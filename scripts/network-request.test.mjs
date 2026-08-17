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

  globalThis.fetch = originalFetch;
  console.log('  ✓ JSON POST 与 raw form POST body 编码正确');
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
