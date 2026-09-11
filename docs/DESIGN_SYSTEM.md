# 牙牙消息 · 统一设计规范（Design System v1）

> 目标：全站 27 个页面布局统一、视觉语言一致。风格 = **官方口袋48风格**（白底 + 粉点缀 + 实心卡片）。
> 本规范是页面重构的**唯一依据**；与规范冲突的写法（isDark 硬编码、半透明卡、emoji 图标）一律清理。

---

## 1. 设计 Token（已有，禁止改）

| Token | 亮色值 | 暗色值 | 用途 |
|:--|:--|:--|:--|
| `palette.background` | `#F5F5F7` | `#0B0B0F` | 页面底 |
| `palette.surface` / `surfaceGlass` | `#FFFFFF` | `#1C1C1F` | 卡片/输入框/分组（**实心**） |
| `palette.surfaceGlassStrong` | `#FFFFFF` | `#232327` | 高强调表面 |
| `palette.tint` | `#ff6f91` | `#ff8fa8` | 主色（按钮/激活/链接） |
| `palette.tintSoft` | `rgba(255,111,145,0.10)` | `rgba(255,143,168,0.20)` | 主色浅底（图标容器） |
| `palette.label` / `labelSecondary` / `labelTertiary` | `#111114` / `#55555C` / `#9A9AA1` | — | 文字三级 |
| `palette.fill2` / `fill3` | 5% / 4% 黑 | 8% / 6% 白 | 次级表面、chip 底 |
| `palette.hairline` / `innerStroke` | 6% 黑 | 9% 白 | 卡片边框 |
| 圆角 | 卡片 16 · 小组件 14 · 按钮 18 · 胶囊 999 | | |

## 2. 布局范式（按页面类型套用）

### 2.1 列表页（私信/视频库/电台/行程/数据库/发票/微博/动态/下载历史）
```
┌──────────────────────────────────┐
│ ScreenHeader（已有，新样式）        │
├──────────────────────────────────┤
│ 筛选 chips（需要时，Pill 组件）     │
├──────────────────────────────────┤
│ ┌ 实心白卡（圆角16, margin 16/4）┐ │
│ │ [40dp圆角方底icon/44圆头像]     │ │
│ │ 标题 15/700      [尾部操作]     │ │
│ │ 副标题 12 secondary            │ │
│ └──────────────────────────────┘ │
└──────────────────────────────────┘
```
- 行内元素垂直居中；leading 图标容器：`38-40dp 圆角方底`（`tintSoft` 底 + `tint` 图标 20）
- 尾部操作：chevron-right（labelTertiary）或 Pill 按钮
- 列表用卡片间距（marginVertical 4-5）分隔，**不用分割线**

### 2.2 网格页（相册/照片/下载任务/视频）
- 2 列等分（FlatList numColumns=2 默认等分），item `flex:1 + margin:4`
- 封面方形或 4:3，圆角 14，`overflow:hidden` 白卡底
- 信息两行：标题 13/700 + 副标题 11 secondary

### 2.3 统计/榜单页（翻牌统计/鸡腿榜）
- 顶部「概览数字条」：1 张白卡内 2-4 个均分数字（数字 18/900 + 标签 11 secondary）
- 下方列表卡（同 2.1 行范式）
- 页签用 Pill 组件（`selected` 态 = tint 底白字）

### 2.4 表单/工具页（充值/发票/登录/翻牌发送）
- 分组实心卡：`palette.surface` 圆角 16，组标题 15/800 在卡外
- 输入框：白底 + hairline 边框 圆角 14，focus 边框 tint
- 主按钮：tint 实底白字 圆角 18；次按钮：fill2 底 label 字

### 2.5 聊天页（房间消息/私信会话）
- 他人气泡：`#FFFFFF` 白底 hairline 边框，圆角 16（左上 6）
- 成员发言：粉 `#ff6f91` 底白字；自己发言：蓝 `#7BC6FF` 底白字
- 头像 36 圆形，首字兜底（tintSoft 底 tint 字）

## 3. 硬性规则

1. **色彩**：一律 `usePalette()` 取 token；禁止新写 `isDark && styles.xDark`、禁止半透明白 `rgba(255,255,255,0.x)` 做卡片底
2. **图标**：一律 `MaterialCommunityIcons`；禁止 emoji 做功能图标（仅装饰性表情可用）
3. **卡片**：实心 `palette.surface` + hairline 边框 + 圆角 16（小卡 14）
4. **文本**：标题 15/700、副标题 12、辅助 11；颜色三级 label/labelSecondary/labelTertiary
5. **间距**：页面水平 16、卡内 padding 12-14、卡片间距 4-5、分组间距 20
6. **按钮**：主 = tint 底白字 18 圆角；次 = fill2 底
7. **保留**：ScreenHeader（新样式）、导航结构、业务逻辑、i18n key —— 一律不动
8. **禁止**：新增 npm 依赖、改 android/ 原生、改 store/api、动播放器覆盖层（半透明保留）

## 4. 参考实现（照抄模式）

- 列表行范式 → `src/screens/FollowedRoomsScreen.tsx` 的房间列表 renderItem
- 网格范式 → `src/screens/MusicLibraryScreen.tsx` 的 songItem
- 大封面内容卡 → `src/screens/MediaScreen.tsx` 的 v2Card
- 仪表盘 → `src/screens/HomeScreen.tsx`
- 分组表单 → `src/screens/SettingsScreen.tsx` / `LoginScreen.tsx`
