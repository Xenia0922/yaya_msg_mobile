// 时长归一 findMediaDurationSeconds 单元测试。
// 运行：`node node_modules/tsx/dist/cli.mjs __tests__/mediaDuration.test.ts`

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findMediaDurationSeconds } from '../src/utils/mediaDuration';

test('秒字段直接采用', () => {
  assert.equal(findMediaDurationSeconds({ duration: 18 }), 18);
  // parseDurationSeconds 不自动 round（调用方即 roomMedia 那侧用 Math.round）—— 这里用全数验证
  assert.equal(findMediaDurationSeconds({ audioTime: 12.5 }), 12.5);
  assert.equal(findMediaDurationSeconds({ videoTime: 120 }), 120);
  assert.equal(findMediaDurationSeconds({ voiceLength: 8 }), 8);
  // 调用方常规 round 行为
  assert.equal(Math.round(findMediaDurationSeconds({ audioTime: 12.5 })), 13);
});

test('毫秒字段自动 ÷1000', () => {
  assert.equal(findMediaDurationSeconds({ audioTimeMs: 18300 }), 18); // 18.3s
  assert.equal(findMediaDurationSeconds({ durationMs: 12345 }), 12);
  assert.equal(findMediaDurationSeconds({ videoTimeMs: 60000 }), 60);
  assert.equal(findMediaDurationSeconds({ voiceLengthMs: '5500' }), 6); // 字符串值
});

test('毫秒后缀兜底（*Ms / *Millis / *MsTime）', () => {
  assert.equal(findMediaDurationSeconds({ customMs: 18320 }), 18);
  assert.equal(findMediaDurationSeconds({ someCustomMsTime: 18320 }), 18);
  assert.equal(findMediaDurationSeconds({ customMillis: 12345 }), 12);
});

test('超大值按毫秒兜底（语音不太可能 > 2h）', () => {
  // 字段名不在白名单，但值 > 7200 s：视作毫秒 ÷1000
  assert.equal(findMediaDurationSeconds({ unknown: 183000 }), 183); // 3min
  assert.equal(findMediaDurationSeconds({ answer: 5000000 }), 5000); // 1h23min
});

test('wide `time` 字段不再误命中', () => {
  // 旧 DURATION_KEYS 含 'time'，会被 messageTime 这种 Unix 时间戳当作秒，巨大秒数。
  // 现已显式剔除：值 1724123456 作为 n<=86400 不接受，应走 > MS_PLAUSIBLE_MAX 直接丢 0。
  assert.equal(findMediaDurationSeconds({ time: 1724123456 }), 0);
  assert.equal(findMediaDurationSeconds({ seconds: 123 }), 0); // 'seconds' 也不在白名单
  assert.equal(findMediaDurationSeconds({ length: 123 }), 0);   // 'length' 太宽
});

test('嵌套深找', () => {
  // 服务端把 audioTime 嵌在 body.attachment.audio 里
  const msg = { body: { attachment: { audio: { audioTimeMs: 18500 } } } };
  assert.equal(findMediaDurationSeconds(msg), 19);
  // 顶层带 ext.voice.length（毫秒用 *Ms 命中）
  const msg2 = { ext: { voice: { lengthMs: '12340' } } };
  assert.equal(findMediaDurationSeconds(msg2), 12);
});

test('非法值', () => {
  assert.equal(findMediaDurationSeconds(0), 0);
  assert.equal(findMediaDurationSeconds(-1), 0);
  assert.equal(findMediaDurationSeconds(null), 0);
  assert.equal(findMediaDurationSeconds(undefined), 0);
  assert.equal(findMediaDurationSeconds({}), 0);
  assert.equal(findMediaDurationSeconds({ duration: -5 }), 0);
  assert.equal(findMediaDurationSeconds({ duration: 1e12 }), 0); // 远超 24h，丢弃
});

test('多源 reduce 优先级（item > ext > body）', () => {
  // 模拟 roomMedia 入口：[item, ext, body].reduce((best, src) => best || findMediaDurationSeconds(src), 0)
  const item = { audioTimeMs: 18500 };
  const ext = { audioTimeMs: 500 }; // 错误的更小秒
  const body = { duration: 99 };
  const collect = (srcs: any[]) => srcs.reduce((best, src) => best || findMediaDurationSeconds(src), 0);
  // item 优先返回 19（18500ms），ext/body 被忽略
  assert.equal(collect([item, ext, body]), 19);
  // item 无值 → 退到 ext
  assert.equal(collect([{}, ext, body]), 1); // 500ms -> 1
  // 都不命中秒字段
  assert.equal(collect([{}, {}, {}]), 0);
});
