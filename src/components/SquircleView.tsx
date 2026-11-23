import React from 'react';
import { Platform, StyleSheet, View, type ViewProps, type ViewStyle } from 'react-native';
import { NativeContinuousCornerView } from '../native/ContinuousCornerView';

export interface SquircleViewProps extends ViewProps {
  radius?: number;
  clipOutline?: boolean;
  children?: React.ReactNode;
}

export function SquircleView({ radius, clipOutline, style, children, ...rest }: SquircleViewProps) {
  const incoming = style ? (StyleSheet.flatten(style) as ViewStyle | undefined) : undefined;
  const r = radius ?? (typeof incoming?.borderRadius === 'number' ? incoming.borderRadius : 0);

  if (
    Platform.OS === 'android' &&
    (r > 0 || clipOutline !== undefined) &&
    NativeContinuousCornerView
  ) {
    const strokeWidth = typeof incoming?.borderWidth === 'number' ? incoming.borderWidth : 0;
    const strokeColor =
      typeof incoming?.borderColor === 'string' ? incoming.borderColor : 'transparent';

    const needsStrip =
      incoming !== undefined &&
      (incoming.borderWidth !== undefined ||
        incoming.borderColor !== undefined ||
        incoming.borderRadius !== undefined ||
        incoming.overflow !== undefined);

    const hostStyle = needsStrip
      ? (() => {
          const {
            borderWidth: _bw,
            borderColor: _bc,
            borderRadius: _br,
            overflow: _ov,
            ...restStyles
          } = incoming!;
          return restStyles;
        })()
      : style;

    return (
      <NativeContinuousCornerView
        cornerRadiusDp={r}
        strokeWidthDp={strokeWidth}
        strokeColor={strokeColor}
        clipOutline={Boolean(clipOutline) && r > 0}
        style={hostStyle}
        {...rest}
      >
        {children}
      </NativeContinuousCornerView>
    );
  }

  return (
    <View
      style={[
        r > 0 ? { borderRadius: r, borderCurve: 'continuous', overflow: 'hidden' } : null,
        style,
      ]}
      {...rest}
    >
      {children}
    </View>
  );
}

export default SquircleView;
