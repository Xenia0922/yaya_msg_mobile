# 口袋48（SNH48 官方 Fans App）接口研究报告

> **更新（2026-08-16 第二版，源码级确认）**：以下精确参数/字段由子代理直接读取 GitHub 源码得出，比 web_search 推断更权威，位于本文顶部补充节。其后保留第一版全文。

## ⭐ 源码级确认补充

### getLiveList（直播/录播列表）
- 参数：`userId`(按成员)、`groupId`(大组)、`teamId`、`next`(**翻页游标，录播分页，初始"0"**)、`record`(false=直播 / true=录播)、`debug`
- **`groupId` 取值**：明星殿堂19、THE9 17、硬糖少女303 18、丝芭影视20、**SNH48=10、BEJ48=11、GNZ48=12、CKG48=14、CGT48=21**、IDFT 15、海外练习生16
- 返回 `content`：`liveList[]`、`next`(下一页游标)；每项 `coverPath / ctime(13位毫秒) / liveId / roomId / title / userInfo / status`
- **`liveType`**：1=直播、2=电台、5=游戏、6=AI；**`liveMode`**：0=正常、1=录屏

### getLiveOne（直播详情）
- 请求 `{liveId}` → `content` 含 `type`(1直播/2电台)、`playStreams[]`(streamName/streamType 1-3/vipShow)、`praiseNum`、`danMuInfo`

### 房间消息 im/api/v1
- 旧路径：`chatroom/msg/list/homeowner`（房主=成员本人消息）/ `chatroom/msg/list/all`（房间全部消息）
- 旧参数：`ownerId`、`needTop1Msg:"false"`、`nextTime`(**翻页游标，初始"0"**)、`roomId`；返回 `content.message[]` + `content.nextTime`
- 新版(48tools)：`team/message/list/homeowner`，参数 `channelId, serverId, nextTime, limit:700`
- **msgType 枚举**：TEXT/IMAGE/REPLY/GIFTREPLY/AUDIO/VIDEO/LIVEPUSH/FLIPCARD/EXPRESS/DELETE/SESSION_DIANTAI/FLIPCARD_AUDIO/FLIPCARD_VIDEO/OPEN_LIVE/TRIP_INFO/PRESENT_NORMAL/PRESENT_TEXT/VOTE…
- **extInfo.messageType**：TEXT、REPLY(replyName/replyText)、LIVEPUSH(liveId/liveTitle/liveCover)、VOTE、PRESENT_TEXT(giftInfo{isVote,giftNum})、FLIPCARD(answer/question/user.nickName)
- 房间信息：`im/room/info/type/source`，请求 `{type:'0', sourceId:<明星id>}` → `content.roomInfo.roomId`

### 签到 checkin
- POST body `{}`；status=200 成功，`content` 含 `days/addExp/addSupport`；**status=1001006 = 今日已打卡**

### 翻牌消息形态
- 房间流：`msgType=='FLIPCARD'`，extInfo 含 `answer/question`；老接口 `extInfo.messageObject=='faipaiText'`，字段 `faipaiName/faipaiContent/messageText`
- 官方定价规则：https://h5.48.cn/2018apppage/idolrule/ ；粉丝整理鸡腿价目：https://www.douban.com/group/topic/221479496/

### 分页精确结论
- 直播列表：`next`（回传 content.next）；record=false 按 userId 且 next=0 时取首条 liveId 作 next
- 房间消息：`nextTime`（13位毫秒游标，初始"0"，回传 content.nextTime）
- posts/动态：`nextId`+`limit`；成员档案：`lastTime`+`limit`

### 仍未找到公开资料（需自行抓包）
1. 直播贡献榜 `getLiveRank`（路径/参数/字段均无）
2. 私信 `message/api` 与 `conversation/page`（wdwind 源码标注 "empty?" 未验证）
3. 行程 TRIP_INFO 字段（仅 48tools interface.d.ts 有枚举名）
4. 48tools 官方飞书文档（需登录）：https://yzb1g5r02h.feishu.cn/docx/MxfydWlNaovZ5sxsbJ5crnAlnVb
5. `toType`、media `typeId`、idolanswer operateType、invoice 字段

### 权威源码仓库（可直接 clone）
- wdwind/pocket48_api（直播/房间/登录/posts）
- duan602728596/48tools（groupId 表、返回类型、直播/公演：`services/48/index.ts`、`interface.d.ts`、`enum.ts`）
- dbFlower/grab48（checkin 签到、直播、房间、用户）
- chinshin/CQBot_hzx（msgType/翻牌 FLIPCARD）
- SuxueCode/Pocket48RoomListen（老接口 faipaiText）
- MikuZZZ/pocket48-graphql、gitcode.com/gh_mirrors/48/48tools（镜像）

---

> **域名**：`pocketapi.48.cn`
> **研究方式**：综合 `web_search` 全文检索 + 直接克隆并读取公开 GitHub 源码仓库（`wdwind/pocket48_api`、`duan602728596/48tools`、`dbFlower/grab48`、`chinshin/CQBot_hzx`、`SuxueCode/Pocket48RoomListen` 等）。
> **可信度标注**：凡标注来源 URL 的内容为"源码级确认/找到公开资料"；标注 **「未找到确切公开资料」** 的内容为确实查不到，多数"仅凭代码/路径命名推断"。

---

## 0. 结论先行

- **已有源码级确认**：直播列表 `getLiveList`（`record=true`=录播、`groupId` 取值表、`liveType`/`liveMode` 枚举、`next` 游标）、直播详情 `getLiveOne`、房间消息 `homeowner`/`all`（`nextTime` 游标、`msgType`/`extInfo` 字段）、签到 `checkin`、翻牌卡片在房间流中的消息形态、直播拉流地址。
- **未找到确切公开资料**（需自行抓包或查阅需登录的内部文档）：直播贡献榜 `getLiveRank`、私信 `message/api` 与 `conversation/page`（源码中标注 "empty?"）、翻牌提交/定价 `idolanswer` REST、媒体 `media typeId` 确切枚举、`friendships toType` 确切取值、`star/archives`、行程 `trip`、送礼 `gift/send`、乱斗榜 `melee/rank`、开票 `invoice`。
- **最权威做法**：直接 clone `duan602728596/48tools`（`src/services/48/` 的 `.ts` 类型即字段文档）与 `wdwind/pocket48_api`（python 实时调用）。web_search 无法索引这些源码逐行，网页上也没有逐字段文档。

---

## 1. 直播接口 `live/api/v1/live/`

### 1.1 `getLiveList` —— 直播/录播列表 ✅ 找到

`https://pocketapi.48.cn/live/api/v1/live/getLiveList`

**请求参数字段**：

| 参数 | 含义 |
|---|---|
| `userId` | 按成员查询（登录者 user 或明星 id） |
| `teamId` | 队伍 id（wdwind / grab48 使用；48tools 未用） |
| `groupId` | 大组 id（取值表见下） |
| `next` | **翻页游标（录播分页用），初始 "0"**；下一页取上次响应的 `content.next`。48tools 注释原文："next - 录播id分页"。直播(record=false) 且按 userId 查询、next=0 时，48tools 会先取请求到的第一条 `liveId` 作为 `next` 传入 |
| `record` | **布尔：false=直播，true=录播**（→ 回答：`record=true` 确实对应录播列表） |
| `debug` | 调试标志 true/false |

**`groupId` 取值**（SNH48 系，来源 48tools）：明星殿堂=19、THE9=17、硬糖少女303=18、丝芭影视=20、SNH48=10、BEJ48=11、GNZ48=12、CKG48=14、CGT48=21、IDFT=15、海外练习生=16

**返回 `content`**：
- 外层：`liveList[]`、`next`（下一页游标，录播翻页关键）、`slideUpAndDown`
- 每条条目（`LiveInfo`）：`coverPath`(封面)、`ctime`(创建时间，13 位毫秒)、`liveId`、`roomId`、`title`、`status`、`userInfo{avatar,nickname,teamLogo,userId}`
- **`liveType`**：1=直播、2=电台、5=游戏、6=AI（枚举 `Pocket48LiveType`）
- **`liveMode`**：0=正常、1=录屏

> 来源：[wdwind/pocket48_api](https://github.com/wdwind/pocket48_api)（`pocket48_api.py` 187-194 行 `get_live_list()`；`pocket48_api_constants.py` 17 行 `LIVE_LIST_URL`）、[48tools](https://github.com/duan602728596/48tools)（`packages/48tools/src/services/48/index.ts` 71-127 行、`interface.d.ts`、`enum.ts` 5-20 行）、[grab48](https://github.com/dbFlower/grab48)（`TableLiveCtr.vue`）、[48tools 官方飞书文档](https://yzb1g5r02h.feishu.cn/docx/MxfydWlNaovZ5sxsbJ5crnAlnVb)

### 1.2 `getLiveOne` —— 直播详情 ✅ 找到

`https://pocketapi.48.cn/live/api/v1/live/getLiveOne`（请求 `{liveId}`）

**返回 `content`**：`liveId`、`title`、`coverPath`、`roomId`、`status`、`playNum`、`stime`、`praiseNum`、`danMuInfo`、`giftId`、`money`、**`type`**(1=直播/2=电台)、`playStreams[]`（含 `streamName` 标清/高清/超清、`streamType` 1/2/3、`vipShow`）、`endTime`。

> 另：`getlivestream {liveId, streamType:3}` → `content` 为拉流地址。
> 来源：48tools `index.ts` 40-50 行、wdwind `pocket48_api.py` 196-198 行、CQBot_hzx `koudai48.py` 315-336 行

### 1.3 `live/api/v1/live/result` —— 直播结束回放信息

**未找到确切公开资料**（无公开路径/参数/字段文档）。

### 1.4 `live/api/v2/live/getLiveRank` —— 直播贡献榜 ⚠️ 未找到

**未找到确切公开资料**。web_search 与全部已读源码仓库中均无公开的接口路径、参数、返回字段。百度贴吧存在人工统计的"直播历史数据"（[链接](https://jump2.bdimg.com/p/5615243523)），属人工数据，**非接口文档**。

---

## 2. IM 房间 / 会话 `im/api/v1/`

### 2.1 房间消息 `homeowner` vs `all` ✅ 找到

| 接口 | 用途 |
|---|---|
| `im/api/v1/chatroom/msg/list/homeowner`（新版 `im/api/v1/team/message/list/homeowner`） | **房主=该成员本人发的消息** |
| `im/api/v1/chatroom/msg/list/all` | **房间全部消息**（所有粉丝+成员） |

> **区别**：`all` = 房间内所有人的发言；`homeowner` = 仅房间主人（该成员本人）发言。

**请求参数**（旧版，wdwind/grab48）：`ownerId`、`needTop1Msg:"false"`、`nextTime`（**翻页游标，初始 "0"**）、`roomId`。
**请求参数**（新版 team，48tools）：`channelId`、`serverId`、`nextTime`、`limit:700`。

**返回**：`content.message[]`、`content.nextTime`（下一页游标）。

**`message[]` 条目字段**：`msgIdServer`、`msgIdClient`、`bodys`(JSON 字符串，图片/语音/视频 url；图片前缀 `https://source.48.cn`)、`extInfo`(JSON 字符串)、`msgType`、`msgTime`(13 位毫秒，越大越新)。

**`msgType` 枚举**（48tools `interface.d.ts` 106-128 行）：
`TEXT` / `IMAGE` / `REPLY` / `GIFTREPLY` / `AUDIO` / `VIDEO` / `LIVEPUSH` / `FLIPCARD` / `EXPRESS` / `DELETE` / `DISABLE_SPEAK` / `SESSION_DIANTAI` / `FLIPCARD_AUDIO` / `FLIPCARD_VIDEO` / `EXPRESSIMAGE` / `OPEN_LIVE` / `TRIP_INFO` / `PRESENT_NORMAL` / `PRESENT_TEXT` / `VOTE` / `CLOSE_ROOM_CHAT` / `RED_PACKET_2024` 等。

**`extInfo.messageType` 细分字段**（CQBot_hzx `koudai48.py` 146-311 行）：
- `TEXT`
- `REPLY` → `replyName` / `replyText` / `text`
- `LIVEPUSH` → `liveId` / `liveTitle` / `liveCover`
- `VOTE`
- `FLIPCARD` → `answer` / `question` / `user.nickName`
- `PRESENT_TEXT` → `giftInfo{isVote, giftNum}`

**房间相册** = `IMAGE` 消息（`bodys.url`，图片前缀 `https://source.48.cn`）。

**房间信息** `im/api/v1/im/room/info/type/source`：请求 `{type:'0', sourceId:<明星userId>}` → `content.roomInfo.roomId`。

> 来源：wdwind `pocket48_api.py` 2-3、115-123 行；grab48 `RoomCtr.vue` 103-187 行；CQBot_hzx `koudai48.py` 80-97、338-361 行；48tools `index.ts` 170-193 行

### 2.2 `im/api/v1/team/msg/list/img` —— 房间相册

**未找到确切公开字段资料**（相册即 IMAGE 消息，见上）。

### 2.3 `im/api/v1/team/classic/last/message/get` —— 关注房间最新消息

**未找到确切公开资料**。

### 2.4 `im/api/v1/conversation/page` —— 会话列表 ⚠️ 未找到

**未找到确切公开资料**。wdwind 常量文件第 15 行有被注释掉的 `im/api/v1/conversation/page`，但注释 `# empty?` 表示未验证/为空，且无任何源码实现。

### 2.5 `im/api/v1/chatroom/msg/list/aim/type` —— 按类型取消息

**未找到确切公开字段资料**。`extMsgType` 的类型名（`POST_INFO` 动态 / `WEI_BO` 微博 / `OPEN_LIVE` 公演）来自接口路径/生态命名规约推断，无精确字段文档。

---

## 3. 翻牌 `idolanswer/`

### 3.1 翻牌消息在房间流中的形态 ✅ 找到

- `msgType == 'TEXT'` 且 `extInfo.messageType == 'FLIPCARD'` 即翻牌消息，`extInfo` 含 `answer`(偶像答复)、`question`(粉丝问题)、`user.nickName`。
- 老接口：`extInfo.messageObject == 'faipaiText'`，字段 `faipaiName` / `faipaiContent` / `messageText`。

> 来源：CQBot_hzx `koudai48.py` 179-183、267-271 行；Pocket48RoomListen `PocketPlugins.cs` 180-182 行

### 3.2 翻牌机制/定价（用户端资料）

- 官方"成员竞价翻牌规则"：[https://h5.48.cn/2018apppage/idolrule/](https://h5.48.cn/2018apppage/idolrule/)
- 粉丝整理的各偶像翻牌鸡腿价目（非官方）：[https://www.douban.com/group/topic/221479496/](https://www.douban.com/group/topic/221479496/)

### 3.3 翻牌提交/定价 REST 接口 ⚠️ 未找到

**`idolanswer/v1/user/question`、`idolanswer/v1/user/question/operate`（`operateType`）、`idolanswer/v2/custom/index`：未找到确切公开资料**。全网 + 全部已读源码仓库均未检索到提交翻牌/定价的接口文档。

---

## 4. 官方媒体 `media/api/media/v1/`（talk/list、music/list、video/list）

**未找到确切公开字段资料**。`typeId` 大概率是媒体/视频分类 Id（如公演/单人/采访等），但 **无公开枚举文档，仅凭代码推断**。

---

## 5. 私信 `message/api/v1/user/message/`（list、info、reply）

**未找到确切公开资料**。`conversation/page` 在源码中被标注为空；私信一对一接口结构未被公开文档覆盖。

---

## 6. 用户 `user/api/v1/`

| 接口 | 用途 | 资料状态 |
|---|---|---|
| `user/info/reload` | 重载当前登录用户信息 | **未找到确切公开资料** |
| `user/info/home` | 当前用户主页（`{userId, needMuteInfo:"True"}` → `content.baseUserInfo`，含 userRecommend 信息；"对某偶像贡献"展示数据，非贡献榜接口） | 部分（见 grab48 `InfoUser.vue`） |
| `friendships/friends/id` | 关注/好友列表 | **未找到确切公开资料** |
| `friendships/friends/add` / `remove` | 关注/取关 | **未找到确切公开资料**；`toType=1` 含义仅凭 friendships 语义推断为"成员" |
| `user/checkin` | 签到 | ✅ 已确认（见下） |
| `user/star/archives` | 成员档案（生诞/血型/应援色等） | **未找到确切公开字段资料**；wdwind 档案接口用 `lastTime`+`limit` 分页 |
| `user/star/history` | 成员历史履历 | **未找到确切公开资料** |

### `user/checkin` 签到 ✅ 找到

`https://pocketapi.48.cn/user/api/v1/checkin`，POST，body `{}`。

- 返回 `status=200` 成功；`content` 含 `days`(连续天数)、`addExp`(经验+)、`addSupport`(应援力+)。
- `status=1001006` = 今日已打卡。

> 来源：[grab48](https://github.com/dbFlower/grab48) `GLOBAL.vue` 82 行、`account.vue` 111-141 行

---

## 7. 其它接口

| 接口 | 用途 | 资料状态 |
|---|---|---|
| `trip/api/trip/v1/list` | 行程列表 | **未找到确切公开资料**（仅 48tools `interface.d.ts` 有 `TRIP_INFO` 枚举名，无字段文档） |
| `gift/api/v1/melee/rank` | 鸡腿乱斗榜（分团/季度 PK 榜） | **未找到确切公开资料** |
| `gift/api/v1/gift/send` | 送礼（鸡腿/礼物） | **未找到确切公开资料** |
| `invoice/api/v1` | 消费开票 | **未找到确切公开资料** |
| `posts/api/v1/posts/img/list` | 图片动态列表 | **未找到确切公开统一字段**；`content` 内含图片 URL 数组；wdwind 用 `nextId`+`limit` 分页（属 posts 范畴） |

---

## 8. 分页机制总结（精确结论）

| 接口类 | 翻页字段 | 说明 |
|---|---|---|
| 直播列表 `getLiveList` | **`next`** | 取 `response.content.next` 回传；录播尤其关键。`record=false` 且按 userId 查询、next=0 时取首条 `liveId` 作 `next` |
| 房间消息 homeowner / all | **`nextTime`** | 13 位毫秒时间戳游标，初始 "0"，回传 `content.nextTime`；grab48 用 `loadMore` 标志做追加去重 |
| 动态 / 相册（posts 类） | `nextId` + `limit` | wdwind 实现 |
| 成员档案 | `lastTime` + `limit` | wdwind 实现 |

> `ctime` 是消息/记录自身的时间戳（13 位毫秒），**非翻页游标**。

---

## 9. 参考项目与接口映射资源位置

| 项目 | 覆盖内容 |
|---|---|
| [wdwind/pocket48_api](https://github.com/wdwind/pocket48_api) | 专门的 python 接口库：直播、房间、登录、posts、常量 URL 表 |
| [duan602728596/48tools](https://github.com/duan602728596/48tools) | 最全：groupId 表、TS 返回类型（`interface.d.ts`）、liveType/liveMode 枚举（`enum.ts`）、直播/公演/录播。services 位于 `packages/48tools/src/services/48/`（[提取 commit e8cd26ee](https://github.com/duan602728596/48tools/commit/e8cd26eeacae93ef74fc0894196f8f323bb55219)） |
| [dbFlower/grab48](https://github.com/dbFlower/grab48) | 签到 checkin、直播、房间、用户（Vue 实现） |
| [chinshin/CQBot_hzx](https://github.com/chinshin/CQBot_hzx) | 房间消息 `msgType` 全枚举、翻牌 `FLIPCARD` 解析 |
| [SuxueCode/Pocket48RoomListen](https://github.com/SuxueCode/Pocket48RoomListen) | 老接口 `faipaiText` 翻牌 |
| [MikuZZZ/pocket48-graphql](http://mirrors.yin199909.workers.dev/MikuZZZ/pocket48-graphql) | pocket48 GraphQL 封装，侧面反映接口结构 |
| [gitcode 48tools 镜像](https://gitcode.com/gh_mirrors/48/48tools) | 48tools 文件树镜像（`packages/` 目录） |
| 48tools 官方飞书文档 | https://yzb1g5r02h.feishu.cn/docx/MxfydWlNaovZ5sxsbJ5crnAlnVb（**需登录**，正文未获取） |

> 另见：48tools fork（[cysk003](https://github.com/cysk003/48tools)、[WangZhiGangELoancn](https://github.com/WangZhiGangELoancn/48tools)、[java66liu](https://github.com/java66liu/48tools)）、[GNZ48-Xie-Leilei-Fan-Club/pocket48-monitor](https://github.com/GNZ48-Xie-Leilei-Fan-Club/pocket48-monitor)、[yourcolour/pocket48_for_gnz](https://github.com/yourcolour/pocket48_for_gnz)、[Lawaxi/WebPocket48Assistant](https://github.com/Lawaxi/WebPocket48Assistant)、[duan602728596/qqtools](https://github.com/duan602728596/qqtools)。

---

## 10. 未找到确切公开资料清单（需自行抓包）

1. **直播贡献榜 `getLiveRank`（v2）** —— 无公开路径/参数/字段。
2. **私信 `message/api/v1/user/message/`（list/info/reply）** 及 **`conversation/page`** —— 源码标注 "empty?"。
3. **翻牌提交/定价 `idolanswer`（`question` / `question/operate`(`operateType`) / `v2/custom/index`）** —— 无提交接口文档。
4. **媒体 `media/api/media/v1` 的 `typeId` 枚举**。
5. **`friendships` 的 `toType=1` 确切取值**。
6. **`user/star/archives`、`trip`（行程字段）、`gift/send`、`gift/melee/rank`、`invoice`、`posts/img/list` 统一字段**。
7. **28tools 官方飞书文档正文**（需登录）。

> 对上述清单，建议对官方 App 做抓包（`pocketapi.48.cn`），公开资料中暂无现成实现。

---

## 11. 最终诚实结论

- **已获源码级确认**：`getLiveList`（含 `record`/`groupId`/`liveType`/`liveMode`/`next`）、`getLiveOne`、房间消息 `homeowner`/`all`（`nextTime` 游标 + `msgType`/`extInfo`）、签到 `checkin`、翻牌卡片在房间流中的形态、直播拉流地址。
- **未找到确切公开资料**：`getLiveRank`、私信、`idolanswer` 提交/定价、media `typeId`、`friendships toType`、`star/archives`、`trip`、`gift send/melee`、`invoice`。
- **最权威获取方式**：clone `duan602728596/48tools`（`src/services/48/` TS 类型）与 `wdwind/pocket48_api`（python 实时调用）直接读源码；如需缺失项，对官方 App 抓包。

---

## 12. 参考 URL 列表（全部）

- https://github.com/wdwind/pocket48_api
- https://github.com/duan602728596/48tools
- https://github.com/duan602728596/48tools/commit/e8cd26eeacae93ef74fc0894196f8f323bb55219
- https://github.com/duan602728596/48tools-cli
- https://github.com/cysk003/48tools
- https://github.com/WangZhiGangELoancn/48tools
- https://github.com/java66liu/48tools
- https://github.com/dbFlower/grab48
- https://github.com/chinshin/CQBot_hzx
- https://github.com/chinshin/qqbot_hzx
- https://github.com/SuxueCode/Pocket48RoomListen
- https://github.com/MikuZZZ/pocket48-graphql（镜像 http://mirrors.yin199909.workers.dev/MikuZZZ/pocket48-graphql）
- https://github.com/GNZ48-Xie-Leilei-Fan-Club/pocket48-monitor
- https://github.com/yourcolour/pocket48_for_gnz
- https://github.com/Lawaxi/WebPocket48Assistant
- https://github.com/duan602728596/qqtools
- https://gitcode.com/gh_mirrors/48/48tools
- https://yzb1g5r02h.feishu.cn/docx/MxfydWlNaovZ5sxsbJ5crnAlnVb（48tools 官方文档，需登录）
- https://h5.48.cn/2018apppage/idolrule/（官方翻牌规则）
- https://www.douban.com/group/topic/221479496/（粉丝整理的翻牌鸡腿价目）
- https://www.douban.com/group/topic/283946418/（口袋48 直播源抓取讨论）
- https://jump2.bdimg.com/p/5615243523（百度贴吧人工直播数据，非接口文档）
- http://cnnetsun.cn/a/1367789（48Tools 直播数据采集技术文章）
- https://blog.csdn.net/XBXX_java/article/details/147273742（口袋48 app 逆向：验证码 param 加密）
- https://blog.gitcode.com/b3e5236c9c592ca9468706d723dac35c.html（48tools 实战指南）
- https://github.com/topics/snh48?l=python
- https://repos.ecosyste.ms/topics/koudai48
- https://github.com/duan602728596/48tools/releases（如 tag v4.7.0: https://github.com/duan602728596/48tools/releases/tag/v4.7.0）
