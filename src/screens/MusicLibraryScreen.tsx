import { useIsFocused, useNavigation } from '@react-navigation/native';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PerfFlatList } from '../components/PerfFlatList';
import { USER_AGENT } from '../constants';

import {
  ActivityIndicator,
  Animated,
  BackHandler,
  Easing,
  InteractionManager,
  Keyboard,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from '../hooks/useSafeAreaInsets';
import officialMediaApi from '../api/officialMedia';
import { loadOfficialSiteMusic } from '../api/officialSiteMusic';
import { loadR2Music } from '../api/r2Music';
import { useUiStore } from '../store';
import { flushMusicPlayerStorage, useMusicPlayerStore } from '../store/musicPlayerStore';
import MiniPlayerBar from '../components/MiniPlayerBar';
import FullScreenPlayer from '../components/FullScreenPlayer';
import {
  MusicEngine,
  mediaUrl as buildMediaUrl,
  isPlayableHost,
  isExoRecentlyArmed,
  noteExoArmed,
  resetExoArm,
  syncNativePlaybackSnapshot,
} from '../services/musicPlayer';
import { exoPlayTrack, exoControl, subscribeExo, setNativeExoDisabled } from '../native/RadioExo';
import { errorMessage } from '../utils/data';
import { logWarn } from '../utils/runtimeLog';
import { fetchCoverToFile, normalizeCoverUrl } from '../utils/coverToFile';
import { formatTrackSubtitle } from '../utils/format';
import { FloatingHeaderAction, getFloatingHeaderOffset } from '../components/FloatingTabHeader';
import ScreenHeader from '../components/ScreenHeader';
import CoverArt from '../components/CoverArt';
import { NetworkImage } from '../components/NetworkImage';
import { Skeleton } from '../components/Skeleton';
import { EmptyState, ErrorState } from '../components/StateViews';
import { ScalePressable } from '../components/Motion';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { usePalette, fontFamily } from '../theme';
import { useI18n } from '../i18n';
import { GlassSegmentedScroll } from '../components/GlassSegmented';
import { SearchBar } from '../components/SearchBar';
import { SquircleView } from '../components/SquircleView';

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

const SNH_FAMILY = new Set([
  'SNH48',
  '7SENSES',
  'BLUEV',
  'DEMOON',
  'HO2',
  'COLOR GIRLS',
  'Color Girls',
  '塞纳河组合',
]);

const groupFamily = (g: string): string =>
  SNH_FAMILY.has(String(g || '').trim()) ? 'SNH48' : String(g || '').trim();

const albumGroupOrder = (g: string): number => {
  const up = groupFamily(g).toUpperCase();
  if (up === 'SNH48') return 0;
  const map: Record<string, number> = {
    GNZ48: 10,
    BEJ48: 20,
    AKB48: 30,
    CKG48: 40,
    CGT48: 50,
    SHY48: 60,
    TSH48: 70,
    TPE48: 80,
  };
  return map[up] ?? 90;
};
const GROUP_TABS = [
  'ALL',
  'FAV',
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
  SNH48: 'SNH48',
  GNZ48: 'GNZ48',
  BEJ48: 'BEJ48',
  AKB48: 'AKB48',
  CKG48: 'CKG48',
  CGT48: 'CGT48',
  SHY48: 'SHY48',
  TSH48: 'TSH48',
  TPE48: 'TPE48',
  '7SENSES': '7SENSES',
  FAV: '收藏',
};

let songsCache: any[] | null = null;

function normTrackField(v: unknown): string {
  return String(v || '')
    .trim()
    .toLowerCase();
}

function isSameTrackItem(a: any, b: any): boolean {
  if (!a || !b) return false;
  const idA = String(a.musicId || a.id || '');
  const idB = String(b.musicId || b.id || '');
  if (!idA || idA !== idB) return false;
  return (
    normTrackField(a.title) === normTrackField(b.title) &&
    normTrackField(a.artist || a.joinMemberNames) ===
      normTrackField(b.artist || b.joinMemberNames) &&
    normTrackField(a.album || a.albumName) === normTrackField(b.album || b.albumName)
  );
}

function isTrackInFavSet(favSet: Set<string>, track: any): boolean {
  if (!favSet.size || !track) return false;
  const id = String(track.musicId || track.id || '');
  if (id && favSet.has(id)) return true;
  const k2 = `${String(track.title || '').trim()}|${String(track.artist || '').trim()}`.trim();
  const k3 = `${k2}|${String(track.album || '').trim()}`.trim();
  return (k3 !== '||' && favSet.has(k3)) || (k2 !== '|' && favSet.has(k2));
}

const AlbumGridCard = React.memo(function AlbumGridCard({
  item,
  fill2Color,
  labelColor,
  labelTertiaryColor,
  unknownGroupText,
  songsUnitText,
  onPress,
}: {
  item: { key: string; groupLabel: string; album: string; cover: string; count: number };
  fill2Color: string;
  labelColor: string;
  labelTertiaryColor: string;
  unknownGroupText: string;
  songsUnitText: string;
  onPress: (album: { groupLabel: string; album: string }) => void;
}) {
  return (
    <View style={styles.albumItem}>
      <TouchableOpacity
        activeOpacity={0.8}
        onPress={() => onPress({ groupLabel: item.groupLabel, album: item.album })}
      >
        <SquircleView radius={16} style={[styles.albumCover, { backgroundColor: fill2Color }]}>
          {item.cover ? (
            <NetworkImage
              source={{ uri: item.cover }}
              style={{ width: '100%', height: '100%' }}
              resizeMode="cover"
              thumbnail={600}
            />
          ) : (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <MaterialCommunityIcons name="album" size={40} color={labelTertiaryColor} />
            </View>
          )}
          <View style={styles.albumCountPill}>
            <Text style={styles.albumCountText}>
              {item.count} {songsUnitText}
            </Text>
          </View>
        </SquircleView>
        <Text numberOfLines={1} style={[styles.songTitle, { color: labelColor, marginTop: 6 }]}>
          {item.album}
        </Text>
        <Text numberOfLines={1} style={[styles.songArtist, { color: labelTertiaryColor }]}>
          {item.groupLabel || unknownGroupText}
        </Text>
      </TouchableOpacity>
    </View>
  );
});

const SongGridCard = React.memo(function SongGridCard({
  item,
  active,
  isPlaying,
  isLoading,
  isFav,
  tintColor,
  onTintColor,
  dangerColor,
  fill2Color,
  labelColor,
  labelTertiaryColor,
  untitledText,
  officialText,
  onPlay,
  onToggleFav,
}: {
  item: any;
  active: boolean;
  isPlaying: boolean;
  isLoading: boolean;
  isFav: boolean;
  tintColor: string;
  onTintColor: string;
  dangerColor: string;
  fill2Color: string;
  labelColor: string;
  labelTertiaryColor: string;
  untitledText: string;
  officialText: string;
  onPlay: (item: any) => void;
  onToggleFav: (item: any) => void;
}) {
  const coverUrl = item.coverUrl || item.cover || item.thumbPath || '';
  return (
    <View style={styles.albumItem}>
      <TouchableOpacity activeOpacity={0.8} onPress={() => onPlay(item)}>
        <SquircleView
          radius={16}
          style={[
            styles.albumCover,
            {
              backgroundColor: fill2Color,
              borderWidth: 2,
              borderColor: active ? tintColor : 'transparent',
            },
          ]}
        >
          <CoverArt uri={coverUrl || undefined} title={item.title || '♪'} fill active={active} />
          {active ? (
            <View style={[styles.playingBadge, { backgroundColor: tintColor }]}>
              {isLoading ? (
                <ActivityIndicator size="small" color={onTintColor} />
              ) : (
                <EqualizerBars color={onTintColor} active={isPlaying} />
              )}
            </View>
          ) : null}
          <ScalePressable
            style={styles.favBtn}
            pressedScale={0.85}
            activeOpacity={0.6}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            onPress={(e) => {
              e.stopPropagation();
              onToggleFav(item);
            }}
          >
            <MaterialCommunityIcons
              name={isFav ? 'heart' : 'heart-outline'}
              size={16}
              color={isFav ? dangerColor : onTintColor}
            />
          </ScalePressable>
        </SquircleView>
        <Text
          numberOfLines={1}
          ellipsizeMode="tail"
          style={[styles.songTitle, { color: labelColor, marginTop: 6 }]}
        >
          {item.title || untitledText}
        </Text>
        <View style={styles.songMetaLine}>
          <Text style={[styles.songArtist, { color: labelTertiaryColor }]} numberOfLines={1}>
            {formatTrackSubtitle(item) || officialText}
          </Text>
        </View>
      </TouchableOpacity>
    </View>
  );
});

export default function MusicLibraryScreen() {
  const navigation = useNavigation();
  const screenFocused = useIsFocused();
  const insets = useSafeAreaInsets();
  const palette = usePalette();
  const { t } = useI18n();
  const showToast = useUiStore((state) => state.showToast);
  const playbackState = useMusicPlayerStore((s) => s.playbackState);
  const playUrl = useMusicPlayerStore((s) => s.url);

  const playVolume = useMemo(() => {
    const u = String(playUrl || '').toLowerCase();
    return /(gnz\.hk|gnz-music|music\.gnz)/.test(u) || /\.r2\.|r2-music/i.test(u) ? 0.86 : 1.0;
  }, [playUrl]);
  const currentIndex = useMusicPlayerStore((s) => s.currentIndex);
  const queue = useMusicPlayerStore((s) => s.queue);
  const playMode = useMusicPlayerStore((s) => s.playMode);
  const favorites = useMusicPlayerStore((s) => s.favorites);
  const toggleFavorite = useMusicPlayerStore((s) => s.toggleFavorite);
  const seekTarget = useMusicPlayerStore((s) => s.seekTarget);
  const seekNonce = useMusicPlayerStore((s) => s.seekNonce);
  const seekPending = useMusicPlayerStore((s) => s.seekPending);
  const [nativeSnapshotReady, setNativeSnapshotReady] = useState(false);
  const nativeSnapshotBlockedRef = useRef(false);
  const nativeSnapshotBlockedKeyRef = useRef({ index: -1, url: '' });
  useEffect(() => {
    let alive = true;
    const task = InteractionManager.runAfterInteractions(() => {
      void syncNativePlaybackSnapshot()
        .then((result) => {
          if (!alive) return;
          if (result.active && !result.matched) {
            const current = useMusicPlayerStore.getState();
            nativeSnapshotBlockedRef.current = true;
            nativeSnapshotBlockedKeyRef.current = { index: current.currentIndex, url: current.url };
          }
          setNativeSnapshotReady(true);
        })
        .catch(() => {
          if (alive) setNativeSnapshotReady(true);
        });
    });
    return () => {
      alive = false;
      task.cancel();
    };
  }, []);
  useEffect(() => {
    const blockedAt = nativeSnapshotBlockedKeyRef.current;
    if (
      nativeSnapshotBlockedRef.current &&
      (currentIndex !== blockedAt.index || playUrl !== blockedAt.url)
    ) {
      nativeSnapshotBlockedRef.current = false;
    }
  }, [currentIndex, playUrl]);
  const [songs, setSongs] = useState<any[]>(songsCache ?? []);
  const applySongs = (list: any[]) => {
    songsCache = list;
    setSongs(list);
  };

  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [group, setGroup] = useState('ALL');

  const [viewMode, setViewMode] = useState<'songs' | 'albums'>('songs');
  const [albumFilter, setAlbumFilter] = useState<{ groupLabel: string; album: string } | null>(
    null,
  );
  const onQueryChange = (q: string) => {
    setQuery(q);
  };
  const onGroupChange = (g: string) => {
    setGroup(g);
  };
  const [status, setStatus] = useState('');

  const [statusIsError, setStatusIsError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [, setHasMore] = useState(true);
  const loadingRef = useRef(false);
  const consumedSeekNonceRef = useRef(0);

  const favSet = useMemo(() => new Set(favorites), [favorites]);
  const favCount = useMemo(
    () => songs.filter((t) => isTrackInFavSet(favSet, t)).length,
    [songs, favSet],
  );
  const filteredSongs = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    let list = songs;
    if (albumFilter)
      list = list.filter(
        (item) =>
          String(item.groupLabel || '') === albumFilter.groupLabel &&
          String(item.album || '') === albumFilter.album,
      );
    else if (group === 'FAV') list = list.filter((item) => isTrackInFavSet(favSet, item));
    else if (group !== 'ALL') list = list.filter((item) => groupFamily(item.groupLabel) === group);
    if (keyword)
      list = list.filter((item) =>
        [item.title, item.artist, item.album, item.groupLabel]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(keyword),
      );
    return list;
  }, [query, songs, group, favSet, albumFilter]);

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
  const curTrack = queue[currentIndex];
  const hasMiniPlayer = queue.length > 0 && playbackState !== 'idle';
  const listBottomSpacerHeight = hasMiniPlayer ? 104 + Math.max(10, insets.bottom - 32) : 20;

  const albums = useMemo(() => {
    const map = new Map<
      string,
      { key: string; groupLabel: string; album: string; cover: string; count: number }
    >();
    for (const t of filteredSongs) {
      const album = String(t.album || '').trim();
      if (!album) continue;
      const key = `${String(t.groupLabel || '')}|${album}`;
      const entry = map.get(key) || {
        key,
        groupLabel: String(t.groupLabel || ''),
        album,
        cover: '',
        count: 0,
      };
      entry.count += 1;
      if (!entry.cover) entry.cover = String(t.coverUrl || t.cover || '');
      map.set(key, entry);
    }
    return [...map.values()].sort((a, b) => {
      const oa = albumGroupOrder(a.groupLabel);
      const ob = albumGroupOrder(b.groupLabel);
      if (oa !== ob) return oa - ob;
      const ga = String(a.groupLabel || '').toLowerCase();
      const gb = String(b.groupLabel || '').toLowerCase();
      if (ga !== gb) return ga < gb ? -1 : 1;
      return String(a.album || '').localeCompare(String(b.album || ''), 'zh');
    });
  }, [filteredSongs]);

  const loadAll = async (force = false) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    if (!songs.length) setLoading(true);
    setStatus('');
    setStatusIsError(false);
    try {
      const [officialRes, r2Res] = await Promise.allSettled([
        loadOfficialSiteMusic(force),
        loadR2Music(force),
      ]);
      const official = officialRes.status === 'fulfilled' ? officialRes.value : [];
      const r2 = r2Res.status === 'fulfilled' ? r2Res.value : [];
      if (officialRes.status === 'rejected' && r2Res.status === 'rejected') {
        const err =
          (officialRes as PromiseRejectedResult).reason || (r2Res as PromiseRejectedResult).reason;
        throw err instanceof Error ? err : new Error('音乐列表加载失败');
      }

      const seen = new Set<string>();
      const merged: any[] = [];

      const dedupKey = (t: any) =>
        `${String(t.title || '')
          .trim()
          .toLowerCase()}|${String(t.artist || '')
          .trim()
          .toLowerCase()}|${String(t.album || '')
          .trim()
          .toLowerCase()}`;
      r2.forEach((t: any) => {
        const key = dedupKey(t);
        if (seen.has(key)) return;
        seen.add(key);
        merged.push(t);
      });
      official.forEach((t: any) => {
        const key = dedupKey(t);
        if (seen.has(key)) return;
        seen.add(key);
        merged.push(t);
      });

      merged.sort((a: any, b: any) => {
        const oa = albumGroupOrder(a.groupLabel);
        const ob = albumGroupOrder(b.groupLabel);
        if (oa !== ob) return oa - ob;
        const sa = Number(a.sourceIndex) || 0;
        const sb = Number(b.sourceIndex) || 0;
        if (sa !== sb) return sa - sb;
        const ga = String(a.groupLabel || '')
          .trim()
          .toLowerCase();
        const gb = String(b.groupLabel || '')
          .trim()
          .toLowerCase();
        if (ga !== gb) return ga < gb ? -1 : 1;
        return String(a.title || '').localeCompare(String(b.title || ''), 'zh');
      });
      applySongs(merged);
      setHasMore(false);

      if (r2Res.status === 'rejected' && officialRes.status === 'fulfilled') {
        setStatus(t('官方音乐已加载（R2 源暂不可用）'));
        setStatusIsError(false);
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
    const task = InteractionManager.runAfterInteractions(() => {
      void loadAllRef.current();
    });
    return () => {
      task.cancel();
    };
  }, [t]);

  const [showFullScreen, setShowFullScreen] = useState(false);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!navigation.isFocused()) return false;
      if (showFullScreen) {
        setShowFullScreen(false);
        return true;
      }
      if (albumFilter) {
        setAlbumFilter(null);
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [navigation, showFullScreen, albumFilter]);

  useEffect(() => {
    if (!seekPending || !seekNonce || seekNonce === consumedSeekNonceRef.current) return;
    if (nativeOkRef.current && !nativeDisabledRef.current) {
      const st = useMusicPlayerStore.getState();
      st.setPosition(seekTarget);
      exoControl('seek', seekTarget);
      consumedSeekNonceRef.current = seekNonce;
      st.consumeSeekTarget();
    }
  }, [seekTarget, seekNonce, seekPending]);

  const [, setNativeOk] = useState(false);
  const nativeOkRef = useRef(false);
  const nativeDisabledRef = useRef(false);

  const [, setNativeDisabled] = useState(false);

  useEffect(() => {
    MusicEngine.setScreenAttached(true);
    return () => {
      MusicEngine.setScreenAttached(false);
      flushMusicPlayerStorage();
    };
  }, []);

  const setNativeDisabledBoth = (v: boolean) => {
    nativeDisabledRef.current = v;
    setNativeDisabled(v);
  };
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const armSeqRef = useRef(0);
  const setNativeState = (v: boolean) => {
    nativeOkRef.current = v;
    setNativeOk(v);
  };
  const cancelArmTimer = () => {
    if (armTimer.current) {
      clearTimeout(armTimer.current);
      armTimer.current = null;
    }
  };

  useEffect(
    () => () => {
      if (armTimer.current) {
        clearTimeout(armTimer.current);
        armTimer.current = null;
      }
    },
    [],
  );

  const armedUrlRef = useRef('');

  const lastProgressTsRef = useRef(0);

  useEffect(
    () =>
      subscribeExo((type, p: any) => {
        try {
          const st = useMusicPlayerStore.getState();
          if (type === 'progress') {
            const playingN = !!p?.playing;

            const staleUrl = !!p?.url && !!st.url && String(p.url) !== String(st.url);
            if (playingN && !staleUrl) {
              lastProgressTsRef.current = Date.now();
              cancelArmTimer();
            }
          } else if (type === 'error') {
            if (!nativeDisabledRef.current) {
              setNativeDisabledBoth(true);
              setNativeExoDisabled(true);
              cancelArmTimer();
              armSeqRef.current += 1;
              setNativeState(false);
              try {
                exoControl('stop');
              } catch {}

              const stNow = useMusicPlayerStore.getState();
              if (stNow.position > 0) stNow.setSeekTarget(stNow.position);
            }
          }
        } catch {}
      }),
    [],
  );

  useEffect(() => {
    if (
      !nativeSnapshotReady ||
      nativeSnapshotBlockedRef.current ||
      !playUrl ||
      playbackState !== 'playing'
    )
      return;
    if (nativeDisabledRef.current) return;

    if (!nativeOkRef.current) setNativeState(true);
    if (
      (armedUrlRef.current === playUrl && Date.now() - lastProgressTsRef.current < 8000) ||
      isExoRecentlyArmed(playUrl)
    ) {
      armedUrlRef.current = playUrl;
      lastProgressTsRef.current = Date.now();
      return;
    }
    const st = useMusicPlayerStore.getState();
    const tr = st.queue[st.currentIndex];
    if (!tr) return;
    const seq = ++armSeqRef.current;
    cancelArmTimer();
    armedUrlRef.current = playUrl;
    const headers = {
      'User-Agent': USER_AGENT,
      Referer: 'https://h5.48.cn/',
      Origin: 'https://h5.48.cn',
    };
    const volume = playVolume > 0 ? playVolume : 1;
    const repeat = playMode === 'single' ? 1 : 0;
    const doPush = (art: string, armWatchdog = true) => {
      if (seq !== armSeqRef.current) return;
      const st2 = useMusicPlayerStore.getState();
      if (!st2.url || st2.url !== playUrl || st2.playbackState !== 'playing') return;
      const progressAtArm = lastProgressTsRef.current;

      const resumeAt =
        !art && st2.seekPending && Number(st2.seekTarget) > 0 ? Number(st2.seekTarget) : 0;
      if (__DEV__) logWarn(`[push-page] ${art ? 'art-refresh' : 'initial'} resumeAt=${resumeAt}`);
      if (resumeAt > 0) {
        consumedSeekNonceRef.current = st2.seekNonce;
        st2.consumeSeekTarget();
      }
      noteExoArmed(playUrl);
      exoPlayTrack(
        {
          url: playUrl,
          trackId: String(tr.musicId || tr.id || ''),
          title: String(tr.title || '音乐'),
          artist: String((tr as any).artist || (tr as any).groupLabel || ''),
          album: String((tr as any).album || ''),
          art,
        },
        resumeAt,
        true,
        headers,
        volume,
        repeat,
      );
      if (!armWatchdog) return;

      cancelArmTimer();
      armTimer.current = setTimeout(() => {
        if (lastProgressTsRef.current <= progressAtArm && !nativeDisabledRef.current) {
          setNativeDisabledBoth(true);
          setNativeExoDisabled(true);
          setNativeState(false);
          try {
            exoControl('stop');
          } catch {}
          const stNow = useMusicPlayerStore.getState();
          if (stNow.position > 0) stNow.setSeekTarget(stNow.position);
          showToast(t('已切换兼容播放器'));
        }
      }, 7000);
    };

    doPush('', true);
    const coverRaw =
      String((tr as any).coverUrl || (tr as any).cover || (tr as any).thumbPath || '') || '';
    if (coverRaw) {
      (async () => {
        let art = '';
        try {
          art = await Promise.race([
            fetchCoverToFile(normalizeCoverUrl(coverRaw)),
            new Promise<string>((res) => setTimeout(() => res(''), 1500)),
          ]);
        } catch {
          art = '';
        }
        const stC = useMusicPlayerStore.getState();
        if (stC.url === playUrl && stC.playbackState === 'playing') {
          doPush(art || String((tr as any).coverUrl || (tr as any).cover || ''), false);
        }
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playUrl, currentIndex, playbackState, playMode, playVolume, nativeSnapshotReady]);

  useEffect(
    () => () => {
      try {
      } catch {}
    },
    [],
  );
  useEffect(() => {
    if (!nativeOkRef.current) return;
    exoControl('repeat', playMode === 'single' ? 1 : 0);
  }, [playMode, playbackState]);

  useEffect(() => {
    if (playbackState === 'idle') {
      cancelArmTimer();
      armSeqRef.current += 1;
      armedUrlRef.current = '';
      lastProgressTsRef.current = 0;
      resetExoArm();
      setNativeDisabledBoth(false);
      try {
        exoControl('stop');
      } catch {}
    }
  }, [playbackState]);

  const filteredSongsRef = useRef(filteredSongs);
  filteredSongsRef.current = filteredSongs;

  const playSong = useCallback((item: any) => {
    const st = useMusicPlayerStore.getState();
    const cur = st.queue[st.currentIndex];
    const sameAsCurrent = !!cur && (cur.musicId || cur.id) === (item.musicId || item.id);
    if (sameAsCurrent && st.playbackState === 'playing') {
      return;
    }

    if (sameAsCurrent && st.position > 0) {
      MusicEngine.resume();
      return;
    }

    MusicEngine.playTrack(
      item,
      filteredSongsRef.current.map((t) => ({ ...t })),
    );
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
    MusicEngine.playTrack(
      list[0],
      list.map((x) => ({ ...x })),
    );
  }, []);

  const shuffleFiltered = useCallback(() => {
    const list = filteredSongsRef.current;
    if (!list.length) return;
    useMusicPlayerStore.getState().setMode('random');
    const pick = list[Math.floor(Math.random() * list.length)];
    MusicEngine.playTrack(
      pick,
      list.map((x) => ({ ...x })),
    );
  }, []);

  const headerOffset = getFloatingHeaderOffset(insets.top);
  const showSearch = searchOpen || query.length > 0;

  return (
    <View style={styles.container}>
      {!showFullScreen ? (
        <ScreenHeader
          title={albumFilter ? albumFilter.album : t('音乐')}
          onBack={() => {
            if (albumFilter) setAlbumFilter(null);
            else navigation.goBack();
          }}
          style={styles.floatingHeader}
          right={
            <>
              {!albumFilter ? (
                <FloatingHeaderAction
                  icon={showSearch ? 'close' : 'magnify'}
                  active={showSearch}
                  accessibilityLabel={showSearch ? t('关闭') : t('搜索歌曲、成员、专辑')}
                  onPress={() => {
                    if (showSearch) {
                      Keyboard.dismiss();
                      setSearchOpen(false);
                      setQuery('');
                    } else {
                      setSearchOpen(true);
                    }
                  }}
                />
              ) : null}
              {!albumFilter ? (
                <FloatingHeaderAction
                  icon={viewMode === 'songs' ? 'album' : 'music-note-outline'}
                  active={viewMode === 'albums'}
                  accessibilityLabel={viewMode === 'songs' ? t('专辑') : t('单曲')}
                  onPress={() => setViewMode((v) => (v === 'songs' ? 'albums' : 'songs'))}
                />
              ) : null}
              {filteredSongs.length > 0 ? (
                <FloatingHeaderAction
                  icon="shuffle-variant"
                  accessibilityLabel={t('随机播')}
                  onPress={shuffleFiltered}
                />
              ) : null}
              {filteredSongs.length > 0 ? (
                <FloatingHeaderAction
                  icon="play"
                  iconColor={palette.tint}
                  accessibilityLabel={t('播放全部')}
                  onPress={playAllFiltered}
                />
              ) : null}
              {!albumFilter ? (
                <FloatingHeaderAction
                  icon="refresh"
                  active={loading}
                  accessibilityLabel={t('刷新')}
                  onPress={() => loadAll(true)}
                />
              ) : null}
            </>
          }
        />
      ) : null}

      {showSearch && !albumFilter ? (
        <View style={{ paddingTop: headerOffset }}>
          <SearchBar
            value={query}
            onChangeText={onQueryChange}
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
            onChange={onGroupChange}
            height={36}
            labelFontSize={12}
          />
        </View>
      ) : (
        <View style={{ height: headerOffset }} />
      )}
      {status ? (
        statusIsError ? (
          <ErrorState title={t('加载失败')} hint={status} onAction={() => loadAll()} />
        ) : (
          <View pointerEvents="none" style={styles.statusInfo}>
            <Text style={[styles.status, { color: palette.tint }]}>{status}</Text>
          </View>
        )
      ) : null}
      {loading && songs.length === 0 ? (
        <View style={{ flex: 1 }}>
          <View style={styles.listContent}>
            {[0, 1, 2].map((row) => (
              <View key={row} style={{ flexDirection: 'row', gap: 10, marginBottom: 12 }}>
                <View style={{ flex: 1 }}>
                  <Skeleton width="100%" height={150} radius={16} />
                  <Skeleton width="70%" height={12} radius={6} style={{ marginTop: 8 }} />
                  <Skeleton width="45%" height={10} radius={6} style={{ marginTop: 6 }} />
                </View>
                <View style={{ flex: 1 }}>
                  <Skeleton width="100%" height={150} radius={16} />
                  <Skeleton width="70%" height={12} radius={6} style={{ marginTop: 8 }} />
                  <Skeleton width="45%" height={10} radius={6} style={{ marginTop: 6 }} />
                </View>
              </View>
            ))}
          </View>
        </View>
      ) : !loading && songs.length === 0 && !status ? (
        <View style={styles.emptyWrap}>
          <EmptyState
            icon="music-off"
            title={group === 'FAV' ? t('还没有收藏歌曲') : t('暂无音乐')}
            hint={
              group === 'FAV'
                ? t('点歌曲封面右下角的 ♥ 即可收藏')
                : t('点击右上角刷新，拉取官方曲库')
            }
          />
        </View>
      ) : !loading && filteredSongs.length === 0 ? (
        <View style={styles.emptyWrap}>
          <EmptyState
            icon="magnify-close"
            title={t('没有匹配的歌曲')}
            hint={t('换个关键词或分团试试')}
          />
        </View>
      ) : viewMode === 'albums' && !albumFilter ? (
        <PerfFlatList
          data={albums}
          keyExtractor={(item) => item.key}
          numColumns={2}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.listContent}
          ListFooterComponent={<View style={{ height: listBottomSpacerHeight }} />}
          removeClippedSubviews={false}
          renderItem={({ item }) => (
            <AlbumGridCard
              item={item}
              fill2Color={palette.fill2}
              labelColor={palette.label}
              labelTertiaryColor={palette.labelTertiary}
              unknownGroupText={t('未知团体')}
              songsUnitText={t('首')}
              onPress={setAlbumFilter}
            />
          )}
        />
      ) : (
        <PerfFlatList
          data={filteredSongs}

          extraData={`${currentIndex}:${playbackState}:${favorites.length}`}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          keyExtractor={(item, index) =>
            `${item.groupKey || ''}-${item.musicId || item.id || ''}-${index}`
          }
          numColumns={2}

          removeClippedSubviews={false}
          contentContainerStyle={styles.listContent}
          ListFooterComponent={<View style={{ height: listBottomSpacerHeight }} />}
          renderItem={({ item }) => (
            <SongGridCard
              item={item}
              active={isSameTrackItem(curTrack, item)}
              isPlaying={screenFocused && playbackState === 'playing'}
              isLoading={playbackState === 'loading'}
              isFav={isTrackInFavSet(favSet, item)}
              tintColor={palette.tint}
              onTintColor={palette.onTint}
              dangerColor={palette.danger}
              fill2Color={palette.fill2}
              labelColor={palette.label}
              labelTertiaryColor={palette.labelTertiary}
              untitledText={t('无标题')}
              officialText={t('官方音乐')}
              onPlay={playSong}
              onToggleFav={handleToggleFav}
            />
          )}
        />
      )}

      <MiniPlayerBar onOpenFullScreen={() => setShowFullScreen(true)} />
      <FullScreenPlayer visible={showFullScreen} onClose={() => setShowFullScreen(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },

  albumItem: { width: '48.5%', marginBottom: 12, marginHorizontal: 5 },
  albumCover: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 22,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  albumCountPill: {
    position: 'absolute',
    right: 6,
    bottom: 6,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  albumCountText: { color: '#fff', fontSize: 11, fontFamily: fontFamily.system, fontWeight: '700' },
  searchBar: {
    marginHorizontal: 16,
    marginBottom: 8,
  },

  floatingHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 20,
  },
  tabsBarWrap: {
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  status: { fontSize: 12, fontWeight: '700' },
  statusInfo: { paddingVertical: 16, alignItems: 'center' },

  listContent: { paddingHorizontal: 12, paddingTop: 4, paddingBottom: 16 },
  emptyWrap: { flex: 1, alignItems: 'stretch' },

  playingBadge: {
    position: 'absolute',
    left: 8,
    bottom: 8,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  favBtn: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.28)',
  },
  songTitle: { fontSize: 15, fontFamily: fontFamily.system, fontWeight: '800', lineHeight: 20 },
  songMetaLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
    gap: 6,
  },
  songArtist: { fontSize: 12, fontFamily: fontFamily.system, flex: 1 },
});
