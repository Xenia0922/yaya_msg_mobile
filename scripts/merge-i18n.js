#!/usr/bin/env node
// Merge missing keys from a JSON file (argv[2]) into the 4 dict .ts files.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const data = JSON.parse(fs.readFileSync(path.join(__dirname, process.argv[2] || 'new-keys.json'), 'utf8'));
const langs = { 'zh-Hant': 'zh-Hant', en: 'en', ja: 'ja', ko: 'ko' };

function parseKeys(s) {
  const keys = [];
  for (const line of s.split(/\r?\n/)) {
    let m = line.match(/^\s*'([^']*)'\s*:/);
    if (m) { keys.push(m[1]); continue; }
    m = line.match(/^\s*([^'":][^:\n]*?)\s*:/);
    if (m) keys.push(m[1]);
  }
  return new Set(keys);
}

function q(s) {
  return "'" + s.replace(/'/g, "\\'") + "'";
}

let total = 0;
for (const [lang, file] of Object.entries(langs)) {
  const filePath = path.join(root, 'src/i18n', file + '.ts');
  let s = fs.readFileSync(filePath, 'utf8');
  const existing = parseKeys(s);
  const lines = s.split(/\r?\n/);
  const out = [];
  for (const [key, tr] of Object.entries(data)) {
    if (existing.has(key)) continue;
    if (!tr[lang]) continue;
    out.push('  ' + q(key) + ': ' + q(tr[lang]) + ',');
  }
  if (out.length) {
    const closeIdx = lines.findIndex((l, i) => /^\};$/.test(l.trim()) && i > 0);
    const insertIdx = closeIdx === -1 ? lines.length - 1 : closeIdx;
    const newLines = [...lines.slice(0, insertIdx), ...out, ...lines.slice(insertIdx)];
    fs.writeFileSync(filePath, newLines.join('\n'), 'utf8');
  }
  total += out.length;
  console.log(lang + ': added ' + out.length);
}
console.log('total added:', total);
