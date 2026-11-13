#!/usr/bin/env node
/**
 * 把 App 运行时解析到的房间映射（roomMap 导出）合并进 overrides.json。
 * ---------------------------------------------------------------
 * 用途：App 使用过程中会通过 seine/server/detail 解析出成员的大小房间 channelId，
 * 这些数据比上游库更新、更全。把它们回灌到覆盖表后，自建库就会**逐步超过上游**，
 * 越用越准（完全属于我们自己的可维护属性）。
 *
 * 输入：member-db/roommap-export.json
 *   即 App 内 AsyncStorage 键 `yaya_member_room_map_v2` 的内容，结构：
 *   { "<memberId>": { "channelId": "...", "yklzId": "...", "serverId": "...", "updatedAt": 0 } }
 *
 * 导出方式（MuMu / 有 root 的模拟器）：
 *   adb root && adb pull /data/data/com.yk1z.yayamsg/databases/RKStorage ./RKStorage
 *   （RN AsyncStorage 是 SQLite 表 catalystLocalStorage，key/value 存其中；
 *     也可在真机上用「设置 → 运行日志」旁的导出能力，或手工整理成上面的 JSON）
 *
 * 用法：
 *   node member-db/merge-roommap.mjs --dry-run   # 只看会改什么
 *   node member-db/merge-roommap.mjs             # 写入 overrides.json
 */

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXPORT_PATH = path.join(__dirname, 'roommap-export.json');
const DIST_PATH = path.join(__dirname, 'dist', 'members.json');
const OVERRIDES_PATH = path.join(__dirname, 'overrides.json');
const DRY = process.argv.includes('--dry-run');

const norm = (v) => String(v ?? '').trim();
const isId = (v) => /^\d+$/.test(norm(v)) && norm(v) !== '0';

const FIELDS = ['channelId', 'yklzId', 'serverId'];

async function main() {
  if (!existsSync(EXPORT_PATH)) {
    console.error(`[roommap] 找不到 ${path.basename(EXPORT_PATH)}，请先按文件头注释导出`);
    process.exit(1);
  }
  const exportRaw = JSON.parse(await readFile(EXPORT_PATH, 'utf8'));
  const dist = existsSync(DIST_PATH) ? JSON.parse(await readFile(DIST_PATH, 'utf8')) : { members: [] };
  const overrides = existsSync(OVERRIDES_PATH)
    ? JSON.parse(await readFile(OVERRIDES_PATH, 'utf8'))
    : { members: {} };
  overrides.members = overrides.members || {};

  const byId = new Map((dist.members || []).map((m) => [norm(m.id), m]));
  let filled = 0, skippedSame = 0, unknown = 0;
  const touched = new Set();

  for (const [rawId, entry] of Object.entries(exportRaw || {})) {
    const id = norm(rawId);
    if (!id || !entry || typeof entry !== 'object') continue;
    const m = byId.get(id);
    if (!m) { unknown += 1; continue; }
    const patch = overrides.members[id] || {};
    let changed = false;
    for (const f of FIELDS) {
      const v = norm(entry[f]);
      if (!isId(v)) continue;
      const cur = norm(m[f]);
      if (isId(cur)) { skippedSame += 1; continue; } // 上游已有值：不覆盖（保持上游权威）
      if (norm(patch[f]) === v) continue;            // 覆盖表里已是该值
      patch[f] = v;
      changed = true;
      filled += 1;
    }
    if (changed) {
      patch.note = `${patch.note ? patch.note + '；' : ''}由 App 运行解析回灌 ${new Date().toISOString().slice(0, 10)}`;
      overrides.members[id] = patch;
      touched.add(id);
    }
  }

  console.log(
    `[roommap] 导出条目 ${Object.keys(exportRaw || {}).length}｜补齐字段 ${filled} 处｜涉及成员 ${touched.size} 位｜` +
    `上游已有值跳过 ${skippedSame}｜库中不存在 ${unknown}`,
  );
  if (!touched.size) {
    console.log('[roommap] 没有需要新增的覆盖，未修改 overrides.json');
    return;
  }
  if (DRY) {
    console.log('[roommap] --dry-run，未写入。将新增的成员：', [...touched].slice(0, 10).join(', '));
    return;
  }
  await writeFile(OVERRIDES_PATH, JSON.stringify(overrides, null, 2), 'utf8');
  console.log(`[roommap] 已更新 overrides.json（${touched.size} 位成员）→ 重新跑 sync.mjs 即可产出更全的 dist`);
}

main().catch((e) => {
  console.error('[roommap] 异常：', e);
  process.exit(1);
});
