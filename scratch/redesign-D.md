# 布局重做明细 D 批（8 页 · layout-spec-v2 执行）

> 范围：成员动态 / 成员微博 / 社区 / 帖子详情 / 房间电台 / 公演记录 / B站直播 / 数据库。
> 业务逻辑 / API / 数据流 / 路由 / i18n 原文一律未动；props/state 尽量保持；颜色全走 usePalette；图标 MaterialCommunityIcons；Animated 全 useNativeDriver:true；列表入场 FadeInView delay=60+index*25（index<12 时），无双层嵌套。

---

## 1. src/screens/MemberDynamicScreen.tsx
- **布局 before→after**：左 28px 头像小卡 + 彩色正文多行 → iOS 26 动态卡范式（40 圆头像 + 14/700 名字 + 11 labelTertiary 时间 + 15/400 正文最多 6 行 + 九宫格 + 底部统计）。
- 头像 28→40 圆，加入 / 名字 12→14/700，时间 11。
- 正文 number-of-lines 10→6，正文色 labelSecondary→label。
- 新增底部统计行：点赞（heart-outline）/ 转发（share-outline）12 labelSecondary，parseExt 补抓 likeCount/forwardCount（无则 0，仅展示不影响数据流）。
- 九宫格图 3 列 flexBasis 31% gap 4 圆角 10（保留），图项按 ScalePressable 0.96。
- 入场 delay 由 80+30i 改为规范 60+25i；卡片底部加 hairline 分隔。
- 新增：首屏 4 块同构 Skeleton 卡（头像+两行+正文+3 图）；RefreshControl（tint）；空态保持 star-circle-outline。

## 2. src/screens/MemberWeiboScreen.tsx
- **before→after**：同类左头像小卡 → 微博动态卡范式（40 圆头像 + 名字 + 时间 + 正文 6 行 + 九宫格 + 统计 + 原文链接行）。
- 头像 28→40，正文 12 行→6 行，名字/时间规范。
- 新增底部统计行（thumb-up-outline 点赞 / share-outline 转发）compat parseWbExt 补抓。
- 「查看微博原文」改为外部链接行：external-link 图标 + tint 字 13/600，去掉 open-in-new。
- 空态图标 account-outline→web；入场 delay 60+25i。
- 新增：首屏 4 块同构 Skeleton；RefreshControl（tint）。

## 3. src/screens/CommunityScreen.tsx
- **before→after**：顶部 2 个独立 Pill 分段 + 页头右上 pencil 图标 → fill2 底分段容器（选中白胶囊 + sm 阴影）+ 右下角发布 FAB；保留发帖 sheet 与数据流。
- 推荐/最新改成分段控件：fill2 容器圆角 md padding 3，选中项 surface 白胶囊 + shadows.sm，flex:1 等宽；按下 0.96。
- 新增右下角发布 FAB：tint 圆 56 + plus 白色 28 图标 + sm 阴影，ScalePressable 0.94；移除原页头右上 pencil 按钮位。
- 发帖 sheet 底 surfaceGlassStrong（原 surface），handle/标题/输入/话题行/发布按钮保留。
- 帖子卡 CommunityPostCard 保持；入场 60+25i；空态缺骨架 → 新增 3 块同构 Skeleton。
- onEndReached 用 loadingRef + hasMore 防连发；列表 paddingBottom 96（给 FAB 让位）。

## 4. src/screens/CommunityPostDetailScreen.tsx
- **before→after**：评论行 28 头像 + 紧凑文字 → 规范评论区行（36 圆头像 + 13/600 名字 + 10 时间 + 14/400 正文 + hairline 分隔）。
- 评论头像 28→36；名字 12/700→13/600；正文 13/400→14/400；行加 hairline 分隔。
- 底部输入条 surface→surfaceGlassStrong（保留圆角 18 输入 + tint 发送圆钮，发送钮再按 0.9）。
- 首屏详情加载 CenterSpinner→同构 Skeleton 卡（头像+4 行+3 图占位）。
- 评论入场 delay 60+25i；评论空态保持 comment-outline。

## 5. src/screens/RoomRadioScreen.tsx（整页重做）
- **before→after**：纯文字小卡 + 文字按钮控制 → iOS 26 播放器大卡（120 圆角 20 居中封面 + 18/700 标题 + 12 副标题 + 56/36 控制圆钮 + 模式 Pin + 状态胶囊）。
- 播放器大卡圆角 20 + sm 阴影；封面 120 圆角 20 居中（用成员头像 NetworkImage / tint 占位）。
- 控制行：主钮 56 圆 tint 底白字（播放/暂停，switch），次钮 36 圆 fill2 底（重播 / 静音 / 停止，图标+字）。
- 状态条：非加载时显示 status 胶囊（tintSoft/tint 或 danger 错误胶囊）。
- 加载中 CenterSpinner、失败 ErrorState（含重试）、空态 EmptyState(broadcast) 均内嵌播放卡；隐藏 Video 播放保留。
- 模式 Pill（大/小房间）置于选择器下方居中；子标题轮换 已静音/正在播放/状态文本。

## 6. src/screens/OpenLiveScreen.tsx
- **before→after**：82 封面大卡 + 堆叠元信息 → 列表行卡（封面 56 圆角 12 + 14/700 标题 2 行 + 12 副标题 + 日期 12 + 状态徽标 + chevron）。
- 封面 82→56 圆角 12（无图 tintSoft play 占位）。
- 标题 15/700→14/700（2 行），元信息行：成员名 12 labelSecondary + 日期 12 labelSecondary。
- 新增状态徽标胶囊（tintSoft 底 + play-circle-outline + tint 字「可看」）；行尾 chevron(labelTertiary)。
- 搜索条规范化：height 40、fill2 底、圆角 14、magnify 16 labelTertiary、有字时 close-circle 清除钮（activeOpacity 0.7）。
- 入场 60+25i；首屏 Skeleton 4 行卡；沉浸式播放页、下载、外部打开、横竖屏逻辑原样保留。

## 7. src/screens/BilibiliLiveScreen.tsx
- **before→after**：40 图标行 + 圆点 → 列表行卡（56 圆角 12 封面临时图标 + 14/700 标题 2 行 + 12 房间号 + 直播状态点/文字 + 下拉刷新）。
- 行首 icon 容器 40→56 圆角 12，直播中 tintSoft / 未开播 fill2 + television-classic。
- 标题 15→14/700（2 行省略）；副标题 12 labelSecondary（房间号）。
- 状态点：直播中 success + 文字「直播中」（Animated 呼吸动画，useNativeDriver:true）/ 未开播 labelTertiary 点 + 文字。
- 新增下拉刷新 RefreshControl（tint 色，触发 checkStatuses）。
- 空态图标→broadcast；入场 60+25i；沉浸播放端与横屏/旋转/线路切换逻辑原样保留。

## 8. src/screens/DatabaseScreen.tsx
- **before→after**：顶部总结卡 + 全屏 WebView → 顶部同步状态条（sync 图标 + 文字 + ActivityIndicator）+ WebView 圆角 16 容器卡（内嵌 Skeleton 占位 + 错误覆盖）。
- 顶部 summaryRow 改造成同步状态条：database-sync-outline 图标 + 「成员数据库」标题 + 同步中(ActivityIndicator) / 已同步(计数) / 失败(点按重试) 三种文案。
- WebView 放入圆角 16 + 溢出隐藏容器卡（surface + hairline）。
- WebView 加载中显示 Skeleton 占位（onLoadStart/onLoadEnd 驱动）；加载失败用 ErrorState 覆盖（含重试）。
- 同步逻辑 syncMembers / useMemberStore / 本地+API 合并保序逻辑原样保留。

---

## 验证
`npx tsc --noEmit`：本批 8 文件 **0 错误**（残留错误均在批外既有文件 AnalysisScreen / FollowedRoomsScreen / MeleeRankScreen）。
