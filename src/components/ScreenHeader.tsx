import React, { useCallback } from 'react';
import { Platform, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useI18n } from '../i18n';
import { fontFamily, usePalette } from '../theme';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { ScalePressable } from './Motion';
import { GlassSurface } from './GlassSurface';
import { FLOATING_BAR_HEIGHT } from './FloatingTabHeader';

interface Props {
  title: string;
  onBack?: () => void;
  right?: React.ReactNode;

  leading?: React.ReactNode;
  style?: ViewStyle;

  overlay?: boolean;

  hideBack?: boolean;
}

export default function ScreenHeader({
  title,
  onBack,
  right,
  leading,
  style,
  overlay,
  hideBack,
}: Props) {
  const navigation = useNavigation();
  const { t } = useI18n();
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const goBack = useCallback(() => {
    if (onBack) onBack();
    else navigation.goBack();
  }, [onBack, navigation]);
  const topPad = insets.top + 8;

  const leftContent = (
    <GlassSurface
      role="bar"
      radius={FLOATING_BAR_HEIGHT / 2}
      style={[
        styles.leftGlass,
        hideBack ? styles.leftGlassNoBack : null,
        hideBack ? styles.islandShadow : null,
        hideBack ? { maxWidth: right ? '68%' : '96%' } : null,
      ]}
    >
      {!hideBack ? (
        <View style={styles.backIcon}>
          <MaterialCommunityIcons name="arrow-left" color={palette.label} size={20} />
        </View>
      ) : null}
      {leading ? <View style={styles.leading}>{leading}</View> : null}
      <Text
        numberOfLines={1}
        style={[
          styles.title,
          { color: palette.label },
          overlay
            ? {
                textShadowColor: 'rgba(0,0,0,0.30)',
                textShadowOffset: { width: 0, height: 1 },
                textShadowRadius: 3,
              }
            : null,
        ]}
      >
        {title}
      </Text>
    </GlassSurface>
  );

  return (
    <View style={[styles.header, { paddingTop: topPad }, style]}>
      {!hideBack ? (
        <ScalePressable
          onPress={goBack}
          accessibilityRole="button"
          accessibilityLabel={t('返回')}
          pressedScale={0.96}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          style={[styles.leftWrap, styles.islandShadow, { maxWidth: right ? '68%' : '96%' }]}
        >
          {leftContent}
        </ScalePressable>
      ) : (
        leftContent
      )}

      {right ? (
        <GlassSurface
          role="bar"
          radius={FLOATING_BAR_HEIGHT / 2}
          style={[styles.rightGlass, styles.islandShadow]}
        >
          {right}
        </GlassSurface>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    position: 'relative',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingBottom: 10,
    gap: 10,
  },
  islandShadow: {
    borderRadius: FLOATING_BAR_HEIGHT / 2,
    borderCurve: 'continuous',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.08,
        shadowRadius: 12,
      },
      android: null,
      default: null,
    }),
  },
  leftWrap: {
    flexShrink: 1,
  },
  leftGlass: {
    height: FLOATING_BAR_HEIGHT,
    paddingLeft: 10,
    paddingRight: 16,
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
    gap: 6,
  },
  leftGlassNoBack: {
    paddingLeft: 16,
  },
  rightGlass: {
    height: FLOATING_BAR_HEIGHT,
    minWidth: FLOATING_BAR_HEIGHT,
    paddingHorizontal: 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    flexShrink: 0,
  },
  leading: { alignItems: 'center', justifyContent: 'center' },
  backIcon: {
    width: 26,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    flexShrink: 1,
    minWidth: 0,
    fontSize: 16,
    lineHeight: 20,
    fontFamily: fontFamily.system,
    fontWeight: '700',
    includeFontPadding: false,
    textAlignVertical: 'center',
    ...Platform.select({ android: { paddingTop: 1 }, default: null }),
  },
});
