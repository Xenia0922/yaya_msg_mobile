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
} from 'react-native';
import { NetworkImage } from './NetworkImage';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
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
  onDownload,
  onShare,
}: {
  url: string;
  onClose: () => void;
  /** 可选：右下角「下载」按钮 */
  onDownload?: () => void;
  /** 可选：右下角「分享」按钮 */
  onShare?: () => void;
}) {
  const { t } = useI18n();
  const palette = usePalette();
  const scale = useRef(new Animated.Value(1)).current;
  const translateX = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(0)).current;
  /** 下滑返回：跟着位移淡出遮罩，松手判定是否关闭 */
  const shadeOpacity = useRef(new Animated.Value(1)).current;

  /** 原图加载中 → 转圈；失败 → 明确提示（旧实现什么都没有，满屏只剩黑背景 = "大黑块"） */
  const [loadingImg, setLoadingImg] = useState(false);
  const [failed, setFailed] = useState(false);
  const startScale = useRef(1);
  const startDistance = useRef(0);
  const startOffset = useRef({ x: 0, y: 0 });
  /** 单击判定：按下时刻/是否发生位移 */
  const tapStart = useRef({ t: 0, moved: false });
  /** 上一次有效单击时间（双击窗口 320ms） */
  const lastTapAt = useRef(0);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    setLoadingImg(!!url);
    setFailed(false);
  }, [url]);

  useEffect(() => {
    if (!url) {
      scale.setValue(1);
      translateX.setValue(0);
      translateY.setValue(0);
    }
  }, [url, scale, translateX, translateY]);

  const responder = useMemo(() => PanResponder.create({
    // 捕获阶段就抢占：Modal 内层 Image/父容器会先拿 responder，
    // 双指落下后手势被上层 terminate → 表现为「双指放大没有反应」（2026-10-18）
    onStartShouldSetPanResponder: () => true,
    onStartShouldSetPanResponderCapture: () => true,
    onMoveShouldSetPanResponder: () => true,
    // 捕获阶段只抢「双指」或「明确向下拖」的手势：
    // 原为无条件 true → 任何轻微滑动都被当成关闭手势（用户反馈「下滑关闭太敏感」）。
    onMoveShouldSetPanResponderCapture: (_e, g) =>
      g.numberActiveTouches >= 2 || (g.dy > 10 && Math.abs(g.dy) > Math.abs(g.dx) * 1.2),
    onPanResponderTerminationRequest: () => false,
    onShouldBlockNativeResponder: () => true,
    onPanResponderGrant: (event) => {
      // 读取当前动画值（近似：从 __getValue 取，缩放/平移过程中足够）
      startScale.current = (scale as any).__getValue() || 1;
      // 单指落下时 distance 为 0；真正的基准在双指出现那一刻固定（见 move）
      startDistance.current = event.nativeEvent.touches.length >= 2 ? distance(event.nativeEvent.touches) : 0;
      tapStart.current = { t: Date.now(), moved: false };
      startOffset.current = {
        x: (translateX as any).__getValue() || 0,
        y: (translateY as any).__getValue() || 0,
      };
    },
    onPanResponderMove: (event, gesture) => {
      const touches = event.nativeEvent.touches;
      if (Math.abs(gesture.dx) > 6 || Math.abs(gesture.dy) > 6) tapStart.current.moved = true;
      if (touches.length >= 2) {
        // ⚠️ 根因修复（2026-10-18）：基准必须在双指**首次出现**时固定。
        // 原写法 base = startDistance.current || distance(touches)，而 startDistance 从未赋值
        // → 每次 move 都拿当前距离当基准 → 比例恒为 1 → 双指放大完全没反应。
        if (!startDistance.current) {
          startDistance.current = distance(touches);
          startScale.current = (scale as any).__getValue() || 1;
        }
        const base = startDistance.current;
        const next = base ? clamp(startScale.current * (distance(touches) / base), 1, 5) : startScale.current;
        scale.setValue(next);
        return;
      }
      const currentScale = (scale as any).__getValue() || 1;
      if (currentScale > 1.01) {
        translateX.setValue(startOffset.current.x + gesture.dx);
        translateY.setValue(startOffset.current.y + gesture.dy);
        return;
      }
      // 未放大：单指下滑返回（跟手位移 + 遮罩淡出）
      if (gesture.dy > 0) {
        translateY.setValue(gesture.dy);
        shadeOpacity.setValue(Math.max(0.35, 1 - gesture.dy / 420));
      }
    },
    onPanResponderRelease: () => {
      const currentScale = (scale as any).__getValue() || 1;
      startDistance.current = 0; // 复位：下次双指重新取基准
      const start = tapStart.current;
      const isTap = !start.moved && Date.now() - start.t < 260;
      if (isTap) {
        const now = Date.now();
        if (now - lastTapAt.current < 320) {
          lastTapAt.current = 0;
          if (currentScale <= 1.02) {
            onCloseRef.current(); // 未放大时双击（空白处/画面）→ 退出预览
            return;
          }
          Animated.parallel([
            Animated.spring(scale, { toValue: 1, ...motion.spring.bouncy, useNativeDriver: false }),
            Animated.spring(translateX, { toValue: 0, ...motion.spring.bouncy, useNativeDriver: false }),
            Animated.spring(translateY, { toValue: 0, ...motion.spring.bouncy, useNativeDriver: false }),
          ]).start();
          return;
        }
        lastTapAt.current = now;
      }
      // 下滑返回：位移超过 180 才关闭（原 110 太敏感，轻微下滑就退出预览）
      const dyNow = Number((translateY as any).__getValue() || 0);
      if (dyNow > 180) {
        Animated.timing(shadeOpacity, { toValue: 0, duration: 140, useNativeDriver: false }).start(() => {
          // ⚠️ 先关再复位：若先 setValue(0)，关闭前的最后一帧会看到图片「闪回原位」（用户实测）
          onCloseRef.current();
          requestAnimationFrame(() => {
            translateY.setValue(0);
            translateX.setValue(0);
            scale.setValue(1);
            shadeOpacity.setValue(1);
          });
        });
        return;
      }
      Animated.spring(shadeOpacity, { toValue: 1, ...motion.spring.bouncy, useNativeDriver: false }).start();
      if (currentScale <= 1.02) {
        Animated.parallel([
          Animated.spring(scale, { toValue: 1, ...motion.spring.bouncy, useNativeDriver: false }),
          Animated.spring(translateX, { toValue: 0, ...motion.spring.bouncy, useNativeDriver: false }),
          Animated.spring(translateY, { toValue: 0, ...motion.spring.bouncy, useNativeDriver: false }),
        ]).start();
      }
    },
  }), [scale, translateX, translateY]);

  return (
    <Modal visible={!!url} transparent animationType="fade" onRequestClose={onClose}>
      <Animated.View style={[styles.shade, { opacity: shadeOpacity }]}>
        <TouchableOpacity style={styles.close} onPress={onClose} activeOpacity={0.75}>
          <Text style={styles.closeText}>{t('关闭')}</Text>
        </TouchableOpacity>
        {url ? (
          <View style={styles.stage} {...responder.panHandlers}>
            {/* 位移/缩放放在外层 Animated.View 上（原来直接包在 Animated.Image 上）；
                图片本体换成 NetworkImage —— 与网格同一套「缩略图→原图→占位」三级兜底，
                不再出现"原图失败就满屏黑"的情况 */}
            <Animated.View style={[styles.image, { transform: [{ translateX }, { translateY }, { scale }] }]}>
              <NetworkImage
                source={{ uri: url }}
                resizeMode="contain"
                style={styles.fill}
                onLoadStart={() => setLoadingImg(true)}
                onLoad={() => setLoadingImg(false)}
                onError={() => { setLoadingImg(false); setFailed(true); }}
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
        {/* 右下角操作：下载 / 分享（与预览控件同区，避免误触关闭） */}
        <View style={styles.actions} pointerEvents="box-none">
          {onDownload ? (
            <TouchableOpacity style={styles.actionBtn} onPress={onDownload} activeOpacity={0.8}>
              <MaterialCommunityIcons name="download" size={20} color="#fff" />
              <Text style={styles.actionText}>{t('下载')}</Text>
            </TouchableOpacity>
          ) : null}
          {onShare ? (
            <TouchableOpacity style={styles.actionBtn} onPress={onShare} activeOpacity={0.8}>
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
  // 底部留 96dp 给下载/分享条：图片按 contain 排版时不再被按钮盖住
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 96 },
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
  image: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' },
  fill: { width: '100%', height: '100%' },
  /** 加载中/失败的居中提示（盖在图片区域上） */
  hintWrap: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  hintText: { color: 'rgba(255,255,255,0.75)', fontSize: 13, fontWeight: '600' },
  /** 右下角操作条 */
  actions: { position: 'absolute', right: 16, bottom: 26, alignItems: 'flex-end', gap: 10 },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: radii.pill,
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  actionText: { color: '#fff', fontSize: 13, fontWeight: '700' },
});
