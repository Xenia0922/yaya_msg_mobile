// 鸡腿榜解析逻辑单测：编译 src/utils/meleeParse.ts 后断言多种返回形态。
// 运行： node scripts/melee-parse.test.mjs
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mkdtempSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const tmp = mkdtempSync(join(root, 'node_modules', '.meleetest-'));
execSync(
  `npx tsc ${join(root, 'src/utils/meleeParse.ts')} --outDir ${tmp} --module commonjs --target es2019 --moduleResolution node --skipLibCheck`,
  { cwd: root, stdio: 'inherit' },
);

const { extractRankList, extractWeeks } = await import(`file://${join(tmp, 'meleeParse.js')}`);

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) { pass += 1; console.log(`  ✓ ${name}`); }
  else { fail += 1; console.error(`  ✗ ${name}`); }
}

console.log('extractRankList:');
// 1) 平铺 content.result
check('content.result 数组',
  extractRankList({ content: { result: [{ userId: 1 }, { userId: 2 }] } }).length === 2);
// 2) 平铺 content.list
check('content.list 数组',
  extractRankList({ content: { list: [{ id: 'a' }] } }).length === 1);
// 3) 顶层 list
check('顶层 list',
  extractRankList({ list: [{ id: 1 }, { id: 2 }, { id: 3 }] }).length === 3);
// 4) data 嵌套
check('data.rankList',
  extractRankList({ data: { rankList: [{}, {}] } }).length === 2);
// 5) records
check('content.records',
  extractRankList({ content: { records: [{}, {}, {}] } }).length === 3);
// 6) 兜底：任意对象数组
check('兜底 任意对象数组',
  extractRankList({ payload: { items: [{ x: 1 }] } }).length === 1);
// 7) 空
check('空对象返回 []', extractRankList({}).length === 0);
check('null 返回 []', extractRankList(null).length === 0);

console.log('extractWeeks:');
// 周列表在 content.weekList
const w1 = extractWeeks({ content: { weekList: [{ weekRankId: 10, weekRankName: '第1周' }, { weekRankId: 11, weekRankName: '第2周' }] } });
check('content.weekList 抽 2 周',
  w1.length === 2 && w1[0].weekRankId === 10 && w1[0].weekRankName === '第1周');
// 周列表在顶层 weekList
check('顶层 weekList',
  extractWeeks({ weekList: [{ weekRankId: 5, weekRankName: 'W5' }] }).length === 1);
// 递归深入
const w2 = extractWeeks({ data: { content: { rankList: [{ weekRankId: 7, weekRankName: '深潜周' }] } } });
check('递归 data.content.rankList',
  w2.length === 1 && w2[0].weekRankName === '深潜周');
// 过滤无效（缺名/缺 id）
const w3 = extractWeeks({ weekList: [{ weekRankId: 1, weekRankName: 'A' }, { rankId: 2, rankName: 'ok' }, { weekRankId: 0, weekRankName: 'bad' }] });
check('过滤无效周（保留2）', w3.length === 2);
// 空
check('空返回 []', extractWeeks({}).length === 0);

console.log(`\n结果： ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
