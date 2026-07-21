import React, { useCallback, useEffect, useRef, useState } from 'react';
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
import { useSettingsStore } from '../store';
import { MusicEngine } from '../services/musicPlayer';
import CoverArt from './CoverArt';

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
  const rawCover = (track?.coverUrl || track?.cover || track?.thumbPath || '') as string;
  const coverUri = rawCover ? (rawCover.startsWith('http') ? rawCover : `https://source.48.cn${rawCover.startsWith('/') ? rawCover : '/' + rawCover}`) : '';

  const progRef = useRef<View>(null);
  const progW = useRef(0);
  const seekProgress = (px: number) => {
    if (duration <= 0) return;
    progRef.current?.measure((_x, _y, _w, _h, x0) => {
      const ratio = Math.max(0, Math.min(1, (px - x0) / progW.current));
      MusicEngine.seek(ratio * duration);
    });
  };

  // 进度条拖拽：按下即 seek，移动实时跟手
  const progPanMini = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (e: GestureResponderEvent) => seekProgress(e.nativeEvent.pageX),
    onPanResponderMove: (e: GestureResponderEvent) => seekProgress(e.nativeEvent.pageX),
    onPanResponderRelease: () => {},
  })).current;

  const rotationAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const translateY = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!isPlaying) return;
    // 不重置到 0：暂停冻结在原角度，恢复无跳变、loop 回绕无缝
    const loop = Animated.loop(
      Animated.timing(rotationAnim, { toValue: 1, duration: 8000, easing: Easing.linear, useNativeDriver: true }),
    );
    loop.start();
    return () => { loop.stop(); };
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

  if (!track || playbackState === 'idle') return null;

  return (
    <Animated.View style={[styles.bar, isDark && styles.barD, SHADOW, { transform: [{ translateY }] }]} {...panResponder.panHandlers}>
      <View ref={progRef} style={styles.progressBar} onLayout={e => { progW.current = e.nativeEvent.layout.width; }} {...progPanMini.panHandlers}>
        <View style={[styles.progressTrack, isDark && styles.progressTrackD]} />
        <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
        <View style={[styles.progressThumb, { left: `${progress * 100}%` }, isDark && styles.progressThumbD]} />
      </View>
      <Pressable style={styles.row} onPress={onOpenFullScreen}>
        <Animated.View style={[styles.cover, { transform: [{ rotate: spin }] }]}>
          <CoverArt uri={coverUri || undefined} title={track.title || '♪'} size={52} round />
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
  progressBar: { height: 28, justifyContent: 'center' },
  progressTrack: { position: 'absolute', left: 0, right: 0, height: 3, borderRadius: 2, backgroundColor: 'rgba(0,0,0,0.12)' },
  progressTrackD: { backgroundColor: 'rgba(255,255,255,0.2)' },
  progressFill: { position: 'absolute', left: 0, height: 3, borderRadius: 2, backgroundColor: '#ff6f91' },
  progressThumb: { position: 'absolute', top: 8, width: 12, height: 12, borderRadius: 6, backgroundColor: '#ff6f91', borderWidth: 2, borderColor: '#fff', transform: [{ translateX: -6 }] },
  progressThumbD: { borderColor: '#222' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cover: { width: 52, height: 52, borderRadius: 26, backgroundColor: '#1a1a1a', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'rgba(0,0,0,0.15)', overflow: 'hidden' },
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
