# 牙牙消息 移动端 UI 审计报告（批 b2）

审计项目：`E:\yymsg\yaya_msg_mobile`（RN + Expo + TS，口袋48 第三方客户端，v2.6.5）
审计范围：6 个屏幕文件（LoginScreen / RechargeScreen / FetchScreen / FlipScreen / ProfileScreen / PhotosScreen）
审计基准：`src/theme/*` + `src/components/{ScreenHeader,AppScaffold,ListItem,GlassCard,EmptyState,StateViews,Skeleton,Motion,SectionHeader,Pill,Button,Loaders}.tsx`

> 说明：`Colors`/`DarkColors` 兼容常量、`useAppTheme()` 返回的 `isDark`、以及 `CenterSpinner dark` 参数均视为旧式硬编码残留（项目约定明确要求改用 `usePalette()` 单一来源）。各页问题按严重度（P0 阻断 / P1 高 / P2 中 / P3 低）排序，"改哪里、改成什么"在每条内给出。

---

## 通用约定核对（设计规范 vs 现状）

| token | 规范值 | 各页实际使用 |
|---|---|---|
| spacing tokens | 2xs=4 / xs=8 / sm=12 / md=16 / lg=20 / xl=24 | 广泛内联数字，未用 token |
| radii tokens | xs=6 / sm=10 / md=14 / lg=20 / xl=28 / pill=999 | 广泛硬编码 14/16/18/20/12 |
| radiiAlias | card=16 / button=18 / chip=pill | 未使用 |
| 按钮圆角 | radiiAlias.button = 18 | 各页自绘 18 但手写 |
| 卡片圆角 | radiiAlias.card = 16 | 多数 16，混有 14/18/20 |
| typography | 梯度 token | 全部手写 fontSize/fontWeight，零 token 引用 |
| 屏幕左右安全留白 | insets.screenHorizontal = 20 | 各页用 16，不一致 |
| motion | duration/spring 曲线 | 全站未用 motion.token |

---

## 1. LoginScreen.tsx（624 行）

**核心问题：硬编码颜色残留最严重、样式表与 JSX 内联样式双轨混乱、大量死代码（`Dark` 系列 + `false` 伪 prop），且按钮/卡片全部弃用统一组件。** 这是 6 个文件里技术债最重的。

### A. 硬编码颜色字面量
- [P1 · L587] `sectionTitle: { color: '#333' }` → JSX L423 已覆盖 `palette.label`，样式表这个 `color` 是死值。
- [P1 · L588] `input`：`borderColor:'rgba(255,255,255,0.52)'`、`backgroundColor:'#FFFFFF'`、`color:'#333'` — 被 JSX L437/439/470/541/556 全部覆盖，实为死代码。
- [P1 · L591] `areaWrap` 同样 `rgba(255,255,255,0.52)` / `#FFFFFF`（JSX L425 覆盖）。
- [P1 · L592] `areaPlus: { color:'#555' }` → 被 JSX L426 `palette.label` 覆盖。
- [P1 · L597] `btn`: `backgroundColor:'#4a4a4a'` → JSX L458 用 `palette.fill2`；`#4a4a4a` 是死值。
- [P1 · L598] `btnPrimary: backgroundColor:'#ff6f91'` → JSX L461 用 `palette.tint` 覆盖；死值。
- [P1 · L601] `status`、[P1 · L602] `biliStatus`：`color:'#444'/'#555'` 被 JSX L577/L528 覆盖。
- [P1 · L604] `tokenInfo: color:'#4caf50'`（绿色成功态）→ JSX L534 未传色，实显绿色但未随主题。应改用 `palette.semantic`（Colors 无该语义字段；需要时 `palette.labelSecondary` 即可）。
- [P1 · L605] `metaLine: color:'#4a4a4a'` 被覆盖。
- [P1 · L607] `accountRow: backgroundColor:'#FFFFFF'` → JSX L506 用 `palette.surface` 覆盖；残留。
- [P1 · L609] `accountRowActive: borderColor:'#ff6f91', backgroundColor:'rgba(255,111,145,0.16)'` → JSX L506 未传这些，实际生效的是这个硬编码；但 tint 变体会走 `accent.pinkDark`，这里写死 `#ff6f91` 在 dark 下不对。改成 `{ borderColor: palette.tint, backgroundColor: palette.tintSoft }` 由调用处传。
- [P1 · L611] `accountName color:'#333'` 被 JSX L511 `palette.label` 覆盖。
- [P1 · L613] `accountAction color:'#ff6f91'` → JSX L514 用 `styles.accountAction`，实际生效，dark 下不对；应 `palette.tint`。
- [P1 · L614] `accountCurrent color:'#20a464'`（绿色）→ JSX L514 用 `styles.accountCurrent`，实际生效且不随主题；应 `palette.semantic.success`。
- [P1 · L615] `verifyBox`：`#ffb3c1`/`rgba(255,111,145,0.08)` → JSX L441 用 `palette.fill2`+`innerStroke` 覆盖（但圆角样式里 `#ffb3c1` 未覆盖，border 用的是 cover 值；见 B）。
- [P1 · L617] `verifyQuestion color:'#c2185b'` → 被 JSX L442 `palette.label` 覆盖。
- [P1 · L619] `verifyOption backgroundColor:'#fff'` → JSX L447 覆盖；`borderColor:'#ffb3c1'` 未被覆盖，实际生效（死色）。
- [P1 · L621] `verifyOptionText color:'#c2185b'` → 被 JSX L451 `palette.label` 覆盖。
- [P2 · 全文件] 大量 `rgba(...)`/`#hex` 虽被 JSX 覆盖但仍是死样式，建议清理，避免后续误用。

### B. isDark 双分支 / theme 分支
- [P1 · L584] `containerDark`、[P1 · L589] `inputDark`、[P1 · L608] `accountRowDark`、[P1 · L616] `verifyBoxDark`、[P1 · L620] `verifyOptionDark`、[P1 · L622] `textDark`、[P1 · L623] `textSubDark` — 全部已定义但**无任何 JSX 引用**，均为死代码（`isDark` 双分支残留的产物）。整类删除。

### C. 页头/布局
- [P2 · L419] 正确使用 `<ScreenHeader title={t('账号设置')} />` ✅。
- [P2 · L418] `style={[styles.container, false]}` 和 `contentContainerStyle={styles.content}` 中 `false` 是伪 prop（数组里放布尔无效），多处存在（L422/467/492）——死代码，删。
- [P2 · L422/467/492/522/537/569] 每段 `section` 都手写玻璃卡：`{ backgroundColor: palette.surfaceGlass, borderColor: palette.innerStroke, borderRadius: 20 }`。应统一用 `GlassCard`（内部已含 surfaceGlass+innerStroke+shadow），取消手写。
- [P2 · L585] `content: { paddingBottom: 32 }` 与顶部无统一屏边留白；section 用 `marginHorizontal:16` 而规范 `insets.screenHorizontal=20`。

### D. 按压反馈
- [P1 · L445-453] `verifyOptions` 的 `TouchableOpacity` 缺 `activeOpacity`（默认 0.2 但非显式，且无 pressed scale）。改 `ScalePressable`。
- [P1 · L458/461] `handleSendSms`/`handleLogin` 按钮用 `TouchableOpacity` + `styles.btnDisabled(opacity)`，无按压 scale。改统一 `Button` 或 `ScalePressable`。
- [P1 · L478/485] `保存Token`/`检查Token` 同上。
- [P1 · L497] `刷新账号列表`，[P1 · L504] `accountRow`（`TouchableOpacity` 无 activeOpacity），[P1 · L524] `btnPrimary`（handleBiliQr，无 activeOpacity），[P1 · L530] `qrRetryBtn`，[P1 · L548/551] `读取资料`/`修改昵称`，[P1 · L564] `选择本地图片上传头像`——**全部 12 个可点击区**均无统一按压反馈。
- [P2 · L447] 验证码选项按钮重复使用 `@click`，disabled 态只靠 `palette.surfaceGlassStrong` 无视觉区分（结合 opacity）。

### E. 动画
- [P2 · L421] `<FadeInView delay duration>` 引入 ✅，但 [P1 · L421] `FadeInView` 把**一整屏**内容（含 WebView、多 segment）包成一个节点，入场时整屏 y 位移，视觉不精细；内部各段无错峰。
- [P2 · 无列表] 账号切换列表（L500）为静态 map，无入场动画。
- [P0 · L527] `<WebView>` 无 `useNativeDriver` 约束问题（原生组件），但作为 QR 展示直接用 SVG HTML 嵌入，视觉粗糙；建议统一到 `FadeInView` 包裹的图片预览。

### 其它 UI 问题
- [P1 · L583] `container: backgroundColor:'transparent'` ✅，但页面顶端 `ScreenHeader` 之后无内容底部安全区（`paddingBottom` 32 可能不够，Tab/Home indicator 遮挡），用 `insets`。
- [P2 · L489] `已保存Token：{token}` 用了 `maskToken(settings.p48Token)`，若 token 为空则显示空；nil 防护。
- [P2 · L514] `Text style={isCurrent ? styles.accountCurrent : styles.accountAction}` — 两分支都非随主题色（见 A 的 L613/614），需同时修。
- [P3 · L237-255] `handleCheckToken` 与 `handleLoadProfile` 大量重复状态管理逻辑，可抽取 hook。

---

## 2. RechargeScreen.tsx（173 行）

**核心问题：相对干净，但 refresh 按钮/重试按钮/loading 三处自绘替代统一组件；`#FFFFFF` 硬编码残留；页头 right 按钮无按压反馈。**

### A. 硬编码颜色
- [P1 · L126] `actionText color:'#ff6f91'` → 被 JSX L56 `palette.tint` 覆盖，死值。
- [P1 · L159] `refreshBtnText` / [P1 · L172] `webRetryText`：`color:'#fff'` → 被 JSX L89 `#FFFFFF`（icon）和 L90 `refreshBtnText` 使用，实际生效。白字在 tint 底上可接受，但应统一走 `Button` 的 fg 逻辑。
- [P1 · L160] `web: backgroundColor:'#FFFFFF'` — WebView 底固定白，flash 风险；可改用 `palette.surface`（Android WebView 底不支持透明，此项可留，标注）。

### B. isDark 分支
- 无显式 `isDark`。✅

### C. 页头
- [P2 · L54] 使用 `<ScreenHeader right={...}>` ✅。但 L55 自绘 `刷新余额` 文本按钮，与 FlipScreen L430、各页 ScreenHeader `right` 布局一致（同 style 56pt 侧栏），字号 `fontSize:13/14` 与其它页 `right` 文本不太统一（Flip 用 14/700，此页 13/800）。

### D. 按压反馈
- [P1 · L55] 页头 `刷新余额` `TouchableOpacity` 无 activeOpacity/scale。
- [P1 · L84-91] `refreshBtn` `TouchableOpacity` 无按压反馈（有 disabled loading）。应改 `ScalePressable` 或 `Button`。
- [P2 · L115] `webRetryBtn` `TouchableOpacity` 无按压反馈。

### E. 动画
- [P2 · 加载与错误层] `renderLoading`（L103）和 `webErrorWrap`（L111)直接条件切换，无淡入。建议错误层用 `FadeInView` 包裹，或用统一 `ErrorState`（但此页是 overlay 在 WebView 上，不宜拆组件；至少加 FadeInView）。
- [P2 · L93] WebView 切换 loading→内容生硬，可用 `Animated` opacity（native driver）过渡。

### F. 空/载/错态
- [P2 · L103-108] loading 为自绘 `<ActivityIndicator>`+文本，与 `CenterSpinner` 重复（但这里需要绝对定位盖住 WebView，属合理自定义；建议抽取 prop 复用样式）。
- [P2 · L111-119] webError 为自绘 icon+text+重试，语义上与 `ErrorState` 重复；因是 WebView overlay 可保留但把按钮换成 `Button`。
- [P3 · 余额卡] L23-27 `balance` 为空态用 `'暂无数据'` 文本，符合轻量需求。

### G. 间距/圆角
- [P2] 多处手写 `borderRadius:16/14/18`、`marginHorizontal:16` — 与 token 一致但未引用 token；建议统一 `radiiAlias.card/button`、`insets.screenHorizontal`。

### 其它
- [P3 · 拓扑] L29 `useEffect(()=>{refreshBalance()},[])` 在 `refreshBalance` 定义前调用（函数提升 OK），但 `loading` 初始 false 会真实发请求，符合预期。
- [P3 · L174+未用] 无死代码。

---

## 3. FetchScreen.tsx（210 行）

**核心问题：`isDark && styles.containerDark` 双分支残留（虽被覆盖为 transparent，属死代码）；模式按钮/抓取按钮自绘、无按压反馈；列表入场动画按 index 错峰会随数据分页重建。**

### A. 硬编码颜色
- [P2 · L140/143/149/152] `color: active ? '#FFFFFF' : palette.labelSecondary` — 选中态白字写死，dark 下 tint=accent.pinkOnDark 仍可承载白字，但应统一走 `Button`/`Pill` 的 fg 逻辑，或 `palette` 取对白。可接受但建议抽组件。
- [P2 · L202] `fetchBtnText color:'#fff'` → JSX L157 `styles.fetchBtnText`，实际生效。

### B. isDark 分支
- [P1 · L58] `const isDark = useAppTheme();` 仅用于 [P1 · L129] `isDark && styles.containerDark`（transparent）+ [P2 · L186] `CenterSpinner dark={isDark}`。`containerDark`（L195）是 `backgroundColor:'transparent'` 的死分支。
- [P2 · L129] `style={[styles.container, isDark && styles.containerDark]}` — 应删除 `containerDark` 与 `isDark`，容器本身透明即可。
- [P2 · L186] `CenterSpinner dark={isDark}` → 应改用 `CenterSpinner` 默认（内部已按 `usePalette` 无感知，实际 `dark` 仅决定 `#ff8fa8` vs `#ff6f91`，与主题脱节——见 Loaders L31）。`isDark` 从 `useAppTheme()` 取，非 palette，存在主题漂移。

### C. 页头
- [P2 · L130] `<ScreenHeader title={t('抓取消息')} />` ✅ 无 right，布局一致。

### D. 按压反馈
- [P1 · L139-143] 四个模式按钮 `TouchableOpacity` 无 activeOpacity/scale，且自绘选中填充。应改 `Pill`（已实现 selected + accent + scale 按压）或 `ScalePressable`。
- [P1 · L148-152] 另四个模式按钮同上。
- [P1 · L156] `fetchBtn` `TouchableOpacity` 无按压反馈（有 disabled）。

### E. 动画
- [P2 · L132] `<FadeInView delay duration style={{flex:1}}>` 包整屏 ✅。
- [P2 · L170] 每条消息 `<FadeInView delay={80+index*30}>` ✅ 错峰。但结果集是抓取完一次性 setResults，分页重查时整批重建，且 50 轮 guard 内若超大数据量 index 迟延过大。建议仅对首批做 animation，后续 `delay=0`。
- [P2 · L186] `ListEmptyComponent` 在 loading 时渲染 `CenterSpinner`，加载完成立即切换，无过渡。

### F. 空/载/错态
- [P2 · L186] 空态自绘 `<Text>{t('暂无数据')}</Text>`（`styles.empty`），与 `EmptyState`（图标+标题）语义不一致。应改用 `EmptyState`（但列表内嵌空态小字也可；建议至少统一字号/token）。
- [P2 · L159] 抓取失败仅 `status` 文本（labelSecondary 色），没有可视化错误态；[P2 · L122] 失败分支写 `setStatus(抓取失败…)`，建议失败走 `ErrorState`+重试。
- [P2 · L186] loading 用 `CenterSpinner dark` 而非 `Skeleton`（规范说载态可用 Skeleton；此处抓取中无骨架可展示，可用极简 spinner，合理）。

### G. 间距/圆角
- [P2 · L196] `section`：`padding:14/marginHorizontal:16/borderRadius:16` — 与 token 一致但手写。
- [P2 · L198] `modeBtn borderRadius:14`、L200 `fetchBtn borderRadius:18` — 混用，未走 `radiiAlias`。
- [P2 · L204] `msgItem borderRadius:14`、L196 section 16 — 风格不统一。

### 其它
- [P3 · L129] `View` 容器透明、无背景——在非 dark 模式下页面底色由外层提供，`container` transparent 可接受 ✅。

---

## 4. FlipScreen.tsx（597 行）

**核心问题：最长的文件，send/view 双模式都自绘大量 chip/按钮/状态，无统一组件；`styles.actionBtn '#ff6f91'` 硬编码；空态/错误态不统一；中心化 `$('#FFFFFF'/'#fff')` 硬编码贯穿按钮文字。**

### A. 硬编码颜色
- [P1 · L542] `actionBtn color:'#ff6f91'` → JSX L430 `<Text style={styles.actionBtn}>` 实际生效，dark 下不对。应 `palette.tint`（见 C/D 右按钮）。
- [P1 · L550] `retryBtnText`、[P1 · L573] `sendBtnText`、[P1 · L590] `answerMediaBtnText`：`color:'#fff'` 实际生效。
- [P2 · L330/354] `color: active?'#FFFFFF':palette.labelSecondary`（chip 文字）— 同 Fetch，建议走 `Pill.accent`。
- [P2 · L591] `answerAudio backgroundColor:'rgba(0,0,0,0.08)'`、[P2 · L592] `answerVideo backgroundColor:'#000'` — 视频黑底合理属可接受；音频 `rgba(0,0,0,0.08)` 在 dark 下几乎不可见，建议 `palette.fill2`。

### B. isDark 分支
- [P1 · L171] `const isDark = useAppTheme();` 仅用于 [P1 · L306] `pageStyle = [styles.container, isDark && styles.containerDark]` 与 [P2 · L532] `CenterSpinner dark={isDark}`。`containerDark`: `transparent` 死分支。
- 修法：删 `containerDark`，`pageStyle` 直接 `styles.container`（透明），`CenterSpinner` 去掉 `dark`。

### C. 页头
- [P2 · L311] send 模式 `<ScreenHeader title>` ✅。
- [P2 · L428] view 模式 `<ScreenHeader right>` ✅，但 L429 `发送翻牌` 文本按钮自绘，`styles.actionBtn` 硬编码 `#ff6f91`（见 A L542），且无按压反馈。应传 `palette.tint` 或复用统一 right 组件；与其页（Recharge L55）fontSize 13/800、Flip 14/700 不一致。

### D. 按压反馈
- [P1 · L325] 回复形式 chip、[P1 · L348] 公开设置 chip：`TouchableOpacity` 无按压反馈（有 disabled 时靠 `optionDisabled:opacity`）。应改 `Pill`。
- [P1 · L375] `rechargeBtn` `TouchableOpacity`（tintSoft 底）无按压反馈。
- [P1 · L394] `sendBtn` `TouchableOpacity` 无按压反馈。
- [P1 · L435] `retryBtn` `TouchableOpacity` 无按压反馈。
- [P1 · L493] `answerMediaBtn`（语音/视频播放切换）`TouchableOpacity` 无按压反馈。

### E. 动画
- [P2 · L313/439] `<FadeInView delay duration>` ✅，send 模式包整屏，view 模式包 FlatList。
- [P2 · L473] 每条 flip card `<FadeInView delay={80+index*30}>` ✅ 错峰；但有同一个"分页重建后 index 迟延过大"问题（onEndReached 翻页时新增 index 从 0 重算 → 已含 delay，视觉怪）。建议 `delay={index<12?80+index*30:0}`。
- [P0 · L499-508] 视频/语音播放 `<Video>` 新实例直接挂载，收起再展开才卸载，无过渡；`controls` 原生可接受，但展开瞬间无淡入。建议 `FadeInView` 包裹播放区。
- [P2 · L532] `ListEmptyComponent` 在 loading 时 spinner → 空态文本 → 无过渡；且 `!status` 时才显示空态文本，逻辑脆。

### F. 空/载/错态
- [P2 · L532] 空态自绘 `<Text>'暂无翻牌记录'</Text>` 非 `EmptyState`（无图标）；错误态靠 L433 status 文本 + L434-438 `retryBtn` 自绘，语义上就是 `ErrorState`+重试。建议 view 模式用 `ErrorState`（含重试）与 `EmptyState` 统一。
- [P2 · L433] `{失败|错误/.test(status) ? palette.danger : palette.tint}` — status 即用作文本也是错误开关，耦合；建议拆出 `error` state。

### G. 间距/圆角
- [P2 · L551/577] `section`/`card` 同 `padding:14/marginHorizontal:16/borderRadius:16`；[P2 · L554] `optionChip borderRadius:16`、L569 `sendBtn 18`、L570 `rechargeBtn 14`、L589 `answerMediaBtn 14` — 圆角数值面广但多为 14/16/18，建议规整到 `radiiAlias`。
- [P2 · L581/583] `typeTag/privacyTag borderRadius:6` ≈ `radii.xs`。
- [P2 · L595] `monthGroup`、L596 `empty` 手写。

### 其它
- [P3 · L170] `Animated` 未直接用异常——但 L473 FadeInView 已用 native driver ✅。
- [P3 · L532] `FlatList` 内 `ListEmptyComponent` 用 `loading ? spinner : !status ? text : null` 三重已定，可读性差，拆为显式空态组件。
- [P3 · L499] 播放按钮文案 L497 一长串三元，可读性差（不属 UI token 问题，列为代码质量）。

---

## 5. ProfileScreen.tsx（273 行）

**核心问题：页面本身 palette 化较好，但空态/错误态自绘（`notice` 用 `#ff9800` 硬编码、`emptyCard` 用文本而非 `EmptyState`）；`isDark`/`containerDark`/`CenterSpinner dark` 双分支；`infoItem width:'48%'` 布局脆。**

### A. 硬编码颜色
- [P1 · L246] `notice borderLeftColor:'#ff9800'`（橙色警示条）→ JSX L115 `<View style={[styles.notice,…]}>` 实际生效。应改 `palette.semantic.warning`（Colors 兼容层无 `warning`，需用语义色）或 `palette.tint`。
- [P2 · L256] `retryBtnText color:'#FFFFFF'` 实际生效。
- [P2 · L253] `photoTitleText` 在 PhotosScreen，非本文件。此处 [P2 · L265] `photoItem` 纯样式，无硬编码色。

### B. isDark 分支
- [P1 · L54] `const isDark = useAppTheme();` 用于 [P1 · L94] `isDark && styles.containerDark`（透明死分支）+[P2 · L217] `CenterSpinner dark={isDark}`。删 `containerDark`/`isDark`，`CenterSpinner` 去 `dark`。

### C. 页头
- [P2 · L95] `<ScreenHeader title>` ✅。但 [P2 · L94] `ScrollView` + ScreenHeader 组合与其它页一致 ✅。

### D. 按压反馈
- [P1 · L118-124] `retryBtn` `TouchableOpacity` 无按压反馈。
- [P2 · L130-137] infoGrid 的 `InfoItem`（L222-228）非交互，无按压需求 ✅。
- [P1 · 成员切换/选择] 由 `MemberPicker` 处理 ✅。

### E. 动画
- [P2 · L97] `<FadeInView delay duration>` 包主体 ✅（含大量内容）。此页无列表错峰（fanRanks/history 用 `slice().map` 静态渲染），无入场动画；量大时一次性 map 渲染，非滚动优化。
  - [P2 · L190] 粉丝排行最多 10 行，[P2 · L205] 重要经历最多 20 行，都 `<View>.map`，应改用 `.map`+`FadeInView` 或保持简单；量小可接受，标注。

### F. 空/载/错态
- [P2 · L180-185] 未选成员空态自绘 `emptyCard`：`emptyTitle`+`emptyText`，非 `EmptyState`（无图标）。建议 `EmptyState icon title description`。
- [P2 · L114-126] 在线档案不可用的 `notice` 是自绘错误提醒（含重试按钮），语义接近 `ErrorState` 但被设计为"降级提示"（保留本地库资料），位置在卡片内，可保留但改用 `palette.semantic.warning` 色 + 统一 `Button`。
- [P2 · L217] `CenterSpinner dark` 只有 loading 才盖在 ScrollView 底部，位置偏（不是整屏居中），建议用 `FadeInView` 或统一。
- [P3 · L181] `emptyCard` 与 [L236/L237] `card` 重复定义结构，可合并。

### G. 间距/圆角
- [P2 · L236/237] `card/emptyCard borderRadius:16` = radiiAlias.card ✅ 数值对，但手写。
- [P2 · L259] `infoItem width:'48%'` + `gap:8` — 两列会有 4% 残留间隙，窄屏下可能溢出/换行；建议 `flexBasis` 或 `width:'48.5%'` 并用 `flexWrap` 修正，或用 FlatList numColumns=2。
- [P2 · L242/244] `avatar borderRadius:34`(68/2 圆形 ✅)、L241 avatar 68。L265 photoItem borderRadius:12。

### 其它
- [P3 · L222-228] `InfoItem` 接收 `palette:any`（类型未用 Theme 类型），可改为 hook `usePalette()` 内部取，减少 props 穿透。
- [P2 · L104-112] `profileHead`+`slide` 静态，粉丝排行/经历无切分动画。

---

## 6. PhotosScreen.tsx（255 行）

**核心问题：状态处理最完善（用 EmptyState/ErrorState ✅）但 `isDark`/`CenterSpinner dark` 尚存；卡片外阴影/标题遮罩 `rgba(0,0,0,0.42)` 属合理；`EmptyState` 的 `icon` prop 传字符串不生效（应为 ReactNode）。**

### A. 硬编码颜色
- [P1 · L253] `photoTitleText color:'#FFFFFF'` + `textShadowColor:'rgba(0,0,0,0.6)'` — 图片标题覆盖文本，白字+阴影属合理（可接受）。
- [P2 · L251] `photoShade backgroundColor:'rgba(0,0,0,0.42)'` — 图片底部渐变遮罩属合理。
- [P2 · L247] `status color: labelSecondary` ✅ palette。
- 无其它明显硬编码 UI 文字色。

### B. isDark 分支
- [P1 · L96] `const isDark = useAppTheme();` 仅用于 [P2 · L212] `CenterSpinner dark={isDark}`。`container`（L245）透明，无 `containerDark`。去 `dark` prop 或改接 palette。

### C. 页头
- [P2 · L203] `<ScreenHeader title />` ✅ 无 right。

### D. 按压反馈
- [P2 · L184] 照片点击 `TouchableOpacity activeOpacity={0.9}` — 有 activeOpacity，但仅 0.9 无 scale；可保持（图片场景 0.9 足够）。onLongPress 下载无反馈，可接受。
- [P1 · 可交互点] `MemberPicker`/`ZoomImageModal` 由组件负责 ✅。

### E. 动画
- [P2 · L204] `<FadeInView style={{flex:1}}>` 包整屏 ✅。
- [P2 · L181] 每张照片 `<FadeInView delay={index<12?80+index*30:0}>` ✅ 已对前 12 张错峰、后续 delay=0（比其它页更正确，可作为其它页范本）。
- [P0 · L209] `ZoomImageModal` 缩放动画是否用 native driver 由该组件决定（未在本次范围）；若该组件用 RN `Modal`+`Animated` 且未 `useNativeDriver:true`，需单独审。标注待查。
- [P2 · 列表切换] 换成员时 `setPhotos([])` + loading spinner 交替，无过渡。

### F. 空/载/错态（本页最佳实践 ✅）
- [P2 · L214] `ErrorState`（含重试 action）✅ 统一。
- [P2 · L218] `EmptyState` ✅ 统一。
- [P1 · L220] `EmptyState icon="image-multiple-outline"` — 传了 `icon` 字符串，但 `EmptyState` 期待 ReactNode（见组件 L24 `{icon ? <View>{icon}</View>}`，字符串会渲染纯文本）。要么传 `<MaterialCommunityIcons …>`，要么用 `StateViews.EmptyState`（其 icon 是字符串 `glyph` 走 MCI）；当前混用导致图标文本化或失效。**需修。**
- [P2 · L210] loading 用 `CenterSpinner dark`（在 `flex:1` 容器内）。

### G. 间距/圆角
- [P2 · L246] `pickerWrap padding:16`，[P2 · L248] `list padding:10, paddingBottom:40`，[P2 · L249] `photoCard margin:4/borderRadius:16` — 2 列网格 `margin:4`(gap 8px)，`list padding:10`+`card margin:4` 与 16px 屏边留白不一致（总边距约 14px）；建议统一 `insets.screenHorizontal` + `gap` token。
- [P2 · L249] `photoCard borderRadius:16` ✓。

### 其它
- [P3 · L177] `const url = photoUrls[index] || deepFindImageUrl(item)` — `photoUrls` useMemo 与 renderItem 的 index 弱关联，深层重排时可能错位；建议在 `photos` map 时直接附 url。
- [P3 · L174] `photoUrls` useMemo 每张照跑 `deepFindImageUrl`（重复计算已 merge 过的逻辑）。

---

## 跨页共性问题（Top 3）

1. **按压反馈缺失高发**：6 页共约 30+ 个 `TouchableOpacity` 只设了 `disabled`/`opacity` 或完全无 `activeOpacity`/scale，未用 `ScalePressable`/`Button`/`Pill`。Fetch/Flip/Login 尤其严重。修法：交互按钮统一收敛到 `Button`，chip/segment 用 `Pill`，列表行用 `ListItem` 或 `ScalePressable`。

2. **`isDark`/`useAppTheme` 双分支与 `CenterSpinner dark` 贯穿全站**：Fetch(L58/L186)、Flip(L171/L306/L532)、Profile(L54/L94/L217)、Photos(L96/L212) 四页都引入了 `isDark`；`useAppTheme()` 非 palette 单一来源。全部删 `isDark`/`containerDark`，`CenterSpinner` 去掉 `dark`（其内部 `#ff8fa8/#ff6f91` 已是旧式残留，需改成 `palette.tint`）。

3. **空态/错误态/加载态与 token 风格全站不统一**：Fetch(空态文本 + status 即错误)、Flip(空态文本 + 自绘 retry)、Profile(emptyCard + 橙色 notice)、Login(纯 status 文本)未走 `EmptyState`/`ErrorState`/`Skeleton`；同时全站 fontSize/borderRadius/margin 全部手写、零引用 `typography`/`radiiAlias`/`spacing` token。

### 次要跨页（附列）
- 卡片统一 `GlassCard`：Login 6 个手写玻璃段、Recharge/Flip/Fetch/Profile 手写 `surface+hairline` 卡片。
- 右栏 header 文本按钮（Recharge L55 / Flip L429）字号 13 vs 14 不一致，且 `#ff6f91` 硬编码。
- 列表错峰动画分页重建：仅 Photos 正确处理（`index<12` 才 delay），Fetch/Flip 全量 `index*30`。
