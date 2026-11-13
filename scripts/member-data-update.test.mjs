import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = readFileSync(new URL('../src/services/memberData.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
const cacheKey = 'yaya_member_data_cache_v7';
const newTime = Date.parse('2026-10-31T09:00:00Z');
const oldTime = Date.parse('2026-10-28T09:00:00Z');
const members = (count) => Array.from({ length: count }, (_, i) => ({ id: String(i + 1), ownerName: `Member ${i + 1}`, channelId: String(100 + i) }));
let values = new Map([[cacheKey, JSON.stringify({ members: members(10), savedAt: Date.now(), count: 10, sourceUpdatedAt: newTime })]]);
let responses = [];
let requests = [];
let shown = [];
let blockNextRead;
const storage = {
  async getItem(key) {
    if (key === cacheKey && blockNextRead) {
      const block = blockNextRead;
      blockNextRead = undefined;
      return block;
    }
    return values.get(key) ?? null;
  },
  async setItem(key, value) { values.set(key, value); },
  async multiRemove(keys) { for (const key of keys) values.delete(key); },
};
const imports = {
  '@react-native-async-storage/async-storage': { __esModule: true, default: storage },
  '../utils/data': { parseMaybeJson: JSON.parse },
  '../utils/members': {
    loadMembers: async (items) => items.map((item) => ({ ...item })),
    normalizeMember: (item) => item,
    appendOfficialGroupMembers: (items) => items,
    classifyMemberState: () => 'active',
  },
  '../store': { useMemberStore: { getState: () => ({ setMembers: (items) => shown.push(items.map((item) => item.id)) }) } },
  '../constants': { MEMBERS_URL: 'fallback', MEMBERS_URL_SELF_LIST: ['primary', 'secondary'] },
  '../utils/network': { fetchWithTimeout: async (url) => {
    requests.push(url.split('?')[0]);
    const value = responses.shift();
    if (value instanceof Error) throw value;
    return { ok: true, text: async () => JSON.stringify(value) };
  } },
  '../api/pocket48': { __esModule: true, default: {
    getGroupTeamStar: async () => ({ content: { starInfo: [] } }),
    getStarServerMap: async () => ({ content: {} }),
    getFollowedIds: async () => ({ content: {} }),
  } },
  '../utils/runtimeLog': { logInfo() {}, logWarn() {}, logError() {} },
  './roomMapCache': { hydrateRoomMap: async () => {}, seedRoomMapFromMembers() {}, getRoomMapEntry() {} },
};
const moduleObject = { exports: {} };
vm.runInNewContext(compiled, { module: moduleObject, exports: moduleObject.exports, require: (id) => {
  if (!(id in imports)) throw new Error(`Unexpected import: ${id}`);
  return imports[id];
}, Date, console, setTimeout, clearTimeout });
const api = moduleObject.exports;

const oldResponse = { updatedAt: new Date(oldTime).toISOString(), members: members(9) };
const newResponse = { updatedAt: new Date(newTime).toISOString(), members: members(10) };
responses = [oldResponse, newResponse];
await api.updateMemberData();
assert.equal(requests.join(','), 'primary,secondary', '旧 CDN 应跳过并尝试其他源');
assert.equal(JSON.parse(values.get(cacheKey)).count, 10);
assert.equal(JSON.parse(values.get(cacheKey)).sourceUpdatedAt, newTime);

requests = [];
responses = [oldResponse, oldResponse, { members: members(9) }];
const rejected = await api.updateMemberData();
assert.equal(rejected.updated, false, '全部源过旧时应保留缓存');
assert.equal(JSON.parse(values.get(cacheKey)).count, 10);

const newerTime = newTime + 1000;
responses = [{ updatedAt: new Date(newerTime).toISOString(), members: members(9) }];
await api.updateMemberData();
assert.equal(JSON.parse(values.get(cacheKey)).count, 9, '真正的新版本允许正常删除成员');

let unblock;
const delayedCache = JSON.stringify({ members: members(9), savedAt: Date.now(), count: 9, sourceUpdatedAt: newerTime });
blockNextRead = new Promise((resolve) => { unblock = () => resolve(delayedCache); });
shown = [];
const boot = api.ensureMemberData();
responses = [{ updatedAt: new Date(newerTime + 1000).toISOString(), members: members(10) }];
await api.updateMemberData();
unblock();
await boot;
assert.equal(shown[0].length, 10);
assert.ok(shown.every((ids) => ids.length === 10), '启动缓存读取不能覆盖已完成的新更新');
console.log('成员数据旧源回退与启动并发测试通过');
