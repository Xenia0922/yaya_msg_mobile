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
  /** 成员状态分类（官方源优先）：退团/暂休不进扫描 */
  state?: string;
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
  /** 本轮扫描总数（供 UI 显示进度） */
  total: number;
  /** 本轮已探测数 */
  done: number;
  /** 成员最近一次探测时间（增量扫描按最久未探测排序取预算） */
  probedAt: Record<string, number>;
  /** 快照年龄（毫秒）：>0 表示当前数据来自快照恢复 */
  snapshotAgeMs?: number;
  scan: (members: OnMicMemberInput[], opts?: { force?: boolean; smallFallback?: boolean }) => Promise<void>;
  clear: () => void;
}

/** 两次扫描周期之间的最小间隔（毫秒） */
const SCAN_INTERVAL = 60 * 1000;
/** 非强制扫描每轮预算：最多探测 1/3 成员（至少 40 位），最久未探测的优先，约 3 轮全量覆盖 */
const BUDGET_MIN = 40;
/** 并发探测数 + 每请求间隔：对齐桌面端 room-radio-feature.js（ROOM_RADIO_SCAN_CONCURRENCY=24 / GAP=20ms） */
const SCAN_CONCURRENCY = 24;
const REQUEST_GAP_MS = 20;

/**
 * 判断某成员的 `team/voice/operate`(operateCode=2) 返回内容是否处于「上麦中」：
 *  - content.streamUrl 非空 → 房间电台音频流已开（有人在麦上播音）
 *  - content.voiceUserList 中存在 voiceStatus !== false 的用户 → 有人在语音麦上
 * 两者任一满足即视为上麦中。
 */
function parseOnMic(content: any): { hasRadio: boolean; onMicCount: number } {
  if (!content) return { hasRadio: false, onMicCount: 0 };
  const hasRadio = !!content.streamUrl;
  const list = Array.isArray(content.voiceUserList) ? content.voiceUserList : [];
  const onMicCount = list.filter((u: any) => u && u.voiceStatus !== false).length;
  return { hasRadio, onMicCount };
}

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
  done: 0,
  probedAt: {},
  snapshotAgeMs: undefined,
  scan: async (allMembers, opts = {}) => {
    if (!allMembers || allMembers.length === 0) return;
    if (get().scanning) return;
    // 立即置位防重入：下方 await 读快照期间若仍为 false，两个并发调用都能通过检查 → 双扫描
    set({ scanning: true });
    // 节流：距上次扫描不足 SCAN_INTERVAL 时跳过（除非 force 强制刷新）
    const last = get().lastScan;
    if (!opts.force && last && Date.now() - last < SCAN_INTERVAL) {
      return;
    }
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
      set({ total: queue.length });

      // 成员级统计：仅当某成员的全部任务都成功返回且都没有流 → 才允许从列表移除（防网络抖动误清）
      const stat = new Map<string, { done: number; total: number; onAir: boolean; failed: number }>();
      for (const t of queue) {
        const st = stat.get(t.memberId) || { done: 0, total: 0, onAir: false, failed: 0 };
        st.total += 1;
        stat.set(t.memberId, st);
      }

      let cursor = 0;
      let sampleLogged = false;
      const worker = async () => {
        while (cursor < queue.length) {
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
            set((snap) => ({ done: snap.done + 1 }));
            if (cursor < queue.length) await sleep(REQUEST_GAP_MS);
          }
        }
      };
      const workers = Array.from({ length: Math.min(SCAN_CONCURRENCY, queue.length) }, () => worker());
      await Promise.all(workers);
      // 仅移除「全部任务成功且都没有流」的成员；失败/部分成功的保留旧状态
      stat.forEach((v, id) => {
        if (v.failed === 0 && v.done >= v.total && !v.onAir) removable.add(id);
      });
      logInfo(`[onMic] 扫描完成：任务 ${queue.length} 个 / ${uniq.length} 位成员，上麦 ${Object.keys(updates).length} 位，确认无声 ${removable.size} 位${opts.force ? '（全量）' : '（增量）'}`, 'onMic');
      set((snap) => {
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
      // 异常路径必须复位 scanning，否则页面永远停留「扫描中」且后续扫描被防重入拦死
      set({ scanning: false });
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
  clear: () => set({ onMic: {}, scanning: false, lastScan: 0, total: 0, done: 0, probedAt: {}, snapshotAgeMs: undefined }),
}));