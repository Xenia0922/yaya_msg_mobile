import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = readFileSync(new URL('../src/utils/members.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const moduleObject = { exports: {} };
vm.runInNewContext(compiled, { module: moduleObject, exports: moduleObject.exports });
const { appendOfficialGroupMembers } = moduleObject.exports;
const existing = [{ id: '1', ownerName: '已有', channelId: '42' }];
const result = appendOfficialGroupMembers(existing, [
  { userId: 1, realName: '已有', groupName: 'SNH48' },
  { userId: 2, realName: '新成员', groupName: 'SNH48', status: 1 },
  { userId: 2, realName: '新成员', groupName: 'SNH48' },
  { userId: 3, realName: '其他团体', groupName: 'Error404Girls' },
]);
assert.equal(result.length, 2);
assert.equal(result[0].channelId, '42');
assert.equal(result[1].id, '2');
assert.equal(result[1].ownerName, '新成员');
assert.equal(result[1].channelId, '');
assert.equal(existing.length, 1);
console.log('官方新增成员合并测试通过');
