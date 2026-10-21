import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = readFileSync(join(root, 'src/utils/runtimeLog.ts'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText;

const storage = {
  getItem: async () => JSON.stringify([{ id: 'old', t: 0, level: 'warn', msg: 'SESSDATA=MOCK_OLD_COOKIE' }]),
  setItem: async () => {},
  removeItem: async () => {},
};
const moduleObject = { exports: {} };
const imports = {
  '@react-native-async-storage/async-storage': { __esModule: true, default: storage },
  'react-native': { Platform: { OS: 'test', Version: '0' } },
  '../constants': { APP_VERSION: 'test' },
};
const fakeConsole = { debug() {}, error() {}, warn() {}, info() {}, log() {} };
vm.runInNewContext(compiled, {
  module: moduleObject,
  exports: moduleObject.exports,
  require: (id) => imports[id] ?? (() => { throw new Error(`Unexpected import: ${id}`); })(),
  console: fakeConsole,
  setTimeout: () => 1,
  clearTimeout() {},
});
const api = moduleObject.exports;
await api.initRuntimeLog();
api.logWarn('ticket=MOCK_TICKET&token=MOCK_TOKEN Authorization: Bearer MOCK_BEARER');
fakeConsole.log('{"p48Token":"MOCK_JSON_TOKEN"}');
const text = api.exportLogText();
for (const secret of ['MOCK_OLD_COOKIE', 'MOCK_TICKET', 'MOCK_TOKEN', 'MOCK_BEARER', 'MOCK_JSON_TOKEN']) {
  assert.equal(text.includes(secret), false, '导出日志包含测试凭证');
}
assert.equal(api.getLogEntries().some((entry) => entry.msg.includes('MOCK_OLD_COOKIE')), false);
console.log('  ✓ 运行日志写入、历史读取与导出均脱敏');
