const fs = require('fs');
let duplicates = 0;
for (const l of ['zh-Hant', 'en', 'ja', 'ko']) {
  const s = fs.readFileSync('src/i18n/' + l + '.ts', 'utf8');
  const keys = [];
  for (const line of s.split(/\r?\n/)) {
    let m = line.match(/^\s*'([^']*)'\s*:/);
    if (m) {
      keys.push(m[1]);
      continue;
    }
    m = line.match(/^\s*([^'":][^:\n]*?)\s*:/);
    if (m) keys.push(m[1]);
  }
  const seen = new Map();
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    if (seen.has(k)) {
      duplicates++;
      console.log(`DUP in ${l}: "${k}" (line ${seen.get(k) + 1} and ${i + 1})`);
    }
    seen.set(k, i);
  }
}
console.log(duplicates === 0 ? '✅ 四份词典均无重复 key' : `⚠️ 共发现 ${duplicates} 个重复 key`);
// 供 CI 使用：--fail 时存在重复 key 必须让命令失败。
if (process.argv.includes('--fail') && duplicates > 0) process.exit(1);
