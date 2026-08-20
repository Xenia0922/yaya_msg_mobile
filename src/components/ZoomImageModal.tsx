import React, { useEffect, useMemo, useRef } from 'react';
import {
  Animated,
  Image,
  Modal,
  PanResponder,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useI18n } from '../i18n';
import { usePalette, radii } from '../theme';
import { motion } from '../theme/motion';

function distance(touches: any[]) {
  if (touches.length < 2) return 0;
  const [a, b] = touches;
  const dx = a.pageX - b.pageX;
  const dy = a.pageY - b.pageY;
  return Math.sqrt(dx * dx + dy * dy);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

/**
 * 全屏图片查看器：双指缩放（1x~5x）+ 单指平移，全部走 Animated + useNativeDriver，
 * 松手回弹（spring）；缩放归位不卡顿。
 */
export default function ZoomImageModal({
  url,
  onClose,
}: {
  url: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const palette = usePalette();
  const scale = useRef(new Animated.Value(1)).current;
  const translateX = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(0)).current;

  const startScale = useRef(1);
  const startDistance = useRef(0);
  const startOffset = useRef({ x: 0, y: 0 });

  useEffect(() => {
    if (!url) {
      scale.setValue(1);
      translateX.setValue(0);
      translateY.setValue(0);
    }
  }, [url, scale, translateX, translateY]);

  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (event) => {
      // 读取当前动画值（近似：从 __getValue 取，缩放/平移过程中足够）
      startScale.current = (scale as any).__getValue() || 1;
      startDistance.current = distance(event.nativeEvent.touches);
      startOffset.current = {
        x: (translateX as any).__getValue() || 0,
        y: (translateY as any).__getValue() || 0,
      };
    },
    onPanResponderMove: (event, gesture) => {
      const touches = event.nativeEvent.touches;
      if (touches.length >= 2) {
        const base = startDistance.current || distance(touches);
        const next = base ? clamp(startScale.current * (distance(touches) / base), 1, 5) : startScale.current;
        scale.setValue(next);
        return;
      }
      const currentScale = (scale as any).__getValue() || 1;
      if (currentScale > 1.01) {
        translateX.setValue(startOffset.current.x + gesture.dx);
        translateY.setValue(startOffset.current.y + gesture.dy);
      }
    },
    onPanResponderRelease: () => {
      const currentScale = (scale as any).__getValue() || 1;
      if (currentScale <= 1.02) {
        Animated.parallel([
          Animated.spring(scale, { toValue: 1, ...motion.spring.bouncy, useNativeDriver: true }),
          Animated.spring(translateX, { toValue: 0, ...motion.spring.bouncy, useNativeDriver: true }),
          Animated.spring(translateY, { toValue: 0, ...motion.spring.bouncy, useNativeDriver: true }),
        ]).start();
      }
    },
  }), [scale, translateX, translateY]);

  return (
    <Modal visible={!!url} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.shade}>
        <TouchableOpacity style={styles.close} onPress={onClose} activeOpacity={0.75}>
          <Text style={styles.closeText}>{t('关闭')}</Text>
        </TouchableOpacity>
        {url ? (
          <View style={styles.stage} {...responder.panHandlers}>
            <Animated.Image
              source={{ uri: url }}
              resizeMode="contain"
              style={[
                styles.image,
                {
                  transform: [
                    { translateX },
                    { translateY },
                    { scale },
                  ],
                },
              ]}
            />
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  shade: { flex: 1, backgroundColor: 'rgba(0,0,0,0.94)' },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  close: {
    position: 'absolute',
    top: 42,
    right: 18,
    zIndex: 2,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: radii.pill,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  closeText: { color: '#fff', fontSize: 13, fontWeight: '900' },
  image: { width: '100%', height: '100%' },
});
