/**
 * 房间消息（云信圈组 / QChat）收发。
 *
 * 为什么单独一条链路：口袋48 的「房间消息」走云信圈组，而云信只有 Android/iOS 官方 SDK
 * 支持圈组的消息收发；Web/RN 版 SDK 里 qchat 仅保留「取接入地址」，没有发送命令。
 * 因此这里经原生桥（NativeModules.PocketIm，见 PocketImModule.java）调用官方 basesdk + qchat。
 *
 * 官方同款参数（口袋48 7.1.39）：
 *   MessageManger#sendTextMessage
 *     new QChatSendMessageParam(serverId, channelId, MsgTypeEnum.text)
 *     setBody(text) + setExtension(ChatMsgUtil.getChannelBaseParams(channelRole, bubbleId))
 *     extension = { channelRole, bubbleId, module: 'QCHAT', user: {...} }
 */

import pocketApi from '../../api/pocket48';
import {
  addPocketImMessageListener,
  isPocketImAvailable,
  pocketImInit,
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
  onQChatMessage,
  onQChatStatus,
} from '../../native/PocketNimQChat';
import { loadSelfProfile } from './credentials';
import { loadNimCredentials } from './credentials';
import { credentialsToProfile } from './runtime';
import { logWarn } from '../../utils/runtimeLog';
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
let loggedInAccid = '';

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
/**
 * 连接世代：每次 reset（切号）递增。
 * 用于丢弃「reset 之后才完成的旧账号 connect」——否则旧任务会写回 qchatNativeAccid，
 * 让后续发送/订阅误以为已用新账号连上（重置与进行中连接赛跑）。
 */
let qchatGeneration = 0;

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
  loggedInAccid = '';
  qchatNativeAccid = '';
  qchatLiveState = 'idle';
  qchatNativeLogins = new Map();
  // 旧订阅者的 unsub 仍会调用（refcount 已清零 → max(0,-1)=0 不会误断新连接），
  // 这里归零是为了让新订阅从 1 重新计数。
  observeRefCount = 0;
  try {
    qchatDisconnect();
  } catch {
    /* 忽略 */
  }
  // eslint-disable-next-line no-console
  console.log('[nim] qchat session reset', reason ? `(${reason})` : '');
}

async function ensureQChatNativeLogin(force = false): Promise<void> {
  watchQChatStatus();
  const creds = await loadNimCredentials();
  if (!creds) throw new Error('未取到云信登录凭证，请重新登录口袋48账号');
  // 已连接（accid 一致且原生未报断连）→ 复用；force = 发送失败后的强制重连
  if (!force && qchatNativeAccid === creds.accid && qchatLiveState !== 'disconnected' && qchatLiveState !== 'error') {
    return;
  }
  const existing = qchatNativeLogins.get(creds.accid);
  if (existing) return existing;
  const generation = qchatGeneration;
  const task: Promise<void> = (async () => {
    // eslint-disable-next-line no-console
    console.log('[nim] native qchat connect account =', creds.accid);
    await qchatConnect(pocketImAppKeyCompat(), creds.accid, creds.token);
    // reset（切号）发生在本次连接过程中 → 这条连接属于旧账号，丢弃并立刻断开，
    // 否则会把旧账号写进登录态，之后发送会以旧身份出去
    if (generation !== qchatGeneration) {
      // eslint-disable-next-line no-console
      console.log('[nim] native qchat connect finished after session reset → discard');
      try {
        qchatDisconnect();
      } catch {
        /* 忽略 */
      }
      return;
    }
    qchatNativeAccid = creds.accid;
    qchatLiveState = 'connected';
    // eslint-disable-next-line no-console
    console.log('[nim] native qchat CONNECTED');
  })();
  qchatNativeLogins.set(creds.accid, task);
  try {
    await task;
  } finally {
    qchatNativeLogins.delete(creds.accid);
  }
  return task;
}

/** appKey 兜底（原生侧同样是这个常量） */
function pocketImAppKeyCompat(): string {
  return '632feff1f4c838541ab75195d1ceb3fa';
}

/** 幂等登录：init + login 只做一次（切换账号时自动重登） */
async function ensureLogin(): Promise<void> {
  if (!isPocketImAvailable()) {
    throw new Error('房间发言需要云信圈组通道，当前构建未包含该原生模块');
  }
  const creds = await loadNimCredentials();
  if (!creds) throw new Error('未取到云信登录凭证，请重新登录口袋48账号');
  if (loggedInAccid === creds.accid) return;
  if (loginInFlight) return loginInFlight;
  loginInFlight = (async () => {
    try {
      // eslint-disable-next-line no-console
      console.log('[nim] qchat ensureLogin accid =', creds.accid, 'tokenLen =', creds.token.length);
      await pocketImInit();
      await pocketImLogin(creds.accid, creds.token);
      loggedInAccid = creds.accid;
      // eslint-disable-next-line no-console
      console.log('[nim] qchat login ok');
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.log('[nim] qchat login FAILED:', String(err?.message || err));
      throw err;
    } finally {
      loginInFlight = null;
    }
  })();
  return loginInFlight;
}

/**
 * 构造圈组消息扩展段（对齐 ChatMsgUtil.getChannelBaseParams）。
 * 服务端会用 user 段渲染昵称/头像，缺失时消息可能显示异常。
 */
export function buildChannelExt(target: RoomMessageTarget, self: NimSelfProfile): string {
  // 字段与桌面版 member-room-message.buildExtension 一致（vip/pfUrl/teamLogo 缺了别人那端渲染就缺东西）
  // 官方 getChannelBaseParams：channelRole 是 **Integer**（我们此前发字符串，gson 解析异常时身份就乱了）
  return JSON.stringify({
    module: NimModule.QCHAT,
    channelRole: Math.trunc(Number(self.sessionRole ?? target.channelRole ?? 0)) || 0,
    user: {
      userId: self.userId,
      nickName: self.nickName,
      teamLogo: self.teamLogo || '',
      avatar: self.avatar,
      level: self.level ?? 0,
      roleId: self.roleId ?? 0,
      vip: self.vip === true,
      pfUrl: self.pfUrl || '',
    },
    bubbleId: String(target.bubbleId || '0'),
  });
}

/** 发送房间文本消息 */
export async function sendRoomTextMessage(target: RoomMessageTarget, text: string): Promise<void> {
  const content = String(text || '').trim();
  if (!content) return;
  const serverId = Number(target.serverId);
  const channelId = Number(target.channelId);
  if (!Number.isFinite(serverId) || !Number.isFinite(channelId) || channelId <= 0) {
    throw new Error('缺少房间 serverId / channelId');
  }
  // 优先走原生 commonlink QChat 通道：官方 SDK 只能带真实包名 → 被服务端拒（实测 414）
  const self = await loadSelfProfile();
  if (!self) throw new Error('未取到云信登录凭证，请重新登录口袋48账号');
  const ext = buildChannelExt(target, self);
  // eslint-disable-next-line no-console
  console.log('[nim] qchat send ext =', ext.slice(0, 400));
  if (isPocketNimQChatAvailable()) {
    await ensureQChatNativeLogin();
    try {
      await qchatSend(String(serverId), String(channelId), content, ext);
    } catch (error: any) {
      // 发送失败最常见的原因是连接已死（TCP 半开 / 被服务端踢 / 刚切过号）：
      // 强制重连一次再发，避免用户看到「发送失败」而其实只是连接需要重建
      // （即用户反馈的「有概率连不上房间 / 发送出错」）。
      const detail = String(error?.message || error || '');
      logWarn(`[nim] qchat 发送失败，重连后重试：${detail}`, 'nim');
      await ensureQChatNativeLogin(true);
      try {
        await qchatSend(String(serverId), String(channelId), content, ext);
      } catch (retryError: any) {
        // 重连后仍失败：给出可读原因（多为凭证过期 / 房间 serverId 与 channelId 不匹配）
        throw new Error(`房间消息发送失败（已重连重试）：${String(retryError?.message || retryError || detail)}`);
      }
    }
    return;
  }
  await ensureLogin();
  await pocketImSendChannelText(serverId, channelId, content, ext);
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

/** 归一化后的房间消息（与 HTTP 历史消息字段对齐，便于直接拼进列表） */
export interface RoomLiveMessage {
  uuid: string;
  serverId: number;
  channelId: number;
  fromAccount: string;
  fromNick: string;
  time: number;
  text: string;
  messageType: string;
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
  return {
    uuid: String(msg.uuid),
    serverId: Number(msg.serverId) || 0,
    channelId: Number(msg.channelId) || 0,
    fromAccount: String(msg.fromAccount || user.accid || ''),
    fromNick: String(msg.fromNick || user.nickName || ''),
    time: Number(msg.time) || Date.now(),
    text: String(msg.content || ext.text || ''),
    messageType: String(ext.messageType || NimMsgType.TEXT),
    ext,
  };
}

/** 订阅房间实时消息（返回取消订阅函数；不支持时为空操作） */
export async function observeRoomMessages(
  handler: (messages: RoomLiveMessage[]) => void
): Promise<() => void> {
  // 原生 commonlink QChat 通道（推荐路径）
  if (isPocketNimQChatAvailable()) {
    try {
      await ensureQChatNativeLogin();
    } catch {
      return () => undefined;
    }
    observeRefCount += 1;
    const off = onQChatMessage((message) => {
      let ext: Record<string, any> = {};
      try {
        ext = message.ext ? JSON.parse(message.ext) : {};
      } catch {
        ext = {};
      }
      const user = (ext.user && typeof ext.user === 'object' ? ext.user : {}) as Record<string, any>;
      handler([
        {
          uuid: message.msgIdClient || message.msgIdServer || `${message.time}`,
          serverId: Number(message.serverId) || 0,
          channelId: Number(message.channelId) || 0,
          fromAccount: message.fromAccount,
          fromNick: message.fromNick || String(user.nickName || ''),
          time: message.time || Date.now(),
          text: message.body || String(ext.text || ''),
          messageType: String(ext.messageType || 'TEXT'),
          ext,
        },
      ]);
    });
    return () => {
      off();
      // ⚠️ 引用计数：房间页与其它调用方共用同一条原生连接，
      // 任一方退订就 disconnect 会把另一方的连接一起掐掉
      // （症状：切页/退出再进后收不到实时消息、发送失败）。
      observeRefCount = Math.max(0, observeRefCount - 1);
      if (observeRefCount === 0) {
        try { qchatDisconnect(); } catch { /* 忽略 */ }
        // 断开后必须复位登录态：否则下次 ensureQChatNativeLogin 见 accid 相同会直接 return，
        // 不会真正重连 → 房间消息通道「只能连接/发送一次」。点进房间/点输入框即触发重连。
        qchatNativeAccid = '';
        qchatLiveState = 'idle';
      }
    };
  }
  if (!isPocketImAvailable()) return () => undefined;
  try {
    await ensureLogin();
    await pocketImObserveMessages(true);
  } catch {
    return () => undefined;
  }
  const sub = addPocketImMessageListener((raw) => {
    const items = (raw || [])
      .map((item) => normalizeLiveMessage(item))
      .filter((item): item is RoomLiveMessage => !!item);
    if (items.length) handler(items);
  });
  return () => {
    sub.remove();
    pocketImObserveMessages(false).catch(() => undefined);
  };
}
