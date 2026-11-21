import React from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  TouchableOpacity,
  View,
  type StyleProp,
  type ViewProps,
  type ViewStyle,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { usePalette } from '../theme';
import { useBlurTarget } from './BlurTarget';
import { NativeContinuousCornerView } from '../native/ContinuousCornerView';

export type GlassRole =
  'card' | 'chip' | 'bar' | 'header' | 'selector' | 'toast' | 'modal' | 'hero';

interface Material {
  intensity: number;

  reduction: number;

  blurTint: 'light' | 'dark';

  overlay: string;

  frostedOverlay: string;

  stroke: string;

  highlight: number;
}

const HIGHLIGHT_GRADIENT_STYLE = { height: '42%' } as const;

const BLUR_REDUCTION = Platform.OS === 'android' ? 6 : 4;

const MATERIAL: { light: Material; dark: Material } = {
  light: {
    intensity: 64,
    reduction: BLUR_REDUCTION,
    blurTint: 'light',
    overlay: 'rgba(255,255,255,0.30)',
    frostedOverlay: 'rgba(255,255,255,0.72)',
    stroke: 'rgba(255,255,255,0.68)',
    highlight: 0.24,
  },
  dark: {
    intensity: 70,
    reduction: BLUR_REDUCTION,
    blurTint: 'dark',
    overlay: 'rgba(20,20,26,0.40)',
    frostedOverlay: 'rgba(28,28,36,0.76)',
    stroke: 'rgba(255,255,255,0.12)',
    highlight: 0.1,
  },
};

const SELECTOR: { light: Material; dark: Material } = {
  light: {
    ...MATERIAL.light,
    overlay: 'rgba(232,232,238,0.55)',
    frostedOverlay: 'rgba(232,232,238,0.78)',
    intensity: 44,
    stroke: 'rgba(255,255,255,0.45)',
    highlight: 0.1,
  },
  dark: {
    ...MATERIAL.dark,
    overlay: 'rgba(255,255,255,0.12)',
    frostedOverlay: 'rgba(42,42,50,0.72)',
    intensity: 52,
  },
};

export interface GlassSurfaceProps extends Omit<ViewProps, 'role'> {
  role?: GlassRole;

  radius?: number;

  asBackground?: boolean;

  frostedOnly?: boolean;

  interactive?: boolean;

  intensity?: number;

  tintColor?: string;

  iridescence?: number;

  onPress?: () => void;
  onLongPress?: () => void;
  activeOpacity?: number;

  pressedScale?: number;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}

export function GlassSurface({
  role = 'card',
  radius = 22,
  asBackground = false,
  frostedOnly = false,
  interactive: _interactive,
  intensity,
  tintColor,
  iridescence: _iridescence,
  onPress,
  onLongPress,
  activeOpacity,
  pressedScale: _pressedScale,
  disabled,
  style,
  children,
  ...rest
}: GlassSurfaceProps) {
  const palette = usePalette();
  const isDark = palette.name === 'dark';
  const blurTarget = useBlurTarget();
  const m =
    role === 'selector'
      ? isDark
        ? SELECTOR.dark
        : SELECTOR.light
      : isDark
        ? MATERIAL.dark
        : MATERIAL.light;

  const r = radius;

  const incoming = style ? (StyleSheet.flatten(style) as ViewStyle | undefined) : undefined;
  const strokeWidth = incoming?.borderWidth ?? 1;
  const strokeColor = (incoming?.borderColor as string) ?? m.stroke;
  const useNativeContinuous =
    Platform.OS === 'android' && r > 0 && NativeContinuousCornerView !== null;

  const hasExplicitBorder =
    incoming !== undefined &&
    (incoming.borderWidth !== undefined || incoming.borderColor !== undefined);
  const hasCircularClip =
    useNativeContinuous &&
    incoming !== undefined &&
    (incoming.borderRadius !== undefined || incoming.overflow !== undefined);
  const outerStyle: StyleProp<ViewStyle> =
    hasExplicitBorder || hasCircularClip
      ? (() => {
          const {
            borderWidth: _bw,
            borderColor: _bc,
            borderRadius: _br,
            overflow: _ov,
            ...restStyles
          } = incoming!;
          if (useNativeContinuous) return restStyles as StyleProp<ViewStyle>;
          return {
            ...restStyles,
            ...(incoming!.borderRadius !== undefined
              ? { borderRadius: incoming!.borderRadius }
              : null),
            ...(incoming!.overflow !== undefined ? { overflow: incoming!.overflow } : null),
          } as StyleProp<ViewStyle>;
        })()
      : style;
  const outerBoxStyle: StyleProp<ViewStyle> = useNativeContinuous
    ? asBackground
      ? [StyleSheet.absoluteFill, outerStyle]
      : outerStyle
    : asBackground
      ? [
          StyleSheet.absoluteFill,
          { borderRadius: r, borderCurve: 'continuous', overflow: 'hidden' },
          outerStyle,
        ]
      : [{ borderRadius: r, borderCurve: 'continuous', overflow: 'hidden' }, outerStyle];

  const fillColor = tintColor ?? (frostedOnly ? m.frostedOverlay : m.overlay);
  const backdropLayers = (
    <>
      {!frostedOnly ? (
        <BlurView
          pointerEvents="none"

          blurTarget={blurTarget ?? undefined}
          intensity={intensity ?? m.intensity}
          tint={m.blurTint}
          blurMethod={Platform.OS === 'android' ? 'dimezisBlurViewSdk31Plus' : undefined}
          blurReductionFactor={m.reduction}
          style={
            useNativeContinuous
              ? StyleSheet.absoluteFill
              : [StyleSheet.absoluteFill, { borderRadius: r, borderCurve: 'continuous' }]
          }
        />
      ) : null}

      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          useNativeContinuous
            ? { backgroundColor: fillColor }
            : {
                borderRadius: r,
                borderCurve: 'continuous',
                backgroundColor: fillColor,
                borderWidth: strokeWidth,
                borderColor: strokeColor,
                overflow: 'hidden',
              },
        ]}
      >
        <LinearGradient
          colors={
            isDark
              ? [`rgba(255,255,255,${m.highlight})`, 'rgba(255,255,255,0.02)', 'transparent']
              : [`rgba(255,255,255,${m.highlight})`, 'rgba(255,255,255,0.06)', 'transparent']
          }
          style={HIGHLIGHT_GRADIENT_STYLE}
        />
      </View>
    </>
  );

  const inner = useNativeContinuous ? (
    (onPress || onLongPress) && !asBackground && NativeContinuousCornerView ? (
      <>
        <NativeContinuousCornerView
          pointerEvents="none"
          cornerRadiusDp={r}
          strokeWidthDp={strokeWidth}
          strokeColor={strokeColor}
          style={StyleSheet.absoluteFill}
        >
          {backdropLayers}
        </NativeContinuousCornerView>
        {children}
      </>
    ) : (
      <>
        {backdropLayers}
        {children}
      </>
    )
  ) : (
    <>
      {backdropLayers}
      {children}
    </>
  );

  if ((onPress || onLongPress) && !asBackground) {
    if (activeOpacity != null) {
      return (
        <TouchableOpacity
          style={outerBoxStyle}
          onPress={onPress}
          onLongPress={onLongPress}
          activeOpacity={activeOpacity}
          disabled={disabled}
          {...(rest as any)}
        >
          {inner}
        </TouchableOpacity>
      );
    }
    return (
      <Pressable
        style={outerBoxStyle}
        onPress={onPress}
        onLongPress={onLongPress}
        disabled={disabled}
        {...(rest as any)}
      >
        {inner}
      </Pressable>
    );
  }

  if (useNativeContinuous && NativeContinuousCornerView) {
    return (
      <NativeContinuousCornerView
        pointerEvents={asBackground ? 'none' : 'auto'}
        cornerRadiusDp={r}
        strokeWidthDp={strokeWidth}
        strokeColor={strokeColor}
        style={outerBoxStyle}
        {...(rest as any)}
      >
        {inner}
      </NativeContinuousCornerView>
    );
  }

  return (
    <View pointerEvents={asBackground ? 'none' : 'auto'} style={outerBoxStyle} {...rest}>
      {inner}
    </View>
  );
}
