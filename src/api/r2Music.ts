import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchWithTimeout } from '../utils/network';

/**
 * R2 音乐库（music.gnz.hk）—— 公演音频全量列表。
 * 源：https://gnz.hk/api/r2-music（一次全量、无 token，1559 首，含 FLAC 高音质）。
 * 音频/封面走 music.gnz.hk 子域（正常媒体 CDN，Content-Type 正确，非 403 挑战页）。
 * 字段/语义对齐桌面端 yk1z/yaya_msg v2.11 `official-site-music-feature.js`（source: 'r2-performance'、
 * 请求带 metadata_v=3、独立缓存 + 网络失败回退缓存）。
 *
 * 请求节流策略（用户要求「请求次数不要太多」）：
 *  1. AsyncStorage 缓存 + 24h TTL（与官方源 officialSiteMusic 同级），冷启动直接命中缓存；
 *  2. 手动「刷新」传 force=true 才重新请求；
 *  3. 模块级 in-flight 去重：并发调用只发一个请求，其余复用同一 Promise；
 *  4. 网络失败回退旧缓存（桌面同款行为），彻底失败才抛错。
 */

const R2_MUSIC_URL = 'https://gnz.hk/api/r2-music?metadata_v=3';
const CACHE_KEY = 'yaya_r2_music_cache_v1';
const CACHE_TTL = 24 * 60 * 60 * 1000;

export interface R2MusicTrack {
  id: string;
  key: string;
  title: string;
  album: string;
  artist: string;
  albumArtist: string;
  /** 专辑分类，如「公演专辑」 */
  grouping: string;
  albumDate: string;
  genre: string;
  trackNumber: number;
  discNumber: number;
  /** 时长文本，如 "3:38" */
  duration: string;
  groupKey: string;
  groupLabel: string;
  /** 实际音频地址（mp3/flac），music.gnz.hk 子域 */
  mp3: string;
  coverUrl: string;
  size: number;
  uploaded: string;
  sourceIndex: number;
  source: string;
}

/** "3:38" / "1:02:05" → 秒 */
export function parseR2Duration(durationText: string): number {
  const parts = String(durationText || '')
    .trim()
    .split(':')
    .map((seg) => parseInt(seg, 10))
    .filter((n) => !Number.isNaN(n));
  if (!parts.length) return 0;
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

async function fetchR2MusicRaw(): Promise<R2MusicTrack[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const resp = await fetchWithTimeout(R2_MUSIC_URL, { signal: controller.signal }, 20000);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const json: any = await resp.json();
    if (!json || !Array.isArray(json.tracks)) throw new Error('r2-music 响应缺少 tracks');
    return json.tracks as R2MusicTrack[];
  } finally {
    clearTimeout(timer);
  }
}

/** 归一化为与官方源一致的曲目结构（musicId / title / artist / album / groupLabel / mp3 / coverUrl） */
export function normalizeR2Tracks(tracks: R2MusicTrack[]): any[] {
  return (tracks || [])
    .filter((t) => t && t.title && t.mp3)
    .map((t) => ({
      musicId: String(t.id || t.key || ''),
      id: String(t.id || t.key || ''),
      title: String(t.title || '').trim(),
      artist: String(t.artist || t.albumArtist || '').trim(),
      album: String(t.album || '').trim(),
      albumArtist: String(t.albumArtist || '').trim(),
      grouping: String(t.grouping || '').trim(),
      albumDate: String(t.albumDate || '').trim(),
      genre: String(t.genre || '').trim(),
      trackNumber: t.trackNumber,
      discNumber: t.discNumber,
      // 与桌面端一致：duration 保留原始文本（"3:38"），另附秒数供需要时使用
      duration: String(t.duration || '').trim(),
      durationSec: parseR2Duration(t.duration),
      groupKey: String(t.groupKey || '').trim(),
      groupLabel: String(t.groupLabel || '').trim(),
      mp3: String(t.mp3 || '').trim(),
      coverUrl: String(t.coverUrl || '').trim(),
      size: t.size,
      uploaded: String(t.uploaded || ''),
      sourceIndex: Number.isFinite(t.sourceIndex) ? t.sourceIndex : 100000,
      // 桌面同款 source 标记（isR2MusicTrack 判定语义：source==='r2-performance' 或 id 前缀 R2-）
      source: 'r2-performance',
    }));
}

let inflight: Promise<any[]> | null = null;
/** 后台刷新去重标志（见 refreshR2MusicInBackground 注释，防无限递归） */
let refreshing = false;
/** 上次后台刷新**尝试**时间：失败也记，避免网络长期不可用时每次调用都重试 */
let lastRefreshAttempt = 0;
/** 后台刷新最小重试间隔 */
const REFRESH_RETRY_MIN_MS = 10 * 60 * 1000;

/** 读缓存（无论是否过期） */
async function readR2Cache(): Promise<any[] | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.list) && parsed.list.length) return parsed.list;
    }
  } catch {
    /* ignore cache errors */
  }
  return null;
}

/**
 * 真正拉取 + 写缓存（模块级 in-flight 去重；网络失败回退旧缓存）。
 *
 * ⚠️【必须与 loadR2Music 分开】旧实现里「过期 → 后台刷新」直接调
 * `prefetchR2Music()` → `loadR2Music(false)`，而后者又会命中**同一份过期缓存**、
 * 直接 `return parsed.list` —— 于是：
 *   ① 刷新链每次都在「读缓存 + JSON.parse(1MB)」后就返回，**从不真正发网络请求**，
 *      缓存永远保持过期；
 *   ② 每次命中过期缓存都会再起一次刷新 → **无限递归**。
 * 实测后果（Hermes CPU Profile）：`[Native] jsonParse` 占 21.6%、`[GC Young Gen]` 占 34.4%，
 * App 空闲即吃 **129% CPU（1.3 核）**，且切后台不停、无网络、无日志、不渲染。
 * 所以后台刷新必须走这条**只负责真正拉取**的路径。
 */
async function fetchR2MusicAndCache(): Promise<any[]> {
  if (inflight) return inflight;

  inflight = (async () => {
    const tracks = await fetchR2MusicRaw();
    const normalized = normalizeR2Tracks(tracks);
    if (!normalized.length) throw new Error('R2 音乐列表为空');
    try {
      await AsyncStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), list: normalized }));
    } catch {
      /* ignore cache errors */
    }
    return normalized;
  })();

  try {
    return await inflight;
  } catch (error) {
    // 网络失败回退旧缓存（桌面 loadR2PerformanceMusicTracks 同款兜底），无缓存才抛错
    const cached = await readR2Cache();
    if (cached && cached.length) return cached;
    throw error;
  } finally {
    inflight = null;
  }
}

/** 后台刷新（去重 + 最小重试间隔 + 真正走网络） */
function refreshR2MusicInBackground(): void {
  if (refreshing || inflight) return;
  if (Date.now() - lastRefreshAttempt < REFRESH_RETRY_MIN_MS) return;
  lastRefreshAttempt = Date.now();
  refreshing = true;
  fetchR2MusicAndCache()
    .catch(() => {
      /* 静默：预取/刷新失败不影响使用，下次命中过期缓存时再试 */
    })
    .finally(() => {
      refreshing = false;
    });
}

/** 加载 R2 音乐列表。force=true 绕过缓存强制重拉（页面「刷新」按钮）。 */
export async function loadR2Music(force = false): Promise<any[]> {
  if (!force) {
    const raw = await AsyncStorage.getItem(CACHE_KEY).catch(() => null);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed.list) && parsed.list.length) {
          // stale-while-revalidate：缓存（含过期）先返回秒开；过期时后台刷新不阻塞
          if (parsed.t && Date.now() - parsed.t >= CACHE_TTL) refreshR2MusicInBackground();
          return parsed.list;
        }
      } catch {
        /* fallthrough to network */
      }
    }
  }
  return fetchR2MusicAndCache();
}

/**
 * 启动静默预取（列表 1MB、gnz.hk 传输慢 ~9s）：App 启动后台拉取写缓存，
 * 用户进音乐库时直接命中缓存秒开，不再干等首拉。
 */
export async function prefetchR2Music(): Promise<void> {
  // 节流（用户要求不施压 API）：非 force——24h 缓存新鲜则不请求；
  // 过期时 stale-while-revalidate 自动后台刷新；绝不每次冷启动全量拉 R2（1MB）
  try {
    await loadR2Music(false);
  } catch {
    /* 静默：预取失败不影响启动，用户进音乐库时再正常加载 */
  }
}

export default { loadR2Music };
