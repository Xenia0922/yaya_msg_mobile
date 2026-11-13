const fs = require('fs');
const raw = fs.readFileSync(process.argv[2], 'utf8');
const re = /<node[^>]*text="([^"]*)"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/g;
let m;
while ((m = re.exec(raw))) {
  const txt = m[1];
  if (process.argv[3] && !txt.includes(process.argv[3])) continue;
  console.log(`${txt}: [${m[2]},${m[3]}][${m[4]},${m[5]}]`);
}
