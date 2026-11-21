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

export const insets = {
  screenHorizontal: 20,
  screenHorizontalCompact: 16,
  listInset: 20,
  cardPadding: 16,
  cardPaddingCompact: 12,
} as const;
