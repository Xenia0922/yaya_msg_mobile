import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  FlatList,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMusicPlayerStore } from '../store/musicPlayerStore';
import { MusicEngine } from '../services/musicPlayer';
import { lyricIndexAt, lyricTimeForIndex } from '../utils/lyrics';
import CoverArt from './CoverArt';
import { NetworkImage } from './NetworkImage';
import { usePalette, radii, spacing, motion, fontFamily } from '../theme';
import { typography } from '../theme/typography';
import { useI18n } from '../i18n';
import { formatTrackSubtitle } from '../utils/format';
import { useVinylSpin } from '../hooks/useVinylSpin';
import { normalizeImageHost } from '../utils/imageThumb';

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

const QUEUE_ROW_HEIGHT = 62;

interface FullScreenProgressBarProps {
  tintColor: string;
  backgroundColor: string;
  trackColor: string;
  timeColor: string;
}

const FullScreenProgressBar = React.memo(function FullScreenProgressBar({
  tintColor,
  backgroundColor,
  trackColor,
  timeColor,
}: FullScreenProgressBarProps) {
  const duration = useMusicPlayerStore((s) => s.duration);
  const position = useMusicPlayerStore((s) => s.position);
  const progress = duration > 0 ? Math.min(1, Math.max(0, position / duration)) : 0;

  const progRef2 = useRef<View>(null);
  const progW2 = useRef(0);
  const progX2 = useRef(0);
  const [dragRatio, setDragRatio] = useState<number | null>(null);
  const dragRatioRef = useRef<number>(0);
  const gestureActive = useRef(false);
  const progRaf = useRef(0);
  const pendingRatio = useRef(0);

  useEffect(
    () => () => {
      if (progRaf.current) cancelAnimationFrame(progRaf.current);
    },
    [],
  );

  const ratioFromX = (pageX: number): number | null => {
    const w = progW2.current;
    if (!w || w < 2) return null;
    return Math.max(0, Math.min(1, (pageX - progX2.current) / w));
  };
  const onProgGrant = (e: any) => {
    const r = ratioFromX(e.nativeEvent.pageX);
    if (r == null) {
      gestureActive.current = false;
      return;
    }
    gestureActive.current = true;
    if (progRaf.current) cancelAnimationFrame(progRaf.current);
    progRaf.current = 0;
    dragRatioRef.current = r;
    pendingRatio.current = r;
    setDragRatio(r);
  };
  const onProgMove = (e: any) => {
    const r = ratioFromX(e.nativeEvent.pageX);
    if (r == null) return;
    pendingRatio.current = r;
    if (progRaf.current) return;
    progRaf.current = requestAnimationFrame(() => {
      progRaf.current = 0;
      const nr = pendingRatio.current;
      if (Math.abs(nr - dragRatioRef.current) < 0.004) return;
      dragRatioRef.current = nr;
      setDragRatio(nr);
    });
  };
  const onProgRelease = () => {
    if (progRaf.current) cancelAnimationFrame(progRaf.current);
    progRaf.current = 0;
    const r = dragRatioRef.current;
    if (gestureActive.current && duration > 0) {
      const target = r * duration;
      const st = useMusicPlayerStore.getState();
      st.setSeekTarget(target);
      st.setPosition(target);
    }
    gestureActive.current = false;
    dragRatioRef.current = 0;
    pendingRatio.current = 0;
    setDragRatio(null);
  };
  const shownRatio = dragRatio ?? progress;

  return (
    <View style={styles.progressRow}>
      <Text style={[styles.progTime, { color: timeColor }]}>{formatTime(position)}</Text>
      <View
        ref={progRef2}
        style={styles.progBg}
        onLayout={(e) => {
          progW2.current = e.nativeEvent.layout.width;
          progRef2.current?.measureInWindow?.((x) => {
            progX2.current = x;
          });
        }}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={onProgGrant}
        onResponderMove={onProgMove}
        onResponderRelease={onProgRelease}
        onResponderTerminate={onProgRelease}
      >
        <View style={[styles.progTrack, { backgroundColor: trackColor }]} />
        <View
          style={[
            styles.progFg,
            { width: `${shownRatio * 100}%` as any, backgroundColor: tintColor },
          ]}
        />
        <View
          style={[
            styles.progThumb,
            {
              left: `${shownRatio * 100}%` as any,
              backgroundColor: tintColor,
              borderColor: backgroundColor,
            },
          ]}
        />
      </View>
      <Text style={[styles.progTime, { color: timeColor }]}>{formatTime(duration)}</Text>
    </View>
  );
});

interface FullScreenLyricsListProps {
  lyrics: any[];
  lrcIdx: number;
  lyricSize: number;
  tintColor: string;
  tintSoftColor: string;
  mutedColor: string;
  emptyText: string;
}

const FullScreenLyricsList = React.memo(function FullScreenLyricsList({
  lyrics,
  lrcIdx,
  lyricSize,
  tintColor,
  tintSoftColor,
  mutedColor,
  emptyText,
}: FullScreenLyricsListProps) {
  const [spacerH, setSpacerH] = useState(160);
  const lyricScrollRef = useRef<ScrollView>(null);
  const lrcScrollH = useRef(400);
  const lineYOffsets = useRef<number[]>([]);

  useEffect(() => {
    lineYOffsets.current = new Array(lyrics.length).fill(0);
  }, [lyrics]);

  useEffect(() => {
    if (lrcIdx < 0 || !lyricScrollRef.current) return;
    const lineH = lyricSize * 1.6 + 16;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const center = () => {
      const y = lineYOffsets.current[lrcIdx] ?? 0;
      if (y > 0 || tries >= 16) {
        if (y > 0) {
          const target = Math.max(0, y - lrcScrollH.current / 2 + lineH / 2);
          lyricScrollRef.current?.scrollTo?.({ y: target, animated: true });
        }
        return;
      }
      tries += 1;
      timer = setTimeout(center, 60);
    };
    timer = setTimeout(center, 30);
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [lrcIdx, lyricSize, lyrics]);

  return (
    <ScrollView
      ref={lyricScrollRef}
      style={styles.lyricScroll}
      showsVerticalScrollIndicator={false}
      onLayout={(e) => {
        lrcScrollH.current = e.nativeEvent.layout.height;
        setSpacerH(Math.max(120, lrcScrollH.current / 2));
      }}
    >
      <View style={{ height: spacerH }} />
      {lyrics.length > 0 ? (
        lyrics.map((l, i) => (
          <Pressable
            key={i}
            onLayout={(e) => {
              lineYOffsets.current[i] = e.nativeEvent.layout.y;
            }}
            onPress={() => {
              const time = lyricTimeForIndex(lyrics, i);
              if (time >= 0) useMusicPlayerStore.getState().setSeekTarget(time);
            }}
          >
            <Text
              style={[
                styles.lyricLine,
                {
                  fontSize: lyricSize,
                  lineHeight: lyricSize * 1.6,
                  color: mutedColor,
                },
                i === lrcIdx && {
                  color: tintColor,
                  fontWeight: '900',
                  textShadowColor: tintSoftColor,
                  textShadowOffset: { width: 0, height: 0 },
                  textShadowRadius: 8,
                },
              ]}
            >
              {l.text}
            </Text>
          </Pressable>
        ))
      ) : (
        <Text style={[styles.lyricLine, { color: mutedColor }]}>{emptyText}</Text>
      )}
      <View style={{ height: spacerH }} />
    </ScrollView>
  );
});

function FullScreenLyricsPanel({
  lyrics,
  lyricSize,
  onDecreaseSize,
  onIncreaseSize,
  onBackToCover,
}: {
  lyrics: any[];
  lyricSize: number;
  onDecreaseSize: () => void;
  onIncreaseSize: () => void;
  onBackToCover: () => void;
}) {
  const { t } = useI18n();
  const palette = usePalette();
  const position = useMusicPlayerStore((s) => s.position);
  const lrcIdx = useMemo(() => lyricIndexAt(lyrics, position), [lyrics, position]);

  return (
    <>
      <View style={styles.lyricToolRow}>
        <Pressable
          onPress={onDecreaseSize}
          accessibilityRole="button"
          accessibilityLabel="A-"
          style={({ pressed }) => [
            styles.lyricToolBtn,
            { backgroundColor: palette.fill2 },
            pressed && { opacity: 0.6 },
          ]}
        >
          <Icon name="format-font-size-decrease" size={16} color={palette.labelSecondary} />
        </Pressable>
        <Pressable
          onPress={onIncreaseSize}
          accessibilityRole="button"
          accessibilityLabel="A+"
          style={({ pressed }) => [
            styles.lyricToolBtn,
            { backgroundColor: palette.fill2 },
            pressed && { opacity: 0.6 },
          ]}
        >
          <Icon name="format-font-size-increase" size={16} color={palette.labelSecondary} />
        </Pressable>
        <Pressable
          onPress={onBackToCover}
          accessibilityRole="button"
          accessibilityLabel={t('单曲')}
          style={({ pressed }) => [
            styles.lyricToolBtn,
            { backgroundColor: palette.fill2 },
            pressed && { opacity: 0.6 },
          ]}
        >
          <Icon name="disc" size={16} color={palette.labelSecondary} />
        </Pressable>
      </View>
      <FullScreenLyricsList
        lyrics={lyrics}
        lrcIdx={lrcIdx}
        lyricSize={lyricSize}
        tintColor={palette.tint}
        tintSoftColor={palette.tintSoft}
        mutedColor={palette.labelTertiary}
        emptyText={t('暂无歌词')}
      />
    </>
  );
}

interface FullScreenPlayerInnerProps {
  track: any;
  isPlaying: boolean;
  isSpinning: boolean;
  isLoading: boolean;
  playMode: string;
  lyrics: any[];
  favorites: string[];
  toggleFavorite: (_id: string, _track?: any) => void;
  currentIndex: number;
  queue: any[];
  onClose: () => void;
}

function FullScreenPlayerInner({
  onClose,
  track,
  isPlaying,
  isSpinning,
  isLoading,
  playMode,
  lyrics,
  toggleFavorite,
  currentIndex,
  queue,
}: FullScreenPlayerInnerProps) {
  const { t } = useI18n();
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { height: screenHeight } = useWindowDimensions();
  const screenHeightRef = useRef(screenHeight);
  screenHeightRef.current = screenHeight;
  const trackFavId = track ? String(track.musicId || track.id || '') : '';
  const isFav = trackFavId ? useMusicPlayerStore.getState().isFavorite(trackFavId, track) : false;
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

  const [showLyrics, setShowLyrics] = useState(false);
  const showLyricsRef = useRef(showLyrics);
  showLyricsRef.current = showLyrics;
  const [lyricSize, setLyricSize] = useState(17);
  const [showQueue, setShowQueue] = useState(false);
  const queueListRef = useRef<FlatList<any>>(null);
  const slideAnim = useRef(new Animated.Value(0)).current;

  const trackSpinKey = String(track?.musicId || track?.id || track?.title || '') || undefined;
  const spinValue = useVinylSpin(trackSpinKey, isSpinning);
  const spin = spinValue.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gs) =>
        !showLyricsRef.current && gs.dy > 14 && Math.abs(gs.dy) > Math.abs(gs.dx) * 1.2,
      onPanResponderMove: (_, gs) => {
        if (!showLyricsRef.current && gs.dy > 0) slideAnim.setValue(gs.dy);
      },
      onPanResponderRelease: (_, gs) => {
        if (!showLyricsRef.current && gs.dy > 80) {
          Animated.timing(slideAnim, {
            toValue: screenHeightRef.current,
            duration: motion.duration.fast,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }).start(() => onCloseRef.current());
        } else {
          Animated.spring(slideAnim, {
            toValue: 0,
            ...motion.spring.bouncy,
            useNativeDriver: true,
          }).start();
        }
      },
    }),
  ).current;

  const scrollQueueToCurrent = useCallback(
    (animated = true) => {
      if (!queue.length || currentIndex < 0 || currentIndex >= queue.length) return;
      try {
        queueListRef.current?.scrollToIndex({
          index: currentIndex,
          animated,
          viewPosition: 0.35,
        });
      } catch {}
    },
    [currentIndex, queue.length],
  );

  useEffect(() => {
    if (!showQueue) return;
    const timer = setTimeout(() => scrollQueueToCurrent(false), 60);
    return () => clearTimeout(timer);
  }, [showQueue, scrollQueueToCurrent]);

  const decLyricSize = useCallback(() => setLyricSize((s) => Math.max(13, s - 2)), []);
  const incLyricSize = useCallback(() => setLyricSize((s) => Math.min(24, s + 2)), []);

  const iconSecondary = palette.labelSecondary;
  const iconStrong = palette.label;
  const isDark = palette.name === 'dark';

  return (
    <View style={styles.root}>
      <View style={[styles.backdrop, { backgroundColor: palette.background }]} />
      {coverUri ? (
        <NetworkImage
          source={{ uri: coverUri }}
          blurRadius={60}
          resizeMode="cover"
          style={styles.backdrop}
          fallback={false}
          fadeDuration={0}
        />
      ) : null}
      <View
        pointerEvents="none"
        style={[
          styles.backdrop,
          { backgroundColor: isDark ? 'rgba(12,12,16,0.78)' : 'rgba(246,247,251,0.84)' },
        ]}
      />
      <Animated.View
        style={[styles.page, { transform: [{ translateY: slideAnim }] }]}
        {...panResponder.panHandlers}
      >
        <View style={[styles.topBar, { paddingTop: Math.max(48, insets.top + 8) }]}>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={t('关闭')}
            style={({ pressed }) => [styles.topBtn, pressed && { opacity: 0.6 }]}
          >
            <Icon name="chevron-down" size={28} color={palette.label} />
          </Pressable>
          <View style={styles.topCenter}>
            <Text style={[typography.headline, { color: palette.label }]} numberOfLines={1}>
              {track.title || t('未知')}
            </Text>
            <Text
              style={[typography.caption1, { color: palette.labelTertiary, marginTop: 2 }]}
              numberOfLines={1}
            >
              {formatTrackSubtitle(track) || t('官方音乐')}
            </Text>
          </View>
          <View style={styles.topBtn} />
        </View>

        {showLyrics ? (
          <FullScreenLyricsPanel
            lyrics={lyrics}
            lyricSize={lyricSize}
            onDecreaseSize={decLyricSize}
            onIncreaseSize={incLyricSize}
            onBackToCover={() => setShowLyrics(false)}
          />
        ) : (
          <Pressable
            style={styles.discWrap}
            onPress={() => setShowLyrics(true)}
            accessibilityRole="button"
            accessibilityLabel={t('轻点封面看歌词')}
          >
            <Animated.View
              style={[
                styles.disc,
                {
                  borderColor: isDark ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.85)',
                  transform: [{ rotate: spin }],
                },
              ]}
            >
              <CoverArt
                key={coverUri || track.title || '♪'}
                uri={coverUri || undefined}
                title={track.title || '♪'}
                size={248}
                round
              />
            </Animated.View>
          </Pressable>
        )}

        <View style={styles.ctrlWrap}>
          <FullScreenProgressBar
            tintColor={palette.tint}
            backgroundColor={palette.background}
            trackColor={palette.fill3}
            timeColor={palette.labelTertiary}
          />
          <View style={styles.btnRow}>
            <Pressable
              onPress={() => {
                void MusicEngine.prev().catch(() => {});
              }}
              style={({ pressed }) => [styles.transportBtn, pressed && { opacity: 0.6 }]}
            >
              <Icon name="skip-previous" size={32} color={iconStrong} />
            </Pressable>
            <Pressable
              onPress={() => {
                try {
                  if (isLoading) {
                    MusicEngine.stop();
                    return;
                  }
                  if (useMusicPlayerStore.getState().playbackState === 'error') {
                    void MusicEngine.resume();
                    return;
                  }
                  MusicEngine.togglePause();
                } catch {}
              }}
              style={({ pressed }) => [
                styles.playBtn,
                { backgroundColor: palette.tint },
                pressed && { transform: [{ scale: 0.94 }] },
              ]}
            >
              {isLoading ? (
                <ActivityIndicator size="small" color={palette.onTint} />
              ) : (
                <Icon name={isPlaying ? 'pause' : 'play'} size={36} color={palette.onTint} />
              )}
            </Pressable>
            <Pressable
              onPress={() => {
                void MusicEngine.next().catch(() => {});
              }}
              style={({ pressed }) => [styles.transportBtn, pressed && { opacity: 0.6 }]}
            >
              <Icon name="skip-next" size={32} color={iconStrong} />
            </Pressable>
          </View>
          <View style={styles.utilityRow}>
            <Pressable
              onPress={() => {
                if (trackFavId) toggleFavorite(trackFavId, track);
              }}
              style={({ pressed }) => [
                styles.sideBtn,
                isFav && { backgroundColor: palette.tintSoft },
                pressed && { opacity: 0.6 },
              ]}
            >
              <Icon
                name={isFav ? 'heart' : 'heart-outline'}
                size={21}
                color={isFav ? palette.danger : iconSecondary}
              />
            </Pressable>
            <Pressable
              onPress={() => {
                MusicEngine.cycleMode();
              }}
              style={({ pressed }) => [styles.sideBtn, pressed && { opacity: 0.6 }]}
            >
              <Icon
                name={
                  playMode === 'single'
                    ? 'repeat-once'
                    : playMode === 'random'
                      ? 'shuffle-variant'
                      : 'repeat'
                }
                size={21}
                color={iconSecondary}
              />
            </Pressable>
            <Pressable
              onPress={() => setShowLyrics(!showLyrics)}
              accessibilityRole="button"
              accessibilityLabel={t('点击任意歌词跳播')}
              style={({ pressed }) => [
                styles.sideBtn,
                showLyrics && { backgroundColor: palette.tintSoft },
                pressed && { opacity: 0.6 },
              ]}
            >
              <Icon
                name="script-text-outline"
                size={21}
                color={showLyrics ? palette.tint : iconSecondary}
              />
            </Pressable>
            <Pressable
              onPress={() => setShowQueue(true)}
              accessibilityRole="button"
              accessibilityLabel={t('播放列表（{count}）', { count: queue.length })}
              style={({ pressed }) => [
                styles.topQueuePill,
                { backgroundColor: palette.fill2 },
                pressed && { opacity: 0.65 },
              ]}
            >
              <Icon name="playlist-music" size={15} color={palette.labelSecondary} />
              <Text style={[styles.topQueueText, { color: palette.labelSecondary }]}>
                {queue.length > 0 ? `${Math.max(1, currentIndex + 1)}/${queue.length}` : '0'}
              </Text>
            </Pressable>
          </View>
        </View>
      </Animated.View>
      <Modal
        visible={showQueue}
        transparent
        animationType="slide"
        statusBarTranslucent
        navigationBarTranslucent
        onRequestClose={() => setShowQueue(false)}
      >
        <TouchableOpacity
          style={styles.queueMask}
          activeOpacity={1}
          onPress={() => setShowQueue(false)}
        >
          <View
            style={[
              styles.queueSheet,
              {
                backgroundColor:
                  palette.name === 'dark' ? 'rgba(22,22,26,0.96)' : 'rgba(255,255,255,0.96)',
                borderTopWidth: StyleSheet.hairlineWidth,
                borderTopColor: palette.hairline,
                borderTopLeftRadius: radii.sheet,
                borderTopRightRadius: radii.sheet,
                paddingBottom: Math.max(18, insets.bottom + 12),
              },
            ]}
            onStartShouldSetResponder={() => true}
          >
            <View style={[styles.queueHandle, { backgroundColor: palette.fill3 }]} />
            <View style={styles.queueHeader}>
              <TouchableOpacity
                onPress={() => scrollQueueToCurrent(true)}
                activeOpacity={0.7}
                style={styles.queueHeaderTitle}
              >
                <Icon name="playlist-music" size={18} color={palette.tint} />
                <Text style={[styles.queueCountText, { color: palette.label }]}>
                  {queue.length}
                </Text>
              </TouchableOpacity>
              <View style={styles.queueActions}>
                <TouchableOpacity
                  onPress={() => {
                    MusicEngine.stop();
                    useMusicPlayerStore.getState().clearQueue();
                    setShowQueue(false);
                    onClose();
                  }}
                  hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={t('清空')}
                  style={[styles.queueActionBtn, { backgroundColor: palette.fill2 }]}
                >
                  <Icon name="trash-can-outline" size={17} color={palette.labelSecondary} />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setShowQueue(false)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  activeOpacity={0.6}
                  style={[styles.queueActionBtn, { backgroundColor: palette.fill2 }]}
                >
                  <Icon name="close" size={17} color={iconSecondary} />
                </TouchableOpacity>
              </View>
            </View>
            <FlatList
              ref={queueListRef}
              data={queue}
              keyExtractor={(t, i) => String(t.musicId || t.id || i)}
              initialNumToRender={14}
              maxToRenderPerBatch={14}
              getItemLayout={(_, index) => ({
                length: QUEUE_ROW_HEIGHT,
                offset: QUEUE_ROW_HEIGHT * index,
                index,
              })}
              onScrollToIndexFailed={(info) => {
                setTimeout(() => {
                  queueListRef.current?.scrollToIndex({
                    index: Math.min(info.index, Math.max(0, queue.length - 1)),
                    animated: false,
                  });
                }, 80);
              }}
              renderItem={({ item, index }) => {
                const active = index === currentIndex;
                const id = String(item.musicId || item.id || index);
                const cu = (item.coverUrl || item.cover || item.thumbPath || '') as string;
                const uri = cu
                  ? cu.startsWith('http')
                    ? normalizeImageHost(cu)
                    : `https://source.48.cn${cu.startsWith('/') ? cu : '/' + cu}`
                  : undefined;
                return (
                  <View style={styles.queueItemRow}>
                    <TouchableOpacity
                      style={[styles.queueItem, active && { backgroundColor: palette.tintSoft }]}
                      onPress={() => {
                        MusicEngine.playAt(index);
                        setShowQueue(false);
                      }}
                      activeOpacity={0.7}
                    >
                      <CoverArt
                        uri={uri}
                        title={item.title || '♪'}
                        size={42}
                        round
                        active={active}
                      />
                      <View style={styles.queueInfo}>
                        <Text
                          style={[typography.subhead, { color: palette.label, fontWeight: '700' }]}
                          numberOfLines={1}
                        >
                          {item.title || t('未知')}
                        </Text>
                        <Text
                          style={[
                            typography.caption1,
                            { color: palette.labelTertiary, marginTop: 2 },
                          ]}
                          numberOfLines={1}
                        >
                          {formatTrackSubtitle(item) || t('官方音乐')}
                        </Text>
                      </View>
                      {active ? <Icon name="volume-high" size={18} color={palette.tint} /> : null}
                    </TouchableOpacity>

                    <Pressable
                      onPress={() => {
                        MusicEngine.removeFromQueue(id).catch(() => {});
                      }}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      style={({ pressed }) => [styles.queueRemove, pressed && { opacity: 0.5 }]}
                    >
                      <Icon name="close" size={17} color={palette.labelTertiary} />
                    </Pressable>
                  </View>
                );
              }}
            />
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

interface Props {
  visible: boolean;
  onClose: () => void;
}

export default function FullScreenPlayer({ visible, onClose }: Props) {
  const currentIndex = useMusicPlayerStore((s) => s.currentIndex);
  const queue = useMusicPlayerStore((s) => s.queue);
  const playbackState = useMusicPlayerStore((s) => s.playbackState);
  const playMode = useMusicPlayerStore((s) => s.playMode);
  const lyrics = useMusicPlayerStore((s) => s.lyrics);
  const favorites = useMusicPlayerStore((s) => s.favorites);
  const toggleFavorite = useMusicPlayerStore((s) => s.toggleFavorite);

  const track = queue[currentIndex] || null;
  const isLoading = playbackState === 'loading';
  const isSpinning = playbackState === 'playing';
  const isPlaying = isSpinning || isLoading;

  if (!visible || !track) return null;

  return (
    <FullScreenPlayerInner
      onClose={onClose}
      track={track}
      isPlaying={isPlaying}
      isSpinning={isSpinning}
      isLoading={isLoading}
      playMode={playMode}
      lyrics={lyrics}
      favorites={favorites}
      toggleFavorite={toggleFavorite}
      currentIndex={currentIndex}
      queue={queue}
    />
  );
}

const styles = StyleSheet.create({
  root: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, zIndex: 999, elevation: 999 },
  backdrop: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
  page: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingTop: 48,
    paddingBottom: 8,
  },
  topBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topQueuePill: {
    minWidth: 44,
    height: 30,
    paddingHorizontal: 9,
    borderRadius: 15,
    borderCurve: 'continuous',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  topQueueText: {
    fontSize: 11,
    fontFamily: fontFamily.system,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  topCenter: { flex: 1, alignItems: 'center', paddingHorizontal: 8 },
  discWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  disc: {
    width: 248,
    height: 248,
    borderRadius: 124,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.18,
    shadowRadius: 20,
    elevation: 8,
  },
  lyricScroll: { flex: 1 },
  lyricToolRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 6,
  },
  lyricToolBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: radii.sm },
  lyricLine: { textAlign: 'center', paddingVertical: 8 },
  ctrlWrap: { paddingHorizontal: 24, paddingBottom: 26 },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 18 },
  progTime: { fontSize: 10, fontFamily: fontFamily.system, width: 40, textAlign: 'center' },
  progBg: { flex: 1, height: 28, justifyContent: 'center' },
  progTrack: { position: 'absolute', left: 0, right: 0, height: 4, borderRadius: 2 },
  progFg: { position: 'absolute', left: 0, height: 4, borderRadius: 2 },
  progThumb: {
    position: 'absolute',
    top: 7,
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    transform: [{ translateX: -7 }],
  },
  btnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 36,
  },
  transportBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  utilityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 14,
    paddingHorizontal: 10,
  },
  sideBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playBtn: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  queueMask: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  queueSheet: { maxHeight: '82%', paddingBottom: 18 },
  queueHandle: {
    width: 38,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 8,
    marginBottom: 4,
  },
  queueHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  queueHeaderTitle: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  queueCountText: {
    fontSize: 15,
    fontFamily: fontFamily.system,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  queueActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  queueActionBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  queueItemRow: { height: QUEUE_ROW_HEIGHT, flexDirection: 'row', alignItems: 'center' },
  queueItem: {
    flex: 1,
    height: QUEUE_ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: spacing.md,
  },
  queueRemove: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.xs,
  },
  queueInfo: { flex: 1, minWidth: 0 },
});
