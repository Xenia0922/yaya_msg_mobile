# b5 批次修复记录（6 页统一设计风格 + 动画细节）

依据 `scratch/audit-b5.md` 逐条落实。改动聚焦 UI 外观，未触碰任何业务逻辑 / API 调用 / 数据流 / 路由参数，i18n文案保持 t('中文') 不变。

## 1. src/screens/MeleeRankScreen.tsx
- 删 `useAppTheme()`/`isDark`，删 `isDark && styles.containerDark`（死代码）与 `containerDark` 样式，容器直接 `styles.container`。
- 双层 FadeInView 修复：删外层列表级 FadeInView（原 L239/260），保留 item 级 `FadeInView delay={80+index*24}`。
- `CenterSpinner dark={isDark}` → `<CenterSpinner text={t('加载中…')} />`（2 处）。
- 自绘错误态 → `<ErrorState title={error} onAction=...>`（含 retry 按钮）。
- 自绘空态裸 Text → `<EmptyState icon="trophy-outline" title=...>`（person/rank 两处）。
- 删 retryBtn/retryText/errorWrap/errorText/empty 死样式；`retryText #fff` 死代码由 ErrorState 内置按钮替代。
- `rankNum fontWeight:'900'` → `700`；头像/卡片/leadIcon 圆角改 `radiiAlias.avatar/card`、`radii.md`。
- 清理未使用 import（TouchableOpacity/FlatList/useSettingsStore/Button）。

## 2. src/screens/MemberDynamicScreen.tsx
- 删 `useAppTheme()`/`isDark`，`CenterSpinner dark={isDark}` → `<CenterSpinner text=...>`。
- 双层 FadeInView 修复：删外层列表级 FadeInView（原 L138），保留 item 级 `delay={index<12?80+index*30:0}`。
- 页头右侧自绘「刷新」TouchableOpacity → `<HeaderAction label={t('刷新')} ...>`（自带 disabled 降透明度）。
- 自绘空态（star+文字）→ `<EmptyState icon="star-circle-outline" ...>`。
- 图片 TouchableOpacity → `ScalePressable`；九宫格固定 100px → `gridItem flexBasis:'31%' + aspectRatio:1` 百分比自适应（对齐 CommunityPostCard L135）。
- 清 未使用 import（ActivityIndicator/FlatList/TouchableOpacity/MaterialCommunityIcons/useSettingsStore）、删 headerAction/disabledText/emptyWrap/empty 死样式。

## 3. src/screens/MemberWeiboScreen.tsx
- 删 `useAppTheme()`/`isDark`，`CenterSpinner dark={isDark}` → `<CenterSpinner text=...>`。
- 双层 FadeInView 修复：删外层列表级 FadeInView（原 L158），保留 item 级 FadeInView。
- 页头刷新自绘 → `HeaderAction`。
- 自绘空态裸 Text → `<EmptyState icon="account-outline" ...>`。
- linkBtn（查看微博原文）TouchableOpacity 缺 activeOpacity → `ScalePressable`；图片 TouchableOpacity → `ScalePressable`。
- 九宫格固定 100px → `flexBasis:'31%' + aspectRatio:1`。
- 清 未使用 import、删 headerAction/disabledText/emptyWrap/empty 死样式。

## 4. src/screens/InvoiceScreen.tsx
- 状态绿硬编码 `#20a464`（可开票状态色）→ `palette.success`。
- 清理死硬编码：headerAction/errorText/submitBtn 的 `#ff6f91`（均被运行时 palette.tint 覆盖）。
- 页头「刷新」自绘 → `HeaderAction`。
- 错误 row（tint 重试）→ `<ErrorState title={t('加载失败')} hint={error} onAction=...>`。
- 空态裸 Text → `<EmptyState icon="receipt-outline" title={t('暂无订单')} />`。
- loading `ActivityIndicator` → `<CenterSpinner />`。
- 「个人/企业」typeBtn → `Pill`（selected 态）；`styles.typeBtn flex:1 居中`。
- submitBtn（主 CTA）→ `<Button variant="filled" loading={submitting} disabled fullWidth>`（自带 pressed scale + disabled 透明度 + loading spinner）。
- 圆角改 `radiiAlias.card/button/input`；删 retryBtn/retryBtnText/errorRow/errorText/empty/disabledBtn/submitText 死样式。
- 清 未使用 import（ActivityIndicator/radii）。

## 5. src/screens/CommunityScreen.tsx
- 删 `useAppTheme()`/`isDark`，`CenterSpinner dark={isDark}` → `<CenterSpinner text=...>`；listEmpty 的 deps 移除 isDark。
- 双层 FadeInView 修复：删外层列表级 FadeInView（原 L175），保留 item 级 `delay={index<10?60+index*25:0}`。
- compose 图标 TouchableOpacity → `ScalePressable`（hitSlop 保留）。
- 推荐/最新 tabPill → `Pill`（selected 态，自带 pressed scale）。
- 发帖 submitBtn → `<Button variant="filled" loading={sending} disabled size="sm">`。
- 输入框圆角 12 → `radiiAlias.input`(14)；submitBtn/sheet/round 改 `radiiAlias.button`/`radii.sheet`；composeBtn 用 `radiiAlias.avatar`。
- 删 tabText/submitText 死样式。

## 6. src/screens/CommunityPostDetailScreen.tsx
- 删 `useAppTheme()`/`isDark`，`CenterSpinner dark={isDark}`（L210/226/253）→ `<CenterSpinner ...>`（3 处）。
- 评论行包裹 `FadeInView`（轻量入场，`delay={index<12?80+index*30:0}` 仅首屏）。
- 评论空态裸 Text → `<EmptyState icon="comment-outline" title={t('暂无评论，来抢沙发～')} />`。
- 发送成功：`Keyboard.dismiss()` + `requestAnimationFrame` 内 `listRef.current?.scrollToOffset({offset:0,animated:true})` 定位到顶部（PerfFlatList forwardRef + scrollToOffset）。新增 `listRef`。
- 查看更多评论 → `ScalePressable`（新增 `loadMoreBtn` style 包裹）；sendBtn → `ScalePressable`，白字改 `palette.onTint`。
- 清 未使用 import（TouchableOpacity）、删 commentsEmpty 死样式。

## 验证
`npx tsc --noEmit`：6 个目标文件 0 错误。剩余 7 个 TS 错误全部位于其他批次文件 `src/screens/HomeScreen.tsx`（与本批无关）。
