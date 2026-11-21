import React, { useEffect, useRef } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { useSafeAreaInsets } from '../hooks/useSafeAreaInsets';
import { useUiStore } from '../store';
import { usePalette } from '../theme';
import { typography } from '../theme/typography';

type ToastTone = 'success' | 'error' | 'info';

function inferToastTone(message: string): ToastTone {
  if (
    /失败|错误|异常|超时|无法|拒绝|不足|未找到|failed|error|timeout|unable|invalid|expired|失敗|エラー|실패|오류/i.test(
      message,
    )
  )
    return 'error';
  if (
    /成功|已更新|已保存|已复制|已完成|已是最新|已连接|已发送|已删除|已登录|已退出|success|saved|copied|updated|completed|connected|sent|deleted|成功|保存|コピー|성공|저장/i.test(
      message,
    )
  )
    return 'success';
  return 'info';
}

export default function AppToast() {
  const message = useUiStore((state) => state.toastMessage);
  const explicitTone = useUiStore((state) => state.toastTone);
  const hideToast = useUiStore((state) => state.hideToast);
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const ty = useSharedValue(-8);
  const op = useSharedValue(0);
  const seqRef = useRef(0);

  const animStyle = useAnimatedStyle(() => ({
    opacity: op.value,
    transform: [{ translateY: ty.value }],
  }));

  useEffect(() => {
    if (!message) {
      ty.value = -8;
      op.value = 0;
      return;
    }
    const seq = ++seqRef.current;

    ty.value = -8;
    op.value = 0;
    const enterEase = Easing.out(Easing.cubic);
    ty.value = withTiming(0, { duration: 150, easing: enterEase });
    op.value = withTiming(1, { duration: 150, easing: enterEase });

    const duration = Math.min(5000, Math.max(2200, 1500 + message.length * 28));
    const timer = setTimeout(() => {
      const exitEase = Easing.in(Easing.cubic);
      ty.value = withTiming(-6, { duration: 140, easing: exitEase });
      op.value = withTiming(0, { duration: 140, easing: exitEase }, (finished) => {
        if (finished && seqRef.current === seq) {
          runOnJS(hideToast)();
        }
      });
    }, duration);
    return () => {
      clearTimeout(timer);
    };
  }, [hideToast, message, op, ty]);

  if (!message) return null;

  const tone = explicitTone ?? inferToastTone(message);
  const toneColor =
    tone === 'error' ? palette.danger : tone === 'success' ? palette.success : palette.tint;
  const toneSoft =
    tone === 'error'
      ? 'rgba(255,59,48,0.14)'
      : tone === 'success'
        ? 'rgba(52,199,89,0.15)'
        : palette.tintSoft;
  const iconName =
    tone === 'error' ? 'alert-circle' : tone === 'success' ? 'check-circle' : 'information-outline';

  return (
    <Animated.View
      pointerEvents="none"
      accessibilityRole="alert"
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
        <View style={[styles.iconWrap, { backgroundColor: toneSoft }]}>
          <MaterialCommunityIcons name={iconName} size={17} color={toneColor} />
        </View>
        <Text
          numberOfLines={2}
          ellipsizeMode="tail"
          style={[typography.footnote, styles.message, { color: palette.label }]}
        >
          {message}
        </Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  outer: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 9999,
    alignItems: 'center',
  },
  banner: {
    alignSelf: 'center',
    minWidth: 168,
    maxWidth: 460,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingLeft: 9,
    paddingRight: 16,
    paddingVertical: 7,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    ...Platform.select({
      ios: {
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.14,
        shadowRadius: 14,
      },
      android: { elevation: 6 },
      default: null,
    }),
  },
  iconWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  message: {
    flexShrink: 1,
    minWidth: 0,
    fontWeight: '600',
    lineHeight: 18,
  },
});
