// 鸡腿榜返回体解析：官方接口字段不稳定，统一兜底抽取排名数组 / 周列表。
// 抽成纯函数，便于单测（scripts/melee-parse.test.mjs 通过 tsc 编译本文件后断言）。

export interface WeekItem {
  weekRankId: number;
  weekRankName: string;
}

/**
 * 规范化周榜名。
 * 上游数据存在笔误/格式不一（实测出现 `08日31日-09月06日`，把"月"写成"日"），
 * 直接展示会看到"08日31日"。这里按数字重建：4 个数字 → MM月DD日-MM月DD日；
 * 2 个数字 → MM月DD日；其余（如"第 3 期"）原样返回。
 */
export function normalizeWeekName(raw: string): string {
  const s = String(raw || '').trim();
  if (!s) return s;
  const cleaned = s.replace(/(20\d{2})\s*[年\-/.]/g, ''); // 去年份
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

/** 从多种返回形态中解析出排名数组。 */
export function extractRankList(data: any): any[] {
  if (!data || typeof data !== 'object') return [];
  const candidates = [
    // rankUserList 是电脑版/官方周榜的用户列表字段（权威），必须优先于泛化猜测，
    // 否则 BFS 兜底可能先撞上 weekRankList 等数组 → 榜单渲染成周列表
    data.rankUserList, data.content?.rankUserList, data.data?.rankUserList,
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
          // 名称缺失时不再丢弃该周（此前要求 weekRankName 必填 → 接口改名/只给 id 时整份周列表为空，
          // 周切换直接失效）；用 rankId 兜底展示
          weekRankName: normalizeWeekName(String(it?.weekRankName ?? it?.rankName ?? it?.name ?? it?.title ?? ''))
            || (Number(it?.weekRankId ?? it?.rankId ?? it?.id ?? 0) > 0 ? `rankId ${Number(it?.weekRankId ?? it?.rankId ?? it?.id)}` : ''),
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
