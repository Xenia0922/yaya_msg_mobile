// iOS 26 阴影体系：深色微弱，亮色清晰；玻璃卡片用低深宽阴影
import { Platform, ViewStyle } from 'react-native';

const shadowImpl = (level: 'xs' | 'sm' | 'md' | 'lg', isDark: boolean) => {
  const cfg = {
    xs: { offsetY: 1, blur: 2, alpha: isDark ? 0.24 : 0.05, radius: 1 },
    sm: { offsetY: 2, blur: 5, alpha: isDark ? 0.28 : 0.06, radius: 2 },
    md: { offsetY: 5, blur: 14, alpha: isDark ? 0.34 : 0.09, radius: 5 },
    lg: { offsetY: 10, blur: 28, alpha: isDark ? 0.42 : 0.12, radius: 10 },
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
