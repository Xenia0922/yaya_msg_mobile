const fs = require('fs');
const raw = fs.readFileSync(process.argv[2], 'utf8');
const re = /<node([^>]*)>/g;
let m;
const rows = [];
while ((m = re.exec(raw))) {
  const t = m[1];
  const g = (n) => { const x = t.match(new RegExp(n + '="([^"]*)"')); return x ? x[1] : null; };
  const b = g('bounds');
  if (!b) continue;
  const txt = g('text') || '';
  const cls = g('class') || '';
  const bm = b.match(/(\d+),(\d+)\]\[(\d+),(\d+)/);
  if (!bm) continue;
  if (process.argv[3] === 'views' && cls.includes('ViewGroup') && Number(bm[2]) > 1600 && Number(bm[4]) > 1800) {
    rows.push(`${cls.split('.').pop()}: [${bm[1]},${bm[2]}][${bm[3]},${bm[4]}]`);
  } else if (process.argv[3] !== 'views' && (txt.includes('Presented') || ['主页', '直播', '房间', '设置'].includes(txt))) {
    rows.push(`${txt}: [${bm[1]},${bm[2]}][${bm[3]},${bm[4]}]`);
  }
}
console.log(rows.join('\n'));

