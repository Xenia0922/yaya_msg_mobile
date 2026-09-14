/**
 * 一次性 codemod：把「GlassBackground 铺底 + 兄弟内容」的旧用法
 * 转成作者结构「<GlassSurface radius role style>{内容}</GlassSurface>」。
 *
 * 两遍式：先定位全部站点（玻璃行 → 容器开/闭标签，缩进配对），再一次性重建输出。
 * 支持容器标签：View / TouchableOpacity / ScalePressable / Pressable / Animated.View。
 * 匹配不上的一律跳过并打印，留给手工。
 */
const fs = require('fs');
const path = require('path');

const files = process.argv.slice(2);
let totalConverted = 0;
let totalSkipped = 0;

const CONTAINER_TAGS = 'View|TouchableOpacity|ScalePressable|Pressable|Animated\\.View';

for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  const lines = src.split('\n');
  const indentOf = (s) => (s.match(/^\s*/) || [''])[0].length;

  // ---- 第一遍：定位站点 ----
  const sites = []; // { glassIdx, openIdx, closeIdx, radius, tag }
  for (let i = 0; i < lines.length; i++) {
    const gm = lines[i].match(/^(\s*)<GlassBackground radius=\{(\d+)\}(?:\s+refract=\{false\})?\s*\/>\s*$/);
    if (!gm) continue;
    const glassIndent = indentOf(lines[i]);
    const radius = gm[2];

    let openIdx = -1;
    let tag = '';
    for (let j = i - 1; j >= 0; j--) {
      const om = lines[j].match(new RegExp(`^\\s*<(${CONTAINER_TAGS})[\\s>]`));
      if (om && indentOf(lines[j]) < glassIndent) {
        openIdx = j;
        tag = om[1];
        break;
      }
    }
    if (openIdx < 0) {
      console.log(`  skip(无容器): ${path.basename(file)}:${i + 1}`);
      totalSkipped++;
      continue;
    }
    const containerIndent = indentOf(lines[openIdx]);

    const closeRe = new RegExp(`^\\s*</${tag}>\\s*$`);
    let closeIdx = -1;
    for (let j = i + 1; j < lines.length; j++) {
      if (indentOf(lines[j]) === containerIndent && closeRe.test(lines[j])) {
        closeIdx = j;
        break;
      }
    }
    if (closeIdx < 0) {
      console.log(`  skip(无闭标签): ${path.basename(file)}:${i + 1}`);
      totalSkipped++;
      continue;
    }
    const overlap = sites.some((s) => openIdx <= s.closeIdx && closeIdx >= s.openIdx);
    if (overlap) {
      console.log(`  skip(重叠): ${path.basename(file)}:${i + 1}`);
      totalSkipped++;
      continue;
    }
    sites.push({ glassIdx: i, openIdx, closeIdx, radius, tag });
  }

  // ---- 第二遍：重建输出 ----
  const glassSet = new Set(sites.map((s) => s.glassIdx));
  const openMap = new Map(sites.map((s) => [s.openIdx, s]));
  const closeMap = new Map(sites.map((s) => [s.closeIdx, s]));

  const out = [];
  for (let j = 0; j < lines.length; j++) {
    if (glassSet.has(j)) continue; // 丢掉 GlassBackground 行
    if (openMap.has(j)) {
      out.push(lines[j].replace('<View', `<GlassSurface radius={${openMap.get(j).radius}} role="card"`));
    } else if (closeMap.has(j)) {
      const s = closeMap.get(j);
      out.push(lines[j].replace(new RegExp(`</${s.tag}>`), '</GlassSurface>'));
    } else {
      out.push(lines[j]);
    }
  }

  let result = out.join('\n');
  if (sites.length > 0) {
    const withoutImport = result.replace(/^import \{ GlassBackground \} from.*$/m, '');
    if (!/GlassBackground/.test(withoutImport)) {
      result = result.replace(
        /^import \{ GlassBackground \} from ['"][^'"]*['"];?\r?\n/m,
        "import { GlassSurface } from '../components/GlassSurface';\n",
      );
    }
  }
  fs.writeFileSync(file, result);
  totalConverted += sites.length;
  console.log(`${path.basename(file)}: converted=${sites.length}`);
}
console.log(`TOTAL converted=${totalConverted} skipped=${totalSkipped}`);
