const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, '..', 'src');
const files = [];
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.tsx?$/.test(e.name)) files.push(p);
  }
}
walk(srcDir);

const re = /useSettingsStore\(\((\w+)\)\s*=>\s*\1\.settings\.theme\s*===\s*'dark'\)/g;
let changed = 0;
for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  if (!re.test(src)) continue;
  re.lastIndex = 0;
  const next = src.replace(re, 'useAppTheme()');
  if (next === src) continue;
  const importLine = "import { useAppTheme } from '../hooks/useAppTheme';";
  let out;
  if (next.includes(importLine)) {
    out = next;
  } else {
    const lines = next.split('\n');
    let lastImport = -1;
    for (let i = 0; i < lines.length; i++) {
      if (/^import[\s\S]*?;?\s*$/.test(lines[i]) && lines[i].trim().startsWith('import')) lastImport = i;
    }
    if (lastImport >= 0) lines.splice(lastImport + 1, 0, importLine);
    else lines.unshift(importLine + '\n');
    out = lines.join('\n');
  }
  fs.writeFileSync(file, out, 'utf8');
  console.log('updated:', path.relative(process.cwd(), file));
  changed++;
}
console.log('total files changed:', changed);
