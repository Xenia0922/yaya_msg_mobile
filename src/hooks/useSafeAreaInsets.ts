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
  const top = Platform.OS === 'ios' ? StatusBar.currentHeight || 44 : StatusBar.currentHeight || 24;
  const bottom = Platform.OS === 'ios' ? IOS_HOME_INDICATOR : ANDROID_NAV_BAR;
  return { top, bottom, left: 0, right: 0 };
}
