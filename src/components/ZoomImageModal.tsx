import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type NativeTouchEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NetworkImage } from './NetworkImage';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { useI18n } from '../i18n';
import { radii, fontFamily } from '../theme';
import { motion } from '../theme/motion';
import { logWarn } from '../utils/runtimeLog';

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

function ZoomSlide({
  uri,
  slideWidth,
  isGallery,
  shadeOpacity,
  onZoomChange,
  onClose,
}: {
  uri: string;
  slideWidth?: number;
  isGallery: boolean;
  shadeOpacity: Animated.Value;
  onZoomChange: (zoomed: boolean) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const scale = useRef(new Animated.Value(1)).current;
  const translateX = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(0)).current;

  const scaleValue = useRef(1);
  const translateXValue = useRef(0);
  const translateYValue = useRef(0);
  const startScale = useRef(1);
  const startDistance = useRef(0);
  const startOffset = useRef({ x: 0, y: 0 });
  const tapStart = useRef({ t: 0, moved: false });
  const lastTapAt = useRef(0);

  const [loadingImg, setLoadingImg] = useState(true);
  const [failed, setFailed] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const onZoomChangeRef = useRef(onZoomChange);
  onZoomChangeRef.current = onZoomChange;

  useEffect(() => {
    setLoadingImg(!!uri);
    setFailed(false);
    setRetryKey(0);
    scale.setValue(1);
    translateX.setValue(0);
    translateY.setValue(0);
    scaleValue.current = 1;
    translateXValue.current = 0;
    translateYValue.current = 0;
    onZoomChangeRef.current(false);
  }, [uri, scale, translateX, translateY]);

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

  const handleTap = useCallback(() => {
    const currentScale = scaleValue.current || 1;
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
          useNativeDriver: true,
        }),
        Animated.spring(translateX, {
          toValue: 0,
          ...motion.spring.bouncy,
          useNativeDriver: true,
        }),
        Animated.spring(translateY, {
          toValue: 0,
          ...motion.spring.bouncy,
          useNativeDriver: true,
        }),
      ]).start();
      scaleValue.current = 1;
      translateXValue.current = 0;
      translateYValue.current = 0;
      onZoomChangeRef.current(false);
      return;
    }
    lastTapAt.current = now;
  }, [scale, translateX, translateY]);

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: (event) =>
          !isGallery || event.nativeEvent.touches.length >= 2,
        onStartShouldSetPanResponderCapture: () => false,
        onMoveShouldSetPanResponder: (event, g) =>
          event.nativeEvent.touches.length >= 2 ||
          scaleValue.current > 1.02 ||
          (!isGallery && (Math.abs(g.dx) > 4 || Math.abs(g.dy) > 4)) ||
          (g.dy > 10 && Math.abs(g.dy) > Math.abs(g.dx) * 1.2),
        onMoveShouldSetPanResponderCapture: (event, g) =>
          event.nativeEvent.touches.length >= 2 ||
          scaleValue.current > 1.02 ||
          (g.dy > 10 && Math.abs(g.dy) > Math.abs(g.dx) * 1.2),
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
            onZoomChangeRef.current(next > 1.02);
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
          onZoomChangeRef.current(currentScale > 1.02);
          const start = tapStart.current;
          if (!start.moved && Date.now() - start.t < 260) {
            handleTap();
            return;
          }

          const dyNow = translateYValue.current || 0;
          if (currentScale <= 1.02 && dyNow > 180) {
            Animated.timing(shadeOpacity, {
              toValue: 0,
              duration: 140,
              useNativeDriver: true,
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
                onZoomChangeRef.current(false);
              });
            });
            return;
          }
          Animated.spring(shadeOpacity, {
            toValue: 1,
            ...motion.spring.bouncy,
            useNativeDriver: true,
          }).start();
          if (currentScale <= 1.02) {
            Animated.parallel([
              Animated.spring(scale, {
                toValue: 1,
                ...motion.spring.bouncy,
                useNativeDriver: true,
              }),
              Animated.spring(translateX, {
                toValue: 0,
                ...motion.spring.bouncy,
                useNativeDriver: true,
              }),
              Animated.spring(translateY, {
                toValue: 0,
                ...motion.spring.bouncy,
                useNativeDriver: true,
              }),
            ]).start();
            scaleValue.current = 1;
            translateXValue.current = 0;
            translateYValue.current = 0;
          }
        },
      }),
    [isGallery, scale, translateX, translateY, shadeOpacity, handleTap],
  );

  return (
    <View style={[styles.slideWrap, slideWidth ? { width: slideWidth } : undefined]}>
      <View
        style={[styles.stage, { paddingBottom: 96 + insets.bottom }]}
        {...responder.panHandlers}
      >
        <Pressable onPress={handleTap} style={styles.fillPress}>
          <Animated.View
            style={[styles.image, { transform: [{ translateX }, { translateY }, { scale }] }]}
          >
            <NetworkImage
              key={`${uri}#${retryKey}`}
              source={{ uri }}
              resizeMode="contain"
              style={styles.fill}
              fallback={false}
              onLoadStart={() => setLoadingImg(true)}
              onLoad={() => {
                setLoadingImg(false);
                setFailed(false);
              }}
              onError={(e: any) => {
                setLoadingImg(false);
                setFailed(true);
                const safe = uri.split('?')[0];
                const reason = String(e?.nativeEvent?.error || 'unknown');
                logWarn(`[ZoomImageModal] 图片加载失败: ${safe} err=${reason}`, 'ui.image');
              }}
            />
          </Animated.View>
        </Pressable>
        {loadingImg ? (
          <View style={styles.hintWrap} pointerEvents="none">
            <ActivityIndicator color="rgba(255,255,255,0.85)" />
          </View>
        ) : null}
      </View>

      {failed ? (
        <View style={styles.hintWrap} pointerEvents="box-none">
          <Text style={styles.hintText}>{t('图片加载失败')}</Text>
          <TouchableOpacity
            style={styles.retryBtn}
            onPress={() => {
              setFailed(false);
              setLoadingImg(true);
              setRetryKey((k) => k + 1);
            }}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel={t('重试')}
          >
            <MaterialCommunityIcons name="refresh" size={16} color="#fff" />
            <Text style={styles.retryText}>{t('重试')}</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
}

export default function ZoomImageModal({
  url,
  images,
  initialIndex = 0,
  onClose,
  onDownload,
  onShare,
}: {
  url: string;
  images?: string[];
  initialIndex?: number;
  onClose: () => void;

  onDownload?: (activeUrl: string) => void;

  onShare?: (activeUrl: string) => void;
}) {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const { width: winW } = useWindowDimensions();
  const shadeOpacity = useRef(new Animated.Value(1)).current;
  const listRef = useRef<FlatList<string> | null>(null);

  const gallery = useMemo(() => {
    if (!url) return [];
    if (images && images.length > 0) {
      if (images[initialIndex] === url || images.includes(url)) return images;
      return [url, ...images];
    }
    return [url];
  }, [url, images, initialIndex]);

  const startIndex = useMemo(() => {
    if (!gallery.length) return 0;
    if (gallery[initialIndex] === url) return initialIndex;
    const found = gallery.indexOf(url);
    return found >= 0 ? found : 0;
  }, [gallery, initialIndex, url]);

  const [activeIndex, setActiveIndex] = useState(startIndex);
  const [isZoomed, setIsZoomed] = useState(false);

  useEffect(() => {
    if (!gallery.length) return;
    shadeOpacity.setValue(1);
    setActiveIndex(startIndex);
    setIsZoomed(false);
    if (gallery.length > 1) {
      requestAnimationFrame(() => {
        try {
          listRef.current?.scrollToIndex({ index: startIndex, animated: false });
        } catch {}
      });
    }
  }, [gallery.length, startIndex, url, shadeOpacity]);

  const activeUrl = gallery[activeIndex] || url;

  const handleMomentumEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (!winW) return;
      const idx = Math.round(e.nativeEvent.contentOffset.x / winW);
      if (idx >= 0 && idx < gallery.length) {
        setActiveIndex(idx);
        setIsZoomed(false);
      }
    },
    [winW, gallery.length],
  );

  const getItemLayout = useCallback(
    (_data: ArrayLike<string> | null | undefined, index: number) => ({
      length: winW,
      offset: winW * index,
      index,
    }),
    [winW],
  );

  const isMulti = gallery.length > 1;

  return (
    <Modal visible={gallery.length > 0} transparent animationType="fade" onRequestClose={onClose}>
      <Animated.View style={[styles.shade, { opacity: shadeOpacity }]}>
        {isMulti ? (
          <View style={[styles.counterPill, { top: insets.top + 16 }]} pointerEvents="none">
            <Text style={styles.counterText}>
              {activeIndex + 1} / {gallery.length}
            </Text>
          </View>
        ) : null}
        <TouchableOpacity
          style={[styles.close, { top: insets.top + 16 }]}
          onPress={onClose}
          activeOpacity={0.75}
          accessibilityRole="button"
          accessibilityLabel={t('关闭')}
        >
          <Text style={styles.closeText}>{t('关闭')}</Text>
        </TouchableOpacity>

        {isMulti ? (
          <FlatList
            ref={listRef}
            data={gallery}
            horizontal
            pagingEnabled
            scrollEnabled={!isZoomed}
            showsHorizontalScrollIndicator={false}
            keyExtractor={(item, idx) => `${idx}-${item}`}
            initialScrollIndex={startIndex}
            getItemLayout={getItemLayout}
            initialNumToRender={1}
            maxToRenderPerBatch={2}
            windowSize={3}
            onMomentumScrollEnd={handleMomentumEnd}
            onScrollToIndexFailed={() => undefined}
            renderItem={({ item }) => (
              <ZoomSlide
                uri={item}
                slideWidth={winW}
                isGallery
                shadeOpacity={shadeOpacity}
                onZoomChange={setIsZoomed}
                onClose={onClose}
              />
            )}
          />
        ) : gallery.length === 1 ? (
          <ZoomSlide
            uri={gallery[0]}
            isGallery={false}
            shadeOpacity={shadeOpacity}
            onZoomChange={setIsZoomed}
            onClose={onClose}
          />
        ) : null}

        <View
          style={[styles.actions, { bottom: Math.max(insets.bottom, 16) + 14 }]}
          pointerEvents="box-none"
        >
          {onDownload ? (
            <TouchableOpacity
              style={styles.actionBtn}
              onPress={() => onDownload(activeUrl)}
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
              onPress={() => onShare(activeUrl)}
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
  slideWrap: { flex: 1, height: '100%' },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  fillPress: { width: '100%', height: '100%' },
  counterPill: {
    position: 'absolute',
    left: 18,
    zIndex: 2,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radii.pill,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  counterText: {
    color: '#fff',
    fontSize: 13,
    fontFamily: fontFamily.system,
    fontWeight: '700',
  },
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

  hintWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  hintText: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 13,
    fontFamily: fontFamily.system,
    fontWeight: '600',
  },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radii.pill,
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  retryText: { color: '#fff', fontSize: 13, fontFamily: fontFamily.system, fontWeight: '700' },

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
