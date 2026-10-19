# v2.7.6 变更记录

> 建立时间：2026-10-02 ~ 10-03
> 起因：用户反馈「小房间全没了 → 成员变成 900 → 大小房间错位」
> 分两部分：**一、服务端**（已上线，对所有已装用户即时生效）；**二、App 侧**（需发版 v2.7.6 生效）。
> 每项均记录：现象 → 根因 → 改动 → 涉及文件 → commit。

---

## 一、服务端（已上线，不依赖发版）

### 1. 成员库自动同步失效 → 改由境内机中继

**现象**：成员库长时间停在 954 位（9-20 快照），上游已有 962 位；用户侧数据永不更新。

**根因**：
- GitHub Actions 出口 IP（Azure 机房段）请求上游 `https://data.gnz.hk/members.json` **恒返回 403**
  （Cloudflare 按 IP / 机房段拦）。补 `Referer: https://gnz.hk/database` + 浏览器 UA 后**仍 403**，
  而同时段 check-host 全球 11 个普通节点访问上游**全部 200** → 确认是 IP 层拦截，非请求头问题。
- `sync.mjs` 失败分支为 `process.exit(0)` → workflow 显示 **success**，问题被掩盖 7 天。
- 判断佐证：`dist` 的历史提交作者全是人工，**无一条 `github-actions[bot]`**。

**改动**：
- 新增境内机中继 `member-db/relay/run.sh`：拉上游 → 复用仓库 `sync.mjs` 生成 dist → `git push` main → `purge.jsdelivr.net`
- `member-db/sync.mjs`：失败分支 `process.exit(0)` → **`exit 2`**（workflow 不再假成功）；请求补 `Referer` / 浏览器 UA / `Accept-Language`；支持 `UPSTREAM_URLS` 多源依次重试
- `.github/workflows/member-db-sync.yml`：**停用 schedule**（只留 `workflow_dispatch`），避免每小时一条无意义失败通知
- `member-db/dist/members.json`：同步上游 954 → **962**（新增 8 位 CGT48 + 补 8 位 yklzId）

**涉及文件**：`member-db/relay/run.sh`(新增)、`member-db/relay/README.md`(新增)、`member-db/sync.mjs`、
`.github/workflows/member-db-sync.yml`、`member-db/dist/members.json`

**commit**：`4b7bf437` `1d67d65f` `105e8fbb` `7f9c4ac5` `07ffee18`（origin/main）、`b17a6c5`（plus）

### 2. 中继提频到「上游一变就同步」

**现象**：数据最长要 1 小时才更新。

**改动**：crontab `0 * * * *` → **`*/2 * * * *`**，并新增 **ETag 快路径** ——
先 `curl -sI` 取上游 ETag 与本地基线比对，相同则**静默退出**（不下载 1.2MB、不打日志、不碰 git）；
ETag 变了但关键字段没变（上游 utime/ctime 抖动）时也把 ETag 落盘，避免反复拉。

**效果**：上游更新 → 镜像更新 **≤ 2 分钟**；常态开销只有一个 HEAD 请求。

**涉及文件**：`member-db/relay/run.sh`、`member-db/relay/README.md`

**commit**：`99122a4a` `c257fa96`（origin/main）、`78c89c2`（plus）

---

## 二、App 侧（需发版 v2.7.6）

### 3. 成员库更新时效：缓存 TTL 6h → 10min，且启动时后台静默刷新

**现象**：服务端早已更新，App 里长期还是旧数据。

**根因**：`src/services/memberData.ts` 的 `MEMBER_CACHE_TTL = 6h`，缓存未过期时
`ensureMemberData` **直接 return 跳过网络** → 用户最多 6 小时才检查一次。

**改动**（`src/services/memberData.ts`）：
- `MEMBER_CACHE_TTL` 6h → **10min**
- 缓存新鲜时不再直接 return，改为**后台静默刷新**（`void updateMemberData().catch(...)`，不阻塞启动、不改变启动速度）
- 新增 `memberUpdateInFlight` 并发去重：启动静默刷新与设置页「手动更新」**共享同一次拉取**，避免重复请求与并发写缓存

**commit**：`78c89c2`

### 4. 上游 `status` 字段下线 → 非在团成员分类退化

**现象**：资料卡状态栏空白、按状态分组丢失。

**根因**：上游 `data.gnz.hk` 自 2026-09-27 起不再返回 `status`（同时下线 `roomId` / `liveRoomId` / `utime` / `ctime`）。
`classifyMemberState` 在无 `status` 时对 `isInGroup=false` 落到 `'unknown'`。

**改动**（`src/utils/members.ts`）：无 `status` 时兜底为 **`'graduated'`**（库判 `isInGroup=false` 基本即已毕业）。
上麦页用 `isInGroup` 判定在团，不受影响。

**附带收益**：`roomId` 下线后，`normalizeMember` 的 `channelId || roomId` 兜底不再被旧口袋房间 id 污染。

**commit**：`2d0b0db`

### 5. 镜像多 CDN 端点重试

**现象**：App 偶发「大/小房间全部消失」。

**根因**：镜像只用单一 `cdn.jsdelivr.net`。国内网络对该域名可达性不稳定（本机实测**直接 TLS 握手失败**）。
拉不到镜像 → 回退上游也失败 → **退化为官方目录**（无任何房间字段）→ 房间全丢。

**改动**：
- `src/constants/index.ts`：新增 `MEMBERS_URL_SELF_LIST`（cdn / fastly / testingcf / gcore 四个 jsDelivr 端点）
- `src/services/memberData.ts`：`fetchYk1zDb` 依次重试 4 个镜像端点，全失败才回退上游

**commit**：`2d0b0db`

### 6. 「大小房间错位」——最新消息反推把大房间写成小房间

**现象**：大房间点开是小房间；部分成员房间消失。

**根因**：`/im/api/v1/team/classic/last/message/get` 对**同一个 serverId 返回多条**
`lastMsgList`（大房间 + 小房间 + 历史房间，顺序不固定；实测有成员一次返回 **11 条**）。
旧逻辑「后写覆盖前写」→ `serverToChannel` 留住的常是小房间/历史房间 id → 填进「channelId 为空」的成员 →
**大房间实际打开的是小房间**，且被 `persist()` 写进缓存后**无法自愈**。
（该接口**不保证包含大房间** —— 有的成员返回 3 条里没有他的大房间。）

**改动**：
- `src/services/memberData.ts`：反推**每个 serverId 只认第一条**；**跳过属于任何成员 `yklzId` 的 channelId**
- `src/services/memberData.ts`：`CACHE_KEY` v6 → **v7**（丢弃含被污染 channelId 的成员库缓存）
- `src/services/roomMapCache.ts`：`ROOM_MAP_KEY` v2 → **v3**（丢弃含被污染映射的房间缓存）

**commit**：`4205454`

### 7. 拒绝退化到「零房间映射」的官方目录（本轮根因）

**现象**：**抓不到数据库时，成员变成 900 个，且大小房间错位**（用户实测描述）。

**根因（已实测确认）**：官方备用目录
`POST /user/api/v1/client/update/group_team_star` 的 `content.starInfo` **恰好 900 位**，
且 `channelId` / `roomId` / `serverId` / `isInGroup` **全部为空**（零房间映射）。
一旦 `yk1z` 库拉取失败，App 退化到该目录 → 房间只能靠最新消息反推（见第 6 项）→ **必然错位**，
人数也从 ~909 掉到 **900**。

**改动**（`src/services/memberData.ts`）：
- 新增模块级 `lastDbSourceOk` 标记（`fetchOfficialMembers` 中按 `dbSettled.status` 赋值）
- `updateMemberData`：当 **`yk1z` 库不可用 且 本地已有缓存** 时，**保留本地缓存并返回 `updated: false`**，
  拒绝官方目录覆盖（首次安装无缓存时仍允许官方目录兜底，否则新用户什么都没有）

**commit**：`6c26660`

---

## 三、缺陷修复（2026-10-03 全项目审计后，共 32 项）

> 审计报告见 `docs/BUG_AUDIT_2026-10-03.md`（P0 5 / P1 15 / P2 22）。
> 分三批修复，每批均通过 `npm run typecheck`。

### 批次 1（`681a623`）—— 5 条 P0 + 进度条 2 项

| 编号 | 问题（用户可见） | 修复 |
|---|---|---|
| P0-1 | ~~聊天流冻结~~ **实测更正：不成立** | `getMessageTime` 统一走 `toMs` 归一为毫秒。**实测两个 HTTP 接口 msgTime 均为 13 位毫秒**，与 NIM 一致，不存在单位混用；此改动改为防御性（若接口将来变秒仍安全），非根因修复 |
| P0-2 | 跨成员消息串台、分页游标错乱 | refresh / loadMore / catch / finally 补 `{seq, channelId}` 校验；`closeRoom` 自增 `roomSeqRef` |
| P0-3 | 直播小窗回大窗被当录播（拖进度条 seek 直播流有原生闪退风险） | `backTo.mode` 由硬编码 `'vod'` 改为 `cur.isLive ? 'live' : 'vod'` |
| P0-4 | 首条线路失败即掉出播放器 | 新增 `openToken`，跨页顶替判定不再比对 `source.url`（换线只改 url） |
| P0-5 | 请求可永久挂起（超时失效） | fetch 始终使用内部 `controller.signal`，外部取消经 `extAbort` 联动 |
| P1-1 | 进度条松手后回弹 | `playerStore.setPosition` 加 seek 粘滞守卫（stickyTarget/From/Until） |
| P1-2 | 拖到最左 / 双击退到开头无效 | 新增 `seekNonce`，不再拿 `seekTarget > 0` 当哨兵 |

### 批次 2（`5250679`）—— P1 共 16 项

小窗与大窗交棒丢进度、小窗/电台页与音乐**双声互斥**（2 项）、PiP 标志改为单一权威源、
网页内核回传 duration（进度条不再 0:00 且可拖）、无 `onRetry` 时重试按钮重建内核、
Exo 首帧不再覆盖用户暂停、失焦 tab 不再抢返回键、返回键先收键盘、列表/直播轮询加前后台+焦点双门卫、
翻牌页加载中不再误报「暂无记录」、私信页 loading 拆分；
另修 `usePaginator` 静默吞异常、首页成员直播区加载白块、统计页刷新转圈提前结束。

### 批次 3（`0d3727a`）—— P2 共 9 项

网页内核双控制条、`PlayerChrome` 定时器泄漏、`activeKernel` 永不为 `web`（守卫失效）、
横屏 rtmp 直播被当竖屏、`pipCover` 缺看门狗（事件丢失导致界面假死）、
小窗回全屏 `playNonce` 同毫秒重复、歌词缓存补 `res.ok` 校验并统一串行写、
网络层 abort 监听泄漏（移入 finally）、消息发送者 id 未 trim。

### 批次 4（`337c220`）—— P2 共 11 项

**播放器**：进度条拖动加 rAF 限帧（+ 最小跳变 0.4%，与 FullScreenPlayer 同款）、
进度触控高度 30→44（达标 44×44）、缓冲时保持控制条可见、
自动重解析定时器改用 `onRetryRef`（此前被父组件内联 `onRetry` 反复重排 → 900ms 定时器饿死）、
小窗网页内核补 `onMessage`（videosize 修正「永远 180×104 被裁」、progress 修正「回大窗从 0 开始」）。

**缓存与存储**（读改写并发 + 无限增长）：`resumePosition` 与 `downloads` 加写串行链、
`resumePosition` 加 200 条容量淘汰、`roomMapCache` 持久化串行、`coverToFile` 内存缓存 80 条上限。

**健壮性**：`NetworkImage` 按 uri 强制重挂载（不再闪上一项旧图）、
`ErrorBoundary` 重试递增 `retryNonce` 并作为子树 key（不再「重试即再崩」）。

### 复核为误报

| 项 | 核实结论 |
|---|---|
| P2-13 小窗初始位置不随布局变化重定位 | **误报**：夹紧 effect 依赖已含 `winW/winH/boxW/boxHNow`，且注释记录了「boxH 自适应变高后需重新夹紧」的历史修复 |

## 四、MuMu 真机验证（2026-10-03）

> 环境：`adb 127.0.0.1:16480`（SM_S938U / MuMu），`YAYA_ABIS=x86_64` 单 ABI 包，`install -r` 覆盖安装（保留登录态）

### 验证通过

| 验证点 | 结果 |
|---|---|
| 崩溃 | `logcat -b crash` **0 行**；`ErrorBoundary caught` **0 次** |
| 成员库 | `962 位`（非 900），`serverId 546 / channelId 544 / yklzId 299` |
| **状态分类修复** | `graduated=727 / active=235` —— 上游删 `status` 后不再退化为 `unknown` |
| **P0-2 切房竞态** | 快速切房间 4 次（0.3-0.5s 间隔），消息**无串台**、无错误态 |
| 房间消息加载 | `进房 鲍雨欣 big 50条/468ms`、`small 1条/219ms` |
| 大小房间消息区分 | 列表与房间内「��/小」标签正确区分 |
| NIM 实时通道 | `native qchat CONNECTED` |
| **进度条回弹** | 拖至 ~81% → 2s 后稳定 91%，**无回弹** |
| 进度条时长 | `0:34 / 3:51` 正常 |
| 返回键 | 1 次关播放器回首页、2 次退桌面（标准） |
| 错误态 | 401004 时显示「加载失败 + 重试」，非白块 |

### 验证中发现并修复的回归（本次改动自身引入）

**`fd274ce` 快速切换播放器必崩**：`TypeError: Cannot read property 'current' of undefined at PlayerChrome`
- 根因：批次 4 的 rAF 限帧把 `const progRaf = useRef(0)` 声明在 `if (!source) return null` **之后**。
  `source` 首次渲染为空时该作用域没有该变量（Metro/Babel 转 `var` 后为 `undefined`），
  卸载时 effect cleanup 访问 `progRaf.current` 抛错。
- 修复：上移到早退之前；已复检 `MiniPlayer`（`navNonceRef` L99 < 早退 L327）、`PlayerScreen`（无早退）无此问题。
- 复验：重新出包后同路径操作 **crash 0 / ErrorBoundary 0**。
- **已写入 `MEMORY.md` 铁律**：新增 hook/ref 必须放在所有早退之前。

### 未能验证（缺条件）

| 项 | 缺什么 |
|---|---|
| P0-3 直播小窗回大窗 | 时段内**无任何直播**（「此时段暂无成员直播/公演直播」） |
| P1-3 网页内核 duration / P2-1 双控制条 | 「最近播放」只有**音乐**，无网页内核视频源 |
| P0-1 消息流实时上屏 | 房间内**无人发言**（且该项根因已被实测推翻，见上） |

### 已知未修（均有明确原因）
| 项 | 原因 |
|---|---|
| P1-4 inline 全屏 Modal 换根导致内核 remount（黑屏重缓冲） | 续播已正确（`PlayerCore:259` 用当前 position）；彻底消除需引入 Portal / 全屏容器架构改造，风险高于收益 |
| P2-18 裸 `<Image>` 收敛（20+ 处） | 涉及 20+ 处 UI 的占位与比例，**必须在真机逐屏验证**后才可替换 |
| P2-16 / P2-17 安全区（底栏未用 inset、Android 硬编码 `bottom=48`） | 项目有意不接 `react-native-safe-area-context`（代码注释），改成运行时测量需先确认策略并多机型验证 |
| P2-11 视频小窗后台播放缺前台服务/通知 | **音频已有**（YayaExoService / RadioForegroundService，均声明 mediaPlayback）；**视频小窗仍无** → 关掉 pip_auto 后切后台音频会被系统挂起。需原生改造 |
| ~~P2-12 PiP 标志写入点~~ | **已修**（见第 15 项：改为按来源登记 + OR 汇总） |
| P2-15 `onClose` 单槽（多播放器并存时清理错页面） | 需改为按实例 id 注册的回调栈，属架构改动，触发场景（切屏竞态）需真机复现验证 |

## 五、鸡腿榜 / 相册 / 小窗（2026-10-06 ~ 10-12）

### 8. 鸡腿榜：切换瞬间日期栏塌陷 + 页签实心粉块 + 文字被裁
- **现象**：切周次/切页签的一瞬间日期栏被「挤一下」；页签是半屏宽的实心粉胶囊；周次文字显示成「09日28日」
- **根因**（三个独立原因，逐帧取证）：
  1. chip 不设高度，被父容器压到 **25.3dp** 后只剩 11dp 放 18dp 行高 → 字形被裁（MuMu 实测）
  2. 页签是 2 个 `flex:1` 的 `Pill`，selected 态是**实心 tint 填充** → 各占半屏的纯粉胶囊
  3. 选中态切换会**换元素树**（实心 Pressable ↔ GlassSurface 包裹）；换树期间有一帧按**内容边界**绘制背景 → 粉色矩形只剩一行文字高（连拍实测 36px vs 正常 96px）
- **改动**：周次 chip 改结构恒定实底（背景拆独立层、圆角取半高 16、给死 `height:32`）；页签换全站标准 `GlassSegmented`；列表 `maxHeight:46`→`height:44` 且横向列表关掉 `removeClippedSubviews`
- **涉及**：`src/screens/MeleeRankScreen.tsx`、`src/components/GlassSegmented.tsx`
- **commit**：`7d3fb9c`、`70b3e65`

### 9. 鸡腿榜：点已选项会清空榜单且永不重载
- **现象**：点当前已选中的周次/页签 → 榜单变「暂无排名数据」且不再恢复（用户描述为「双击日期像是刷新」）
- **根因**：`onPress` 无条件 `setRanks([])`，紧接着 `setSelectedWeek(item)` 传入的是**同一个对象引用** → setState 无变化 → 加载 effect 不重跑 → 清空后卡死
- **改动**：两处都先判等（已选中直接 return）；切换周次不再清空列表（保留旧数据直到新数据到达，页面高度全程不变）
- **commit**：`1753f83`

### 10. 日期栏在切换页签时整行塌陷
- **现象**：切到「成员贡献」再切回「周榜」，日期栏塌成一行文字高
- **根因**：日期栏写成 `mode === 'week' && ...` → 切到成员贡献整行被**卸载**，切回时重新挂载，挂载首帧父级尚未完成布局
- **改动**：日期栏两个页签下都常驻（顺带保留横向滚动位置）；加载 effect 拆成两个（避免在成员贡献页点日期白跑一次 `loadPerson`）
- **commit**：`e98de8b`

### 11. 分段控件滑动胶囊被竖切
- **现象**：切换页签的瞬间胶囊**左圆头整块消失、左边缘是一条硬直线**
- **根因**：胶囊用 `GlassSurface role="selector"`（expo-blur 的 BlurView）。Android 上用**原生驱动 transform** 位移时，backdrop 的**裁剪框不跟随** → 移出旧裁剪框的部分被竖直切掉
- **改动**：移动胶囊改用与 `SELECTOR` 材质等价的不透明层（深色 12% 白 + 10% 白描边），不再用 BlurView；**轨道仍保留玻璃**
- **涉及**：`src/components/GlassSegmented.tsx`
- **commit**：`70b3e65`

### 12. 鸡腿榜偶发加载不出来（504）
- **根因**：官方网关偶发 504 / 超时（同一请求时好时坏）
- **改动**：新增 `withTransientRetry`（3 次、400/900ms 退避；**仅**对超时/网络/5xx 重试，业务错误不重试）
- **commit**：`7d3fb9c`

### 13. 周榜「上拉加载」滑到底没反应
- **根因**：上游 `getMeleeWeekRank` 的 `nextId` 是**死游标**（原样回显、返回同一份）；且周榜服务端**硬上限 7 条**（试过 11 种扩容参数）
- **改动**：返回值与传入值相同时判定不可翻页，停止上拉
- **备注**：官方 APK 里**根本没有** `getMeleeWeekRank` 这个接口（官方只有 `getMeleeYearRank` 与 `getPersonMeleeRankPage`），官方自己的周贡献榜是 H5 页面 `/session/devoterank`
- **commit**：`1753f83`

### 14. 恢复「房间相册」（对照桌面版 yayamsg）
- **现象**：相册功能缺失（`0ee880f` 曾以「有问题未实现」删除）
- **根因**：当年删除时**唯一硬伤**是 `import PlayerScreen, { buildPocketHeaders } from '../player'` —— 播放器重写后 `player/index` 不再导出该符号（实际在 `resolve/streamResolver`）。接口与 API 层（`getRoomAlbum`）**从未被删**，与桌面版 `room-album-feature.js` 完全一致
- **改动**：
  - 恢复页面，并按**现行玻璃规范**重做风格：大/小房间改用全站标准 `GlassSegmented`（替换手搓 TouchableOpacity 分段；小房间仅在成员有 `yklzId` 时出现）；网格卡圆角对齐 token（`radiiAlias.cardCompact`）、banner 对齐 `radiiAlias.card`；网格卡保持**实底**（遵守「列表/网格逐卡禁玻璃」）
  - 重新接回：navigation types + Stack.Screen + 首页工具「相册」入口
  - 补 4 语言包 i18n key `{mode} · {name}`
- **涉及**：`src/screens/RoomAlbumScreen.tsx`、`src/navigation/*`、`src/screens/HomeScreen.tsx`、`src/i18n/*`
- **commit**：`fc1099d`

### 15. 系统小窗（PiP）标志写入点互相踩
- **现象**：小窗正在播放时打开全屏播放器，**按 Home 不弹系统悬浮窗**；反向：全屏播放器卸载会把还在播的小窗标志一起清掉
- **根因**：5 个调用点各自往原生写**绝对布尔值**（MiniPlayer / FullscreenManager / MediaScreen），后写者覆盖前者
- **改动**：改为**按来源登记**（`miniplayer` / `fullscreen` / `mediascreen`），原生标志 = 各路 OR 汇总
- **涉及**：`src/utils/pip.ts` + 3 个调用点
- **commit**：`fc1099d`

### 16. 小窗两颗按钮图标一模一样
- **现象**：小窗右上角「全屏」与紧跟其下的「尺寸档位」两颗按钮**看起来完全一样**，只能靠颜色区分
- **根因**：尺寸档位按钮在 `scale === 1` 时用的是 `arrow-expand` —— 与「全屏」按钮同一个图标
- **改动**：尺寸档位按钮固定用 `resize`（全屏仍保留 `arrow-expand` + 「全屏」文字），两者图标语义彻底分开
- **涉及**：`src/components/MiniPlayer.tsx`
- **commit**：`512d62f`

### 17. 语音/视频翻牌缺少播放按钮与秒数
- **现象**：翻牌统计明细里，语音/视频翻牌的答案只有文字，没有播放按钮、也没有时长
- **根因**：`parseAnswer` 只解析 `answerContent/answer/answerText/replyContent`；当 URL/时长在**条目自身字段**（`answerUrl` / `answerDuration` 等）时全部取不到 → `answerUrl` 空 → 播放/下载按钮不渲染，`ansDur` 为 0 → 秒数不显示
- **改动**：`parseAnswer` 增加兜底：URL 依次取 `answerUrl/ansUrl/voiceUrl/audioUrl/videoUrl/mediaUrl/answerMedia/answerMediaUrl/answerPath/…`；时长取 `answerDuration/answerSecond/duration`
- **涉及**：`src/screens/FlipScreen.tsx`
- **commit**：`512d62f`

### 18. 播放器下半底坞过高、不随设备自适应
- **现象**：全屏播放器底部（弹幕输入 + 控制行）整体偏高，小屏机型更明显
- **根因**：`dockWrap` 的 `paddingBottom`、弹幕行 `marginBottom` 均为固定值，未按屏幕高度缩放
- **改动**：引入 `dockScale = clamp(0.82, 1, screenH / 820)`，底坞 `paddingBottom`、弹幕行 `marginBottom` 按它取整缩放
- **涉及**：`src/player/chrome/PlayerChrome.tsx`
- **commit**：`512d62f`

### 19. 弹幕输入框偏高
- **现象**：直播底坞里的弹幕输入框比同类输入框高
- **根因**：`minHeight: 36` + `paddingVertical: 8`，视觉偏厚
- **改动**：`minHeight 34` / `paddingVertical 6` / `borderRadius 17`（保持胶囊比例）
- **涉及**：`src/components/LiveBarrageBoard.tsx`
- **commit**：`512d62f`

## 附：发版清单

- 出包：`node scripts/build-apk.js` → `E:\yymsg\APK\`
- 版本号需同步改：`package.json` / `app.json` / `src/constants/index.ts`(APP_VERSION) 等，
  `scripts/verify-version.js` 会校验一致性
- **App 侧改动全部在本地 plus 分支，尚未 push**；服务端改动已 push 到 origin/main
