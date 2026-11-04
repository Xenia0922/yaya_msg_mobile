import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
function load(path, imports) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, require: (name) => {
    if (!(name in imports)) throw new Error(`Unexpected import: ${name}`);
    return imports[name];
  }, console: { log() {} }, setTimeout, clearTimeout });
  return module.exports;
}
let callback;
const adapter = load('../src/native/PocketNimChatroom.ts', {
  'react-native': { Platform: { OS: 'android' }, NativeModules: { PocketNimChatroom: {} }, DeviceEventEmitter: { addListener: (_name, cb) => { callback = cb; return { remove() {} }; } } },
});
const counts = [];
adapter.onChatroomOnline((count) => counts.push(count));
callback({ count: 123 }); callback({ count: 0 }); callback({}); callback({ count: -1 }); callback({ count: 'bad' });
assert.equal(counts.join(','), '123,0', '只有有效人数可进入播放器');

let online;
const noopSubscription = () => () => {};
const native = {
  isPocketNimChatroomAvailable: () => true,
  chatroomConnect: async () => {}, chatroomDisconnect() {}, chatroomSend: async () => '',
  onChatroomMessage: noopSubscription, onChatroomStatus: noopSubscription,
  onChatroomOnline: (cb) => { online = cb; return () => {}; },
};
const { LiveChatroom } = load('../src/services/pocketNim/chatroom.ts', {
  './codec': {}, '../../native/PocketNimChatroom': native,
  './runtime': { NIM_CHATROOM_ADDRESSES: [], NIM_APP_KEY: 'test' },
  './credentials': {}, './types': {},
});
const received = [];
const room = new LiveChatroom({ roomId: '1', credentials: {}, onMessages() {}, onOnlineCount: (count) => received.push(count) });
room.connect();
online(42);
room.dispose();
online(99);
assert.equal(received.join(','), '42', '聊天室在线人数应转发，关闭后不得继续转发');
console.log('直播聊天室在线人数事件测试通过');
