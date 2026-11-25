import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation } from '@react-navigation/native';
import { CompositeNavigationProp } from '@react-navigation/native';
import { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { StackNavigationProp } from '@react-navigation/stack';
import { useSafeAreaInsets } from '../hooks/useSafeAreaInsets';
import { usePocketAccountSummary } from '../hooks/usePocketAccountSummary';
import { RootStackParamList, TabParamList } from '../navigation/types';
import { useSettingsStore, useMemberStore, useUiStore } from '../store';
import { useMusicPlayerStore } from '../store/musicPlayerStore';
import { MusicEngine } from '../services/musicPlayer';
import { usePalette, spacing, getPageBackground } from '../theme';
import { typography } from '../theme/typography';
import {
  FloatingHeaderAction,
  FloatingTabHeader,
  getFloatingHeaderOffset,
} from '../components/FloatingTabHeader';
import { GlassCard } from '../components/GlassCard';
import { ScalePressable } from '../components/Motion';
import { useI18n } from '../i18n';
import {
  fetchFollowedIdsShared,
  fetchLiveListShared,
  hydrateFollowedIdsShared,
  peekFollowedIdsShared,
  subscribeFollowedIds,
} from '../services/pocketSharedData';
import { pocketApi } from '../api/pocket48';
import { externalApi } from '../api/external';
import bilibiliApi from '../api/bilibili';
import { BilibiliLiveRoom } from '../types';
import { normalizeUrl, pickText, unwrapList } from '../utils/data';
import { privateUnreadCount, sumPrivateConversationUnread } from '../utils/privateUnread';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { resolveHomeModules } from './home/modules';
import LiveModule from './home/LiveModule';
import PerformancesModule from './home/PerformancesModule';
import QuickModule from './home/QuickModule';
import ResumeModule from './home/ResumeModule';
import ToolsModule from './home/ToolsModule';
import { styles } from './home/styles';
import { matchFollowedMember } from './followedRooms/roomDomain';
import { decideLivesUpdate } from '../utils/homeLivesRules';
import { useDiscoveredLivesStore } from '../store/discoveredLivesStore';
import type { LiveCardItem, NavItem } from './home/types';

type HomeNavProp = CompositeNavigationProp<
  BottomTabNavigationProp<TabParamList, 'Home'>,
  StackNavigationProp<RootStackParamList>
>;

const ICONS: Record<string, string> = {
  LiveRoom: 'video',
  Vod: 'play-box-multiple',
  RoomRadio: 'radio',
  Bilibili: 'broadcast',
  Rooms: 'message-text',
  PrivateMessages: 'email-outline',
  RoomAlbum: 'image-multiple',
  OpenLive: 'theater',
  FlipSend: 'comment-question-outline',
  FlipHistory: 'history',
  Analysis: 'chart-bar',
  Profile: 'account',
  MemberDynamic: 'star-circle',
  MemberWeibo: 'web',
  Trip: 'briefcase',
  VideoLibrary: 'play-box',
  MusicLibrary: 'music-note',
  AudioPrograms: 'podcast',
  MeleeRank: 'trophy',
  Database: 'database',
  Login: 'key-variant',
  Download: 'download',
  Invoice: 'file-document-outline',
  Settings: 'cog',
  Community: 'forum',
  OnMic: 'microphone',
};

const QUICK: NavItem[] = [
  { title: '直播', desc: '', route: 'Media', params: { mode: 'live' }, icon: ICONS.LiveRoom },
  { title: '回放', desc: '', route: 'Media', params: { mode: 'vod' }, icon: ICONS.Vod },
  { title: '音乐', desc: '', route: 'MusicLibraryScreen', icon: ICONS.MusicLibrary },
  { title: '翻牌', desc: '', route: 'FlipScreen', icon: ICONS.FlipSend },
];

const TOOL_CHIPS: NavItem[] = [
  { title: '上麦', desc: '', route: 'OnMicScreen', icon: ICONS.OnMic },
  { title: '下载', desc: '', route: 'DownloadScreen', icon: ICONS.Download },
  { title: '公演', desc: '', route: 'OpenLiveScreen', icon: ICONS.OpenLive },
  { title: 'B站', desc: '', route: 'BilibiliLiveScreen', icon: ICONS.Bilibili },
  { title: '鸡腿榜', desc: '', route: 'MeleeRankScreen', icon: ICONS.MeleeRank },
  { title: '相册', desc: '', route: 'RoomAlbumScreen', icon: ICONS.RoomAlbum },
  { title: '数据库', desc: '', route: 'DatabaseScreen', icon: ICONS.Database },
  { title: '发票', desc: '', route: 'InvoiceScreen', icon: ICONS.Invoice },
];

function normalizeFollowName(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^(?:snh48|gnz48|bej48|ckg48|cgt48)[-_ ]/i, '');
}

function sortLivesByPreference(
  list: LiveCardItem[],
  followedIds: Set<string>,
  pinnedIds: string[],
  followedNames: Set<string> = new Set(),
) {
  const pinSet = new Set(pinnedIds);
  const isFollowed = (it: LiveCardItem) => {
    const uid = String(it.userId ?? '');
    if (followedIds.has(uid)) return true;
    const nick = normalizeFollowName(it.nickname);
    return !!nick && followedNames.has(nick);
  };
  const rank = (it: LiveCardItem) => {
    const uid = String(it.userId ?? '');
    if (isFollowed(it)) return pinSet.has(uid) ? 0 : 1;
    if (pinSet.has(uid)) return 2;
    return 3;
  };

  if (followedIds.size || followedNames.size) {
    const preferred = list.filter((it) => isFollowed(it) || pinSet.has(String(it.userId ?? '')));
    if (preferred.length) {
      const preferredSet = new Set(preferred);
      const rest = list.filter((it) => !preferredSet.has(it));
      return [
        ...preferred.sort((a, b) => rank(a) - rank(b)),
        ...rest.sort((a, b) => rank(a) - rank(b)),
      ];
    }
  }
  return [...list].sort((a, b) => rank(a) - rank(b));
}

const LIVES_CACHE_KEY = 'yaya_home_lives_cache_v1';

const GONGYAN_CACHE_KEY = 'yaya_home_gongyan_cache_v1';

const BILI_FAST_TIMEOUT = 6000;

const HOME_FOCUS_DEFER_MS = 260;

const HOME_FOCUS_COOLDOWN_MS = 20000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise<T | null>((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      resolve(null);
    }, ms);
    p.then(
      (value) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function isAppForeground(): boolean {
  return AppState.currentState !== 'background' && AppState.currentState !== 'inactive';
}

function normalizeLiveList(res: any): LiveCardItem[] {
  const source = unwrapList(res, [
    'content.liveList',
    'content.list',
    'content.data',
    'content.records',
    'data.liveList',
    'liveList',
    'list',
    'data',
  ]);
  return source
    .map((raw: any, index: number) => ({
      liveId: String(pickText(raw, ['liveId', 'id', 'live_id', 'roomId'], String(index))),
      title: pickText(raw, ['title', 'liveTitle', 'liveRoomTitle', 'roomName', 'subject'], ''),
      nickname: pickText(
        raw,
        ['nickname', 'nickName', 'userInfo.nickname', 'userInfo.nickName', 'ownerName'],
        '',
      ),
      cover: normalizeUrl(
        pickText(
          raw,
          [
            'liveCover',
            'coverPath',
            'cover',
            'coverUrl',
            'picPath',
            'picturePath',
            'imageUrl',
            'poster',
            'thumb',
            'userInfo.avatar',
          ],
          '',
        ),
      ),
      userId: String(
        pickText(
          raw,
          [
            'userId',
            'ownerId',
            'memberId',
            'hostId',
            'account',
            'userInfo.userId',
            'userInfo.id',
            'owner.userId',
            'memberInfo.userId',
            'user.userId',
          ],
          '',
        ),
      ),
    }))
    .filter((item: LiveCardItem) => item.title);
}

export default function HomeScreen() {
  const navigation = useNavigation<HomeNavProp>();
  const focusedRef = useRef(navigation.isFocused());
  const lastGongyanAtRef = useRef(0);
  const lastFollowedIdsAtRef = useRef(0);
  const lastLivesAtRef = useRef(0);
  const lastUnreadAtRef = useRef(0);
  const settings = useSettingsStore((state) => state.settings);

  const order = resolveHomeModules(settings.home_modules_order, settings.home_modules_hidden);
  const showLive = order.some((m) => m.key === 'live');
  const showPerformances = order.some((m) => m.key === 'performances');
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const token = settings.p48Token;
  const account = usePocketAccountSummary(token);

  const { width: winW } = useWindowDimensions();
  const quickCellW = (winW - spacing.md * 2 - 24) / 4;

  const [lives, setLives] = useState<LiveCardItem[]>([]);
  const [livesOk, setLivesOk] = useState(false);
  const [livesError, setLivesError] = useState('');
  const [bannerIndex, setBannerIndex] = useState(0);
  const discoveredLives = useDiscoveredLivesStore((s) => s.items);

  const pmUnread = useUiStore((state) => state.pmUnread);
  const setPmUnread = useUiStore((state) => state.setPmUnread);
  const pmUnreadTokenRef = useRef('');
  const fetchedRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );
  const livesRetryRef = useRef(0);

  const livesRef = useRef<LiveCardItem[]>([]);

  const allLivesRef = useRef<LiveCardItem[]>([]);

  const emptyStreakRef = useRef(0);
  useEffect(() => {
    livesRef.current = lives;
  }, [lives]);

  const GONGYAN_ROOMS = useMemo(() => ['SNH48', 'GNZ48', 'BEJ48', 'CGT48', 'CKG48'], []);
  const [gongyanRooms, setGongyanRooms] = useState<BilibiliLiveRoom[]>([]);
  const [gongyanLive, setGongyanLive] = useState<Record<string, boolean>>({});
  const [gongyanInfo, setGongyanInfo] = useState<Record<string, { title: string; cover: string }>>(
    {},
  );
  const [gongyanOk, setGongyanOk] = useState(false);
  const [gongyanError, setGongyanError] = useState('');
  const gongyanTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const gongyanRetryRef = useRef(0);
  const gongyanHasDataRef = useRef(false);

  const gongyanLiveRef = useRef<Record<string, boolean>>({});

  const gongyanInfoRef = useRef<Record<string, { title: string; cover: string }>>({});
  useEffect(() => {
    gongyanLiveRef.current = gongyanLive;
  }, [gongyanLive]);
  useEffect(() => {
    gongyanInfoRef.current = gongyanInfo;
  }, [gongyanInfo]);

  const fetchGongyanStatus = useCallback(async () => {
    if (!focusedRef.current || !isAppForeground()) return;
    lastGongyanAtRef.current = Date.now();
    try {
      const rooms = await externalApi.fetchBilibiliConfig();

      const filtered = GONGYAN_ROOMS.map((name) =>
        rooms.find((room) => String(room.name || '').trim() === name),
      ).filter((room): room is BilibiliLiveRoom => !!room);

      const results = await Promise.allSettled(
        filtered.map((room) =>
          withTimeout(bilibiliApi.getRoomInit(room.roomId), BILI_FAST_TIMEOUT),
        ),
      );
      const prevLive = gongyanLiveRef.current;
      const next: Record<string, boolean> = {};
      filtered.forEach((room, index) => {
        const r = results[index];
        if (r.status === 'fulfilled' && r.value) {
          next[room.roomId] = Number(r.value?.data?.live_status) === 1;
        } else {
          next[room.roomId] = !!prevLive[room.roomId];
        }
      });

      const liveIds = filtered.filter((room) => next[room.roomId]).map((room) => room.roomId);
      const infoResults = await Promise.allSettled(
        liveIds.map((id) => withTimeout(bilibiliApi.getRoomInfo(id), BILI_FAST_TIMEOUT)),
      );
      const prevInfo = gongyanInfoRef.current;
      const infoMap: Record<string, { title: string; cover: string }> = {};
      infoResults.forEach((r, index) => {
        const rid = liveIds[index];
        if (r.status === 'fulfilled' && r.value) {
          const d = r.value;
          infoMap[rid] = {
            title: String(d.title || ''),
            cover: normalizeUrl(String(d.cover || d.user_cover || '')),
          };
        } else {
          infoMap[rid] = prevInfo[rid] || { title: '', cover: '' };
        }
      });
      if (!focusedRef.current || !isAppForeground()) return;
      setGongyanLive(next);
      setGongyanInfo(infoMap);
      setGongyanRooms(filtered);
      setGongyanOk(true);
      setGongyanError('');
      gongyanRetryRef.current = 0;
      gongyanHasDataRef.current = true;

      AsyncStorage.setItem(
        GONGYAN_CACHE_KEY,
        JSON.stringify({ rooms: filtered, live: next, info: infoMap }),
      ).catch(() => {});
    } catch (e: any) {
      if (!focusedRef.current) return;

      if (!gongyanHasDataRef.current) setGongyanError(e?.message || String(e));

      if (gongyanRetryRef.current < 2) {
        gongyanRetryRef.current += 1;
        setTimeout(() => {
          if (!mountedRef.current || !focusedRef.current) return;
          if (isAppForeground()) fetchGongyanStatus();
        }, 5000);
      }
    }
  }, [GONGYAN_ROOMS]);

  useEffect(() => {
    AsyncStorage.getItem(GONGYAN_CACHE_KEY)
      .then((raw) => {
        if (!raw) return;
        try {
          const cached = JSON.parse(raw);
          if (Array.isArray(cached?.rooms) && cached.rooms.length) {
            setGongyanRooms(cached.rooms);
            setGongyanLive(cached.live || {});
            setGongyanInfo(cached.info || {});
            setGongyanOk(true);
            gongyanHasDataRef.current = true;
          }
        } catch {}
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!showPerformances) return;
    let deferTimer: ReturnType<typeof setTimeout> | null = null;
    const cancelDefer = () => {
      if (deferTimer) {
        clearTimeout(deferTimer);
        deferTimer = null;
      }
    };
    const scheduleGongyan = (delayMs: number) => {
      cancelDefer();
      deferTimer = setTimeout(() => {
        deferTimer = null;
        if (focusedRef.current && isAppForeground()) {
          void fetchGongyanStatus();
        }
      }, delayMs);
    };
    if (navigation.isFocused()) {
      focusedRef.current = true;
      if (!gongyanHasDataRef.current) void fetchGongyanStatus();
      else if (Date.now() - lastGongyanAtRef.current >= HOME_FOCUS_COOLDOWN_MS) {
        scheduleGongyan(HOME_FOCUS_DEFER_MS);
      }
    }
    gongyanTimer.current = setInterval(
      () => {
        if (!focusedRef.current || !isAppForeground()) return;
        void fetchGongyanStatus();
      },
      2 * 60 * 1000,
    );
    const offFocus = navigation.addListener('focus', () => {
      focusedRef.current = true;
      if (
        !gongyanHasDataRef.current ||
        Date.now() - lastGongyanAtRef.current >= HOME_FOCUS_COOLDOWN_MS
      ) {
        scheduleGongyan(HOME_FOCUS_DEFER_MS);
      }
    });
    const offBlur = navigation.addListener('blur', () => {
      focusedRef.current = false;
      cancelDefer();
    });
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && focusedRef.current) {
        if (
          !gongyanHasDataRef.current ||
          Date.now() - lastGongyanAtRef.current >= HOME_FOCUS_COOLDOWN_MS
        ) {
          scheduleGongyan(HOME_FOCUS_DEFER_MS);
        }
      } else {
        cancelDefer();
      }
    });
    return () => {
      cancelDefer();
      if (gongyanTimer.current) clearInterval(gongyanTimer.current);
      offFocus();
      offBlur();
      sub.remove();
    };
  }, [fetchGongyanStatus, navigation, showPerformances]);

  const liveGongyanRooms = useMemo(
    () => gongyanRooms.filter((room) => !!gongyanLive[room.roomId]),
    [gongyanRooms, gongyanLive],
  );

  const bannerDraggingRef = useRef(false);
  const bannerResumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleBannerDragChange = useCallback((dragging: boolean) => {
    if (bannerResumeTimerRef.current) {
      clearTimeout(bannerResumeTimerRef.current);
      bannerResumeTimerRef.current = null;
    }
    if (dragging) {
      bannerDraggingRef.current = true;
    } else {
      bannerResumeTimerRef.current = setTimeout(() => {
        bannerResumeTimerRef.current = null;
        bannerDraggingRef.current = false;
      }, 1500);
    }
  }, []);

  const [followedIds, setFollowedIds] = useState<Set<string>>(new Set());
  const [pinnedIds, setPinnedIds] = useState<string[]>([]);
  const members = useMemberStore((state) => state.members);

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
  useEffect(() => {
    AsyncStorage.getItem('yaya_pinned_rooms')
      .then((v) => {
        try {
          const a = JSON.parse(v || '[]');
          if (Array.isArray(a)) setPinnedIds(a.map(String));
        } catch {}
      })
      .catch(() => {});
    if (!token) {
      setFollowedIds(new Set());
      return;
    }
    let alive = true;
    const trimmedToken = String(token || '').trim();
    setFollowedIds(peekFollowedIdsShared(trimmedToken));
    const offSub = subscribeFollowedIds((ids, tk) => {
      if (alive && tk === trimmedToken) setFollowedIds(ids);
    });

    void hydrateFollowedIdsShared(trimmedToken).then((cached) => {
      if (alive && cached.cached) setFollowedIds(new Set(cached.ids));
    });
    let deferTimer: ReturnType<typeof setTimeout> | null = null;
    const cancelDefer = () => {
      if (deferTimer) {
        clearTimeout(deferTimer);
        deferTimer = null;
      }
    };
    const loadFollowedIds = () => {
      lastFollowedIdsAtRef.current = Date.now();
      fetchFollowedIdsShared(trimmedToken)
        .then((ids) => {
          if (!alive) return;
          setFollowedIds(new Set(ids));
        })
        .catch(() => {});
    };
    const scheduleFollowedIds = () => {
      if (Date.now() - lastFollowedIdsAtRef.current < HOME_FOCUS_COOLDOWN_MS) return;
      cancelDefer();
      deferTimer = setTimeout(() => {
        deferTimer = null;
        if (alive && focusedRef.current && isAppForeground()) loadFollowedIds();
      }, HOME_FOCUS_DEFER_MS);
    };
    loadFollowedIds();
    const offFocus = navigation.addListener('focus', scheduleFollowedIds);
    const offBlur = navigation.addListener('blur', cancelDefer);
    const appSub = AppState.addEventListener('change', (next) => {
      if (next === 'active' && focusedRef.current) scheduleFollowedIds();
      else cancelDefer();
    });
    return () => {
      alive = false;
      offSub();
      cancelDefer();
      offFocus();
      offBlur();
      appSub.remove();
    };
  }, [navigation, token]);

  const fetchLives = useCallback(
    (options?: { authoritative?: boolean }) => {
      if (!focusedRef.current || !isAppForeground()) return;
      lastLivesAtRef.current = Date.now();
      const authoritative = !!options?.authoritative;

      if (!fetchedRef.current) {
        AsyncStorage.getItem(LIVES_CACHE_KEY)
          .then((raw) => {
            if (!raw || !focusedRef.current) return;
            try {
              const cached = JSON.parse(raw);
              if (Array.isArray(cached) && cached.length && !fetchedRef.current) {
                allLivesRef.current = cached;
                setLives(
                  sortLivesByPreference(cached, followedIds, pinnedIds, followedNames).slice(0, 8),
                );
                setLivesOk(true);
              }
            } catch {}
          })
          .catch(() => {});
      }
      withTimeout(fetchLiveListShared({ force: authoritative }), 10000)
        .then((res: any) => {
          if (!focusedRef.current || !isAppForeground()) return;
          if (!res) throw new Error('timeout');

          const rawList = (res?.content ?? res?.data ?? res)?.liveList;
          if (!Array.isArray(rawList)) throw new Error('live list empty shell');
          const allLives = normalizeLiveList(res);
          allLivesRef.current = allLives;
          const list = sortLivesByPreference(allLives, followedIds, pinnedIds, followedNames).slice(
            0,
            8,
          );

          const decision = decideLivesUpdate({
            prevCount: livesRef.current.length,
            rawLen: rawList.length,
            nextLen: list.length,
            emptyStreak: emptyStreakRef.current,
            authoritative,
          });
          emptyStreakRef.current = decision.emptyStreak;
          fetchedRef.current = true;
          setLivesOk(true);
          setLivesError('');
          livesRetryRef.current = 0;
          if (decision.action === 'replace') {
            setLives(list);
            AsyncStorage.setItem(LIVES_CACHE_KEY, JSON.stringify(list)).catch(() => {});
          } else if (decision.action === 'clear') {
            setLives([]);
            AsyncStorage.removeItem(LIVES_CACHE_KEY).catch(() => {});
          }
        })
        .catch((e: any) => {
          if (!focusedRef.current) return;

          if (livesRef.current.length === 0) {
            setLivesError(e?.message || String(e));
            if (livesRetryRef.current < 3) {
              livesRetryRef.current += 1;
              setTimeout(() => {
                if (!mountedRef.current || !focusedRef.current) return;
                if (isAppForeground()) fetchLives();
              }, 5000);
            }
          }
        });
    },
    [followedIds, pinnedIds, followedNames],
  );

  useEffect(() => {
    const base = allLivesRef.current.length ? allLivesRef.current : livesRef.current;
    const seen = new Set(base.map((it) => String(it.liveId)));
    const extra: LiveCardItem[] = discoveredLives
      .filter((it) => it.liveId && !seen.has(String(it.liveId)))
      .map((it) => ({
        liveId: String(it.liveId),
        title: it.title || it.nickname || '',
        nickname: it.nickname || '',
        cover: it.liveCover || it.coverPath || '',
        userId: String(it.userId || ''),
      }));
    const merged = extra.length ? [...base, ...extra] : base;
    if (merged.length) {
      setLives(sortLivesByPreference(merged, followedIds, pinnedIds, followedNames).slice(0, 8));
    }
  }, [discoveredLives, followedIds, pinnedIds, followedNames]);

  useEffect(() => {
    if (!showLive) return;
    let deferTimer: ReturnType<typeof setTimeout> | null = null;
    const cancelDefer = () => {
      if (deferTimer) {
        clearTimeout(deferTimer);
        deferTimer = null;
      }
    };
    const scheduleLives = (authoritative: boolean, delayMs: number) => {
      cancelDefer();
      deferTimer = setTimeout(() => {
        deferTimer = null;
        if (focusedRef.current && isAppForeground()) {
          fetchLives({ authoritative });
        }
      }, delayMs);
    };
    if (navigation.isFocused() && isAppForeground()) {
      focusedRef.current = true;
      if (!fetchedRef.current) fetchLives({ authoritative: true });
      else if (Date.now() - lastLivesAtRef.current >= HOME_FOCUS_COOLDOWN_MS) {
        scheduleLives(true, HOME_FOCUS_DEFER_MS);
      }
    }
    const id = setInterval(() => {
      if (focusedRef.current && isAppForeground()) fetchLives();
    }, 60 * 1000);
    const offFocus = navigation.addListener('focus', () => {
      focusedRef.current = true;
      if (!fetchedRef.current || Date.now() - lastLivesAtRef.current >= HOME_FOCUS_COOLDOWN_MS) {
        scheduleLives(true, HOME_FOCUS_DEFER_MS);
      }
    });
    const offBlur = navigation.addListener('blur', () => {
      focusedRef.current = false;
      cancelDefer();
    });
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && focusedRef.current) {
        if (Date.now() - lastLivesAtRef.current >= HOME_FOCUS_COOLDOWN_MS) {
          scheduleLives(false, HOME_FOCUS_DEFER_MS);
        }
      } else {
        cancelDefer();
      }
    });
    return () => {
      cancelDefer();
      clearInterval(id);
      offFocus();
      offBlur();
      sub.remove();
    };
  }, [fetchLives, navigation, showLive]);

  const bannerCount = Math.min(4, lives.length);

  const safeBannerIndex = bannerCount > 0 ? Math.min(bannerIndex, bannerCount - 1) : 0;
  useEffect(() => {
    if (bannerCount <= 1) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const startLoop = () => {
      if (timer || !focusedRef.current || !isAppForeground()) return;
      timer = setInterval(() => {
        if (!focusedRef.current || !isAppForeground() || bannerDraggingRef.current) return;
        setBannerIndex((i) => ((i < 0 ? 0 : Math.min(i, bannerCount - 1)) + 1) % bannerCount);
      }, 3200);
    };
    const stopLoop = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      if (bannerResumeTimerRef.current) {
        clearTimeout(bannerResumeTimerRef.current);
        bannerResumeTimerRef.current = null;
      }
      bannerDraggingRef.current = false;
    };
    if (navigation.isFocused() && isAppForeground()) startLoop();
    const offFocus = navigation.addListener('focus', startLoop);
    const offBlur = navigation.addListener('blur', stopLoop);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') startLoop();
      else stopLoop();
    });
    return () => {
      offFocus();
      offBlur();
      sub.remove();
      stopLoop();
    };
  }, [bannerCount, navigation]);

  useEffect(() => {
    if (bannerCount > 0) {
      setBannerIndex((i) => Math.min(i, bannerCount - 1));
    }
  }, [bannerCount]);

  const musicQueue = useMusicPlayerStore((s) => s.queue);
  const musicIndex = useMusicPlayerStore((s) => s.currentIndex);
  const musicPlaybackState = useMusicPlayerStore((s) => s.playbackState);
  const currentTrack = musicQueue[musicIndex] || null;

  const lyricsList = useMusicPlayerStore((s) => s.lyrics);
  const playbackForLyric = useMusicPlayerStore((s) => s.playbackState);
  const pausedPosForLyric = useMusicPlayerStore((s) =>
    s.playbackState === 'paused' ? s.position : 0,
  );
  const [lyricIdx, setLyricIdx] = useState(-1);
  const lyricAnchor = useRef({ pos: 0, at: Date.now(), last: -1 });

  useEffect(() => {
    if (!lyricsList.length || playbackForLyric === 'idle') {
      setLyricIdx(-1);
      return;
    }
    if (playbackForLyric !== 'playing' && playbackForLyric !== 'loading') {
      let lo = 0;
      let hi = lyricsList.length - 1;
      let hit = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (lyricsList[mid].time <= pausedPosForLyric) {
          hit = mid;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      setLyricIdx(hit);
      return;
    }
    let timer: ReturnType<typeof setInterval> | null = null;
    const tick = () => {
      if (!focusedRef.current || !isAppForeground()) return;
      const st = useMusicPlayerStore.getState();
      const list = st.lyrics;
      const pos = Number(st.position) || 0;
      const a = lyricAnchor.current;
      if (pos !== a.last) lyricAnchor.current = { pos, at: Date.now(), last: pos };
      const playing = st.playbackState === 'playing' || st.playbackState === 'loading';
      const anchorNow = lyricAnchor.current;
      const est = playing ? anchorNow.pos + (Date.now() - anchorNow.at) / 1000 : pos;
      const use = Math.max(pos, est);
      if (!list.length) {
        setLyricIdx((v) => (v === -1 ? v : -1));
        return;
      }
      let lo = 0;
      let hi = list.length - 1;
      let hit = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (list[mid].time <= use) {
          hit = mid;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      setLyricIdx((v) => (v === hit ? v : hit));
    };
    const startTicker = () => {
      if (!focusedRef.current || !isAppForeground()) return;
      tick();
      if (!timer) timer = setInterval(tick, 1000);
    };
    const stopTicker = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };
    if (navigation.isFocused() && isAppForeground()) startTicker();
    const offFocus = navigation.addListener('focus', startTicker);
    const offBlur = navigation.addListener('blur', stopTicker);
    const appSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') startTicker();
      else stopTicker();
    });
    return () => {
      offFocus();
      offBlur();
      appSub.remove();
      stopTicker();
    };
  }, [lyricsList, playbackForLyric, pausedPosForLyric, navigation]);

  const lyricLine = lyricIdx >= 0 ? lyricsList[lyricIdx]?.text || '' : '';

  const handleNav = useCallback(
    (item: NavItem) => {
      if (item.params) (navigation as any).navigate(item.route, item.params);
      else (navigation as any).navigate(item.route);
    },
    [navigation],
  );

  const openMusicLibrary = useCallback(() => {
    handleNav({ title: '', desc: '', route: 'MusicLibraryScreen', icon: '' });
  }, [handleNav]);

  const openMusicPlayer = useCallback(() => {
    useMusicPlayerStore.getState().openFullScreen('none');
  }, []);

  const handleMusicPrev = useCallback(() => {
    void MusicEngine.prev();
  }, []);
  const handleMusicNext = useCallback(() => {
    void MusicEngine.next();
  }, []);
  const handleMusicToggle = useCallback(() => {
    const s = useMusicPlayerStore.getState();
    if (!s.queue[s.currentIndex]) return;
    if (s.playbackState === 'idle') {
      void MusicEngine.resume().catch(() => {});
      return;
    }
    MusicEngine.togglePause();
  }, []);

  const handleStopMusic = useCallback(() => {
    const s = useMusicPlayerStore.getState();
    if (!s.queue.length || s.playbackState === 'idle') return;

    MusicEngine.stop();
  }, []);

  const hour = new Date().getHours();
  const greeting =
    hour < 5
      ? t('夜深了')
      : hour < 11
        ? t('早上好')
        : hour < 14
          ? t('中午好')
          : hour < 18
            ? t('下午好')
            : t('晚上好');

  const quick = QUICK.map((i) => ({ ...i, title: t(i.title) }));

  useEffect(() => {
    if (!token || settings.yaya_pm_unread_badge === false) {
      pmUnreadTokenRef.current = '';
      setPmUnread(0);
      return;
    }
    if (pmUnreadTokenRef.current !== token) {
      pmUnreadTokenRef.current = token;
      setPmUnread(0);
    }
    let alive = true;
    let fetching = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    let deferTimer: ReturnType<typeof setTimeout> | null = null;
    const cancelDefer = () => {
      if (deferTimer) {
        clearTimeout(deferTimer);
        deferTimer = null;
      }
    };
    const refreshUnread = () => {
      if (!alive || fetching || !focusedRef.current || !isAppForeground()) return;
      fetching = true;
      lastUnreadAtRef.current = Date.now();
      Promise.allSettled([
        pocketApi.getPrivateMessageList(Date.now()),
        pocketApi.getUnreadMessageCount(),
      ])
        .then(([listSettled, numSettled]) => {
          if (!alive) return;
          if (listSettled.status === 'fulfilled') {
            const list = unwrapList(listSettled.value, [
              'content.userMessageList',
              'content.list',
              'content.data',
              'data.userMessageList',
              'userMessageList',
              'list',
            ]);
            const listUnread = sumPrivateConversationUnread(list);
            if (listUnread !== null) {
              setPmUnread(listUnread);
              return;
            }
          }
          if (numSettled.status === 'fulfilled') {
            const count = privateUnreadCount(numSettled.value);
            if (count !== null) setPmUnread(count);
          }
        })
        .catch(() => {})
        .finally(() => {
          fetching = false;
        });
    };
    const scheduleUnread = () => {
      if (Date.now() - lastUnreadAtRef.current < HOME_FOCUS_COOLDOWN_MS) return;
      cancelDefer();
      deferTimer = setTimeout(() => {
        deferTimer = null;
        refreshUnread();
      }, 320);
    };
    const startPolling = () => {
      if (!alive || timer) return;
      timer = setInterval(refreshUnread, 60000);
    };
    const stopPolling = () => {
      cancelDefer();
      if (!timer) return;
      clearInterval(timer);
      timer = null;
    };
    if (navigation.isFocused() && isAppForeground()) {
      refreshUnread();
      startPolling();
    }
    const offFocus = navigation.addListener('focus', () => {
      scheduleUnread();
      startPolling();
    });
    const offBlur = navigation.addListener('blur', stopPolling);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && focusedRef.current) {
        scheduleUnread();
        startPolling();
      } else {
        stopPolling();
      }
    });
    return () => {
      alive = false;
      stopPolling();
      offFocus();
      offBlur();
      sub.remove();
    };
  }, [navigation, token, settings.yaya_pm_unread_badge, setPmUnread]);
  const toolChips = useMemo(() => TOOL_CHIPS.map((i) => ({ ...i, title: t(i.title) })), [t]);

  const trackTitle = currentTrack?.title || '';
  const trackArtist = currentTrack?.artist || currentTrack?.joinMemberNames || '';

  const resumeLabel =
    musicPlaybackState === 'playing'
      ? t('播放中')
      : musicPlaybackState === 'loading'
        ? t('加载中')
        : t('继续播放');

  const openLive = useCallback(
    (item: LiveCardItem) => {
      (navigation as any).navigate('Media', {
        mode: 'live',
        playLiveId: item.liveId,
        playTitle: item.title,
        playCover: item.cover,
        playNonce: Date.now(),
      });
    },
    [navigation],
  );

  const openGongyanAll = useCallback(() => {
    handleNav({ title: '', desc: '', route: 'BilibiliLiveScreen', icon: '' });
  }, [handleNav]);
  const openGongyanRoom = useCallback(
    (room: BilibiliLiveRoom) => {
      (navigation as any).navigate('BilibiliLiveScreen', {
        roomId: room.roomId,
        roomName: room.name,
      });
    },
    [navigation],
  );

  const headerOffset = getFloatingHeaderOffset(insets.top);

  return (
    <View style={[styles.outer, { backgroundColor: getPageBackground() }]}>
      <FloatingTabHeader
        left={
          <View style={styles.headerBrandRow}>
            <Text style={[styles.headerBrandTitle, { color: palette.label }]} numberOfLines={1}>
              {t('牙牙消息')}
            </Text>
            <View style={[styles.headerBrandDivider, { backgroundColor: palette.separator }]} />
            <Text
              style={[styles.headerBrandSub, { color: palette.labelSecondary }]}
              numberOfLines={1}
            >
              {greeting}
            </Text>
          </View>
        }
        right={
          <>
            <FloatingHeaderAction
              icon="email-outline"
              badge={settings.yaya_pm_unread_badge !== false && pmUnread > 0 ? pmUnread : false}
              accessibilityLabel={t('私信')}
              onPress={() =>
                handleNav({ title: '', desc: '', route: 'PrivateMessagesScreen', icon: '' })
              }
            />
            <FloatingHeaderAction
              icon="account-outline"
              avatarUri={account?.avatar}
              badge={!token}
              accessibilityLabel={account?.name ? `${t('账号')} · ${account.name}` : t('账号')}
              onPress={() => handleNav({ title: '', desc: '', route: 'LoginScreen', icon: '' })}
            />
          </>
        }
      />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingTop: headerOffset,

          paddingBottom: 92 + insets.bottom,
        }}
        showsVerticalScrollIndicator={false}
      >
        {!token ? (
          <View style={{ paddingHorizontal: spacing.md }}>
            <ScalePressable
              style={{ marginBottom: spacing.xl }}
              onPress={() => handleNav({ title: '', desc: '', route: 'LoginScreen', icon: '' })}
              pressedScale={0.98}
            >
              <GlassCard strong padding={14} radius={20} style={{ borderColor: palette.danger }}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <View style={[styles.loginBadge, { backgroundColor: palette.tintSoft }]}>
                    <MaterialCommunityIcons name="key-variant" color={palette.tint} size={20} />
                  </View>
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={[typography.headline, { color: palette.label }]}>
                      {t('未登录口袋账号')}
                    </Text>
                    <Text
                      style={[
                        typography.footnote,
                        { color: palette.labelSecondary, marginTop: 3, lineHeight: 18 },
                      ]}
                    >
                      {t('消息、私信、翻牌需要登录；点此粘贴 token')}
                    </Text>
                  </View>
                  <MaterialCommunityIcons
                    name="chevron-right"
                    color={palette.labelTertiary}
                    size={20}
                  />
                </View>
              </GlassCard>
            </ScalePressable>
          </View>
        ) : null}

        {order.map((mod) => {
          switch (mod.key) {
            case 'live':
              return (
                <LiveModule
                  key={mod.key}
                  lives={lives}
                  livesOk={livesOk}
                  livesError={livesError}
                  bannerCount={bannerCount}
                  safeBannerIndex={safeBannerIndex}
                  onRetry={fetchLives}
                  onPressAll={() => handleNav({ title: '', desc: '', route: 'Media', icon: '' })}
                  onPressLive={openLive}
                  onSelectBanner={setBannerIndex}
                  onBannerDragChange={handleBannerDragChange}
                />
              );
            case 'performances':
              return (
                <PerformancesModule
                  key={mod.key}
                  gongyanOk={gongyanOk}
                  gongyanError={gongyanError}
                  liveRooms={liveGongyanRooms}
                  gongyanInfo={gongyanInfo}
                  onRetry={() => {
                    setGongyanError('');
                    fetchGongyanStatus();
                  }}
                  onPressAll={openGongyanAll}
                  onPressRoom={openGongyanRoom}
                />
              );
            case 'quick':
              return (
                <QuickModule
                  key={mod.key}
                  quick={quick}
                  quickCellW={quickCellW}
                  pmUnread={pmUnread}
                  showPmBadge={settings.yaya_pm_unread_badge !== false}
                  onPressItem={handleNav}
                />
              );
            case 'resume':
              return (
                <ResumeModule
                  key={mod.key}
                  currentTrack={currentTrack}
                  trackTitle={trackTitle}
                  trackArtist={trackArtist}
                  resumeLabel={resumeLabel}
                  lyricLine={lyricLine}
                  playbackState={musicPlaybackState}
                  onOpenPlayer={openMusicPlayer}
                  onOpenLibrary={openMusicLibrary}
                  onPrev={handleMusicPrev}
                  onNext={handleMusicNext}
                  onToggle={handleMusicToggle}
                  onStop={handleStopMusic}
                />
              );
            case 'tools':
              return (
                <ToolsModule
                  key={mod.key}
                  toolChips={toolChips}
                  quickCellW={quickCellW}
                  onPressItem={handleNav}
                />
              );
            default:
              return null;
          }
        })}

        <Text
          style={[
            typography.caption1,
            {
              color: palette.labelTertiary,
              textAlign: 'center',
              marginTop: spacing.xl,
              marginBottom: 24,
            },
          ]}
        >
          {t('Presented by Xenia')}
        </Text>
      </ScrollView>
    </View>
  );
}
