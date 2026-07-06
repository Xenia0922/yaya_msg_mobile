import React, { useEffect, useMemo, useRef } from 'react';
import {
  Animated,
  Easing,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useMusicPlayerStore } from '../store/musicPlayerStore';
import { useSettingsStore } from '../store';
import { MusicEngine } from '../services/musicPlayer';

const ANIM_DURATION = 300;
const SHADOW = {
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.1,
  shadowRadius: 4,
  elevation: 6,
};

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

interface Props {
  onOpenFullScreen?: () => void;
}

export default function MiniPlayerBar({ onOpenFullScreen }: Props) {
  const isDark = useSettingsStore((s) => s.settings.theme === 'dark');
  const currentIndex = useMusicPlayerStore((s) => s.currentIndex);
  const queue = useMusicPlayerStore((s) => s.queue);
  const playbackState = useMusicPlayerStore((s) => s.playbackState);
  const playMode = useMusicPlayerStore((s) => s.playMode);
  const duration = useMusicPlayerStore((s) => s.duration);
  const position = useMusicPlayerStore((s) => s.position);

  const track = queue[currentIndex] || null;
  const isPlaying = playbackState === 'playing';
  const progress = duration > 0 ? position / duration : 0;

  const rotationAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const translateY = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (isPlaying) {
      rotationAnim.setValue(0);
      Animated.loop(
        Animated.timing(rotationAnim, {
          toValue: 1, duration: 8000, easing: Easing.linear, useNativeDriver: true,
        }),
      ).start();
    } else {
      rotationAnim.stopAnimation();
    }
  }, [isPlaying, currentIndex]);

  const spin = rotationAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  const panResponder = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, gs) => Math.abs(gs.dy) > 8,
    onPanResponderMove: (_, gs) => { if (gs.dy > 0) translateY.setValue(gs.dy); },
    onPanResponderRelease: (_, gs) => {
      if (gs.dy > 50) {
        Animated.timing(translateY, { toValue: 200, duration: ANIM_DURATION, easing: Easing.inOut(Easing.ease), useNativeDriver: true }).start();
      } else {
        Animated.spring(translateY, { toValue: 0, useNativeDriver: true, bounciness: 4 }).start();
      }
    },
  })).current;

  const pressIn = () => Animated.spring(scaleAnim, { toValue: 0.95, useNativeDriver: true, bounciness: 4 }).start();
  const pressOut = () => Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, bounciness: 4 }).start();

  const modeLabel = playMode === 'sequential' ? '🔁' : playMode === 'random' ? '🔀' : '🔂';

  if (!track || playbackState === 'idle') return null;

  return (
    <Animated.View style={[styles.bar, isDark && styles.barD, SHADOW, { transform: [{ translateY }] }]} {...panResponder.panHandlers}>
      <View style={styles.progressBar}>
        <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
      </View>
      <Pressable style={styles.row} onPress={onOpenFullScreen}>
        <Animated.View style={[styles.cover, { transform: [{ rotate: spin }] }]}>
          <Text style={styles.coverText}>♪</Text>
        </Animated.View>
        <View style={styles.info}>
          <Text style={[styles.title, isDark && styles.tL]} numberOfLines={1}>{track.title || '未知'}</Text>
          <Text style={[styles.artist, isDark && styles.tS]} numberOfLines={1}>
            {[track.joinMemberNames, track.subTitle, track.albumName].filter(Boolean).join(' · ') || '官方音乐'}
          </Text>
        </View>
        <View style={styles.actions}>
          <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
            <Pressable onPress={MusicEngine.togglePause} onPressIn={pressIn} onPressOut={pressOut} style={styles.btn}>
              <Text style={styles.btnIcon}>{isPlaying ? '⏸' : '▶'}</Text>
            </Pressable>
          </Animated.View>
          <Pressable onPress={() => MusicEngine.next()} onPressIn={pressIn} onPressOut={pressOut} style={styles.btn}>
            <Text style={styles.btnIcon}>⏭</Text>
          </Pressable>
          <Pressable onPress={MusicEngine.cycleMode} onPressIn={pressIn} onPressOut={pressOut} style={styles.modeBtn}>
            <Text style={styles.modeText}>{modeLabel}</Text>
          </Pressable>
        </View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(255,255,255,0.96)', borderTopLeftRadius: 18, borderTopRightRadius: 18, paddingBottom: 8, paddingTop: 4, paddingHorizontal: 14 },
  barD: { backgroundColor: 'rgba(22,22,22,0.96)' },
  progressBar: { height: 2, borderRadius: 1, backgroundColor: 'rgba(0,0,0,0.08)', overflow: 'hidden', marginBottom: 8 },
  progressFill: { height: 2, backgroundColor: '#ff6f91' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cover: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#ff6f91', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'rgba(255,111,145,0.3)' },
  coverText: { color: '#fff', fontSize: 18 },
  info: { flex: 1, minWidth: 0 },
  title: { fontSize: 14, fontWeight: '700', color: '#222' },
  artist: { fontSize: 11, color: '#888', marginTop: 1 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  btn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  btnIcon: { fontSize: 16, color: '#ff6f91' },
  modeBtn: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  modeText: { fontSize: 12 },
  tL: { color: '#eee' }, tS: { color: '#aaa' },
});
