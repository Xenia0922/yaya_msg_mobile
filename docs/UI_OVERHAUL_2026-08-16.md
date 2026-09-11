# 牙牙消息 2.6.5 · UI 全量统一与动效完善（2026-08-16）

> 本次改造目标：全站 30 个功能页 + 22 个共享组件统一设计语言（Palette 双主题 token），
> 补齐 UI 动画细节，清理全部旧式双分支/死代码。`tsc --noEmit` 0 错误。

---

## 1. 主题与共享组件升级（src/theme + src/components）

| 变更 | 说明 |
|:--|:--|
| `theme/colors.ts` | 新增 `onTint` token（tint 填充上的前景白字），双主题统一 |
| `theme/radii.ts` | 新增 `radii.sheet=22`（底部弹层圆角）；修正注释与 `radiiAlias.button=18` 的矛盾说明 |
| `Loaders.tsx` | `CenterSpinner` 删除 `dark` prop，内部 `usePalette().tint` 自动双主题 |
| `StateViews.tsx` | 空/错态统一组件；操作按钮改用统一 `Button`（删除第三套自绘按钮） |
| `components/EmptyState.tsx` | 删除（与 StateViews 重复，全站 0 引用） |
| `Button.tsx` | 删除 `export { motion }` 死代码；白字 → `palette.onTint` |
| `GlassCard.tsx` | 删除冗余 `Platform.select`；注释修正 |
| `AppScaffold.tsx` | 背景改 `palette.background`（不再手写 #F2F2F7/#000） |
| `ScreenHeader.tsx` | 返回键改 `ScalePressable`（统一按压缩放） |
| `ListItem.tsx` | 按压底色 → `palette.fill2` |
| `SectionHeader.tsx` | 「更多」文字按钮补按压反馈（opacity+scale） |
| `Pill.tsx` | 白字 → `palette.onTint` |
| `Skeleton.tsx` | 删除空 styles |
| `AppToast.tsx` | 圆角 → `radii.sheet` |
| `HeaderAction.tsx` | **新增**：页头右侧文字按钮统一组件（label/onPress/disabled/loading） |
| `AppTabBar.tsx` | **新增 active 图标 spring 弹跳**（motion.spring.bouncy，切 tab 图标放大回弹） |
| `App.tsx` | 公告弹窗卡片 spring 入场（scale 0.92→1 + translateY 16→0） |

## 2. 重度组件重构

| 组件 | 变更 |
|:--|:--|
| `FullScreenPlayer.tsx` | 全面主题化（删 `isDark`/`Colors.bgDark` 反主题实现）；**下拉关闭手势方向修正 translateX→translateY**（方向与手势一致）；删 3 个未用样式与无效 `!visible` 双保险；进度/歌词/图标全走 palette；播放列表 sheet 圆角 `radii.sheet` |
| `ZoomImageModal.tsx` | 缩放/平移从 React state 改为 `Animated` + `useNativeDriver`；松手 spring 回弹（motion.spring.bouncy）；关闭按钮补 activeOpacity |
| `MemberPicker.tsx` | `useAppTheme` 双分支 → `usePalette`；chip 复用 `Pill`；修复 `.//` 病态导入路径 |
| `DanmakuSettingsSheet.tsx` | `useAppTheme` 双分支 → `usePalette`；chips 复用 `Pill`；「恢复默认」用 `Button` |
| `ErrorBoundary.tsx` | 自绘错误页 → 统一 `ErrorState`；全主题化 |
| `RuntimeLogViewer.tsx` | `useAppTheme` 双分支 → `usePalette`；过滤 chip 复用 `Pill`；工具栏按钮统一 |
| `MiniPlayerBar.tsx` | 删 `void spacing` 死代码；阴影 → `makeShadows` |
| `CoverArt.tsx` | 裸 `Image` → `NetworkImage`；`radii.pill`；定时器卸载清理（mounted ref） |

## 3. 30 个功能页统一改造（每页均完成）

**通用改动（全部页面）**
- 删除 `useAppTheme()`/`isDark` + `isDark && styles.xxxDark` 双分支与全部 `xxxDark` 死样式
- `CenterSpinner` 不再传 `dark`
- 硬编码 `#ff6f91` → `palette.tint`；白字 → `palette.onTint`；状态色 → `palette.danger/warning/success`
- 空态/错误态/加载态统一 `EmptyState`/`ErrorState`/`CenterSpinner`
- 缺失按压反馈的 `TouchableOpacity` → `ScalePressable`/`Button`/`Pill` 或补 `activeOpacity`
- 列表入场动画统一 `FadeInView delay={index < 12 ? 80 + index * 30 : 0}`（首屏错峰，滚动不复放）
- 删除被 palette 覆盖的死样式与未用 import
- 圆角/间距收敛到 `radiiAlias`/`spacing`/`insets`；字号收敛到 `typography`

**重点页面专项**
| 页面 | 专项修复 |
|:--|:--|
| HomeScreen | 直播重试 → `Button`；四大区块 FadeInView 分层入场（60/100/140/180） |
| MessagesScreen | 硬编码 style 全清；成员选择 Modal 空态 → `EmptyState` |
| MediaScreen | 公告面板 `top` 动画 → `translateY`+`useNativeDriver:true`（红线）；礼物/贡献榜 Modal 恒深色 → 主题化；删 `VodCardSkeleton` 冒名组件与 8 个死样式 |
| FollowedRoomsScreen | **修复 mediaPlayBtn 嵌套重复 TouchableOpacity 结构性 bug**；气泡 `#7BC6FF` → palette 语义（idol/mine=palette.tint）；RoomRankPanel 恒深色 → 主题化；空态/登录提示统一 |
| SettingsScreen | 删 `, false` 伪 prop；图标/语义色 token 化；主要操作 → `Button` |
| LoginScreen | 12 个无反馈按钮收敛；6 段手写玻璃 → `GlassCard`；死样式全清 |
| FlipScreen / FetchScreen | 模式/回复 chip → `Pill`；空错态统一；列表 delay 加 index<12 |
| PrivateMessagesScreen | 气泡 `#7BC6FF/#FFFFFF` → palette（mine=palette.tint）；输入条与列表分层 |
| BilibiliLiveScreen | 控制层 fade 加 `Easing.out(Easing.cubic)`；`Dimensions` → `useWindowDimensions`；状态点主题化 |
| MeleeRank/MemberDynamic/MemberWeibo/Community | **删除 4 处双层 FadeInView 嵌套（二次淡入跳动）**；九宫格固定 100px → flexBasis 百分比 |
| InvoiceScreen | 状态绿 `#20a464` → `palette.success`；submit → `Button` |
| CommunityPostDetailScreen | 评论行补入场动画；发送后 `Keyboard.dismiss()` + 回顶定位 |
| MusicLibraryScreen | 列表补入场动画；一整批死样式清理；收藏心 → `palette.danger` |
| AnalysisScreen / DownloadScreen / DatabaseScreen / TripScreen | 空错态统一；header 刷新统一 `HeaderAction`；summaryRow 误导 chevron 移除 |

## 4. 验证

- `npx tsc --noEmit`：**0 错误**
- `node scripts/verify-version.js`：四源版本一致 ✅（v2.6.5 / versionCode 2060005）
- Android release APK 构建：见构建日志（`android` gradle assembleRelease）
- 审计报告存档：`scratch/audit-*.md`（6 份）；修复记录：`scratch/fix-*.md`（5 份）

## 5. 统计

- 改动文件：57 个（+1703 / -2044 行，净删 341 行死代码）
- 全站 `useAppTheme()`/`isDark` 双分支：**0 处残留**（仅 hook 定义本身）
- 全站 `xxxDark` 死样式：**0 处残留**
