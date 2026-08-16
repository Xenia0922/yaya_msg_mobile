# 布局重做批次 C（6 页）改动明细

> 基准：`scratch/layout-spec-v2.md`。仅重组布局结构，业务逻辑/API/路由/i18n 原文未动。
> 验证：`npx tsc --noEmit`（workdir=E:\yymsg\yaya_msg_mobile）本批 6 文件 0 错误。

## 1. AnalysisScreen（src/screens/AnalysisScreen.tsx）
before→after：原先顶部 4 列挤成一行的 summary 卡 + 独立分页 Pill 平铺 + 40px 方形图标行 ☞ 改为 2 列统计卡网格 + 分段控件（底灰胶囊中白片）+ 28 圆角图标统一列表行 + 图标图标徽标+迷你进度条的翻牌成员行。
- 概览区改 2 列统计卡（数值 20/800 tint + 标签 11 labelSecondary），翻牌/媒体头部同步套用。
- Tab 由平铺 Pill 改分段控件：`fill2` 底 radius 12 padding 3，选中项白胶囊（`palette.surface`），等宽 flex:1。
- 列表行统一：28 圆角图标底（tintSoft）+ 标题 14/600 + 副标题 12 + 右侧数值/进度。
- 成员翻牌排行改为「名次徽标(28 fill2) + 行内 mini 进度条(fill3 轨道 3px + tint 填充)」，替代原多行 meta 卡。
- 条形图区块规整：track fill2 / 填充 tint 圆角 3。
- 首屏加载加 Skeleton 占位（与真实卡片同构），保留 CenterSpinner 状态提示。
- 清理死样式：summary*/tabsRow/tabPill/typeCard/flipCardsCard/flipMemberCard/flipChipText 等；删除未用 `chunk`。

## 2. DownloadScreen（src/screens/DownloadScreen.tsx）
before→after：原 40px 方形类型图标占位卡 + 无缩略图 ☞ 缩略图 44 圆角 10 + 名称 14/600 + 类型胶囊 + 进度条 + 百分比 + 圆形操作按钮。
- 概览 3 列统计（value 20/800 + label 11 + 中分隔）保持不变并规整。
- 任务行卡片重组：图片用 `NetworkImage` 真实缩略图（localUri||url），其余回退类型图标；右侧改 tintSoft 圆形重试/打开 + danger 删除。
- 进度条：track fill3 高 4 圆角2，tint/danger 填充；meta 行增加右对齐百分比 11/800。
- 入场 delay 改 `index<12 ? 60+index*25 : 0`。

## 3. TripScreen（src/screens/TripScreen.tsx）
before→after：原内置白色圆点节点时间轴 + 粉实底「票务链接」按钮 ☞ 规整 tint 竖线时间轴 + tint 实心白边节点 + fill2 日期胶囊 + tint 字「查看行程」链接行。
- 时间轴：左竖线 2px tint，节点 16（tint 实心/tint 描边/fill3 过期）+ 内 10px 白点。
- 日期胶囊统一 fill2 底 11 号字（今天 tint 强调）。
- 标题 15/700、地点 12 labelSecondary 地图图标淡化。
- 票务链接改「查看行程」tint 字 + chevron 链接行（ScalePressable），替代实心粉按钮。
- 空态 EmptyState（icon calendar-heart）保留；Footer 加载更多保留。

## 4. MeleeRankScreen（src/screens/MeleeRankScreen.tsx）
before→after：原 tintSoft 40px 方形 medal/序号 + 34px 小头像 + 无进度 ☞ 名次徽标（前三名 tint 实底白字 16/900 / 其余 fill2 底 14/800）+ 44 圆头像 + 昵称 14/600 + 鸡腿数 13/800 tint + 迷你进度条。
- 周/总/年/成员 Pill 分段保留，新样式生效。
- 榜单行加 Mini 进度条（fill3 轨道 4px + tint 填充），按第一名占比（新增 `rankMax` useMemo 计算并传入 RankCard）。
- 头像 34→44 圆形，placeholder 换 account 图标。
- 首屏加载由 CenterSpinner 改 SkeletonRankList 骨架（与真实行同构）；PersonCard 同步徽标/头像风格。
- 两 FlatList 加 `RefreshControl`（tint 色）。

## 5. InvoiceScreen（src/screens/InvoiceScreen.tsx）
before→after：原 checkbox + 名称/金额/时间一行 + 彩色状态文字 ☞ 订单号 13/600 + 金额 15/800 + 状态徽标（可开票 success/已开票 fill2/其他）+ 「去开票」Pill。
- 订单行：可开票项显示「去开票/已选」Pill 单选；其余显示状态徽标 + 空心勾选占位。
- 开票表单：输入框改圆角 14 `fill2` 底（去描边）；类型分段 个人/企业 Pill 保留；提交 `Button` filled 全宽保留。
- 空态 EmptyState（icon receipt-outline）保留；清理未用 TouchableOpacity/MaterialCommunityIcons。
- 入场 delay 改 `index<12 ? 60+index*25 : 0`。

## 6. RechargeScreen（src/screens/RechargeScreen.tsx）
before→after：原表面卡余额 + 独立全宽「刷新」大按钮 ☞ GlassCard strong 余额卡 + 28/800 金额 + HeaderAction 刷新，WebView 装入圆角卡片。
- 余额卡改 `GlassCard strong`：标签 12 labelSecondary + 金额 28/800 + 右侧 HeaderAction 刷新（替代全宽按钮）。
- WebView 容器卡：圆角 16 溢出隐藏 + hairline 边框。
- 加载覆盖层用 `CenterSpinner`；错误覆盖层用 `ErrorState`（含「重试」），替代手写 view。
