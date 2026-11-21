import { useCallback, useEffect, useRef, useState } from 'react';
import pocketApi from '../api/pocket48';
import { LiveChatroom, type ChatroomStatus } from '../services/pocketNim/chatroom';
import { loadNimCredentials, loadSelfProfile } from '../services/pocketNim/credentials';
import { getNimSessionEpoch, subscribeNimSession } from '../services/pocketNim/session';
import { BarrageItem } from '../services/pocketNim/types';
import {
  isLiveEndMessage,
  isLiveStreamTransition,
  type LivePkState,
  reduceLivePkState,
} from '../services/pocketNim/codec';

const MAX_ITEMS = 300;

export interface UseLiveBarrageOptions {
  liveId?: string;

  enabled?: boolean;

  module?: 'live' | 'public';
}

export interface UseLiveBarrageResult {
  items: BarrageItem[];
  status: ChatroomStatus | 'idle' | 'resolving';
  error: string;

  ready: boolean;
  send: (text: string) => Promise<void>;
  clear: () => void;
  retry: () => void;
  streamRevision: number;

  liveEnded: boolean;

  multiMicUsers: any[];

  pkState: 'start' | 'finish' | null;

  lastLiveEvent: string;
  liveInfo: {
    audience?: string;
    rankAvatars?: string[];
    hostId?: string;
    hostName?: string;
    hostAvatar?: string;
  };
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
    hostId?: string;
    hostName?: string;
    hostAvatar?: string;
  }>({});
  const transitionIdsRef = useRef(new Set<string>());
  const pkStateRef = useRef<LivePkState>({ active: false, users: [] });

  const [sessionEpoch, setSessionEpoch] = useState(getNimSessionEpoch);
  useEffect(() => subscribeNimSession(setSessionEpoch), []);

  const chatroomRef = useRef<LiveChatroom | null>(null);
  const seqRef = useRef(0);
  const roomKeyRef = useRef('');

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
      pkStateRef.current = { active: false, users: [] };
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
      if (chatroom) {
        setLiveInfo((previous) => ({
          ...previous,
          rankAvatars: chatroom.rankAvatars,
          hostId: chatroom.hostId || previous.hostId,
          hostName: chatroom.hostName,
          hostAvatar: chatroom.hostAvatar,
        }));
        if (
          chatroom.pkInfo?.active &&
          chatroom.pkInfo.users.length &&
          !pkStateRef.current.active &&
          !pkStateRef.current.endedPkId
        ) {
          pkStateRef.current = {
            active: true,
            users: chatroom.pkInfo.users,
            pkId: chatroom.pkInfo.pkId,
          };
          setMultiMicUsers(chatroom.pkInfo.users);
          setPkState('start');
        }
      }

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
        onPkEvent: (pkEvent) => {
          if (cancelled || seqRef.current !== seq) return;
          const nextPk = reduceLivePkState(pkStateRef.current, pkEvent);
          pkStateRef.current = nextPk;
          setMultiMicUsers(nextPk.users);
          setPkState(nextPk.active ? 'start' : null);
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
            if (!transitionIdsRef.current.has(item.id)) {
              transitionIdsRef.current.add(item.id);
              if (transitionIdsRef.current.size > 100) transitionIdsRef.current.clear();
              setStreamRevision((n) => n + 1);
            }
            return false;
          });

          const lastLocal = lastLocalRef.current;
          const deduped =
            lastLocal && !lastLocal.consumed && Date.now() - lastLocal.ts < 60000
              ? chatItems.filter((it) => {
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
            const seen = new Set(prev.map((item) => item.id));
            const fresh = deduped.filter((item) => !seen.has(item.id));
            if (!fresh.length) return prev;

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

    const pending = { nick: '', text: content, ts: Date.now(), consumed: false };
    lastLocalRef.current = pending;
    const profilePromise = loadSelfProfile().catch(() => null);
    try {
      await instance.send(content);
    } catch (err) {
      if (lastLocalRef.current === pending) lastLocalRef.current = null;
      throw err;
    }

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
