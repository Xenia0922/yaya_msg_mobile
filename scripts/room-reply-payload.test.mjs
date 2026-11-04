import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const ts = createRequire(import.meta.url)('typescript');
const source = readFileSync(new URL('../src/utils/data.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const sandbox = { exports: {}, require: () => ({ translate: (s) => s }) };
vm.runInNewContext(compiled, sandbox);
const { messagePayload, messageText } = sandbox.exports;

// 实时推送（QChat）把官方 bodys 原文塞在 bodys.text 里：REPLY 是一整段 JSON。
const replyBody = JSON.stringify({
  replyInfo: {
    replyMessageId: 'ecc350d5553b45aeaad4c5c84bbfa61',
    replyName: '从来单推得人心',
    replyText: 'iq拿什么打gen，十零开，百零开，万零开！',
    text: '超孝子佳霞！先突破4强',
    userId: 0,
  },
  messageType: 'REPLY',
});
const pushed = {
  msgType: 'REPLY',
  bodys: {
    text: replyBody,
    messageType: 'REPLY',
    user: { userId: 123, nickName: '最爱纯纯的小N' },
  },
};

const payload = messagePayload(pushed);
assert.ok(payload.replyInfo, 'bodys.text 里的 replyInfo 应被解析出来');
assert.equal(payload.replyInfo.replyName, '从来单推得人心');
assert.equal(payload.messageType, 'REPLY');
assert.equal(payload.user.nickName, '最爱纯纯的小N', '外层 user 不能被覆盖');

const shown = messageText(pushed);
assert.ok(!shown.includes('"replyInfo"'), `气泡不应显示原始 JSON，实际=${shown}`);
assert.ok(shown.includes('超孝子佳霞'), `应显示回复正文，实际=${shown}`);
assert.ok(shown.includes('从来单推得人心'), `应显示被回复者，实际=${shown}`);

// 普通文本里长得像 JSON 的内容不能被误改。
const plain = { msgType: 'TEXT', bodys: { text: '{不是JSON', messageType: 'TEXT' } };
assert.equal(messageText(plain), '{不是JSON');

// HTTP 轮询拿到的 bodys 本身是 JSON 字符串，走原有解析分支。
const polled = { msgType: 'REPLY', bodys: replyBody };
assert.ok(messagePayload(polled).replyInfo);
assert.ok(!messageText(polled).includes('"replyInfo"'));

console.log('房间 REPLY 消息解析（推送/轮询）测试通过');
