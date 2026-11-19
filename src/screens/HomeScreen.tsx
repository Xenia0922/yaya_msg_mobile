/**
 * HomeScreen · 内容仪表盘 v2.6 布局重做
 * - 问候区（大标题 + 副标题，区块标题统一「4×18 tint 竖条 + headline」）
 * - 未登录提示卡
 * - 正在直播 banner 轮播（crossfade/位移动画 + 指示点随动）+ 直播行列表（52 封面圆角12 + 标题/昵称/chevron）
 * - 快捷入口 4 格胶囊
 * - 最近播放续播卡
 * - 工具 chips 横向滚动
 * - 首屏加载 Skeleton 占位
 * 业务逻辑 / API / 数据流 / 路由 / i18n 原文一律不动，仅重组布局结构。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, AppState, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation, useIsFocused } from '@react-navigation/native';
import { CompositeNavigationProp } from '@react-navigation/native';
import { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { StackNavigationProp } from '@react-navigation/stack';
import { useSafeAreaInsets } from '../hooks/useSafeAreaInsets';
import { RootStackParamList, TabParamList } from '../navigation/types';
import { useSettingsStore, useMemberStore } from '../store';
import { useMusicPlayerStore } from '../store/musicPlayerStore';
import { MusicEngine } from '../services/musicPlayer';
import { usePalette, spacing, getPageBackground } from '../theme';
import { typography } from '../theme/typography';
import ScreenHeader from '../components/ScreenHeader';
import { GlassCard } from '../components/GlassCard';
import { ScalePressable } from '../components/Motion';
import { useI18n } from '../i18n';
import { readFollowedIdsCache, writeFollowedIdsCache } from '../services/followedIds';
import { pocketApi } from '../api/pocket48';
import { externalApi } from '../api/external';
import bilibiliApi from '../api/bilibili';
import { BilibiliLiveRoom } from '../types';
import { normalizeUrl, pickText, unwrapList } from '../utils/data';
import { privateUnreadCount } from '../utils/privateUnread';
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
import type { LiveCardItem, NavItem } from './home/types';

type HomeNavProp = CompositeNavigationProp<
  BottomTabNavigationProp<TabParamList, 'Home'>,
  StackNavigationProp<RootStackParamList>
>;

/** MaterialCommunityIcons 图标（统一视觉语言，替代 emoji） */
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
  { title: '私信', desc: '', route: 'PrivateMessagesScreen', icon: ICONS.PrivateMessages },
];

/** 工具：单行横向 chips（翻牌/统计/下载/账号/设置…） */
const TOOL_CHIPS: NavItem[] = [
  { title: '翻牌', desc: '', route: 'FlipScreen', icon: ICONS.FlipSend },
  { title: '上麦', desc: '', route: 'OnMicScreen', icon: ICONS.OnMic },
  { title: '下载', desc: '', route: 'DownloadScreen', icon: ICONS.Download },
  { title: '账号', desc: '', route: 'LoginScreen', icon: ICONS.Login },
  { title: '设置', desc: '', route: 'Settings', icon: ICONS.Settings },
  { title: '公演', desc: '', route: 'OpenLiveScreen', icon: ICONS.OpenLive },
  { title: 'B站', desc: '', route: 'BilibiliLiveScreen', icon: ICONS.Bilibili },
  { title: '鸡腿榜', desc: '', route: 'MeleeRankScreen', icon: ICONS.MeleeRank },
  { title: '相册', desc: '', route: 'RoomAlbumScreen', icon: ICONS.RoomAlbum },
  { title: '数据库', desc: '', route: 'DatabaseScreen', icon: ICONS.Database },
  { title: '发票', desc: '', route: 'InvoiceScreen', icon: ICONS.Invoice },
];

/** 统一昵称：部分直播接口带团名前缀，成员库 ownerName 不带，比较时去掉前缀。 */
function normalizeFollowName(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^(?:snh48|gnz48|bej48|ckg48|cgt48)[-_ ]/i, '');
}

/** 成员直播排序：已关注+置顶 → 已关注未置顶 → 其他（保持原顺序） */
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
  // 关注/置顶的直播排最前；关注的人不够填满 banner 时，用其他正在直播的房间补齐。
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

/** 首页直播列表缓存（stale-while-revalidate：冷启动秒显上次内容） */
const LIVES_CACHE_KEY = 'yaya_home_lives_cache_v1';

/** 公演直播（B站开播状态）缓存：B站接口不稳定，冷启动秒显上次检测结果，后台刷新 */
const GONGYAN_CACHE_KEY = 'yaya_home_gongyan_cache_v1';

/** B站单请求短超时：开播检测只需状态，6s 未回视为失败，避免拖慢首页骨架 */
const BILI_FAST_TIMEOUT = 6000;

/** Promise 竞速超时：返回 null 表示超时（不 abort，仅放弃等待；结束时清理定时器） */
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
  const isFocused = useIsFocused();
  const focusedRef = useRef(isFocused);
  focusedRef.current = isFocused;
  const settings = useSettingsStore((state) => state.settings);
  /** C4：按注册表解析最终渲染顺序（已剔除隐藏模块） */
  const order = resolveHomeModules(settings.home_modules_order, settings.home_modules_hidden);
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const token = settings.p48Token;
  // 屏幕宽度驱动快捷入口像素宽度：横竖屏切换（如 B 站直播自动横屏后返回）时立即重算，
  // 避免 flexBasis 百分比在旋转后残留横屏宽度（按钮被拉长不恢复）
  const { width: winW } = useWindowDimensions();
  const quickCellW = (winW - spacing.md * 2 - 24) / 4;

  const [lives, setLives] = useState<LiveCardItem[]>([]);
  const [livesOk, setLivesOk] = useState(false);
  const [livesError, setLivesError] = useState('');
  const [bannerIndex, setBannerIndex] = useState(0);
  /** 口袋私信未读数（红点角标）：进首页拉一次，失败静默为 0 */
  const [pmUnread, setPmUnread] = useState(0);
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
  /** 最新成员直播列表快照（供失败分支判断"当前是否已有可展示数据"，避免空壳响应误清列表） */
  const livesRef = useRef<LiveCardItem[]>([]);
  /** 未截断的完整直播列表：关注 id 晚于首屏到达时，必须从全量重排，不能只在已截断的 lives 里重排 */
  const allLivesRef = useRef<LiveCardItem[]>([]);
  /** 服务端连续返回「完整结构但空 liveList」的次数（见 utils/homeLivesRules） */
  const emptyStreakRef = useRef(0);
  useEffect(() => {
    livesRef.current = lives;
  }, [lives]);

  // 公演直播：B站直播间开播检测（仅五个团 SNH48/GNZ48/BEJ48/CGT48/CKG48，其余直播间不展示）
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
  /** 上一轮开播判定快照：B站单房间请求偶发失败/超时时保留上次状态（防在播行随单次失败闪没/重现"抽风"） */
  const gongyanLiveRef = useRef<Record<string, boolean>>({});
  /** 上一轮房间信息快照：info 请求失败时保留旧封面/标题（防封面闪回占位） */
  const gongyanInfoRef = useRef<Record<string, { title: string; cover: string }>>({});
  useEffect(() => {
    gongyanLiveRef.current = gongyanLive;
  }, [gongyanLive]);
  useEffect(() => {
    gongyanInfoRef.current = gongyanInfo;
  }, [gongyanInfo]);

  const fetchGongyanStatus = useCallback(async () => {
    if (!focusedRef.current || !isAppForeground()) return;
    try {
      const rooms = await externalApi.fetchBilibiliConfig();
      // 五团固定顺序（按 GONGYAN_ROOMS 序，非 B站接口返回序 —— 接口顺序跨轮不稳会导致行顺序跳动"抽风"）
      const filtered = GONGYAN_ROOMS.map((name) =>
        rooms.find((room) => String(room.name || '').trim() === name),
      ).filter((room): room is BilibiliLiveRoom => !!room);
      // 并行检测开播状态（每请求 6s 竞速超时：B站接口不稳，单请求挂起不应拖住整个公演区）
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
          // 单轮失败/超时：保留上次判定 —— 已开播的房间不因一次抖动被判"下播"而整行闪烁
          next[room.roomId] = !!prevLive[room.roomId];
        }
      });
      // 在播房间并行抓取封面 + 直播标题（公演行展示真实封面与场次标题；6s 竞速超时）
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
          // info 单轮失败：保留旧封面/标题（防在播行封面闪成占位图标）
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
      // 持久化成功结果：冷启动秒显上次开播状态（B站接口慢时骨架不空转）
      AsyncStorage.setItem(
        GONGYAN_CACHE_KEY,
        JSON.stringify({ rooms: filtered, live: next, info: infoMap }),
      ).catch(() => {});
    } catch (e: any) {
      if (!focusedRef.current) return;
      // 刷新失败：保留旧数据继续展示（不闪骨架）；完全无数据时才记错误态
      if (!gongyanHasDataRef.current) setGongyanError(e?.message || String(e));
      // 初次失败 5s 后自动重试（最多 2 次），不必干等 120s 轮询
      if (gongyanRetryRef.current < 2) {
        gongyanRetryRef.current += 1;
        setTimeout(() => {
          if (!mountedRef.current || !focusedRef.current) return;
          if (isAppForeground()) fetchGongyanStatus();
        }, 5000);
      }
    }
  }, [GONGYAN_ROOMS]);

  // 冷启动秒显公演缓存（stale-while-revalidate）
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
        } catch {
          /* ignore */
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!isFocused) return;
    fetchGongyanStatus();
    gongyanTimer.current = setInterval(
      () => {
        // 切到后台时暂停轮询，回前台立即补一次（省电 + 不占后台网络）
        if (AppState.currentState !== 'active') return;
        fetchGongyanStatus();
      },
      2 * 60 * 1000,
    );
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') fetchGongyanStatus();
    });
    return () => {
      if (gongyanTimer.current) clearInterval(gongyanTimer.current);
      sub.remove();
    };
  }, [fetchGongyanStatus, isFocused]);

  const liveGongyanRooms = useMemo(
    () => gongyanRooms.filter((room) => !!gongyanLive[room.roomId]),
    [gongyanRooms, gongyanLive],
  );

  // banner crossfade 位移动画
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const slideAnim = useRef(new Animated.Value(0)).current;

  // 成员直播排序偏好：已关注（getFollowedIds）+ 置顶（yaya_pinned_rooms）优先
  const [followedIds, setFollowedIds] = useState<Set<string>>(new Set());
  const [pinnedIds, setPinnedIds] = useState<string[]>([]);
  const members = useMemberStore((state) => state.members);
  // 关注 id → 成员库 ownerName：直播接口有时缺 userId，昵称是最后一道兜底。
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
        } catch {
          /* ignore */
        }
      })
      .catch(() => {});
    if (!token) {
      setFollowedIds(new Set());
      return;
    }
    let alive = true;
    // 本地缓存先出：首页 banner 的关注优先级不等网络。
    void readFollowedIdsCache(token).then((cached) => {
      if (alive && cached.cached) setFollowedIds(new Set(cached.ids));
    });
    const loadFollowedIds = () => {
      pocketApi
        .getFollowedIds()
        .then((res: any) => {
          if (!alive) return;
          const ids = unwrapList(res, ['content.data', 'content', 'data', 'list']).map(String);
          setFollowedIds(new Set(ids));
          void writeFollowedIdsCache(token, ids);
        })
        .catch(() => {});
    };
    loadFollowedIds();
    const timer = setInterval(loadFollowedIds, 60000);
    const offFocus = navigation.addListener('focus', loadFollowedIds);
    return () => {
      alive = false;
      clearInterval(timer);
      offFocus();
    };
  }, [navigation, token]);

  const fetchLives = useCallback(
    (options?: { authoritative?: boolean }) => {
      if (!focusedRef.current || !isAppForeground()) return;
      const authoritative = !!options?.authoritative;
      // 秒显上次缓存（stale-while-revalidate）：冷启动立即有内容，后台刷新
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
          } catch {
            /* ignore */
          }
        })
        .catch(() => {});
      withTimeout(
        pocketApi.getLiveList({
          groupId: 0,
          liveType: 0,
          next: 0,
          record: false,
          // 默认一页仅 15 条：在播人数多时，排在后面的关注成员会在服务端就被截掉。
          // 首页需要完整列表做「关注优先」排序，再截取展示数量。
          size: 100,
        }),
        10000,
      )
        .then((res: any) => {
          if (!focusedRef.current || !isAppForeground()) return;
          if (!res) throw new Error('timeout');
          // 空壳防护：官方接口偶发返回 success/200 但 content 无 liveList 字段（限流/风控/异常），
          // 此时 normalizeLiveList 会解出空数组 → 误把"有直播"显示成"暂无成员直播"。
          // 判定规则：结构里确实没有 liveList 数组 = 视为请求异常（保留旧数据走 catch），
          // 只有结构完整且 liveList 真为空（此时无人开播）才落空态。
          const rawList = (res?.content ?? res?.data ?? res)?.liveList;
          if (!Array.isArray(rawList)) throw new Error('live list empty shell');
          const allLives = normalizeLiveList(res);
          allLivesRef.current = allLives;
          const list = sortLivesByPreference(allLives, followedIds, pinnedIds, followedNames).slice(
            0,
            8,
          );
          // 与 Yaya Message X 相同的三态判定：非空替换；真空连续两次清空（用户主动刷新立即清）；
          // 原始有条目但解析为 0 条视为解析异常，保留旧数据，避免把「有直播」误显示成「暂无」。
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
          // 有缓存/已有列表时网络失败不打断展示（保留内容，仅静默）；
          // 无任何数据时：记错误态 + 5s 后自动重试（最多 3 次，网络抖动自愈，不必等手动点重试）。
          // 判断依据是当前无可展示数据，避免首屏失败后只剩 120s 轮询兜底。
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

  // 关注/置顶数据到达后：从完整列表重排（不是只在已截断的 8 条里重排，
  // 否则首次请求时关注列表尚未到达，排在后面的关注成员直播会被永久漏掉）。
  useEffect(() => {
    const all = allLivesRef.current.length ? allLivesRef.current : livesRef.current;
    if (all.length) {
      setLives(sortLivesByPreference(all, followedIds, pinnedIds, followedNames).slice(0, 8));
    }
  }, [followedIds, pinnedIds, followedNames]);

  // 仅首页可见时请求和轮询；重新进入首页立即刷新。
  const wasFocusedRef = useRef(false);
  useEffect(() => {
    if (!isFocused) {
      wasFocusedRef.current = false;
      return;
    }
    if (!wasFocusedRef.current) {
      wasFocusedRef.current = true;
      // 从直播页/房间回到首页视为用户主动刷新：空列表立即采纳，不再让旧 banner 多挂一轮。
      fetchLives({ authoritative: true });
    }
    const id = setInterval(() => {
      if (AppState.currentState === 'active') fetchLives();
    }, 60 * 1000);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') fetchLives();
    });
    return () => {
      clearInterval(id);
      sub.remove();
    };
  }, [fetchLives, isFocused]);

  // banner 轮播：2.5s 自动切换下一条（最多轮前 4 条），切换带 crossfade + 位移动画。
  // 与直播/公演轮询一致，仅首页可见且 App 前台时切换。
  const bannerCount = Math.min(4, lives.length);
  // B4 修复：渲染期安全下标 —— 轮询把 lives 变短（主播下播）时，bannerIndex 可能暂时越界；
  // 仅靠 effect 收敛会先渲染一帧 lives[idx]=undefined → banner 整块消失 → 下方列表跳位“抽风”。
  // 渲染期直接夹取，保证任何一帧 banner 都存在（dots 也跟随安全下标）。
  const safeBannerIndex = bannerCount > 0 ? Math.min(bannerIndex, bannerCount - 1) : 0;
  useEffect(() => {
    if (!isFocused || bannerCount <= 1) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    let transition: Animated.CompositeAnimation | null = null;
    const startLoop = () => {
      if (timer || !isAppForeground()) return;
      timer = setInterval(() => {
        if (!isAppForeground()) return;
        transition = Animated.parallel([
          Animated.timing(fadeAnim, { toValue: 0, duration: 150, useNativeDriver: true }),
          Animated.timing(slideAnim, { toValue: 10, duration: 150, useNativeDriver: true }),
        ]);
        transition.start(({ finished }) => {
          if (!finished || !focusedRef.current || !isAppForeground()) return;
          setBannerIndex((i) => ((i < 0 ? 0 : Math.min(i, bannerCount - 1)) + 1) % bannerCount);
          // 退场结束后再回弹，避免两个动画同时驱动 slideAnim。
          transition = Animated.parallel([
            Animated.timing(fadeAnim, { toValue: 1, duration: 240, useNativeDriver: true }),
            Animated.spring(slideAnim, {
              toValue: 0,
              speed: 26,
              bounciness: 5,
              useNativeDriver: true,
            }),
          ]);
          transition.start(() => {
            transition = null;
          });
        });
      }, 2500);
    };
    const stopLoop = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      transition?.stop();
      transition = null;
      fadeAnim.setValue(1);
      slideAnim.setValue(0);
    };
    startLoop();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') startLoop();
      else stopLoop();
    });
    return () => {
      sub.remove();
      stopLoop();
    };
  }, [bannerCount, fadeAnim, slideAnim, isFocused]);

  // B2 修复：lives 数量变化（60s 轮询）后 bannerIndex 收敛到有效范围（dots 点击/轮播前进以渲染期安全值为主）
  useEffect(() => {
    if (bannerCount > 0) {
      setBannerIndex((i) => Math.min(i, bannerCount - 1));
    }
  }, [bannerCount]);

  // 原子化订阅：queue 引用仅在队列变化时更新，position 高频写入不触发首页重渲染
  const musicQueue = useMusicPlayerStore((s) => s.queue);
  const musicIndex = useMusicPlayerStore((s) => s.currentIndex);
  const musicPlaybackState = useMusicPlayerStore((s) => s.playbackState);
  const currentTrack = musicQueue[musicIndex] || null;
  /**
   * 当前歌词行：selector 返回字符串（Object.is 比较），position 高频更新时
   * 只有「行文本变化」才触发首页重渲染，避免每 250ms 刷整页。
   */
  /**
   * minibar 歌词行（重做）。
   *
   * 此前直接按 store.position 取行：一旦位置心跳停更（页面不在 / 原生心跳丢失），
   * 歌词永远停在第一句（用户看到一直显示「如果有你在 -」这种版权信息行）。
   *
   * 现在：不订阅 position（避免 4 次/秒整页重渲染），改成 500ms 本地 ticker：
   * - 记录「最近一次 store.position + 对应时刻」作为锚点；
   * - 播放中时按墙上时钟补时（锚点 + 已过秒数），与 store.position 取较大值；
   * - 只在「命中的行号变化」时才 setState，渲染开销可忽略。
   */
  const lyricsList = useMusicPlayerStore((s) => s.lyrics);
  const playbackForLyric = useMusicPlayerStore((s) => s.playbackState);
  const [lyricIdx, setLyricIdx] = useState(-1);
  const lyricAnchor = useRef({ pos: 0, at: Date.now(), last: -1 });

  useEffect(() => {
    if (
      !isFocused ||
      !lyricsList.length ||
      (playbackForLyric !== 'playing' && playbackForLyric !== 'loading')
    ) {
      setLyricIdx(-1);
      return;
    }
    const tick = () => {
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
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [lyricsList, playbackForLyric, isFocused]);

  const lyricLine = lyricIdx >= 0 ? lyricsList[lyricIdx]?.text || '' : '';

  const handleNav = useCallback(
    (item: NavItem) => {
      if (item.params) (navigation as any).navigate(item.route, item.params);
      else (navigation as any).navigate(item.route);
    },
    [navigation],
  );

  /**
   * 进音乐功能（最近播放卡面/播放中胶囊）：只导航进音乐库，不触发播放——
   * - 外部正在播 → 保持原声连续（不再二次 resume：重复解析+seekTo 会造成"暂停一下再加载"的中断感）
   * - 外部暂停/停止 → 保持暂停态进入，不自动开播（用户要求：没在播时进音乐功能不得自动续播）
   */
  const openMusicLibrary = useCallback(() => {
    handleNav({ title: '', desc: '', route: 'MusicLibraryScreen', icon: '' });
  }, [handleNav]);

  /** minibar：上一首 / 下一首 / 暂停播放 */
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

  /** 关闭音乐：清播放上下文（queue 保留以便再播），idle → 停 Exo 服务与系统媒体通知 */
  const handleStopMusic = useCallback(() => {
    const s = useMusicPlayerStore.getState();
    if (!s.queue.length || s.playbackState === 'idle') return;
    // ⚠️ 不能只 setState：原生 Exo 的声源不受 store 控制，清了状态还会继续播
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

  // 私信未读红点：进软件/回前台即拉取，前台每 60s 刷新；后台暂停，失败静默
  useEffect(() => {
    // 设置里有开关（默认开）：关掉就不再拉取、不显示角标
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
    const refreshUnread = () => {
      if (!alive || fetching || AppState.currentState !== 'active') return;
      fetching = true;
      pocketApi
        .getUnreadMessageCount()
        .then((res: any) => {
          if (!alive) return;
          const count = privateUnreadCount(res);
          if (count !== null) setPmUnread(count);
        })
        .catch(() => {})
        .finally(() => {
          fetching = false;
        });
    };
    const startPolling = () => {
      if (!alive || timer) return;
      timer = setInterval(refreshUnread, 60000);
    };
    const stopPolling = () => {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
    };
    refreshUnread();
    if (AppState.currentState === 'active') startPolling();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        refreshUnread();
        startPolling();
      } else {
        stopPolling();
      }
    });
    return () => {
      alive = false;
      stopPolling();
      sub.remove();
    };
  }, [token, settings.yaya_pm_unread_badge]);
  const toolChips = TOOL_CHIPS.map((i) => ({ ...i, title: t(i.title) }));

  const trackTitle = currentTrack?.title || '';
  const trackArtist = currentTrack?.artist || currentTrack?.joinMemberNames || '';
  // F3 修复：续播卡随播放状态显示「播放中/加载中/继续播放」，R2 曲目 URL 异步解析时用户有反馈
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

  /** 公演直播：跳 B 站直播屏 */
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

  return (
    <View style={[styles.outer, { backgroundColor: getPageBackground() }]}>
      {}
      <ScreenHeader title={t('牙牙消息')} hideBack />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingTop: 4,
          // 底部滚动空间：让 footer 可滚动到悬浮 dock 上方完全可见
          paddingBottom: 92 + insets.bottom,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* 问候区：一行问候 */}
        <View style={{ paddingHorizontal: spacing.md }}>
          {/* 问候：随手机当前时间变化（v2.7 字号缩小） */}
          <Text
            style={[
              typography.footnote,
              { color: palette.labelSecondary, marginBottom: spacing.md },
            ]}
          >
            {greeting}
          </Text>

          {!token ? (
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
          ) : null}
        </View>

        {/* C4：按 home_modules 注册表顺序渲染（未知 key 跳过；隐藏模块已在 resolve 时剔除） */}
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
                  fadeAnim={fadeAnim}
                  slideAnim={slideAnim}
                  onRetry={fetchLives}
                  onPressAll={() => handleNav({ title: '', desc: '', route: 'Media', icon: '' })}
                  onPressLive={openLive}
                  onSelectBanner={setBannerIndex}
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
