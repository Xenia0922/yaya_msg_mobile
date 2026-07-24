// 鸡腿榜返回体解析：官方接口字段不稳定，统一兜底抽取排名数组 / 周列表。
// 抽成纯函数，便于单测（scripts/melee-parse.test.mjs 通过 tsc 编译本文件后断言）。

export interface WeekItem {
  weekRankId: number;
  weekRankName: string;
}

/** 从多种返回形态中解析出排名数组。 */
export function extractRankList(data: any): any[] {
  if (!data || typeof data !== 'object') return [];
  const candidates = [
    data.rankList, data.list, data.data, data.ranks, data.result, data.records,
    data.content?.rankList, data.content?.list, data.content?.data, data.content?.ranks,
    data.content?.result, data.content?.records,
    data.data?.rankList, data.data?.list, data.data?.result, data.data?.records,
  ];
  for (const c of candidates) {
    if (Array.isArray(c) && c.length) return c;
  }
  // 兜底：广度优先遍历对象，找首个对象数组（处理多层嵌套，带防环 + 数量上限）
  const stack: any[] = [data];
  const seen = new WeakSet<any>();
  let guard = 0;
  while (stack.length && guard < 2000) {
    guard += 1;
    const node = stack.pop();
    if (!node || typeof node !== 'object') continue;
    if (seen.has(node)) continue;
    seen.add(node);
    for (const key of Object.keys(node)) {
      const v = (node as any)[key];
      if (Array.isArray(v) && v.length && typeof v[0] === 'object') return v;
      if (v && typeof v === 'object') stack.push(v);
    }
  }
  return [];
}

/** 从返回体中递归找出“周列表”（含 weekRankId / weekRankName 的数组）。 */
export function extractWeeks(data: any): WeekItem[] {
  if (!data || typeof data !== 'object') return [];
  const scan = (node: any): WeekItem[] => {
    if (Array.isArray(node)) {
      const mapped = node
        .map((it: any) => ({
          weekRankId: Number(it?.weekRankId ?? it?.rankId ?? it?.id ?? it?.week ?? 0),
          weekRankName: String(it?.weekRankName ?? it?.rankName ?? it?.name ?? it?.title ?? ''),
        }))
        .filter((w: WeekItem) => w.weekRankId > 0 && w.weekRankName);
      if (mapped.length) return mapped;
    }
    if (node && typeof node === 'object') {
      for (const k of ['weekList', 'weeks', 'weekRankList', 'rankList', 'list']) {
        const r = scan((node as any)[k]);
        if (r.length) return r;
      }
      for (const k of Object.keys(node)) {
        const r = scan((node as any)[k]);
        if (r.length) return r;
      }
    }
    return [];
  };
  return scan(data);
}
