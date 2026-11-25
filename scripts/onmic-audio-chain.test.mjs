import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');

function loadTs(relPath, imports) {
  const source = readFileSync(new URL(relPath, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
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

const createZustand = (init) => {
  let state;
  const listeners = new Set();
  const get = () => state;
  const set = (update) => {
    const patch = typeof update === 'function' ? update(state) : update;
    if (patch && patch !== state) {
      state = { ...state, ...patch };
      for (const listener of listeners) listener(state);
    }
  };
  state = init(set, get);
  return {
    getState: () => state,
    setState: (patch) => set(patch),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
};

// =========================================================================
// 1. audioFocus coordinator tests
// =========================================================================
{
  const audioFocus = loadTs('../src/services/audioFocus.ts', {});
  const events = [];
  const offMusic = audioFocus.registerAudioHandler('music', (r) => events.push(`music:${r}`));
  const offVideo = audioFocus.registerAudioHandler('video', (r) => events.push(`video:${r}`));
  const offMini = audioFocus.registerAudioHandler('mini', (r) => events.push(`mini:${r}`));
  const offRadio = audioFocus.registerAudioHandler('radio', (r) => events.push(`radio:${r}`));
  const offVoice = audioFocus.registerAudioHandler('voice', (r) => events.push(`voice:${r}`));

  audioFocus.claimAudioFocus('video');
  assert.equal(audioFocus.getActiveAudioOwner(), 'video');
  assert.deepEqual(events.sort(), ['mini:video', 'music:video', 'radio:video', 'voice:video']);

  events.length = 0;
  audioFocus.claimAudioFocus('radio');
  audioFocus.setRadioForegroundActive(true);
  assert.equal(audioFocus.isRadioForegroundActive(), true);
  assert.equal(audioFocus.getActiveAudioOwner(), 'radio');

  audioFocus.claimAudioFocus('music');
  assert.equal(
    audioFocus.isRadioForegroundActive(),
    false,
    'music claim clears radio foreground flag',
  );
  assert.equal(audioFocus.getActiveAudioOwner(), 'music');
  assert.ok(events.includes('radio:music'));

  audioFocus.releaseAudioFocus('radio');
  assert.equal(audioFocus.getActiveAudioOwner(), 'music', 'releasing non-active owner is no-op');
  audioFocus.releaseAudioFocus('music');
  assert.equal(audioFocus.getActiveAudioOwner(), null);

  events.length = 0;
  audioFocus.setRadioForegroundActive(true);
  audioFocus.stopAllAudio('logout');
  assert.equal(audioFocus.getActiveAudioOwner(), null);
  assert.equal(audioFocus.isRadioForegroundActive(), false);
  assert.deepEqual(events.sort(), [
    'mini:reset',
    'music:reset',
    'radio:reset',
    'video:reset',
    'voice:reset',
  ]);

  offMusic();
  offVideo();
  offMini();
  offRadio();
  offVoice();
}

// =========================================================================
// 2. onMicStore priority, TTL, per-source cooldown, probeMember, applyVoiceEvent
// =========================================================================
const scheduler = loadTs('../src/services/perfScheduler.ts', {
  react: { useSyncExternalStore: () => 'Home' },
  'react-native': {
    AppState: {
      currentState: 'active',
      addEventListener: () => ({ remove: () => {} }),
    },
  },
});

{
  const kv = new Map();
  const removedKeys = [];
  const operateCalls = [];
  /** @type {(params: any) => Promise<any>} */
  let operateResponder = async () => ({ status: 200, content: {} });

  /** @type {Record<string, any>} */
  const roomMapData = {
    m1: { channelId: '101', serverId: '1', yklzId: '201' },
    m2: { channelId: '102', serverId: '2', yklzId: '202' },
    m3: { channelId: '103', serverId: '3', yklzId: '203' },
  };

  /** @param {boolean} [fastGap] */
  function makeStore(fastGap = false) {
    scheduler.resetSchedulerForTest();
    scheduler.setActiveRouteName('OnMicScreen');
    return loadTs('../src/store/onMicStore.ts', {
      '@react-native-async-storage/async-storage': {
        __esModule: true,
        default: {
          getItem: async (k) => (kv.has(k) ? kv.get(k) : null),
          setItem: async (k, v) => {
            kv.set(k, v);
          },
          removeItem: async (k) => {
            removedKeys.push(k);
            kv.delete(k);
          },
        },
      },
      zustand: { create: createZustand },
      '../api/pocket48': {
        __esModule: true,
        default: {
          operateRoomVoice: async (params) => {
            operateCalls.push(params);
            return operateResponder(params);
          },
        },
      },
      '../utils/runtimeLog': { logInfo: () => {}, logWarn: () => {} },
      '../services/roomMapCache': {
        hydrateRoomMap: async () => {},
        getRoomMapEntry: (id) => roomMapData[id] || null,
      },
      '../services/perfScheduler': fastGap
        ? {
            ...scheduler,
            /** @param {string} owner @param {any} role */
            getTaskBudget: (owner, role) => ({
              ...scheduler.getTaskBudget(owner, role),
              gapMs: 0,
              commitBatchMs: 0,
            }),
          }
        : scheduler,
    });
  }

  // 2a. Priority ordering & O(N) dedup & stream freshness helper
  {
    const mod = makeStore();
    const candidates = [
      { memberId: 'm1', name: 'A', channelId: '101', serverId: '1' },
      { memberId: 'm1', name: 'A-dup', channelId: '101', serverId: '1' },
      { memberId: 'm4', name: 'Grad', channelId: '104', serverId: '4', isInGroup: false },
      { memberId: 'm3', name: 'C', channelId: '103', serverId: '3' },
      { memberId: 'm2', name: 'B', channelId: '102', serverId: '2' },
    ];
    const ordered = mod.orderOnMicCandidates(candidates, {
      activeIds: new Set(['m3']),
      priorityIds: new Set(['m2']),
      probedAt: { m1: 50 },
    });
    assert.deepEqual(
      Array.from(ordered, (x) => x.memberId),
      ['m3', 'm2', 'm1'],
      'active(Tier0) -> followed(Tier1) -> rest(Tier2), deduped & skipping non-group',
    );
    assert.equal(
      mod.isOnMicStreamFresh({ streamUrl: 'rtmp://live', updatedAt: Date.now() - 30_000 }),
      true,
    );
    assert.equal(
      mod.isOnMicStreamFresh({ streamUrl: 'rtmp://live', updatedAt: Date.now() - 5 * 60_000 }),
      false,
    );
  }

  // 2b. Expired (>10min) snapshot discarded & removed
  {
    kv.clear();
    removedKeys.length = 0;
    operateCalls.length = 0;
    kv.set(
      'yaya_onmic_snapshot_v1',
      JSON.stringify({
        savedAt: Date.now() - 15 * 60 * 1000,
        entries: {
          m1: {
            memberId: 'm1',
            name: 'Stale',
            channelId: '101',
            serverId: '1',
            smallChannelId: '201',
            hasRadio: true,
            onMicCount: 1,
            streamUrl: 'rtmp://old',
            updatedAt: Date.now() - 15 * 60 * 1000,
          },
        },
      }),
    );
    const mod = makeStore();
    await mod.useOnMicStore
      .getState()
      .scan([{ memberId: 'm2', name: 'B', channelId: '102', serverId: '2' }], { source: 'onMic' });
    assert.equal(mod.useOnMicStore.getState().onMic.m1, undefined, 'stale >10m snapshot dropped');
    assert.ok(removedKeys.includes('yaya_onmic_snapshot_v1'));
  }

  // 2c. Valid (<10min) but stale stream (>2min) strips streamUrl cleanly
  {
    kv.clear();
    removedKeys.length = 0;
    kv.set(
      'yaya_onmic_snapshot_v1',
      JSON.stringify({
        savedAt: Date.now() - 4 * 60 * 1000,
        entries: {
          m1: {
            memberId: 'm1',
            name: 'Warm',
            channelId: '101',
            serverId: '1',
            smallChannelId: '201',
            hasRadio: true,
            onMicCount: 1,
            streamUrl: 'rtmp://maybe-stale',
            updatedAt: Date.now() - 4 * 60 * 1000,
          },
        },
      }),
    );
    const mod = makeStore();
    await mod.useOnMicStore
      .getState()
      .scan([{ memberId: 'm2', name: 'B', channelId: '102', serverId: '2' }], { source: 'onMic' });
    assert.equal(mod.useOnMicStore.getState().onMic.m1.name, 'Warm');
    assert.equal(mod.useOnMicStore.getState().onMic.m1.streamUrl, undefined);
  }

  // 2d. Per-source cooldown: rooms scan does NOT block onMic scan, priority member scanned
  {
    kv.clear();
    operateCalls.length = 0;
    operateResponder = async ({ channelId }) =>
      channelId === '202'
        ? {
            status: 200,
            content: {
              streamUrl: 'rtmp://small-202',
              voiceUserList: [{ userId: 'm2', voiceStatus: true }],
            },
          }
        : { status: 200, content: {} };

    const mod = makeStore();
    scheduler.setActiveRouteName('Rooms');
    await mod.useOnMicStore
      .getState()
      .scan([{ memberId: 'm1', name: 'A', channelId: '101', serverId: '1' }], { source: 'rooms' });
    assert.ok(mod.useOnMicStore.getState().lastScanBySource.rooms > 0);
    assert.equal(mod.useOnMicStore.getState().lastScanBySource.onMic, 0);

    operateCalls.length = 0;
    scheduler.setActiveRouteName('OnMicScreen');
    await mod.useOnMicStore.getState().scan(
      [
        { memberId: 'm1', name: 'A', channelId: '101', serverId: '1' },
        { memberId: 'm2', name: 'B', channelId: '102', serverId: '2', smallChannelId: '202' },
      ],
      { source: 'onMic', priorityIds: ['m2'] },
    );
    assert.equal(operateCalls[0].channelId, '102', 'followed priority member m2 runs first');
    const hitM2 = mod.useOnMicStore.getState().onMic.m2;
    assert.equal(hitM2.smallVoice, true);
    assert.equal(hitM2.streamUrl, 'rtmp://small-202');

    // Second immediate non-force rooms scan IS throttled, while probeMember still runs cleanly
    operateCalls.length = 0;
    await mod.useOnMicStore
      .getState()
      .scan([{ memberId: 'm1', name: 'A', channelId: '101', serverId: '1' }], { source: 'rooms' });
    assert.equal(operateCalls.length, 0, 'rooms scan throttled within 60s');

    operateResponder = async () => ({ status: 200, content: {} });
    const probed = await mod.useOnMicStore.getState().probeMember({
      memberId: 'm2',
      name: 'B',
      channelId: '102',
      serverId: '2',
      smallChannelId: '202',
    });
    assert.equal(probed, null);
    assert.equal(
      mod.useOnMicStore.getState().onMic.m2,
      undefined,
      'off-air probe clears zombie entry',
    );
  }

  // 2e. applyVoiceEvent: dedup + small room preservation + does NOT alter lastScan
  {
    kv.clear();
    const mod = makeStore();
    const beforeScan = mod.useOnMicStore.getState().lastScan;
    const ev = {
      kind: 'member',
      serverId: '2',
      channelId: '202',
      operateType: 'openVoice',
      streamUrl: 'rtmp://ev-small',
      users: [
        { userId: 'm2', nickname: 'B', avatar: '', micState: true },
        { userId: 'u9', nickname: 'Guest', avatar: '', micState: true },
      ],
    };
    mod.useOnMicStore.getState().applyVoiceEvent(ev);
    const entry = mod.useOnMicStore.getState().onMic.m2;
    assert.equal(entry.channelId, '102', 'keeps big channelId from roomMap');
    assert.equal(entry.smallChannelId, '202');
    assert.equal(entry.smallVoice, true);
    assert.equal(entry.onMicCount, 2);
    assert.equal(
      mod.useOnMicStore.getState().lastScan,
      beforeScan,
      'event must not reset scan cooldown',
    );

    // Duplicate within 800ms ignored even if we manually deleted to observe
    mod.useOnMicStore.setState({ onMic: {} });
    mod.useOnMicStore.getState().applyVoiceEvent(ev);
    assert.equal(mod.useOnMicStore.getState().onMic.m2, undefined, 'duplicate event suppressed');

    // Close small room removes entry
    mod.useOnMicStore.setState({ onMic: { m2: entry } });
    mod.useOnMicStore.getState().applyVoiceEvent({
      kind: 'room',
      serverId: '2',
      channelId: '202',
      active: false,
      users: [],
    });
    assert.equal(mod.useOnMicStore.getState().onMic.m2, undefined, 'room close cleans smallVoice');
  }

  // 2f. Offscreen onMic downgrade caps at 28 tasks, keeps hits + probedAt, avoids cooldown block
  {
    kv.clear();
    operateCalls.length = 0;
    operateResponder = async ({ channelId }) =>
      channelId === '3000'
        ? {
            status: 200,
            content: {
              streamUrl: 'rtmp://bg-hit-0',
              voiceUserList: [{ userId: 'c00', voiceStatus: true }],
            },
          }
        : { status: 200, content: {} };

    const candidates35 = Array.from({ length: 35 }, (_, idx) => {
      const id = `c${String(idx).padStart(2, '0')}`;
      return {
        memberId: id,
        name: `Member${idx}`,
        channelId: String(3000 + idx),
        serverId: String(400 + idx),
      };
    });

    const mod = makeStore(true);
    scheduler.setActiveRouteName('Rooms');
    await mod.useOnMicStore.getState().scan(candidates35, { source: 'onMic' });

    assert.equal(
      operateCalls.length,
      28,
      'offscreen onMic scan caps gentle continuation at 28 tasks',
    );
    assert.equal(mod.useOnMicStore.getState().onMic.c00?.streamUrl, 'rtmp://bg-hit-0');
    assert.equal(Object.keys(mod.useOnMicStore.getState().probedAt).length, 28);
    assert.equal(
      mod.useOnMicStore.getState().lastScanBySource.onMic,
      0,
      'budget-paused offscreen scan must NOT lock onMic cooldown',
    );

    // Focusing OnMicScreen resumes unprobed tail right after active hit without cooldown block
    operateCalls.length = 0;
    scheduler.setActiveRouteName('OnMicScreen');
    await mod.useOnMicStore.getState().scan(candidates35, { source: 'onMic' });
    assert.equal(operateCalls.length, 35, 'full scan runs immediately once focused');
    const firstEight = new Set(operateCalls.slice(0, 8).map((c) => c.channelId));
    assert.equal(firstEight.has('3000'), true, 'active onMic hit c00 stays Tier 0 first');
    for (let idx = 28; idx < 35; idx += 1) {
      assert.equal(
        firstEight.has(String(3000 + idx)),
        true,
        `unprobed tail ${3000 + idx} prioritized right after active Tier 0 on refocus`,
      );
    }
    assert.ok(mod.useOnMicStore.getState().lastScanBySource.onMic > 0);
  }
}

// =========================================================================
// 3. radio.ts strict big/small mode isolation vs allowFallbackMode
// =========================================================================
{
  const calls = [];
  const radio = loadTs('../src/services/radio.ts', {
    '../api/pocket48': {
      __esModule: true,
      default: {
        operateRoomVoice: async ({ channelId }) => {
          calls.push(channelId);
          return channelId === '901'
            ? { status: 200, content: { streamUrl: 'rtmp://big-901' } }
            : { status: 200, content: {} };
        },
      },
    },
    './roomMapCache': {
      resolveMemberRooms: async () => ({ channelId: '901', yklzId: '', serverId: '9' }),
    },
    '../utils/data': { pickText: (obj, keys) => obj?.content?.streamUrl || '' },
    '../store': {
      useMemberStore: { getState: () => ({ patchMemberByUserId: () => {} }) },
    },
    '../player/resolve/streamResolver': { isRtmpUrl: (u) => /^rtmp:/i.test(u) },
  });

  await assert.rejects(
    () =>
      radio.fetchMemberRadioStream(
        { id: '90', ownerName: 'Test', channelId: '901', serverId: '9' },
        'small',
      ),
    (/** @type {any} */ err) => err?.code === 'NO_CHANNEL',
    'strict small mode without yklzId must NOT silently return big room stream',
  );
  assert.equal(calls.length, 0);

  const fallbackRes = await radio.fetchMemberRadioStream(
    { id: '90', ownerName: 'Test', channelId: '901', serverId: '9' },
    'small',
    { allowFallbackMode: true },
  );
  assert.equal(fallbackRes.mode, 'big');
  assert.equal(fallbackRes.url, 'rtmp://big-901');
}

// =========================================================================
// 4. pocketSharedData.ts dedup, mutateFollowedIdShared broadcast & reset
// =========================================================================
{
  let followedReqCount = 0;
  let liveReqCount = 0;
  const diskWritten = [];
  const dataUtils = loadTs('../src/utils/data.ts', {
    '../i18n': { translate: (k) => k },
    './html': { sanitizeText: (s) => String(s || '') },
    './imageThumb': loadTs('../src/utils/imageThumb.ts', {}),
    './emojiMap': { __esModule: true, default: {} },
  });

  const shared = loadTs('../src/services/pocketSharedData.ts', {
    '../api/pocket48': {
      __esModule: true,
      default: {
        getFollowedIds: async () => {
          followedReqCount += 1;
          await new Promise((r) => setTimeout(r, 15));
          return { status: 200, content: { data: ['10', '20'] } };
        },
        getLiveList: async () => {
          liveReqCount += 1;
          await new Promise((r) => setTimeout(r, 15));
          return { status: 200, content: { liveList: [{ liveId: 'L1' }] } };
        },
      },
    },
    '../utils/data': dataUtils,
    './followedIds': {
      readFollowedIdsCache: async () => ({ ids: [], cached: false }),
      writeFollowedIdsCache: async (tk, ids) => {
        diskWritten.push({ tk, ids });
      },
    },
  });

  const notifications = [];
  const off = shared.subscribeFollowedIds((ids, tk) => {
    notifications.push({ tk, ids: Array.from(ids).sort() });
  });

  const [a, b, c] = await Promise.all([
    shared.fetchFollowedIdsShared('tok-1'),
    shared.fetchFollowedIdsShared('tok-1'),
    shared.fetchFollowedIdsShared('tok-1'),
  ]);
  assert.equal(followedReqCount, 1, 'concurrent getFollowedIds calls deduped to 1');
  assert.deepEqual(Array.from(a), ['10', '20']);
  assert.deepEqual(Array.from(b), ['10', '20']);
  assert.deepEqual(Array.from(c), ['10', '20']);

  const cachedHit = await shared.fetchFollowedIdsShared('tok-1');
  assert.equal(followedReqCount, 1, 'TTL cache serves repeat call without extra request');
  assert.deepEqual(Array.from(cachedHit), ['10', '20']);

  shared.mutateFollowedIdShared('tok-1', '30', true);
  assert.deepEqual(notifications[notifications.length - 1], {
    tk: 'tok-1',
    ids: ['10', '20', '30'],
  });
  assert.equal(diskWritten[diskWritten.length - 1].ids.includes('30'), true);

  const [l1, l2] = await Promise.all([shared.fetchLiveListShared(), shared.fetchLiveListShared()]);
  assert.equal(liveReqCount, 1, 'concurrent getLiveList calls deduped to 1');
  assert.equal(l1.content.liveList[0].liveId, 'L1');
  assert.equal(l2.content.liveList[0].liveId, 'L1');

  shared.resetSharedPocketData();
  assert.deepEqual(notifications[notifications.length - 1], { tk: '', ids: [] });
  assert.equal(shared.peekFollowedIdsShared('tok-1').size, 0);

  off();
}

// =========================================================================
// 5. perfScheduler.ts transition yield, route subscriptions & adaptive budgets
// =========================================================================
{
  scheduler.resetSchedulerForTest();
  /** @type {string[]} */
  const routeEvents = [];
  const unsub = scheduler.subscribeActiveRouteName(() => {
    routeEvents.push(scheduler.getActiveRouteName());
  });

  scheduler.setActiveRouteName('Rooms');
  scheduler.setActiveRouteName('Rooms'); // duplicate no-op
  scheduler.setActiveRouteName('Media');
  assert.deepEqual(
    routeEvents,
    ['Rooms', 'Media'],
    'active route notifies subscribers on change only',
  );
  assert.equal(scheduler.getActiveRouteName(), 'Media');

  // Adaptive budgets: focused vs offscreen downgrade
  scheduler.setActiveRouteName('Rooms');
  const bgFocused = scheduler.getTaskBudget('Rooms', 'roomBg');
  const timeFocused = scheduler.getTaskBudget('Rooms', 'roomTime');
  const onMicOff = scheduler.getTaskBudget('OnMicScreen', 'onMic');
  assert.equal(bgFocused.focused, true);
  assert.equal(bgFocused.concurrency, 2);
  assert.equal(timeFocused.focused, true);
  assert.equal(timeFocused.concurrency, 3);
  assert.equal(onMicOff.focused, false);
  assert.equal(onMicOff.concurrency, 1);
  assert.ok(onMicOff.gapMs > 0);
  assert.ok(onMicOff.commitBatchMs > 0);

  scheduler.setActiveRouteName('OnMicScreen');
  assert.equal(scheduler.getTaskBudget('OnMicScreen', 'onMic').concurrency, 6);
  const bgOff = scheduler.getTaskBudget('Rooms', 'roomBg');
  assert.equal(bgOff.focused, false);
  assert.equal(bgOff.concurrency, 1);
  assert.ok(bgOff.gapMs > 0);

  // Transition gate suspends background waitForIdleSlot until transition completes
  scheduler.notifyTransitionStart('tab-switch', 70);
  assert.equal(scheduler.isTransitioning(), true);
  let settled = false;
  const waitP = scheduler.waitForIdleSlot('background').then((ok) => {
    settled = true;
    return ok;
  });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(settled, false, 'background slot must yield while UI transition is active');
  assert.equal(await waitP, true, 'background slot resumes automatically after transition window');
  assert.equal(scheduler.isTransitioning(), false);

  // AppState background pauses background work until active returns
  scheduler.setAppActiveForTest(false);
  let bgResumed = false;
  const bgP = scheduler.waitForIdleSlot('background').then((ok) => {
    bgResumed = true;
    return ok;
  });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(bgResumed, false, 'OS background must pause background workers');
  scheduler.setAppActiveForTest(true);
  assert.equal(await bgP, true);

  // Cancellation predicate returns false immediately when aborted while paused
  scheduler.setAppActiveForTest(false);
  let active = true;
  const cancelP = scheduler.waitForIdleSlot('background', () => active);
  active = false;
  scheduler.wakeIdleWaiters();
  assert.equal(await cancelP, false);
  scheduler.setAppActiveForTest(true);

  unsub();
  scheduler.resetSchedulerForTest();
}

// =========================================================================
// 6. useUiStore toastId lifecycle & AppToast passive replay prevention
// =========================================================================
{
  const uiMod = loadTs('../src/store/index.ts', {
    zustand: { create: createZustand },
    '../utils/data': { parseMaybeJson: (/** @type {any} */ s) => JSON.parse(s) },
    '@react-native-async-storage/async-storage': {
      __esModule: true,
      default: {
        getItem: async () => null,
        setItem: async () => {},
        multiGet: async () => [],
      },
    },
    '../constants': { APP_VERSION: '2.9.1' },
    '../constants/channel': { IS_PLUS_BUILD: false },
    '../services/settings': { DEFAULT_SETTINGS: {} },
    '../utils/updateCache': {
      evaluateUpdateFromCache: () => ({}),
      isNewerVersion: () => false,
      localTodayKey: () => '2026-11-24',
      parseUpdateCache: () => ({}),
      shouldPromptDailyUpdate: () => false,
    },
  });

  const ui = uiMod.useUiStore;
  ui.getState().showToast('Toast 1');
  assert.equal(ui.getState().toastId, 1);
  assert.equal(ui.getState().toastMessage, 'Toast 1');

  ui.getState().showToast('更新成功：成员 900 位');
  assert.equal(ui.getState().toastId, 2);
  assert.equal(ui.getState().toastMessage, '更新成功：成员 900 位');

  // Stale timer callback must NOT wipe newer toast
  ui.getState().hideToast(1);
  assert.equal(ui.getState().toastMessage, '更新成功：成员 900 位');
  assert.equal(ui.getState().toastId, 2);

  // Matching expectedId clears toastMessage while preserving monotonic toastId
  ui.getState().hideToast(2);
  assert.equal(ui.getState().toastMessage, '');
  assert.equal(ui.getState().toastId, 2);

  // Repeated identical messages advance toastId; empty message clears
  ui.getState().showToast('下载完成');
  assert.equal(ui.getState().toastId, 3);
  ui.getState().showToast('下载完成');
  assert.equal(ui.getState().toastId, 4);
  ui.getState().showToast('');
  assert.equal(ui.getState().toastMessage, '');
  ui.getState().hideToast();

  // Passive AppToast inside ZoomImageModal must not replay pre-existing toasts
  assert.equal(
    uiMod.shouldRenderToast({
      message: '更新成功：成员 900 位',
      toastId: 2,
      passive: true,
      mountedToastId: 2,
    }),
    false,
    'passive modal toast must ignore active toast that existed before open',
  );
  assert.equal(
    uiMod.shouldRenderToast({
      message: '更新成功：成员 900 位',
      toastId: 2,
      passive: true,
      mountedToastId: 3,
    }),
    false,
  );
  assert.equal(
    uiMod.shouldRenderToast({
      message: '下载完成',
      toastId: 3,
      passive: true,
      mountedToastId: 2,
    }),
    true,
    'passive modal toast displays new toasts triggered inside modal',
  );
  assert.equal(
    uiMod.shouldRenderToast({
      message: '下载完成',
      toastId: 3,
      passive: false,
      mountedToastId: 0,
    }),
    true,
  );

  // Guard against reintroducing Reanimated worklet ref-caching bug in AppToast
  const appToastSrc = readFileSync(
    new URL('../src/components/AppToast.tsx', import.meta.url),
    'utf8',
  );
  assert.equal(
    /\brunOnJS\b/.test(appToastSrc),
    false,
    'AppToast must not clear toast via Reanimated runOnJS worklet callback',
  );
  assert.equal(
    /\bseqRef\b/.test(appToastSrc),
    false,
    'AppToast must not capture React seqRef inside worklet closure',
  );

  // =======================================================================
  // 7. useMemberStore no-op writes preserve members reference & avoid churn
  // =======================================================================
  const memberStore = uiMod.useMemberStore;
  const mA = { id: 'm1', channelId: '101', serverId: '201', yklzId: '301' };
  const mB = { id: 'm2', channelId: '102', serverId: '202', yklzId: '' };
  memberStore.getState().setMembers([mA, mB]);

  let memberNotifies = 0;
  const unsubMember = memberStore.subscribe(() => {
    memberNotifies += 1;
  });
  const initialMembers = memberStore.getState().members;

  // Same serverId/yklzId or unknown channelId must be exact no-op
  memberStore.getState().updateMemberRoomIds('101', { serverId: '201' });
  memberStore.getState().updateMemberRoomIds('999', { serverId: '888' });
  memberStore.getState().batchUpdateSmallRooms([{ channelId: '101', yklzId: '301' }]);
  memberStore.getState().patchMemberByUserId('m2', { serverId: '202' });
  assert.equal(memberStore.getState().members, initialMembers, 'no-op patch keeps exact reference');
  assert.equal(memberNotifies, 0, 'no-op patch fires zero subscribers');

  // Real change updates only matching member and preserves untouched member object
  memberStore.getState().updateMemberRoomIds('102', { yklzId: '302' });
  assert.equal(memberNotifies, 1);
  assert.notEqual(memberStore.getState().members, initialMembers);
  assert.equal(memberStore.getState().members[0], mA, 'untouched member preserves reference');
  assert.equal(memberStore.getState().members[1].yklzId, '302');

  // Batch update changes mB only once, then repeats as no-op
  memberStore.getState().batchUpdateSmallRooms([
    { channelId: '101', yklzId: '301' },
    { channelId: '102', yklzId: '302' },
  ]);
  assert.equal(memberNotifies, 1, 'already matching batchUpdateSmallRooms is no-op');

  // patchMemberByUserId changes mA only when value actually differs
  memberStore.getState().patchMemberByUserId('m1', { roomId: 'r1' });
  assert.equal(memberNotifies, 2);
  assert.equal(memberStore.getState().members[0].roomId, 'r1');
  memberStore.getState().patchMemberByUserId('m1', { roomId: 'r1' });
  assert.equal(memberNotifies, 2);

  unsubMember();
}

console.log('上麦、音频焦点、跨页共享与性能调度链路测试通过');
