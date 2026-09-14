/**
 * glassify.mjs — 用 AST 精确定位「玻璃色卡片」并在其子节点前注入 <GlassBackground />
 *
 * 为什么用 AST：正则/行号方案无法正确处理多行 JSX 开标签与嵌套，
 * 之前三次尝试都破坏了 JSX（121/97/17 处编译错误）。AST 能给出精确的
 * 开标签结束偏移，插入点绝对安全。
 *
 * 规则：
 *  - 目标：JSXOpeningElement 的 style 属性为数组，其中存在对象字面量含
 *    backgroundColor: palette.surfaceGlassStrong
 *  - 仅处理非自闭合元素（有 children）
 *  - 操作：① 该属性值改为 'transparent' ② 开标签结束后插入 <GlassBackground />
 *  - 幂等：已含 <GlassBackground 的紧邻子节点则跳过
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';

const traverse = traverseModule.default ?? traverseModule;

const targets = process.argv.slice(2);
if (!targets.length) {
  console.error('用法: node tools/glassify.mjs <file.tsx> [...]');
  process.exit(1);
}

let changedFiles = 0;
let totalEdits = 0;

for (const file of targets) {
  const code = await readFile(file, 'utf8');
  const ast = parse(code, {
    sourceType: 'module',
    plugins: ['typescript', 'jsx'],
    errorRecovery: false,
  });

  /** @type {{colorStart:number,colorEnd:number,insertAt:number,radius:number}[]} */
  const edits = [];

  traverse(ast, {
    JSXOpeningElement(nodePath) {
      const node = nodePath.node;
      if (node.selfClosing) return;

      // 找 style 属性（数组表达式）
      const styleAttr = node.attributes.find(
        (a) => a.type === 'JSXAttribute' && a.name?.name === 'style',
      );
      if (!styleAttr?.value || styleAttr.value.type !== 'JSXExpressionContainer') return;
      const expr = styleAttr.value.expression;
      if (expr.type !== 'ArrayExpression') return;

      // 在数组元素里找含 backgroundColor: palette.surfaceGlassStrong 的对象
      let hit = null;
      for (const el of expr.elements) {
        if (el?.type !== 'ObjectExpression') continue;
        for (const prop of el.properties) {
          if (
            prop.type === 'ObjectProperty' &&
            prop.key?.name === 'backgroundColor' &&
            prop.value?.type === 'MemberExpression' &&
            prop.value.property?.name === 'surfaceGlassStrong'
          ) {
            hit = prop.value;
            break;
          }
        }
        if (hit) break;
      }
      if (!hit) return;

      // 圆角：样式数组里若显式给了 borderRadius 用它，否则默认 20
      let radius = 20;
      for (const el of expr.elements) {
        if (el?.type !== 'ObjectExpression') continue;
        for (const prop of el.properties) {
          if (prop.type === 'ObjectProperty' && prop.key?.name === 'borderRadius' && prop.value?.type === 'NumericLiteral') {
            radius = prop.value.value;
          }
        }
      }

      // 已是玻璃卡则跳过（幂等）
      const firstChild = nodePath.node.end ? code.slice(node.end, node.end + 220) : '';
      if (firstChild.includes('<GlassBackground')) return;

      // 缩进：取开标签所在行的缩进（不是 insertAt 的列位置，否则多行标签会缩进爆炸）
      const nodeLineStart = code.lastIndexOf('\n', node.start - 1) + 1;
      const lineIndent = (code.slice(nodeLineStart, node.start).match(/^\s*/) || [''])[0];
      edits.push({ colorStart: hit.start, colorEnd: hit.end, insertAt: node.end, radius, indent: lineIndent + '  ' });
    },
  });

  if (!edits.length) continue;

  // 从后往前应用，避免偏移
  edits.sort((a, b) => b.insertAt - a.insertAt);
  let out = code;
  for (const e of edits) {
    const indent = e.indent;
    out = out.slice(0, e.insertAt) + `\n${indent}<GlassBackground radius={${e.radius}} refract={false} />` + out.slice(e.insertAt);
    out = out.slice(0, e.colorStart) + "'transparent'" + out.slice(e.colorEnd);
  }

  // 补 import
  if (!out.includes("components/GlassBackground'")) {
    // 用 AST 找最后一个顶层 import 的结束位置（多行 import 也精确）
    let lastImportEnd = -1;
    for (const stmt of ast.program.body) {
      if (stmt.type === 'ImportDeclaration') lastImportEnd = stmt.end;
    }
    if (lastImportEnd > 0) {
      out = out.slice(0, lastImportEnd) + "\nimport { GlassBackground } from '../components/GlassBackground';" + out.slice(lastImportEnd);
    }
  }

  await writeFile(file, out, 'utf8');
  changedFiles += 1;
  totalEdits += edits.length;
  console.log(path.basename(file), edits.length);
}

console.log('files:', changedFiles, 'edits:', totalEdits);
