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
import { credentialsToProfile, loadNimSdk, NimCredentials, NIM_CHATROOM_ADDRESSES, NIM_APP_KEY } from './runtime';
import { BarrageItem, NimModule } from './types';

export type ChatroomStatus = 'connecting' | 'connected' | 'reconnecting' | 'closed' | 'error';

/** 云信 SDK 内部日志开关（排障时临时改 true；日志经 console → logcat ReactNativeJS） */
const NIM_DEBUG = false;

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

/** 单个直播间弹幕连接。dispose() 一定要在离开直播间时调用。 */export class LiveChatroom {
  private readonly options: LiveChatroomOptions;
  private instance: any = null;
  private disposed = false;
  private status: ChatroomStatus = 'connecting';
  /** 连接尝试序号：0 = 账号+token，1 = 匿名（只读） */
  private attempt = 0;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;

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
  connect(): void {
    if (this.disposed) return;
    this.attempt = 0;
    this.open(this.attempt);
  }

  private open(attempt: number): void {
    if (this.disposed) return;
    const { credentials, roomId } = this.options;
    this.attempt = attempt;
    this.destroyInstance();
    this.setStatus('connecting');
    try {
      const SDK = loadNimSdk();
      const profile = credentialsToProfile(credentials);
      const anonymous = attempt === 1;
      const auth = anonymous
        ? { isAnonymous: true, chatroomNick: `yaya${Date.now()}`, chatroomAvatar: '' }
        : { account: credentials.accid, token: credentials.token };
      // eslint-disable-next-line no-console
      console.log('[nim] chatroom connect attempt =', attempt, 'anonymous =', anonymous, 'roomId =', roomId);
      this.instance = SDK.Chatroom.getInstance({
        appKey: NIM_APP_KEY,
        chatroomId: roomId,
        ...auth,
        chatroomAddresses: NIM_CHATROOM_ADDRESSES,
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
  private fallback(reason: string) {
    if (this.disposed) return;
    this.clearTimer();
    if (this.attempt < 1) {
      const next = this.attempt + 1;
      // eslint-disable-next-line no-console
      console.log('[nim] chatroom fallback -> attempt', next, 'reason =', reason);
      this.open(next);
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
    if (!this.instance) return Promise.reject(new Error('弹幕通道尚未连接'));

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
    this.destroyInstance();
    this.setStatus('closed');
  }
}
