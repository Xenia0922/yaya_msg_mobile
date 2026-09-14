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
  | 'selector' // 底栏选中态（真玻璃 + 色散）
  | 'toast' // 短提示
  | 'modal' // 弹层 / 面板
  | 'hero'; // 装饰性主视觉

/** 角色 → 材质配置。
 *
 * ⚠️ 关键坑（实机 + 饱和底衬诊断确认）：
 * 库的 `regular` 是「自适应磨砂」——**会给浅色底衬叠一层中性 veil，视觉上就是"灰"**。
 * 之前为了让玻璃"看得见"把 card/chip 覆盖成 regular，结果整片发灰
 * （诊断：底衬纯绿 (0,179,75) 经玻璃后变 (57,153,100) → 玻璃采到了真实背景，灰是 regular 叠的）。
 * 所以一律用预设自带的 `clear`（真透明折射玻璃）。
 */
/**
 * 哪些角色上真 AGSL 玻璃 —— **只有底栏和底栏选中态**（用户最终定案）。
 *
 * 库的 Android 实现是每个实例每帧抓一次 backdrop + 跑一遍 AGSL（capture 最贵），
 * 首页十几个胶囊/卡片全上的话帧率会崩；而且内容层铺满 AGSL 还会因为 `regular` 的自适应
 * veil 整片发灰。所以内容层走「透明 + 发丝彩边」的轻量观感（见下方 lightweight 分支），
 * 真玻璃只留给数量固定的导航层。
 */
const AGSL_ROLES: ReadonlySet<GlassRole> = new Set<GlassRole>(['bar', 'selector']);

const ROLE_CONFIG: Record<
  GlassRole,
  {
    preset: GlassPresetName;
    intensity?: number;
    variant?: 'regular' | 'clear';
    /** 镜片厚度：同时决定折射与**边缘色散带的宽度**（越小边越细） */
    thickness?: number;
    iridescence?: number;
    tintColor?: string;
  }
> = {
  card: { preset: 'cardOverMedia' },
  chip: { preset: 'compactControl' },
  // 底栏：clear（透明折射），把「亮」让给选中态，否则全白一片选中态就看不见了
  bar: { preset: 'floatingTabBar', variant: 'clear', intensity: 45, thickness: 0.55, iridescence: 0.1 },
  header: { preset: 'navigationBar', variant: 'clear', intensity: 50, thickness: 0.55, iridescence: 0.1 },
  // 选中态：regular（自适应磨砂）+ 中性偏灰 —— 苹果里选中那块就是比底栏更实的一层
  selector: {
    preset: 'compactControl',
    variant: 'regular',
    thickness: 0.7,
    iridescence: 0.18,
    tintColor: 'rgba(140,140,150,0.55)',
  },
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
  /** 覆盖预设材质：regular=自适应磨砂（会偏灰），clear=透明折射玻璃 */
  variant?: 'regular' | 'clear';
  /** 镜片厚度：同时决定边缘色散带宽度（越小边越细） */
  thickness?: number;
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
  variant,
  thickness,
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

  const cfg = ROLE_CONFIG[role];
  const useRealGlass = canGlass && AGSL_ROLES.has(role);
  const isNav = role === 'bar' || role === 'header';

  /**
   * 轻量「透明玻璃」分支：内容层（card/chip/按钮…）与不支持玻璃的设备都走这里。
   *
   * 观感 = 几乎全透明 + 一条**发丝彩边**。彩边用「左右暖色 / 上下冷色」的对角双色模拟色散
   * （RN 的 border 四边可分别设色），成本为零，但读起来就是「玻璃边缘在折光」。
   */
  if (!useRealGlass) {
    const veil = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.10)';
    const warm = isDark ? 'rgba(255,150,190,0.34)' : 'rgba(255,150,190,0.42)';
    const cool = isDark ? 'rgba(140,205,255,0.34)' : 'rgba(140,205,255,0.42)';
    return (
      <View pointerEvents={asBackground ? 'none' : 'auto'} style={boxStyle}>
        <View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            {
              borderRadius: radius,
              backgroundColor: veil,
              borderWidth: StyleSheet.hairlineWidth * 2,
              borderTopColor: warm,
              borderLeftColor: warm,
              borderBottomColor: cool,
              borderRightColor: cool,
            },
          ]}
        />
        {children}
      </View>
    );
  }

  /** 真 AGSL 玻璃分支（仅导航层 + 底栏选中态）。 */
  return (
    <View pointerEvents={asBackground ? 'none' : 'auto'} style={boxStyle}>
      <LiquidGlassView
        preset={cfg.preset}
        variant={variant ?? cfg.variant}
        intensity={intensity ?? cfg.intensity}
        borderRadius={radius}
        interactive={interactive}
        pointerEvents={interactive && !asBackground ? 'auto' : 'none'}
        refraction={refraction}
        thickness={thickness ?? cfg.thickness}
        legibilityFloor={legibilityFloor ?? 0}
        // 几乎不染色：要的是「透明玻璃」，玻璃的颜色由背后的内容决定。
        // （染白会把浅色底洗成中性灰 —— 之前"整片发灰"的两个原因之一）
        tintColor={tintColor ?? cfg.tintColor ?? (isDark ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.08)')}
        // 四周那一点点色散/彩虹边（Android）：只给很淡的一点，边要细不要糊
        iridescence={iridescence ?? cfg.iridescence ?? 0.12}
        style={StyleSheet.absoluteFill}
      />
      {children}
    </View>
  );
}
