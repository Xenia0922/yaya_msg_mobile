# UI 修复清单 · 批次 b4（6 页统一设计风格 + 补齐动画）

> 基线 `scratch/audit-b4.md`。全局契约：禁用 `useAppTheme/isDark` + `xxxDark` 双分支；`CenterSpinner` 不再传 `dark`；硬编码品牌粉/白/收藏红 → `palette.tint/onTint/danger`；Animated 一律 `useNativeDriver: true`（由共享 `FadeInView/ScalePressable` 保证）；错误/空态统一 `ErrorState/EmptyState`。

## 1. src/screens/MusicLibraryScreen.tsx（死样式最多）
- 删 `useAppTheme` import + `isDark` 变量；`styles.containerDark` 删除，容器直接 `styles.container`。
- 页头 refresh 图标 → `HeaderAction label={t('刷新')} loading/disabled`（与其它页文字版统一）。
- 清空搜索 `close-circle` → `ScalePressable`。
- 分组 chip（GROUP_TABS）→ `ScalePressable`；选中白字 `#FFFFFF` → `palette.onTint`。
- 收藏心 `TouchableOpacity` → `ScalePressable`；心色 `#ff3b5c` → `palette.danger`，未收藏 `#fff` → `palette.onTint`。
- 错误态手写 `statusOverlay+retryBtn` → `ErrorState`；空态裸 `Text` → `EmptyState icon="music-off"`；`CenterSpinner` 去 `dark`。
- renderItem 外包 `FadeInView delay={index<12?80+index*30:0}`（补列表入场动画）。
- 死样式整批删除：`containerDark/backBtn/disabledText/gChipDark/gChipOn/gTextDark/gTextOn/tabsBarLight/tabsBarDark/status/statusOverlay/retryBtn/retryBtnText/cardDark/songItemActiveDark/songItemActive/coverImg/coverPlaceholder/coverPlaceholderText/unavailableBadge/unavailableText/textDark/textSubDark`。
- `coverWrap backgroundColor '#111'` 删除（交由 CoverArt）；`gChip` 默认底色删除；`gText/songTitle/songArtist/dateText/status` 中的硬编码 `#555/#888/#aaa/#222/#ff6f91` 清理（颜色已由 palette 运行期覆盖）。

## 2. src/screens/AudioProgramsScreen.tsx（最规范，小修）
- 删 `useAppTheme`/`isDark`；两处 `CenterSpinner`（加载中/加载更多）去 `dark`。
- 页头手写 `TouchableOpacity+backBtn` → `HeaderAction label={t('刷新')} loading`。
- 删死样式 `backBtn`（命名误导的 `#ff6f91`）与 `disabledText`。

## 3. src/screens/AnalysisScreen.tsx
- 删 `useAppTheme`/`isDark` + `styles.containerDark`；`CenterSpinner` 去 `dark`。
- 页头刷新文字 → `HeaderAction`。
- 加载错误 `retryBtn` 手写 → `ErrorState`。
- dates tab `ListEmptyComponent` 裸 `Text` → `EmptyState icon="calendar-month-outline"`；media tab 补 `ListEmptyComponent=EmptyState icon="image-off-outline"`；flip tab 补 `ListEmptyComponent=EmptyState icon="card-outline"`。
- flipChip（成员筛选）→ `ScalePressable`，选中白字 → `palette.onTint`；flipPlayBtn → `ScalePressable`，白字 → `palette.onTint`。
- 删冗余别名 `roomOverview`（直接用 `cards`）。
- 删死样式 `containerDark/refreshText/retryBtn/retryBtnText/empty`。

## 4. src/screens/DownloadScreen.tsx
- 删 `useAppTheme`/`isDark`（原声名未用）与未使用 import `FlatList`。
- 页头「清理完成」手写 `TouchableOpacity+clearBtn` → `HeaderAction`。
- addBtn 手写粉按钮 → `Button variant="filled" size="md" fullWidth loading={busy}`。
- 任务行 actionBtn（retry/open/delete）→ `ScalePressable`；图片预览模态 `TouchableOpacity` → `ScalePressable activeOpacity={1}`。
- 空态 `ListEmptyComponent` 裸 `Text` → `EmptyState icon="download-off"`。
- 删死样式 `clearBtn/btnDisabled/addBtnText/empty`；`addBtn` 简化为 `{ marginTop:10, alignSelf:'stretch' }`。

## 5. src/screens/DatabaseScreen.tsx（特别任务）
- summaryRow 为纯展示卡、本页无详情页可进：移除误导性的 `chevron-right` 装饰，并加注释说明（非可点击）。
- 同步失败重试 `TouchableOpacity` → `ScalePressable`。
- 页头「刷新」手写 → `HeaderAction`。
- webError 重试 `TouchableOpacity` → `ScalePressable`；`webRetryBtn` 圆角 `16` → `radiiAlias.button`。
- 删死硬编码样式 `headerAction ('#ff6f91')` 与 `errorText` 的 `'#ff6f91'`（颜色移入 JSX 用 `palette.tint`）；删不再使用的 `TouchableOpacity` import。

## 6. src/screens/TripScreen.tsx
- 删 `useAppTheme`/`isDark`；`CenterSpinner` 去 `dark`。
- 页头「刷新」手写 → `HeaderAction`。
- 空态手写 `Text` → `EmptyState icon="calendar-heart"`，加载/错误态保持 `CenterSpinner/ErrorState`。
- 票务 linkBtn `TouchableOpacity` → `ScalePressable`，白字/图标 → `palette.onTint`。
- 删死样式 `headerAction/disabledText/emptyWrap/empty`；`linkBtnText` 的 `'#fff'` 移除；删不再使用的 `TouchableOpacity` import。

## 验证
每个文件修改后：`npx tsc --noEmit | Select-String "screens\\(MusicLibraryScreen|AudioProgramsScreen|AnalysisScreen|DownloadScreen|DatabaseScreen|TripScreen)"` → 全部 0 匹配（0 错误；其它批次错误忽略）。
