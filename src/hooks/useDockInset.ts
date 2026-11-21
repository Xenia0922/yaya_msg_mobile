import { useMiniPlayerStore } from '../store/miniPlayerStore';

const TAB_BAR_SPACE = 96;
const MINI_PLAYER_SPACE = 78;

export function useDockInset(base = 24, hasDock = true): number {
  const miniVisible = useMiniPlayerStore((s) => s.visible);
  return base + (hasDock ? TAB_BAR_SPACE : 0) + (miniVisible ? MINI_PLAYER_SPACE : 0);
}
