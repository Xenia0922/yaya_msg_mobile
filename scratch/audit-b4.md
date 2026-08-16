# UI 审计报告 · yaya_msg_mobile v2.6.5（审计批次 b4）

审计对象：MusicLibraryScreen / AudioProgramsScreen / AnalysisScreen / DownloadScreen / DatabaseScreen / TripScreen
设计规范基准：`src/theme/*`（spacing/radii/typography/motion token）+ 共享组件（ScreenHeader / AppScaffold / ListItem / GlassCard / EmptyState / StateViews / Skeleton / Motion / SectionHeader / Pill / Button）。

审计符号：🔴 高（必须改，设计规范违背/硬编码残留）｜🟠 中（一致性/体验）｜🟡 低（死代码/轻微）。

> 共同背景：6 个页面都以 `<View>` 容器 + `ScreenHeader` 作为页头，未使用 `AppScaffold`（该组件各页均未用，全站以 ScreenHeader 为准，可接受；但头部的 `right` 操作样式在各页各自手写、不统一——见跨页问题 3）。加载态统一走 `CenterSpinner`，空/错态只有部分页面用 `EmptyState/ErrorState`。

---

## 1. src/screens/MusicLibraryScreen.tsx

### A. 硬编码颜色字面量
- 🟡 L281 `color: '#fff'` 与 favBtn 逻辑。L281 收藏心：`favorites.includes(...) ? '#ff3b5c' : '#fff'` —— **非 palette 硬编码**。收藏态用 `#ff3b5c`（非品牌粉，且未用 `palette.danger`/`palette.tint`）；未收藏态 `#fff` 叠在 `rgba(0,0,0,0.32)` 遮罩上尚可。**建议**：收藏态改 `palette.tint`（或注释说明品牌粉），白字保留。修正`rgba(0,0,0,0.32)`遮罩为合理遮罩场景。
- 🟡 L266 `color="#FFFFFF"`（活跃徽标 equalizer 图标，粉底白字）合理。
- 🟡 L204 `color: group === g ? '#FFFFFF' : palette.labelSecondary` —— chip 选中态白字，合理（同 Pill/Button 惯例）。
- 🟢 L461-465 `shadowColor:'#000', shadowOpacity:0.06` 卡片阴影 —— 合理场景，可改 `makeShadows()` 统一。
- 🟡 L470 `coverWrap ... backgroundColor:'#111'` 封面兜底底色硬编码 —— 建议用 `palette.surfaceMuted` 或 `palette.labelTertiary` 透明度。
- 🟠 **styles 里大量粉/灰硬编码但运行期被 palette 覆盖（死样式）**：`gText:{color:'#555'}`(L436)、`gChip` 默认底 `rgba(0,0,0,0.06)`(L424)、`status:{color:'#ff6f91'}`(L439)、`songItem...backgroundColor:'#FFFFFF'`(L459)、`coverPlaceholder backgroundColor:'#e8e8e8'`(L483)、`unavailableText color:'#ffd479'`(L486)、`textDark/ textSubDark '#eee'`(L493-494)。运行期 gChip(L194)/gText(L204)/songItem(L256)/cover 均由 palette 覆盖。**建议**：整体清删，避免误导后续维护者。

### B. isDark 双分支
- 🔴 L48 `const isDark = useAppTheme();` 且 L157 `isDark && styles.containerDark`；L389 `containerDark:{backgroundColor:'transparent'}` —— **双分支但两值相同（透明），纯硬编码残留**。`isDark` 仅 L229 传给 `CenterSpinner dark={isDark}`。
- **建议**：删 `containerDark`，L157 直接 `styles.container`；`isDark` 变量随 `CenterSpinner` 的 `dark` 参数一并废弃（见跨页共性问题 1）——传 `undefined` 由 CenterSpinner 内部 `usePalette` 替代。

### C. 页头
- 🟢 用 `ScreenHeader`，左返回右 refresh **图标** —— 与其余 5 页「刷新」**文字**不一致（见跨页问题 3）。
- 🟠 L159 refresh TouchableOpacity 用图标、loading 时仅置灰不放转圈；刷新动作有 `disabled={loading}`。可接受，建议与其它页统一为文字刷新或统一图标。

### D. 按压反馈
- 🟠 L159 refresh、L173 清空搜索、L189 分组 chip、L269 favBtn 的 `TouchableOpacity` **均未显式 activeOpacity**（默认 0.2 偏弱，尤其 favBtn 喜 40px 内点击无感）。L253 歌曲卡有 `activeOpacity={0.7}`。
- **建议**：chip/清空/收藏改为 `ScalePressable`（comp/ScalePressable）或显式 `activeOpacity≈0.6`；favBtn 至少 0.6。

### E. 动画
- 🟠 列表（`PerfFlatList`）**无任何入场动画**（对比 AudioPrograms/Analysis 用 `FadeInView` 逐项淡入）。建议 renderItem 外包 `FadeInView delay={80+idx*30}` 与其它列表一致。
- 🟢 无自定义 Animated misuse；`FullScreenPlayer/MiniPlayerBar` 为独立组件（不在本次审计一行行核对，但注意它们是音乐播放器的转场/进度承载方，属另一审计面）。
- 🟢 隐藏 Video 常驻（L304）无动画，合理。

### F. 空/载/错态
- 🟠 L227-230 加载用 `CenterSpinner`（非 Skeleton，全站统一可接受）。
- 🟠 L231-234 空态仅 `<Text>{t('暂无音乐')}</Text>` 居中，**未用 EmptyState**。建议 `EmptyState icon="music-off" title={t('暂无音乐')}`。
- 🟠 L213-226 错误态手写 `statusOverlay` + `retryBtn`（L217），**未用 ErrorState**。建议统一用 StateViews 的 `ErrorState`。

### G. 间距/圆角
- 🟠 间距混乱：`searchBar marginHorizontal:16`(L396)、`tabsBarBase paddingHorizontal:12`(L408)、`gChip paddingHorizontal:16`、`listContent paddingHorizontal:12`(L450)、`songItem margin:5`、`songInfo padding:10`(L487)。与规范 `insets.screenHorizontal=20` / spacing 4pt 梯度不一致。建议：屏幕级留白用 `insets.screenHorizontal`，卡片内边距用 `spacing`/`radiiAlias.card`。
- 🟠 圆角：L400 searchBar `borderRadius:14`（≈`radii.md` ok）、L423 gChip `16`（应 `radii pill` 或统一 14）、L457 songItem `16`、L477 playingBadge `13`。建议统一到 `radiiAlias`。

### H. 其它
- 🟠 **大量死样式**（见 A 尾部）：`gChipDark/gChipOn/gTextDark/gTextOn/tabsBarLight/tabsBarDark/cardDark/songItemActiveDark/songItemActive/status/statusOverlay/retryBtnText/coverImg/coverPlaceholder/coverPlaceholderText/unavailableBadge/unavailableText/backBtn(定义未用)/textDark/textSubDark`。建议整块清删。
- 🟡 L103-124 URL resolver 用 `catch{}` 吞错，仅注释，非 UI 问题。
- 🟠 字体硬编码（`songTitle fontSize:15 fontWeight:'800'` L488、`songArtist 12`、`dateText 11`）未用 typography token。
- 🟡 L403 `searchInput fontSize:15,padding:0` 建议用 `typography.body/subhead`。

---

## 2. src/screens/AudioProgramsScreen.tsx

### A. 硬编码颜色
- 🟡 L81-83 / audioUrls 与 UI 无关（网络地址拼装）。
- 🟠 L287 `heroCover` 底由 `palette.tintSoft` 运行期指定（ok），但 L199 实际 `backgroundColor: palette.tintSoft`；styles 里无冲突残留。
- 🟡 L217 `#FFFFFF`（hero 播放按钮白图标）合理。
- 🟠 L267 `backBtn:{color:'#ff6f91',...}` 定义但被 L143 `palette.tint` 覆盖 —— 死样式/误导，删。
- 🟡 无遮罩/阴影字面量（容器 transparent）。

### B. isDark 双分支
- 🔴 L68 `const isDark = useAppTheme();` 仅 L170、L223 `CenterSpinner dark={isDark}` 使用。无 `xxxDark` 样式。**建议**：如前述废弃 `isDark` 传参（交给 CenterSpinner 内部 usePalette）。

### C. 页头
- 🟢 `ScreenHeader` + right「刷新」**文字**（L141-145），`loading` 时置灰。风格与其余文字刷新页一致，但与 MusicLibrary 图标版不一致（见跨页 3）。
- 🟡 L143 刷新文字 `backBtn` 风格（fontSize 14）—— 命名误导（它是 right 刷新非返回），建议统一为 `headerAction`。

### D. 按压反馈
- 🟢 主卡/列表行均有 activeOpacity（hero 0.9 L197、progItem 0.88 L237）。
- 🟠 L142 refresh `TouchableOpacity` 无 activeOpacity；无 ScalePressable。建议刷新/行卡用 `ScalePressable`。

### E. 动画
- 🟢 做得好：列表整卡 `FadeInView`(L181) + 逐行 `FadeInView delay=80+idx*30`(L227) 入场动画，节奏统一。
- 🟢 header / playerBar 无动画需求。

### F. 空/载/错态
- 🟢 L170 加载 `CenterSpinner`；L172-175 错误 `ErrorState`（含重试）；L176-179 空态 `EmptyState` —— 全部用统一组件，**本页状态处理最规范**。
- 🟠 第一屏加载在 flex:1 View 包裹；建议保持。

### G. 间距/圆角
- 🟠 间距：`playerBar marginHorizontal:16`(L269)、`listContent paddingHorizontal:12`(L273)、`heroCard marginHorizontal:4/marginBottom:10`(L278-280)、`progItem marginHorizontal:16, marginVertical:4`(L306-307)、`padding:14/12`。与 `insets.screenHorizontal=20` 不一致。
- 🟠 圆角统一 `16`（L269/281/287/309/315）—— 建议用 `radiiAlias.card`/`radii.md`。

### H. 其它
- 🟠 字体硬编码：`heroTitle 16`(L293)、`heroMeta 12`、`progTitle 15`(L320) 等未用 typography token。
- 🟡 L23-37 `normalizeTalks/mergeUniqueTalks/nextCtimeFrom`、L44-56 `audioUrls` 为数据层，非 UI。
- 🟢 无死样式明显堆积（较干净）。

---

## 3. src/screens/AnalysisScreen.tsx

### A. 硬编码颜色
- 🟠 L830 `flipAudio backgroundColor:'rgba(0,0,0,0.06)'` —— 建议 `palette.fill2`（已大量用 fill2 作轨道底）。
- 🟡 L831 flipVideo / L834 videoModal / L837 videoPlayer `backgroundColor:'#000'` 视频黑底合理。
- 🟡 L832 imgModal `rgba(0,0,0,0.9)` 遮罩、L836 `videoCloseText '#fff'` 合理（模态遮罩场景）。
- 🟠 L828 flipPlayBtn `borderRadius:18`（≈radiiAlias.button，ok）。
- 🟢 其余主 UI 全部走 `palette.tint/fill2/surface` 等，**本页 palette 化较彻底**（条形图/节点均 palette）。

### B. isDark 双分支
- 🔴 L126 `const isDark = useAppTheme();` 仅 L360 `CenterSpinner dark={isDark}`。
- 🔴 L350 `isDark && styles.containerDark`、L769 `containerDark:{backgroundColor:'transparent'}` —— 死双分支（同 MusicLibrary）。
- **建议**：删 containerDark 与 isDark 传参。

### C. 页头
- 🟢 `ScreenHeader` + right「刷新」文字（L351-353），`!member||loading` 时 `opacity:0.45`。风格与文字刷新页一致。
- 🟢 `refreshText`(L771 `fontSize:14,minWidth:54,textAlign:'right',fontWeight:'700'`) 命名合理（非 backBtn）。

### D. 按压反馈
- 🟠 L352 refresh、L365 retryBtn、L584 flipChip、L713 flipPlayBtn 的 TouchableOpacity 无 activeOpacity（默认0.2 偏弱）。
- 🟢 L542-544 media 行有 `activeOpacity={0.8}`；Pill 有 pressed scale（共享组件）。
- **建议**：flipChip、flipPlayBtn 改 `ScalePressable`；retry 用 `Button` 组件。

### E. 动画
- 🟠 **Modal 动画生硬**：图片预览 `animationType="fade"`(L740) 尚可，但视频/音频 L747 `animationType="slide"` 为系统默认整屏滑入，无背景淡入、无圆角卡片弹出（对比玻璃卡语言）。建议：图片预览保留 fade 但加 `presentationStyle`/圆角卡片缩放；播放 Modal 至少配深色底 + 顶部关闭已有，可接受，但「关闭」文字按钮(L750)触区小。
- 🟢 列表各 tab 均有 `FadeInView`（room L389、dates L440+L454、senders L488、media L541、flip L686）—— **入场动画全面**。
- 🟢 条形图宽度动画无需求（静态 pct%）。

### F. 空/载/错态
- 🟠 **不一致**：dates tab `ListEmptyComponent` 只有 `<Text>`(L449 `styles.empty`)，未用 EmptyState；media、flip tab 无空态组件。建议统一 `EmptyState`。
- 🟢 加载 `CenterSpinner`(L360)；错误 `retryBtn` 手写(L365)未用 ErrorState —— 建议改 ErrorState。
- 🟡 L815 `empty:{textAlign:'center',marginTop:60}` 为手写空态，删。

### G. 间距/圆角
- 🟠 `content:{padding:14}`(L784)（4 边 14 偏小），`pickerWrap paddingHorizontal:16`(L770)、`tabsRow paddingHorizontal:16`。建议屏幕 20、卡片 14`radiiAlias.card`。
- 🟠 圆角 `16` 大量（summaryCard/rowCard/rankCard/typeCard/flipCardsCard），`rowIcon 12`(L794)、`flipABlock 12`—— 建议 radii token。

### H. 其它
- 🟠 **大量手写字号**：summaryValue 18、rowTitle 14、rowSub 12、flipCardValue 18、flipChipText 11 等，未用 typography。
- 🟢 `roomOverview = cards`(L347) 冗余别名，可删。
- 🟡 L28-34 TABS label 未走 i18n key 常量（用 t(item.label) 运行时翻译 ok）。
- 🟠 L753 Video `headers` 里 `Referer` 用裸字符串 URL —— 数据层，可移。非 UI。

---

## 4. src/screens/DownloadScreen.tsx

### A. 硬编码颜色
- 🟡 L308 `addBtnText '#FFFFFF'` 粉底白字合理。
- 🟡 L344 `imgModal rgba(0,0,0,0.94)` 遮罩、`imgFull 96%` 合理。
- 🟠 L300 `container 'transparent'`；L342 `actionBtn backgroundColor:'transparent'` 显式透明，ok。
- 🟢 进度条/概览全部 palette（`palette.tint/success/danger/fill2`），**palette 化良好**。

### B. isDark 双分支
- 🔴 L66 `const isDark = useAppTheme();` —— **声名但 JSX 中从未使用**（检查全文件无其它引用）。纯死变量残留。删除即可（即使将来 CenterSpinner 也不传 dark）。

### C. 页头
- 🟢 `ScreenHeader` + right「清理完成」文字（L189-191），disabled 时次要色。需确认 54 宽不溢出（`clearBtn minWidth:54, textAlign:'right', fontSize:13` L301，合理）。

### D. 按压反馈
- 🟠 L190 clearDone、L209 addBtn、L270/274 retry/open actionBtn、L278 delete actionBtn 均无 activeOpacity。actionBtn 34px、addBtn 主操作建议改 `Button`/`ScalePressable`。
- 🟢 列表行不可点（整行非 Pressable），仅右侧 action 可点 —— 可接受，但建议整行可点（打开展开）提高可操作性。

### E. 动画
- 🟢 列表 `FadeInView`(L251) + 整容器 `FadeInView`(L195) 入场动画，节奏好。
- 🟠 L289 图片预览 `Modal animationType="fade"` 可接受；进度条实时刷新用宽度百分比，无动画（高频更新用 nativeDriver 不适用，ok）。

### F. 空/载/错态
- 🟠 **空态**：L238 `ListEmptyComponent` 仅 `<Text>`，未用 EmptyState。建议 `EmptyState icon="download-off" title={t('暂无下载项目')}`。
- 🟢 无加载态页面级 spinner（数据量小）；错误通过 toast + 组头 —— 可接受。

### G. 间距/圆角
- 🟠 `manualCard marginHorizontal:16`(L302)、`overviewCard marginHorizontal:12`(L314)、`task marginHorizontal:12`(L329)、`list padding:4`(L309) —— 与 `insets.screenHorizontal=20` 不一致，卡片横向留白各页漂移。
- 🟠 `list padding:4`(L309) 太小导致卡片贴边感；建议 `padding: spacing.xs`。
- 🟠 圆角 `16`(L302/319/332) `addBtn 18`(L306) `actionBtn 17` —— 建议 radiiAlias。

### H. 其它
- 🟡 **未使用的 import**：L6 `FlatList`（实际用 `PerfFlatList`）—— 删除。
- 🟠 手写字号：overviewNum 20、taskName 15、taskSub 11、groupTitle 13 等未用 typography。
- 🟢 `formatBytes/typeLabel/typeIcon` 数据层 helper 正常。

---

## 5. src/screens/DatabaseScreen.tsx

### A. 硬编码颜色
- 🟠 L157 `headerAction:{color:'#ff6f91'}`、L182 `errorText:{color:'#ff6f91'}` 定义但被 L79/L122 `palette.tint` 覆盖 —— 死硬编码。
- 🟡 L189 `webRetryText '#fff'`、L193 webRetryBtn 圆角 16 —— 粉底白字合理，但圆角建议 `radiiAlias.button`。
- 🟢 summaryRow 全部 palette；**整体最简洁、palette 化较彻底**。

### B. isDark 双分支
- 🟢 无 `useAppTheme/isDark` —— **本页干净**（未用双分支）。

### C. 页头
- 🟢 `ScreenHeader` + right「刷新」文字（L77-80，`palette.tint`）。与文字刷新页一致。

### D. 按压反馈
- 🟠 L78 refresh、L109 同步失败重试、L123 webError 重试 均无 activeOpacity。
- 🔴 L83-118 **summaryRow 是 `View` 非可点击（Pressable）**，但含 `chevron-right`(L117) 暗示可点进数据库 → **可点击语义误导 / 无效交互**。若本页仅展示，应去掉 chevron；若想进详情，应包 `TouchableOpacity` 或 `ScalePressable`。

### E. 动画
- 🟢 无列表/入场动画需求（WebView 页）。WebView `renderLoading={()=><View/>}` 空壳（L148），短暂白屏 —— 可接受，但无 loading 提示，可选加 Skeleton/文字。

### F. 空/载/错态
- 🟡 L120-127 webError 手写 `errorWrap`，未用 ErrorState —— WebView 场景可放宽，但可对齐。
- 🟢 同步态用 `ActivityIndicator`(L103) + 状态文字，直观。（未用 CenterSpinner/Skeleton —— 数据量小，ok）

### G. 间距/圆角
- 🟠 `summaryRow marginHorizontal:16, marginVertical:8`(L161-162)、`padding:12`、`borderRadius:16` —— 建议 `insets.screenHorizontal` + `radiiAlias.card`。

### H. 其它
- 🟢 代码最小、几乎无死样式。`headerAction` 仅颜色残留需删。

---

## 6. src/screens/TripScreen.tsx

### A. 硬编码颜色
- 🟢 **palette 化优秀**：时间轴 rail(L138 `palette.tint/fill2`)、node(L146-153)、datePill(L174)、card(L166) 全走 palette。
- 🟡 L156 `nodeDot backgroundColor:'#FFFFFF'`（tint 实心内白点）合理。
- 🟡 L205/207 `#FFFFFF`（linkBtn 粉底白图标/箭头）、L331 `linkBtnText '#fff'` 合理。
- 🟡 `container transparent`。

### B. isDark 双分支
- 🔴 L88 `const isDark = useAppTheme();` 仅 L249 `CenterSpinner dark={isDark}`。无 xxxDark 样式。建议废弃传参。

### C. 页头
- 🟢 `ScreenHeader` + right「刷新」文字（L222-225），`!member||loading` 置灰。与文字刷新页一致。
- 🟢 subtitle(L227) 置于 header 下、MemberPicker 上方 —— 布局合理。

### D. 按压反馈
- 🟠 L201 linkBtn、L223 refresh 无 activeOpacity。linkBtn 建议 `ScalePressable`（带弹性）或 `Button`。
- 🟢 时间轴卡片非点击（纯展示），合理。

### E. 动画
- 🟢 逐行 `FadeInView`(L130) 入场动画统一。整容器也包 `FadeInView`(L231)。
- 🟢 无多余动画。

### F. 空/载/错态
- 🟠 **不一致**：错误态用 `ErrorState`(L251，规范✅)；加载用 `CenterSpinner`(L249)；**空态仅手写 `<Text>`**(L253-257)，未用 `EmptyState`。建议空态改 `EmptyState icon="calendar-heart" title={...}`。

### G. 间距/圆角
- 🟠 `list padding:16`(L271)、`subtitle paddingHorizontal:16`(L270)、`card padding:14, marginLeft:10`、`datePill padding 10/4` —— 横向留白 16 vs 规范 20 不一致。
- 🟡 `card borderRadius:16`、`linkBtn 18`、`datePill 999(pill)` —— card 建议 `radiiAlias.card`。

### H. 其它
- 🟠 手写字号：cardTitle 15、cardSub 12、datePillText 12、locationText 12、linkBtnText 12 未用 typography。
- 🟢 `parseTripDate/normalizeTripItem/tripNodeState` 数据层正常。代码简洁无死样式。

---

## 跨页共性问题（按影响排序）

1. 🔴 **`isDark`/`useAppTheme` 的硬编码双分支残留**：除 DatabaseScreen 外 5 页都 `const isDark = useAppTheme()`，且 MusicLibrary(L157)、Analysis(L350) 还有 `isDark && styles.containerDark`（两值均为 `transparent`，纯死代码）。同时全站 `CenterSpinner` 接收 `dark` 参数并内部分支 `#ff8fa8/#ff6f91`（Loaders.tsx L31/L45）—— 整条链违背「usePalette 单源」约定。**建议**：删所有 `containerDark`/`isDark` 传参，让 `CenterSpinner` 内部用 `usePalette().tint`（一行改动即让全页受益）。

2. 🔴 **空/错态不统一**：AudioPrograms 用 `EmptyState/ErrorState`（规范✅），但 MusicLibrary(空/错手写)、Analysis(dates/media/flip 空态仅 Text、错态手写 retryBtn)、Download(空态仅 Text)、Trip(空态仅 Text) 均未用统一组件。**建议**：全部换 `EmptyState`/`ErrorState`（StateViews），删除各自手写的 `empty`/`statusOverlay`/`retryBtn` 样式。

3. 🟠 **页头 right 操作不统一 + 自绘样式重复**：MusicLibrary 用 refresh **图标**(L159)，其余 5 页用「刷新/清理完成」**文字**，且各自手写 `backBtn/refreshText/clearBtn/headerAction`（仅颜色/字号微差）——同功能多处复制。**建议**：抽一个共享 `HeaderAction`（或统一「文字版」），全站替换；顺带清掉那些被 palette 覆盖的死样式名（AudioPrograms L267 backBtn、Database L157 headerAction、MusicLibrary 一堆）。

4. 🟠 **硬编码间距/圆角/字号全站漂移，未用 token**：屏幕横向留白在 16/12/14/20 间漂移（应为 `insets.screenHorizontal=20`）；卡片圆角 16/12/14/17/18 混用（应为 `radiiAlias.card`/`button`）；字号全部手写（未用 `typography.title2/subhead/footnote/caption1`）。6 页均涉。

5. 🟠 **TouchableOpacity 普遍缺压制反馈**：绝大多数无显式 `activeOpacity`（默认 0.2 偏弱），少数点了无任何视觉回馈（favBtn、chip、actionBtn、refresh、linkBtn 等）。**建议**：交互元素优先 `ScalePressable`，至少显式 `activeOpacity≤0.6`。

6. 🟡 **死代码堆积**（尤其 MusicLibrary 一整批 `*Dark`/`*On`/`unavailable*` 样式 + Download 未用 import `FlatList` + Download 死变量 `isDark` + Analysis `roomOverview` 别名）——建议集中清理防误导。
