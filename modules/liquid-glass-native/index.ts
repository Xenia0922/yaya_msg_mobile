/**
 * 原生液态玻璃视图（RenderNode 硬件录制 + AGSL 边缘透镜/色散）。
 * Android 33+ 满血；更低版本/解析失败 → 返回空视图，调用方回落 expo-blur。
 */
import type * as React from 'react';
import { Platform, requireNativeComponent } from 'react-native';

let resolved: React.ComponentType<any> | null = null;
if (Platform.OS === 'android') {
  try {
    resolved = requireNativeComponent<any>('LiquidGlassNativeView');
  } catch {
    resolved = null;
  }
}

export const LiquidGlassNativeView = (resolved ?? (() => null)) as React.ComponentType<any>;
export const isLiquidGlassNativeAvailable = resolved != null;
