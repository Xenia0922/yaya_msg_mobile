/**
 * 房间页双栏判定（C5-S1）。
 *
 * 宽屏（平板/横屏，宽 ≥ 720dp）时房间页可「左聊天 / 右直播」双栏；
 * 本阶段（S1）只提供判定与常量，**不接入布局**（保证单栏路径零回归）。
 */
import { useWindowDimensions } from 'react-native';

/** 双栏最小宽度（dp）。720 覆盖常见平板竖屏与手机横屏。 */
export const DUAL_PANE_MIN_W = 720;

export function useDualPane(): { dual: boolean; width: number; height: number } {
  const { width, height } = useWindowDimensions();
  // 仅横屏或平板宽屏启用；竖屏手机始终单栏
  const dual = width >= DUAL_PANE_MIN_W && width > height;
  return { dual, width, height };
}
