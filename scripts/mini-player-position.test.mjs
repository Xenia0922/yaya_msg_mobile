import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = readFileSync(new URL('../src/store/miniPlayerStore.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const module = { exports: {} };
const create = (init) => {
  let state;
  const set = (update) => { state = { ...state, ...(typeof update === 'function' ? update(state) : update) }; };
  state = init(set);
  return { getState: () => state };
};
vm.runInNewContext(compiled, {
  module, exports: module.exports,
  require: (name) => name === 'zustand'
    ? { create }
    : { useMusicPlayerStore: { getState: () => ({ queue: [] }) } },
});
const store = module.exports.useMiniPlayerStore;
const info = { url: 'video', title: '录播', isLive: false, position: 135, backTo: { mode: 'vod', playUrl: 'video' } };
store.getState().open(info);
assert.equal(store.getState().currentPos, 135, '尚未收到进度事件时应保留录播位置');
store.getState().setCurrentPos(140);
assert.equal(store.getState().currentPos, 140, '收到进度事件后使用最新位置');
store.getState().open({ ...info, isLive: true });
assert.equal(store.getState().currentPos, 0, '直播不继承录播位置');
store.getState().open({ ...info, position: -1 });
assert.equal(store.getState().currentPos, 0, '异常负数位置归零');
store.getState().close();
assert.equal(store.getState().currentPos, 0, '关闭后清理进度');
console.log('小窗录播进度测试通过');
