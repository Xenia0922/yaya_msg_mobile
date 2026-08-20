# B3 批次 UI 修复记录 — 6 页统一设计风格 & 补齐动画细节

> 审计基准：audit-b3.md。所有改动不触碰业务逻辑 / API / 数据流 / 路由参数 / i18n。
> 验证：`npx tsc --noEmit` 中 **6 个文件 0 错误**（唯一报错为批次外 HomeScreen.tsx，忽略）。

---

## RoomAlbumScreen.tsx
- 删除 `useAppTheme()`/`isDark` 及 `AlbumGridItem` 的 `isDark` prop 传递链（renderAlbumItem、组件签名、调用点）。
- `CenterSpinner dark={isDark}` → `<CenterSpinner text={t('加载中…')} />`（去 dark prop）。
- 空态裸 `<Text>` → `<EmptyState icon="image-multiple-outline" title={t('暂无相册内容')} />`。
- 错误态手写 retryRow → `<ErrorState title={t('加载失败')} hint={loadError} onAction=… />`。
- 页头刷新 TouchableOpacity → `<HeaderAction label={t('刷新')} … />`。
- modeBtn 与播放页错误返回按钮补 `activeOpacity={0.7}`；网格卡 TouchableOpacity → `ScalePressable`。
- 网格项 `FadeInView duration={300}` 改 `delay={index < 12 ? 80 + index * 30 : 0}`（renderAlbumItem 传入 index），滚动复放不再无限延迟。
- `FadeInView` 外层去掉 `style={{ flex: 1 }}`（只包 opacity/transform）。
- modeText 选中态 `#FFFFFF` → `palette.onTint`。
- 死 import 删除 `Image`。
- 死样式删除 `backBtn/empty/retryRow/retryText/retryBtn/retryBtnText`。

## RoomRadioScreen.tsx（全批最不合规）
- 删除 `useAppTheme()`/`isDark` + `containerDark` 死样式与条件。
- 删除未用的 `useNavigation`/`navigation`、`useSettingsStore` 导入、`playerRef`（及 Video ref 属性）。
- 三态全改统一组件：loading → `<CenterSpinner text={t('正在获取电台地址…')} />`、error → `<ErrorState … onAction=startRadio />`、空（未选成员）→ `<EmptyState icon="broadcast" … />`。
- modePill 硬圆角 14 → 替换为 `Pill` 组件（big/small 选中态）。
- 全部控件 TouchableOpacity 补 `activeOpacity={0.7}`；胶囊/开关用 Pill；按钮白字 → `palette.onTint`（ctrlBtnText/playBtnText 去样式内 `#fff`，改内联 onTint）。

## OpenLiveScreen.tsx
- 删除 `useAppTheme()`/`isDark` + `containerDark`；删除未用的 `useNavigation`/`navigation`、`FlatList`、`ActivityIndicator` 导入。
- headerAction 就地粉 `#ff6f91` → `HeaderAction`（刷新、横屏切换共用）。
- 播放错误 `#FF6B6B` → `palette.danger`；播放页错误返回按钮、externalBtn 补 `activeOpacity`，白字 → `palette.onTint`。
- externalBtn 就地品牌粉 `#ff6f91` → `palette.tint`（内联），externalText 白 → `palette.onTint`。
- 列表空/载手写 → `EmptyState` / `CenterSpinner`。
- 列表项 `FadeInView delay={80 + index * 30}` → 加 `index < 12` 首屏限制。
- 死样式删除 `containerDark/headerAction/disabledText/emptyWrap/empty`。

## PrivateMessagesScreen.tsx（气泡最严重）
- 删除 `useAppTheme()`/`isDark` 及全部 `CenterSpinner dark={isDark}`。
- 气泡配色重构：`bubbleMine` 的 `#7BC6FF` → `palette.tint`、`bubbleOther:#FFFFFF` 死样式删除（JSX `mine ? styles.bubbleMine : null` + `backgroundColor: mine ? palette.tint : palette.surface`）。
- mine 白字 → `palette.onTint`（msgText/msgTime/play icon 内联 onTint），删除 `msgTextMine`/`msgTimeMine` 死样式。
- 删 L504 与样式表冲突死分支（`mine ? undefined` 重构）。
- mediaBtn/flipChip/充值/send → `ScalePressable`（原 TouchableOpacity 无反馈）；mediaBtn mine 背景 → `palette.tintSoft`；play icon 白 → `palette.onTint`。
- 页头刷新 → `HeaderAction`。
- 会话空态裸 `Text` → `EmptyState`；消息空态裸 `Text` → `EmptyState icon="message-text-outline"`；conv 空态 → `EmptyState icon="message-outline"`；load 时 `ListEmptyComponent` 返回 null。
- inputBar 底色 `palette.surface` → `palette.surfaceGlassStrong`（与列表区分）；input 底色改回 `palette.surface`。
- inlineImg 死背景 `#EEEEEF` → `palette.fill2`（内联）。
- 死样式删除 `refreshBtn/empty/bubbleOther/msgTextMine/msgTimeMine/flipChipTOn` 及 `flipRechargeT/sendT` 内置 `#fff`。

## BilibiliLiveScreen.tsx
- 删除 `useAppTheme()`/`isDark` + `containerDark`。
- header 加载 `ActivityIndicator color="#ff6f91"` → `palette.tint`；刷新 → `HeaderAction`。
- 控制层 fade 动画（showControls/toggleControls）补 `easing: Easing.out(Easing.cubic)`（native driver 保留）。
- `Dimensions.get('window')` → `useWindowDimensions()`（biliWindow 宽高）。
- 列表空/载手写 → `EmptyState` / `CenterSpinner`。
- roomItem 补 `activeOpacity={0.85}`；刷新/`retryBtn`→`HeaderAction`；webFallbackBtn/retryBtn 补 activeOpacity，白字 → `palette.onTint`。
- statusDot：offlineDot（黑 25%）→ `palette.labelTertiary`、liveDot（#4caf50）→ `palette.success`（内联）。
- 死样式删除 `containerDark/refresh/liveDot/offlineDot/empty/emptyWrap`；webFallbackBtn 去就地粉。

## VideoLibraryScreen.tsx（最合规一页，轻量清理）
- 删除 `useAppTheme()`/`isDark` 及 `CenterSpinner dark={isDark}`（两处）。
- 删除未用的 `useNavigation`/`navigation` 导入与声明。
- 页头刷新 → `HeaderAction`（去 backBtn 就地 `#ff6f91` 与 disabledText 死样式）。
- 网格卡 `borderRadius: 14` → `16`（与 banner 圆角统一 radiiAlias.card）。
- 网格项 `FadeInView delay={80 + index * 30}` → 加 `index < 12` 首屏限制。
- 死样式删除 `backBtn/disabledText/bannerInfo/bannerTitle/bannerMeta`。
