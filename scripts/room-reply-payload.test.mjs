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
const { messagePayload, messageText, messagePreviewText, humanizeRawMessageText } = sandbox.exports;

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

// DELETE 控制消息 / 墓碑识别、ID 提取、房间过滤与预览跳过
{
  /** @param {string} relPath @param {Record<string, any>} imports */
  function loadTs(relPath, imports) {
    const src = readFileSync(new URL(relPath, import.meta.url), 'utf8');
    const out = ts.transpileModule(src, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        esModuleInterop: true,
      },
    }).outputText;
    const mod = { exports: {} };
    vm.runInNewContext(out, {
      module: mod,
      exports: mod.exports,
      require: (/** @type {string} */ id) => {
        if (!(id in imports)) throw new Error(`Unexpected require("${id}") in ${relPath}`);
        return imports[id];
      },
      console,
    });
    return mod.exports;
  }

  const dataMod = loadTs('../src/utils/data.ts', {
    '../i18n': { translate: (/** @type {any} */ s) => s },
    './html': htmlMod.exports,
    './imageThumb': {},
    './emojiMap': { __esModule: true, default: {} },
  });
  const formatMod = loadTs('../src/utils/format.ts', {});
  const messageUtils = loadTs('../src/screens/followedRooms/messageUtils.ts', {
    '../../utils/data': dataMod,
    '../../utils/format': formatMod,
    '../../i18n': { t: (/** @type {any} */ s) => s },
  });
  const roomDomain = loadTs('../src/screens/followedRooms/roomDomain.ts', {
    '../../i18n': { t: (/** @type {any} */ s) => s },
    '../../utils/data': dataMod,
    './messageUtils': messageUtils,
  });

  // (a) QChat pushed DELETE control message
  const qchatDel = {
    msgType: 'DELETE',
    msgTime: 1732400002000,
    bodys: {
      text: '',
      messageType: 'DELETE',
      deleteInfo: { msgIdClient: 'orig-1' },
      user: { userId: 123, nickName: '测试' },
    },
  };
  assert.equal(dataMod.isDeletedMessage(qchatDel), true);
  assert.equal(dataMod.isHiddenControlMessage(qchatDel), true);
  assert.equal(dataMod.messageText(qchatDel), '');
  assert.equal(dataMod.extractDeletedMessageIds(qchatDel).includes('orig-1'), true);

  // (b) HTTP tombstone DELETE + raw 'DELETE' string + extInfo DELETE
  const httpDel = {
    msgType: 'DELETE',
    msgIdClient: 'orig-2',
    bodys: '{"messageType":"DELETE"}',
  };
  assert.equal(dataMod.isDeletedMessage(httpDel), true);
  assert.equal(dataMod.messageText(httpDel), '');
  assert.equal(dataMod.extractDeletedMessageIds(httpDel).includes('orig-2'), true);

  const rawStringDel = { bodys: 'DELETE' };
  assert.equal(dataMod.isDeletedMessage(rawStringDel), true);
  assert.equal(dataMod.messageText(rawStringDel), '');

  const extInfoDel = {
    msgIdClient: 'orig-3',
    extInfo: '{"messageType":"DELETE"}',
    bodys: { text: '', user: { userId: 1 } },
  };
  assert.equal(dataMod.isDeletedMessage(extInfoDel), true);
  assert.equal(dataMod.messageText(extInfoDel), '');
  assert.equal(dataMod.extractDeletedMessageIds(extInfoDel).includes('orig-3'), true);

  // (c) TEAM_VOICE / VOICE_OPERATE hidden control but not DELETE
  const teamVoice = {
    msgType: 'TEAM_VOICE',
    bodys: { messageType: 'TEAM_VOICE', operateType: 'openVoice' },
  };
  const voiceOp = {
    msgType: 'VOICE_OPERATE',
    bodys: { messageType: 'VOICE_OPERATE' },
  };
  assert.equal(dataMod.isDeletedMessage(teamVoice), false);
  assert.equal(dataMod.isHiddenControlMessage(teamVoice), true);
  assert.equal(dataMod.messageText(teamVoice), '');
  assert.equal(dataMod.isDeletedMessage(voiceOp), false);
  assert.equal(dataMod.isHiddenControlMessage(voiceOp), true);
  assert.equal(dataMod.messageText(voiceOp), '');

  // (d) Normal user TEXT literal 'DELETE' must NOT be treated as DELETE control
  const userTextObj = { msgType: 'TEXT', bodys: { text: 'DELETE', messageType: 'TEXT' } };
  const userTextStr = { msgType: 'TEXT', bodys: 'DELETE' };
  assert.equal(dataMod.isDeletedMessage(userTextObj), false);
  assert.equal(dataMod.isHiddenControlMessage(userTextObj), false);
  assert.equal(dataMod.messageText(userTextObj), 'DELETE');
  assert.equal(dataMod.isDeletedMessage(userTextStr), false);
  assert.equal(dataMod.isHiddenControlMessage(userTextStr), false);
  assert.equal(dataMod.messageText(userTextStr), 'DELETE');

  // (e) qchatToRoomMessage preserves msgIdClient and messageKey resolves it
  const mappedLive = messageUtils.qchatToRoomMessage({
    uuid: 'client-uuid-99',
    serverId: 10,
    channelId: 20,
    fromAccount: 'acc',
    fromNick: 'Tester',
    time: 1732400001000,
    text: 'hello',
    messageType: 'TEXT',
    attachment: {},
    ext: { user: { userId: 77, nickName: 'Tester' } },
  });
  assert.equal(mappedLive.msgIdClient, 'client-uuid-99');
  assert.equal(roomDomain.messageKey({ msgIdClient: 'only-client-1' }), 'only-client-1');

  // (f) mergeMessages evicts deleted target by msgIdClient without inserting DELETE tombstone
  const existing = {
    msgIdClient: 'orig-1',
    msgTime: 1732400001000,
    msgType: 'TEXT',
    bodys: { text: '准备撤回的消息', messageType: 'TEXT' },
  };
  const kept = {
    msgId: 'keep-1',
    msgTime: 1732400000000,
    msgType: 'TEXT',
    bodys: { text: '保留消息', messageType: 'TEXT' },
  };
  const afterMerge = roomDomain.mergeMessages([existing, kept], [qchatDel]);
  assert.deepEqual(
    Array.from(afterMerge, (/** @type {any} */ m) => m.msgId || m.msgIdClient),
    ['keep-1'],
    '收到带 msgIdClient 的 DELETE 后必须移除原消息且不残留 DELETE 气泡',
  );

  // (g) filterVisibleRoomMessages strips DELETE + TEAM_VOICE and evicts target messages
  const filteredRes = roomDomain.filterVisibleRoomMessages([
    {
      msgIdClient: 'orig-2',
      msgTime: 1732400001500,
      msgType: 'TEXT',
      bodys: { text: '将被过滤', messageType: 'TEXT' },
    },
    httpDel,
    teamVoice,
    kept,
  ]);
  assert.equal(filteredRes.deletedIdsFound.includes('orig-2'), true);
  assert.deepEqual(
    Array.from(filteredRes.visible, (/** @type {any} */ m) => m.msgId || m.msgIdClient),
    ['keep-1'],
  );

  // (h) findLastMessage / findSmallLastMessage skip DELETE records
  const member = { id: '77', channelId: '20', yklzId: '21' };
  const bigMsgs = [
    { ...qchatDel, channelId: '20', userId: '77' },
    { ...kept, channelId: '20', userId: '77', msgTime: 1732400000500 },
  ];
  const smallMsgs = [
    { ...httpDel, channelId: '21', userId: '77' },
    {
      msgId: 'small-keep',
      channelId: '21',
      userId: '77',
      msgType: 'TEXT',
      bodys: { text: '小房间消息' },
    },
  ];
  assert.equal(messageUtils.findLastMessage(bigMsgs, member)?.msgId, 'keep-1');
  assert.equal(messageUtils.findSmallLastMessage(smallMsgs, member)?.msgId, 'small-keep');

  // (i) messagePreviewText preserves media labels for room list rows while messageText remains empty
  const imgMsg = {
    msgId: 'img-1',
    msgType: 'IMAGE',
    bodys: JSON.stringify({ url: 'https://source.48.cn/a.jpg', width: 100, height: 100 }),
  };
  const audioMsg = {
    msgId: 'aud-1',
    msgType: 'AUDIO',
    bodys: JSON.stringify({ url: 'https://source.48.cn/a.m4a', dur: 3000 }),
  };
  const videoMsg = {
    msgId: 'vid-1',
    msgType: 'VIDEO',
    bodys: JSON.stringify({ url: 'https://source.48.cn/a.mp4' }),
  };
  const captionedImg = {
    msgId: 'img-2',
    msgType: 'IMAGE',
    bodys: { text: '早安图', url: 'https://source.48.cn/b.jpg' },
  };
  assert.equal(messageText(imgMsg), '', 'chat bubble skips redundant [图片消息]');
  assert.equal(messagePreviewText(imgMsg), '[图片消息]', 'room list keeps [图片消息]');
  assert.equal(messagePreviewText(audioMsg), '[语音消息]');
  assert.equal(messagePreviewText(videoMsg), '[视频消息]');
  assert.equal(messagePreviewText(captionedImg), '早安图');
  assert.equal(messagePreviewText(httpDel), '', 'deleted control msg stays empty in preview');
}

console.log('房间 REPLY / GIFTREPLY 与 DELETE 控制消息过滤测试通过');
