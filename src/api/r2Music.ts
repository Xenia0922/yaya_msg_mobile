// yk1z 的 R2 音乐库（yk1z/yaya_msg 电脑版的「R2 音乐」源，与官网源并列的两路歌曲源之一）。
// 接口：GET https://gnz.hk/api/r2-music → { success, tracks: [{ id, key, title, album, groupKey,
//   groupLabel, mp3: '/r2-music/<key>', coverUrl: '/r2-music/<key>', size, uploaded, source }] }
// mp3/coverUrl 是相对路径，需拼到 worker 主机（gnz.hk）下才能播放/显示。
export interface R2Track {
  id: string;
  key: string;
  title: string;
  album: string;
  groupKey: string;
  groupLabel: string;
  mp3: string; // 相对路径，如 /r2-music/SNH48/xxx.mp3
  coverUrl: string; // 相对路径
  size: number;
  uploaded: string;
  source: string;
}

// R2 音乐 worker 主机（与 yk1z 电脑版一致）。Cloudflare 对无头请求会拦，但 App 内 fetch
// 带移动 UA 通常可过；失败则静默回退，不影响官网源曲库。
const R2_API_HOST = 'https://gnz.hk';
const R2_API = `${R2_API_HOST}/api/r2-music`;

export async function getR2Music(): Promise<R2Track[]> {
  try {
    const res = await fetch(R2_API, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const tracks: R2Track[] = Array.isArray(data?.tracks)
      ? data.tracks
      : Array.isArray(data)
        ? data
        : [];
    return tracks.filter((t) => t && t.mp3 && t.title);
  } catch {
    return [];
  }
}

/** 把 R2 相对路径拼成可播放/显示的绝对 URL */
export function r2Absolute(path: string): string {
  if (!path) return '';
  if (path.startsWith('http')) return path;
  return `${R2_API_HOST}${path.startsWith('/') ? '' : '/'}${path}`;
}

/**
 * 把 R2 曲目转成与官方源一致的 Track 形状，便于两路合并到同一队列。
 * 去重键优先用 (mp3|title|artist)：同歌不同源天然保留；同歌同源不重复。
 */
export function r2ToTrack(t: R2Track): any {
  const absMp3 = r2Absolute(t.mp3);
  const absCover = r2Absolute(t.coverUrl);
  return {
    id: t.id || `R2-${t.key}`,
    musicId: `r2:${t.key}`,
    title: t.title || '未命名歌曲',
    album: t.album || '',
    albumName: t.album || '',
    artist: t.groupLabel || '',
    joinMemberNames: t.groupLabel || '',
    subTitle: '',
    groupLabel: t.groupLabel || '',
    groupKey: t.groupKey || '',
    mp3: absMp3,
    coverUrl: absCover,
    source: 'r2-performance',
    key: t.key,
  };
}
