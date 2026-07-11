import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Image,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useMusicPlayerStore } from '../store/musicPlayerStore';
import { useSettingsStore } from '../store';
import { MusicEngine } from '../services/musicPlayer';

const ANIM_DURATION = 300;
const SHADOW = {
  shadowColor: '#000',
  shadowOffset: { width: 0, height: -1 },
  shadowOpacity: 0.04,
  shadowRadius: 3,
  elevation: 3,
};

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
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
  const progress = duration > 0 ? Math.min(1, Math.max(0, position / duration)) : 0;

  const progRef = useRef<View>(null);
  const progW = useRef(0);
  const seekProgress = (px: number) => {
    if (duration <= 0) return;
    progRef.current?.measure((_x, _y, _w, _h, x0) => {
      const ratio = Math.max(0, Math.min(1, (px - x0) / progW.current));
      MusicEngine.seek(ratio * duration);
    });
  };

  const rotationAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const translateY = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let loop: any;
    if (isPlaying) {
      rotationAnim.setValue(0);
      loop = Animated.loop(
        Animated.timing(rotationAnim, {
          toValue: 1, duration: 8000, easing: Easing.linear, useNativeDriver: true,
        }),
      );
      loop.start();
    } else {
      rotationAnim.stopAnimation();
    }
    return () => { if (loop) loop.stop(); };
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

  const modeLabel = playMode === 'sequential' ? '→→' : playMode === 'random' ? '⇄' : '↻';

  if (!track || playbackState === 'idle') return null;

  return (
    <Animated.View style={[styles.bar, isDark && styles.barD, SHADOW, { transform: [{ translateY }] }]} {...panResponder.panHandlers}>
      <Pressable ref={progRef} style={styles.progressBar} onLayout={e => { progW.current = e.nativeEvent.layout.width; }}
        onPress={e => seekProgress(e.nativeEvent.pageX)}>
        <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
      </Pressable>
      <Pressable style={styles.row} onPress={onOpenFullScreen}>
        <Animated.View style={[styles.cover, { transform: [{ rotate: spin }] }]}>
          {track.thumbPath ? (
            <Image source={{ uri: track.thumbPath.startsWith('http') ? track.thumbPath : `https://source.48.cn${track.thumbPath}` }} style={styles.coverImg} />
          ) : (
            <Text style={styles.coverText}>♪</Text>
          )}
        </Animated.View>
        <View style={styles.info}>
          <Text style={[styles.title, isDark && styles.tL]} numberOfLines={1}>{track.title || '未知'}</Text>
          <Text style={[styles.artist, isDark && styles.tS]} numberOfLines={1}>
            {[track.joinMemberNames, track.subTitle, track.albumName].filter(Boolean).join(' · ') || '官方音乐'}
          </Text>
        </View>
        <View style={styles.actions}>
          <Pressable onPress={MusicEngine.cycleMode} onPressIn={pressIn} onPressOut={pressOut} style={styles.modeBtn}>
            <Icon name={playMode === 'single' ? 'repeat-once' : playMode === 'random' ? 'shuffle-variant' : 'repeat'} size={16} color={isDark ? '#aaa' : '#888'} />
          </Pressable>
          <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
            <Pressable onPress={MusicEngine.togglePause} onPressIn={pressIn} onPressOut={pressOut} style={styles.btn}>
              <Icon name={isPlaying ? 'pause-circle' : 'play-circle'} size={30} color="#ff6f91" />
            </Pressable>
          </Animated.View>
          <Pressable onPress={() => MusicEngine.next()} onPressIn={pressIn} onPressOut={pressOut} style={styles.btn}>
            <Icon name="skip-next-circle" size={30} color="#ff6f91" />
          </Pressable>
        </View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(255,255,255,0.96)', borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: 10, paddingTop: 6, paddingHorizontal: 14 },
  barD: { backgroundColor: 'rgba(22,22,22,0.96)' },
  progressBar: { height: 24, justifyContent: 'center', paddingHorizontal: 4, marginBottom: 4, backgroundColor: 'rgba(0,0,0,0.05)', borderRadius: 2 },
  progressFill: { height: 3, borderRadius: 2, backgroundColor: '#ff6f91' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cover: { width: 52, height: 52, borderRadius: 26, backgroundColor: '#ff6f91', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'rgba(255,111,145,0.3)', overflow: 'hidden' },
  coverImg: { width: 52, height: 52, borderRadius: 26 },
  coverText: { color: '#fff', fontSize: 20 },
  info: { flex: 1, minWidth: 0 },
  title: { fontSize: 15, fontWeight: '700', color: '#222' },
  artist: { fontSize: 12, color: '#888', marginTop: 1 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  btn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  btnIcon: { fontSize: 18, color: '#ff6f91' },
  modeBtn: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  modeText: { fontSize: 13, fontWeight: '700', color: '#888' },
  tL: { color: '#eee' }, tS: { color: '#aaa' },
});
