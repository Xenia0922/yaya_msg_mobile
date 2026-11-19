import assert from 'node:assert/strict';
import { createCipheriv } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
function load(path, imports) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    module,
    exports: module.exports,
    require: (id) => imports[id],
    setTimeout,
    clearTimeout,
    console,
  });
  return { exports: module.exports, source };
}

const util = load('../src/utils/pocketRegistration.ts', { 'node-forge': require('node-forge') });
const protocolKey = /const PROTOCOL_KEY = '([^']+)'/.exec(util.source)?.[1];
assert.ok(protocolKey);
for (const input of ['test-pass', 'abcdefghabcdefgh', '测试用密码123']) {
  const cipher = createCipheriv('aes-128-ecb', Buffer.from(protocolKey), null);
  const expected = Buffer.concat([cipher.update(input, 'utf8'), cipher.final()]).toString('base64');
  assert.ok(
    util.exports.encryptPocketPassword(input) === expected,
    '密码协议与标准 AES-ECB 不一致',
  );
}
assert.ok(util.exports.validateRegistrationPassword('short', 'short'));
assert.ok(util.exports.validateRegistrationPassword('test-pass', 'different'));
assert.equal(util.exports.validateRegistrationPassword('test-pass', 'test-pass'), '');

const calls = [];
let response = { status: 200, success: true, content: {} };
const mockedSettings = { p48Token: 'existing-session' };
const storageMock = {
  __esModule: true,
  default: { getItem: async () => null, setItem: async () => {} },
};
const pocketToken = load('../src/utils/pocketToken.ts', {}).exports;
const pocketHeaders = load('../src/api/pocketHeaders.ts', {
  '../store': { useSettingsStore: { getState: () => ({ settings: mockedSettings }) } },
  '../utils/pocketToken': pocketToken,
  '@react-native-async-storage/async-storage': storageMock,
}).exports;
const api = load('../src/api/pocket48.ts', {
  '../store': { useSettingsStore: { getState: () => ({ settings: mockedSettings }) } },
  '../auth': { initWasm: async () => {}, generatePaAsync: async () => 'mock-signature' },
  '../utils/network': {
    xhrPost: async (url, body, headers) => {
      calls.push({ url, body, headers });
      return response;
    },
  },
  '../utils/data': {},
  '../utils/pocketToken': pocketToken,
  './pocketHeaders': pocketHeaders,
  '@react-native-async-storage/async-storage': storageMock,
}).exports.pocketApi;
await api.loginSendSms('000000', '86');
assert.ok(calls[0].url.endsWith('/user/api/v2/sms/send_sms'));
assert.equal(calls[0].body.businessCode, 1);
assert.equal(calls[0].headers.token, undefined);
response = { status: 10001, success: false };
assert.equal((await api.loginByCode('000000', '1234', '86')).status, 10001);
assert.ok(calls[1].url.endsWith('/user/api/v2/login/app/app_login'));
assert.equal(calls[1].body.mobileCodeLogin.area, '86');
response = { status: 200, success: true, content: {} };
await api.registerByCode('000000', '1234', '86', 'mock-encrypted');
assert.ok(calls[2].url.endsWith('/user/api/v1/register/mobile'));
assert.equal(calls[2].body.mobilePwd, 'mock-encrypted');
await api.loginByPassword('000000', 'mock-encrypted');
assert.ok(calls[3].url.endsWith('/user/api/v1/login/app/mobile'));
assert.equal(calls[3].body.loginType, 'MOBILE_PWD');
assert.equal(calls[3].headers.token, undefined);

// 塞纳河48 登录已合并：旧设置残留也统一按口袋48身份发送
response = { status: 200, success: true, content: {} };
mockedSettings.p48ClientProfile = 'seine48';
await api.loginSendSms('000000', '86');
const unifiedCall = calls[calls.length - 1];
const unifiedInfo = JSON.parse(unifiedCall.headers.appInfo);
assert.equal(unifiedInfo.appName, 'pocket48');
assert.equal(unifiedCall.headers['X-Custom-Device-Type'], undefined);
assert.ok(unifiedCall.headers['User-Agent'].startsWith('PocketFans201807/7.1.45_26102701'));

// 跨设备纯 token 遭遇 401005 token解析失败 时，自动带空 deviceId 重试并记住该 token
calls.length = 0;
mockedSettings.p48Token = 'cross-device-bare-token';
let crossAttempt = 0;
const origXhrPost = calls;
const apiWithFallback = load('../src/api/pocket48.ts', {
  '../store': { useSettingsStore: { getState: () => ({ settings: mockedSettings }) } },
  '../auth': { initWasm: async () => {}, generatePaAsync: async () => 'mock-signature' },
  '../utils/network': {
    xhrPost: async (url, body, headers) => {
      origXhrPost.push({ url, body, headers });
      crossAttempt += 1;
      if (crossAttempt === 1) return { status: 401005, success: false, message: 'token解析失败' };
      return { status: 200, success: true, content: { data: [63] } };
    },
  },
  '../utils/data': {},
  '../utils/pocketToken': pocketToken,
  './pocketHeaders': pocketHeaders,
  '@react-native-async-storage/async-storage': storageMock,
}).exports.pocketApi;

const followed = await apiWithFallback.getFollowedIds();
assert.equal(followed.content.data[0], 63);
assert.equal(origXhrPost.length, 2);
assert.notEqual(JSON.parse(origXhrPost[0].headers.appInfo).deviceId, '');
assert.equal(JSON.parse(origXhrPost[1].headers.appInfo).deviceId, '');
assert.equal(JSON.parse(origXhrPost[1].headers.appInfo).IMEI, '');

// 后续同 token 请求直接跳过失败首包，1 次即发空 deviceId
await apiWithFallback.getUserRenameCount();
assert.equal(origXhrPost.length, 3);
assert.equal(JSON.parse(origXhrPost[2].headers.appInfo).deviceId, '');

// 验证码登录请求依然必须带上本机持久化非空 deviceId
await apiWithFallback.loginSendSms('000000', '86');
assert.notEqual(JSON.parse(origXhrPost[3].headers.appInfo).deviceId, '');

console.log('注册、密码协议和登录请求测试通过');
