# 第五遍终审 · 布局与交互细节（final-audit-5）

> 范围：`src/screens/` 30 屏 + `src/components/` 核心组件，逐文件 fresh-eyes 审查。
> 重点（非颜色）：输入高度、文字截断、触控目标、行距/内边距、图标语义、空/加载/错误三态、键盘体验、动画、文案。
> 用法例：本工程 i18n 采用「中文原文即 key」（`t('中文…')` 为正确范式），故清单 9 只处理 **未包 t() 的中文**。
> 验证：`npx tsc --noEmit` exit=0，改过文件 0 错误。

---

## 1. 输入框高度不统一

**已修**
- `MusicLibraryScreen.tsx:446` 搜索条 `height:42 → 40`（对齐全站搜索条规范；`MessagesScreen` 搜索条本就是 40）。
- `DownloadScreen.tsx:321` 单行输入 `urlInput minHeight:44 → 42`（对齐普通输入规范）。

**审查结论**：其余页面无「搜索40 vs 输入42」混用（成员搜索 `MemberPicker` 输入、`InvoiceScreen` 表单输入均用 `padding:10` 自适配，高度一致）。

---

## 2. 文字截断 / 溢出

**已修**
- `RuntimeLogViewer.tsx:163` 日志 `ctx` 加 `numberOfLines={1}`；`:227` `ctx` 加 `flexShrink:1`（防止横向溢出挤压 badge/时间）。
- `FollowedRoomsScreen.tsx:2187`（约）`roomRankValue` 加 `flexShrink:1`（防 `贡献 {value}` 拥堵排行信息列）；`:2158`（约）`openLinkBtn` 加 `maxWidth:'100%'` + `alignSelf:'flex-start'`（防 URL 溢出气泡）。
- `FollowedRoomsScreen.tsx:2179`（约）`empty` 样式去除死硬编码色 `#3f3f3f`（全被内联 palette 覆盖）。

**保留**
- 各封面/标题 `numberOfLines={1/2}` 省略「…」为规范内设计（动态媒体标题截断属合理）；`FlipScreen cardQ/cardA` 行数截断属有意为之（卡片非交互）。
- 图片/视频播放器白字遮罩、`#fff` 徽标均为媒体场景，保留。

---

## 3. 触控目标 < 40dp

**已修（icon 类加 hitSlop，纯按钮/分段拉高）**
- `Pill.tsx:26` 共享组件 `Pressable` 加 `hitSlop={top/bottom:4, left/right:5}`（惠及 MemberPicker/DanmakuSettingsSheet/RuntimeLogViewer/InvoiceScreen 全部 pill chip，视觉 32dp 触控至 ≈40dp）。
- `FetchScreen.tsx:234` `segmentBtn minHeight:34 → 40`。
- `RoomAlbumScreen.tsx:424` `segmentBtn minHeight:34 → 40`。
- `RoomRadioScreen.tsx:286` `secondaryCtrl height:36 → 40`（圆角同步 18→20）。
- `AnalysisScreen.tsx:796` `segItem height:34 → 40`。
- `CommunityScreen.tsx:387` `tab paddingVertical:8 → 11`（分段 ≈40dp）。
- `LoginScreen.tsx:488` `verifyOption` 加 `hitSlop`；`:727`（约）`qrRetry` 加 `hitSlop`。
- `FlipScreen.tsx:541`（约）`answerBtn`（34×34 播放切换）加 `hitSlop`；`:622` `rechargeBtn` 加 `minHeight:40`。
- `CommunityPostDetailScreen.tsx:302`（约）`sendBtn`（主提交按钮）加 `hitSlop`。
- `RuntimeLogViewer.tsx:120`（约）`关闭` 按钮加 `hitSlop`。
- `FollowedRoomsScreen.tsx`：`roomFollowBtn:1824`、`followBtn`(room header):1360、`pinBtn`:1372、`roomPlayerTool`:1288/1291、`roomRankClose`:1322 均加 `hitSlop`（`roomPinBtn` 原本已有，未动）。

**保留**
- 播放器内沉浸黑底上的功能按钮（`roomPlayerTool`、底部 `bottomDock` 按钮）为全屏播放控件，视觉 36dp + hitSlop 处理，属合理。
- 纯图标（如 Header 刷新图标 21px + activeOpacity）非「功能按钮」，保留。

**（未改 note）** 图表排序条形/排行等 `rankRow`、日期 meta 无 numberOfLines 在窄屏可能换行——轻微，未达改动门槛。

---

## 4. 列表行间距 / 卡片内边距不一致

**已修**
- `OpenLiveScreen.tsx:446` `skeletonCard padding:12 → 10`（与真实 `card:10` 对齐，消除加载时布局跳动）。

**审查结论**：其余页面同类行间距/内边距一致（`AnalysisScreen rowCard`、`MeleeRank rankCard`、`Trip timelineRow` 均 marginBottom:5；`Dynamic/Weibo` 卡均 padding:14/marginVertical:4；`FetchScreen msgItem` 均 marginVertical:4）。无冲突。

---

## 5. 图标语义

**已修 / 无此类问题**
- 复审：空态/错误态图标语义正确（`message-text-outline`、`receipt-outline`、`web-off`、`account-key-outline`…）；无同一行重复图标。

**保留**
- `MediaScreen` 直播/电台类型徽标在「视频」「电台」两种上下文中分别用 `video`/`radio`，语义正确。
- `MemberDynamic` 点赞用 `heart-outline`、`MemberWeibo` 用 `thumb-up-outline`——分属「口袋动态/微博」两个不同平台来源，图标差异视为平台语义差异，保留。

---

## 6. 空态 / 加载态 / 错误态

**已修**
- `AnalysisScreen.tsx:516`（约）发言榜 `senders` 列表补 `ListEmptyComponent`（`account-group-outline` + `暂无发言数据`），对齐同屏 dates/media/flip 三榜。
- `FollowedRoomsScreen.tsx`：新增 `followedError` 状态 + `loadFollowed` catch 落盘 + `ListEmptyComponent` 错误分支（`ErrorState` 带重试），避免「加载失败被误显示成『暂无关注房间』」；并新增 `roomMsgError`，房间消息加载失败时 `ListEmptyComponent` 出 `ErrorState` 代替代「暂无消息」。（此二视为本轮关键补漏——失败不再伪装成空。）
- `BilibiliLiveScreen.tsx`：新增 `configError` + `loadConfig` useCallback（挂载即拉取），列表 `ListEmptyComponent` 增加错误分支 · 重试，覆盖初始配置拉取失败回落「暂无直播间」。
- `OpenLiveScreen.tsx`：新增 `listError`，成员公演列表加载失败时 `ListEmptyComponent` 出 `ErrorState`·重试，避免回落「暂无公演记录」。

**审查结论**
- 其余（Download/Flip/Community/Media/Music/Login/Invoice/Recharge/MemberPicker/各房间屏）loading+empty+error 齐全。

**保留 / 待优化 note**
- `CommunityScreen` 切 tab（推荐↔最新）期间旧列表暂存直至新数据返回、无中转态——属分页器既有行为，未改（避免动业务数据流）。

---

## 7. 键盘 / 输入体验

**已修**
- `PrivateMessagesScreen.tsx:512`（约）聊天屏（sel 分支）外包 `KeyboardAvoidingView behavior=padding`，防止底部 `inputBar` 被键盘遮挡。
- `LoginScreen.tsx:438`（约）表单屏外包 `KeyboardAvoidingView`。
- `InvoiceScreen.tsx:151`（约）开票表单屏外包 `KeyboardAvoidingView` + `ScrollView keyboardShouldPersistTaps="handled"`（按钮/银行账号字段原会被 iOS 键盘盖住）。
- `FlipScreen.tsx:315`（约）发送翻牌表单外包 `KeyboardAvoidingView`。
- `DownloadScreen.tsx:200`（约）URL 输入加 `returnKeyType="done"` + `onSubmitEditing={startManualDownload}`。
- `MemberPicker.tsx:52`（约）搜索输入加 `returnKeyType="search"`。
- `FollowedRoomsScreen.tsx:1427 / :1674`（约）两个搜索输入加 `returnKeyType="search"`。
- `OpenLiveScreen.tsx:315`（约）筛选输入加 `returnKeyType="search"`。
- `CommunityScreen.tsx:~328`（约）发布表单：标题加 `returnKeyType="next"` + `onSubmitEditing` 跳转话题（`topicRef.focus()`），话题加 `returnKeyType="done"`（表单本身已有 `KeyboardAvoidingView`）。

**审查结论**：`CommunityPostDetailScreen` 已有 `KeyboardAvoidingView`；`ProfileScreen` 用 `ScrollView keyboardShouldPersistTaps="handled"`。现状可接受。

---

## 8. 动画

**已修（无 native driver 违规）**
- 全栈 `Animated.timing/spring`（`Motion.tsx` FadeInView/ScalePressable、`Skeleton`、`AppToast`、`AppTabBar` 弹跳、各屏呼吸点/进度）均已 `useNativeDriver:true`；背景色动画（`Skeleton` 用 opacity 动画）不违规。

**保留 / 行为修正**
- `AnalysisScreen.tsx:412` `statCard` 与 `:426` `rankRow` 原为**无 onPress 的 `ScalePressable`**（按压有反馈却无动作）→ 已改为普通 `View`，消除「假可点」误导。属交互细节修复。
- `FollowedRoomsScreen.tsx:1594`（约）媒体卡外层 `TouchableOpacity` 原 `onPress` 与内层播放按钮 `onPress` 同调 `playMedia`（嵌套可点→双击路径/手势冲突；`onLongPress` 下载亦与内层按钮冲突）→ 移除外层卡片的 `onPress`（仅保留长按下载），播放唯一由内层按钮触发（音频/无封面 live 通用），消除双重触发。

---

## 9. 文案（硬编码中文未走 t()）

**检查结论**：所有 JSX 中面向用户的中文字符串均走 `t()` / `translate()`；仅代码注释及工具函数内的匹配正则含中文，非渲染文案。

**保留 / note**
- `FetchScreen.tsx:177`、`FlipScreen.tsx:431`、`CommunityScreen` 的 `/失败|错误/.test(status)` 用中文原文做状态判定——依赖「status 以中文 t() 落库」的现状，属本地化脆弱点但非渲染文案、也非本次改动范围，保留并备注。

---

## 验证
- `npx tsc --noEmit 2>&1 | Select-String "screens\\|components\\"` → 无输出，exit=0（改过的文件 0 错误）。

## 说明
- 全部修复不触碰业务逻辑 / API 调用 / 数据流 / 路由 / i18n 原文；颜色均走 `usePalette()` token；`Animated` 均 `useNativeDriver:true`。
- 错误态扩展（`FollowedRoomsScreen` followedError/roomMsgError、`BilibiliLiveScreen` configError、`OpenLiveScreen` listError）均为「新增本地状态 + 条件渲染」，未改任何接口签名或数据流；仅 `BilibiliLiveScreen` 把挂载时的拉取内联 IIFE 重构为 `loadConfig` useCallback（同逻辑）。
- 「CommunityScreen 切 tab 无中转态」归入待优化（受分页器既有行为约束，未动数据流）。
