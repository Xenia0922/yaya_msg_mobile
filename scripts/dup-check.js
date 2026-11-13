const fs = require('fs');
for (const l of ['zh-Hant', 'en', 'ja', 'ko']) {
  const s = fs.readFileSync('src/i18n/' + l + '.ts', 'utf8');
  const keys = [];
  for (const line of s.split(/\r?\n/)) {
    let m = line.match(/^\s*'([^']*)'\s*:/);
    if (m) { keys.push(m[1]); continue; }
    m = line.match(/^\s*([^'":][^:\n]*?)\s*:/);
    if (m) keys.push(m[1]);
  }
  const seen = new Map();
  for (const k of keys) {
    if (seen.has(k)) console.log('DUP in ' + l + ': "' + k + '" (line ' + (seen.get(k) + 1) + ' and ' + keys.indexOf(k) + 1 + ')');
    seen.set(k, keys.indexOf(k));
  }
}
