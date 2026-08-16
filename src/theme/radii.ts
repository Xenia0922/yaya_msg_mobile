// 官方口袋48风格圆角：卡片 16、按钮 18、chip 胶囊
export const radii = {
  none: 0,
  xs: 6,
  sm: 10,
  md: 14,
  lg: 20,
  xl: 28,
  '2xl': 36,
  pill: 999, // capsule / fully rounded
  /** 底部弹层（sheet）顶部圆角 */
  sheet: 22,
} as const;

export type RadiusToken = keyof typeof radii;

/** 推荐组合：卡片 16、按钮/输入框 14~18、chip/avatar 胶囊 */
export const radiiAlias = {
  card: radii.md,         // 16 —— 实心卡片
  cardCompact: radii.md,  // 14 —— 紧凑卡片
  button: 18,             // 18 —— 主按钮（方形按钮；全胶囊按钮直接用 radii.pill）
  buttonSquare: radii.md, // 14 —— 方按钮
  input: radii.md,        // 14
  chip: radii.pill,       // 999
  avatar: radii.pill,     // 圆形
} as const;
