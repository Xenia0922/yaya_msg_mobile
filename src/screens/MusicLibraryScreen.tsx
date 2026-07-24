import React, { useEffect, useMemo, useRef, useState } from 'react';
import { PerfFlatList } from '../components/PerfFlatList';

import {
  ScrollView,
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
import { MusicEngine, mediaUrl as buildMediaUrl, isPlayableHost } from '../services/musicPlayer';
import { errorMessage } from '../utils/data';
import { formatTimestamp } from '../utils/format';
import ScreenHeader from '../components/ScreenHeader';
import MiniPlayerBar from '../components/MiniPlayerBar';
import FullScreenPlayer from '../components/FullScreenPlayer';
import CoverArt from '../components/CoverArt';
import { CenterSpinner } from '../components/Loaders';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';

const GROUP_TABS = ['ALL', 'SNH48', 'GNZ48', 'BEJ48', 'CKG48', 'CGT48', 'FAV'];
const CHIP_BASE_WIDTH = 72;
const CHIP_GAP = 8;
const CHIP_FAV_WIDTH = 104;
const CHIP_HEIGHT = 28;
const TABS_BAR_HEIGHT = 44; // 标签栏总高度（含上下内边距）

export default function MusicLibraryScreen() {
  const isDark = useSettingsStore((state) => state.settings.theme === 'dark');
  const showToast = useUiStore((state) => state.showToast);
  const playbackState = useMusicPlayerStore((s) => s.playbackState);
  const playUrl = useMusicPlayerStore((s) => s.url);
  const currentIndex = useMusicPlayerStore((s) => s.currentIndex);
  const queue = useMusicPlayerStore((s) => s.queue);
  const playMode = useMusicPlayerStore((s) => s.playMode);
  const favorites = useMusicPlayerStore((s) => s.favorites);
  const toggleFavorite = useMusicPlayerStore((s) => s.toggleFavorite);
  const seekTarget = useMusicPlayerStore((s) => s.seekTarget);
  const [songs, setSongs] = useState<any[]>([]);
  // 搜索词 / 分团：纯 local state（不再镜像到 store，避免双写）。
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState('ALL');
  const onQueryChange = (q: string) => { setQuery(q); };
  const onGroupChange = (g: string) => { setGroup(g); };
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [showFullScreen, setShowFullScreen] = useState(false);
  const loadingRef = useRef(false);
  const videoRef = useRef<any>(null);

  const filteredSongs = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    let list = songs;
    if (group === 'FAV') list = list.filter(item => favorites.includes(String(item.musicId || item.id || '')));
    else if (group !== 'ALL') list = list.filter(item => (item.groupLabel || '') === group);
    if (keyword) list = list.filter(item => [item.title, item.artist, item.album, item.groupLabel].filter(Boolean).join(' ').toLowerCase().includes(keyword));
    return list;
  }, [query, songs, group, favorites]);

  // 仅使用官方源（口袋48官网静态 JS，一次全量、无 token）—— 完整官方曲库。
  const loadAll = async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    setStatus('');
    try {
      const official = await loadOfficialSiteMusic(false);
      setSongs(official);
      setHasMore(false);
    } catch (error) {
      setStatus(`加载失败：${errorMessage(error)}`);
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  };

  // 注入 URL resolver（供 MusicEngine 使用），避免循环引用
  useEffect(() => {
    loadAll();
    MusicEngine.setUrlResolver(async (track: any) => {
      // 官方源歌曲的 mp3 直链即可播放
      if (track?.mp3 && /^https?:/i.test(String(track.mp3))) {
        const u = String(track.mp3);
        if (!isPlayableHost(u)) throw new Error('不支持的播放源');
        return u;
      }
      // 回退：个别非官网源曲目尝试移动端接口解析地址
      try {
        const res = await officialMediaApi.getMusic(String(track.musicId || track.id));
        const data = res?.content?.data || res?.content || res?.data || {};
        const url = buildMediaUrl(String(data.filePath || data.musicPath || data.playStreamPath || data.audioPath || data.url || ''));
        if (url) {
          if (!isPlayableHost(url)) throw new Error('不支持的播放源');
          return url;
        }
      } catch { /* ignore */ }
      const fb = buildMediaUrl(String((track as any).filePath || (track as any).musicPath || (track as any).playStreamPath || (track as any).audioPath || (track as any).url || ''));
      if (!fb) throw new Error('无法解析播放地址');
      if (!isPlayableHost(fb)) throw new Error('不支持的播放源');
      return fb;
    });
  }, []);

  // 处理 seekTarget：Video 挂载后检测到 seekTarget > 0 即执行 seek 并清零
  useEffect(() => {
    if (seekTarget > 0 && videoRef.current && typeof videoRef.current.seek === 'function') {
      try {
        videoRef.current.seek(seekTarget);
      } catch (err) {
        console.warn('[MusicLibraryScreen] seekTarget error:', err);
      }
      useMusicPlayerStore.getState().setSeekTarget(0);
    }
  }, [seekTarget]);

  const playSong = (item: any) => {
    const st = useMusicPlayerStore.getState();
    const cur = st.queue[st.currentIndex];
    const sameAsCurrent = !!cur && (cur.musicId || cur.id) === (item.musicId || item.id);
    if (sameAsCurrent && st.playbackState === 'playing') {
      setShowFullScreen(true);
      return;
    }
    // 克隆队列：播放器 store 与列表 songs 解耦，避免共享同一批对象引用时，
    // 任何播放态写入（或 FlatList 复用）反噬列表渲染。
    MusicEngine.playTrack(item, filteredSongs.map((t) => ({ ...t })));
    setShowFullScreen(true);
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
        onChangeText={onQueryChange}
        placeholder="搜索歌曲、成员、专辑"
        placeholderTextColor={isDark ? '#aaa' : '#4a4a4a'}
        style={[styles.searchInput, isDark && styles.searchInputDark]}
      />
      {/* 横向标签栏：使用 flex:1 的 ScrollView + flexDirection: row，配合固定宽度 chip，
           彻底避免 Yoga 在屏幕外 item 重新测量导致的拉伸问题。 */}
      <View style={[styles.tabsBarBase, isDark ? styles.tabsBarDark : styles.tabsBarLight]}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          removeClippedSubviews={false}
          collapsable={false}
          contentContainerStyle={styles.tabsContent}
        >
          {GROUP_TABS.map((g, idx) => (
            <TouchableOpacity
              key={g}
              onPress={() => onGroupChange(g)}
              style={[
                styles.gChip,
                isDark && styles.gChipDark,
                group === g && styles.gChipOn,
                g === 'FAV' ? styles.gChipFav : styles.gChipBase,
              ]}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            >
              <Text
                numberOfLines={1}
                ellipsizeMode="tail"
                style={[
                  styles.gText,
                  isDark && styles.gTextDark,
                  group === g && styles.gTextOn,
                ]}
              >
                {g === 'FAV' ? `收藏${favorites.length ? `(${favorites.length})` : ''}` : g}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>
      {status ? (
        <View pointerEvents="none" style={styles.statusOverlay}>
          <Text style={[styles.status, isDark && styles.textSubDark]}>{status}</Text>
        </View>
      ) : null}
      {loading && songs.length === 0 ? (
        <View style={{ flex: 1 }}>
          <CenterSpinner dark={isDark} text="加载中…" />
        </View>
      ) : !loading && songs.length === 0 && !status ? (
        <View style={styles.emptyWrap}>
          <Text style={[styles.status, isDark && styles.textSubDark]}>暂无音乐</Text>
        </View>
      ) : (
      <PerfFlatList
          data={filteredSongs}
          keyExtractor={(item, index) => `${item.groupKey || ''}-${item.musicId || item.id || ''}-${index}`}
          numColumns={2}
          removeClippedSubviews={false}
          contentContainerStyle={styles.listContent}
          columnWrapperStyle={styles.gridRow}
          renderItem={({ item, index }) => {
            const id = String(item.musicId || item.id || '');
            const active = queue[currentIndex] && (String(queue[currentIndex].musicId || queue[currentIndex].id) === id);
            const coverUrl = item.coverUrl || item.cover || item.thumbPath || '';
            return (
              <TouchableOpacity
                style={[styles.songItem, isDark && styles.cardDark, active && styles.songItemActive, active && isDark && styles.songItemActiveDark]}
                onPress={() => playSong(item)}
                activeOpacity={0.7}
              >
                <View style={styles.coverWrap}>
                  <CoverArt uri={coverUrl || undefined} title={item.title || '♪'} fill active={active} />
                  <TouchableOpacity
                    style={styles.favBtn}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    onPress={(e) => {
                      e.stopPropagation();
                      const fid = String(item.musicId || item.id || '');
                      if (fid) toggleFavorite(fid);
                    }}
                  >
                    <MaterialCommunityIcons
                      name={favorites.includes(String(item.musicId || item.id || '')) ? 'heart' : 'heart-outline'}
                      size={20}
                      color={favorites.includes(String(item.musicId || item.id || '')) ? '#ff3b5c' : '#fff'}
                    />
                  </TouchableOpacity>
                </View>
                <View style={styles.songInfo}>
                  <Text style={[styles.songTitle, isDark && styles.textDark]} numberOfLines={2}>{item.title || '无标题'}</Text>
                  <Text style={[styles.songArtist, isDark && styles.textSubDark]} numberOfLines={1}>
                    {[item.album, item.artist, item.groupLabel].filter(Boolean).join(' · ') || '官方音乐'}
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
      {/* Video 常驻（width:0 height:0），不做条件卸载，彻底消除 source+paused 同步翻转崩溃 */}
      <Video
        ref={videoRef}
        source={{ uri: playUrl || '' }}
        style={styles.tinyPlayer}
        paused={playbackState !== 'playing'}
        ignoreSilentSwitch="ignore"
        onLoad={(e) => {
          try {
            const dur = e.duration || 0;
            useMusicPlayerStore.getState().setDuration(dur);
            // seekTarget 已在单独的 effect 中处理
          } catch (err) {
            console.warn('[MusicLibraryScreen] onLoad error:', err);
          }
        }}
        onProgress={(e) => {
          try { useMusicPlayerStore.getState().setPosition(e.currentTime || 0); } catch {}
        }}
        onEnd={() => {
          try {
            if (playMode === 'single') {
              useMusicPlayerStore.getState().setPosition(0);
              useMusicPlayerStore.getState().setSeekTarget(0);
              useMusicPlayerStore.getState().setPlaybackState('playing');
            } else {
              MusicEngine.next();
            }
          } catch (err) {
            console.warn('[MusicLibraryScreen] onEnd error:', err);
          }
        }}
        onError={(err) => {
          try {
            console.warn('[MusicLibraryScreen] onError:', err);
            const t = queue[currentIndex];
            showToast(`《${t?.title || '该歌曲'}》无法播放，已跳过`);
            MusicEngine.next();
          } catch (e) {
            console.error('[MusicLibraryScreen] onError handler crashed:', e);
          }
        }}
      />
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
  
  // 标签栏容器：固定高度，底部分隔线（颜色在组件里动态切换）
  tabsBarBase: { 
    height: TABS_BAR_HEIGHT, 
    paddingHorizontal: 12, 
    borderBottomWidth: StyleSheet.hairlineWidth, 
  },
  tabsBarLight: { borderBottomColor: 'rgba(0,0,0,0.06)' },
  tabsBarDark: { borderBottomColor: 'rgba(255,255,255,0.08)' },
  // 内容区：flex row，靠左对齐，gap 由 marginRight 控制
  tabsContent: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    justifyContent: 'flex-start',
    paddingVertical: (TABS_BAR_HEIGHT - CHIP_HEIGHT) / 2, // 垂直居中
  },
  gChip: { 
    height: CHIP_HEIGHT, 
    paddingHorizontal: 14, 
    borderRadius: 14, 
    backgroundColor: 'rgba(0,0,0,0.06)', 
    alignItems: 'center', 
    justifyContent: 'center', 
    flexShrink: 0, 
    flexGrow: 0, 
    overflow: 'hidden',
    marginRight: CHIP_GAP,
  },
  gChipDark: { backgroundColor: 'rgba(255,255,255,0.12)' },
  gChipOn: { backgroundColor: '#ff6f91' },
  gChipFav: { width: CHIP_FAV_WIDTH },
  gChipBase: { width: CHIP_BASE_WIDTH },
  gText: { fontSize: 13, color: '#555', fontWeight: '600' },
  gTextDark: { color: '#d6d6d6' },
  gTextOn: { color: '#fff' },
  status: { color: '#ff6f91', fontSize: 12, fontWeight: '700' },
  statusOverlay: { position: 'absolute', top: 140, left: 0, right: 0, zIndex: 10, alignItems: 'center' },
  
  // 列表内容：顶部留出标签栏高度，底部留出迷你播放器空间
  listContent: { paddingHorizontal: 12, paddingTop: 8, paddingBottom: 120 },
  emptyWrap: { alignItems: 'center', marginTop: 80 },
  gridRow: { justifyContent: 'space-between' as const },
  songItem: { width: '48%', marginBottom: 12, borderRadius: 12, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.82)' },
  cardDark: { backgroundColor: 'rgba(20,20,20,0.72)' },
  songItemActiveDark: { borderColor: '#ff8fa8' },
  songItemActive: { borderWidth: 2, borderColor: '#ff6f91' },
  coverWrap: { width: '100%', aspectRatio: 1, backgroundColor: '#111' },
  favBtn: { position: 'absolute', top: 6, right: 6, width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.32)' },
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