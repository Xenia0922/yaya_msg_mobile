/**
 * v3.0 布局 token —— **唯一真源**
 *
 * 铁律（页面里出现裸数字即视为违规，Review 直接打回）：
 *  1. 横向只允许一条基准线：GUTTER。缩进只允许 GUTTER 与 GUTTER + 12 两级。
 *  2. 间距只用 SPACE 五档，且**组内用 xs/sm、组间用 lg**（组间必须 ≥ 组内的 2 倍）。
 *  3. 字号只用 TYPE 五档；正文 15，次要 13，标签 12。列表正文不用 700 以上。
 *  4. 圆角只用 R 四档；**网格间距必须 ≥ 圆角**，否则两块会长在一起。
 *  5. 一屏只允许一个主焦点（大数字/主按钮），其余降级为次要或元信息。
 *
 * 颜色不在这里定义：颜色来自主题（usePalette），因为要跟随明暗；但**用法**受 token 约束：
 *  - 主色只用于「选中态 / 关键数字 / 主按钮」，不做装饰描边；
 *  - 内容区一律实底（surface），玻璃只允许出现在底栏 / 底部弹层 / 悬浮小窗。
 */

/** 页面横向唯一基准线 */
export const GUTTER = 16;

/** 间距五档。组内 xs/sm；组间 lg；md 只用于同一行内的元素之间 */
export const SPACE = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 24,
  xl: 32,
} as const;

/** 字号五档（含行高与字重，避免各页自己拍） */
export const TYPE = {
  /** 标签 / 角标 / 元信息（12） */
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '500' as const },
  /** 次要文字（13） */
  secondary: { fontSize: 13, lineHeight: 18, fontWeight: '500' as const },
  /** 正文（15） */
  body: { fontSize: 15, lineHeight: 21, fontWeight: '500' as const },
  /** 区块标题（17） */
  title: { fontSize: 17, lineHeight: 24, fontWeight: '700' as const },
  /** 页面主数字 / 空态标题（22） */
  display: { fontSize: 22, lineHeight: 28, fontWeight: '800' as const },
} as const;

/** 圆角四档。网格卡用 sm(8)，卡片用 md(12)，弹层用 lg(16)，胶囊用 pill */
export const R = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
} as const;

/**
 * 固定层高度（**唯一来源**，页面里禁止再写 112/120 这种魔法数）。
 * 安全区：项目不接 safe-area-context（历史决定），Android 走 StatusBar.currentHeight，
 * iOS 走 54 的固定顶距 —— 与 ScreenHeader 保持一致，避免新老页面顶距不一致。
 */
export const LAYOUT = {
  /** 顶栏内容行高（不含状态栏） */
  appBar: 48,
  /** 工具条行高（筛选/分段/次要操作） */
  toolbar: 44,
  /** 底部悬浮 dock（实测 MuMu：可视高度 ≈ 96，加 16 呼吸 = 112，与旧版硬编码 112 吻合） */
  tabBar: 96,
  /** 应用内小窗（悬浮时覆盖在内容之上，不占文档流） */
  miniPlayer: 56,
  /** 列表底部额外呼吸 */
  bottomGap: 16,
  /** 列表行高基准 */
  row: 56,
} as const;

/** 内容区底部需要留出的高度（有/无小窗两档，别再写死） */
export function contentBottom(hasMiniPlayer: boolean): number {
  return LAYOUT.tabBar + (hasMiniPlayer ? LAYOUT.miniPlayer : 0) + LAYOUT.bottomGap;
}

/** 动效时长（统一三档，禁止页面自己拍数字） */
export const DURATION = {
  /** 状态切换（颜色/透明度） */
  fast: 140,
  /** 位移/展开 */
  base: 220,
  /** 页面级进场 */
  slow: 320,
} as const;
