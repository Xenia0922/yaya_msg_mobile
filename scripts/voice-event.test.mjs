import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = readFileSync(
  new URL('../src/services/pocketNim/voiceEvent.ts', import.meta.url),
  'utf8',
);
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText;
const module = { exports: {} };
vm.runInNewContext(compiled, { module, exports: module.exports, require: () => ({}) });
const { parseVoiceEvent } = module.exports;

const base = {
  serverId: '1',
  channelId: '2',
  time: 1,
  fromAccount: '',
  fromNick: '',
  text: '',
  ext: {},
};

const team = parseVoiceEvent({
  ...base,
  messageType: 'TEAM_VOICE',
  attachment: {
    messageType: 'TEAM_VOICE',
    voiceInfo: {
      operateType: 'openVoice',
      streamUrl: 'rtmp://example/live',
      voiceStarInfoList: [
        { userId: '42', nickname: '测试成员', avatar: 'a.png', micState: true },
        { userId: '43', nickname: '离开成员', micState: false },
      ],
    },
  },
});
assert.equal(team?.kind, 'member');
assert.equal(team?.operateType, 'openVoice');
assert.equal(team?.streamUrl, 'rtmp://example/live');
assert.equal(team?.users.length, 2);
assert.equal(team?.users[0].userId, '42');
assert.equal(team?.users[0].micState, true);

const room = parseVoiceEvent({
  ...base,
  messageType: 'VOICE_OPERATE',
  attachment: {
    messageType: 'VOICE_OPERATE',
    operateType: { targetChannel: { isInVoiceChatting: true } },
  },
});
assert.equal(room?.kind, 'room');
assert.equal(room?.active, true);

assert.equal(parseVoiceEvent({ ...base, messageType: 'TEXT' }), null);
console.log('语音事件解析测试通过');
