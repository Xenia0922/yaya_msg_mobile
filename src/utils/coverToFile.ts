import * as FileSystem from 'expo-file-system/legacy';
import { isPocket48ImageHost, normalizeImageHost } from './imageThumb';

const coverDataCache = new Map<string, string>();
const inflightDownloads = new Map<string, Promise<string>>();

const COVER_CACHE_MAX = 80;
let coverDirReady: Promise<boolean> | null = null;
let coverPrunePending = false;

function coverDirPath(): string {
  return `${FileSystem.cacheDirectory || ''}cover/`;
}

function ensureCoverDir(): Promise<boolean> {
  if (!coverDirReady) {
    coverDirReady = (async () => {
      try {
        await FileSystem.makeDirectoryAsync(coverDirPath(), { intermediates: true });
        return true;
      } catch {
        return false;
      }
    })();
  }
  return coverDirReady;
}

function coverFileFor(url: string): string {
  let h = 0;
  for (let i = 0; i < url.length; i++) h = (h * 31 + url.charCodeAt(i)) >>> 0;
  const ext = /\.png([?#]|$)/i.test(url) ? 'png' : 'jpg';
  return `${coverDirPath()}art_v2_${h.toString(36)}.${ext}`;
}

function recordMemoryCover(coverUrl: string, local: string): void {
  coverDataCache.delete(coverUrl);
  coverDataCache.set(coverUrl, local);
  if (coverDataCache.size > COVER_CACHE_MAX) {
    const keys = Array.from(coverDataCache.keys());
    keys.slice(0, keys.length - COVER_CACHE_MAX).forEach((k) => coverDataCache.delete(k));
  }
}

async function pruneCoverDir(): Promise<void> {
  if (coverPrunePending) return;
  coverPrunePending = true;
  try {
    const dir = coverDirPath();
    const files = await FileSystem.readDirectoryAsync(dir);
    if (files.length <= COVER_CACHE_MAX) return;
    const stats = await Promise.all(
      files.map(async (f) => {
        const p = `${dir}${f}`;
        try {
          const info: any = await FileSystem.getInfoAsync(p);
          return { p, t: info?.modificationTime ? Number(info.modificationTime) : 0 };
        } catch {
          return { p, t: 0 };
        }
      }),
    );
    stats.sort((a, b) => a.t - b.t);
    const excess = stats.slice(0, stats.length - COVER_CACHE_MAX);
    await Promise.all(excess.map((x) => FileSystem.deleteAsync(x.p, { idempotent: true })));
  } catch {
  } finally {
    coverPrunePending = false;
  }
}

export function peekCoverFile(coverUrl: string): string {
  if (!coverUrl) return '';
  if (coverUrl.startsWith('file://') || coverUrl.startsWith('data:')) return coverUrl;
  return coverDataCache.get(coverUrl) || '';
}

export async function fetchCoverToFile(coverUrl: string): Promise<string> {
  if (!coverUrl) return '';
  if (coverUrl.startsWith('file://') || coverUrl.startsWith('data:')) return coverUrl;
  const hit = coverDataCache.get(coverUrl);
  if (hit) return hit;

  const existingPromise = inflightDownloads.get(coverUrl);
  if (existingPromise) return existingPromise;

  const task = (async () => {
    try {
      await ensureCoverDir();
      const local = coverFileFor(coverUrl);
      try {
        const existingInfo: any = await FileSystem.getInfoAsync(local);
        if (existingInfo?.exists && Number(existingInfo.size || 0) > 256) {
          recordMemoryCover(coverUrl, local);
          return local;
        }
      } catch {}

      const needsPocketRef =
        isPocket48ImageHost(coverUrl) || /(?:^|\/\/)[^/]*snh48\.com\//i.test(coverUrl);
      const downloadOnce = async (withReferer: boolean) => {
        const options = withReferer ? { headers: { Referer: 'https://h5.48.cn/' } } : {};
        return Promise.race([
          FileSystem.downloadAsync(coverUrl, local, options),
          new Promise((_, rej) => setTimeout(() => rej(new Error('cover timeout')), 7000)),
        ]);
      };
      let res: any = await downloadOnce(needsPocketRef);
      if (res && res.status === 403 && needsPocketRef) {
        await FileSystem.deleteAsync(local, { idempotent: true }).catch(() => {});
        res = await downloadOnce(false);
      }
      if (res && (res.status === 200 || res.status === undefined)) {
        const savedInfo: any = await FileSystem.getInfoAsync(local).catch(() => null);
        if (savedInfo?.exists && Number(savedInfo.size || 0) > 256) {
          recordMemoryCover(coverUrl, local);
          void pruneCoverDir();
          return local;
        }
      }
      await FileSystem.deleteAsync(local, { idempotent: true }).catch(() => {});
    } catch {}
    return coverUrl;
  })();

  inflightDownloads.set(coverUrl, task);
  try {
    return await task;
  } finally {
    inflightDownloads.delete(coverUrl);
  }
}

export function normalizeCoverUrl(raw: string): string {
  let cover = String(raw || '').trim();
  if (!cover) return '';
  if (!/^https?:\/\//i.test(cover)) {
    cover = `https://source.48.cn${cover.startsWith('/') ? cover : '/' + cover}`;
  }
  cover = normalizeImageHost(cover);
  if (/resize_\d+x\d+/i.test(cover)) {
    cover = cover.replace(/resize_\d+x\d+/i, 'resize_500x500');
  }
  return cover;
}
