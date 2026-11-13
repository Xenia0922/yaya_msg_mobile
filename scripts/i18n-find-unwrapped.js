#!/usr/bin/env node
// Find Chinese text in src/screens + src/components that is NOT inside t()/translate()
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dirs = [path.join(root, 'src/screens'), path.join(root, 'src/components')];

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.tsx$/.test(name)) out.push(full);
  }
  return out;
}

const results = [];
for (const dir of dirs) {
  for (const f of walk(dir)) {
    const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];
      const trimmed = line.trim();
      if (!/[\u4e00-\u9fff]/.test(trimmed)) continue;
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
      // strip t('...')/translate('...') spans
      const stripped = trimmed
        .replace(/\b(?:t|translate)\(\s*['"][^'"`]*['"]\s*(?:,|\))/g, '')
        .replace(/\b(?:t|translate)\(\s*`[^`]*`\s*(?:,|\))/g, '');
      if (!/[\u4e00-\u9fff]/.test(stripped)) continue;
      // skip known data-ish lines: arrays of member names/rooms etc.
      results.push(f.slice(root.length + 1) + ':' + (i + 1) + '  ' + trimmed.slice(0, 140));
    }
  }
}
fs.writeFileSync(path.join(root, '..', 'untranslated-report.txt'), results.join('\n') + '\n', 'utf8');
console.log('hits:', results.length);
