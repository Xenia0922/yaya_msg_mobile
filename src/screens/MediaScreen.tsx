import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { setPipPlaying, setPipAspectLive } from '../utils/pip';
import { useMiniPlayerStore } from '../store/miniPlayerStore';
import ScreenHeader from '../components/ScreenHeader';
import { VODItem, Member } from '../types';
import { formatTimestamp, formatDuration } from '../utils/format';
import { errorMessage, normalizeUrl, pickText, unwrapList } from '../utils/data';
import { normalizeGiftList } from '../utils/giftList';
import { thumbUrl } from '../utils/imageThumb';
import { getResumePosition, saveResumePosition } from '../utils/resumePosition';
import { logInfo, logWarn } from '../utils/runtimeLog';
import pocketApi from '../api/pocket48';
import { setLiveImmersiveMode } from '../native/LivePlayer';
// 流形态判定统一走 src/player/resolve/streamResolver（与本地旧实现逐字一致 → 零行为变化）
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
import { usePalette } from '../theme';
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
import { GlassSurface } from '../components/GlassSurface';
import { GlassSegmented, GlassSegmentedScroll } from '../components/GlassSegmented';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { UserProfileSheet, type UserProfileTarget } from '../components/UserProfileSheet';
import { ListBottomSpacer } from '../components/ListBottomSpacer';

/** 回放列表加载占位：居中低调研度指示，无微光闪烁，避免「转圈 + 文字」混排打架 */
type MediaRouteProp = RouteProp<TabParamList, 'Media'>;

const MEDIA_GROUPS: { label: string; id: number; match: string }[] = [
  { label: '全部', id: 0, match: '' },
  { label: 'SNH48', id: 1, match: 'SNH48' },
  { label: 'BEJ48', id: 2, match: 'BEJ48' },
  { label: 'GNZ48', id: 3, match: 'GNZ48' },
  { label: 'CKG48', id: 4, match: 'CKG48' },
  { label: 'CGT48', id: 6, match: 'CGT48' },
];

/** 关注昵称归一化：直播接口常带 SNH48-/GNZ48- 前缀，成员库 ownerName 不带。 */
function normalizeFollowName(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^(?:snh48|gnz48|bej48|ckg48|cgt48)[-_ ]/i, '');
}

/**
 * 网格封面缩略图请求边长（px）。
 *
 * 双列网格每卡宽度 ≈ (360dp - 16) / 2 - 8 ≈ 164dp；480dpi 机型上约 492 物理像素，
 * 取 700 留出余量（服务端按原图比例 contain，`resizeMode="cover"` 再裁切，
 * 不会变形也不会糊）。对比原图（828×1104 / 783KB）体积降到约 1/17。
 */
/** 直播中呼吸红点（Animated + native driver） */
function LivePulseDot({ size = 7 }: { size?: number }) {
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.35, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return (
    <Animated.View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: '#ff4d4f',
        marginRight: 4,
        opacity: pulse,
      }}
    />
  );
}

/** 回放/直播列表首屏骨架：banner 块 + 2 列网格块 */
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

/** 播放器公告是否收起（'1'=收起）：跨直播间/跨启动记忆（用户要求） */
const PLAYER_ANNOUNCE_COLLAPSED_KEY = 'yaya_player_announce_collapsed_v1';
/** 直播公告内存缓存：小窗/PiP 返回时先恢复再后台刷新，避免公告丢失 */
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
  // 只统计“参数错误”的连续次数；合法空列表（liveList: []）必须立即呈现为空。
  const liveParamErrorStreakRef = useRef(0);
  const [loading, setLoading] = useState(false);
  const [, setRefreshing] = useState(false);
  const [, setNextCursor] = useState(0);
  const nextCursorRef = useRef(0); // 翻页游标 ref：避免自动翻页闭包读到旧游标重复拉同一页
  const [pageVersion, setPageVersion] = useState(0); // 每次拉取完成 +1：驱动自动翻页 effect 续链
  const [error, setError] = useState('');
  const [playerError, setPlayerError] = useState('');
  const [, setUseWebPlayer] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  // 横屏/竖屏切换（仅旋转，独立于「全屏」沉浸；方向锁由下方统一 effect 处理）
  const [isLandscape, setIsLandscape] = useState(false);
  // 画面旋转（翻转）：0/90/180/270，每按一次步进 90°
  const [, setVideoRotate] = useState(0);
  // 用户是否手动切过方向：手动后 onLoad 不再自动覆盖（尊重用户选择）
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
  /** 直播结束总结页（直播结束/播放内核报错时显示） */
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
  /**
   * 直播弹幕（云信聊天室）—— 全页唯一一条连接：
   * - 接收：推给 DanmakuOverlay 的 liveItems，直接飘在画面上
   * - 发送：播放器底部的弹幕输入条（同一 source，不重复建连）
   * 录播不受影响（走 danmaku + currentTime 时间轴）。
   */
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
  /**
   * 全屏礼物特效（仅直播页）：PRESENT_FULLSCREEN(_TWO) 消息带 zipPath 时播 PAG 动画。
   * 别人送的与自己送的都走这条（服务端广播会回投给发送者）；按 item.id 去重防重播。
   */
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
  // 离开直播间清队列，避免下一场开播播上一场的特效
  useEffect(
    () => () => {
      clearGiftEffectQueue();
    },
    [],
  );

  // 修复「直播弹幕不飘屏」：showDanmaku 此前只由 HTTP 轮询打开，
  // 原生云信通道有弹幕也不会飘 —— 云信一到货就自动打开飘屏。
  useEffect(() => {
    if (liveBarrage.items.length) setShowDanmaku(true);
  }, [liveBarrage.items.length]);
  // 直播输入条已并入播放器底坞（随控制条自动隐藏），不再需要单独的收起状态
  // 续播位置：打开回放时读取上次进度，播放中由 WebView 回传进度落盘
  const [webResumeTime, setWebResumeTime] = useState(0);
  const [giftVisible, setGiftVisible] = useState(false);
  const [gifts, setGifts] = useState<any[]>([]);
  const [selectedGift, setSelectedGift] = useState<any | null>(null);
  const [giftNum, setGiftNum] = useState('1');
  /** 送礼在途：无此锁时连点「送出」会并发发多次请求 —— 真实重复扣鸡腿 */
  const [giftSending, setGiftSending] = useState(false);
  const [giftStatus, setGiftStatus] = useState('');
  const [balance, setBalance] = useState('');
  const [hasMore, setHasMore] = useState(true);
  const [rankVisible, setRankVisible] = useState(false);
  const [rankRows, setRankRows] = useState<any[]>([]);
  /** 贡献榜点某一行 → 用户资料卡（与弹幕发送者同一套） */
  const [rankProfile, setRankProfile] = useState<UserProfileTarget | null>(null);

  // 续播 key 用稳定 id（liveId）而非播放 URL：URL 换线路/带签名/拼接参数会变，
  // 用 URL 做 key 会导致同一视频换线路后续播进度丢失
  const resumeKey = React.useMemo(
    () => String(playing?.item?.liveId || playing?.item?.id || playing?.url || ''),
    [playing],
  );

  // 打开回放时读取上次观看进度，用于 WebView 续播
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

  // 拉取/轮询弹幕并解析；失败静默，不拖垮播放
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
      // 时间轴归一化：覆盖接口返回的多种 time 形态，保证弹幕能对上视频相对进度飘出来
      // 1) 毫秒时间戳（>1e6）：先转秒
      // 2) 绝对秒时间戳（>1e7，远超任何视频时长）：以最早弹幕为 0 做相对偏移
      // 3) 全 0 / 异常（maxT<=0）：按序均匀分配，至少保证弹幕能飘
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
      // 直播：轮询 barrage/list 累积实时弹幕
      // 功耗：后台/页面失焦时暂停（画面不可见时拉了也白拉），回前台立即补一次
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
      // 初始与前后台切换：前台+页面聚焦才轮询
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
    // content.msgFilePath 指向的 LRC 文件，而非 barrage/list；格式 [hh:mm:ss.fff]昵称\t内容，
    // 已由 parseDanmaku 解析为「秒」对上 playbackTime）
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

  // R1: 弹幕时间轴统一由 playerStore.position 驱动（统一播放器接管后原生 onProgress 实时上报，
  // 无需本地插值；旧 useWebPlayer 插值路径已随内核切换删除）
  const [rankStatus, setRankStatus] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const [announceVisible, setAnnounceVisible] = useState(false);
  /** 进入直播间默认展开公告（用户要求）。关闭后停留本次会话，不再自动弹回 */
  /**
   * 公告展开态：**记住收起状态**（用户要求）。挂载时从 AsyncStorage 读一次；
   * 收起/展开即时写回；新开播不再强制展开（否则记住的收起被打回）。
   */
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
  /** 本次进入是否已自动展开过（避免用户手动收起后被自动展开逻辑again弹开） */
  const announceAutoShownRef = useRef(false);
  const loadingRef = useRef(false);
  const playingRef = useRef<typeof playing>(null);
  // v2.6: group filter + search
  const [groupId, setGroupId] = useState(0);
  const [search, setSearch] = useState('');
  // 弹幕：解析后的弹幕数组 + 是否显示 + 当前播放进度（驱动弹幕发射）
  const [danmaku, setDanmaku] = useState<DanmakuItem[]>([]);
  const [showDanmaku, setShowDanmaku] = useState(false);
  // 关注成员 id 集合：「关注」tag 实时筛选（60s 同步一次）
  const [followedIds, setFollowedIds] = useState<Set<string>>(new Set());
  const [followedIdsReady, setFollowedIdsReady] = useState(false);
  const danmakuClock = usePlayerStore((s) => s.position);
  // 播放器控制（哔哩哔哩风格自定义控制条）
  const [, setDuration] = useState(0);
  const [paused, setPaused] = useState(false);

  // ⚠️ 此处**不再写 PiP 标志**（修复）：统一播放器重写后媒体状态以 playerStore.state 为准，
  // 本页的 paused 是死状态（全页只有一处 setPaused(false)），用它判定会出现「已暂停、按 Home 仍进悬浮窗」，
  // 且该写入会覆盖 FullscreenManager 的正确结果（PiP 标志原本有 3 个写入点互相打架）。
  // PiP 唯一权威源 = FullscreenManager（依据 playerStore.state==='playing' && !fullscreen）。
  // 搜索：选中成员后，搜索框转为「该成员的标题/日期」过滤
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [dateFilter, setDateFilter] = useState<Date | null>(null);
  const [showCalendar, setShowCalendar] = useState(false);
  const [showDanmakuSettings, setShowDanmakuSettings] = useState(false);

  const [showDanmakuList, setShowDanmakuList] = useState(false);
  /** 弹幕列表点发送者 → 用户资料卡（成员/粉丝同一个界面） */
  const [danmakuProfile, setDanmakuProfile] = useState<UserProfileTarget | null>(null);
  const danmakuListEntries = useMemo<DanmakuListEntry[]>(() => {
    if (playing?.isLive) {
      return liveBarrage.items.map((item) => ({
        id: item.id,
        time: 0,
        nick: item.nick || '',
        text: item.text || '',
        kind: item.kind,
        // 直播弹幕带发送者口袋 userId → 弹幕列表点昵称可直接查资料
        userId: item.userId || undefined,
        avatar: item.avatar || undefined,
      }));
    }
    // 录播：danmaku 由 parseDanmaku 保证按时间升序
    return danmaku.map((item, index) => ({
      id: `dm-${index}-${item.time}`,
      time: item.time,
      nick: item.nick || '',
      text: item.text,
      userId: item.userId,
      avatar: item.avatar,
    }));
  }, [playing?.isLive, liveBarrage.items, danmaku]);
  // 播放器控制条（B站式沉浸：点击视频区显隐，播放中自动隐藏）
  const [, setControlsVisible] = useState(true);
  const controlsOpacity = useRef(new Animated.Value(1)).current;
  // 公告始终位于播放器顶栏下方；播放器控制层自行显隐，不再用页面的旧动画状态推算位置。
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
  // 新视频载入即显示控制条，播放中 3 秒无操作自动隐藏（B站式沉浸）
  useEffect(() => {
    if (playing?.url) showControls(true);
  }, [playing?.url, showControls]);

  // 分组 chips：最前面加「关注」（id=-1，按关注成员 id 过滤）
  const groupChips: { label: string; id: number; match: string }[] = [
    { label: t('关注'), id: -1, match: '' },
    ...MEDIA_GROUPS,
  ];
  // 关注成员的昵称集合：录播/直播接口字段不一，id 匹配不到时按昵称兜底（大小写不敏感、去空白）
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
    let raw = tab === 'live' ? liveList : vodList;
    // 关注筛选：命中关注成员 id 或昵称 的在播直播/录播（id 字段因接口而异，昵称兜底保证录播也能打通）
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
    // 选中成员时数据已在服务端按 userId 直查（见 doFetch），此处无需内存筛选；
    // 保留 selectedMember 依赖以在成员切换时触发重算（raw 源 vodList 已换为成员数据）。
    // 日历日期筛选：按录制日期(YYYY-MM-DD)精确过滤
    if (dateFilter) {
      const key = dateKeyOf(dateFilter);
      raw = raw.filter((item: any) => dateKeyOf(item.startTime) === key);
    }
    if (!search.trim()) return raw;
    const q = search.trim().toLowerCase();
    const qDigits = q.replace(/[^0-9]/g, '');
    return raw.filter((item) => {
      const { text, digits } = buildMediaSearchText(item);
      // 数字优先：时间搜索（/ 0720 / 7-20 / 2026/7/20 等自然输入都能命中）
      if (qDigits.length >= 3 && digits.includes(qDigits)) return true;
      if (text.includes(q)) return true;
      return false;
    });
  }, [tab, liveList, vodList, search, groupId, dateFilter, followedIds, followedNames]);

  // 录播按日期分组（今天/昨天/更早），live tab 不用
  const vodRows = useMemo(() => {
    if (tab !== 'vod') return null;
    // 纯网格：不再按「今天/昨天/更早」分组（接口 startTime 为字符串毫秒，日期分组易出错），
    // 时间直接显示在卡片内（带年份、缩小字体适配），列表按时间倒序连续排列
    const flat: { type: 'header' | 'row'; key: string; title?: string; left?: any; right?: any }[] =
      [];
    for (let i = 0; i < list.length; i += 2) {
      flat.push({ type: 'row', key: `r-${i}`, left: list[i], right: list[i + 1] });
    }
    return flat;
  }, [tab, list]);

  // 成员联想：未选成员时，输入命中成员名/缩写则弹出选择框
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

  // v2.6: auto-play when navigated from room with playLiveId/playUrl
  useEffect(() => {
    const lid = routeParamsRef.current?.playLiveId;
    const directUrl = routeParamsRef.current?.playUrl;
    if (!lid && !directUrl) return;
    const request = ++playRequestRef.current;
    const isLive = routeParamsRef.current?.mode !== 'vod';
    (async () => {
      try {
        if (directUrl) {
          // 房间页已解析出可用地址：直接播放，不再二次请求接口
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
            // 大小窗切换续播：小窗回传 playPosition
            position: Number(routeParamsRef.current?.playPosition) || 0,
          });
          // 从房间直链进入（房间只传 playUrl/playLiveId）：公告也必须拉一次
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
        // 点击即进播放器：先以「解析中」状态渲染播放器 shell，解析完成后无缝播放；
        // 失败在播放器内提示（含重试），不再停留在列表页干等或弹窗
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
        // 解析：详情接口 → 公开详情 → 直播/录播列表按 liveId 查找（多层兜底）
        let detail: any = await pocketApi.getLiveOne(lid).catch(() => null);
        if (request !== playRequestRef.current) return;
        if (!detail) detail = await pocketApi.getOpenLiveOne(lid).catch(() => null);
        if (request !== playRequestRef.current) return;
        const item = (detail?.content || detail?.data || detail || {}) as any;
        // ⚠️【公告修复】这条链路（首页/房间卡片直进播放器）以前只解析播放地址，
        // 从不读 announcement → 只有「在列表里点」才看得到公告。
        // 这里补一次设置（与 startPlay 同判定，含 getOpenLiveOne 兜底）。
        const annText = String(item?.announcement || '').trim();
        if (annText) {
          setAnnouncement(annText);
          setAnnounceVisible(true);
          setAnnounceExpandedPersisted(true);
          announceAutoShownRef.current = true;
        } else {
          // getLiveOne 没拿到 → 用公开详情兜底再试一次（上面 detail 可能是 getLiveOne 的结果）
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
        // Switch tab to match mode
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
      // ⚠️ 失焦的 tab 页仍持有 BackHandler 订阅（bottom-tabs 不卸载页面），
      // 不自行判断焦点会抢走当前页的返回键、关掉后台页面状态（修复）
      if (!navigation.isFocused()) return false;
      if (!playing) return false;
      // 返回键的第一预期行为是收键盘（弹幕输入中）
      if (Keyboard.isVisible()) {
        Keyboard.dismiss();
        return true;
      }
      playRequestRef.current += 1;
      // 中断解析中的请求后必须显式复位 loading：startPlay 的 finally 只在请求号未变时
      // setLoading(false)，取消后请求号已递增 → 永不复位 → 列表一直卡在骨架屏、上拉也失效。
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
        // 需先发一次不带 userId 的请求取列表最新 liveId 作为 next，再按成员直查。
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
        // 空壳防护：官方接口偶发 success/200 但缺 liveList 字段（限流/风控/异常）→
        // normalizeLiveList 会解出空数组，把"有直播/录播"误覆盖成"暂无数据"（用户可感知的概率性空态）。
        // 结构里确实没有 liveList 数组视为请求异常（抛错走 catch 保留旧列表）；仅真为 [] 才落空。
        const shellList = (res?.content ?? res?.data ?? res)?.liveList;
        if (!Array.isArray(shellList)) throw new Error('直播列表参数错误：缺少 liveList');
        const next = normalizeLiveList(res);
        // 正常拿到 liveList（包括合法的 []）就清零参数错误计数。
        liveParamErrorStreakRef.current = 0;
        const nextToken =
          Number(
            (res as any)?.content?.next ?? (res as any)?.data?.next ?? (res as any)?.next ?? 0,
          ) || 0;
        setNextCursor(nextToken);
        nextCursorRef.current = nextToken; // 同步 ref：翻页用最新游标，避免闭包读到旧值重复拉同一页
        // 翻页终止条件：本页有数据 且 游标确有前进（nextToken>0 且不等于本次请求的 cursor）。
        // 加 `nextToken !== cursor` 兜底，防止接口返回不变游标却持续吐相同数据导致的死循环。
        setHasMore(next.length > 0 && nextToken > 0 && nextToken !== cursor);
        // 注意：liveList 合法返回 [] 表示当前确实没有直播，立即清空；
        // 参数错误/空壳在 catch 里保留旧列表，不能用“空响应次数”误伤正常空态。
        if (mode === 'live')
          setLiveList((prev) => (append ? mergeUniqueLiveItems(prev, next) : next));
        else setVodList((prev) => (append ? mergeUniqueLiveItems(prev, next) : next));
      } catch (err) {
        // 静默轮询失败（60s 自动刷新）不弹错误条：保留旧列表继续展示，下一轮自愈；
        // 仅首屏/下拉/切 tab（silent=false）失败才提示（列表为空时不会误显示"暂无数据"）。
        const message = errorMessage(err);
        if (/参数|param|invalid|illegal|400|422|缺少|必填/i.test(message)) {
          liveParamErrorStreakRef.current += 1;
          // 参数错误连续 7 次仍保留旧列表；由下一轮继续重试，绝不把已有直播清空。
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
        if (!silent) setLoading(false);
        setRefreshing(false);
        setPageVersion((v) => v + 1); // 通知自动翻页 effect：本次拉取完成，可继续下一页
      }
    },
    [],
  ); // stable ref, reads groupId from groupIdRef

  const reloadList = useCallback(() => {
    // 刷新时保留当前列表内容，避免列表被清空导致骨架屏闪一下；
    // 仅当列表本就为空（首屏）时才走骨架屏逻辑。
    setNextCursor(0);
    setHasMore(true);
    doFetch(tab, 0);
  }, [doFetch, tab]);

  // initial load：只在 Media tab 真正聚焦时拉，避免启动阶段预挂载 tab 在后台抢网络/JS。
  useFocusEffect(
    useCallback(() => {
      doFetch(tab, 0);
    }, [doFetch, tab]),
  );

  // 选中成员时切到「回放」并重置列表，立即触发首屏加载。
  // 用 setTimeout(0) 让上面的 setState 先提交，避免读到切换前的旧 tab；
  // 覆盖「已在 vod tab 时初始加载 effect 不触发」以及「切 tab 时 loadingRef 把自动翻页挡掉」两种情况。
  // 完整直播/录播，替代「全量加载全局列表再前端筛选」——旧实现只能筛到已加载页面内的数据，
  // 成员较早的录播永远搜不到。
  useEffect(() => {
    if (!selectedMember) return;
    const mid = String(
      selectedMember.id || (selectedMember as any).userId || (selectedMember as any).memberId || '',
    );
    setVodList([]);
    setNextCursor(0);
    setHasMore(true);
    setTab('vod');
    const id = setTimeout(() => doFetch('vod', 0, false, false, mid), 0);
    return () => clearTimeout(id);
  }, [selectedMember, doFetch]);

  // 退出成员筛选（selectedMember 清空）时恢复全局录播列表：成员模式下 vodList 存的是该成员数据，
  // 不恢复会导致后续「全部/团/关注」看到的是残留的成员列表。
  const prevMemberRef = useRef<any>(null);
  useEffect(() => {
    if (prevMemberRef.current && !selectedMember && tab === 'vod') {
      setVodList([]);
      setNextCursor(0);
      setHasMore(true);
      doFetch('vod', 0);
    }
    prevMemberRef.current = selectedMember;
  }, [selectedMember, doFetch, tab]);

  // 搜索 / 选中成员 / 「关注」tag：自动翻页补齐更多数据（关注录播常分散在多页，只加载首屏会找不到）
  // 未筛选时（无搜索、无成员、非关注）不自动翻页，仅靠用户上滑 onEndReached 触发。
  const filterPages = useRef(0);
  const loadMoreRef = useRef<(silent?: boolean) => void>(() => {});
  // 并行翻页可用性（state 驱动：false 时本 effect 接管游标链）
  const [pageModeOk, setPageModeOk] = useState<boolean | null>(null);
  useEffect(() => {
    if (loadingRef.current || loading) return;
    const haveFilter = !!search.trim() || !!selectedMember || groupId === -1;
    if (!haveFilter || !hasMore) return;
    if (selectedMember && tab !== 'vod') return; // 成员检索固定在录播页，等 tab 切到 vod 再翻
    // 「关注」录播：并行扫描进行中不重复走游标链；扫描完成后从最深处继续兜底补更老录播
    if (groupId === -1 && tab === 'vod' && pageModeOk !== false && !scanDoneRef.current) return;
    // 「关注」tag 翻页上限：最多补 60 页（1200 条），覆盖被新录播挤到深处的关注成员；静默加载不闪控件
    if (groupId === -1) {
      if (filterPages.current >= 60) return;
      filterPages.current += 1;
    }
    const id = setTimeout(() => loadMoreRef.current(groupId === -1), 60);
    return () => clearTimeout(id);
  }, [search, selectedMember, hasMore, loading, tab, groupId, pageVersion, pageModeOk]);

  // 筛选条件变化时重置翻页计数
  useEffect(() => {
    filterPages.current = 0;
  }, [search, selectedMember, groupId]);

  // 「关注」录播快速并行扫描：
  // 实测口袋 getLiveList 的游标 = 上一页最后一条的 liveId，且 liveId 随时间近似线性增长（约 2^22/ms），
  // 因此可按「时间分片」一次性并行拉取近 48 小时的录播（每片约一页），再以相邻真实边界的中点闭合间隙；
  // 游标不可跳（探针失败）时自动退回上面的游标链。
  const followLoadingRef = useRef(false);
  const [followFetching, setFollowFetching] = useState(false);
  const scanDoneRef = useRef(false);
  // 关注成员录播：并发按 userId 服务端直查（用户指定实现）——
  // 不再"扫描全局流 48h 再前端筛选"（慢且命中率低），直接对每个关注成员的 userId 调
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
      // 1) 关注成员 id 列表
      const idsRes = await pocketApi.getFollowedIds().catch(() => null);
      const ids = idsRes
        ? unwrapList(idsRes, ['content.data', 'content', 'data', 'list']).map(String)
        : [];
      // 2) 从成员库提取关注成员 userId（多候选：id/userId/memberId）
      const userIds: string[] = [];
      const seen = new Set<string>();
      for (const m of members) {
        const mid = String((m as any).id || (m as any).userId || (m as any).memberId || '');
        if (mid && ids.includes(mid) && !seen.has(mid)) {
          seen.add(mid);
          userIds.push(mid);
        }
      }
      // 3) 并发按 userId 直查（每批 8 并发，防瞬间打爆接口）
      if (!userIds.length) {
        // 关注列表为空/未匹配到成员：兜底拉全局最新一页，避免"暂无"误导
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

  // 进入「关注」录播视图或下拉刷新后触发并行扫描
  const [refreshTick, setRefreshTick] = useState(0);
  useEffect(() => {
    if (groupId === -1 && tab === 'vod' && token) {
      scanDoneRef.current = false;
      loadFollowVodFast();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, tab, refreshTick]);

  // 关注成员 id 同步（聚焦立即拉一次 + 60s 一次；state 声明在组件上部供「关注」tag 筛选使用）
  useEffect(() => {
    let alive = true;
    // 本地缓存先出：关注筛选不应等网络，缓存命中时首帧就能筛出关注直播。
    void readFollowedIdsCache(token).then((cached) => {
      if (!alive || !cached.cached) return;
      setFollowedIds(new Set(cached.ids));
      setFollowedIdsReady(true);
    });
    const load = () => {
      // 退后台/失焦时不发请求（修复：此前锁屏仍每 60s 拉一次）
      if (AppState.currentState !== 'active' || !navigation.isFocused()) return;
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
    load();
    const id = setInterval(load, 60000);
    // Media 是预挂载 tab：启动时通常不在焦点，旧实现首次 load 被 isFocused 挡掉，
    // 必须等 60s 才拉到关注列表 → 「关注」tab 短暂/长期空白。聚焦时补一次。
    const offFocus = navigation.addListener('focus', load);
    return () => {
      alive = false;
      clearInterval(id);
      offFocus();
    };
  }, [navigation, token]);

  useEffect(() => {
    setFollowedIdsReady(false);
  }, [token]);

  // 直播列表实时自动刷新：浏览直播 tab 且未播放时每 60s 静默重拉（关注成员开播即时可见）
  useEffect(() => {
    if (tab !== 'live' || playing) return;
    const id = setInterval(() => {
      // 同上：后台/失焦不轮询
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

  // 回到前台时按当前播放状态重新锁定（后台复位后上方 effect 不会再触发，需在此补锁）
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
      } else if (playing) {
        const wantLandscape = isFullscreen || isLandscape;
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
    // 同返回键：取消在途解析后显式复位 loading，否则列表永远停在骨架屏
    setLoading(false);
    setIsFullscreen(false);
    setIsLandscape(false);
    setLiveImmersiveMode(false);
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    setPlaying(null);
    setAnnouncement('');
    setAnnounceVisible(false);
    // 复位为「默认展开」：下次进入直播间仍是默认打开公告
    setAnnounceExpandedPersisted(true);
    announceAutoShownRef.current = false;
    // fromRoom 直达（房间点开）：关闭播放器 = 返回房间
    if (route.params?.fromRoom) navigation.goBack();
  }, [navigation, route.params?.fromRoom]);

  // 应用内小窗：当前播放交棒给悬浮小窗（小窗独立 Video/LiveExoView 实例续播），关掉大播放器。
  // RTMP/FLV 直播也放行：MiniPlayer 对 rtmp/.flv + isLive 渲染原生 LiveExoView（与大播放器同内核），
  // 录播/HLS 走 RNV Video —— 不再全屏拦截（此前拦截导致成员直播「小窗点了没用」）。
  /** 大窗视频真实宽高（PlayerCore onVideoSize 上报）：交棒小窗时带上，小窗立即按比例适配 */
  const videoSizeRef = useRef<{ w: number; h: number } | null>(null);
  const handleMiniPlayer = useCallback(() => {
    const cur = playing;
    if (!cur?.url) return;
    useMiniPlayerStore.getState().open({
      url: cur.url,
      title: cur.title,
      cover: cur.cover,
      isLive: !!cur.isLive,
      // 必须取统一播放器 store 的真实进度，不能用本地瞬时状态，否则大窗看一半会从小窗从头开始。
      position: usePlayerStore.getState().position,
      aspectW: videoSizeRef.current?.w,
      aspectH: videoSizeRef.current?.h,
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

  // v2.6: came from room (explicit fromRoom flag) → hide list, back goes to room
  // 注意：不能仅凭 playLiveId 判断——首页直播卡跳转也带 playLiveId，
  // 无 fromRoom 标记时保持列表页（不误切 Rooms tab）
  // fromRoom 直达：不再"首帧未播放即弹回房间"——此前 playing 初始为 null（解析中）时
  // useEffect 立即 navigate('Rooms')，导致房间点录播/直播「第一次必进不去播放器」。
  // 播放失败由播放器错误态 + 重试呈现；关闭时 closePlayer 负责 goBack 回房间。
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
      void refreshLiveStream();
    } else if (
      evUpper.includes('START') ||
      evUpper.includes('SUCCESS') ||
      evUpper.includes('AGREE')
    ) {
      showToast(t('PK连麦已开始，正在切换画面'));
      void refreshLiveStream();
    }
  }, [liveBarrage.lastLiveEvent, showToast, t]);

  // CLOSELIVE 是官方直播结束信号；此时拉 live/result + 贡献榜做收尾总结。
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

  // 兜底：任何入口把「h5 分享页」塞进 playing.url，都在渲染前替换为真实媒体流
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

  // 每次进入新的直播间：公告默认展开（用户要求「进直播间显示公告」）
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
        // 没有公告就直接隐藏（不再显示「暂无公告」占位）
        setAnnouncement('');
        setAnnounceVisible(false);
        return;
      }
      if (playing.item?.liveId) LIVE_ANNOUNCEMENT_CACHE.set(String(playing.item.liveId), annText);
      setAnnouncement(annText);
      setAnnounceVisible(true);
      setAnnounceExpandedPersisted(true);
    } catch {
      // 拉取失败不占屏；保留已有公告文本（若有）
      setAnnounceVisible(false);
    }
  };

  // 小窗/PiP 返回：公告先取缓存恢复，避免「回来公告没了」；无缓存则后台重拉
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
    setTab(next);
    setNextCursor(0);
    setHasMore(true);
    // rely on useEffect to trigger fetch
  };

  // 从首页快捷入口二次进入时，React Navigation 可能复用 MediaScreen 实例，
  // useState 初始值不会重算 → 手动切过的 tab 残留。这里用 params.mode 兜底同步，
  // 让用户「点回放进去就是录播、点直播进去就是直播」，与离开前停留的 tab 无关。
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
    reloadList();
    // 关注录播下拉刷新后重新触发并行翻页（否则只剩第一页）
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
    // 点击即进播放器：解析完成前先以「解析中」状态渲染播放器 shell（loading 提示），
    // 解析完成后无缝替换为真实播放；不再让用户停留在列表页干等或失败弹窗
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
      // 老录播/已结束直播的地址可能是 h5 分享页（.html?id=xxx）→ 用 id 重新解析真实媒体流
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
          // 进入直播间默认展开公告（用户要求）；只有用户手动收起后才保持收起
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
        // 播放器内提示（播放器已进入，用户可见错误与重试），不再只停留在列表页
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
      // 官方有时在直播结束后返回 h5 分享页（.html）而不是媒体流，Exo 会报 Source error
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

  const refreshLiveStream = async () => {
    const current = playingRef.current;
    if (!current?.isLive) return;
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
    if (urls[0] && urls[0] !== current.url) {
      setPlaying({
        ...current,
        url: urls[0],
        urls,
        needsVlc: streamNeedsProxy(urls[0]),
        item: { ...current.item, ...(detail?.content || detail?.data || detail) },
      });
    } else {
      usePlayerStore.getState().requestKernelRebuild();
    }
  };

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
      // 礼物列表：直播送礼走直播协议（businessId=liveId, giftType=1）；
      // 只有它返回空时才用成员维度兜底（否则面板空着没法送），并打日志便于定位。
      const anchorUserId = acceptUserId(source.item);
      const [moneyRes] = await Promise.all([pocketApi.getUserMoney().catch(() => null)]);
      let next: any[] = [];
      // 官方直播礼物面板参数是 {memberId, businessCode:1, liveId}；只传 businessId
      // 会漏掉「琴音生花」。先按官方直播场景取，空再回退旧参数。
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
      // 记分礼物（如「琴音生花」）在 giftType=2 分组，需单独拉取并合并
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
      // 记分礼物「琴音生花」置顶（用户要求）
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
    // 在途锁：连点「送出」会并发发多次请求（每次真实扣鸡腿），必须先拦住
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
      // 直播详情里的 crm（DES 加密的聊天室 id）——服务端靠它把礼物广播进直播间，缺失则成员端无感知
      let crm = '';
      try {
        const one = await pocketApi.getLiveOne(String(playing.item.liveId));
        crm = String((one as any)?.content?.crm || '');
      } catch {
        /* 拿不到 crm 时按官方空 crm 路径发送 */
      }
      // 记分礼物（琴音生花等）来自成员维度 businessCode=5；直播普通礼物 businessCode=0（公演=7）
      // 某些礼物的 businessCode 不在直播列表里 → 失败时用 5 再试一次，确保能送出去
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
    // 每次打开都清空旧榜，避免换直播间/二次打开时先看到上一场贡献数据。
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

  // 旧全原生直播页（LivePlayerActivity）的「请求礼物面板」事件已于 随死代码一并删除。
  // 统一播放器的礼物入口由控制条直接调用 openGiftPanel。

  // 画面旋转（翻转）：旋转 90° 时交换容器宽高，使视频填满屏幕且不裁剪
  const screen = useWindowDimensions();
  // 小窗比例跟随窗口方向：竖屏页面固定 9:16、横屏全屏固定 16:9（不用屏幕原始比例，超长屏会出竖条）。
  // ⚠️ 不使用视频 naturalSize：口袋竖屏内容常是横屏编码，会把小窗带横（用户反馈）。
  useEffect(() => {
    if (screen.width > 0 && screen.height > 0) setPipAspectLive(screen.width > screen.height);
  }, [screen.width, screen.height]);

  // PiP 退出兜底 remount key：Dimensions 在 Android 上对 windowMode 变化未必刷新，
  // 万一 key 随 winW 没翻也没法触发 FlatList 重挂载 → 直接 bump 这个 nonce 强制 remount。
  // 注意：这只是已知 MediaScreen 直播网格的局部兜底；其他类似 FlatList 屏按需补。
  const [pipRemount, setPipRemount] = useState(0);
  /**
   * 是否处于系统小窗（PiP）。
   * ⚠️ 系统 PiP 的画面 = **整个 Activity 窗口的快照**，不是单独抓媒体层。
   * 所以播放器页上任何浮层（公告面板、弹幕列表抽屉…）都会一起被拍进小窗里
   * —— 用户反馈「小窗会带着直播公告」就是这个原因。
   * 进 PiP 时把播放器浮层全部隐藏，保证小窗里只有画面。
   */
  const [inSystemPip, setInSystemPip] = useState(false);
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('PipEnteredChanged', (entered: boolean) => {
      setInSystemPip(!!entered);
      if (!entered) setPipRemount((n) => n + 1);
    });
    return () => sub.remove();
  }, []);

  // 分享页（老录播）解析期间只显示 loading，绝不把 .html 交给 Native Exo（否则必 Source error）
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
        {/* 公告展开时：点画面任意处收起；收起后左上角保留「公告」小按钮 */}
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
              style={[styles.announceBadge, { top: insets.top + 42 }]}
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
            style={[styles.announcePanel, { top: insets.top + 46 }]}
          >
            <View style={styles.announcePanelTop}>
              {/* ⚠️ 标题组必须 flex:1 + minWidth:0，否则内层 title 的 flex:1 失效
                  （它撑的是这个 wrapper，而 wrapper 默认按内容宽）→ wrapper 撑满整行，
                  把右侧「刷新/收起」两个按钮顶出屏幕（用户截图：收起按钮跑到屏幕外）。 */}
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

        {/* 解析中/解析失败：url 未就绪时渲染播放器 shell 内提示（点击即进播放器的等待态） */}
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
          /* 统一播放器（重写）：口袋直播/录播 → PlayerScreen
             - 内核路由：rtmp/flv → Exo / HLS/mp4 → Native / 失败可切 Web（flv.js+hls.js）
             - 候选线路 urls：失败自动切下一候选
             - 弹幕：children 插槽挂 DanmakuOverlay（poll/LRC 数据源保留在页面）
             - 倍速/续播/内核切换/礼物/贡献榜/公告/弹幕设置全部经 features + extraActions */
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
            // 直播弹幕输入条：进播放器底坞（随控制条自动隐藏/呼出），不再单独叠一层 + 收起按钮
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
            // 直播流地址有时效（wsSecret）：失败重试 = 重新解析（startPlay），而非重播同 URL
            onRetry={() =>
              playing.isLive ? void refreshLiveStream() : void startPlay(playing.item, false)
            }
            liveTransitionKey={liveBarrage.streamRevision}
            persistent
          >
            {/* 弹幕列表抽屉（直播/录播通用）：列表 + 搜索 + 按发送者筛选 + 点击跳转 + 跟随播放 */}
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
              // 点发送者昵称 → 用户资料卡（成员/粉丝同一界面）
              onOpenProfile={(entry) =>
                setDanmakuProfile({
                  nick: entry.nick,
                  avatar: entry.avatar,
                  userId: entry.userId != null ? String(entry.userId) : undefined,
                })
              }
            />
            {/* 直播弹幕输入条已并入播放器底坞（barrageInput），不再单独叠一层，也没有单独的收起按钮 */}
          </PlayerScreen>
        )}

        {/* PK/连麦成员浮层：官方 MULTI_MIC_PK / MICROPHONE_CONNECTION 事件驱动 */}
        {playing?.isLive && liveBarrage.multiMicUsers.length ? (
          <View style={[styles.pkOverlay, { top: insets.top + 54 }]} pointerEvents="none">
            <Text style={styles.pkOverlayTitle}>
              {liveBarrage.pkState === 'finish' ? t('PK已结束') : t('PK连麦')}
            </Text>
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

        {/* 直播结束总结页：避免结束后一直停在直播间/错误页 */}
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

        {/* 弹幕列表点发送者 → 用户资料卡（含关注/取消关注 + 私信） */}
        <UserProfileSheet
          visible={!!danmakuProfile}
          target={danmakuProfile}
          onClose={() => setDanmakuProfile(null)}
          onOpenChat={({ id, name }) => {
            setDanmakuProfile(null);
            navigation.navigate('PrivateMessagesScreen', { targetUserId: id, targetName: name });
          }}
        />

        <Modal
          visible={giftVisible}
          transparent
          animationType="slide"
          onRequestClose={() => setGiftVisible(false)}
        >
          <View style={styles.modalShade}>
            <GlassSurface
              radius={22}
              role="card"
              style={[styles.giftPanel, { backgroundColor: 'transparent' }]}
            >
              <View style={styles.giftHeader}>
                <Text style={[styles.giftTitle, { color: palette.label }]}>{t('直播送礼')}</Text>
                <TouchableOpacity onPress={() => setGiftVisible(false)} activeOpacity={0.8}>
                  <Text style={[styles.backBtnText, { color: palette.tint }]}>{t('关闭')}</Text>
                </TouchableOpacity>
              </View>
              <Text style={[styles.giftStatus, { color: palette.labelSecondary }]}>
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
                            backgroundColor: active ? palette.tintSoft : palette.fill2,
                            borderColor: active ? palette.tint : palette.hairline,
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
                          <View style={[styles.giftImage, { backgroundColor: palette.fill3 }]} />
                        )}
                        <Text style={[styles.giftName, { color: palette.label }]} numberOfLines={1}>
                          {giftName(gift)}
                        </Text>
                        <Text style={[styles.giftCost, { color: palette.tint }]}>
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
                      color: palette.label,
                      borderColor: palette.hairline,
                      backgroundColor: palette.fill2,
                    },
                  ]}
                  keyboardType="numeric"
                  value={giftNum}
                  maxLength={3}
                  // 只留数字：非数字输入会让 Number 落回 1，用户看不出自己输错了
                  onChangeText={(s) => setGiftNum(String(s).replace(/\D/g, '').slice(0, 3))}
                />
                <TouchableOpacity
                  style={[
                    styles.sendGiftBtn,
                    {
                      backgroundColor: selectedGift && !giftSending ? palette.tint : palette.fill3,
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
                          selectedGift && !giftSending ? palette.onTint : palette.labelTertiary,
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
                <Text style={[styles.rechargeText, { color: palette.tint }]}>
                  {t('余额不足？去充值鸡腿')}
                </Text>
              </TouchableOpacity>
            </GlassSurface>
          </View>
        </Modal>
        <Modal
          visible={rankVisible}
          transparent
          animationType="slide"
          presentationStyle="overFullScreen"
          statusBarTranslucent
          onRequestClose={() => setRankVisible(false)}
        >
          <View style={styles.modalShade}>
            <GlassSurface
              radius={22}
              role="card"
              style={[styles.giftPanel, { backgroundColor: 'transparent' }]}
            >
              <View style={styles.giftHeader}>
                <Text style={[styles.giftTitle, { color: palette.label }]}>{t('贡献榜')}</Text>
                <TouchableOpacity onPress={() => setRankVisible(false)} activeOpacity={0.8}>
                  <Text style={[styles.backBtnText, { color: palette.tint }]}>{t('关闭')}</Text>
                </TouchableOpacity>
              </View>
              <Text style={[styles.giftStatus, { color: palette.labelSecondary }]}>
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
                    // 点名字/头像 → 资料卡（用户要求）。整行可点，命中区更大；
                    // 没有 userId 的行给一句说明而不是点了没反应。
                    activeOpacity={0.7}
                    onPress={() =>
                      setRankProfile({
                        userId: row.userId ? String(row.userId) : undefined,
                        nick: row.name,
                        avatar: row.avatar,
                        missingIdMessage: t('该用户没有可加载的口袋资料'),
                      })
                    }
                    style={[styles.rankRow, { borderBottomColor: palette.hairline }]}
                  >
                    <Text style={[styles.rankNo, { color: palette.tint }]}>
                      {row.rank || index + 1}
                    </Text>
                    {row.avatar ? (
                      <NetworkImage
                        source={{ uri: row.avatar }}
                        style={[styles.rankAvatar, { backgroundColor: palette.fill3 }]}
                        thumbnail={64}
                      />
                    ) : (
                      <View style={[styles.rankAvatar, { backgroundColor: palette.fill3 }]} />
                    )}
                    <View style={styles.rankInfo}>
                      <Text style={[styles.rankName, { color: palette.label }]} numberOfLines={1}>
                        {row.name}
                      </Text>
                      <Text
                        style={[styles.rankValue, { color: palette.labelSecondary }]}
                        numberOfLines={1}
                      >
                        {row.value ? t('贡献 {value}', { value: row.value }) : t('贡献用户')}
                      </Text>
                    </View>
                    <MaterialCommunityIcons
                      name="chevron-right"
                      size={16}
                      color={palette.labelTertiary}
                    />
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </GlassSurface>
          </View>
        </Modal>
        {/* 贡献榜用户资料卡：挂在排行榜 Modal 之后 → 层级在其上，关掉回到榜单 */}
        <UserProfileSheet
          visible={!!rankProfile}
          target={rankProfile}
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

  return (
    <View style={[styles.container]}>
      <ScreenHeader
        title={tab === 'live' ? t('直播') : t('录播')}
        hideBack
        right={
          <TouchableOpacity
            onPress={refreshList}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            activeOpacity={0.7}
            accessibilityLabel={t('刷新')}
          >
            <MaterialCommunityIcons name="refresh" size={22} color={palette.label} />
          </TouchableOpacity>
        }
      />
      {/* 直播/录播分段控件：玻璃轨道 + 滑动玻璃选中胶囊（与底栏同一套） */}
      <GlassSegmented
        options={[
          { key: 'live', label: t('直播') },
          { key: 'vod', label: t('录播') },
        ]}
        value={tab}
        onChange={(k) => switchTab(k as 'live' | 'vod')}
        height={38}
        style={[
          styles.segmentWrap,
          { borderColor: palette.innerStroke, borderWidth: StyleSheet.hairlineWidth },
        ]}
      />
      {/* 单行筛选：分组 = 玻璃滑动选中块（与底栏同一套） + 搜索图标 */}
      <View style={styles.filterRow}>
        <View style={{ flex: 1 }}>
          <GlassSegmentedScroll
            options={groupChips.map((item) => ({ key: String(item.id), label: t(item.label) }))}
            value={String(groupId)}
            onChange={(k) => setGroupId(Number(k))}
            height={38}
          />
        </View>
        <TouchableOpacity
          onPress={() => setShowSearch((v) => !v)}
          style={[
            styles.searchToggle,
            { backgroundColor: showSearch ? palette.tint : palette.fill2 },
          ]}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          activeOpacity={0.85}
          accessibilityLabel={showSearch ? t('关闭搜索') : t('搜索')}
        >
          <MaterialCommunityIcons
            name={showSearch ? 'close' : 'magnify'}
            size={18}
            color={showSearch ? palette.onTint : palette.labelSecondary}
          />
        </TouchableOpacity>
      </View>
      {/* 搜索展开行 */}
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
          <TouchableOpacity
            onPress={() => setShowCalendar(true)}
            style={[styles.calBtn, dateFilter && styles.calBtnActive]}
            hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
          >
            <MaterialCommunityIcons
              name="calendar-month"
              size={20}
              color={dateFilter ? palette.tint : palette.labelSecondary}
            />
          </TouchableOpacity>
          <TextInput
            style={[
              styles.searchInput,
              {
                backgroundColor: palette.surfaceGlassStrong,
                borderColor: selectedMember ? palette.tint : palette.innerStroke,
                color: palette.label,
              },
            ]}
            placeholder={
              selectedMember ? t('搜索该成员的标题 / 日期...') : t('搜索成员名、标题、时间...')
            }
            placeholderTextColor={palette.labelTertiary}
            value={search}
            onChangeText={setSearch}
            returnKeyType="search"
          />
          {search.trim() ? (
            <TouchableOpacity
              onPress={() => setSearch('')}
              style={styles.searchClear}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <MaterialCommunityIcons name="close-circle" size={18} color={palette.labelTertiary} />
            </TouchableOpacity>
          ) : null}
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
            <MaterialCommunityIcons name="close-circle" size={16} color={palette.labelTertiary} />
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
          // 滑动即收键盘：顶部有搜索框，滑列表时键盘不该一直压着半屏
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          // 直播页去宣传栏（banner）：统一双列网格，即使只有 1 条直播也保持双列
          data={tab === 'vod' ? ((vodRows ?? []) as any) : list}
          keyExtractor={(item: any, index) => {
            const base = String(item?.liveId || item?.key || index);
            // ⚠️ PiP/横竖屏切换后需让 item 重挂以重测 aspectRatio:1(高=宽),
            // 但用 FlatList key 整体 remount 会丢滚动位置 → 改为 keyExtractor 拼
            // 窗口宽 + PiP 退出计数：cell 卸载重挂, VirtualizedList 保留 offset。
            return `${base}_${screen.width}_${pipRemount}`;
          }}
          numColumns={tab === 'vod' ? 1 : 2}
          columnWrapperStyle={tab === 'vod' ? null : styles.vodGridRow}
          // PiP/横竖屏切换后 winW 变化:extraData 不足以让已 measure 的子节点重测(Yoga 不会自动),
          // 关 removeClippedSubviews(grid 仅几行无虚拟化必要,且 Android PiP 后裁剪会留顶部残影)。
          extraData={screen.width}
          removeClippedSubviews={false}
          // 性能（用户反馈「全部」网格滑动严重掉帧）：限制同屏挂载的玻璃卡数量、加快批渲染。
          updateCellsBatchingPeriod={40}
          renderItem={({ item }) => {
            // 录播：组头 / 双卡行
            if (tab === 'vod') {
              if (item.type === 'header') {
                return (
                  <Text style={[styles.vodGroupTitle, { color: palette.labelTertiary }]}>
                    {item.title}
                  </Text>
                );
              }
              const renderCard = (it: any) => {
                if (!it) return <View style={styles.vodGridItem} />;
                const coverUrl = it.liveCover || it.coverPath;
                const meta = [it.nickname, formatTimestamp(it.startTime).slice(0, 16)]
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
                      onPress={() => startPlay(it)}
                      activeOpacity={0.88}
                      accessibilityLabel={it.title || it.liveRoomTitle || t('播放')}
                    >
                      <View
                        style={{
                          borderRadius: 20,
                          overflow: 'hidden',
                          backgroundColor: palette.fill3,
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
                              <MaterialCommunityIcons
                                name="video"
                                size={30}
                                color={palette.labelTertiary}
                              />
                            </View>
                          )}
                          <View
                            style={[
                              styles.v2Badge,
                              styles.vodGridType,
                              { backgroundColor: 'rgba(0,0,0,0.55)' },
                            ]}
                          >
                            <MaterialCommunityIcons
                              name={it.liveType === 2 ? 'radio' : 'video'}
                              size={10}
                              color="#FFFFFF"
                              style={{ marginRight: 3 }}
                            />
                            <Text style={styles.v2BadgeText}>
                              {it.liveType === 2 ? t('电台') : t('视频')}
                            </Text>
                          </View>
                          {/* 右上角徽标：时长（开播时间已显示在标题下方 meta） */}
                          <View style={styles.vodBadgeRow}>
                            {it.endTime && it.startTime ? (
                              <View
                                style={[styles.v2Badge, { backgroundColor: 'rgba(0,0,0,0.55)' }]}
                              >
                                <Text style={styles.v2BadgeText}>
                                  {formatDuration((it.endTime - it.startTime) / 1000)}
                                </Text>
                              </View>
                            ) : null}
                          </View>
                          {/* 底部平滑渐变遮罩（替代两层色阶） */}
                          <LinearGradient
                            pointerEvents="none"
                            colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.45)', 'rgba(0,0,0,0.82)']}
                            locations={[0, 0.45, 1]}
                            style={styles.vodShade}
                          />
                          <View style={styles.vodInfoOverlay}>
                            <Text style={styles.vodTitleOverlay} numberOfLines={2}>
                              {it.title || it.liveRoomTitle || t('无标题')}
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
              };
              return (
                <View style={styles.vodRow}>
                  {renderCard(item.left)}
                  {renderCard(item.right)}
                </View>
              );
            }
            // 直播：单卡网格
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
                  onPress={() => startPlay(item)}
                  activeOpacity={0.88}
                  accessibilityLabel={item.title || item.liveRoomTitle || t('播放')}
                >
                  {/* 卡片不套玻璃：网格里每卡一个 BlurView 会逐帧重算模糊（用户反馈滑动掉帧），
                      且封面铺满、玻璃观感等于没有 —— 按设计系统「列表卡不用玻璃」用实底圆角 */}
                  <View
                    style={{ borderRadius: 20, overflow: 'hidden', backgroundColor: palette.fill3 }}
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
                          <MaterialCommunityIcons
                            name="video"
                            size={30}
                            color={palette.labelTertiary}
                          />
                        </View>
                      )}
                      <View
                        style={[
                          styles.v2Badge,
                          styles.vodGridType,
                          { backgroundColor: 'rgba(0,0,0,0.55)' },
                        ]}
                      >
                        <MaterialCommunityIcons
                          name={item.liveType === 2 ? 'radio' : 'video'}
                          size={10}
                          color="#FFFFFF"
                          style={{ marginRight: 3 }}
                        />
                        <Text style={styles.v2BadgeText}>
                          {item.liveType === 2 ? t('电台') : t('视频')}
                        </Text>
                      </View>
                      {/* 右上角徽标：直播中/电台（开播时间已显示在标题下方 meta） */}
                      <View style={styles.vodBadgeRow}>
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
                      </View>
                      {/* 底部平滑渐变遮罩（替代两层色阶） */}
                      <LinearGradient
                        pointerEvents="none"
                        colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.45)', 'rgba(0,0,0,0.82)']}
                        locations={[0, 0.45, 1]}
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
          }}
          ListEmptyComponent={
            loading || (groupId === -1 && !!token && !followedIdsReady) ? (
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
            />
          }
          ListFooterComponent={<ListBottomSpacer />}
          contentContainerStyle={list.length === 0 ? { flex: 1 } : styles.listContent}
          initialNumToRender={tab === 'vod' ? 6 : 8}
          maxToRenderPerBatch={8}
          windowSize={7}
        />
      </View>
    </View>
  );
}
