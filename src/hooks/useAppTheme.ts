import { useColorScheme, type ColorSchemeName } from 'react-native';
import { useSettingsStore } from '../store';

export type ResolvedTheme = 'light' | 'dark';

// RN 0.83 起 ColorSchemeName 增加 'unspecified'，非 'dark' 一律按浅色处理
function resolveTheme(theme: 'light' | 'dark' | 'system', system: ColorSchemeName): ResolvedTheme {
  if (theme === 'system') return system === 'dark' ? 'dark' : 'light';
  return theme === 'dark' ? 'dark' : 'light';
}

/**
 * 解析后的深色判断（boolean）。'system' 跟随系统（useColorScheme 自动订阅系统切换）。
 * 全局统一用本 hook 代替 `settings.theme === 'dark'` 判断。
 */
export function useAppTheme(): boolean {
  const theme = useSettingsStore((s) => s.settings.theme);
  const system = useColorScheme();
  return resolveTheme(theme, system) === 'dark';
}

/** 解析后的实际主题字符串（'light' | 'dark'），导航主题等需要字符串处使用。 */
export function useResolvedTheme(): ResolvedTheme {
  const theme = useSettingsStore((s) => s.settings.theme);
  const system = useColorScheme();
  return resolveTheme(theme, system);
}
