import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const ts = createRequire(import.meta.url)('typescript');
const source = readFileSync(new URL('../src/services/roomLivePolicy.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const moduleObject = { exports: {} };
vm.runInNewContext(compiled, { module: moduleObject, exports: moduleObject.exports });
const {
  roomPollDelay,
  ROOM_POLL_FAST_MS,
  ROOM_POLL_SLOW_MS,
  ROOM_PUSH_ALIVE_MS,
  ROOM_REFRESH_LIMIT,
} = moduleObject.exports;

const now = 1_700_000_000_000;
assert.equal(roomPollDelay(now, 0), ROOM_POLL_FAST_MS, '从未收到推送 → 快速轮询');
assert.equal(roomPollDelay(now, now - 1_000), ROOM_POLL_SLOW_MS, '刚收到推送 → 慢速轮询');
assert.equal(roomPollDelay(now, now - ROOM_PUSH_ALIVE_MS + 1), ROOM_POLL_SLOW_MS, '45s 内算长连接存活');
assert.equal(roomPollDelay(now, now - ROOM_PUSH_ALIVE_MS), ROOM_POLL_FAST_MS, '超过 45s 转快速轮询');
assert.ok(ROOM_POLL_FAST_MS <= 10_000, '快速轮询需在 10s 内，观感才接近实时');
assert.ok(ROOM_POLL_SLOW_MS >= ROOM_POLL_FAST_MS * 4, '长连接正常时应明显降频省电');
assert.ok(ROOM_REFRESH_LIMIT > 0 && ROOM_REFRESH_LIMIT < 100, '实时刷新只拉最新一小页');
console.log('房间实时策略（推送存活判定与轮询降频）测试通过');
