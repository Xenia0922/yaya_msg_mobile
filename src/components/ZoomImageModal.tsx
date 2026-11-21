import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Modal,
  PanResponder,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type NativeTouchEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NetworkImage } from './NetworkImage';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { useI18n } from '../i18n';
import { radii, fontFamily } from '../theme';
import { motion } from '../theme/motion';

function distance(touches: readonly NativeTouchEvent[]) {
  if (touches.length < 2) return 0;
  const [a, b] = touches;
  const dx = a.pageX - b.pageX;
  const dy = a.pageY - b.pageY;
  return Math.sqrt(dx * dx + dy * dy);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export default function ZoomImageModal({
  url,
  onClose,
  onDownload,
  onShare,
}: {
  url: string;
  onClose: () => void;

  onDownload?: () => void;

  onShare?: () => void;
}) {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const scale = useRef(new Animated.Value(1)).current;
  const translateX = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(0)).current;

  const scaleValue = useRef(1);
  const translateXValue = useRef(0);
  const translateYValue = useRef(0);

  const shadeOpacity = useRef(new Animated.Value(1)).current;

  const [loadingImg, setLoadingImg] = useState(false);
  const [failed, setFailed] = useState(false);
  const startScale = useRef(1);
  const startDistance = useRef(0);
  const startOffset = useRef({ x: 0, y: 0 });

  const tapStart = useRef({ t: 0, moved: false });

  const lastTapAt = useRef(0);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    setLoadingImg(!!url);
    setFailed(false);
  }, [url]);

  useEffect(() => {
    const ids = [
      scale.addListener(({ value }) => {
        scaleValue.current = value;
      }),
      translateX.addListener(({ value }) => {
        translateXValue.current = value;
      }),
      translateY.addListener(({ value }) => {
        translateYValue.current = value;
      }),
    ];
    return () => {
      scale.removeListener(ids[0]);
      translateX.removeListener(ids[1]);
      translateY.removeListener(ids[2]);
    };
  }, [scale, translateX, translateY]);

  useEffect(() => {
    if (!url) {
      scale.setValue(1);
      translateX.setValue(0);
      translateY.setValue(0);
      scaleValue.current = 1;
      translateXValue.current = 0;
      translateYValue.current = 0;
    }
  }, [url, scale, translateX, translateY]);

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onStartShouldSetPanResponderCapture: () => true,
        onMoveShouldSetPanResponder: () => true,

        onMoveShouldSetPanResponderCapture: (_e, g) =>
          g.numberActiveTouches >= 2 || (g.dy > 10 && Math.abs(g.dy) > Math.abs(g.dx) * 1.2),
        onPanResponderTerminationRequest: () => false,
        onShouldBlockNativeResponder: () => true,
        onPanResponderGrant: (event) => {
          startScale.current = scaleValue.current || 1;

          startDistance.current =
            event.nativeEvent.touches.length >= 2 ? distance(event.nativeEvent.touches) : 0;
          tapStart.current = { t: Date.now(), moved: false };
          startOffset.current = {
            x: translateXValue.current || 0,
            y: translateYValue.current || 0,
          };
        },
        onPanResponderMove: (event, gesture) => {
          const touches = event.nativeEvent.touches;
          if (Math.abs(gesture.dx) > 6 || Math.abs(gesture.dy) > 6) tapStart.current.moved = true;
          if (touches.length >= 2) {
            if (!startDistance.current) {
              startDistance.current = distance(touches);
              startScale.current = scaleValue.current || 1;
            }
            const base = startDistance.current;
            const next = base
              ? clamp(startScale.current * (distance(touches) / base), 1, 5)
              : startScale.current;
            scale.setValue(next);
            scaleValue.current = next;
            return;
          }
          const currentScale = scaleValue.current || 1;
          if (currentScale > 1.01) {
            translateX.setValue(startOffset.current.x + gesture.dx);
            translateY.setValue(startOffset.current.y + gesture.dy);
            translateXValue.current = startOffset.current.x + gesture.dx;
            translateYValue.current = startOffset.current.y + gesture.dy;
            return;
          }

          if (gesture.dy > 0) {
            translateY.setValue(gesture.dy);
            translateYValue.current = gesture.dy;
            shadeOpacity.setValue(Math.max(0.35, 1 - gesture.dy / 420));
          }
        },
        onPanResponderRelease: () => {
          const currentScale = scaleValue.current || 1;
          startDistance.current = 0;
          const start = tapStart.current;
          const isTap = !start.moved && Date.now() - start.t < 260;
          if (isTap) {
            const now = Date.now();
            if (now - lastTapAt.current < 320) {
              lastTapAt.current = 0;
              if (currentScale <= 1.02) {
                onCloseRef.current();
                return;
              }
              Animated.parallel([
                Animated.spring(scale, {
                  toValue: 1,
                  ...motion.spring.bouncy,
                  useNativeDriver: false,
                }),
                Animated.spring(translateX, {
                  toValue: 0,
                  ...motion.spring.bouncy,
                  useNativeDriver: false,
                }),
                Animated.spring(translateY, {
                  toValue: 0,
                  ...motion.spring.bouncy,
                  useNativeDriver: false,
                }),
              ]).start();
              scaleValue.current = 1;
              translateXValue.current = 0;
              translateYValue.current = 0;
              return;
            }
            lastTapAt.current = now;
          }

          const dyNow = translateYValue.current || 0;
          if (dyNow > 180) {
            Animated.timing(shadeOpacity, {
              toValue: 0,
              duration: 140,
              useNativeDriver: false,
            }).start(() => {
              onCloseRef.current();
              requestAnimationFrame(() => {
                translateY.setValue(0);
                translateX.setValue(0);
                scale.setValue(1);
                translateXValue.current = 0;
                translateYValue.current = 0;
                scaleValue.current = 1;
                shadeOpacity.setValue(1);
              });
            });
            return;
          }
          Animated.spring(shadeOpacity, {
            toValue: 1,
            ...motion.spring.bouncy,
            useNativeDriver: false,
          }).start();
          if (currentScale <= 1.02) {
            Animated.parallel([
              Animated.spring(scale, {
                toValue: 1,
                ...motion.spring.bouncy,
                useNativeDriver: false,
              }),
              Animated.spring(translateX, {
                toValue: 0,
                ...motion.spring.bouncy,
                useNativeDriver: false,
              }),
              Animated.spring(translateY, {
                toValue: 0,
                ...motion.spring.bouncy,
                useNativeDriver: false,
              }),
            ]).start();
            scaleValue.current = 1;
            translateXValue.current = 0;
            translateYValue.current = 0;
          }
        },
      }),
    [scale, translateX, translateY, shadeOpacity],
  );

  return (
    <Modal visible={!!url} transparent animationType="fade" onRequestClose={onClose}>
      <Animated.View style={[styles.shade, { opacity: shadeOpacity }]}>
        <TouchableOpacity
          style={[styles.close, { top: insets.top + 16 }]}
          onPress={onClose}
          activeOpacity={0.75}
          accessibilityRole="button"
          accessibilityLabel={t('关闭')}
        >
          <Text style={styles.closeText}>{t('关闭')}</Text>
        </TouchableOpacity>
        {url ? (
          <View
            style={[styles.stage, { paddingBottom: 96 + insets.bottom }]}
            {...responder.panHandlers}
          >
            <Animated.View
              style={[styles.image, { transform: [{ translateX }, { translateY }, { scale }] }]}
            >
              <NetworkImage
                source={{ uri: url }}
                resizeMode="contain"
                style={styles.fill}
                onLoadStart={() => setLoadingImg(true)}
                onLoad={() => setLoadingImg(false)}
                onError={() => {
                  setLoadingImg(false);
                  setFailed(true);
                }}
              />
            </Animated.View>
            {loadingImg ? (
              <View style={styles.hintWrap} pointerEvents="none">
                <ActivityIndicator color="rgba(255,255,255,0.85)" />
              </View>
            ) : null}
            {failed ? (
              <View style={styles.hintWrap} pointerEvents="none">
                <Text style={styles.hintText}>{t('图片加载失败')}</Text>
              </View>
            ) : null}
          </View>
        ) : null}

        <View
          style={[styles.actions, { bottom: Math.max(insets.bottom, 16) + 14 }]}
          pointerEvents="box-none"
        >
          {onDownload ? (
            <TouchableOpacity
              style={styles.actionBtn}
              onPress={onDownload}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel={t('下载')}
            >
              <MaterialCommunityIcons name="download" size={20} color="#fff" />
              <Text style={styles.actionText}>{t('下载')}</Text>
            </TouchableOpacity>
          ) : null}
          {onShare ? (
            <TouchableOpacity
              style={styles.actionBtn}
              onPress={onShare}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel={t('分享')}
            >
              <MaterialCommunityIcons name="share-variant" size={20} color="#fff" />
              <Text style={styles.actionText}>{t('分享')}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  shade: { flex: 1, backgroundColor: 'rgba(0,0,0,0.94)' },

  stage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  close: {
    position: 'absolute',
    right: 18,
    zIndex: 2,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: radii.pill,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  closeText: { color: '#fff', fontSize: 13, fontFamily: fontFamily.system, fontWeight: '900' },
  image: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' },
  fill: { width: '100%', height: '100%' },

  hintWrap: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  hintText: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 13,
    fontFamily: fontFamily.system,
    fontWeight: '600',
  },

  actions: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: radii.pill,
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  actionText: { color: '#fff', fontSize: 13, fontFamily: fontFamily.system, fontWeight: '700' },
});
