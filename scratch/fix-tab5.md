# UI 修复记录 · tab5（Home / Messages / Media / FollowedRooms / Settings）

> 项目：yaya_msg_mobile v2.6.5 · 按 audit-tab5.md 逐条落实，遵循统一组件新 API + palette 语义。
> 全部 5 文件 `npx tsc --noEmit` 对应路径：0 错误。
> 未改动业务逻辑 / API 调用 / 数据流 / 路由参数；i18n 文案原文不变。

---

## src/screens/HomeScreen.tsx（dashboard 首页）

- 直播加载失败「重试」由裸 `TouchableOpacity`（liveStateBtn）改为 `Button variant="tinted" size="sm"`，含统一按压反馈（D1-1）。
- 删除死样式 `liveStateBtn` / `liveStateBtnText`。（F1-1）
- 删除未使用的 `TouchableOpacity` import。
- 首屏四大区块（正在直播 / 快捷入口 / 最近播放 / 工具）包 `FadeInView`，delay 分层 60/100/140/180（E1-1）。
- liveBadgeText 等覆盖在深色遮罩上的白字保留（合理场景）。

## src/screens/MessagesScreen.tsx

- 删除 `useAppTheme()`/`isDark` 及 `isDark && styles.containerDark`，删除 `useAppTheme` import。
- `CenterSpinner dark={isDark}` → 去掉 `dark` prop（B2-1）。
- 清理全部硬编码色 style 与 dead dark 变体（pickerLabel/pickerButtonText/pickerCount/modalHeader*/memberItem*/msg*/empty*/textLight/inputDark/status/containerDark），颜色统一 palette 语义（A2-1）。
- 成员选择 Modal 空态裸文本 → `EmptyState icon="account-search-outline"`（F2-1）。
- picker / 关闭 / memberItem 补 `activeOpacity={0.85}`（D2-1）。
- 圆角手写 18/26 → `radiiAlias.input` / `radiiAlias.button`（G2-1）。

## src/screens/MediaScreen.tsx

- 公告面板 `top` 动画 → `transform: [{ translateY }]`，三个 `Animated.timing` 全部 `useNativeDriver: true`，style 补 `top:0`（E3-1 红线）。
- 「礼物/贡献榜」Modal 恒深色 `#1C1C1F`/`giftPanelDark`/`textLight` → 主题化：`palette.surface` 底、`palette.label/labelSecondary/tint/onTint`，删 `isDark`/`giftPanelDark`/`textLight`（A3-1）。
- `VodCardSkeleton`（冒名 CenterSpinner）删除，直接用 `CenterSpinner`；列表空态裸文本 → `EmptyState`；Footer `CenterSpinner dark=` 去掉（A3-2）。
- 删除 dead 样式：`error` 黄条、`groupChip*Dark`、`searchInput*`、`memberHit*Dark`、`empty/emptyDark/emptyWrap`、`giftPanelDark`、`card*`、`coverPlaceholder*`、`v2Title/v2Meta/v2Info`、`typeTag/typeRow/giftTag/typeText`、`cardSub*`、`footerSpinner`（A3-2/死样式清理）。
- 分组 chip / 搜索开关 / 成员 chip / 日历翻页 / 日期 chip / 错误流重试统一反馈：groupChip 文本选中态 `#FFFFFF`→`palette.onTint`，一堆 `#ff6f91`→`palette.tint`（D3-1/G3-1）。
- 圆角收敛到 `radiiAlias` / `radii.pill` / `radii.sheet`（G3-1）；错误条改 `Button variant="tinted"`。

## src/screens/FollowedRoomsScreen.tsx（工作量最大）

- 删除 `useAppTheme()`/`isDark` + `useAppTheme` import；`CenterSpinner dark=` 全部去掉（A4-1）。
- 聊天气泡硬编码 `#7BC6FF`(mine) / `#FFFFFF` 收敛为 palette 语义：自己/偶像气泡 → `palette.tint`，粉丝 → `palette.surfaceGlass`，sender 色 → `palette.tint/labelSecondary`（A4-1/②）。
- RoomRankPanel 恒深色 `#1C1C1F` → `palette.surface` + label 系，删硬编码（A4-2/③）。
- **结构性 bug**：L1581 附近 `mediaPlayBtn` 嵌套重复 `TouchableOpacity`（外+内同 onPress）→ 合并为单个 TouchableOpacity，去掉冗余嵌套触发（D4-1/①）。
- media 卡 / play 按钮色走 palette（tint/onTint），删死样式 `mediaCardHighlight/mediaPlayBtnHighlight/mediaPlayTextHighlight`。
- 空态 / 登录提示统一 `EmptyState`（聊天空态 / 登录提示 / 无关注房间）（F4-1/④）。
- 大量 dead dark 变体删除：`containerDark`、`modePill*`、`subtitle`/`row`/`inputDark`/`refresh*`、`loginLink*`、`status/mediaStatus/statusDark`、`roomItem*/roomName/roomTeam/roomMeta*/lastMessage`、`replyCardDark/replyTextDark`、`msgTimeDark/msgBubbleDark`、`giftMetaDark`、`mediaTitleDark/mediaDurationDark`、`textDark/textSubDark/emptyDark/emptyWrap/emptyLink`、`followBtnOn/followBtnTextOn`、`msgSenderIdol/Mine`（A4-1）。
- 大量缺失按压反馈补 `activeOpacity`（segment / chatTool / followBtn / pinBtn / rank关闭 / 搜索 / roomPlayer 工具 / 关注按钮 / 打开链接等）（D4-1）。
- 圆角收敛到 `radiiAlias` / `radii.sheet` / `radii.pill`（G4-1）。

## src/screens/SettingsScreen.tsx

- 修复 `style={[styles.container, false]}` → 去掉冗余 `, false`（H5-1）。
- 图标/语义色 `#ff6f91`→`palette.tint`（github/sync/verChipText），verDot `#ff3b30`→`palette.danger`、描边→`palette.onTint`，clearText `#e74c3c`→`palette.danger`（A5-1）。
- 删除全部 dead dark 变体：`containerDark/sectionDark/chipDark/chipActive/chipTextActive/aboutHeroDark/linkCardDark/autoSyncRowDark/textLight/textSubLight`、`linkBtn/linkText`（A5-1）。
- 主要操作改统一 `Button`：进入账号管理 / 选择本地图片 / 下载管理 / 运行日志（D5-1）。
- verChip / 背景清除按钮 / linkCard 补 `activeOpacity`（D5-1）。
- 区块 `FadeInView` 分层入场（delay 60/100/…/300），`Section` 自动包裹（E5-1）。
- sectionTitle 收敛 `typography.headline`，section 圆角 → `radiiAlias.card`（C5-1）。

---

## 共性（跨页）
- 移除全部 `useAppTheme()`/`isDark && xxxDark` 双分支；颜色统一 `usePalette()`。
- 空/载/错态统一 `CenterSpinner(无 dark)` / `EmptyState` / `ErrorState` / `Button`。
- `Animated` 全部 `useNativeDriver: true`（MediaScreen 公告面板 top→translateY 达成）。
- 列表入场动画按 `delay={index < 12 ? 80 + index*30 : 0}`，无双层 FadeInView 嵌套。
- 所有 `TouchableOpacity` 补 `activeOpacity`，可交互卡/按钮优先 ScalePressable/Button/Pill。
