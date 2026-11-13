#!/usr/bin/env node
// 从标准输入接收本次会话的口袋 48 登录信息；绝不写入文件或日志。
import { readFile, writeFile, mkdir, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'member-db/official/rooms.json');
let token = '';
for await (const chunk of process.stdin) token += chunk;
token = token.trim();
if (!token) throw new Error('需要通过标准输入提供有效登录会话');

const glue = await readFile(path.join(root, 'src/auth/wasm.js'), 'utf8');
const signer = await import(`data:text/javascript;base64,${Buffer.from(glue).toString('base64')}`);
await signer.default(await readFile(path.join(root, 'assets/2.wasm')));
const base = 'https://pocketapi.48.cn';
const iosInfo = { vendor: 'apple', deviceId: '7B93DFD0-472F-4736-A628-E85FAE086486', appVersion: '7.1.35', appBuild: '25101021', osVersion: '16.3.0', osType: 'ios', deviceName: 'iPhone 14 Pro', os: 'ios' };
const seineInfo = { appVersion: '1.0.0', appBuild: 26061101, osType: 'android', appName: 'seine48', deviceId: '7b93dfd0472f4736a628e85fae086486', deviceName: 'SM-G9730', osVersion: '12', vendor: 'Samsung' };

async function post(endpoint, body, seine = false) {
  const response = await fetch(base + endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json;charset=utf-8', token, pa: signer.__x6c2adf8__(),
      'User-Agent': seine ? 'PocketFans201807/1.0.0_26061101 (SM-G9730:Android 12;Samsung V417IR release-keys)' : 'PocketFans201807/7.1.35 (iPhone; iOS 16.3; Scale/3.00)',
      appInfo: JSON.stringify(seine ? seineInfo : iosInfo),
      ...(seine ? { 'X-Custom-Device-Type': 'ANDROID' } : {}),
    },
    body: JSON.stringify(body), signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

const result = await post('/im/api/v1/team/star/server/map/get', {});
const map = result?.content?.userServerMap;
if (result?.status !== 200 || !map || typeof map !== 'object' || Array.isArray(map)) {
  throw new Error('获取官方成员服务器映射失败，请检查登录状态');
}
const entries = Object.entries(map).filter(([id, sid]) => /^\d+$/.test(id) && /^\d+$/.test(String(sid)) && String(sid) !== '0');
if (entries.length < 50) throw new Error('服务器映射数量异常，已停止更新');
const rooms = [];
let failures = 0;
let next = 0;
async function worker() {
  while (true) {
    const index = next++;
    if (index >= entries.length) return;
    const [id, serverId] = entries[index];
    try {
      const detail = await post('/im/api/seine/server/detail', { serverId: Number(serverId) }, true);
      const channels = detail?.content?.channelInfoList;
      if (detail?.status !== 200 || !Array.isArray(channels) || !channels[0]?.channelId) {
        failures++;
      } else {
        rooms.push({ id, serverId: String(serverId), channelId: String(channels[0].channelId), yklzId: channels[1]?.channelId ? String(channels[1].channelId) : '' });
      }
    } catch { failures++; }
    if ((index + 1) % 50 === 0) console.log(`已检查 ${index + 1}/${entries.length} 个服务器`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}
await Promise.all([worker(), worker()]);
if (rooms.length < 50 || rooms.length < entries.length * 0.65) {
  throw new Error(`成功 ${rooms.length}/${entries.length}，覆盖不足，未写入数据`);
}
rooms.sort((a, b) => Number(a.id) - Number(b.id));
const sha256 = createHash('sha256').update(JSON.stringify(rooms)).digest('hex');
try {
  const previous = JSON.parse(await readFile(output, 'utf8'));
  if (previous.count && rooms.length < previous.count * 0.8) {
    throw new Error('房间数据较上次减少超过 20%，未写入数据');
  }
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
await mkdir(path.dirname(output), { recursive: true });
const temporary = `${output}.tmp`;
try {
  await writeFile(temporary, `${JSON.stringify({ source: 'pocket48 official server map and server detail', fetchedAt: new Date().toISOString(), serverCount: entries.length, count: rooms.length, failed: failures, sha256, rooms }, null, 2)}\n`, 'utf8');
  await rename(temporary, output);
} catch (error) {
  await unlink(temporary).catch(() => {});
  throw error;
}
console.log(`官方房间映射已保存：${rooms.length} 条，未成功 ${failures} 条`);
