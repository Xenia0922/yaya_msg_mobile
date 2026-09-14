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
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { NavigationContext } from '@react-navigation/native';
import {
  LiquidGlassView,
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
const ROLE_PRESET: Record<GlassRole, GlassPresetName> = {
  card: 'cardOverMedia', // 照片/内容上的卡片：clear + 可读性薄纱
  chip: 'compactControl', // 小胶囊/徽标/悬浮控件：clear + 小数字
  bar: 'floatingTabBar', // 悬浮底栏（下面会被 NAV_BAR_READABILITY 覆盖成作者的可读性配方）
  header: 'navigationBar', // 页头：regular + 浅镜片
  selector: 'compactControl', // 底栏选中态
  toast: 'toast', // 可读性优先的短提示
  modal: 'frosted', // 重磨砂（设置页/模态背板）
  hero: 'crystal', // 装饰性主视觉：薄、硬、深折射
};

/**
 * 作者针对「栏上有图标 + 文字」给出的可读性配方
 * （tab bar 专页 Code snippet 5），逐字照抄：
 *   variant="clear" + legibilityFloor 0.4（只在子元素下方加自适应遮罩，避免整体变暗）
 *   + edgeReflectionStrength 0.4（压住镜像边的回声，别糊住文字）+ borderRadius 28
 */
const BAR_READABILITY = {
  variant: 'clear' as const,
  legibilityFloor: 0.4,
  edgeReflectionStrength: 0.4,
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
  /**
   * 强调染色。**仅在需要强调的按钮上给**（作者示例统一用 rgba(10,132,255,0.55)）。
   * 不给就不染 —— 染色会把浅色底洗成中性灰，是「整片发灰」的主因。
   */
  tintColor?: string;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}

export function GlassSurface({
  role = 'card',
  radius = 20,
  asBackground = false,
  interactive = false,
  tintColor,
  style,
  children,
}: GlassSurfaceProps) {
  const palette = usePalette();
  const isDark = palette.name === 'dark';
  const { tier } = useGlassSupport();
  const paused = useGlassPaused();

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

  return (
    <View pointerEvents={asBackground ? 'none' : 'auto'} style={boxStyle}>
      <LiquidGlassView
        preset={ROLE_PRESET[role]}
        // 底栏肩上有图标+文字 → 用作者的可读性配方覆盖预设
        {...(role === 'bar' ? BAR_READABILITY : null)}
        borderRadius={radius}
        interactive={interactive}
        pointerEvents={interactive && !asBackground ? 'auto' : 'none'}
        tintColor={tintColor}
        paused={paused}
        style={StyleSheet.absoluteFill}
      />
      {children}
    </View>
  );
}
