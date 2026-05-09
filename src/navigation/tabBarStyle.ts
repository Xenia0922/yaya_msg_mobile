import { ui } from '../theme/ui';

export function mainTabBarStyle(hasBackground: boolean, isDark = false) {
  const plainBg = isDark ? 'rgba(24,24,24,0.96)' : 'rgba(255,255,255,0.94)';
  const imageBg = isDark ? 'rgba(16,16,16,0.76)' : ui.colors.cardOnImage;
  const plainBorder = isDark ? 'rgba(255,255,255,0.16)' : ui.colors.border;
  const imageBorder = isDark ? 'rgba(255,255,255,0.18)' : ui.colors.borderOnImage;

  return {
    position: 'absolute' as const,
    left: ui.tabBar.horizontalInset,
    right: ui.tabBar.horizontalInset,
    bottom: ui.tabBar.bottom,
    height: ui.tabBar.height,
    paddingTop: 7,
    paddingBottom: 11,
    paddingHorizontal: 4,
    borderRadius: ui.tabBar.radius,
    overflow: 'hidden' as const,
    backgroundColor: hasBackground ? imageBg : plainBg,
    borderWidth: 1,
    borderTopWidth: 1,
    borderColor: hasBackground ? imageBorder : plainBorder,
    elevation: 0,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    alignSelf: 'stretch' as const,
  };
}
