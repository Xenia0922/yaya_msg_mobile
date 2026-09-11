# member-db · 自建成员库（上游镜像 + 自有覆盖）

**目的**：不再完全依赖 yk1z 上游库（`data.gnz.hk/members.json`），而是**自建一份可维护的成员库**：
每日自动同步上游更新 → 叠加我们自己的修正/补充 → 产出 `dist/members.json` 供 App 拉取。

## 结构

```
member-db/
  sync.mjs        同步器：拉上游 + 应用 overrides/extra + 校验 + 写出 dist
  overrides.json  字段级覆盖表（修正上游错误/缺失，如某个成员的 yklzId）
  extra.json      上游没有的成员（新成员/整条覆盖）
  dist/members.json  产物（Action 自动提交，App 拉这个）
```

## 日常维护

| 要做什么 | 怎么做 |
|---|---|
| 修正某成员的房间映射 | 编辑 `overrides.json` → `members."<成员id>" = { channelId/yklzId/serverId: "..." }` |
| 新增一名成员 | 编辑 `extra.json` → `members` 数组追加一条（至少 id + ownerName + channelId） |
| 立即生效 | Actions 页面手动跑 `member-db sync`，或本地 `node member-db/sync.mjs` 后提交 |
| 上游结构变了 | 本地跑 sync，看日志里的"上游返回为空或结构未知"，调整 `sync.mjs` 的字段兜底 |

> 修改 `overrides.json` / `extra.json` 后 push，Action 会在当晚自动合并；想立刻生效就手动触发一次。


## 让自建库越用越全（回灌 App 运行时解析结果）

App 使用中会通过 `seine/server/detail` 解析出成员的大小房间 channelId，这些数据比上游库更新。
回灌流程：

```bash
# 1) 从设备导出 roomMap（MuMu / 有 root 的模拟器）
adb root && adb pull /data/data/com.yk1z.yayamsg/databases/RKStorage ./RKStorage
#    RN AsyncStorage 为 SQLite，表 catalystLocalStorage 中 key = yaya_member_room_map_v2
#    取出 value 存为 member-db/roommap-export.json

# 2) 合并进覆盖表（只补上游空缺，不覆盖上游已有值）
node member-db/merge-roommap.mjs --dry-run   # 预览
node member-db/merge-roommap.mjs             # 写入 overrides.json

# 3) 重新产出
node member-db/sync.mjs
```

> 原则：**上游已有值保持权威**，回灌只补空缺字段，避免我们这边的解析结果反向污染正确数据。

## 安全护栏（永不劣化）

- 上游拉取失败 → **不写出**，保留上一份 `dist/members.json`
- 上游条数 < 现有 60%，或大房间覆盖率 < 现有 70% → **拒绝写出**（防上游退化传导到 App）
- 人工确认要强制覆盖时：`node member-db/sync.mjs --force`
- 客户端侧另有第二道护栏（`updateMemberData`：条数/覆盖率劣化时拒绝覆盖本地缓存）+ 旧缓存备份

## App 侧接入

`src/constants/index.ts`：

```ts
export const MEMBERS_URL_SELF = '<自建地址>';   // 优先
export const MEMBERS_URL = 'https://data.gnz.hk/members.json'; // 上游/回退
```

自建地址二选一：

1. **jsDelivr（零配置，推荐先用这个）**
   `https://cdn.jsdelivr.net/gh/Xenia0922/yaya_msg_mobile@main/member-db/dist/members.json`
2. **Cloudflare Pages（更稳，可自定义域名）**
   新建 Pages 项目指向本仓库，构建命令 `node member-db/sync.mjs`，输出目录 `member-db/dist`
   → 得到 `https://<project>.pages.dev/members.json`

App 拉取顺序：自建 → 失败自动回退上游 yk1z 库（不会因为自建挂了而不可用）。
