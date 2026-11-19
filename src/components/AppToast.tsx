/**
 * AppToast · iOS 26 顶部通知胶囊
 * - 顶部悬浮、自适应宽度，图标 + 单/双行正文
 * - 长消息自动延长停留时间，避免「还没看完就消失」
 * - 消息清空后立即卸载，避免 Toast 永远停留
 */
import React, { useEffect, useRef } from 'react';
import { Animated, Platform, StyleSheet, Text, View } from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { useSafeAreaInsets } from '../hooks/useSafeAreaInsets';
import { useUiStore } from '../store';
import { usePalette, radiiAlias } from '../theme';
import { typography } from '../theme/typography';
import { motion } from '../theme/motion';

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
  const ty = useRef(new Animated.Value(-14)).current;
  const op = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!message) return;
    // 每条新消息都从「上方 + 透明」重新入场；不要在 message 清空后保留组件，
    // 否则退场动画的完成回调可能因原生节点已卸载而不触发，旧 Toast 会永久停留。
    ty.setValue(-14);
    op.setValue(0);
    const enter = Animated.parallel([
      Animated.spring(ty, { toValue: 0, ...motion.spring.bouncy, useNativeDriver: true }),
      Animated.timing(op, { toValue: 1, duration: motion.duration.base, useNativeDriver: true }),
    ]);
    enter.start();
    // 长消息（如成员库同步详情）按长度延长到最多 5 秒，短消息保持轻快。
    const duration = Math.min(5000, Math.max(2400, 1600 + message.length * 28));
    let exit: Animated.CompositeAnimation | null = null;
    const timer = setTimeout(() => {
      exit = Animated.parallel([
        Animated.timing(op, { toValue: 0, duration: 180, useNativeDriver: true }),
        Animated.timing(ty, { toValue: -8, duration: 180, useNativeDriver: true }),
      ]);
      exit.start(({ finished }) => {
        if (finished) hideToast();
      });
    }, duration);
    return () => {
      clearTimeout(timer);
      enter.stop();
      exit?.stop();
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
          top: Math.max(insets.top, 14) + 6,
          opacity: op,
          transform: [{ translateY: ty }],
        },
      ]}
    >
      <Animated.View
        style={[
          styles.banner,
          {
            backgroundColor:
              palette.name === 'dark' ? 'rgba(38,38,43,0.94)' : 'rgba(255,255,255,0.95)',
            borderColor: palette.hairline,
            shadowColor: palette.name === 'dark' ? '#000000' : '#555560',
          },
        ]}
      >
        <View style={[styles.iconWrap, { backgroundColor: toneSoft }]}>
          <MaterialCommunityIcons name={iconName} size={18} color={toneColor} />
        </View>
        <Text
          numberOfLines={2}
          ellipsizeMode="tail"
          style={[typography.footnote, styles.message, { color: palette.label }]}
        >
          {message}
        </Text>
      </Animated.View>
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
    width: '100%',
    maxWidth: 560,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: radiiAlias.card,
    borderWidth: StyleSheet.hairlineWidth,
    ...Platform.select({
      ios: {
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.16,
        shadowRadius: 16,
      },
      android: { elevation: 6 },
      default: null,
    }),
  },
  iconWrap: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  message: {
    flex: 1,
    minWidth: 0,
    fontWeight: '600',
    lineHeight: 18,
  },
});
