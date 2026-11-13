/**
 * 富文本清洗单测（防「官方 HTML 弹幕/消息把标签当文字显示」回归）。
 * 运行：node scripts/html-text.test.mjs
 *
 * 说明：Node 22+ 原生支持导入 .ts（类型剥离），这里直接 import 真实模块，避免复制实现。
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const mod = await import(pathToFileURL(path.join(__dirname, '..', 'src', 'utils', 'html.ts')).href);
const { looksLikeHtml, htmlToPlain, sanitizeText, extractHtmlImageUrls } = mod;

let failures = 0;
function eq(actual, expected, name) {
  if (actual !== expected) {
    failures += 1;
    console.error(`✗ ${name}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`);
  } else {
    console.log(`✓ ${name}`);
  }
}

// 1) 用户实测截图里的真实样本（直播弹幕）
const sample =
  '我真的变心了（北女一梦女版）：<div><span style="color:#ffffff; vertical-align:middle;">欢迎</span>' +
  '<span style="color:3b059a; vertical-align:middle;">黄宣绮</span>' +
  '<img style="vertical-align:middle;" src="/backstage/2026/0810/b4bvoiuxrmwuo5mk65vhhxd.webp" /></div>';
eq(looksLikeHtml(sample), true, '识别 HTML 弹幕');
const plain = htmlToPlain(sample);
eq(plain.includes('<'), false, '清洗后不含 <');
eq(plain.includes('我真的变心了'), true, '保留前缀文字');
eq(plain.includes('欢迎'), true, '保留 span 内文（欢迎）');
eq(plain.includes('黄宣绮'), true, '保留 span 内文（黄宣绮）');

// 2) 普通文本不能被误伤
eq(looksLikeHtml('a<b 且 c>d'), false, '普通比较符不算 HTML');
eq(sanitizeText('a<b 且 c>d'), 'a<b 且 c>d', '普通文本原样返回');

// 3) 实体与换行
eq(htmlToPlain('<div>a<br/>b</div><div>c&amp;d</div>').replace(/\n+/g, '|'), 'a|b|c&d', 'br/div 转行 + &amp; 解码');

// 4) 图片提取（相对路径保留）
const imgs = extractHtmlImageUrls(sample);
eq(imgs.length, 1, '提取 1 张图');
eq(imgs[0], '/backstage/2026/0810/b4bvoiuxrmwuo5mk65vhhxd.webp', '图片 src 正确');

// 5) script/style 内容被丢弃
eq(htmlToPlain('<style>.a{color:red}</style><span>ok</span>'), 'ok', '丢弃 style 块');

if (failures) {
  console.error(`\n${failures} 项失败`);
  process.exit(1);
}
console.log('\n全部通过');
