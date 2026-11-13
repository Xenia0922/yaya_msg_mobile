/**
 * GlassBackground · 玻璃背景层（absoluteFill）
 *
 * 用法不变：父容器 `backgroundColor: 'transparent'` + 圆角，玻璃只做底，
 * 布局（flexDirection/padding）仍由外层 View 负责。
 *
 * 实现已收口到 GlassSurface（全站唯一玻璃出口）——旧的「保底白膜 + 手绘顶部高光 +
 * AGSL 位图采样」三件套已删除：那套在浅色底上会把玻璃压灰、并在卡片中部留一条硬边界白条。
 * 现在边缘受光/镜面高光由 react-native-liquid-glassmorphism 的材质自己出。
 */
import React from 'react';
import { GlassSurface } from './GlassSurface';

export interface GlassBackgroundProps {
  radius?: number;
  /** 强玻璃（大容器 / 需要更强可读性）→ card 预设；否则 chip 预设 */
  strong?: boolean;
  /** @deprecated 库作者配方里不调折射开关，保留仅为兼容旧调用点 */
  refract?: boolean;
}

export function GlassBackground({ radius = 20, strong = false }: GlassBackgroundProps) {
  return <GlassSurface role={strong ? 'card' : 'chip'} radius={radius} asBackground />;
}
