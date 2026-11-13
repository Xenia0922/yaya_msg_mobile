import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const ts = createRequire(import.meta.url)('typescript');
function load(path, imports) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(compiled, { module, exports: module.exports, require: (id) => imports[id], console });
  return module.exports;
}
const parseMaybeJson = (value) => {
  if (value && typeof value === 'object') return value;
  try { return JSON.parse(String(value).replace(/:\s*([0-9]{15,})/g, ':"$1"')); } catch { return null; }
};
const { getRoomFlipInfo } = load('../src/utils/roomFlip.ts', { './data': { parseMaybeJson } });
const info = getRoomFlipInfo({ bodys: '{"filpCardInfo":{"question":"问题","answer":"回答","questionId":12345678901234567,"answerId":12345678901234568}}' }, 'FLIPCARD');
assert.equal(info.questionId, '12345678901234567');
assert.equal(info.answerId, '12345678901234568');
assert.equal(info.answerText, '回答');
assert.equal(getRoomFlipInfo({}, 'TEXT'), null);

let token = 'account-a';
let response = {};
const { getRoomFlipUser } = load('../src/services/roomFlipUser.ts', {
  '../api/pocket48': { __esModule: true, default: { getRoomFlipUser: async () => ({ content: response }) } },
  '../store': { useSettingsStore: { getState: () => ({ settings: { p48Token: token } }) } },
});
response = { type: 3, userId: '99', userName: '不能显示' };
const anonymous = await getRoomFlipUser(token, '1', '1');
assert.equal(anonymous.visibility, 'anonymous');
assert.equal(anonymous.userId, undefined);
response = { type: 2, userId: '99', userName: '不能显示' };
const privateUser = await getRoomFlipUser(token, '2', '2');
assert.equal(privateUser.visibility, 'private');
assert.equal(privateUser.name, undefined);
response = { type: 1, userId: '12345678901234567', userName: '公开用户' };
const publicUser = await getRoomFlipUser(token, '3', '3');
assert.equal(publicUser.userId, '12345678901234567');
assert.equal(publicUser.name, '公开用户');
token = 'account-b';
response = { type: 3 };
assert.equal((await getRoomFlipUser(token, '3', '3')).visibility, 'anonymous');
console.log('翻牌 ID 和提问者隐私测试通过');
