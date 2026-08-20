# 布局重做 · B 批 · 改动明细

基准：`scratch/layout-spec-v2.md`。范围：6 个页面（业务逻辑 / API / 数据流 / 路由 / i18n 原文一律未动）。
验证：`npx tsc --noEmit` 本批 6 文件 **0 错误**（全仓 11 个既有错误均位于 AnalysisScreen / BilibiliLiveScreen / FollowedRoomsScreen / MeleeRankScreen，与本批无关）。

---

## 1. PhotosScreen
- **布局结构**：before → after：2 列带边框照片卡 + 文字底栏 + 圆按钮下载 → **3 列正方形紧致网格（gap 6）无边框沉浸式网格** + 顶部成员选择行卡 + 首屏 Skeleton 网格块。
- 关键改动：
  - 网格改为 `numColumns={3}`、`photoCell` aspectRatio 1、margin 3（≈gap 6），无边框、去画面下方标题栏。
  - 顶部重构为「48 圆形头像 + 名字/副标题 + chevron-down」成员选择行卡；展开区引入 MemberPicker；加「刷新」HeaderAction。
  - 首屏 loading 改为一组 3×3 Skeleton 方形占位（同构网格）。
  - 列表加 `RefreshControl`（tint 色）；图片点击打开 ZoomImageModal，长按下载保留。
  - 入场 delay 改为 `60 + index*25`；按压统一 ScalePressable `pressedScale=0.96`。

## 2. RoomAlbumScreen
- **布局结构**：before → after：2 列 1:1 带边框卡 + 顶部 tint 实底/白字 mode 按钮 → **2 列 3:4 网格 + 底部渐变遮罩标题白字 13** + 大/小房间 Segmented 分段控件 + 视频时长胶囊角标。
- 关键改动：
  - 网格卡改为 `aspectRatio 3/4`、`mediaCard` 深色底无缝，底部 45% 渐变遮罩 + 标题白字 13/700 + 轻阴影（去原双阴影+meta）。
  - 大/小房间由实底按钮改为 `fill2` 底 + 选中白胶囊的 Segmented 分段控件。
  - 视频卡：封面 + 中央播放遮罩/播放钮 + 右上角黑半透明时长胶囊（formatDuration）。
  - 首屏 loading 改 2×4 列 Skeleton；列表加 RefreshControl；空态 EmptyState 补 hint。
  - 输入固定 `60 + index*25` 入场；长按下载保留。

## 3. VideoLibraryScreen
- **布局结构**：before → after：第 1 个视频 16:9 high banner + 其余 1:1 网格标题/日期 → **16:9 banner 大卡（标题 + 时长徽标 + 中央播放钮）** + 其余 **2 列 16:9 网格卡（封面 + 时长右上角 + 两行标题）**。
- 关键改动：
  - banner 封面固定 `aspectRatio 16/9`，新增中央白/黑播放钮；时长胶囊左下 + clock 图标；底部渐变遮罩标题白字。
  - 网格卡封面改 `aspectRatio 16/9`，右上黑半透明时长徽标 + 播放遮罩，标题两行 `numberOfLines={2}`。
  - 首屏改 banner + 2×2 网格 Skeleton；列表加 RefreshControl。
  - 按压统一 ScalePressable；入场 `60 + index*25`。

## 4. AudioProgramsScreen
- **布局结构**：before → after：72 封面 hero 卡（白底） + 40×40 图标行列表 → **96 圆角 16 封面 hero 播放卡（16/700 标题 + 12 副标题 + tint 圆钮/加载指示）** + **48 圆角 10 封面行（15/600 标题 + 12 日期副题 + 时长右对齐 11）**。
- 关键改动：
  - hero 封面扩至 96（圆角 16），标题 16/700，副标题 12；播放/暂停圆钮 tint 底白字 icon，解析中显示 ActivityIndicator。
  - 列表行封面 48 圆角 10（支持真实封面 NetworkImage），标题 15/600，副标题用日期/嘉宾，右侧播放钮 + 时长右对齐 11。
  - 首屏用 hero + 行式 Skeleton 列表；列表加 RefreshControl。
  - 入场错峰（表头 hero + 行 `60 + index*25`）。

## 5. FlipScreen
- **布局结构**：before → after：发送页 5 个独立白卡 section（每卡 label + 输入）→ **统一发送表单分组（icon 段头 + 回复形式/公开设置 Pill 行 + fill2 圆角 14 输入区 + 全宽 filled 发送钮）**；历史页 → **行卡：类型 tag(tintSoft) + 状态徽标(成功 success/失败 danger/等待 tint) + 时间 11 + 左侧正文 + 右侧播放/重试钮**。
- 关键改动（发送态）：
  - 5 个 section 合并为带「组图标+标题」的表头分组；内容输入区改 `fill2` 圆角 14 无描边；计数/余额成行。
  - 鸡腿数改为内嵌行（label + 输入 + 充值钮）；发送 Button `size="lg"` 全宽；状态按成败着色。
- 关键改动（历史态）：
  - 卡片改 `fill2` 底无描边轻卡；加状态徽标（status1 tint / status2 success / 其它 danger）。
  - 播放/收起操作改右侧圆形 tintSoft 播放钮（原 sm filled Button）；时长信息并入 meta。
  - 类型 tag 改 `radii.xs` tintSoft 底 tint 字；日期右置 11。
  - 入场 `60 + index*25`。

## 6. FetchScreen
- **布局结构**：before → after：4 个独立 Pill 强制按钮 + md filled 按钮 → **单一面板内两个 Segmented 分段（消息范围 / 房间分区，fill2 底 + 选中白胶囊）+ 全宽 filled 抓取钮 + 成功/失败状态胶囊条** + 消息结果行卡（sender 13/700 + 时间 10 右 + 正文 14 省略）。
- 关键改动：
  - 「全部/成员」「大/小房间」由 Pill 行改为 two 组 Segmented 分段控件（fill2 底 + 白胶囊）。
  - 抓取按钮改 `size="lg"` 全宽；状态条改为胶囊（成功 tintSoft/tint、失败 danger 红底）。
  - 消息行改 `fill2` 轻卡：sender 13/700 + 时间 10 右对齐 + 正文 14 / secondary / 4 行省略；分组计数徽标。
  - 入场 `60 + index*25`。

---

### 全批统一
- 颜色全部走 `usePalette()`；图标 MaterialCommunityIcons；Animated 均 `useNativeDriver: true`。
- 入场 `FadeInView delay={index<12 ? 60+index*25 : 0}`，无双层嵌套。
- 可刷新页面（相册/视频/电台）均补 `RefreshControl`；首屏 Skeleton 6~8 块同构占位。
- 按压类交互统一 `ScalePressable` / `Button` / Segment(activeOpacity)。
