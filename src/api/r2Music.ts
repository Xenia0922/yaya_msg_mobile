export interface R2Track {
  title: string;
  lrcPath: string;
  mp3: string;
  group: string;
  groupCode: string;
  album: string;
  duration: number;
  coverUrl: string;
}

const R2_API = 'https://gnz.hk/api/r2-music';

export async function getR2Music(): Promise<R2Track[]> {
  try {
    const res = await fetch(R2_API);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    if (!text.trim()) throw new Error('empty response');
    const data = JSON.parse(text);
    if (!Array.isArray(data)) throw new Error('invalid format');
    return data;
  } catch {
    return [];
  }
}
