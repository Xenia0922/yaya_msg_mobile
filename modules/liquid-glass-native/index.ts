/**
 * 原生液态玻璃视图（RenderNode 硬件录制 + AGSL 边缘透镜/色散）。
 *
 * Android 33+ 满血（AGSL RuntimeShader）；31~32 退化为纯 RenderEffect 模糊；
 * 更低版本 / 解析失败 → 导出 null 视图，调用方自动回落 expo-blur。
 *
 * 注意：本工程未把 expo-modules-core 提升到根 node_modules（它嵌在 expo 下），
 * 所以这里从 `expo` 的再导出拿 requireNativeViewManager。
 */
import type * as React from 'react';
import { requireNativeView } from 'expo';
import { Platform } from 'react-native';

function resolveView(): React.ComponentType<any> | null {
  if (Platform.OS !== 'android') return null;
  const mgr = requireNativeView as unknown as (...args: any[]) => any;
  try {
    // 工厂式：requireNativeViewManager(moduleName)(viewName)
    const v = mgr('LiquidGlassNative')('LiquidGlassNativeView');
    if (v) return v as React.ComponentType<any>;
  } catch {
    /* 试单参式 */
  }
  // 注意：单参形式会把 view 名当成模块名 → 解析出不存在的 ViewManager。
  // 正确名是 ViewManagerAdapter_<Module>_<View>，只能走工厂式，失败就回落。
  return null;
}

const ResolvedView = resolveView();

export const LiquidGlassNativeView = (ResolvedView ?? (() => null)) as React.ComponentType<any>;
export const isLiquidGlassNativeAvailable = ResolvedView != null;
