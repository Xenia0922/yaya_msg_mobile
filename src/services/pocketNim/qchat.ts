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
  qchatSubscribeBatch,
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

  channelRole?: number;

  bubbleId?: string;
}

export { isPocketImAvailable };

let loginInFlight: Promise<void> | null = null;

let loginInFlightAccid = '';

let loginInFlightToken = '';
let loggedInAccid = '';

let loggedInToken = '';

let loginGeneration = 0;

let qchatNativeLogins = new Map<string, Promise<void>>();
let qchatNativeAccid = '';

let qchatLiveState = 'idle';
let qchatStatusWatched = false;

let observeRefCount = 0;

let observeRefGeneration = -1;

let pocketImObserveRefCount = 0;

let pocketImObserveActive = false;
let pocketImObserveStart: Promise<void> | null = null;

const pendingSubscribeServerIds = new Set<string>();

const subscribedInSession = new Set<string>();

let flushPendingPromise: Promise<boolean> | null = null;

async function flushPendingSubscriptions(): Promise<boolean> {
  if (!isPocketNimQChatAvailable() || pendingSubscribeServerIds.size === 0) return false;
  if (flushPendingPromise) {
    await flushPendingPromise;
  }
  const toSend = Array.from(pendingSubscribeServerIds).filter(
    (sid) => !subscribedInSession.has(sid),
  );
  if (!toSend.length) return true;
  const gen = qchatGeneration;
  const run = qchatSubscribeBatch(toSend).then((ok) => {
    if (ok && gen === qchatGeneration && qchatLiveState === 'connected') {
      for (const sid of toSend) subscribedInSession.add(sid);
    }
    return ok;
  });
  flushPendingPromise = run;
  try {
    return await run;
  } finally {
    if (flushPendingPromise === run) flushPendingPromise = null;
  }
}

function maskAccid(accid: string): string {
  const s = String(accid || '');
  if (!s) return '';
  return s.length <= 4 ? '****' : `***${s.slice(-4)}`;
}

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

function releasePocketImObserve(): void {
  if (!pocketImObserveActive) return;
  pocketImObserveActive = false;
  pocketImObserveMessages(false).catch(() => undefined);
}

let qchatGeneration = 0;

let qchatLoginCooldownUntil = 0;
const QCHAT_LOGIN_COOLDOWN_MS = 10_000;
const QCHAT_LOGIN_TIMEOUT_MS = 12_000;

const qchatConnectListeners = new Set<() => void>();

export function onQChatConnected(listener: () => void): () => void {
  qchatConnectListeners.add(listener);
  return () => {
    qchatConnectListeners.delete(listener);
  };
}

function isQChatCancellation(error: unknown): boolean {
  const message = String((error as any)?.message || error || '');
  return /已断开|E_CANCELLED|取消|cancel/i.test(message);
}

function watchQChatStatus(): void {
  if (qchatStatusWatched) return;
  qchatStatusWatched = true;
  try {
    onQChatStatus((status) => {
      const nextState = status.state || 'idle';
      const prevState = qchatLiveState;
      qchatLiveState = nextState;
      if (qchatLiveState === 'disconnected' || qchatLiveState === 'error') {
        qchatNativeAccid = '';
        subscribedInSession.clear();
      } else if (nextState === 'connected' && prevState !== 'connected') {
        subscribedInSession.clear();
        if (pendingSubscribeServerIds.size > 0) {
          void flushPendingSubscriptions();
        }
        qchatConnectListeners.forEach((fn) => {
          try {
            fn();
          } catch {}
        });
      }
    });
  } catch {}
}

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

  qchatLoginCooldownUntil = 0;

  observeRefCount = 0;
  observeRefGeneration = qchatGeneration;
  pendingSubscribeServerIds.clear();
  subscribedInSession.clear();
  flushPendingPromise = null;
  try {
    qchatDisconnect();
  } catch {}
  logInfo(`[nim] qchat session reset${reason ? ` (${reason})` : ''}`, 'nim');
}

async function ensureQChatNativeLogin(force = false, bypassCooldown = false): Promise<void> {
  if (!force && !bypassCooldown && Date.now() < qchatLoginCooldownUntil) {
    throw new Error('QChat 登录冷却中');
  }
  watchQChatStatus();
  const creds = await loadNimCredentials();
  if (!creds) throw new Error('未取到云信登录凭证，请重新登录口袋48账号');

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
    } catch {}
  } else {
    const existing = qchatNativeLogins.get(creds.accid);
    if (existing) return existing;
  }
  const generation = qchatGeneration;
  const task: Promise<void> = (async () => {
    logInfo(`[nim] native qchat connect account = ${maskAccid(creds.accid)}`, 'nim');

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
        } catch {}
      }
      throw err;
    } finally {
      if (timeout) clearTimeout(timeout);
    }

    if (generation !== qchatGeneration) {
      logInfo('[nim] native qchat connect finished after session reset → discard', 'nim');
      try {
        qchatDisconnect();
      } catch {}
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

export async function ensureGlobalQChatConnection(bypassCooldown = false): Promise<boolean> {
  if (!isPocketNimQChatAvailable()) return false;
  try {
    await ensureQChatNativeLogin(false, bypassCooldown);
    if (pendingSubscribeServerIds.size > 0) {
      await flushPendingSubscriptions();
    }
    return true;
  } catch (e) {
    if (!isQChatCancellation(e)) {
      logInfo(`[qchat] 全局常驻连接待重试：${String((e as any)?.message || e)}`, 'nim');
    }
    return false;
  }
}

export function pauseQChatSession(reason = '切到后台'): void {
  qchatGeneration += 1;
  qchatNativeAccid = '';
  qchatLiveState = 'idle';
  qchatNativeLogins = new Map();
  subscribedInSession.clear();
  if (isPocketNimQChatAvailable()) {
    try {
      qchatDisconnect();
    } catch {}
  }
  if (reason) logInfo(`[nim] qchat pause (${reason})`, 'nim');
}

function pocketImAppKeyCompat(): string {
  return '632feff1f4c838541ab75195d1ceb3fa';
}

async function ensureLogin(): Promise<void> {
  if (!isPocketImAvailable()) {
    throw new Error('房间发言需要云信圈组通道，当前构建未包含该原生模块');
  }
  const creds = await loadNimCredentials();
  if (!creds) throw new Error('未取到云信登录凭证，请重新登录口袋48账号');
  if (loggedInAccid === creds.accid && loggedInToken === creds.token) return;

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

export interface RoomReplyInfo {
  replyMessageId: string;

  replyName: string;

  replyText: string;
}

export interface RoomSticker {
  sourceName: string;
  sourcePath: string;
  width: number;
  height: number;
  vip: boolean;
}

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
  await ensureQChatNativeLogin(false, true);
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

export async function subscribeRoomChannel(
  serverId: string | number,
  channelId: string | number,
): Promise<boolean> {
  const sid = String(serverId ?? '').trim();
  const cid = String(channelId ?? '').trim();
  if (!/^\d+$/.test(sid) || sid === '0') return false;
  if (isPocketNimQChatAvailable()) {
    pendingSubscribeServerIds.add(sid);
    return qchatSubscribe(sid);
  }
  if (isPocketImAvailable()) {
    if (!/^\d+$/.test(cid) || cid === '0') return false;
    return pocketImJoinChannel(Number(sid), Number(cid));
  }
  return false;
}

export async function subscribeRoomChannelsBatch(
  serverIds: Array<string | number>,
): Promise<boolean> {
  if (!isPocketNimQChatAvailable()) return false;
  const valid = serverIds
    .map((v) => String(v ?? '').trim())
    .filter((s) => /^\d+$/.test(s) && s !== '0');
  if (!valid.length) return false;
  let added = false;
  for (const sid of valid) {
    if (!pendingSubscribeServerIds.has(sid)) {
      pendingSubscribeServerIds.add(sid);
      added = true;
    }
  }
  const hasUnsent = valid.some((sid) => !subscribedInSession.has(sid));
  if (!added && !hasUnsent) return true;
  if (qchatLiveState !== 'connected') return false;
  return flushPendingSubscriptions();
}

export async function sendRoomTextMessage(
  target: RoomMessageTarget,
  text: string,
  reply?: RoomReplyInfo | null,
): Promise<void> {
  const body = String(text || '').trim();
  if (!body) return;

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

  const self = await loadSelfProfile();
  if (!self) throw new Error('未取到云信登录凭证，请重新登录口袋48账号');
  const ext = buildChannelExt(target, self);
  if (isPocketNimQChatAvailable()) {
    await ensureQChatNativeLogin(false, true);
    try {
      await qchatSend(serverId, channelId, content, ext);
    } catch (error: any) {
      const detail = String(error?.message || error || '');
      logWarn(`[nim] qchat 发送失败，重连后重试：${detail}`, 'nim');
      await ensureQChatNativeLogin(true);
      try {
        await qchatSend(serverId, channelId, content, ext);
      } catch (retryError: any) {
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

export async function observeRoomMessages(
  handler: (messages: RoomLiveMessage[]) => void,
): Promise<() => void> {
  if (isPocketNimQChatAvailable()) {
    const generation = qchatGeneration;
    let disposed = false;
    let off: (() => void) | null = null;
    let observerAttached = false;

    const attach = async () => {
      try {
        await ensureQChatNativeLogin();
      } catch (e) {
        if (disposed) return;
        if (isQChatCancellation(e)) {
          logInfo('[qchat] 登录被房间切换取消，走轮询', 'nim');
        } else if (/超时|冷却中/.test(String((e as any)?.message || e))) {
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
      if (pendingSubscribeServerIds.size > 0) {
        void qchatSubscribeBatch(Array.from(pendingSubscribeServerIds));
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

      if (generation !== qchatGeneration) return;

      observeRefCount = Math.max(0, observeRefCount - 1);
    };
  }
  if (!isPocketImAvailable()) return () => undefined;
  pocketImObserveRefCount += 1;
  try {
    await ensureLogin();

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
