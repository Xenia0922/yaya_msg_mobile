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
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AppToast from './AppToast';
import { NetworkImage } from './NetworkImage';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { useI18n } from '../i18n';
import { radii, fontFamily } from '../theme';
import { motion } from '../theme/motion';
import { logWarn } from '../utils/runtimeLog';

const DOUBLE_TAP_ZOOM = 2.4;
const THUMB_SIZE = 38;
const THUMB_GAP = 8;
const THUMB_STRIDE = THUMB_SIZE + THUMB_GAP;
const THUMB_PADDING_H = 18;

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

const ZoomSlide = React.memo(function ZoomSlide({
  uri,
  slideWidth,
  isGallery,
  isActive,
  resetZoomSeq,
  shadeOpacity,
  chromeOpacity,
  chromeVisible,
  onZoomChange,
  onToggleChrome,
  onClose,
}: {
  uri: string;
  slideWidth?: number;
  isGallery: boolean;
  isActive: boolean;
  resetZoomSeq: number;
  shadeOpacity: Animated.Value;
  chromeOpacity: Animated.Value;
  chromeVisible: boolean;
  onZoomChange: (zoomed: boolean) => void;
  onToggleChrome: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const scale = useRef(new Animated.Value(1)).current;
  const translateX = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(0)).current;
  const dragY = useRef(new Animated.Value(0)).current;
  const dragScale = useRef(new Animated.Value(1)).current;

  const scaleValue = useRef(1);
  const translateXValue = useRef(0);
  const translateYValue = useRef(0);
  const dragYValue = useRef(0);
  const startScale = useRef(1);
  const startDistance = useRef(0);
  const startOffset = useRef({ x: 0, y: 0 });
  const tapStart = useRef({ t: 0, moved: false });
  const lastTapAt = useRef(0);
  const singleTapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [loadingImg, setLoadingImg] = useState(true);
  const [failed, setFailed] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  const failedRef = useRef(false);
  failedRef.current = failed;
  const chromeVisibleRef = useRef(chromeVisible);
  chromeVisibleRef.current = chromeVisible;
  const isActiveRef = useRef(isActive);
  isActiveRef.current = isActive;

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const onZoomChangeRef = useRef(onZoomChange);
  onZoomChangeRef.current = onZoomChange;
  const onToggleChromeRef = useRef(onToggleChrome);
  onToggleChromeRef.current = onToggleChrome;

  const clearPendingTap = useCallback(() => {
    if (singleTapTimerRef.current) {
      clearTimeout(singleTapTimerRef.current);
      singleTapTimerRef.current = null;
    }
  }, []);

  useEffect(() => () => clearPendingTap(), [clearPendingTap]);

  useEffect(() => {
    clearPendingTap();
    lastTapAt.current = 0;
    setLoadingImg(!!uri);
    setFailed(false);
    setRetryKey(0);
    scale.setValue(1);
    translateX.setValue(0);
    translateY.setValue(0);
    dragY.setValue(0);
    dragScale.setValue(1);
    scaleValue.current = 1;
    translateXValue.current = 0;
    translateYValue.current = 0;
    dragYValue.current = 0;
    if (isActiveRef.current) onZoomChangeRef.current(false);
  }, [uri, scale, translateX, translateY, dragY, dragScale, clearPendingTap]);

  const springResetTransform = useCallback(() => {
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
  }, [scale, translateX, translateY]);

  useEffect(() => {
    if (resetZoomSeq > 0 && isActive) {
      springResetTransform();
    }
  }, [resetZoomSeq, isActive, springResetTransform]);

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
      dragY.addListener(({ value }) => {
        dragYValue.current = value;
      }),
    ];
    return () => {
      scale.removeListener(ids[0]);
      translateX.removeListener(ids[1]);
      translateY.removeListener(ids[2]);
      dragY.removeListener(ids[3]);
    };
  }, [scale, translateX, translateY, dragY]);

  const handleTap = useCallback(() => {
    const currentScale = scaleValue.current || 1;
    const now = Date.now();
    if (now - lastTapAt.current < 280) {
      clearPendingTap();
      lastTapAt.current = 0;
      if (currentScale <= 1.02) {
        Animated.spring(scale, {
          toValue: DOUBLE_TAP_ZOOM,
          ...motion.spring.bouncy,
          useNativeDriver: true,
        }).start();
        scaleValue.current = DOUBLE_TAP_ZOOM;
        onZoomChangeRef.current(true);
      } else {
        springResetTransform();
      }
      return;
    }
    lastTapAt.current = now;
    clearPendingTap();
    singleTapTimerRef.current = setTimeout(() => {
      singleTapTimerRef.current = null;
      if (!failedRef.current) {
        onToggleChromeRef.current();
      }
    }, 260);
  }, [scale, clearPendingTap, springResetTransform]);

  const restoreDrag = useCallback(() => {
    Animated.parallel([
      Animated.spring(shadeOpacity, {
        toValue: 1,
        ...motion.spring.bouncy,
        useNativeDriver: true,
      }),
      Animated.spring(dragY, {
        toValue: 0,
        ...motion.spring.bouncy,
        useNativeDriver: true,
      }),
      Animated.spring(dragScale, {
        toValue: 1,
        ...motion.spring.bouncy,
        useNativeDriver: true,
      }),
      Animated.timing(chromeOpacity, {
        toValue: chromeVisibleRef.current ? 1 : 0,
        duration: 140,
        useNativeDriver: true,
      }),
    ]).start();
    dragYValue.current = 0;
  }, [shadeOpacity, dragY, dragScale, chromeOpacity]);

  const finishGesture = useCallback(() => {
    const currentScale = scaleValue.current || 1;
    startDistance.current = 0;
    onZoomChangeRef.current(currentScale > 1.02);

    const dyNow = dragYValue.current || 0;
    if (currentScale <= 1.02 && dyNow > 140) {
      clearPendingTap();
      Animated.parallel([
        Animated.timing(shadeOpacity, {
          toValue: 0,
          duration: 150,
          useNativeDriver: true,
        }),
        Animated.timing(dragY, {
          toValue: dyNow + 220,
          duration: 150,
          useNativeDriver: true,
        }),
        Animated.timing(chromeOpacity, {
          toValue: 0,
          duration: 100,
          useNativeDriver: true,
        }),
      ]).start(() => {
        onCloseRef.current();
        requestAnimationFrame(() => {
          dragY.setValue(0);
          dragScale.setValue(1);
          translateY.setValue(0);
          translateX.setValue(0);
          scale.setValue(1);
          dragYValue.current = 0;
          translateXValue.current = 0;
          translateYValue.current = 0;
          scaleValue.current = 1;
          shadeOpacity.setValue(1);
          onZoomChangeRef.current(false);
        });
      });
      return;
    }

    restoreDrag();
    if (currentScale <= 1.02 && (translateXValue.current !== 0 || translateYValue.current !== 0)) {
      springResetTransform();
    }
  }, [
    shadeOpacity,
    chromeOpacity,
    dragY,
    dragScale,
    translateY,
    translateX,
    scale,
    clearPendingTap,
    restoreDrag,
    springResetTransform,
  ]);

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: (event) =>
          !isGallery || event.nativeEvent.touches.length >= 2,
        onStartShouldSetPanResponderCapture: () => false,
        onMoveShouldSetPanResponder: (event, g) =>
          event.nativeEvent.touches.length >= 2 ||
          (scaleValue.current > 1.02 && (Math.abs(g.dx) > 4 || Math.abs(g.dy) > 4)) ||
          (!isGallery && (Math.abs(g.dx) > 4 || Math.abs(g.dy) > 4)) ||
          (g.dy > 10 && Math.abs(g.dy) > Math.abs(g.dx) * 1.2),
        onMoveShouldSetPanResponderCapture: (event, g) =>
          event.nativeEvent.touches.length >= 2 ||
          (scaleValue.current > 1.02 && (Math.abs(g.dx) > 4 || Math.abs(g.dy) > 4)) ||
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
            clearPendingTap();
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
          if (currentScale > 1.02) {
            const nx = startOffset.current.x + gesture.dx;
            const ny = startOffset.current.y + gesture.dy;
            translateX.setValue(nx);
            translateY.setValue(ny);
            translateXValue.current = nx;
            translateYValue.current = ny;
            return;
          }

          if (gesture.dy > 0) {
            dragY.setValue(gesture.dy);
            dragYValue.current = gesture.dy;
            dragScale.setValue(clamp(1 - gesture.dy / 900, 0.78, 1));
            shadeOpacity.setValue(clamp(1 - gesture.dy / 360, 0.25, 1));
            if (chromeVisibleRef.current) {
              chromeOpacity.setValue(clamp(1 - gesture.dy / 140, 0, 1));
            }
          }
        },
        onPanResponderRelease: () => {
          const start = tapStart.current;
          if (!start.moved && Date.now() - start.t < 260) {
            startDistance.current = 0;
            handleTap();
            return;
          }
          finishGesture();
        },
        onPanResponderTerminate: () => {
          finishGesture();
        },
      }),
    [
      isGallery,
      scale,
      translateX,
      translateY,
      dragY,
      dragScale,
      shadeOpacity,
      chromeOpacity,
      clearPendingTap,
      handleTap,
      finishGesture,
    ],
  );

  return (
    <View style={[styles.slideWrap, slideWidth ? { width: slideWidth } : undefined]}>
      <View style={[styles.stage, isGallery && styles.stageGalleryGap]} {...responder.panHandlers}>
        <Pressable onPress={handleTap} style={styles.fillPress}>
          <Animated.View
            style={[
              styles.dragLayer,
              {
                transform: [{ translateY: dragY }, { scale: dragScale }],
              },
            ]}
          >
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
          </Animated.View>
        </Pressable>
        {loadingImg ? (
          <View style={styles.hintWrap} pointerEvents="none">
            <ActivityIndicator color="rgba(255,255,255,0.88)" size="large" />
          </View>
        ) : null}
      </View>

      {failed ? (
        <View style={styles.hintWrap} pointerEvents="box-none">
          <MaterialCommunityIcons
            name="image-broken-variant"
            size={36}
            color="rgba(255,255,255,0.55)"
          />
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
});

const ThumbStripItem = React.memo(function ThumbStripItem({
  uri,
  index,
  active,
  onSelect,
}: {
  uri: string;
  index: number;
  active: boolean;
  onSelect: (index: number) => void;
}) {
  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={() => onSelect(index)}
      style={[styles.thumbItem, active ? styles.thumbItemActive : styles.thumbItemIdle]}
    >
      <NetworkImage
        source={{ uri }}
        resizeMode="cover"
        thumbnail={120}
        style={styles.thumbImg}
        fallback={false}
      />
    </TouchableOpacity>
  );
});

function ZoomImageModal({
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
  onDownload?: (activeUrl: string) => void | Promise<unknown>;
  onShare?: (activeUrl: string) => void;
}) {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const { width: winW } = useWindowDimensions();
  const shadeOpacity = useRef(new Animated.Value(1)).current;
  const chromeOpacity = useRef(new Animated.Value(1)).current;
  const listRef = useRef<FlatList<string> | null>(null);
  const thumbListRef = useRef<FlatList<string> | null>(null);
  const thumbViewportWRef = useRef(0);
  const winWRef = useRef(winW);
  winWRef.current = winW;

  const gallery = useMemo(() => {
    if (!url) return [];
    if (images && images.length > 0) {
      if (images[initialIndex] === url || images.includes(url)) return images;
      return [url, ...images];
    }
    return [url];
  }, [url, images, initialIndex]);

  const galleryLenRef = useRef(gallery.length);
  galleryLenRef.current = gallery.length;

  const startIndex = useMemo(() => {
    if (!gallery.length) return 0;
    if (gallery[initialIndex] === url) return initialIndex;
    const found = gallery.indexOf(url);
    return found >= 0 ? found : 0;
  }, [gallery, initialIndex, url]);

  const [activeIndex, setActiveIndex] = useState(startIndex);
  const [isZoomed, setIsZoomed] = useState(false);
  const [chromeVisible, setChromeVisible] = useState(true);
  const [resetZoomSeq, setResetZoomSeq] = useState(0);
  const [downloadingUrl, setDownloadingUrl] = useState('');
  const [downloadedUrl, setDownloadedUrl] = useState('');

  const activeIndexRef = useRef(startIndex);
  activeIndexRef.current = activeIndex;
  const programmaticTargetRef = useRef<number | null>(null);
  const programmaticTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const downloadedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearProgrammaticTarget = useCallback(() => {
    programmaticTargetRef.current = null;
    if (programmaticTimerRef.current) {
      clearTimeout(programmaticTimerRef.current);
      programmaticTimerRef.current = null;
    }
  }, []);

  useEffect(
    () => () => {
      clearProgrammaticTarget();
      if (downloadedTimerRef.current) {
        clearTimeout(downloadedTimerRef.current);
        downloadedTimerRef.current = null;
      }
    },
    [clearProgrammaticTarget],
  );

  const syncThumbToIndex = useCallback((idx: number, animated: boolean) => {
    const count = galleryLenRef.current;
    if (count <= 1) return;
    const viewportW = thumbViewportWRef.current || winWRef.current || 0;
    if (viewportW <= 0) return;
    const totalW = THUMB_PADDING_H * 2 + count * THUMB_STRIDE;
    const maxOffset = Math.max(0, totalW - viewportW);
    if (maxOffset <= 0) return;
    const centerX = THUMB_PADDING_H + clamp(idx, 0, count - 1) * THUMB_STRIDE + THUMB_STRIDE / 2;
    const targetOffset = clamp(centerX - viewportW / 2, 0, maxOffset);
    try {
      thumbListRef.current?.scrollToOffset({ offset: targetOffset, animated });
    } catch {}
  }, []);

  useEffect(() => {
    clearProgrammaticTarget();
    if (!gallery.length) {
      setDownloadingUrl('');
      setDownloadedUrl('');
      if (downloadedTimerRef.current) {
        clearTimeout(downloadedTimerRef.current);
        downloadedTimerRef.current = null;
      }
      return;
    }
    shadeOpacity.setValue(1);
    chromeOpacity.setValue(1);
    setChromeVisible(true);
    setActiveIndex(startIndex);
    activeIndexRef.current = startIndex;
    setIsZoomed(false);
    setResetZoomSeq(0);
    setDownloadingUrl('');
    setDownloadedUrl('');
    if (gallery.length > 1) {
      requestAnimationFrame(() => {
        if (winWRef.current > 0) {
          try {
            listRef.current?.scrollToOffset({
              offset: startIndex * winWRef.current,
              animated: false,
            });
          } catch {}
        }
        syncThumbToIndex(startIndex, false);
      });
    }
  }, [
    gallery.length,
    startIndex,
    url,
    shadeOpacity,
    chromeOpacity,
    syncThumbToIndex,
    clearProgrammaticTarget,
  ]);

  const toggleChrome = useCallback(() => {
    setChromeVisible((prev) => {
      const next = !prev;
      Animated.timing(chromeOpacity, {
        toValue: next ? 1 : 0,
        duration: 160,
        useNativeDriver: true,
      }).start();
      return next;
    });
  }, [chromeOpacity]);

  const activeUrl = gallery[activeIndex] || url;

  const handleScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (!winW || gallery.length <= 1) return;
      const idx = clamp(Math.round(e.nativeEvent.contentOffset.x / winW), 0, gallery.length - 1);
      if (programmaticTargetRef.current !== null) {
        if (idx === programmaticTargetRef.current) {
          clearProgrammaticTarget();
        }
        return;
      }
      if (idx !== activeIndexRef.current) {
        activeIndexRef.current = idx;
        setActiveIndex(idx);
        syncThumbToIndex(idx, true);
      }
    },
    [winW, gallery.length, syncThumbToIndex, clearProgrammaticTarget],
  );

  const handleMomentumEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      clearProgrammaticTarget();
      if (!winW) return;
      const idx = clamp(Math.round(e.nativeEvent.contentOffset.x / winW), 0, gallery.length - 1);
      if (idx !== activeIndexRef.current) {
        activeIndexRef.current = idx;
        setActiveIndex(idx);
        syncThumbToIndex(idx, true);
      }
      setIsZoomed(false);
    },
    [winW, gallery.length, syncThumbToIndex, clearProgrammaticTarget],
  );

  const handleSelectThumb = useCallback(
    (index: number) => {
      if (index === activeIndexRef.current) return;
      const prevIdx = activeIndexRef.current;
      clearProgrammaticTarget();
      setIsZoomed(false);
      activeIndexRef.current = index;
      setActiveIndex(index);
      const smooth = Math.abs(index - prevIdx) === 1;
      if (winW > 0) {
        programmaticTargetRef.current = index;
        programmaticTimerRef.current = setTimeout(() => {
          programmaticTargetRef.current = null;
          programmaticTimerRef.current = null;
        }, 420);
        try {
          listRef.current?.scrollToOffset({ offset: index * winW, animated: smooth });
        } catch {}
      }
      syncThumbToIndex(index, true);
    },
    [winW, syncThumbToIndex, clearProgrammaticTarget],
  );

  const handleDownloadPress = useCallback(async () => {
    if (!onDownload || !activeUrl || downloadingUrl === activeUrl) return;
    const targetUrl = activeUrl;
    const ret = onDownload(targetUrl);
    if (ret && typeof (ret as Promise<unknown>).then === 'function') {
      setDownloadingUrl(targetUrl);
      setDownloadedUrl('');
      try {
        await ret;
        setDownloadedUrl(targetUrl);
        if (downloadedTimerRef.current) clearTimeout(downloadedTimerRef.current);
        downloadedTimerRef.current = setTimeout(() => {
          downloadedTimerRef.current = null;
          setDownloadedUrl((prev) => (prev === targetUrl ? '' : prev));
        }, 1600);
      } catch {
      } finally {
        setDownloadingUrl((prev) => (prev === targetUrl ? '' : prev));
      }
    }
  }, [onDownload, activeUrl, downloadingUrl]);

  const getItemLayout = useCallback(
    (_data: ArrayLike<string> | null | undefined, index: number) => ({
      length: winW,
      offset: winW * index,
      index,
    }),
    [winW],
  );

  const getThumbLayout = useCallback(
    (_data: ArrayLike<string> | null | undefined, index: number) => ({
      length: THUMB_STRIDE,
      offset: THUMB_STRIDE * index,
      index,
    }),
    [],
  );

  const isMulti = gallery.length > 1;
  const hasActions = Boolean(onDownload || onShare);
  const isDownloadingActive = Boolean(activeUrl && downloadingUrl === activeUrl);
  const isDownloadedActive = Boolean(activeUrl && downloadedUrl === activeUrl);

  return (
    <Modal
      visible={gallery.length > 0}
      transparent
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.modalRoot}>
        <Animated.View style={[styles.shade, { opacity: shadeOpacity }]}>
          {gallery.length > 0 ? <StatusBar style="light" /> : null}
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
              initialNumToRender={3}
              maxToRenderPerBatch={3}
              windowSize={5}
              scrollEventThrottle={32}
              onScrollBeginDrag={clearProgrammaticTarget}
              onScroll={handleScroll}
              onMomentumScrollEnd={handleMomentumEnd}
              onScrollToIndexFailed={() => undefined}
              renderItem={({ item, index }) => (
                <ZoomSlide
                  uri={item}
                  slideWidth={winW}
                  isGallery
                  isActive={index === activeIndex}
                  resetZoomSeq={resetZoomSeq}
                  shadeOpacity={shadeOpacity}
                  chromeOpacity={chromeOpacity}
                  chromeVisible={chromeVisible}
                  onZoomChange={setIsZoomed}
                  onToggleChrome={toggleChrome}
                  onClose={onClose}
                />
              )}
            />
          ) : gallery.length === 1 ? (
            <ZoomSlide
              uri={gallery[0]}
              isGallery={false}
              isActive
              resetZoomSeq={resetZoomSeq}
              shadeOpacity={shadeOpacity}
              chromeOpacity={chromeOpacity}
              chromeVisible={chromeVisible}
              onZoomChange={setIsZoomed}
              onToggleChrome={toggleChrome}
              onClose={onClose}
            />
          ) : null}

          <Animated.View
            pointerEvents="none"
            style={[styles.topGrad, { height: insets.top + 84, opacity: chromeOpacity }]}
          >
            <LinearGradient
              colors={['rgba(0,0,0,0.62)', 'rgba(0,0,0,0)']}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>

          <Animated.View
            pointerEvents="none"
            style={[
              styles.bottomGrad,
              {
                height: (isMulti ? 156 : 108) + Math.max(insets.bottom, 16),
                opacity: chromeOpacity,
              },
            ]}
          >
            <LinearGradient
              colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.74)']}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>

          <Animated.View
            style={[styles.topBar, { top: insets.top + 10, opacity: chromeOpacity }]}
            pointerEvents={chromeVisible ? 'box-none' : 'none'}
          >
            <TouchableOpacity
              style={styles.iconCircleBtn}
              onPress={onClose}
              activeOpacity={0.78}
              accessibilityRole="button"
              accessibilityLabel={t('关闭')}
            >
              <MaterialCommunityIcons name="close" size={20} color="#fff" />
            </TouchableOpacity>

            {isMulti ? (
              <View style={styles.counterPill} pointerEvents="none">
                <Text style={styles.counterText}>
                  {activeIndex + 1} / {gallery.length}
                </Text>
              </View>
            ) : (
              <View />
            )}

            {isZoomed ? (
              <TouchableOpacity
                style={styles.resetZoomPill}
                onPress={() => setResetZoomSeq((k) => k + 1)}
                activeOpacity={0.78}
                accessibilityRole="button"
                accessibilityLabel={t('还原')}
              >
                <MaterialCommunityIcons name="magnify-minus-outline" size={16} color="#fff" />
                <Text style={styles.resetZoomText}>1×</Text>
              </TouchableOpacity>
            ) : (
              <View style={styles.topBarPlaceholder} />
            )}
          </Animated.View>

          {isMulti || hasActions ? (
            <Animated.View
              style={[
                styles.bottomArea,
                { bottom: Math.max(insets.bottom, 16) + 12, opacity: chromeOpacity },
              ]}
              pointerEvents={chromeVisible ? 'box-none' : 'none'}
            >
              {isMulti ? (
                <FlatList
                  ref={thumbListRef}
                  data={gallery}
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  keyExtractor={(item, idx) => `thumb-${idx}-${item}`}
                  getItemLayout={getThumbLayout}
                  onLayout={(e) => {
                    thumbViewportWRef.current = e.nativeEvent.layout.width;
                  }}
                  onScrollToIndexFailed={() => undefined}
                  contentContainerStyle={styles.thumbStripContent}
                  style={styles.thumbStripList}
                  renderItem={({ item, index }) => (
                    <ThumbStripItem
                      uri={item}
                      index={index}
                      active={index === activeIndex}
                      onSelect={handleSelectThumb}
                    />
                  )}
                />
              ) : null}

              {hasActions ? (
                <View style={styles.dockOuter}>
                  {onDownload ? (
                    <TouchableOpacity
                      style={styles.dockBtn}
                      onPress={() => void handleDownloadPress()}
                      disabled={isDownloadingActive}
                      activeOpacity={0.78}
                      accessibilityRole="button"
                      accessibilityLabel={
                        isDownloadedActive
                          ? t('下载完成')
                          : isDownloadingActive
                            ? t('下载中')
                            : t('下载')
                      }
                    >
                      {isDownloadingActive ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <MaterialCommunityIcons
                          name={isDownloadedActive ? 'check' : 'download-outline'}
                          size={19}
                          color={isDownloadedActive ? '#34C759' : '#fff'}
                        />
                      )}
                      <Text
                        style={[
                          styles.dockBtnText,
                          isDownloadedActive ? { color: '#34C759' } : undefined,
                        ]}
                      >
                        {isDownloadedActive
                          ? t('下载完成')
                          : isDownloadingActive
                            ? t('下载中')
                            : t('下载')}
                      </Text>
                    </TouchableOpacity>
                  ) : null}
                  {onDownload && onShare ? <View style={styles.dockDivider} /> : null}
                  {onShare ? (
                    <TouchableOpacity
                      style={styles.dockBtn}
                      onPress={() => onShare(activeUrl)}
                      activeOpacity={0.78}
                      accessibilityRole="button"
                      accessibilityLabel={t('分享')}
                    >
                      <MaterialCommunityIcons name="share-variant-outline" size={18} color="#fff" />
                      <Text style={styles.dockBtnText}>{t('分享')}</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              ) : null}
            </Animated.View>
          ) : null}
        </Animated.View>
        {gallery.length > 0 ? <AppToast passive /> : null}
      </View>
    </Modal>
  );
}

export default React.memo(ZoomImageModal);

const styles = StyleSheet.create({
  modalRoot: { flex: 1 },
  shade: { flex: 1, backgroundColor: '#000000' },
  slideWrap: { flex: 1, height: '100%' },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  stageGalleryGap: { paddingHorizontal: 6 },
  fillPress: { width: '100%', height: '100%' },
  dragLayer: { width: '100%', height: '100%' },
  image: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' },
  fill: { width: '100%', height: '100%' },

  topGrad: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 1 },
  bottomGrad: { position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 1 },

  topBar: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 3,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  topBarPlaceholder: { width: 38, height: 38 },
  iconCircleBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(26,27,34,0.74)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  counterPill: {
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: radii.pill,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(26,27,34,0.74)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.16)',
  },
  counterText: {
    color: '#fff',
    fontSize: 13,
    fontFamily: fontFamily.system,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    includeFontPadding: false,
  },
  resetZoomPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 34,
    paddingHorizontal: 10,
    borderRadius: 17,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(26,27,34,0.78)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  resetZoomText: {
    color: '#fff',
    fontSize: 12,
    fontFamily: fontFamily.system,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    includeFontPadding: false,
  },

  hintWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  hintText: {
    color: 'rgba(255,255,255,0.78)',
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
    borderCurve: 'continuous',
    backgroundColor: 'rgba(26,27,34,0.78)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.28)',
  },
  retryText: { color: '#fff', fontSize: 13, fontFamily: fontFamily.system, fontWeight: '700' },

  bottomArea: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 3,
    alignItems: 'center',
    gap: 12,
  },
  thumbStripList: { maxHeight: 46, maxWidth: '100%', flexGrow: 0 },
  thumbStripContent: { paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center' },
  thumbItem: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    marginHorizontal: THUMB_GAP / 2,
    borderRadius: 9,
    borderCurve: 'continuous',
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  thumbItemActive: {
    borderWidth: 2,
    borderColor: '#fff',
    opacity: 1,
    transform: [{ scale: 1.06 }],
  },
  thumbItemIdle: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.22)',
    opacity: 0.52,
  },
  thumbImg: { width: '100%', height: '100%' },

  dockOuter: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 24,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(26,27,34,0.8)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.18)',
    overflow: 'hidden',
  },
  dockBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 18,
    paddingVertical: 11,
  },
  dockBtnText: {
    color: '#fff',
    fontSize: 13,
    fontFamily: fontFamily.system,
    fontWeight: '700',
    includeFontPadding: false,
  },
  dockDivider: {
    width: StyleSheet.hairlineWidth,
    height: 18,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
});
