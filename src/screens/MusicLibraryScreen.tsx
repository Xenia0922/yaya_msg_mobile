import React, { useEffect, useMemo, useRef, useState } from 'react';
import { PerfFlatList } from '../components/PerfFlatList';

import {
  FlatList,
  Image,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Video from 'react-native-video';
import officialMediaApi from '../api/officialMedia';
import { useSettingsStore } from '../store';
import { useMusicPlayerStore } from '../store/musicPlayerStore';
import { MusicEngine, mediaUrl as buildMediaUrl } from '../services/musicPlayer';
import { errorMessage, unwrapList } from '../utils/data';
import { formatTimestamp } from '../utils/format';
import ScreenHeader from '../components/ScreenHeader';
import MiniPlayerBar from '../components/MiniPlayerBar';
import FullScreenPlayer from '../components/FullScreenPlayer';

function normalizeMusic(res: any): any[] {
  return unwrapList(res, ['content.data', 'content.list', 'data.data', 'data.list', 'list']);
}

function mergeUniqueMusic(current: any[], next: any[]): any[] {
  const seen = new Set(current.map((item) => String(item.musicId || item.id)).filter(Boolean));
  const merged = [...current];
  next.forEach((item) => {
    const key = String(item.musicId || item.id || '');
    if (!key || seen.has(key)) return;
    seen.add(key);
    merged.push(item);
  });
  return merged;
}

function nextCtimeFrom(list: any[]): number {
  const times = list.map((item) => Number(item.ctime)).filter((item) => Number.isFinite(item) && item > 0);
  return times.length ? Math.min(...times) : 0;
}

export default function MusicLibraryScreen() {
  const isDark = useSettingsStore((state) => state.settings.theme === 'dark');
  const playbackState = useMusicPlayerStore((s) => s.playbackState);
  const playUrl = useMusicPlayerStore((s) => s.url);
  const currentIndex = useMusicPlayerStore((s) => s.currentIndex);
  const queue = useMusicPlayerStore((s) => s.queue);
  const playMode = useMusicPlayerStore((s) => s.playMode);
  const [songs, setSongs] = useState<any[]>([]);
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState('ALL');
  const [status, setStatus] = useState('加载中...');
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [nextCtime, setNextCtime] = useState(0);
  const [showFullScreen, setShowFullScreen] = useState(false);
  const loadingRef = useRef(false);
  const videoRef = useRef<any>(null);
  // Keep MusicEngine ref in sync whenever Video element exists
  useEffect(() => { if (videoRef.current) MusicEngine.setVideoRef(videoRef.current); }, [playbackState, playUrl]);

  const filteredSongs = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    let list = songs;
    if (group !== 'ALL') list = list.filter(item => (item.subTitle || item.joinMemberNames || '').toUpperCase().includes(group));
    if (keyword) list = list.filter(item => [item.title, item.subTitle, item.albumName, item.joinMemberNames].filter(Boolean).join(' ').toLowerCase().includes(keyword));
    return list;
  }, [query, songs, group]);

  const load = async (refresh = true) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    const cursor = refresh ? 0 : nextCtime;
    if (refresh) setLoading(true);
    else setLoadingMore(true);
    setStatus(refresh ? '加载中...' : '加载更多...');
    try {
      const res = await officialMediaApi.getMusicList({ ctime: cursor, limit: 20 });
      const list = normalizeMusic(res);
      setSongs((prev) => (refresh ? mergeUniqueMusic([], list) : mergeUniqueMusic(prev, list)));
      const nct = nextCtimeFrom(list);
      setNextCtime(nct);
      const more = list.length >= 20 && nct > 0;
      setHasMore(more);
      setStatus(refresh ? (list.length ? `已加载 ${list.length} 首` : '暂无资源') : '');
    } catch (error) {
      setStatus(`加载失败：${errorMessage(error)}`);
      setHasMore(false);
    } finally {
      loadingRef.current = false;
      setLoading(false);
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    load(true);
    MusicEngine.setUrlResolver(async (track) => {
      const res = await officialMediaApi.getMusic(String(track.musicId || track.id));
      const data = res?.content?.data || res?.content || res?.data || {};
      return buildMediaUrl(String(data.filePath || data.musicPath || data.playStreamPath || data.audioPath || data.url || ''));
    });
  }, []);

  // 自动翻页：每次加载完毕且有更多数据时，继续加载（桌面版行为）
  useEffect(() => {
    if (loading || loadingMore || !hasMore) return;
    const id = setTimeout(() => load(false), 300);
    return () => clearTimeout(id);
  }, [loading, loadingMore, hasMore]);

  const loadMore = () => {
    if (loading || loadingMore || loadingRef.current || !hasMore) return;
    load(false);
  };

  const playSong = async (item: any) => {
    await MusicEngine.playTrack(item, songs);
  };

  return (
    <View style={[styles.container, isDark && styles.containerDark]}>
      <ScreenHeader title="音乐" right={
        <TouchableOpacity onPress={() => load(true)} disabled={loading}>
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
          <Text style={[styles.status, isDark && styles.textSubDark]}>{loading ? '加载中...' : status}</Text>
        </View>
      ) : null}
      <PerfFlatList
          data={filteredSongs}
          keyExtractor={(item, index) => String(item.musicId || item.id || index)}
          numColumns={2}
          contentContainerStyle={[styles.listContent, playbackState !== 'idle' && { paddingBottom: 80 }]}
          columnWrapperStyle={styles.gridRow}
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          renderItem={({ item, index }) => {
            const active = queue[currentIndex] && (String(queue[currentIndex].musicId || queue[currentIndex].id) === String(item.musicId || item.id));
            const coverUrl = item.thumbPath ? `https://source.48.cn${item.thumbPath}` : '';
            return (
              <TouchableOpacity
                style={[styles.songItem, isDark && styles.cardDark, active && styles.songItemActive]}
                onPress={() => playSong(item)}
                activeOpacity={0.7}
              >
                <View style={styles.coverWrap}>
                  {coverUrl ? (
                    <Image source={{ uri: coverUrl }} style={styles.coverImg} resizeMode="cover" />
                  ) : (
                    <View style={[styles.coverPlaceholder, active && { backgroundColor: '#ff6f91' }]}>
                      <Text style={styles.coverPlaceholderText}>♪</Text>
                    </View>
                  )}
                </View>
                <View style={styles.songInfo}>
                  <Text style={[styles.songTitle, isDark && styles.textDark]} numberOfLines={2}>{item.title || '无标题'}</Text>
                  <Text style={[styles.songArtist, isDark && styles.textSubDark]} numberOfLines={1}>
                    {item.joinMemberNames || item.subTitle || item.albumName || ''}
                  </Text>
                  <Text style={[styles.dateText, isDark && styles.textSubDark]}>
                    {formatTimestamp(item.ctime).slice(0, 10)}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          }}
        />
      {playbackState !== 'idle' && playUrl ? (
        <Video
          ref={videoRef}
          source={{ uri: playUrl }}
          style={styles.tinyPlayer}
          paused={playbackState !== 'playing'}
          ignoreSilentSwitch="ignore"
          onLoad={(e) => MusicEngine.onLoad(e.duration || 0)}
          onProgress={(e) => MusicEngine.onProgress(e.currentTime || 0)}
          onEnd={() => {
            if (playMode === 'single') {
              useMusicPlayerStore.getState().setPosition(0);
              useMusicPlayerStore.getState().setPlaybackState('paused');
              setTimeout(() => useMusicPlayerStore.getState().setPlaybackState('playing'), 50);
            } else {
              MusicEngine.next();
            }
          }}
          onError={() => { MusicEngine.next(); }}
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
  gridRow: { justifyContent: 'space-between' as const },
  songItem: { width: '48%', marginBottom: 12, borderRadius: 12, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.82)' },
  cardDark: { backgroundColor: 'rgba(20,20,20,0.72)' },
  songItemActive: { borderWidth: 2, borderColor: '#ff6f91' },
  coverWrap: { width: '100%', aspectRatio: 1, backgroundColor: '#111' },
  coverImg: { width: '100%', height: '100%' },
  coverPlaceholder: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center', backgroundColor: '#e8e8e8' },
  coverPlaceholderText: { color: '#fff', fontSize: 28, fontWeight: '800', opacity: 0.5 },
  songInfo: { padding: 8 },
  songTitle: { fontSize: 13, fontWeight: '700', color: '#222', lineHeight: 17 },
  songArtist: { fontSize: 11, color: '#888', marginTop: 3 },
  dateText: { fontSize: 10, color: '#aaa', marginTop: 3 },
  tinyPlayer: { width: 0, height: 0 },
  textDark: { color: '#eee' },
  textSubDark: { color: '#eeeeee' },
});
