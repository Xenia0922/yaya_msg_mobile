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

async function ensureQChatNativeLogin(): Promise<void> {
  const creds = await loadNimCredentials();
  if (!creds) throw new Error('未取到云信登录凭证，请重新登录口袋48账号');
  if (qchatNativeAccid === creds.accid) return;
  const existing = qchatNativeLogins.get(creds.accid);
  if (existing) return existing;
  const task: Promise<void> = (async () => {
    // eslint-disable-next-line no-console
    console.log('[nim] native qchat connect account =', creds.accid);
    await qchatConnect(pocketImAppKeyCompat(), creds.accid, creds.token);
    qchatNativeAccid = creds.accid;
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
  return JSON.stringify({
    module: NimModule.QCHAT,
    channelRole: String(target.channelRole ?? 0),
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
    await qchatSend(String(serverId), String(channelId), content, ext);
    return;
  }
  await ensureLogin();
  await pocketImSendChannelText(serverId, channelId, content, ext);
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
      try { qchatDisconnect(); } catch { /* 忽略 */ }
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
