/**
 * 房间消息（云信圈组 / QChat）收发。
 *
 * 为什么单独一条链路：口袋48 的「房间消息」走云信圈组，而云信只有 Android/iOS 官方 SDK
 * 支持圈组的消息收发；Web/RN 版 SDK 里 qchat 仅保留「取接入地址」，没有发送命令。
 * 因此这里经原生桥（NativeModules.PocketIm，见 PocketImModule.java）调用官方 basesdk + qchat。
 *
 * 官方同款参数（口袋48 7.1.39）：
 * MessageManger#sendTextMessage
 * new QChatSendMessageParam(serverId, channelId, MsgTypeEnum.text)
 * setBody(text) + setExtension(ChatMsgUtil.getChannelBaseParams(channelRole, bubbleId))
 * extension = { channelRole, bubbleId, module: 'QCHAT', user: {...} }
 */

import pocketApi from '../../api/pocket48';
import { ALLOW_VIP_STICKERS } from '../../constants/identityFeatures';
import {
  addPocketImMessageListener,
  isPocketImAvailable,
  pocketImInit,
  pocketImJoinChannel,
  pocketImLogin,
  pocketImObserveMessages,
  pocketImSendChannelText,
  type PocketImMessage,
} from '../../native/PocketIm';
import {
  isPocketNimQChatAvailable,
  qchatConnect,
  qchatDisconnect,
  qchatSend,
  qchatSendCustom,
  qchatSubscribe,
  onQChatMessage,
  onQChatStatus,
} from '../../native/PocketNimQChat';
import { loadSelfProfile } from './credentials';
import { loadNimCredentials } from './credentials';
import { logInfo, logWarn } from '../../utils/runtimeLog';
import { NimModule, NimMsgType } from './types';
import type { NimSelfProfile } from './types';

export interface RoomMessageTarget {
  serverId: string | number;
  channelId: string | number;
  /** 频道身份（官方 channelRole，普通用户 0） */
  channelRole?: number;
  /** 气泡 id（官方默认 '0'） */
  bubbleId?: string;
}

/** 原生桥是否可用（非 Android 或未打包该模块时为 false） */
export { isPocketImAvailable };

let loginInFlight: Promise<void> | null = null;
/** loginInFlight 对应的账号：不同账号的登录任务不能互相复用 */
let loginInFlightAccid = '';
/** loginInFlight 对应的 token：同账号换 token 也不能复用旧登录任务 */
let loginInFlightToken = '';
let loggedInAccid = '';
/** 已登录账号的 token：token 变化（重新登录/换凭证）也要重登 */
let loggedInToken = '';
/** 登录任务序号：reset/新登录后，旧任务不得再写回登录态 */
let loginGeneration = 0;

/** 原生 commonlink QChat 登录（幂等） */
let qchatNativeLogins = new Map<string, Promise<void>>();
let qchatNativeAccid = '';
/**
 * 原生连接实时状态（来自 PocketNimQChat:status）。
 * ⚠️ 只比对 accid 不足以判断「还连着」：网络切换 / 被服务端踢 / 进程内 TCP 半开时
 * accid 不变，旧逻辑会直接 return 而**不重连** → 用户反馈的「有概率连不上房间」+ 发送失败。
 */
let qchatLiveState = 'idle';
let qchatStatusWatched = false;
/** 房间消息订阅引用计数：多个组件共用同一条原生连接，最后一个退订才允许断开 */
let observeRefCount = 0;
/** observeRefCount 所属的连接世代：reset 后旧世代订阅的 unsub 只移除自身监听，不再动新连接 */
let observeRefGeneration = -1;
/** PocketIm（非 QChat）通道的订阅引用计数：多处订阅时最后一方退订才关闭监听 */
let pocketImObserveRefCount = 0;
/** 原生消息监听是否已开启 + 开启中的 Promise（并发订阅只注册一次，避免重复回调） */
let pocketImObserveActive = false;
let pocketImObserveStart: Promise<void> | null = null;

/** 待补订的 serverId（commonlink 尚未建连前调用 subscribeRoomChannel 时暂存） */
let pendingSubscribeServerId = '';

function maskAccid(accid: string): string {
  const s = String(accid || '');
  if (!s) return '';
  return s.length <= 4 ? '****' : `***${s.slice(-4)}`;
}

/** 幂等开启原生消息监听（并发调用共享同一次注册，await 后复核引用计数防竞态泄漏） */
async function ensurePocketImObserve(): Promise<void> {
  if (pocketImObserveActive) return;
  if (!pocketImObserveStart) {
    pocketImObserveStart = pocketImObserveMessages(true)
      .then(() => {
        if (pocketImObserveRefCount > 0) {
          pocketImObserveActive = true;
        } else {
          pocketImObserveActive = false;
          pocketImObserveMessages(false).catch(() => undefined);
        }
      })
      .finally(() => {
        pocketImObserveStart = null;
      });
  }
  await pocketImObserveStart;
}

/** 关闭原生消息监听（最后一个订阅者退订时调用） */
function releasePocketImObserve(): void {
  if (!pocketImObserveActive) return;
  pocketImObserveActive = false;
  pocketImObserveMessages(false).catch(() => undefined);
}
/**
 * 连接世代：每次 reset（切号）递增。
 * 用于丢弃「reset 之后才完成的旧账号 connect」——否则旧任务会写回 qchatNativeAccid，
 * 让后续发送/订阅误以为已用新账号连上（重置与进行中连接赛跑）。
 */
let qchatGeneration = 0;
/**
 * QChat 登录失败后的短冷却：网络异常时每个房间挂载都重试会反复卡住 JS/原生桥，
 * 冷却期内直接走 HTTP 轮询，避免“进房间反应好几秒”。
 */
let qchatLoginCooldownUntil = 0;
const QCHAT_LOGIN_COOLDOWN_MS = 30_000;
const QCHAT_LOGIN_TIMEOUT_MS = 4_000;

function isQChatCancellation(error: unknown): boolean {
  const message = String((error as any)?.message || error || '');
  return /已断开|E_CANCELLED|取消|cancel/i.test(message);
}

function watchQChatStatus(): void {
  if (qchatStatusWatched) return;
  qchatStatusWatched = true;
  try {
    onQChatStatus((status) => {
      qchatLiveState = status.state || 'idle';
      if (qchatLiveState === 'disconnected' || qchatLiveState === 'error') {
        // 连接已死 → 复位登录态，下次发送/进房重新连接
        qchatNativeAccid = '';
      }
    });
  } catch {
    /* 事件不可用：退化为纯 accid 判定 */
  }
}

/**
 * 重置圈组会话（切号 / 登出）。断开原生连接并清掉登录态与在途登录，
 * 使下一次发送/订阅按**新账号**重新连接。
 */
export function resetQChatSession(reason = ''): void {
  qchatGeneration += 1;
  loginGeneration += 1;
  loggedInAccid = '';
  loggedInToken = '';
  loginInFlight = null;
  loginInFlightAccid = '';
  loginInFlightToken = '';
  qchatNativeAccid = '';
  qchatLiveState = 'idle';
  qchatNativeLogins = new Map();
  // 切号/重进房间重新获得一次尝试机会；真正的网络失败由 ensure 重新计时。
  qchatLoginCooldownUntil = 0;
  // 新世代从 0 重新计数；旧世代订阅的 unsub 会按 observeRefGeneration 判定并直接跳过，
  // 不会把新连接的计数减到 0（P1-C9）。
  observeRefCount = 0;
  observeRefGeneration = qchatGeneration;
  pendingSubscribeServerId = '';
  try {
    qchatDisconnect();
  } catch {
    /* 忽略 */
  }
  logInfo(`[nim] qchat session reset${reason ? ` (${reason})` : ''}`, 'nim');
}

async function ensureQChatNativeLogin(force = false): Promise<void> {
  if (!force && Date.now() < qchatLoginCooldownUntil) {
    throw new Error('QChat 登录冷却中，走轮询');
  }
  watchQChatStatus();
  const creds = await loadNimCredentials();
  if (!creds) throw new Error('未取到云信登录凭证，请重新登录口袋48账号');
  // 已连接（accid 一致且原生未报断连）→ 复用；force = 发送失败后的强制重连
  if (
    !force &&
    qchatNativeAccid === creds.accid &&
    qchatLiveState !== 'disconnected' &&
    qchatLiveState !== 'error'
  ) {
    return;
  }
  if (force) {
    qchatNativeAccid = '';
    qchatNativeLogins.delete(creds.accid);
    try {
      qchatDisconnect();
    } catch {
      /* 忽略 */
    }
  } else {
    const existing = qchatNativeLogins.get(creds.accid);
    if (existing) return existing;
  }
  const generation = qchatGeneration;
  const task: Promise<void> = (async () => {
    logInfo(`[nim] native qchat connect account = ${maskAccid(creds.accid)}`, 'nim');
    // 原生 connect 没有超时兜底；限时 4s，超时主动断开原生连接避免后台泄漏，让房间走轮询。
    let timeout: ReturnType<typeof setTimeout> | null = null;
    try {
      await Promise.race([
        qchatConnect(pocketImAppKeyCompat(), creds.accid, creds.token),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new Error('QChat 登录超时')), QCHAT_LOGIN_TIMEOUT_MS);
        }),
      ]);
    } catch (err) {
      if (!isQChatCancellation(err)) {
        try {
          qchatDisconnect();
        } catch {
          /* 忽略 */
        }
      }
      throw err;
    } finally {
      if (timeout) clearTimeout(timeout);
    }
    // reset（切号）发生在本次连接过程中 → 这条连接属于旧账号，丢弃并立刻断开，
    // 否则会把旧账号写进登录态，之后发送会以旧身份出去
    if (generation !== qchatGeneration) {
      logInfo('[nim] native qchat connect finished after session reset → discard', 'nim');
      try {
        qchatDisconnect();
      } catch {
        /* 忽略 */
      }
      return;
    }
    qchatNativeAccid = creds.accid;
    qchatLiveState = 'connected';
    logInfo('[nim] native qchat CONNECTED', 'nim');
  })();
  qchatNativeLogins.set(creds.accid, task);
  try {
    await task;
    qchatLoginCooldownUntil = 0;
  } catch (e) {
    if (!isQChatCancellation(e)) {
      qchatLoginCooldownUntil = Date.now() + QCHAT_LOGIN_COOLDOWN_MS;
    }
    throw e;
  } finally {
    qchatNativeLogins.delete(creds.accid);
  }
  return task;
}

/** appKey 兜底（原生侧同样是这个常量） */
function pocketImAppKeyCompat(): string {
  return '632feff1f4c838541ab75195d1ceb3fa';
}

/** 幂等登录：init + login 只做一次（切换账号或 token 变化时自动重登） */
async function ensureLogin(): Promise<void> {
  if (!isPocketImAvailable()) {
    throw new Error('房间发言需要云信圈组通道，当前构建未包含该原生模块');
  }
  const creds = await loadNimCredentials();
  if (!creds) throw new Error('未取到云信登录凭证，请重新登录口袋48账号');
  if (loggedInAccid === creds.accid && loggedInToken === creds.token) return;
  // 仅复用同一账号且同一 token 的在途登录；跨账号（或同账号新 token）不能复用旧 Promise
  if (loginInFlight && loginInFlightAccid === creds.accid && loginInFlightToken === creds.token)
    return loginInFlight;
  const generation = ++loginGeneration;
  loginInFlightAccid = creds.accid;
  loginInFlightToken = creds.token;
  const task = (async () => {
    try {
      logInfo(
        `[nim] qchat ensureLogin accid = ${maskAccid(creds.accid)} tokenLen = ${creds.token.length}`,
        'nim',
      );
      await pocketImInit();
      await pocketImLogin(creds.accid, creds.token);
      // 期间 reset/重新登录过：此次登录结果属于旧会话，丢弃，避免覆盖新登录态
      if (generation !== loginGeneration) return;
      loggedInAccid = creds.accid;
      loggedInToken = creds.token;
      logInfo('[nim] qchat login ok', 'nim');
    } catch (err: any) {
      logWarn(`[nim] qchat login FAILED: ${String(err?.message || err)}`, 'nim');
      throw err;
    } finally {
      if (generation === loginGeneration) {
        loginInFlight = null;
        loginInFlightAccid = '';
        loginInFlightToken = '';
      }
    }
  })();
  loginInFlight = task;
  return task;
}

export function buildChannelExt(target: RoomMessageTarget, self: NimSelfProfile): string {
  // 官方 getChannelBaseParams：channelRole 是 **Integer**（我们此前发字符串，gson 解析异常时身份就乱了）
  return JSON.stringify({
    module: NimModule.QCHAT,
    channelRole: Math.trunc(Number(target.channelRole ?? 0)) || 0,
    user: {
      userId: self.userId,
      nickName: self.nickName,
      teamLogo: self.teamLogo || '',
      isStar: self.isStar === true,
      avatar: self.avatar,
      level: self.level ?? 0,
      roleId: self.roleId ?? 0,
      vip: self.vip === true,
      pfUrl: self.pfUrl || '',
      badge: Array.isArray(self.badge) ? self.badge : [],
    },
    bubbleId: String(target.bubbleId || '0'),
  });
}

/** 回复引用（官方 REPLY 消息的 replyInfo 字段） */
export interface RoomReplyInfo {
  /** 被回复消息的 msgIdClient */
  replyMessageId: string;
  /** 被回复者名字 */
  replyName: string;
  /** 被回复消息正文 */
  replyText: string;
}

export interface RoomSticker {
  sourceName: string;
  sourcePath: string;
  width: number;
  height: number;
  vip: boolean;
}

/** 按口袋圈组自定义消息格式发送；服务端保留最终权限判断。 */
export async function sendRoomSticker(
  target: RoomMessageTarget,
  sticker: RoomSticker,
): Promise<void> {
  if (sticker.vip && !ALLOW_VIP_STICKERS) throw new Error('当前版本不支持发送 VIP 表情包');
  const serverId = String(target.serverId || '');
  const channelId = String(target.channelId || '');
  if (
    !/^\d+$/.test(serverId) ||
    serverId === '0' ||
    !/^\d+$/.test(channelId) ||
    channelId === '0' ||
    !sticker.sourcePath
  )
    throw new Error('表情包或房间信息不完整');
  const self = await loadSelfProfile();
  if (!self) throw new Error('未取到云信登录凭证，请重新登录口袋48账号');
  if (!isPocketNimQChatAvailable()) throw new Error('当前设备不支持发送表情包');
  const attachment = JSON.stringify({
    messageType: 'EXPRESSIMAGE',
    expressImgInfo: {
      emotionName: sticker.sourceName,
      emotionPattern: sticker.sourcePath,
      emotionRemote: sticker.sourcePath,
      width: Math.max(0, Math.round(Number(sticker.width) || 0)),
      height: Math.max(0, Math.round(Number(sticker.height) || 0)),
    },
  });
  const ext = buildChannelExt(target, self);
  await ensureQChatNativeLogin();
  try {
    await qchatSendCustom(serverId, channelId, attachment, ext);
  } catch (error: any) {
    const detail = String(error?.message || error || '');
    logWarn(`[nim] qchat 表情包发送失败，重连后重试：${detail}`, 'nim');
    await ensureQChatNativeLogin(true);
    try {
      await qchatSendCustom(serverId, channelId, attachment, ext);
    } catch (retryError: any) {
      throw new Error(
        `表情包发送失败（已重连重试）：${String(retryError?.message || retryError || detail)}`,
      );
    }
  }
}

/** 订阅房间圈组频道（Android commonlink 走 cmd 25/7，其余平台回退官方 SDK） */
export async function subscribeRoomChannel(
  serverId: string | number,
  channelId: string | number,
): Promise<boolean> {
  const sid = String(serverId ?? '').trim();
  const cid = String(channelId ?? '').trim();
  if (!/^\d+$/.test(sid) || sid === '0') return false;
  if (isPocketNimQChatAvailable()) {
    pendingSubscribeServerId = sid;
    return qchatSubscribe(sid);
  }
  if (isPocketImAvailable()) {
    if (!/^\d+$/.test(cid) || cid === '0') return false;
    return pocketImJoinChannel(Number(sid), Number(cid));
  }
  return false;
}

/** 发送房间文本消息；带 reply 时按官方 REPLY 结构组包（bodys 变 JSON，msgType=REPLY） */
export async function sendRoomTextMessage(
  target: RoomMessageTarget,
  text: string,
  reply?: RoomReplyInfo | null,
): Promise<void> {
  const body = String(text || '').trim();
  if (!body) return;
  // 官方真实样本：普通消息 bodys = 纯文本；回复消息 bodys = JSON
  // {"replyInfo":{"replyMessageId","replyName","replyText","text","userId":0},"messageType":"REPLY"}
  const content = reply?.replyMessageId
    ? JSON.stringify({
        replyInfo: {
          replyMessageId: String(reply.replyMessageId),
          replyName: String(reply.replyName || ''),
          replyText: String(reply.replyText || ''),
          text: body,
          userId: 0,
        },
        messageType: 'REPLY',
      })
    : body;
  // serverId/channelId 可能是 64 位整数：全程按字符串校验与传递，禁止 Number 丢精度。
  const serverId = String(target.serverId ?? '').trim();
  const channelId = String(target.channelId ?? '').trim();
  if (
    !/^\d+$/.test(serverId) ||
    serverId === '0' ||
    !/^\d+$/.test(channelId) ||
    channelId === '0'
  ) {
    throw new Error('缺少房间 serverId / channelId');
  }
  // 优先走原生 commonlink QChat 通道：官方 SDK 只能带真实包名 → 被服务端拒（实测 414）
  const self = await loadSelfProfile();
  if (!self) throw new Error('未取到云信登录凭证，请重新登录口袋48账号');
  const ext = buildChannelExt(target, self);
  if (isPocketNimQChatAvailable()) {
    await ensureQChatNativeLogin();
    try {
      await qchatSend(serverId, channelId, content, ext);
    } catch (error: any) {
      // 发送失败最常见的原因是连接已死（TCP 半开 / 被服务端踢 / 刚切过号）：
      // 强制重连一次再发，避免用户看到「发送失败」而其实只是连接需要重建
      // （即用户反馈的「有概率连不上房间 / 发送出错」）。
      const detail = String(error?.message || error || '');
      logWarn(`[nim] qchat 发送失败，重连后重试：${detail}`, 'nim');
      await ensureQChatNativeLogin(true);
      try {
        await qchatSend(serverId, channelId, content, ext);
      } catch (retryError: any) {
        // 重连后仍失败：给出可读原因（多为凭证过期 / 房间 serverId 与 channelId 不匹配）
        throw new Error(
          `房间消息发送失败（已重连重试）：${String(retryError?.message || retryError || detail)}`,
        );
      }
    }
    return;
  }
  await ensureLogin();
  await pocketImSendChannelText(Number(serverId), Number(channelId), content, ext);
}

/**
 * 删除（撤回）自己在房间发送的消息。官方仅允许删除本人消息（服务端校验 accId）。
 * payload 取自消息项：channelId / msgIdClient / msgTime。
 */
export async function deleteRoomMessage(params: {
  channelId: number | string;
  msgIdClient: string;
  msgTime: number;
}): Promise<void> {
  const creds = await loadNimCredentials();
  if (!creds) throw new Error('未取到云信登录凭证，请重新登录口袋48账号');
  if (!params.msgIdClient) throw new Error('缺少消息 ID');
  if (!params.msgTime || params.msgTime <= 0) throw new Error('缺少消息时间');
  await pocketApi.deleteTeamMsg({
    accId: creds.accid,
    msgIdClient: String(params.msgIdClient),
    channelId: String(params.channelId || ''),
    msgTime: Number(params.msgTime),
  });
}

export interface RoomLiveMessage {
  uuid: string;
  serverId: number;
  channelId: number;
  fromAccount: string;
  fromNick: string;
  time: number;
  text: string;
  messageType: string;
  attachment?: Record<string, any>;
  /** 解析后的 remoteExtension */
  ext: Record<string, any>;
}

function normalizeLiveMessage(msg: PocketImMessage): RoomLiveMessage | null {
  if (!msg || !msg.uuid) return null;
  let ext: Record<string, any> = {};
  try {
    ext = msg.extension ? JSON.parse(msg.extension) : {};
  } catch {
    ext = {};
  }
  const user = (ext.user && typeof ext.user === 'object' ? ext.user : {}) as Record<string, any>;
  let attachment: Record<string, any> = {};
  try {
    attachment = msg.attachment ? JSON.parse(msg.attachment) : {};
  } catch {
    attachment = {};
  }
  return {
    uuid: String(msg.uuid),
    serverId: Number(msg.serverId) || 0,
    channelId: Number(msg.channelId) || 0,
    fromAccount: String(msg.fromAccount || user.accid || ''),
    fromNick: String(msg.fromNick || user.nickName || ''),
    time: Number(msg.time) || Date.now(),
    text: String(msg.content || ext.text || ''),
    messageType: String(
      attachment.messageType || ext.messageType || msg.msgType || NimMsgType.TEXT,
    ),
    attachment,
    ext,
  };
}

/** 订阅房间实时消息（返回取消订阅函数；不支持时为空操作） */
export async function observeRoomMessages(
  handler: (messages: RoomLiveMessage[]) => void,
): Promise<() => void> {
  // 原生 commonlink QChat 通道（推荐路径）
  if (isPocketNimQChatAvailable()) {
    const generation = qchatGeneration;
    let disposed = false;
    let off: (() => void) | null = null;
    let observerAttached = false;

    // ⚠️ 不要 await 登录后再返回：原生登录在弱网/模拟器上可能卡 4s+，
    // 虽不阻塞 JS，但会让房间等实时通道；先返回清理函数，后台完成登录/observer，
    // 期间房间照常走 HTTP 轮询，登录成功后再无缝接上实时推送。
    const attach = async () => {
      try {
        await ensureQChatNativeLogin();
      } catch (e) {
        if (disposed) return;
        if (isQChatCancellation(e)) {
          logInfo('[qchat] 登录被房间切换取消，走轮询', 'nim');
        } else if (/超时|冷却中/.test(String((e as any)?.message || e))) {
          // 超时/冷却不是致命错误：房间已有轮询，不刷 WARN 吓用户。
          logInfo(`[qchat] 实时通道暂不可用，继续轮询：${String((e as any)?.message || e)}`, 'nim');
        } else {
          logWarn(
            `[qchat] 实时消息通道登录失败，降级为轮询：${String((e as any)?.message || e)}`,
            'nim',
          );
        }
        return;
      }
      if (disposed || generation !== qchatGeneration) return;
      if (observeRefGeneration !== generation) {
        observeRefCount = 0;
        observeRefGeneration = generation;
      }
      observeRefCount += 1;
      observerAttached = true;
      if (pendingSubscribeServerId) {
        void qchatSubscribe(pendingSubscribeServerId);
      }
      if (disposed) return;
      off = onQChatMessage((message) => {
        let ext: Record<string, any> = {};
        try {
          ext = message.ext ? JSON.parse(message.ext) : {};
        } catch {
          ext = {};
        }
        const user = (ext.user && typeof ext.user === 'object' ? ext.user : {}) as Record<
          string,
          any
        >;
        let attachment: Record<string, any> = {};
        try {
          attachment = message.attachment ? JSON.parse(message.attachment) : {};
        } catch {}
        handler([
          {
            uuid: message.msgIdClient || message.msgIdServer || `${message.time}`,
            serverId: Number(message.serverId) || 0,
            channelId: Number(message.channelId) || 0,
            fromAccount: message.fromAccount,
            fromNick: message.fromNick || String(user.nickName || ''),
            time: message.time || Date.now(),
            text: message.body || String(ext.text || ''),
            messageType: String(attachment.messageType || ext.messageType || 'TEXT'),
            attachment,
            ext,
          },
        ]);
      });
    };
    void attach();

    return () => {
      if (disposed) return;
      disposed = true;
      if (off) {
        off();
        off = null;
      }
      if (!observerAttached) return;
      // 旧世代的订阅（reset 之前建立）不能影响 reset 之后的新连接状态
      if (generation !== qchatGeneration) return;
      // ⚠️ 引用计数：房间页与其它调用方共用同一条原生连接，
      // 任一方退订就 disconnect 会把另一方的连接一起掐掉
      // （症状：切页/退出再进后收不到实时消息、发送失败）。
      observeRefCount = Math.max(0, observeRefCount - 1);
      if (observeRefCount === 0) {
        try {
          qchatDisconnect();
        } catch {
          /* 忽略 */
        }
        // 断开后必须复位登录态：否则下次 ensureQChatNativeLogin 见 accid 相同会直接 return，
        // 不会真正重连 → 房间消息通道「只能连接/发送一次」。点进房间/点输入框即触发重连。
        qchatNativeAccid = '';
        qchatLiveState = 'idle';
      }
    };
  }
  if (!isPocketImAvailable()) return () => undefined;
  pocketImObserveRefCount += 1;
  try {
    await ensureLogin();
    // 多处订阅共用原生监听：只注册一次，最后一个订阅者退订才关闭
    await ensurePocketImObserve();
  } catch {
    pocketImObserveRefCount = Math.max(0, pocketImObserveRefCount - 1);
    return () => undefined;
  }
  const sub = addPocketImMessageListener((raw) => {
    const items = (raw || [])
      .map((item) => normalizeLiveMessage(item))
      .filter((item): item is RoomLiveMessage => !!item);
    if (items.length) handler(items);
  });
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    sub.remove();
    pocketImObserveRefCount = Math.max(0, pocketImObserveRefCount - 1);
    if (pocketImObserveRefCount === 0) releasePocketImObserve();
  };
}
