import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');

function loadTs(relPath, imports) {
  const source = readFileSync(new URL(relPath, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    module,
    exports: module.exports,
    require: (id) => {
      if (!(id in imports)) {
        throw new Error(`Unexpected require("${id}") from ${relPath}`);
      }
      return imports[id];
    },
    setTimeout,
    clearTimeout,
    console,
  });
  return module.exports;
}

const imageThumb = loadTs('../src/utils/imageThumb.ts', {});
const dataUtils = loadTs('../src/utils/data.ts', {
  '../i18n': { translate: (k) => k },
  './html': { sanitizeText: (s) => String(s || '') },
  './imageThumb': imageThumb,
  './emojiMap': { __esModule: true, default: {} },
});

const USER_AGENT = 'PocketFans201807/7.0.41 (iPhone; iOS 16.3.1; Scale/2.00)';

// 1. Mock AsyncStorage & FileSystem for roomBgCache + roomMetaCache tests
const kvStore = new Map();
const AsyncStorageMock = {
  __esModule: true,
  default: {
    getItem: async (k) => (kvStore.has(k) ? kvStore.get(k) : null),
    setItem: async (k, v) => {
      kvStore.set(k, String(v));
    },
    removeItem: async (k) => {
      kvStore.delete(k);
    },
  },
};

const BG_DIR = 'file:///mock-cache/roombg/';
const diskFiles = new Map([
  ['stale_missing_never', undefined], // not on disk
  ['leftover.img.tmp', { size: 64 }],
]);
diskFiles.delete('stale_missing_never');

const downloadLog = [];
/** @type {(uri: string, dest: string, headers: any) => Promise<any>} */
let downloadHandler = async (_uri, _dest, _headers) => ({ status: 404, headers: {} });

const FileSystemMock = {
  cacheDirectory: 'file:///mock-cache/',
  readDirectoryAsync: async (dir) => {
    if (dir !== BG_DIR) return [];
    const out = [];
    for (const key of diskFiles.keys()) {
      if (key.startsWith(BG_DIR)) out.push(key.slice(BG_DIR.length));
      else if (!key.includes('/')) out.push(key);
    }
    return out;
  },
  getInfoAsync: async (uri) => {
    const rec = diskFiles.get(uri);
    if (!rec) return { exists: false, uri, isDirectory: false };
    return { exists: true, uri, isDirectory: false, size: rec.size };
  },
  makeDirectoryAsync: async () => {},
  deleteAsync: async (uri) => {
    diskFiles.delete(uri);
    if (!uri.startsWith(BG_DIR)) return;
    diskFiles.delete(uri.slice(BG_DIR.length));
  },
  moveAsync: async ({ from, to }) => {
    const rec = diskFiles.get(from);
    if (!rec) throw new Error(`missing source ${from}`);
    diskFiles.delete(from);
    diskFiles.set(to, rec);
  },
  downloadAsync: async (uri, dest, opts) => {
    downloadLog.push({ uri, dest, headers: opts?.headers });
    const res = await downloadHandler(uri, dest, opts?.headers);
    if (res.bytes && res.status >= 200 && res.status < 300) {
      diskFiles.set(dest, { size: res.bytes });
    }
    return { status: res.status, headers: res.headers || {} };
  },
};

// Pre-seed stale map entry & leftover .tmp file before initRoomBgCache
diskFiles.set(`${BG_DIR}leftover.img.tmp`, { size: 50 });
kvStore.set(
  'yaya_room_bg_cache_v3',
  JSON.stringify({
    'http://source2.48.cn/stale/gone.jpg': {
      localUri: `${BG_DIR}gone.img`,
      url: 'http://source2.48.cn/stale/gone.jpg',
    },
  }),
);

const roomBgCache = loadTs('../src/services/roomBgCache.ts', {
  '@react-native-async-storage/async-storage': AsyncStorageMock,
  'expo-file-system/legacy': FileSystemMock,
  '../constants': { USER_AGENT },
  '../utils/data': dataUtils,
  '../utils/imageThumb': imageThumb,
  './perfScheduler': {
    getTaskBudget: () => ({ focused: true, concurrency: 2, gapMs: 0, commitBatchMs: 0 }),
    waitForIdleSlot: async () => true,
  },
});

// Verify initRoomBgCache prunes missing disk files and cleans .tmp
await roomBgCache.initRoomBgCache();
await new Promise((r) => setTimeout(r, 20));
assert.equal(diskFiles.has(`${BG_DIR}leftover.img.tmp`), false, '启动应清理残留 .tmp 文件');
assert.equal(
  roomBgCache.getBgDisplayUri('https://source2.48.cn/stale/gone.jpg'),
  'https://source1.48.cn/stale/gone.jpg',
  '磁盘缺失的过期缓存应被剔除并归一化到 source1.48.cn',
);

// Verify mirror fallback + rejecting HTML response + Pocket48 headers + atomic write
const primaryRaw = 'http://source.48.cn/room/bg-big.jpg';
const primaryNorm = roomBgCache.normalizeBgUrl(primaryRaw);
assert.equal(primaryNorm, 'https://source.48.cn/room/bg-big.jpg');
assert.equal(
  roomBgCache.normalizeBgUrl('/mediasource/room/a.png'),
  'https://source.48.cn/mediasource/room/a.png',
);
assert.equal(
  roomBgCache.normalizeBgUrl('mediasource/room/b.png'),
  'https://source.48.cn/mediasource/room/b.png',
);

downloadHandler = async (uri, _dest, headers) => {
  if (uri === 'https://source.48.cn/room/bg-big.jpg' && headers?.Referer) {
    return { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' }, bytes: 2048 };
  }
  if (uri === 'https://source1.48.cn/room/bg-big.jpg') {
    return { status: 200, headers: { 'Content-Type': 'image/jpeg' }, bytes: 4096 };
  }
  return { status: 403, headers: {} };
};

const cachedLocal = await roomBgCache.ensureBgCached(primaryRaw);
assert.ok(cachedLocal.startsWith(BG_DIR) && cachedLocal.endsWith('.jpg'), '应落盘写入 .jpg 缓存');
assert.ok(
  downloadLog.some((d) => d.headers?.Referer === 'https://h5.48.cn/'),
  '口袋图片域应携带 Referer 与 UA 请求头',
);
assert.equal(
  roomBgCache.getBgDisplayUri(primaryRaw),
  cachedLocal,
  '命中后 getBgDisplayUri 应返回本地 file URI',
);

// Verify invalidateBgCache removes disk file and falls back to normalized remote URL
const restoredRemote = await roomBgCache.invalidateBgCache(cachedLocal);
assert.equal(restoredRemote, 'https://source.48.cn/room/bg-big.jpg');
assert.equal(
  roomBgCache.getBgDisplayUri(primaryRaw),
  'https://source.48.cn/room/bg-big.jpg',
  '缓存失效后应立即回退远端 URL',
);

// Verify .png extension + existing .img backward compatibility
await roomBgCache.ensureBgCached('https://source.48.cn/room/transparent.png');
assert.ok(
  roomBgCache.getBgDisplayUri('https://source.48.cn/room/transparent.png').endsWith('.png'),
  'PNG 背景应保留 .png 扩展名',
);

// Verify warmRoomBgs skips already cached entries
downloadLog.length = 0;
downloadHandler = async () => ({
  status: 200,
  headers: { 'Content-Type': 'image/jpeg' },
  bytes: 2048,
});
await roomBgCache.warmRoomBgs([primaryRaw, primaryNorm, '/room/bg-small.jpg']);
const warmedCount = downloadLog.length;
await roomBgCache.warmRoomBgs([primaryRaw, '/room/bg-small.jpg']);
assert.equal(downloadLog.length, warmedCount, '已缓存背景不应在 warmRoomBgs 中重复下载');

// 2. Test roomMetaCache big/small extraction & merge semantics
const roomMetaCache = loadTs('../src/services/roomMetaCache.ts', {
  '@react-native-async-storage/async-storage': AsyncStorageMock,
  './roomBgCache': roomBgCache,
});

await roomMetaCache.loadRoomMetaCache();
assert.equal(
  roomMetaCache.pickRoomBg({ bgWallImg: 'http://source2.48.cn/wall/x.jpg' }),
  'https://source1.48.cn/wall/x.jpg',
);

const seineExtracted = roomMetaCache.extractRoomMetasFromSeineDetail({
  chatServerInfo: { serverBgWallImg: '/mediasource/server-wall.jpg' },
  channelInfoList: [
    { channelId: '1001', channelName: '大房间名', bgImg: '/mediasource/big-bg.jpg' },
    { channelId: '1002', channelName: '小房间名', bgImg: '' },
    { channelId: '1003', channelName: '独立背景小房', bgImg: 'https://source.48.cn/small-own.jpg' },
  ],
});
assert.equal(seineExtracted['1001'].bg, 'https://source.48.cn/mediasource/big-bg.jpg');
assert.equal(seineExtracted['1002'].name, '小房间名', '小房间自身名称不能被大房间覆盖');
assert.equal(
  seineExtracted['1002'].bg,
  '',
  'seine/server/detail 提取不得把 serverBg 或 list[0] 串台写入无自身背景的频道',
);
assert.equal(seineExtracted['1003'].bg, 'https://source.48.cn/small-own.jpg');

roomMetaCache.cacheRoomMetasFromSeineDetail({
  channelInfoList: [
    { channelId: '2001', channelName: '成员A', bgImg: 'https://source1.48.cn/a-bg.jpg' },
  ],
});
const keptBg = roomMetaCache.mergeRoomMetaCached(
  '2001',
  { name: '成员A新名', bg: '' },
  { allowClearBg: false },
);
assert.equal(keptBg.name, '成员A新名');
assert.equal(keptBg.bg, 'https://source1.48.cn/a-bg.jpg', '非权威更新不得清空已有背景');
const clearedBg = roomMetaCache.mergeRoomMetaCached(
  '2001',
  { name: '成员A新名', bg: '' },
  { allowClearBg: true },
);
assert.equal(clearedBg.bg, '', '权威无背景更新应允许清空背景');

// 3. Test pocket48.getRoomMeta small-room fallback & failure semantics
const pocketToken = loadTs('../src/utils/pocketToken.ts', {});
const pocketHeaders = loadTs('../src/api/pocketHeaders.ts', {
  '../store': { useSettingsStore: { getState: () => ({ settings: { p48Token: 'tok' } }) } },
  '../utils/pocketToken': pocketToken,
  '@react-native-async-storage/async-storage': AsyncStorageMock,
});

/** @type {(url: string, body: any) => Promise<any>} */
let apiResponder = async (_url, _body) => ({ status: 500 });
const pocketApi = loadTs('../src/api/pocket48.ts', {
  '../store': {
    useMemberStore: { getState: () => ({ members: [] }) },
    useSettingsStore: { getState: () => ({ settings: { p48Token: 'tok' } }) },
  },
  '../auth': {
    initWasm: async () => {},
    generatePa: () => 'sig',
    generatePaAsync: async () => 'sig',
    getWasmError: () => '',
    invalidatePaCache: () => {},
  },
  '../utils/network': {
    xhrPost: async (url, body) => apiResponder(url, body),
    requestJson: async () => ({}),
    fetchWithTimeout: async () => ({}),
  },
  '../utils/data': dataUtils,
  '../utils/pocketToken': pocketToken,
  './pocketHeaders': pocketHeaders,
}).pocketApi;

// Case A: small room has own channelName, empty bgImg; server/big room provides bg
apiResponder = async (url, body) => {
  if (url.endsWith('/im/api/v1/im/team/room/info')) {
    if (body.channelId === 'small-2') {
      return {
        status: 200,
        success: true,
        content: { channelInfo: { channelId: 'small-2', channelName: '小房间', bgImg: '' } },
      };
    }
    if (body.channelId === 'big-1') {
      return {
        status: 200,
        success: true,
        content: {
          channelInfo: {
            channelId: 'big-1',
            channelName: '大房间',
            bgImg: 'http://source2.48.cn/big-room.jpg',
          },
        },
      };
    }
  }
  if (url.endsWith('/im/api/seine/server/detail')) {
    return {
      status: 200,
      success: true,
      content: {
        chatServerInfo: { serverId: 9001 },
        channelInfoList: [
          { channelId: 'big-1', channelName: '大房间', bgImg: 'http://source2.48.cn/big-room.jpg' },
          { channelId: 'small-2', channelName: '小房间', bgImg: '' },
        ],
      },
    };
  }
  return { status: 404 };
};

const smallMeta = await pocketApi.getRoomMeta('small-2', 'big-1', '9001');
assert.equal(smallMeta.ok, true);
assert.equal(smallMeta.bgAuthoritative, true);
assert.equal(smallMeta.name, '小房间', '小房间有自身名称时应保留小房间名称');
assert.equal(
  smallMeta.bg,
  'https://source1.48.cn/big-room.jpg',
  '小房间自身无背景时应继承大房间背景',
);
assert.equal(
  smallMeta.siblings['big-1']?.bg,
  'https://source1.48.cn/big-room.jpg',
  '应顺带返回同服务器兄弟房间元数据',
);

// Case B: big room never inherits list[0]'s small-room bg, and small room prefers big room bg over server wall
apiResponder = async (url, body) => {
  if (url.endsWith('/im/api/v1/im/team/room/info')) {
    if (body.channelId === 'big-1') {
      return {
        status: 200,
        success: true,
        content: { channelInfo: { channelId: 'big-1', channelName: '大房间', bgImg: '' } },
      };
    }
    if (body.channelId === 'small-2') {
      return {
        status: 200,
        success: true,
        content: { channelInfo: { channelId: 'small-2', channelName: '小房间', bgImg: '' } },
      };
    }
  }
  if (url.endsWith('/im/api/seine/server/detail')) {
    return {
      status: 200,
      success: true,
      content: {
        chatServerInfo: { serverId: 9001, serverBgWallImg: '/mediasource/server-wall.jpg' },
        channelInfoList: [
          {
            channelId: 'small-2',
            channelName: '小房间',
            bgImg: 'https://source1.48.cn/small-only.jpg',
          },
          { channelId: 'big-1', channelName: '大房间', bgImg: '' },
        ],
      },
    };
  }
  return { status: 404 };
};

const bigMeta = await pocketApi.getRoomMeta('big-1', undefined, '9001');
assert.equal(
  bigMeta.bg,
  'https://source.48.cn/mediasource/server-wall.jpg',
  '大房间不得继承 channelInfoList[0] 的小房间背景',
);
assert.equal(bigMeta.siblings['small-2']?.bg, 'https://source1.48.cn/small-only.jpg');

// Case C: small room prioritizes big room's own bg over generic server wall
apiResponder = async (url, body) => {
  if (url.endsWith('/im/api/v1/im/team/room/info')) {
    return {
      status: 200,
      success: true,
      content: { channelInfo: { channelId: body.channelId, channelName: '小房间', bgImg: '' } },
    };
  }
  if (url.endsWith('/im/api/seine/server/detail')) {
    return {
      status: 200,
      success: true,
      content: {
        chatServerInfo: { serverId: 9001, serverBgWallImg: '/mediasource/server-wall.jpg' },
        channelInfoList: [
          { channelId: 'big-1', channelName: '大房间', bgImg: 'http://source2.48.cn/big-own.jpg' },
          { channelId: 'small-2', channelName: '小房间', bgImg: '' },
        ],
      },
    };
  }
  return { status: 404 };
};

const smallPreferBig = await pocketApi.getRoomMeta('small-2', 'big-1', '9001');
assert.equal(
  smallPreferBig.bg,
  'https://source1.48.cn/big-own.jpg',
  '小房间缺省背景应优先使用大房间自身背景而非通用服务器背景墙',
);

// Case D: offline / error returns ok: false & bgAuthoritative: false
apiResponder = async () => {
  throw new Error('network down');
};
const failedMeta = await pocketApi.getRoomMeta('small-2', 'big-1', '9001');
assert.equal(failedMeta.ok, false);
assert.equal(failedMeta.bgAuthoritative, false);

// 4. Test followedIds snapshot cache (round-trip, token isolation, 150-entry cap)
const followedIds = loadTs('../src/services/followedIds.ts', {
  '@react-native-async-storage/async-storage': AsyncStorageMock,
});
const snapInput = Array.from({ length: 160 }, (_, idx) => ({
  memberId: `m-${idx}`,
  lastMessage: { msgTime: 1700000000000 + idx, bodys: `big-${idx}` },
  lastSmallMessage: idx % 2 === 0 ? { msgTime: 1700000000000 + idx, bodys: `small-${idx}` } : null,
}));
await followedIds.writeFollowedRoomsSnapshot('tok-user-a', snapInput);
const readA = await followedIds.readFollowedRoomsSnapshot('tok-user-a');
const readB = await followedIds.readFollowedRoomsSnapshot('tok-user-b');
assert.equal(readA.cached, true);
assert.equal(readA.entries.length, 150, '快照缓存应限制最多保留 150 条');
assert.equal(readA.entries[0].lastMessage.bodys, 'big-0');
assert.equal(readA.entries[0].lastSmallMessage.bodys, 'small-0');
assert.equal(readB.cached, false, '不同账号 token 快照应隔离');

console.log('房间背景缓存与大小房间元数据测试通过');
