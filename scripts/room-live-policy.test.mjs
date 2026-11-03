import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const ts = createRequire(import.meta.url)('typescript');
const source = readFileSync(new URL('../src/services/roomLivePolicy.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const moduleObject = { exports: {} };
vm.runInNewContext(compiled, { module: moduleObject, exports: moduleObject.exports });
const { ROOM_POLL_INTERVAL_MS, ROOM_REFRESH_LIMIT, ROOM_REJOIN_AFTER_MS } = moduleObject.exports;

assert.ok(ROOM_POLL_INTERVAL_MS > 0, '刷新间隔必须为正');
assert.ok(ROOM_POLL_INTERVAL_MS <= 2_000, '房间页需持续刷新，间隔不得超过 2s');
assert.ok(ROOM_REFRESH_LIMIT > 0 && ROOM_REFRESH_LIMIT < 100, '刷新只拉最新一小页');
assert.ok(ROOM_REJOIN_AFTER_MS >= 30_000, '补订阅不能过于频繁');
console.log('房间持续刷新策略（2s 轮询 + 补订阅阈值）测试通过');
