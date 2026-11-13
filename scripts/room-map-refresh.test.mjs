import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const ts = createRequire(import.meta.url)('typescript');
const source = readFileSync(new URL('../src/services/roomMapCache.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
let token = 'test-account';
let members = [
  { id: '1', serverId: '10', channelId: '11', yklzId: '12', isInGroup: true },
  { id: '2', serverId: '20', channelId: '21', yklzId: '', isInGroup: true },
  { id: '3', serverId: '30', channelId: '31', yklzId: '', isInGroup: false },
];
const calls = [];
const store = { getState: () => ({ members, setMembers: (value) => { members = value; } }) };
const imports = {
  '@react-native-async-storage/async-storage': { __esModule: true, default: { getItem: async () => null, setItem: async () => {} } },
  '../store': { useMemberStore: store, useSettingsStore: { getState: () => ({ settings: { p48Token: token } }) } },
  '../utils/members': { isRoomMember: (m) => m.isInGroup !== false },
  '../utils/runtimeLog': { logInfo() {}, logWarn() {} },
  '../api/pocket48': { __esModule: true, default: {
    getStarServerMap: async () => ({ content: { userServerMap: { 1: '10', 2: '20', 3: '30' } } }),
    getSeineServerDetail: async (id) => {
      calls.push(id);
      if (id === 20) throw new Error('offline');
      return { content: { chatServerInfo: { serverId: id }, channelInfoList: [{ channelId: '111' }, { channelId: '112' }] } };
    },
  } },
};
const module = { exports: {} };
vm.runInNewContext(compiled, { module, exports: module.exports, require: (id) => imports[id], setTimeout: (fn) => { fn(); return 0; }, console });
await module.exports.refreshActiveRoomMappings();
assert.equal(members[0].channelId, '111', '官方有效映射应更新');
assert.equal(members[0].yklzId, '112');
assert.equal(members[1].channelId, '21', '请求失败时保留原映射');
assert.equal(calls.includes(30), false, '离团成员不应请求');
assert.ok(module.exports.getRoomMapEntry('1').verifiedAt);
token = '';
await module.exports.refreshActiveRoomMappings();
assert.equal(calls.length, 2, '未登录时不请求');
console.log('启动房间映射更新和失败回退测试通过');
