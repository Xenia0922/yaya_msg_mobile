export interface WeekItem {
  weekRankId: number;
  weekRankName: string;
}

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : null;
}

export function normalizeWeekName(raw: string): string {
  const s = String(raw || '').trim();
  if (!s) return s;
  const cleaned = s.replace(/(20\d{2})\s*[年\-/.]/g, '');
  const nums = (cleaned.match(/\d{1,2}/g) || []).map((n) => Number(n));
  const pad = (n: number) => String(n).padStart(2, '0');
  if (nums.length >= 4) {
    const [m1, d1, m2, d2] = nums;
    if (m1 >= 1 && m1 <= 12 && m2 >= 1 && m2 <= 12 && d1 >= 1 && d1 <= 31 && d2 >= 1 && d2 <= 31) {
      return `${pad(m1)}月${pad(d1)}日-${pad(m2)}月${pad(d2)}日`;
    }
  }
  if (nums.length === 2) {
    const [m, d] = nums;
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) return `${pad(m)}月${pad(d)}日`;
  }
  return s;
}

export function extractRankList(data: unknown): unknown[] {
  const root = asRecord(data);
  if (!root && !Array.isArray(data)) return [];
  const content = asRecord(root?.content);
  const dataNode = asRecord(root?.data);
  const candidates = [
    root?.rankUserList,
    content?.rankUserList,
    dataNode?.rankUserList,
    root?.rankList,
    root?.list,
    root?.data,
    root?.ranks,
    root?.result,
    root?.records,
    content?.rankList,
    content?.list,
    content?.data,
    content?.ranks,
    content?.result,
    content?.records,
    dataNode?.rankList,
    dataNode?.list,
    dataNode?.result,
    dataNode?.records,
  ];
  for (const c of candidates) {
    if (Array.isArray(c) && c.length) return c;
  }

  const stack: unknown[] = [data];
  const seen = new WeakSet<object>();
  let guard = 0;
  while (stack.length && guard < 2000) {
    guard += 1;
    const node = stack.pop();
    if (!node || typeof node !== 'object') continue;
    if (seen.has(node)) continue;
    seen.add(node);
    if (Array.isArray(node)) return node;
    for (const key of Object.keys(node)) {
      const value = (node as JsonRecord)[key];
      if (Array.isArray(value) && value.length && typeof value[0] === 'object') return value;
      if (value && typeof value === 'object') stack.push(value);
    }
  }
  return [];
}

export function extractWeeks(data: unknown): WeekItem[] {
  if (!data || typeof data !== 'object') return [];
  const scan = (node: unknown): WeekItem[] => {
    if (Array.isArray(node)) {
      const mapped = node
        .map((it) => {
          const record = asRecord(it) || {};
          return {
            weekRankId: Number(record.weekRankId ?? record.rankId ?? record.id ?? record.week ?? 0),

            weekRankName:
              normalizeWeekName(
                String(record.weekRankName ?? record.rankName ?? record.name ?? record.title ?? ''),
              ) ||
              (Number(record.weekRankId ?? record.rankId ?? record.id ?? 0) > 0
                ? `rankId ${Number(record.weekRankId ?? record.rankId ?? record.id)}`
                : ''),
          };
        })
        .filter((w: WeekItem) => w.weekRankId > 0 && w.weekRankName);
      if (mapped.length) return mapped;
    }
    const record = asRecord(node);
    if (record) {
      for (const key of ['weekList', 'weeks', 'weekRankList', 'rankList', 'list']) {
        const result = scan(record[key]);
        if (result.length) return result;
      }
      for (const key of Object.keys(record)) {
        const result = scan(record[key]);
        if (result.length) return result;
      }
    }
    return [];
  };
  return scan(data);
}
