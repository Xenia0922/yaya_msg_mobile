import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const ts = createRequire(import.meta.url)('typescript');
const source = readFileSync(new URL('../src/services/roomLivePolicy.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const moduleObject = { exports: {} };
vm.runInNewContext(compiled, { module: moduleObject, exports: moduleObject.exports });
const { ROOM_POLL_INTERVAL_MS, ROOM_REFRESH_LIMIT, ROOM_REJOIN_AFTER_MS, ROOM_AT_BOTTOM_OFFSET, splitByFreezeAnchor } = moduleObject.exports;

assert.ok(ROOM_POLL_INTERVAL_MS > 0, '刷新间隔必须为正');
assert.ok(ROOM_POLL_INTERVAL_MS <= 2_000, '房间页需持续刷新，间隔不得超过 2s');
assert.ok(ROOM_REFRESH_LIMIT > 0 && ROOM_REFRESH_LIMIT < 100, '刷新只拉最新一小页');
assert.ok(ROOM_REJOIN_AFTER_MS >= 30_000, '补订阅不能过于频繁');
assert.ok(ROOM_AT_BOTTOM_OFFSET > 0 && ROOM_AT_BOTTOM_OFFSET <= 120, '贴底门槛应在合理范围');

// 冻结锚点：上划后新消息只计数，不插进列表；更旧的历史（加载更多）照常显示
const msgs = ['n3', 'n2', 'n1', 'old1', 'old2'].map((id) => ({ _id: id }));
const frozen = splitByFreezeAnchor(msgs, 'n1');
assert.deepEqual(frozen.list.map((m) => m._id), ['n1', 'old1', 'old2'], '锚点之前的 2 条新消息应被按住');
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
assert.deepEqual(splitByFreezeAnchor(more, 'n1').list.map((m) => m._id), ['n1', 'old1', 'old2', 'old3']);

console.log('房间持续刷新策略（2s 轮询 + 补订阅阈值 + 冻结锚点）测试通过');
