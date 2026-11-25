import { useIsFocused, useNavigation } from '@react-navigation/native';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  BackHandler,
  Easing,
  InteractionManager,
  Keyboard,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { PerfFlatList } from '../components/PerfFlatList';
import { useSafeAreaInsets } from '../hooks/useSafeAreaInsets';
import officialMediaApi from '../api/officialMedia';
import {
  getCachedMusicCatalog,
  getTrackCatalogMeta,
  loadMusicCatalog,
} from '../services/musicCatalog';
import { useSettingsStore, useUiStore } from '../store';
import { useMusicPlayerStore } from '../store/musicPlayerStore';
import { MusicEngine, mediaUrl as buildMediaUrl, isPlayableHost } from '../services/musicPlayer';
import { errorMessage } from '../utils/data';
import { formatDuration, formatTrackSubtitle } from '../utils/format';
import { FloatingHeaderAction, getFloatingHeaderOffset } from '../components/FloatingTabHeader';
import ScreenHeader from '../components/ScreenHeader';
import CoverArt from '../components/CoverArt';
import { NetworkImage } from '../components/NetworkImage';
import { Skeleton } from '../components/Skeleton';
import { EmptyState, ErrorState } from '../components/StateViews';
import { ScalePressable } from '../components/Motion';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { usePalette, fontFamily, radii } from '../theme';
import { useI18n } from '../i18n';
import { GlassSegmentedScroll } from '../components/GlassSegmented';
import { SearchBar } from '../components/SearchBar';

const TRACK_ROW_HEIGHT = 66;

function EqualizerBars({
  color,
  size = 13,
  active = true,
}: {
  color: string;
  size?: number;
  active?: boolean;
}) {
  const bars = useMemo(
    () => [new Animated.Value(0.35), new Animated.Value(0.35), new Animated.Value(0.35)],
    [],
  );
  useEffect(() => {
    if (!active) {
      bars.forEach((v) => {
        v.stopAnimation();
        v.setValue(0.35);
      });
      return;
    }
    const loops = bars.map((v, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(v, {
            toValue: 1,
            duration: 340 + i * 120,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(v, {
            toValue: 0.35,
            duration: 340 + i * 120,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
        ]),
      ),
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [bars, active]);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: size }}>
      {bars.map((v, i) => (
        <Animated.View
          key={i}
          style={{
            width: 3,
            height: size,
            borderRadius: 1.5,
            backgroundColor: color,
            transform: [{ scaleY: v }],
          }}
        />
      ))}
    </View>
  );
}

const GROUP_TABS = [
  'ALL',
  'FAV',
  'RECENT',
  'SNH48',
  'GNZ48',
  'BEJ48',
  'AKB48',
  'CKG48',
  'CGT48',
  'SHY48',
  'TSH48',
  'TPE48',
];
const GROUP_LABELS: Record<string, string> = {
  ALL: '全部',
  FAV: '收藏',
  RECENT: '最近播放',
  SNH48: 'SNH48',
  GNZ48: 'GNZ48',
  BEJ48: 'BEJ48',
  AKB48: 'AKB48',
  CKG48: 'CKG48',
  CGT48: 'CGT48',
  SHY48: 'SHY48',
  TSH48: 'TSH48',
  TPE48: 'TPE48',
};

function trackMatchSig(item: any): string {
  if (!item) return '';
  const id = String(item.musicId || item.id || '');
  if (!id) return '';
  const title = String(item.title || '')
    .trim()
    .toLowerCase();
  const artist = String(item.artist || item.joinMemberNames || '')
    .trim()
    .toLowerCase();
  const album = String(item.album || item.albumName || '')
    .trim()
    .toLowerCase();
  return `${id}|${title}|${artist}|${album}`;
}

function isTrackInFavSet(favSet: Set<string>, track: any): boolean {
  if (!favSet.size || !track) return false;
  const meta = getTrackCatalogMeta(track);
  if (meta.id && favSet.has(meta.id)) return true;
  return (
    (meta.favKey3 !== '||' && favSet.has(meta.favKey3)) ||
    (meta.favKey2 !== '|' && favSet.has(meta.favKey2))
  );
}

function trackDurationSec(item: any): number {
  return item ? getTrackCatalogMeta(item).durSec : 0;
}

const AlbumGridCard = React.memo(function AlbumGridCard({
  item,
  cardWidth,
  labelColor,
  labelSecondaryColor,
  unknownGroupText,
  songsUnitText,
  onPress,
}: {
  item: { key: string; groupLabel: string; album: string; cover: string; count: number };
  cardWidth: number;
  labelColor: string;
  labelSecondaryColor: string;
  unknownGroupText: string;
  songsUnitText: string;
  onPress: (album: { groupLabel: string; album: string; cover: string }) => void;
}) {
  return (
    <Pressable
      onPress={() => onPress({ groupLabel: item.groupLabel, album: item.album, cover: item.cover })}
      style={({ pressed }) => [
        styles.albumItem,
        { width: cardWidth },
        pressed && styles.albumPressed,
      ]}
    >
      <CoverArt
        uri={item.cover || undefined}
        title={item.album}
        size={cardWidth}
        borderRadius={16}
        thumbnail={320}
      />
      <Text numberOfLines={1} style={[styles.albumTitle, { color: labelColor }]}>
        {item.album}
      </Text>
      <Text numberOfLines={1} style={[styles.albumSub, { color: labelSecondaryColor }]}>
        {`${item.groupLabel || unknownGroupText} · ${item.count} ${songsUnitText}`}
      </Text>
    </Pressable>
  );
});

const TrackRow = React.memo(function TrackRow({
  item,
  index,
  showTrackNumber,
  active,
  isPlaying,
  isLoading,
  isFav,
  tintColor,
  tintSoftColor,
  dangerColor,
  labelColor,
  labelSecondaryColor,
  labelTertiaryColor,
  untitledText,
  officialText,
  moreA11yLabel,
  onPlay,
  onToggleFav,
  onOpenMenu,
}: {
  item: any;
  index: number;
  showTrackNumber: boolean;
  active: boolean;
  isPlaying: boolean;
  isLoading: boolean;
  isFav: boolean;
  tintColor: string;
  tintSoftColor: string;
  dangerColor: string;
  labelColor: string;
  labelSecondaryColor: string;
  labelTertiaryColor: string;
  untitledText: string;
  officialText: string;
  moreA11yLabel: string;
  onPlay: (item: any) => void;
  onToggleFav: (item: any) => void;
  onOpenMenu: (item: any) => void;
}) {
  const coverUrl = item.coverUrl || item.cover || item.thumbPath || '';
  const dur = trackDurationSec(item);
  const trackNumStr = String(
    typeof item.trackNumber === 'number' && item.trackNumber > 0 ? item.trackNumber : index + 1,
  ).padStart(2, '0');

  return (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={() => onPlay(item)}
      onLongPress={() => onOpenMenu(item)}
      style={[styles.trackRow, active && { backgroundColor: tintSoftColor, borderRadius: 14 }]}
    >
      {showTrackNumber ? (
        <View style={styles.trackNumBox}>
          {active ? (
            isLoading ? (
              <ActivityIndicator size="small" color={tintColor} />
            ) : (
              <EqualizerBars color={tintColor} size={14} active={isPlaying} />
            )
          ) : (
            <Text style={[styles.trackNumText, { color: labelTertiaryColor }]}>{trackNumStr}</Text>
          )}
        </View>
      ) : (
        <View style={styles.rowCoverWrap}>
          <CoverArt
            uri={coverUrl || undefined}
            title={item.title || '♪'}
            size={50}
            borderRadius={10}
            thumbnail={120}
          />
          {active ? (
            <View style={styles.rowActiveOverlay}>
              {isLoading ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <EqualizerBars color="#FFFFFF" size={14} active={isPlaying} />
              )}
            </View>
          ) : null}
        </View>
      )}

      <View style={styles.rowTextCol}>
        <Text
          numberOfLines={1}
          style={[
            styles.rowTitle,
            { color: active ? tintColor : labelColor, fontWeight: active ? '700' : '600' },
          ]}
        >
          {item.title || untitledText}
        </Text>
        <Text numberOfLines={1} style={[styles.rowSub, { color: labelSecondaryColor }]}>
          {formatTrackSubtitle(item) || officialText}
        </Text>
      </View>

      <View style={styles.rowRightCol}>
        {dur > 0 ? (
          <Text style={[styles.rowDur, { color: labelTertiaryColor }]}>{formatDuration(dur)}</Text>
        ) : null}
        <Pressable
          onPress={() => onToggleFav(item)}
          hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
          style={({ pressed }) => [styles.rowIconBtn, pressed && styles.rowBtnPressed]}
        >
          <MaterialCommunityIcons
            name={isFav ? 'heart' : 'heart-outline'}
            size={18}
            color={isFav ? dangerColor : labelTertiaryColor}
          />
        </Pressable>
        <Pressable
          onPress={() => onOpenMenu(item)}
          hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
          accessibilityRole="button"
          accessibilityLabel={moreA11yLabel}
          style={({ pressed }) => [styles.rowIconBtn, pressed && styles.rowBtnPressed]}
        >
          <MaterialCommunityIcons name="dots-horizontal" size={19} color={labelTertiaryColor} />
        </Pressable>
      </View>
    </TouchableOpacity>
  );
});

export default function MusicLibraryScreen() {
  const navigation = useNavigation();
  const screenFocused = useIsFocused();
  const insets = useSafeAreaInsets();
  const { width: winW } = useWindowDimensions();
  const palette = usePalette();
  const { t } = useI18n();
  const showToast = useUiStore((state) => state.showToast);

  const playbackState = useMusicPlayerStore((s) => s.playbackState);
  const miniBarDismissed = useMusicPlayerStore((s) => s.miniBarDismissed);
  const miniBarEnabled = useSettingsStore((s) => s.settings.yaya_music_minibar_enabled !== false);
  const activeTrackSig = useMusicPlayerStore((s) => trackMatchSig(s.queue[s.currentIndex]));
  const hasQueueTrack = useMusicPlayerStore((s) => s.queue.length > 0 && s.currentIndex >= 0);
  const favorites = useMusicPlayerStore((s) => s.favorites);
  const recentIds = useMusicPlayerStore((s) => s.recentIds);
  const toggleFavorite = useMusicPlayerStore((s) => s.toggleFavorite);
  const fullScreenOpen = useMusicPlayerStore((s) => s.fullScreenOpen);

  const [songs, setSongs] = useState<any[]>(() => getCachedMusicCatalog() ?? []);
  const songsRef = useRef(songs);
  songsRef.current = songs;
  const applySongs = useCallback((list: any[]) => {
    songsRef.current = list;
    setSongs(list);
  }, []);

  const [listReady, setListReady] = useState(false);

  const [queryInput, setQueryInput] = useState('');
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [group, setGroup] = useState('ALL');
  const [viewMode, setViewMode] = useState<'songs' | 'albums'>('songs');
  const [albumFilter, setAlbumFilter] = useState<{
    groupLabel: string;
    album: string;
    cover: string;
  } | null>(null);
  const [actionTrack, setActionTrack] = useState<any | null>(null);

  const [status, setStatus] = useState('');
  const [statusIsError, setStatusIsError] = useState(false);
  const [loading, setLoading] = useState(false);
  const loadingRef = useRef(false);

  useEffect(() => {
    const trimmed = queryInput;
    const id = setTimeout(() => setQuery(trimmed), 180);
    return () => clearTimeout(id);
  }, [queryInput]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!navigation.isFocused() || fullScreenOpen) return false;
      if (actionTrack) {
        setActionTrack(null);
        return true;
      }
      if (albumFilter) {
        setAlbumFilter(null);
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [navigation, fullScreenOpen, actionTrack, albumFilter]);

  const favSet = useMemo(() => new Set(favorites), [favorites]);
  const favCount = useMemo(
    () => songs.filter((tr) => isTrackInFavSet(favSet, tr)).length,
    [songs, favSet],
  );

  const songByIdMap = useMemo(() => {
    const m = new Map<string, any>();
    if (group !== 'RECENT') return m;
    for (const item of songs) {
      const id = getTrackCatalogMeta(item).id;
      if (id && !m.has(id)) m.set(id, item);
    }
    return m;
  }, [songs, group]);

  const filteredSongs = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    let list: any[];
    if (albumFilter) {
      list = songs
        .filter(
          (item) =>
            String(item.groupLabel || '') === albumFilter.groupLabel &&
            String(item.album || '') === albumFilter.album,
        )
        .sort((a, b) => {
          const da = Number(a.discNumber) || 1;
          const db = Number(b.discNumber) || 1;
          if (da !== db) return da - db;
          const ta = Number(a.trackNumber) || Number(a.sourceIndex) || 0;
          const tb = Number(b.trackNumber) || Number(b.sourceIndex) || 0;
          if (ta !== tb) return ta - tb;
          const ma = getTrackCatalogMeta(a);
          const mb = getTrackCatalogMeta(b);
          if (ma.titleLower === mb.titleLower) return 0;
          return ma.titleLower < mb.titleLower ? -1 : 1;
        });
    } else if (group === 'FAV') {
      list = songs.filter((item) => isTrackInFavSet(favSet, item));
    } else if (group === 'RECENT') {
      list = recentIds.map((id) => songByIdMap.get(id)).filter(Boolean);
    } else if (group !== 'ALL') {
      list = songs.filter((item) => getTrackCatalogMeta(item).groupFam === group);
    } else {
      list = songs;
    }

    if (keyword) {
      list = list.filter((item) => getTrackCatalogMeta(item).search.includes(keyword));
    }
    return list;
  }, [query, songs, group, favSet, recentIds, songByIdMap, albumFilter]);

  const displaySongs = useMemo(
    () => (listReady || filteredSongs.length <= 12 ? filteredSongs : filteredSongs.slice(0, 12)),
    [listReady, filteredSongs],
  );

  const groupSegOptions = useMemo(
    () =>
      GROUP_TABS.map((g) => ({
        key: g,
        label:
          g === 'FAV'
            ? t('收藏{count}', { count: favCount ? `(${favCount})` : '' })
            : t(GROUP_LABELS[g] || g),
      })),
    [favCount, t],
  );

  const hasMiniPlayer =
    miniBarEnabled && hasQueueTrack && playbackState !== 'idle' && !miniBarDismissed;
  const listBottomSpacerHeight = hasMiniPlayer ? 114 : 32;

  const albums = useMemo(() => {
    if (viewMode !== 'albums' || albumFilter) return [];
    const map = new Map<
      string,
      {
        key: string;
        groupLabel: string;
        album: string;
        cover: string;
        count: number;
        order: number;
        groupLower: string;
        albumLower: string;
      }
    >();
    for (const tr of filteredSongs) {
      const album = String(tr.album || '').trim();
      if (!album) continue;
      const meta = getTrackCatalogMeta(tr);
      const gl = String(tr.groupLabel || '');
      const key = `${gl}|${album}`;
      const existing = map.get(key);
      if (existing) {
        existing.count += 1;
        if (!existing.cover) existing.cover = String(tr.coverUrl || tr.cover || '');
      } else {
        map.set(key, {
          key,
          groupLabel: gl,
          album,
          cover: String(tr.coverUrl || tr.cover || ''),
          count: 1,
          order: meta.groupOrder,
          groupLower: meta.groupLower,
          albumLower: album.toLowerCase(),
        });
      }
    }
    return [...map.values()].sort((a, b) => {
      if (a.order !== b.order) return a.order - b.order;
      if (a.groupLower !== b.groupLower) return a.groupLower < b.groupLower ? -1 : 1;
      if (a.albumLower === b.albumLower) return 0;
      return a.albumLower < b.albumLower ? -1 : 1;
    });
  }, [filteredSongs, albumFilter, viewMode]);

  const displayAlbums = useMemo(
    () => (listReady || albums.length <= 8 ? albums : albums.slice(0, 8)),
    [listReady, albums],
  );

  const loadAll = async (force = false) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    if (!songsRef.current.length) setLoading(true);
    setStatus('');
    setStatusIsError(false);
    try {
      const result = await loadMusicCatalog(force);
      if (force || result.songs !== songsRef.current) {
        applySongs(result.songs);
      }
    } catch (error) {
      setStatus(t('加载失败：{msg}', { msg: errorMessage(error) }));
      setStatusIsError(true);
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  };
  const loadAllRef = useRef(loadAll);
  loadAllRef.current = loadAll;

  useEffect(() => {
    MusicEngine.setUrlResolver(async (track: any) => {
      if (track?.mp3 && /^https?:/i.test(String(track.mp3))) {
        const u = String(track.mp3);
        if (!isPlayableHost(u)) throw new Error(t('不支持的播放源'));
        return u;
      }
      try {
        const res = await officialMediaApi.getMusic(String(track.musicId || track.id));
        const data = res?.content?.data || res?.content || res?.data || {};
        const url = buildMediaUrl(
          String(
            data.filePath ||
              data.musicPath ||
              data.playStreamPath ||
              data.audioPath ||
              data.url ||
              '',
          ),
        );
        if (url) {
          if (!isPlayableHost(url)) throw new Error(t('不支持的播放源'));
          return url;
        }
      } catch {}
      const fb = buildMediaUrl(
        String(
          (track as any).filePath ||
            (track as any).musicPath ||
            (track as any).playStreamPath ||
            (track as any).audioPath ||
            (track as any).url ||
            '',
        ),
      );
      if (!fb) throw new Error(t('无法解析播放地址'));
      if (!isPlayableHost(fb)) throw new Error(t('不支持的播放源'));
      return fb;
    });
    let activated = false;
    const activate = () => {
      if (activated) return;
      activated = true;
      setListReady(true);
      void loadAllRef.current();
    };
    const task = InteractionManager.runAfterInteractions(activate);
    const fallbackTimer = setTimeout(activate, 320);
    return () => {
      activated = true;
      clearTimeout(fallbackTimer);
      task.cancel();
    };
  }, [t]);

  const filteredSongsRef = useRef(filteredSongs);
  filteredSongsRef.current = filteredSongs;

  const playSong = useCallback((item: any) => {
    const st = useMusicPlayerStore.getState();
    const cur = st.queue[st.currentIndex];
    const sameAsCurrent = !!cur && (cur.musicId || cur.id) === (item.musicId || item.id);
    if (sameAsCurrent && st.playbackState === 'playing') {
      st.openFullScreen('none');
      return;
    }
    if (sameAsCurrent && st.position > 0) {
      void MusicEngine.resume();
      return;
    }
    void MusicEngine.playTrack(item, [...filteredSongsRef.current]);
  }, []);

  const handleToggleFav = useCallback(
    (item: any) => {
      const fid = String(item.musicId || item.id || '');
      if (fid) toggleFavorite(fid, item);
    },
    [toggleFavorite],
  );

  const playAllFiltered = useCallback(() => {
    const list = filteredSongsRef.current;
    if (!list.length) return;
    useMusicPlayerStore.getState().setMode('sequential');
    void MusicEngine.playTrack(list[0], [...list]);
  }, []);

  const shuffleFiltered = useCallback(() => {
    const list = filteredSongsRef.current;
    if (!list.length) return;
    useMusicPlayerStore.getState().setMode('random');
    const pick = list[Math.floor(Math.random() * list.length)];
    void MusicEngine.playTrack(pick, [...list]);
  }, []);

  const songKeyExtractor = useCallback(
    (item: any, index: number) =>
      `${item.groupKey || ''}-${item.musicId || item.id || ''}-${index}`,
    [],
  );
  const albumKeyExtractor = useCallback((item: any) => item.key, []);
  const getSongItemLayout = useCallback(
    (_: any, index: number) => ({
      length: TRACK_ROW_HEIGHT,
      offset: TRACK_ROW_HEIGHT * index,
      index,
    }),
    [],
  );

  const headerOffset = getFloatingHeaderOffset(insets.top);
  const showSearch = searchOpen || queryInput.length > 0;
  const albumCardWidth = Math.max(136, Math.floor((winW - 38) / 2));

  const unknownGroupText = t('未知团体');
  const songsUnitText = t('首');
  const untitledText = t('无标题');
  const officialText = t('官方音乐');
  const moreA11yLabel = t('更多');
  const playingNow = screenFocused && playbackState === 'playing';
  const loadingNow = playbackState === 'loading';

  const renderAlbumItem = useCallback(
    ({ item }: { item: any }) => (
      <AlbumGridCard
        item={item}
        cardWidth={albumCardWidth}
        labelColor={palette.label}
        labelSecondaryColor={palette.labelSecondary}
        unknownGroupText={unknownGroupText}
        songsUnitText={songsUnitText}
        onPress={setAlbumFilter}
      />
    ),
    [albumCardWidth, palette.label, palette.labelSecondary, unknownGroupText, songsUnitText],
  );

  const renderSongItem = useCallback(
    ({ item, index }: { item: any; index: number }) => (
      <TrackRow
        item={item}
        index={index}
        showTrackNumber={!!albumFilter}
        active={!!activeTrackSig && trackMatchSig(item) === activeTrackSig}
        isPlaying={playingNow}
        isLoading={loadingNow}
        isFav={isTrackInFavSet(favSet, item)}
        tintColor={palette.tint}
        tintSoftColor={palette.tintSoft}
        dangerColor={palette.danger}
        labelColor={palette.label}
        labelSecondaryColor={palette.labelSecondary}
        labelTertiaryColor={palette.labelTertiary}
        untitledText={untitledText}
        officialText={officialText}
        moreA11yLabel={moreA11yLabel}
        onPlay={playSong}
        onToggleFav={handleToggleFav}
        onOpenMenu={setActionTrack}
      />
    ),
    [
      albumFilter,
      activeTrackSig,
      playingNow,
      loadingNow,
      favSet,
      palette.tint,
      palette.tintSoft,
      palette.danger,
      palette.label,
      palette.labelSecondary,
      palette.labelTertiary,
      untitledText,
      officialText,
      moreA11yLabel,
      playSong,
      handleToggleFav,
    ],
  );

  const songToolbarHeader = useMemo(() => {
    if (albumFilter) {
      const heroCover =
        albumFilter.cover || String(filteredSongs[0]?.coverUrl || filteredSongs[0]?.cover || '');
      return (
        <View style={[styles.albumHeroBox, { backgroundColor: palette.fill2 }]}>
          {heroCover ? (
            <NetworkImage
              source={{ uri: heroCover }}
              blurRadius={32}
              resizeMode="cover"
              style={[StyleSheet.absoluteFill, { opacity: 0.24 }]}
              fallback={false}
            />
          ) : null}
          <View style={styles.albumHeroInner}>
            <CoverArt
              uri={heroCover || undefined}
              title={albumFilter.album}
              size={104}
              borderRadius={16}
              thumbnail={280}
            />
            <View style={styles.albumHeroInfo}>
              <Text numberOfLines={2} style={[styles.albumHeroTitle, { color: palette.label }]}>
                {albumFilter.album}
              </Text>
              <Text
                numberOfLines={1}
                style={[styles.albumHeroMeta, { color: palette.labelSecondary }]}
              >
                {`${albumFilter.groupLabel || t('未知团体')} · ${filteredSongs.length} ${t('首')}`}
              </Text>
              <View style={styles.albumHeroBtns}>
                <ScalePressable
                  onPress={playAllFiltered}
                  pressedScale={0.95}
                  style={[styles.albumHeroPrimaryBtn, { backgroundColor: palette.tint }]}
                >
                  <MaterialCommunityIcons name="play" size={16} color={palette.onTint} />
                  <Text style={[styles.albumHeroPrimaryText, { color: palette.onTint }]}>
                    {t('播放专辑')}
                  </Text>
                </ScalePressable>
                <ScalePressable
                  onPress={shuffleFiltered}
                  pressedScale={0.95}
                  style={[styles.albumHeroSubBtn, { backgroundColor: palette.surfaceElevated }]}
                >
                  <MaterialCommunityIcons name="shuffle-variant" size={15} color={palette.label} />
                  <Text style={[styles.albumHeroSubText, { color: palette.label }]}>
                    {t('随机播')}
                  </Text>
                </ScalePressable>
              </View>
            </View>
          </View>
        </View>
      );
    }
    if (!filteredSongs.length) return null;
    return (
      <View style={styles.toolbarRow}>
        <ScalePressable
          onPress={playAllFiltered}
          pressedScale={0.96}
          style={[styles.playAllPill, { backgroundColor: palette.tintSoft }]}
        >
          <MaterialCommunityIcons name="play-circle" size={18} color={palette.tint} />
          <Text style={[styles.playAllText, { color: palette.tint }]}>
            {`${t('播放全部')} (${filteredSongs.length})`}
          </Text>
        </ScalePressable>

        <ScalePressable
          onPress={shuffleFiltered}
          pressedScale={0.95}
          style={[styles.shufflePill, { backgroundColor: palette.fill2 }]}
        >
          <MaterialCommunityIcons name="shuffle-variant" size={16} color={palette.labelSecondary} />
          <Text style={[styles.shuffleText, { color: palette.labelSecondary }]}>{t('随机播')}</Text>
        </ScalePressable>
      </View>
    );
  }, [
    albumFilter,
    filteredSongs,
    palette.fill2,
    palette.tint,
    palette.tintSoft,
    palette.onTint,
    palette.label,
    palette.labelSecondary,
    palette.surfaceElevated,
    playAllFiltered,
    shuffleFiltered,
    t,
  ]);

  const listFooter = useMemo(
    () => <View style={{ height: listBottomSpacerHeight }} />,
    [listBottomSpacerHeight],
  );

  const actionFav = actionTrack ? isTrackInFavSet(favSet, actionTrack) : false;
  const actionAlbum = actionTrack ? String(actionTrack.album || '').trim() : '';

  return (
    <View style={styles.container}>
      <ScreenHeader
        title={albumFilter ? albumFilter.album : t('音乐')}
        onBack={() => {
          if (albumFilter) setAlbumFilter(null);
          else navigation.goBack();
        }}
        style={styles.floatingHeader}
        right={
          albumFilter ? undefined : (
            <>
              <FloatingHeaderAction
                icon={showSearch ? 'close' : 'magnify'}
                active={showSearch}
                accessibilityLabel={showSearch ? t('关闭') : t('搜索歌曲、成员、专辑')}
                onPress={() => {
                  if (showSearch) {
                    Keyboard.dismiss();
                    setSearchOpen(false);
                    setQueryInput('');
                    setQuery('');
                  } else {
                    setSearchOpen(true);
                  }
                }}
              />
              <FloatingHeaderAction
                icon={viewMode === 'songs' ? 'album' : 'format-list-bulleted'}
                active={viewMode === 'albums'}
                accessibilityLabel={viewMode === 'songs' ? t('专辑') : t('单曲')}
                onPress={() => setViewMode((v) => (v === 'songs' ? 'albums' : 'songs'))}
              />
              <FloatingHeaderAction
                icon="refresh"
                active={loading}
                accessibilityLabel={t('刷新')}
                onPress={() => void loadAll(true)}
              />
            </>
          )
        }
      />

      {showSearch && !albumFilter ? (
        <View style={{ paddingTop: headerOffset }}>
          <SearchBar
            value={queryInput}
            onChangeText={setQueryInput}
            placeholder={t('搜索歌曲、成员、专辑')}
            style={styles.searchBar}
          />
        </View>
      ) : null}

      {!albumFilter ? (
        <View style={[styles.tabsBarWrap, { paddingTop: showSearch ? 2 : headerOffset }]}>
          <GlassSegmentedScroll
            options={groupSegOptions}
            value={group}
            onChange={setGroup}
            height={36}
            labelFontSize={12}
          />
        </View>
      ) : (
        <View style={{ height: headerOffset }} />
      )}

      {status ? (
        statusIsError ? (
          <ErrorState title={t('加载失败')} hint={status} onAction={() => void loadAll()} />
        ) : (
          <View pointerEvents="none" style={styles.statusInfo}>
            <Text style={[styles.status, { color: palette.tint }]}>{status}</Text>
          </View>
        )
      ) : null}

      {songs.length === 0 && (loading || !listReady) ? (
        <View style={styles.listContent}>
          <View style={styles.bootSplashPill}>
            <ActivityIndicator size="small" color={palette.tint} />
            <Text style={[styles.bootSplashText, { color: palette.labelSecondary }]}>
              {t('加载中')}
            </Text>
          </View>
          {[0, 1, 2, 3, 4, 5].map((row) => (
            <View key={row} style={styles.skeletonRow}>
              <Skeleton width={50} height={50} radius={10} />
              <View style={{ flex: 1 }}>
                <Skeleton width="62%" height={14} radius={6} />
                <Skeleton width="42%" height={11} radius={5} style={{ marginTop: 7 }} />
              </View>
            </View>
          ))}
        </View>
      ) : !loading && songs.length === 0 && !status ? (
        <View style={styles.emptyWrap}>
          <EmptyState icon="music-off" title={t('暂无音乐')} hint={t('点击右上角刷新，拉取曲库')} />
        </View>
      ) : !loading && filteredSongs.length === 0 ? (
        <View style={styles.emptyWrap}>
          <EmptyState
            icon={
              group === 'FAV' ? 'heart-outline' : group === 'RECENT' ? 'history' : 'magnify-close'
            }
            title={
              group === 'FAV'
                ? t('还没有收藏歌曲')
                : group === 'RECENT'
                  ? t('暂无最近播放')
                  : t('没有匹配的歌曲')
            }
            hint={
              group === 'FAV'
                ? t('点歌曲封面右下角的 ♥ 即可收藏')
                : group === 'RECENT'
                  ? t('播放歌曲后会显示在这里')
                  : t('换个关键词或分团试试')
            }
          />
        </View>
      ) : viewMode === 'albums' && !albumFilter ? (
        <PerfFlatList
          data={displayAlbums}
          key="albums-grid"
          keyExtractor={albumKeyExtractor}
          numColumns={2}
          initialNumToRender={8}
          maxToRenderPerBatch={6}
          windowSize={5}
          updateCellsBatchingPeriod={30}
          columnWrapperStyle={styles.albumColumnWrap}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.listContent}
          ListFooterComponent={listFooter}
          renderItem={renderAlbumItem}
        />
      ) : (
        <PerfFlatList
          data={displaySongs}
          key="songs-rows"
          extraData={`${activeTrackSig}:${playbackState}:${favorites.length}`}
          initialNumToRender={12}
          maxToRenderPerBatch={8}
          windowSize={5}
          updateCellsBatchingPeriod={30}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          keyExtractor={songKeyExtractor}
          getItemLayout={!albumFilter ? getSongItemLayout : undefined}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={songToolbarHeader}
          ListFooterComponent={listFooter}
          renderItem={renderSongItem}
        />
      )}

      {actionTrack ? (
        <Modal
          visible
          transparent
          animationType="fade"
          statusBarTranslucent
          navigationBarTranslucent
          onRequestClose={() => setActionTrack(null)}
        >
          <TouchableOpacity
            style={styles.sheetMask}
            activeOpacity={1}
            onPress={() => setActionTrack(null)}
          >
            <View
              style={[
                styles.actionSheet,
                {
                  backgroundColor: palette.surfaceElevated,
                  borderTopColor: palette.hairline,
                  paddingBottom: Math.max(20, insets.bottom + 12),
                },
              ]}
              onStartShouldSetResponder={() => true}
            >
              <View style={[styles.sheetHandle, { backgroundColor: palette.fill3 }]} />
              <View style={styles.sheetHeader}>
                <CoverArt
                  uri={actionTrack.coverUrl || actionTrack.cover || undefined}
                  title={actionTrack.title || '♪'}
                  size={48}
                  borderRadius={10}
                  thumbnail={120}
                />
                <View style={styles.sheetHeaderMeta}>
                  <Text numberOfLines={1} style={[styles.sheetTitle, { color: palette.label }]}>
                    {actionTrack.title || t('未知')}
                  </Text>
                  <Text
                    numberOfLines={1}
                    style={[styles.sheetSub, { color: palette.labelSecondary }]}
                  >
                    {formatTrackSubtitle(actionTrack) || t('官方音乐')}
                  </Text>
                </View>
              </View>

              <ScalePressable
                onPress={() => {
                  const tr = actionTrack;
                  setActionTrack(null);
                  const st = useMusicPlayerStore.getState();
                  if (!st.queue.length || st.playbackState === 'idle') {
                    void MusicEngine.playTrack(tr, [tr]);
                  } else {
                    st.insertNextInQueue(tr);
                    showToast(t('已设为下一首播放'));
                  }
                }}
                pressedScale={0.98}
                style={styles.sheetActionItem}
              >
                <MaterialCommunityIcons name="playlist-play" size={22} color={palette.tint} />
                <Text style={[styles.sheetActionLabel, { color: palette.label }]}>
                  {t('下一首播放')}
                </Text>
              </ScalePressable>

              <ScalePressable
                onPress={() => {
                  const tr = actionTrack;
                  setActionTrack(null);
                  const st = useMusicPlayerStore.getState();
                  if (!st.queue.length || st.playbackState === 'idle') {
                    void MusicEngine.playTrack(tr, [tr]);
                  } else {
                    st.addToQueue(tr);
                    showToast(t('已加入播放队列'));
                  }
                }}
                pressedScale={0.98}
                style={styles.sheetActionItem}
              >
                <MaterialCommunityIcons name="playlist-plus" size={22} color={palette.label} />
                <Text style={[styles.sheetActionLabel, { color: palette.label }]}>
                  {t('加入播放队列')}
                </Text>
              </ScalePressable>

              {actionAlbum ? (
                <ScalePressable
                  onPress={() => {
                    const tr = actionTrack;
                    setActionTrack(null);
                    setAlbumFilter({
                      groupLabel: String(tr.groupLabel || ''),
                      album: String(tr.album || ''),
                      cover: String(tr.coverUrl || tr.cover || ''),
                    });
                  }}
                  pressedScale={0.98}
                  style={styles.sheetActionItem}
                >
                  <MaterialCommunityIcons name="album" size={21} color={palette.label} />
                  <Text style={[styles.sheetActionLabel, { color: palette.label }]}>
                    {t('查看所属专辑')}
                  </Text>
                </ScalePressable>
              ) : null}

              <ScalePressable
                onPress={() => {
                  const tr = actionTrack;
                  setActionTrack(null);
                  handleToggleFav(tr);
                }}
                pressedScale={0.98}
                style={styles.sheetActionItem}
              >
                <MaterialCommunityIcons
                  name={actionFav ? 'heart' : 'heart-outline'}
                  size={21}
                  color={actionFav ? palette.danger : palette.label}
                />
                <Text style={[styles.sheetActionLabel, { color: palette.label }]}>
                  {actionFav ? t('取消收藏') : t('收藏')}
                </Text>
              </ScalePressable>
            </View>
          </TouchableOpacity>
        </Modal>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  floatingHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 20,
  },
  searchBar: {
    marginHorizontal: 16,
    marginBottom: 8,
  },
  tabsBarWrap: {
    paddingHorizontal: 16,
    marginBottom: 6,
  },
  status: { fontSize: 12, fontWeight: '700' },
  statusInfo: { paddingVertical: 6, alignItems: 'center' },
  listContent: { paddingHorizontal: 14, paddingTop: 4, paddingBottom: 16 },
  bootSplashPill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10,
  },
  bootSplashText: {
    fontSize: 13,
    fontFamily: fontFamily.system,
    fontWeight: '600',
  },
  emptyWrap: { flex: 1, alignItems: 'stretch' },
  skeletonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    height: TRACK_ROW_HEIGHT,
  },
  toolbarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    paddingHorizontal: 2,
  },
  playAllPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    height: 36,
    borderRadius: 18,
  },
  playAllText: {
    fontSize: 13,
    fontFamily: fontFamily.system,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  shufflePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    height: 34,
    borderRadius: 17,
  },
  shuffleText: {
    fontSize: 12,
    fontFamily: fontFamily.system,
    fontWeight: '600',
  },
  trackRow: {
    height: TRACK_ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    gap: 10,
  },
  trackNumBox: {
    width: 32,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trackNumText: {
    fontSize: 13,
    fontFamily: fontFamily.system,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  rowCoverWrap: {
    width: 50,
    height: 50,
    borderRadius: 10,
    overflow: 'hidden',
  },
  rowActiveOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.44)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowTextCol: {
    flex: 1,
    minWidth: 0,
  },
  rowTitle: {
    fontSize: 15,
    fontFamily: fontFamily.system,
    lineHeight: 20,
  },
  rowSub: {
    fontSize: 12,
    fontFamily: fontFamily.system,
    marginTop: 2,
    lineHeight: 16,
  },
  rowRightCol: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  rowDur: {
    fontSize: 11,
    fontFamily: fontFamily.system,
    fontVariant: ['tabular-nums'],
    marginRight: 4,
  },
  rowIconBtn: {
    width: 32,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBtnPressed: {
    opacity: 0.55,
  },
  albumColumnWrap: {
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  albumItem: {
    paddingBottom: 2,
  },
  albumPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.97 }],
  },
  albumTitle: {
    fontSize: 14,
    fontFamily: fontFamily.system,
    fontWeight: '700',
    lineHeight: 19,
    marginTop: 7,
  },
  albumSub: {
    fontSize: 11,
    fontFamily: fontFamily.system,
    marginTop: 2,
  },
  albumHeroBox: {
    borderRadius: 20,
    borderCurve: 'continuous',
    overflow: 'hidden',
    padding: 14,
    marginBottom: 12,
  },
  albumHeroInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  albumHeroInfo: {
    flex: 1,
    minWidth: 0,
  },
  albumHeroTitle: {
    fontSize: 18,
    fontFamily: fontFamily.system,
    fontWeight: '800',
    lineHeight: 23,
  },
  albumHeroMeta: {
    fontSize: 12,
    fontFamily: fontFamily.system,
    marginTop: 4,
  },
  albumHeroBtns: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
  },
  albumHeroPrimaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 14,
    height: 34,
    borderRadius: 17,
  },
  albumHeroPrimaryText: {
    fontSize: 12,
    fontFamily: fontFamily.system,
    fontWeight: '700',
  },
  albumHeroSubBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    height: 34,
    borderRadius: 17,
  },
  albumHeroSubText: {
    fontSize: 12,
    fontFamily: fontFamily.system,
    fontWeight: '600',
  },
  sheetMask: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.48)',
    justifyContent: 'flex-end',
  },
  actionSheet: {
    borderTopLeftRadius: radii.sheet,
    borderTopRightRadius: radii.sheet,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 18,
  },
  sheetHandle: {
    width: 38,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 12,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingBottom: 14,
    marginBottom: 6,
  },
  sheetHeaderMeta: { flex: 1, minWidth: 0 },
  sheetTitle: {
    fontSize: 16,
    fontFamily: fontFamily.system,
    fontWeight: '700',
  },
  sheetSub: {
    fontSize: 12,
    fontFamily: fontFamily.system,
    marginTop: 3,
  },
  sheetActionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
    paddingHorizontal: 4,
  },
  sheetActionLabel: {
    fontSize: 15,
    fontFamily: fontFamily.system,
    fontWeight: '600',
  },
});
