import { useMiniPlayerStore } from '../store/miniPlayerStore';

/**
 * 底部「悬浮层」占位计算。
 *
 * 背景：App 底部是**悬浮 Dock**（绝对定位，不占布局高度）+ 可选**迷你播放条**；
 * 列表若不预留，最后一行会被压住（用户截图：直播网格底部两卡、音乐库第二排封面）。
 *
 * 说明：Dock 只在「Main 的 Tab 页」显示，Stack 页（如音乐库）没有 Dock → 传 hasDock=false。
 */
const TAB_BAR_SPACE = 96;
const MINI_PLAYER_SPACE = 78;

export function useDockInset(base = 24, hasDock = true): number {
  const miniVisible = useMiniPlayerStore((s) => s.visible);
  return base + (hasDock ? TAB_BAR_SPACE : 0) + (miniVisible ? MINI_PLAYER_SPACE : 0);
}
