export interface LyricLine {
  time: number;
  text: string;
}

const CREDIT_RE =
  /^(?:作词|作曲|编曲|填词|词|曲|录音|混音|母带|制作人|监制|出品|发行|企划|统筹|策划|音乐总监|人声|配唱|和声|吉他|贝斯|鼓|弦乐|键盘|后期|美术|设计|OP|SP|A&R)\s*[:：]/i;

function isTitleLine(text: string, time: number): boolean {
  if (time > 2) return false;
  if (!/\s[-–—]\s/.test(text)) return false;
  return text.length <= 40 && !/[，。！？；,.!?;]/.test(text);
}

export function parseLrc(raw: string): LyricLine[] {
  if (!raw) return [];
  const lines: LyricLine[] = [];
  const timeTagRe = /\[(\d{1,3}):(\d{1,2}(?:\.\d{1,3})?)\]/g;
  for (const rawLine of raw.split(/\r?\n/)) {
    const times: number[] = [];
    let textStart = 0;
    timeTagRe.lastIndex = 0;
    let tm: RegExpExecArray | null;
    while ((tm = timeTagRe.exec(rawLine)) !== null) {
      times.push(parseInt(tm[1], 10) * 60 + parseFloat(tm[2]));
      textStart = tm.index + tm[0].length;
    }
    if (!times.length) continue;
    const text = rawLine.slice(textStart).trim();
    if (!text) continue;
    if (CREDIT_RE.test(text)) continue;
    if (isTitleLine(text, times[0])) continue;
    for (const t of times) lines.push({ time: t, text });
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
