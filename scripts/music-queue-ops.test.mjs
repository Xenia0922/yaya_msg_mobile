import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = readFileSync(new URL('../src/store/musicPlayerStore.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;

const create = (init) => {
  if (!init) return create;
  let state;
  const set = (update) => {
    state = { ...state, ...(typeof update === 'function' ? update(state) : update) };
  };
  const get = () => state;
  state = init(set, get);
  return Object.assign(() => state, {
    getState: get,
    setState: set,
    persist: { hasHydrated: () => true, onFinishHydration: () => {} },
  });
};

const memStorage = new Map();
const asyncStorageMock = {
  getItem: async (k) => (memStorage.has(k) ? memStorage.get(k) : null),
  setItem: async (k, v) => {
    memStorage.set(k, v);
  },
  removeItem: async (k) => {
    memStorage.delete(k);
  },
};

const moduleObj = { exports: {} };
vm.runInNewContext(compiled, {
  module: moduleObj,
  exports: moduleObj.exports,
  setTimeout,
  clearTimeout,
  Date,
  Math,
  JSON,
  Map,
  Set,
  require: (name) => {
    if (name === 'zustand') return { create };
    if (name === 'zustand/middleware') {
      return {
        persist: (fn) => fn,
        createJSONStorage: () => asyncStorageMock,
      };
    }
    if (name === '@react-native-async-storage/async-storage') return asyncStorageMock;
    throw new Error(`Unexpected require: ${name}`);
  },
});

const { insertTrackNextInQueue, appendRecentTrackId, trackIdentityKey, useMusicPlayerStore } =
  moduleObj.exports;

const mk = (id) => ({ id, musicId: id, title: `Track ${id}` });

// 1. insertTrackNextInQueue on empty queue
const rEmpty = insertTrackNextInQueue([], -1, mk('1'));
assert.equal(
  JSON.stringify(rEmpty.queue.map(trackIdentityKey)),
  JSON.stringify(['1']),
  '空队列插入应作为唯一曲目',
);
assert.equal(rEmpty.currentIndex, 0);

// 2. insert new track right after currentIndex
const qBase = [mk('1'), mk('2'), mk('3')];
const rInsert = insertTrackNextInQueue(qBase, 0, mk('4'));
assert.equal(
  JSON.stringify(rInsert.queue.map(trackIdentityKey)),
  JSON.stringify(['1', '4', '2', '3']),
  '新歌应插入到当前曲目下一首',
);
assert.equal(rInsert.currentIndex, 0);

// 3. move existing track from after currentIndex -> currentIndex + 1
const rMoveAfter = insertTrackNextInQueue(qBase, 0, mk('3'));
assert.equal(
  JSON.stringify(rMoveAfter.queue.map(trackIdentityKey)),
  JSON.stringify(['1', '3', '2']),
  '后面的已有歌曲应移动到紧随当前曲目之后',
);
assert.equal(rMoveAfter.currentIndex, 0);

// 4. move existing track from before currentIndex -> adjusts currentIndex - 1
const rMoveBefore = insertTrackNextInQueue([mk('1'), mk('2'), mk('3'), mk('4')], 2, mk('1'));
assert.equal(
  JSON.stringify(rMoveBefore.queue.map(trackIdentityKey)),
  JSON.stringify(['2', '3', '1', '4']),
  '前面的已有歌曲移到当前曲目之后时 currentIndex 应同步左移',
);
assert.equal(rMoveBefore.currentIndex, 1);

// 5. no-op when track is already playing
const rSame = insertTrackNextInQueue(qBase, 1, mk('2'));
assert.equal(rSame.queue, qBase, '正在播放当前曲目时不得改动队列');
assert.equal(rSame.currentIndex, 1);

// 6. appendRecentTrackId deduplication & cap (80)
let recent = [];
for (let i = 1; i <= 85; i += 1) {
  recent = appendRecentTrackId(recent, `id-${i}`);
}
assert.equal(recent.length, 80, '最近播放历史最多保留 80 首');
assert.equal(recent[0], 'id-85', '最新播放应排在首位');
assert.ok(!recent.includes('id-5'), '超出上限的最早记录应被淘汰');

recent = appendRecentTrackId(recent, 'id-50');
assert.equal(recent[0], 'id-50', '重播已有曲目应提至第一位');
assert.equal(recent.filter((x) => x === 'id-50').length, 1, '最近播放历史不应包含重复 ID');
assert.equal(recent.length, 80);

// 7. store actions integration sanity
const st = useMusicPlayerStore;
st.getState().setQueue([mk('A'), mk('B'), mk('C')]);
st.getState().insertNextInQueue(mk('D'));
assert.equal(
  JSON.stringify(st.getState().queue.map(trackIdentityKey)),
  JSON.stringify(['A', 'D', 'B', 'C']),
);

// 8. r2Music & musicCatalog long-TTL cache, startup zero-network hydration & cooldowns
/**
 * @param {string} relPath
 * @param {Record<string, any>} mocks
 * @param {{ now: () => number }} clock
 * @returns {any}
 */
function loadTsWithClock(relPath, mocks, clock) {
  const src = readFileSync(new URL(relPath, import.meta.url), 'utf8');
  const js = ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;
  class FakeDate extends Date {
    static now() {
      return clock.now();
    }
  }
  const mod = { exports: {} };
  vm.runInNewContext(js, {
    module: mod,
    exports: mod.exports,
    setTimeout,
    clearTimeout,
    Date: FakeDate,
    Math,
    JSON,
    Map,
    Set,
    WeakMap,
    URL,
    Promise,
    Error,
    Number,
    String,
    Array,
    Object,
    require: (/** @type {string} */ id) => {
      if (id in mocks) return mocks[id];
      throw new Error(`Unexpected require("${id}") from ${relPath}`);
    },
  });
  return mod.exports;
}

let fakeNow = 1_760_000_000_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const MIN_MS = 60 * 1000;

/** @type {Map<string, string>} */
const r2Store = new Map();
const r2AsyncStorage = {
  __esModule: true,
  default: {
    getItem: async (/** @type {string} */ k) => (r2Store.has(k) ? (r2Store.get(k) ?? null) : null),
    setItem: async (/** @type {string} */ k, /** @type {string} */ v) => {
      r2Store.set(k, v);
    },
    removeItem: async (/** @type {string} */ k) => {
      r2Store.delete(k);
    },
  },
};

let fetchCalls = 0;
let failFetch = false;
let serverTracks = [
  {
    id: 'r2-1',
    key: 'r2-1',
    title: '千金',
    album: '千金',
    artist: 'SNH48',
    albumArtist: 'SNH48',
    duration: '04:01',
    groupKey: 'SNH',
    groupLabel: 'SNH48',
    mp3: 'https://music.gnz.hk/a.flac',
    coverUrl: 'https://music.gnz.hk/a.jpg',
    sourceIndex: 1,
    source: 'r2-performance',
  },
];

const r2Mod = loadTsWithClock(
  '../src/api/r2Music.ts',
  {
    '@react-native-async-storage/async-storage': r2AsyncStorage,
    '../utils/data': {
      parseMaybeJson: (/** @type {string} */ s) => {
        try {
          return JSON.parse(s);
        } catch {
          return null;
        }
      },
    },
    '../utils/network': {
      fetchWithTimeout: async () => {
        fetchCalls += 1;
        if (failFetch) throw new Error('network down');
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ tracks: serverTracks }),
        };
      },
    },
  },
  { now: () => fakeNow },
);

const catalogMod = loadTsWithClock(
  '../src/services/musicCatalog.ts',
  {
    '@react-native-async-storage/async-storage': r2AsyncStorage,
    '../api/r2Music': r2Mod,
    '../store/musicPlayerStore': moduleObj.exports,
  },
  { now: () => fakeNow },
);

// Startup hydration: empty disk cache -> null, 0 network calls; cleans up legacy official cache
r2Store.set(
  'yaya_official_site_music_cache_v2',
  JSON.stringify({ t: fakeNow, list: [{ id: 'old' }] }),
);
assert.equal(await catalogMod.hydrateMusicCatalogFromCache(), null);
assert.equal(fetchCalls, 0, '启动水合空缓存不应发起网络请求');
assert.equal(
  r2Store.has('yaya_official_site_music_cache_v2'),
  false,
  '启动水合应清理旧官网曲库缓存',
);

// Startup hydration: even 20-day-old disk cache hydrates locally with 0 network requests
r2Mod.resetR2MusicCacheForTest();
catalogMod.resetMusicCatalogForTest();
const staleTrack = {
  musicId: 'cached-1',
  id: 'cached-1',
  title: 'Cached Track',
  artist: 'GNZ48',
  album: 'Test',
  groupLabel: 'GNZ48',
  durationSec: 210,
  mp3: 'https://music.gnz.hk/cached.mp3',
  sourceIndex: 5,
};
r2Store.set(
  r2Mod.R2_MUSIC_CACHE_KEY,
  JSON.stringify({ t: fakeNow - 20 * DAY_MS, list: [staleTrack] }),
);
const hydrated = await catalogMod.hydrateMusicCatalogFromCache();
assert.equal(hydrated?.length, 1);
assert.equal(fetchCalls, 0, '启动水合过期本地缓存时也不得请求网络');

// Fresh 13-day cache on loadMusicCatalog(false) -> 0 network requests (within 14-day TTL)
r2Mod.resetR2MusicCacheForTest();
catalogMod.resetMusicCatalogForTest();
r2Store.set(
  r2Mod.R2_MUSIC_CACHE_KEY,
  JSON.stringify({ t: fakeNow - 13 * DAY_MS, list: [staleTrack] }),
);
const fresh13 = await catalogMod.loadMusicCatalog(false);
await new Promise((r) => setTimeout(r, 15));
assert.equal(fresh13.songs.length, 1);
assert.equal(fetchCalls, 0, '14 天有效期内打开曲库不得触发任何后台或前台请求');

// 15-day-old cache triggers single background refresh; failure triggers 6h retry backoff
r2Mod.resetR2MusicCacheForTest();
catalogMod.resetMusicCatalogForTest();
r2Store.set(
  r2Mod.R2_MUSIC_CACHE_KEY,
  JSON.stringify({ t: fakeNow - 15 * DAY_MS, list: [staleTrack] }),
);
failFetch = true;
const staleLoad = await catalogMod.loadMusicCatalog(false);
await new Promise((r) => setTimeout(r, 20));
assert.equal(staleLoad.songs[0].title, 'Cached Track', '超过 14 天时应先秒开返回本地缓存');
assert.equal(fetchCalls, 1, '超过 14 天应触发 1 次后台静默刷新');

fakeNow += 2 * HOUR_MS;
await catalogMod.loadMusicCatalog(false);
await new Promise((r) => setTimeout(r, 20));
assert.equal(fetchCalls, 1, '后台刷新失败后 6 小时冷却期内不得重复请求');

fakeNow += 7 * HOUR_MS;
failFetch = false;
await catalogMod.loadMusicCatalog(false);
await new Promise((r) => setTimeout(r, 20));
assert.equal(fetchCalls, 2, '超过 6 小时冷却后应重试后台刷新');
const updatedCatalog = await catalogMod.loadMusicCatalog(false);
assert.equal(updatedCatalog.songs[0].title, '千金', '后台刷新完成后目录内存缓存应自动同步更新');

// Manual force refresh within 5 minutes skips duplicate network hit; succeeds after >5 minutes
await catalogMod.loadMusicCatalog(true);
assert.equal(fetchCalls, 2, '刚刷新完 5 分钟内连点手动刷新不应重复请求接口');

fakeNow += 6 * MIN_MS;
serverTracks = [
  ...serverTracks,
  {
    id: 'r2-2',
    key: 'r2-2',
    title: '不想说再见',
    album: '千金',
    artist: 'SNH48',
    albumArtist: 'SNH48',
    duration: '03:50',
    groupKey: 'SNH',
    groupLabel: 'SNH48',
    mp3: 'https://music.gnz.hk/b.flac',
    coverUrl: 'https://music.gnz.hk/b.jpg',
    sourceIndex: 2,
    source: 'r2-performance',
  },
];
const manualRefreshed = await catalogMod.loadMusicCatalog(true);
assert.equal(fetchCalls, 3, '超过 5 分钟手动冷却后手动刷新应拉取最新曲库');
assert.equal(manualRefreshed.songs.length, 2);

console.log('music-queue-ops.test: ok');
