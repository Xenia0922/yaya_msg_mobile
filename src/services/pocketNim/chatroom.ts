import {
  buildLiveBarrageExt,
  type LivePkEvent,
  parseChatroomMessage,
  parseLivePkEvent,
  parseLiveUpdate,
} from './codec';
import {
  isPocketNimChatroomAvailable,
  chatroomConnect,
  chatroomSend,
  chatroomDisconnect,
  onChatroomMessage,
  onChatroomStatus,
  onChatroomOnline,
} from '../../native/PocketNimChatroom';
import {
  credentialsToProfile,
  loadNimSdk,
  NimCredentials,
  NIM_CHATROOM_ADDRESSES,
  NIM_APP_KEY,
} from './runtime';
import { loadSelfProfile } from './credentials';
import { BarrageItem, NimModule } from './types';

export type ChatroomStatus = 'connecting' | 'connected' | 'reconnecting' | 'closed' | 'error';

let lbsAddresses: string[] | null = null;
let lbsInflight: Promise<string[]> | null = null;

async function resolveChatroomAddresses(): Promise<string[]> {
  if (lbsAddresses && lbsAddresses.length) return lbsAddresses;
  if (!lbsInflight) {
    lbsInflight = (async () => {
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
        const merged = (
          chat.length || web.length ? [...chat, ...web, ...rest] : FALLBACK_LBS
        ).slice(0, 5);
        // eslint-disable-next-line no-console
        console.log('[nim] LBS chatroom addresses =', merged.join(' , ') || '(empty)');
        if (merged.length) {
          lbsAddresses = merged;
          return merged;
        }
      } catch {}
      return NIM_CHATROOM_ADDRESSES;
    })();
  }
  return lbsInflight;
}

const NIM_DEBUG = false;

export interface LiveChatroomOptions {
  roomId: string;

  liveId?: string;
  credentials: NimCredentials;

  module?: string;
  onMessages: (items: BarrageItem[]) => void;
  onStatus?: (status: ChatroomStatus, detail?: string) => void;
  onLiveInfo?: (info: { audience?: string; rankAvatars?: string[] }) => void;
  onOnlineCount?: (count: number) => void;
  onPkEvent?: (event: LivePkEvent) => void;
}

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

export async function webImLoginProbe(
  credentials: NimCredentials,
): Promise<{ ok: boolean; detail: string }> {
  const SDK = loadNimSdk();
  return new Promise((resolve) => {
    let settled = false;
    let inst: any = null;
    const finish = (ok: boolean, detail: string) => {
      if (settled) return;
      settled = true;
      try {
        inst && inst.destroy && inst.destroy();
      } catch {}
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
        ondisconnect: (err: any) =>
          finish(false, `disconnect:${String(err?.message || err?.code || '')}`),
      });
      setTimeout(() => finish(false, 'timeout'), 12000);
    } catch (e: any) {
      finish(false, String(e?.message || e));
    }
  });
}

export class LiveChatroom {
  private readonly options: LiveChatroomOptions;
  private instance: any = null;
  private disposed = false;
  private status: ChatroomStatus = 'connecting';

  private attempt = 0;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;

  private anonymous = false;

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

  private addresses: string[] = NIM_CHATROOM_ADDRESSES;

  connect(): void {
    if (this.disposed) return;

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
      }),
    );
    this.nativeUnsubs.push(
      onChatroomOnline((count) => {
        if (!this.disposed) this.options.onOnlineCount?.(count);
      }),
    );
    this.nativeUnsubs.push(
      onChatroomMessage((message) => {
        if (this.disposed) return;

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
        const info = parseLiveUpdate(shaped);
        if (info) this.options.onLiveInfo?.(info);
        const pkEvent = parseLivePkEvent(shaped);
        if (pkEvent) this.options.onPkEvent?.(pkEvent);
        const item = parseChatroomMessage(shaped);
        if (item) this.options.onMessages([item]);
      }),
    );
    try {
      // eslint-disable-next-line no-console
      console.log('[nim] native chatroom connecting');
      await chatroomConnect(NIM_APP_KEY, credentials.accid, credentials.token, roomId);

      if (this.disposed) {
        try {
          chatroomDisconnect();
        } catch {}
        return;
      }
      // eslint-disable-next-line no-console
      console.log('[nim] native chatroom CONNECTED');
    } catch (error: any) {
      if (this.disposed) return;
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

      const anonNick = `yaya-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
      if (attempt === 2) {
        // eslint-disable-next-line no-console
        console.log('[nim] web IM login probe...');
        const probeResult = await webImLoginProbe(credentials);

        if (this.disposed) return;
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
      console.log(
        '[nim] chatroom connect attempt =',
        attempt,
        'anonymous =',
        anonymous,
        'roomId =',
        roomId,
      );
      this.instance = SDK.Chatroom.getInstance({
        appKey: NIM_APP_KEY,
        chatroomId: roomId,
        ...auth,
        chatroomAddresses: this.addresses,
        chatroomNick: profile.nickName || credentials.accid,
        chatroomAvatar: profile.avatar || '',

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
          const sorted = msgs
            .slice()
            .sort((a, b) => (Number(a?.time) || 0) - (Number(b?.time) || 0));
          for (const msg of sorted) {
            const info = parseLiveUpdate(msg);
            if (info) this.options.onLiveInfo?.(info);
            const pkEvent = parseLivePkEvent(msg);
            if (pkEvent) this.options.onPkEvent?.(pkEvent);
            const item = parseChatroomMessage(msg);
            if (item) items.push(item);
          }
          if (items.length) this.options.onMessages(items);
        },
        onerror: (err: any) => {
          const detail =
            err && (err.message || err.code) ? String(err.message || err.code) : '聊天室连接错误';
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

      this.clearTimer();
      this.connectTimer = setTimeout(() => {
        if (this.disposed || this.status === 'connected') return;
        // eslint-disable-next-line no-console
        console.log('[nim] chatroom attempt', attempt, 'timeout, no connect');
        this.fallback('连接超时');
      }, 8000);
    } catch (error: any) {
      // eslint-disable-next-line no-console
      console.log(
        '[nim] chatroom connect THREW attempt =',
        attempt,
        String(error?.message || error),
      );
      this.fallback(String(error?.message || error));
    }
  }

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
    } catch {}
    try {
      if (typeof instance.destroy === 'function') instance.destroy();
    } catch {}
  }

  async send(text: string, messageType?: string): Promise<void> {
    const content = String(text || '').trim();
    if (!content) return;
    if (this.useNative) {
      const self = (await loadSelfProfile()) || credentialsToProfile(this.options.credentials);
      const ext = buildLiveBarrageExt({
        roomId: this.options.roomId,
        sourceId: this.options.liveId || this.options.roomId,
        text: content,
        self,
        module: this.options.module || NimModule.LIVE,
      });
      await chatroomSend(content, JSON.stringify(ext));
      return;
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

      const attempts: Array<Record<string, any>> = [
        { text: content, remoteExtension: ext, done },
        { text: content, custom: JSON.stringify(ext), done },
      ];
      for (const payload of attempts) {
        try {
          this.instance.sendText(payload);
          return;
        } catch {}
      }
      done(new Error('弹幕发送参数不被当前云信 SDK 接受'));
    });
  }

  dispose(): void {
    this.disposed = true;
    this.clearTimer();
    if (this.useNative) {
      this.nativeUnsubs.forEach((off) => {
        try {
          off();
        } catch {}
      });
      this.nativeUnsubs = [];
      try {
        chatroomDisconnect();
      } catch {}
    }
    this.destroyInstance();
    this.setStatus('closed');
  }
}
