# 设计系统

本项目的界面以「内容优先、材质克制」为原则：列表和卡片保持实色，不叠玻璃；玻璃材质只用于底栏、选择器等少量固定层级，保证滚动性能和可读性。

## 圆角

统一从 `src/theme/radii.ts` 取值，不要在页面里另写魔法数字。

| Token | 值 | 用途 |
| --- | ---: | --- |
| `radii.lg` / `radiiAlias.card` | 22 | 普通卡片、设置分组 |
| `radii.md` / `cardCompact` / `input` | 14 | 紧凑卡片、输入框、小方块 |
| `radiiAlias.button` | 18 | 主按钮 |
| `radii.xl` | 28 | 大容器 |
| `radii.pill` | 999 | 胶囊、头像、标签 |

底部弹层顶部圆角使用 `radii.sheet`（22）。

## 字体

字体跟随系统：iOS 使用系统字体（中文为苹方），Android 使用系统默认字体。字号与行高统一走 `src/theme/typography.ts`。

| Token | 字号 / 行高 / 字重 | 用途 |
| --- | --- | --- |
| `pageTitle` | 24 / 30 / 800 | 页面大标题 |
| `sectionTitle` | 17 / 22 / 800 | 区块标题 |
| `title2` | 22 / 28 / 700 | 弹层标题 |
| `headline` | 17 / 22 / 600 | 强调正文、行标题 |
| `body` | 17 / 22 / 400 | 正文 |
| `subhead` | 15 / 20 / 400 | 次要正文 |
| `footnote` | 13 / 18 / 400 | 说明文字 |
| `caption1` | 12 / 16 / 400 | 辅助信息 |

## 材质

`GlassSurface` 只接受 `role`、`radius`、`intensity`、`tintColor` 四个可调参数，材质参数由组件内部按角色统一维护。

- `role="background"`：页面背景层，`asBackground` 铺满父容器且不接收触摸。
- `role="card"`：内容卡；列表和网格中不要逐卡使用玻璃，改用实色卡片。
- `role="chip"`：胶囊、小控件。
- `role="bar"` / `role="selector"`：底栏、分段选择器，整个页面最多各一个。
- Android 使用 `BlurView` 时必须提供 `blurTarget`；不要把模糊层放在参与 transform 动画的元素上。

## 间距

页面左右边距 16，卡片内边距 14–16，区块之间 12–16；同一页面内保持同一档间距，不逐块微调。

## 图标

使用 `@expo/vector-icons` 的 Ionicons，默认 20–22；区块标题左侧使用 20 大小的 tintSoft 图标块。图标只承担识别作用，不代替文字标题。
