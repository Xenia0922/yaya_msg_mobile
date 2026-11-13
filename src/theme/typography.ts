// iOS 26 排版梯度（基于 SF Pro / 中文 PingFang SC 回退）
// 大标题 + 系统字体梯度，字号与行高按 Apple HIG 节奏给到 round numbers。
// 全局字体跟随系统：iOS 中文即苹方（系统自带）；Android 用系统默认字体（不打包自定义字体）。
import { Platform, TextStyle } from 'react-native';

const systemFamily = Platform.select({
  ios: 'System',
  android: undefined,
  default: 'System',
});
const roundedFamily = Platform.select({
  ios: 'System',
  android: undefined,
  default: 'System',
});

export const fontFamily = {
  system: systemFamily,
  rounded: roundedFamily,
};

/** 字体梯度（字号 / 行高 / 字重 / 用途） */
export const typography = {
  largeTitle: { fontSize: 34, lineHeight: 41, fontWeight: '700' as TextStyle['fontWeight'], letterSpacing: 0.37 },
  title1: { fontSize: 28, lineHeight: 34, fontWeight: '700' as TextStyle['fontWeight'], letterSpacing: 0.36 },
  title2: { fontSize: 22, lineHeight: 28, fontWeight: '700' as TextStyle['fontWeight'], letterSpacing: 0.35 },
  title3: { fontSize: 20, lineHeight: 25, fontWeight: '600' as TextStyle['fontWeight'], letterSpacing: 0.38 },
  headline: { fontSize: 17, lineHeight: 22, fontWeight: '600' as TextStyle['fontWeight'], letterSpacing: -0.41 },
  body: { fontSize: 17, lineHeight: 22, fontWeight: '400' as TextStyle['fontWeight'], letterSpacing: -0.41 },
  callout: { fontSize: 16, lineHeight: 21, fontWeight: '400' as TextStyle['fontWeight'], letterSpacing: -0.32 },
  subhead: { fontSize: 15, lineHeight: 20, fontWeight: '400' as TextStyle['fontWeight'], letterSpacing: -0.24 },
  footnote: { fontSize: 13, lineHeight: 18, fontWeight: '400' as TextStyle['fontWeight'], letterSpacing: -0.08 },
  caption1: { fontSize: 12, lineHeight: 16, fontWeight: '400' as TextStyle['fontWeight'], letterSpacing: 0 },
  caption2: { fontSize: 11, lineHeight: 13, fontWeight: '400' as TextStyle['fontWeight'], letterSpacing: 0.07 },
} as const;

export type TypographyToken = keyof typeof typography;
