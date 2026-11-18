/**
 * 直播间实时弹幕 Hook（云信聊天室）。
 *
 * 链路：liveId → getLiveOne(content.roomId) + im/userinfo(accid/pwd) → 云信聊天室连接 → 弹幕流。
 * 与录播弹幕（msgFilePath 指向的 LRC 文件，走 parseDanmaku）互不影响：
 * - 录播：DanmakuOverlay + utils/danmaku
 * - 直播：本 Hook + LiveBarrageBoard
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import pocketApi from '../api/pocket48';
import { LiveChatroom, type ChatroomStatus } from '../services/pocketNim/chatroom';
import { loadNimCredentials, loadSelfProfile } from '../services/pocketNim/credentials';
import { getNimSessionEpoch, subscribeNimSession } from '../services/pocketNim/session';
import { BarrageItem } from '../services/pocketNim/types';
import { isLiveEndMessage, isLiveStreamTransition } from '../services/pocketNim/codec';

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
  streamRevision: number;
  /** 收到官方 CLOSELIVE 系统消息：直播已结束 */
  liveEnded: boolean;
  /** 官方 MULTI_MIC_PK / MICROPHONE_CONNECTION 消息携带的连麦成员 */
  multiMicUsers: any[];
  /** null / start / finish */
  pkState: 'start' | 'finish' | null;
  /** 最近一条 PK/连麦/结束事件类型（用于提示，不进入公屏） */
  lastLiveEvent: string;
  liveInfo: { audience?: string; rankAvatars?: string[]; hostName?: string; hostAvatar?: string };
}

export function useLiveBarrage(options: UseLiveBarrageOptions): UseLiveBarrageResult {
  const { liveId, enabled = true, module = 'live' } = options;
  const [items, setItems] = useState<BarrageItem[]>([]);
  const [status, setStatus] = useState<ChatroomStatus | 'idle' | 'resolving'>('idle');
  const [error, setError] = useState('');
  const [retryToken, setRetryToken] = useState(0);
  const [streamRevision, setStreamRevision] = useState(0);
  const [liveEnded, setLiveEnded] = useState(false);
  const [multiMicUsers, setMultiMicUsers] = useState<any[]>([]);
  const [pkState, setPkState] = useState<'start' | 'finish' | null>(null);
  const [lastLiveEvent, setLastLiveEvent] = useState('');
  const [liveInfo, setLiveInfo] = useState<{
    audience?: string;
    rankAvatars?: string[];
    hostName?: string;
    hostAvatar?: string;
  }>({});
  const transitionIdsRef = useRef(new Set<string>());
  /**
   * 云信会话世代：切号 / 换号后 +1。
   * 连接是用「当时的账号凭证」建立的，换代后必须整条重连
   * （否则新号身份发弹幕会被告知无权限，或仍以旧号身份发出）。
   */
  const [sessionEpoch, setSessionEpoch] = useState(getNimSessionEpoch);
  useEffect(() => subscribeNimSession(setSessionEpoch), []);

  const chatroomRef = useRef<LiveChatroom | null>(null);
  const seqRef = useRef(0);
  const roomKeyRef = useRef('');
  // 乐观上屏记录：聊天室不一定回投自己的弹幕，发送成功后本地先插一条；
  // 服务端回投到达时按 昵称+文本 去重（60s 窗口，只吞第一条）
  const lastLocalRef = useRef<{ nick: string; text: string; ts: number; consumed: boolean } | null>(
    null,
  );

  const retry = useCallback(() => setRetryToken((n) => n + 1), []);
  const clear = useCallback(() => setItems([]), []);

  useEffect(() => {
    const id = String(liveId || '');
    const roomKey = enabled && id ? `${module}:${id}` : '';
    if (roomKeyRef.current !== roomKey) {
      roomKeyRef.current = roomKey;
      lastLocalRef.current = null;
      transitionIdsRef.current.clear();
      setItems([]);
      setLiveInfo({});
      setLiveEnded(false);
      setMultiMicUsers([]);
      setPkState(null);
      setLastLiveEvent('');
      setError('');
    }
    if (!enabled || !id) {
      seqRef.current += 1;
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
      if (chatroom)
        setLiveInfo((previous) => ({
          ...previous,
          rankAvatars: chatroom.rankAvatars,
          hostName: chatroom.hostName,
          hostAvatar: chatroom.hostAvatar,
        }));
      // 诊断：确认聊天室坐标是否解析成功（成员直播弹幕不显示时先看这条）
      // eslint-disable-next-line no-console
      console.log(
        '[nim] live barrage resolved:',
        !!chatroom?.roomId,
        'credentials:',
        !!credentials,
      );
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
        onOnlineCount: (count) => {
          if (cancelled || seqRef.current !== seq) return;
          setLiveInfo((previous) => ({ ...previous, audience: String(count) }));
        },
        onLiveInfo: (info) => {
          if (cancelled || seqRef.current !== seq) return;
          setLiveInfo((previous) => ({
            ...previous,
            rankAvatars: info.rankAvatars ?? previous.rankAvatars,
          }));
        },
        onMessages: (incoming) => {
          if (cancelled || seqRef.current !== seq) return;
          const chatItems = incoming.filter((item) => {
            if (isLiveEndMessage(item.messageType)) {
              setLiveEnded(true);
              return false;
            }
            if (!isLiveStreamTransition(item.messageType)) return true;
            setLastLiveEvent(item.messageType);
            const event = item.liveEvent;
            if (event?.multiMicUserInfoList?.length) {
              setMultiMicUsers(event.multiMicUserInfoList);
            }
            const mtUpper = String(item.messageType || '').toUpperCase();
            if (
              mtUpper === 'MULTI_MIC_PK_SUCCESS' ||
              mtUpper === 'MULTI_MIC_PK_START' ||
              mtUpper === 'MULTI_MIC_PK_AGREE' ||
              mtUpper.includes('PK_START') ||
              mtUpper.includes('PK_SUCCESS')
            ) {
              setPkState('start');
            } else if (mtUpper === 'MULTI_MIC_PK_FINISH' || mtUpper.includes('PK_FINISH')) {
              setPkState('finish');
              setMultiMicUsers([]);
            } else if (
              mtUpper === 'MULTI_MIC_PK_REFUSE' ||
              mtUpper === 'MULTI_MIC_PK_TIMEOUT' ||
              mtUpper.includes('FINISH') ||
              mtUpper.includes('REFUSE') ||
              mtUpper.includes('TIMEOUT')
            ) {
              setPkState(null);
              setMultiMicUsers([]);
            }
            if (!transitionIdsRef.current.has(item.id)) {
              transitionIdsRef.current.add(item.id);
              if (transitionIdsRef.current.size > 100) transitionIdsRef.current.clear();
              setStreamRevision((n) => n + 1);
            }
            return false;
          });
          // 吞掉乐观上屏那条的服务端回投（昵称+文本匹配，只吞第一条）
          const lastLocal = lastLocalRef.current;
          const deduped =
            lastLocal && !lastLocal.consumed && Date.now() - lastLocal.ts < 60000
              ? chatItems.filter((it) => {
                  // nick 为空表示 profile 还没加载完：先按文本匹配，避免回投先到导致重复上屏
                  if (
                    it.text === lastLocal.text &&
                    (!lastLocal.nick || it.nick === lastLocal.nick)
                  ) {
                    lastLocal.consumed = true;
                    return false;
                  }
                  return true;
                })
              : chatItems;
          setItems((prev) => {
            // 云信聊天室可能重复推送（重连补发），按 id 去重
            const seen = new Set(prev.map((item) => item.id));
            const fresh = deduped.filter((item) => !seen.has(item.id));
            if (!fresh.length) return prev;
            // onmsgs 一批可能含多条：先按时间倒序，保证 items[0] 永远是最新一条。
            // 否则一批里较旧的消息会占在队首，列表/浮层就会「最新一条跟不上」。
            const incoming = fresh
              .slice()
              .sort((a, b) => (Number(b.time) || 0) - (Number(a.time) || 0));
            const next = incoming.concat(prev);
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
  }, [liveId, enabled, module, retryToken, sessionEpoch]);

  const send = useCallback(async (text: string) => {
    const instance = chatroomRef.current;
    if (!instance) throw new Error('弹幕通道尚未就绪');
    const seq = seqRef.current;
    const content = String(text || '').trim();
    // 发送前就登记本地去重标识：服务端回投可能比 send 返回更早到达，
    // 等发送成功后再登记会把自己那条当成别人的消息重复上屏。
    // nick 先留空（按文本兜底匹配），profile 加载成功后再补；profile 失败不影响去重。
    const pending = { nick: '', text: content, ts: Date.now(), consumed: false };
    lastLocalRef.current = pending;
    const profilePromise = loadSelfProfile().catch(() => null);
    try {
      await instance.send(content);
    } catch (err) {
      if (lastLocalRef.current === pending) lastLocalRef.current = null;
      throw err;
    }
    // 乐观上屏：立刻显示自己的弹幕（不等服务端回投）
    const self = await profilePromise;
    if (seqRef.current !== seq || chatroomRef.current !== instance) return;
    if (!pending.consumed) pending.nick = self?.nickName || '';
    setItems((prev) =>
      [
        {
          id: `local-${Date.now()}`,
          kind: 'text' as const,
          messageType: 'BARRAGE_NORMAL',
          text: content,
          nick: self?.nickName || '',
          avatar: self?.avatar || '',
          userId: self?.userId ? String(self.userId) : '',
          roleId: 0,
          level: self?.level ?? 0,
          time: Date.now(),
        },
        ...prev,
      ].slice(0, MAX_ITEMS),
    );
  }, []);

  const currentRoomKey = enabled && liveId ? `${module}:${String(liveId)}` : '';
  const sameRoom = roomKeyRef.current === currentRoomKey;
  return {
    items: sameRoom ? items : [],
    status: sameRoom ? status : currentRoomKey ? 'resolving' : 'idle',
    error: sameRoom ? error : '',
    ready: sameRoom && status === 'connected',
    send,
    clear,
    retry,
    streamRevision,
    liveEnded: sameRoom && liveEnded,
    multiMicUsers: sameRoom ? multiMicUsers : [],
    pkState: sameRoom ? pkState : null,
    lastLiveEvent: sameRoom ? lastLiveEvent : '',
    liveInfo: sameRoom ? liveInfo : {},
  };
}

export default useLiveBarrage;
