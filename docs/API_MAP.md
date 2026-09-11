# 牙牙消息 · 口袋48 API 全景映射（2026-08-16）

> 目的：把 `src/api/pocket48.ts` 及关联 API 层每个方法对应到官方接口的用途、参数、分页与数据要点，
> 作为后续「按易用性/可用性逐功能重写页面」的依据。推断标注见文末。

## 0. 基础设施

| 项 | 值 | 说明 |
|---|---|---|
| 主域名 | `https://pocketapi.48.cn` | 口袋48 官方 App 接口 |
| 头像上传 | `https://pfile.48.cn/filesystem/upload/image` | 表单上传 |
| 公演直播页 | `https://live.48.cn/Index/inlive/id/{liveId}` | 抓取参与成员 |
| Meet48 | `https://meetapi-v2.meet48.xyz/meet48-api/...` | 第三方聚合直播 |
| B站 | `api.bilibili.com` / `api.live.bilibili.com` | 直播/二维码 |
| 成员库 | `data.gnz.hk/members.json`（运行时 `MEMBERS_URL`） | 全量成员数据 |
| 签名 | WASM 生成 `pa` 头（`src/auth`），另有 WebView 兜底签名器 | 关键请求带签名 |
| 请求管线 | `requestJson`：超时（GET 10s/POST 15s）、并发去重、GET TTL 缓存 | `src/utils/network.ts` |
| 响应判断 | `status===200 / success===true / code===0 / content!==undefined` | 兜底宽松判断 |
| 大数处理 | 响应中 15+ 位数字转为字符串再解析 | 防 ID 精度丢失 |

**Token 体系**：`token`（登录后）、`pa`（每请求签名，WASM）、`P-Sign-Type: V0`（签到/微博类）。
`tokenRequired` 默认 true（无 token 直接抛「缺少 Token」），只读公开接口设 false。

---

## 1. 用户与账号（user/api/v1）

| API 方法 | 官方路径 | 用途 | 关键参数 | 需要 token |
|---|---|---|---|---|
| `loginSendSms` | `/user/api/v1/sms/send2` | 发送登录验证码；status=2001 触发滑块验证（question/options） | mobile, area, answer | 否 |
| `loginByCode` | `/user/api/v1/login/app/mobile/code` | 验证码登录换取 token | mobile, code | 否 |
| `loginCheckToken` | `/user/api/v1/user/info/reload` | 校验 token 有效性（启动时） | from:'appstart' | 是 |
| `getNimLoginInfo` | `/user/api/v1/user/info/reload` + `/home` | 取当前用户信息（多路尝试） | from | 是 |
| `getUserProfile` | `/user/api/v1/user/info` + `/detail` + `/home` | 任意用户资料（多路尝试） | userId | 是（保守） |
| `editUserInfo` | `/user/api/v1/user/info/edit` | 改昵称/头像 | {key,value} 或 nickName/avatar | 是 |
| `getUserRenameCount` | `/user/api/v1/user/rename/count` | 剩余改名次数 | — | 是 |
| `uploadUserAvatar` | pfile.48.cn | 上传头像图 → 返回 path | 表单 file | 是 |
| `checkIn` | `/user/api/v1/checkin` | 每日签到；重复签到按成功处理（alreadyChecked） | — | 是 |
| `getCheckinToday` | `/user/api/v1/checkin/check/today` | 今日是否已签到 | — | 是 |
| `getUserMoney` | `/user/api/v1/user/money` | 鸡腿余额 | — | 是 |
| `switchBigSmall` | `/user/api/v1/bigsmall/switch/user` | 大号/小号切换 | toUserId | 是 |
| `getGroupTeamStar` | `/user/api/v1/client/update/group_team_star` | 官方成员列表（分组/队伍/星标） | — | 否 |
| `getStarArchives` | `/user/api/v1/user/star/archives` | 成员档案（编年史） | memberId | 否 |
| `getStarHistory` | `/user/api/v1/user/star/history` | 成员历史记录 | memberId, limit, lastTime | 否 |
| `getUserHomeInfo` | `/user/api/v1/user/info/home` | 用户主页聚合信息 | userId(可选) | 是 |
| `getUserPictureFrames` | `/user/api/v1/user/get/picture/frame` | 头像框列表 | — | 是 |

## 2. 关注关系（friendships）

| API 方法 | 官方路径 | 用途 | 关键参数 |
|---|---|---|---|
| `getFollowedIds` | `/user/api/v1/friendships/friends/id` | 已关注成员 ID 列表 | — |
| `followMember` | `/user/api/v2/friendships/friends/add` | 关注成员 | toSourceId, toType:1 |
| `unfollowMember` | `/user/api/v2/friendships/friends/remove` | 取消关注 | toSourceId, toType:1 |

## 3. 房间 / 聊天（im/api/v1）

| API 方法 | 官方路径 | 用途 | 关键参数/分页 |
|---|---|---|---|
| `getStarServerMap` | `/im/api/v1/team/star/server/map/get` | 全量房间 channelId→serverId 映射 | — |
| `resolveServerId(s)` | `/im/api/v1/im/team/room/info` + 映射 | 由 channelId 反查 serverId（大房间兜底） | channelId |
| `getLastMessages` | `/im/api/v1/team/classic/last/message/get` | 关注房间的最新消息（首页/房间列表摘要） | serverIdList[] |
| `getRoomMessages` | `/im/api/v1/team/message/list/all`（含粉丝）/ `.../homeowner`（仅成员） | 房间消息流，多路尝试（num/str/modern × 双 serverId × all/owner） | channelId, serverId, nextTime, limit |
| `getRoomAlbum` | `/im/api/v1/team/msg/list/img` | 房间图片流（相册） | channelId, nextTime |
| `operateRoomVoice` | `/im/api/v1/team/voice/operate` | 房间电台（operateCode:2） | channelId, serverId |
| `getConversationPage` | `/im/api/v1/conversation/page` | 私信会话列表 | nextTime, limit |
| `getMemberDynamic` | `/im/api/v1/chatroom/msg/list/aim/type` | 成员动态（extMsgType=POST_INFO） | ownerId, roomId, nextTime |
| `getMemberWeibo` | 同上（WEI_BO） | 成员微博 | 同上 |
| `getOpenLive` | 同上（OPEN_LIVE） | 成员公演记录 | 同上 |

## 4. 直播 / 录播（live/api/v1）

| API 方法 | 官方路径 | 用途 | 关键参数/分页 |
|---|---|---|---|
| `getLiveList` | `/live/api/v1/live/getLiveList` | **直播/录播列表**：record=false 正在直播，record=true 回放；groupId 过滤团，liveType 类型，next 翻页 | groupId, liveType, next, record, debug, page |
| `getLiveOne` | `/live/api/v1/live/getLiveOne` | 单场直播详情（含播放地址、状态位 isLiving/isEnd/msgFilePath/lrcUrl） | liveId, streamProtocol |
| `getLiveResult` | `/live/api/v1/live/result` | 直播结果/战报 | liveId |
| `getLiveRank` | `/live/api/v2/live/getLiveRank` | 直播贡献榜 | type:1, liveId |
| `getLiveBarrage` | `/live/api/v1/live/barrage/list` | 直播弹幕 | liveId, time/lastTime |
| `getLiveLrc` | 由 getLiveOne 的 `content.msgFilePath/lrcUrl` 拉 LRC 文件 | **录播弹幕**（[mm:ss.fff]昵称\t内容） | liveId |
| `getOpenLivePublicList` | `/live/api/v1/live/getOpenLiveList` | 公演列表（record 控制 直播/回放） | groupId, next, record |
| `getOpenLiveOne` | `/live/api/v1/live/getOpenLiveOne` | 公演详情 | liveId, streamProtocol |
| `getOpenLiveParticipants` | live.48.cn 页面抓取 | 公演参演成员名单（memberhot 接口 + HTML 兜底） | liveId, title, dateHint |
| `getMemberPhotos` | `/idolanswer/api/idolanswer/v1/user/nft/user_nft_list` | 成员 NFT/相册图 | starId, page, size |

## 5. 私信（message/api/v1）

| API 方法 | 官方路径 | 用途 | 关键参数/分页 |
|---|---|---|---|
| `getPrivateMessageList` | `/message/api/v1/user/message/list` | 私信会话列表 | lastTime=Date.now() 起 |
| `getPrivateMessageDetail` | `/message/api/v1/user/message/info` | 与某用户的私信消息流 | targetUserId, lastTime |
| `sendPrivateMessageReply` | `/message/api/v1/user/message/reply` | 回复私信 | targetUserId, messageType:'TEXT', text |
| `getUnreadMessageCount` | `/message/api/v1/unread/message/num` | 未读数 | — |

## 6. 翻牌（idolanswer/api）

| API 方法 | 官方路径 | 用途 | 关键参数/分页 |
|---|---|---|---|
| `getFlipList` | `/idolanswer/api/idolanswer/v1/user/question/list` | 我的翻牌记录 | status:0, beginLimit, limit, memberId |
| `getFlipPrices` | `/idolanswer/api/idolanswer/v2/custom/index` | 某成员的翻牌类型/价格 | memberId |
| `getFlipCustomIndexV1` | `/idolanswer/api/idolanswer/v1/custom/index` | 翻牌配置（v1 兜底） | memberId |
| `sendFlipQuestion` | `/idolanswer/api/idolanswer/v1/user/question` | 发送翻牌提问 | payload（类型/价格/问题） |
| `operateFlipQuestion` | `/idolanswer/api/idolanswer/v1/user/question/operate` | 操作翻牌（operateType） | questionId, operateType |

## 7. 官方媒体（media/api/media/v1）—— 无需 token

| API 方法 | 官方路径 | 用途 | 关键参数/分页 |
|---|---|---|---|
| `getOfficialTalkList` | `/media/api/media/v1/talk/list` | 电台节目列表 | ctime, groupId, limit |
| `getOfficialTalk` | `/media/api/media/v1/talk` | 电台详情/音频地址 | resId |
| `getOfficialMusicList` | `/media/api/media/v1/music/list` | 官方音乐列表 | ctime, limit |
| `getOfficialMusic` | `/media/api/media/v1/music` | 单曲地址 | resId |
| `getOfficialVideoList` | `/media/api/media/v1/video/list` | 官方视频列表（typeId=分类） | ctime, typeId, groupId, limit |
| `getOfficialVideo` | `/media/api/media/v1/video` | 单视频地址 | resId |
| `getMediaCollectionTotalCount` | `/media/api/media/v1/getCollectionTotalCount` | 收藏数统计 | — |

（`officialMedia.ts` 是同一批接口的桌面端 XHR 实现，`officialSiteMusic.ts` 是官网静态 JS 全量曲库。）

## 8. 礼物 / 鸡腿（gift/api）

| API 方法 | 官方路径 | 用途 | 关键参数 |
|---|---|---|---|
| `sendGift` | `/gift/api/v1/gift/send` | 送礼 | giftId, businessId(liveId), acceptUserId, giftNum |
| `getGiftList` | `/gift/api/v1/gift/list` | 礼物列表 | businessId, giftType:1 |
| `getMeleeWeekRank` | `/gift/api/v1/melee/rank/getMeleeWeekRank` | 鸡腿乱斗周榜 | rankId, nextId |
| `getMeleeRankPage` | `/gift/api/v1/melee/rank/getMeleeRankPage` | 乱斗总榜 | rankid, nextId |
| `getMeleeYearRankPage` | `/gift/api/v1/melee/rank/getMeleeYearRankPage` | 乱斗年榜 | rankid, nextId |
| `getPersonMeleeRankPage` | `/gift/api/v1/melee/rank/getPersonMeleeRankPage` | 成员鸡腿贡献榜 | resId |

## 9. 其他

| API 方法 | 官方路径 | 用途 | 关键参数 |
|---|---|---|---|
| `getTripList` | `/trip/api/trip/v1/list` | 成员行程 | groupId, memberId/userId, lastTime, isMore |
| `getMemberPostImages` | `/posts/api/v1/posts/img/list` | 成员图片动态 | userId, nextTime |
| `getInvoiceTips` | `/invoice/api/v1/invoice/tips` | 开票提示 | — |
| `getInvoiceConfig` | `/invoice/api/v1/invoice/config` | 开票配置 | — |
| `getInvoiceOrderList` | `/invoice/api/v1/order/list` | 可开票订单 | nextTime, yearMonth, token |
| `applyElectronicInvoice` | `/invoice/api/v1/invoice/apply/electronic` | 提交电子发票申请 | buyerType/名称/税号/邮箱/orderDataId[] |
| `getMeet48LiveList/One` | meetapi-v2.meet48.xyz | Meet48 直播列表/详情 | next/record / liveId+RTMP |
| `bilibiliApi.*` | api.bilibili.com | B站登录/扫码/直播流解析 | cookie, roomId |

## 9.5 v2.7 新接口（同步自 yk1z/yaya_msg 电脑版，2026-08-16）

| API 方法 | 官方路径 | 用途 | 关键参数 |
|---|---|---|---|
| `deletePrivateMessage` | `/message/api/v1/user/message/delete/msg` | 删除单条私信 | msgId（Android 头） |
| `sendPrivateImageMessage` | `/message/api/v1/user/message/reply` | 私信发图 | messageType:IMAGE + imgUrl/宽高/尺寸 |
| `uploadPocketImage` | pfile.48.cn | 通用图片上传（私信图等） | fromType 可空 |
| `getPostImageList` | `/posts/api/v1/posts/img/list` | 主页相册 | userId, nextId, limit（Android 头） |
| `getPostVideoList` | `/posts/api/v2/posts/video/list` | 主页视频（v2） | userId, nextId, limit |
| `getPostTimelineHome` | `/posts/api/v1/posts/timeline/home` | 主页动态时间线 | userId, nextId, limit |
| `getSeinePerformanceList` | snhapi-v1.ckg48.cn `/home/api/seine/home/interaction/list` | Seine 公演列表（新数据源） | type:2, groupId, next（Seine iOS 头） |
| `getSeineServerDetail` | `/im/api/seine/server/detail` | 频道详情（serverId→房间名） | serverId（Seine 头） |
| `getLastMessageByServerId` | `/im/api/v1/team/last/message/get` | 单成员最新消息（push 服务同款） | serverId（注意：非 classic 前缀） |
| `getArea48Newest` | `/posts/api/v1/area48/data/newest/new` | 社区最新动态 | nextId（Area48 头） |
| `getArea48Recommend` | `/posts/api/v1/area48/data/recommend/new` | 社区推荐 | nextId |
| `getArea48PostDetails` | `/posts/api/v1/posts/details` | 帖子详情 | postId |
| `getArea48Comments` | `/comment/api/v1/comment/level1/getCommentList` | 评论列表 | resourceId, next, resourceType:1002 |
| `addArea48Comment` | `/comment/api/v1/comment/addComment` | 发表评论 | resourceId, commentMsg |
| `createArea48Post` | `/posts/api/v1/posts/create` | 社区发帖 | title/content/topicArray |
| `getPocketMaskWords` | `/home/api/check/maskword?clientTime=` | 发言屏蔽词 | clientTime（GET） |

> 头类型：Android 头 = `createPocketAndroidHeaders`（7.1.43）；Seine 头 = `createSeineHeaders`/`createSeineIosHeaders`（seine48 客户端）；Area48 头 = `createArea48Headers`（老版 6.0.22）。来源：yk1z/yaya_msg `src/common/pocket-runtime.mjs`（全部 100+ 通道）与 yk1z/yaya_push `push.py`。

## 10. 分页机制速查

| 接口族 | 翻页字段 | 说明 |
|---|---|---|
| 直播/录播/公演 | `next`（数字游标） | 配合 `record` 区分直播/回放；`page` 仅部分接口 |
| 房间消息/私信/相册/动态/微博 | `nextTime`（毫秒时间戳） | 首页传 0 或 Date.now()，下一页传返回的 nextTime |
| 翻牌 | `beginLimit`/`limit` | 游标分页 |
| 官方媒体/行程 | `ctime`/`lastTime` | 时间游标 |
| NFT 相册 | `page`/`size` | 页码分页 |

## 11. 已知推断 / 待验证

- `operateFlipQuestion` 的 operateType 取值（1=？）未找到公开资料，代码中默认 1。
- `getLiveList` 的 `liveType` 取值（0=全部？2=电台？）依据现有 UI「电台」标签推断。
- `getFlipPrices` v2 vs v1 返回结构差异未完全验证（v2 优先、v1 兜底）。
- `followMember` 的 `toType:1` 推断为「关注成员类型=1」。
- `checkIn` 已签到文案兜底（已签到/重复签到/已领取/明天再来）视为成功。

## 12. 参考资料

- https://github.com/duan602728596/48tools （48tools：录播/直播工具）
- https://github.com/wdwind/pocket48_api
- https://github.com/chinshin/CQBot_hzx （口袋48 机器人，含房间接口讨论）
- https://github.com/topics/snh48 （SNH48 相关开源项目集）
