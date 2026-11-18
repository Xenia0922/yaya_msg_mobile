#!/usr/bin/env node
/**
 * 未使用样式检查（全量）。
 *
 * 背景：项目里 `StyleSheet.create({...})` 常年累积死样式（改名/删组件后遗留），
 * 原脚本只扫 SettingsScreen 一个文件、且用正则粗暴剥离，基本形同虚设。
 *
 * 用法：
 *   node scripts/unused-styles-check.js          # 只报告
 *   node scripts/unused-styles-check.js --fail   # 有未使用样式时 exit 1（供 CI 用）
 *
 * 判定：抽出 `const styles = StyleSheet.create({ ... })` 里的顶层 key，
 * 若文件内除定义外再无 `styles.<key>` 引用（也不存在 `styles[...]` 动态访问），即视为未使用。
 * 动态访问存在时保守跳过该文件，避免误删。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SCAN_DIRS = ['src/screens', 'src/components', 'src/player', 'src/hooks', 'src/navigation'];
const EXTS = new Set(['.tsx', '.ts']);

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (EXTS.has(path.extname(p))) out.push(p);
  }
  return out;
}

/** 取 StyleSheet.create 里第一层的 key（按行首缩进的 `key: {` 识别） */
function styleKeys(src) {
  const m = src.match(/StyleSheet\.create\(\s*\{([\s\S]*?)\}\s*\)/);
  if (!m) return [];
  const body = m[1];
  const keys = [];
  let depth = 0;
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    // 只有在 depth===0 时的 `key: {` 才是顶层样式名
    if (depth === 0) {
      const km = trimmed.match(/^([A-Za-z_$][\w$]*)\s*:\s*\{/);
      if (km) keys.push(km[1]);
    }
    for (const ch of line) {
      if (ch === '{') depth += 1;
      else if (ch === '}') depth -= 1;
    }
  }
  return keys;
}

const files = [];
for (const d of SCAN_DIRS) walk(path.join(ROOT, d), files);

let totalUnused = 0;
const report = [];
for (const file of files) {
  let src;
  try {
    src = fs.readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  if (!/StyleSheet\.create\(/.test(src)) continue;
  const keys = styleKeys(src);
  if (!keys.length) continue;
  // 动态访问 styles[...] → 跳过（无法静态判定）
  if (/styles\s*\[/.test(src)) {
    report.push({ file, skipped: '动态访问 styles[...]' });
    continue;
  }
  // 共享样式模块（如 screens/home/styles.ts）：键被同目录组件引用，需要跨文件统计
  let refSrc = src;
  if (path.basename(file) === 'styles.ts') {
    try {
      const dirs = [path.dirname(file), path.dirname(path.dirname(file))];
      refSrc = dirs
        .flatMap((d) => {
          try {
            return fs
              .readdirSync(d)
              .filter((n) => /\.(ts|tsx)$/.test(n) && n !== 'styles.ts')
              .map((n) => fs.readFileSync(path.join(d, n), 'utf8'));
          } catch {
            return [];
          }
        })
        .join('\n');
    } catch {}
  }
  const unused = keys.filter((k) => {
    const re = new RegExp('styles\\.' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\w$])');
    // 去掉定义本身后再数引用（定义是 `k: {`，不含 `styles.k`，因此直接全文件搜索即可）
    return !re.test(refSrc);
  });
  if (unused.length) {
    totalUnused += unused.length;
    report.push({ file, unused });
  }
}

const rel = (p) => path.relative(ROOT, p).replace(/\\/g, '/');
console.log(`扫描 ${files.length} 个文件；发现未使用样式 ${totalUnused} 个`);
for (const r of report) {
  if (r.skipped) {
    console.log(`\n${rel(r.file)}  [跳过：${r.skipped}]`);
  } else if (r.unused) {
    console.log(`\n${rel(r.file)}`);
    console.log('  - ' + r.unused.join(', '));
  }
}
if (process.argv.includes('--fail') && totalUnused > 0) process.exit(1);
