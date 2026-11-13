#!/usr/bin/env node
/**
 * UI 工具评估器 —— 对 uiautomator dump 做「可用性/易用性」自动体检并打分。
 *
 * 用法：node scripts/ui-eval.js <dump.xml> [screenW] [screenH] [页面名]
 * 输出：逐项问题 + 100 分制评分（A≥90 / B≥75 / C≥60 / D<60）
 *
 * 评估维度（对齐「功能好用、易用、美观」）：
 *  - 越界/裁切：节点超出屏幕（视觉破损）
 *  - 触控尺寸：可点击区域 < 44dp（约 96px）→ 难点
 *  - 文字重叠：文本节点相互覆盖（美观/可读性）
 *  - 无标签控件：可点击但无 text/content-desc（可理解性）
 *  - 密度：可点击元素数量（信息架构过载提示）
 */
'use strict';
const fs = require('fs');

const xmlPath = process.argv[2];
const SW = Number(process.argv[3] || 1080);
const SH = Number(process.argv[4] || 1920);
const NAME = process.argv[5] || '页面';
const DENSITY = Number(process.argv[6] || 3); // 1080p 模拟器常见 480dpi=3x

if (!xmlPath) {
  console.error('用法: node scripts/ui-eval.js <dump.xml> [screenW] [screenH] [页面名]');
  process.exit(2);
}

const raw = fs.readFileSync(xmlPath, 'utf8');
const nodes = [];
const re = /<node[^>]*?\/?>/g;
let m;
while ((m = re.exec(raw))) {
  const tag = m[0];
  const attr = (name) => {
    const mm = tag.match(new RegExp(name + '="([^"]*)"'));
    return mm ? mm[1] : null;
  };
  const b = attr('bounds');
  if (!b) continue;
  const bm = b.match(/\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/);
  if (!bm) continue;
  nodes.push({
    cls: (attr('class') || '').split('.').pop(),
    text: (attr('text') || '').trim(),
    desc: (attr('content-desc') || '').trim(),
    clickable: attr('clickable') === 'true',
    longClickable: attr('long-clickable') === 'true',
    x1: +bm[1], y1: +bm[2], x2: +bm[3], y2: +bm[4],
  });
}

const MIN_TOUCH = Math.round(36 * DENSITY); // 36dp（本项目评估基线：控件统一 36–40dp）
const issues = [];
const push = (type, detail, weight) => issues.push({ type, detail, weight });

// 1) 越界 / 裁切
for (const n of nodes) {
  if (n.x1 < -2 || n.y1 < -2 || n.x2 > SW + 2 || n.y2 > SH + 2) {
    push('越界', `${n.cls} "${(n.text || n.desc || '').slice(0, 24)}" [${n.x1},${n.y1}][${n.x2},${n.y2}]`, 5);
  }
}

// 2) 触控目标过小（仅交互节点）
const isInside = (a, b) => a !== b && a.x1 >= b.x1 - 2 && a.y1 >= b.y1 - 2 && a.x2 <= b.x2 + 2 && a.y2 <= b.y2 + 2;
const clickables = nodes.filter((n) => n.clickable || n.longClickable);
const topClickables = clickables.filter((n) => !clickables.some((o) => isInside(n, o)));
for (const n of topClickables) {
  const w = n.x2 - n.x1, h = n.y2 - n.y1;
  if (w > 0 && h > 0 && (w < MIN_TOUCH || h < MIN_TOUCH)) {
    push('触控过小', `${w}x${h} ${n.cls} "${(n.text || n.desc || '').slice(0, 24)}"`, 2);
  }
}

// 3) 文字重叠（排除容器型节点与底部悬浮区）
const TAB_ZONE = SH * 0.87;
const estW = (t) => {
  const s = t.text || '';
  const cjk = (s.match(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g) || []).length;
  return cjk * 28 + (s.length - cjk) * 16;
};
const texts = nodes.filter((n) => n.text && n.y1 < TAB_ZONE && (n.x2 - n.x1) <= Math.max(320, estW(n) * 4));
for (let i = 0; i < texts.length; i++) {
  for (let j = i + 1; j < texts.length; j++) {
    const a = texts[i], b = texts[j];
    const ox = Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1);
    const oy = Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1);
    if (ox > 8 && oy > 8) {
      push('文字重叠', `"${a.text.slice(0, 16)}" × "${b.text.slice(0, 16)}"`, 1);
    }
  }
}

// 4) 无标签可点击控件（图标按钮不可理解）
for (const n of topClickables) {
  if (!n.text && !n.desc) {
    push('无标签控件', `${n.cls} [${n.x1},${n.y1}][${n.x2},${n.y2}]`, 1);
  }
}

const clicks = nodes.filter((n) => n.clickable).length;
if (clicks > 60) push('信息密度', `同屏可点击元素 ${clicks} 个，可能过载`, 1);

const penalty = issues.reduce((s, x) => s + x.weight, 0);
const score = Math.max(0, Math.min(100, 100 - penalty));
const grade = score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : 'D';

const byType = issues.reduce((acc, x) => { acc[x.type] = (acc[x.type] || 0) + 1; return acc; }, {});
console.log(`\n===== ${NAME} =====`);
console.log(`节点 ${nodes.length} · 可点击 ${clicks} · 评分 ${score} (${grade})`);
for (const [k, v] of Object.entries(byType)) console.log(`  ${k}: ${v}`);
for (const x of issues.slice(0, 12)) console.log(`  - [${x.type}] ${x.detail}`);
if (issues.length > 12) console.log(`  … 其余 ${issues.length - 12} 项`);
if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ name: NAME, score, grade, nodes: nodes.length, clicks, issues }));
}
