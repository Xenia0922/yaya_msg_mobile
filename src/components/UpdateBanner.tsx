import React, { useCallback, useEffect, useRef } from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { useSafeAreaInsets } from '../hooks/useSafeAreaInsets';
import { useI18n } from '../i18n';
import { usePalette } from '../theme';
import { typography } from '../theme/typography';

const AUTO_HIDE_MS = 8000;
const EXIT_MS = 140;

export default function UpdateBanner({
  visible,
  version,
  onPress,
  onDismiss,
}: {
  visible: boolean;
  version: string;
  onPress: () => void;
  onDismiss: () => void;
}) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const ty = useSharedValue(-16);
  const op = useSharedValue(0);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dismissingRef = useRef(false);

  const clearTimers = useCallback(() => {
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
    if (exitTimerRef.current) {
      clearTimeout(exitTimerRef.current);
      exitTimerRef.current = null;
    }
  }, []);

  const animateDismiss = useCallback(() => {
    if (dismissingRef.current) return;
    dismissingRef.current = true;
    clearTimers();
    const exitEase = Easing.in(Easing.cubic);
    ty.value = withTiming(-10, { duration: EXIT_MS, easing: exitEase });
    op.value = withTiming(0, { duration: EXIT_MS, easing: exitEase });
    exitTimerRef.current = setTimeout(() => {
      exitTimerRef.current = null;
      onDismiss();
    }, EXIT_MS + 20);
  }, [clearTimers, onDismiss, op, ty]);

  const handlePress = useCallback(() => {
    dismissingRef.current = true;
    clearTimers();
    onPress();
  }, [clearTimers, onPress]);

  const animStyle = useAnimatedStyle(() => ({
    opacity: op.value,
    transform: [{ translateY: ty.value }],
  }));

  useEffect(() => {
    clearTimers();
    if (!visible || !version) {
      dismissingRef.current = false;
      ty.value = -16;
      op.value = 0;
      return;
    }
    dismissingRef.current = false;
    ty.value = -16;
    op.value = 0;
    const enterEase = Easing.out(Easing.cubic);
    ty.value = withTiming(0, { duration: 180, easing: enterEase });
    op.value = withTiming(1, { duration: 180, easing: enterEase });
    dismissTimerRef.current = setTimeout(() => {
      dismissTimerRef.current = null;
      animateDismiss();
    }, AUTO_HIDE_MS);
    return clearTimers;
  }, [animateDismiss, clearTimers, op, ty, version, visible]);

  if (!visible || !version) return null;

  return (
    <Animated.View
      pointerEvents="box-none"
      accessibilityLiveRegion="polite"
      style={[
        styles.outer,
        {
          top: Math.max(insets.top, 8) + 8,
        },
        animStyle,
      ]}
    >
      <View
        style={[
          styles.banner,
          {
            backgroundColor: palette.name === 'dark' ? '#24242A' : '#FFFFFF',
            borderColor: palette.innerStroke,
            shadowColor: palette.name === 'dark' ? '#000000' : '#404556',
          },
        ]}
      >
        <TouchableOpacity
          style={styles.mainTap}
          activeOpacity={0.82}
          onPress={handlePress}
          accessibilityRole="button"
          accessibilityLabel={t('发现新版本 {v}', { v: version })}
        >
          <View style={[styles.iconWrap, { backgroundColor: palette.tintSoft }]}>
            <MaterialCommunityIcons name="cellphone-arrow-down" size={18} color={palette.tint} />
            <View
              style={[
                styles.redDot,
                { borderColor: palette.name === 'dark' ? '#24242A' : '#FFFFFF' },
              ]}
            />
          </View>
          <View style={styles.textCol}>
            <Text
              style={[typography.footnote, styles.title, { color: palette.label }]}
              numberOfLines={1}
            >
              {t('发现新版本 {v}', { v: version })}
            </Text>
            <Text style={[styles.sub, { color: palette.labelSecondary }]} numberOfLines={1}>
              {t('点击查看更新内容')}
            </Text>
          </View>
          <View style={[styles.ctaPill, { backgroundColor: palette.tint }]}>
            <Text style={[styles.ctaText, { color: palette.onTint }]} numberOfLines={1}>
              {t('立即更新')}
            </Text>
          </View>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={animateDismiss}
          hitSlop={{ top: 8, bottom: 8, left: 6, right: 8 }}
          style={styles.closeBtn}
          accessibilityRole="button"
          accessibilityLabel={t('关闭')}
        >
          <MaterialCommunityIcons name="close" size={16} color={palette.labelTertiary} />
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  outer: {
    position: 'absolute',
    left: 14,
    right: 14,
    zIndex: 9990,
    alignItems: 'center',
  },
  banner: {
    width: '100%',
    maxWidth: 460,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 10,
    paddingRight: 8,
    paddingVertical: 8,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    ...Platform.select({
      ios: {
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.16,
        shadowRadius: 16,
      },
      android: { elevation: 7 },
      default: null,
    }),
  },
  mainTap: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  redDot: {
    position: 'absolute',
    top: -2,
    right: -2,
    width: 9,
    height: 9,
    borderRadius: 4.5,
    backgroundColor: '#FF3B30',
    borderWidth: 1.5,
  },
  textCol: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontWeight: '700',
    lineHeight: 17,
  },
  sub: {
    fontSize: 11.5,
    marginTop: 1,
    lineHeight: 15,
  },
  ctaPill: {
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  ctaText: {
    fontSize: 12,
    fontWeight: '700',
  },
  closeBtn: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 2,
  },
});
