import AsyncStorage from '@react-native-async-storage/async-storage';
import pocketApi from '../api/pocket48';
import { useMemberStore, useSettingsStore } from '../store';
import { isRoomMember } from '../utils/members';
import { logInfo, logWarn } from '../utils/runtimeLog';

const ROOM_MAP_KEY = 'yaya_member_room_map_v3';

export interface RoomMapEntry {
  channelId: string;
  yklzId: string;
  serverId: string;
  updatedAt: number;

  yklzTriedAt?: number;

  verifiedAt?: number;
}

let roomMap: Record<string, RoomMapEntry> = {};
let hydrated = false;
let hydration: Promise<void> | null = null;

const MAX_ENTRIES = 1000;

function trimRoomMap(): void {
  const keys = Object.keys(roomMap);
  if (keys.length <= MAX_ENTRIES) return;
  const drop = keys
    .sort((a, b) => (roomMap[a]?.updatedAt || 0) - (roomMap[b]?.updatedAt || 0))
    .slice(0, keys.length - MAX_ENTRIES);
  for (const k of drop) delete roomMap[k];
}

export async function hydrateRoomMap(): Promise<void> {
  if (hydrated) return;
  if (hydration) return hydration;
  hydration = (async () => {
    try {
      const raw = await AsyncStorage.getItem(ROOM_MAP_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') roomMap = parsed;
      }
      trimRoomMap();
    } catch {
      roomMap = {};
    }
    hydrated = true;
    logInfo(`[roomMap] 已加载房间映射缓存 ${Object.keys(roomMap).length} 条`, 'roomMap');
  })();
  try {
    await hydration;
  } finally {
    hydration = null;
  }
}

export function getRoomMapEntry(memberId: string): RoomMapEntry | undefined {
  return roomMap[String(memberId)];
}

export function seedRoomMapFromMembers(members: any[]): void {
  let changed = false;
  for (const m of members) {
    const id = String(m?.id || '');
    if (!id) continue;
    const cid = String(m?.channelId || '');
    const yid = String(m?.yklzId || '');
    const sid = String(m?.serverId || '');
    if (!cid && !yid && !sid) continue;
    const existing = roomMap[id];
    if (!existing) {
      roomMap[id] = { channelId: cid, yklzId: yid, serverId: sid, updatedAt: Date.now() };
      changed = true;
      continue;
    }
    if ((!existing.channelId || existing.channelId === '0') && cid) {
      existing.channelId = cid;
      changed = true;
    }
    if ((!existing.yklzId || existing.yklzId === '0') && yid) {
      existing.yklzId = yid;
      changed = true;
    }
    if ((!existing.serverId || existing.serverId === '0') && sid) {
      existing.serverId = sid;
      changed = true;
    }
    existing.updatedAt = Date.now();
  }
  if (changed) persistRoomMap();
}

let persistChain: Promise<void> = Promise.resolve();

function persistRoomMap(): void {
  persistChain = persistChain.then(async () => {
    try {
      trimRoomMap();
      await AsyncStorage.setItem(ROOM_MAP_KEY, JSON.stringify(roomMap));
    } catch {}
  });
}

export function parseSeineDetail(content: any): {
  channelId: string;
  yklzId: string;
  serverId: string;
} {
  const list = Array.isArray(content?.channelInfoList) ? content.channelInfoList : [];
  const big = list[0];
  const small = list[1];
  const channelId = String(big?.channelId || '');
  const yklzId = String(small?.channelId || '');
  const serverId = String(content?.chatServerInfo?.serverId || '');
  return { channelId, yklzId, serverId };
}

export async function refreshActiveRoomMappings(): Promise<void> {
  const token = useSettingsStore.getState().settings.p48Token;
  if (!token) return;
  await hydrateRoomMap();
  let servers: Record<string, unknown>;
  try {
    const result = await pocketApi.getStarServerMap();
    servers = result?.content?.userServerMap || result?.data?.userServerMap || {};
  } catch {
    return;
  }
  if (useSettingsStore.getState().settings.p48Token !== token) return;
  const candidates = useMemberStore
    .getState()
    .members.filter(
      (member) => isRoomMember(member) && /^[1-9]\d*$/.test(String(servers[member.id] || '')),
    );
  let next = 0;
  let failures = 0;
  let changed = 0;
  const patches = new Map<string, RoomMapEntry>();
  const flush = () => {
    if (!patches.size || useSettingsStore.getState().settings.p48Token !== token) return;
    const updates = new Map(patches);
    patches.clear();
    const store = useMemberStore.getState();
    store.setMembers(
      store.members.map((member) => {
        const update = updates.get(String(member.id));
        return update
          ? {
              ...member,
              serverId: update.serverId,
              channelId: update.channelId,
              yklzId: update.yklzId,
            }
          : member;
      }),
    );
    persistRoomMap();
  };
  const worker = async () => {
    while (
      next < candidates.length &&
      failures < 8 &&
      useSettingsStore.getState().settings.p48Token === token
    ) {
      const member = candidates[next++];
      const sid = String(servers[member.id]);
      if (!Number.isSafeInteger(Number(sid))) continue;
      try {
        const result = await pocketApi.getSeineServerDetail(Number(sid));
        if (useSettingsStore.getState().settings.p48Token !== token) return;
        const parsed = parseSeineDetail(result?.content || result?.data || {});
        if (
          !/^[1-9]\d*$/.test(parsed.channelId) ||
          (parsed.serverId && parsed.serverId !== sid) ||
          parsed.channelId === parsed.yklzId
        )
          throw new Error('房间映射无效');
        failures = 0;
        const previous = roomMap[String(member.id)];
        const entry: RoomMapEntry = {
          channelId: parsed.channelId,
          yklzId: /^[1-9]\d*$/.test(parsed.yklzId)
            ? parsed.yklzId
            : (previous?.serverId === sid
                ? previous.yklzId
                : member.serverId === sid
                  ? member.yklzId
                  : '') || '',
          serverId: sid,
          updatedAt: Date.now(),
          verifiedAt: Date.now(),
        };
        roomMap[String(member.id)] = entry;
        patches.set(String(member.id), entry);
        changed += 1;
        if (changed % 20 === 0) persistRoomMap();
      } catch {
        failures += 1;
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  };
  await Promise.all([worker(), worker()]);
  flush();
  logInfo(`[roomMap] 启动核验完成：${changed}/${candidates.length}`, 'roomMap');
}

export async function resolveMemberRooms(
  memberId: string,
  opts: {
    name?: string;
    knownChannelId?: string;
    knownYklzId?: string;
    knownServerId?: string;
  } = {},
): Promise<{ channelId: string; yklzId: string; serverId: string; fromCache: boolean }> {
  const id = String(memberId);
  let channelId = opts.knownChannelId || '';
  let yklzId = opts.knownYklzId || '';
  let serverId = opts.knownServerId || '';

  const cached = roomMap[id];
  if (cached) {
    if (!channelId) channelId = cached.channelId || '';
    if (!yklzId) yklzId = cached.yklzId || '';
    if (!serverId) serverId = cached.serverId || '';

    const yklzReady = !!yklzId || (cached.yklzTriedAt || 0) > Date.now() - 24 * 3600 * 1000;
    if (channelId && serverId && yklzReady) return { channelId, yklzId, serverId, fromCache: true };
  }

  if (!channelId || !yklzId || !serverId) {
    const m = useMemberStore.getState().members.find((x) => String(x.id) === id);
    if (m) {
      if (!channelId) channelId = String(m.channelId || '');
      if (!yklzId) yklzId = String(m.yklzId || '');
      if (!serverId) serverId = String(m.serverId || '');
    }
  }
  if (channelId && serverId) {
    const tried = cached?.yklzTriedAt || 0;
    if (yklzId || tried > Date.now() - 24 * 3600 * 1000) {
      roomMap[id] = {
        channelId,
        yklzId,
        serverId,
        updatedAt: Date.now(),
        yklzTriedAt: tried || undefined,
      };
      return { channelId, yklzId, serverId, fromCache: true };
    }
  }

  if (!serverId && !channelId) {
    try {
      const jres: any = await pocketApi.serverJump(Number(id));
      const jc = jres?.content || jres?.data || {};
      const jsid = String(jc?.serverId || '');
      const jcid = String(jc?.channelId || '');
      if (jsid && jsid !== '0') {
        serverId = jsid;
        if (jcid && jcid !== '0') channelId = jcid;
        roomMap[id] = { channelId, yklzId, serverId, updatedAt: Date.now() };
        persistRoomMap();
        logInfo(
          `[roomMap] serverJump 解析 userId=${id} ${opts.name || ''} -> 大=${channelId} 小=${yklzId} srv=${serverId}`,
          'roomMap',
        );
      }
    } catch (_e: any) {}
  }

  if (serverId && (!channelId || !yklzId)) {
    try {
      const res: any = await pocketApi.getSeineServerDetail(Number(serverId));
      const content = res?.content || res?.data || {};
      const parsed = parseSeineDetail(content);
      if (parsed.channelId) {
        channelId = channelId || parsed.channelId;
        if (!yklzId) yklzId = parsed.yklzId;
        if (!serverId) serverId = parsed.serverId || serverId;
      } else {
        const listLen = Array.isArray(content?.channelInfoList)
          ? content.channelInfoList.length
          : -1;
        const keys = content ? Object.keys(content).join(',') : 'EMPTY';
        logWarn(
          `[roomMap] seine 无大房间 userId=${id} ${opts.name || ''} srv=${serverId} listLen=${listLen} keys=${keys} raw=${JSON.stringify(content).slice(0, 300)}`,
          'roomMap',
        );
      }

      roomMap[id] = {
        channelId,
        yklzId,
        serverId,
        updatedAt: Date.now(),
        yklzTriedAt: yklzId ? undefined : Date.now(),
      };
      persistRoomMap();
      if (channelId || yklzId || serverId) {
        useMemberStore.getState().patchMemberByUserId(id, { channelId, yklzId, serverId });
      }
      logInfo(
        `[roomMap] seine 解析 userId=${id} ${opts.name || ''} -> 大=${channelId} 小=${yklzId} srv=${serverId}`,
        'roomMap',
      );
    } catch (e: any) {
      logWarn(`[roomMap] seine 解析失败 userId=${id}：${e?.message || String(e)}`, 'roomMap');
    }
  }
  return { channelId, yklzId, serverId, fromCache: false };
}
