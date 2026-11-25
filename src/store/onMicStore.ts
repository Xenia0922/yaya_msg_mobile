import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import pocketApi from '../api/pocket48';
import { logInfo, logWarn } from '../utils/runtimeLog';
import { hydrateRoomMap, getRoomMapEntry } from '../services/roomMapCache';
import { getTaskBudget, waitForIdleSlot, wakeIdleWaiters } from '../services/perfScheduler';
import type { VoiceEvent } from '../services/pocketNim/voiceEvent';

const SNAPSHOT_KEY = 'yaya_onmic_snapshot_v1';

export const SCAN_INTERVAL = 60 * 1000;
export const SNAPSHOT_MAX_AGE_MS = 10 * 60 * 1000;
export const STREAM_URL_FRESH_MS = 2 * 60 * 1000;

const SCAN_STUCK_MS = 90 * 1000;
const BUDGET_MIN = 40;
const SCAN_CONCURRENCY = 6;
const BG_ONMIC_MAX_TASKS = 28;
const PROBE_COOLDOWN_MS = 5 * 1000;
const EVENT_DEDUP_MS = 800;

export type ScanSource = 'rooms' | 'onMic';

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
  bigVoice?: boolean;
  smallVoice?: boolean;
  streamUrl?: string;
  updatedAt?: number;
}

interface OnMicState {
  onMic: Record<string, OnMicEntry>;
  voiceRooms: Record<string, boolean>;
  scanning: boolean;
  lastScan: number;
  lastScanBySource: Record<ScanSource, number>;
  total: number;
  memberTotal: number;
  done: number;
  probedAt: Record<string, number>;
  snapshotAgeMs?: number;
  scan: (
    members: OnMicMemberInput[],
    opts?: { force?: boolean; source?: ScanSource; priorityIds?: Iterable<string> },
  ) => Promise<void>;
  probeMember: (input: OnMicMemberInput) => Promise<OnMicEntry | null>;
  abortScan: (source?: ScanSource) => void;
  applyVoiceEvent: (event: VoiceEvent) => void;
  clear: () => void;
}

interface ScanRound {
  id: number;
  epoch: number;
  aborted: boolean;
  source: ScanSource;
  lastProgress: number;
}

let roundSeq = 0;
let storeEpoch = 0;
let currentRound: ScanRound | null = null;
let snapshotHydrated = false;

const probeInFlight = new Map<string, Promise<OnMicEntry | null>>();
const probeLastAt = new Map<string, number>();
const recentVoiceEvents = new Map<string, number>();

function normChannelId(value: any): string {
  const v = String(value || '').trim();
  return /^\d+$/.test(v) && v !== '0' ? v : '';
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function isOnMicStreamFresh(
  entry?: Pick<OnMicEntry, 'streamUrl' | 'updatedAt'> | null,
  now = Date.now(),
): boolean {
  if (!entry?.streamUrl || !entry.updatedAt) return false;
  const age = now - Number(entry.updatedAt);
  return age >= 0 && age < STREAM_URL_FRESH_MS;
}

export function orderOnMicCandidates(
  members: OnMicMemberInput[],
  opts?: {
    activeIds?: Set<string>;
    priorityIds?: Set<string>;
    probedAt?: Record<string, number>;
  },
): OnMicMemberInput[] {
  const seen = new Set<string>();
  const uniq: OnMicMemberInput[] = [];
  for (const m of members) {
    const id = String(m?.memberId || '').trim();
    const name = String(m?.name || '').trim();
    if (!id || !name || m.isInGroup === false || seen.has(id)) continue;
    seen.add(id);
    uniq.push(m);
  }
  const activeIds = opts?.activeIds;
  const priorityIds = opts?.priorityIds;
  const probedAt = opts?.probedAt || {};
  const tierOf = (id: string) => {
    if (activeIds?.has(id)) return 0;
    if (priorityIds?.has(id)) return 1;
    return 2;
  };
  return uniq.sort((a, b) => {
    const ta = tierOf(a.memberId);
    const tb = tierOf(b.memberId);
    if (ta !== tb) return ta - tb;
    return (probedAt[a.memberId] || 0) - (probedAt[b.memberId] || 0);
  });
}

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

function mergeVoiceHit(
  prev: OnMicEntry | undefined,
  task: ScanTask,
  streamUrl: string,
  micCount: number,
  now = Date.now(),
): OnMicEntry {
  const isSmall = task.roomType === 'small';
  const bigVoice = isSmall ? Boolean(prev?.bigVoice) : true;
  const smallVoice = isSmall ? true : Boolean(prev?.smallVoice);
  const keepPrevStream = isSmall && prev?.bigVoice && prev?.streamUrl;
  return {
    memberId: task.memberId,
    name: task.name,
    channelId: task.bigChannelId || prev?.channelId || task.channelId,
    serverId: task.serverId || prev?.serverId || '',
    smallChannelId: task.smallChannelId || prev?.smallChannelId || '',
    hasRadio: true,
    onMicCount: Math.max(micCount, prev?.onMicCount || 0),
    bigVoice: bigVoice || undefined,
    smallVoice: isSmall ? true : smallVoice || undefined,
    streamUrl: (keepPrevStream ? prev?.streamUrl : streamUrl) || undefined,
    updatedAt: now,
  };
}

function parseVoiceOperateHit(res: any): { onAir: boolean; streamUrl: string; micCount: number } {
  const content = res?.content || (res?.data && res.data.content) || {};
  const voiceList = Array.isArray(content?.voiceUserList) ? content.voiceUserList : null;
  const activeCount = voiceList
    ? voiceList.filter((u: any) => u && u.voiceStatus !== false).length
    : 0;
  const streamUrl = String(content?.streamUrl || '');
  const onAir = !!streamUrl && (!voiceList || activeCount > 0);
  return { onAir, streamUrl, micCount: activeCount };
}

function buildVoiceEventKey(event: VoiceEvent): string {
  const usersSig = event.users
    .map((u) => `${u.userId}:${u.micState ? 1 : 0}`)
    .sort()
    .join(',');
  return `${event.kind}|${event.serverId}|${event.channelId}|${event.operateType || ''}|${event.active ? 1 : 0}|${usersSig}`;
}

function isDuplicateVoiceEvent(event: VoiceEvent): boolean {
  const now = Date.now();
  if (recentVoiceEvents.size > 100) {
    recentVoiceEvents.forEach((ts, k) => {
      if (now - ts > EVENT_DEDUP_MS) recentVoiceEvents.delete(k);
    });
  }
  const key = buildVoiceEventKey(event);
  const prev = recentVoiceEvents.get(key) || 0;
  if (prev && now - prev < EVENT_DEDUP_MS) return true;
  recentVoiceEvents.set(key, now);
  return false;
}

export const useOnMicStore = create<OnMicState>((set, get) => ({
  onMic: {},
  voiceRooms: {},
  scanning: false,
  lastScan: 0,
  lastScanBySource: { rooms: 0, onMic: 0 },
  total: 0,
  memberTotal: 0,
  done: 0,
  probedAt: {},
  snapshotAgeMs: undefined,

  scan: async (allMembers, opts = {}) => {
    if (!allMembers || allMembers.length === 0) return;

    const source: ScanSource = opts.source || 'onMic';
    const lastForSource = get().lastScanBySource?.[source] || 0;
    if (!opts.force && lastForSource && Date.now() - lastForSource < SCAN_INTERVAL) return;

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
      } else if (prev && prev.source === 'rooms' && source === 'onMic') {
        logInfo('[onMic] 上麦页面接管扫描：中止后台房间列表轮询', 'onMic');
        prev.aborted = true;
        set({ scanning: false });
      } else {
        return;
      }
    }

    const roundEpoch = storeEpoch;
    const round: ScanRound = {
      id: ++roundSeq,
      epoch: roundEpoch,
      aborted: false,
      source,
      lastProgress: Date.now(),
    };
    currentRound = round;
    set({ scanning: true });

    const isCurrent = () => currentRound === round && !round.aborted && roundEpoch === storeEpoch;

    if (!snapshotHydrated) {
      snapshotHydrated = true;
      try {
        const raw = await AsyncStorage.getItem(SNAPSHOT_KEY);
        if (raw && isCurrent()) {
          const parsed = JSON.parse(raw);
          const entries: Record<string, OnMicEntry> =
            parsed?.entries && typeof parsed.entries === 'object' ? parsed.entries : {};
          const savedAt = Number(parsed?.savedAt || 0);
          const ageMs = savedAt > 0 ? Math.max(0, Date.now() - savedAt) : Infinity;
          if (ageMs > SNAPSHOT_MAX_AGE_MS) {
            void AsyncStorage.removeItem(SNAPSHOT_KEY).catch(() => {});
            logInfo(
              `[onMic] 丢弃过期快照（${Number.isFinite(ageMs) ? Math.round(ageMs / 60000) : '未知'} 分钟前）`,
              'onMic',
            );
          } else {
            const now = Date.now();
            const restored: Record<string, OnMicEntry> = {};
            for (const [id, entry] of Object.entries(entries)) {
              if (!entry || !id) continue;
              if (entry.updatedAt && now - entry.updatedAt > SNAPSHOT_MAX_AGE_MS) continue;
              restored[id] = isOnMicStreamFresh(entry, now)
                ? entry
                : { ...entry, streamUrl: undefined };
            }
            const restoredCount = Object.keys(restored).length;
            if (restoredCount > 0) {
              set((snap) => ({
                onMic: { ...restored, ...snap.onMic },
                snapshotAgeMs: ageMs,
              }));
              logInfo(
                `[onMic] 快照恢复上麦成员 ${restoredCount} 位（${Math.round(ageMs / 60000)} 分钟前）`,
                'onMic',
              );
            }
          }
        }
      } catch {}

      if (!isCurrent()) return;
    }

    set({ scanning: true, total: 0, done: 0 });
    const updates: Record<string, OnMicEntry> = {};
    const removable = new Set<string>();
    let orderedUniq: OnMicMemberInput[] = [];
    try {
      await hydrateRoomMap();
      if (!isCurrent()) return;

      const activeIds = new Set(Object.keys(get().onMic));
      const priorityIds = opts.priorityIds ? new Set(opts.priorityIds) : undefined;
      const probedAt = { ...get().probedAt } as Record<string, number>;

      orderedUniq = orderOnMicCandidates(allMembers, {
        activeIds,
        priorityIds,
        probedAt,
      });

      if (!orderedUniq.length) {
        const doneAt = Date.now();
        set((snap) => ({
          scanning: false,
          lastScan: Math.max(snap.lastScan, doneAt),
          lastScanBySource: { ...snap.lastScanBySource, [source]: doneAt },
          done: 0,
          total: 0,
        }));
        return;
      }

      let selectedMembers = orderedUniq;
      if (!opts.force) {
        const alwaysCount = orderedUniq.reduce(
          (acc, m) => (activeIds.has(m.memberId) || priorityIds?.has(m.memberId) ? acc + 1 : acc),
          0,
        );
        const budget = Math.max(BUDGET_MIN, Math.ceil(orderedUniq.length / 3), alwaysCount);
        if (orderedUniq.length > budget) {
          selectedMembers = orderedUniq.slice(0, budget);
        }
      }

      const queue = buildScanTasks(selectedMembers);
      if (!queue.length) {
        const doneAt = Date.now();
        set((snap) => ({
          scanning: false,
          lastScan: Math.max(snap.lastScan, doneAt),
          lastScanBySource: { ...snap.lastScanBySource, [source]: doneAt },
          done: 0,
          total: 0,
        }));
        return;
      }
      set({ total: queue.length, memberTotal: orderedUniq.length });

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
      let bgTasksUsed = 0;
      let pausedByBgCap = false;
      let pendingHits: Record<string, OnMicEntry> = {};
      let lastHitCommit = Date.now();

      const ownerRoute = source === 'rooms' ? 'Rooms' : 'OnMicScreen';
      const budgetRole = source === 'rooms' ? 'roomsOnMic' : 'onMic';
      const trackProgress = source !== 'rooms';

      const flushPendingHits = (force = false) => {
        const hitKeys = Object.keys(pendingHits);
        if (!hitKeys.length) return;
        const budget = getTaskBudget(ownerRoute, budgetRole);
        if (!force && !budget.focused && Date.now() - lastHitCommit < budget.commitBatchMs) {
          return;
        }
        const batch = pendingHits;
        pendingHits = {};
        lastHitCommit = Date.now();
        if (!isCurrent()) return;
        set((snap) => ({ onMic: { ...snap.onMic, ...batch } }));
      };

      const flushDone = (force = false) => {
        if (!trackProgress || !pendingDone) return;
        const budget = getTaskBudget(ownerRoute, budgetRole);
        const minWait = budget.focused ? 250 : budget.commitBatchMs;
        const minCount = budget.focused ? 8 : 16;
        if (!force && pendingDone < minCount && Date.now() - lastFlush < minWait) return;
        const step = pendingDone;
        pendingDone = 0;
        lastFlush = Date.now();
        if (!isCurrent()) return;
        set((snap) => ({ done: snap.done + step }));
      };

      const worker = async (workerIdx: number) => {
        while (!pausedByBgCap && cursor < queue.length) {
          if (!isCurrent()) return;
          const ok = await waitForIdleSlot('background', isCurrent);
          if (!ok || !isCurrent()) return;
          round.lastProgress = Date.now();
          if (pausedByBgCap || cursor >= queue.length) return;
          const budget = getTaskBudget(ownerRoute, budgetRole);
          if (source === 'onMic' && !budget.focused && bgTasksUsed >= BG_ONMIC_MAX_TASKS) {
            pausedByBgCap = true;
            return;
          }
          if (workerIdx >= budget.concurrency) {
            await sleep(260);
            continue;
          }
          const nextIdx = cursor++;
          if (nextIdx >= queue.length) return;
          const t = queue[nextIdx];
          if (!budget.focused) bgTasksUsed += 1;
          const st = stat.get(t.memberId)!;
          try {
            const res: any = await pocketApi.operateRoomVoice({
              channelId: t.channelId,
              serverId: t.serverId,
            });
            if (!sampleLogged) {
              sampleLogged = true;
              logInfo(
                `[onMic] voice/operate 返回结构（${t.name} ch=${t.channelId} srv=${t.serverId}）：${JSON.stringify(res).slice(0, 700)}`,
                'onMic',
              );
            }
            const parsed = parseVoiceOperateHit(res);
            st.done += 1;
            if (parsed.onAir) {
              st.onAir = true;
              const merged = mergeVoiceHit(
                updates[t.memberId],
                t,
                parsed.streamUrl,
                parsed.micCount,
              );
              updates[t.memberId] = merged;
              pendingHits[t.memberId] = merged;
              flushPendingHits(getTaskBudget(ownerRoute, budgetRole).focused);
              logInfo(
                `[onMic] ${t.name} 上麦中（${t.roomType === 'small' ? '小' : '大'}房间）ch=${t.channelId} srv=${t.serverId}`,
                'onMic',
              );
            }
          } catch {
            st.done += 1;
            st.failed += 1;
          } finally {
            probedAt[t.memberId] = Date.now();
            round.lastProgress = Date.now();
            pendingDone += 1;
            flushDone();
            if (cursor < queue.length && !pausedByBgCap) {
              const gap = getTaskBudget(ownerRoute, budgetRole).gapMs;
              if (gap > 0) await sleep(gap);
            }
          }
        }
      };

      const workers = Array.from(
        { length: Math.min(SCAN_CONCURRENCY, queue.length) },
        (_unused, idx) => worker(idx),
      );
      await Promise.all(workers);
      flushPendingHits(true);
      flushDone(true);

      stat.forEach((v, id) => {
        if (v.failed === 0 && v.done >= v.total && !v.onAir) removable.add(id);
      });
      logInfo(
        `[onMic] 扫描${pausedByBgCap ? '后台降载暂停' : '完成'}（${source}）：任务 ${cursor}/${queue.length} 个（成员 ${orderedUniq.length} 位），上麦 ${Object.keys(updates).length} 位，确认无声 ${removable.size} 位${opts.force ? '（全量）' : '（增量）'}`,
        'onMic',
      );
      set((snap) => {
        if (!isCurrent()) return snap;
        const next: Record<string, OnMicEntry> = { ...snap.onMic };
        removable.forEach((id) => {
          if (!(id in updates)) delete next[id];
        });
        Object.assign(next, updates);
        const doneAt = Date.now();
        return {
          onMic: next,
          probedAt,
          scanning: false,
          lastScan: pausedByBgCap ? snap.lastScan : Math.max(snap.lastScan, doneAt),
          lastScanBySource: pausedByBgCap
            ? snap.lastScanBySource
            : { ...snap.lastScanBySource, [source]: doneAt },
          done: pausedByBgCap ? snap.done : get().total,
          snapshotAgeMs: undefined,
        };
      });
    } catch (e: any) {
      logWarn(`[onMic] 扫描异常：${e?.message || String(e)}`, 'onMic');
      if (isCurrent()) set({ scanning: false });
    }

    if (isCurrent()) {
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

  probeMember: async (input) => {
    const memberId = String(input?.memberId || '').trim();
    const name = String(input?.name || memberId).trim();
    if (!memberId) return null;

    const existingPromise = probeInFlight.get(memberId);
    if (existingPromise) return existingPromise;

    const lastProbe = probeLastAt.get(memberId) || 0;
    if (lastProbe && Date.now() - lastProbe < PROBE_COOLDOWN_MS) {
      return get().onMic[memberId] || null;
    }

    const epochAtStart = storeEpoch;
    let taskPromise: Promise<OnMicEntry | null> | null = null;
    taskPromise = (async (): Promise<OnMicEntry | null> => {
      await hydrateRoomMap();
      if (epochAtStart !== storeEpoch) return null;

      const cached = getRoomMapEntry(memberId);
      const big = normChannelId(input.channelId) || normChannelId(cached?.channelId);
      const rawSmall = normChannelId(input.smallChannelId) || normChannelId(cached?.yklzId);
      const small = rawSmall && rawSmall !== big ? rawSmall : '';
      const serverId = String(input.serverId || cached?.serverId || '').trim();

      const probeTasks: ScanTask[] = [];
      if (big) {
        probeTasks.push({
          memberId,
          name,
          serverId,
          channelId: big,
          roomType: 'big',
          bigChannelId: big,
          smallChannelId: small,
        });
      }
      if (small) {
        probeTasks.push({
          memberId,
          name,
          serverId,
          channelId: small,
          roomType: 'small',
          bigChannelId: big,
          smallChannelId: small,
        });
      }
      if (!probeTasks.length) return get().onMic[memberId] || null;

      const results = await Promise.all(
        probeTasks.map(async (t) => {
          try {
            const res = await pocketApi.operateRoomVoice({
              channelId: t.channelId,
              serverId: t.serverId,
            });
            return { task: t, ok: true, parsed: parseVoiceOperateHit(res) };
          } catch {
            return { task: t, ok: false, parsed: { onAir: false, streamUrl: '', micCount: 0 } };
          }
        }),
      );
      if (epochAtStart !== storeEpoch) return null;

      probeLastAt.set(memberId, Date.now());
      let merged: OnMicEntry | undefined;
      let allSucceeded = true;
      for (const r of results) {
        if (!r.ok) allSucceeded = false;
        if (r.parsed.onAir) {
          merged = mergeVoiceHit(merged, r.task, r.parsed.streamUrl, r.parsed.micCount);
        }
      }

      if (merged) {
        set((snap) => ({
          onMic: { ...snap.onMic, [memberId]: merged! },
          probedAt: { ...snap.probedAt, [memberId]: Date.now() },
        }));
        return merged;
      }
      if (allSucceeded) {
        set((snap) => {
          const next = { ...snap.onMic };
          delete next[memberId];
          return {
            onMic: next,
            probedAt: { ...snap.probedAt, [memberId]: Date.now() },
          };
        });
        return null;
      }
      return get().onMic[memberId] || null;
    })().finally(() => {
      if (probeInFlight.get(memberId) === taskPromise) {
        probeInFlight.delete(memberId);
      }
    });

    probeInFlight.set(memberId, taskPromise);
    return taskPromise;
  },

  applyVoiceEvent: (event) => {
    if (isDuplicateVoiceEvent(event)) return;
    if (event.kind === 'room') {
      const eventCid = normChannelId(event.channelId);
      set((snap) => {
        const nextVoiceRooms = {
          ...snap.voiceRooms,
          [`${event.serverId}:${event.channelId}`]: !!event.active,
        };
        if (event.active || !eventCid) {
          return { voiceRooms: nextVoiceRooms };
        }
        const nextOnMic = { ...snap.onMic };
        let changed = false;
        for (const [id, entry] of Object.entries(nextOnMic)) {
          if (entry.serverId && event.serverId && entry.serverId !== event.serverId) continue;
          const matchesBig = normChannelId(entry.channelId) === eventCid;
          const matchesSmall = normChannelId(entry.smallChannelId) === eventCid;
          if (!matchesBig && !matchesSmall) continue;
          if (matchesBig && !entry.smallVoice) {
            delete nextOnMic[id];
            changed = true;
          } else if (matchesSmall && !entry.bigVoice) {
            delete nextOnMic[id];
            changed = true;
          } else if (matchesBig && entry.smallVoice) {
            nextOnMic[id] = { ...entry, bigVoice: false, streamUrl: undefined };
            changed = true;
          } else if (matchesSmall && entry.bigVoice) {
            nextOnMic[id] = { ...entry, smallVoice: false };
            changed = true;
          }
        }
        return changed
          ? { voiceRooms: nextVoiceRooms, onMic: nextOnMic }
          : { voiceRooms: nextVoiceRooms };
      });
      return;
    }

    set((snap) => {
      const next = { ...snap.onMic };
      const eventCid = normChannelId(event.channelId);
      const removeChannelEntries = event.operateType === 'closeVoice' && !event.users.length;
      if (removeChannelEntries) {
        for (const [id, entry] of Object.entries(next)) {
          const matchesBig = normChannelId(entry.channelId) === eventCid;
          const matchesSmall = normChannelId(entry.smallChannelId) === eventCid;
          if (
            (!event.serverId || !entry.serverId || entry.serverId === event.serverId) &&
            (matchesBig || matchesSmall)
          ) {
            if (matchesSmall && entry.bigVoice && !matchesBig) {
              next[id] = { ...entry, smallVoice: false };
            } else if (matchesBig && entry.smallVoice && !matchesSmall) {
              next[id] = { ...entry, bigVoice: false, streamUrl: undefined };
            } else {
              delete next[id];
            }
          }
        }
      }

      const activeCount = Math.max(
        1,
        event.users.filter(
          (u) =>
            u.micState && event.operateType !== 'downVoice' && event.operateType !== 'closeVoice',
        ).length,
      );

      for (const user of event.users) {
        const existing = next[user.userId];
        const mapEntry = getRoomMapEntry(user.userId);
        const knownBig = normChannelId(existing?.channelId) || normChannelId(mapEntry?.channelId);
        const knownSmall =
          normChannelId(existing?.smallChannelId) || normChannelId(mapEntry?.yklzId);
        const isSmallEvent = Boolean(
          eventCid && knownSmall && eventCid === knownSmall && eventCid !== knownBig,
        );

        if (
          !user.micState ||
          event.operateType === 'downVoice' ||
          event.operateType === 'closeVoice'
        ) {
          if (existing) {
            if (isSmallEvent && existing.bigVoice) {
              next[user.userId] = { ...existing, smallVoice: false };
            } else if (!isSmallEvent && existing.smallVoice && existing.channelId === eventCid) {
              next[user.userId] = { ...existing, bigVoice: false, streamUrl: undefined };
            } else {
              delete next[user.userId];
            }
          }
          continue;
        }

        const bigVoice = isSmallEvent ? Boolean(existing?.bigVoice) : true;
        const smallVoice = isSmallEvent ? true : Boolean(existing?.smallVoice);
        next[user.userId] = {
          memberId: user.userId,
          name: user.nickname || existing?.name || user.userId,
          channelId: knownBig || (isSmallEvent ? '' : eventCid),
          serverId: event.serverId || existing?.serverId || mapEntry?.serverId || '',
          smallChannelId: knownSmall || (isSmallEvent ? eventCid : ''),
          hasRadio: true,
          onMicCount: activeCount,
          bigVoice: bigVoice || undefined,
          smallVoice: isSmallEvent ? true : smallVoice || undefined,
          streamUrl: event.streamUrl || existing?.streamUrl || undefined,
          updatedAt: Date.now(),
        };
      }
      return { onMic: next };
    });
  },

  abortScan: (source) => {
    if (!currentRound) return;
    if (source && currentRound.source !== source) return;
    const abortedSource = currentRound.source;
    currentRound.aborted = true;
    currentRound = null;
    wakeIdleWaiters();

    const prevSourceLast = get().lastScanBySource?.[abortedSource] || 0;
    const cooldownLastScan = Math.max(prevSourceLast, Date.now() - SCAN_INTERVAL + 15000);
    set((snap) => ({
      scanning: false,
      lastScanBySource: { ...snap.lastScanBySource, [abortedSource]: cooldownLastScan },
      lastScan: Math.max(snap.lastScan, cooldownLastScan),
    }));
  },

  clear: () => {
    storeEpoch += 1;
    snapshotHydrated = false;
    probeInFlight.clear();
    probeLastAt.clear();
    recentVoiceEvents.clear();
    if (currentRound) currentRound.aborted = true;
    currentRound = null;
    wakeIdleWaiters();
    set({
      onMic: {},
      voiceRooms: {},
      scanning: false,
      lastScan: 0,
      lastScanBySource: { rooms: 0, onMic: 0 },
      total: 0,
      memberTotal: 0,
      done: 0,
      probedAt: {},
      snapshotAgeMs: undefined,
    });
  },
}));
