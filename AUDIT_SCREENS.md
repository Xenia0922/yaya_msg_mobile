# yaya_msg_mobile 屏幕可用性审计报告

> 审计对象：`yaya_msg_mobile/src/screens` 下全部 **26 个 `.tsx` 文件**（只读，未修改任何代码）。
> 方法：read / grep / glob 逐页核对 + 6 个并行子代理精读最大页面，行号以当前工作区为准。
> 目的：为后续按易用性重写页面提供分页 / 空态 / 错误态 / 加载态改造清单。

---

## 一、页面清单（26 个）

| 文件名 | 中文用途 | 代码规模 |
|---|---|---|
| `MediaScreen.tsx` | 直播/录播播放 | 1956 行 |
| `FollowedRoomsScreen.tsx` | 关注房间 + 聊天室 | 2095 行 |
| `PrivateMessagesScreen.tsx` | 私信列表/会话 | 674 行 |
| `FlipScreen.tsx` | 翻牌（发送 + 历史） | 584 行 |
| `ProfileScreen.tsx` | 成员档案（MemberProfile） | 258 行 |
| `MusicLibraryScreen.tsx` | 音乐库 | 479 行 |
| `VideoLibraryScreen.tsx` | 视频库 | 294 行 |
| `RoomAlbumScreen.tsx` | 房间相册 | 363 行 |
| `PhotosScreen.tsx` | 个人相册 | 228 行 |
| `TripScreen.tsx` | 行程 | 330 行 |
| `AnalysisScreen.tsx` | 数据统计 | 824 行 |
| `InvoiceScreen.tsx` | 电子发票/开票 | 273 行 |
| `DownloadScreen.tsx` | 下载管理 | 322 行 |
| `MeleeRankScreen.tsx` | 鸡腿/乱斗排行榜 | 345 行 |
| `OpenLiveScreen.tsx` | 公演记录 | 386 行 |
| `BilibiliLiveScreen.tsx` | B站直播 | 369 行 |
| `LoginScreen.tsx` | 账号设定/登录 | 619 行 |
| `SettingsScreen.tsx` | 设置 | 321 行 |
| `HomeScreen.tsx` | 首页/仪表盘 | 546 行 |
| `MessagesScreen.tsx` | 消息检索 | 217 行 |
| `FetchScreen.tsx` | 抓取消息 | 179 行 |
| `DatabaseScreen.tsx` | 数据库/资料 | 151 行 |
| `RoomRadioScreen.tsx` | 房间电台/上麦音频 | 137 行 |
| `MemberDynamicScreen.tsx` | 成员动态 | 186 行 |
| `MemberWeiboScreen.tsx` | 成员微博 | 197 行 |
| `RechargeScreen.tsx` | 鸡腿充值 | 146 行 |

导航层级依据 `src/navigation/index.tsx`（L176-179 Tab：主页/直播/房间/设置；L240-263 Stack 挂载其余各页）。

---

## 二、重点页面逐页审计

### 1. MediaScreen（直播/录播播放）
- **功能**：直播/回放双 tab 列表 + 全屏播放器；弹幕、送礼、贡献榜、公告、续播；过滤/搜索。
- **API 方法与行号**：`getLiveList`(L857, 唯一分页源)、`getLiveOne`(L804/964/1020)、`getOpenLiveOne`(L805/965/1029/1037)、`getLiveBarrage`(L574, 5s interval L591)、`getLiveLrc`(L597)、`getGiftList`(L1074)、`getUserMoney`(L1075/1107)、`getLiveRank`(L1124)、`getUserProfile`(L1132)、`sendGift`(L1100)。
- **易用性短板**：
  - 🔴 列表加载失败仅黄色错误横幅文字(L1493, 样式 `styles.error` L1718)，**无内联「重试」按钮**；失败时 `setHasMore(false)`(L868) 使 `onEndReached`(L1666) 被 `!hasMore`(L990) 挡掉，唯一恢复路径是右上角刷新图标(L1403)，缺乏引导。
  - 🔴 **无下拉刷新**：`PerfFlatList` 未传 `refreshControl`/`RefreshControl`。
  - 🔴 **播放器无缓冲反馈**：未监听 `onBuffering`/`onLoadStart`，缓冲中黑屏；WebView 播放器(L1217-1238)无 onError 处理，原生 `Video` onError(L1256) 设置的 `playerError` 也不覆盖 WebView 分支。
  - 🔴 分页边界：`nextToken===0` 时即使仍有数据也会判 `hasMore=false`(L863) 提前截断。
  - 🟡 筛选/搜索/切 tab 无独立 loading 遮罩；过滤自动翻页期间仅 footer「加载更多…」提示(L1671)，不易感知。
  - 🟡 礼物列表空(L1080)、贡献榜空(L1139/1141) 仅文字无图标；回放空数据无「下拉刷新/点右上角刷新」引导。
  - 🟡 全屏/横竖屏切换(L1279-1293)、沉浸控制条自动隐藏(L658-681) 存在但首次进入无「点击唤出控制栏」提示。
  - 🟡 送礼 `giftNum` 输入框(L1340) 无上限校验，`giftCost*giftNum`(L770) 超大会直接显示巨额数字。

### 2. FollowedRoomsScreen（关注房间 + 聊天室）
- **功能**：关注房间 2 列卡片、搜索；聊天室（大/小房间 segmented、粉丝/成员过滤、房间内搜索）；内嵌直播播放；关注/取关三入口。
- **API 方法与行号**：`getLiveOne`(L489)、`getOpenLiveOne`(L490)、`getLiveList`(L491/496)、`getOpenLivePublicList`(L493)、`unfollowMember`(L969)、`followMember`(L970)、`getFollowedIds`(L1002)、`getLastMessages`(L1010)、`getNimLoginInfo`(L1041)、`getRoomMessages`(L1045/1072)、`getLiveRank`(L1156)。
- **易用性短板**：
  - 🔴 **聊天室空消息完全无占位**：ListFooter 仅在 `roomMessages.length` 非空时渲染(L1420)，无消息时一片空白。
  - 🔴 列表加载失败仅 `showToast`(L1017)、聊天加载失败仅 toast + 置空(L1057-1059)，**均无内联错误视图/重试**，只能靠右上角刷新(L1616)。
  - 🔴 **聊天室完全不支持发送消息**：无 TextInput/发送按钮/send API，只能阅读历史（最大功能缺口）。
  - 🔴 **无新消息实时刷新**：全程无定时器/WebSocket，不自动滚动到底、无未读提醒，属「只读历史浏览」。
  - 🔴 关注空态只有「暂无关注房间」(L1795)，**无「去搜索关注成员」引导**（虽搜索态可达，但空态无提示）。
  - 🟡 取关无二次确认(L1761-1777 小心形) 易误触。
  - ✅ 优点：分页 `onEndReached={loadMoreRoomMessages}`(L1417)＋threshold 0.25、多重守卫(L1066-1069)＋ref 防闭包过期、`mergeMessages` 用 messageKey 去重(L330-340)、终止条件合理(L1086)；关注乐观更新+失败回滚(L966/982)＋busy 防连点做得好。

### 3. PrivateMessagesScreen（私信）
- **功能**：会话列表（未读 badge、分组 header、一键刷新）、消息详情（语音/视频/图片/翻牌卡片解析）、发送私信与翻牌。
- **API 方法与行号**：`getFlipPrices`(L350)、`getUserMoney`(L350)、`getPrivateMessageList`(L367)、`getNimLoginInfo`(L386)、`getPrivateMessageDetail`(L390/405)、`sendFlipQuestion`(L430)、`sendPrivateMessageReply`(L439)。
- **易用性短板**：
  - 🔴 会话列表一次最多拉 60 轮(`loadConvs` while 循环 L366) 全量加载，未虚拟化、压力大。
  - 🔴 会话列表加载无 loading 指示；消息/会话/发送失败仅 `showToast`(L377/397/418/444) 无重试按钮；断网重连不自动刷新。
  - ✅ 优点：消息分页 onEndReached(L462-463)＋`nextCursor` 无前进即终止(L417)、去重 msgId；空态齐全「暂无消息」(L500)/「暂无私信」(L612)；翻牌价格与余额联动合理。

### 4. FlipScreen（翻牌）
- **功能**：双 mode —— 发送（选成员/回复形式/公开设置/鸡腿数，完整表单校验）与历史查看。
- **API 方法与行号**：`getFlipList`(L203, 偏移 `(page-1)*100`)、`getUserMoney`(L229)、`getFlipPrices`(L253)、`sendFlipQuestion`(L290)。
- **易用性短板**：
  - 🟡 历史页错误/状态仅顶部文字(L213) **无重试按钮**；发送成功仅文字提示(L298) 无跳转/高亮。
  - ✅ 优点：表单逐项校验清晰(L265-285)、底价/未开放提示到位(L278/355)、历史分页 onEndReached(L520)。

### 5. ProfileScreen（成员档案）
- **功能**：成员 pick、基础/生涯/技术参数栅格、公式照横向卷、粉丝排行。
- **API 方法与行号**：`getStarArchives`(L68)、`getStarHistory`(L69)（Promise.all + 各自 catch 容错）。
- **易用性短板**：
  - 🔴 在线档案失败进 `archive.error` 仅黄色提示条(L114-119) **无重试**，需重选成员才重载；历史拉取失败静默。
  - ✅ 空态(L175-176)「暂无数据/搜索成员查看档案」、加载 CenterSpinner(L210)、本地数据兜底提示清晰。

### 6. MusicLibraryScreen（音乐库）
- **功能**：官方曲库（单次全量）、搜索/分团/收藏 tab、常驻播放器 + 续播 seek、播放队列。
- **API 方法与行号**：`loadOfficialSiteMusic`(L89, 一次全量)、`officialMediaApi.getMusic`(L112, 音频地址回退 resolver)。
- **易用性短板**：
  - 🔴 错误 overlay `pointerEvents="none"`(L214) **不可点击重试**，唯一恢复是头部刷新图标(L159)。
  - 🟡 单次全量无分页，曲库大时首屏/内存压力。
  - ✅ loadingRef 锁(L70/84) 防并发；空态「暂无音乐」(L222-225) 有。

### 7. VideoLibraryScreen（视频库）
- **功能**：官方视频列表（ctime 游标分页）、首条 banner、点击进全屏播放。
- **API 方法与行号**：`officialMediaApi.getVideoList`(L89)、`officialMediaApi.getVideo`(L119)。
- **易用性短板**：
  - 🔴 **无 `ListEmptyComponent`（空态缺失）**，data 空时网格空白。
  - 🔴 **无加载 spinner**，仅状态文字(L146) 且加载中 status 被置空(L87)。
  - 🟡 错误仅 `setStatus`(L96-97) 无重试按钮；首条 item 被 `slice(1)`(L149) 丢弃。
  - ✅ 分页 onEndReached(L158) + loadingRef(L79/82) + hasMore(L93) 防重良好。

### 8. RoomAlbumScreen（房间相册）
- **功能**：大/小房间切换、图片 ZoomImageModal 预览、视频内嵌播放、长按下载。
- **API 方法与行号**：`pocketApi.getRoomAlbum`(L164, channelId + nextTime 分页)。
- **易用性短板**：
  - 🔴 视频 `onError` 静默 `setPlaying(null)`(L231) 无提示；无加载 spinner（仅 status 文案 L264, 加载中留空 L278）。
  - 🟡 错误仅 `setStatus`+toast(L178)，靠头部刷新(L239)。
  - ✅ 分页防死循环(L171 游标无前进即终止)+ `uniqueMerge` 去重(L114-124)、空态(L278)、channelId 明示(L261-263)、模式切换即时(L191) 做得完善。

### 9. PhotosScreen（个人相册）
- **功能**：选成员 + Profile 资料图合并去重、双列网格、点击放大、长按下载。
- **API 方法与行号**：`pocketApi.getMemberPhotos`(L110)、`pocketApi.getStarArchives`(L111)。
- **易用性短板**：
  - 🔴 **`loadPhotos`(L104) 无 `runId`/`loadingRef` 防竞态**：快速切成员时旧请求晚返回覆盖新数据（最可能产生错误数据）。
  - 🔴 **无分页 / 无 onEndReached**：单次全量拉取，量大时漏数据 + 卡顿。
  - 🔴 **无刷新/重试入口**：只能重新选成员触发 `loadPhotos`。
  - 🟡 无加载 spinner；长按下载无操作提示文案。
  - ✅ 空态「暂无图片」(L206)。

### 10. TripScreen（行程）
- **功能**：按成员展示行程时间轴（今天/过去/未来）、票务链接跳转、成员选择、下拉刷新。
- **API 方法与行号**：`pocketApi.getTripList`(L102, {memberId,lastTime,isMore})。
- **易用性短板**：
  - 🔴 错误仅 `setError`(L114-115)，只显示在空列表一行文字(L251)，**无失败重试按钮**；某中间页失败则分页中断且无提示。
  - ✅ 分页最规范：onEndReached(L239)+ `lastTime` 游标(L94/110-113) + 游标前进才继续防死循环(L112)；空态/引导(L247-254) 清晰。

### 11. AnalysisScreen（数据统计）
- **功能**：5 个 Tab（房间概览/日期/发言排行/媒体/翻牌），汇总卡 + 排行条形图 + 翻牌统计。
- **API 方法与行号**：`pocketApi.getRoomMessages`(L264, 循环最多 20 页×100)、`pocketApi.getFlipList`(L304, 循环最多 24 页)。
- **易用性短板**：
  - 🔴 房间失败有 `setStatus`+`showToast`(L290-291)，翻牌失败仅 `setStatus` 无 toast(L315-316) 且未清空 flips；翻牌循环内 `.catch(()=>null)`(L304) 静默吞错。
  - 🔴 空/错误统一走 `status`(L135)，**无失败重试按钮**，仅顶部刷新(L337)。
  - 🟡 未选成员时「刷新」因 `disabled=!member`(L337) 点击无反馈。
  - ✅ 加载 CenterSpinner(L344-345)、日期 Tab 空态(L425)、翻牌防死循环(L309 next<=begin) 较稳。

### 12. InvoiceScreen（电子发票）
- **功能**：多选可开票订单 → 填开票信息（个人/企业抬头、税号、邮箱）→ 提交申请后刷新。
- **API 方法与行号**：`pocketApi.getInvoiceOrderList`(L59)、`pocketApi.applyElectronicInvoice`(L88)。
- **易用性短板**：
  - 🔴 **订单用 ScrollView 一次性 map 渲染(L147/152)**，无分页/虚拟化，订单量大时卡顿。
  - 🔴 拉单失败仅红字(L151) **无重试按钮**（需点右上角刷新 L143-144）。
  - 🟡 企业必填项（税号等）无逐项校验；提交失败用 Alert(L95)。
  - ✅ 空态「暂无订单」(L153-155)、加载 ActivityIndicator(L156)、提交中禁用(L220-222)、未选订单 Alert(L83)、已开票/申请中置灰(L100/111-115) 引导清晰。

### 13. DownloadScreen（下载管理）
- **功能**：手动粘贴 URL 添加下载（按扩展名判型）、任务按 下载中/已完成/失败 分组、打开/删除/清理、图片预览。
- **API**：无 pocketApi 调用，用本地 `services/downloads`（enqueueDownload/deleteDownloadItem/clearFinishedDownloads/loadDownloadItems/openDownloadItem，import L25-32）。
- **易用性短板**：
  - 🔴 **失败项无单独「重试」按钮**，只能删除重下；删除/清理失败在 catch 静默忽略(L122/137)。
  - 🔴 「清理完成」按钮禁用条件仅看 `doneCount`(L172)，只有失败项（无完成项）时按钮禁用无法一键清失败。
  - ✅ 空态(L220)、删除/清理二次确认 Alert(L116-127/L131-142)、失败任务 danger 色+error 文案(L244-247) 较好。

### 14. MeleeRankScreen（鸡腿/乱斗榜）
- **功能**：周/总/年榜 + 成员贡献榜；周榜可切周次芯片。
- **API 方法与行号**：`pocketApi.getMeleeYearRankPage`(L67)、`getMeleeRankPage`(L68/72)、`getMeleeWeekRank`(L71)、`getPersonMeleeRankPage`(L103)。
- **易用性短板**：
  - 🔴 **无 onEndReached 分页**：榜单一次性返回渲染，大榜单卡顿（长榜仅靠 initialNumToRender 优化）。
  - ✅ 顶部红字 +「重试」按钮(L189-196, retry L192 分支正确)；错误置 error 并清 ranks(L86-88)；空态区分「请选择成员查看贡献榜/暂无排名数据」(L211-215/L232-235)；首屏 CenterSpinner(L201/222) + 翻页 ActivityIndicator(L237)。

### 15. OpenLiveScreen（公演记录）
- **功能**：按成员拉取公演列表 + 关键字筛选、播放（flv/rtmp native）、下载、横竖屏切换。
- **API 方法与行号**：`pocketApi.getOpenLive`(L214)、`pocketApi.getOpenLiveOne`(L240)。
- **易用性短板**：
  - 🔴 **播放器 Video `onError` 静默 `setPlaying(null)`(L285)**，无错误提示/无重试（四页里最需补的点）。
  - 🔴 未选成员时也显示「暂无公演记录」(L331) 有误导，建议拆文案（status 初值 L175 同为「暂无公演记录」）。
  - 🟡 列表失败 `setStatus`+toast(L224-227) 仅头部刷新(L296-297) 无重试；播放解析失败仅 toast(L256-260)。
  - ✅ 分页 onEndReached(L322) + hasMore/nextTime(L172-173)、首载 ActivityIndicator(L326-328)、播放加载文案(L247)。

### 16. BilibiliLiveScreen（B站直播）
- **功能**：直播间列表 + 开播状态点、自动横屏全屏、多线路候选切换（自动/手动「下一线路」/更多面板）、原生/WebView 切换、刷新。
- **API 方法与行号**：`externalApi.fetchBilibiliConfig`(L98)、`bilibiliApi.getRoomInit`(L147)、`bilibiliApi.resolveLive`(L167)、`bilibiliApi.headers`(L216)。
- **易用性短板**：
  - 🔴 **`streamCandidates` 空且无 streamUrl 时静默卡在「正在获取直播流」**(L168)，list=[{url:undefined}] 不进播放器也不报错，需补空校验。
  - 🟡 线路自动失败 `setPlayerError`(L185/188) 有「网页播放器/下一线路」重试钮(L235-241) ✅，但「下一线路」仅在还有候选时渲染(L238)；`resolveLive` 失败仅 `setStatus`(L175-176) 无重试；`fetchBilibiliConfig` 失败仅状态文字(L101-102)。
  - ✅ 首屏转圈(L330-332)、刷新 header 小 spinner(L297-299)、空态「暂无直播间」(L335)。

### 17. LoginScreen（账号设定）
- **功能**：口袋48 验证码登录、Token 登录/检查、大小号账号列表与切换、B站扫码登录、昵称/头像编辑、跳官方充值。
- **API 方法与行号**：
  - `pocketApi.loginSendSms`(L158)、`loginByCode`(L190)、`loginCheckToken`(L223)、`switchBigSmall`(L257)、`getNimLoginInfo`(L335)、`getUserRenameCount`(L339)、`editUserInfo`(L366/407)、`uploadUserAvatar`(L400)。
  - `bilibiliApi.pollQrCode`(L279)、`checkLoginStatus`(L286)、`generateQrCode`(L313)。
- **易用性短板**：
  - 🔴 **B站二维码过期/86038**(L296) 无「刷新二维码」按钮，需重新点「获取二维码」。
  - 🟡 所有表单用 `setStatus` 反馈（无 Alert），无重试按钮，仅「刷新账号列表」(L497)；loading 仅禁按钮（btnDisabled L458-559）无独立 spinner。
  - 🟡 账号列表可能较大时整列表重渲染(L500) + B站轮询 30×2s(L274-305) 占循环（已用 pollingRef 卸载中止 L119/276-277）。
  - ✅ **关于「140 余成员 switchBigSmall」不成立**：本页渲染的是 `accountInfo.users`（大小号去重 L94-108），单次点击只调一次 `switchBigSmall`(L257)，不会逐个切 140 成员；token 掩码 L489/maskToken(L42-47) 防泄漏良好。

### 18. SettingsScreen（设置）
- **功能**：版本/致谢/Repo、进账号管理、主题/背景图、语言、自动签到、下载管理/日志、成员数据统计。
- **API**：无 pocketApi/bilibiliApi 调用，纯本地 store（`getMemberDataMeta`(L96)、`saveSettings`(L112-121)、`ImagePicker`(L127)）。
- **易用性短板**：
  - 🟡 版本 chip 点击仅在「有更新」时有意义(L151-161)，未更新时点了无反应。
  - ✅ 设置项文字标识清晰；update 失败 showToast/Alert(L118-134)；无分页/加载需求。

### 19. HomeScreen（首页/仪表盘）
- **功能**：问候 + 直播 banner 轮播 + 直播网格 + 快捷入口 + 工具手风琴 + 续播卡 + 未登录引导卡。
- **API 方法与行号**：`pocketApi.getLiveList`(L152, {groupId:0,liveType:0,next:0,record:false})。
- **易用性短板**：
  - 🔴 **直播区块仅在 `livesOk=true` 才渲染**(L252)，而 `livesOk` 仅在 `list.length>0` 时置 true(L156)——**直播为空或拉取失败时整块「正在直播」连标题一起消失，无空态/错误占位**。
  - 🔴 `getLiveList` `.catch(()=>{})`(L160) **完全静默**，失败对用户不可见。
  - ✅ 未登录引导卡(L232-249) 有明确「点此粘贴 token」操作引导。

### 20. MessagesScreen（消息检索）
- **功能**：选成员 → 拉取房间消息 → 本地搜索过滤。
- **API 方法与行号**：`pocketApi.getRoomMessages`(L54, fetchAll:true 全量)。
- **易用性短板**：
  - 🔴 **主列表 `PerfFlatList`(L172-180) 完全无 `ListEmptyComponent`**：失败(`setMessages([])` L63) 或空结果时列表区域空白，无「暂无消息」也无重试。
  - 🔴 拉取期间 `setLoading(true)`(L52) 但**界面无任何加载指示**。
  - 🔴 错误态仅 L63 `showToast` 无 retry；无分页（fetchAll 全量一次性渲染）。
  - 🟡 成员弹窗空态「成员列表为空」(L166)。

### 21. FetchScreen（抓取消息）
- **功能**：选成员 + 模式（全部/成员消息、大/小房间）→抓取展示；大房间空自动回退小房间(L85-89)。
- **API 方法与行号**：`pocketApi.getRoomMessages`(L65)。
- **易用性短板**：
  - 🔴 错误态仅状态文案(L98) 无重试按钮（需再点「开始抓取」）。
  - 🔴 成员消息模式 `fetchOnce`(`fetchAll=false`) 只取一页即停，**无分页循环，会漏历史消息**。
  - 🟡 主列表无 loading spinner，靠按钮文字/禁用(L132-133)；未选成员提示(L76)。

### 22. DatabaseScreen（数据库）
- **功能**：本地 members.json + 远端同步成员库 + 内嵌 gnz.hk/database WebView。
- **API 方法与行号**：`pocketApi.getGroupTeamStar`(L45)。
- **易用性短板**：
  - 🔴 **本地库同步的 catch(L56-58) 完全静默**（仅 `!alive` 判断），同步失败无任何用户提示。
  - 🔴 同步过程无 loading 指示，仅最终 memberCount 数字；WebView 错误态(L94-98) 无重试——「刷新」`reloadWebView`(L28-31) 仅重载 WebView，不影响已失败的数据同步。

### 23. RoomRadioScreen（房间电台）
- **功能**：选成员 → 取流 URL → Video 播放，大/小房间切换与静音。
- **API 方法与行号**：`pocketApi.operateRoomVoice`(L39)。
- **易用性短板**：
  - 🔴 **loading 时状态文本被清**(L78 `loading ? '' : status`)，**无「正在缓冲」文案/音频活动指示**，用户难判断是否在播。
  - 🔴 播放失败态(L103) 仅 setStatus **无重试**；大房间失败不自动尝试小房间。
  - 🔴 **无初始引导**：未选成员时显示「暂无数据」(L77)、控件区全空，未提示「选择成员获取上麦音频」。

### 24. MemberDynamicScreen（成员动态）
- **功能**：选成员 → 动态流（图文/九宫格/图放大）。
- **API 方法与行号**：`pocketApi.getMemberDynamic`(L82)。
- **易用性短板**：
  - 🟡 错误提示(L158) 复用空态文本，无重试按钮（仅靠页头刷新 L132）；追加加载无独立指示。
  - ✅ **分页最规范**：使用共享 `usePaginator` hook(L95)（loadingRef 同步锁 + runId 丢弃过期响应, 注释 L76-77），onEndReached(L146)、footer「上滑继续加载/没有更多了」(L150-152)；引导「请搜索选择成员查看动态」(L158) 清晰。

### 25. MemberWeiboScreen（成员微博）
- **功能**：选成员 → 微博流（图文/九宫格/图放大/跳原文 Linking）。
- **API 方法与行号**：`pocketApi.getMemberWeibo`(L88)。
- **易用性短板**：
  - 🔴 **手写分页(无法复用 `usePaginator`)**(L83-100)：nextTime(L79)、hasMore(L80)、onEndReached(L154 内联判 hasMore&&!loadingMore)，**无同步重入锁**，比 Dynamic 页更易连发重复请求；与 Dynamic 的共享 hook 存在重复/不一致。
  - 🟡 错误 L98 设 error 后仅空态显示 error 文本（复用空态区域），无重试按钮。
  - ✅ 引导「请搜索选择成员查看微博」(L166)、footer(L158-159) 清晰。

### 26. RechargeScreen（鸡腿充值）
- **功能**：显示鸡腿余额 + WebView 加载官方充值页 live.48.cn/Recharge。
- **API 方法与行号**：`pocketApi.getUserMoney`(L34)。
- **易用性短板**：
  - 🔴 余额刷新 `refreshBalance`(L29-43) 与 WebView `onError`(L101) **共用 status**，错误难区分是哪一步失败；WebView 失败无法重试（只能刷余额，不能重载 WebView）。
  - 🟡 页头刷新(L48) + 底部刷新按钮(L79) 双入口冗余。
  - ✅ 余额 ActivityIndicator(L72)、WebView renderLoading「正在打开官方充值页…」(L95-100) 尚可。

---

## 三、三个系统性结论（重写优先级）

### 1. 错误态系统性缺失「重试按钮」（最普遍）
绝大多数页面捕获错误后仅 `showToast` / `status` 文字反馈，出错后只能靠手动再触发（头部刷新/重选成员），**无统一的内联错误视图 + retry callback**。
- 受影响：MediaScreen(仅横幅,无重试,失败即 hasMore=false)、FollowedRooms(L1017/1057仅toast)、Profile(getStarArchives L114-119 仅提示条)、MusicLibrary(pointerEvents:"none" L214 不可点)、VideoLibrary、AudioPrograms、RoomAlbum、Photos、Trip(L114-115)、Analysis(L290/315)、Invoice(L151)、Messages(L63)、RoomRadio(L103)、Database(同步 catch L56-58 完全静默)、MemberWeibo(L98)、Download(删除/清理失败静默 L122/137)、Fetch(L98)、Recharge(L101)。
- 少数自带重试按钮的正面样例：MeleeRank(L189-196)、Bilibili 多线路(L235-241)、OpenLive 播放态（未补）。
- 建议：抽统一 `ErrorState`/`RetryButton` 组件，失败时保留分页游标（勿 `setHasMore(false)` 阻断 onEndReached 恢复）。

### 2. 分页实现不统一，部分页面无分页
- **健壮（建议复用）**：MemberDynamic 共享 `usePaginator`(同步锁 + runId)；Trip(lastTime 游标 + 防死循环)；RoomAlbum(nextTime + 游标无前进终止 + uniqueMerge)；PrivateMessages(Message onclicked nextCursor 无前进终止)。
- **手写且防重入较弱**：MemberWeiboScreen(L83-100 无同步锁)、PhotosScreen(loadPhotos L104 无 runId，**并发竞态**)。
- **完全无分页 / 一次性渲染**：MeleeRank(榜单一次渲染)、Photos(全量)、Messages(fetchAll)、Analysis(循环 20/24 页拉满)、Invoice(ScrollView 全量)、Database(WebView)、Home 直播(仅 8 条)。
- 建议：全部列表页统一抽 `usePaginator`(游标 + loadingRef 同步锁 + runId 丢弃过期响应 + hasMore 终止 + onEndReached)。

### 3. 空态 / 加载态缺失集中
- **无空态 ListEmptyComponent**：VideoLibrary、AudioPrograms、FollowedRooms 聊天区(仅非空才渲染 L1420)、Home 直播区块(et livesOk=false 连标题消失 L252)、Messages 主列表(L172-180)。
- **无加载 spinner（仅 status 文字且加载中置空）**：VideoLibrary(L87)、AudioPrograms(L84)、RoomAlbum(L162/L278)、Photos(L107/L148)、Messages(loading 无指示)、RoomRadio(loading 置空显示「暂无数据」L78)。
- **无操作引导**：RoomRadio 初始状态、Messages 主列表区域、Home 直播空/失败无占位。
- 建议：统一 `EmptyState`/`LoadingState` 组件 + 明确「下拉刷新/下滑加载更多/去搜索关注」等引导文案。

---

*本报告基于全部 26 个 `.tsx` 文件的实际只读审计 + 6 个子代理并行精读，行号以当前工作区为准，可直接作为重写清单。*
