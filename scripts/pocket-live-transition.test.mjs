import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
function load(path, imports = {}) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(compiled, { module, exports: module.exports, require: (name) => {
    if (!(name in imports)) throw new Error(`Unexpected import: ${name}`);
    return imports[name];
  } });
  return module.exports;
}

const types = load('../src/services/pocketNim/types.ts');
const { parseChatroomMessage, isLiveStreamTransition, parseLiveUpdate } = load('../src/services/pocketNim/codec.ts', { './types': types });
for (const type of ['MICROPHONE_CONNECTION_AGREE_V2', 'MICROPHONE_CONNECTION_FINISH_V2', 'MULTI_MIC_PK_SUCCESS', 'MULTI_MIC_PK_FINISH']) {
  assert.equal(isLiveStreamTransition(type), true);
  const message = parseChatroomMessage({ type: 'custom', idClient: type, remoteExtension: { messageType: type } });
  assert.equal(message?.messageType, type, `${type} 无正文时仍应通知播放器`);
}
assert.equal(isLiveStreamTransition('MULTI_MIC_PK_SCORE'), false, 'PK 分数变化不应反复重载');
assert.equal(parseChatroomMessage({ type: 'custom', remoteExtension: { messageType: 'MULTI_MIC_PK_SCORE' } }), null);
const message = parseChatroomMessage({ type: 'custom', idClient: 'a', remoteExtension: { messageType: 'BARRAGE_NORMAL', text: '你好', userInfo: { userId: 123, userName: 'A', userAvatar: 'avatar/a', userLevel: 8 } } });
assert.equal(message.avatar, 'avatar/a');
assert.equal(message.userId, '123');
const longIds = parseChatroomMessage({ type: 'custom', remoteExtension: '{"messageType":"PRESENT","user":{"userId":12345678901234567,"nickName":"A"},"giftInfo":{"acceptUser":{"userId":98765432109876543}}}' });
assert.equal(longIds?.userId, '12345678901234567', '保留发送者的完整 ID，不能取礼物接收者 ID');
assert.equal(parseChatroomMessage({ type: 'custom', remoteExtension: { messageType: 'BARRAGE_NORMAL', text: 'hi', user: { userId: 12345678901234567 } } })?.userId, '', '已损坏的数字 ID 不能用于查询');
assert.equal(message.level, 8);
const update = parseLiveUpdate({ type: 'custom', remoteExtension: { messageType: 'LIVEUPDATE', liveUpdateInfo: { online: 281, topList: [{ user: { userAvatar: 'avatar/a' } }, { user: { userAvatar: 'avatar/b' } }] } } });
assert.equal(update.audience, '281');
assert.equal(update.rankAvatars.join(','), 'avatar/a,avatar/b');
assert.equal(parseLiveUpdate({ remoteExtension: { messageType: 'BARRAGE_NORMAL' } }), null);

let calls = 0;
let resolveProfile;
const profile = new Promise((resolve) => { resolveProfile = resolve; });
const { getLiveUserAvatar, normalizeLiveAvatar } = load('../src/services/liveAvatarCache.ts', {
  '../api/pocket48': { default: { getUserProfile: () => { calls += 1; return profile; } } },
  '../utils/data': { normalizeUrl: (x) => x.startsWith('/') ? `https://source.48.cn${x}` : x, pickText: (x) => x.content.avatar },
});
const first = getLiveUserAvatar('123');
const second = getLiveUserAvatar('123');
assert.equal(calls, 1, '并发请求应合并');
resolveProfile({ content: { avatar: 'https://example.invalid/avatar' } });
assert.equal(await first, 'https://example.invalid/avatar');
assert.equal(await second, 'https://example.invalid/avatar');
assert.equal(await getLiveUserAvatar('123'), 'https://example.invalid/avatar');
assert.equal(calls, 1, '重复打开应复用头像');
assert.equal(normalizeLiveAvatar('avatar/a'), 'https://source.48.cn/avatar/a');
assert.equal(normalizeLiveAvatar('invalid'), '', '无法解析为完整 URL 时不交给图片组件');
const nestedAvatar = load('../src/services/liveAvatarCache.ts', {
  '../api/pocket48': { default: { getUserProfile: async () => ({ content: { baseUserInfo: { avatar: '/avatar/test.png' } } }) } },
  '../utils/data': {
    normalizeUrl: (x) => x.startsWith('/') ? `https://source.48.cn${x}` : x,
    pickText: (obj, paths) => paths.map((path) => path.split('.').reduce((value, key) => value?.[key], obj)).find(Boolean) || '',
  },
});
assert.equal(await nestedAvatar.getLiveUserAvatar('456'), 'https://source.48.cn/avatar/test.png', '识别资料接口 baseUserInfo 中的头像');
console.log('连麦切换消息识别与头像缓存测试通过');
