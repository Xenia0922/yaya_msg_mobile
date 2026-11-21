import AsyncStorage from '@react-native-async-storage/async-storage';
import { parseMaybeJson } from '../utils/data';
import { loadMembers, normalizeMember, appendOfficialGroupMembers } from '../utils/members';
import { Member } from '../types';
import { useMemberStore } from '../store';
import { MEMBERS_URL, MEMBERS_URL_SELF_LIST } from '../constants';
import { fetchWithTimeout } from '../utils/network';
import pocketApi from '../api/pocket48';
import { logInfo, logWarn } from '../utils/runtimeLog';
import { hydrateRoomMap, seedRoomMapFromMembers, getRoomMapEntry } from './roomMapCache';

const CACHE_KEY = 'yaya_member_data_cache_v7';

const OLD_CACHE_KEYS = [
  'yaya_member_data_cache_v1',
  'yaya_member_data_cache_v2',
  'yaya_member_data_cache_v3',
  'yaya_member_data_cache_v4',
  'yaya_member_data_cache_v5',
  'yaya_member_data_cache_v6',
];

const MEMBER_CACHE_TTL = 10 * 60 * 1000;

const BACKUP_KEY = 'yaya_member_data_cache_bak';

function countMapping(list: Member[]): { channel: number; yklz: number; server: number } {
  let channel = 0,
    yklz = 0,
    server = 0;
  for (const m of list) {
    if (m.channelId && m.channelId !== '0') channel += 1;
    if (m.yklzId && m.yklzId !== '0') yklz += 1;
    if (m.serverId && m.serverId !== '0') server += 1;
  }
  return { channel, yklz, server };
}

export async function restoreMemberDataFromBackup(): Promise<{ restored: boolean; count: number }> {
  try {
    const raw = await AsyncStorage.getItem(BACKUP_KEY);
    if (!raw) return { restored: false, count: 0 };
    const parsed = JSON.parse(raw);
    const members = await loadMembers(parsed?.members);
    if (!members.length) return { restored: false, count: 0 };
    await AsyncStorage.setItem(CACHE_KEY, raw);
    useMemberStore.getState().setMembers(members);
    logInfo(`[memberData] 已从备份恢复成员库 ${members.length} 位`, 'memberData');
    return { restored: true, count: members.length };
  } catch {
    return { restored: false, count: 0 };
  }
}

export interface MemberDataMeta {
  savedAt: number;
  signature: string;
  count: number;
  source: 'bundle' | 'remote' | 'official' | 'cache';
  sourceUpdatedAt?: number;
}

export async function loadCachedMemberData(): Promise<Member[] | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const members = await loadMembers(parsed.members);
    if (!members.length) return null;
    return members;
  } catch {
    return null;
  }
}

export async function getMemberDataMeta(): Promise<MemberDataMeta | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return {
      savedAt: parsed.savedAt || 0,
      signature: parsed.signature || '',
      count: parsed.count || 0,
      source: parsed.source || 'cache',
      sourceUpdatedAt: typeof parsed.sourceUpdatedAt === 'number' ? parsed.sourceUpdatedAt : 0,
    };
  } catch {
    return null;
  }
}

export interface MemberUpdateResult {
  updated: boolean;
  count: number;
  message: string;
  source: 'official' | 'none';

  detail: string;
}

function sampleKeys(list: any[], label: string) {
  const first = list.find((i: any) => i && typeof i === 'object');
  if (!first) return;
  const keys = Object.keys(first);
  logInfo(
    `[memberData] ${label} 成功：数量=${list.length} 字段数=${keys.length} 样例字段=${keys.slice(0, 40).join(',')}`,
    'memberData',
  );
  logInfo(
    `[memberData] ${label} 首条=${JSON.stringify({
      id: first.id ?? first.memberId ?? first.userId ?? first.starId,
      ownerName:
        first.ownerName ?? first.starName ?? first.name ?? first.realName ?? first.nickname,
      channelId: first.channelId ?? first.roomId,
      serverId: first.serverId ?? first.serverID,
      yklzId: first.yklzId ?? first.smallRoomId,
      team: first.team ?? first.teamName,
      groupName: first.groupName,
      pinyin: first.pinyin,
    })}`,
    'memberData',
  );
}

async function fetchYk1zDb(): Promise<{ members: Member[]; updatedAt: number }> {
  const sources = [MEMBERS_URL, ...MEMBERS_URL_SELF_LIST].filter(Boolean);
  const previousUpdatedAt = (await getMemberDataMeta())?.sourceUpdatedAt || 0;
  let lastErr: any = null;
  for (const url of sources) {
    const isMirror = MEMBERS_URL_SELF_LIST.includes(url);
    try {
      const res = await fetchWithTimeout(
        `${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`,
        {
          method: 'GET',
          headers: { Accept: 'application/json' },
        },
        isMirror ? 12000 : 7000,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = parseMaybeJson(await res.text());
      const parsedTime = isMirror ? Date.parse(String(json?.updatedAt || '')) : NaN;
      const updatedAt =
        Number.isFinite(parsedTime) && parsedTime <= Date.now() + 86400000 ? parsedTime : 0;

      if (previousUpdatedAt && updatedAt > 0 && updatedAt < previousUpdatedAt) {
        throw new Error('成员库版本早于本地缓存');
      }
      const arr = Array.isArray(json)
        ? json
        : json.roomId || json.data || json.members || json.list || [];
      const members = await loadMembers(arr);
      if (!members.length) throw new Error('成员库返回为空');
      const rawById = new Map<string, any>();
      for (const x of arr) rawById.set(String(x?.id ?? x?.memberId ?? x?.userId), x);
      for (const m of members) {
        const raw = rawById.get(String(m.id));
        if (raw && !raw.channelId) m.channelId = '';
      }
      logInfo(
        `[memberData] 成员库拉取成功：${members.length} 位（源 ${MEMBERS_URL_SELF_LIST.includes(url) ? '自建镜像' : '上游 yk1z'} · ${url.split('/')[2]}）`,
        'memberData',
      );
      return { members, updatedAt };
    } catch (e: any) {
      lastErr = e;

      logInfo(`[memberData] 成员库源失败（${url}）：${e?.message || String(e)}`, 'memberData');
    }
  }
  logWarn('[memberData] 所有成员库源均失败，回退本地缓存', 'memberData');
  throw lastErr || new Error('成员库拉取失败');
}

let lastDbSourceOk = true;
let lastDbSourceUpdatedAt = 0;

export async function fetchOfficialMembers(): Promise<Member[]> {
  const [dbSettled, catalogSettled, mapSettled] = await Promise.allSettled([
    fetchYk1zDb(),
    pocketApi.getGroupTeamStar(),
    pocketApi.getStarServerMap(),
  ]);
  lastDbSourceOk = dbSettled.status === 'fulfilled';
  lastDbSourceUpdatedAt = dbSettled.status === 'fulfilled' ? dbSettled.value.updatedAt : 0;

  let dbMembers: Member[] = dbSettled.status === 'fulfilled' ? dbSettled.value.members : [];
  if (!dbMembers.length) {
    const cached = await loadCachedMemberData().catch(() => null);
    if (cached?.length) {
      dbMembers = cached;
      logInfo(`[memberData] 使用本地缓存成员库 ${cached.length} 位（远端不可达）`, 'memberData');
    }
  }
  if (dbSettled.status === 'rejected') {
    logWarn(
      `[memberData] yk1z 成员库拉取失败（房间映射缺失，大小房间可能不可用）：${dbSettled.reason?.message || String(dbSettled.reason)}`,
      'memberData',
    );
  } else {
    logInfo(`[memberData] yk1z 成员库：${dbMembers.length} 位（成员库底座）`, 'memberData');
  }

  let catalogRes: any = null;
  if (catalogSettled.status === 'fulfilled') {
    catalogRes = catalogSettled.value;
    logInfo(
      `[memberData] getGroupTeamStar 请求成功 status=${catalogRes?.status ?? '?'} success=${catalogRes?.success ?? '?'} code=${catalogRes?.code ?? '?'}`,
      'memberData',
    );
  } else {
    logWarn(
      `[memberData] getGroupTeamStar 失败（降级为仅 yk1z 库）：${catalogSettled.reason?.message || String(catalogSettled.reason)}`,
      'memberData',
    );
  }
  const content = catalogRes?.content || catalogRes?.data || {};
  const starInfo = Array.isArray(content.starInfo) ? content.starInfo : [];
  const officialInfo = content.officialInfo;

  const officialTeamLogoById = new Map<string, string>();
  const officialTeamLogoByName = new Map<string, string>();
  for (const list of [content.teamInfo, content.teamList, content.teams]) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      const logo = String(item?.teamLogo || item?.teamLogoUrl || item?.logo || '').trim();
      if (!logo) continue;
      const tid = String(item?.teamId ?? item?.id ?? '').trim();
      const tname = String(item?.teamName || item?.name || '')
        .trim()
        .toUpperCase();
      if (tid && !officialTeamLogoById.has(tid)) officialTeamLogoById.set(tid, logo);
      if (tname && !officialTeamLogoByName.has(tname)) officialTeamLogoByName.set(tname, logo);
    }
  }
  logInfo(
    `[memberData] group_team_star keys=${Object.keys(content).join(',')} starInfo=${starInfo.length} officialInfo=${Array.isArray(officialInfo) ? officialInfo.length : '?'}`,
    'memberData',
  );
  if (starInfo.length) sampleKeys(starInfo, 'group_team_star starInfo');

  const userServerMap = new Map<string, string>();
  if (mapSettled.status === 'fulfilled') {
    const mapRes = mapSettled.value;
    const cont = mapRes?.content || mapRes?.data || {};
    logInfo(
      `[memberData] getStarServerMap 成功 status=${mapRes?.status ?? '?'} content keys=${Object.keys(cont).join(',')}`,
      'memberData',
    );
    if (cont.userServerMap && typeof cont.userServerMap === 'object') {
      for (const [k, v] of Object.entries(cont.userServerMap)) {
        if (k && v && k !== '0' && String(v) !== '0') userServerMap.set(String(k), String(v));
      }
      logInfo(
        `[memberData] userServerMap 字典解析：userId->serverId ${userServerMap.size} 条`,
        'memberData',
      );
    } else {
      logInfo(
        `[memberData] getStarServerMap 原始样例=${JSON.stringify(cont).slice(0, 500)}`,
        'memberData',
      );
    }
  } else {
    logWarn(
      `[memberData] getStarServerMap 失败（不阻断）：${mapSettled.reason?.message || String(mapSettled.reason)}`,
      'memberData',
    );
  }

  let members: Member[] = [];
  if (dbMembers.length) {
    const officialById = new Map<string, any>();
    for (const raw of starInfo)
      officialById.set(String(raw?.userId ?? raw?.id ?? raw?.starId), raw);
    members = dbMembers.map((db) => {
      const off = officialById.get(String(db.id));
      if (!off) return db;
      const m: any = { ...db };

      if (!m.avatar) m.avatar = String(off.avatar || '');
      if (!m.pinyin) m.pinyin = String(off.pinyin || '');
      if (!m.groupName) m.groupName = String(off.groupName || '');
      if (!m.team) m.team = String(off.teamName || '');
      if (!m.teamId) m.teamId = String(off.teamId || '');

      const ykTeamId = String(m.teamId || off.teamId || '').trim();
      const ykTeamKey = String(m.team || off.teamName || '')
        .trim()
        .toUpperCase();
      const dynamicTeamLogo =
        (ykTeamId ? officialTeamLogoById.get(ykTeamId) : '') ||
        (ykTeamKey ? officialTeamLogoByName.get(ykTeamKey) : '') ||
        String(off.teamLogo || off.teamLogoUrl || '').trim();
      if (dynamicTeamLogo) m.teamLogo = dynamicTeamLogo;
      if (!m.liveRoomId) m.liveRoomId = String(off.liveRoomId || '');
      if (!m.periodName) m.periodName = off.periodName ? String(off.periodName) : m.periodName;
      if (!m.fullPhoto1) m.fullPhoto1 = off.fullPhoto1 ? String(off.fullPhoto1) : m.fullPhoto1;
      if (!m.fullPhoto2) m.fullPhoto2 = off.fullPhoto2 ? String(off.fullPhoto2) : m.fullPhoto2;
      if (!m.fullPhoto3) m.fullPhoto3 = off.fullPhoto3 ? String(off.fullPhoto3) : m.fullPhoto3;
      if (!m.fullPhoto4) m.fullPhoto4 = off.fullPhoto4 ? String(off.fullPhoto4) : m.fullPhoto4;
      if (!m.wbName) m.wbName = off.wbName ? String(off.wbName) : m.wbName;
      if (!m.wbUid) m.wbUid = off.wbUid ? String(off.wbUid) : m.wbUid;
      if (!m.birthday) m.birthday = off.birthday ? String(off.birthday) : m.birthday;

      const profileDetailFields = [
        'birthplace',
        'constellation',
        'height',
        'bloodType',
        'hobbies',
        'specialty',
        'joinTime',
        'jtime',
        'ptime',
        'promotionTime',
        'gtime',
        'graduateTime',
        'qtime',
        'quitTime',
        'rank',
        'note',
      ] as const;
      for (const key of profileDetailFields) {
        const current = (m as any)[key];
        const incoming = (off as any)[key];
        if (
          (current === undefined || current === null || String(current).trim() === '') &&
          incoming !== undefined &&
          incoming !== null &&
          String(incoming).trim() !== ''
        ) {
          (m as any)[key] = typeof incoming === 'number' ? incoming : String(incoming);
        }
      }

      return m;
    });
    const before = members.length;
    members = appendOfficialGroupMembers(members, starInfo);
    logInfo(
      `[memberData] 双源合并完成：${members.length} 位（新增官方成员 ${members.length - before} 位）`,
      'memberData',
    );
  } else {
    members = starInfo
      .map((raw: any) => normalizeMember(raw))
      .filter((m: Member) => m.id && m.ownerName);
    logWarn(`[memberData] yk1z 库不可用，退化为官方目录 ${members.length} 位`, 'memberData');
  }

  if (userServerMap.size) {
    let patched = 0;
    for (const m of members) {
      if (!m.serverId || m.serverId === '0') {
        const sid = userServerMap.get(String(m.id));
        if (sid) {
          m.serverId = sid;
          patched += 1;
        }
      }
    }
    logInfo(`[memberData] userServerMap 补齐 serverId：${patched} 位`, 'memberData');
  }

  try {
    const followedRes = await pocketApi.getFollowedIds();
    const followedContent = followedRes?.content || followedRes?.data || {};
    let idsArr: string[] = [];
    for (const key of ['data', 'list', 'friends', 'ids']) {
      if (Array.isArray(followedContent[key])) {
        idsArr = followedContent[key].map(String);
        break;
      }
    }
    if (!idsArr.length && Array.isArray(followedRes)) idsArr = followedRes.map(String);
    logInfo(
      `[memberData] 关注成员 ${idsArr.length} 位，尝试用最新消息反推 channelId`,
      'memberData',
    );
    if (idsArr.length) {
      const serverIds = idsArr
        .map((id: string) => {
          const sid = userServerMap.get(id);
          if (sid) return Number(sid);
          const m = members.find((mm) => String(mm.id) === id);
          return m?.serverId ? Number(m.serverId) : 0;
        })
        .filter((n: number) => n > 0);
      const BATCH = 50;
      const serverToChannel = new Map<string, string>();

      const yklzIds = new Set(
        members.map((m) => String(m.yklzId || '')).filter((v) => v && v !== '0'),
      );
      for (let i = 0; i < serverIds.length; i += BATCH) {
        const batch = Array.from(new Set(serverIds.slice(i, i + BATCH)));
        if (!batch.length) continue;
        const lastRes = await pocketApi.getLastMessages(batch);
        const lastList = Array.isArray(lastRes?.content?.lastMsgList)
          ? lastRes.content.lastMsgList
          : [];
        if (i === 0)
          logInfo(`[memberData] lastMessage 首批返回 ${lastList.length} 条`, 'memberData');
        for (const msg of lastList) {
          const sid = String(msg?.serverId || '');
          const cid = String(msg?.channelId || '');
          if (!sid || !cid || sid === '0' || cid === '0') continue;
          if (yklzIds.has(cid)) continue;
          if (!serverToChannel.has(sid)) serverToChannel.set(sid, cid);
        }
      }
      if (serverToChannel.size) {
        let patched = 0;
        for (const m of members) {
          if ((!m.channelId || m.channelId === '0') && m.serverId) {
            const cid = serverToChannel.get(String(m.serverId));
            if (cid) {
              m.channelId = cid;
              patched += 1;
            }
          }
        }
        logInfo(`[memberData] lastMessage 反推 channelId：${patched} 位`, 'memberData');
      }
    }
  } catch (e: any) {
    logWarn(
      `[memberData] 关注 members/反推 channelId 失败（不阻断）：${e?.message || String(e)}`,
      'memberData',
    );
  }

  const withServer = members.filter((m) => m.serverId && m.serverId !== '0').length;
  const withChannel = members.filter((m) => m.channelId && m.channelId !== '0').length;
  const withYklz = members.filter((m) => m.yklzId && m.yklzId !== '0').length;
  logInfo(
    `[memberData] 目录规范化后：${members.length} 位，serverId 覆盖 ${withServer} / channelId ${withChannel} / yklzId ${withYklz}`,
    'memberData',
  );

  const stateCounts: Record<string, number> = {};
  for (const m of members) {
    const s = m.state || 'unknown';
    stateCounts[s] = (stateCounts[s] || 0) + 1;
  }
  logInfo(
    `[memberData] 状态分类：${Object.entries(stateCounts)
      .map(([k, v]) => `${k}=${v}`)
      .join(' / ')}`,
    'memberData',
  );

  const idftOfficial = new Map<string, any>();
  for (const raw of starInfo) idftOfficial.set(String(raw?.userId ?? raw?.id ?? raw?.starId), raw);
  const idft = members.filter((m) =>
    String(idftOfficial.get(String(m.id))?.teamName || '').includes('IDFT'),
  );
  if (idft.length) {
    const activeIdft = idft.filter((m) => m.state === 'active');
    logInfo(
      `[memberData] 官方 IDFT 标的 ${idft.length} 位，其中库判在团 ${activeIdft.length} 位：${activeIdft.map((m) => `${m.ownerName}(id=${m.id})`).join(' ')}${activeIdft.length ? '' : '（无）'}`,
      'memberData',
    );
  }

  try {
    await hydrateRoomMap();
    seedRoomMapFromMembers(members);
  } catch (e: any) {
    logWarn(`[memberData] 房间映射缓存预热失败：${e?.message || String(e)}`, 'memberData');
  }
  return members;
}

async function persist(
  members: Member[],
  source: MemberDataMeta['source'],
  sourceUpdatedAt: number,
) {
  await AsyncStorage.setItem(
    CACHE_KEY,
    JSON.stringify({
      members,
      signature: '',
      savedAt: Date.now(),
      count: members.length,
      source,
      sourceUpdatedAt,
    }),
  );
}

async function runMemberDataUpdate(): Promise<MemberUpdateResult> {
  const members = await fetchOfficialMembers();

  let prev: Member[] = [];
  try {
    prev = (await loadCachedMemberData()) ?? [];
  } catch {}

  if (!lastDbSourceOk && prev.length) {
    logWarn(
      `[memberData] yk1z 成员库不可用 → 拒绝退化为「无房间映射」的官方目录（900 位），保留本地 ${prev.length} 位`,
      'memberData',
    );
    return {
      updated: false,
      count: prev.length,
      message: '成员库源暂不可用，已保留本地数据',
      source: 'none',
      detail: `yk1z 库不可用（已跳过官方目录退化）｜本地 ${prev.length} 位`,
    };
  }

  if (!members.length) throw new Error('成员数据为空');

  if (prev.length) {
    const prevById = new Map(prev.map((m) => [String(m.id), m]));
    let filled = 0;
    for (const m of members) {
      const p = prevById.get(String(m.id));
      if (!p) continue;
      if (!m.channelId && p.channelId) {
        m.channelId = p.channelId;
        filled += 1;
      }
      if (!m.yklzId && p.yklzId) {
        m.yklzId = p.yklzId;
        filled += 1;
      }
      if (!m.serverId && p.serverId) {
        m.serverId = p.serverId;
        filled += 1;
      }
      if (!m.avatar && p.avatar) m.avatar = p.avatar;
      if (!m.pinyin && p.pinyin) m.pinyin = p.pinyin;
      if (!m.team && p.team) m.team = p.team;
    }
    const nowC = countMapping(members);
    const prevC = countMapping(prev);
    const tooFew = members.length < prev.length * 0.6;
    const mapLost = prevC.channel > 0 && nowC.channel < prevC.channel * 0.7;
    if (filled) logInfo(`[memberData] 护栏：用本地旧值回填映射字段 ${filled} 处`, 'memberData');
    if (tooFew || mapLost) {
      const detail = `云端 ${members.length} 位/大房间 ${nowC.channel}/小房间 ${nowC.yklz} ｜ 本地 ${prev.length} 位/大房间 ${prevC.channel}/小房间 ${prevC.yklz}（已拒绝覆盖）`;
      logWarn(`[memberData] 数据劣化，拒绝覆盖本地缓存：${detail}`, 'memberData');
      return {
        updated: false,
        count: prev.length,
        message: '数据源返回异常，已保留本地数据',
        source: 'none',
        detail,
      };
    }
    try {
      const raw = await AsyncStorage.getItem(CACHE_KEY);
      if (raw) await AsyncStorage.setItem(BACKUP_KEY, raw);
    } catch {}
  }

  const withServer = members.filter((m) => m.serverId && m.serverId !== '0').length;
  const withChannel = members.filter((m) => m.channelId && m.channelId !== '0').length;
  const withYklz = members.filter((m) => m.yklzId && m.yklzId !== '0').length;

  try {
    await hydrateRoomMap();
    let overlayPatched = 0;
    for (const m of members) {
      const e = getRoomMapEntry(String(m.id));
      if (!e) continue;
      if (e.verifiedAt && e.channelId && e.serverId) {
        m.channelId = e.channelId;
        m.serverId = e.serverId;
        if (e.yklzId) m.yklzId = e.yklzId;
        overlayPatched += 1;
        continue;
      }
      if (!m.channelId && e.channelId) {
        m.channelId = e.channelId;
        overlayPatched += 1;
      }
      if (!m.yklzId && e.yklzId) {
        m.yklzId = e.yklzId;
        overlayPatched += 1;
      }
      if (!m.serverId && e.serverId) {
        m.serverId = e.serverId;
        overlayPatched += 1;
      }
    }
    if (overlayPatched)
      logInfo(`[memberData] 本地 overlay 固化房间映射 ${overlayPatched} 处`, 'memberData');
    seedRoomMapFromMembers(members);
  } catch {}

  await persist(members, 'official', lastDbSourceUpdatedAt);

  try {
    await AsyncStorage.multiRemove(OLD_CACHE_KEYS);
  } catch {}
  useMemberStore.getState().setMembers(members);
  const detail = `成员 ${members.length} · serverId ${withServer} · channelId ${withChannel} · yklzId ${withYklz}（yk1z 库+官方双源）`;
  logInfo(`[memberData] 已载入成员库 ${members.length} 位（${detail}）`, 'memberData');
  return {
    updated: true,
    count: members.length,
    message: `已载入成员库 ${members.length} 位`,
    source: 'official',
    detail,
  };
}

let memberUpdateInFlight: Promise<MemberUpdateResult> | null = null;
let memberUpdateGeneration = 0;

export function updateMemberData(): Promise<MemberUpdateResult> {
  if (!memberUpdateInFlight) {
    memberUpdateGeneration += 1;
    memberUpdateInFlight = runMemberDataUpdate().finally(() => {
      memberUpdateInFlight = null;
    });
  }
  return memberUpdateInFlight;
}

export async function ensureMemberData(): Promise<void> {
  const generation = memberUpdateGeneration;

  const currentMembers = (useMemberStore.getState() as { members?: unknown[] }).members;
  const alreadyHydrated = Array.isArray(currentMembers) && currentMembers.length > 0;
  if (alreadyHydrated) {
    logInfo('[memberData] 启动阶段已载入成员库，跳过重复缓存解析', 'memberData');
  } else {
    try {
      const cached = await loadCachedMemberData();
      if (
        cached &&
        cached.length &&
        generation === memberUpdateGeneration &&
        !memberUpdateInFlight
      ) {
        useMemberStore.getState().setMembers(cached);
        logInfo(`[memberData] 启动先用本地缓存展示 ${cached.length} 位`, 'memberData');
      } else {
        logInfo('[memberData] 无本地缓存，直接双源拉取（yk1z 库+官方）', 'memberData');
      }
    } catch {
      logWarn('[memberData] 读取本地缓存失败', 'memberData');
    }
  }

  let fresh = false;
  try {
    const meta = await getMemberDataMeta();
    fresh = !!(
      meta &&
      meta.savedAt &&
      meta.count > 0 &&
      Date.now() - meta.savedAt < MEMBER_CACHE_TTL
    );
    if (fresh) {
      const mins = Math.round((Date.now() - (meta?.savedAt || 0)) / 60000);
      logInfo(
        `[memberData] 缓存 ${mins} 分钟前更新（TTL ${MEMBER_CACHE_TTL / 60000}min），后台静默刷新`,
        'memberData',
      );
    }
  } catch {}

  if (fresh) {
    void updateMemberData().catch((e: any) =>
      logWarn(
        `[memberData] 后台静默刷新失败（保留缓存展示）：${e?.message || String(e)}`,
        'memberData',
      ),
    );
    return;
  }

  try {
    await updateMemberData();
  } catch (e: any) {
    logWarn(`[memberData] 双源同步失败（保留缓存展示）：${e?.message || String(e)}`, 'memberData');
  }
}
