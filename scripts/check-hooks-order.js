// 检查屏幕文件：顶层条件 return 之后是否还声明了 hook（hooks 顺序违规 → 运行时崩溃）
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, '..', 'src', 'screens');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.tsx'));
const hookRe = /^\s{2}(?:const\s+\w+\s*=\s*use(?:State|Memo|Callback|Ref|Effect)|use(?:Effect|FocusEffect)\(|useRef<)/;
let bad = 0;
for (const file of files) {
  const lines = fs.readFileSync(path.join(dir, file), 'utf8').split('\n');
  // 找顶层 "if (...) {" + return 的模式（缩进 2 空格）
  let sawReturn = false;
  const after = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!sawReturn && /^  (?:if|else if|switch)\s*\(/.test(line) && /return\s*\(/.test(line.slice(line.indexOf('{')) || line)) {
      // 该 if 块内含 return —— 先检查后续行
      sawReturn = true;
      continue;
    }
    if (sawReturn) {
      const trimmed = line.trim();
      if (/^return\s*\(/.test(trimmed) || trimmed === ')' || trimmed.startsWith('</') || trimmed === ');' || trimmed.startsWith('}')) {
        // 继续：可能处于 return 的 JSX 中
        if (trimmed === ');' && line.startsWith('  ')) { sawReturn = false; }
        continue;
      }
      if (hookRe.test(line)) after.push(i + 1 + ': ' + line.trim().slice(0, 70));
    }
  }
  if (after.length) {
    bad++;
    console.log(`\n### ${file}`);
    after.forEach((a) => console.log('  ' + a));
  }
}
console.log(bad === 0 ? '\n✅ 无「条件 return 后声明 hook」的文件' : `\n⚠️ ${bad} 个文件存在疑似 hooks 顺序违规`);
