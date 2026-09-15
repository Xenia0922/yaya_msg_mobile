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

/** 单个直播间弹幕连接。dispose() 一定要在离开直播间时调用。 */
export class LiveChatroom {
  private readonly options: LiveChatroomOptions;
  private instance: any = null;
  private disposed = false;
  private status: ChatroomStatus = 'connecting';

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

  connect(): void {
    if (this.disposed) return;
    const { credentials, roomId } = this.options;
    this.setStatus('connecting');
    try {
      const SDK = loadNimSdk();
      const profile = credentialsToProfile(credentials);
      this.instance = SDK.Chatroom.getInstance({
        appKey: NIM_APP_KEY,
        chatroomId: roomId,
        chatroomAddresses: NIM_CHATROOM_ADDRESSES,
        account: credentials.accid,
        token: credentials.token,
        chatroomNick: profile.nickName || credentials.accid,
        chatroomAvatar: profile.avatar || '',
        db: false,
        dbLog: false,
        onconnect: () => {
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
          this.setStatus('error', detail);
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
    } catch (error: any) {
      this.setStatus('error', String(error?.message || error));
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
    const instance = this.instance;
    this.instance = null;
    if (!instance) return;
    try {
      if (typeof instance.disconnect === 'function') {
        instance.disconnect({ done: () => undefined });
      }
    } catch {
      /* 断开失败无需处理（页面已离开） */
    }
    try {
      if (typeof instance.destroy === 'function') instance.destroy();
    } catch {
      /* 同上 */
    }
    this.setStatus('closed');
  }
}
