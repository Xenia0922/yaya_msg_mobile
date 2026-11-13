#!/usr/bin/env node
// Scan all src .ts/.tsx for t()/translate() keys, report keys missing from each dict
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const srcDir = path.join(root, 'src');

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === '.git') continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

const files = walk(srcDir);
const used = new Set();
for (const f of files) {
  const s = fs.readFileSync(f, 'utf8');
  // t('key'), t("key"), translate('key'), translate("key")
  for (const m of s.matchAll(/\b(?:t|translate)\(\s*['"`]([^'"`\n]+)['"`]\s*(?:,|\))/g)) {
    used.add(m[1]);
  }
}

const langs = {};
for (const l of ['zh-Hant', 'en', 'ja', 'ko']) {
  const s = fs.readFileSync(path.join(root, 'src/i18n', l + '.ts'), 'utf8');
  const keys = [];
  for (const line of s.split(/\r?\n/)) {
    let m = line.match(/^\s*'([^']*)'\s*:/);
    if (m) { keys.push(m[1]); continue; }
    m = line.match(/^\s*([^'":][^:\n]*?)\s*:/);
    if (m) keys.push(m[1]);
  }
  langs[l] = new Set(keys);
  const dup = [...new Set(keys.filter((k, i) => keys.indexOf(k) !== i))];
  if (dup.length) console.log('DUP in ' + l + ': ' + dup.join(' | '));
}

console.log('used keys:', used.size);
let missing = 0;
const missingList = [];
for (const k of [...used].sort()) {
  const miss = Object.entries(langs).filter(([, set]) => !set.has(k)).map(([n]) => n);
  if (miss.length) {
    missing++;
    missingList.push({ k, miss });
    console.log(' - ' + k + ' [' + miss.join(',') + ']');
  }
}
console.log('missing total:', missing);
fs.writeFileSync(path.join(root, '..', 'coverage-report.txt'),
  'used keys: ' + used.size + '\nmissing total: ' + missing + '\n\n' +
  missingList.map((m) => JSON.stringify(m.k)).join('\n') + '\n', 'utf8');
