# UI 审计报告 · tab5（Home / Messages / Media / FollowedRooms / Settings）

> 项目：yaya_msg_mobile v2.6.5 · 审计日期：本会话
> 基准：src/theme（tokens）与 src/components（ScreenHeader/AppScaffold/ListItem/GlassCard/EmptyState/Skeleton/StateViews/Motion/SectionHeader/Pill/Button）。
> 阅读材料：theme/*.ts 全部、components 全部、5 个 screen 完整读取。
> 说明：所有行号以本次读取为准；`rgba(0,0,0,…)` 遮罩/阴影/渐变及播放器沉浸黑底属合理场景，一般不再单列（仅保留特例）。

---

## 1. src/screens/HomeScreen.tsx（dashboard 首页）

### 问题清单（按严重度降序）

**H1-1 · 页头自绘大标题，未用 ScreenHeader/AppScaffold（中等）**
- L223-239：手写 `styles.outer` + `paddingTop: insets.top + 4`，`homeTitle`（L465：24/30/800/-0.3）与 ScreenHeader 内 `.title`（24/30/800/-0.3）几乎逐字重复。首页是 dashboard，允许自定义大标题，但重复定义纯属复制粘贴。
- 建议：保留自定义大标题没关系，但把 `homeTitle` 这份样式删掉，改用 `ScreenHeader` 的 title 语义或直接复用 `typography`，避免两处 24/30/800 漂移。`paddingTop: insets.top+4` 也建议改成和 ScreenHeader 一致的 `topPad` 计算逻辑（ios 54 / StatusBar+10）。

**A1-1 · 少量硬编码纯色（遮罩/阴影外的可去重项）**
- L492 `liveBadgeText` `color:'#fff'`、L514 `liveBannerTitle` `'#FFFFFF'`、L515 nickname `rgba(255,255,255,0.88)`、L550 `liveStateBtnText` `'#FFFFFF'` —— 用在图片/彩色底上，可保留；但建议统一走 `accent`/语义（例如 `Button` 的 filled 白字由组件提供）。
- L465 `homeTitle` 的 `fontSize:24, fontWeight:'800', letterSpacing:-0.3`：应来自 `typography` 或 ScreenHeader，避免魔法数字。
- L498-505 `liveBannerWrap` shadow（`#000`、0.14/14/elevation4）与 L501-506 —— shadow/阴影合理场景，可忽略，但整页 shadow 风格不统一（L498 用 elevation4，GlassCard 用 makeShadows），建议统一到 `makeShadows`。

**D1-1 · 按压反馈不一致（低）**
- L281 `TouchableOpacity`（直播加载失败「重试」按钮）无 `activeOpacity`（默认 0.2，与全站 0.85~0.9 不统一）；L281 与 Button/StateViews 的 button 语义重复。
- L267-272「全部」链接：`ScalePressable` 包裹 `View`，反馈 OK。全页其它入口都用 `ScalePressable`（L107/242/321/359/393/437），唯独 L281 用了裸 `TouchableOpacity`。
- 建议：L281 改用 `Button`（variant="tinted"）或补 `activeOpacity={0.85}`；与 StateViews 错误态重试统一组件（见 F1）。

**E1-1 · 无统一列表入场动画（低）**
- L318 `gridLives`、L358 quick、L436 toolChips 均直接渲染，无 `FadeInView`。首页大量卡片，建议对首屏区块外层包 `FadeInView`（delay 分层 60/100/140…），与 Media/FollowedRooms 的入场语言一致。
- L174-180 banner 轮播用 `setInterval` 硬切 `setBannerIndex`，非动画（可接受，切换频率业务所需）。

**F1-1 · 直播加载/错误态是自绘卡片，未用统一 StateViews（低）**
- L275-289 `liveStateCard` 自绘加载失败/空态（wifi-off / video-off + 文本 + 裸重试按钮），风格与 StateViews 的 `StateView` 不一致。
- 建议：首屏该局部态可保留紧凑行式（对比 EmptyState 居中大字形更合适），但「重试」按钮应换用统一 `Button`（tinted），文案/图标命名与 StateViews 对齐，避免两套按钮样式（L546 `liveStateBtn` radius 14 vs Button pill）。

**G1-1 · 圆角/间距魔法数字混杂（低）**
- 圆角区间：L498 `liveBannerWrap` 20、L523 liveRow 16、L528 thumb 12、L577 musicCover 12、L586 toolChip 16、L472 sectionDot 2 —— 大量与 `radiiAlias`（card 16／input 14）不一致的手写值。非致命但建议收敛。
- 间距：L229 `paddingHorizontal: spacing.md(16)` 与 insets.screenHorizontal(20) 不一致；L436 `marginHorizontal: -spacing.md` 负margin 平衡 OK。

### 修复优先级（Home）
1. D1-1 L281 重试用统一 `Button`/补 activeOpacity（交互可点性）。
2. H1-1 页头自定义标题样式去重，收敛到 ScreenHeader/typography。
3. E1-1 首屏区块补 FadeInView 入场。
4. F1-1 局部状态组件对齐 StateViews 文案/按钮。
5. G1-1 圆角收敛到 radii 梯度。

---

## 2. src/screens/MessagesScreen.tsx

### 问题清单（按严重度降序）

**B2-1 · useAppTheme() 仍在用，且顶部有 isDark 双分支（高）**
- L27 `const isDark = useAppTheme();` —— 项目约定「页面必须 usePalette，不允许 isDark && xxxDark 硬编码双分支」。虽然 L103 的 `isDark && styles.containerDark` 实际两个分支都是 `transparent`（L217-218），属于「形同虚设」的双分支，但模式本身属于审计禁止项。
- 建议：删 `isDark`，L103 直接 `<View style={[styles.container]}>`；把 `CenterSpinner dark={isDark}`（L177）改为不传 dark（或让 CenterSpinner 从 palette 自取），彻底移除对 useAppTheme 的依赖。

**A2-1 · 大量硬编码颜色 style 残留，多数是死/被覆盖（高）**
- style 块里：L218-219 pickerLabel/pickerButtonText `'#333'`、L220 pickerCount `'#333333'`、L221 picker `'#FFFFFF'/rgba(255,255,255,0.52)`、L223 input、L225 status `#fff3cd/#8a5a00`、L227-228 modalHeader/modalHeaderDark、L229-230 `#ff6f91/#333`、L231 memberItem、L233-245、L246 `textLight`。
- 运行时：picker/input/modalHeader/memberItem 等多数背景/色值都被 JSX 里 `palette.*` 覆盖（L108/L120/L133/L159），因此这些硬编码实际不生效 —— 但属于「Colors 兼容层 + 手写 dual-branch」顽固残留，应整块清理。
- 建议：删除所有被 palette 覆盖的 `#333/#fff/` 底样式，把 `pickerLabel/pickerButtonText/pickerCount/modalBack/modalTitle/memberName/memberTeam/msgSender/msgTime/msgBody` 全部改为 `{ color: palette.* }` 内联或带 token 样式；`status`（L225）、`textLight`（L246）、`inputDark`、`modalHeaderDark`、`memberItemDark`、`msgDark`、`msgTimeDark`、`emptyDark` 均为死代码，直接删。

**C2-1 · 页头一致（合格）**
- L104 用 `ScreenHeader title={t('消息检索')}`，布局/字号与其它页一致，无问题。

**D2-1 · 缺按压反馈的 TouchableOpacity（中）**
- L105 picker（选择成员行）、L136 模态「关闭」、L156 memberItem、L166 无 activeOpacity。
- 其中 L156 memberItem 是高频点击区，建议补 `activeOpacity={0.85}` 或换用 Pressable pressed 态（配合 StateViews/ListItem）。列表缺少 ListItem 语义（见 F2）。

**E2-1 · 动画基本达标（低）**
- L175 `FadeInView delay={80} duration={300}` 包裹内容，`useNativeDriver:true`，合格。无遗漏。

**F2-1 · 主态用统一组件（合格），但模态空态是裸文本（低）**
- L176-198 正确用 `CenterSpinner`/`ErrorState`/`EmptyState`（StateViews）。
- 但 L170 成员选择 Modal 的 `ListEmptyComponent` 用 `<Text>{t('成员列表为空')}</Text>`，未用 EmptyState。建议换 `EmptyState icon="account-search-outline" title={t('成员列表为空')}`。

**G2-1 · 圆角/间距不一致（低）**
- borderRadius：L221 picker 18、L223 input 18、L227 modalHeader 26、L231 memberItem 18、L236 msg 18，绝大多数手写 18，未用 `radiiAlias`。建议统一 `radiiAlias.input/button (14/18)` 或 `radii.md`。
- L221-223 picker 与 input 的 `borderRadius:18` 与 Button(18) 相同但语义是输入/行，建议 `radiiAlias.input`。
- container（L216）无背景色（'transparent'），相对其它页少一层 `palette.background` 兜底（依赖导航背景，轻微）。

### 修复优先级（Messages）
1. B2-1 删 `isDark`/useAppTheme，去掉 `isDark && styles.containerDark` 与 CenterSpinner dark 传参。
2. A2-1 清理 style 块内硬编码色与全部 dead dark 变体。
3. D2-1 L156 成员行补按压反馈。
4. F2-1 模态空态换 EmptyState。
5. G2-1 圆角收敛。

---

## 3. src/screens/MediaScreen.tsx

### 问题清单（按严重度降序）

**E3-1 · Animated 未用 native driver（中高，约定红线）**
- L663 / L670 / L678 `Animated.timing(announceTopAnim, { …, useNativeDriver: false })` —— 动画 `top`（布局属性）无法用 native driver，技术上有理由，但属审计红线条目。更优做法是把公告面板改动画 `transform: [{translateY}]` 再 `useNativeDriver:true`。
- 建议：`announcePanel` 定位改为 `top:0` + `transform translateY`（通过 annimateTopAnim.value 偏移），三个 timing 全部置 `useNativeDriver:true`。
- 其它（controlsOpacity L661/668/677）已 `useNativeDriver:true`，合格。

**A3-1 · 礼物/贡献榜 Modal 恒为深色硬编码，双主题背道而驰（高）**
- L1315 `[styles.giftPanel, isDark && styles.giftPanelDark]`：`giftPanel`（L1922 `'#1C1C1F'`）与 `giftPanelDark`（L1923 同 `'#1C1C1F'`）**两个分支同值，永远深色**，浅色主题下也深 —— 这是最刺眼的双分支残留。
- L1317/L1373 `isDark && styles.textLight`（textLight=`#eee`，L1917）双分支但恒亮色；L1925 giftTitle `'#f5f5f5'`、L1926 giftStatus `'#d8d8d8'`、L1934/L1943/L1952 大量 `#ff6f91` 手写。
- 建议：模态面板改为跟随 palette —— `giftPanel` 背景 `palette.surfaceGlassStrong`（或 surface），标题/状态 `palette.label/labelSecondary`，选中色用 `palette.tint`，删 `giftPanelDark`/`textLight`/`isDark` 分支。这是该页最大改版点。

**A3-2 · 列表页也残留 isDark 与硬编码（中）**
- L1669 / L1691 `VodCardSkeleton dark={isDark}`、`CenterSpinner dark={isDark}`，`VodCardSkeleton`（L52-55）只是包一层 CenterSpinner，名字叫 Skeleton 却非 Skeleton 组件。
- L1728 `styles.error`：`#fff3cd`/`#8a5a00` 黄色警示条硬编码（死样式，L1498 error 用的是内联？实际 L1499-1503 用手写 errorRow + palette.tint 按钮，L1728 `error` 未被 JSX 引用 → dead）。L1919 `empty '#3f3f3f'`（L1672 已用 palette 覆盖）。L1888-1893 groupChip*Dark 等 dark 变体 dead。
- 建议：`VodCardSkeleton` 改名/剔除（用 `SkeletonRow` 或直接 CenterSpinner）；删 L1728 死样式；清掉 groupChip*/searchInput*/memberHit*/*Dark 死代码；空态 L1671-1675 换统一 `EmptyState`。

**C3-1 · 页头一致（合格）**
- L1401 `ScreenHeader title={tab==='live'?'直播':'录播'} right=…`，合格。日期 chip（L1536 'rgba(0,0,0,0.55)' 遮罩）合理。

**D3-1 · 部分 TouchableOpacity 缺反馈（低）**
- L1418 groupChip（筛选 chip）、L1430 searchToggle、L1442 memberChip、L212 calDay、L196/L200 日历翻页，均无 activeOpacity/pressed。
- L1523 liveBanner、L1571/1627 vod card、L1331 giftItem 已有 activeOpacity 或 Scale。建议 groupChip/searchToggle 补 `activeOpacity`，日历格改 Pressable pressed 缩放。

**G3-1 · 圆角/间距魔法数字多（中）**
- 大量手写：L1890 groupChip 16、L1898 searchInput 16、L1904 memberChip 16、L1922 giftPanel 24、L1926/1956 calSheet 18、L1768 webFallback 18、第 1955 年日历 18。与 `radiiAlias`/`Button pill` 不一致。
- 建议用 `radiiAlias`（chip/input/button/card）收敛。
- `searchInput`（L1895-1899）背景 `'#FFFFFF'` 被 JSX L1452 palette 覆盖 → dead，删除。

### 修复优先级（Media）
1. E3-1 公告面板动画改 transform + `useNativeDriver:true`（约定红线）。
2. A3-1 礼物/贡献榜模态改为主题化，删恒深色双分支（高影响）。
3. A3-2 列表页 dead 样式清理 + `VodCardSkeleton` 正名/剔除。
4. G3-1/D3-1 圆角与按压反馈收敛。

---

## 4. src/screens/FollowedRoomsScreen.tsx

### 问题清单（按严重度降序）

**A4-1 · 聊天页仍是 isDark 双分支 + 海量硬编码色（高）**
- L830 `const isDark = useAppTheme();`，并在渲染中多次 `isDark && …`：L1573 `mediaTitleDark`、L1575 `mediaDurationDark`、L1597 `textSubDark`、L1608（inlineVideo 无）等；样式表里 `msgBubbleDark/msgBubbleIdol/msgBubbleMine`、`mediaTitleDark/mediaDurationDark/memberTeamDark/giftMetaDark` 等。
- 硬编码语义色（可接受但要集中）：L1344/1719 `#ff6f91`/`#ffffff`（ActivityIndicator）、L1362/1368 `#FFFFFF`、L1513 `#7BC6FF`（自己气泡）、L1521 `idol?palette.tint:mine?'#7BC6FF'`、L1588 `'#ff6f91'/'#FFFFFF'`。自己/偶像气泡用粉/蓝固定色属 IM 语义，可保留，但建议收敛为 palette.tint + 一个语义 `myBubble` token，避免散落。
- 大量死代码样式：L1862 containerDark、L1903-1904 modePill*/modePillDark、L1905 subtitle、L1907 input/inputDark、L1909 refreshBtnDisable、L2016 loginLink/loginLinkDark、L2018-2020 status/statusDark/mediaStatus、L2023-2024 roomItem/roomItemDark、L2026-2047 roomAvatar/roomName/roomTeam/pinBtn/followBtn…、L2059 replyCardDark、L2062 replyTextDark、L2070 msgTimeDark、L2075 msgBubbleDark、L2085-2086 giftMetaDark、L2146-2147 textDark/textSubDark、L2149 emptyDark、L308-310 aboutHeroDark 等 —— 一堆未被子复用、或 JSX 已覆盖。
- 建议：像 Messages 一样做一遍「删 dark 变体 + 颜色走 palette」清理；`isDark &&` 全部移除（用 palette 语义替代）；`#7BC6FF` 提为 IM 语义常量。

**A4-2 · RoomRankPanel 恒深色硬编码（中高）**
- L1308-1332 `roomRankPanel`（L2135 `'#1C1C1F'`）、`roomRankTitle/Status/Name/Value` 全 `#fff/#d8d8d8`，`roomModalShade` `rgba(0,0,0,0.45)`。不随主题。建议改 `palette.surface`+`palette.label/labelSecondary`，浅色下也可读；遮罩保留。

**F4-1 · 空/加载态大量自绘，未用统一组件（中）**
- L1431-1443 ListFooter 手写；L1444-1455 `ListEmptyComponent` 手写（CenterSpinner OK，但「暂无消息」`emptyWrap`+图标手写，未用 EmptyState）；L1836-1848 房间列表空态/登录提示也手写 `emptyWrap`/`empty`/`emptyLink`。
- 建议：房间列表空态统一用 `EmptyState`；登录提示可用 `StateView`（actionLabel=去登录）；房间内聊天空态可保留紧凑样式但复用 StateViews 图标/文案规范。

**D4-1 · 按压反馈大量缺失（中）**
- L1578-1582 双重嵌套 `TouchableOpacity.mediaPlayBtn`（外层容器 + 内层按钮，两处 onPress 相同，嵌套点击冗余、内层会重复触发）——结构性 bug（也属布局问题）。
- L1581-1593、L1313（rank 关闭）、L1551/1566 已有 activeOpacity；L1665 清空、L1648 refresh、L1349 pinBtn、L1358/1364-1368 segmentItem（大/小房间 tab）、L1372 search icon 等无 activeOpacity/pressed。segmentItem 是高频切换，建议补 pressed。

**C4-1 · 页头一致（合格）**
- 列表页 L1639、房间页 L1336 均用 `ScreenHeader`（含 right 操作位），布局/字号一致。房间页 right 里 followBtn/pinBtn 为自绘胶囊（用硬编码 pink，见 A4-1）。

**G4-1 · 圆角/间距魔法数字（中，且双实现并存）**
- 卡片有两套：`memberHitCard`（L1938-1944 shadow 0.05/6）与 `memberCard`（L1976-1981 shadow 0.05/6）几乎重复；既有 `memberCard` radius 18、`memberHitAvatar/avatar` 等。
- chatTools/segment（radius 14/11）、mediaCard 14、replyCard 10、liveCard 14 —— 未走 radiiAlias。建议用 `radiiAlias.chip/card`。
- 行列距手写：chatRow marginVertical 6、msgBlock maxWidth 78% 等（IM 合理，可保留）。

### 修复优先级（FollowedRooms）
1. A4-1 全页 isDark 双分支 + 硬编码色大清理（最大工作项）。
2. A4-2 Rank 模态主题化。
3. D4-1 L1581 嵌套 TouchableOpacity 结构性修复（点击/可访问性 bug）。
4. F4-1 空态换统一 EmptyState/StateView。
5. C/G/D 其它按压反馈与圆角收敛。

---

## 5. src/screens/SettingsScreen.tsx

### 问题清单（按严重度降序）

**A5-1 · 残留大量硬编码 + dead dark 变体（中高）**
- L181 github 图标 `color="#ff6f91"`、L265 sync 图标 `'#ff6f91'`、L314 verDot `'#ff3b30'/'#fff'`、L298 clearText `'#e74c3c'`、L297 clearBtn `rgba(255,0,0,0.08)`、L316 linkCard `rgba(255,111,145,0.08)`（L180 运行时已被 palette.tintSoft 覆盖）、L312 verChip `rgba(255,111,145,0.14)`、L284 section `'#FFFFFF'`（L39 已用 palette.surfaceGlass 覆盖）、L288 divider `rgba(0,0,0,0.06)`。
- **死代码 dark 变体（本页甚至没 import isDark）**：L282 containerDark、L285 sectionDark、L291 chipDark、L292 chipActive、L294 chipTextActive、L310 aboutHeroDark、L317 linkCardDark、L326 autoSyncRowDark、L308 textLight、L309 textSubLight —— 全部未引用。
- 建议：图标色改 `palette.tint`；danger/语义色（verDot、clearText）改 `palette.danger`；linkCard/autoSyncRow/verChip 用 `palette.tintSoft`；删除全部 dead dark 变体。可顺手加一次 lint 清理。

**D5-1 · 主要操作无按压反馈（中）**
- L199 / L209 / L243 / L246 `linkBtn`（进入账号/选择图片/下载管理/运行日志）：大按钮但只有 `TouchableOpacity`，无 activeOpacity/pressed，点按无视觉反馈。
- L151 verChip、L214 clearBtn、L58 chip 同。
- 建议：`linkBtn` 换用统一 `Button`（variant="tinted"/"filled"）或用 Pressable 加 pressed 缩放；`Section` 内的行级操作统一反馈。

**C5-1 · 页头一致（合格），副标题/行高略偏**
- L141 用 `ScreenHeader`，合格。
- L284 section `borderRadius:20` 硬编码（L39 又传 20）；Section 头标题 `sectionTitle` 15px，其它页区块标题用 headline(17) —— 轻微不一致，建议 `typography.headline`。

**E5-1 · 无列表入场动画（低）**
- 整页无 `FadeInView`。设置页区块可逐块 `FadeInView`（delay 分层），与 tab5 其它页入场语言统一。

**H5-1 · 代码质量问题（中）**
- L140 `style={[styles.container, false]}` —— 数组第二项传入字面量 `false`（RN 会忽略 falsy，属死代码/笔误），应删 `, false`。
- L283 content paddingBottom:112 与其余页 (84/120) 不一致；paddingBottom 偏大属 tabBar 遮罩补偿，可统一常量。
- 空/加载/错误态：本页无异步列表态，无需 Empty/Error；但 `RuntimeLogViewer` 弹出、meta 加载无占位，可接受。

### 修复优先级（Settings）
1. A5-1 图标/语义色改 palette token + 删所有 dead dark 变体。
2. D5-1 linkBtn 统一 Button / 补按压反馈。
3. H5-1 修 L140 `, false`；统一 section 圆角/区块标题字号。
4. E5-1 区块补 FadeInView。

---

## 跨页 top 3 共性（最重要）

1. **useAppTheme()/isDark 硬编码双分支仍在 4 页弥漫**
   Messages(L27)、Media(L1315/L1317/L1669/L1691)、Followed(整聊天区)、并各有几十条 `xxxDark` 死样式（Media 的 `groupChip*Dark`、Followed 的 `msgBubbleDark/mediaTitleDark`、Messages 的 `inputDark/modalHeaderDark`、Settings 的 `sectionDark/aboutHeroDark` 等）。其中 Media 的礼物榜/贡献榜与 Followed 的 Rank 面板是「恒深色硬编码」，最刺眼。应全页删 `isDark` 引用，颜色统一走 palette 语义。

2. **空态/加载态/错误态没统一**：Home 直播区、Followed 空态/登录提示、Messages 模态空态、Media 错误条均为自绘文本+自定义按钮，未用 EmptyState/StateViews/Button；`VodCardSkeleton` 冒名 Skeleton 实为 CenterSpinner。

3. **按压反馈与主题 token 不统一**：大量 `TouchableOpacity` 缺 activeOpacity/pressed（segments、chips、日历格、设置 linkBtn、直播重试），Followed 有嵌套重复 TouchableOpacity 的结构问题；圆角/间距大量手写魔法数字（18/20/16/24/14 混用），未收敛到 `spacing`/`radiiAlias`，颜色 `#ff6f91` 这类品牌色在多个文件散落为字面量而非 `palette.tint`。
