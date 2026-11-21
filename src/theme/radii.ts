export const radii = {
  none: 0,
  xs: 6,
  sm: 10,
  md: 14,
  lg: 22,
  xl: 28,
  '2xl': 36,
  pill: 999,

  sheet: 22,
} as const;

export type RadiusToken = keyof typeof radii;

export const radiiAlias = {
  card: radii.lg,
  cardCompact: radii.md,
  button: 18,
  buttonSquare: radii.md,
  input: radii.md,
  chip: radii.pill,
  avatar: radii.pill,
} as const;

export const continuousCorner = { borderCurve: 'continuous' as const };
