/**
 * 直播间实时弹幕 Hook（云信聊天室）。
 *
 * 链路：liveId → getLiveOne(content.roomId) + im/userinfo(accid/pwd) → 云信聊天室连接 → 弹幕流。
 * 与录播弹幕（msgFilePath 指向的 LRC 文件，走 parseDanmaku）互不影响：
 *   - 录播：DanmakuOverlay + utils/danmaku
 *   - 直播：本 Hook + LiveBarrageBoard
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import pocketApi from '../api/pocket48';
import { LiveChatroom, type ChatroomStatus } from '../services/pocketNim/chatroom';
import { loadNimCredentials, loadSelfProfile } from '../services/pocketNim/credentials';
import { BarrageItem } from '../services/pocketNim/types';

/** 弹幕列表上限（超出丢弃最旧的，避免长时间挂直播间内存膨胀） */
const MAX_ITEMS = 300;

export interface UseLiveBarrageOptions {
  /** 直播 id；为空则不连接 */
  liveId?: string;
  /** 是否启用（例如只在直播中进行中开启） */
  enabled?: boolean;
  /** 'live' 成员直播（默认）/ 'public' 公开直播 */
  module?: 'live' | 'public';
}

export interface UseLiveBarrageResult {
  items: BarrageItem[];
  status: ChatroomStatus | 'idle' | 'resolving';
  error: string;
  /** 是否已连上聊天室（可发送） */
  ready: boolean;
  send: (text: string) => Promise<void>;
  clear: () => void;
  retry: () => void;
}

export function useLiveBarrage(options: UseLiveBarrageOptions): UseLiveBarrageResult {
  const { liveId, enabled = true, module = 'live' } = options;
  const [items, setItems] = useState<BarrageItem[]>([]);
  const [status, setStatus] = useState<ChatroomStatus | 'idle' | 'resolving'>('idle');
  const [error, setError] = useState('');
  const [retryToken, setRetryToken] = useState(0);

  const chatroomRef = useRef<LiveChatroom | null>(null);
  const seqRef = useRef(0);
  // 乐观上屏记录：聊天室不一定回投自己的弹幕，发送成功后本地先插一条；
  // 服务端回投到达时按 昵称+文本 去重（60s 窗口，只吞第一条）
  const lastLocalRef = useRef<{ nick: string; text: string; ts: number; consumed: boolean } | null>(null);

  const retry = useCallback(() => setRetryToken((n) => n + 1), []);
  const clear = useCallback(() => setItems([]), []);

  useEffect(() => {
    const id = String(liveId || '');
    if (!enabled || !id) {
      setStatus('idle');
      return undefined;
    }
    const seq = seqRef.current + 1;
    seqRef.current = seq;
    let cancelled = false;

    setError('');
    setStatus('resolving');

    (async () => {
      const [credentials, chatroom] = await Promise.all([
        loadNimCredentials(),
        pocketApi.getLiveChatroom(id).catch(() => null),
      ]);
      if (cancelled || seqRef.current !== seq) return;
      // 诊断：确认聊天室坐标是否解析成功（成员直播弹幕不显示时先看这条）
      // eslint-disable-next-line no-console
      console.log('[nim] live barrage resolve liveId=', id, 'roomId=', chatroom?.roomId || '(none)', 'creds=', credentials ? credentials.accid : '(none)');
      if (!credentials) {
        setStatus('error');
        setError('未取到云信登录凭证，请先登录口袋48账号');
        return;
      }
      if (!chatroom?.roomId) {
        setStatus('error');
        setError('该直播未返回聊天室房间号（可能已结束或为回放）');
        return;
      }

      const instance = new LiveChatroom({
        roomId: chatroom.roomId,
        liveId: chatroom.sourceId || id,
        credentials,
        module,
        onMessages: (incoming) => {
          if (cancelled || seqRef.current !== seq) return;
          // 吞掉乐观上屏那条的服务端回投（昵称+文本匹配，只吞第一条）
          const lastLocal = lastLocalRef.current;
          const deduped = lastLocal && !lastLocal.consumed
            ? incoming.filter((it) => {
                if (it.text === lastLocal.text && it.nick === lastLocal.nick) {
                  lastLocal.consumed = true;
                  return false;
                }
                return true;
              })
            : incoming;
          setItems((prev) => {
            // 云信聊天室可能重复推送（重连补发），按 id 去重
            const seen = new Set(prev.map((item) => item.id));
            const fresh = deduped.filter((item) => !seen.has(item.id));
            if (!fresh.length) return prev;
            const next = fresh.concat(prev);
            return next.length > MAX_ITEMS ? next.slice(0, MAX_ITEMS) : next;
          });
        },
        onStatus: (next, detail) => {
          if (cancelled || seqRef.current !== seq) return;
          setStatus(next);
          if (next === 'error' && detail) setError(detail);
        },
      });
      chatroomRef.current = instance;
      instance.connect();
    })();

    return () => {
      cancelled = true;
      const instance = chatroomRef.current;
      chatroomRef.current = null;
      instance?.dispose();
    };
  }, [liveId, enabled, module, retryToken]);

  const send = useCallback(async (text: string) => {
    const instance = chatroomRef.current;
    if (!instance) throw new Error('弹幕通道尚未就绪');
    const content = String(text || '').trim();
    await instance.send(content);
    // 乐观上屏：立刻显示自己的弹幕（不等服务端回投）
    const self = await loadSelfProfile().catch(() => null);
    lastLocalRef.current = { nick: self?.nickName || '', text: content, ts: Date.now(), consumed: false };
    setItems((prev) => [
      {
        id: `local-${Date.now()}`,
        kind: 'text' as const,
        messageType: 'BARRAGE_NORMAL',
        text: content,
        nick: self?.nickName || '',
        avatar: self?.avatar || '',
        userId: self?.userId || 0,
        roleId: 0,
        level: self?.level ?? 0,
        time: Date.now(),
      },
      ...prev,
    ].slice(0, MAX_ITEMS));
  }, []);

  return {
    items,
    status,
    error,
    ready: status === 'connected',
    send,
    clear,
    retry,
  };
}

export default useLiveBarrage;
