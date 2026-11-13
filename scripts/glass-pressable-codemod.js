/**
 * codemod v4：把「按压容器 + GlassBackground 铺底 + 兄弟内容」转成
 * 「按压容器在外 / 玻璃在内 / 内容进玻璃」。
 *
 * 与 v3 的区别：v3 直接把容器标签改成 GlassSurface（于是 onPress/activeOpacity/pressedScale
 * 这些按压属性残留到玻璃上 → 类型错误，且按压行为丢失）。
 * v4 保留按压容器，把它的 style 挪给插入的 GlassSurface，内容整体进玻璃。
 *
 * 只处理能可靠定位的形态，其余跳过并打印。
 */
const fs = require('fs');
const path = require('path');

const files = process.argv.slice(2);
const PRESSABLE = 'TouchableOpacity|ScalePressable|Pressable';
let converted = 0;
let skipped = 0;

for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  const lines = src.split('\n');
  const indentOf = (s) => (s.match(/^\s*/) || [''])[0].length;
  let fileConverted = 0;

  // 从后往前处理，避免行号漂移
  for (let i = lines.length - 1; i >= 0; i--) {
    const gm = lines[i].match(/^(\s*)<GlassBackground radius=\{(\d+)\}(?:\s+refract=\{false\})?\s*\/>\s*$/);
    if (!gm) continue;
    const glassIndent = indentOf(lines[i]);
    const radius = gm[2];

    // 1) 往上找按压容器开标签
    let openIdx = -1;
    let tag = '';
    for (let j = i - 1; j >= 0; j--) {
      const om = lines[j].match(new RegExp(`^\\s*<(${PRESSABLE})[\\s>]`));
      if (om && indentOf(lines[j]) < glassIndent) {
        openIdx = j;
        tag = om[1];
        break;
      }
    }
    if (openIdx < 0) {
      console.log(`  skip(非按压容器): ${path.basename(file)}:${i + 1}`);
      skipped++;
      continue;
    }

    // 2) 找开标签结束行（该行以 `>` 结尾）
    let openEnd = -1;
    for (let j = openIdx; j < i; j++) {
      if (/^\s*>?\s*$/.test(lines[j].trim()) === false && />\s*$/.test(lines[j])) {
        openEnd = j;
        break;
      }
      if (/^\s*>\s*$/.test(lines[j])) {
        openEnd = j;
        break;
      }
    }
    if (openEnd < 0) {
      console.log(`  skip(开标签未闭合): ${path.basename(file)}:${i + 1}`);
      skipped++;
      continue;
    }

    // 3) 在开标签块里抽出 style 属性（可能跨行：style={[ ... ]} 或 style={X}）
    const block = lines.slice(openIdx, openEnd + 1);
    let styleStart = -1;
    let styleEnd = -1;
    let depth = 0;
    for (let k = 0; k < block.length; k++) {
      if (styleStart < 0 && /\bstyle=\{/.test(block[k])) {
        styleStart = k;
        depth = (block[k].match(/\{/g) || []).length - (block[k].match(/\}/g) || []).length;
        if (depth <= 0) styleEnd = k;
      } else if (styleStart >= 0 && styleEnd < 0) {
        depth += (block[k].match(/\{/g) || []).length - (block[k].match(/\}/g) || []).length;
        if (depth <= 0) {
          styleEnd = k;
          break;
        }
      }
    }
    if (styleStart < 0) {
      console.log(`  skip(无 style 可挪): ${path.basename(file)}:${i + 1}`);
      skipped++;
      continue;
    }

    // 4) 容器闭标签
    const closeRe = new RegExp(`^\\s*</${tag}>\\s*$`);
    const containerIndent = indentOf(lines[openIdx]);
    let closeIdx = -1;
    for (let j = i + 1; j < lines.length; j++) {
      if (indentOf(lines[j]) === containerIndent && closeRe.test(lines[j])) {
        closeIdx = j;
        break;
      }
    }
    if (closeIdx < 0) {
      console.log(`  skip(无闭标签): ${path.basename(file)}:${i + 1}`);
      skipped++;
      continue;
    }

    const pad = ' '.repeat(glassIndent);
    const styleLines = block.slice(styleStart, styleEnd + 1).map((l, idx, arr) => {
      // 去掉 style={ 外壳，只留里面的数组/对象
      let t = l;
      if (idx === 0) t = t.replace(/^(\s*)style=\{/, '$1');
      if (idx === arr.length - 1) t = t.replace(/\}$/, '');
      return t;
    });

    // 5) 组装：容器开标签（去掉 style 行）→ GlassSurface（带 style）→ 内容 → 闭玻璃 → 闭容器
    const newLines = [];
    for (let j = openIdx; j <= openEnd; j++) {
      if (j >= openIdx + styleStart && j <= openIdx + styleEnd) continue; // 去掉原 style 行
      newLines.push(lines[j]);
    }
    newLines.push(`${pad}<GlassSurface`);
    newLines.push(`${pad}  radius={${radius}}`);
    newLines.push(`${pad}  role="card"`);
    newLines.push(`${pad}  style={${styleLines.join('\n').trim()}}`);
    newLines.push(`${pad}>`);

    const out = [
      ...lines.slice(0, openIdx),
      ...newLines,
      ...lines.slice(openEnd + 1, i), // 内容
      `${pad}</GlassSurface>`,
      ...lines.slice(i + 1, closeIdx + 1),
      ...lines.slice(closeIdx + 1),
    ];
    lines.length = 0;
    lines.push(...out);
    fileConverted++;
    converted++;
    // 继续从当前位置往前扫（行号已变，但循环用 i-- 继续，可能重复处理；此处直接跳出重扫）
    i = Math.min(i, closeIdx + 2);
  }

  let result = lines.join('\n');
  if (fileConverted > 0) {
    const withoutImport = result.replace(/^import \{ GlassBackground \} from.*$/m, '');
    if (!/GlassBackground/.test(withoutImport)) {
      result = result.replace(
        /^import \{ GlassBackground \} from ['"][^'"]*['"];?\r?\n/m,
        "import { GlassSurface } from '../components/GlassSurface';\n",
      );
    }
  }
  fs.writeFileSync(file, result);
  console.log(`${path.basename(file)}: converted=${fileConverted}`);
}
console.log(`TOTAL converted=${converted} skipped=${skipped}`);
