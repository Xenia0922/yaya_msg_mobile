import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = readFileSync(new URL('../src/utils/privateUnread.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
const module = { exports: {} };
vm.runInNewContext(code, { module, exports: module.exports });
const { privateUnreadCount, sumPrivateConversationUnread } = module.exports;
assert.equal(privateUnreadCount({ content: { noreadNum: 7 } }), 7);
assert.equal(privateUnreadCount({ content: { unreadNum: '3' } }), 3);
assert.equal(privateUnreadCount({ content: { userMessageNum: 4 } }), 4);
assert.equal(
  privateUnreadCount({ content: { userMessageList: [{ noreadNum: 2 }, { unreadNum: '3' }] } }),
  5,
);
assert.equal(
  sumPrivateConversationUnread([{ noreadNum: 1 }, { noreadNum: '2' }, { noreadNum: -1 }]),
  3,
);
assert.equal(privateUnreadCount({ content: 0 }), 0);
assert.equal(privateUnreadCount({ data: '5' }), 5);
assert.equal(privateUnreadCount({ content: { messageNum: 9 } }), 9);
assert.equal(privateUnreadCount({ content: { unreadMessageNum: '2' } }), 2);
assert.equal(privateUnreadCount({ content: {} }), null);
assert.equal(privateUnreadCount({ content: { unreadNum: -1 } }), null);
console.log('私信未读数解析测试通过');
