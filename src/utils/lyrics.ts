export interface LyricLine { time: number; text: string }

export function parseLrc(raw: string): LyricLine[] {
  if (!raw) return [];
  const lines: LyricLine[] = [];
  const re = /\[(\d{1,3}):(\d{1,2}(?:\.\d{1,3})?)\](.*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    const t = parseInt(m[1], 10) * 60 + parseFloat(m[2]);
    const text = (m[3] || '').trim();
    if (text) lines.push({ time: t, text });
  }
  return lines.sort((a, b) => a.time - b.time);
}

export function lyricIndexAt(lines: LyricLine[], posSec: number): number {
  for (let i = lines.length - 1; i >= 0; i--) if (posSec >= lines[i].time) return i;
  return -1;
}

export function lyricTimeForIndex(lines: LyricLine[], idx: number): number {
  if (idx < 0 || idx >= lines.length) return -1;
  return lines[idx].time;
}
