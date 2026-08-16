# 布局重做规范 v2（2026-08-16 · 全页面执行基准）

> 目标：布局易用性、美观性、交互流畅合理性。所有页面按本规范重做布局，
> 业务逻辑 / API 调用 / 数据流 / 路由 / i18n 原文一律不动。

## 1. 页面骨架
- 容器背景 `palette.background`（自定义背景图时保持 transparent，由外层 ImageBackground 提供）。
- 内容区水平留白：`insets.screenHorizontal = 20`；底部 `paddingBottom = 84 + insets.bottom`（Tab 页 96+）。
- 页头一律 `ScreenHeader`；页头右侧文字操作统一 `HeaderAction`。

## 2. 区块节奏
- 每屏区块 ≤ 4 个；区块间距 24（`spacing.xl`）。
- 区块标题：`SectionHeader` 或「4×18 tint 竖条 dot + headline 标题 + 可选「全部 ›」」。

## 3. 列表行范式（ListRow）
- leading：48×48 缩略图/头像，圆角 12，无图时 fill3 底 + 语义图标。
- 标题：15/600 `palette.label`；副标题：12 `palette.labelSecondary`（1 行省略）。
- 右侧：chevron（labelTertiary）或 时间 11 labelTertiary 或 状态徽标。
- 行 padding 12、行间距 8；按压 `ScalePressable pressedScale={0.97}`，底色 fill2。

## 4. 网格范式（GridCard）
- 2 列，gap 12；图片 16:9（视频/直播）或 3:4（相册/音乐封面 1:1）。
- 圆角 16；底部渐变遮罩 `rgba(0,0,0,0.55)→rgba(0,0,0,0)`（高度 45%）内标题白字 13/700 带轻阴影。
- 右上角徽标：黑半透明 `rgba(0,0,0,0.55)` 胶囊、白字 10/700（时长 / 直播中 / 集数）。
- 网格间距：list padding 12 + gap 12（视觉 16 屏边留白）。

## 5. 聊天气泡范式（ChatBubble）
- 他人：`palette.surfaceGlass` 左气泡；自己：`palette.tint` 右气泡、文字 `palette.onTint`。
- 圆角 16，指向角 6（左上/右上）；同发送者连排（3 分钟内）组内圆角 6，组首带头像+名字+时间。
- 名字 12/600（tint 或 labelSecondary）；时间 10 labelTertiary；正文 15/400（自己气泡 onTint，他人 label）。
- 日期分隔条：居中胶囊 `palette.fill2` 底、10 号 labelTertiary。

## 6. 搜索条（SearchBar）
- 高度 40、圆角 14、`palette.fill2` 底（深色 fill1）；左侧 `magnify` 图标 16 labelTertiary；
- 文字 15；有内容时右侧清除按钮（close-circle，activeOpacity 0.7）。

## 7. 分段控件（Segmented）
- 容器 `palette.fill2` 圆角 12 padding 3；选中项白胶囊 `palette.surface` + shadows.sm 或 tint 底白字；
- 等宽 flex:1；切换即时、无闪烁（保留本地 state）。

## 8. 加载 / 空态 / 错误态
- 首屏：6~8 块 `Skeleton` 占位（行式/网格式，与真实内容同构）。
- 增量加载：`CenterSpinner`（列表底部）。
- 所有可刷新列表：`RefreshControl`（tint 色），与「重试」并存。
- 空态 `EmptyState`（icon glyph / title / hint / action）；错误态 `ErrorState`（含重试）。

## 9. 按钮 / 图标 / 动效
- 主按钮 `Button`（filled/tinted/plain）；chip `Pill`；页头操作 `HeaderAction`。
- 图标一律 `MaterialCommunityIcons`（禁止 emoji）。
- 列表入场：`FadeInView delay={index < 12 ? 60 + index * 25 : 0}`；禁止双层嵌套。
- 按压反馈统一：交互元素 ScalePressable / Button / Pill / activeOpacity ≤ 0.85。
- Animated 一律 `useNativeDriver: true`；Modal 进出场用 fade（全屏）/slide（底部 sheet 圆角 radii.sheet=22 + 顶部 handle）。
- 成功/失败操作给 `AppToast` 反馈；表单/输入页用 KeyboardAvoidingView。

## 10. 双主题
- 全部颜色走 `usePalette()`（tint/tintSoft/onTint/label/labelSecondary/labelTertiary/fill1-3/surface/surfaceGlass/surfaceGlassStrong/background/danger/warning/success/hairline/innerStroke）；
- 禁止 `useAppTheme()/isDark` 双分支；媒体内容上的白字/遮罩属合理场景。
