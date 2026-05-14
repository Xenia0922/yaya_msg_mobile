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
import { useNavigation } from '@react-navigation/native';
import officialMediaApi from '../api/officialMedia';
import { useSettingsStore } from '../store';
import { FadeInView } from '../components/Motion';
import { errorMessage, normalizeUrl, unwrapList } from '../utils/data';
import { formatTimestamp } from '../utils/format';
import ScreenHeader from '../components/ScreenHeader';

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

function mediaUrl(path: string): string {
  if (!path) return '';
  if (path.startsWith('http')) return path;
  return path.startsWith('/') ? `https://mp4.48.cn${path}` : normalizeUrl(path);
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function MusicLibraryScreen() {
  const navigation = useNavigation<any>();
  const isDark = useSettingsStore((state) => state.settings.theme === 'dark');
  const [songs, setSongs] = useState<any[]>([]);
  const [query, setQuery] = useState('');
  const [playing, setPlaying] = useState<any | null>(null);
  const [playUrl, setPlayUrl] = useState('');
  const [paused, setPaused] = useState(false);
  const [duration, setDuration] = useState(0);
  const [position, setPosition] = useState(0);
  const [status, setStatus] = useState('加载中...');
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [nextCtime, setNextCtime] = useState(0);
  const loadingRef = useRef(false);

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
  }, []);

  const loadMore = () => {
    if (loading || loadingMore || loadingRef.current || !hasMore) return;
    load(false);
  };

  const play = async (item: any) => {
    setPlaying(item);
    setPlayUrl('');
    setPaused(false);
    setDuration(0);
    setPosition(0);
    setStatus('正在解析音乐地址...');
    try {
      const res = await officialMediaApi.getMusic(String(item.musicId || item.id));
      const data = res?.content?.data || res?.content || res?.data || {};
      const url = mediaUrl(String(data.filePath || data.musicPath || data.playStreamPath || data.audioPath || data.url || ''));
      if (!url) throw new Error('未返回音乐文件地址');
      setPlayUrl(url);
      setStatus(`正在播放：${item.title || data.title || '音乐'}`);
    } catch (error) {
      setStatus(`播放失败：${errorMessage(error)}`);
    }
  };

  const playByOffset = (offset: number) => {
    const source = filteredSongs.length ? filteredSongs : songs;
    if (!source.length) return;
    const currentKey = String(playing?.musicId || playing?.id || '');
    const currentIndex = source.findIndex((item) => String(item.musicId || item.id || '') === currentKey);
    const baseIndex = currentIndex >= 0 ? currentIndex : 0;
    const nextIndex = (baseIndex + offset + source.length) % source.length;
    play(source[nextIndex]);
  };

  const progress = duration > 0 ? Math.min(1, Math.max(0, position / duration)) : 0;

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
            contentContainerStyle={[styles.listContent, playUrl && styles.listContentWithPlayer]}
            initialNumToRender={12}
            maxToRenderPerBatch={12}
            windowSize={7}
            removeClippedSubviews
            onEndReached={loadMore}
          onEndReachedThreshold={0.35}
          ListFooterComponent={loadingMore ? <Text style={[styles.status, isDark && styles.textSubDark]}>加载更多...</Text> : null}
          renderItem={({ item, index }) => (
            <FadeInView delay={80 + index * 30} duration={300}>
              <TouchableOpacity
                style={[styles.songItem, isDark && styles.cardDark, playing?.musicId === item.musicId && styles.songItemActive]}
                onPress={() => play(item)}
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
          )}
        />
      </FadeInView>
      {playUrl ? (
        <View style={[styles.miniPlayer, isDark && styles.miniPlayerDark]}>
          <Video
            source={{ uri: playUrl }}
            style={styles.tinyPlayer}
            paused={paused}
            controls={false}
            ignoreSilentSwitch="ignore"
            onLoad={(event) => setDuration(event.duration || 0)}
            onProgress={(event) => setPosition(event.currentTime || 0)}
            onEnd={() => playByOffset(1)}
            onError={() => setStatus('音乐播放失败，请换一首试试')}
          />
          <View style={styles.miniTop}>
            <View style={styles.coverArt}>
              <Text style={styles.coverArtText}>♪</Text>
            </View>
            <View style={styles.playerMeta}>
              <Text style={[styles.playerTitle, isDark && styles.textDark]} numberOfLines={1}>{playing?.title || '正在播放'}</Text>
              <Text style={[styles.playerSub, isDark && styles.textSubDark]} numberOfLines={1}>
                {[playing?.joinMemberNames, playing?.subTitle, playing?.albumName].filter(Boolean).join(' · ') || '官方音乐'}
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.closePlayer, isDark && styles.closePlayerDark]}
              onPress={() => { setPlaying(null); setPlayUrl(''); }}
            >
              <Text style={[styles.closePlayerText, isDark && styles.closePlayerTextDark]}>✕</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.progressWrap}>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${progress * 100}%` as any }]} />
            </View>
            <View style={styles.timeRow}>
              <Text style={[styles.timeText, isDark && styles.textSubDark]}>{formatTime(position)}</Text>
              <Text style={[styles.timeText, isDark && styles.textSubDark]}>{formatTime(duration)}</Text>
            </View>
          </View>
          <View style={styles.controlsRow}>
            <TouchableOpacity style={styles.controlBtn} onPress={() => playByOffset(-1)}>
              <Text style={styles.controlIcon}>⏮</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.mainPlayBtn} onPress={() => setPaused((v) => !v)}>
              <Text style={styles.mainPlayIcon}>{paused ? '▶' : '⏸'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.controlBtn} onPress={() => playByOffset(1)}>
              <Text style={styles.controlIcon}>⏭</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}
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
  listContentWithPlayer: { paddingBottom: 140 },
  songItem: { height: 76, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, backgroundColor: 'rgba(255,255,255,0.72)', marginHorizontal: 16, marginVertical: 4, borderRadius: 12 },
  cardDark: { backgroundColor: 'rgba(20,20,20,0.68)' },
  songItemActive: { borderLeftWidth: 3, borderLeftColor: '#ff6f91' },
  songInfo: { flex: 1 },
  songTitle: { fontSize: 15, fontWeight: '700', color: '#333' },
  songArtist: { fontSize: 11, color: '#333333', marginTop: 2 },
  dateText: { fontSize: 11, color: '#333333', marginTop: 4 },
  tinyPlayer: { width: 0, height: 0 },
  miniPlayer: { position: 'absolute', left: 10, right: 10, bottom: 10, padding: 12, paddingBottom: 10, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.94)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.76)', shadowColor: '#000', shadowOpacity: 0.10, shadowRadius: 10, shadowOffset: { width: 0, height: -2 }, elevation: 8 },
  miniPlayerDark: { backgroundColor: 'rgba(22,22,22,0.94)', borderColor: 'rgba(255,255,255,0.06)', shadowOpacity: 0.20 },
  miniTop: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  coverArt: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#ff6f91', alignItems: 'center', justifyContent: 'center' },
  coverArtText: { color: '#fff', fontSize: 18 },
  playerMeta: { flex: 1, minWidth: 0 },
  playerTitle: { fontSize: 14, fontWeight: '800', color: '#222' },
  playerSub: { fontSize: 11, color: '#555', marginTop: 1 },
  closePlayer: { padding: 4 },
  closePlayerDark: { backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 12 },
  closePlayerText: { color: '#999', fontSize: 12, fontWeight: '700' },
  closePlayerTextDark: { color: '#eeeeee' },
  progressWrap: { marginBottom: 8 },
  progressTrack: { height: 4, borderRadius: 2, backgroundColor: 'rgba(0,0,0,0.08)', overflow: 'hidden' },
  progressFill: { height: 4, borderRadius: 2, backgroundColor: '#ff6f91' },
  timeRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
  timeText: { fontSize: 10, color: '#555' },
  controlsRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 18 },
  controlBtn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,111,145,0.08)' },
  controlIcon: { fontSize: 14, color: '#ff6f91' },
  mainPlayBtn: { width: 44, height: 44, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: '#ff6f91' },
  mainPlayIcon: { fontSize: 18, color: '#fff' },
  textDark: { color: '#eee' },
  textSubDark: { color: '#eeeeee' },
});
