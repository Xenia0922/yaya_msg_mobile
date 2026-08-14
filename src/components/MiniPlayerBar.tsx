/**
 * MiniPlayerBar · iOS 26 Liquid Glass 浮层
 *  - 玻璃感悬浮胶囊（顶部浮出 + 阴影）
 *  - 圆角 28，大封面旋转动画
 *  - 进度条可拖动
 *  - 上下手势：下滑隐藏、上滑复位
 *  - 弹簧按压反馈
 *  - 所有音乐控制逻辑（play/pause/next/mode/seek）保持原状
 */
import React, { useCallback, useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  GestureResponderEvent,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useMusicPlayerStore } from '../store/musicPlayerStore';
import { usePalette, motion } from '../theme';
import { typography } from '../theme/typography';
import { spacing } from '../theme/spacing';
import { isPlayableHost, MusicEngine } from '../services/musicPlayer';
import CoverArt from './CoverArt';
import { useI18n } from '../i18n';

interface Props {
  onOpenFullScreen?: () => void;
}

export default function MiniPlayerBar({ onOpenFullScreen }: Props) {
  const palette = usePalette();
  const { t } = useI18n();
  const currentIndex = useMusicPlayerStore((s) => s.currentIndex);
  const queue = useMusicPlayerStore((s) => s.queue);
  const playbackState = useMusicPlayerStore((s) => s.playbackState);
  const playMode = useMusicPlayerStore((s) => s.playMode);
  const duration = useMusicPlayerStore((s) => s.duration);
  const position = useMusicPlayerStore((s) => s.position);
  const playUrl = useMusicPlayerStore((s) => s.url);

  const track = queue[currentIndex] || null;
  const isPlaying = playbackState === 'playing';
  const progress = duration > 0 ? Math.min(1, Math.max(0, position / duration)) : 0;

  const progRef = useRef<View>(null);
  const translateY = useRef(new Animated.Value(0)).current;
  const rotationAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const seekProgress = (px: number) => {
    if (duration <= 0) return;
    progRef.current?.measure((_x, _y, w, _h, x0) => {
      if (!w || w < 2) return;
      const ratio = Math.max(0, Math.min(1, (px - x0) / w));
      useMusicPlayerStore.getState().setSeekTarget(ratio * duration);
    });
  };

  const progPanMini = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e: GestureResponderEvent) => seekProgress(e.nativeEvent.pageX),
      onPanResponderMove: (e: GestureResponderEvent) => seekProgress(e.nativeEvent.pageX),
    })
  ).current;

  useEffect(() => {
    if (!isPlaying) return;
    let cancelled = false;
    let current = (rotationAnim as any).__turns ?? 0;
    const step = () => {
      if (cancelled) return;
      const next = current + 1;
      Animated.timing(rotationAnim, {
        toValue: next, duration: 8000, easing: Easing.linear, useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished && !cancelled) {
          current = next;
          (rotationAnim as any).__turns = current;
          step();
        }
      });
    };
    step();
    return () => { cancelled = true; rotationAnim.stopAnimation(); };
  }, [isPlaying, track?.id, rotationAnim]);

  const spin = rotationAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gs) => Math.abs(gs.dy) > 8,
      onPanResponderMove: (_, gs) => { if (Math.abs(gs.dy) > 8) translateY.setValue(gs.dy); },
      onPanResponderRelease: (_, gs) => {
        if (gs.dy > 60) {
          Animated.timing(translateY, { toValue: 220, duration: motion.duration.fast, easing: Easing.inOut(Easing.ease), useNativeDriver: true }).start();
        } else {
          Animated.spring(translateY, { toValue: 0, ...motion.spring.bouncy, useNativeDriver: true }).start();
        }
      },
    })
  ).current;

  const pressIn = () => Animated.spring(scaleAnim, { toValue: 0.94, ...motion.spring.bouncy, useNativeDriver: true }).start();
  const pressOut = () => Animated.spring(scaleAnim, { toValue: 1, ...motion.spring.bouncy, useNativeDriver: true }).start();

  const rawCover = (track?.coverUrl || track?.cover || track?.thumbPath || '') as string;
  const coverUri = rawCover ? (rawCover.startsWith('http') ? rawCover : `https://source.48.cn${rawCover.startsWith('/') ? rawCover : '/' + rawCover}`) : '';

  const handleToggle = useCallback(() => {
    try {
      if (!isPlayableHost(playUrl)) return;
      MusicEngine.togglePause();
    } catch {}
  }, [playUrl]);

  const handleNext = useCallback(() => { try { MusicEngine.next(); } catch {} }, []);
  const handleMode = useCallback(() => { try { MusicEngine.cycleMode(); } catch {} }, []);

  if (!track || playbackState === 'idle' || !isPlayableHost(playUrl)) return null;

  return (
    <Animated.View
      style={[
        styles.bar,
        {
          backgroundColor: palette.surfaceGlassStrong,
          borderColor: palette.innerStroke,
          transform: [{ translateY }],
        },
      ]}
      {...panResponder.panHandlers}
    >
      <View ref={progRef} style={styles.progressBar} {...progPanMini.panHandlers}>
        <View style={[styles.progressTrack, { backgroundColor: palette.fill3 }]} />
        <View style={[styles.progressFill, { width: `${progress * 100}%`, backgroundColor: palette.tint }]} />
        <View
          style={[
            styles.progressThumb,
            { left: `${progress * 100}%`, backgroundColor: palette.tint, borderColor: palette.surfaceGlassStrong },
          ]}
        />
      </View>

      <Pressable onPress={onOpenFullScreen} style={styles.row}>
        <Animated.View style={[styles.cover, { transform: [{ rotate: spin }] }]}>
          <CoverArt uri={coverUri || undefined} title={track.title || '♪'} size={48} round />
        </Animated.View>
        <View style={styles.info}>
          <Text
            numberOfLines={1}
            style={[typography.subhead, { color: palette.label, fontWeight: '700', lineHeight: 20 }]}
          >
            {track.title || t('未知')}
          </Text>
          <Text
            numberOfLines={1}
            style={[typography.caption1, { color: palette.labelTertiary, lineHeight: 14, marginTop: 2 }]}
          >
            {[track.joinMemberNames, track.subTitle, track.albumName].filter(Boolean).join(' · ') || t('官方音乐')}
          </Text>
        </View>
        <View style={styles.actions}>
          <Pressable onPress={handleMode} onPressIn={pressIn} onPressOut={pressOut} style={styles.modeBtn}>
            <Icon
              name={playMode === 'single' ? 'repeat-once' : playMode === 'random' ? 'shuffle-variant' : 'repeat'}
              size={18}
              color={palette.labelSecondary}
            />
          </Pressable>
          <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
            <Pressable onPress={handleToggle} onPressIn={pressIn} onPressOut={pressOut} style={styles.playBtn}>
              <Icon name={isPlaying ? 'pause-circle' : 'play-circle'} size={36} color={palette.tint} />
            </Pressable>
          </Animated.View>
          <Pressable onPress={handleNext} onPressIn={pressIn} onPressOut={pressOut} style={styles.playBtn}>
            <Icon name="skip-next-circle" size={32} color={palette.tint} />
          </Pressable>
        </View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 96, // 浮在 TabBar 上方，给 iOS 26 Liquid Glass TabBar 留出空间
    borderRadius: 26,
    borderWidth: StyleSheet.hairlineWidth,
    paddingTop: 6,
    paddingBottom: 8,
    paddingHorizontal: 8,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 12,
  },
  progressBar: { height: 22, justifyContent: 'center', paddingHorizontal: 4 },
  progressTrack: { position: 'absolute', left: 4, right: 4, height: 3, borderRadius: 2 },
  progressFill: { position: 'absolute', left: 4, height: 3, borderRadius: 2 },
  progressThumb: {
    position: 'absolute', top: 9, width: 12, height: 12, borderRadius: 6,
    borderWidth: 2, transform: [{ translateX: -6 }],
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingLeft: 4, paddingRight: 4 },
  cover: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#1a1a1a', overflow: 'hidden' },
  info: { flex: 1, minWidth: 0 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  playBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20 },
  modeBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 18 },
});

// suppress unused (spacing) 在 button 内 (Compose 中未直接用, 留作未来)
void spacing;
