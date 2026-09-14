/**
 * GlassSurface · 全局液态玻璃基元（全站唯一玻璃出口）
 *
 * 为什么收口到一个组件：
 *  - 一处调参：材质/预设/降级策略全在这里，避免每个页面各写一套参数导致观感不统一
 *  - 一处降级：低版本 Android / 鸿蒙 2·3（Android 8~10 基座）自动退回半透明白 + 发丝描边
 *
 * 引擎 = react-native-liquid-glassmorphism
 *  - iOS 26：系统原生 UIGlassEffect
 *  - Android 13+（API 33+）：AGSL 真折射（逐帧 backdrop 捕获 → 折射/色散/边缘反射）
 *  - Android 12（API 31~32）：降级为 RenderEffect 模糊 + tint（无折射）
 *  - API < 31 / 不支持：本组件自己给半透明白材质，保证「有形、不脏」
 *
 * ⚠️ 两个务必遵守的约束（来自库文档，违反会掉帧或变脏）：
 *  1. 不要玻璃叠玻璃：玻璃表面之间的层级要平铺，别把玻璃做进玻璃里面
 *  2. 列表里别堆大量实例：每个玻璃实例每帧都要抓 backdrop，长列表只给可见项上玻璃
 */
import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import {
  LiquidGlassView,
  useGlassSupport,
  type GlassPresetName,
} from 'react-native-liquid-glassmorphism';
import { usePalette } from '../theme';

/** 语义角色 —— 决定材质预设，保证全站同类元素观感一致 */
export type GlassRole =
  | 'card' // 内容卡
  | 'chip' // 胶囊 / 小控件
  | 'bar' // 悬浮底栏
  | 'header' // 页头 / 导航栏
  | 'toast' // 短提示
  | 'modal' // 弹层 / 面板
  | 'hero'; // 装饰性主视觉

/** 角色 → 材质配置。
 *
 * 实机对照过三版（MuMu / API 35 / 浅色底衬）：
 *  - A：`regular` 且无染色 → 一片中性灰（"脏"）
 *  - B：预设自带 `clear`   → 通透但偏薄，小胶囊上有明显放大鬼影
 *  - C（本版）：`regular` + 白纱染色 → 乳白磨砂，最接近苹果浅色材料 ✅
 * 所以内容层（card/chip）走 C；导航层（bar/header）保留预设自带的通透配方。
 */
const ROLE_CONFIG: Record<
  GlassRole,
  { preset: GlassPresetName; intensity?: number; variant?: 'regular' | 'clear' }
> = {
  card: { preset: 'cardOverMedia', variant: 'regular', intensity: 50 },
  chip: { preset: 'compactControl', variant: 'regular', intensity: 45 },
  bar: { preset: 'floatingTabBar' },
  header: { preset: 'navigationBar' },
  toast: { preset: 'toast' },
  modal: { preset: 'frosted' },
  hero: { preset: 'crystal' },
};

export interface GlassSurfaceProps {
  /** 语义角色（选材质），默认 card */
  role?: GlassRole;
  /** 圆角（dp） */
  radius?: number;
  /**
   * 纯背景层模式：铺满父容器、不吃触摸。
   * 用于「父容器负责布局、玻璃只做底」的场景（胶囊/卡片/分段控件）。
   */
  asBackground?: boolean;
  /** 触摸交互（按下的高光/放大）。父层已是 Pressable 时用 false，避免抢手势 */
  interactive?: boolean;
  /** 覆盖预设的模糊强度 0–100 */
  intensity?: number;
  /** 覆盖预设的折射开关（API 33+ 生效） */
  refraction?: boolean;
  /** 前景可读性薄纱 0–1：文字压在照片/视频上时调高 */
  legibilityFloor?: number;
  /** 边缘虹彩/色散强度 0–1（Android） */
  iridescence?: number;
  /** 染色（默认跟随主题给半透明白/黑） */
  tintColor?: string;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}

export function GlassSurface({
  role = 'card',
  radius = 20,
  asBackground = false,
  interactive = false,
  intensity,
  refraction,
  legibilityFloor,
  iridescence,
  tintColor,
  style,
  children,
}: GlassSurfaceProps) {
  const palette = usePalette();
  const isDark = palette.name === 'dark';
  const { tier } = useGlassSupport();
  const canGlass = tier !== 'none';

  const boxStyle: StyleProp<ViewStyle> = asBackground
    ? [StyleSheet.absoluteFill, { borderRadius: radius }, style]
    : [{ borderRadius: radius }, style];

  // 不支持玻璃的设备（含鸿蒙 2/3 的 Android 8~10 基座）：半透明白 + 发丝描边兜底。
  // 用高不透明度而不是低透明度 —— 低透明在浅色底上会「发灰发脏」。
  if (!canGlass) {
    const veil = isDark ? 'rgba(26,26,32,0.78)' : 'rgba(255,255,255,0.82)';
    return (
      <View pointerEvents={asBackground ? 'none' : 'auto'} style={boxStyle}>
        <View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            {
              borderRadius: radius,
              backgroundColor: veil,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: isDark ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.92)',
            },
          ]}
        />
        {children}
      </View>
    );
  }

  const cfg = ROLE_CONFIG[role];

  /**
   * 不垫任何白纱/色膜 —— 液态玻璃就是玻璃本身，加膜会把它糊成一块奶白塑料。
   * 色调只由材质参数（预设 / variant / intensity / tintColor）决定。
   *
   * ⚠️ 已知问题（未解）：MuMu(API35/x86_64) 上 AGSL 材质本身偏灰，且
   * tintColor / brightness / saturation 对最终色调几乎没有影响（0.55→0.75 只差 3 个色阶），
   * 换过底衬、换过图层顺序都不生效 → 高度怀疑是模拟器 GPU/驱动，**待真机确认**。
   */
  return (
    <View pointerEvents={asBackground ? 'none' : 'auto'} style={boxStyle}>
      <LiquidGlassView
        preset={cfg.preset}
        variant={cfg.variant}
        intensity={intensity ?? cfg.intensity}
        borderRadius={radius}
        interactive={interactive}
        pointerEvents={interactive && !asBackground ? 'auto' : 'none'}
        refraction={refraction}
        legibilityFloor={legibilityFloor}
        // 玻璃自身的染色：一层薄白给玻璃"体量"（太透会显薄、露底）；
        // 立体感与彩边仍由材质自己的 rim / 折射 / 色散出，不靠染色堆。
        tintColor={tintColor ?? (isDark ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.30)')}
        // 四周那一点点色散/彩虹边（Android：rim 上的虹彩微光，0–1）
        iridescence={iridescence ?? 0.2}
        style={StyleSheet.absoluteFill}
      />
      {children}
    </View>
  );
}
