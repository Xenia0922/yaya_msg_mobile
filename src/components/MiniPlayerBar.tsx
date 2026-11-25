import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useMusicPlayerStore } from '../store/musicPlayerStore';
import { usePalette, makeShadows } from '../theme';
import { useSafeAreaInsets } from '../hooks/useSafeAreaInsets';
import { typography } from '../theme/typography';
import { normalizeImageHost } from '../utils/imageThumb';
import { MusicEngine } from '../services/musicPlayer';
import CoverArt from './CoverArt';
import { ScalePressable } from './Motion';
import { useI18n } from '../i18n';
import { formatTrackSubtitle } from '../utils/format';
import { GlassSurface } from '../components/GlassSurface';

const MiniProgressLine = React.memo(function MiniProgressLine({
  tintColor,
  trackColor,
  bufferColor,
}: {
  tintColor: string;
  trackColor: string;
  bufferColor: string;
}) {
  const duration = useMusicPlayerStore((s) => s.duration);
  const position = useMusicPlayerStore((s) => s.position);
  const buffered = useMusicPlayerStore((s) => s.buffered);

  const progress = duration > 0 ? Math.min(1, Math.max(0, position / duration)) : 0;
  const bufRatio = duration > 0 ? Math.min(1, Math.max(progress, buffered / duration)) : progress;

  const displayPos = useRef(new Animated.Value(progress)).current;
  useEffect(() => {
    Animated.timing(displayPos, {
      toValue: progress,
      duration: 180,
      easing: Easing.inOut(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [progress, displayPos]);

  return (
    <View pointerEvents="none" style={[styles.progressTrack, { backgroundColor: trackColor }]}>
      {bufRatio > 0 ? (
        <View
          style={[
            styles.progressBuffer,
            { backgroundColor: bufferColor, width: `${bufRatio * 100}%` as any },
          ]}
        />
      ) : null}
      <Animated.View
        style={[
          styles.progressFill,
          {
            backgroundColor: tintColor,
            transform: [{ scaleX: displayPos }],
            transformOrigin: 'left',
          },
        ]}
      />
    </View>
  );
});

interface Props {
  onOpenFullScreen?: () => void;
  bottomOffset?: number;
}

export default React.memo(function MiniPlayerBar({ onOpenFullScreen, bottomOffset }: Props) {
  const palette = usePalette();
  const shadows = makeShadows(palette.name === 'dark');
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const currentIndex = useMusicPlayerStore((s) => s.currentIndex);
  const queue = useMusicPlayerStore((s) => s.queue);
  const playbackState = useMusicPlayerStore((s) => s.playbackState);
  const buffering = useMusicPlayerStore((s) => s.buffering);

  const track = queue[currentIndex] || null;
  const isLoading = playbackState === 'loading' || (playbackState === 'playing' && buffering);
  const isError = playbackState === 'error';
  const showPause = playbackState === 'playing' || playbackState === 'loading';

  const onOpenFullScreenRef = useRef(onOpenFullScreen);
  onOpenFullScreenRef.current = onOpenFullScreen;

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gs) =>
        (gs.dy < -16 && Math.abs(gs.dy) > Math.abs(gs.dx) * 1.3) ||
        (Math.abs(gs.dx) > 22 && Math.abs(gs.dx) > Math.abs(gs.dy) * 1.4),
      onPanResponderRelease: (_, gs) => {
        if (gs.dy < -24 && Math.abs(gs.dy) > Math.abs(gs.dx)) {
          onOpenFullScreenRef.current?.();
        } else if (gs.dx < -44) {
          void MusicEngine.next().catch(() => {});
        } else if (gs.dx > 44) {
          void MusicEngine.prev().catch(() => {});
        }
      },
    }),
  ).current;

  const rawCover = (track?.coverUrl || track?.cover || track?.thumbPath || '') as string;
  const coverUri = useMemo(
    () =>
      rawCover
        ? rawCover.startsWith('http')
          ? normalizeImageHost(rawCover)
          : `https://source.48.cn${rawCover.startsWith('/') ? rawCover : '/' + rawCover}`
        : '',
    [rawCover],
  );

  const handleToggle = useCallback(() => {
    try {
      const curState = useMusicPlayerStore.getState().playbackState;
      if (curState === 'loading') {
        MusicEngine.stop();
        return;
      }
      if (curState === 'error') {
        void MusicEngine.resume();
        return;
      }
      MusicEngine.togglePause();
    } catch {}
  }, []);

  const handlePrev = useCallback(() => {
    void MusicEngine.prev().catch(() => {});
  }, []);
  const handleNext = useCallback(() => {
    void MusicEngine.next().catch(() => {});
  }, []);
  const handleClose = useCallback(() => {
    useMusicPlayerStore.getState().dismissMiniBar();
  }, []);

  if (!track || playbackState === 'idle') return null;

  const computedBottom =
    bottomOffset ?? Math.max(12, insets.bottom > 0 ? Math.min(insets.bottom, 28) + 6 : 12);

  return (
    <GlassSurface
      radius={22}
      role="bar"
      frostedOnly
      tintColor={palette.name === 'dark' ? 'rgba(26,26,34,0.95)' : 'rgba(255,255,255,0.95)'}
      style={[
        styles.bar,
        shadows.md,
        {
          backgroundColor: 'transparent',
          borderColor: palette.name === 'dark' ? 'rgba(255,255,255,0.14)' : 'rgba(18,22,36,0.09)',
          bottom: computedBottom,
          elevation: 10,
        },
      ]}
      {...panResponder.panHandlers}
    >
      <Pressable onPress={onOpenFullScreen} style={styles.row}>
        <View style={styles.cover}>
          <CoverArt
            uri={coverUri || undefined}
            title={track.title || '♪'}
            size={42}
            borderRadius={11}
            thumbnail={120}
          />
        </View>
        <View style={styles.info}>
          <Text
            numberOfLines={1}
            style={[
              typography.subhead,
              { color: palette.label, fontWeight: '700', lineHeight: 19 },
            ]}
          >
            {track.title || t('未知')}
          </Text>
          <Text
            numberOfLines={1}
            style={[
              typography.caption1,
              { color: palette.labelSecondary, lineHeight: 15, marginTop: 1 },
            ]}
          >
            {formatTrackSubtitle(track) || t('官方音乐')}
          </Text>
        </View>
        <View style={styles.actions}>
          <ScalePressable
            onPress={handlePrev}
            pressedScale={0.88}
            hitSlop={6}
            style={styles.smallCtrlBtn}
            accessibilityRole="button"
            accessibilityLabel={t('上一首')}
          >
            <Icon name="skip-previous" size={21} color={palette.label} />
          </ScalePressable>
          <ScalePressable
            onPress={handleToggle}
            pressedScale={0.9}
            hitSlop={4}
            style={[styles.playBtn, { backgroundColor: palette.tintSoft }]}
            accessibilityRole="button"
            accessibilityLabel={isLoading ? t('取消') : showPause ? t('暂停') : t('播放')}
          >
            {isLoading ? (
              <ActivityIndicator size="small" color={palette.tint} />
            ) : (
              <Icon
                name={isError ? 'refresh' : showPause ? 'pause' : 'play'}
                size={20}
                color={isError ? palette.danger : palette.tint}
              />
            )}
          </ScalePressable>
          <ScalePressable
            onPress={handleNext}
            pressedScale={0.88}
            hitSlop={6}
            style={styles.smallCtrlBtn}
            accessibilityRole="button"
            accessibilityLabel={t('下一首')}
          >
            <Icon name="skip-next" size={21} color={palette.label} />
          </ScalePressable>
          <View style={[styles.closeDivider, { backgroundColor: palette.separator }]} />
          <ScalePressable
            onPress={handleClose}
            pressedScale={0.86}
            hitSlop={8}
            style={styles.closeBtn}
            accessibilityRole="button"
            accessibilityLabel={t('隐藏播放栏')}
          >
            <Icon name="close" size={17} color={palette.labelTertiary} />
          </ScalePressable>
        </View>
      </Pressable>

      <MiniProgressLine
        tintColor={palette.tint}
        trackColor={palette.fill3}
        bufferColor={palette.name === 'dark' ? 'rgba(255,255,255,0.22)' : 'rgba(18,22,36,0.14)'}
      />
    </GlassSurface>
  );
});

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: 14,
    right: 14,
    borderRadius: 22,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    paddingTop: 8,
    paddingBottom: 10,
    paddingHorizontal: 10,
    overflow: 'hidden',
  },
  progressTrack: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 0,
    height: 2.5,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressBuffer: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
  },
  progressFill: {
    ...StyleSheet.absoluteFillObject,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 2 },
  cover: {
    width: 42,
    height: 42,
    borderRadius: 11,
    overflow: 'hidden',
  },
  info: { flex: 1, minWidth: 0 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  playBtn: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 17,
  },
  smallCtrlBtn: {
    width: 28,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
  },
  closeDivider: {
    width: StyleSheet.hairlineWidth,
    height: 16,
    marginHorizontal: 2,
  },
  closeBtn: {
    width: 24,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
  },
});
