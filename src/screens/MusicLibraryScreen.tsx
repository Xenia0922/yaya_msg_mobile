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
import { MusicEngine, mediaUrl as buildMediaUrl } from '../services/musicPlayer';
import { errorMessage } from '../utils/data';
import { formatTimestamp } from '../utils/format';
import ScreenHeader from '../components/ScreenHeader';
import MiniPlayerBar from '../components/MiniPlayerBar';
import FullScreenPlayer from '../components/FullScreenPlayer';
import CoverArt from '../components/CoverArt';
import { CenterSpinner } from '../components/Loaders';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';

// 仅放行 48 官方 CDN 域名。R2/gnz.hk 等位于 Cloudflare 之后的第三方源会返回
// 403 HTML 而非音频，一旦交给原生 ExoPlayer 就会触发进程级崩溃（闪退）。
// 用白名单从根上拦截：任何非官方域名一律视为不可播放、走 onError 跳过。
function isPlayableHost(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.endsWith('.48.cn') || host === 'snh48.com' || host === 'www.snh48.com';
  } catch {
    return false;
  }
}

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
  const [songs, setSongs] = useState<any[]>([]);
  // 搜索词 / 分团：从 player store 初始化并回写，确保离开音乐页再回来时筛选条件不丢失
  const [query, setQuery] = useState(() => useMusicPlayerStore.getState().libraryQuery || '');
  const [group, setGroup] = useState(() => useMusicPlayerStore.getState().libraryGroup || 'ALL');
  const onQueryChange = (q: string) => { setQuery(q); useMusicPlayerStore.getState().setLibraryQuery(q); };
  const GROUP_TABS = ['ALL', 'SNH48', 'GNZ48', 'BEJ48', 'CKG48', 'CGT48', 'FAV'];
  const onGroupChange = (g: string) => { setGroup(g); useMusicPlayerStore.getState().setLibraryGroup(g); };
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
    if (group === 'FAV') list = list.filter(item => favorites.includes(String(item.musicId || item.id || '')));
    else if (group !== 'ALL') list = list.filter(item => (item.groupLabel || '') === group);
    if (keyword) list = list.filter(item => [item.title, item.artist, item.album, item.groupLabel].filter(Boolean).join(' ').toLowerCase().includes(keyword));
    return list;
  }, [query, songs, group, favorites]);

  // 仅使用官方源（口袋48官网静态 JS，一次全量、无 token）—— 完整官方曲库。
  // 注：曾并列的 yk1z R2 音乐库（gnz.hk）已移除。该 host 位于 Cloudflare 之后，
  // 对移动端 ExoPlayer 的请求返回 403 HTML 而非音频，导致原生播放器解析失败、App 闪退，
  // 详见播放崩溃根因说明。仅保留官方源可彻底消除该崩溃。
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
      // 最后一道防线：非 48 官方 CDN 域名（如曾导致闪退的 R2/gnz.hk）一律拒绝，
      // 避免把 Cloudflare 403 HTML 页面喂给原生 ExoPlayer 触发进程级崩溃。
      if (!isPlayableHost(fb)) throw new Error('不支持的播放源');
      return fb;
    });
  }, []);

  const playSong = (item: any) => {
    // 用户主动点歌 → 立即播放（不是「进播放页不播」）。
    // 进音乐列表本身不会自动播放（列表挂载只 loadAll，从不调 play），所以
    // 「不自动播放」应作用于「进入列表」而非「点歌」——之前做反了。
    const st = useMusicPlayerStore.getState();
    const cur = st.queue[st.currentIndex];
    const sameAsCurrent = !!cur && (cur.musicId || cur.id) === (item.musicId || item.id);
    if (sameAsCurrent && st.playbackState === 'playing') {
      // 已经在放这首，直接打开播放页即可，不重启（避免重新缓冲）
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
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        removeClippedSubviews={false}
        collapsable={false}
        style={styles.groupsWrap}
        contentContainerStyle={styles.groups}
      >
        {GROUP_TABS.map((g, idx) => (
          <TouchableOpacity
            key={g}
            onPress={() => onGroupChange(g)}
            style={[
              styles.gChip, isDark && styles.gChipDark, group === g && styles.gChipOn,
              g === 'FAV' && styles.gChipFav,
              idx < GROUP_TABS.length - 1 && styles.gChipGap,
            ]}
          >
            <Text numberOfLines={1} style={[styles.gText, isDark && styles.gTextDark, group === g && styles.gTextOn]}>
              {g === 'FAV' ? `收藏${favorites.length ? `(${favorites.length})` : ''}` : g}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
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
          contentContainerStyle={[styles.listContent, playbackState !== 'idle' && { paddingBottom: 80 }]}
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
  // 横向标签栏：用纯 ScrollView（非 FlatList/虚拟化列表），所有子项始终保持挂载，
  // 杜绝 Yoga 在屏幕外 item 进入视口时重新测量导致标签异常拉伸。
  // 每 chip 固定宽度 + flexShrink:0 + flexGrow:0（绝不伸缩），显式高度防纵向裁切。
  // gap 在 ScrollView contentContainerStyle 中可能触发额外测量，改用 marginRight。
  groups: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12 },
  groupsWrap: { marginTop: 2, marginBottom: 8, width: '100%', height: 40 },
  gChip: { width: 72, height: 28, paddingHorizontal: 14, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.06)', flexShrink: 0, flexGrow: 0, alignItems: 'center', justifyContent: 'center' },
  gChipGap: { marginRight: 8 },
  gChipDark: { backgroundColor: 'rgba(255,255,255,0.12)' },
  gChipOn: { backgroundColor: '#ff6f91' },
  gChipFav: { width: 104 },
  gText: { fontSize: 13, color: '#555', fontWeight: '600' },
  gTextDark: { color: '#d6d6d6' },
  gTextOn: { color: '#fff' },
  status: { color: '#ff6f91', fontSize: 12, fontWeight: '700' },
  statusOverlay: { position: 'absolute', top: 140, left: 0, right: 0, zIndex: 10, alignItems: 'center' },
  listContent: { paddingHorizontal: 12, paddingBottom: 120 },
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
