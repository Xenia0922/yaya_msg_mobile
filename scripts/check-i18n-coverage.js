#!/usr/bin/env node
/**
 * i18n 覆盖率检查（全量）。
 *
 * 背景：原脚本只扫 3 个文件（LoginScreen / SettingsScreen / navigation），给出的是虚假安全感。
 * 现改为扫描 src 下全部 ts/tsx，收集 `t('中文原文')` 用到的 key，与四份词典比对。
 *
 * 用法：
 *   node scripts/check-i18n-coverage.js           # 报告
 *   node scripts/check-i18n-coverage.js --fail    # 有缺失时 exit 1（供 CI 用）
 *
 * 说明：zh-Hans 以中文原文为 key（无词典），因此只比对 zh-Hant/en/ja/ko。
 * 缺失不代表报错——`t()` 会回退中文原文；这里用于量化「还需补哪些翻译」。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const LANGS = ['zh-Hant', 'en', 'ja', 'ko'];

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      if (name === 'i18n') continue; // 词典自身不扫
      walk(p, out);
    } else if (/\.(tsx?|jsx?)$/.test(name)) out.push(p);
  }
  return out;
}

const used = new Map(); // key -> Set(file)
for (const file of walk(SRC)) {
  const s = fs.readFileSync(file, 'utf8');
  // 注意：`translate('x')` 也收录；跳过 t(`...`) 里的模板变量（含 ${ 的不算可静态校验的 key）
  for (const m of s.matchAll(/\bt\(\s*['`]([^'`$]+)['`]/g)) {
    const key = m[1];
    if (!key.trim()) continue;
    if (!used.has(key)) used.set(key, new Set());
    used.get(key).add(path.relative(ROOT, file).replace(/\\/g, '/'));
  }
}

function loadDict(lang) {
  const s = fs.readFileSync(path.join(SRC, 'i18n', lang + '.ts'), 'utf8');
  const keys = new Set();
  for (const line of s.split(/\r?\n/)) {
    let m = line.match(/^\s*'([^']*)'\s*:/);
    if (m) {
      keys.add(m[1]);
      continue;
    }
    m = line.match(/^\s*([^'":][^:\n]*?)\s*:\s*['"`]/);
    if (m) keys.add(m[1].trim());
  }
  return keys;
}

const dicts = {};
for (const l of LANGS) dicts[l] = loadDict(l);

console.log(`扫描到 ${used.size} 个可静态校验的 i18n key（全 src）`);
let totalMissing = 0;
const rows = [];
for (const [key, files] of used) {
  const miss = LANGS.filter((l) => !dicts[l].has(key));
  if (miss.length) {
    totalMissing += 1;
    rows.push({ key, miss, where: [...files].slice(0, 2).join(',') });
  }
}
rows.sort((a, b) => a.miss.length - b.miss.length || a.key.localeCompare(b.key));
for (const r of rows.slice(0, 200)) {
  console.log(` - ${r.key}  [缺 ${r.miss.join(',')}]  ${r.where}`);
}
if (rows.length > 200) console.log(` ... 其余 ${rows.length - 200} 条省略`);
console.log(`\n缺失翻译的 key：${totalMissing} 个（回退中文原文，不影响运行）`);
if (process.argv.includes('--fail') && totalMissing > 0) process.exit(1);
