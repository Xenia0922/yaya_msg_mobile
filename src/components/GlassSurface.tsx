/**
 * GlassSurface · 全局液态玻璃基元（全站唯一玻璃出口）
 *
 * 引擎 = react-native-liquid-glassmorphism（iOS26 UIGlassEffect / Android13+ AGSL 真折射）
 *
 * ⚠️ 参数原则：**照抄库作者自己的配方，不自创调参**。
 * 作者 example app 的 recipes（6 个 copy-paste 片段）里，可调参数**只有**：
 *   variant / borderRadius / tintColor(仅强调按钮) / interactive / shape
 * 完全没有碰 intensity / thickness / iridescence / legibilityFloor / brightness / saturation ——
 * 之前那套自创参数表就是在跟库的调音打架，越调越灰。
 *
 * 作者的两条材质规则（recipes 里反复出现）：
 *  - 压在照片/视频上 → `variant="clear"`（媒体控件条、底部 dock、FAB）
 *  - 需要文字可读的内容层 → `variant="regular"`（导航栏、照片上的卡片）
 * 预设（GlassPresets）本身就是 6 组「作者调好的材质」，所以这里只给「角色 → 预设 + 圆角」，
 * 其余全交给库。
 */
import React from 'react';
import {
  StyleSheet,
  View,
  type StyleProp,
  type ViewProps,
  type ViewStyle,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { NavigationContext } from '@react-navigation/native';
import {
  LiquidGlassView,
  getGlassCapabilities,
  useGlassSupport,
  type GlassPresetName,
} from 'react-native-liquid-glassmorphism';
import { usePalette } from '../theme';

/** 语义角色 —— 决定用哪组作者预设 */
export type GlassRole =
  | 'card' // 内容卡
  | 'chip' // 胶囊 / 小控件
  | 'bar' // 悬浮底栏（压在内容上 → clear）
  | 'header' // 页头 / 导航栏（文字可读优先 → regular）
  | 'selector' // 底栏选中态
  | 'toast' // 短提示
  | 'modal' // 弹层 / 面板
  | 'hero'; // 装饰性主视觉

/**
 * 角色 → 作者预设。
 * 预设已含 variant/intensity/thickness/edgeReflection/legibilityFloor/borderRadius 的调音，
 * 我们只覆盖圆角（轮廓是我们自己的）。
 */
const ROLE_PRESET: Record<GlassRole, GlassPresetName | undefined> = {
  card: undefined, // 照片上的卡片：作者 recipe 用 variant="regular"，不用预设
  chip: undefined, // 玻璃按钮：作者 recipe 用默认（regular），强调时给 tintColor
  bar: undefined, // 底栏：与卡片同材质。floatingTabBar 预设自带 legibilityFloor 0.2 +
  // edgeReflectionStrength 1（镜像回声），压在浅色底上会把整条底栏压成深灰，
  // 和内容卡的浅白玻璃不一致（实拍对比确认）
  header: 'navigationBar', // 页头：浅镜片
  selector: undefined, // 底栏选中态：dock 上的控件 → clear（媒体控件 recipe）
  toast: 'toast', // 可读性优先的短提示
  modal: 'frosted', // 重磨砂（设置页/模态背板）
  hero: 'crystal', // 装饰性主视觉：薄、硬、深折射
};

/** 角色 → variant（作者 recipes 的原始用法；与预设冲突时以 recipe 为准） */
const ROLE_VARIANT: Partial<Record<GlassRole, 'regular' | 'clear'>> = {
  card: 'regular', // 照片上的卡片 recipe
  chip: 'regular', // 玻璃按钮 recipe（默认 regular）
  bar: 'regular', // 与内容卡同材质，浅色主题下整条底栏才是浅玻璃
  selector: 'clear', // 媒体控件/dock 上的控件 recipe
};

/**
 * 角色 → 模糊强度。iOS 26 实拍参考的玻璃是「轻模糊、高透」——
 * 背后内容清晰可辨只是被柔化，而不是糊成一团。预设里 45~70 的强度在
 * 浅色底上就是"超级磨砂"，这里统一压到 26~40。
 */
const ROLE_INTENSITY: Record<GlassRole, number> = {
  card: 32,
  chip: 32,
  bar: 32,
  header: 36,
  selector: 28,
  toast: 40,
  modal: 50,
  hero: 26,
};

/**
 * 焦点感知的暂停：作者性能规则 ——「导航栈里还活着但非活跃的屏幕，Android 感知不到，
 * 必须手动 paused」，否则那些离屏玻璃仍在每帧抓 backdrop。
 * 用 NavigationContext 而不是 useIsFocused()：后者在没有导航容器时会抛错，
 * 而玻璃可能被用在弹层/全局挂载组件里。
 */
function useGlassPaused(): boolean {
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
  return nav ? !focused : false;
}

// 诊断：报告设备能力与实际渲染 tier（一次性）。
// AGSL 在部分模拟器上会编译失败 → 库静默降级到 blur/tint（视觉=一张灰膜），不看日志根本发现不了。
let __glassDiagLogged = false;
function logGlassDiag() {
  if (__glassDiagLogged) return;
  __glassDiagLogged = true;
  try {
    const cap = getGlassCapabilities();
    console.log('[GlassDiag] capabilities:', JSON.stringify(cap));
  } catch (e) {
    console.log('[GlassDiag] capabilities failed:', String(e));
  }
}

export interface GlassSurfaceProps extends Omit<ViewProps, 'role'> {
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
  /**
   * 强调染色。**仅在需要强调的按钮上给**（作者示例统一用 rgba(10,132,255,0.55)）。
   * 不给就不染 —— 染色会把浅色底洗成中性灰，是「整片发灰」的主因。
   */
  tintColor?: string;
  /** 边缘虹彩/色散强度 0–1（Android，对应 Kyant0 的 chromaticAberration） */
  iridescence?: number;
  /** 覆盖角色模糊强度（官方：轻模糊高透，26–40） */
  intensity?: number;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}

export function GlassSurface({
  role = 'card',
  radius = 20,
  asBackground = false,
  interactive = false,
  intensity,
  tintColor,
  iridescence,
  style,
  children,
  ...rest
}: GlassSurfaceProps) {
  const palette = usePalette();
  const isDark = palette.name === 'dark';
  const { tier } = useGlassSupport();
  const paused = useGlassPaused();
  React.useEffect(() => {
    logGlassDiag();
  }, []);

  const boxStyle: StyleProp<ViewStyle> = asBackground
    ? [StyleSheet.absoluteFill, { borderRadius: radius }, style]
    : [{ borderRadius: radius }, style];

  /**
   * 不支持玻璃的设备（`tier === 'none'`，含鸿蒙 2/3 的 Android 8~10 基座）：
   * 给半透明白 + 发丝边的兜底材质，保证「有形」。
   */
  if (tier === 'none') {
    return (
      <View pointerEvents={asBackground ? 'none' : 'auto'} style={boxStyle}>
        <View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            {
              borderRadius: radius,
              backgroundColor: isDark ? 'rgba(26,26,32,0.70)' : 'rgba(255,255,255,0.60)',
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: isDark ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.85)',
            },
          ]}
        />
        {children}
      </View>
    );
  }

  /**
   * 作者文档的标准用法（ Minimal example / 全部 recipes 一致）：
   *   <LiquidGlassView variant=... borderRadius=... style={{...}}>
   *     {children}     ← 内容作为 children 放进玻璃里，"renders crisply on top of the glass"
   *   </LiquidGlassView>
   * 且所有片段都在 style 上加了 `overflow: 'hidden'`。
   * 之前自创的「玻璃 absoluteFill 铺底 + 内容当兄弟节点」会让玻璃盖在内容上 —— 本末倒置。
   */
  return (
    <LiquidGlassView
      preset={ROLE_PRESET[role]}
      variant={ROLE_VARIANT[role]}
      intensity={intensity ?? ROLE_INTENSITY[role]}
      borderRadius={radius}
      interactive={interactive}
      // Kyant0 LiquidBottomTabs 的底栏表面色（onDrawSurface 画的那层）：
      // 浅色 #FAFAFA@40% / 深色 #121212@40% —— 这层浅纱才是"浅色玻璃"的正确实现。
      // 仅在调用方没有明确给 tint 时按主题取默认。
      tintColor={tintColor ?? (isDark ? 'rgba(18,18,18,0.28)' : 'rgba(250,250,250,0.20)')}
      iridescence={iridescence}
      paused={paused}
      onPipelineReady={(e) => {
        const info = (e as any)?.nativeEvent ?? {};
        console.log('[GlassDiag] pipeline:', JSON.stringify(info));
      }}
      style={[
        { borderRadius: radius, overflow: 'hidden' },
        asBackground ? StyleSheet.absoluteFill : null,
        style,
      ]}
      {...rest}
    >
      {/* 官方三层结构的顶层：顶部连续高光带 + 极细半透明描边。
          放在玻璃材质之上、内容之下；pointerEvents none 不吃触摸。 */}
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          {
            borderRadius: radius,
            borderWidth: 1,
            borderColor: isDark ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.45)',
            overflow: 'hidden',
          },
        ]}
      >
        <LinearGradient
          colors={[
            isDark ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.50)',
            isDark ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.08)',
            'transparent',
          ]}
          style={{ height: '46%' }}
        />
      </View>
      {children}
    </LiquidGlassView>
  );
}
