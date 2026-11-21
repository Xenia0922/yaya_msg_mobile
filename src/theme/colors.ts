export const accent = {
  pink: '#ff6f91',
  pinkDark: '#ff8fa8',
  pinkSoft: 'rgba(255, 111, 145, 0.16)',
  pinkOnDark: '#ff8fa8',
} as const;

const neutralLight = {
  background: '#ECEDF1',
  surface: '#F4F5F9',
  surfaceElevated: '#F4F5F9',
  surfaceMuted: '#ECEDF1',
  surfaceGlass: 'rgba(255,255,255,0.60)',
  surfaceGlassStrong: 'rgba(255,255,255,0.72)',
  hairline: 'rgba(0,0,0,0.06)',
  separator: 'rgba(60,60,67,0.14)',
  label: '#111114',
  labelSecondary: '#55555C',
  labelTertiary: '#9A9AA1',
  fill1: 'rgba(0,0,0,0.06)',
  fill2: 'rgba(0,0,0,0.05)',
  fill3: 'rgba(0,0,0,0.04)',
  innerStroke: 'rgba(255,255,255,0.68)',
};

const neutralDark = {
  background: '#0B0B0F',
  surface: '#1C1C1F',
  surfaceElevated: '#26262B',
  surfaceMuted: '#17171B',
  surfaceGlass: 'rgba(28,28,36,0.66)',
  surfaceGlassStrong: 'rgba(28,28,36,0.76)',
  hairline: 'rgba(255,255,255,0.10)',
  separator: 'rgba(84,84,88,0.40)',
  label: '#F5F5F7',
  labelSecondary: '#C9C9CE',
  labelTertiary: '#8E8E93',
  fill1: 'rgba(255,255,255,0.10)',
  fill2: 'rgba(255,255,255,0.08)',
  fill3: 'rgba(255,255,255,0.06)',
  innerStroke: 'rgba(255,255,255,0.12)',
};

export const semantic = {
  success: '#34C759',
  warning: '#FF9F0A',
  danger: '#FF3B30',
  info: '#5AC8FA',
} as const;

const light = {
  ...neutralLight,
  ...accent,
  ...semantic,
  name: 'light' as const,
  tint: accent.pink,
  tintSoft: accent.pinkSoft,

  onTint: '#FFFFFF',
} as const;

const dark = {
  ...neutralDark,
  ...accent,
  ...semantic,
  name: 'dark' as const,
  tint: accent.pinkOnDark,
  tintSoft: 'rgba(255,143,168,0.20)',
  onTint: '#FFFFFF',
} as const;

export type Palette = typeof light | typeof dark;
export type PaletteName = 'light' | 'dark';

export const Palettes = { light, dark } as const;

import { useResolvedTheme } from '../hooks/useAppTheme';

export function usePalette(): Palette {
  return useResolvedTheme() === 'dark' ? dark : light;
}

export function getPageBackground(): string {
  return 'transparent';
}
