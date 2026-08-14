// iOS 26 调色板：双主题（light / dark）、品牌粉、玻璃专用 surface
// 命名遵循 Apple HIG 的语义色模式：bg / surface / label / separator / tint / glass.*

/** 品牌 accent：保留口袋粉 #ff6f91 同时新增 iOS 26 强调色变体 */
export const accent = {
  pink: '#ff6f91',
  pinkDark: '#ff8fa8',
  pinkSoft: 'rgba(255, 111, 145, 0.16)',
  pinkOnDark: '#ff8fa8',
} as const;

/** 官方口袋48风格：白底 + 粉点缀 + 实心卡片（2026-08-15 改版） */
const neutralLight = {
  background: '#F5F5F7',
  surface: '#FFFFFF',
  surfaceElevated: '#FFFFFF',
  surfaceMuted: '#F0F0F3',
  surfaceGlass: '#FFFFFF',
  surfaceGlassStrong: '#FFFFFF',
  hairline: 'rgba(0,0,0,0.06)',
  separator: 'rgba(60,60,67,0.14)',
  label: '#111114',
  labelSecondary: '#55555C',
  labelTertiary: '#9A9AA1',
  fill1: 'rgba(0,0,0,0.06)',
  fill2: 'rgba(0,0,0,0.05)',
  fill3: 'rgba(0,0,0,0.04)',
  innerStroke: 'rgba(0,0,0,0.06)',
};

const neutralDark = {
  background: '#0B0B0F',
  surface: '#1C1C1F',
  surfaceElevated: '#26262B',
  surfaceMuted: '#17171B',
  surfaceGlass: '#1C1C1F',
  surfaceGlassStrong: '#232327',
  hairline: 'rgba(255,255,255,0.10)',
  separator: 'rgba(84,84,88,0.40)',
  label: '#F5F5F7',
  labelSecondary: '#C9C9CE',
  labelTertiary: '#8E8E93',
  fill1: 'rgba(255,255,255,0.10)',
  fill2: 'rgba(255,255,255,0.08)',
  fill3: 'rgba(255,255,255,0.06)',
  innerStroke: 'rgba(255,255,255,0.09)',
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
} as const;

const dark = {
  ...neutralDark,
  ...accent,
  ...semantic,
  name: 'dark' as const,
  tint: accent.pinkOnDark,
  tintSoft: 'rgba(255,143,168,0.20)',
} as const;

export type Palette = typeof light | typeof dark;
export type PaletteName = 'light' | 'dark';

export const Palettes = { light, dark } as const;

/** 通过 useAppTheme / useResolvedTheme 选其一返回 */
import { useSettingsStore } from '../store';

export function usePalette(): Palette {
  const mode = useSettingsStore((s) => s.settings.theme);
  return mode === 'dark' ? dark : light;
}

/** 兼容旧 Colors 引用：返回扁平 token 对象（默认 light）—— 旧 screens 不爆炸 */
export const Colors = {
  ...light,
  // 兼容旧字段（其它模块残留引用）
  bgDark: dark.background,
  darkTextPrimary: dark.label,
  darkTextSecondary: dark.labelSecondary,
  darkTextTertiary: dark.labelTertiary,
  btnSecondaryBg: light.fill3,
  btnSecondaryBgDark: dark.fill3,
};

export const DarkColors = dark;
