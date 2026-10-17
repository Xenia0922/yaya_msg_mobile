# v3.0 布局重写

> 代码目录叫 `src/v3`（`3.0` 不能作为合法 import 路径），文档里就是 **3.0**。

## 为什么要重写

不是"不好看"，是**布局结构**有四个可量化的问题（26 个屏幕统计）：

| 问题 | 数据 | 后果 |
|---|---|---|
| 左边缘不齐 | `paddingHorizontal` **10 种值**（12×55 / 14×24 / 8×21 / 16×20 / 10×11 / 6 / 18 / 20 / 24 / 26） | 眼睛沿列表下滑时基准线一直跳 |
| 每块都包卡 | 26 屏里 **12 屏**有 ≥3 个并列 `GlassSurface` | 一屏碎成 4~6 个"浮岛" |
| 顶部控件吃掉 1/4 屏 | 相册页 5 层 → 第一张图在 **23%** 处 | 只能"看一点滚一点" |
| 底栏避让写死 | `paddingBottom` **112×6 / 120×5** + 40/32/24/16 | 有的页面被底栏压一截 |

对照 Desktop48：`.page { padding: var(--page-pad) }` 一个变量、`border-bottom` 分节、
`repeat(auto-fill, minmax(320px,1fr))` 自适应网格、`position:fixed` 只有 5 处。

## 五条铁律（Review 直接打回）

1. **横向只有一条基准线**：`GUTTER = 16`。缩进只允许 `GUTTER` 与 `GUTTER + 12`。
2. **分组用间距，不用卡片**：组内 `sm(8)`、组间 `lg(24)`；不够再上 `Divider`，最后才考虑卡片。
3. **一屏只有一个主焦点**：大数字 / 主按钮。其余降级为次要或元信息。
4. **网格间距 ≥ 圆角**：`gap` 用 `GRID_GAP(12)`，圆角 `R.sm(8)` —— 否则卡片会长在一起。
5. **玻璃只允许 3 处**：底栏 / 底部弹层 / 悬浮小窗。内容区、列表行、chip 一律实底。

## 三把尺子（自测）

1. **眯眼测试**：看不清字时，还能看出"一块主内容 + 一个主按钮"吗？
2. **左线测试**：沿左边缘下滑，线跳几次？
3. **删除测试**：删掉这个元素布局会塌吗？不会塌就是没用的。

## 结构

```
src/v3/
  tokens.ts              布局唯一真源：GUTTER / SPACE / TYPE / R / LAYOUT / DURATION
  layout/Screen.tsx      页面骨架（AppBar + 可选 Toolbar + 唯一滚动容器约定）
  layout/primitives.tsx  SectionHeader / Divider / ListRow / EmptyHint / 网格常量
  components/Segmented.tsx  分段控件（实底，无 BlurView，指示器只做 transform）
  pages/*V3.tsx          逐页重写
  spec/inventory.md      26 屏逐页分析与方案（本目录的"分析底稿"）
```

## 可以复用 / 禁止复用

| 复用 ✅ | 禁止 ❌ |
|---|---|
| `api/` `store/` `services/` `i18n/` `theme` 的**颜色与状态** | `components/GlassSurface`、`ScreenHeader`、`GlassSegmented`、`MemberPicker` 等**布局组件** |
| `utils/`（解析、格式化、meleeParse） | 任何形如 `paddingHorizontal: 12/14/18/20` 的旧间距 |
| `components/NetworkImage`（图片加载兜底，非布局） | 旧的 `styles.container/paddingBottom:112` 魔法数 |
| `components/PerfFlatList`（列表性能封装） | 旧页面的 JSX 结构（允许参考逻辑分支，不允许照抄排版） |

## 迁移状态（26/26 屏已落地）

| 页面 | 实现 | 说明 |
|---|---|---|
| 首页 | `HomeV3` | 直播横滑大卡 + 快捷 4 项 + 工具横滚单行 |
| 鸡腿榜 | `MeleeRankV3` | 5 层压 2 层；周次降级为次级下拉 |
| 相册 | `RoomAlbumV3` | 网格 gap12≥圆角8；卡片无文字 |
| 设置 | `SettingsV3` | 系统设置式，全程无卡片 |
| 照片 / 动态 / 档案 | `MemberPagesV3` | 共用 MemberSheet |
| 充值 / 数据库 | `MemberPagesV3` | WebView |
| 消息检索 / 翻牌 / 公演 / 统计 / 抓取 / 上麦 / 电台 / 音乐库 | `ListPagesV3` | DataListPage + 真接口 |
| 视频库 / 音频节目 / B站 / 下载 | `ListPagesV3` | **列表骨架已落，取数入口集中在 LocalListPage 待接** |
| 媒体 | `MediaLoginV3` | 直播/回放列表；**播放委托旧播放器**（避免重写流解析） |
| 账号 | `LoginV3` | Token 校验 / 短信登录 / 保存后 resetNimSession |
| 私信 | `PrivateRoomsInvoiceV3` | 会话列表 + 详情 + 发送回复 |
| 房间消息 | `PrivateRoomsInvoiceV3` | **只读**；发言仍走旧版（云信发送链路未迁移） |
| 发票 | `PrivateRoomsInvoiceV3` | 订单列表 |

### 待补（不影响布局验收）
1. 视频库 / 音频节目 / B站 / 下载：`LocalListPage` 的取数（旧版为本地文件或组件内状态）
2. 房间消息：发言链路（云信会话 + serverId + 414 处理）
3. 数据库：真实 URL 待确认
