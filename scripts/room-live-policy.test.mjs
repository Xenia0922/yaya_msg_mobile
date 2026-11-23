import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const ts = createRequire(import.meta.url)('typescript');
const source = readFileSync(new URL('../src/services/roomLivePolicy.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
const moduleObject = { exports: {} };
vm.runInNewContext(compiled, { module: moduleObject, exports: moduleObject.exports });
const {
  ROOM_POLL_INTERVAL_MS,
  ROOM_REFRESH_LIMIT,
  ROOM_REJOIN_AFTER_MS,
  ROOM_AT_BOTTOM_OFFSET,
  ROOM_SEARCH_DEBOUNCE_MS,
  ROOM_LOAD_MORE_COOLDOWN_MS,
  ROOM_SEARCH_MIN_HITS,
  ROOM_SEARCH_BURST_PAGES,
  splitByFreezeAnchor,
  computeHistoryCursorAdvance,
  shouldAutoLoadMoreOnScroll,
  shouldSearchAutoContinue,
} = moduleObject.exports;

assert.ok(ROOM_POLL_INTERVAL_MS > 0, '刷新间隔必须为正');
assert.ok(ROOM_POLL_INTERVAL_MS <= 2_000, '房间页需持续刷新，间隔不得超过 2s');
assert.ok(ROOM_REFRESH_LIMIT > 0 && ROOM_REFRESH_LIMIT < 100, '刷新只拉最新一小页');
assert.ok(ROOM_REJOIN_AFTER_MS >= 30_000, '补订阅不能过于频繁');
assert.ok(ROOM_AT_BOTTOM_OFFSET > 0 && ROOM_AT_BOTTOM_OFFSET <= 120, '贴底门槛应在合理范围');

// 冻结锚点：上划后新消息只计数，不插进列表；更旧的历史（加载更多）照常显示
const msgs = ['n3', 'n2', 'n1', 'old1', 'old2'].map((id) => ({ _id: id }));
const frozen = splitByFreezeAnchor(msgs, 'n1');
assert.deepEqual(
  frozen.list.map((m) => m._id),
  ['n1', 'old1', 'old2'],
  '锚点之前的 2 条新消息应被按住',
);
assert.equal(frozen.pending, 2, '新消息条数用于气泡提示');
// 没冻结时原样返回
assert.deepEqual(splitByFreezeAnchor(msgs, null).list, msgs);
assert.equal(splitByFreezeAnchor(msgs, null).pending, 0);
// 锚点消失 → 放开（宁可滚一下也不卡在旧数据）
const lost = splitByFreezeAnchor(msgs, 'gone');
assert.deepEqual(lost.list, msgs);
assert.equal(lost.pending, 0);
// 锚点就是最新一条 → 相当于没冻结
const atTop = splitByFreezeAnchor(msgs, 'n3');
assert.deepEqual(atTop.list, msgs);
assert.equal(atTop.pending, 0);
// 上滑加载到更旧的历史后，冻结仍然只挡新消息
const more = [...msgs, { _id: 'old3' }];
assert.deepEqual(
  splitByFreezeAnchor(more, 'n1').list.map((m) => m._id),
  ['n1', 'old1', 'old2', 'old3'],
);

assert.ok(ROOM_SEARCH_DEBOUNCE_MS >= 150 && ROOM_SEARCH_DEBOUNCE_MS <= 350);
assert.ok(ROOM_LOAD_MORE_COOLDOWN_MS >= 150);
assert.ok(ROOM_SEARCH_MIN_HITS >= 6 && ROOM_SEARCH_BURST_PAGES >= 3);

// 历史翻页游标推进与防卡死死循环保护
assert.deepEqual(
  { ...computeHistoryCursorAdvance(5000, 4000, 100, 80) },
  { nextTime: 4000, hasMore: true, stalled: false },
  '正常递减游标应继续翻页',
);
assert.deepEqual(
  { ...computeHistoryCursorAdvance(5000, 5000, 100, 0) },
  { nextTime: 0, hasMore: false, stalled: true },
  '同一游标且无新增去重条数时必须停止，禁止抽风死循环',
);
assert.deepEqual(
  { ...computeHistoryCursorAdvance(5000, 5000, 100, 10) },
  { nextTime: 4999, hasMore: true, stalled: false },
  '同时间戳边界仍有新增消息时递减 1ms 避免重复请求同一页',
);
assert.deepEqual(
  { ...computeHistoryCursorAdvance(5000, 6000, 50, 20) },
  { nextTime: 0, hasMore: false, stalled: true },
  '游标倒退（大于上次游标）应中止防死循环',
);
assert.deepEqual(
  { ...computeHistoryCursorAdvance(5000, 0, 10, 10) },
  { nextTime: 0, hasMore: false, stalled: false },
  'nextTime=0 表示到底了',
);
assert.deepEqual(
  { ...computeHistoryCursorAdvance(5000, 4000, 0, 0) },
  { nextTime: 0, hasMore: false, stalled: false },
  '返回空数组表示无更多历史',
);

// 上划自动加载触发判定
assert.equal(
  shouldAutoLoadMoreOnScroll({
    offsetY: 0,
    contentHeight: 2400,
    layoutHeight: 700,
    hasMore: true,
    loading: false,
    loadingMore: false,
  }),
  false,
  '贴底初始位置不触发上划加载',
);
assert.equal(
  shouldAutoLoadMoreOnScroll({
    offsetY: 1300,
    contentHeight: 2400,
    layoutHeight: 700,
    hasMore: true,
    loading: false,
    loadingMore: false,
  }),
  true,
  '倒置列表距离顶部 <= max(360, 0.7 * layoutHeight) 时自动触发加载',
);
assert.equal(
  shouldAutoLoadMoreOnScroll({
    offsetY: 1300,
    contentHeight: 2400,
    layoutHeight: 700,
    hasMore: true,
    loading: false,
    loadingMore: true,
  }),
  false,
  '正在加载中不得重复触发',
);

// 搜索自动加载预算与终止条件
assert.equal(
  shouldSearchAutoContinue({
    query: '晚安',
    matchCount: 3,
    targetMatchCount: 12,
    pagesScannedInBurst: 2,
    maxPagesPerBurst: 6,
    hasMore: true,
    nextTime: 12345,
  }),
  true,
  '命中数不足且未超突发预算时继续搜索更早历史',
);
assert.equal(
  shouldSearchAutoContinue({
    query: '晚安',
    matchCount: 12,
    targetMatchCount: 12,
    pagesScannedInBurst: 2,
    maxPagesPerBurst: 6,
    hasMore: true,
    nextTime: 12345,
  }),
  false,
  '命中数已满足阈值后停止本轮扫描',
);
assert.equal(
  shouldSearchAutoContinue({
    query: '不存在',
    matchCount: 0,
    targetMatchCount: 12,
    pagesScannedInBurst: 6,
    maxPagesPerBurst: 6,
    hasMore: true,
    nextTime: 12345,
  }),
  false,
  '达到单次扫描页上限时暂停，由用户手动点续查或上划继续',
);

console.log('房间持续刷新、历史翻页与搜索自动加载策略测试通过');
