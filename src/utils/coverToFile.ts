import * as FileSystem from 'expo-file-system/legacy';

const coverDataCache = new Map<string, string>();

const COVER_CACHE_MAX = 80;
let coverDirReady: Promise<boolean> | null = null;

function ensureCoverDir(): Promise<boolean> {
  if (!coverDirReady) {
    coverDirReady = (async () => {
      try {
        const dir = `${FileSystem.cacheDirectory || ''}cover/`;
        await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
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
  return `${FileSystem.cacheDirectory || ''}cover/notif_${h.toString(36)}.${ext}`;
}

export async function fetchCoverToFile(coverUrl: string): Promise<string> {
  if (!coverUrl) return '';
  if (coverUrl.startsWith('file://') || coverUrl.startsWith('data:')) return coverUrl;
  const hit = coverDataCache.get(coverUrl);
  if (hit) return hit;
  try {
    await ensureCoverDir();
    const local = coverFileFor(coverUrl);
    const res: any = await Promise.race([
      FileSystem.downloadAsync(coverUrl, local),
      new Promise((_, rej) => setTimeout(() => rej(new Error('cover timeout')), 7000)),
    ]);
    if (res && (res.status === 200 || res.status === undefined)) {
      coverDataCache.set(coverUrl, local);
      if (coverDataCache.size > COVER_CACHE_MAX) {
        const keys = Array.from(coverDataCache.keys());
        keys.slice(0, keys.length - COVER_CACHE_MAX).forEach((k) => coverDataCache.delete(k));
      }
      return local;
    }
  } catch {}
  return coverUrl;
}

export function normalizeCoverUrl(raw: string): string {
  let cover = String(raw || '').trim();
  if (!cover) return '';
  if (!/^https?:\/\//i.test(cover)) {
    cover = `https://source.48.cn${cover.startsWith('/') ? cover : '/' + cover}`;
  }
  if (/resize_\d+x\d+/i.test(cover)) {
    cover = cover.replace(/resize_\d+x\d+/i, 'resize_500x500');
  }
  return cover;
}
