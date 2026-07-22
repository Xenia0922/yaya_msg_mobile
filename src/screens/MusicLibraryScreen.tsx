import React, { useEffect, useMemo, useRef, useState } from 'react';
import { PerfFlatList } from '../components/PerfFlatList';

import {
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Video from 'react-native-video';
import officialMediaApi from '../api/officialMedia';
import { loadOfficialSiteMusic } from '../api/officialSiteMusic';
import { useSettingsStore, useUiStore } from '../store';
import { useMusicPlayerStore } from '../store/musicPlayerStore';
import { MusicEngine, mediaUrl as buildMediaUrl } from '../services/musicPlayer';
import { errorMessage } from '../utils/data';
import { formatTimestamp } from '../utils/format';
import ScreenHeader from '../components/ScreenHeader';
import MiniPlayerBar from '../components/MiniPlayerBar';
import FullScreenPlayer from '../components/FullScreenPlayer';
import CoverArt from '../components/CoverArt';
import { SkeletonGrid } from '../components/Skeleton';

export default function MusicLibraryScreen() {
  const isDark = useSettingsStore((state) => state.settings.theme === 'dark');
  const showToast = useUiStore((state) => state.showToast);
  const playbackState = useMusicPlayerStore((s) => s.playbackState);
  const playUrl = useMusicPlayerStore((s) => s.url);
  const currentIndex = useMusicPlayerStore((s) => s.currentIndex);
  const queue = useMusicPlayerStore((s) => s.queue);
  const playMode = useMusicPlayerStore((s) => s.playMode);
  const [songs, setSongs] = useState<any[]>([]);
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState('ALL');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [showFullScreen, setShowFullScreen] = useState(false);
  const loadingRef = useRef(false);
  const videoRef = useRef<any>(null);
  // Keep MusicEngine ref in sync whenever Video element exists
  useEffect(() => { if (videoRef.current) MusicEngine.setVideoRef(videoRef.current); }, [playbackState, playUrl]);

  const filteredSongs = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    let list = songs;
    if (group !== 'ALL') list = list.filter(item => (item.groupLabel || '') === group);
    if (keyword) list = list.filter(item => [item.title, item.artist, item.album, item.groupLabel].filter(Boolean).join(' ').toLowerCase().includes(keyword));
    return list;
  }, [query, songs, group]);

  // 官方音乐库：从口袋48官网静态 JS 脚本一次拉全部曲库（无 token、无分页）。
  // 之前的移动端实现错用了 /media/api 移动端接口，未登录只返回约 56 首公开子集，
  // 这才导致「列表里好多歌不显示」。改用官网源后拿到的就是完整曲库。
  const loadAll = async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    setStatus('');
    try {
      const all = await loadOfficialSiteMusic(false);
      setSongs(all);
      setHasMore(false);
    } catch (error) {
      setStatus(`加载失败：${errorMessage(error)}`);
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
    MusicEngine.setUrlResolver(async (track: any) => {
      // 官方源歌曲的 mp3 直链即可播放
      if (track?.mp3 && /^https?:/i.test(String(track.mp3))) return String(track.mp3);
      // 回退：个别非官网源曲目尝试移动端接口解析地址
      try {
        const res = await officialMediaApi.getMusic(String(track.musicId || track.id));
        const data = res?.content?.data || res?.content || res?.data || {};
        const url = buildMediaUrl(String(data.filePath || data.musicPath || data.playStreamPath || data.audioPath || data.url || ''));
        if (url) return url;
      } catch { /* ignore */ }
      const fb = buildMediaUrl(String((track as any).filePath || (track as any).musicPath || (track as any).playStreamPath || (track as any).audioPath || (track as any).url || ''));
      if (!fb) throw new Error('无法解析播放地址');
      return fb;
    });
  }, []);

  const playSong = (item: any) => {
    MusicEngine.playTrack(item, songs);
  };

  return (
    <View style={[styles.container, isDark && styles.containerDark]}>
      <ScreenHeader title="音乐" right={
        <TouchableOpacity onPress={() => loadAll()} disabled={loading}>
          <Text style={[styles.backBtn, loading && styles.disabledText]}>刷新</Text>
        </TouchableOpacity>
      } />
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="搜索歌曲、成员、专辑"
        placeholderTextColor={isDark ? '#aaa' : '#4a4a4a'}
        style={[styles.searchInput, isDark && styles.searchInputDark]}
      />
      <View style={styles.groups}>
        {['ALL','SNH48','GNZ48','BEJ48','CKG48','CGT48'].map(g => (
          <TouchableOpacity key={g} onPress={() => setGroup(g)} style={[styles.gChip, group === g && styles.gChipOn]}>
            <Text style={[styles.gText, group === g && styles.gTextOn]}>{g}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {status ? (
        <View pointerEvents="none" style={styles.statusOverlay}>
          <Text style={[styles.status, isDark && styles.textSubDark]}>{status}</Text>
        </View>
      ) : null}
      {loading && songs.length === 0 ? (
        <View style={{ flex: 1 }}>
          <SkeletonGrid count={8} dark={isDark} />
        </View>
      ) : !loading && songs.length === 0 && !status ? (
        <View style={styles.emptyWrap}>
          <Text style={[styles.status, isDark && styles.textSubDark]}>暂无音乐</Text>
        </View>
      ) : (
      <PerfFlatList
          data={filteredSongs}
          keyExtractor={(item, index) => String(item.musicId || item.id || index)}
          numColumns={2}
          removeClippedSubviews={false}
          contentContainerStyle={[styles.listContent, playbackState !== 'idle' && { paddingBottom: 80 }]}
          columnWrapperStyle={styles.gridRow}
          renderItem={({ item, index }) => {
            const id = String(item.musicId || item.id || '');
            const active = queue[currentIndex] && (String(queue[currentIndex].musicId || queue[currentIndex].id) === id);
            const coverUrl = item.coverUrl || item.cover || item.thumbPath || '';
            return (
              <TouchableOpacity
                style={[styles.songItem, isDark && styles.cardDark, active && styles.songItemActive]}
                onPress={() => playSong(item)}
                activeOpacity={0.7}
              >
                <View style={styles.coverWrap}>
                  <CoverArt uri={coverUrl || undefined} title={item.title || '♪'} fill active={active} />
                </View>
                <View style={styles.songInfo}>
                  <Text style={[styles.songTitle, isDark && styles.textDark]} numberOfLines={2}>{item.title || '无标题'}</Text>
                  <Text style={[styles.songArtist, isDark && styles.textSubDark]} numberOfLines={1}>
                    {[item.album, item.artist].filter(Boolean).join(' · ') || ''}
                  </Text>
                  {item.ctime ? (
                    <Text style={[styles.dateText, isDark && styles.textSubDark]}>
                      {formatTimestamp(item.ctime).slice(0, 10)}
                    </Text>
                  ) : null}
                </View>
              </TouchableOpacity>
            );
          }}
        />
      )}
      {playbackState !== 'idle' && playUrl ? (
        <Video
          ref={videoRef}
          source={{ uri: playUrl }}
          style={styles.tinyPlayer}
          paused={playbackState !== 'playing'}
          ignoreSilentSwitch="ignore"
          onLoad={(e) => {
            MusicEngine.onLoad(e.duration || 0);
            const ps = useMusicPlayerStore.getState().pendingSeek;
            if (ps != null && videoRef.current) {
              videoRef.current.seek(ps);
              useMusicPlayerStore.getState().setPendingSeek(null);
            }
          }}
          onProgress={(e) => MusicEngine.onProgress(e.currentTime || 0)}
          onEnd={() => {
            if (playMode === 'single') {
              // 单曲循环：必须显式 seek 回 0，否则真实 Video 停在结尾、仅改 store 进度不会重播，
              // 表现为「单曲循环不继续播放」。MusicEngine.seek 内含 600ms 进度锁，避免 onProgress 把进度覆盖回结尾。
              useMusicPlayerStore.getState().setPosition(0);
              MusicEngine.seek(0);
              useMusicPlayerStore.getState().setPlaybackState('playing');
            } else {
              MusicEngine.next();
            }
          }}
          onError={() => {
            const t = queue[currentIndex];
            showToast(`《${t?.title || '该歌曲'}》无法播放，已跳过`);
            MusicEngine.next();
          }}
        />
      ) : null}
      <MiniPlayerBar onOpenFullScreen={() => setShowFullScreen(true)} />
      <FullScreenPlayer visible={showFullScreen} onClose={() => setShowFullScreen(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  containerDark: { backgroundColor: 'transparent' },
  backBtn: { color: '#ff6f91', fontSize: 14, fontWeight: '700' },
  disabledText: { opacity: 0.45 },
  searchInput: { height: 44, marginHorizontal: 16, marginBottom: 6, paddingHorizontal: 14, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.76)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.78)', color: '#333', fontSize: 14 },
  searchInputDark: { backgroundColor: 'rgba(20,20,20,0.68)', borderColor: 'rgba(255,255,255,0.12)', color: '#eee' },
  groups: { flexDirection: 'row', paddingHorizontal: 12, marginBottom: 4, gap: 6 },
  gChip: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.06)' },
  gChipOn: { backgroundColor: '#ff6f91' },
  gText: { fontSize: 12, color: '#555', fontWeight: '600' },
  gTextOn: { color: '#fff' },
  status: { color: '#ff6f91', fontSize: 12, fontWeight: '700' },
  statusOverlay: { position: 'absolute', top: 140, left: 0, right: 0, zIndex: 10, alignItems: 'center' },
  listContent: { paddingHorizontal: 12, paddingBottom: 120 },
  emptyWrap: { alignItems: 'center', marginTop: 80 },
  gridRow: { justifyContent: 'space-between' as const },
  songItem: { width: '48%', marginBottom: 12, borderRadius: 12, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.82)' },
  cardDark: { backgroundColor: 'rgba(20,20,20,0.72)' },
  songItemActive: { borderWidth: 2, borderColor: '#ff6f91' },
  coverWrap: { width: '100%', aspectRatio: 1, backgroundColor: '#111' },
  coverImg: { width: '100%', height: '100%' },
  coverPlaceholder: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center', backgroundColor: '#e8e8e8' },
  coverPlaceholderText: { color: '#fff', fontSize: 28, fontWeight: '800', opacity: 0.5 },
  unavailableBadge: { position: 'absolute', top: 6, right: 6, backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8 },
  unavailableText: { color: '#ffd479', fontSize: 10, fontWeight: '700' },
  songInfo: { padding: 8 },
  songTitle: { fontSize: 13, fontWeight: '700', color: '#222', lineHeight: 17 },
  songArtist: { fontSize: 11, color: '#888', marginTop: 3 },
  dateText: { fontSize: 10, color: '#aaa', marginTop: 3 },
  tinyPlayer: { width: 0, height: 0 },
  textDark: { color: '#eee' },
  textSubDark: { color: '#eeeeee' },
});
