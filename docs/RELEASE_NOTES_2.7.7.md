# v2.7.7 发布说明（公开发行版）

- 日期：2026-11-03
- 批次提交：`2027fdf`（本文档随后单独提交）
- 版本号：2.7.7 / versionCode 3000010

---

## 一、账号

### 1. 短信验证码登录与注册

**现象**：此前只能粘贴 Token 登录，换号必须先用官方客户端取 Token；没有口袋账号的用户无法进入。

**改动**：

- 新增「验证码」登录：手机号 + 区号 + 短信验证码。
- 登录返回「未注册」时不再报错终止，转入注册流程：设置密码（至少 6 位，两次一致）→ 同意协议 → 注册并登录。注册失败保留验证码，可直接重试。
- 密码按口袋客户端协议 AES-ECB 加密后提交；明文密码不写入设置、不进运行日志。
- 区号独立输入（默认 86）；取码与登录必须使用同一手机号 + 区号，改动后旧验证码作废并提示重新获取。

**涉及文件**：`src/screens/LoginScreen.tsx`、`src/api/pocket48.ts`、`src/utils/pocketRegistration.ts`、`scripts/pocket-registration.test.mjs`

### 2. 密码登录与安全验证

- 登录方式改为分段控件：验证码 / 密码 / Token / B站二维码。
- 密码登录走 `login/app/mobile`，与验证码登录共用设备头。
- 安全验证（滑块/问答）答错或过期时给出可操作提示，可重新取码。

### 3. 账号装饰

- 账号设置新增头像框 / 队标 / 勋章选择，选项取自官方接口，仅作用于当前登录账号。
- 头像框提交走 `user/modify/picture/frame`。
- 队标渲染修正：此前只有成员身份才画队标，普通账号选了队标也永远看不到；现在消息里带了
  `ext.user.teamLogo` 就渲染，没带才回落到「成员空 / 粉丝等级胶囊」。

**涉及文件**：`src/components/IdentityDecorations.tsx`、`src/api/pocket48.ts`

---

## 二、房间

### 4. 表情包与贴纸面板

**现象**：房间只能手打官方表情文本，不知道有哪些表情可用。

**改动**：

- 输入条新增表情入口：emoji 与官方表情包分组展示，支持搜索；VIP 组按账号权限置灰并给出说明。
- 发送走圈组自定义消息，服务端保留最终权限判断；发送中禁用面板避免重复提交。

**涉及文件**：`src/components/RoomStickerPanel.tsx`、`src/services/pocketNim/qchat.ts`、`src/api/pocket48.ts`（`getRoomExpressionList`）

### 5. 翻牌提问卡

**现象**：房间里的翻牌消息只显示一行提示，看不到问题，也不知道提问者是谁。

**改动**：

- 翻牌消息渲染为提问卡：问题正文 + 提问者（公开 / 匿名 / 仅本人可见三态），点心头像打开资料卡。
- 详情按 questionId+answerId 缓存，3 路并发限流，快速滚动不重复请求。

**涉及文件**：`src/components/RoomFlipQuestion.tsx`、`src/utils/roomFlip.ts`、`src/services/roomFlipUser.ts`、`scripts/room-flip-user.test.mjs`

---

## 三、直播

### 6. 弹幕浮层重写

- 弹幕头像缺失时按 `userId` 异步补全，失败回退占位头像；榜前三头像同源。
- 支持过滤进场消息、字号与透明度即时生效。
- 切换直播 / 断流重连时清空上一场弹幕与礼物特效（`streamRevision`），不再串台。

**涉及文件**：`src/player/chrome/PlayerChrome.tsx`、`src/services/liveAvatarCache.ts`、`src/hooks/useLiveBarrage.ts`、`src/screens/MediaScreen.tsx`

---

## 四、小窗

### 7. 切小窗时播放器 UI 残留

**现象**：从播放器切到系统小窗，控制条、弹幕层还会闪一下，个别机型直接永久留在小窗上。

**根因**：隐藏 UI 依赖 JS 收到小窗事件后再 setState，转场期间来不及；部分机型的「小窗」是自由窗口而不是标准画中画，事件根本不会来。

**改动**：

- 新增原生 `PipOverlayController`：按窗口尺寸（当前宽 < 最大宽 70% 且高 < 最大高 80%）判定小窗，直接按 `nativeID=yaya.pip.overlay` 隐藏/恢复对应 View，不等 JS 渲染。
- `MainActivity` 监听布局变化，状态切换时通知 JS；小窗内新挂载的浮层会被再次隐藏。

**涉及文件**：`android/app/src/main/java/com/yk1z/yayamsg/PipOverlayController.java`、`MainActivity.kt`、`PipModule.java`、`src/components/MiniPlayer.tsx`

---

## 五、稳定性

### 8. 成员库被旧数据覆盖

**现象**：自建镜像返回 200 但内容是旧的，本地缓存被旧数据整体覆盖，房间映射（channelId / yklzId / serverId）大量丢失。

**根因**：拉取只看 HTTP 成败，不比版本时间；官方目录里的新成员也从未并入。

**改动**：

- 镜像 `updatedAt` 缺失或早于本地缓存 → 视为该源失败，继续下一个源，不再落盘。
- 官方目录补 48 系新成员（只补缺，不覆盖已有映射）。
- 房间映射带 `verifiedAt` 时优先采用，避免被上游空字段冲掉。
- 启动更新加代次保护，缓存展示与后台刷新并发时不回退旧数据。

**涉及文件**：`src/services/memberData.ts`、`src/utils/members.ts`、`src/services/roomMapCache.ts`、`scripts/member-data-update.test.mjs`、`scripts/official-members.test.mjs`、`scripts/room-map-refresh.test.mjs`

### 9. 私信红点

- 未读接口返回缺字段/非数字时不再把红点清零，只有明确的 0 才清零。
- 换账号立即清零旧账号红点；30s 轮询仅在应用前台执行，回前台补拉。

**涉及文件**：`src/utils/privateUnread.ts`、`src/screens/HomeScreen.tsx`、`scripts/private-unread.test.mjs`

### 10. 底栏隐藏互相影响

**现象**：在媒体页隐藏底栏后切回房间页，底栏也一起消失。

**根因**：全局单一布尔，两个页面互相覆盖。

**改动**：按页面分别记录（Media / Rooms），路由切换时各自判定。

**涉及文件**：`src/navigation/tabBarVisibility.ts`、`src/store/index.ts`、`src/navigation/index.tsx`、`scripts/dock-visibility.test.mjs`

### 11. 分段控件位置回弹

- 点击、拖动、松手共用同一位置引用，父级状态更新前不再跳回旧索引。
- 父级回调迟到时用回滚定时器兜底，卸载时清理。

**涉及文件**：`src/components/GlassSegmented.tsx`

### 12. 公演成员榜

- 公演页新增成员榜，数据取 `live/api/v1/live/getOpenLiveMemberRank`，接口失败不影响播放。

**涉及文件**：`src/screens/OpenLiveScreen.tsx`、`src/api/pocket48.ts`

---

### 13. 房间消息不自动更新

**现象**：进入房间后，别人发的消息不会自己冒出来，要切页面回来才刷出来。预期是群聊那样一直往下更新。

**根因（四条叠加）**：

1. 兜底轮询是固定 60s（此前为省电从 15s 提到 60s）。QChat 长连接一旦静默，页面最多 60s 才更新一次。
2. 进房时的 `joinChannel` 与 QChat 登录并发发起。冷启动时订阅常早于登录完成 → 被服务端丢弃，且没有任何重试/补订逻辑。
3. 判新用时间戳 `>` 比较，而 HTTP 历史消息的 `msgTime` 只到秒 —— 同一秒内到达的第二条消息永远判成「没有新消息」。
4. 切后台回来、订阅被回收后都不补订，只能等下一个轮询周期。

**改动**：

- **停在房间页时每 2s 拉一次最新消息**（只取最新 20 条），列表持续更新，不需要手动下拉或切页面。
- QChat 推送保留为实时主通道：到达即先上屏；60s 没收到本频道推送就自动补订一次频道。
- 切回房间页、回前台立即补拉一次，不等下一个 tick。
- 判新改为按消息 key 去重（时间戳只作辅助），同秒消息不再丢；没有新消息时不触发重渲染。
- 前 3 次推送写运行日志（`room.live`），导出日志即可确认长连接到底通没通。

**涉及文件**：`src/services/roomLivePolicy.ts`、`src/screens/FollowedRoomsScreen.tsx`、`src/api/pocket48.ts`、`scripts/room-live-policy.test.mjs`

### 14. 下载完成却被判失败

**现象**：文件其实已经下载完，列表却显示「失败」；旧安装包/开发包更常见。

**根因**：下载完成后无条件调用原生 `PublicDownloads.saveToDownloads` 导出到系统下载目录。原生模块缺失（旧 APK）或写入失败时异常冒泡，把已完成的下载判成 failed。

**改动**：导出改为非致命 —— 失败只记 `exportError`，`status` 仍为 done，文件继续保留在应用目录；`deletePublicCopy` 与相册保存路径不变。

**涉及文件**：`src/services/downloads.ts`、`scripts/downloads.test.mjs`

## 六、工程

### 15. 构建渠道写入包内

**现象**：渠道此前是 `src/constants/channel.ts` 里的字面量，靠人工改；CI 直接跑 gradle，漏改就会出「渠道不对」的包，而包体外观完全一样，装到手机上才发现功能不对。

**改动**：

- 新增 `scripts/write-build-channel.js`：构建前写 `src/constants/buildChannel.ts`（渠道 + 出包标识 `渠道-MMDD-HHMM`）。
- `scripts/build-apk.js` 与 `.github/workflows/android-apk.yml` 共用同一份逻辑；CI 与本地出包按仓库/分支判定渠道，`YAYA_FLAVOR` 可覆盖。
- 默认文件恒为 public，避免仓库里长期留着非发行渠道的值被继承。

**涉及文件**：`scripts/write-build-channel.js`、`scripts/build-apk.js`、`.github/workflows/android-apk.yml`、`src/constants/channel.ts`、`src/constants/buildChannel.ts`

### 16. 日志导出带包身份

- 导出头部与会话首行统一为 `牙牙消息 v2.7.7 · public-1104-1100 · Android 16`。
- 远程排障先看这一行，能立刻区分渠道与出包时间，不必再靠用户描述。

**涉及文件**：`src/utils/runtimeLog.ts`、`scripts/runtime-log.test.mjs`

### 17. 私信图片不显示

**现象**：对方发来的图片私信只显示一行 `[图片消息]`，气泡里没有图；自己发出的图片消息同样不显示。

**根因**（四处叠加，都在 `PrivateMessagesScreen` 的媒体解析）：① 判定类型读的是 `msg.msgType`，而服务端私信字段是 `messageType`（桌面版读的也是 `messageType`/`content.messageType`），类型兜底永远不生效；② 相对路径统一拼 `mp4.48.cn`，图片实际在 `source.48.cn`，域名错 → 必然 404；③ `imageInfo`/`pictureInfo` 这类外层包裹没有单独作为候选，`imgUrl` 埋在里层时取不到；④ 气泡里的 `<Image>` 没有失败回退，加载失败就是一块空白。

**改动**：
- 新增 `src/utils/mediaUrl.ts`，与桌面版 `private-message-formatters-feature.js` 对齐：`imgUrl → imageUrl → pictureUrl → picUrl → photoUrl → cover → url → path` 的字段顺序、`/mediasource|/imagesource → source.48.cn`、图片走 source / 音视频走 mp4 的宿主规则。
- 解析顺序改为「先判类型、再按类型选宿主」；类型取 `messageType/msgType/contentType/type`，与桌面版一致。
- `pushBody` 增加 `imageInfo/imgInfo/pictureInfo/voiceInfo/audioInfo/videoInfo/replyInfo` 候选层。
- 兜底：字段名不认识时按图片扩展名整棵对象深扫（跳过 `user/avatar/starInfo/badge` 等身份字段，否则纯文字私信会被渲染成对方头像）。
- 气泡图片换 `NetworkImage`（缩略图 + 失败占位 + 原图兜底），点击打开 `ZoomImageModal` 大图预览。
- 同一行消息的媒体只解析一次（原来一次渲染里调了三遍）。

**涉及文件**：`src/utils/mediaUrl.ts`、`src/screens/PrivateMessagesScreen.tsx`、`scripts/private-message-media.test.mjs`

### 18. 私信头像与用户资料卡

**现象**：私信里对方头像不显示（只剩一个首字母），点头像也没有任何反应；桌面版每条对方消息左侧都有头像，点开是用户主页。

**根因**：会话页头像只从成员库取（按 targetUserId 匹配成员），普通粉丝不是成员 → 永远取不到；聊天库默认头像只认 `currentMessage.user.avatar`，我们传的是空串，所以只剩首字母；也没接 `renderAvatar` 与资料卡入口。

**改动**：
- 新增 `resolvePrivateAvatar()`（`src/utils/mediaUrl.ts`）：消息发送者 `user.avatar` → 会话对象 `user.avatar/headImg/avatarUrl/picUrl` → 成员库，相对路径按桌面版拼 `source.48.cn`。
- 会话列表头像改用该函数（原来是成员库独占），列表头像可点开资料卡。
- 会话页 `renderAvatar` 接管气泡头像：36dp 圆形、`NetworkImage` 缩略图 + 失败占位，点击打开 `UserProfileSheet`。
- 会话页标题左侧新增对方头像（`ScreenHeader` 新增可选 `leading` 插槽），同样可点开资料卡。
- 资料卡复用房间消息那套（关注 / 私信 / 关闭），数据源仍是 `/user/api/v1/user/info/home`。

**涉及文件**：`src/utils/mediaUrl.ts`、`src/screens/PrivateMessagesScreen.tsx`、`src/components/ScreenHeader.tsx`、`scripts/private-message-media.test.mjs`

### 19. 房间上滑看历史被新消息拽回底部（QQ 式行为）

**现象**：房间里往上翻历史，2s 轮询一到新消息列表就自己滑回底部，历史根本看不完。

**做法（对齐 QQ）**：
- 记「贴底」状态（inverted 列表 offset ≤ 60px）。离开底部即记下当时最新一条消息 id 作**冻结锚点**。
- 锚点**之前**（更新）的消息先不插进列表，只计数 → 消息不再把视口拽走。
- 锚点**及其之后**（更旧的历史，含上滑自动加载的「加载更多」）照常显示 → 翻历史不受影响。
- 离开底部时露出「回到底部 / N 条新消息」气泡（库的 scrollToBottom 能力，改成胶囊样式）；
  点一下或手动滑回底部即解冻。换房间 / 自己发言会自动回到底部。
- 私信页同样开了「回到底部」气泡。
- 修正：聊天列表不再启用 `maintainVisibleContentPosition` —— 倒序列表在 offset=0 时本来就贴底，
  而 MVCP 会把可见内容钉住（插入新消息后把 offset 推大），表现就是「点了回到底部也不跟新消息滚、
  而且立刻又被判成不在底部」，与冻结逻辑互相打架。

**涉及文件**：`src/services/roomLivePolicy.ts`（`splitByFreezeAnchor`）、`src/screens/FollowedRoomsScreen.tsx`、`src/screens/PrivateMessagesScreen.tsx`、`scripts/room-live-policy.test.mjs`

### 20. 流畅度：切页、连点头像、长会话

- **导航层冻结**：Tab 与 Stack 都开 `freezeOnBlur` —— 切走的页面只保留状态、停止重渲染，快速来回切页不再整棵子树重算。
- **房间消息对象复用**：2s 轮询每轮都会重建数组，之前每行 message 都是新对象 → FlatList 里所有行 memo 失效、整屏重渲。现在按「行 key + 内容签名」复用旧对象，内容没变就不重渲染。
- **Chat props 常量化**：`theme` / `darkTheme` / `user` / `messagesContainerStyle` / `listProps` / `loadEarlierMessagesProps` 都改成稳定引用（原来全是内联字面量，父组件一次 setState 就重建整套 props）。
- **私信页**：消息 → IMessage 改为 `useMemo`（原来写在 render 里，输入框每敲一个字都重建全部消息）；`renderBubble` / `renderDay` / `renderAvatar` 提到顶层 `useCallback`；成员查找从 `members.find`（O(成员数)）改成预建 Map。消息列表滚动事件节流 100ms，不再每帧过 JS 桥。
- **资料卡缓存**：`user/info/home` 结果按 id 缓存 5 分钟，命中直接上屏、TTL 内不再请求；关注态变化会写回缓存。来回连点头像不再反复打接口。

**涉及文件**：`src/navigation/index.tsx`、`src/components/UserProfileSheet.tsx`、`src/screens/FollowedRoomsScreen.tsx`、`src/screens/PrivateMessagesScreen.tsx`

### 21. 测试

- `test:core` 从 5 项扩到 23 项：翻牌隐私、翻牌期限、房间映射刷新、房间实时策略、注册协议、成员库回退、私信未读、私信图片解析、底栏显隐、小窗进度等。
- 删除已无引用的送礼面板构建指纹常量（`GIFT_PANEL_BUILD_TAG`），包身份统一由日志导出承担。

### 22. 签名通道（pa）：并发合并 + 失活自愈

**现象**：日志里成批出现 `[generatePaAsync] WebView PA generation FAILED: 签名生成超时`，同一秒十几二十条；出现之后接口继续慢/失败，杀进程重开才恢复。

**根因**：
- 口袋接口每个请求都要带 `pa` 签名头。Hermes 没有 WebAssembly，原生 WASM 通道必然失败（属正常降级），实际签名由 App 根部那个 1×1 隐藏 WebView 里的 wasm 计算。
- 旧实现每次请求各发一条 `pa` 消息、各自等 10s。启动时二十多个接口并发 → 二十多个定时器，一旦同时超时就同一秒刷出二十多条一样的 ERROR。
- 更要命的是**没有恢复**：超时只 reject，`signerReady` 仍为 true，WebView 也不重建。渲染进程被系统回收（`onRenderProcessGone`）后原 WebView 已经不可用，后续每个请求都继续往死掉的实例发消息、白等 10s —— 一次抖动会拖成整个会话不可用。
- 后台/息屏时渲染进程会被系统冻结，这段时间的超时同样是误判。

**改动**（不放宽任何功能，只改签名通道的调度）：
- **单飞合并**：并发调用共享同一次签名结果（`pa` 由无参 wasm 调用生成，只可能依赖时间/设备信息，不可能依赖具体请求，复用安全），二十多个请求 → 1 条消息。
- **失活自愈**：请求超时或渲染进程被回收 → 清 `signerReady`、reject 在途请求、换 key 重挂载 WebView，等新实例 ready 后自动重试一次。
- **后台不误判**：App 不在前台时签名请求不发起、超时计时暂停（回前台继续），避免息屏期间的成批假超时。
- **日志节流**：同一 5s 窗口内相同失败只记一条（附折叠条数）；原生 WASM 降级的 warn 只打一次。

**涉及文件**：`src/auth/webviewSigner.tsx`、`src/auth/index.ts`

### 23. 登录身份：口袋48 / 塞纳河48 区分登录（桌面端 v3.0 移植）

**背景**：口袋48 与塞纳河48 是同一套 48 账号体系的两个客户端，服务端按 `appInfo` 里的
`appName / appVersion / appBuild` 与 UA 区分身份。在塞纳河48 客户端注册/登录的账号，
用口袋48 身份请求时可能被判为「需绑定」或查无此人。

**改动**（对齐桌面端 v3.0 `src/common/pocket-client-profile.js`，来自官方 1.3.5 APK 的实测值）：
- 账号设置页新增「登录身份」分段控件：口袋48（默认）/ 塞纳河48，选择即持久化到 `p48ClientProfile`。
- 塞纳河48 身份下，登录 / 注册 / 验证码 / 全站接口统一改发：
  `appName=seine48`、`appVersion=1.3.5`、`appBuild=26102601`、
  UA `PocketFans201807/1.3.5_26102601 (SM-G9730:Android 12;Samsung V417IR release-keys)`，
  并附加 `X-Custom-Device-Type: ANDROID`；`modern` 分支不再把它改回 iOS 身份。
- 口袋48 身份完全沿用原有请求头（零回归），不动 NIM 侧现有 `com.seine48.app` 通道。
- 注册只支持口袋48 身份（与桌面端 `pocket-registration.js` 一致）：塞纳河身份下注册按钮置灰并提示切换。
- 验证码卡片标题随身份显示「口袋48验证码登录 / 塞纳河48验证码登录」。

**涉及文件**：`src/api/pocket48.ts`、`src/screens/LoginScreen.tsx`、`src/types/index.ts`、`src/services/settings.ts`、`src/i18n/*`、`scripts/pocket-registration.test.mjs`

### 24. 充值页 / 音乐播放 / 弹幕重连

- **充值页**：去掉顶部余额卡（该接口 token 过期时恒返回 401003，卡片退化成空壳还占掉近 1/4 屏幕），改为全屏官方充值页 + 预填口袋ID + 15s 加载兜底；导航栏刷新 = 重载页面。
- **音乐**：原生 Exo 通道可用时**完全不挂载** RNV Video —— 此前 Video 常驻占位，挂载即请求音频焦点，与原生 Exo 互相判失焦、双方都暂停（现象：没声音、进度条不动）。
- **直播弹幕**：未连上时输入框也可点击，**聚焦即重连**，不再只能干等「弹幕连接中」。

**涉及文件**：`src/screens/RechargeScreen.tsx`、`src/screens/MusicLibraryScreen.tsx`、`src/components/LiveBarrageBoard.tsx`

### 25. 云信连接改为按需接入（房间页 / 前台）

**现象**：进入过房间后云信长连接一直挂着，和官方客户端或本机另一个账号同时在线会互相顶号。

**改动**：

- 房间消息的 QChat 连接只在「房间页 + 已选房间 + App 前台」保持；
- 离开房间页、切到后台立即 `resetQChatSession()` 断开并清登录态；回到页面/前台按需重连；
- 房间消息本来就有 2s 自适应轮询兜底，断开期间不会丢消息，回页面会补拉。

**涉及文件**：`src/screens/FollowedRoomsScreen.tsx`

---

## 验证

```sh
npm run typecheck   # tsc --noEmit + 版本一致性
npm run test:core   # 23 项，全通过
git diff --check
```

## 附：本轮收尾修复

| 现象 | 根因 | 改动 |
| --- | --- | --- |
| 账号设置页底部输入框被键盘盖住 | Android edge-to-edge 下 `KeyboardAvoidingView` 的 `behavior` 为 undefined（完全不补偿），系统 `requestRectangleOnScreen` 也不会把输入框滚到键盘之上 | `App.tsx` 挂 `KeyboardProvider`；账号设置页改用 `KeyboardAwareScrollView`（原生 WindowInsetsAnimation 跟手），`bottomOffset=24` 避开输入法工具条 |
| 房间列表偶发「倒退」/旧数据覆盖新数据 | 手动刷新、30s 轮询、切账号并发触发加载，慢响应后到先赢 | 加在途序号，两处 `await` 与 `catch`/`finally` 校验后再落状态 |
| 房间页偶发整页闪一下 | 三个 Modal 常驻挂载（`visible={!!x}`），每次重渲染都 flush Modal 窗口 | 改为 `{x ? <Modal visible …> : null}` 按需挂载 |
| 英文/繁體下错误提示不变红、「重试」不出现 | 用 `/失败|错误/.test(status)` 反推错误态 | 翻牌页、抓取页改为显式 `statusError` |

**涉及文件**：`App.tsx`、`src/screens/{LoginScreen,FollowedRoomsScreen,FlipScreen,FetchScreen}.tsx`

## 附二：动效 / 小窗 / 截字（2026-11-05 下午）

| 现象 | 根因 | 改动 |
| --- | --- | --- |
| 点进房间、退出房间回列表时的渐入动画一顿一顿 | `FadeInView` 由 JS 驱动（`useNativeDriver:false`）。进房要挂载 Chat（几百条消息 + 玻璃气泡）、退房要卸载 Chat 并重建整个房间列表，这几百毫秒 JS 线程满载，opacity/translateY 只能排队等 JS 空档 | 改用 reanimated `useSharedValue` + `useAnimatedStyle`，动画在 UI 线程推进；保留「delay+duration+200ms 兜底置 1」，避免任何情况下停在透明 |
| 首页工具行「鸡腿榜 / 数据库」显示成「鸡腿…」「数据…」 | 工具 chip 仍在套快捷入口固定格宽 `quickCellW`：360dp 屏 = 76dp，扣掉图标 28 + gap 4 + padding 8 只剩 36dp，而 12px 中文三字正好 36dp（零余量） | 宽度改 `minWidth: quickCellW * 0.8` + `toolChip` 增大左右留白、`justifyContent:'flex-start'`，让 chip 按内容自适应（横排本就可滚动） |
| 登录方式分段控件「B站二维码」被截成「B站二维...」 | 4 等分，每格文字宽约 63dp，「B站二维码」约 65dp | 文案改「B站扫码」（卡片标题本就是「B站登录」，信息不丢） |
| 小窗四个角按钮语义混乱、缩放按钮难发现 | 全屏是「图标+文字」胶囊、关闭红色方块、缩放圆点、播放挤在右下角 | 左上角关闭、右上角返回全屏（四角括号图标）**常显**；播放/暂停移到正中（随控件 3s 隐藏）；删掉缩放按钮，改为**双击画面空白处**循环切换大小（1 → 1.18 → 0.74） |

**涉及文件**：`src/components/Motion.tsx`、`src/components/MiniPlayer.tsx`、`src/screens/HomeScreen.tsx`、`src/screens/LoginScreen.tsx`

## 已知问题

- `node-forge` 仅用于注册/密码登录的 AES-ECB，若后续体积敏感可换成内置实现。
