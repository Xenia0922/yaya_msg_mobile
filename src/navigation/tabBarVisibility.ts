export function shouldHideTabBar(
  activeRoute: string | undefined,
  mainFocused: boolean,
  hiddenByRoute: { Media: boolean; Rooms: boolean },
): boolean {
  if (!mainFocused) return true;
  if (activeRoute === 'Media' || activeRoute === 'Rooms') return hiddenByRoute[activeRoute];
  return false;
}
