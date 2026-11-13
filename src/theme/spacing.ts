// iOS 26 间距梯度（4pt baseline）—— 容器、卡片、控件、文本配对间距
export const spacing = {
  '2xs': 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 20,
  xl: 24,
  '2xl': 32,
  '3xl': 40,
  '4xl': 56,
} as const;

export type SpacingToken = keyof typeof spacing;

/** iOS standard edge insets（屏幕左右安全留白 20，列表 inset 行 16） */
export const insets = {
  screenHorizontal: 20,
  screenHorizontalCompact: 16,
  listInset: 20,
  cardPadding: 16,
  cardPaddingCompact: 12,
} as const;

/** 全局 SafeArea 顶部/底部留白由 navigation 提供，这里只提供水平间距 */
