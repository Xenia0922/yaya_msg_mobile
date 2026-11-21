import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import pocketApi from '../api/pocket48';
import { logInfo, logWarn } from '../utils/runtimeLog';
import { hydrateRoomMap, getRoomMapEntry } from '../services/roomMapCache';
import type { VoiceEvent } from '../services/pocketNim/voiceEvent';

const SNAPSHOT_KEY = 'yaya_onmic_snapshot_v1';

export interface OnMicMemberInput {
  memberId: string;
  name: string;
  channelId: string;
  serverId: string;
  smallChannelId?: string;

  state?: string;

  isInGroup?: boolean;
}

export interface OnMicEntry {
  memberId: string;
  name: string;
  channelId: string;
  serverId: string;
  smallChannelId: string;

  hasRadio: boolean;

  onMicCount: number;

  smallVoice?: boolean;

  streamUrl?: string;

  updatedAt?: number;
}

interface OnMicState {
  onMic: Record<string, OnMicEntry>;

  voiceRooms: Record<string, boolean>;
  scanning: boolean;
  lastScan: number;

  total: number;

  memberTotal: number;

  done: number;

  probedAt: Record<string, number>;

  snapshotAgeMs?: number;
  scan: (
    members: OnMicMemberInput[],
    opts?: { force?: boolean; source?: 'rooms' | 'onMic' },
  ) => Promise<void>;

  abortScan: (source?: 'rooms' | 'onMic') => void;

  applyVoiceEvent: (event: VoiceEvent) => void;
  clear: () => void;
}

const SCAN_INTERVAL = 60 * 1000;

const SCAN_STUCK_MS = 90 * 1000;

interface ScanRound {
  id: number;
  aborted: boolean;
  source?: 'rooms' | 'onMic';

  lastProgress: number;
}
let roundSeq = 0;

let currentRound: ScanRound | null = null;

const BUDGET_MIN = 40;

const SCAN_CONCURRENCY = 8;
const REQUEST_GAP_MS = 20;

let snapshotHydrated = false;

function normChannelId(value: any): string {
  const v = String(value || '').trim();
  return /^\d+$/.test(v) && v !== '0' ? v : '';
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface ScanTask {
  memberId: string;
  name: string;
  serverId: string;
  channelId: string;
  roomType: 'big' | 'small';
  bigChannelId: string;
  smallChannelId: string;
}

function buildScanTasks(members: OnMicMemberInput[]): ScanTask[] {
  const tasks: ScanTask[] = [];
  const seen = new Set<string>();
  for (const m of members) {
    const name = String(m.name || '').trim();
    if (!name || !m.memberId) continue;
    if (m.isInGroup === false) continue;
    const cached = getRoomMapEntry(m.memberId);
    const big = normChannelId(m.channelId) || normChannelId(cached?.channelId);
    const small = normChannelId(m.smallChannelId) || normChannelId(cached?.yklzId);
    const serverId = String(m.serverId || cached?.serverId || '').trim();
    const pairs: [string, 'big' | 'small'][] = [
      [big, 'big'],
      [small, 'small'],
    ];
    for (const [channelId, roomType] of pairs) {
      if (!channelId) continue;
      const key = `${serverId}:${channelId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      tasks.push({
        memberId: m.memberId,
        name,
        serverId,
        channelId,
        roomType,
        bigChannelId: big,
        smallChannelId: small,
      });
    }
  }
  return tasks;
}

export const useOnMicStore = create<OnMicState>((set, get) => ({
  onMic: {},
  voiceRooms: {},
  scanning: false,
  lastScan: 0,
  total: 0,
  memberTotal: 0,
  done: 0,
  probedAt: {},
  snapshotAgeMs: undefined,
  scan: async (allMembers, opts = {}) => {
    if (!allMembers || allMembers.length === 0) return;

    const last = get().lastScan;
    if (!opts.force && last && Date.now() - last < SCAN_INTERVAL) return;

    if (get().scanning) {
      const prev = currentRound;
      const prevStuck = !prev || Date.now() - prev.lastProgress > SCAN_STUCK_MS;
      if (prevStuck) {
        if (prev) {
          logWarn(
            `[onMic] 上次扫描疑似卡死（${Math.round((Date.now() - prev.lastProgress) / 1000)}s 无进展），中止该轮后重扫`,
            'onMic',
          );
          prev.aborted = true;
        }
        set({ scanning: false });
      } else if (opts.force && prev) {
        logInfo('[onMic] 强制扫描：中止在飞的上一轮并立即重扫', 'onMic');
        prev.aborted = true;
        set({ scanning: false });
      } else {
        return;
      }
    }

    const round: ScanRound = {
      id: ++roundSeq,
      aborted: false,
      source: opts.source,
      lastProgress: Date.now(),
    };
    currentRound = round;
    set({ scanning: true });

    if (!snapshotHydrated) {
      snapshotHydrated = true;
      try {
        const raw = await AsyncStorage.getItem(SNAPSHOT_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          const entries: Record<string, OnMicEntry> =
            parsed?.entries && typeof parsed.entries === 'object' ? parsed.entries : {};
          const savedAt = Number(parsed?.savedAt || 0);
          const ageMs = savedAt ? Date.now() - savedAt : 0;
          if (Object.keys(entries).length) {
            set({ onMic: entries, snapshotAgeMs: ageMs >= 0 ? ageMs : 0 });
            logInfo(
              `[onMic] 快照恢复上麦成员 ${Object.keys(entries).length} 位（${Math.round(Math.max(ageMs, 0) / 60000)} 分钟前）`,
              'onMic',
            );
          }
        }
      } catch {}

      if (currentRound !== round || round.aborted) return;
    }
    set({ scanning: true, total: 0, done: 0 });
    const updates: Record<string, OnMicEntry> = {};
    const removable = new Set<string>();
    let uniq: OnMicMemberInput[] = [];
    try {
      await hydrateRoomMap();

      if (currentRound !== round || round.aborted) return;
      uniq = allMembers.filter(
        (m, i, arr) => arr.findIndex((x) => x.memberId === m.memberId) === i,
      );
      if (!uniq.length) {
        set({ scanning: false, lastScan: Date.now(), done: 0, total: 0 });
        return;
      }

      const tasks = buildScanTasks(uniq);

      const probedAt = { ...get().probedAt } as Record<string, number>;
      let queue = tasks;
      if (!opts.force) {
        const budget = Math.max(BUDGET_MIN, Math.ceil(uniq.length / 3));
        if (uniq.length > budget) {
          const keep = new Set(
            [...uniq]
              .sort((a, b) => (probedAt[a.memberId] || 0) - (probedAt[b.memberId] || 0))
              .slice(0, budget)
              .map((m) => m.memberId),
          );
          queue = tasks.filter((t) => keep.has(t.memberId));
        }
      }
      if (!queue.length) {
        set({ scanning: false, lastScan: Date.now(), done: 0, total: 0 });
        return;
      }
      set({ total: queue.length, memberTotal: uniq.length });

      const stat = new Map<
        string,
        { done: number; total: number; onAir: boolean; failed: number }
      >();
      for (const t of queue) {
        const st = stat.get(t.memberId) || { done: 0, total: 0, onAir: false, failed: 0 };
        st.total += 1;
        stat.set(t.memberId, st);
      }

      let cursor = 0;
      let sampleLogged = false;

      let pendingDone = 0;
      let lastFlush = Date.now();

      const isCurrent = () => currentRound === round && !round.aborted;
      const trackProgress = opts.source !== 'rooms';
      const flushDone = (force = false) => {
        if (!trackProgress || !pendingDone) return;
        if (!force && pendingDone < 8 && Date.now() - lastFlush < 250) return;
        const step = pendingDone;
        pendingDone = 0;
        lastFlush = Date.now();

        if (!isCurrent()) return;
        set((snap) => ({ done: snap.done + step }));
      };
      const worker = async () => {
        while (cursor < queue.length) {
          if (!isCurrent()) return;
          const t = queue[cursor++];
          const st = stat.get(t.memberId)!;
          try {
            const res: any = await pocketApi.operateRoomVoice({
              channelId: t.channelId,
              serverId: t.serverId,
            });
            const content = res?.content || (res?.data && res.data.content) || {};
            if (!sampleLogged) {
              sampleLogged = true;
              logInfo(
                `[onMic] voice/operate 返回结构（${t.name} ch=${t.channelId} srv=${t.serverId}）：${JSON.stringify(res).slice(0, 700)}`,
                'onMic',
              );
            }
            const voiceList = Array.isArray(content?.voiceUserList) ? content.voiceUserList : null;
            const activeVoice =
              !!voiceList && voiceList.some((u: any) => u && u.voiceStatus !== false);
            const streamUrl = String(content?.streamUrl || '');
            const onAir = !!streamUrl && (!voiceList || activeVoice);
            st.done += 1;
            if (onAir) {
              st.onAir = true;
              const isSmall = t.roomType === 'small';
              const prev = updates[t.memberId];

              if (!prev || (prev.smallVoice && !isSmall)) {
                const entry: OnMicEntry = {
                  memberId: t.memberId,
                  name: t.name,
                  channelId: t.bigChannelId || t.channelId,
                  serverId: t.serverId,
                  smallChannelId: t.smallChannelId,
                  hasRadio: true,
                  onMicCount: voiceList
                    ? voiceList.filter((u: any) => u && u.voiceStatus !== false).length
                    : 0,
                  smallVoice: isSmall || undefined,
                  streamUrl: streamUrl || undefined,
                  updatedAt: Date.now(),
                };
                updates[t.memberId] = entry;
                if (!isCurrent()) return;

                set((snap) => ({ onMic: { ...snap.onMic, [t.memberId]: entry } }));
                logInfo(
                  `[onMic] ${t.name} 上麦中（${isSmall ? '小' : '大'}房间）ch=${t.channelId} srv=${t.serverId}`,
                  'onMic',
                );
              }
            }
          } catch {
            st.done += 1;
            st.failed += 1;
          } finally {
            probedAt[t.memberId] = Date.now();

            round.lastProgress = Date.now();
            pendingDone += 1;
            flushDone();
            if (cursor < queue.length) await sleep(REQUEST_GAP_MS);
          }
        }
      };
      const workers = Array.from({ length: Math.min(SCAN_CONCURRENCY, queue.length) }, () =>
        worker(),
      );
      await Promise.all(workers);
      flushDone(true);

      stat.forEach((v, id) => {
        if (v.failed === 0 && v.done >= v.total && !v.onAir) removable.add(id);
      });
      logInfo(
        `[onMic] 扫描完成：任务 ${queue.length} 个 / ${uniq.length} 位成员，上麦 ${Object.keys(updates).length} 位，确认无声 ${removable.size} 位${opts.force ? '（全量）' : '（增量）'}`,
        'onMic',
      );
      set((snap) => {
        if (!isCurrent()) return snap;
        const next: Record<string, OnMicEntry> = { ...snap.onMic };
        removable.forEach((id) => {
          if (!(id in updates)) delete next[id];
        });
        Object.assign(next, updates);
        return {
          onMic: next,
          probedAt,
          scanning: false,
          lastScan: Date.now(),
          done: get().total,
          snapshotAgeMs: undefined,
        };
      });
    } catch (e: any) {
      logWarn(`[onMic] 扫描异常：${e?.message || String(e)}`, 'onMic');

      if (currentRound === round && !round.aborted) set({ scanning: false });
    }

    if (currentRound === round && !round.aborted) {
      try {
        await AsyncStorage.setItem(
          SNAPSHOT_KEY,
          JSON.stringify({
            entries: get().onMic,
            savedAt: Date.now(),
          }),
        );
      } catch {}
    }
  },
  applyVoiceEvent: (event) => {
    if (event.kind === 'room') {
      set((snap) => ({
        voiceRooms: {
          ...snap.voiceRooms,
          [`${event.serverId}:${event.channelId}`]: !!event.active,
        },
      }));
      return;
    }
    set((snap) => {
      const next = { ...snap.onMic };
      const removeChannelEntries = event.operateType === 'closeVoice' && !event.users.length;
      if (removeChannelEntries) {
        for (const [id, entry] of Object.entries(next)) {
          if (
            entry.serverId === event.serverId &&
            (entry.channelId === event.channelId || entry.smallChannelId === event.channelId)
          ) {
            delete next[id];
          }
        }
      }
      for (const user of event.users) {
        if (
          !user.micState ||
          event.operateType === 'downVoice' ||
          event.operateType === 'closeVoice'
        ) {
          delete next[user.userId];
          continue;
        }
        next[user.userId] = {
          memberId: user.userId,
          name: user.nickname,
          channelId: event.channelId,
          serverId: event.serverId,
          smallChannelId: '',
          hasRadio: !!event.streamUrl,
          onMicCount: 1,
          streamUrl: event.streamUrl || undefined,
          updatedAt: Date.now(),
        };
      }
      return { onMic: next, lastScan: Date.now(), snapshotAgeMs: 0 };
    });
  },
  abortScan: (source) => {
    if (!currentRound) return;
    if (source && currentRound.source !== source) return;
    currentRound.aborted = true;
    currentRound = null;

    const cooldownLastScan = Math.max(get().lastScan, Date.now() - SCAN_INTERVAL + 15000);
    if (get().scanning || cooldownLastScan !== get().lastScan) {
      set({ scanning: false, lastScan: cooldownLastScan });
    }
  },
  clear: () => {
    if (currentRound) currentRound.aborted = true;
    currentRound = null;
    set({
      onMic: {},
      voiceRooms: {},
      scanning: false,
      lastScan: 0,
      total: 0,
      memberTotal: 0,
      done: 0,
      probedAt: {},
      snapshotAgeMs: undefined,
    });
  },
}));
