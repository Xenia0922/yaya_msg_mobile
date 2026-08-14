// iOS 26 阴影体系：深色微弱，亮色清晰；玻璃卡片用低深宽阴影
import { Platform, ViewStyle } from 'react-native';

const shadowImpl = (level: 'xs' | 'sm' | 'md' | 'lg', isDark: boolean) => {
  const cfg = {
    xs: { offsetY: 1, blur: 2, alpha: isDark ? 0.30 : 0.06, radius: 1 },
    sm: { offsetY: 2, blur: 6, alpha: isDark ? 0.36 : 0.10, radius: 3 },
    md: { offsetY: 6, blur: 18, alpha: isDark ? 0.42 : 0.14, radius: 8 },
    lg: { offsetY: 12, blur: 36, alpha: isDark ? 0.50 : 0.18, radius: 16 },
  }[level];

  if (Platform.OS === 'ios') {
    return {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: cfg.offsetY },
      shadowOpacity: cfg.alpha,
      shadowRadius: cfg.blur,
    } as ViewStyle;
  }
  return {
    elevation: cfg.radius,
    shadowColor: '#000',
  } as ViewStyle;
};

export const makeShadows = (isDark: boolean) => ({
  xs: shadowImpl('xs', isDark),
  sm: shadowImpl('sm', isDark),
  md: shadowImpl('md', isDark),
  lg: shadowImpl('lg', isDark),
});
