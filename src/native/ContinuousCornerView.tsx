import { Platform, requireNativeComponent, type ViewProps } from 'react-native';

export interface ContinuousCornerNativeProps extends ViewProps {
  cornerRadiusDp?: number;
  strokeWidthDp?: number;
  strokeColor?: string;
}

export const NativeContinuousCornerView =
  Platform.OS === 'android'
    ? (() => {
        try {
          return requireNativeComponent<ContinuousCornerNativeProps>('ContinuousCornerView');
        } catch {
          return null;
        }
      })()
    : null;
