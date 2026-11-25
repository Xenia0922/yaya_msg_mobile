import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const ts = createRequire(import.meta.url)('typescript');
const source = readFileSync(new URL('../src/utils/voiceBar.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
const mod = { exports: {} };
vm.runInNewContext(compiled, { module: mod, exports: mod.exports });
const {
  VOICE_RATES,
  nextVoiceRate,
  formatVoiceTime,
  computeVoiceBarWidth,
  buildVoiceWaveform,
  computeSeekSeconds,
} = mod.exports;

assert.deepEqual([...VOICE_RATES], [1, 1.5, 2]);
assert.equal(nextVoiceRate(1), 1.5);
assert.equal(nextVoiceRate(1.5), 2);
assert.equal(nextVoiceRate(2), 1);

assert.equal(formatVoiceTime(0), '0:00');
assert.equal(formatVoiceTime(-3), '0:00');
assert.equal(formatVoiceTime(3.8), '0:03');
assert.equal(formatVoiceTime(75), '1:15');

assert.equal(computeVoiceBarWidth(1), 156);
assert.equal(computeVoiceBarWidth(20), 196);
assert.equal(computeVoiceBarWidth(120), 252);
assert.equal(computeVoiceBarWidth(0), 162);

const w1 = buildVoiceWaveform('https://mp4.48.cn/a.mp3', 24);
const w2 = buildVoiceWaveform('https://mp4.48.cn/a.mp3', 24);
const w3 = buildVoiceWaveform('https://mp4.48.cn/b.mp3', 24);
assert.equal(w1.length, 24);
assert.deepEqual(w1, w2, '同音频地址生成确定性声纹');
assert.notDeepEqual(w1, w3, '不同音频地址声纹有差异');
assert.ok(w1.every((v) => v >= 0.26 && v <= 1));

assert.equal(computeSeekSeconds(-10, 100, 20), 0);
assert.equal(computeSeekSeconds(50, 100, 20), 10);
assert.equal(computeSeekSeconds(140, 100, 20), 20);
assert.equal(computeSeekSeconds(50, 0, 20), 0);

console.log('统一语音条工具函数测试通过');
