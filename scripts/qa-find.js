const fs = require('fs');
const raw = fs.readFileSync(process.argv[2], 'utf8');
const want = new Set(process.argv[3] ? process.argv[3].split(',') : []);
const re = /<node([^>]*)>/g;
let m;
const rows = [];
while ((m = re.exec(raw))) {
  const t = m[1];
  const g = (n) => { const x = t.match(new RegExp(n + '="([^"]*)"')); return x ? x[1] : null; };
  const txt = (g('text') || '').trim();
  const b = g('bounds');
  if (!b) continue;
  const bm = b.match(/(\d+),(\d+)\]\[(\d+),(\d+)/);
  if (!bm) continue;
  if (want.size === 0 || want.has(txt)) rows.push(`${txt} [${bm[1]},${bm[2]}][${bm[3]},${bm[4]}]`);
}
console.log(rows.join('\n'));
