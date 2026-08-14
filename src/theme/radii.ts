// iOS 26 圆角：胶囊 + 大卡片圆角 + 内嵌小圆角
export const radii = {
  none: 0,
  xs: 6,
  sm: 10,
  md: 14,
  lg: 20,
  xl: 28,
  '2xl': 36,
  pill: 999, // capsule / fully rounded
} as const;

export type RadiusToken = keyof typeof radii;

/** 推荐组合：卡片大圆角、按钮/输入框中等圆角、chip/avatar 胶囊 */
export const radiiAlias = {
  card: radii.xl,        // 28 —— iOS 26 卡片大圆角
  cardCompact: radii.lg, // 20 —— 紧凑卡片
  button: radii.pill,    // 999 —— 胶囊主按钮
  buttonSquare: radii.md,// 14 —— 方按钮
  input: radii.md,       // 14
  chip: radii.pill,      // 999
  avatar: radii.pill,    // 圆形
} as const;
