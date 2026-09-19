import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import pocketApi from '../api/pocket48';
import { logInfo, logWarn } from '../utils/runtimeLog';
import { hydrateRoomMap, getRoomMapEntry } from '../services/roomMapCache';

/** 上麦快照持久化 key：冷启动先展示旧结果，后台再增量重扫 */
const SNAPSHOT_KEY = 'yaya_onmic_snapshot_v1';

export interface OnMicMemberInput {
  memberId: string;
  name: string;
  channelId: string;
  serverId: string;
  smallChannelId?: string;
  /** 成员状态分类（官方源优先） */
  state?: string;
  /** 是否在团（桌面端 isInGroup !== false 语义）：false 表示退团/毕业，不参与扫描 */
  isInGroup?: boolean;
}

export interface OnMicEntry {
  memberId: string;
  name: string;
  channelId: string;
  serverId: string;
  smallChannelId: string;
  /** 房间电台音频流已开启（streamUrl 存在） */
  hasRadio: boolean;
  /** 当前在麦（语音）人数 */
  onMicCount: number;
  /** 上麦信号来自小房间（大房间无声时补测得出，播放页应默认小房间） */
  smallVoice?: boolean;
  /** 最近一次探测到的流地址（秒开用；wsSecret 会过期，播放页会立即后台校验换流） */
  streamUrl?: string;
  /** 本条目最近一次确认时间（快照恢复时用于展示时效） */
  updatedAt?: number;
}

interface OnMicState {
  /** 以 memberId 为键的上麦成员表 */
  onMic: Record<string, OnMicEntry>;
  scanning: boolean;
  lastScan: number;
  /** 本轮扫描任务总数（大/小房间各算一个，供内部进度） */
  total: number;
  /** 本轮参与扫描的成员数（UI 进度文案显示这个，任务数会让用户困惑） */
  memberTotal: number;
  /** 本轮已探测数 */
  done: number;
  /** 成员最近一次探测时间（增量扫描按最久未探测排序取预算） */
  probedAt: Record<string, number>;
  /** 快照年龄（毫秒）：>0 表示当前数据来自快照恢复 */
  snapshotAgeMs?: number;
  scan: (members: OnMicMemberInput[], opts?: { force?: boolean }) => Promise<void>;
  clear: () => void;
}

/** 两次扫描周期之间的最小间隔（毫秒） */
const SCAN_INTERVAL = 60 * 1000;
/** 单轮扫描的看门狗上限：超过视为卡死（异常路径漏复位），下次扫描前强制复位 */
const SCAN_STUCK_MS = 90 * 1000;
/**
 * 扫描轮次令牌（修复「新旧两轮并发」竞态）。
 *
 * ⚠️ 旧实现用两个模块级全局量 `scanStartedAt` / `scanAborted` 表示「当前轮」，
 * 但新一轮启动时会无条件把它们重置（`scanAborted = false` / `scanStartedAt = now`）
 * —— 于是被看门狗中止的**上一轮** worker 会被复活，继续跟新一轮抢 cursor、
 * 把两轮的进度混在一起（`done` 双计数）。
 *
 * 现在每轮拿一个独立的 round 对象，worker 闭包捕获**自己那一轮**的对象：
 *   - 心跳只刷自己轮的 lastProgress（不会替别的轮续命）
 *   - 看门狗只置自己轮的 aborted（只中止该死的那一轮，不误伤新一轮）
 *   - 进度 set / 结果 set 前都先校验 `isCurrent(round)`，旧轮一律作废不写 state
 */
interface ScanRound {
  id: number;
  aborted: boolean;
  /** 本轮的「最后进展时间」（开始时刻 + 每完成一个任务刷新；看门狗用，不走 state） */
  lastProgress: number;
}
let roundSeq = 0;
/** 当前活跃轮次（null = 没有在跑的轮） */
let currentRound: ScanRound | null = null;
/** 非强制扫描每轮预算：最多探测 1/3 成员（至少 40 位），最久未探测的优先，约 3 轮全量覆盖 */
const BUDGET_MIN = 40;
/** 并发探测数 + 每请求间隔：对齐桌面端 room-radio-feature.js（ROOM_RADIO_SCAN_CONCURRENCY=24 / GAP=20ms） */
const SCAN_CONCURRENCY = 24;
const REQUEST_GAP_MS = 20;

let snapshotHydrated = false;

/** 规范化 channelId：仅「纯数字且非 0」视为有效（桌面端 normalizeRoomRadioChannelId 同款） */
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

/**
 * 构造扫描任务（桌面端 createRoomRadioScanTaskList 语义）：
 *   每位成员 → 大房间(channelId) + 小房间(yklzId) 两个任务，去重键 `serverId:channelId`。
 *   成员库字段缺失时用 roomMap 本地缓存补（纯本地，不联网）；
 *   小房间被关闭（无 yklzId）→ 不生成该类任务，由大房间结果兜底。
 */
function buildScanTasks(members: OnMicMemberInput[]): ScanTask[] {
  const tasks: ScanTask[] = [];
  const seen = new Set<string>();
  for (const m of members) {
    const name = String(m.name || '').trim();
    if (!name || !m.memberId) continue;
    // 对齐桌面端：退团/毕业成员（isInGroup === false）不参与扫描，避免几百个无效请求
    if (m.isInGroup === false) continue;
    const cached = getRoomMapEntry(m.memberId);
    const big = normChannelId(m.channelId) || normChannelId(cached?.channelId);
    const small = normChannelId(m.smallChannelId) || normChannelId(cached?.yklzId);
    const serverId = String(m.serverId || cached?.serverId || '').trim();
    const pairs: [string, 'big' | 'small'][] = [[big, 'big'], [small, 'small']];
    for (const [channelId, roomType] of pairs) {
      if (!channelId) continue;
      const key = `${serverId}:${channelId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      tasks.push({ memberId: m.memberId, name, serverId, channelId, roomType, bigChannelId: big, smallChannelId: small });
    }
  }
  return tasks;
}

/**
 * v2.7.4 上麦扫描（语义：全部成员房间电台探测）：
 *  - 上麦 ≠ 口袋直播（liveList 是直播列表，与房间语音无关），只认 voice/operate 返回。
 *  - 快照优先：冷启动先恢复上次上麦结果（秒显），再后台重扫。
 *  - 预算制增量：非强制扫描每轮只探测「最久未探测」的 1/3（至少 40 位），
 *    降低服务端压力（原全量 505 人/轮）；强制扫描（进页）仍全量。
 *  - 大房间无声时补测小房间（yklzId），小房间有音则标记 smallVoice，播放页默认切小房间。
 *  - 60s 节流 + scanning 防重入。
 */
export const useOnMicStore = create<OnMicState>((set, get) => ({
  onMic: {},
  scanning: false,
  lastScan: 0,
  total: 0,
  memberTotal: 0,
  done: 0,
  probedAt: {},
  snapshotAgeMs: undefined,
  scan: async (allMembers, opts = {}) => {
    if (!allMembers || allMembers.length === 0) return;
    // ⚠️【扫描死锁修复】节流必须在 set({scanning:true}) 之前判断并返回。
    // 旧写法先置 scanning 再判节流，节流 return 时 scanning 留在 true 且无人复位 →
    // 之后的每次扫描（含头部「刷新」以外的自动刷新）都被 if (get().scanning) return 拦死，
    // 页面永久停「扫描中…」、一位成员都扫不出来。上麦页 60s 定时器与 SCAN_INTERVAL 同为 60s，
    // 极易命中该窗口 → 表现为「有概率扫不出来 / 偶尔一直转圈」。
    const last = get().lastScan;
    if (!opts.force && last && Date.now() - last < SCAN_INTERVAL) return;
    // 看门狗：判定**上一次**轮次是否卡死（异常路径漏复位 / 请求全 hang 无心跳）。
    // 只中止那一轮自己（round.aborted），不碰新轮；新轮拿到全新 round 对象，二者互不干扰。
    if (get().scanning) {
      const prev = currentRound;
      const prevStuck = !prev || Date.now() - prev.lastProgress > SCAN_STUCK_MS;
      if (prevStuck) {
        if (prev) {
          logWarn(`[onMic] 上次扫描疑似卡死（${Math.round((Date.now() - prev.lastProgress) / 1000)}s 无进展），中止该轮后重扫`, 'onMic');
          prev.aborted = true;
        }
        set({ scanning: false });
      } else {
        return;
      }
    }
    // 开新轮：新建独立令牌（**不覆盖**别轮的 aborted —— 那正是旧实现的竞态根因）
    const round: ScanRound = { id: ++roundSeq, aborted: false, lastProgress: Date.now() };
    currentRound = round;
    set({ scanning: true });
    // 冷启动：先恢复上麦快照（仅首次），页面秒显旧数据
    if (!snapshotHydrated) {
      snapshotHydrated = true;
      try {
        const raw = await AsyncStorage.getItem(SNAPSHOT_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          const entries: Record<string, OnMicEntry> = (parsed?.entries && typeof parsed.entries === 'object')
            ? parsed.entries : {};
          const savedAt = Number(parsed?.savedAt || 0);
          const ageMs = savedAt ? Date.now() - savedAt : 0;
          if (Object.keys(entries).length) {
            set({ onMic: entries, snapshotAgeMs: ageMs >= 0 ? ageMs : 0 });
            logInfo(`[onMic] 快照恢复上麦成员 ${Object.keys(entries).length} 位（${Math.round(Math.max(ageMs, 0) / 60000)} 分钟前）`, 'onMic');
          }
        }
      } catch {
        // 快照损坏忽略
      }
    }
    set({ scanning: true, total: 0, done: 0 });
    const updates: Record<string, OnMicEntry> = {};
    const removable = new Set<string>();
    let uniq: OnMicMemberInput[] = [];
    try {
      await hydrateRoomMap();
      uniq = allMembers.filter(
        (m, i, arr) => arr.findIndex((x) => x.memberId === m.memberId) === i,
      );
      if (!uniq.length) {
        set({ scanning: false, lastScan: Date.now(), done: 0, total: 0 });
        return;
      }

      // 抄桌面端 room-radio-feature.js：不做运行时房间解析（不再逐人 serverJump/seine 联网），
      // 直接用成员库(+roomMap 本地缓存)的 channelId / yklzId 构造「大房间 + 小房间」任务。
      // 此前逐人 resolveMemberRooms，未登录或解析失败即 continue → 全量扫描只出个位数
      // （用户反馈「根本收不到、只有 9 个」）。
      const tasks = buildScanTasks(uniq);

      // 预算制增量：非强制扫描只取「最久未探测」的成员子集
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

      // 成员级统计：仅当某成员的全部任务都成功返回且都没有流 → 才允许从列表移除（防网络抖动误清）
      const stat = new Map<string, { done: number; total: number; onAir: boolean; failed: number }>();
      for (const t of queue) {
        const st = stat.get(t.memberId) || { done: 0, total: 0, onAir: false, failed: 0 };
        st.total += 1;
        stat.set(t.memberId, st);
      }

      let cursor = 0;
      let sampleLogged = false;
      /**
       * 进度节流：扫描一轮可达上千个任务，若每个任务都 setState，
       * 上麦页会以每秒上百次重渲染（滚动卡顿、看起来像「卡死转圈」）。
       * 这里只在跨过 8 个任务或 250ms 时更新一次进度。
       */
      let pendingDone = 0;
      let lastFlush = Date.now();
      /** 本轮是否仍是活跃轮（旧轮被中止/被新轮取代后一律不写 state） */
      const isCurrent = () => currentRound === round && !round.aborted;
      const flushDone = (force = false) => {
        if (!pendingDone) return;
        if (!force && pendingDone < 8 && Date.now() - lastFlush < 250) return;
        const step = pendingDone;
        pendingDone = 0;
        lastFlush = Date.now();
        // 已不是活跃轮：丢弃待写进度，避免污染新一轮的 done（旧实现这里会双计数）
        if (!isCurrent()) return;
        set((snap) => ({ done: snap.done + step }));
      };
      const worker = async () => {
        while (cursor < queue.length) {
          if (!isCurrent()) return; // 本轮被看门狗中止 / 已被新轮取代 → 立即收工
          const t = queue[cursor++];
          const st = stat.get(t.memberId)!;
          try {
            const res: any = await pocketApi.operateRoomVoice({ channelId: t.channelId, serverId: t.serverId });
            const content = res?.content || (res?.data && res.data.content) || {};
            if (!sampleLogged) {
              sampleLogged = true;
              logInfo(`[onMic] voice/operate 返回结构（${t.name} ch=${t.channelId} srv=${t.serverId}）：${JSON.stringify(res).slice(0, 700)}`, 'onMic');
            }
            const voiceList = Array.isArray(content?.voiceUserList) ? content.voiceUserList : null;
            const activeVoice = !!voiceList && voiceList.some((u: any) => u && u.voiceStatus !== false);
            const streamUrl = String(content?.streamUrl || '');
            // 与桌面端一致的判定：有 streamUrl 且（无 voiceUserList 或列表内存在活跃用户）才算在麦
            const onAir = !!streamUrl && (!voiceList || activeVoice);
            st.done += 1;
            if (onAir) {
              st.onAir = true;
              const isSmall = t.roomType === 'small';
              const prev = updates[t.memberId];
              // 大房间结果优先；仅当小房间在麦且大房间无声时才标 smallVoice（播放页默认切小房间）
              if (!prev || (prev.smallVoice && !isSmall)) {
                const entry: OnMicEntry = {
                  memberId: t.memberId,
                  name: t.name,
                  channelId: t.bigChannelId || t.channelId,
                  serverId: t.serverId,
                  smallChannelId: t.smallChannelId,
                  hasRadio: true,
                  onMicCount: voiceList ? voiceList.filter((u: any) => u && u.voiceStatus !== false).length : 0,
                  smallVoice: isSmall || undefined,
                  streamUrl: streamUrl || undefined,
                  updatedAt: Date.now(),
                };
                updates[t.memberId] = entry;
                // 发现即上屏：不等整轮扫描结束，立即写进列表
                set((snap) => ({ onMic: { ...snap.onMic, [t.memberId]: entry } }));
                logInfo(`[onMic] ${t.name} 上麦中（${isSmall ? '小' : '大'}房间）ch=${t.channelId} srv=${t.serverId}`, 'onMic');
              }
            }
          } catch {
            // 单任务失败：计入 failed（该成员本轮不允许被移除），不影响其它任务
            st.done += 1;
            st.failed += 1;
          } finally {
            probedAt[t.memberId] = Date.now();
            // 心跳：只要有任务在完成，就不算卡死（看门狗只针对「长时间毫无进展」，
            // 慢网下 500+ 成员的完整扫描耗时长也不会被误判成卡死）
            round.lastProgress = Date.now();
            pendingDone += 1;
            flushDone();
            if (cursor < queue.length) await sleep(REQUEST_GAP_MS);
          }
        }
      };
      const workers = Array.from({ length: Math.min(SCAN_CONCURRENCY, queue.length) }, () => worker());
      await Promise.all(workers);
      flushDone(true);
      // 仅移除「全部任务成功且都没有流」的成员；失败/部分成功的保留旧状态
      stat.forEach((v, id) => {
        if (v.failed === 0 && v.done >= v.total && !v.onAir) removable.add(id);
      });
      logInfo(`[onMic] 扫描完成：任务 ${queue.length} 个 / ${uniq.length} 位成员，上麦 ${Object.keys(updates).length} 位，确认无声 ${removable.size} 位${opts.force ? '（全量）' : '（增量）'}`, 'onMic');
      set((snap) => {
        // 本轮已被看门狗中止 / 已被新轮取代：结果作废，不要覆盖新轮的状态与进度
        if (!isCurrent()) return snap;
        const next: Record<string, OnMicEntry> = { ...snap.onMic };
        removable.forEach((id) => { if (!(id in updates)) delete next[id]; });
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
      // 异常路径必须复位 scanning，否则页面永远停留「扫描中」且后续扫描被防重入拦死。
      // 仅当仍是活跃轮才复位 —— 否则新轮刚开始就被旧轮的异常路径把 scanning 清掉了。
      if (currentRound === round && !round.aborted) set({ scanning: false });
    }
    // 无论成功失败都持久化当前结果（含快照恢复后的首次空结果）
    try {
      await AsyncStorage.setItem(SNAPSHOT_KEY, JSON.stringify({
        entries: get().onMic,
        savedAt: Date.now(),
      }));
    } catch {
      // 持久化失败忽略
    }
  },
  clear: () => set({ onMic: {}, scanning: false, lastScan: 0, total: 0, memberTotal: 0, done: 0, probedAt: {}, snapshotAgeMs: undefined }),
}));