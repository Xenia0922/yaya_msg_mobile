/**
 * GlassSurface · 全站液态玻璃基元（唯一玻璃出口）
 *
 * ══ 引擎换成 expo-blur（Android = Dimezis BlurView + 硬件 RenderEffect）══
 * 弃用 react-native-liquid-glassmorphism 的原因：
 *   它的 Android 实现每帧对整个 root 做一次 `rootView.draw(canvas)` 软件重绘抓背景位图，
 *   N 块玻璃 = N 份全屏 ARGB 位图 + N 遍 AGSL，实例一多必然掉帧（实测"非常卡"），
 *   而且它只排除"玻璃视图自己"、把兄弟内容折射进来（正是"折射卡片自己的内容"根因）。
 *   expo-blur 走 SurfaceFlinger/RenderEffect 硬件模糊管线，没有每帧整屏软件抓图。
 *
 * ══ 材质（按 Apple Liquid Glass 的 Regular 变体）══
 *   浅色 = 白系磨砂（blur + 约 40% 白纱 + 顶部高光带 + 1px 描边）→ 深色文字可读
 *   深色 = 深系磨砂（blur + 约 46% 深纱）→ 官方"深色模式降低通透度、提升对比度"
 *   强调控件 = tintColor 染色
 *
 * ══ 使用铁律 ══
 *   内容作为 children 放进玻璃里（玻璃负责底、内容在上层清晰渲染）。
 *   可调参数只有 role/radius/intensity/tintColor，不要自创。
 */
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
import { LiquidGlassView, useGlassSupport } from 'react-native-liquid-glassmorphism';
import { LinearGradient } from 'expo-linear-gradient';
import { NavigationContext } from '@react-navigation/native';
import { usePalette } from '../theme';
import { GLASS_BACKDROP_ID, useBlurTarget } from './BlurTarget';
import { LiquidGlassNativeView, isLiquidGlassNativeAvailable } from '../../modules/liquid-glass-native';
import {
  LiquidGlassComposeView,
  isLiquidGlassComposeAvailable,
  GLASS_TUNING,
  type GlassTuning,
} from '../native/LiquidGlassCompose';

/** 语义角色 —— 决定用哪组材质 */
export type GlassRole =
  | 'card' // 内容卡
  | 'chip' // 胶囊 / 小控件
  | 'bar' // 悬浮底栏
  | 'header' // 页头 / 导航栏
  | 'selector' // 底栏选中态
  | 'toast' // 短提示
  | 'modal' // 弹层 / 面板
  | 'hero'; // 装饰性主视觉

interface Material {
  /** BlurView 强度（1–100） */
  intensity: number;
  /** 模糊半径压缩（Android 感知强度与 iOS 不同，用它对齐） */
  reduction: number;
  /** expo-blur 的 tint（决定模糊结果的底色走向） */
  blurTint: 'light' | 'dark';
  /** 叠在模糊之上的一层纱（底色） */
  overlay: string;
  /** 1px 描边 */
  stroke: string;
  /** 顶部高光带起始不透明度 */
  highlight: number;
}

/** Apple Regular 材质：浅色白系磨砂 / 深色深系磨砂 */
const MATERIAL: { light: Material; dark: Material } = {
  light: {
    // Apple Regular(浅色)：强模糊 + 淡白纱 —— 模糊负责可读，纱淡才透得出去
    intensity: 64,
    reduction: 4,
    blurTint: 'light',
    overlay: 'rgba(255,255,255,0.30)',
    stroke: 'rgba(255,255,255,0.66)',
    highlight: 0.24,
  },
  dark: {
    // 官方：深色模式降低通透度、提升对比度
    intensity: 70,
    reduction: 4,
    blurTint: 'dark',
    overlay: 'rgba(20,20,26,0.40)',
    stroke: 'rgba(255,255,255,0.10)',
    highlight: 0.10,
  },
};

/**
 * 玻璃引擎总开关。
 *   - 'auto'（默认）：能用 Compose 引擎就用它（真折射 + 色散 + 边缘光），不可用自动降级 expo-blur
 *   - 'blur'：全站退回 expo-blur（对照/排障用）
 * 单实例可用 `engine` prop 单独覆盖。
 */
export const GLASS_ENGINE: 'auto' | 'blur' = 'auto';

/** 按角色微调 Compose 引擎参数（不改就用 GLASS_TUNING 的默认档） */
export const GLASS_TUNING_OVERRIDE: Partial<Record<GlassRole, Partial<GlassTuning>>> = {};

/**
 * 选中态（压在底栏玻璃上那块）。
 * 静止时保持低调（浅灰而非亮白）—— 变化留给交互：拖动时由原生 AGSL 出边缘色散/透镜，
 * 加上 AppTabBar 的液化拉伸。静止就很白会显得「一块贴纸」而不是玻璃。
 */
const SELECTOR: { light: Material; dark: Material } = {
  light: { ...MATERIAL.light, overlay: 'rgba(232,232,238,0.55)', intensity: 44, stroke: 'rgba(255,255,255,0.45)', highlight: 0.10 },
  dark: { ...MATERIAL.dark, overlay: 'rgba(255,255,255,0.12)', intensity: 52 },
};

/**
 * 焦点感知：AGSL 分支在非活跃屏要 paused（旧库性能规则：Android 感知不到离屏玻璃）。
 * 用 NavigationContext 而不是 useIsFocused()：后者在没有导航容器时会抛错。
 */
function useGlassFocused(): boolean {
  const nav = React.useContext(NavigationContext);
  const [focused, setFocused] = React.useState(true);
  React.useEffect(() => {
    if (!nav) return;
    setFocused(nav.isFocused());
    const onFocus = nav.addListener('focus', () => setFocused(true));
    const onBlur = nav.addListener('blur', () => setFocused(false));
    return () => {
      onFocus();
      onBlur();
    };
  }, [nav]);
  return focused;
}

export interface GlassSurfaceProps extends Omit<ViewProps, 'role'> {
  /** 语义角色（选材质），默认 card */
  role?: GlassRole;
  /** 圆角（dp） */
  radius?: number;
  /** 纯背景层模式：铺满父容器、不吃触摸 */
  asBackground?: boolean;
  /** 触摸交互（预留给按压高光；当前仅作语义标记） */
  interactive?: boolean;
  /** 覆盖模糊强度 1–100 */
  intensity?: number;
  /** 强调染色（叠在模糊上的颜色） */
  tintColor?: string;
  /** 兼容旧签名（AGSL 时代的色散强度），新引擎忽略 */
  iridescence?: number;
  /** 可点：给了就在内部渲染 TouchableOpacity/Pressable（玻璃自己就是按压容器） */
  onPress?: () => void;
  onLongPress?: () => void;
  activeOpacity?: number;
  /** 兼容 ScalePressable 的按下缩放（仅作语义标记，避免类型报错） */
  pressedScale?: number;
  disabled?: boolean;
  /** 单实例引擎覆盖：'auto' 用 Compose 引擎（默认）/ 'blur' 退回 expo-blur（滚动内容穿过玻璃时用它） */
  engine?: 'auto' | 'blur';
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}

export function GlassSurface({
  role = 'card',
  radius = 20,
  asBackground = false,
  interactive: _interactive,
  intensity,
  tintColor,
  iridescence: _iridescence,
  onPress,
  onLongPress,
  activeOpacity,
  pressedScale: _pressedScale,
  disabled,
  engine: engineProp,
  style,
  children,
  ...rest
}: GlassSurfaceProps) {
  const palette = usePalette();
  const isDark = palette.name === 'dark';
  const { tier } = useGlassSupport();
  const focused = useGlassFocused();
  const blurTarget = useBlurTarget();
  const m =
    role === 'selector'
      ? isDark
        ? SELECTOR.dark
        : SELECTOR.light
      : isDark
          ? MATERIAL.dark
          : MATERIAL.light;

  // ── 双引擎 ──
  // dock 类（底栏 + 选中态）用 AGSL：真·边缘透镜折射 + 色散，苹果的核心观感就在这两处，
  // 且实例极少（≤2），旧库"每帧整屏抓一次背景"的成本可控（全实例共享同一张位图）。
  // 其余大面积元素（卡片/胶囊）走 expo-blur 的硬件模糊，避免 N 实例 × 整屏重绘。
  // ⚠️ 实测（MuMu API35）：AGSL dock = janky 10% / p50 25ms；expo-blur = janky 0% / p50 5ms。
  // 旧库每帧用「软件 Canvas」把整个 root 重绘进 Bitmap，成本 20ms/帧，给不了"真折射 + 满帧"。
  // 要真边缘折射必须自写原生视图：抓目标进 **RenderNode（硬件录制）** + AGSL 链式 RenderEffect
  // （blur → lens/dispersion），Dimezis BlurView 走的就是 RenderNode 路线，实测 0% janky。
  // 自写原生 AGSL 视图（RenderNode 硬件录制 + 链式 RenderEffect）—— 真边缘折射/色散，
  // 且不用软件 Canvas，成本可控。仅 dock 类角色（实例 ≤2）使用。
  const isDock = role === 'bar' || role === 'selector';
  // ⚠️ 原生视图当前关闭：录制整棵树时会与 expo-blur(Dimezis) 的 RenderNode 互相嵌套，
  // RenderThread 里 prepareTreeImpl 递归爆栈（实测 SIGSEGV）。修法：改成只录制
  // PageBackdrop 这一层（传 tag 指定目标，不含任何玻璃/RenderNode），待下轮接。
  // ⚠️ 暂时关闭：原生视图已能注册（isLiquidGlassNativeAvailable=true），但它的
  // RenderNode 录制在底栏区域会画出一条深色带（边缘采样/录制偏移问题，非参数问题），
  // 观感比 expo-blur 更差。等原生渲染修好再打开这个开关。
  // 注册链路本身是通的（见 modules/liquid-glass-native + settings.gradle 手动链接）。
  const useNativeDock = false && isLiquidGlassNativeAvailable && isDock;
  // 旧 AGSL 库（软件 Canvas 路线，实测 janky 10%）默认关闭，仅作对照
  const useAgsL = false && isDock && tier !== 'none';

  const r = radius;
  const boxStyle: StyleProp<ViewStyle> = asBackground
    ? [StyleSheet.absoluteFill, { borderRadius: r, overflow: 'hidden' }, style]
    : [{ borderRadius: r, overflow: 'hidden' }, style];

  if (useNativeDock) {
    return (
      <View pointerEvents={asBackground ? 'none' : 'auto'} style={boxStyle} {...rest}>
        <LiquidGlassNativeView
          targetId={GLASS_BACKDROP_ID}
          style={StyleSheet.absoluteFill}
          cornerRadius={r}
          blurRadius={role === 'selector' ? 18 : 22}
          lensWidth={0.32}
          lensStrength={role === 'selector' ? 16 : 12}
          // 色散 / 边缘反射光：苹果液态玻璃的签名特征，滑动时才明显
          dispersion={role === 'selector' ? 0.10 : 0.07}
          rimStrength={role === 'selector' ? 0.22 : 0.16}
          tintColor={tintColor ?? (isDark ? '#B314141A' : '#52FFFFFF')}
        />
        <View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            {
              borderRadius: r,
              borderWidth: 1,
              borderColor: isDark ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.60)',
              overflow: 'hidden',
            },
          ]}
        >
          <LinearGradient
            colors={
              isDark
                ? [`rgba(255,255,255,${m.highlight})`, 'transparent']
                : [`rgba(255,255,255,${m.highlight})`, 'rgba(255,255,255,0.04)', 'transparent']
            }
            style={{ height: '42%' }}
          />
        </View>
        {children}
      </View>
    );
  }

  if (useAgsL) {
    return (
      <LiquidGlassView
        variant={role === 'selector' ? 'clear' : 'regular'}
        intensity={role === 'selector' ? 45 : 50}
        borderRadius={r}
        tintColor={tintColor ?? (isDark ? 'rgba(20,20,26,0.30)' : 'rgba(255,255,255,0.34)')}
        iridescence={role === 'selector' ? 0.6 : 0.25}
        paused={!focused}
        style={[
          { borderRadius: r, overflow: 'hidden' },
          asBackground ? StyleSheet.absoluteFill : null,
          style,
        ]}
        {...rest}
      >
        <View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            {
              borderRadius: r,
              borderWidth: 1,
              borderColor: isDark ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.60)',
              overflow: 'hidden',
            },
          ]}
        >
          <LinearGradient
            colors={
              isDark
                ? [`rgba(255,255,255,${m.highlight})`, 'transparent']
                : [`rgba(255,255,255,${m.highlight})`, 'rgba(255,255,255,0.04)', 'transparent']
            }
            style={{ height: '42%' }}
          />
        </View>
        {children}
      </LiquidGlassView>
    );
  }

  /**
   * 引擎：shufajiaok/LiquidGlass（Compose）—— 真折射 + 色散 + 边缘光。
   *
   * 与 expo-blur 分支的关键差异：
   *   - 背板是**抓下来的位图**（原生侧从 GLASS_BACKDROP_ID 那一层抓，全局共享一张），
   *     所以静态背景下比"模糊身后"更接近 Apple 那块玻璃；滚动内容穿过玻璃时需要
   *     captureRefreshMs 低频重抓；
   *   - 材质/描边/顶部高光全部由引擎自己画，这里**不能再叠一层**，否则双重描边。
   */
  const composeRole: keyof typeof GLASS_TUNING =
    role === 'bar' || role === 'selector' || role === 'header' || role === 'card' || role === 'chip' ? role : 'card';
  const tuning: GlassTuning = { ...GLASS_TUNING[composeRole], ...(GLASS_TUNING_OVERRIDE[composeRole] ?? {}) };
  const useComposeGlass = isLiquidGlassComposeAvailable && (engineProp ?? GLASS_ENGINE) !== 'blur';

  if (useComposeGlass) {
    return (
      <View pointerEvents={asBackground ? 'none' : 'auto'} style={boxStyle} {...rest}>
        {/* 玻璃底层：不吃触摸，内容（children）叠在上面 */}
        <LiquidGlassComposeView
          pointerEvents="none"
          targetId={GLASS_BACKDROP_ID}
          style={StyleSheet.absoluteFill}
          cornerRadius={r}
          blurRadius={tuning.blurRadius}
          edgeWidth={tuning.edgeWidth}
          transparency={tuning.transparency}
          refractDp={tuning.refractDp}
          refractMode={tuning.refractMode}
          dispersion={tuning.dispersion}
          edgeGlow={tuning.edgeGlow}
          captureRefreshMs={tuning.captureRefreshMs}
          bitmapScale={tuning.bitmapScale ?? 2}
          backdropMode={tuning.backdropMode ?? 0}
          filmColor={tuning.filmColor}
        />
        {children}
      </View>
    );
  }

  const inner = (
    <>
      {/* 底层：硬件模糊（Android 31+ = RenderEffect / Dimezis BlurView） */}
      <BlurView
        // 不吃触摸：absoluteFill 的模糊层会挡住子元素里的按钮（tap 切换全失效的根因）
        pointerEvents="none"
        // blurTarget = 只包背景层的 BlurTargetView（内部无 BlurView → 不会 RenderNode 互相嵌套）
        blurTarget={blurTarget ?? undefined}
        intensity={intensity ?? m.intensity}
        tint={m.blurTint}
        blurMethod={Platform.OS === 'android' ? 'dimezisBlurViewSdk31Plus' : undefined}
        blurReductionFactor={m.reduction}
        style={[StyleSheet.absoluteFill, { borderRadius: r }]}
      />
      {/* 中层：底色纱 + 1px 描边；顶层：顶部连续高光带（Apple 三层结构） */}
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          {
            borderRadius: r,
            backgroundColor: tintColor ?? m.overlay,
            borderWidth: 1,
            borderColor: m.stroke,
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
          style={{ height: '42%' }}
        />
      </View>
      {children}
    </>
  );

  // 可点玻璃：内部渲染 TouableOpacity/Pressable，玻璃本身就是按压容器
  if ((onPress || onLongPress) && !asBackground) {
    if (activeOpacity != null) {
      return (
        <TouchableOpacity
          style={boxStyle}
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
      <Pressable style={boxStyle} onPress={onPress} onLongPress={onLongPress} disabled={disabled} {...(rest as any)}>
        {inner}
      </Pressable>
    );
  }

  return (
    <View pointerEvents={asBackground ? 'none' : 'auto'} style={boxStyle} {...rest}>
      {inner}
    </View>
  );
}
