import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');

function loadTs(path) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    module,
    exports: module.exports,
    require: () => {
      throw new Error('unexpected import');
    },
    console,
  });
  return module.exports;
}

const {
  normalizePocketToken,
  extractPocketTokenFromObject,
  normalizePocketDeviceId,
  parsePocketTokenBundle,
  formatPocketTokenBundle,
} = loadTs('../src/utils/pocketToken.ts');

const sampleRaw = Buffer.from('user:123456:token:pocket48-sample-payloa', 'utf8').toString(
  'base64',
);
assert.equal(sampleRaw.endsWith('=='), true);
assert.equal(sampleRaw.length % 4, 0);

const sampleSingleEq = Buffer.from('user:123456:token:pocket48-sample-payload', 'utf8').toString(
  'base64',
);
assert.equal(sampleSingleEq.endsWith('='), true);
assert.equal(sampleSingleEq.endsWith('=='), false);

// 1. 合法 token 原样保留
assert.equal(normalizePocketToken(sampleRaw), sampleRaw);
assert.equal(normalizePocketToken(sampleSingleEq), sampleSingleEq);

// 2. 截断末尾 '=' 修复（如 ...LQ= 或 ...LQ → ...LQ==）
const missingOneEq = sampleRaw.slice(0, -1);
const missingTwoEq = sampleRaw.slice(0, -2);
const extraEq = `${sampleRaw}=`;
assert.equal(normalizePocketToken(missingOneEq), sampleRaw);
assert.equal(normalizePocketToken(missingTwoEq), sampleRaw);
assert.equal(normalizePocketToken(extraEq), sampleRaw);
assert.equal(normalizePocketToken(sampleSingleEq.slice(0, -1)), sampleSingleEq);

// 3. 零宽字符、换行空白、引号、前缀与 KV 参数剥离
assert.equal(
  normalizePocketToken(`\u200B  "${sampleRaw.slice(0, 12)}\n${sampleRaw.slice(12)}" `),
  sampleRaw,
);
assert.equal(normalizePocketToken(`Bearer ${sampleRaw}`), sampleRaw);
assert.equal(normalizePocketToken(`Authorization: Bearer ${sampleRaw}`), sampleRaw);
assert.equal(normalizePocketToken(`token=${sampleRaw}&userId=123`), sampleRaw);
assert.equal(normalizePocketToken(`p48Token: '${sampleRaw}'`), sampleRaw);

// 4. URL 编码与 JSON 包装解包
assert.equal(normalizePocketToken(`token=${encodeURIComponent(sampleRaw)}`), sampleRaw);
assert.equal(
  normalizePocketToken(JSON.stringify({ content: { userInfo: { token: sampleRaw } } })),
  sampleRaw,
);
assert.equal(extractPocketTokenFromObject({ data: { accessToken: sampleRaw } }), sampleRaw);

// 5. 空值与无效输入
assert.equal(normalizePocketToken(''), '');
assert.equal(normalizePocketToken('   \n\t '), '');
assert.equal(normalizePocketToken(null), '');

// 6. 跨设备凭证（Token + deviceId）导出与解析
const devHex = 'A1B2C3D4E5F60708';
assert.equal(normalizePocketDeviceId(`  "${devHex}"  `), devHex.toLowerCase());
assert.equal(
  normalizePocketDeviceId('7B93DFD0-472F-4736-A628-E85FAE086486'),
  '7B93DFD0-472F-4736-A628-E85FAE086486',
);
assert.equal(normalizePocketDeviceId('short'), '');
const bundleStr = formatPocketTokenBundle(sampleRaw, devHex);
const parsedJson = parsePocketTokenBundle(bundleStr);
assert.equal(parsedJson.token, sampleRaw);
assert.equal(parsedJson.deviceId, devHex.toLowerCase());
const parsedQuery = parsePocketTokenBundle(
  `token=${encodeURIComponent(sampleRaw)}&deviceId=${devHex}`,
);
assert.equal(parsedQuery.token, sampleRaw);
assert.equal(parsedQuery.deviceId, devHex.toLowerCase());
const parsedPlain = parsePocketTokenBundle(sampleRaw);
assert.equal(parsedPlain.token, sampleRaw);
assert.equal(parsedPlain.deviceId, '');

console.log('口袋 Token 与跨设备凭证解析测试通过');
