import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = readFileSync(new URL('../src/screens/FlipScreen.tsx', import.meta.url), 'utf8');
const start = source.indexOf('function parseMedia(');
const end = source.indexOf('function answerMediaUrl(', start);
assert.ok(start >= 0 && end > start);
const code = ts.transpileModule(`${source.slice(start, end)}\nexports.parseAnswer = parseAnswer;`, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const exports = {};
vm.runInNewContext(code, {
  exports,
  normalizeUrl: (value) => value || '',
  parseDurationSeconds: Number,
  pickText: (item, keys, fallback = '') => keys.map((key) => item?.[key]).find((value) => typeof value === 'string' && value) || fallback,
});
for (const status of [1, 3, '1']) {
  const answer = exports.parseAnswer({ status, answerType: 2, voiceUrl: 'https://example.invalid/voice' });
  assert.equal(answer.text, '', '等待或退款状态不能显示回复');
  assert.equal(answer.url, '');
}
const answered = exports.parseAnswer({ status: 2, answerType: 2, voiceUrl: 'https://example.invalid/voice' });
assert.equal(answered.text, '语音回复');
assert.equal(answered.url, 'https://example.invalid/voice');
console.log('翻牌回复状态测试通过');
