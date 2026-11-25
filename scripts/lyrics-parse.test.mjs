import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const ts = createRequire(import.meta.url)('typescript');
const source = readFileSync(new URL('../src/utils/lyrics.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
const sandbox = { exports: {} };
vm.runInNewContext(compiled, sandbox);
const { parseLrc, lyricIndexAt, lyricTimeForIndex } = sandbox.exports;

// 真实 LRC 头部：标题行 + 制作名单，时间戳都是 00:00
const lrc = [
  '[00:00.00]如果有你在 - SNH48 Team HII',
  '[00:00.00]词：张鹏鹏',
  '[00:00.00]曲：陈鹏杰',
  '[00:00.00]编曲：郭伟聪',
  '[00:00.00]录音：夏甄尧',
  '[00:00.00]混音：王路遥',
  '[00:00.50]OP：北京某某文化',
  '[00:12.30]夜色落在肩上',
  '[00:18.60]他说：别怕',
  '[00:24.00]我们一起唱',
].join('\n');

const lines = parseLrc(lrc);
// vm 沙箱返回的数组跨 realm，deepEqual 会因原型不同误报 → 统一比较 JSON
assert.equal(
  JSON.stringify(lines.map((l) => l.text)),
  JSON.stringify(['夜色落在肩上', '他说：别怕', '我们一起唱']),
  `制作名单与标题行必须过滤，实际=${JSON.stringify(lines.map((l) => l.text))}`,
);
assert.equal(lines[0].time, 12.3, '首句保留正确时间轴');
assert.ok(!lines.some((l) => l.text.includes('词：')), '不得残留「词：」');
assert.ok(!lines.some((l) => l.text.includes('SNH48 Team HII')), '不得残留「歌名 - 歌手」标题行');

// 正文里的冒号不能被误杀（不在白名单关键词里）
assert.ok(
  lines.some((l) => l.text === '他说：别怕'),
  '普通冒号歌词应保留',
);

// 时间轴排序 + 一行多时间戳
const multi = parseLrc('[00:20.00][00:40.00]副歌\n[00:10.00]主歌');
assert.equal(
  JSON.stringify(multi.map((l) => [l.time, l.text])),
  JSON.stringify([
    [10, '主歌'],
    [20, '副歌'],
    [40, '副歌'],
  ]),
);

// 只有制作信息 → 返回空数组（调用方显示「暂无歌词」）
assert.equal(parseLrc('[00:00.00]词：某人\n[00:00.00]曲：某人').length, 0);
assert.equal(parseLrc('').length, 0);

// 2 秒之后的「A - B」不按标题行处理（可能是歌词正文）
const late = parseLrc('[00:30.00]北京 - 上海');
assert.equal(late.length, 1, '2 秒后的破折号行不应被当标题行过滤');

// [offset:±ms] 解析 + 非负钳制
const withOffsetPlus = parseLrc('[offset:500]\n[00:10.00]第一句\n[00:20.50]第二句');
assert.equal(withOffsetPlus[0].time, 10.5, '[offset:500] 应后移 0.5 秒');
assert.equal(withOffsetPlus[1].time, 21.0, '[offset:500] 第二句应后移 0.5 秒');

const withOffsetMinus = parseLrc('[offset:-1500]\n[00:01.00]前奏歌词\n[00:10.00]主歌');
assert.equal(withOffsetMinus[0].time, 0, '负偏移不得产生负时间戳');
assert.equal(withOffsetMinus[1].time, 8.5, '[offset:-1500] 应前移 1.5 秒');

// 二分查找 lyricIndexAt + 同时间戳处理
const seq = [
  { time: 5, text: 'A' },
  { time: 12, text: 'B1' },
  { time: 12, text: 'B2' },
  { time: 25, text: 'C' },
];
assert.equal(lyricIndexAt([], 10), -1, '空歌词返回 -1');
assert.equal(lyricIndexAt(seq, 4.9), -1, '首句之前返回 -1');
assert.equal(lyricIndexAt(seq, 5), 0, '精准命中首句');
assert.equal(lyricIndexAt(seq, 11.9), 0, '两句之间取前一句');
assert.equal(lyricIndexAt(seq, 12), 2, '同时间戳取最后一条匹配');
assert.equal(lyricIndexAt(seq, 99), 3, '末句之后取最后一条');
assert.equal(lyricTimeForIndex(seq, 3), 25, 'lyricTimeForIndex 正常取值');
assert.equal(lyricTimeForIndex(seq, 99), -1, '越界返回 -1');

console.log('lyrics-parse.test: ok');
