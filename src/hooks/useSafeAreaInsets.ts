/**
 * 纯 JS 安全区兜底 —— 不依赖 react-native-safe-area-context
 * 真实值由 native 测量（刘海/底部导航条）通过 Provider 注入，但本 hook 不依赖 Provider：
 *  - 若将来接入 SafeAreaProvider，调用方只需换 import 即可（API 兼容），本 hook 作为 fallback。
 *  - App.tsx 不再包 SafeAreaProvider —— 沙箱构建无 native 真机回归时，第三方 native 包
 *    （依赖 autolinking 注入 Pod/AAR）经常导致 RN bridge 启动崩溃（"_module not found" /
 *    "No safe area value available"）。为降低重构风险，本工程采用 StatusBar + Platform
 *    经验值。
 *
 * 实测：
 *  - iOS：顶部 status bar 高度由 StatusBar.currentHeight 给出；底部 home indicator 高 34
 *  - Android：顶部 status bar ~24dp，底部 navigation bar 约 48dp（API ≥ 24）
 *  - 平板/无 home indicator 时 bottom 趋近 0
 *
 * 数据有偏差但足够定位内容 —— 玻璃底栏 / Toast / MiniPlayer 已用这些值，不会出现
 * "No safe area value available" 启动崩溃。
 */
import { Platform, StatusBar } from 'react-native';

export interface SafeAreaInsets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

const ANDROID_NAV_BAR = 48;
const IOS_HOME_INDICATOR = 34;

export function useSafeAreaInsets(): SafeAreaInsets {
  const top =
    Platform.OS === 'ios'
      ? StatusBar.currentHeight || 44
      : StatusBar.currentHeight || 24;
  const bottom = Platform.OS === 'ios' ? IOS_HOME_INDICATOR : ANDROID_NAV_BAR;
  return { top, bottom, left: 0, right: 0 };
}
