import { sanitizeText } from './html';

export interface DanmakuItem {
  time: number;

  text: string;

  nick?: string;
  userId?: string;
  avatar?: string;
  level?: number;
}

export interface ReplayBarrageInfo {
  content: string;
  time: number;
  user: string;
  userId?: string;
  avatar?: string;
  level?: number;
}

function replayRowItems(row: ReplayBarrageInfo): DanmakuItem[] {
  const parsed = parseDanmaku(row.content);
  if (parsed.length) return parsed;
  let time = Number(row.time);
  if (!Number.isFinite(time) || time <= 0) return [];
  if (time > 86400 && time <= 86400000) time /= 1000;
  if (time > 86400) return [];
  return [{ time, text: sanitizeText(row.content), nick: row.user }];
}

export function replayBarrageToDanmaku(rows: ReplayBarrageInfo[]): DanmakuItem[] {
  return rows
    .flatMap((row) =>
      replayRowItems(row).map((item) => ({
        ...item,
        nick: item.nick || row.user || undefined,
        userId: row.userId,
        avatar: row.avatar,
        level: row.level,
      })),
    )
    .filter((item) => !!item.text)
    .sort((a, b) => a.time - b.time);
}

export function enrichReplayDanmaku(
  items: DanmakuItem[],
  rows: ReplayBarrageInfo[],
): DanmakuItem[] {
  const lookup = new Map<string, Array<DanmakuItem>>();
  for (const row of rows) {
    if (!row.userId && !row.avatar && !row.level) continue;
    for (const item of replayRowItems(row)) {
      const nick = String(item.nick || row.user || '').trim();
      const text = String(item.text || '').trim();
      const time = Number(item.time);
      if (!nick || !text || !Number.isFinite(time) || time < 0 || time > 86400) continue;
      const key = `${nick}\t${text}`;
      const list = lookup.get(key) || [];
      list.push({
        time,
        text: sanitizeText(text),
        nick,
        userId: row.userId,
        avatar: row.avatar,
        level: row.level,
      });
      lookup.set(key, list);
    }
  }
  const sourceLookup = new Map<string, number[]>();
  for (const item of items) {
    if (!item.nick) continue;
    const key = `${item.nick.trim()}\t${item.text.trim()}`;
    const times = sourceLookup.get(key) || [];
    times.push(item.time);
    sourceLookup.set(key, times);
  }
  return items.map((item) => {
    if (!item.nick) return item;
    const key = `${item.nick.trim()}\t${item.text.trim()}`;
    const matches = (lookup.get(key) || []).filter(
      (candidate) => Math.abs(candidate.time - item.time) < 1,
    );
    if (
      matches.length !== 1 ||
      (sourceLookup.get(key) || []).filter((time) => Math.abs(time - item.time) < 1).length !== 1
    )
      return item;
    const match = matches[0];
    return {
      ...item,
      userId: item.userId || match.userId,
      avatar: item.avatar || match.avatar,
      level: item.level || match.level,
    };
  });
}

export function replayDanmakuCount(list: ReadonlyArray<DanmakuItem>, current: number): number {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (list[mid].time <= current) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

const TIME_RE = /^\s*\[\s*(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?(?:\.(\d{1,3}))?\s*\]([\s\S]*)$/;

function parseTime(h: string, m: string, s: string | undefined, ms: string | undefined): number {
  const hours = s !== undefined ? parseInt(h, 10) : 0;
  const minutes = s !== undefined ? parseInt(m, 10) : parseInt(h, 10);
  const seconds = s !== undefined ? parseInt(s, 10) : parseInt(m, 10);

  const millis = ms ? parseInt(ms.padEnd(3, '0'), 10) / 1000 : 0;
  return hours * 3600 + minutes * 60 + seconds + millis;
}

export function parseDanmaku(raw: string): DanmakuItem[] {
  if (!raw) return [];
  const lines = raw.split(/\r?\n/);
  const result: DanmakuItem[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const match = trimmed.match(TIME_RE);
    if (!match) continue;

    const [, h, m, s, ms, body] = match;
    let text = (body ?? '').trim();
    let nick: string | undefined;

    const tabIdx = text.indexOf('\t');
    if (tabIdx >= 0) {
      nick = text.slice(0, tabIdx).trim();
      text = text.slice(tabIdx + 1).trim();
    }

    if (!text) continue;

    result.push({
      time: parseTime(h, m, s, ms),
      text,
      ...(nick ? { nick } : {}),
    });
  }

  result.sort((a, b) => a.time - b.time);
  return result;
}

export function collectActiveDanmaku(list: DanmakuItem[], current: number): DanmakuItem[] {
  return list.filter((d) => d.time <= current);
}

export function recentDanmaku(list: DanmakuItem[], current: number): DanmakuItem[] {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (list[mid].time <= current) lo = mid + 1;
    else hi = mid;
  }
  return list.slice(Math.max(0, lo - 6), lo).filter((item) => item.time >= current - 20);
}
