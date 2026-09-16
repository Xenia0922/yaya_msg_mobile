/**
 * 直播间弹幕通道（云信聊天室）。
 *
 * 完整链路（对齐官方 口袋48 7.1.39）：
 *   1. 取凭证      GET/POST im/api/v1/im/userinfo  → accid + pwd(token)
 *   2. 登录云信    NIMStrategy.login(accid, pwd)   → NIMSDK.getAuthService().login(LoginInfo(accid, pwd))
 *   3. 进聊天室    IMChatRoom.enter(roomId, 8)     → enterChatRoomEx(EnterChatRoomData(roomId), 8)
 *                  roomId = live 详情 content.roomId（LivePlayActivity: m58828(getRoomId(), liveId)）
 *   4. 收弹幕      observeReceiveMessage → remoteExtension.messageType 判定
 *   5. 发弹幕      IMChatRoom.sendTextMessage(roomId, map)
 *                  map = ChatMsgBuilder.createBarrageNomalMessageMap(roomId, liveId, text, 'live', topList)
 *                  → createChatRoomTextMessage + setRemoteExtension(map) + setContent(text)
 */

import { buildLiveBarrageExt, parseChatroomMessage } from './codec';
import {
  isPocketNimChatroomAvailable,
  chatroomConnect,
  chatroomSend,
  chatroomDisconnect,
  onChatroomMessage,
  onChatroomStatus,
} from '../../native/PocketNimChatroom';
import { credentialsToProfile, loadNimSdk, NimCredentials, NIM_CHATROOM_ADDRESSES, NIM_APP_KEY } from './runtime';
import { BarrageItem, NimModule } from './types';

export type ChatroomStatus = 'connecting' | 'connected' | 'reconnecting' | 'closed' | 'error';

/**
 * 聊天室接入点解析（关键）。
 *
 * 口袋48 的云信已迁到新集群：LBS(webconf.jsp) 返回的聊天室链路是
 * `chatwl02.yunxinfw.com:443` / `weblink-bgp.netease.im:443` 等；
 * 旧地址 `chatweblink01.netease.im:443` 对该 appKey 会静默超时或直接
 * 「403 非法操作或没有权限」（48tools 就是因为写死旧地址而失效的）。
 * 因此这里启动时向 LBS 动态解析，把返回的 link 列表交给 SDK（chatwl 优先）。
 */
let lbsAddresses: string[] | null = null;
let lbsInflight: Promise<string[]> | null = null;

async function resolveChatroomAddresses(): Promise<string[]> {
  if (lbsAddresses && lbsAddresses.length) return lbsAddresses;
  if (!lbsInflight) {
    lbsInflight = (async () => {
      // 云信新集群聊天室接入点（LBS 实测返回，作解析失败/空结果的兜底）
      const FALLBACK_LBS = [
        'chatwl02.yunxinfw.com:443',
        'weblink-bgp.netease.im:443',
        'weblink03.yunxinfw.com:443',
        'weblink02.yunxinfw.com:443',
      ];
      try {
        const res = await fetch(`https://lbs.netease.im/lbs/webconf.jsp?appkey=${NIM_APP_KEY}`);
        const text = await res.text();
        let json: any = {};
        try {
          json = JSON.parse(text);
        } catch {
          // eslint-disable-next-line no-console
          console.log('[nim] LBS raw =', text.slice(0, 300));
        }
        // eslint-disable-next-line no-console
        console.log('[nim] LBS keys =', Object.keys(json || {}).join(','));
        const list: string[] = Array.isArray(json?.link)
          ? json.link.filter((x: any) => typeof x === 'string' && x.includes(':'))
          : [];
        const chat = list.filter((x) => x.startsWith('chatwl'));
        const web = list.filter((x) => x.startsWith('weblink'));
        const rest = list.filter((x) => !x.startsWith('chatwl') && !x.startsWith('weblink'));
        const merged = (chat.length || web.length ? [...chat, ...web, ...rest] : FALLBACK_LBS).slice(0, 5);
        // eslint-disable-next-line no-console
        console.log('[nim] LBS chatroom addresses =', merged.join(' , ') || '(empty)');
        if (merged.length) {
          lbsAddresses = merged;
          return merged;
        }
      } catch {
        /* LBS 失败落到旧默认地址 */
      }
      return NIM_CHATROOM_ADDRESSES;
    })();
  }
  return lbsInflight;
}

/** 云信 SDK 内部日志开关（排障时临时改 true；日志经 console → logcat ReactNativeJS） */
const NIM_DEBUG = true;

export interface LiveChatroomOptions {
  /** 聊天室 id（live 详情 content.roomId） */
  roomId: string;
  /** 直播 id（官方 sourceId，用于弹幕 remoteExtension） */
  liveId?: string;
  credentials: NimCredentials;
  /** 'live' 成员直播 / 'public' 公开直播 */
  module?: string;
  onMessages: (items: BarrageItem[]) => void;
  onStatus?: (status: ChatroomStatus, detail?: string) => void;
}

/**
 * 服务端拒绝聊天室登录时的可读文案。
 * 实测：口袋48 的 appKey 对客户端有服务端校验 —— 用账号+token 或匿名登录聊天室都会被拒
 * （IM 登录 414 参数错误 / 聊天室 403 非法操作或没有权限），官方 App 的包名在白名单内。
 */
function friendlyAuthError(reason: string): string {
  if (/403|非法操作|没有权限/.test(reason)) {
    return '弹幕通道被服务端拒绝（非法操作或没有权限）：该 App 对客户端标识有白名单校验';
  }
  if (/414|参数错误/.test(reason)) {
    return '弹幕通道被服务端拒绝（参数错误）：App 标识未通过校验或凭证不匹配';
  }
  if (/超时|timeout/i.test(reason)) {
    return '弹幕连接超时：无法连接聊天室接入点';
  }
  return reason || '弹幕连接失败';
}


/**
 * Web/RN 侧 IM 登录探针。
 *
 * 官方 App 进聊天室是「非独立模式」：先完成 IM 登录，聊天室鉴权依赖 IM 会话；
 * 我们此前聊天室裸登（account+token 直连聊天室服务）被 403，可能就是缺这个前置。
 */
export async function webImLoginProbe(credentials: NimCredentials): Promise<{ ok: boolean; detail: string }> {
  const SDK = loadNimSdk();
  return new Promise((resolve) => {
    let settled = false;
    let inst: any = null;
    const finish = (ok: boolean, detail: string) => {
      if (settled) return;
      settled = true;
      try { inst && inst.destroy && inst.destroy(); } catch { /* 忽略 */ }
      resolve({ ok, detail });
    };
    try {
      inst = SDK.NIM.getInstance({
        appKey: NIM_APP_KEY,
        account: credentials.accid,
        token: credentials.token,
        debug: NIM_DEBUG,
        db: false,
        dbLog: false,
        onconnect: () => finish(true, 'connected'),
        onerror: (err: any) => finish(false, String(err?.message || err?.code || err || 'error')),
        ondisconnect: (err: any) => finish(false, `disconnect:${String(err?.message || err?.code || '')}`),
      });
      setTimeout(() => finish(false, 'timeout'), 12000);
    } catch (e: any) {
      finish(false, String(e?.message || e));
    }
  });
}

/** 单个直播间弹幕连接。dispose() 一定要在离开直播间时调用。 */
export class LiveChatroom {
  private readonly options: LiveChatroomOptions;
  private instance: any = null;
  private disposed = false;
  private status: ChatroomStatus = 'connecting';
  /** 连接尝试序号：0 = 账号+token，1 = 匿名（只读），2 = 先 IM 登录再进聊天室 */
  private attempt = 0;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  /** 是否以匿名（只读）方式连上：匿名通道不能发送弹幕 */
  private anonymous = false;
  /** 走原生 commonlink 通道（可过服务端标识校验）；否则退到 JS Web SDK */
  private useNative = false;
  private nativeUnsubs: Array<() => void> = [];

  constructor(options: LiveChatroomOptions) {
    this.options = options;
  }

  get currentStatus(): ChatroomStatus {
    return this.status;
  }

  private setStatus(status: ChatroomStatus, detail?: string) {
    this.status = status;
    this.options.onStatus?.(status, detail);
  }

  private clearTimer() {
    if (this.connectTimer) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
  }

  /**
   * 依次尝试三种连法，任一连上就停：
   *   0) account + token（可收可发）
   *   1) 匿名（只读；口袋48 聊天室允许匿名进入，48tools 同款）
   * 之前的问题：只用 0，而这一路在这台机器/这个 appKey 下**静默不连接**
   * （既无 onconnect 也无 onerror），表现为「弹幕一条不来」。
   */
  /** 当前使用的接入点（LBS 解析结果；解析完成前为旧默认） */
  private addresses: string[] = NIM_CHATROOM_ADDRESSES;

  connect(): void {
    if (this.disposed) return;
    // 首选原生 commonlink 通道：登录包里包名由自己填，能过口袋48 的客户端标识校验；
    // JS Web SDK 会带浏览器/RN 标识 → 实测 403。原生不可用时才走 JS 那三条 fallback。
    if (isPocketNimChatroomAvailable()) {
      this.connectNative();
      return;
    }
    this.attempt = 0;
    resolveChatroomAddresses()
      .then((addrs) => {
        this.addresses = addrs;
        if (!this.disposed) this.open(0);
      })
      .catch(() => {
        this.addresses = NIM_CHATROOM_ADDRESSES;
        if (!this.disposed) this.open(0);
      });
  }

  /** 原生 commonlink 通道：连接 + 收消息（消息体复用 parseChatroomMessage 归一化） */
  private async connectNative(): Promise<void> {
    const { credentials, roomId } = this.options;
    this.useNative = true;
    this.setStatus('connecting');
    this.nativeUnsubs.push(
      onChatroomStatus((status) => {
        if (this.disposed) return;
        if (status.state === 'connected') this.setStatus('connected');
        else if (status.state === 'connecting') this.setStatus('connecting');
        else if (status.state === 'reconnecting') this.setStatus('reconnecting');
        else if (status.state === 'disconnected') this.setStatus('closed');
        else if (status.state === 'error') this.setStatus('error', status.detail);
      })
    );
    this.nativeUnsubs.push(
      onChatroomMessage((message) => {
        if (this.disposed) return;
        // 组装成 Web SDK 的消息形态，复用同一套解析（readExt / parseChatroomMessage）
        const shaped = {
          type: message.msgType === 0 ? 'text' : 'custom',
          text: message.text,
          fromNick: message.fromNick,
          fromAvatar: message.fromAvatar,
          from: message.fromAccount,
          time: message.time,
          idClient: message.uuid,
          custom: message.ext,
        };
        const item = parseChatroomMessage(shaped);
        if (item) this.options.onMessages([item]);
      })
    );
    try {
      // eslint-disable-next-line no-console
      console.log('[nim] native chatroom connect roomId =', roomId, 'account =', credentials.accid);
      await chatroomConnect(NIM_APP_KEY, credentials.accid, credentials.token, roomId);
      // eslint-disable-next-line no-console
      console.log('[nim] native chatroom CONNECTED');
    } catch (error: any) {
      const detail = String(error?.message || error);
      // eslint-disable-next-line no-console
      console.log('[nim] native chatroom FAILED:', detail);
      this.setStatus('error', friendlyAuthError(detail));
    }
  }

  private async open(attempt: number): Promise<void> {
    if (this.disposed) return;
    const { credentials, roomId } = this.options;
    this.attempt = attempt;
    this.destroyInstance();
    this.setStatus('connecting');
    try {
      const SDK = loadNimSdk();
      const profile = credentialsToProfile(credentials);
      const anonymous = attempt === 1;
      // 匿名模式下昵称必须用随机串（48tools 同款 randomUUID）：
      // 若把真实 accid 当昵称带上，聊天室登录会被服务端判「非法操作」直接 403。
      const anonNick = `yaya-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
      if (attempt === 2) {
        // 先完成一次 IM 登录（官方「非独立模式」同款前置：聊天室鉴权依赖 IM 会话）
        // eslint-disable-next-line no-console
        console.log('[nim] web IM login probe...');
        const probeResult = await webImLoginProbe(credentials);
        // eslint-disable-next-line no-console
        console.log('[nim] web IM login probe result =', probeResult.ok, probeResult.detail);
        if (!probeResult.ok) {
          this.fallback(`IM登录失败:${probeResult.detail}`);
          return;
        }
      }
      const auth = anonymous
        ? { isAnonymous: true, chatroomNick: anonNick, chatroomAvatar: '' }
        : { account: credentials.accid, token: credentials.token };
      // eslint-disable-next-line no-console
      console.log('[nim] chatroom connect attempt =', attempt, 'anonymous =', anonymous, 'roomId =', roomId);
      this.instance = SDK.Chatroom.getInstance({
        appKey: NIM_APP_KEY,
        chatroomId: roomId,
        ...auth,
        chatroomAddresses: this.addresses,
        chatroomNick: profile.nickName || credentials.accid,
        chatroomAvatar: profile.avatar || '',
        // SDK 内部日志开关：排障时改 true（日志经 console → logcat ReactNativeJS）
        debug: NIM_DEBUG,
        db: false,
        dbLog: false,
        onconnect: () => {
          // eslint-disable-next-line no-console
          console.log('[nim] chatroom CONNECTED attempt =', attempt, 'anonymous =', anonymous);
          this.clearTimer();
          this.anonymous = anonymous;
          this.setStatus('connected');
        },
        onmsgs: (msgs: any[]) => {
          if (this.disposed || !Array.isArray(msgs)) return;
          const items: BarrageItem[] = [];
          for (const msg of msgs) {
            const item = parseChatroomMessage(msg);
            if (item) items.push(item);
          }
          if (items.length) this.options.onMessages(items);
        },
        onerror: (err: any) => {
          const detail = err && (err.message || err.code) ? String(err.message || err.code) : '聊天室连接错误';
          // eslint-disable-next-line no-console
          console.log('[nim] chatroom ERROR attempt =', attempt, detail);
          this.fallback(detail);
        },
        ondisconnect: (err: any) => {
          if (this.disposed) return;
          const detail = err && err.message ? String(err.message) : '';
          this.setStatus(detail ? 'error' : 'closed', detail);
        },
        onwillreconnect: () => {
          if (this.disposed) return;
          this.setStatus('reconnecting');
        },
      });

      // 静默不连接守卫：8 秒内没连上就换下一种连法（SDK 在这一路失败时不回调 onerror）
      this.clearTimer();
      this.connectTimer = setTimeout(() => {
        if (this.disposed || this.status === 'connected') return;
        // eslint-disable-next-line no-console
        console.log('[nim] chatroom attempt', attempt, 'timeout, no connect');
        this.fallback('连接超时');
      }, 8000);
    } catch (error: any) {
      // eslint-disable-next-line no-console
      console.log('[nim] chatroom connect THREW attempt =', attempt, String(error?.message || error));
      this.fallback(String(error?.message || error));
    }
  }

  /** 当前连法失败 → 试下一种；都失败才置 error */
  private async fallback(reason: string): Promise<void> {
    if (this.disposed) return;
    this.clearTimer();
    if (this.attempt < 2) {
      const next = this.attempt + 1;
      // eslint-disable-next-line no-console
      console.log('[nim] chatroom fallback -> attempt', next, 'reason =', reason);
      await this.open(next);
      return;
    }
    this.setStatus('error', friendlyAuthError(reason));
  }

  private destroyInstance() {
    const instance = this.instance;
    this.instance = null;
    if (!instance) return;
    try {
      if (typeof instance.disconnect === 'function') instance.disconnect({ done: () => undefined });
    } catch {
      /* 忽略 */
    }
    try {
      if (typeof instance.destroy === 'function') instance.destroy();
    } catch {
      /* 忽略 */
    }
  }

  /**
   * 发送弹幕。
   * 官方对普通用户用 BARRAGE_NORMAL，成员本人 BARRAGE_MEMBER，超管 BARRAGE_SUPERMAN；
   * 牙牙账号通常是普通粉丝，因此默认 BARRAGE_NORMAL。
   */
  send(text: string, messageType?: string): Promise<void> {
    const content = String(text || '').trim();
    if (!content) return Promise.resolve();
    if (this.useNative) {
      const ext = buildLiveBarrageExt({
        roomId: this.options.roomId,
        sourceId: this.options.liveId || this.options.roomId,
        text: content,
        self: credentialsToProfile(this.options.credentials),
        module: this.options.module || NimModule.LIVE,
      });
      return chatroomSend(content, JSON.stringify(ext)).then(() => undefined);
    }
    if (!this.instance) return Promise.reject(new Error('弹幕通道尚未连接'));
    if (this.anonymous) return Promise.reject(new Error('当前为匿名只读通道，无法发送弹幕'));

    const ext = buildLiveBarrageExt({
      roomId: this.options.roomId,
      sourceId: this.options.liveId || this.options.roomId,
      text: content,
      self: credentialsToProfile(this.options.credentials),
      module: this.options.module || NimModule.LIVE,
      ...(messageType ? { messageType } : {}),
    });

    return new Promise((resolve, reject) => {
      let settled = false;
      const done = (err: any) => {
        if (settled) return;
        settled = true;
        if (err) reject(new Error(String(err.message || err.code || err)));
        else resolve();
      };
      // 不同版本 SDK 对自定义扩展的字段名不一致（remoteExtension / custom），依次兜底。
      const attempts: Array<Record<string, any>> = [
        { text: content, remoteExtension: ext, done },
        { text: content, custom: JSON.stringify(ext), done },
      ];
      for (const payload of attempts) {
        try {
          this.instance.sendText(payload);
          return;
        } catch {
          /* 换下一种字段名 */
        }
      }
      done(new Error('弹幕发送参数不被当前云信 SDK 接受'));
    });
  }

  dispose(): void {
    this.disposed = true;
    this.clearTimer();
    if (this.useNative) {
      this.nativeUnsubs.forEach((off) => {
        try { off(); } catch { /* 忽略 */ }
      });
      this.nativeUnsubs = [];
      try { chatroomDisconnect(); } catch { /* 忽略 */ }
    }
    this.destroyInstance();
    this.setStatus('closed');
  }
}
