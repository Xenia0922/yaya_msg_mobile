import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const ts = createRequire(import.meta.url)('typescript');
const source = readFileSync(new URL('../src/utils/data.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
const htmlSrc = readFileSync(new URL('../src/utils/html.ts', import.meta.url), 'utf8');
const htmlMod = { exports: {} };
vm.runInNewContext(
  ts.transpileModule(htmlSrc, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
  { module: htmlMod, exports: htmlMod.exports },
);
const sandbox = {
  exports: {},
  require: (n) => (n === './html' ? htmlMod.exports : { translate: (s) => s }),
};
vm.runInNewContext(compiled, sandbox);
const { messagePayload, messageText, humanizeRawMessageText } = sandbox.exports;

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

// 别人把 REPLY 原文当文本粘贴出来时，复制/引用不能再把整段 JSON 带出去。
assert.equal(humanizeRawMessageText(replyBody), '超孝子佳霞！先突破4强');
assert.equal(humanizeRawMessageText('普通文本'), '普通文本');
assert.equal(humanizeRawMessageText('{坏JSON'), '{坏JSON');

// 礼物回复（GIFTREPLY / AUDIO_GIFT_REPLY）带语音解析
const giftReplyAudioBody = JSON.stringify({
  messageType: 'AUDIO_GIFT_REPLY',
  giftReplyInfo: {
    replyName: '柠檬茴香',
    replyText: '送给 周文迪 1个琴音生花',
    voiceUrl: '/voice/2026/11/16/zwd_flower.m4a',
    duration: '5',
    replyGiftInfo: {
      giftName: '琴音生花',
      giftNum: 1,
      picPath: '/mediasource/gift/flower.png',
    },
  },
});
const giftReplyMsg = {
  msgType: 'GIFTREPLY',
  bodys: giftReplyAudioBody,
};
const giftPayload = messagePayload(giftReplyMsg);
assert.ok(giftPayload.giftReplyInfo, 'giftReplyInfo 应被成功解析');
assert.equal(giftPayload.giftReplyInfo.replyName, '柠檬茴香');
assert.equal(giftPayload.giftReplyInfo.voiceUrl, '/voice/2026/11/16/zwd_flower.m4a');

console.log('房间 REPLY / GIFTREPLY 消息解析（推送/轮询/复制/语音礼物回复）测试通过');
