#!/usr/bin/env node
// 获取口袋 48 官方成员目录；此接口不提供房间映射。
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const endpoint = 'https://pocketapi.48.cn/user/api/v1/client/update/group_team_star';
const output = path.join(path.dirname(fileURLToPath(import.meta.url)), 'official', 'members.json');

async function main() {
  // 境内中继走代理下载（Node 全局 fetch 不支持 HTTP 代理），把响应写到文件后用
  // OFFICIAL_JSON_FILE 传进来；本机 / workflow_dispatch 仍可直连。
  const inputFile = process.env.OFFICIAL_JSON_FILE || '';
  let result;
  if (inputFile) {
    result = JSON.parse(await readFile(inputFile, 'utf8'));
  } else {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json;charset=utf-8', 'User-Agent': 'PocketFans201807/7.1.35 (iPhone; iOS 16.3; Scale/3.00)' },
      body: '{}',
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`官方接口 HTTP ${response.status}`);
    result = await response.json();
  }
  const members = result?.content?.starInfo;
  if (result?.status !== 200 || !Array.isArray(members) || members.length < 500) {
    throw new Error('官方接口返回失败或成员数量异常，保留原有数据');
  }
  const ids = new Set();
  for (const member of members) {
    const id = String(member?.userId ?? '');
    if (!/^\d+$/.test(id) || id === '0' || !member.realName || ids.has(id)) {
      throw new Error('官方成员的 ID、姓名无效或 ID 重复，保留原有数据');
    }
    ids.add(id);
  }
  members.sort((a, b) => Number(a.userId) - Number(b.userId));
  const hash = createHash('sha256').update(JSON.stringify(members)).digest('hex');
  let previous;
  try { previous = JSON.parse(await readFile(output, 'utf8')); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (previous?.sha256 === hash) {
    console.log(`官方成员数据未变化：${members.length} 条`);
    return;
  }
  if (previous?.count && members.length < previous.count * 0.8) {
    throw new Error('官方成员数量较上次下降超过 20%，保留原有数据');
  }
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify({ source: endpoint, fetchedAt: new Date().toISOString(), count: members.length, sha256: hash, members }, null, 2)}\n`, 'utf8');
  console.log(`已保存官方成员数据：${members.length} 条`);
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
