# 布局重做 A 批改动明细（v2.6.5 · 5 页面）

> 目标：按 `scratch/layout-spec-v2.md` 重做 5 个页面的布局结构（信息层级 / 留白节奏 / 列表卡片 / 表单范式）。
> 业务逻辑 / API / 数据流 / 路由 / i18n 原文一律不动；颜色全走 `usePalette()`；图标 `MaterialCommunityIcons`；
> Animated 一律 `useNativeDriver: true`。验证：`npx tsc --noEmit` 对本批 5 文件 0 错误（`ALL_5_CLEAN`）。

---

## 1. src/screens/HomeScreen.tsx

**before → after**：松散顶部+手搓区块头+硬编码间距 → 「大标题问候区 + 4×18 tint 竖条统一区块头 + 直播 banner 轮播（crossfade/位移动画+指示点随动）+ 直播行卡 + 快捷胶囊 + 最近播放卡 + 工具横向 chips + 首屏 Skeleton」的规整分区结构。

关键改动列表：
- 新增 `SectionHeader` 组件：统一「4×18 tint 竖条 + headline 标题 + 可选『全部 ›』」，区块间距统一 `spacing.xl = 24`，区块外层统一 `sectionOuter`（水平留白 `spacing.md`）。
- 问候区改为 `typography.largeTitle` 大标题 + subhead 副标题，去掉旧手搓大标题。
- 直播 banner 轮播：用 `Animated` 包一层（`fadeAnim` crossfade + `slideAnim` 位移动画，全部 `useNativeDriver: true`，切换 150ms 退场 + 240ms 入场 + spring 复位）。
- 指示点随动：新增 `AnimatedDots` 组件，用 `Animated` 做宽度膨胀（6→16）+ 颜色过渡。
- 直播列表行卡：封面 52 / 圆角 12，标题 14/700 + 昵称 12 + chevron，surface 卡 + hairline 圆角 16，`FadeInView delay={index<12?60+index*25:0}` 入场（单一层，无双层嵌套）。
- 快捷入口：4 格胶囊（100% 等宽 flexBasis 24%），`scale` 按压反馈，逐格 `FadeInView` 入场。
- 最近播放卡：保留 GlassCard 续播卡，标题/副标题/「继续播放」Pill。
- 工具 chips：保留横向滚动，新增图标圆底（`toolChipIcon` 26 圆）+ 标题。
- 首屏加载：`!livesOk && !livesError` 时渲染直播区 Skeleton（banner + 行式 2 块），与真实内容同构。

---

## 2. src/screens/MessagesScreen.tsx

**before → after**：两个裸 `TouchableOpacity` 文本框 + 全屏 `Modal` picker → 「成员选择行卡 + 规范搜索条 + 气泡卡行 + 底部 sheet 选择器」。

关键改动列表：
- 顶部成员选择改为行卡：48 圆底图标（`account-star`）+ 主标题成员名 + 副标题 `共 {count} 位成员` + chevron-down，`ScalePressable` 按压。
- 搜索条按规范：高度 40、圆角 14、`palette.fill2` 底、左侧 `magnify` 16 + 有内容时 `close-circle` 清除按钮（`ScalePressable`）。
- 消息列表改「气泡卡行」：sender 名 13/700 tint + 时间 10 右对齐 + 正文 14，surface 卡 + hairline 圆角 16，整卡 `FadeInView` 入场。
- 成员选择 Modal 改**底部 sheet**：`Modal transparent animationType="slide"` + `radii.sheet=22` 顶部圆角 + 顶部 handle（40×5）+ 标题/计数头 + sheet 内规范搜索条 + 虚拟化 `PerfFlatList`（行带头像圆图标 + 名字 + team + chevron）+ 底部胶囊「关闭」按钮。
- 空/错态改用 `ScrollView` 垂直居中承载 `EmptyState`/`ErrorState`（业务回调原样）。

---

## 3. src/screens/SettingsScreen.tsx

**before → after**：平铺字段 + 零散 ChipRow → 全页 inset 分组卡片 + 行式条目（28 圆角图标底）+ 关于 hero 卡 + 成员数据 2 列卡 + 错峰入场。

关键改动列表：
- 新增 `Row` 行式条目组件：28 圆角图标底（tintSoft / danger 红底）+ 标题 15/600 + 右侧 chevron/状态文字（`value`），`ScalePressable`。
- 每个 `Section` 圆角 16 solid 卡片（`palette.surface` + hairline），区块标题独立置顶，区块入场 `FadeInView` 错峰（delay 60→300 递增）。
- 关于区改 hero 卡：logo 52 圆角 16 + 名称 + 副标题 + 版本 chip（`v{APP_VERSION}`）+ 红点（更新提示），下方「项目仓库 / 开源协议」行条目。
- 「账号 / 外观 / 语言 / 自动签到 / 工具」分组化为行式条目；背景图选择与恢复默认背景改为 `Row`。
- 成员数据统计改 **2 列卡**（`memberStatCard` 对称卡片：成员数 / 最近更新）+ 自动同步胶囊提示行。
- 主题 / 语言 / 签到仍用 `ChipRow`（fill2 底 + tint 激活态），`update()`/`saveSettings()`/`ImagePicker` 业务原样。

---

## 4. src/screens/LoginScreen.tsx

**before → after**：5 张独立 GlassCard 平铺（验证码 / Token / 账号 / B站 / 资料…）→ 「分段控件切换登录方式 + 表单卡 + 账号行卡 + B站白卡二维码」。

关键改动列表：
- 新增登录方式**分段控件**（本地 `mode` state：`sms` / `token` / `bilibili`）：`palette.fill2` 底圆角 12 + 选中白色胶囊（`segmentItemActive` 白底微阴影），等宽 flex:1，切换即时无闪烁。
- 短信验证码表单卡：输入框圆角 14 `fill2` 底 + 主按钮 `Button filled` 全宽（获取验证码 tinted + 登录 filled 纵向排）。
- Token 表单卡：多行 token 输入 + 检查/保存按钮全宽 + 已存 token 掩码提示。
- B站二维码卡：**白卡**（`qrCard` 描边，WebView 内嵌白底二维码居中）+ 过期时「点击刷新」tint 行式按钮。
- 账号列表改**行卡**：48 圆底头像（`account`/`account-check`）+ 昵称 15/700 + token 掩码 11 + 角色；「当前」tint 徽标 vs 其他账号 `Button filled sm` 切换按钮，逐行 `FadeInView` 入场。
- 「口袋资料 / 鸡腿充值」保留为表单卡；全部状态文案、`login*/switchBigSmall/B站扫码轮询`、`savePocketToken` 业务原样。

---

## 5. src/screens/FollowedRoomsScreen.tsx（改动量最大）

**before → after**：关注列表 2 列网格 → 单列房间行卡；聊天区保持 ChatBubble 范式并补齐「日期分隔胶囊 / 组内连排圆角 / 工具条强玻璃卡 / 贡献榜 sheet handle+进度条」。

关键改动列表：
- **房间列表 2 列网格 → 单列行卡**：封面 56 / 圆角 12（缺图时字母首字 tint）+ 房间名 15/700 + 在线状态点（有最近消息 `success` / 否则 `labelTertiary`）+「直播中」tint 小徽标 + 团队/最后消息/时间 + 右侧置顶/关注三组按钮。surface + hairline 圆角 16 卡，`ScalePressable` 主区进房。关注二次确认 `Alert` 逻辑原样保留。
- **聊天日期分隔**：`---分隔线---` 改为居中胶囊 `palette.fill2` 底（`chatDatePill`）。
- **气泡圆角范式**：他人气泡圆角 16 + 左上 6（`msgBubbleIdol`）；自己 `tint` 右白字 + 右上 6（`msgBubbleMine`）；同发送者组内连排统一圆角 6（`msgBubbleMid`）。sender 名 12/600 + 时间 10 层级保留。
- **聊天工具条**：原裸分段+图标行 → `palette.surfaceGlassStrong` 底圆角 18 卡 + 分段胶囊（大/小房间）+ 搜索/粉丝圆钮（tint 激活态，`ScalePressable`）。
- **贡献榜 sheet**：圆角 `radii.sheet=22` + 顶部 handle（40×5）+ 关闭圆钮；行 = 排名 + 头像 + 昵称 + **贡献进度条**（`valNum/max` 归一化，tint 填充）+ 鸡腿数右侧。
- 会话逻辑、房间打开、媒体解析/播放、翻牌/下载、`openRoomRankPanel` 等全部原样未动；仅新增 `ScalePressable` import。

---

## 验证

```
npx tsc --noEmit
```
对本批 5 文件命中结果：**ALL_5_CLEAN（0 错误）**。仓库其余文件仍有与本批无关的既有错误（AnalysisScreen / InvoiceScreen / MeleeRankScreen），不在本次范围。
