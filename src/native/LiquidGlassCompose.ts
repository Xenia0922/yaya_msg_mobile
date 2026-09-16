/**
 * Compose 版液态玻璃（shufajiaok/LiquidGlass 引擎）的 RN 桥。
 *
 * 原生实现：modules/liquid-glass-native/android/.../LiquidGlassComposeView.kt
 *   - 用 Compose 引擎把背板按 ContentScale.Crop 的同一套换算重画 + BlurEffect，
 *     只对贴边一条带做折射/色散（真折射 + 彩边 + 边缘光）
 *   - 背板来源：把 RN 的背景层（nativeID = targetId，即 GLASS_BACKDROP_ID）抓成 Bitmap
 *   - `captureRefreshMs > 0` 时按间隔重抓（列表从玻璃下滚过才需要）
 *
 * 参数区间（上游 GlassDefaults，真机拖出来的）：
 *   通透度 0.05–0.70 · 折射 0–12dp · 边缘光带宽 0.6–10dp · 边缘亮度 0.4–2.5 · 色散 0–1
 * 经验：**模糊半径不要接近控件高度**，否则玻璃里只剩一团均匀色块；小控件要把
 * blurRadius / edgeWidth 一起收窄。
 */

import React from 'react';
import { Platform, requireNativeComponent, type ViewProps } from 'react-native';

export type LiquidGlassRefractMode = 'scale' | 'field';

export interface LiquidGlassComposeProps extends ViewProps {
  /** 圆角（dp） */
  cornerRadius?: number;
  /** 模糊半径（dp） */
  blurRadius?: number;
  /** 边缘光带宽（dp）；-1/不传 = 用引擎全局值 */
  edgeWidth?: number;
  /** 通透度 0..1（越大越透） */
  transparency?: number;
  /** 折射位移量（dp，轮廓处） */
  refractDp?: number;
  /** 'scale'（整体放大，最省）/ 'field'（边缘折射，中心不动） */
  refractMode?: LiquidGlassRefractMode;
  /** 色散强度 0..1（贴边 RGB 错位 = 彩边） */
  dispersion?: number;
  /** 边缘光亮度倍率，1 = 自动 */
  edgeGlow?: number;
  /** 背景层 nativeID（抓它当背板） */
  targetId?: string;
  /** 背板来源：0=按 targetId 那一层（默认）/ 1=整个内容视图（透出玻璃背后的内容） */
  backdropMode?: number;
  /** 膜层颜色（#AARRGGBB）：覆盖引擎默认的 MaterialTheme.surface 膜色，越透越像玻璃 */
  filmColor?: string;
  /** 抓图缩放：2 = 半分辨率（默认） */
  bitmapScale?: number;
  /** 重抓间隔（ms）：0 = 只抓一次（静态背景） */
  captureRefreshMs?: number;
}

const NativeView = Platform.OS === 'android'
  ? requireNativeComponent<LiquidGlassComposeProps>('LiquidGlassComposeView')
  : null;

/**
 * 原生视图（非 Android 时是空组件，仅为满足 JSX 类型；调用方必须用
 * [isLiquidGlassComposeAvailable] 判断再渲染）。
 */
export const LiquidGlassComposeView = (NativeView ?? (() => null)) as React.ComponentType<LiquidGlassComposeProps>;

/** 原生模块是否可用（未打包/非 Android 时为 false → 调用方走 expo-blur 降级） */
export const isLiquidGlassComposeAvailable = !!NativeView;

/** 各角色的推荐参数（对着上游「玻璃实验台」的区间取值） */
export interface GlassTuning {
  blurRadius: number;
  edgeWidth: number;
  transparency: number;
  refractDp: number;
  refractMode: LiquidGlassRefractMode;
  dispersion: number;
  edgeGlow: number;
  captureRefreshMs: number;
  /** 0=抓背景层（省）/ 1=抓整个内容视图（玻璃里透出背后的内容） */
  backdropMode?: number;
  /** 膜色（#AARRGGBB）；不给就用引擎默认（偏白、显得实） */
  filmColor?: string;
  /** 抓图分辨率：2=半分辨率；越大越省 */
  bitmapScale?: number;
}

export const GLASS_TUNING: Record<'bar' | 'selector' | 'header' | 'card' | 'chip', GlassTuning> = {
  /**
   * 底栏：面积大、实例少（1 块）。**必须抓整窗内容**（backdropMode=1）——
   * 只抓页面背景层的话，玻璃里透出的是一层平色，看起来就是一块白板。
   * 低频重抓（150ms）+ 半分辨率以上，兼顾"内容从底下滚过"和开销。
   */
  bar: {
    blurRadius: 9, edgeWidth: 2.2, transparency: 0.72, refractDp: 6, refractMode: 'scale',
    dispersion: 0.45, edgeGlow: 1.15, captureRefreshMs: 150,
    backdropMode: 1, filmColor: '#08FFFFFF', bitmapScale: 2,
  },
  // 选中胶囊（≈40dp 高）：半径/边缘光都收窄，否则糊成一圈亮框
  selector: {
    blurRadius: 6, edgeWidth: 1.4, transparency: 0.72, refractDp: 4, refractMode: 'scale',
    dispersion: 0.4, edgeGlow: 1.1, captureRefreshMs: 150,
    backdropMode: 1, filmColor: '#0CFFFFFF', bitmapScale: 2,
  },
  header: {
    blurRadius: 11, edgeWidth: 2.2, transparency: 0.7, refractDp: 6, refractMode: 'scale',
    dispersion: 0.42, edgeGlow: 1.1, captureRefreshMs: 0, backdropMode: 1, filmColor: '#0AFFFFFF', bitmapScale: 2,
  },
  card: {
    blurRadius: 11, edgeWidth: 2, transparency: 0.68, refractDp: 5, refractMode: 'scale',
    dispersion: 0.38, edgeGlow: 1.1, captureRefreshMs: 0, backdropMode: 0, filmColor: '#0CFFFFFF', bitmapScale: 2,
  },
  chip: {
    blurRadius: 6, edgeWidth: 1.3, transparency: 0.7, refractDp: 4, refractMode: 'scale',
    dispersion: 0.34, edgeGlow: 1.1, captureRefreshMs: 0, backdropMode: 0, filmColor: '#0EFFFFFF', bitmapScale: 2,
  },
};
