import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = readFileSync(new URL('../src/utils/updateCache.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
const module = { exports: {} };
vm.runInNewContext(code, { module, exports: module.exports });
const {
  localTodayKey,
  parseUpdateCache,
  isNewerVersion,
  shouldPromptDailyUpdate,
  evaluateUpdateFromCache,
} = module.exports;

assert.equal(localTodayKey(new Date(2026, 10, 5, 9, 30)), '2026-11-05');
assert.equal(isNewerVersion('v2.10.0', '2.9.0'), true);
assert.equal(isNewerVersion('v2.9.0', '2.9.0'), false);
assert.equal(isNewerVersion('2.8.9', '2.9.0'), false);

const legacy = parseUpdateCache('1732200000000');
assert.equal(legacy.checkedDate, '');
assert.equal(legacy.checkedAt, 1732200000000);
assert.equal(legacy.latestTag, '');

const corrupt = parseUpdateCache('{bad-json');
assert.equal(corrupt.checkedDate, '');
assert.equal(corrupt.latestTag, '');

const cached = parseUpdateCache(
  JSON.stringify({
    checkedDate: '2026-11-22',
    checkedAt: 1795320000000,
    latestTag: 'v2.9.1',
    latestUrl: '',
    releaseNotes: '- 修复若干问题',
  }),
);

const sameDayFirstPrompt = evaluateUpdateFromCache(
  cached,
  '2.9.0',
  '',
  '2026-11-22',
  'https://gnz48.tech/app/',
);
assert.equal(sameDayFirstPrompt.hasUpdate, true);
assert.equal(sameDayFirstPrompt.latestVersion, 'v2.9.1');
assert.equal(sameDayFirstPrompt.latestUrl, 'https://gnz48.tech/app/');
assert.equal(sameDayFirstPrompt.releaseNotes, '- 修复若干问题');
assert.equal(sameDayFirstPrompt.pendingDailyPrompt, true);

const sameDayRepeat = evaluateUpdateFromCache(
  cached,
  '2.9.0',
  '2026-11-22',
  '2026-11-22',
  'https://gnz48.tech/app/',
);
assert.equal(sameDayRepeat.hasUpdate, true);
assert.equal(sameDayRepeat.pendingDailyPrompt, false);

const nextDayUnupdated = evaluateUpdateFromCache(
  cached,
  '2.9.0',
  '2026-11-22',
  '2026-11-23',
  'https://gnz48.tech/app/',
);
assert.equal(nextDayUnupdated.hasUpdate, true);
assert.equal(nextDayUnupdated.pendingDailyPrompt, true);

const afterUpgrade = evaluateUpdateFromCache(
  cached,
  '2.9.1',
  '2026-11-22',
  '2026-11-23',
  'https://gnz48.tech/app/',
);
assert.equal(afterUpgrade.hasUpdate, false);
assert.equal(afterUpgrade.latestVersion, '');
assert.equal(afterUpgrade.pendingDailyPrompt, false);

assert.equal(
  shouldPromptDailyUpdate({ hasUpdate: true, force: true, promptedDate: '', today: '2026-11-22' }),
  false,
);
assert.equal(
  shouldPromptDailyUpdate({
    hasUpdate: false,
    force: false,
    promptedDate: '',
    today: '2026-11-22',
  }),
  false,
);

console.log('每日更新检测与弹窗频控测试通过');
