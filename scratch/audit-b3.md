# 移动端 UI 审计报告 — B3 批次（6 页）

审计对象批次：RoomAlbum / RoomRadio / OpenLive / PrivateMessages / BilibiliLive / VideoLibrary
审计基准：iOS 26 token 体系（theme/*.ts）+ 统一组件（ScreenHeader/AppScaffold/ListItem/GlassCard/EmptyState/Skeleton/StateViews/Motion/SectionHeader/Pill/Button）。
约定核查项：强制 usePalette()、typography 梯度、禁 `isDark && xxxDark` 双分支、卡片用 GlassCard 或 palette.surface、按压反馈、空/载/错态统一、Animated useNativeDriver: true、旧 Colors 常量 = 残留。

> 批量文件行号均以本次 read 输出的实际行数为准。

---

## 0. 跨页共性问题（影响全部 6 页，按优先级）

### P0-1 `isDark`/`useAppTheme()` 双分支残留（违反「禁 isDark && 硬编码」约定）
6 页全部声明 `const isDark = useAppTheme()`，且大多伴随 `.containerDark` 死样式：
- RoomAlbum L132、RoomRadio L21/L66/L144、OpenLive L165/L305/L378、PrivateMessages L285、BilibiliLive L36/L301/L362、VideoLibrary L72。
- `.containerDark` 三处（RoomRadio L144、OpenLive L378、BilibiliLive L362）全是 `backgroundColor: 'transparent'`，与 `.container` 完全相同的纯死代码 —— 应整段删除，并删除 `isDark` 变量；列表/空态已用 palette，`CenterSpinner dark={isDark}`（L292/L640/L650、VideoLibrary L156/L222）应改用 palette 系 spinner，去掉 dark prop。

### P0-2 自定义点按反馈缺 activeOpacity 或未收缩 scale
大量 `TouchableOpacity` 未设 `activeOpacity`，部分直接是原色无反馈：
- RoomAlbum：L239、L253、L262/L268（modeBtn）、L282。
- OpenLive：L307/L355、L285。
- PrivateMessages：L512（mediaBtn）、L534（flipChip）。
- BilibiliLive：L241/L245、L306。
- 建议：常态行/卡片统一用 `ScalePressable`（或 Pressable pressed 态 scale 0.96），纯文字刷新按钮加 `activeOpacity={0.7}` 或改 Pressable。

### P0-3 大量就地硬编码颜色，未走 palette / token
- 各页刷新/外部按钮写死 `#ff6f91`（RoomAlbum 无但 OpenLive L379/L401、BilibiliLive L304/L363/L380、VideoLibrary L265）；`palette.tint`/`palette.tintSoft` 可用。
- 播放页 `#000000` 背景为合理沉浸场景，可保留，但见各页 H 细节。
- 其它见逐页 A 清单。

---

## 1. RoomAlbumScreen.tsx（房间相册）

**一句话结论：网格卡自身无按压反馈（activeOpacity 只降半透明）、旧 `#FFFFFF`/`#000000` 字色残留、modeBtn 缺边界透明处理、播放页错误态未用统一组件。**

### A. 硬编码颜色
- L266 / L272：modeText 条件 `'#FFFFFF'`（选中态白字，可保留但属就地色；建议抽 `const onAccent = palette.name…`，或直接保留因 contrast 需求）。低优先。
- L344 / L347：videoBadge 内 `color="#FFFFFF"`、playMark `color="#FFFFFF"` —— 图片/视频遮罩上的图标白字是为保证可见性，合理，保留。
- L382-383：`gridShade1/2` rgba 渐变遮罩，合理场景，保留。
- L385-386：overlay 文本 `#FFFFFF`/`rgba(255,255,255,0.85)` + textShadow，图片上浮信息，合理。
- **L393/394**：`playerPage`/`player` `#000000`，全屏播放页合理。
- **L449（样式内 `backBtn: { fontSize: 14, … minWidth: 56 }`）非颜色。**
- 需修正：**L305 empty 文案用了 palette.labelTertiary 但 `ListEmptyComponent` 无图标**，与全局 EmptyState 风格不一致（见 F）。

### B. isDark 双分支
- **L132** `const isDark = useAppTheme();` 被 **L292** `CenterSpinner dark={isDark}` 使用，且经 L229 传入 AlbumGridItem 的 `isDark` prop（L319/L324 签名），但方法体内**完全没用到 isDark**（L334-360 网格项全部 palette）——死引用链条，删除 isDark / dark prop。

### C. 页头
- 用 ScreenHeader（L235 播放页 / L252 列表页）✅。标题字号左对齐、返回键与其他页一致 ✅。右侧刷新为 `TouchableOpacity`+Text（L253-255）无 activeOpacity、无 hitSlop，触区偏小（见 D）。
- **自绘 header 无**。但 L235 播放页在 `#000000` 全黑背景上叠 ScreenHeader，标题白字无阴影分隔，观感偏平（低优先）。

### D. 按压反馈
- **L253** 刷新 TouchableOpacity 无 activeOpacity。
- L262/L263 与 L268/L269 modeBtn（大/小房间）无 activeOpacity。
- L282 retryBtn 无 activeOpacity（有 semi 反馈靠 backgroundColor 但按压无变化）。
- L335-339 网格卡 `activeOpacity={0.9}` ✅，但**仅透明度而非常态其余页的 scale 反馈，反馈力度不一致**；建议换 ScalePressable 保持手感统一。
- L239 播放页返回错误「返回」按钮无 activeOpacity。

### E. 动画
- L258 页面 FadeInView ✅；L334 每网格项 `FadeInView duration={300}` 嵌套在 FlatList 的 scroll 中，**每 item 独立重放入场动画**，滚动回看会反复触发（列表动画应只做首屏一批，参考 OpenLive/PrivateMessages 的 `index<12` 判断）。中优先。
- 未使用 Animated.timing 手动实现，native driver 无违规。

### F. 空/载/错态
- 三态**未用统一组件**：L305 空态用裸 `<Text>`（无图标）；L290-292 加载用 `CenterSpinner dark`；L279-286 错误态手写 retryRow（Text + TouchableOpacity），风格与 StateViews/ErrorState 不一致。建议统一：空→`EmptyState`、加载→`CenterSpinner`、错误→`ErrorState onAction=重试`。高优先。
- 播放页错误（L236-243）也手写，可复用 StateView。

### G. 间距/圆角
- 系统性就地值：L367 `paddingHorizontal: 16`(=md ✅)；L368 `gap: 8`(xs ✅)；L369 `minHeight:42, borderRadius:18`(button ✅)；**L374 grid `padding:10`（非 gradient，2 列网格常用，可接受但建议 spacing.xs·2 语义化）**；L375 `margin:4, borderRadius:16`(=md ✅)；L378 `borderRadius:10`(非 token)；L391 `borderRadius:16`(retry, =md ✅)。
- 圆角混用 16/18/10，未统一走 radiiAlias（按钮宜 button=18、chip 宜 pill）。低-中优先。

### H. 其它
- **L333 `style={{ flex: 1 }}` 包在 FadeInView 上 + 内部 TouchableOpacity `flex:1`**，两列网格在 FlatList item 中 `flex:1` 即可；`FadeInView` 的 flex 与外部 `renderAlbumItem` 传入的网格已 flex，嵌套可能造成高度计算冗余，建议 FadeInView 只包 opacity/transform 不改 flex。
- L305 empty 复用网格空状态无 padding-bottom，与 L374 grid padding 冲突（空态会贴边）。
- Import L5-12 中 `FlatList`、`Image` 已 import 但本文件用 PerfFlatList，`Image` 未用（未在 JSX 出现）——deadimport（L7 `Image`）。`View`、`TouchableOpacity`、`Text` 在用。低优先。

---

## 2. RoomRadioScreen.tsx（房间电台）

**一句话结论：近全为就地色 + 手写控件，双分支死代码 + 无按压反馈 + 错误/空/载态未统一，是最不合规的一页。**

### A. 硬编码颜色
- L67 `container` 透明 + L144 `containerDark` 透明（双分支死代码，见 B）。
- **L153 `ctrlBtnText` `color: '#fff'`、L155 `playBtnText` `color: '#fff'`、L152** —— 就地白字，可保留。
- L146 playerCard `backgroundColor: palette.surface` ✅；L147-148 就地文字色走 palette（palette in JSX）✅。

### B. isDark 双分支
- **L21** `const isDark = useAppTheme();`
- **L66** `style={[styles.container, isDark && styles.containerDark]}`
- **L144** `containerDark: { backgroundColor: 'transparent' }` —— 与 container 相同，纯死代码。删除 isDark + containerDark + 该条件。高优先。

### C. 页头
- 用 ScreenHeader（L67）✅ 无 right 操作位（本页无右上角刷新，但状态刷新依赖 modeBtn 重播，可接受）。标题/左布局一致 ✅。

### D. 按压反馈
- L72/L75 modePill、L91 retry、L106/L109/L112 ctrlBtn、L132 playBtn —— **全部 TouchableOpacity 无 activeOpacity**，且背景仅 fill2/表面，按压几乎无视觉反馈。建议统一 ScalePressable 或补 `activeOpacity={0.7}`。高优先。

### E. 动画
- L68 页面 FadeInView ✅。无 Animated 手写。播放器为 hidden（L159，位置 absolute 1×1），无控制层动画需求。
- **视频 hidden（L117-128）用 `style={styles.hiddenPlayer}`（1×1 opacity:0）** —— 播音频可接受，但文档式 opacity/display 会用 `backgroundColor:'transparent'`，ok。

### F. 空/载/错态
- 三态全部手写分支（L83-101）：loading 用 ActivityIndicator + Text、error 用 red Text + retry、空态用 hint Text。未用 CenterSpinner/EmptyState/ErrorState。建议：
  - loading → `<CenterSpinner …/>` 或统一 `ActivityIndicator color={palette.tint}`（现一致性可但缺组件封装）；
  - error → `ErrorState title onAction=retry`；
  - 空（无成员）→ `EmptyState`。
  高优先（全页最弱环节）。

### G. 间距/圆角
- L145 pickerWrap `padding:16`(md ✅)；L146 playerCard `margin:16, padding:20, borderRadius:16`(=md 但 padding:20=lg，cardPadding 应为 16，微不一致)；L150/L154 `borderRadius:18`(button ✅)；**L157 modePill `borderRadius:14`（非 token，pill 应 999）** —— 用 Pill 组件替换最理想。L146 卡内 alignItems center 但未用 GlassCard。低-中。

### H. 其它
- **L106-107 ctrlBtn 内 isPlaying 逻辑 `onPress={playing ? stopRadio : () => setPlaying(true)}`** 与下方 `paused` 无关，Video `paused={!playing}` L121 —— 变量命名 `muted`/`playing` 语义 OK，但 `paused` 未被用于控件显示状态，仅隐式。
- **L32 `playerRef`** 未用（无 seek/resume 调用）——死引用，可删（删除后隐藏 Video 也可不用 ref）。低优先。
- L149 controlsRow、L156 modeRow `gap:8`(xs ✅)。

---

## 3. OpenLiveScreen.tsx（公演记录）

**一句话结论：结构最接近规范，但 isDark 死代码、headerAction 就地粉、错误态混橙/粉两套、播放页错误态非组件，且无错误空态兜底的重试在 refresh 场景缺按钮。**

### A. 硬编码颜色
- **L379 `headerAction: { color: '#ff6f91' … }`** + **L306 用法无 palette 覆盖** —— 直接写死品牌粉，应改 `{ color: palette.tint }` 内联覆盖或改用 token。高优先（跨页 P0-3 之一）。
- **L289 播放错误 `<Text color: '#FF6B6B'>`** —— 就地橙红，应 `palette.danger`（已有 palette 引入）。中优先。
- **L401 `externalBtn backgroundColor:'#ff6f91'` + L402 `externalText '#ffffff'`** —— 就地品牌色；宜 `palette.tint` + `#fff`（浅/深对比）。中优先。
- L243-L244 `setPlayerError('')` 若重试想关掉错误但无法重新加载——见 F。
- L361 coverPlaceholder 用 `palette.tintSoft`/`palette.tint` ✅；L395/396 播放页 `#000000` 合理。

### B. isDark 双分支
- **L165** isDark；**L305** `[styles.container, isDark && styles.containerDark]`；**L378 `containerDark:{ backgroundColor:'transparent'}`** 死代码。删除。高优先。

### C. 页头
- 用 ScreenHeader（L306 列表 / L284 播放）✅；播放页 right 横屏切换 TouchableOpacity 无 activeOpacity（L285）；L307 刷新 同。标题/左布局一致 ✅。

### D. 按压反馈
- L285 header 横屏、L297 externalBtn、L307 刷新 —— 无 activeOpacity。
- **L355 卡片 TouchableOpacity `activeOpacity={0.9}`** ✅ 但与其他页 scale 手感不一致。
- L290 retryTouchableOpacity、L313 retryBtn —— 无 activeOpacity。

### E. 动画
- **L354 `FadeInView delay={80 + index * 30}` 无 `index<12` 限制 + L312 页面 FadeInView**：列表逐项入场在大量项下会有动画堆积、滚动复放，应加 `index < N` 首屏限制（对齐 PrivateMessages/Motion 惯例）。中优先。
- 无 Animated 手写，native driver 无违规。

### F. 空/载/错态
- **L335-347 空/载手写**：loading 用 ActivityIndicator、空用裸 Text（L342 `empty` 文案），未用统一组件。建议 `CenterSpinner` / `EmptyState`。
- **L312-319 fetchError 独立 retryBtn** 用 `palette.tint` 文案「重试获取直播流」✅（这是唯一显式错误态），但 L287-293 播放错误也手写。整体建议统一 StateViews。高优先。
- L295 播放 onError 后仅文本无重试按钮（L243 setPlayerError('') 是关闭非重试），可加「返回/换线路」。

### G. 间距/圆角
- L381 `paddingHorizontal:14`（非 token，微差）；L382 search `minHeight:42, borderRadius:14`(input ✅)；L384 `padding:14`；L385 card `padding:10, marginVertical:4, borderRadius:16`(=md)；L386/387 `borderRadius:14`(cover)；L392 footerText marginVertical 14。整体较统一，仅 14/10 就地值非 token，低优先。

### H. 其它
- **L304-305：error 与 loading 不互斥** —— L322 status 逻辑 `loading && !items.length` 正确处理。
- L252 原生播放器分支 `openNativeLivePlayer` 与本页 UI 语义解耦，但 L281 `if (playing)` 渲染整页替换，**返回时整个列表 unmount/重挂**，状态（items、query）为 useState 保留 ✅（未重置），尚可。
- L181-183 卸载时强制竖屏清理 OK。
- deadimport：L8 `FlatList`（用 PerfFlatList）、L30 `<Image>` 未用（L361 用 Image ✅ 有在用）。调整为先确认；`Linking` 用 ✅。

---

## 4. PrivateMessagesScreen.tsx（私信）

**一句话结论：气泡聊天气泡配色硬编码大量旧 iOS 蓝（`#7BC6FF`）且暗色下破坏可读性；翻牌条/输入条手写控件缺反馈；媒体视频点击无反馈。整体气泡区是全批最重硬编码区。**

### A. 硬编码颜色（私信气泡为**最严重区域**）
- **L685 `bubbleMine: { backgroundColor: '#7BC6FF' }`** —— 旧 iOS 气泡蓝，白字（L688 `msgTextMine '#fff'`），**深色主题下也保持天蓝底**，属硬编码双主题残留。应改用 `palette.tint` 或 `palette.fill1` 系统蓝语义化，并保证 `#fff` 字对比。
- **L686 `bubbleOther: { backgroundColor: '#FFFFFF' }`** —— 白底，深色下刺眼且与 L504 `!mine` 覆盖冲突（JSX L504 已设 `backgroundColor: mine ? undefined : palette.surface`，但 style 对象 L686 又写死 #FFFFFF —— **L504 的 `mine ? undefined` 使 mine 走 bubbleMine 蓝、!mine 会同时命中 L686 #FFFFFF 与 L504 palette.surface 覆盖，L504 后匹配生效，故 L686 实际被 palette.surface 覆盖 → L686 是死样式残留**）。确认后删 L686 或改用全 palette。
- **L690 `msgTimeMine: 'rgba(255,255,255,0.75)'`**（在蓝底上合理）；**L688 `msgTextMine '#fff'`**。
- **L693 `inlineImg backgroundColor:'#EEEEEF'`** 就地；**L695 `backgroundColor:'#000'`**（视频黑底合理）。
- L507/517/521 JSX `!mine && { color: palette.label }` 覆盖 OK，但 mine 分支走 `styles.msgTextMine` 白字 —— 蓝底白字固定，双主题不随 palette，属硬编码残留。**高优先**。
- L514 play icon `color={mine ? '#FFFFFF' : palette.tint}` —— 白字控制，合理但就地。

### B. isDark 双分支
- **L285** isDark；**L640/L650 传给 `CenterSpinner dark={isDark}`**、VideoLibrary 同理。无 `containerDark` 死样式（screen 用 palette.background L478/L583 ✅）。isDark 本身仅喂给 CenterSpinner，改 palette spinner 后可删。

### C. 页头
- 两屏均 ScreenHeader（L479 会话内 / L584 列表）✅；refresh 按钮 TouchableOpacity L585 无 activeOpacity、触区小。会话标题用 convName ✅。布局一致 ✅。

### D. 按压反馈
- L585 刷新、L513 mediaBtn（`TouchableOpacity` backgroundColor fill2）、L534 flipChip、L556 充值、L573 sendBtn —— 均无 activeOpacity。媒体按钮点击在视频播放/收起切换间**无任何视觉反馈**（只切播放状态）。建议 ScalePressable。高优先。
- L608 convCard `activeOpacity={0.88}` ✅。

### E. 动画
- L498 / L607 `FadeInView delay index<12` ✅（已带首屏限制，符合惯例）；L587 页面 FadeInView ✅。无 native driver 违规。
- L423 `scrollToEnd animated:false` 直跳，首屏无滚动动画（可接受）。

### F. 空/载/错态
- **L527 会话消息空态 `ListEmptyComponent` 裸 Text**（loading 时又不显示，L527 `loading ? '' : t('暂无消息')`）——建议 EmptyState。
- 列表页 L639-646：loading 用 CenterSpinner dark、error 用 **ErrorState（统一 ✅）**、空态用裸 Text —— 三态内一致度参差。建议空态统一 EmptyState。中优先。
- L642 `ErrorState … onAction={() => loadConvs()}` ✅ 统一组件用到了。

### G. 间距/圆角
- L696/707 borderTop hairline ✅；L709 input `borderRadius:18`(button)、L710 sendBtn 18 ✅；L684/685/686 bubble `borderRadius:16`（=md ✅ 但搭配 `borderTopLeftRadius:6/16` 自绘气泡尖角风格，全局气泡无 token，低-中优先）。
- L693 inlineImg 200×200 固定，未用 aspectRatio；L699 flipChip `borderRadius:10`。

### H. 其它
- **L504 覆盖逻辑与 L685/L686 死样式并存**（见 A），深层重构气泡配色时应一并清理。
- L569 TextInput placeholder 与 L566 `backgroundColor: palette.surfaceGlassStrong`，但 L562 inputBar 与 L530 flipBar 都用 `palette.surface` + `borderTopColor` —— 双底重复，视觉上输入条与列表同色无分隔层次，建议 inputBar 用 surfaceGlassStrong。
- deadimport：L29 MaterialCommunityIcons（用 ✅）；L16/L21/L22/L30 均在用；核对 L14 `StackNavigationProp` 用 ✅。

---

## 5. BilibiliLiveScreen.tsx（B 站直播/播放器）

**一句话结论：播放器控制层动画已用 native driver 且最规范；但列表页仍是 isDark 死分支 + 就地品牌粉 + 玩家错误贴条手写；控制栏动画生硬（仅 fade 无 easing）可优化。**

### A. 硬编码颜色
- **L304 header 刷新用 `<ActivityIndicator color="#ff6f91">`** —— 就地粉，应 `palette.tint`。
- **L363 `refresh: { fontSize:12, color:'#ff6f91' }`** 就地品牌粉，改 palette.tint。
- **L388 `liveDot: '#4caf50'`、L389 `offlineDot: 'rgba(0,0,0,0.25)'`** —— 就地状态色；dark 下 offlineDot 黑 25% 几乎不可见，应 `palette.labelTertiary` 或 semantic.success（#34C759），offline 用 `palette.fill2`。中优先。
- L377 playerError `backgroundColor:'#1C1C1F'`（深色贴条，player 背景已是 #000，专贴竖屏可读，合理）、L378 `#fff` 字、L374-376 `#000` 播放页合理。
- L380 webFallbackBtn `#ff6f91` 就地粉 → 如需可 palette.tint。

### B. isDark 双分支
- **L36** isDark；**L301 `[styles.container, isDark && styles.containerDark]`**；**L362 containerDark 死样式**。删除。高优先。

### C. 页头
- 列表页 ScreenHeader（L302）✅；播放页（L199-297）**自绘沉浸 header（PlayerTopBar）覆盖 ScreenHeader——这是设计意图（B站式沉浸顶栏）✅**，非违规。但 PlayerTopBar 是独立组件（media/PlayerChrome），可读性依赖 controlsOpacity 动画。
- L302 right 在 loading 时显示 spinner、否则 refresh —— 无 activeOpacity（L306）。

### D. 按压反馈
- L306 refresh TouchableOpacity 无 activeOpacity。
- L241/L245 webFallbackBtn —— 无 activeOpacity。
- L326 列表 roomItem `TouchableOpacity` **无 activeOpacity**（默认 0.7 半透）。建议 ScalePressable 或补 0.85。
- L257 TouchableWithoutFeedback toggleControls（点击层）无反馈——但这是「点击唤出/收起」UI，无按压反馈可接受（非破坏）。

### E. 动画
- **控制层动画：L62/L67/L74 `Animated.timing(controlsOpacity,… useNativeDriver: true)`** ✅ 合规。
- **L56 `new Animated.Value(1)` + showControls/toggleControls 手动 duration:180 无 easing**（默认 linear）——生硬，建议 `Easing.out(Easing.cubic)` 或复用 motion.duration.fast。中优先。
- **L62/L74/67 fade 只动 opacity，控制栏显隐无位移/缩放**，B站风格一般是 slide —— 可视要求决定是否加 translateY。
- L324 列表 FadeInView delay index<12 ✅。

### F. 空/载/错态
- L342-350 空/载手写：ActivityIndicator + 裸 Text；L311 status 条、L312 fetchError retryBtn 手写。建议 CenterSpinner/EmptyState/ErrorState 统一。中优先。
- 播放错误 L237-250 用独立浮层（合理，播放页内嵌）。
- L103 列表加载失败只 setStatus（Text），无重试按钮 —— 列表加载失败应提供 ErrorState 重试。中优先。

### G. 间距/圆角
- L382 roomItem `padding:12, marginHorizontal:16, marginVertical:4, borderRadius:16`(=md ✅)；L383 `borderRadius:12`(icon)；L387 statusDot `borderRadius:6`(pill→半径 6 非 999，小圆点可接受)；L364 status `borderRadius:14`；L371 retryBtn `borderRadius:16`。相对统一。

### H. 其它
- **L92/L93 tabBarStyle 控制**：`parent?.setOptions({tabBarStyle:{display:'none'}})`,播放时隐藏 tabbar，返回恢复 ✅ 合理。
- **L83-85 `bilibiliScreen` 用 `Dimensions.get('window')`** 取宽高，横竖屏旋转后不实时更新（不用 useWindowDimensions），旋转动画期若 orientation 变化可能尺寸错位——建议 `useWindowDimensions()`。中优先。
- L215-216 `flex:1` + width/height 用 window 值硬算，旋转后 videoBox 可能不 refresh。
- deadimport 核对：`Animated`（用）、`AppState`（用）、`Dimensions`（用）。

---

## 6. VideoLibraryScreen.tsx（视频库）

**一句话结论：三态用统一组件（EmptyState/ErrorState/CenterSpinner）是最合规一页，但网卡上就地 `#ff6f91`/`#000`/rgba 遮罩分档多、bannerTitle 底存在 shadow、以及 `backBtn` 硬编码粉；isDark 仅喂 spinner。**

### A. 硬编码颜色
- **L265 `backBtn: { color:'#ff6f91' }`**（即使 L150 JSX 有 `{ color: palette.tint }` 覆盖内联，最终取 palette.tint ✅，**但样式里写死 #ff6f91 是残留，可删字】）。中优先。
- L280-282 bannerShade1/2/3 rgba 渐变遮罩（合理）；L284/285 overlay 白字+textShadow（图片上信息，合理）；L294 bannerDuration 白字；L214 bannerDuration 背景 `rgba(0,0,0,0.6)`（合理）。
- L295/L297 bannerInfo/bannerTitle **未出现在 JSX（bannerInfo 结构用 bannerInfoOverlay 覆盖）→ L296-297 死样式**（bannerInfo：padding:12、bannerTitle、bannerMeta）。
- L313/314 playerPage/videoPlayer `#000` 合理。

### B. isDark 双分支
- **L72** isDark，仅喂给 L156/L222 CenterSpinner `dark={isDark}`；无 containerDark 死样式（container 透明 ✅）。改用 palette spinner 后删 isDark。

### C. 页头
- 用 ScreenHeader（L148 列表 / L140 播放）✅；backBtn（L149-151）TouchableOpacity 无 activeOpacity、无 hitSlop。标题/布局一致 ✅。播放页在 #000 上叠 ScreenHeader 与 RoomAlbum/OpenLive 同类问题（低）。

### D. 按压反馈
- L149 刷新、L190 bannerCard `activeOpacity={0.9}` ✅、L225 gridCard `activeOpacity={0.9}` ✅ —— 刷新按钮补 activeOpacity。其余尚可。

### E. 动画
- L224 gridItem FadeInView delay index*30 **无 `index<12` 首屏限制**（同 OpenLive L354 问题），应加。中优先。
- L167 页面 FadeInView ✅；无 native driver 违规。

### F. 空/载/错态
- **统一组件使用最佳 ✅**：L155-156 CenterSpinner、L158-161 ErrorState（onAction=load(true) ✅）、L162-165 EmptyState（icon play-box-outline ✅）。唯一小问题：L153 status 与 L154 loading 状态互斥显示，逻辑 OK。
- 播放失败（L133 setStatus 文本，L141 onError setPlayUrl('')）—— onError 直接关闭播放器无错误提示，建议用 StateView 或在关闭后 toast。中优先。

### G. 间距/圆角
- L268 listContent `paddingHorizontal:12`；L273 bannerCard `borderRadius:16, marginHorizontal:4`(=md)；L277 bannerCover `height:196`（硬值非 token）；L302 gridCard `borderRadius:14`（vs banner 16 —— **同页卡片圆角 16/14 不统一**）；L291 bannerDuration `borderRadius:10`；L311 gridTitle 14/19。中优先（网格卡与 banner 圆角统一为 16）。

### H. 其它
- **L296-297 死样式 bannerInfo/bannerTitle/bannerMeta**（见 A），删除。
- **L169 `videos.length > 1 ? videos.slice(1) : []`** —— 第一个视频被切成 banner 展示（ListHeader L180-221 展示 videos[0]），数据源 `data` 故意去掉第 0 项，逻辑正确但依赖 `videos` 顺序稳定；若接口乱序 banner 与网格会重复/缺失，属数据鲁棒性风险（低）。
- L181 `videos.length > 0` 与 L169 `>1` 组合：只有 1 条时网格空但 banner 有 —— 可接受。
- deadimport：`Image` 用；L12 useNavigation 用（但 navigation 未实际调用 —— L71 **`navigation` 声明但函数体内未用**，仅在 useNavigation()，删或留）。低优先。

---

## 优先级总排序

**必须尽快（高）**
1. P0-1：6 页 isDark/useAppTheme + `containerDark` 死样式 + `CenterSpinner dark` 清理。
2. P0-2：无 activeOpacity / 无 scale 的 TouchableOpacity 统一换 ScalePressable 或补反馈（RoomAlbum L253/262/268/282；RoomRadio 全按钮；OpenLive L285/297/307/313；PrivateMessages L513/534/556/573/585；Bilibili L306/326/241；VideoLibrary L149）。
3. P0-3：就地品牌粉 `#ff6f91` → palette.tint（OpenLive L379/401、Bilibili L304/363/380、VideoLibrary L265）；就地错误/标签色 → palette.tint/palette.danger（OpenLive L289）。
4. PrivateMessages 气泡硬编码 `#7BC6FF`/`#FFFFFF`/`#fff` → palette 语义色，删 L504/L686 冲突死分支。
5. 空/载/错统一：RoomAlbum L305/279/L290、RoomRadio 全三态、OpenLive L335-347、Bilibili L342-350、PrivateMessages L527/L639 —— 统一 EmptyState/CenterSpinner/ErrorState。

**中**
6. 列表入场动画 index<12 限制：RoomAlbum L334（无限制）、OpenLive L354、VideoLibrary L224。
7. Bilibili 控制层动画加 easing（L62/67/74）；offlineDot 用 palette（L389）；Dimensions → useWindowDimensions（L82-85）。
8. VideoLibrary 卡片/banner 圆角统一 16（L302 vs L273）。

**低/清理**
9. 死代码/死 import：RoomAlbum L7 Image、L132/L319 isDark 链；RoomRadio L32 playerRef；OpenLive L8 FlatList；VideoLibrary L71 navigation、L296-297 死样式；PrivateMessages L686 死样式。
10. modePill 硬圆角 14 → 用 Pill 组件（RoomRadio L157）。

---

## 附：复用提示
- 统一按钮：`ScalePressable`（Motion.tsx）或 `Pressable` pressed scale 0.96/0.9。
- 统一空/载/错：`EmptyState`/`ErrorState`（StateViews.tsx）、`CenterSpinner`（Loaders）。
- 卡片：`GlassCard`（玻璃）或 `palette.surface`。
- 圆角：`radiiAlias.card`(16)/`button`(18)/`chip`(999)；间距：`spacing.*`/`insets.*`；排版：`typography.*`。
