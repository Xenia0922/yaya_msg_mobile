import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Easing,
  FlatList,
  GestureResponderEvent,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useMusicPlayerStore } from '../store/musicPlayerStore';
import { useSettingsStore } from '../store';
import { MusicEngine } from '../services/musicPlayer';
import { lyricIndexAt, lyricTimeForIndex } from '../utils/lyrics';
import CoverArt from './CoverArt';

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
  const coverUrl = useMusicPlayerStore((s) => s.coverUrl);
  const favorites = useMusicPlayerStore((s) => s.favorites);
  const toggleFavorite = useMusicPlayerStore((s) => s.toggleFavorite);
  const [showQueue, setShowQueue] = useState(false);
  const track = queue[currentIndex] || null;
  const trackFavId = track ? String(track.musicId || track.id || '') : '';
  const isFav = trackFavId ? favorites.includes(trackFavId) : false;

  const isPlaying = playbackState === 'playing';
  const progress = duration > 0 ? position / duration : 0;
  const lrcIdx = lyricIndexAt(lyrics, position);
  const progRef2 = useRef<View>(null);
  const progW2 = useRef(0);
  // 拖拽预览：按下/移动时本地实时跟手，松手才真正 seek（避免频繁打断播放）
  const [dragRatio, setDragRatio] = useState<number | null>(null);
  // 用 ref 缓存最近一次有效 ratio：松手事件（onResponderRelease）的 locationX 常为 0，
  // 直接读会导致 seek(0) 弹回开头；改用 grant/move 时记下的真实 ratio。
  const dragRatioRef = useRef<number>(0);
  // 手势有效性守卫：只有「按下时轨道宽度已测到」才算有效拖拽；否则（全屏页刚弹出首帧、
  // 旋转后布局未就绪，progW2 仍为 0）ratioFromX 会因 `|| 1` 把任意位置算成 0/100%，误 seek 到开头/结尾。
  const gestureActive = useRef(false);
  const ratioFromX = (x: number): number | null => {
    const w = progW2.current;
    if (!w || w < 2) return null;
    return Math.max(0, Math.min(1, x / w));
  };
  const onProgGrant = (e: any) => {
    const r = ratioFromX(e.nativeEvent.locationX);
    if (r == null) { gestureActive.current = false; return; }
    gestureActive.current = true;
    dragRatioRef.current = r;
    setDragRatio(r);
  };
  const onProgMove = (e: any) => {
    const r = ratioFromX(e.nativeEvent.locationX);
    if (r == null) return;
    dragRatioRef.current = r;
    setDragRatio(r);
  };
  const onProgRelease = () => {
    const r = dragRatioRef.current;
    // 仅有效手势才真正 seek；无效手势（宽度未知）不碰进度，杜绝误跳开头/结尾
    if (gestureActive.current && duration > 0) MusicEngine.seek(r * duration);
    gestureActive.current = false;
    dragRatioRef.current = 0;
    setDragRatio(null);
  };

  const [showLyrics, setShowLyrics] = useState(false);
  const [lyricSize, setLyricSize] = useState(17);
  const [spacerH, setSpacerH] = useState(160);
  const rotationAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(0)).current;
  const lyricScrollRef = useRef<ScrollView>(null);
  const lrcScrollH = useRef(400);
  // 每行歌词在 ScrollView 内容里的 y 偏移（onLayout 实测），用于自适应居中滚动
  const lineYOffsets = useRef<number[]>([]);

  // 歌词变化：重置实测偏移数组
  useEffect(() => { lineYOffsets.current = new Array(lyrics.length).fill(0); }, [lyrics]);

  // 黑胶旋转：仅在播放时转，暂停冻结原角度；用「递增值 + 递归 timing」保证 loop 边界不冻结、持续旋转。
  useEffect(() => {
    if (!isPlaying) return;
    let cancelled = false;
    let current = (rotationAnim as any).__turns ?? 0;
    const step = () => {
      if (cancelled) return;
      const next = current + 1;
      Animated.timing(rotationAnim, {
        toValue: next,
        duration: 12000,
        easing: Easing.linear,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished && !cancelled) { current = next; (rotationAnim as any).__turns = current; step(); }
      });
    };
    step();
    return () => { cancelled = true; rotationAnim.stopAnimation(); };
  }, [isPlaying, currentIndex]);

  const spin = rotationAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const panResponder = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, gs) => Math.abs(gs.dy) > 15,
    onPanResponderMove: (_, gs) => { if (Math.abs(gs.dy) > 15) slideAnim.setValue(gs.dy); },
    onPanResponderRelease: (_, gs) => {
      if (gs.dy > 60) {
        onCloseRef.current();
        slideAnim.setValue(0);
      } else {
        Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true }).start();
      }
    },
  })).current;

  // 自适应歌词滚动：用实测的每行 y 偏移 + ScrollView 可视高度做居中，
  // 不再写死「-8 行」，自动适配字号、行高、屏幕尺寸。
  useEffect(() => {
    if (lrcIdx < 0 || !showLyrics || !lyricScrollRef.current) return;
    const y = lineYOffsets.current[lrcIdx] ?? 0;
    const lineH = lyricSize * 1.6 + 16;
    const timer = setTimeout(() => {
      const target = Math.max(0, y - lrcScrollH.current / 2 + lineH / 2);
      lyricScrollRef.current?.scrollTo?.({ y: target, animated: true });
    }, 30);
    return () => clearTimeout(timer);
  }, [lrcIdx, showLyrics, lyricSize, lyrics]);

  if (!visible || !track) return null;

  return (
    <View style={styles.root}>
      <View style={[styles.backdrop, isDark && styles.backdropD]} />
      <Animated.View style={[styles.page, { transform: [{ translateX: slideAnim }] }]} {...panResponder.panHandlers}>
        {/* Top bar：左侧关闭，中间歌名居中（右侧留等宽占位保证歌名真正居中） */}
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
          <View style={styles.topBtn} />
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
            <ScrollView ref={lyricScrollRef} style={styles.lyricScroll} showsVerticalScrollIndicator={false}
              onLayout={e => { lrcScrollH.current = e.nativeEvent.layout.height; setSpacerH(Math.max(120, lrcScrollH.current / 2)); }}>
              <View style={{ height: spacerH }} />
              {lyrics.length > 0 ? lyrics.map((l, i) => (
                <Pressable
                  key={i}
                  onLayout={e => { lineYOffsets.current[i] = e.nativeEvent.layout.y; }}
                  onPress={() => { const t = lyricTimeForIndex(lyrics, i); if (t >= 0) MusicEngine.seek(t); }}
                >
                  <Text style={[styles.lyricLine, { fontSize: lyricSize, lineHeight: lyricSize * 1.6 }, i === lrcIdx && styles.lyricLineOn, isDark && styles.lyricLineD]}>
                    {l.text}
                  </Text>
                </Pressable>
              )) : <Text style={[styles.lyricLine, isDark && styles.lyricLineD]}>暂无歌词</Text>}
              <View style={{ height: spacerH }} />
            </ScrollView>
          </>
        ) : (
          <View style={styles.discWrap}>
            <Animated.View style={[styles.disc, { transform: [{ rotate: spin }] }]}>
              <CoverArt uri={coverUrl || undefined} title={track.title || '♪'} size={240} round />
            </Animated.View>
          </View>
        )}

        {/* Controls */}
        <View style={styles.ctrlWrap}>
          <View style={styles.progressRow}>
            <Text style={[styles.progTime, isDark && styles.tS]}>{formatTime(position)}</Text>
            <View
              ref={progRef2}
              style={styles.progBg}
              onLayout={e => { progW2.current = e.nativeEvent.layout.width; }}
              onStartShouldSetResponder={() => true}
              onMoveShouldSetResponder={() => true}
              onResponderGrant={onProgGrant}
              onResponderMove={onProgMove}
              onResponderRelease={onProgRelease}
            >
              <View style={[styles.progTrack, isDark && styles.progTrackD]} />
              <View style={[styles.progFg, { width: `${(dragRatio ?? progress) * 100}%` as any }]} />
              <View style={[styles.progThumb, { left: `${(dragRatio ?? progress) * 100}%` as any }, isDark && styles.progThumbD]} />
            </View>
            <Text style={[styles.progTime, isDark && styles.tS]}>{formatTime(duration)}</Text>
          </View>
          <View style={styles.btnRow}>
            <Pressable
              onPress={() => { if (trackFavId) toggleFavorite(trackFavId); }}
              style={[styles.sideBtn, isFav && styles.favOn]}
            >
              <Icon name={isFav ? 'heart' : 'heart-outline'} size={22} color={isFav ? '#ff3b5c' : (isDark ? '#ccc' : '#666')} />
            </Pressable>
            <Pressable onPress={MusicEngine.cycleMode} style={styles.sideBtn}>
              <Icon name={playMode === 'single' ? 'repeat-once' : playMode === 'random' ? 'shuffle-variant' : 'repeat'} size={22} color={isDark ? '#ccc' : '#666'} />
            </Pressable>
            <Pressable onPress={() => MusicEngine.prev()} style={styles.sideBtn}>
              <Icon name="skip-previous" size={30} color={isDark ? '#eee' : '#333'} />
            </Pressable>
            <Pressable onPress={MusicEngine.togglePause} style={styles.playBtn}>
              <Icon name={isPlaying ? 'pause' : 'play'} size={38} color="#fff" />
            </Pressable>
            <Pressable onPress={() => MusicEngine.next()} style={styles.sideBtn}>
              <Icon name="skip-next" size={30} color={isDark ? '#eee' : '#333'} />
            </Pressable>
            <Pressable onPress={() => setShowLyrics(!showLyrics)} style={[styles.sideBtn, showLyrics && styles.lyricOn]}>
              <Text style={[styles.btnLabel, isDark && styles.btnLabelD, showLyrics && styles.btnLabelOn]}>词</Text>
            </Pressable>
            <Pressable onPress={() => setShowQueue(true)} style={styles.sideBtn}>
              <Icon name="playlist-music" size={22} color={isDark ? '#ccc' : '#666'} />
            </Pressable>
          </View>
        </View>
      </Animated.View>
      <Modal visible={showQueue} transparent animationType="slide" onRequestClose={() => setShowQueue(false)}>
        <TouchableOpacity style={styles.queueMask} activeOpacity={1} onPress={() => setShowQueue(false)}>
          <View style={[styles.queueSheet, isDark && styles.queueSheetD]} onStartShouldSetResponder={() => true}>
            <View style={styles.queueHandle} />
            <View style={styles.queueHeader}>
              <Text style={[styles.queueTitle, isDark && styles.tL]}>播放列表（{queue.length}）</Text>
              <TouchableOpacity onPress={() => setShowQueue(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Icon name="close" size={20} color={isDark ? '#ccc' : '#666'} />
              </TouchableOpacity>
            </View>
            <FlatList
              data={queue}
              keyExtractor={(t, i) => String(t.musicId || t.id || i)}
              initialNumToRender={12}
              renderItem={({ item, index }) => {
                const active = index === currentIndex;
                const id = String(item.musicId || item.id || index);
                const cu = (item.coverUrl || item.cover || item.thumbPath || '') as string;
                const uri = cu ? (cu.startsWith('http') ? cu : `https://source.48.cn${cu.startsWith('/') ? cu : '/' + cu}`) : undefined;
                return (
                  <TouchableOpacity
                    style={[styles.queueItem, isDark && styles.queueItemD, active && styles.queueItemActive]}
                    onPress={() => { MusicEngine.playAt(index); setShowQueue(false); }}
                  >
                    <CoverArt uri={uri} title={item.title || '♪'} size={42} round active={active} />
                    <View style={styles.queueInfo}>
                      <Text style={[styles.queueTitle2, isDark && styles.tL]} numberOfLines={1}>{item.title || '未知'}</Text>
                      <Text style={[styles.queueSub, isDark && styles.tS]} numberOfLines={1}>
                        {[item.albumName || item.album, item.joinMemberNames || item.artist].filter(Boolean).join(' · ') || '官方音乐'}
                      </Text>
                    </View>
                    {active ? <Icon name="volume-high" size={18} color="#ff6f91" /> : null}
                  </TouchableOpacity>
                );
              }}
            />
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, zIndex: 999, elevation: 999 },
  backdrop: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: '#ffffff' },
  backdropD: { backgroundColor: '#111111' },
  page: { flex: 1 },
  topBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingTop: 48, paddingBottom: 8 },
  topBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  topBtnT: { fontSize: 22, color: '#333' },
  topBtnOn: { color: '#ff6f91', fontWeight: '800' },
  topCenter: { flex: 1, alignItems: 'center' },
  topTitle: { fontSize: 16, fontWeight: '700', color: '#222' },
  topSub: { fontSize: 11, color: '#888', marginTop: 2 },
  discWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  disc: { width: 240, height: 240, borderRadius: 120, backgroundColor: '#1a1a1a', alignItems: 'center', justifyContent: 'center', borderWidth: 8, borderColor: '#0d0d0d', overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.25, shadowRadius: 16, elevation: 8 },
  lyricScroll: { flex: 1 },
  lyricToolRow: { flexDirection: 'row', justifyContent: 'center', gap: 12, paddingVertical: 6 },
  lyricToolBtn: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.06)' },
  lyricToolT: { fontSize: 12, color: '#555' },
  lyricLine: { fontSize: 15, color: '#999', textAlign: 'center', paddingVertical: 8, lineHeight: 26 },
  lyricLineD: { color: '#555' },
  lyricLineOn: { color: '#ff6f91', fontWeight: '900', textShadowColor: 'rgba(255,111,145,0.3)', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 8 },
  ctrlWrap: { paddingHorizontal: 20, paddingBottom: 32 },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 },
  progTime: { fontSize: 10, color: '#888', width: 40, textAlign: 'center' },
  progBg: { flex: 1, height: 28, justifyContent: 'center' },
  progTrack: { position: 'absolute', left: 0, right: 0, height: 4, borderRadius: 2, backgroundColor: 'rgba(0,0,0,0.12)' },
  progTrackD: { backgroundColor: 'rgba(255,255,255,0.18)' },
  progFg: { position: 'absolute', left: 0, height: 4, borderRadius: 2, backgroundColor: '#ff6f91' },
  progThumb: { position: 'absolute', top: 7, width: 14, height: 14, borderRadius: 7, backgroundColor: '#ff6f91', borderWidth: 2, borderColor: '#fff', transform: [{ translateX: -7 }] },
  progThumbD: { borderColor: '#222' },
  btnRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  sideBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  favOn: { backgroundColor: 'rgba(255,59,92,0.12)' },
  lyricOn: { backgroundColor: 'rgba(255,111,145,0.12)' },
  btnLabel: { fontSize: 16, fontWeight: '800', color: '#666' },
  btnLabelD: { color: '#ccc' },
  btnLabelOn: { color: '#ff6f91' },
  playBtn: { width: 60, height: 60, borderRadius: 30, backgroundColor: '#ff6f91', alignItems: 'center', justifyContent: 'center' },
  playIcon: { fontSize: 26, color: '#fff' },
  tL: { color: '#eee' }, tS: { color: '#aaa' },
  // 播放列表
  queueMask: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  queueSheet: { maxHeight: '82%', backgroundColor: '#fff', borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingBottom: 18 },
  queueSheetD: { backgroundColor: '#1b1b1b' },
  queueHandle: { width: 38, height: 4, borderRadius: 2, backgroundColor: '#ddd', alignSelf: 'center', marginTop: 8, marginBottom: 4 },
  queueHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10 },
  queueTitle: { fontSize: 16, fontWeight: '800', color: '#222' },
  queueItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 10 },
  queueItemD: { borderBottomColor: 'rgba(255,255,255,0.08)' },
  queueItemActive: { backgroundColor: 'rgba(255,111,145,0.10)' },
  queueInfo: { flex: 1, minWidth: 0 },
  queueTitle2: { fontSize: 14, fontWeight: '700', color: '#222' },
  queueSub: { fontSize: 11, color: '#888', marginTop: 2 },
  queueUnavail: { fontSize: 10, color: '#ffd479', fontWeight: '700' },
});
