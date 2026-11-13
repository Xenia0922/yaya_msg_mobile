const fs = require('fs');

const files = ['src/screens/LoginScreen.tsx', 'src/screens/SettingsScreen.tsx', 'src/navigation/index.tsx'];
const used = new Set();
for (const f of files) {
  const s = fs.readFileSync(f, 'utf8');
  for (const m of s.matchAll(/t\(['`]([^'`]+)['`]/g)) used.add(m[1]);
}

const langs = {};
for (const l of ['zh-Hant', 'en', 'ja', 'ko']) {
  const s = fs.readFileSync('src/i18n/' + l + '.ts', 'utf8');
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
console.log('missing in some dict:');
let any = false;
for (const k of used) {
  const miss = Object.entries(langs).filter(([, set]) => !set.has(k)).map(([n]) => n);
  if (miss.length) { any = true; console.log(' - ' + k + ' [' + miss.join(',') + ']'); }
}
if (!any) console.log(' (none)');
