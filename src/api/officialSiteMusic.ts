// 官方音乐库（口袋48官网源）
// 源数据来自 yk1z/yaya_msg 电脑版（github.com/yk1z/yaya_msg）的 official-site-music-feature，
// 一次性全量、无 token。关键修正（之前"全显示热恋专属"的根因）：
//   - ix_mp3list_xxx 每首只有 mp3/artist/title，且 artist 字段其实是「专辑名」（全都写成"热恋专属 Love Ver."），
//     所以不能直接拿 artist 当专辑/歌手。
//   - 真实专辑名来自两条路径：
//       (a) SNH 用 mp3 文件名前缀 → 专辑名 的硬编码映射（SNH_ALBUM_BY_AUDIO_GROUP）；
//       (b) GNZ 用 歌名 → 专辑名 的硬编码映射（GNZ_ALBUM_BY_TITLE）；
//       (c) 兜底：同一音频分组（mp3 前缀）里第一首歌的标题当作专辑名，再去 records 里模糊匹配。
//   - 真实封面与演唱者（team）来自 records_xxx：按专辑名匹配到 record，record.image 是封面、
//     record.team 是演唱者（SNH48 / 袁一琦 / 7SENSES / 鞠婧祎 …）。
// 这样列表/详情里专辑与歌手就都正确且各不相同，封面也变成真实专辑封面。
import AsyncStorage from '@react-native-async-storage/async-storage';

const OFFICIAL_SITE_ORIGIN = 'https://www.snh48.com';
const SCRIPT_BASE = `${OFFICIAL_SITE_ORIGIN}/js`;

export interface OfficialSiteTrack {
  id: string;
  musicId?: string;
  sourceIndex: number;
  groupKey: string;
  audioGroupKey: string;
  groupLabel: string;
  title: string;
  /** 真实演唱者（record.team），如 SNH48 / 袁一琦 / 7SENSES / 鞠婧祎 */
  artist: string;
  /** 真实专辑名 */
  album: string;
  albumName?: string;
  /** 演唱者（与 artist 一致，供详情/队列副标题使用） */
  joinMemberNames?: string;
  subTitle?: string;
  mp3: string;
  coverUrl: string;
  recordUrl: string;
  duration: number;
}

const GROUPS = [
  { key: 'SNH', label: 'SNH48', script: 'json_data_snh.js', listVar: 'ix_mp3list_snh', recordsVar: 'records_snh', songsVar: 'ix_songs_snh' },
  { key: 'GNZ', label: 'GNZ48', script: 'json_data_gnz.js', listVar: 'ix_mp3list_gnz', recordsVar: 'records_gnz', songsVar: 'ix_songs_gnz' },
  { key: 'BEJ', label: 'BEJ48', script: 'json_data_bej.js', listVar: 'ix_mp3list_bej', recordsVar: 'records_bej', songsVar: 'ix_songs_bej' },
  { key: 'CKG', label: 'CKG48', script: 'json_data_ckg.js', listVar: 'ix_mp3list_ckg', recordsVar: 'records_ckg', songsVar: 'ix_songs_ckg' },
  { key: 'CGT', label: 'CGT48', script: 'json_data_cgt.js', listVar: 'ix_mp3list_cgt', recordsVar: 'records_cgt', songsVar: 'ix_songs_cgt' },
];

function normalizeMusicUrl(url: string): string {
  const text = String(url || '').trim();
  if (!text) return '';
  if (text.startsWith('//')) return `https:${text}`;
  if (text.startsWith('http://')) return text.replace(/^http:/i, 'https:');
  if (text.startsWith('/')) return `${OFFICIAL_SITE_ORIGIN}${text}`;
  return text;
}

function normalizeLookupUrl(url: string): string {
  return normalizeMusicUrl(url).toLowerCase();
}

function normalizeAlbumName(name: string): string {
  return String(name || '').trim().toLowerCase().replace(/[\s（）()【】\[\]！!?？.,·、]/g, '');
}

// 从官网 JS 脚本里切出某个变量（数组/对象）的值并 JSON.parse。
function extractAssignedValue(scriptText: string, variableName: string): any {
  const assignmentIndex = scriptText.indexOf(variableName);
  if (assignmentIndex < 0) return null;
  const objectStart = scriptText.indexOf('{', assignmentIndex);
  const arrayStart = scriptText.indexOf('[', assignmentIndex);
  const valueStart = arrayStart >= 0 && (objectStart < 0 || arrayStart < objectStart) ? arrayStart : objectStart;
  if (valueStart < 0) return null;
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  for (let i = valueStart; i < scriptText.length; i++) {
    const c = scriptText[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '[' || c === '{') stack.push(c);
    else if (c === ']' || c === '}') {
      stack.pop();
      if (stack.length === 0) {
        try {
          return JSON.parse(scriptText.slice(valueStart, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

async function fetchScriptText(url: string): Promise<string> {
  const fresh = `${url}${url.includes('?') ? '&' : '?'}adv=${Date.now()}`;
  const res = await fetch(fresh, { cache: 'no-store' } as any);
  if (!res.ok) throw new Error(`拉取 ${url} 失败：${res.status}`);
  return res.text();
}

// ---- 唱片（专辑）收集：递归找出带 title+image 的对象 ----
function collectRecordItems(value: any, result: any[] = []): any[] {
  if (Array.isArray(value)) {
    value.forEach((item) => collectRecordItems(item, result));
  } else if (value && typeof value === 'object') {
    if (value.title && value.image) result.push(value);
    Object.keys(value).forEach((key) => {
      if (key !== 'title' && key !== 'image') collectRecordItems(value[key], result);
    });
  }
  return result;
}

function buildRecordMap(recordsData: any): Map<string, any> {
  const recordMap = new Map<string, any>();
  const records: any[] = [];
  collectRecordItems(recordsData).forEach((record) => {
    const title = String(record.title || '').trim();
    if (!title) return;
    const recordInfo = {
      title,
      image: normalizeMusicUrl(record.image),
      url: normalizeMusicUrl(record.url),
      team: String(record.team || '').trim(),
    };
    records.push(recordInfo);
    recordMap.set(title, recordInfo);
    recordMap.set(normalizeAlbumName(title), recordInfo);
  });
  recordMap.set('__records', records);
  return recordMap;
}

function findRecordForAlbum(recordsMap: Map<string, any>, album: string): any {
  if (!album) return null;
  const normalizedAlbum = normalizeAlbumName(album);
  const exact = recordsMap.get(album) || recordsMap.get(normalizedAlbum);
  if (exact) return exact;
  const records = recordsMap.get('__records') || [];
  return records.find((record: any) => {
    const normalizedTitle = normalizeAlbumName(record.title);
    return normalizedTitle && (normalizedAlbum.includes(normalizedTitle) || normalizedTitle.includes(normalizedAlbum));
  }) || null;
}

// 由 mp3 文件名前缀推断「音频分组键」，用于 SNH 的 前缀→专辑 映射
function getAudioGroupKey(url: string, groupKey = ''): string {
  const fileName = String(url || '').split('/').pop() || '';
  const baseName = fileName.replace(/\.mp3$/i, '');
  const numericGroup = baseName.replace(/_?\d+$/i, '');
  if (numericGroup !== baseName) return numericGroup || baseName;
  if (groupKey === 'BEJ' && baseName.includes('_')) {
    return baseName.split('_')[0] || baseName;
  }
  return baseName || fileName;
}

function buildAudioGroups(list: any[], groupKey = ''): Map<string, any> {
  const groups = new Map<string, any>();
  let currentGroup: any = null;
  (Array.isArray(list) ? list : []).forEach((item) => {
    const audioGroupKey = getAudioGroupKey(item && item.mp3, groupKey);
    if (!currentGroup || currentGroup.groupKey !== audioGroupKey) {
      currentGroup = { groupKey: audioGroupKey, title: (item && item.title) || '', count: 0 };
      groups.set(audioGroupKey, currentGroup);
    }
    currentGroup.count += 1;
  });
  return groups;
}

function parseTrackDuration(durationText: string): number {
  const parts = String(durationText || '').split(':').map((part) => Number(part));
  if (parts.some((p) => !Number.isFinite(p))) return 0;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

// SNH：mp3 文件名前缀 → 专辑名（yk1z 电脑版同款硬编码映射，保证专辑名正确）
const SNH_ALBUM_BY_AUDIO_GROUP = new Map<string, string>([
  ['fly', 'F.L.Y成长三部曲'],
  ['wmlc', '我们的旅程'],
  ['newyear', '新年的钟声'],
  ['bluelight', '新年的钟声'],
  ['banoil', '新年的钟声'],
  ['dudubaby', '新年的钟声'],
  ['gogirl', '新年的钟声'],
  ['gayni', '新年的钟声'],
  ['kyt', '苦与甜'],
  ['myself', '盛夏好声音'],
  ['kissing', '盛夏好声音'],
  ['speedeye', '盛夏好声音'],
  ['philosophy', '盛夏好声音'],
  ['afterrain', '雨季之后'],
  ['diary', '雨季之后'],
  ['sha', '雨季之后'],
  ['planetreeh', '雨季之后'],
  ['wolf', '雨季之后'],
  ['gaobai', '青春的约定'],
  ['gravita', '青春的约定'],
  ['suki', '青春的约定'],
  ['dreamriver', '青春的约定'],
  ['planetree', '呜吒（UZA）'],
  ['rabit', '呜吒（UZA）'],
  ['miss', '呜吒（UZA）'],
  ['sunset', '呜吒（UZA）'],
  ['solong', '一心向前'],
  ['sakurasiori', '一心向前'],
  ['wind', '一心向前'],
  ['megami', '一心向前'],
  ['hr_n', '无尽旋转【蓝版】'],
  ['fg_n', '一心向前'],
  ['river_n', '一心向前'],
  ['boni_n', '一心向前'],
  ['down', '心电感应'],
  ['love', '心电感应'],
  ['sunrise', '心电感应'],
  ['blackwhite', '心电感应'],
  ['chrismas', '爱的幸运曲奇'],
  ['maybe', '爱的幸运曲奇'],
  ['beginner', '爱的幸运曲奇'],
  ['boni', '飞翔入手'],
  ['shitou', '飞翔入手'],
  ['river', '无尽旋转'],
  ['sakura', '无尽旋转'],
  ['rl', '热恋专属 Love Ver.'],
]);

// GNZ：歌名 → 专辑名
const GNZ_ALBUM_BY_TITLE = new Map<string, string>([
  ['Brave Heart', '此刻到永远'],
  ['HERO', 'HERO'],
  ['抱紧处理', '抱紧处理'],
  ['不见不散', '甜蜜盛典'],
  ['SAY NO', 'SAY NO'],
  ['I Know', 'SAY NO'],
  ['就是现在', 'SAY NO'],
  ['未知方向', 'SAY NO'],
  ['蠢蠢', 'SAY NO'],
  ['蒲公英的脚印', 'I.F'],
  ['Miss Camellia', 'I.F'],
  ['向日葵约定', 'I.F'],
  ['粉红白玫瑰', 'I.F'],
  ['紫荆', 'I.F'],
  ['新年好', 'BOOM ! BOOM ! BOOM !'],
  ['拆封未来', 'BOOM ! BOOM ! BOOM !'],
  ['青春不败', 'BOOM ! BOOM ! BOOM !'],
  ['梦飞船', 'BOOM ! BOOM ! BOOM !'],
  ['回家', 'BOOM ! BOOM ! BOOM !'],
  ['你所不知道的我', '你所不知道的我'],
  ['LOVE', '你所不知道的我'],
  ['近未来', '你所不知道的我'],
  ['做自己的主宰', '你所不知道的我'],
  ['这样的我', '你所不知道的我'],
]);

// 少量歌曲（ix_songs_xxx，仅 2 首左右）带有准确 record_name 与 songs_time，优先用
function buildSongRecordMap(songsData: any): Map<string, any> {
  const songRecordMap = new Map<string, any>();
  const collect = (value: any) => {
    if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === 'object') {
      if (value.url || value.songs_name) {
        const recordName = String(value.record_name || '').trim();
        if (!recordName && !value.songs_time) return;
        const meta = { recordName, duration: String(value.songs_time || '').trim() };
        const url = normalizeLookupUrl(value.url);
        const songName = normalizeAlbumName(value.songs_name);
        if (url) songRecordMap.set(url, meta);
        if (songName) songRecordMap.set(`title:${songName}`, meta);
      }
      Object.keys(value).forEach((key) => {
        if (key !== 'url' && key !== 'songs_name') collect(value[key]);
      });
    }
  };
  collect(songsData);
  return songRecordMap;
}

function buildTracks(group: { key: string; label: string }, list: any[], recordsMap: Map<string, any>, songRecordMap: Map<string, any>): OfficialSiteTrack[] {
  const sourceList: any[] = [];
  const seenSourceKeys = new Set<string>();
  (Array.isArray(list) ? list : []).forEach((item) => {
    const mp3 = normalizeLookupUrl(item && item.mp3);
    const title = String((item && item.title) || '').trim();
    const artist = String((item && item.artist) || '').trim();
    const sourceKey = `${mp3}|${title}|${artist}`;
    if (!mp3 || seenSourceKeys.has(sourceKey)) return;
    seenSourceKeys.add(sourceKey);
    sourceList.push(item);
  });

  const albumCounts = new Map<string, number>();
  sourceList.forEach((item) => {
    const album = String((item && item.artist) || '').trim();
    if (album) albumCounts.set(album, (albumCounts.get(album) || 0) + 1);
  });
  const hasUsefulAlbumData = albumCounts.size > 1 || sourceList.length <= 10;
  const audioGroups = buildAudioGroups(sourceList, group.key);

  return sourceList
    .map((item, index) => {
      const mp3 = normalizeMusicUrl(item && item.mp3);
      if (!mp3) return null;
      const audioGroupKey = getAudioGroupKey(item && item.mp3, group.key);
      const audioGroup = audioGroups.get(audioGroupKey);
      const exactSongMeta =
        songRecordMap.get(normalizeLookupUrl(item && item.mp3)) ||
        songRecordMap.get(`title:${normalizeAlbumName(item && item.title)}`) ||
        null;
      const exactRecordName =
        (exactSongMeta && exactSongMeta.recordName) ||
        (group.key === 'GNZ' ? GNZ_ALBUM_BY_TITLE.get((item && item.title) || '') || '' : '') ||
        (group.key === 'SNH' ? SNH_ALBUM_BY_AUDIO_GROUP.get(audioGroupKey) || '' : '') ||
        '';
      const titleRecord = findRecordForAlbum(recordsMap, item && item.title);
      let album = '';
      let record: any = null;
      if (exactRecordName) {
        album = exactRecordName;
        record = findRecordForAlbum(recordsMap, exactRecordName) || titleRecord;
      } else if (hasUsefulAlbumData) {
        album = (item && item.artist) || '';
        record = findRecordForAlbum(recordsMap, album) || titleRecord;
      } else if (group.key === 'GNZ' && titleRecord) {
        album = titleRecord.title;
        record = titleRecord;
      } else {
        const inferredAlbum = (audioGroup && audioGroup.title) || '';
        const inferredRecord = findRecordForAlbum(recordsMap, inferredAlbum) || titleRecord;
        if (inferredRecord) {
          album = inferredAlbum;
          record = inferredRecord;
        }
      }
      if (record && record.title) {
        album = record.title;
      }
      const singer = (record && record.team) || group.label;
      const coverUrl = record && record.image ? record.image : '';
      return {
        id: `${group.key}-${index}`,
        musicId: mp3,
        sourceIndex: index + 1,
        groupKey: group.key,
        audioGroupKey,
        groupLabel: group.label,
        title: (item && item.title) || '未命名歌曲',
        artist: singer,
        album,
        albumName: album,
        joinMemberNames: singer,
        subTitle: '',
        mp3,
        coverUrl,
        recordUrl: record && record.url ? record.url : '',
        duration: (exactSongMeta && exactSongMeta.duration ? parseTrackDuration(exactSongMeta.duration) : 0),
      };
    })
    .filter(Boolean) as OfficialSiteTrack[];
}

const CACHE_KEY = 'yaya_official_site_music_cache_v4';
const CACHE_TTL = 24 * 60 * 60 * 1000;

export async function loadOfficialSiteMusic(force = false): Promise<OfficialSiteTrack[]> {
  if (!force) {
    try {
      const raw = await AsyncStorage.getItem(CACHE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.t && Date.now() - parsed.t < CACHE_TTL && Array.isArray(parsed.list) && parsed.list.length) {
          return parsed.list as OfficialSiteTrack[];
        }
      }
    } catch {
      /* ignore cache errors */
    }
  }
  const results = await Promise.allSettled(
    GROUPS.map(async (group) => {
      const text = await fetchScriptText(`${SCRIPT_BASE}/${group.script}`);
      const list = extractAssignedValue(text, group.listVar);
      let recordsMap = new Map<string, any>();
      let songRecordMap = new Map<string, any>();
      try {
        recordsMap = buildRecordMap(extractAssignedValue(text, group.recordsVar));
      } catch {
        /* ignore */
      }
      try {
        songRecordMap = buildSongRecordMap(extractAssignedValue(text, group.songsVar));
      } catch {
        /* ignore */
      }
      return buildTracks(group, list, recordsMap, songRecordMap);
    }),
  );
  const all: OfficialSiteTrack[] = [];
  results.forEach((r) => {
    if (r.status === 'fulfilled' && Array.isArray(r.value)) all.push(...r.value);
  });
  if (all.length === 0) {
    const anyRejected = results.find((r) => r.status === 'rejected');
    if (anyRejected && (anyRejected as PromiseRejectedResult).reason) {
      throw (anyRejected as PromiseRejectedResult).reason;
    }
    throw new Error('官网音乐列表为空');
  }
  try {
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), list: all }));
  } catch {
    /* ignore */
  }
  return all;
}

export default { loadOfficialSiteMusic };
