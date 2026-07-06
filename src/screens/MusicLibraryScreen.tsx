import React, { useEffect, useMemo, useRef, useState } from 'react';
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
import { useSettingsStore } from '../store';
import { useMusicPlayerStore } from '../store/musicPlayerStore';
import { MusicEngine, mediaUrl as buildMediaUrl } from '../services/musicPlayer';
import { FadeInView } from '../components/Motion';
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
  const [status, setStatus] = useState('加载中...');
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [nextCtime, setNextCtime] = useState(0);
  const [showFullScreen, setShowFullScreen] = useState(false);
  const loadingRef = useRef(false);
  const videoRef = useRef<any>(null);
  // Keep MusicEngine ref in sync whenever Video element exists
  useEffect(() => { MusicEngine.setVideoRef(videoRef.current); }, [playbackState, playUrl]);

  const filteredSongs = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return songs;
    return songs.filter((item) => [
      item.title,
      item.subTitle,
      item.albumName,
      item.joinMemberNames,
    ].filter(Boolean).join(' ').toLowerCase().includes(keyword));
  }, [query, songs]);

  const load = async (refresh = true) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    const cursor = refresh ? 0 : nextCtime;
    if (refresh) setLoading(true);
    else setLoadingMore(true);
    setStatus(refresh ? '加载中...官方音乐...' : '加载中...更多音乐...');
    try {
      const res = await officialMediaApi.getMusicList({ ctime: cursor, limit: 20 });
      const list = normalizeMusic(res);
      setSongs((prev) => (refresh ? mergeUniqueMusic([], list) : mergeUniqueMusic(prev, list)));
      setNextCtime(nextCtimeFrom(list));
      setHasMore(list.length >= 20 && nextCtimeFrom(list) > 0);
      const loadedCount = refresh ? list.length : mergeUniqueMusic(songs, list).length;
      setStatus(loadedCount ? `已加载 ${loadedCount} 首音乐` : '官方接口暂无音乐资源');
    } catch (error) {
      setStatus(`加载失败：${errorMessage(error)}`);
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
      {status ? <Text style={[styles.status, isDark && styles.textSubDark]}>{loading ? '加载中...' : status}</Text> : null}
      <FadeInView delay={80} duration={300} style={{ flex: 1 }}>
        <FlatList
          data={filteredSongs}
          keyExtractor={(item, index) => String(item.musicId || item.id || index)}
            contentContainerStyle={[styles.listContent, playbackState !== 'idle' && { paddingBottom: 80 }]}
            initialNumToRender={12}
            maxToRenderPerBatch={12}
            windowSize={7}
            removeClippedSubviews
            onEndReached={loadMore}
          onEndReachedThreshold={0.35}
          ListFooterComponent={loadingMore ? <Text style={[styles.status, isDark && styles.textSubDark]}>加载更多...</Text> : null}
          renderItem={({ item, index }) => {
            const active = queue[currentIndex] && (String(queue[currentIndex].musicId || queue[currentIndex].id) === String(item.musicId || item.id));
            return (
            <FadeInView delay={80 + index * 30} duration={300}>
              <TouchableOpacity
                style={[styles.songItem, isDark && styles.cardDark, active && styles.songItemActive]}
                onPress={() => playSong(item)}
              >
                <View style={styles.songInfo}>
                  <Text style={[styles.songTitle, isDark && styles.textDark]} numberOfLines={1}>{item.title || '无标题'}</Text>
                  <Text style={[styles.songArtist, isDark && styles.textSubDark]} numberOfLines={1}>
                    {[item.joinMemberNames, item.subTitle, item.albumName].filter(Boolean).join(' · ') || '官方单曲'}
                  </Text>
                  <Text style={[styles.dateText, isDark && styles.textSubDark]}>{formatTimestamp(item.ctime).slice(0, 10)}</Text>
                </View>
              </TouchableOpacity>
            </FadeInView>
          )}}
        />
      </FadeInView>
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
  status: { margin: 12, color: '#444', fontSize: 13, textAlign: 'center' },
  listContent: { paddingBottom: 120 },
  songItem: { height: 76, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, backgroundColor: 'rgba(255,255,255,0.72)', marginHorizontal: 16, marginVertical: 4, borderRadius: 12 },
  cardDark: { backgroundColor: 'rgba(20,20,20,0.68)' },
  songItemActive: { borderLeftWidth: 3, borderLeftColor: '#ff6f91' },
  songInfo: { flex: 1 },
  songTitle: { fontSize: 15, fontWeight: '700', color: '#333' },
  songArtist: { fontSize: 11, color: '#333333', marginTop: 2 },
  dateText: { fontSize: 11, color: '#333333', marginTop: 4 },
  tinyPlayer: { width: 0, height: 0 },
  textDark: { color: '#eee' },
  textSubDark: { color: '#eeeeee' },
});
