import { useWindowDimensions } from 'react-native';

export const DUAL_PANE_MIN_W = 720;

export function useDualPane(): { dual: boolean; width: number; height: number } {
  const { width, height } = useWindowDimensions();

  const dual = width >= DUAL_PANE_MIN_W && width > height;
  return { dual, width, height };
}
