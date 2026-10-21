import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = readFileSync(join(root, 'src/services/downloads.ts'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText;

let data = [];
let headers;
let releaseDownload;
let releaseDelete;
let deletionStarted;
const deletionStartedPromise = new Promise((resolve) => { deletionStarted = resolve; });
const deleteGate = new Promise((resolve) => { releaseDelete = resolve; });
const storage = {
  getItem: async () => JSON.stringify(data),
  setItem: async (_key, value) => { data = JSON.parse(value); },
};
const filesystem = {
  documentDirectory: 'file:///mock/',
  makeDirectoryAsync: async () => {},
  deleteAsync: async () => { deletionStarted(); await deleteGate; },
  getInfoAsync: async () => ({ exists: true, size: 100 }),
  createDownloadResumable: (_url, uri, options) => {
    headers = options.headers;
    return { downloadAsync: async () => { await new Promise((resolve) => { releaseDownload = resolve; }); return { uri }; } };
  },
};
const moduleObject = { exports: {} };
const imports = {
  '@react-native-async-storage/async-storage': { __esModule: true, default: storage },
  'expo-file-system/legacy': filesystem,
  'expo-media-library': {},
  '../utils/runtimeLog': { logError() {} },
  'react-native': { Linking: {}, Platform: { OS: 'android' }, Alert: {} },
};
vm.runInNewContext(compiled, {
  module: moduleObject,
  exports: moduleObject.exports,
  require: (id) => imports[id] ?? (() => { throw new Error(`Unexpected import: ${id}`); })(),
  setTimeout,
  clearTimeout,
  console,
});
const api = moduleObject.exports;

data = [{ id: 'old', url: 'https://example.test/old', status: 'done', localUri: 'file:///mock/old' }];
const clearing = api.clearFinishedDownloads();
await deletionStartedPromise;
const downloading = api.enqueueDownload({ url: 'https://third-party.example/new', type: 'file' });
releaseDelete();
await clearing;
while (!releaseDownload) await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(headers.token, undefined, '第三方下载不能收到账号凭证');
releaseDownload();
await downloading;
assert.equal(data.length, 1, '清理不能覆盖并发新下载');
assert.equal(data[0].status, 'done');

data = [];
filesystem.createDownloadResumable = (_url, _uri, _options, onProgress) => ({
  downloadAsync: async () => {
    onProgress({ totalBytesWritten: 40, totalBytesExpectedToWrite: 100 });
    throw new Error('synthetic failure');
  },
});
await assert.rejects(api.enqueueDownload({ url: 'https://example.test/failure', type: 'file' }));
await new Promise((resolve) => setTimeout(resolve, 450));
assert.equal(data[0].status, 'failed', '延迟进度不能覆盖失败终态');
console.log('  ✓ 下载凭证边界、并发清理与失败终态正确');
