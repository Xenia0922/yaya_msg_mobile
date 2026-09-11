#!/usr/bin/env node
/**
 * 成员库镜像同步器（自建数据源）
 * ---------------------------------------------------------------
 * 目标：在 yk1z 上游库（data.gnz.hk/members.json）基础上，自建一份**可维护**的成员库：
 *   1. 同步上游更新（不修改上游，只镜像）
 *   2. 应用本地 overrides（字段级覆盖，用于修正/补充上游错误或缺失的值）
 *   3. 应用 extra（上游没有的成员或全新字段）
 *   4. 产出 dist/members.json（带 version / updatedAt / count / 覆盖率统计）
 *
 * 安全策略（与客户端护栏一致的"永不劣化"原则）：
 *   - 上游拉取失败 → 保留上一次 dist，不写出、退出码 0（由 Action 决定是否告警）
 *   - 上游条数 < 上次 60%，或大房间覆盖率 < 上次 70% → 拒绝写出（防上游退化传导）
 *   - overrides / extra 始终生效（本地维护优先）
 *
 * 用法：
 *   node member-db/sync.mjs                 # 正常同步
 *   node member-db/sync.mjs --force         # 跳过劣化护栏（人工确认后使用）
 *   UPSTREAM_URL=... node member-db/sync.mjs
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const DIST_PATH = path.join(ROOT, 'dist', 'members.json');
const OVERRIDES_PATH = path.join(ROOT, 'overrides.json');
const EXTRA_PATH = path.join(ROOT, 'extra.json');

const UPSTREAM_URL = process.env.UPSTREAM_URL || 'https://data.gnz.hk/members.json';
const FORCE = process.argv.includes('--force');

/** 可被 overrides 覆盖的字段白名单（避免误改 id 等关键字段） */
const OVERRIDABLE = new Set([
  'ownerName', 'channelId', 'yklzId', 'smallChannelId', 'serverId', 'roomId', 'liveRoomId',
  'team', 'teamId', 'groupName', 'pinyin', 'avatar', 'state', 'isInGroup', 'periodName',
  'birthday', 'wbName', 'wbUid', 'note',
]);

const norm = (v) => String(v ?? '').trim();
const isId = (v) => /^\d+$/.test(norm(v)) && norm(v) !== '0';

function coverage(list) {
  let channel = 0, yklz = 0, server = 0;
  for (const m of list) {
    if (isId(m.channelId)) channel += 1;
    if (isId(m.yklzId ?? m.smallChannelId)) yklz += 1;
    if (isId(m.serverId)) server += 1;
  }
  return { channel, yklz, server };
}

async function readJson(file, fallback) {
  try {
    if (!existsSync(file)) return fallback;
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (e) {
    console.error(`[member-db] 读取 ${path.basename(file)} 失败：${e.message}`);
    return fallback;
  }
}

async function fetchUpstream() {
  const url = `${UPSTREAM_URL}${UPSTREAM_URL.includes('?') ? '&' : '?'}t=${Date.now()}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  const arr = Array.isArray(json)
    ? json
    : (json.members || json.roomId || json.data || json.list || []);
  if (!Array.isArray(arr) || !arr.length) throw new Error('上游返回为空或结构未知');
  return arr;
}

function memberIdOf(m) {
  return norm(m?.id ?? m?.memberId ?? m?.userId ?? m?.starId);
}

/** 应用 overrides + extra（返回新数组；不修改入参） */
function applyOverrides(upstream, overrides, extra) {
  const oMap = new Map();
  for (const [id, patch] of Object.entries(overrides?.members || {})) {
    if (!patch || typeof patch !== 'object') continue;
    const safe = {};
    for (const [k, v] of Object.entries(patch)) {
      if (k === 'note') { safe[k] = v; continue; } // note 为自有字段，直接写入
      if (OVERRIDABLE.has(k)) safe[k] = v;
    }
    oMap.set(String(id), safe);
  }

  let overridden = 0;
  const out = upstream.map((m) => {
    const id = memberIdOf(m);
    const patch = oMap.get(id);
    if (!patch) return { ...m };
    overridden += 1;
    return { ...m, ...patch, _overridden: true };
  });

  // 已存在成员去重；extra.members 追加（id 冲突时 extra 优先，用于强制覆盖整条记录）
  const index = new Map(out.map((m, i) => [memberIdOf(m), i]));
  let added = 0;
  for (const m of (extra?.members || [])) {
    const id = memberIdOf(m);
    if (!id || !norm(m.ownerName)) continue;
    if (index.has(id)) out[index.get(id)] = { ...out[index.get(id)], ...m, _extra: true };
    else { out.push({ ...m, _extra: true }); added += 1; }
  }
  return { members: out, overridden, added };
}

async function main() {
  const overrides = await readJson(OVERRIDES_PATH, { members: {} });
  const extra = await readJson(EXTRA_PATH, { members: [] });

  let upstream;
  try {
    upstream = await fetchUpstream();
    console.log(`[member-db] 上游同步成功：${upstream.length} 位（${UPSTREAM_URL}）`);
  } catch (e) {
    console.error(`[member-db] 上游拉取失败：${e.message} → 保留现有 dist，不写出`);
    process.exit(0);
  }

  const prev = await readJson(DIST_PATH, null);
  const prevMembers = Array.isArray(prev?.members) ? prev.members : [];

  if (prevMembers.length && !FORCE) {
    const prevCov = coverage(prevMembers);
    const upCov = coverage(upstream);
    const tooFew = upstream.length < prevMembers.length * 0.6;
    const mapLost = prevCov.channel > 0 && upCov.channel < prevCov.channel * 0.7;
    if (tooFew || mapLost) {
      console.error(
        `[member-db] 上游数据劣化，拒绝写出：上游 ${upstream.length} 位/大房间 ${upCov.channel} ｜` +
        ` 现有 ${prevMembers.length} 位/大房间 ${prevCov.channel}（如需强制覆盖加 --force）`,
      );
      process.exit(0);
    }
  }

  const { members, overridden, added } = applyOverrides(upstream, overrides, extra);
  const withName = members.filter((m) => norm(m.ownerName)).length;
  const cov = coverage(members);

  // 内容指纹：只取关键字段（上游含 utime/ctime 等每次都会变的动态字段，
  // 整条 hash 会导致每天都判定"有变化"→ 每天提交 1MB）。仅当映射/名称/在团状态变化时才重写。
  const fingerprint = members.map((m) => [
    norm(m.id), norm(m.ownerName), norm(m.channelId), norm(m.yklzId ?? m.smallChannelId),
    norm(m.serverId), norm(m.team), String(m.isInGroup ?? ''), norm(m.status),
  ]);
  const contentHash = createHash('sha256').update(JSON.stringify(fingerprint)).digest('hex').slice(0, 16);
  if (prev?.contentHash === contentHash && !FORCE) {
    console.log(`[member-db] 关键内容未变化（hash ${contentHash}），跳过写出`);
    process.exit(0);
  }

  const payload = {
    version: new Date().toISOString().slice(0, 10).replace(/-/g, ''),
    updatedAt: new Date().toISOString(),
    contentHash,
    count: members.length,
    source: { upstream: UPSTREAM_URL, upstreamCount: upstream.length, overridden, extraAdded: added },
    coverage: { withName, channelId: cov.channel, yklzId: cov.yklz, serverId: cov.server },
    members,
  };

  await mkdir(path.dirname(DIST_PATH), { recursive: true });
  await writeFile(DIST_PATH, JSON.stringify(payload, null, 2), 'utf8');
  console.log(
    `[member-db] 已写出 dist/members.json：${members.length} 位` +
    `（覆盖 ${overridden} / 新增 ${added}）｜大房间 ${cov.channel} 小房间 ${cov.yklz} serverId ${cov.server}`,
  );
}

main().catch((e) => {
  console.error('[member-db] 未捕获异常：', e);
  process.exit(1);
});
