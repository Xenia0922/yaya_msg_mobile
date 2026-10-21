import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = readFileSync(join(root, 'src/services/pocketNim/credentials.ts'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText;

let token = 'MOCK_ACCOUNT_A';
const requests = [];
const moduleObject = { exports: {} };
const imports = {
  '../../api/pocket48': {
    __esModule: true,
    default: { getNimLoginInfo: () => new Promise((resolve) => requests.push(resolve)) },
  },
  '../settings': { getSetting: async () => null },
  '../../store': { useSettingsStore: { getState: () => ({ settings: { p48Token: token } }) } },
  '../../utils/runtimeLog': { logInfo() {} },
  './runtime': { normalizeCredentials: (value) => value, credentialsToProfile: (value) => value },
};
vm.runInNewContext(compiled, {
  module: moduleObject,
  exports: moduleObject.exports,
  require: (id) => imports[id] ?? (() => { throw new Error(`Unexpected import: ${id}`); })(),
  console: { log() {} },
});

const api = moduleObject.exports;
const old = api.loadNimCredentials();
token = 'MOCK_ACCOUNT_B';
const next = api.loadNimCredentials();
assert.equal(requests.length, 2, '切号后必须发起新请求');
requests[1]({ accid: 'MOCK_USER_B', token: 'MOCK_CREDENTIAL_B' });
assert.equal((await next)?.accid, 'MOCK_USER_B');
requests[0]({ accid: 'MOCK_USER_A', token: 'MOCK_CREDENTIAL_A' });
assert.equal(await old, null, '旧请求应作废');
assert.equal(api.peekNimCredentials()?.accid, 'MOCK_USER_B', '旧请求不能覆盖新缓存');

api.clearNimCredentials();
const beforeLogout = api.loadNimCredentials();
api.clearNimCredentials();
requests[2]({ accid: 'MOCK_USER_B', token: 'MOCK_CREDENTIAL_B' });
assert.equal(await beforeLogout, null, '登出后的在途请求应作废');
assert.equal(api.peekNimCredentials(), null);
token = 'MOCK_ACCOUNT_C';
const profileRequest = api.loadSelfProfile();
requests[3]({ accid: 'MOCK_USER_C', token: 'MOCK_CREDENTIAL_C', nickName: 'Mock', avatar: 'https://example.test/avatar' });
assert.equal((await profileRequest)?.accid, 'MOCK_USER_C', '切号后的首次自身资料请求应成功');
console.log('  ✓ 云信凭证切号与登出时的在途请求隔离正确');
