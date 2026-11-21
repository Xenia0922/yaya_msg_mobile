import { Platform, TextStyle } from 'react-native';

const systemFamily = Platform.select({
  ios: 'System',
  android: 'GoogleSansFlex',
  default: 'System',
});
const roundedFamily = Platform.select({
  ios: 'System',
  android: 'GoogleSansFlex',
  default: 'System',
});

export const fontFamily = {
  system: systemFamily,
  rounded: roundedFamily,
};

const isAndroid = Platform.OS === 'android';
const boldWeight: TextStyle['fontWeight'] = '700';
const semiBoldWeight: TextStyle['fontWeight'] = '600';
const extraBoldWeight: TextStyle['fontWeight'] = isAndroid ? '700' : '800';
const baseFontProps: Pick<TextStyle, 'fontFamily' | 'includeFontPadding'> = isAndroid
  ? { fontFamily: systemFamily, includeFontPadding: false }
  : { fontFamily: systemFamily };
const ls = (iosSpacing: number) => (isAndroid ? 0 : iosSpacing);

export const typography = {
  largeTitle: {
    fontSize: 34,
    lineHeight: 41,
    fontWeight: boldWeight,
    letterSpacing: ls(0.37),
    ...baseFontProps,
  },
  title1: {
    fontSize: 28,
    lineHeight: 34,
    fontWeight: boldWeight,
    letterSpacing: ls(0.36),
    ...baseFontProps,
  },
  title2: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: boldWeight,
    letterSpacing: ls(0.35),
    ...baseFontProps,
  },
  title3: {
    fontSize: 20,
    lineHeight: 25,
    fontWeight: semiBoldWeight,
    letterSpacing: ls(0.38),
    ...baseFontProps,
  },
  headline: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: semiBoldWeight,
    letterSpacing: ls(-0.41),
    ...baseFontProps,
  },
  body: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '400' as TextStyle['fontWeight'],
    letterSpacing: ls(-0.41),
    ...baseFontProps,
  },
  callout: {
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '400' as TextStyle['fontWeight'],
    letterSpacing: ls(-0.32),
    ...baseFontProps,
  },
  subhead: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '400' as TextStyle['fontWeight'],
    letterSpacing: ls(-0.24),
    ...baseFontProps,
  },
  footnote: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '400' as TextStyle['fontWeight'],
    letterSpacing: ls(-0.08),
    ...baseFontProps,
  },
  caption1: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '400' as TextStyle['fontWeight'],
    letterSpacing: 0,
    ...baseFontProps,
  },
  caption2: {
    fontSize: 11,
    lineHeight: 13,
    fontWeight: '400' as TextStyle['fontWeight'],
    letterSpacing: ls(0.07),
    ...baseFontProps,
  },

  pageTitle: {
    fontSize: 24,
    lineHeight: 30,
    fontWeight: extraBoldWeight,
    letterSpacing: ls(-0.3),
    ...baseFontProps,
  },

  sectionTitle: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: extraBoldWeight,
    letterSpacing: ls(-0.2),
    ...baseFontProps,
  },
} as const;

export type TypographyToken = keyof typeof typography;
