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
import { usePalette, motion, makeShadows } from '../theme';
import { useSafeAreaInsets } from '../hooks/useSafeAreaInsets';
import { typography } from '../theme/typography';
import { normalizeImageHost } from '../utils/imageThumb';
import { MusicEngine } from '../services/musicPlayer';
import CoverArt from './CoverArt';
import { useI18n } from '../i18n';
import { formatTrackSubtitle } from '../utils/format';
import { useVinylSpin } from '../hooks/useVinylSpin';
import { GlassSurface } from '../components/GlassSurface';

interface Props {
  onOpenFullScreen?: () => void;
}

export default React.memo(function MiniPlayerBar({ onOpenFullScreen }: Props) {
  const palette = usePalette();
  const shadows = makeShadows(palette.name === 'dark');
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const currentIndex = useMusicPlayerStore((s) => s.currentIndex);
  const queue = useMusicPlayerStore((s) => s.queue);
  const playbackState = useMusicPlayerStore((s) => s.playbackState);
  const playMode = useMusicPlayerStore((s) => s.playMode);
  const duration = useMusicPlayerStore((s) => s.duration);
  const position = useMusicPlayerStore((s) => s.position);

  const track = queue[currentIndex] || null;
  const isLoading = playbackState === 'loading';
  const isError = playbackState === 'error';

  const showPause = playbackState === 'playing' || isLoading;
  const progress = duration > 0 ? Math.min(1, Math.max(0, position / duration)) : 0;

  const scaleAnim = useRef(new Animated.Value(1)).current;
  const displayPos = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(displayPos, {
      toValue: progress,
      duration: 180,
      easing: Easing.inOut(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [progress, displayPos]);

  const trackSpinKey = String(track?.musicId || track?.id || track?.title || '') || undefined;
  const spinValue = useVinylSpin(trackSpinKey, playbackState === 'playing');
  const spin = spinValue.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  const onOpenFullScreenRef = useRef(onOpenFullScreen);
  onOpenFullScreenRef.current = onOpenFullScreen;

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gs) =>
        gs.dy < -16 && Math.abs(gs.dy) > Math.abs(gs.dx) * 1.4,
      onPanResponderRelease: (_, gs) => {
        if (gs.dy < -24) onOpenFullScreenRef.current?.();
      },
    }),
  ).current;

  const pressIn = useCallback(
    () =>
      Animated.spring(scaleAnim, {
        toValue: 0.94,
        ...motion.spring.bouncy,
        useNativeDriver: true,
      }).start(),
    [scaleAnim],
  );
  const pressOut = useCallback(
    () =>
      Animated.spring(scaleAnim, {
        toValue: 1,
        ...motion.spring.bouncy,
        useNativeDriver: true,
      }).start(),
    [scaleAnim],
  );

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
    try {
      MusicEngine.prev();
    } catch {}
  }, []);
  const handleNext = useCallback(() => {
    try {
      MusicEngine.next();
    } catch {}
  }, []);
  const handleMode = useCallback(() => {
    try {
      MusicEngine.cycleMode();
    } catch {}
  }, []);

  if (!track || playbackState === 'idle') return null;

  return (
    <GlassSurface
      radius={26}
      role="bar"
      tintColor={palette.name === 'dark' ? 'rgba(26,26,32,0.74)' : 'rgba(255,255,255,0.72)'}
      style={[
        styles.bar,
        shadows.md,
        {
          backgroundColor: 'transparent',
          borderColor: palette.innerStroke,
          bottom: Math.max(10, insets.bottom - 32),
          elevation: 4,
        },
      ]}
      {...panResponder.panHandlers}
    >
      <Pressable onPress={onOpenFullScreen} style={styles.row}>
        <Animated.View style={[styles.cover, { transform: [{ rotate: spin }] }]}>
          <CoverArt
            key={coverUri || track.title || '♪'}
            uri={coverUri || undefined}
            title={track.title || '♪'}
            size={42}
            round
          />
        </Animated.View>
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
              { color: palette.labelTertiary, lineHeight: 14, marginTop: 1 },
            ]}
          >
            {formatTrackSubtitle(track) || t('官方音乐')}
          </Text>
        </View>
        <View style={styles.actions}>
          <Pressable
            onPress={handleMode}
            onPressIn={pressIn}
            onPressOut={pressOut}
            style={styles.modeBtn}
          >
            <Icon
              name={
                playMode === 'single'
                  ? 'repeat-once'
                  : playMode === 'random'
                    ? 'shuffle-variant'
                    : 'repeat'
              }
              size={18}
              color={palette.labelSecondary}
            />
          </Pressable>
          <Pressable
            onPress={handlePrev}
            onPressIn={pressIn}
            onPressOut={pressOut}
            style={styles.smallCtrlBtn}
          >
            <Icon name="skip-previous" size={24} color={palette.label} />
          </Pressable>
          <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
            <Pressable
              onPress={handleToggle}
              onPressIn={pressIn}
              onPressOut={pressOut}
              style={styles.playBtn}
              accessibilityRole="button"
              accessibilityLabel={isLoading ? t('取消') : showPause ? t('暂停') : t('播放')}
            >
              {isLoading ? (
                <ActivityIndicator size="small" color={palette.tint} />
              ) : (
                <Icon
                  name={isError ? 'refresh-circle' : showPause ? 'pause-circle' : 'play-circle'}
                  size={34}
                  color={isError ? palette.danger : palette.tint}
                />
              )}
            </Pressable>
          </Animated.View>
          <Pressable
            onPress={handleNext}
            onPressIn={pressIn}
            onPressOut={pressOut}
            style={styles.smallCtrlBtn}
          >
            <Icon name="skip-next" size={24} color={palette.label} />
          </Pressable>
        </View>
      </Pressable>

      <View pointerEvents="none" style={[styles.progressTrack, { backgroundColor: palette.fill3 }]}>
        <Animated.View
          style={[
            styles.progressFill,
            {
              backgroundColor: palette.tint,
              transform: [{ scaleX: displayPos }],
              transformOrigin: 'left',
            },
          ]}
        />
      </View>
    </GlassSurface>
  );
});

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: 12,
    right: 12,
    borderRadius: 26,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    paddingTop: 9,
    paddingBottom: 10,
    paddingHorizontal: 10,
    overflow: 'hidden',
  },
  progressTrack: {
    position: 'absolute',
    left: 20,
    right: 20,
    bottom: 0,
    height: 2.5,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    ...StyleSheet.absoluteFillObject,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 2 },
  cover: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#1a1a1a',
    overflow: 'hidden',
  },
  info: { flex: 1, minWidth: 0 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  playBtn: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 19,
  },
  smallCtrlBtn: {
    width: 32,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
  },
  modeBtn: {
    width: 32,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
  },
});
