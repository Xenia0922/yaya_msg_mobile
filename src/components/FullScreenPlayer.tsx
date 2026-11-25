import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  BackHandler,
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
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMusicPlayerStore, LyricLine } from '../store/musicPlayerStore';
import { MusicEngine } from '../services/musicPlayer';
import { lyricIndexAt, lyricTimeForIndex } from '../utils/lyrics';
import CoverArt from './CoverArt';
import { NetworkImage } from './NetworkImage';
import { ScalePressable } from './Motion';
import { usePalette, radii, spacing, motion, fontFamily } from '../theme';
import { typography } from '../theme/typography';
import { useI18n } from '../i18n';
import { formatTrackSubtitle } from '../utils/format';
import { normalizeImageHost } from '../utils/imageThumb';

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatCountdown(msRemaining: number): string {
  const sec = Math.max(0, Math.ceil(msRemaining / 1000));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

const SPEED_CYCLE = [1.0, 1.25, 1.5, 0.75];
function nextPlaybackSpeed(cur: number): number {
  const idx = SPEED_CYCLE.findIndex((x) => Math.abs(x - cur) < 0.05);
  return SPEED_CYCLE[(idx + 1) % SPEED_CYCLE.length];
}

const QUEUE_ROW_HEIGHT = 60;

interface FullScreenProgressBarProps {
  tintColor: string;
  bufferingText: string;
  compact?: boolean;
}

const FullScreenProgressBar = React.memo(function FullScreenProgressBar({
  tintColor,
  bufferingText,
  compact = false,
}: FullScreenProgressBarProps) {
  const duration = useMusicPlayerStore((s) => s.duration);
  const position = useMusicPlayerStore((s) => s.position);
  const buffered = useMusicPlayerStore((s) => s.buffered);
  const buffering = useMusicPlayerStore((s) => s.buffering);
  const playbackState = useMusicPlayerStore((s) => s.playbackState);

  const progress = duration > 0 ? Math.min(1, Math.max(0, position / duration)) : 0;
  const bufferedRatio =
    duration > 0 ? Math.min(1, Math.max(progress, buffered / duration)) : progress;

  const progRef = useRef<View>(null);
  const progW = useRef(0);
  const progX = useRef(-1);
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

  const ratioFromEvent = (e: any): number | null => {
    const w = progW.current;
    if (!w || w < 2) return null;
    const ne = e?.nativeEvent;
    if (!ne) return null;
    const relX =
      progX.current >= 0 && Number.isFinite(ne.pageX)
        ? ne.pageX - progX.current
        : Number.isFinite(ne.locationX)
          ? ne.locationX
          : null;
    if (relX === null) return null;
    return Math.max(0, Math.min(1, relX / w));
  };
  const onProgGrant = (e: any) => {
    progRef.current?.measureInWindow?.((x) => {
      if (Number.isFinite(x)) progX.current = x;
    });
    const r = ratioFromEvent(e);
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
    const r = ratioFromEvent(e);
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

  const shownRatio = Math.max(0, Math.min(1, dragRatio ?? progress));
  const shownTime = dragRatio !== null && duration > 0 ? dragRatio * duration : position;
  const isBufferingActive = buffering && playbackState === 'playing' && dragRatio === null;

  return (
    <View style={[styles.progressWrap, compact && styles.progressWrapCompact]}>
      <View
        ref={progRef}
        style={styles.progBg}
        onLayout={(e) => {
          progW.current = e.nativeEvent.layout.width;
          requestAnimationFrame(() => {
            progRef.current?.measureInWindow?.((x) => {
              if (Number.isFinite(x)) progX.current = x;
            });
          });
        }}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderTerminationRequest={() => false}
        onResponderGrant={onProgGrant}
        onResponderMove={onProgMove}
        onResponderRelease={onProgRelease}
        onResponderTerminate={onProgRelease}
      >
        <View pointerEvents="none" style={styles.progTrack} />
        {bufferedRatio > 0 ? (
          <View
            pointerEvents="none"
            style={[styles.progBuffer, { width: `${bufferedRatio * 100}%` as any }]}
          />
        ) : null}
        <View
          pointerEvents="none"
          style={[
            styles.progFg,
            { width: `${shownRatio * 100}%` as any, backgroundColor: tintColor },
          ]}
        />
        <View
          pointerEvents="none"
          style={[
            dragRatio !== null ? styles.progThumbActive : styles.progThumb,
            {
              left: `${shownRatio * 100}%` as any,
              backgroundColor: '#FFFFFF',
              borderColor: tintColor,
            },
          ]}
        />
      </View>
      <View style={styles.timeRow}>
        <Text
          style={[styles.progTime, dragRatio !== null && { color: '#FFFFFF', fontWeight: '700' }]}
        >
          {formatTime(shownTime)}
        </Text>
        {isBufferingActive ? <Text style={styles.bufferingCaption}>{bufferingText}</Text> : null}
        <Text style={styles.progTime}>{formatTime(duration)}</Text>
      </View>
    </View>
  );
});

const FullScreenLyricPreview = React.memo(function FullScreenLyricPreview({
  lyrics,
  emptyText,
  onPress,
}: {
  lyrics: LyricLine[];
  emptyText: string;
  onPress: () => void;
}) {
  const position = useMusicPlayerStore((s) => s.position);
  const idx = useMemo(() => lyricIndexAt(lyrics, position), [lyrics, position]);
  const currentLine = idx >= 0 ? lyrics[idx]?.text : lyrics[0]?.text || '';
  const nextLine = idx >= 0 ? lyrics[idx + 1]?.text || '' : lyrics[1]?.text || '';

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.lyricPreviewBox, pressed && { opacity: 0.7 }]}
    >
      <Text numberOfLines={1} style={styles.lyricPreviewActive}>
        {currentLine || emptyText}
      </Text>
      {nextLine ? (
        <Text numberOfLines={1} style={styles.lyricPreviewNext}>
          {nextLine}
        </Text>
      ) : null}
    </Pressable>
  );
});

interface FullScreenLyricsListProps {
  lyrics: LyricLine[];
  lrcIdx: number;
  lyricSize: number;
  tintColor: string;
  emptyText: string;
}

const FullScreenLyricsList = React.memo(function FullScreenLyricsList({
  lyrics,
  lrcIdx,
  lyricSize,
  tintColor,
  emptyText,
}: FullScreenLyricsListProps) {
  const [spacerH, setSpacerH] = useState(160);
  const lyricScrollRef = useRef<ScrollView>(null);
  const lrcScrollH = useRef(380);
  const lineYOffsets = useRef<number[]>([]);
  const lineHeights = useRef<number[]>([]);
  const scrollYRef = useRef(0);
  const manualResumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [manualLineIdx, setManualLineIdx] = useState<number | null>(null);

  useEffect(() => {
    lineYOffsets.current = new Array(lyrics.length).fill(0);
    lineHeights.current = new Array(lyrics.length).fill(lyricSize * 1.6 + 16);
    setManualLineIdx(null);
  }, [lyrics, lyricSize]);

  useEffect(
    () => () => {
      if (manualResumeTimer.current) clearTimeout(manualResumeTimer.current);
    },
    [],
  );

  const findCenterLineIndex = useCallback(
    (scrollY: number): number => {
      if (!lyrics.length) return -1;
      const centerY = scrollY + lrcScrollH.current / 2;
      let best = 0;
      let bestDist = Infinity;
      for (let i = 0; i < lyrics.length; i += 1) {
        const y = lineYOffsets.current[i] ?? 0;
        if (y <= 0) continue;
        const mid = y + (lineHeights.current[i] || lyricSize * 1.6 + 16) / 2;
        const d = Math.abs(mid - centerY);
        if (d < bestDist) {
          bestDist = d;
          best = i;
        }
      }
      return best;
    },
    [lyrics.length, lyricSize],
  );

  const scheduleManualResume = useCallback(() => {
    if (manualResumeTimer.current) clearTimeout(manualResumeTimer.current);
    manualResumeTimer.current = setTimeout(() => {
      manualResumeTimer.current = null;
      setManualLineIdx(null);
    }, 3000);
  }, []);

  useEffect(() => {
    if (manualLineIdx !== null || lrcIdx < 0 || !lyricScrollRef.current) return;
    const lineH = lineHeights.current[lrcIdx] || lyricSize * 1.6 + 16;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const center = () => {
      const y = lineYOffsets.current[lrcIdx] ?? 0;
      if (y > 0 || tries >= 12) {
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
  }, [lrcIdx, lyricSize, lyrics, manualLineIdx]);

  const manualLine = manualLineIdx !== null ? lyrics[manualLineIdx] : null;

  return (
    <View style={styles.lyricListWrap}>
      <ScrollView
        ref={lyricScrollRef}
        style={styles.lyricScroll}
        fadingEdgeLength={64}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={32}
        onLayout={(e) => {
          lrcScrollH.current = e.nativeEvent.layout.height;
          setSpacerH(Math.max(120, lrcScrollH.current / 2));
        }}
        onScrollBeginDrag={() => {
          if (!lyrics.length) return;
          if (manualResumeTimer.current) {
            clearTimeout(manualResumeTimer.current);
            manualResumeTimer.current = null;
          }
          setManualLineIdx(findCenterLineIndex(scrollYRef.current));
        }}
        onScroll={(e) => {
          const y = e.nativeEvent.contentOffset.y;
          scrollYRef.current = y;
          if (manualLineIdx !== null) {
            const next = findCenterLineIndex(y);
            if (next >= 0 && next !== manualLineIdx) setManualLineIdx(next);
          }
        }}
        onScrollEndDrag={() => {
          if (manualLineIdx !== null) scheduleManualResume();
        }}
        onMomentumScrollEnd={() => {
          if (manualLineIdx !== null) scheduleManualResume();
        }}
      >
        <View style={{ height: spacerH }} />
        {lyrics.length > 0 ? (
          lyrics.map((l, i) => {
            const isActive = i === lrcIdx;
            const isPreview = manualLineIdx !== null && i === manualLineIdx;
            return (
              <Pressable
                key={`${i}-${l.time}`}
                onLayout={(e) => {
                  lineYOffsets.current[i] = e.nativeEvent.layout.y;
                  lineHeights.current[i] = e.nativeEvent.layout.height;
                }}
                onPress={() => {
                  const time = lyricTimeForIndex(lyrics, i);
                  if (time >= 0) {
                    if (manualResumeTimer.current) clearTimeout(manualResumeTimer.current);
                    setManualLineIdx(null);
                    useMusicPlayerStore.getState().setSeekTarget(time);
                  }
                }}
              >
                <Text
                  style={[
                    styles.lyricLine,
                    {
                      fontSize: lyricSize,
                      lineHeight: lyricSize * 1.55,
                      color: isPreview ? 'rgba(255,255,255,0.88)' : 'rgba(255,255,255,0.42)',
                    },
                    isActive && {
                      color: '#FFFFFF',
                      fontWeight: '800',
                      fontSize: lyricSize + 2,
                      textShadowColor: tintColor,
                      textShadowOffset: { width: 0, height: 0 },
                      textShadowRadius: 10,
                    },
                  ]}
                >
                  {l.text}
                </Text>
              </Pressable>
            );
          })
        ) : (
          <Text style={[styles.lyricLine, { color: 'rgba(255,255,255,0.46)' }]}>{emptyText}</Text>
        )}
        <View style={{ height: spacerH }} />
      </ScrollView>

      {manualLine ? (
        <View pointerEvents="box-none" style={styles.centerSeekGuide}>
          <Text style={styles.centerSeekTime}>{formatTime(manualLine.time)}</Text>
          <View style={styles.centerSeekHairline} />
          <Pressable
            onPress={() => {
              if (manualResumeTimer.current) clearTimeout(manualResumeTimer.current);
              setManualLineIdx(null);
              useMusicPlayerStore.getState().setSeekTarget(manualLine.time);
            }}
            style={({ pressed }) => [
              styles.centerSeekBtn,
              { backgroundColor: tintColor },
              pressed && { opacity: 0.75 },
            ]}
          >
            <Icon name="play" size={14} color="#FFFFFF" />
          </Pressable>
        </View>
      ) : null}
    </View>
  );
});

function FullScreenLyricsPanel({
  lyrics,
  lyricSize,
  onDecreaseSize,
  onIncreaseSize,
}: {
  lyrics: LyricLine[];
  lyricSize: number;
  onDecreaseSize: () => void;
  onIncreaseSize: () => void;
}) {
  const { t } = useI18n();
  const palette = usePalette();
  const position = useMusicPlayerStore((s) => s.position);
  const lrcIdx = useMemo(() => lyricIndexAt(lyrics, position), [lyrics, position]);

  return (
    <View style={styles.lyricsPanel}>
      <View style={styles.lyricToolRow}>
        <Pressable
          onPress={onDecreaseSize}
          accessibilityRole="button"
          accessibilityLabel="A-"
          style={({ pressed }) => [styles.lyricToolBtn, pressed && { opacity: 0.6 }]}
        >
          <Icon name="format-font-size-decrease" size={16} color="rgba(255,255,255,0.78)" />
        </Pressable>
        <Pressable
          onPress={onIncreaseSize}
          accessibilityRole="button"
          accessibilityLabel="A+"
          style={({ pressed }) => [styles.lyricToolBtn, pressed && { opacity: 0.6 }]}
        >
          <Icon name="format-font-size-increase" size={16} color="rgba(255,255,255,0.78)" />
        </Pressable>
      </View>
      <FullScreenLyricsList
        lyrics={lyrics}
        lrcIdx={lrcIdx}
        lyricSize={lyricSize}
        tintColor={palette.tint}
        emptyText={t('暂无歌词')}
      />
    </View>
  );
}

function SleepCountdownBadge({
  sleepTimerEndAt,
  sleepAfterTrack,
}: {
  sleepTimerEndAt: number | null;
  sleepAfterTrack: boolean;
}) {
  const { t } = useI18n();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!sleepTimerEndAt) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [sleepTimerEndAt]);

  if (sleepAfterTrack) {
    return <Text style={styles.utilPillTextActive}>{t('本首后')}</Text>;
  }
  if (sleepTimerEndAt && sleepTimerEndAt > now) {
    return <Text style={styles.utilPillTextActive}>{formatCountdown(sleepTimerEndAt - now)}</Text>;
  }
  return <Text style={styles.utilPillText}>{t('定时')}</Text>;
}

interface FullScreenPlayerInnerProps {
  track: any;
  isPlaying: boolean;
  isLoading: boolean;
  playMode: string;
  speed: number;
  sleepTimerEndAt: number | null;
  sleepAfterTrack: boolean;
  lyrics: LyricLine[];
  favorites: string[];
  toggleFavorite: (_id: string, _track?: any) => void;
  currentIndex: number;
  queue: any[];
  initialSheet: 'none' | 'queue';
  onClose: () => void;
}

function FullScreenPlayerInner({
  onClose,
  track,
  isPlaying,
  isLoading,
  playMode,
  speed,
  sleepTimerEndAt,
  sleepAfterTrack,
  lyrics,
  toggleFavorite,
  currentIndex,
  queue,
  initialSheet,
}: FullScreenPlayerInnerProps) {
  const { t } = useI18n();
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
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
  const [lyricSize, setLyricSize] = useState(18);
  const [showQueue, setShowQueue] = useState(initialSheet === 'queue');
  const [showSleepSheet, setShowSleepSheet] = useState(false);
  const queueListRef = useRef<FlatList<any>>(null);
  const slideAnim = useRef(new Animated.Value(0)).current;
  const coverScale = useRef(new Animated.Value(isPlaying ? 1 : 0.94)).current;

  useEffect(() => {
    if (initialSheet === 'queue') setShowQueue(true);
  }, [initialSheet]);

  useEffect(() => {
    Animated.spring(coverScale, {
      toValue: isPlaying ? 1 : 0.94,
      damping: 18,
      stiffness: 200,
      useNativeDriver: true,
    }).start();
  }, [isPlaying, coverScale]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (showSleepSheet) {
        setShowSleepSheet(false);
        return true;
      }
      if (showQueue) {
        setShowQueue(false);
        return true;
      }
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [showQueue, showSleepSheet, onClose]);

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gs) =>
        !showLyricsRef.current && gs.dy > 16 && Math.abs(gs.dy) > Math.abs(gs.dx) * 1.3,
      onPanResponderMove: (_, gs) => {
        if (!showLyricsRef.current && gs.dy > 0) slideAnim.setValue(gs.dy);
      },
      onPanResponderRelease: (_, gs) => {
        if (!showLyricsRef.current && gs.dy > 85) {
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

  const coverSwipeResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gs) =>
        Math.abs(gs.dx) > 22 && Math.abs(gs.dx) > Math.abs(gs.dy) * 1.4,
      onPanResponderRelease: (_, gs) => {
        if (gs.dx < -48) {
          void MusicEngine.next().catch(() => {});
        } else if (gs.dx > 48) {
          void MusicEngine.prev().catch(() => {});
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

  const decLyricSize = useCallback(() => setLyricSize((s) => Math.max(14, s - 2)), []);
  const incLyricSize = useCallback(() => setLyricSize((s) => Math.min(24, s + 2)), []);

  const isCompactH = screenHeight < 700;
  const topBarPadTop = Math.max(insets.top + 8, isCompactH ? 24 : 38);
  const ctrlPadBottom = Math.max(insets.bottom + (isCompactH ? 10 : 14), isCompactH ? 14 : 24);
  const topBarEstH = topBarPadTop + 40 + 6;
  const ctrlEstH = (isCompactH ? 52 : 60) + 64 + (isCompactH ? 42 : 50) + ctrlPadBottom;
  const metaAndPreviewEstH = isCompactH ? 156 : 168;
  const maxCoverByHeight = Math.floor(screenHeight - topBarEstH - ctrlEstH - metaAndPreviewEstH);
  const coverSize = Math.max(132, Math.min(screenWidth - 76, 276, maxCoverByHeight));
  const hasSleep = Boolean(sleepAfterTrack || sleepTimerEndAt);

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <View style={[styles.backdrop, { backgroundColor: '#0A0B11' }]} />
      {coverUri ? (
        <NetworkImage
          source={{ uri: coverUri }}
          blurRadius={64}
          resizeMode="cover"
          style={[styles.backdrop, { opacity: 0.46 }]}
          fallback={false}
          fadeDuration={120}
        />
      ) : null}
      <LinearGradient
        pointerEvents="none"
        colors={[
          'rgba(10,11,17,0.36)',
          'rgba(10,11,17,0.54)',
          'rgba(10,11,17,0.78)',
          'rgba(10,11,17,0.95)',
        ]}
        locations={[0, 0.36, 0.68, 1]}
        style={styles.backdrop}
      />

      <Animated.View
        style={[styles.page, { transform: [{ translateY: slideAnim }] }]}
        {...panResponder.panHandlers}
      >
        <View style={[styles.topBar, { paddingTop: topBarPadTop }]}>
          <ScalePressable
            onPress={onClose}
            pressedScale={0.88}
            accessibilityRole="button"
            accessibilityLabel={t('关闭')}
            style={styles.topBtn}
          >
            <Icon name="chevron-down" size={28} color="#FFFFFF" />
          </ScalePressable>

          <View style={styles.modeSegPill}>
            <Pressable
              onPress={() => setShowLyrics(false)}
              style={[styles.modeSegTab, !showLyrics && styles.modeSegTabActive]}
            >
              <Text style={[styles.modeSegText, !showLyrics && styles.modeSegTextActive]}>
                {t('歌曲')}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setShowLyrics(true)}
              style={[styles.modeSegTab, showLyrics && styles.modeSegTabActive]}
            >
              <Text style={[styles.modeSegText, showLyrics && styles.modeSegTextActive]}>
                {t('歌词')}
              </Text>
            </Pressable>
          </View>

          {showLyrics ? (
            <ScalePressable
              onPress={() => {
                if (trackFavId) toggleFavorite(trackFavId, track);
              }}
              pressedScale={0.82}
              accessibilityRole="button"
              accessibilityLabel={isFav ? t('已收藏') : t('收藏')}
              style={[styles.topBtn, isFav && { backgroundColor: 'rgba(255,77,109,0.20)' }]}
            >
              <Icon
                name={isFav ? 'heart' : 'heart-outline'}
                size={22}
                color={isFav ? '#FF4D6D' : 'rgba(255,255,255,0.82)'}
              />
            </ScalePressable>
          ) : (
            <View style={styles.topBtn} />
          )}
        </View>

        {showLyrics ? (
          <FullScreenLyricsPanel
            lyrics={lyrics}
            lyricSize={lyricSize}
            onDecreaseSize={decLyricSize}
            onIncreaseSize={incLyricSize}
          />
        ) : (
          <View style={[styles.songBody, isCompactH && styles.songBodyCompact]}>
            <View style={styles.coverStage} {...coverSwipeResponder.panHandlers}>
              <Animated.View
                style={[
                  styles.coverCard,
                  {
                    width: coverSize,
                    height: coverSize,
                    transform: [{ scale: coverScale }],
                  },
                ]}
              >
                <CoverArt
                  uri={coverUri || undefined}
                  title={track.title || '♪'}
                  size={coverSize}
                  borderRadius={22}
                  thumbnail={540}
                />
              </Animated.View>
            </View>

            <View style={styles.trackMetaRow}>
              <View style={styles.trackMetaTexts}>
                <Text numberOfLines={1} style={styles.trackTitle}>
                  {track.title || t('未知')}
                </Text>
                <Text numberOfLines={1} style={styles.trackSub}>
                  {formatTrackSubtitle(track) || t('官方音乐')}
                </Text>
              </View>
              <ScalePressable
                onPress={() => {
                  if (trackFavId) toggleFavorite(trackFavId, track);
                }}
                pressedScale={0.82}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={isFav ? t('已收藏') : t('收藏')}
                style={[styles.favHeartBtn, isFav && { backgroundColor: 'rgba(255,77,109,0.18)' }]}
              >
                <Icon
                  name={isFav ? 'heart' : 'heart-outline'}
                  size={23}
                  color={isFav ? '#FF4D6D' : 'rgba(255,255,255,0.78)'}
                />
              </ScalePressable>
            </View>

            <FullScreenLyricPreview
              lyrics={lyrics}
              emptyText={t('暂无歌词')}
              onPress={() => setShowLyrics(true)}
            />
          </View>
        )}

        <View style={[styles.ctrlWrap, { paddingBottom: ctrlPadBottom }]}>
          <FullScreenProgressBar
            tintColor={palette.tint}
            bufferingText={t('正在缓冲…')}
            compact={isCompactH}
          />

          <View style={styles.btnRow}>
            <ScalePressable
              onPress={() => MusicEngine.cycleMode()}
              pressedScale={0.88}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={t('播放模式')}
              style={styles.sideCtrlBtn}
            >
              <Icon
                name={
                  playMode === 'single'
                    ? 'repeat-once'
                    : playMode === 'random'
                      ? 'shuffle-variant'
                      : 'repeat'
                }
                size={23}
                color={playMode === 'sequential' ? 'rgba(255,255,255,0.76)' : palette.tint}
              />
            </ScalePressable>

            <ScalePressable
              onPress={() => {
                void MusicEngine.prev().catch(() => {});
              }}
              pressedScale={0.88}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={t('上一首')}
              style={styles.transportBtn}
            >
              <Icon name="skip-previous" size={34} color="#FFFFFF" />
            </ScalePressable>

            <ScalePressable
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
              pressedScale={0.92}
              accessibilityRole="button"
              accessibilityLabel={isLoading ? t('取消') : isPlaying ? t('暂停') : t('播放')}
              style={[styles.playBtn, { backgroundColor: palette.tint }]}
            >
              {isLoading ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Icon name={isPlaying ? 'pause' : 'play'} size={34} color="#FFFFFF" />
              )}
            </ScalePressable>

            <ScalePressable
              onPress={() => {
                void MusicEngine.next().catch(() => {});
              }}
              pressedScale={0.88}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={t('下一首')}
              style={styles.transportBtn}
            >
              <Icon name="skip-next" size={34} color="#FFFFFF" />
            </ScalePressable>

            <ScalePressable
              onPress={() => setShowQueue(true)}
              pressedScale={0.88}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={t('播放列表（{count}）', { count: queue.length })}
              style={styles.sideCtrlBtn}
            >
              <Icon name="playlist-music" size={24} color="rgba(255,255,255,0.82)" />
            </ScalePressable>
          </View>

          <View style={[styles.utilityRow, isCompactH && styles.utilityRowCompact]}>
            <ScalePressable
              onPress={() => {
                const nextSp = nextPlaybackSpeed(speed);
                useMusicPlayerStore.getState().setSpeed(nextSp);
              }}
              pressedScale={0.94}
              style={[styles.utilPill, Math.abs(speed - 1.0) > 0.05 && styles.utilPillActive]}
            >
              <Icon
                name="speedometer"
                size={15}
                color={Math.abs(speed - 1.0) > 0.05 ? palette.tint : 'rgba(255,255,255,0.72)'}
              />
              <Text
                style={
                  Math.abs(speed - 1.0) > 0.05 ? styles.utilPillTextActive : styles.utilPillText
                }
              >
                {`${speed}x`}
              </Text>
            </ScalePressable>

            <ScalePressable
              onPress={() => setShowSleepSheet(true)}
              pressedScale={0.94}
              style={[styles.utilPill, hasSleep && styles.utilPillActive]}
            >
              <Icon
                name="timer-outline"
                size={15}
                color={hasSleep ? palette.tint : 'rgba(255,255,255,0.72)'}
              />
              <SleepCountdownBadge
                sleepTimerEndAt={sleepTimerEndAt}
                sleepAfterTrack={sleepAfterTrack}
              />
            </ScalePressable>
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
          style={styles.sheetMask}
          activeOpacity={1}
          onPress={() => setShowQueue(false)}
        >
          <View
            style={[styles.queueSheet, { paddingBottom: Math.max(18, insets.bottom + 12) }]}
            onStartShouldSetResponder={() => true}
          >
            <View style={styles.sheetHandle} />
            <View style={styles.queueHeader}>
              <TouchableOpacity
                onPress={() => scrollQueueToCurrent(true)}
                activeOpacity={0.7}
                style={styles.queueHeaderTitle}
              >
                <Icon name="playlist-music" size={19} color={palette.tint} />
                <Text style={styles.queueHeaderText}>
                  {t('播放队列')} ({queue.length})
                </Text>
              </TouchableOpacity>
              <View style={styles.queueActions}>
                <ScalePressable
                  onPress={() => MusicEngine.cycleMode()}
                  pressedScale={0.92}
                  style={styles.queueActionPill}
                >
                  <Icon
                    name={
                      playMode === 'single'
                        ? 'repeat-once'
                        : playMode === 'random'
                          ? 'shuffle-variant'
                          : 'repeat'
                    }
                    size={15}
                    color="rgba(255,255,255,0.85)"
                  />
                  <Text style={styles.queueActionPillText}>
                    {playMode === 'single'
                      ? t('单曲')
                      : playMode === 'random'
                        ? t('随机')
                        : t('顺序')}
                  </Text>
                </ScalePressable>
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
                  style={styles.queueActionBtn}
                >
                  <Icon name="trash-can-outline" size={17} color="rgba(255,255,255,0.75)" />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setShowQueue(false)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  activeOpacity={0.6}
                  style={styles.queueActionBtn}
                >
                  <Icon name="close" size={17} color="rgba(255,255,255,0.75)" />
                </TouchableOpacity>
              </View>
            </View>
            <FlatList
              ref={queueListRef}
              data={queue}
              keyExtractor={(item, i) => String(item.musicId || item.id || i)}
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
                      style={[styles.queueItem, active && styles.queueItemActive]}
                      onPress={() => {
                        void MusicEngine.playAt(index);
                        setShowQueue(false);
                      }}
                      activeOpacity={0.7}
                    >
                      <CoverArt
                        uri={uri}
                        title={item.title || '♪'}
                        size={42}
                        borderRadius={10}
                        thumbnail={110}
                      />
                      <View style={styles.queueInfo}>
                        <Text
                          style={[
                            typography.subhead,
                            { color: active ? palette.tint : '#FFFFFF', fontWeight: '700' },
                          ]}
                          numberOfLines={1}
                        >
                          {item.title || t('未知')}
                        </Text>
                        <Text
                          style={[
                            typography.caption1,
                            { color: 'rgba(255,255,255,0.55)', marginTop: 2 },
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
                        void MusicEngine.removeFromQueue(id).catch(() => {});
                      }}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      style={({ pressed }) => [styles.queueRemove, pressed && { opacity: 0.5 }]}
                    >
                      <Icon name="close" size={17} color="rgba(255,255,255,0.5)" />
                    </Pressable>
                  </View>
                );
              }}
            />
          </View>
        </TouchableOpacity>
      </Modal>

      <Modal
        visible={showSleepSheet}
        transparent
        animationType="fade"
        statusBarTranslucent
        navigationBarTranslucent
        onRequestClose={() => setShowSleepSheet(false)}
      >
        <TouchableOpacity
          style={styles.sheetMask}
          activeOpacity={1}
          onPress={() => setShowSleepSheet(false)}
        >
          <View
            style={[styles.sleepSheet, { paddingBottom: Math.max(20, insets.bottom + 12) }]}
            onStartShouldSetResponder={() => true}
          >
            <View style={styles.sheetHandle} />
            <Text style={styles.sleepSheetTitle}>{t('定时关闭')}</Text>
            {[
              {
                label: t('关闭定时'),
                active: !hasSleep,
                onPress: () => useMusicPlayerStore.getState().clearSleepTimer(),
              },
              {
                label: t('播完本首后暂停'),
                active: sleepAfterTrack,
                onPress: () => useMusicPlayerStore.getState().setSleepAfterTrack(true),
              },
              {
                label: t('{min} 分钟后', { min: 15 }),
                active: false,
                onPress: () => useMusicPlayerStore.getState().setSleepTimer(15),
              },
              {
                label: t('{min} 分钟后', { min: 30 }),
                active: false,
                onPress: () => useMusicPlayerStore.getState().setSleepTimer(30),
              },
              {
                label: t('{min} 分钟后', { min: 60 }),
                active: false,
                onPress: () => useMusicPlayerStore.getState().setSleepTimer(60),
              },
            ].map((opt, idx) => (
              <ScalePressable
                key={idx}
                onPress={() => {
                  opt.onPress();
                  setShowSleepSheet(false);
                }}
                pressedScale={0.98}
                style={[
                  styles.sleepOptRow,
                  opt.active && { backgroundColor: 'rgba(255,255,255,0.08)' },
                ]}
              >
                <Text
                  style={[
                    styles.sleepOptText,
                    opt.active && { color: palette.tint, fontWeight: '700' },
                  ]}
                >
                  {opt.label}
                </Text>
                {opt.active ? <Icon name="check" size={18} color={palette.tint} /> : null}
              </ScalePressable>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

interface Props {
  visible: boolean;
  initialSheet?: 'none' | 'queue';
  onClose: () => void;
}

export default function FullScreenPlayer({ visible, initialSheet = 'none', onClose }: Props) {
  const currentIndex = useMusicPlayerStore((s) => s.currentIndex);
  const queue = useMusicPlayerStore((s) => s.queue);
  const playbackState = useMusicPlayerStore((s) => s.playbackState);
  const playMode = useMusicPlayerStore((s) => s.playMode);
  const speed = useMusicPlayerStore((s) => s.speed);
  const sleepTimerEndAt = useMusicPlayerStore((s) => s.sleepTimerEndAt);
  const sleepAfterTrack = useMusicPlayerStore((s) => s.sleepAfterTrack);
  const lyrics = useMusicPlayerStore((s) => s.lyrics);
  const favorites = useMusicPlayerStore((s) => s.favorites);
  const toggleFavorite = useMusicPlayerStore((s) => s.toggleFavorite);

  const track = queue[currentIndex] || null;
  const isLoading = playbackState === 'loading';
  const isPlaying = playbackState === 'playing' || isLoading;

  if (!visible || !track) return null;

  return (
    <FullScreenPlayerInner
      onClose={onClose}
      track={track}
      isPlaying={isPlaying}
      isLoading={isLoading}
      playMode={playMode}
      speed={speed}
      sleepTimerEndAt={sleepTimerEndAt}
      sleepAfterTrack={sleepAfterTrack}
      lyrics={lyrics}
      favorites={favorites}
      toggleFavorite={toggleFavorite}
      currentIndex={currentIndex}
      queue={queue}
      initialSheet={initialSheet}
    />
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    zIndex: 999,
    elevation: 999,
  },
  backdrop: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
  page: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingBottom: 6,
  },
  topBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeSegPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderRadius: 18,
    padding: 3,
    gap: 2,
  },
  modeSegTab: {
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderRadius: 15,
  },
  modeSegTabActive: {
    backgroundColor: 'rgba(255,255,255,0.20)',
  },
  modeSegText: {
    color: 'rgba(255,255,255,0.62)',
    fontSize: 12,
    fontFamily: fontFamily.system,
    fontWeight: '600',
  },
  modeSegTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  songBody: {
    flex: 1,
    justifyContent: 'space-evenly',
    paddingHorizontal: 26,
    paddingVertical: 6,
    overflow: 'hidden',
  },
  songBodyCompact: {
    paddingVertical: 2,
  },
  coverStage: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
  },
  coverCard: {
    borderRadius: 22,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.42,
    shadowRadius: 24,
    elevation: 14,
  },
  trackMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  trackMetaTexts: { flex: 1, minWidth: 0 },
  trackTitle: {
    color: '#FFFFFF',
    fontSize: 21,
    fontFamily: fontFamily.system,
    fontWeight: '800',
    lineHeight: 27,
  },
  trackSub: {
    color: 'rgba(255,255,255,0.65)',
    fontSize: 13,
    fontFamily: fontFamily.system,
    marginTop: 3,
  },
  favHeartBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  lyricPreviewBox: {
    minHeight: 48,
    justifyContent: 'center',
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  lyricPreviewActive: {
    color: 'rgba(255,255,255,0.92)',
    fontSize: 14,
    fontFamily: fontFamily.system,
    fontWeight: '600',
    lineHeight: 21,
  },
  lyricPreviewNext: {
    color: 'rgba(255,255,255,0.44)',
    fontSize: 13,
    fontFamily: fontFamily.system,
    lineHeight: 19,
    marginTop: 2,
  },
  lyricsPanel: { flex: 1, paddingHorizontal: 18 },
  lyricToolRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
    paddingVertical: 4,
  },
  lyricToolBtn: {
    width: 34,
    height: 30,
    borderRadius: radii.sm,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  lyricListWrap: { flex: 1, position: 'relative', marginTop: 4, marginBottom: 8 },
  lyricScroll: { flex: 1 },
  lyricLine: {
    textAlign: 'center',
    paddingVertical: 9,
    fontFamily: fontFamily.system,
  },
  centerSeekGuide: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '50%',
    marginTop: -14,
    height: 28,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  centerSeekTime: {
    color: 'rgba(255,255,255,0.78)',
    fontSize: 11,
    fontFamily: fontFamily.system,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    backgroundColor: 'rgba(18,20,28,0.78)',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 8,
  },
  centerSeekHairline: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.28)',
  },
  centerSeekBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctrlWrap: { paddingHorizontal: 26 },
  progressWrap: { marginBottom: 14 },
  progressWrapCompact: { marginBottom: 8 },
  progBg: { height: 28, justifyContent: 'center' },
  progTrack: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  progBuffer: {
    position: 'absolute',
    left: 0,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.34)',
  },
  progFg: { position: 'absolute', left: 0, height: 4, borderRadius: 2 },
  progThumb: {
    position: 'absolute',
    top: 8,
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    transform: [{ translateX: -6 }],
  },
  progThumbActive: {
    position: 'absolute',
    top: 6,
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2.5,
    transform: [{ translateX: -8 }],
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 2,
  },
  progTime: {
    color: 'rgba(255,255,255,0.58)',
    fontSize: 11,
    fontFamily: fontFamily.system,
    fontVariant: ['tabular-nums'],
  },
  bufferingCaption: {
    color: 'rgba(255,255,255,0.68)',
    fontSize: 10,
    fontFamily: fontFamily.system,
  },
  btnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
  },
  sideCtrlBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  transportBtn: {
    width: 50,
    height: 50,
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playBtn: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 6,
  },
  utilityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    marginTop: 18,
  },
  utilityRowCompact: {
    marginTop: 12,
  },
  utilPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  utilPillActive: {
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  utilPillText: {
    color: 'rgba(255,255,255,0.78)',
    fontSize: 12,
    fontFamily: fontFamily.system,
    fontWeight: '600',
  },
  utilPillTextActive: {
    color: '#FFFFFF',
    fontSize: 12,
    fontFamily: fontFamily.system,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  sheetMask: { flex: 1, backgroundColor: 'rgba(0,0,0,0.58)', justifyContent: 'flex-end' },
  sheetHandle: {
    width: 38,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 6,
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  queueSheet: {
    maxHeight: '78%',
    backgroundColor: 'rgba(22,23,31,0.97)',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.14)',
    borderTopLeftRadius: radii.sheet,
    borderTopRightRadius: radii.sheet,
  },
  queueHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  queueHeaderTitle: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  queueHeaderText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontFamily: fontFamily.system,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  queueActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  queueActionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  queueActionPillText: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 12,
    fontFamily: fontFamily.system,
    fontWeight: '600',
  },
  queueActionBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.10)',
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
  queueItemActive: { backgroundColor: 'rgba(255,255,255,0.08)' },
  queueRemove: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.xs,
  },
  queueInfo: { flex: 1, minWidth: 0 },
  sleepSheet: {
    backgroundColor: 'rgba(22,23,31,0.98)',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.14)',
    borderTopLeftRadius: radii.sheet,
    borderTopRightRadius: radii.sheet,
    paddingHorizontal: 18,
  },
  sleepSheetTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontFamily: fontFamily.system,
    fontWeight: '700',
    paddingVertical: 10,
  },
  sleepOptRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: 14,
    marginBottom: 4,
  },
  sleepOptText: {
    color: 'rgba(255,255,255,0.88)',
    fontSize: 15,
    fontFamily: fontFamily.system,
  },
});
