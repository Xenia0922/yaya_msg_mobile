import { normalizeUrl, pickText, unwrapList } from '../../utils/data';
import { formatTimestamp } from '../../utils/format';
import { translate } from '../../i18n';
import type { VODItem } from '../../types';
import pocketApi from '../../api/pocket48';
import { logInfo } from '../../utils/runtimeLog';

export const GRID_COVER_THUMB = 700;

export const PLAY_URL_FIELDS = [
  'playStreamPath',
  'playUrlPath',
  'playPathUrl',
  'streamUrl',
  'streamURL',
  'playUrl',
  'urlPath',
  'playPath',
  'streamPath',
  'path',
  'src',
  'pullStreamPath',
  'liveStreamPath',
  'livePlayStreamPath',
  'streamPathHd',
  'streamPathHigh',
  'streamPathNormal',
  'streamPathOrigin',
  'url',
  'liveUrl',
  'm3u8Url',
  'flvUrl',
  'hlsUrl',
  'videoUrl',
  'recordUrl',
  'mediaUrl',
  'filePath',
  'content.playStreamPath',
  'content.playUrlPath',
  'content.playPathUrl',
  'content.streamUrl',
  'content.playUrl',
  'content.playPath',
  'content.streamPath',
  'content.pullStreamPath',
  'content.liveStreamPath',
  'content.livePlayStreamPath',
  'content.url',
  'data.playStreamPath',
  'data.playUrlPath',
  'data.playPathUrl',
  'data.streamUrl',
  'data.playUrl',
  'data.playPath',
  'data.streamPath',
  'data.pullStreamPath',
  'data.liveStreamPath',
  'data.livePlayStreamPath',
  'data.url',
  'content.playStreams.0.streamPath',
  'data.playStreams.0.streamPath',
];

/**
 * ⚠️ 本文件的 streamScore / liveStreamScore 与统一解析器
 * `src/player/resolve/streamResolver.ts` 的评分表**不一致**（这里 rtmp=20、https-flv=60；
 * 解析器 rtmp=60、flv=70/110），且 MediaScreen 走的是「录播优先」的权重。
 * 因此**暂不合并**：直接换成解析器的评分会改变候选排序 → 可能改变实际选中的线路，
 * 属于必须真机验证的行为变更（见 P1 记录 R-09）。
 * FollowedRoomsScreen 的旧实现与解析器逐字一致，已改为直接复用（零行为变化）。
 */
export function streamScore(url: string): number {
  const lower = url.toLowerCase();
  if (lower.includes('.m3u8') || lower.includes('format=hls')) return 100;
  if (lower.startsWith('https://') && lower.includes('.flv')) return 60;
  if (lower.startsWith('http://') && lower.includes('.flv')) return 50;
  if (lower.startsWith('rtmp://')) return 20;
  return 40;
}

export function liveStreamScore(url: string): number {
  const lower = url.toLowerCase();
  if (lower.startsWith('rtmp://')) return 120;
  if (lower.startsWith('https://') && lower.includes('.flv')) return 105;
  if (lower.startsWith('http://') && lower.includes('.flv')) return 95;
  if (lower.includes('.m3u8') || lower.includes('format=hls')) return 80;
  return streamScore(url);
}

/**
 * 为直播/录播项构造可搜索文本 + 数字串，支持「时间搜索」。
 * 数字串同时给出「补零」与「不补零」两种形态，使 / 0720 / 7-20 / 2026/7/20
 * 等自然输入都能命中，解决原先只能匹配 YYYY-MM-DD HH:mm:ss 单一格式的问题。
 */
export function buildMediaSearchText(item: any): { text: string; digits: string } {
  const ts = formatTimestamp(item.startTime);
  const d = new Date(String(item.startTime || '').replace(/-/g, '/'));
  let padded = '';
  let loose = '';
  if (!Number.isNaN(d.getTime())) {
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    const day = d.getDate();
    const hh = d.getHours();
    const mm = d.getMinutes();
    const ss = d.getSeconds();
    padded = `${y}${String(m).padStart(2, '0')}${String(day).padStart(2, '0')}${String(hh).padStart(2, '0')}${String(mm).padStart(2, '0')}${String(ss).padStart(2, '0')}`;
    loose = `${y}${m}${day}${hh}${mm}${ss}`;
  }
  const text = [item.title, item.nickname, item.liveRoomTitle, String(item.liveId || ''), ts]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  const digits = [ts.replace(/\D/g, ''), padded, loose].filter(Boolean).join('');
  return { text, digits };
}

// 取录制时间的日期键 YYYY-MM-DD，用于日历筛选精确匹配
export function dateKeyOf(startTime: any): string {
  let v: any = startTime;
  if (v === null || v === undefined || v === '') return '';
  // 录播接口 startTime 实际是「字符串形式的毫秒时间戳」（如 "1787214699552"），
  // 直接 new Date("1787214699552") 是 Invalid Date → 解析成秒/毫秒数字再 new Date
  if (typeof v === 'string') {
    const s = v.trim();
    if (/^\d{10}$/.test(s))
      v = Number(s) * 1000; // 10 位秒
    else if (/^\d{13}$/.test(s))
      v = Number(s); // 13 位毫秒
    else v = s.replace(/-/g, '/');
  }
  if (typeof v === 'number' && Number.isFinite(v) && v > 0 && v < 1e10) v *= 1000;
  const d = new Date(v as any);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function pickPlayableUrls(raw: any, preferLive = false): string[] {
  const candidates: string[] = [];
  const direct = normalizeUrl(pickText(raw, PLAY_URL_FIELDS));
  if (direct) candidates.push(direct);
  const streamList = unwrapList(raw, [
    'streams',
    'playStreams',
    'liveStreams',
    'urls',
    'content.streams',
    'content.playStreams',
    'content.urls',
    'data.streams',
    'data.playStreams',
    'content.liveStreams',
    'content.streamList',
    'content.playStreamList',
    'data.liveStreams',
    'data.streamList',
    'data.playStreamList',
    'data.urls',
  ]);
  for (const stream of streamList) {
    const url = normalizeUrl(pickText(stream, PLAY_URL_FIELDS));
    if (url) candidates.push(url);
  }
  const score = preferLive ? liveStreamScore : streamScore;
  return Array.from(new Set(candidates.filter(Boolean))).sort((a, b) => score(b) - score(a));
}

export function pickPlayableUrl(raw: any): string {
  return pickPlayableUrls(raw)[0] || '';
}

/** 官方「分享页」URL（老录播/已结束直播常见）：不是媒体流，需按 id 重新解析 */
export function isSharePageUrl(u: string): boolean {
  return /\.html(\?|$)/i.test(u) || u.includes('h5.48.cn');
}

/** 分享页 URL → 用其中的 id 重新解析真实媒体流；失败返回 error 文案 key */
export async function resolveSharePlayableUrls(
  urls: string[],
  preferLive: boolean,
): Promise<{ urls: string[]; error?: string }> {
  if (!urls.length || !urls.every((u) => isSharePageUrl(String(u)))) return { urls };
  const shareId = /[?&]id=(\d+)/.exec(String(urls[0]))?.[1] || '';
  try {
    logInfo(
      `[player] share page detected id=${shareId} url=${String(urls[0]).slice(0, 120)}`,
      'player.core',
    );
  } catch {}
  if (!shareId) return { urls: [], error: '该录播暂时无法播放' };
  // 官方公开接口（token 可选）直接取 playStreamPath —— 分享页自身就是这么取的；
  // 统一走 pocketApi（含 UA/签名/错误语义），不再在 UI 层按原样裸 fetch。
  try {
    const json: any = await pocketApi.getLiveOne(shareId);
    const directUrl =
      json?.content?.playStreamPath || json?.content?.playUrl || json?.data?.playStreamPath || '';
    if (directUrl) {
      try {
        logInfo(
          `[player] share page resolved id=${shareId} url=${String(directUrl).slice(0, 120)}`,
          'player.core',
        );
      } catch {}
      return { urls: [String(directUrl)] };
    }
  } catch (e: any) {
    try {
      logInfo(`[player] share page direct fetch failed: ${e?.message || String(e)}`, 'player.core');
    } catch {}
  }
  const byOpen = await pocketApi.getOpenLiveOne(shareId).catch(() => null);
  let resolved = pickPlayableUrls(byOpen, preferLive);
  if (!resolved.length) {
    const byLive = await pocketApi.getLiveOne(shareId).catch(() => null);
    resolved = pickPlayableUrls(byLive, preferLive);
  }
  return resolved.length ? { urls: resolved } : { urls: [], error: '该录播暂时无法播放' };
}

export function normalizeLiveList(res: any): VODItem[] {
  const source = unwrapList(res, [
    'content.liveList',
    'content.list',
    'content.data',
    'content.records',
    'data.liveList',
    'liveList',
    'list',
    'data',
  ]);

  return source.map((raw: any, index: number) => ({
    ...raw,
    liveId: String(pickText(raw, ['liveId', 'id', 'live_id', 'roomId'], String(index))),
    title: pickText(
      raw,
      ['title', 'liveTitle', 'liveRoomTitle', 'roomName', 'subject'],
      translate('无标题'),
    ),
    liveRoomTitle: pickText(raw, ['liveRoomTitle', 'title', 'liveTitle']),
    nickname: pickText(raw, [
      'nickname',
      'nickName',
      'userInfo.nickname',
      'userInfo.nickName',
      'ownerName',
    ]),
    startTime:
      raw.startTime ||
      raw.stime ||
      raw.start_time ||
      raw.ctime ||
      raw.liveStartTime ||
      raw.beginTime,
    endTime: raw.endTime || raw.etime || raw.end_time || raw.liveEndTime,
    liveCover: normalizeUrl(
      pickText(raw, [
        'liveCover',
        'coverPath',
        'cover',
        'coverUrl',
        'picPath',
        'picturePath',
        'imageUrl',
        'poster',
        'thumb',
        'userInfo.avatar',
      ]),
    ),
    coverPath: normalizeUrl(pickText(raw, ['coverPath', 'cover', 'coverUrl'])),
    playUrl: pickPlayableUrl(raw),
    playPath: normalizeUrl(pickText(raw, ['playPath', 'playUrl', 'url'])),
    liveType: Number(pickText(raw, ['liveType', 'type', 'mediaType'], '1')),
    screenDirection: Number(pickText(raw, ['screenDirection', 'orientation'], '0')),
  })) as VODItem[];
}

/** 按 liveId 在直播/录播列表（首屏）中查找条目，作为详情接口解析失败的兜底 */
export async function findLiveItemInLists(liveId: string, record: boolean) {
  const calls: Promise<any>[] = [
    pocketApi.getLiveList({ record, debug: true, next: 0, size: 100 }),
    pocketApi.getOpenLivePublicList({ record, next: 0 }),
  ];
  for (const p of calls) {
    try {
      const res = await p;
      const list = unwrapList(res, [
        'content.liveList',
        'content.list',
        'data.liveList',
        'liveList',
        'list',
        'data',
      ]);
      const found = list.find(
        (it: any) => String(it.liveId || it.id || it.live_id || '') === String(liveId),
      );
      if (found) return found;
    } catch {
      /* 尝试下一个源 */
    }
  }
  return null;
}

export function mergeUniqueLiveItems(prev: VODItem[], next: VODItem[]) {
  const seen = new Set(
    prev.map((item: any, index) => String(item.liveId || item.id || item.title || index)),
  );
  const merged = [...prev];
  for (const item of next as any[]) {
    const key = String(item.liveId || item.id || item.title || merged.length);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  return merged;
}

export function normalizeLiveRank(res: any): any[] {
  let list = unwrapList(res, [
    'content.rankList',
    'content.userRankList',
    'content.userRankingList',
    'content.contributionList',
    'content.list',
    'content.data',
    'content.data.list',
    'content.data.rankList',
    'data.rankList',
    'data.userRankList',
    'data.userRankingList',
    'data.contributionList',
    'data.list',
    'rankList',
    'userRankList',
    'userRankingList',
    'contributionList',
    'list',
  ]);
  if (!list.length) {
    const content = res?.content || res?.data || res;
    if (content && typeof content === 'object') {
      const found: any[] = [];
      const walk = (node: any, depth = 0) => {
        if (!node || depth > 5) return;
        if (Array.isArray(node)) {
          node.forEach((item) => walk(item, depth + 1));
          return;
        }
        if (typeof node !== 'object') return;
        const hasUser = pickText(node, [
          'nickName',
          'nickname',
          'userName',
          'name',
          'userInfo.nickname',
          'userInfo.nickName',
          'user.nickname',
          'user.nickName',
        ]);
        const hasValue = pickText(node, [
          'score',
          'total',
          'cost',
          'money',
          'giftValue',
          'value',
          'amount',
          'contribution',
          'count',
          'giftNum',
        ]);
        if (hasUser || hasValue || node.userInfo || node.user) found.push(node);
        Object.values(node).forEach((value) => walk(value, depth + 1));
      };
      walk(content);
      list = found;
    }
  }
  return list.map((item: any, index: number) => ({
    ...item,
    userId: pickText(item, [
      'userId',
      'uid',
      'id',
      'account',
      'userInfo.userId',
      'userInfo.id',
      'user.userId',
      'user.id',
      'user.userIdStr',
      'user.userAccount',
      'memberInfo.userId',
      'memberInfo.id',
    ]),
    rank: Number(item.rank || item.no || item.index || index + 1),
    name: pickText(
      item,
      [
        'nickName',
        'nickname',
        'userName',
        'name',
        'senderName',
        'userInfo.nickName',
        'userInfo.nickname',
        'userInfo.name',
        'user.nickName',
        'user.nickname',
        'user.userName',
        'user.name',
        'memberInfo.nickName',
        'memberInfo.nickname',
      ],
      '\u7528\u6237 ' + (index + 1),
    ),
    avatar: normalizeUrl(
      pickText(item, [
        'avatar',
        'headImg',
        'picPath',
        'userInfo.avatar',
        'userInfo.headImg',
        'user.avatar',
        'user.headImg',
        'user.userAvatar',
        'memberInfo.avatar',
      ]),
    ),
    value: pickText(
      item,
      [
        'score',
        'total',
        'cost',
        'money',
        'giftValue',
        'value',
        'amount',
        'contribution',
        'count',
        'giftNum',
      ],
      '',
    ),
  }));
}

export function rankNameIsFallback(row: any, index: number) {
  const name = String(row.name || '').trim();
  const fallbackPrefix = '\u7528\u6237';
  return (
    !name ||
    name === `${fallbackPrefix} ${index + 1}` ||
    new RegExp(`^${fallbackPrefix}\\s*\\d+$`).test(name)
  );
}
export function profileFromUserRes(res: any) {
  const info =
    res?.content?.userInfo ||
    res?.content?.user ||
    res?.content ||
    res?.data?.userInfo ||
    res?.data?.user ||
    res?.data ||
    res ||
    {};
  return {
    name: pickText(info, [
      'nickName',
      'nickname',
      'userName',
      'name',
      'profile.nickName',
      'profile.nickname',
      'userInfo.nickName',
      'userInfo.nickname',
      'user.nickName',
      'user.nickname',
      'user.userName',
    ]),
    avatar: normalizeUrl(
      pickText(info, [
        'avatar',
        'headImg',
        'headUrl',
        'picPath',
        'profile.avatar',
        'profile.headImg',
        'userInfo.avatar',
        'userInfo.headImg',
        'user.avatar',
        'user.headImg',
        'user.userAvatar',
      ]),
    ),
  };
}

export function giftName(gift: any): string {
  return String(gift.giftName || gift.name || translate('未知礼物'));
}

export function giftCost(gift: any): number {
  return Number(gift.money ?? gift.cost ?? gift.canSendNum ?? 0) || 0;
}

export function giftImage(gift: any): string {
  return normalizeUrl(gift.picPath || gift.icon || gift.giftPic || gift.url || '');
}

export function acceptUserId(item: any): string {
  return String(
    item?.userInfo?.userId ||
      item?.user?.userId ||
      item?.userId ||
      item?.ownerId ||
      item?.memberId ||
      '',
  );
}
