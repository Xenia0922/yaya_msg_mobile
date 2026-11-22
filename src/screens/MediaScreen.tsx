import React, { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NetworkImage } from '../components/NetworkImage';
import { USER_AGENT } from '../constants';
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PerfFlatList } from '../components/PerfFlatList';

import {
  ActivityIndicator,
  Animated,
  AppState,
  BackHandler,
  DeviceEventEmitter,
  Keyboard,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import * as ScreenOrientation from 'expo-screen-orientation';
import { RouteProp, useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { TabParamList } from '../navigation/types';
import { useSettingsStore, useUiStore, useMemberStore } from '../store';
import { useDiscoveredLivesStore } from '../store/discoveredLivesStore';
import { setPipPlaying, setPipAspectLive } from '../utils/pip';
import { useMiniPlayerStore } from '../store/miniPlayerStore';
import {
  FLOATING_BAR_HEIGHT,
  FloatingHeaderAction,
  FloatingTabHeader,
  getFloatingHeaderOffset,
} from '../components/FloatingTabHeader';
import { VODItem, Member } from '../types';
import { formatTimestamp, formatDuration } from '../utils/format';
import { errorMessage, normalizeUrl, pickText, unwrapList } from '../utils/data';
import { normalizeGiftList } from '../utils/giftList';
import { thumbUrl } from '../utils/imageThumb';
import { getResumePosition, saveResumePosition } from '../utils/resumePosition';
import { logInfo, logWarn } from '../utils/runtimeLog';
import pocketApi from '../api/pocket48';
import { setLiveImmersiveMode } from '../native/LivePlayer';

import { needsNativeExo as streamNeedsProxy } from '../player/resolve/streamResolver';
import PlayerScreen from '../player';
import { usePlayerStore } from '../player/store/playerStore';
import {
  clearGiftEffectQueue,
  isGiftEffectSupported,
  playGiftEffect,
} from '../services/giftEffect';
import { LiveBarrageBoard } from '../components/LiveBarrageBoard';
import { useLiveBarrage } from '../hooks/useLiveBarrage';
import DanmakuSettingsSheet from '../components/DanmakuSettingsSheet';
import { MediaCalendarSheet } from '../components/MediaCalendarSheet';
import DanmakuListSheet, { type DanmakuListEntry } from '../components/DanmakuListSheet';
import {
  enrichReplayDanmaku,
  parseDanmaku,
  replayBarrageToDanmaku,
  DanmakuItem,
} from '../utils/danmaku';
import { memberSearchText } from '../utils/members';
import { EmptyState } from '../components/StateViews';
import { readFollowedIdsCache, writeFollowedIdsCache } from '../services/followedIds';
import { matchFollowedMember } from './followedRooms/roomDomain';
import { LoginPrompt } from '../components/LoginPrompt';
import { Button } from '../components/Button';
import { Skeleton } from '../components/Skeleton';
import { Palettes, usePalette } from '../theme';
import type { Palette } from '../theme/colors';
import { styles } from './media/styles';
import {
  GRID_COVER_THUMB,
  buildMediaSearchText,
  dateKeyOf,
  pickPlayableUrls,
  isSharePageUrl,
  resolveSharePlayableUrls,
  findLiveItemInLists,
  normalizeLiveList,
  mergeUniqueLiveItems,
  normalizeLiveRank,
  rankNameIsFallback,
  profileFromUserRes,
  giftName,
  giftCost,
  giftImage,
  acceptUserId,
} from './media/parsing';
import { useI18n } from '../i18n';
import { GlassSegmented, GlassSegmentedScroll } from '../components/GlassSegmented';
import { SearchBar } from '../components/SearchBar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { UserProfileSheet, type UserProfileTarget } from '../components/UserProfileSheet';
import { ListBottomSpacer } from '../components/ListBottomSpacer';

type MediaRouteProp = RouteProp<TabParamList, 'Media'>;

const liveSheetPalette = Palettes.dark;

const MEDIA_GROUPS: { label: string; id: number; match: string }[] = [
  { label: '全部', id: 0, match: '' },
  { label: 'SNH48', id: 1, match: 'SNH48' },
  { label: 'BEJ48', id: 2, match: 'BEJ48' },
  { label: 'GNZ48', id: 3, match: 'GNZ48' },
  { label: 'CKG48', id: 4, match: 'CKG48' },
  { label: 'CGT48', id: 6, match: 'CGT48' },
];

function normalizeFollowName(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^(?:snh48|gnz48|bej48|ckg48|cgt48)[-_ ]/i, '');
}

const MEDIA_FOCUS_DEFER_MS = 240;
const MEDIA_FOCUS_COOLDOWN_MS = 20000;

const sharedLivePulse = new Animated.Value(1);
let sharedPulseRefs = 0;
let sharedPulseScreenActive = false;
let sharedPulseLoop: Animated.CompositeAnimation | null = null;

function syncSharedLivePulse() {
  const shouldRun = sharedPulseRefs > 0 && sharedPulseScreenActive;
  if (shouldRun && !sharedPulseLoop) {
    sharedLivePulse.setValue(1);
    sharedPulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(sharedLivePulse, { toValue: 0.35, duration: 700, useNativeDriver: true }),
        Animated.timing(sharedLivePulse, { toValue: 1, duration: 700, useNativeDriver: true }),
      ]),
    );
    sharedPulseLoop.start();
  } else if (!shouldRun && sharedPulseLoop) {
    sharedPulseLoop.stop();
    sharedPulseLoop = null;
    sharedLivePulse.setValue(1);
  }
}

function setMediaPulseActive(active: boolean) {
  if (sharedPulseScreenActive === active) return;
  sharedPulseScreenActive = active;
  syncSharedLivePulse();
}

function LivePulseDot({ size = 7 }: { size?: number }) {
  useEffect(() => {
    sharedPulseRefs += 1;
    syncSharedLivePulse();
    return () => {
      sharedPulseRefs = Math.max(0, sharedPulseRefs - 1);
      syncSharedLivePulse();
    };
  }, []);
  return (
    <Animated.View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: '#ff4d4f',
        marginRight: 4,
        opacity: sharedLivePulse,
      }}
    />
  );
}

function MediaGridSkeleton() {
  return (
    <View style={{ paddingHorizontal: 12, paddingTop: 4 }}>
      <Skeleton width="100%" height={170} radius={16} style={{ marginBottom: 12 }} />
      {[0, 1, 2].map((row) => (
        <View key={row} style={{ flexDirection: 'row', gap: 10, marginBottom: 10 }}>
          <View style={{ flex: 1 }}>
            <Skeleton width="100%" height={110} radius={14} />
          </View>
          <View style={{ flex: 1 }}>
            <Skeleton width="100%" height={110} radius={14} />
          </View>
        </View>
      ))}
    </View>
  );
}

const PLAYER_ANNOUNCE_COLLAPSED_KEY = 'yaya_player_announce_collapsed_v1';

const LIVE_ANNOUNCEMENT_CACHE = new Map<string, string>();

export default function MediaScreen() {
  const route = useRoute<MediaRouteProp>();
  const navigation = useNavigation<any>();
  const palette = usePalette();
  const { t } = useI18n();
  const setDockHidden = useUiStore((state) => state.setTabBarHidden);
  const setTabBarHidden = useCallback(
    (hidden: boolean) => setDockHidden(hidden, 'Media'),
    [setDockHidden],
  );
  const showToast = useUiStore((state) => state.showToast);
  const members = useMemberStore((state) => state.members);
  const [tab, setTab] = useState<'live' | 'vod'>(route.params?.mode ?? 'live');
  const token = useSettingsStore((s) => s.settings.p48Token);
  const [showSearch, setShowSearch] = useState(false);
  const [vodList, setVodList] = useState<VODItem[]>([]);
  const [liveList, setLiveList] = useState<VODItem[]>([]);
  const discoveredLives = useDiscoveredLivesStore((s) => s.items);
  const liveListRef = useRef<VODItem[]>([]);
  liveListRef.current = liveList;
  const vodListRef = useRef<VODItem[]>([]);
  vodListRef.current = vodList;
  const lastFocusFetchAtRef = useRef<Map<string, number>>(new Map());
  const lastFollowedFetchAtRef = useRef(0);
  useEffect(() => {
    const syncPulse = () => {
      setMediaPulseActive(navigation.isFocused() && AppState.currentState === 'active');
    };
    syncPulse();
    const offFocus = navigation.addListener('focus', syncPulse);
    const offBlur = navigation.addListener('blur', () => setMediaPulseActive(false));
    const appSub = AppState.addEventListener('change', syncPulse);
    return () => {
      offFocus();
      offBlur();
      appSub.remove();
      setMediaPulseActive(false);
    };
  }, [navigation]);

  const liveParamErrorStreakRef = useRef(0);
  const [loading, setLoading] = useState(false);
  const [loadedOnce, setLoadedOnce] = useState<{ live: boolean; vod: boolean }>({
    live: false,
    vod: false,
  });
  const loadedOnceRef = useRef<{ live: boolean; vod: boolean }>({ live: false, vod: false });
  const [, setRefreshing] = useState(false);
  const [, setNextCursor] = useState(0);
  const nextCursorRef = useRef(0);
  const [pageVersion, setPageVersion] = useState(0);
  const [error, setError] = useState('');
  const [playerError, setPlayerError] = useState('');
  const [, setUseWebPlayer] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const [isLandscape, setIsLandscape] = useState(false);

  const [, setVideoRotate] = useState(0);

  const manualOrientRef = useRef(false);
  const [playing, setPlaying] = useState<{
    url: string;
    urls: string[];
    title: string;
    cover?: string;
    item: any;
    isLive: boolean;
    needsVlc: boolean;
    resolving?: boolean;
    position?: number;
  } | null>(null);

  const [liveEnded, setLiveEnded] = useState(false);
  const [liveSummary, setLiveSummary] = useState<null | {
    title: string;
    member: string;
    startTime: string;
    duration: string;
    top: { name: string; value: string }[];
  }>(null);
  const playRequestRef = useRef(0);
  const hidePlayerEffects = usePlayerStore((s) => s.hideEffects || s.cleanScreen);
  const cleanScreen = usePlayerStore((s) => s.cleanScreen);

  const liveBarrageId = playing?.isLive
    ? String(playing.item?.liveId || playing.item?.id || '')
    : '';
  const liveBarrage = useLiveBarrage({
    liveId: liveBarrageId,
    enabled: !!liveBarrageId,
    module: 'live',
  });
  const liveBarrageReadyRef = useRef(false);
  liveBarrageReadyRef.current = liveBarrage.ready;
  const danmakuLiveIdRef = useRef('');

  const playedEffectsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!isGiftEffectSupported()) return;
    const items = liveBarrage.items;
    if (!items.length) return;
    for (const item of items) {
      const zip = item.gift?.zipPath;
      if (!zip || playedEffectsRef.current.has(item.id)) continue;
      playedEffectsRef.current.add(item.id);
      if (!hidePlayerEffects)
        playGiftEffect({ zipPath: zip, zipMd5: item.gift?.zipMd5, giftName: item.gift?.giftName });
    }
    if (playedEffectsRef.current.size > 200) playedEffectsRef.current.clear();
  }, [liveBarrage.items, hidePlayerEffects]);

  useEffect(
    () => () => {
      clearGiftEffectQueue();
    },
    [],
  );

  useEffect(() => {
    if (liveBarrage.items.length) setShowDanmaku(true);
  }, [liveBarrage.items.length]);

  const [webResumeTime, setWebResumeTime] = useState(0);
  const [giftVisible, setGiftVisible] = useState(false);
  const [gifts, setGifts] = useState<any[]>([]);
  const [selectedGift, setSelectedGift] = useState<any | null>(null);
  const [giftNum, setGiftNum] = useState('1');

  const [giftSending, setGiftSending] = useState(false);
  const [giftStatus, setGiftStatus] = useState('');
  const [balance, setBalance] = useState('');
  const [hasMore, setHasMore] = useState(true);
  const [rankVisible, setRankVisible] = useState(false);
  const [rankRows, setRankRows] = useState<any[]>([]);

  const [rankProfile, setRankProfile] = useState<UserProfileTarget | null>(null);

  const resumeKey = React.useMemo(
    () => String(playing?.item?.liveId || playing?.item?.id || playing?.url || ''),
    [playing],
  );

  useEffect(() => {
    if (!playing?.url) {
      setWebResumeTime(0);
      return;
    }
    let alive = true;
    getResumePosition(resumeKey)
      .then((t) => {
        if (alive) setWebResumeTime(t);
      })
      .catch((e) => {
        logWarn('读取续播进度失败: ' + errorMessage(e), 'MediaScreen.resume');
      });
    return () => {
      alive = false;
    };
  }, [resumeKey, playing?.url]);

  useEffect(() => {
    if (!playing || playing.isLive) return;
    const save = (force = false) =>
      saveResumePosition(resumeKey, usePlayerStore.getState().position, force);
    const timer = setInterval(() => {
      void save();
    }, 10000);
    return () => {
      clearInterval(timer);
      void save(true);
    };
  }, [playing, resumeKey]);

  useEffect(() => {
    if (!playing) {
      setDanmaku([]);
      setShowDanmaku(false);
      return;
    }
    const lid = String(playing.item?.liveId || playing.item?.id || '');
    if (!lid) {
      setDanmaku([]);
      setShowDanmaku(false);
      return;
    }
    if (danmakuLiveIdRef.current !== lid) {
      danmakuLiveIdRef.current = lid;
      setDanmaku([]);
      setShowDanmaku(false);
    }
    let alive = true;
    const seenMsg = new Set<string>();
    const collect = (infos: any[]): DanmakuItem[] => {
      const flat: DanmakuItem[] = [];
      for (const b of infos) {
        const parsed = parseDanmaku(b.content);
        const sender = {
          ...(b.userId ? { userId: b.userId } : {}),
          ...(b.avatar ? { avatar: b.avatar } : {}),
          ...(b.level ? { level: b.level } : {}),
        };
        if (parsed.length) flat.push(...parsed.map((item) => ({ ...item, ...sender })));
        else
          flat.push({
            time: Number(b.time) || 0,
            text: String(b.content || ''),
            ...(b.user ? { nick: b.user } : {}),
            ...sender,
          });
      }
      const items = flat.filter((d) => d && d.text) as DanmakuItem[];
      if (!items.length) return items;

      const rangeOf = (arr: DanmakuItem[]) =>
        arr.reduce(
          (acc, d) => ({ max: Math.max(acc.max, d.time), min: Math.min(acc.min, d.time) }),
          { max: 0, min: Infinity },
        );
      let { max: maxT, min: minT } = rangeOf(items);
      if (maxT > 1e6) {
        items.forEach((d) => {
          d.time = d.time / 1000;
        });
        ({ max: maxT, min: minT } = rangeOf(items));
      }
      if (maxT > 1e7) {
        const base = minT;
        items.forEach((d) => {
          d.time = d.time - base;
        });
        ({ max: maxT } = rangeOf(items));
      }
      if (maxT <= 0) {
        items.forEach((d, i) => {
          d.time = i * 1.2;
        });
      }
      items.sort((a, b) => a.time - b.time);
      return items;
    };
    if (playing.isLive) {
      let pollId: ReturnType<typeof setInterval> | null = null;
      let polling = false;
      const startPoll = () => {
        if (!pollId) pollId = setInterval(poll, 5000);
      };
      const stopPoll = () => {
        if (pollId) {
          clearInterval(pollId);
          pollId = null;
        }
      };
      const poll = async () => {
        if (
          polling ||
          !alive ||
          AppState.currentState !== 'active' ||
          !navigation.isFocused() ||
          liveBarrageReadyRef.current
        )
          return;
        polling = true;
        try {
          const infos = await pocketApi.getLiveBarrage(lid);
          if (
            !alive ||
            AppState.currentState !== 'active' ||
            !navigation.isFocused() ||
            liveBarrageReadyRef.current
          )
            return;
          const fresh = infos.filter((it, index) => {
            const key =
              it.messageId || `${it.time}:${it.user}:${it.content}:${it.time ? '' : index}`;
            if (seenMsg.has(key)) return false;
            seenMsg.add(key);
            if (seenMsg.size > 3000) {
              seenMsg.clear();
              seenMsg.add(key);
            }
            return true;
          });
          const items = collect(fresh);
          if (!items.length) return;
          setDanmaku((prev) => {
            const merged = [...prev, ...items];
            merged.sort((a, b) => a.time - b.time);
            return merged.slice(-800);
          });
          setShowDanmaku(true);
        } catch {
        } finally {
          polling = false;
        }
      };

      if (AppState.currentState === 'active' && navigation.isFocused()) {
        poll();
        startPoll();
      }
      const sub = AppState.addEventListener('change', (next) => {
        if (next === 'active' && alive && navigation.isFocused()) {
          poll();
          startPoll();
        } else stopPoll();
      });
      const unsubFocus = navigation.addListener('focus', () => {
        if (alive && AppState.currentState === 'active') {
          poll();
          startPoll();
        }
      });
      const unsubBlur = navigation.addListener('blur', stopPoll);
      return () => {
        alive = false;
        sub.remove();
        unsubFocus();
        unsubBlur();
        stopPoll();
      };
    }

    const replayDetails = pocketApi.getLiveBarrage(lid);
    pocketApi
      .getLiveLrc(lid)
      .then((text) => {
        if (!alive) return;
        if (!text) {
          void replayDetails.then((rows) => {
            if (!alive) return;
            const items = replayBarrageToDanmaku(rows);
            setDanmaku(items);
            setShowDanmaku(items.length > 0);
            showToast(
              items.length ? t('弹幕 {count} 条', { count: items.length }) : t('该视频暂无弹幕'),
            );
          });
          return;
        }
        const items = parseDanmaku(text);
        setDanmaku(items);
        setShowDanmaku(items.length > 0);
        showToast(
          items.length > 0 ? t('弹幕 {count} 条', { count: items.length }) : t('该视频暂无弹幕'),
        );
        void replayDetails.then((rows) => {
          if (alive && rows.length) setDanmaku(enrichReplayDanmaku(items, rows));
        });
      })
      .catch(() => {
        if (alive) setDanmaku([]);
      });
    return () => {
      alive = false;
    };
  }, [playing, liveBarrageId, navigation, showToast, t]);

  const [rankStatus, setRankStatus] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const [announceVisible, setAnnounceVisible] = useState(false);

  const [announceExpanded, setAnnounceExpanded] = useState(true);
  const announcePrefLoadedRef = useRef(false);
  useEffect(() => {
    if (announcePrefLoadedRef.current) return;
    announcePrefLoadedRef.current = true;
    AsyncStorage.getItem(PLAYER_ANNOUNCE_COLLAPSED_KEY)
      .then((v: string | null) => setAnnounceExpanded(v !== '1'))
      .catch(() => {});
  }, []);
  const setAnnounceExpandedPersisted = (v: boolean) => {
    setAnnounceExpanded(v);
    AsyncStorage.setItem(PLAYER_ANNOUNCE_COLLAPSED_KEY, v ? '0' : '1').catch(() => {});
  };

  const announceAutoShownRef = useRef(false);
  const loadingRef = useRef(false);
  const playingRef = useRef<typeof playing>(null);

  const [groupId, setGroupId] = useState(0);
  const [search, setSearch] = useState('');

  const [danmaku, setDanmaku] = useState<DanmakuItem[]>([]);
  const [showDanmaku, setShowDanmaku] = useState(false);

  const [followedIds, setFollowedIds] = useState<Set<string>>(new Set());
  const [followedIdsReady, setFollowedIdsReady] = useState(false);
  const danmakuClock = usePlayerStore((s) => s.position);

  const [, setDuration] = useState(0);
  const [paused, setPaused] = useState(false);

  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [dateFilter, setDateFilter] = useState<Date | null>(null);
  const [showCalendar, setShowCalendar] = useState(false);
  const [showDanmakuSettings, setShowDanmakuSettings] = useState(false);

  const [showDanmakuList, setShowDanmakuList] = useState(false);

  const [danmakuProfile, setDanmakuProfile] = useState<UserProfileTarget | null>(null);
  const danmakuListEntries = useMemo<DanmakuListEntry[]>(() => {
    if (playing?.isLive) {
      return liveBarrage.items.map((item) => ({
        id: item.id,
        time: 0,
        nick: item.nick || '',
        text: item.text || '',
        kind: item.kind,

        userId: item.userId || undefined,
        avatar: item.avatar || undefined,
      }));
    }

    return danmaku.map((item, index) => ({
      id: `dm-${index}-${item.time}`,
      time: item.time,
      nick: item.nick || '',
      text: item.text,
      userId: item.userId,
      avatar: item.avatar,
    }));
  }, [playing?.isLive, liveBarrage.items, danmaku]);

  const [, setControlsVisible] = useState(true);
  const controlsOpacity = useRef(new Animated.Value(1)).current;

  const insets = useSafeAreaInsets();
  const hideControlsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pausedRef = useRef(paused);
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);
  const showControls = useCallback(
    (autoHide = true) => {
      setControlsVisible(true);
      Animated.timing(controlsOpacity, {
        toValue: 1,
        duration: 180,
        useNativeDriver: true,
      }).start();
      if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current);
      if (autoHide && !pausedRef.current) {
        hideControlsTimer.current = setTimeout(() => {
          setControlsVisible(false);
          Animated.timing(controlsOpacity, {
            toValue: 0,
            duration: 180,
            useNativeDriver: true,
          }).start();
        }, 3000);
      }
    },
    [controlsOpacity],
  );

  useEffect(() => {
    if (playing?.url) showControls(true);
  }, [playing?.url, showControls]);

  const groupChips = useMemo(() => [{ label: t('关注'), id: -1, match: '' }, ...MEDIA_GROUPS], [t]);
  const filterOptions = useMemo(
    () => groupChips.map((item) => ({ key: String(item.id), label: t(item.label) })),
    [groupChips, t],
  );
  const filterBarNode = useMemo(
    () => (
      <View style={styles.filterRow}>
        <View style={{ flex: 1 }}>
          <GlassSegmentedScroll
            options={filterOptions}
            value={String(groupId)}
            onChange={(k) => setGroupId(Number(k))}
            height={38}
          />
        </View>
      </View>
    ),
    [filterOptions, groupId],
  );

  const followedNames = useMemo(() => {
    const names = new Set<string>();
    followedIds.forEach((id) => {
      const member = matchFollowedMember(members, id);
      const name = member?.ownerName;
      const normalized = normalizeFollowName(String(name || ''));
      if (normalized) names.add(normalized);
    });
    return names;
  }, [members, followedIds]);
  const list = useMemo(() => {
    let raw =
      tab === 'live'
        ? discoveredLives.length
          ? mergeUniqueLiveItems(liveList, discoveredLives)
          : liveList
        : vodList;

    if (groupId === -1) {
      raw = raw.filter((item: any) => {
        const owner = String(
          item.userId ||
            item.ownerId ||
            item.memberId ||
            item.userInfo?.userId ||
            item.userInfo?.id ||
            item.user?.userId ||
            item.owner?.userId ||
            item.memberInfo?.userId ||
            item.hostId ||
            item.account ||
            '',
        );
        if (owner && followedIds.has(owner)) return true;
        const nick = normalizeFollowName(String(item.nickname || item.nickName || ''));
        return !!nick && followedNames.has(nick);
      });
    } else if (groupId !== 0) {
      const g = MEDIA_GROUPS.find((x) => x.id === groupId);
      if (g && g.match) {
        raw = raw.filter(
          (item) =>
            (item.nickname || '').includes(g.match) ||
            (item.title || '').includes(g.match) ||
            (item.liveRoomTitle || '').includes(g.match),
        );
      }
    }

    if (dateFilter) {
      const key = dateKeyOf(dateFilter);
      raw = raw.filter((item: any) => dateKeyOf(item.startTime) === key);
    }
    if (!search.trim()) return raw;
    const q = search.trim().toLowerCase();
    const qDigits = q.replace(/[^0-9]/g, '');
    return raw.filter((item) => {
      const { text, digits } = buildMediaSearchText(item);

      if (qDigits.length >= 3 && digits.includes(qDigits)) return true;
      if (text.includes(q)) return true;
      return false;
    });
  }, [
    tab,
    liveList,
    vodList,
    discoveredLives,
    search,
    groupId,
    dateFilter,
    followedIds,
    followedNames,
  ]);

  const vodRows = useMemo(() => {
    if (tab !== 'vod') return null;

    const flat: { type: 'header' | 'row'; key: string; title?: string; left?: any; right?: any }[] =
      [];
    for (let i = 0; i < list.length; i += 2) {
      flat.push({ type: 'row', key: `r-${i}`, left: list[i], right: list[i + 1] });
    }
    return flat;
  }, [tab, list]);

  const memberHits = useMemo(() => {
    if (selectedMember || !search.trim()) return [];
    const q = search.trim().toLowerCase();
    return members.filter((m) => memberSearchText(m).includes(q)).slice(0, 8);
  }, [members, search, selectedMember]);
  const selectedGiftTotal = useMemo(
    () => (selectedGift ? giftCost(selectedGift) * (Number(giftNum) || 1) : 0),
    [giftNum, selectedGift],
  );

  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  const routeParamsRef = useRef(route.params);
  routeParamsRef.current = route.params;
  const tRef = useRef(t);
  tRef.current = t;
  const tabRef = useRef(tab);
  tabRef.current = tab;

  useEffect(() => {
    const lid = routeParamsRef.current?.playLiveId;
    const directUrl = routeParamsRef.current?.playUrl;
    if (!lid && !directUrl) return;
    const request = ++playRequestRef.current;
    const isLive = routeParamsRef.current?.mode !== 'vod';
    (async () => {
      try {
        if (directUrl) {
          const title = routeParamsRef.current?.playTitle || tRef.current('直播');
          const cover = routeParamsRef.current?.playCover || '';
          const shareResolved = await resolveSharePlayableUrls([directUrl], isLive);
          if (shareResolved.error) {
            setPlayerError(tRef.current('该录播暂时无法播放'));
            setPlaying((p) => (p ? { ...p, resolving: false } : p));
            return;
          }
          const playUrls = shareResolved.urls.length ? shareResolved.urls : [directUrl];
          setPlaying({
            url: playUrls[0],
            urls: playUrls,
            title,
            cover: normalizeUrl(cover),
            item: { liveId: lid || '', title, liveCover: cover },
            isLive,
            needsVlc: streamNeedsProxy(directUrl),

            position: Number(routeParamsRef.current?.playPosition) || 0,
          });

          if (lid && isLive) {
            try {
              let detail: any = await pocketApi.getLiveOne(lid).catch(() => null);
              if (!detail) detail = await pocketApi.getOpenLiveOne(lid).catch(() => null);
              const d: any = (detail as any)?.content || (detail as any)?.data || detail || {};
              const annText = String(d?.announcement || '').trim();
              if (annText) {
                setAnnouncement(annText);
                setAnnounceVisible(true);
                setAnnounceExpandedPersisted(true);
                LIVE_ANNOUNCEMENT_CACHE.set(String(lid), annText);
              }
            } catch {}
          }
          if (!isLive && tabRef.current !== 'vod') switchTab('vod');
          return;
        }
        if (!lid) return;

        const guessTitle = routeParamsRef.current?.playTitle || tRef.current('直播');
        const guessCover = routeParamsRef.current?.playCover || '';
        setPlaying({
          url: '',
          urls: [],
          title: guessTitle,
          cover: normalizeUrl(guessCover),
          item: { liveId: lid, title: guessTitle, liveCover: guessCover },
          isLive,
          needsVlc: false,
          resolving: true,
        });

        let detail: any = await pocketApi.getLiveOne(lid).catch(() => null);
        if (request !== playRequestRef.current) return;
        if (!detail) detail = await pocketApi.getOpenLiveOne(lid).catch(() => null);
        if (request !== playRequestRef.current) return;
        const item = (detail?.content || detail?.data || detail || {}) as any;

        const annText = String(item?.announcement || '').trim();
        if (annText) {
          setAnnouncement(annText);
          setAnnounceVisible(true);
          setAnnounceExpandedPersisted(true);
          announceAutoShownRef.current = true;
        } else {
          void pocketApi
            .getOpenLiveOne(lid)
            .then((detail2: any) => {
              if (request !== playRequestRef.current) return;
              const d2 = (detail2?.content || detail2?.data || detail2 || {}) as any;
              const annText2 = String(d2?.announcement || '').trim();
              if (annText2) {
                setAnnouncement(annText2);
                setAnnounceVisible(true);
                setAnnounceExpandedPersisted(true);
                announceAutoShownRef.current = true;
              }
            })
            .catch(() => {});
        }
        let urls = pickPlayableUrls(item, isLive);
        if (!urls.length) {
          const found = await findLiveItemInLists(lid, isLive).catch(() => null);
          if (request !== playRequestRef.current) return;
          if (found) urls = pickPlayableUrls(found, isLive);
        }
        const shareResolved = await resolveSharePlayableUrls(urls, isLive);
        if (shareResolved.error) {
          setPlayerError(tRef.current('该录播暂时无法播放'));
          setPlaying((p) => (p ? { ...p, resolving: false } : p));
          return;
        }
        urls = shareResolved.urls;
        const url = urls[0] || '';
        if (!url) {
          setPlayerError(tRef.current('未解析到播放地址，请点击重试。'));
          setPlaying((p) => (p ? { ...p, resolving: false } : p));
          return;
        }
        const title =
          routeParamsRef.current?.playTitle ||
          item.title ||
          item.liveRoomTitle ||
          tRef.current('直播');
        const cover = routeParamsRef.current?.playCover || item.liveCover || item.coverPath || '';
        setPlaying({
          url,
          urls,
          title,
          cover: normalizeUrl(cover),
          item: { ...item, liveId: lid, title, liveCover: cover },
          isLive,
          needsVlc: streamNeedsProxy(url),
          resolving: false,
        });

        if (!isLive && tabRef.current !== 'vod') switchTab('vod');
      } catch (e) {
        if (request !== playRequestRef.current) return;
        setPlayerError(errorMessage(e));
        setPlaying((p) => (p ? { ...p, resolving: false } : p));
      }
    })();
  }, [
    routeParamsRef.current?.playLiveId,
    routeParamsRef.current?.playUrl,
    routeParamsRef.current?.playNonce,
  ]);

  useFocusEffect(
    useCallback(() => {
      setTabBarHidden(!!playing);
    }, [playing, setTabBarHidden]),
  );

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!navigation.isFocused()) return false;
      if (!playing) return false;

      if (Keyboard.isVisible()) {
        Keyboard.dismiss();
        return true;
      }
      playRequestRef.current += 1;

      setLoading(false);
      setIsFullscreen(false);
      setIsLandscape(false);
      setLiveImmersiveMode(false);
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
      setPlaying(null);
      return true;
    });
    return () => subscription.remove();
  }, [navigation, playing]);

  const doFetch = useCallback(
    async (
      mode: 'live' | 'vod',
      cursor = 0,
      append = false,
      silent = false,
      userId?: string | number,
    ) => {
      if (loadingRef.current) return;
      loadingRef.current = true;
      if (!silent) setLoading(true);
      setError('');
      try {
        let finalCursor = cursor;

        if (userId !== undefined && userId !== null && userId !== '' && Number(cursor) === 0) {
          const probe = await pocketApi
            .getLiveList({ next: 0, record: mode === 'vod', debug: true, size: 100 })
            .catch(() => null);
          if (probe) {
            const probeList = normalizeLiveList(probe);
            const probeNext =
              Number((probe as any)?.content?.next ?? (probe as any)?.data?.next ?? 0) || 0;
            if (probeList[0]?.liveId) finalCursor = Number(probeList[0].liveId) || probeNext || 0;
            else if (probeNext) finalCursor = probeNext;
          }
        }
        const res = await pocketApi.getLiveList({
          next: finalCursor,
          record: mode === 'vod',
          debug: true,
          userId,
          size: 100,
        });

        const shellList = (res?.content ?? res?.data ?? res)?.liveList;
        if (!Array.isArray(shellList)) throw new Error('直播列表参数错误：缺少 liveList');
        const next = normalizeLiveList(res);
        if (cursor === 0 && !userId) {
          lastFocusFetchAtRef.current.set(mode, Date.now());
        }

        liveParamErrorStreakRef.current = 0;
        const nextToken =
          Number(
            (res as any)?.content?.next ?? (res as any)?.data?.next ?? (res as any)?.next ?? 0,
          ) || 0;
        setNextCursor(nextToken);
        nextCursorRef.current = nextToken;

        setHasMore(next.length > 0 && nextToken > 0 && nextToken !== cursor);

        if (mode === 'live')
          setLiveList((prev) => (append ? mergeUniqueLiveItems(prev, next) : next));
        else setVodList((prev) => (append ? mergeUniqueLiveItems(prev, next) : next));
      } catch (err) {
        const message = errorMessage(err);
        if (/参数|param|invalid|illegal|400|422|缺少|必填/i.test(message)) {
          liveParamErrorStreakRef.current += 1;

          logWarn(
            `[liveList] 参数错误第 ${liveParamErrorStreakRef.current} 次，保留旧列表：${message}`,
            'live',
          );
        } else {
          liveParamErrorStreakRef.current = 0;
        }
        if (!silent) setError(message);
        setHasMore(false);
      } finally {
        loadingRef.current = false;
        if (cursor === 0) {
          loadedOnceRef.current[mode] = true;
          setLoadedOnce((prev) => (prev[mode] ? prev : { ...prev, [mode]: true }));
        }
        if (!silent) setLoading(false);
        setRefreshing(false);
        setPageVersion((v) => v + 1);
      }
    },
    [],
  );

  const reloadList = useCallback(() => {
    setNextCursor(0);
    setHasMore(true);
    doFetch(tab, 0);
  }, [doFetch, tab]);

  useFocusEffect(
    useCallback(() => {
      if (playingRef.current) return undefined;
      const existingCount = tab === 'live' ? liveListRef.current.length : vodListRef.current.length;
      const lastAt = lastFocusFetchAtRef.current.get(tab) || 0;
      const hasLoaded = loadedOnceRef.current[tab] || existingCount > 0 || lastAt > 0;
      if (hasLoaded && Date.now() - lastAt < MEDIA_FOCUS_COOLDOWN_MS) {
        return undefined;
      }
      const timer = setTimeout(() => {
        if (!navigation.isFocused() || AppState.currentState !== 'active' || playingRef.current) {
          return;
        }
        const silent =
          loadedOnceRef.current[tab] ||
          (tab === 'live' ? liveListRef.current.length : vodListRef.current.length) > 0 ||
          (lastFocusFetchAtRef.current.get(tab) || 0) > 0;
        void doFetch(tab, 0, false, silent);
      }, MEDIA_FOCUS_DEFER_MS);
      return () => clearTimeout(timer);
    }, [doFetch, navigation, tab]),
  );

  useEffect(() => {
    if (!selectedMember) return;
    const mid = String(
      selectedMember.id || (selectedMember as any).userId || (selectedMember as any).memberId || '',
    );
    loadedOnceRef.current.vod = false;
    setLoadedOnce((prev) => (prev.vod ? { ...prev, vod: false } : prev));
    setVodList([]);
    setNextCursor(0);
    setHasMore(true);
    setTab('vod');
    const id = setTimeout(() => doFetch('vod', 0, false, false, mid), 0);
    return () => clearTimeout(id);
  }, [selectedMember, doFetch]);

  const prevMemberRef = useRef<any>(null);
  useEffect(() => {
    if (prevMemberRef.current && !selectedMember && tab === 'vod') {
      loadedOnceRef.current.vod = false;
      setLoadedOnce((prev) => (prev.vod ? { ...prev, vod: false } : prev));
      setVodList([]);
      setNextCursor(0);
      setHasMore(true);
      doFetch('vod', 0);
    }
    prevMemberRef.current = selectedMember;
  }, [selectedMember, doFetch, tab]);

  const filterPages = useRef(0);
  const loadMoreRef = useRef<(silent?: boolean) => void>(() => {});

  const [pageModeOk, setPageModeOk] = useState<boolean | null>(null);
  useEffect(() => {
    if (loadingRef.current || loading) return;
    const haveFilter = !!search.trim() || !!selectedMember || groupId === -1;
    if (!haveFilter || !hasMore) return;
    if (selectedMember && tab !== 'vod') return;

    if (groupId === -1 && tab === 'vod' && pageModeOk !== false && !scanDoneRef.current) return;

    if (groupId === -1) {
      if (filterPages.current >= 60) return;
      filterPages.current += 1;
    }
    const id = setTimeout(() => loadMoreRef.current(groupId === -1), 60);
    return () => clearTimeout(id);
  }, [search, selectedMember, hasMore, loading, tab, groupId, pageVersion, pageModeOk]);

  useEffect(() => {
    filterPages.current = 0;
  }, [search, selectedMember, groupId]);

  const followLoadingRef = useRef(false);
  const [followFetching, setFollowFetching] = useState(false);
  const scanDoneRef = useRef(false);

  const loadFollowVodFast = useCallback(async () => {
    if (followLoadingRef.current || groupId !== -1 || tab !== 'vod') return;
    if (!useSettingsStore.getState().settings.p48Token) {
      scanDoneRef.current = true;
      return;
    }
    followLoadingRef.current = true;
    setFollowFetching(true);
    const t0 = Date.now();
    const PAGE_SIZE = 100;
    const startTimeOf = (it: any) => Number(it?.startTime || it?.ctime || 0);
    const merge = (items: any[]) =>
      setVodList((prev) => {
        const merged = mergeUniqueLiveItems(prev, items);
        return merged.sort((a: any, b: any) => startTimeOf(b) - startTimeOf(a) || 0);
      });
    try {
      const idsRes = await pocketApi.getFollowedIds().catch(() => null);
      const ids = idsRes
        ? unwrapList(idsRes, ['content.data', 'content', 'data', 'list']).map(String)
        : [];

      const userIds: string[] = [];
      const seen = new Set<string>();
      for (const m of members) {
        const mid = String((m as any).id || (m as any).userId || (m as any).memberId || '');
        if (mid && ids.includes(mid) && !seen.has(mid)) {
          seen.add(mid);
          userIds.push(mid);
        }
      }

      if (!userIds.length) {
        const page1 = await pocketApi
          .getLiveList({ next: 0, record: true, debug: true, size: PAGE_SIZE })
          .catch(() => null);
        if (page1) merge(normalizeLiveList(page1));
        scanDoneRef.current = true;
        return;
      }
      const BATCH = 8;
      for (let i = 0; i < userIds.length; i += BATCH) {
        if (groupId !== -1) return;
        const chunk = userIds.slice(i, i + BATCH);
        const results = await Promise.allSettled(
          chunk.map((uid) =>
            pocketApi.getLiveList({
              next: 0,
              record: true,
              debug: true,
              size: PAGE_SIZE,
              userId: uid,
            }),
          ),
        );
        let got = 0;
        for (const r of results) {
          if (r.status !== 'fulfilled') continue;
          const items = normalizeLiveList(r.value);
          if (items.length) {
            got += 1;
            merge(items);
          }
        }
        setPageVersion((v) => v + 1);
        logInfo(
          `[FollowVod] userId 直查批次 ${i / BATCH + 1}/${Math.ceil(userIds.length / BATCH)} 命中成员=${got}/${chunk.length}`,
        );
      }
      logInfo(
        `[FollowVod] userId 并发直查完成 members=${userIds.length} 耗时=${Date.now() - t0}ms`,
      );
    } catch (e) {
      logWarn(`[FollowVod] userId 直查失败，退回游标链 ${String(e)}`);
      setPageModeOk(false);
    } finally {
      followLoadingRef.current = false;
      setFollowFetching(false);
      scanDoneRef.current = true;
    }
  }, [groupId, tab, members]);

  const [refreshTick, setRefreshTick] = useState(0);
  useEffect(() => {
    if (groupId === -1 && tab === 'vod' && token) {
      scanDoneRef.current = false;
      loadFollowVodFast();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, tab, refreshTick]);

  useEffect(() => {
    let alive = true;

    void readFollowedIdsCache(token).then((cached) => {
      if (!alive || !cached.cached) return;
      setFollowedIds(new Set(cached.ids));
      setFollowedIdsReady(true);
    });
    let followDeferTimer: ReturnType<typeof setTimeout> | null = null;
    const cancelFollowDefer = () => {
      if (followDeferTimer) {
        clearTimeout(followDeferTimer);
        followDeferTimer = null;
      }
    };
    const load = () => {
      if (AppState.currentState !== 'active' || !navigation.isFocused()) return;
      lastFollowedFetchAtRef.current = Date.now();
      pocketApi
        .getFollowedIds()
        .then((res) => {
          if (!alive) return;
          const ids = unwrapList(res, ['content.data', 'content', 'data', 'list']).map(String);
          setFollowedIds(new Set(ids));
          setFollowedIdsReady(true);
          void writeFollowedIdsCache(token, ids);
        })
        .catch(() => {
          if (alive) setFollowedIdsReady(true);
        });
    };
    const scheduleLoadOnFocus = () => {
      if (Date.now() - lastFollowedFetchAtRef.current < MEDIA_FOCUS_COOLDOWN_MS) return;
      cancelFollowDefer();
      followDeferTimer = setTimeout(() => {
        followDeferTimer = null;
        if (alive) load();
      }, MEDIA_FOCUS_DEFER_MS);
    };
    load();

    const offFocus = navigation.addListener('focus', scheduleLoadOnFocus);
    const offBlur = navigation.addListener('blur', cancelFollowDefer);
    return () => {
      alive = false;
      cancelFollowDefer();
      offFocus();
      offBlur();
    };
  }, [navigation, token]);

  useEffect(() => {
    setFollowedIdsReady(false);
  }, [token]);

  useEffect(() => {
    if (tab !== 'live' || playing) return;
    const id = setInterval(() => {
      if (AppState.currentState !== 'active' || !navigation.isFocused()) return;
      doFetch('live', 0, false, true);
    }, 60000);
    return () => clearInterval(id);
  }, [tab, playing, doFetch, navigation]);

  useEffect(
    () => () => {
      setLiveImmersiveMode(false);
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    },
    [],
  );

  const inSystemPipRef = useRef(false);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        if (!inSystemPipRef.current) {
          ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(
            () => {},
          );
        }
      } else if (playing) {
        const wantLandscape = usePlayerStore.getState().fullscreen || isFullscreen || isLandscape;
        ScreenOrientation.lockAsync(
          wantLandscape
            ? ScreenOrientation.OrientationLock.LANDSCAPE
            : ScreenOrientation.OrientationLock.PORTRAIT_UP,
        ).catch(() => {});
      }
    });
    return () => sub.remove();
  }, [playing, isFullscreen, isLandscape]);

  const closePlayer = useCallback(() => {
    playRequestRef.current += 1;

    setLoading(false);
    setIsFullscreen(false);
    setIsLandscape(false);
    setLiveImmersiveMode(false);
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    setPlaying(null);
    setAnnouncement('');
    setAnnounceVisible(false);

    setAnnounceExpandedPersisted(true);
    announceAutoShownRef.current = false;

    if (route.params?.fromRoom) navigation.goBack();
  }, [navigation, route.params?.fromRoom]);

  const videoSizeRef = useRef<{ w: number; h: number } | null>(null);
  const handleMiniPlayer = useCallback(() => {
    const cur = playing;
    if (!cur?.url) return;
    const pst = usePlayerStore.getState();
    useMiniPlayerStore.getState().open({
      url: cur.url,
      title: cur.title,
      cover: cur.cover,
      isLive: !!cur.isLive,

      position: pst.position,
      aspectW: pst.detectedAspect?.w || videoSizeRef.current?.w,
      aspectH: pst.detectedAspect?.h || videoSizeRef.current?.h,
      isLandscape: pst.detectedAspect ? pst.detectedLandscape : undefined,
      backTo: {
        mode: cur.isLive ? 'live' : 'vod',
        playUrl: cur.url,
        playLiveId: String(cur.item?.liveId || cur.item?.id || '') || undefined,
        playTitle: cur.title,
        playCover: cur.cover,
      },
    });
    closePlayer();
  }, [playing, closePlayer]);

  useEffect(() => {
    setLiveEnded(false);
    setLiveSummary(null);
  }, [playing?.item?.liveId, playing?.url]);

  const lastLiveEventRef = useRef('');
  useEffect(() => {
    const event = liveBarrage.lastLiveEvent;
    if (!event || event === lastLiveEventRef.current) return;
    lastLiveEventRef.current = event;
    const evUpper = String(event).toUpperCase();
    if (evUpper.includes('FINISH')) {
      showToast(t('连麦已结束，正在刷新直播'));
      void refreshLiveStreamRef.current();
    } else if (
      evUpper === 'MULTI_MIC_PK_SUCCESS' ||
      evUpper.startsWith('MICROPHONE_CONNECTION_AGREE')
    ) {
      showToast(t('PK连麦已开始，正在切换画面'));
      void refreshLiveStreamRef.current();
    }
  }, [liveBarrage.lastLiveEvent, showToast, t]);

  useEffect(() => {
    if (!liveBarrage.liveEnded || !playing?.isLive) return;
    const liveId = String(playing.item?.liveId || playing.item?.id || '');
    if (!liveId) {
      setLiveEnded(true);
      return;
    }
    let active = true;
    setLiveEnded(true);
    Promise.all([
      pocketApi.getLiveResult(liveId).catch(() => null),
      pocketApi.getLiveRank(liveId).catch(() => null),
    ]).then(([resultRes, rankRes]) => {
      if (!active) return;
      const result: any =
        (resultRes as any)?.content || (resultRes as any)?.data || resultRes || {};
      const item: any = playing.item || {};
      const liveMs = Number(result.liveTime || result.duration || result.liveDurationMs) || 0;
      const top = normalizeLiveRank(rankRes)
        .slice(0, 3)
        .map((row) => ({ name: row.name, value: String(row.value || '') }));
      setLiveSummary({
        title: String(result.title || result.liveTitle || item.title || playing.title || ''),
        member: String(
          result.userName ||
            result.nickname ||
            item.nickname ||
            item.ownerName ||
            item.user?.nickName ||
            '',
        ),
        startTime: String(result.startTime || result.liveStartTime || item.startTime || ''),
        duration:
          liveMs > 0 ? formatDuration(liveMs > 10000 ? Math.round(liveMs / 1000) : liveMs) : '',
        top,
      });
    });
    return () => {
      active = false;
    };
  }, [liveBarrage.liveEnded, playing?.isLive, playing?.item, playing?.title]);

  useEffect(() => {
    const u = String(playing?.url || '');
    if (!u || !isSharePageUrl(u)) return;
    let cancelled = false;
    (async () => {
      const resolved = await resolveSharePlayableUrls([u], !!playing?.isLive);
      if (cancelled) return;
      if (resolved.urls.length) {
        const nextUrl = resolved.urls[0];
        setPlaying((p) =>
          p
            ? {
                ...p,
                url: nextUrl,
                urls: resolved.urls,
                needsVlc: streamNeedsProxy(nextUrl),
                resolving: false,
              }
            : p,
        );
      } else {
        setPlayerError(t('该录播暂时无法播放'));
        setPlaying((p) => (p ? { ...p, url: '', urls: [], resolving: false } : p));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing?.url]);

  useEffect(() => {
    if (playing?.isLive) setAnnounceExpandedPersisted(true);
  }, [playing?.item?.liveId, playing?.isLive]);

  const refreshAnnouncement = async () => {
    if (!playing || !playing.isLive) return;
    try {
      const detail = await pocketApi.getLiveOne(playing.item.liveId).catch(() => null);
      const detail2 = !detail
        ? await pocketApi.getOpenLiveOne(playing.item.liveId).catch(() => null)
        : null;
      const d = (detail || detail2 || {}) as any;
      const annText = d?.content?.announcement || d?.announcement || d?.data?.announcement || '';
      if (!annText) {
        setAnnouncement('');
        setAnnounceVisible(false);
        return;
      }
      if (playing.item?.liveId) LIVE_ANNOUNCEMENT_CACHE.set(String(playing.item.liveId), annText);
      setAnnouncement(annText);
      setAnnounceVisible(true);
      setAnnounceExpandedPersisted(true);
    } catch {
      setAnnounceVisible(false);
    }
  };

  useEffect(() => {
    if (!playing?.isLive) return;
    const liveId = String(playing.item?.liveId || '');
    if (!liveId) return;
    const cached = LIVE_ANNOUNCEMENT_CACHE.get(liveId);
    if (cached) {
      setAnnouncement((prev) => prev || cached);
      setAnnounceVisible(true);
    } else {
      void refreshAnnouncement();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing?.item?.liveId, playing?.isLive]);

  const switchTab = (next: 'live' | 'vod') => {
    startTransition(() => {
      setTab(next);
      setNextCursor(0);
      setHasMore(true);
    });
  };

  useEffect(() => {
    const mode = route.params?.mode;
    if (mode === 'live' || mode === 'vod') {
      setTab((prev) => (prev === mode ? prev : mode));
      setNextCursor(0);
      setHasMore(true);
    }
  }, [route.params?.mode]);

  const refreshList = () => {
    setRefreshing(true);
    if (tab === 'live') {
      void useDiscoveredLivesStore.getState().revalidate();
    }
    reloadList();

    setRefreshTick((v) => v + 1);
  };

  const loadMore = (silent = false) => {
    if (loading || loadingRef.current || !hasMore) return;
    const mid = selectedMember
      ? String(
          selectedMember.id ||
            (selectedMember as any).userId ||
            (selectedMember as any).memberId ||
            '',
        )
      : undefined;
    doFetch(tab, nextCursorRef.current, true, silent, mid || undefined);
  };
  loadMoreRef.current = loadMore;

  const startPlay = async (item: VODItem, forceLive = tab === 'live') => {
    const request = ++playRequestRef.current;
    setError('');
    setPlayerError('');
    setUseWebPlayer(false);
    setIsFullscreen(false);
    setIsLandscape(false);
    setVideoRotate(0);
    manualOrientRef.current = false;
    setLiveImmersiveMode(false);
    setPaused(false);
    setDuration(0);
    setLoading(true);

    setPlaying({
      url: '',
      urls: [],
      title: item.title || item.liveRoomTitle || t('直播 / 回放'),
      cover: item.liveCover || item.coverPath,
      item,
      isLive: forceLive,
      needsVlc: false,
      resolving: true,
    });
    try {
      let urls = pickPlayableUrls(item, forceLive);

      {
        const shareResolved = await resolveSharePlayableUrls(urls, forceLive);
        if (shareResolved.error) {
          setPlayerError(t('该录播暂时无法播放'));
          setPlaying((p) => (p ? { ...p, url: '', urls: [], resolving: false } : p));
          return;
        }
        urls = shareResolved.urls;
      }
      let detail: any = item;
      const initialUrl = urls[0] || '';
      if (initialUrl) {
        setPlaying({
          url: initialUrl,
          urls,
          title: item.title || item.liveRoomTitle || t('直播 / 回放'),
          cover: item.liveCover || item.coverPath,
          item,
          isLive: forceLive,
          needsVlc: streamNeedsProxy(initialUrl),
        });
      }
      if (item.liveId) {
        detail = await pocketApi.getLiveOne(item.liveId).catch(() => null);
        if (request !== playRequestRef.current) return;
        urls = [...pickPlayableUrls(detail, forceLive), ...urls];
        const d = (detail || {}) as any;
        const annText = d?.content?.announcement || d?.announcement || d?.data?.announcement || '';
        if (annText) {
          setAnnouncement(annText);
          if (item.liveId) LIVE_ANNOUNCEMENT_CACHE.set(String(item.liveId), annText);
          setAnnounceVisible(true);

          setAnnounceExpandedPersisted(true);
          announceAutoShownRef.current = true;
        } else {
          const detail2 = await pocketApi.getOpenLiveOne(item.liveId).catch(() => null);
          if (request !== playRequestRef.current) return;
          if (detail2) {
            const d2 = detail2 as any;
            const annText2 =
              d2?.content?.announcement || d2?.announcement || d2?.data?.announcement || '';
            if (annText2) {
              setAnnouncement(annText2);
              setAnnounceVisible(true);
              setAnnounceExpandedPersisted(true);
              announceAutoShownRef.current = true;
            }
          }
        }
        if (!urls.filter(Boolean).length) {
          detail = await pocketApi.getOpenLiveOne(item.liveId).catch(() => null);
          if (request !== playRequestRef.current) return;
          urls = [...pickPlayableUrls(detail, forceLive), ...urls];
        }
      }
      urls = Array.from(new Set(urls.filter(Boolean)));
      const baseUrl = urls[0] || '';
      if (!baseUrl) {
        setPlayerError(t('未解析到播放地址，可点击重试'));
        setPlaying((p) => (p ? { ...p, resolving: false } : p));
        return;
      }
      setPlaying({
        url: baseUrl,
        urls,
        title: item.title || item.liveRoomTitle || t('直播 / 回放'),
        cover: item.liveCover || item.coverPath,
        item: { ...item, ...(detail?.content || detail?.data || detail) },
        isLive: forceLive,
        needsVlc: streamNeedsProxy(baseUrl),
        resolving: false,
      });
    } catch (err) {
      if (request !== playRequestRef.current) return;

      try {
        const curUrl = String(playingRef.current?.url || '');
        if (/\.html(\?|$)/i.test(curUrl) || curUrl.includes('h5.48.cn')) setLiveEnded(true);
      } catch {}
      logWarn('[player] startPlay failed:', errorMessage(err));
      setError(t('播放失败，请重试'));
      setPlayerError(t('播放失败，请重试'));
      setPlaying((p) => (p ? { ...p, resolving: false } : p));
    } finally {
      if (request === playRequestRef.current) setLoading(false);
    }
  };

  const liveRetryFollowupRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshLiveStreamRef = useRef<(allowFollowup?: boolean) => Promise<void> | void>(
    () => undefined,
  );
  useEffect(
    () => () => {
      if (liveRetryFollowupRef.current) clearTimeout(liveRetryFollowupRef.current);
    },
    [],
  );

  const refreshLiveStream = async (allowFollowup = true) => {
    const current = playingRef.current;
    if (!current?.isLive) return;
    if (liveRetryFollowupRef.current) {
      clearTimeout(liveRetryFollowupRef.current);
      liveRetryFollowupRef.current = null;
    }
    const id = String(current.item?.liveId || current.item?.id || '');
    if (!id) {
      usePlayerStore.getState().requestKernelRebuild();
      return;
    }
    const request = ++playRequestRef.current;
    let detail = await pocketApi.getLiveOne(id).catch(() => null);
    if (request !== playRequestRef.current) return;
    let urls = pickPlayableUrls(detail, true);
    if (!urls.length) {
      detail = await pocketApi.getOpenLiveOne(id).catch(() => null);
      if (request !== playRequestRef.current) return;
      urls = pickPlayableUrls(detail, true);
    }
    if (playingRef.current !== current) return;
    const rawDetail = (detail?.content || detail?.data || detail || {}) as Record<string, any>;
    if (urls[0] && urls[0] !== current.url) {
      setPlaying({
        ...current,
        url: urls[0],
        urls,
        needsVlc: streamNeedsProxy(urls[0]),
        item: { ...current.item, ...rawDetail },
      });
      return;
    }
    if (!urls.length && Number(rawDetail.status) === 2) {
      setLiveEnded(true);
      return;
    }
    usePlayerStore.getState().requestKernelRebuild();
    if (allowFollowup) {
      liveRetryFollowupRef.current = setTimeout(() => {
        liveRetryFollowupRef.current = null;
        if (playingRef.current === current && !liveEnded) {
          void refreshLiveStream(false);
        }
      }, 1800);
    }
  };
  refreshLiveStreamRef.current = refreshLiveStream;

  const openGiftPanel = async (source = playingRef.current || playing) => {
    if (!source?.item?.liveId) {
      setGiftStatus(t('当前直播缺少 liveId，不能送礼'));
      setGiftVisible(true);
      return;
    }
    setGiftVisible(true);
    setGiftStatus('');
    setSelectedGift(null);
    try {
      const anchorUserId = acceptUserId(source.item);
      const [moneyRes] = await Promise.all([pocketApi.getUserMoney().catch(() => null)]);
      let next: any[] = [];

      const liveSceneRes = anchorUserId
        ? await pocketApi
            .getLiveGiftList(String(source.item.liveId), String(anchorUserId))
            .catch(() => null)
        : null;
      next = normalizeGiftList(liveSceneRes);
      const liveGiftRes = next.length
        ? null
        : await pocketApi.getGiftList(String(source.item.liveId)).catch(() => null);
      if (!next.length) next = normalizeGiftList(liveGiftRes);

      const scoreRes = anchorUserId
        ? await pocketApi.getScoreGiftListByMember(String(anchorUserId)).catch(() => null)
        : null;
      const scoreGifts = normalizeGiftList(scoreRes);
      if (scoreGifts.length) {
        const seen = new Set(next.map((g: any) => String(g.giftId || g.id)));
        next = next.concat(scoreGifts.filter((g: any) => !seen.has(String(g.giftId || g.id))));
      }
      try {
        logInfo(
          `[gift.list] live type2 count=${scoreGifts.length} names=${scoreGifts
            .map((g: any) => String(g.giftName || g.name || ''))
            .join('|')
            .slice(0, 300)}`,
          'gift',
        );
      } catch {}
      if (!next.length) {
        logWarn(
          `[live-gift] 直播礼物列表为空 liveId=${String(source.item.liveId)} raw=${JSON.stringify(liveGiftRes)?.slice(0, 300)}`,
        );
        if (anchorUserId) {
          const byMember = await pocketApi
            .getGiftListByMember(String(anchorUserId))
            .catch(() => null);
          next = normalizeGiftList(byMember);
        }
      }

      try {
        const qin = next.filter((g: any) =>
          String(g.giftName || g.name || '').includes('琴音生花'),
        );
        if (qin.length) next = [...qin, ...next.filter((g: any) => !qin.includes(g))];
      } catch {}
      setGifts(next);
      try {
        const names = next.map((g: any) => String(g.giftName || g.name || '')).filter(Boolean);
        logInfo(
          `[gift.list] live count=${next.length} hasQinYin=${names.some((n) => n.includes('琴音生花')) ? 'yes' : 'no'} names=${names.slice(0, 40).join('|')}`,
          'gift',
        );
      } catch {}

      setBalance(
        moneyRes?.content?.moneyTotal !== undefined ? String(moneyRes.content.moneyTotal) : '',
      );
      setGiftStatus(
        next.length ? t('已加载 {count} 个礼物', { count: next.length }) : t('礼物列表为空'),
      );
    } catch (err) {
      setGifts([]);
      setGiftStatus(t('加载礼物失败：{error}', { error: errorMessage(err) }));
    }
  };

  const sendGift = async () => {
    if (giftSending) return;
    if (!playing || !selectedGift) {
      setGiftStatus(t('请先选择礼物'));
      return;
    }
    const num = Math.max(1, Math.floor(Number(giftNum) || 1));
    const targetUserId = acceptUserId(playing.item);
    if (!targetUserId) {
      setGiftStatus(t('无法获取主播 ID，不能送礼'));
      return;
    }
    setGiftSending(true);
    setGiftStatus(t('正在发送...'));
    try {
      let crm = '';
      try {
        const one = await pocketApi.getLiveOne(String(playing.item.liveId));
        crm = String((one as any)?.content?.crm || '');
      } catch {}

      const giftNameText = String(giftName(selectedGift) || '');
      const preferredCode = Number((selectedGift as any).businessCode ?? 0) || 0;
      const codes = Array.from(
        new Set([preferredCode, ...(giftNameText.includes('琴音生花') ? [5] : [])]),
      );
      let sent = false;
      let lastErr: any = null;
      for (const code of codes) {
        try {
          await pocketApi.sendGift({
            giftId: String(selectedGift.giftId || selectedGift.id),
            liveId: String(playing.item.liveId),
            acceptUserId: targetUserId,
            giftNum: num,
            crm,
            businessCode: code,
          });
          sent = true;
          break;
        } catch (e) {
          lastErr = e;
        }
      }
      if (!sent) throw lastErr || new Error(t('送礼失败'));
      setGiftStatus(t('已送出 {num} 个 {giftName}', { num, giftName: giftName(selectedGift) }));
      const money = await pocketApi.getUserMoney().catch(() => null);
      if (money?.content?.moneyTotal !== undefined) setBalance(String(money.content.moneyTotal));
    } catch (err) {
      setGiftStatus(t('送礼失败：{error}', { error: errorMessage(err) }));
    } finally {
      setGiftSending(false);
    }
  };

  const openRankPanel = async (source = playingRef.current || playing) => {
    if (!source?.item?.liveId) {
      setRankRows([]);
      setRankStatus(t('当前直播缺少 liveId，不能获取贡献榜'));
      setRankVisible(true);
      return;
    }
    setRankVisible(true);

    setRankRows([]);
    setRankStatus(t('加载中…'));
    try {
      const res = await pocketApi.getLiveRank(String(source.item.liveId));
      const rows = normalizeLiveRank(res);
      setRankRows(rows);
      if (
        rows.some((row, index) => row.userId && (!row.avatar || rankNameIsFallback(row, index)))
      ) {
        setRankStatus(t('正在补充 {count} 位贡献用户资料...', { count: rows.length }));
        const enriched = await Promise.all(
          rows.map(async (row, index) => {
            if (!row.userId || (row.avatar && !rankNameIsFallback(row, index))) return row;
            try {
              const profile = profileFromUserRes(
                await pocketApi.getUserProfile(String(row.userId)),
              );
              return {
                ...row,
                name: profile.name || row.name,
                avatar: profile.avatar || row.avatar,
              };
            } catch {
              return row;
            }
          }),
        );
        setRankRows(enriched);
        setRankStatus(
          enriched.length
            ? t('已加载 {count} 位贡献用户', { count: enriched.length })
            : t('贡献榜为空'),
        );
      } else {
        setRankStatus(
          rows.length ? t('已加载 {count} 位贡献用户', { count: rows.length }) : t('贡献榜为空'),
        );
      }
    } catch (err) {
      setRankRows([]);
      setRankStatus(t('贡献榜加载失败：{error}', { error: errorMessage(err) }));
    }
  };

  const screen = useWindowDimensions();

  useEffect(() => {
    if (usePlayerStore.getState().detectedAspect) return;
    if (screen.width > 0 && screen.height > 0) setPipAspectLive(screen.width > screen.height);
  }, [screen.width, screen.height]);

  const [pipRemount, setPipRemount] = useState(0);

  const [inSystemPip, setInSystemPip] = useState(false);
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('PipEnteredChanged', (entered: boolean) => {
      inSystemPipRef.current = !!entered;
      setInSystemPip(!!entered);
      if (!entered) setPipRemount((n) => n + 1);
    });
    return () => sub.remove();
  }, []);

  const startPlayRef = useRef(startPlay);
  startPlayRef.current = startPlay;
  const handlePlayCard = useCallback((it: VODItem) => {
    void startPlayRef.current(it);
  }, []);

  const mediaKeyExtractor = useCallback(
    (item: any, index: number) => {
      const base = String(item?.liveId || item?.key || index);
      return `${base}_${screen.width}_${pipRemount}`;
    },
    [pipRemount, screen.width],
  );

  const renderMediaItem = useCallback(
    ({ item }: { item: any }) => {
      if (tab === 'vod') {
        if (item.type === 'header') {
          return (
            <Text style={[styles.vodGroupTitle, { color: palette.labelTertiary }]}>
              {item.title}
            </Text>
          );
        }
        return (
          <View style={styles.vodRow}>
            <MediaGridCard item={item.left} isVod palette={palette} t={t} onPlay={handlePlayCard} />
            <MediaGridCard
              item={item.right}
              isVod
              palette={palette}
              t={t}
              onPlay={handlePlayCard}
            />
          </View>
        );
      }
      return (
        <MediaGridCard item={item} isVod={false} palette={palette} t={t} onPlay={handlePlayCard} />
      );
    },
    [handlePlayCard, palette, t, tab],
  );

  if (playing && playing.url && isSharePageUrl(String(playing.url))) {
    return (
      <View style={styles.playerPage}>
        <View style={styles.player}>
          <View style={styles.resolvingWrap}>
            <ActivityIndicator size="large" color="#FFFFFF" />
            <Text style={styles.resolvingText}>{t('正在解析播放地址…')}</Text>
          </View>
        </View>
      </View>
    );
  }

  if (playing) {
    return (
      <View style={[styles.playerPage, isFullscreen && styles.playerPageFullscreen]}>
        {announceVisible && announcement && !inSystemPip && !cleanScreen ? (
          announceExpanded ? (
            <Pressable
              style={[StyleSheet.absoluteFillObject, { zIndex: 28 }]}
              onPress={() => setAnnounceExpanded(false)}
            />
          ) : (
            <TouchableOpacity
              {...({ nativeID: 'yaya.pip.overlay', collapsable: false } as any)}
              activeOpacity={0.85}
              onPress={() => setAnnounceExpanded(true)}
              style={[styles.announceBadge, { top: insets.top + 56 }]}
            >
              <MaterialCommunityIcons name="bullhorn" size={14} color="#FFFFFF" />
              <Text style={styles.announceBadgeText}>{t('公告')}</Text>
            </TouchableOpacity>
          )
        ) : null}
        {announceExpanded && announceVisible && announcement && !inSystemPip && !cleanScreen ? (
          <View
            nativeID="yaya.pip.overlay"
            collapsable={false}
            style={[styles.announcePanel, { top: insets.top + 56 }]}
          >
            <View style={styles.announcePanelTop}>
              <View style={styles.announcePanelTitleRow}>
                <MaterialCommunityIcons
                  name="bullhorn"
                  size={15}
                  color="#FFFFFF"
                  style={{ marginRight: 5 }}
                />
                <Text style={styles.announcePanelTitle} numberOfLines={1}>
                  {t('公告')}
                </Text>
              </View>
              <View style={styles.announcePanelBtns}>
                <TouchableOpacity onPress={refreshAnnouncement} style={styles.announceSmallBtn}>
                  <Text style={styles.announceSmallBtnText}>{t('刷新')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setAnnounceExpanded(false)}
                  style={styles.announceSmallBtn}
                >
                  <Text style={styles.announceSmallBtnText}>{t('收起')}</Text>
                </TouchableOpacity>
              </View>
            </View>
            <ScrollView style={styles.announcePanelBody}>
              <Text style={styles.announcePanelText}>{announcement}</Text>
            </ScrollView>
          </View>
        ) : null}

        {!playing.url ? (
          <View style={styles.player}>
            {playerError ? (
              <View style={styles.resolvingWrap}>
                <Text style={styles.resolvingText}>{playerError}</Text>
                <TouchableOpacity
                  style={[styles.webFallbackBtn, { backgroundColor: palette.tint }]}
                  onPress={() => startPlay(playing.item)}
                >
                  <Text style={styles.webFallbackText}>{t('重试')}</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.resolvingWrap}>
                <ActivityIndicator size="large" color="#FFFFFF" />
                <Text style={styles.resolvingText}>{t('正在解析播放地址…')}</Text>
              </View>
            )}
          </View>
        ) : (
          <PlayerScreen
            source={{
              kind: playing.isLive ? 'live' : 'vod',
              url: playing.url,
              urls: playing.urls,
              liveId: String(playing.item?.liveId || playing.item?.id || ''),
              needsNativeExo: playing.needsVlc,
              coverPortrait: true,
              headers: {
                'User-Agent': USER_AGENT,
                Referer: 'https://h5.48.cn/',
                Origin: 'https://h5.48.cn',
              },
            }}
            meta={{ title: playing.title, cover: playing.cover }}
            pocket={{
              name:
                liveBarrage.liveInfo.hostName ||
                String(
                  playing.item?.user?.userName ||
                    playing.item?.nickname ||
                    playing.item?.ownerName ||
                    playing.title,
                ),
              avatar: normalizeUrl(
                liveBarrage.liveInfo.hostAvatar ||
                  pickText(playing.item, [
                    'user.userAvatar',
                    'avatar',
                    'userInfo.avatar',
                    'user.avatar',
                    'headImg',
                  ]),
              ),
              liveId: String(playing.item?.liveId || playing.item?.id || ''),
              audience: playing.isLive ? liveBarrage.liveInfo.audience : undefined,
              rankAvatars: liveBarrage.liveInfo.rankAvatars,
              comments: playing.isLive
                ? liveBarrage.items.length
                  ? liveBarrage.items
                      .slice()
                      .reverse()
                      .map((item) => ({
                        id: item.id,
                        text: item.text,
                        nick: item.nick,
                        level: item.level,
                        kind: item.kind,
                        userId: item.userId,
                        avatar: item.avatar,
                      }))
                  : showDanmaku
                    ? danmaku.map((item, index) => ({
                        id: `${item.time}-${index}`,
                        text: item.text,
                        nick: item.nick,
                        userId: item.userId,
                        avatar: item.avatar,
                        level: item.level,
                      }))
                    : []
                : undefined,
              replayComments: playing.isLive ? undefined : danmaku,
              onRankPress: () => openRankPanel(),
              onHostPress: () => {
                const hostName =
                  liveBarrage.liveInfo.hostName ||
                  String(
                    playing.item?.user?.userName ||
                      playing.item?.nickname ||
                      playing.item?.ownerName ||
                      playing.title,
                  );
                const hostAvatar = normalizeUrl(
                  liveBarrage.liveInfo.hostAvatar ||
                    pickText(playing.item, [
                      'user.userAvatar',
                      'avatar',
                      'userInfo.avatar',
                      'user.avatar',
                      'headImg',
                    ]),
                );
                const rawHostId = String(
                  liveBarrage.liveInfo.hostId ||
                    pickText(playing.item, [
                      'user.userId',
                      'user.id',
                      'userId',
                      'ownerId',
                      'starId',
                      'userInfo.userId',
                      'userInfo.id',
                    ]) ||
                    '',
                ).trim();
                const normHost = normalizeFollowName(hostName);
                const matched = members.find((m) => {
                  const mids = [m.id, m.userId].map((v) => String(v ?? '').trim());
                  if (rawHostId && mids.includes(rawHostId)) return true;
                  return !!normHost && normalizeFollowName(m.ownerName) === normHost;
                });
                setDanmakuProfile({
                  nick: hostName,
                  avatar: hostAvatar,
                  userId:
                    rawHostId || (matched ? String(matched.userId || matched.id || '') : undefined),
                  memberId: matched?.id ? String(matched.id) : undefined,
                  member: matched,
                });
              },
              onCommentPress: (item) =>
                setDanmakuProfile({
                  nick: item.nick,
                  avatar: item.avatar,
                  userId: item.userId ? String(item.userId) : undefined,
                  missingIdMessage: playing.isLive
                    ? undefined
                    : t('录播弹幕未提供用户 ID，无法加载完整资料'),
                }),
            }}
            onVideoSize={(w, h) => {
              if (w > 0 && h > 0) videoSizeRef.current = { w, h };
            }}
            danmaku={
              playing.isLive
                ? { type: 'poll', liveId: String(playing.item?.liveId || playing.item?.id || '') }
                : { type: 'lrc', lrcUrl: '' }
            }
            features={{
              rate: !playing.isLive,
              danmaku: true,
              kernelSwitch: true,
              resume: !playing.isLive,
            }}
            chromeHidden={inSystemPip}
            resumeAt={webResumeTime || playing?.position || 0}
            extraActions={[
              ...(playing.isLive
                ? [{ key: 'gift', icon: 'gift', label: t('礼物'), onPress: () => openGiftPanel() }]
                : []),
              { key: 'rank', icon: 'trophy', label: t('贡献榜'), onPress: () => openRankPanel() },
              ...(announceVisible && announcement
                ? [
                    {
                      key: 'announce',
                      icon: 'bullhorn',
                      label: t('公告'),
                      active: announceExpanded,
                      onPress: () => setAnnounceExpanded((v) => !v),
                    },
                  ]
                : []),
              {
                key: 'danmaku',
                icon: 'cog',
                label: t('弹幕设置'),
                onPress: () => setShowDanmakuSettings(true),
              },
              {
                key: 'danmakuList',
                icon: 'format-list-bulleted',
                label: t('弹幕列表'),
                active: showDanmakuList,
                onPress: () => setShowDanmakuList((v) => !v),
              },
              {
                key: 'pip',
                icon: 'picture-in-picture-bottom-right-outline',
                label: t('小窗'),
                onPress: handleMiniPlayer,
              },
            ]}

            barrageInput={
              playing.isLive ? (
                <LiveBarrageBoard
                  source={liveBarrage}
                  liveId={String(playing.item?.liveId || playing.item?.id || '')}
                  module="live"
                  variant="pocket"
                  inputOnly
                />
              ) : undefined
            }
            onClose={() => {
              setPipPlaying(false, 'mediascreen');
              closePlayer();
            }}

            onRetry={() =>
              playing.isLive ? void refreshLiveStream() : void startPlay(playing.item, false)
            }
            liveTransitionKey={liveBarrage.streamRevision}
            persistent
          >
            <DanmakuListSheet
              visible={showDanmakuList && !inSystemPip}
              onClose={() => setShowDanmakuList(false)}
              entries={danmakuListEntries}
              currentTime={danmakuClock}
              onSeek={
                playing?.isLive ? undefined : (sec) => usePlayerStore.getState().setSeekTarget(sec)
              }
              live={!!playing?.isLive}
              loading={
                playing?.isLive
                  ? liveBarrage.status === 'connecting' || liveBarrage.status === 'resolving'
                  : false
              }

              onOpenProfile={(entry) =>
                setDanmakuProfile({
                  nick: entry.nick,
                  avatar: entry.avatar,
                  userId: entry.userId != null ? String(entry.userId) : undefined,
                })
              }
            />
          </PlayerScreen>
        )}

        {playing?.isLive &&
        !inSystemPip &&
        !cleanScreen &&
        liveBarrage.pkState === 'start' &&
        liveBarrage.multiMicUsers.length ? (
          <View style={[styles.pkOverlay, { top: insets.top + 58 }]} pointerEvents="none">
            <Text style={styles.pkOverlayTitle}>{t('PK成员')}</Text>
            <Text style={styles.pkOverlayUsers} numberOfLines={2}>
              {liveBarrage.multiMicUsers
                .slice(0, 5)
                .map(
                  (user: any) =>
                    user?.userName || user?.nickname || user?.nickName || user?.name || '',
                )
                .filter(Boolean)
                .join(' · ')}
            </Text>
          </View>
        ) : null}

        {liveEnded && !cleanScreen ? (
          <View style={styles.liveEndedOverlay} pointerEvents="auto">
            <View style={styles.liveEndedCard}>
              <MaterialCommunityIcons name="broadcast-off" size={34} color="#FFFFFF" />
              <Text style={styles.liveEndedTitle}>
                {playing?.isLive ? t('直播已结束') : t('该录播暂时无法播放')}
              </Text>
              <Text style={styles.liveEndedSub} numberOfLines={2}>
                {playing.title}
              </Text>
              {liveSummary ? (
                <View style={styles.liveEndedSummary}>
                  <Text style={styles.liveEndedMeta} numberOfLines={1}>
                    {[liveSummary.member, liveSummary.startTime, liveSummary.duration]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                  {liveSummary.top.length ? (
                    <View style={styles.liveEndedTop}>
                      <Text style={styles.liveEndedTopTitle}>{t('贡献榜')}</Text>
                      {liveSummary.top.map((row, index) => (
                        <Text key={`${row.name}-${index}`} style={styles.liveEndedTopRow}>
                          {index + 1}. {row.name} {row.value}
                        </Text>
                      ))}
                    </View>
                  ) : null}
                </View>
              ) : null}
              <TouchableOpacity
                onPress={closePlayer}
                activeOpacity={0.85}
                style={[styles.liveEndedBtn, { backgroundColor: palette.tint }]}
              >
                <Text style={styles.liveEndedBtnText}>{t('返回')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}

        <UserProfileSheet
          visible={!!danmakuProfile}
          target={danmakuProfile}
          appearance="dark"
          onClose={() => setDanmakuProfile(null)}
          onOpenChat={({ id, name }) => {
            setDanmakuProfile(null);
            navigation.navigate('PrivateMessagesScreen', { targetUserId: id, targetName: name });
          }}
          onOpenMemberPage={({ memberId, name, avatar, member }) => {
            if (usePlayerStore.getState().fullscreen) {
              usePlayerStore.getState().setFullscreen(false);
            }
            setDanmakuProfile(null);
            navigation.navigate('ProfileScreen', {
              memberId,
              memberName: name,
              memberAvatar: avatar,
              member,
              nonce: Date.now(),
            });
          }}
          onFollowChanged={(id, following) => {
            setFollowedIds((prev) => {
              const next = new Set(prev);
              if (following) next.add(id);
              else next.delete(id);
              void writeFollowedIdsCache(token, Array.from(next));
              return next;
            });
          }}
        />

        <Modal
          visible={giftVisible}
          transparent
          animationType="slide"
          statusBarTranslucent
          navigationBarTranslucent
          onRequestClose={() => setGiftVisible(false)}
        >
          <View style={styles.modalShade}>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setGiftVisible(false)} />
            <View
              style={[
                styles.giftPanel,
                {
                  backgroundColor: 'rgba(24,24,30,0.96)',
                  paddingBottom: Math.max(18, insets.bottom + 12),
                },
              ]}
            >
              <View style={styles.sheetHandle} />
              <View style={styles.giftHeader}>
                <Text style={[styles.giftTitle, { color: liveSheetPalette.label }]}>
                  {t('直播送礼')}
                </Text>
                <TouchableOpacity
                  onPress={() => setGiftVisible(false)}
                  activeOpacity={0.7}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityRole="button"
                  accessibilityLabel={t('关闭')}
                  style={[styles.sheetCloseBtn, { backgroundColor: liveSheetPalette.fill2 }]}
                >
                  <MaterialCommunityIcons
                    name="close"
                    size={18}
                    color={liveSheetPalette.labelSecondary}
                  />
                </TouchableOpacity>
              </View>
              <Text style={[styles.giftStatus, { color: liveSheetPalette.labelSecondary }]}>
                {balance ? `${t('余额：{balance} 鸡腿', { balance })} · ` : ''}
                {giftStatus}
              </Text>
              <ScrollView style={styles.giftGrid}>
                <View style={styles.giftGridInner}>
                  {gifts.map((gift) => {
                    const active =
                      String(selectedGift?.giftId || selectedGift?.id) ===
                      String(gift.giftId || gift.id);
                    return (
                      <TouchableOpacity
                        key={String(gift.giftId || gift.id)}
                        style={[
                          styles.giftItem,
                          active && styles.giftItemActive,
                          {
                            backgroundColor: active
                              ? liveSheetPalette.tintSoft
                              : liveSheetPalette.fill2,
                            borderColor: active ? liveSheetPalette.tint : liveSheetPalette.hairline,
                          },
                        ]}
                        onPress={() => setSelectedGift(gift)}
                        activeOpacity={0.85}
                      >
                        {giftImage(gift) ? (
                          <NetworkImage
                            source={{ uri: giftImage(gift) }}
                            style={styles.giftImage}
                            thumbnail={96}
                          />
                        ) : (
                          <View
                            style={[styles.giftImage, { backgroundColor: liveSheetPalette.fill3 }]}
                          />
                        )}
                        <Text
                          style={[styles.giftName, { color: liveSheetPalette.label }]}
                          numberOfLines={1}
                        >
                          {giftName(gift)}
                        </Text>
                        <Text style={[styles.giftCost, { color: liveSheetPalette.tint }]}>
                          {t('{count} 鸡腿', { count: giftCost(gift) })}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </ScrollView>
              <View style={styles.giftFooter}>
                <TextInput
                  style={[
                    styles.giftNum,
                    {
                      color: liveSheetPalette.label,
                      borderColor: liveSheetPalette.hairline,
                      backgroundColor: liveSheetPalette.fill2,
                    },
                  ]}
                  keyboardType="numeric"
                  value={giftNum}
                  maxLength={3}

                  onChangeText={(s) => setGiftNum(String(s).replace(/\D/g, '').slice(0, 3))}
                />
                <TouchableOpacity
                  style={[
                    styles.sendGiftBtn,
                    {
                      backgroundColor:
                        selectedGift && !giftSending
                          ? liveSheetPalette.tint
                          : liveSheetPalette.fill3,
                    },
                  ]}
                  onPress={sendGift}
                  disabled={!selectedGift || giftSending}
                  activeOpacity={0.85}
                >
                  <Text
                    style={[
                      styles.sendGiftText,
                      {
                        color:
                          selectedGift && !giftSending
                            ? liveSheetPalette.onTint
                            : liveSheetPalette.labelTertiary,
                      },
                    ]}
                  >
                    {giftSending
                      ? t('发送中...')
                      : selectedGift
                        ? t('送出 · {count}', { count: selectedGiftTotal })
                        : t('选择礼物')}
                  </Text>
                </TouchableOpacity>
              </View>
              <TouchableOpacity
                style={styles.rechargeBtn}
                onPress={() => {
                  setGiftVisible(false);
                  (navigation as any).navigate('RechargeScreen');
                }}
                activeOpacity={0.8}
              >
                <Text style={[styles.rechargeText, { color: liveSheetPalette.tint }]}>
                  {t('余额不足？去充值鸡腿')}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
        <Modal
          visible={rankVisible}
          transparent
          animationType="slide"
          presentationStyle="overFullScreen"
          statusBarTranslucent
          navigationBarTranslucent
          onRequestClose={() => setRankVisible(false)}
        >
          <View style={styles.modalShade}>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setRankVisible(false)} />
            <View
              style={[
                styles.giftPanel,
                {
                  backgroundColor: 'rgba(24,24,30,0.96)',
                  paddingBottom: Math.max(18, insets.bottom + 12),
                },
              ]}
            >
              <View style={styles.sheetHandle} />
              <View style={styles.giftHeader}>
                <Text style={[styles.giftTitle, { color: liveSheetPalette.label }]}>
                  {t('贡献榜')}
                </Text>
                <TouchableOpacity
                  onPress={() => setRankVisible(false)}
                  activeOpacity={0.7}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityRole="button"
                  accessibilityLabel={t('关闭')}
                  style={[styles.sheetCloseBtn, { backgroundColor: liveSheetPalette.fill2 }]}
                >
                  <MaterialCommunityIcons
                    name="close"
                    size={18}
                    color={liveSheetPalette.labelSecondary}
                  />
                </TouchableOpacity>
              </View>
              <Text style={[styles.giftStatus, { color: liveSheetPalette.labelSecondary }]}>
                {rankStatus}
              </Text>
              <ScrollView
                style={styles.rankList}
                nestedScrollEnabled
                overScrollMode="never"
                showsVerticalScrollIndicator
              >
                {rankRows.map((row, index) => (
                  <TouchableOpacity
                    key={String(row.userId || row.id || index)}

                    activeOpacity={0.7}
                    onPress={() =>
                      setRankProfile({
                        userId: row.userId ? String(row.userId) : undefined,
                        nick: row.name,
                        avatar: row.avatar,
                        missingIdMessage: t('该用户没有可加载的口袋资料'),
                      })
                    }
                    style={[styles.rankRow, { borderBottomColor: liveSheetPalette.hairline }]}
                  >
                    <Text style={[styles.rankNo, { color: liveSheetPalette.tint }]}>
                      {row.rank || index + 1}
                    </Text>
                    {row.avatar ? (
                      <NetworkImage
                        source={{ uri: row.avatar }}
                        style={[styles.rankAvatar, { backgroundColor: liveSheetPalette.fill3 }]}
                        thumbnail={64}
                      />
                    ) : (
                      <View
                        style={[styles.rankAvatar, { backgroundColor: liveSheetPalette.fill3 }]}
                      />
                    )}
                    <View style={styles.rankInfo}>
                      <Text
                        style={[styles.rankName, { color: liveSheetPalette.label }]}
                        numberOfLines={1}
                      >
                        {row.name}
                      </Text>
                      <Text
                        style={[styles.rankValue, { color: liveSheetPalette.labelSecondary }]}
                        numberOfLines={1}
                      >
                        {row.value ? t('贡献 {value}', { value: row.value }) : t('贡献用户')}
                      </Text>
                    </View>
                    <MaterialCommunityIcons
                      name="chevron-right"
                      size={16}
                      color={liveSheetPalette.labelTertiary}
                    />
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          </View>
        </Modal>

        <UserProfileSheet
          visible={!!rankProfile}
          target={rankProfile}
          appearance="dark"
          onClose={() => setRankProfile(null)}
          onOpenChat={({ id, name }) => {
            setRankProfile(null);
            setRankVisible(false);
            navigation.navigate('PrivateMessagesScreen', { targetUserId: id, targetName: name });
          }}
        />
        <DanmakuSettingsSheet
          staticFeed
          visible={showDanmakuSettings}
          onClose={() => setShowDanmakuSettings(false)}
        />
      </View>
    );
  }

  const headerOffset = getFloatingHeaderOffset(insets.top);
  const hasTopControls = showSearch || !!dateFilter || memberHits.length > 0 || !!error;

  return (
    <View style={[styles.container]}>
      <FloatingTabHeader
        leftIsland={
          <GlassSegmented
            role="bar"
            options={[
              { key: 'live', label: t('直播') },
              { key: 'vod', label: t('录播') },
            ]}
            value={tab}
            onChange={(k) => switchTab(k as 'live' | 'vod')}
            height={FLOATING_BAR_HEIGHT}
            labelFontSize={13}
            style={styles.headerSeg}
          />
        }
        right={
          <>
            <FloatingHeaderAction
              icon="calendar-month"
              active={!!dateFilter || showCalendar}
              accessibilityLabel={t('日历')}
              onPress={() => startTransition(() => setShowCalendar(true))}
            />
            <FloatingHeaderAction
              icon={showSearch ? 'close' : 'magnify'}
              active={showSearch}
              accessibilityLabel={showSearch ? t('关闭搜索') : t('搜索')}
              onPress={() => startTransition(() => setShowSearch((v) => !v))}
            />
            <FloatingHeaderAction
              icon="refresh"
              accessibilityLabel={t('刷新')}
              onPress={refreshList}
            />
          </>
        }
      />

      {hasTopControls ? (
        <View style={{ paddingTop: headerOffset }}>
          {showSearch ? (
            <View style={styles.searchWrap}>
              {selectedMember ? (
                <TouchableOpacity
                  onPress={() => setSelectedMember(null)}
                  style={[styles.memberChip, { backgroundColor: palette.tint }]}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.memberChipText, { color: palette.onTint }]}>
                    {selectedMember.ownerName}
                  </Text>
                  <MaterialCommunityIcons
                    name="close"
                    size={16}
                    color={palette.onTint}
                    style={{ marginLeft: 6 }}
                  />
                </TouchableOpacity>
              ) : null}
              <SearchBar
                value={search}
                onChangeText={setSearch}
                placeholder={
                  selectedMember ? t('搜索该成员的标题 / 日期...') : t('搜索成员名、标题、时间...')
                }
                style={{ flex: 1 }}
              />
            </View>
          ) : null}
          {dateFilter ? (
            <View style={styles.dateChipRow}>
              <TouchableOpacity
                style={[
                  styles.dateChip,
                  { backgroundColor: palette.tintSoft, borderColor: palette.tint },
                ]}
                onPress={() => setShowCalendar(true)}
                activeOpacity={0.85}
              >
                <MaterialCommunityIcons name="calendar-month" size={14} color={palette.tint} />
                <Text style={[styles.dateChipText, { color: palette.tint }]}>
                  {dateKeyOf(dateFilter)}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setDateFilter(null)}
                style={styles.dateChipClear}
                activeOpacity={0.85}
              >
                <MaterialCommunityIcons
                  name="close-circle"
                  size={16}
                  color={palette.labelTertiary}
                />
              </TouchableOpacity>
            </View>
          ) : null}
          {memberHits.length ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.memberHits}
              contentContainerStyle={styles.memberHitsContent}
            >
              {memberHits.map((m) => (
                <TouchableOpacity
                  key={m.id}
                  style={[
                    styles.memberHitChip,
                    { backgroundColor: palette.fill2, borderColor: palette.hairline },
                  ]}
                  onPress={() => {
                    setSelectedMember(m);
                    setSearch('');
                  }}
                >
                  <Text style={[styles.memberHitText, { color: palette.labelSecondary }]}>
                    {m.ownerName.split('-').pop()}
                  </Text>
                  {m.team ? (
                    <Text style={[styles.memberHitTeam, { color: palette.labelTertiary }]}>
                      {m.team}
                    </Text>
                  ) : null}
                </TouchableOpacity>
              ))}
            </ScrollView>
          ) : null}
          {error ? (
            <View
              style={[
                styles.errorRow,
                {
                  backgroundColor: palette.surfaceGlass,
                  borderColor: palette.innerStroke,
                  borderWidth: StyleSheet.hairlineWidth,
                },
              ]}
            >
              <Text style={[styles.error, { color: palette.labelSecondary }]} numberOfLines={2}>
                {error}
              </Text>
              <Button title={t('重试')} variant="tinted" size="sm" onPress={reloadList} />
            </View>
          ) : null}
        </View>
      ) : null}

      <MediaCalendarSheet
        visible={showCalendar}
        initial={dateFilter}
        onSelect={(d) => {
          setDateFilter(d);
          setShowCalendar(false);
        }}
        onClose={() => setShowCalendar(false)}
      />

      <View style={{ flex: 1 }}>
        <PerfFlatList
          key={tab === 'vod' ? 'vod-1col' : 'live-2col'}

          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"

          data={tab === 'vod' ? ((vodRows ?? []) as any) : list}
          keyExtractor={mediaKeyExtractor}
          numColumns={tab === 'vod' ? 1 : 2}
          columnWrapperStyle={tab === 'vod' ? null : styles.vodGridRow}

          extraData={screen.width}
          removeClippedSubviews={false}

          updateCellsBatchingPeriod={40}
          renderItem={renderMediaItem}
          ListEmptyComponent={
            !loadedOnce[tab] || (groupId === -1 && !!token && !followedIdsReady) ? (
              <MediaGridSkeleton />
            ) : groupId === -1 && !token ? (
              <LoginPrompt hint={t('查看关注成员的直播/录播需要登录')} />
            ) : followFetching ? (
              <View style={styles.followScanWrap}>
                <ActivityIndicator size="small" color={palette.tint} />
                <Text style={[styles.followScanText, { color: palette.labelSecondary }]}>
                  {t('正在翻找关注成员的录播…')}
                </Text>
              </View>
            ) : (
              <EmptyState
                icon={error ? 'cloud-alert-outline' : 'file-cancel-outline'}
                title={
                  search.trim()
                    ? t('没有匹配的直播/录播')
                    : error
                      ? t('加载失败，请下拉重试')
                      : t('暂无数据')
                }
              />
            )
          }
          onEndReached={() => loadMore(groupId === -1)}
          onEndReachedThreshold={0.35}
          refreshControl={
            <RefreshControl
              refreshing={loading && list.length > 0}
              onRefresh={refreshList}
              colors={[palette.tint]}
              tintColor={palette.tint}
              progressViewOffset={hasTopControls ? 0 : headerOffset}
            />
          }
          ListHeaderComponent={filterBarNode}
          ListFooterComponent={<ListBottomSpacer />}
          contentContainerStyle={[
            list.length === 0 ? { flex: 1 } : styles.listContent,
            { paddingTop: hasTopControls ? 2 : headerOffset },
          ]}
          initialNumToRender={tab === 'vod' ? 4 : 6}
          maxToRenderPerBatch={tab === 'vod' ? 4 : 6}
          windowSize={7}
        />
      </View>
    </View>
  );
}

const VOD_SHADE_COLORS = ['rgba(0,0,0,0)', 'rgba(0,0,0,0.45)', 'rgba(0,0,0,0.82)'] as const;
const VOD_SHADE_LOCATIONS = [0, 0.45, 1] as const;

const MediaGridCard = React.memo(function MediaGridCard({
  item,
  isVod,
  palette,
  t,
  onPlay,
}: {
  item: any;
  isVod: boolean;
  palette: Palette;
  t: (key: string) => string;
  onPlay: (item: VODItem) => void;
}) {
  if (!item) return <View style={styles.vodGridItem} />;
  const coverUrl = item.liveCover || item.coverPath;
  const meta = [item.nickname, formatTimestamp(item.startTime).slice(0, 16)]
    .filter(Boolean)
    .join(' · ');
  return (
    <View style={styles.vodGridItem}>
      <TouchableOpacity
        style={[
          styles.vodGridCard,
          {
            backgroundColor: 'transparent',
            borderColor: palette.hairline,
            borderWidth: StyleSheet.hairlineWidth,
          },
        ]}
        onPress={() => onPlay(item)}
        activeOpacity={0.88}
        accessibilityLabel={item.title || item.liveRoomTitle || t('播放')}
      >
        <View
          style={{
            borderRadius: 22,
            borderCurve: 'continuous',
            overflow: 'hidden',
            backgroundColor: palette.surfaceGlassStrong,
          }}
        >
          <View style={[styles.vodGridCover, { backgroundColor: palette.fill3 }]}>
            {coverUrl ? (
              <NetworkImage
                source={{ uri: thumbUrl(coverUrl, GRID_COVER_THUMB) }}
                style={styles.vodGridCoverImg}
                resizeMode="cover"
              />
            ) : (
              <View style={styles.vodGridFallback}>
                <MaterialCommunityIcons name="video" size={30} color={palette.labelTertiary} />
              </View>
            )}
            <View
              style={[styles.v2Badge, styles.vodGridType, { backgroundColor: 'rgba(0,0,0,0.55)' }]}
            >
              <MaterialCommunityIcons
                name={item.liveType === 2 ? 'radio' : 'video'}
                size={10}
                color="#FFFFFF"
                style={{ marginRight: 3 }}
              />
              <Text style={styles.v2BadgeText}>{item.liveType === 2 ? t('电台') : t('视频')}</Text>
            </View>

            <View style={styles.vodBadgeRow}>
              {isVod ? (
                item.endTime && item.startTime ? (
                  <View style={[styles.v2Badge, { backgroundColor: 'rgba(0,0,0,0.55)' }]}>
                    <Text style={styles.v2BadgeText}>
                      {formatDuration((item.endTime - item.startTime) / 1000)}
                    </Text>
                  </View>
                ) : null
              ) : (
                <View style={[styles.v2Badge, { backgroundColor: 'rgba(0,0,0,0.55)' }]}>
                  {item.liveType === 2 ? (
                    <>
                      <MaterialCommunityIcons
                        name="radio"
                        size={11}
                        color="#FFFFFF"
                        style={{ marginRight: 3 }}
                      />
                      <Text style={styles.v2BadgeText}>{t('电台')}</Text>
                    </>
                  ) : (
                    <>
                      <LivePulseDot />
                      <Text style={styles.v2BadgeText}>{t('直播中')}</Text>
                    </>
                  )}
                </View>
              )}
            </View>

            <LinearGradient
              pointerEvents="none"
              colors={VOD_SHADE_COLORS as unknown as [string, string, ...string[]]}
              locations={VOD_SHADE_LOCATIONS as unknown as [number, number, ...number[]]}
              style={styles.vodShade}
            />
            <View style={styles.vodInfoOverlay}>
              <Text style={styles.vodTitleOverlay} numberOfLines={2}>
                {item.title || item.liveRoomTitle || t('无标题')}
              </Text>
              {meta ? (
                <Text style={styles.vodMetaOverlay} numberOfLines={1}>
                  {meta}
                </Text>
              ) : null}
            </View>
          </View>
        </View>
      </TouchableOpacity>
    </View>
  );
});
