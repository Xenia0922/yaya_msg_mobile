// 网络请求封装测试：验证 JSON POST 与 raw 表单 POST 的 body 编码不互相污染。
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mkdtempSync, rmSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const tmp = mkdtempSync(join(root, 'node_modules', '.networktest-'));

try {
  execSync(
    `npx tsc ${join(root, 'src/utils/network.ts')} --outDir ${tmp} --module commonjs --target es2019 --moduleResolution node --skipLibCheck`,
    { cwd: root, stdio: 'inherit' },
  );

  const { requestJson } = await import(`file://${join(tmp, 'network.js')}`);
  const originalFetch = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (_url, options) => {
    calls.push(options);
    return new Response('{"status":200,"content":{}}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  await requestJson('https://example.test/json', {
    method: 'POST',
    body: { answer: 'ok' },
  });
  await requestJson('https://example.test/form', {
    method: 'POST',
    body: 'act=default&token=<REDACTED>',
    bodyType: 'raw',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  const jsonBody = calls[0]?.body;
  const rawBody = calls[1]?.body;
  if (jsonBody !== '{"answer":"ok"}') throw new Error(`JSON body mismatch: ${jsonBody}`);
  if (rawBody !== 'act=default&token=<REDACTED>') throw new Error(`raw body mismatch: ${rawBody}`);

  // 相同地址与 body 但身份不同的在途请求必须各自发出并拿到各自响应。
  const pending = [];
  globalThis.fetch = (_url, options) => new Promise((resolve) => {
    pending.push({ options, resolve });
  });
  const accountA = requestJson('https://example.test/account', { headers: { Authorization: 'MOCK_A' }, cacheTtl: 60000 });
  const accountB = requestJson('https://example.test/account', { headers: { Authorization: 'MOCK_B' }, cacheTtl: 60000 });
  if (pending.length !== 2) throw new Error('不同身份的 GET 被合并');
  pending[0].resolve(new Response('{"account":"A"}', { status: 200 }));
  pending[1].resolve(new Response('{"account":"B"}', { status: 200 }));
  const [a, b] = await Promise.all([accountA, accountB]);
  if (a.account !== 'A' || b.account !== 'B') throw new Error('不同身份的 GET 响应串号');

  pending.length = 0;
  const firstPost = requestJson('https://example.test/action', { method: 'POST', body: { action: 'send' } });
  const secondPost = requestJson('https://example.test/action', { method: 'POST', body: { action: 'send' } });
  if (pending.length !== 2) throw new Error('POST 被合并');
  for (const call of pending) call.resolve(new Response('{}', { status: 200 }));
  await Promise.all([firstPost, secondPost]);

  globalThis.fetch = originalFetch;
  console.log('  ✓ 请求编码、身份隔离与 POST 独立发送正确');
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
