import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Easing,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useMusicPlayerStore } from '../store/musicPlayerStore';
import { useSettingsStore } from '../store';
import { MusicEngine } from '../services/musicPlayer';
import { lyricIndexAt, lyricTimeForIndex } from '../utils/lyrics';

const { width: SW } = Dimensions.get('window');
const ANIM_DURATION = 300;

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

interface Props {
  visible: boolean;
  onClose: () => void;
}

export default function FullScreenPlayer({ visible, onClose }: Props) {
  const isDark = useSettingsStore((s) => s.settings.theme === 'dark');
  const currentIndex = useMusicPlayerStore((s) => s.currentIndex);
  const queue = useMusicPlayerStore((s) => s.queue);
  const playbackState = useMusicPlayerStore((s) => s.playbackState);
  const playMode = useMusicPlayerStore((s) => s.playMode);
  const duration = useMusicPlayerStore((s) => s.duration);
  const position = useMusicPlayerStore((s) => s.position);
  const lyrics = useMusicPlayerStore((s) => s.lyrics);
  const track = queue[currentIndex] || null;

  const isPlaying = playbackState === 'playing';
  const progress = duration > 0 ? position / duration : 0;
  const lrcIdx = lyricIndexAt(lyrics, position);

  const [showLyrics, setShowLyrics] = useState(false);
  const [lyricSize, setLyricSize] = useState(17);
  const rotationAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(0)).current;
  const lyricScrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (isPlaying) {
      rotationAnim.setValue(0);
      Animated.loop(
        Animated.timing(rotationAnim, { toValue: 1, duration: 12000, easing: Easing.linear, useNativeDriver: true }),
      ).start();
    } else {
      rotationAnim.stopAnimation();
    }
  }, [isPlaying, currentIndex]);

  const spin = rotationAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const panResponder = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, gs) => Math.abs(gs.dx) > 15 || Math.abs(gs.dy) > 15,
    onPanResponderMove: (_, gs) => slideAnim.setValue(gs.dx),
    onPanResponderRelease: (_, gs) => {
      if (Math.abs(gs.dx) > SW * 0.25) {
        const dir = gs.dx > 0 ? 1 : -1;
        Animated.timing(slideAnim, { toValue: dir * SW, duration: ANIM_DURATION, easing: Easing.inOut(Easing.ease), useNativeDriver: true }).start(() => {
          slideAnim.setValue(0);
          if (dir > 0) MusicEngine.prev(); else MusicEngine.next();
        });
      } else if (gs.dy > 60) {
        onCloseRef.current();
        slideAnim.setValue(0);
      } else {
        Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true }).start();
      }
    },
  })).current;

  useEffect(() => {
    if (lrcIdx >= 0 && showLyrics && lyricScrollRef.current) {
      try { lyricScrollRef.current.scrollTo({ y: Math.max(0, lrcIdx * (lyricSize * 1.6) - 80), animated: true }); } catch {}
    }
  }, [lrcIdx, showLyrics, lyricSize]);

  if (!visible || !track) return null;

  const modeLabel = playMode === 'sequential' ? '🔁' : playMode === 'random' ? '🔀' : '🔂';

  return (
    <View style={styles.root}>
      <View style={[styles.backdrop, isDark && styles.backdropD]} />
      <Animated.View style={[styles.page, { transform: [{ translateX: slideAnim }] }]} {...panResponder.panHandlers}>
        {/* Top bar */}
        <View style={styles.topBar}>
          <Pressable onPress={onClose} style={styles.topBtn}>
            <Text style={styles.topBtnT}>▾</Text>
          </Pressable>
          <View style={styles.topCenter}>
            <Text style={[styles.topTitle, isDark && styles.tL]} numberOfLines={1}>{track.title || '未知'}</Text>
            <Text style={[styles.topSub, isDark && styles.tS]} numberOfLines={1}>
              {[track.joinMemberNames, track.subTitle, track.albumName].filter(Boolean).join(' · ') || '官方音乐'}
            </Text>
          </View>
          <Pressable onPress={() => setShowLyrics(!showLyrics)} style={styles.topBtn}>
            <Text style={[styles.topBtnT, lyrics.length > 0 && styles.topBtnOn]}>词</Text>
          </Pressable>
        </View>

        {showLyrics ? (
          <>
            <View style={styles.lyricToolRow}>
              <Pressable onPress={() => setLyricSize((s) => Math.max(13, s - 2))} style={styles.lyricToolBtn}>
                <Text style={styles.lyricToolT}>A-</Text>
              </Pressable>
              <Pressable onPress={() => setLyricSize((s) => Math.min(24, s + 2))} style={styles.lyricToolBtn}>
                <Text style={styles.lyricToolT}>A+</Text>
              </Pressable>
            </View>
            <ScrollView ref={lyricScrollRef} style={styles.lyricScroll} showsVerticalScrollIndicator={false}>
              <View style={{ height: 120 }} />
              {lyrics.length > 0 ? lyrics.map((l, i) => (
                <Pressable key={i} onPress={() => { const t = lyricTimeForIndex(lyrics, i); if (t >= 0) MusicEngine.seek(t); }}>
                  <Text style={[styles.lyricLine, { fontSize: lyricSize, lineHeight: lyricSize * 1.6 }, i === lrcIdx && styles.lyricLineOn, isDark && styles.lyricLineD]}>
                    {l.text}
                  </Text>
                </Pressable>
              )) : <Text style={[styles.lyricLine, isDark && styles.lyricLineD]}>暂无歌词</Text>}
              <View style={{ height: 200 }} />
            </ScrollView>
          </>
        ) : (
          <View style={styles.discWrap}>
            <Animated.View style={[styles.disc, { transform: [{ rotate: spin }] }]}>
              <View style={styles.discInner}>
                <Text style={styles.discText}>♪</Text>
              </View>
            </Animated.View>
          </View>
        )}

        {/* Controls */}
        <View style={styles.ctrlWrap}>
          <View style={styles.progressRow}>
            <Text style={[styles.progTime, isDark && styles.tS]}>{formatTime(position)}</Text>
            <View style={styles.progBg}>
              <View style={[styles.progFg, { width: `${progress * 100}%` as any }]} />
            </View>
            <Text style={[styles.progTime, isDark && styles.tS]}>{formatTime(duration)}</Text>
          </View>
          <View style={styles.btnRow}>
            <Pressable onPress={MusicEngine.cycleMode} style={styles.sideBtn}>
              <Text style={styles.modeLabel}>{modeLabel}</Text>
            </Pressable>
            <Pressable onPress={() => MusicEngine.prev()} style={styles.sideBtn}>
              <Text style={styles.sideIcon}>⏮</Text>
            </Pressable>
            <Pressable onPress={MusicEngine.togglePause} style={styles.playBtn}>
              <Text style={styles.playIcon}>{isPlaying ? '⏸' : '▶'}</Text>
            </Pressable>
            <Pressable onPress={() => MusicEngine.next()} style={styles.sideBtn}>
              <Text style={styles.sideIcon}>⏭</Text>
            </Pressable>
            <Pressable onPress={() => {}} style={styles.sideBtn}>
              <Text style={styles.sideIcon}>≡</Text>
            </Pressable>
          </View>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, zIndex: 999, elevation: 999 },
  backdrop: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(255,255,255,0.96)' },
  backdropD: { backgroundColor: 'rgba(10,10,10,0.96)' },
  page: { flex: 1 },
  topBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingTop: 48, paddingBottom: 8 },
  topBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  topBtnT: { fontSize: 22, color: '#333' },
  topBtnOn: { color: '#ff6f91', fontWeight: '800' },
  topCenter: { flex: 1, alignItems: 'center' },
  topTitle: { fontSize: 16, fontWeight: '700', color: '#222' },
  topSub: { fontSize: 11, color: '#888', marginTop: 2 },
  discWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  disc: { width: 240, height: 240, borderRadius: 120, backgroundColor: '#333', alignItems: 'center', justifyContent: 'center', borderWidth: 8, borderColor: 'rgba(0,0,0,0.12)' },
  discInner: { width: 80, height: 80, borderRadius: 40, backgroundColor: '#ff6f91', alignItems: 'center', justifyContent: 'center' },
  discText: { color: '#fff', fontSize: 32 },
  lyricScroll: { flex: 1 },
  lyricToolRow: { flexDirection: 'row', justifyContent: 'center', gap: 12, paddingVertical: 6 },
  lyricToolBtn: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.06)' },
  lyricToolT: { fontSize: 12, color: '#555' },
  lyricLine: { fontSize: 15, color: '#999', textAlign: 'center', paddingVertical: 8, lineHeight: 26 },
  lyricLineD: { color: '#555' },
  lyricLineOn: { color: '#ff6f91', fontWeight: '900', fontSize: 21, textShadowColor: 'rgba(255,111,145,0.3)', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 8 },
  ctrlWrap: { paddingHorizontal: 20, paddingBottom: 32 },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 },
  progTime: { fontSize: 10, color: '#888', width: 40, textAlign: 'center' },
  progBg: { flex: 1, height: 3, borderRadius: 2, backgroundColor: 'rgba(0,0,0,0.08)', overflow: 'hidden' },
  progFg: { height: 3, borderRadius: 2, backgroundColor: '#ff6f91' },
  btnRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 },
  sideBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  sideIcon: { fontSize: 20, color: '#ff6f91' },
  modeLabel: { fontSize: 16 },
  playBtn: { width: 60, height: 60, borderRadius: 30, backgroundColor: '#ff6f91', alignItems: 'center', justifyContent: 'center' },
  playIcon: { fontSize: 26, color: '#fff' },
  tL: { color: '#eee' }, tS: { color: '#aaa' },
});
