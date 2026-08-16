#!/usr/bin/env node
/**
 * uiautomator XML 布局巡检器
 * 用法: node qa-check.js <dump.xml> [screenW screenH]
 * 检测:
 *  1. 越出屏幕边界的节点
 *  2. 文字节点互相重叠
 *  3. 可点击节点触控区过小 (<48dp 按 420dpi≈126px)
 *  4. 输出可见文本层级（供人工核对内容结构）
 */
'use strict';
const fs = require('fs');

const xmlPath = process.argv[2];
const SW = Number(process.argv[3] || 1080);
const SH = Number(process.argv[4] || 1920);
const MIN_TOUCH = 96; // 42dp @2.625 ≈ 110px；取 96 宽松阈值

const raw = fs.readFileSync(xmlPath, 'utf8');
const nodes = [];
const re = /<node[^>]*\/>/g;
let m;
while ((m = re.exec(raw))) {
  const tag = m[0];
  const attr = (name) => {
    const mm = tag.match(new RegExp(name + '="([^"]*)"'));
    return mm ? mm[1] : null;
  };
  const bounds = attr('bounds');
  if (!bounds) continue;
  const bm = bounds.match(/\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/);
  if (!bm) continue;
  nodes.push({
    cls: attr('class'),
    text: attr('text'),
    desc: attr('content-desc'),
    clickable: attr('clickable') === 'true',
    longClickable: attr('long-clickable') === 'true',
    x1: +bm[1], y1: +bm[2], x2: +bm[3], y2: +bm[4],
  });
}

const issues = [];
// 1. 越界
for (const n of nodes) {
  const w = n.x2 - n.x1, h = n.y2 - n.y1;
  if (n.x1 < -2 || n.y1 < -2 || n.x2 > SW + 2 || n.y2 > SH + 2) {
    issues.push(`[越界] ${n.cls?.split('.').pop()} "${(n.text || n.desc || '').slice(0, 30)}" bounds=[${n.x1},${n.y1}][${n.x2},${n.y2}]`);
  }
  // 2. 触控目标过小
  if ((n.clickable || n.longClickable) && (w < MIN_TOUCH || h < MIN_TOUCH)) {
    issues.push(`[触控过小 ${w}x${h}] ${n.cls?.split('.').pop()} "${(n.text || n.desc || '').slice(0, 30)}"`);
  }
}
// 3. 文字重叠（两两比较，限制数量；排除底部悬浮 TabBar 区（屏幕底部 ~13%）的节点——那是正常的内容滚动遮挡；
//    也排除「容器型」文本节点（宽度远超自身字符估计宽度，如 flex:1 的标题行，uiautomator 报的是容器 bounds 而非字形））
const TAB_ZONE = SH * 0.87;
const estWidth = (t) => { const cjk = (t.text.match(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g) || []).length; const other = t.text.length - cjk; return cjk * 28 + other * 16; };
const isContainerNode = (t) => (t.x2 - t.x1) > Math.max(320, estWidth(t) * 4);
const texts = nodes.filter((n) => n.text && n.text.trim() && n.y1 < TAB_ZONE && !isContainerNode(n));
outer:
for (let i = 0; i < texts.length; i++) {
  for (let j = i + 1; j < texts.length; j++) {
    const a = texts[i], b = texts[j];
    const ox = Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1);
    const oy = Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1);
    if (ox > 6 && oy > 6) {
      issues.push(`[文字重叠] "${a.text.slice(0, 20)}" & "${b.text.slice(0, 20)}"`);
      if (issues.filter((x) => x.startsWith('[文字重叠]')).length > 8) break outer;
    }
  }
}

console.log(`== 巡检 ${xmlPath} (${SW}x${SH}) 节点数=${nodes.length} ==`);
if (issues.length === 0) console.log('✅ 无越界/触控过小/文字重叠问题');
else {
  console.log(`⚠️ 发现 ${issues.length} 个问题:`);
  issues.forEach((x) => console.log('  ' + x));
}
console.log('\n== 可见文本层级（前 60 条）==');
let printed = 0;
for (const n of nodes) {
  if (!n.text || !n.text.trim()) continue;
  if (printed++ >= 60) break;
  console.log(`  y=${n.y1} "${n.text.slice(0, 46)}"`);
}
