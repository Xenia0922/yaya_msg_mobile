import { useColorScheme, type ColorSchemeName } from 'react-native';
import { useSettingsStore } from '../store';

export type ResolvedTheme = 'light' | 'dark';

function resolveTheme(theme: 'light' | 'dark' | 'system', system: ColorSchemeName): ResolvedTheme {
  if (theme === 'system') return system === 'dark' ? 'dark' : 'light';
  return theme === 'dark' ? 'dark' : 'light';
}

export function useAppTheme(): boolean {
  const theme = useSettingsStore((s) => s.settings.theme);
  const system = useColorScheme();
  return resolveTheme(theme, system) === 'dark';
}

export function useResolvedTheme(): ResolvedTheme {
  const theme = useSettingsStore((s) => s.settings.theme);
  const system = useColorScheme();
  return resolveTheme(theme, system);
}
