import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PerfFlatList } from '../components/PerfFlatList';

import {
  Animated,
  BackHandler,
  DeviceEventEmitter,
  Dimensions,
  FlatList,
  Image,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  TouchableOpacity,
  View,
} from 'react-native';
import { WebView } from 'react-native-webview';
import Video from 'react-native-video';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import * as ScreenOrientation from 'expo-screen-orientation';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { TabParamList } from '../navigation/types';
import { useSettingsStore, useUiStore, useMemberStore } from '../store';
import { FadeInView } from '../components/Motion';
import ScreenHeader from '../components/ScreenHeader';
import { VODItem, Member } from '../types';
import { formatTimestamp } from '../utils/format';
import { errorMessage, normalizeUrl, pickText, unwrapList } from '../utils/data';
import { getResumePosition, saveResumePosition, clearResumePosition } from '../utils/resumePosition';
import pocketApi from '../api/pocket48';
import { getPlayerHtml } from '../components/media/player';
import { LiveExoView, setLiveImmersiveMode } from '../native/LivePlayer';
import { DanmakuOverlay } from '../components/DanmakuOverlay';
import DanmakuSettingsSheet from '../components/DanmakuSettingsSheet';
import { parseDanmaku, DanmakuItem } from '../utils/danmaku';
import { memberSearchText } from '../utils/members';
import { PlayerTopBar, PlayerBottomBar, PlayerMorePanel, MoreItem } from '../components/media/PlayerChrome';
import { Skeleton } from '../components/Skeleton';

/** 回放列表加载骨架：与卡片同构（左封面 + 右侧两行），统一用 Skeleton 微光，避免「转圈 + 文字」混排闪烁 */
function VodCardSkeleton({ dark }: { dark?: boolean }) {
  return (
    <View style={{ paddingHorizontal: 12, paddingTop: 6 }}>
      {Array.from({ length: 6 }).map((_, i) => (
        <View key={i} style={[styles.card, dark && styles.cardDark]}>
          <Skeleton width={112} height={78} radius={18} dark={dark} />
          <View style={[styles.cardInfo, { gap: 8 }]}>
            <Skeleton width="82%" height={14} radius={6} dark={dark} />
            <Skeleton width="55%" height={12} radius={6} dark={dark} />
          </View>
        </View>
      ))}
    </View>
  );
}

type MediaRouteProp = RouteProp<TabParamList, 'Media'>;

const PLAY_URL_FIELDS = [
  'playStreamPath',
  'playUrlPath',
  'playPathUrl',
  'streamUrl',
  'streamURL',
  'playUrl',
  'urlPath',
  'playPath',
  'streamPath',
  'path',
  'src',
  'pullStreamPath',
  'liveStreamPath',
  'livePlayStreamPath',
  'streamPathHd',
  'streamPathHigh',
  'streamPathNormal',
  'streamPathOrigin',
  'url',
  'liveUrl',
  'm3u8Url',
  'flvUrl',
  'hlsUrl',
  'videoUrl',
  'recordUrl',
  'mediaUrl',
  'filePath',
  'content.playStreamPath',
  'content.playUrlPath',
  'content.playPathUrl',
  'content.streamUrl',
  'content.playUrl',
  'content.playPath',
  'content.streamPath',
  'content.pullStreamPath',
  'content.liveStreamPath',
  'content.livePlayStreamPath',
  'content.url',
  'data.playStreamPath',
  'data.playUrlPath',
  'data.playPathUrl',
  'data.streamUrl',
  'data.playUrl',
  'data.playPath',
  'data.streamPath',
  'data.pullStreamPath',
  'data.liveStreamPath',
  'data.livePlayStreamPath',
  'data.url',
  'content.playStreams.0.streamPath',
  'data.playStreams.0.streamPath',
];

function streamScore(url: string): number {
  const lower = url.toLowerCase();
  if (lower.includes('.m3u8') || lower.includes('format=hls')) return 100;
  if (lower.startsWith('https://') && lower.includes('.flv')) return 60;
  if (lower.startsWith('http://') && lower.includes('.flv')) return 50;
  if (lower.startsWith('rtmp://')) return 20;
  return 40;
}

function liveStreamScore(url: string): number {
  const lower = url.toLowerCase();
  if (lower.startsWith('rtmp://')) return 120;
  if (lower.startsWith('https://') && lower.includes('.flv')) return 105;
  if (lower.startsWith('http://') && lower.includes('.flv')) return 95;
  if (lower.includes('.m3u8') || lower.includes('format=hls')) return 80;
  return streamScore(url);
}

/**
 * 为直播/录播项构造可搜索文本 + 数字串，支持「时间搜索」。
 * 数字串同时给出「补零」与「不补零」两种形态，使 2026-07-20 / 0720 / 7-20 / 2026/7/20
 * 等自然输入都能命中，解决原先只能匹配 YYYY-MM-DD HH:mm:ss 单一格式的问题。
 */
function buildMediaSearchText(item: any): { text: string; digits: string } {
  const ts = formatTimestamp(item.startTime);
  const d = new Date(String(item.startTime || '').replace(/-/g, '/'));
  let padded = '';
  let loose = '';
  if (!Number.isNaN(d.getTime())) {
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    const day = d.getDate();
    const hh = d.getHours();
    const mm = d.getMinutes();
    const ss = d.getSeconds();
    padded = `${y}${String(m).padStart(2, '0')}${String(day).padStart(2, '0')}${String(hh).padStart(2, '0')}${String(mm).padStart(2, '0')}${String(ss).padStart(2, '0')}`;
    loose = `${y}${m}${day}${hh}${mm}${ss}`;
  }
  const text = [item.title, item.nickname, item.liveRoomTitle, String(item.liveId || ''), ts]
    .filter(Boolean).join(' ').toLowerCase();
  const digits = [ts.replace(/\D/g, ''), padded, loose].filter(Boolean).join('');
  return { text, digits };
}

// 取录制时间的日期键 YYYY-MM-DD，用于日历筛选精确匹配
function dateKeyOf(startTime: any): string {
  const d = new Date(String(startTime || '').replace(/-/g, '/'));
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// 录播日历选择弹层（纯 RN 月历，零依赖，对标 pocket48_lite 的 CalendarMonth 按钮 + DatePicker）
function CalendarSheet({
  visible,
  initial,
  onSelect,
  onClose,
}: {
  visible: boolean;
  initial: Date | null;
  onSelect: (d: Date) => void;
  onClose: () => void;
}) {
  const isDarkC = useSettingsStore((s) => s.settings.theme === 'dark');
  const base = initial || new Date();
  const [view, setView] = useState(() => new Date(base.getFullYear(), base.getMonth(), 1));
  const year = view.getFullYear();
  const month = view.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={styles.calMask} activeOpacity={1} onPress={onClose}>
        <View style={styles.calSheet} onStartShouldSetResponder={() => true}>
          <View style={styles.calHeader}>
            <TouchableOpacity onPress={() => setView(new Date(year, month - 1, 1))} hitSlop={{ top: 8, bottom: 8, left: 12, right: 12 }}>
              <MaterialCommunityIcons name="chevron-left" size={24} color={isDarkC ? '#eee' : '#333'} />
            </TouchableOpacity>
            <Text style={[styles.calTitle]}>{year} 年 {month + 1} 月</Text>
            <TouchableOpacity onPress={() => setView(new Date(year, month + 1, 1))} hitSlop={{ top: 8, bottom: 8, left: 12, right: 12 }}>
              <MaterialCommunityIcons name="chevron-right" size={24} color={isDarkC ? '#eee' : '#333'} />
            </TouchableOpacity>
          </View>
          <View style={styles.calWeekRow}>
            {weekdays.map((w) => (
              <Text key={w} style={[styles.calWeek]}>{w}</Text>
            ))}
          </View>
          <View style={styles.calGrid}>
            {cells.map((d, i) =>
              d ? (
                <TouchableOpacity key={i} style={styles.calDay} onPress={() => onSelect(new Date(year, month, d))}>
                  <Text style={[styles.calDayText]}>{d}</Text>
                </TouchableOpacity>
              ) : (
                <View key={i} style={styles.calDay} />
              ),
            )}
          </View>
          <View style={styles.calFooter}>
            <TouchableOpacity onPress={onClose} style={styles.calCancel}>
              <Text style={[styles.calCancelText]}>取消</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => { onSelect(new Date()); onClose(); }}
              style={styles.calToday}
            >
              <Text style={styles.calTodayText}>今天</Text>
            </TouchableOpacity>
          </View>
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

function pickPlayableUrls(raw: any, preferLive = false): string[] {
  const candidates: string[] = [];
  const direct = normalizeUrl(pickText(raw, PLAY_URL_FIELDS));
  if (direct) candidates.push(direct);
  const streamList = unwrapList(raw, [
    'streams',
    'playStreams',
    'liveStreams',
    'urls',
    'content.streams',
    'content.playStreams',
    'content.urls',
    'data.streams',
    'data.playStreams',
    'content.liveStreams',
    'content.streamList',
    'content.playStreamList',
    'data.liveStreams',
    'data.streamList',
    'data.playStreamList',
    'data.urls',
  ]);
  for (const stream of streamList) {
    const url = normalizeUrl(pickText(stream, PLAY_URL_FIELDS));
    if (url) candidates.push(url);
  }
  const score = preferLive ? liveStreamScore : streamScore;
  return Array.from(new Set(candidates.filter(Boolean))).sort((a, b) => score(b) - score(a));
}

function pickPlayableUrl(raw: any): string {
  return pickPlayableUrls(raw)[0] || '';
}

function streamNeedsProxy(url: string): boolean {
  const lower = url.toLowerCase();
  return lower.startsWith('rtmp://') || lower.includes('.flv');
}

function normalizeLiveList(res: any): VODItem[] {
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

  return source.map((raw: any, index: number) => ({
    ...raw,
    liveId: String(pickText(raw, ['liveId', 'id', 'live_id', 'roomId'], String(index))),
    title: pickText(raw, ['title', 'liveTitle', 'liveRoomTitle', 'roomName', 'subject'], '无标题'),
    liveRoomTitle: pickText(raw, ['liveRoomTitle', 'title', 'liveTitle']),
    nickname: pickText(raw, ['nickname', 'nickName', 'userInfo.nickname', 'userInfo.nickName', 'ownerName']),
    startTime: raw.startTime || raw.stime || raw.start_time || raw.ctime || raw.liveStartTime || raw.beginTime,
    endTime: raw.endTime || raw.etime || raw.end_time || raw.liveEndTime,
    liveCover: normalizeUrl(pickText(raw, [
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
    ])),
    coverPath: normalizeUrl(pickText(raw, ['coverPath', 'cover', 'coverUrl'])),
    playUrl: pickPlayableUrl(raw),
    playPath: normalizeUrl(pickText(raw, ['playPath', 'playUrl', 'url'])),
    liveType: Number(pickText(raw, ['liveType', 'type', 'mediaType'], '1')),
    screenDirection: Number(pickText(raw, ['screenDirection', 'orientation'], '0')),
  })) as VODItem[];
}

function mergeUniqueLiveItems(prev: VODItem[], next: VODItem[]) {
  const seen = new Set(prev.map((item: any, index) => String(item.liveId || item.id || item.title || index)));
  const merged = [...prev];
  for (const item of next as any[]) {
    const key = String(item.liveId || item.id || item.title || merged.length);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  return merged;
}

function playerSource(url: string) {
  return {
    uri: url,
    headers: {
      'User-Agent': 'PocketFans201807/7.0.41 (iPhone; iOS 16.3.1; Scale/2.00)',
      Referer: 'https://h5.48.cn/',
    },
  };
}

function normalizeGiftList(res: any): any[] {
  const categories = unwrapList(res, ['content', 'content.list', 'data.content', 'data.list', 'list']);
  const gifts: any[] = [];
  for (const item of categories) {
    const nested = unwrapList(item, ['giftList', 'gifts', 'list']);
    if (nested.length) gifts.push(...nested);
    else if (item?.giftId || item?.id) gifts.push(item);
  }
  const seen = new Set<string>();
  return gifts.filter((gift) => {
    const id = String(gift.giftId || gift.id || '');
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function normalizeLiveRank(res: any): any[] {
  let list = unwrapList(res, [
    'content.rankList',
    'content.userRankList',
    'content.userRankingList',
    'content.contributionList',
    'content.list',
    'content.data',
    'content.data.list',
    'content.data.rankList',
    'data.rankList',
    'data.userRankList',
    'data.userRankingList',
    'data.contributionList',
    'data.list',
    'rankList',
    'userRankList',
    'userRankingList',
    'contributionList',
    'list',
  ]);
  if (!list.length) {
    const content = res?.content || res?.data || res;
    if (content && typeof content === 'object') {
      const found: any[] = [];
      const walk = (node: any, depth = 0) => {
        if (!node || depth > 5) return;
        if (Array.isArray(node)) {
          node.forEach((item) => walk(item, depth + 1));
          return;
        }
        if (typeof node !== 'object') return;
        const hasUser = pickText(node, ['nickName', 'nickname', 'userName', 'name', 'userInfo.nickname', 'userInfo.nickName', 'user.nickname', 'user.nickName']);
        const hasValue = pickText(node, ['score', 'total', 'cost', 'money', 'giftValue', 'value', 'amount', 'contribution', 'count', 'giftNum']);
        if (hasUser || hasValue || node.userInfo || node.user) found.push(node);
        Object.values(node).forEach((value) => walk(value, depth + 1));
      };
      walk(content);
      list = found;
    }
  }
  return list.map((item: any, index: number) => ({
    ...item,
    userId: pickText(item, ['userId', 'uid', 'id', 'account', 'userInfo.userId', 'userInfo.id', 'user.userId', 'user.id', 'user.userIdStr', 'user.userAccount', 'memberInfo.userId', 'memberInfo.id']),
    rank: Number(item.rank || item.no || item.index || index + 1),
    name: pickText(item, [
      'nickName',
      'nickname',
      'userName',
      'name',
      'senderName',
      'userInfo.nickName',
      'userInfo.nickname',
      'userInfo.name',
      'user.nickName',
      'user.nickname',
      'user.userName',
      'user.name',
      'memberInfo.nickName',
      'memberInfo.nickname',
    ], '\u7528\u6237 ' + (index + 1)),
    avatar: normalizeUrl(pickText(item, [
      'avatar',
      'headImg',
      'picPath',
      'userInfo.avatar',
      'userInfo.headImg',
      'user.avatar',
      'user.headImg',
      'user.userAvatar',
      'memberInfo.avatar',
    ])),
    value: pickText(item, ['score', 'total', 'cost', 'money', 'giftValue', 'value', 'amount', 'contribution', 'count', 'giftNum'], ''),
  }));
}

function rankNameIsFallback(row: any, index: number) {
  const name = String(row.name || '').trim();
  const fallbackPrefix = '\u7528\u6237';
  return !name || name === `${fallbackPrefix} ${index + 1}` || new RegExp(`^${fallbackPrefix}\\s*\\d+$`).test(name);
}
function profileFromUserRes(res: any) {
  const info = res?.content?.userInfo || res?.content?.user || res?.content || res?.data?.userInfo || res?.data?.user || res?.data || res || {};
  return {
    name: pickText(info, [
      'nickName', 'nickname', 'userName', 'name',
      'profile.nickName', 'profile.nickname',
      'userInfo.nickName', 'userInfo.nickname',
      'user.nickName', 'user.nickname', 'user.userName',
    ]),
    avatar: normalizeUrl(pickText(info, [
      'avatar', 'headImg', 'headUrl', 'picPath',
      'profile.avatar', 'profile.headImg',
      'userInfo.avatar', 'userInfo.headImg',
      'user.avatar', 'user.headImg', 'user.userAvatar',
    ])),
  };
}

function giftName(gift: any): string {
  return String(gift.giftName || gift.name || '未知礼物');
}

function giftCost(gift: any): number {
  return Number(gift.money ?? gift.cost ?? gift.canSendNum ?? 0) || 0;
}

function giftImage(gift: any): string {
  return normalizeUrl(gift.picPath || gift.icon || gift.giftPic || gift.url || '');
}

function acceptUserId(item: any): string {
  return String(item?.userInfo?.userId || item?.user?.userId || item?.userId || item?.ownerId || item?.memberId || '');
}


export default function MediaScreen() {
  const route = useRoute<MediaRouteProp>();
  const navigation = useNavigation<any>();
  const isDark = useSettingsStore((state) => state.settings.theme === 'dark');
  const setTabBarHidden = useUiStore((state) => state.setTabBarHidden);
  const showToast = useUiStore((state) => state.showToast);
  const members = useMemberStore((state) => state.members);
  const [tab, setTab] = useState<'live' | 'vod'>(route.params?.mode ?? 'live');
  const [vodList, setVodList] = useState<VODItem[]>([]);
  const [liveList, setLiveList] = useState<VODItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [nextCursor, setNextCursor] = useState(0);
  const [error, setError] = useState('');
  const [playerError, setPlayerError] = useState('');
  const [useWebPlayer, setUseWebPlayer] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  // 横屏/竖屏切换（仅旋转，独立于「全屏」沉浸；方向锁由下方统一 effect 处理）
  const [isLandscape, setIsLandscape] = useState(false);
  // 画面旋转（翻转）：0/90/180/270，每按一次步进 90°
  const [videoRotate, setVideoRotate] = useState(0);
  const [playing, setPlaying] = useState<{ url: string; urls: string[]; title: string; cover?: string; item: any; isLive: boolean; needsVlc: boolean } | null>(null);
  // 续播位置：打开回放时读取上次进度，播放中由 WebView 回传进度落盘
  const [webResumeTime, setWebResumeTime] = useState(0);
  const [giftVisible, setGiftVisible] = useState(false);
  const [gifts, setGifts] = useState<any[]>([]);
  const [selectedGift, setSelectedGift] = useState<any | null>(null);
  const [giftNum, setGiftNum] = useState('1');
  const [giftStatus, setGiftStatus] = useState('');
  const [balance, setBalance] = useState('');
  const [hasMore, setHasMore] = useState(true);
  const [rankVisible, setRankVisible] = useState(false);
  const [rankRows, setRankRows] = useState<any[]>([]);

  // 打开回放时读取上次观看进度，用于 WebView 续播
  useEffect(() => {
    if (!playing?.url) {
      setWebResumeTime(0);
      return;
    }
    let alive = true;
    getResumePosition(playing.url)
      .then((t) => { if (alive) setWebResumeTime(t); })
      .catch(() => {});
    return () => { alive = false; };
  }, [playing?.url]);

  // 拉取/轮询弹幕并解析；失败静默，不拖垮播放
  useEffect(() => {
    if (!playing) {
      setDanmaku([]);
      setShowDanmaku(false);
      return;
    }
    const lid = String(playing.item?.liveId || playing.item?.id || '');
    if (!lid) { setDanmaku([]); setShowDanmaku(false); return; }
    let alive = true;
    const seenMsg = new Set<string>();
    const collect = (infos: any[]): DanmakuItem[] => {
      const flat: DanmakuItem[] = [];
      for (const b of infos) {
        const parsed = parseDanmaku(b.content);
        if (parsed.length) flat.push(...parsed);
        else flat.push({ time: Number(b.time) || 0, text: String(b.content || ''), ...(b.user ? { nick: b.user } : {}) });
      }
      let items = flat.filter((d) => d && d.text) as DanmakuItem[];
      if (!items.length) return items;
      // 时间轴归一化：覆盖接口返回的多种 time 形态，保证弹幕能对上视频相对进度飘出来
      //  1) 毫秒时间戳（>1e6）：先转秒
      //  2) 绝对秒时间戳（>1e7，远超任何视频时长）：以最早弹幕为 0 做相对偏移
      //  3) 全 0 / 异常（maxT<=0）：按序均匀分配，至少保证弹幕能飘
      const rangeOf = (arr: DanmakuItem[]) => arr.reduce(
        (acc, d) => ({ max: Math.max(acc.max, d.time), min: Math.min(acc.min, d.time) }),
        { max: 0, min: Infinity },
      );
      let { max: maxT, min: minT } = rangeOf(items);
      if (maxT > 1e6) {
        items.forEach((d) => { d.time = d.time / 1000; });
        ({ max: maxT, min: minT } = rangeOf(items));
      }
      if (maxT > 1e7) {
        const base = minT;
        items.forEach((d) => { d.time = d.time - base; });
        ({ max: maxT } = rangeOf(items));
      }
      if (maxT <= 0) {
        items.forEach((d, i) => { d.time = i * 1.2; });
      }
      items.sort((a, b) => a.time - b.time);
      return items;
    };
    if (playing.isLive) {
      // 直播：轮询 barrage/list 累积实时弹幕
      const poll = async () => {
        try {
          const infos = await pocketApi.getLiveBarrage(lid);
          if (!alive) return;
          const items = collect(infos);
          if (!items.length) return;
          setDanmaku((prev) => {
            const merged = [...prev];
            for (const it of items) {
              const key = it.nick ? `${it.nick}:${it.text}` : it.text;
              if (!seenMsg.has(key)) { seenMsg.add(key); merged.push(it); }
            }
            merged.sort((a, b) => a.time - b.time);
            return merged.slice(-800);
          });
          setShowDanmaku(true);
        } catch {}
      };
      poll();
      const id = setInterval(poll, 5000);
      return () => { alive = false; clearInterval(id); };
    }
    // 回放：从 LRC 文件拉取（参考 pocket48_lite：录播弹幕在 getLiveOne 的
    // content.msgFilePath 指向的 LRC 文件，而非 barrage/list；格式 [hh:mm:ss.fff]昵称\t内容，
    // 已由 parseDanmaku 解析为「秒」对上 playbackTime）
    pocketApi.getLiveLrc(lid)
      .then((text) => {
        if (!alive) return;
        if (!text) {
          setDanmaku([]);
          setShowDanmaku(false);
          showToast('该视频暂无弹幕');
          return;
        }
        const items = parseDanmaku(text);
        setDanmaku(items);
        setShowDanmaku(items.length > 0);
        showToast(items.length > 0 ? `弹幕 ${items.length} 条` : '该视频暂无弹幕');
      })
      .catch(() => { if (alive) setDanmaku([]); });
    return () => { alive = false; };
  }, [playing?.url, playing?.isLive]);

  // 回放时推进播放进度驱动弹幕：
  //  - 网页播放器(WebView)无逐帧 onProgress，用 250ms 插值平滑（每 2s 由 onMessage 校正）
  //  - 原生 Video 已有 onProgress 实时驱动，无需插值，避免与真实进度冲突
  useEffect(() => {
    if (!playing || playing.isLive) { setPlaybackTime(0); return; }
    if (!useWebPlayer) { setPlaybackTime(webResumeTime || 0); return; }
    setPlaybackTime(webResumeTime || 0);
    const id = setInterval(() => setPlaybackTime((t) => t + 0.25), 250);
    return () => clearInterval(id);
  }, [playing?.url, playing?.isLive, webResumeTime, useWebPlayer]);
  const [rankStatus, setRankStatus] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const [announceVisible, setAnnounceVisible] = useState(false);
  const [announceExpanded, setAnnounceExpanded] = useState(false);
  const loadingRef = useRef(false);
  const playingRef = useRef<typeof playing>(null);
  // v2.6: group filter + search
  const [groupId, setGroupId] = useState(0);
  const [search, setSearch] = useState('');
  // 弹幕：解析后的弹幕数组 + 是否显示 + 当前播放进度（驱动弹幕发射）
  const [danmaku, setDanmaku] = useState<DanmakuItem[]>([]);
  const [showDanmaku, setShowDanmaku] = useState(false);
  const [playbackTime, setPlaybackTime] = useState(0);
  // 播放器控制（哔哩哔哩风格自定义控制条）
  const videoRef = useRef<any>(null);
  const [duration, setDuration] = useState(0);
  const [paused, setPaused] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  // 搜索：选中成员后，搜索框转为「该成员的标题/日期」过滤
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [dateFilter, setDateFilter] = useState<Date | null>(null);
  const [showCalendar, setShowCalendar] = useState(false);
  const [showDanmakuSettings, setShowDanmakuSettings] = useState(false);
  const [moreVisible, setMoreVisible] = useState(false);
  // 播放器控制条（B站式沉浸：点击视频区显隐，播放中自动隐藏）
  const [controlsVisible, setControlsVisible] = useState(true);
  const controlsOpacity = useRef(new Animated.Value(1)).current;
  const hideControlsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pausedRef = useRef(paused);
  const seekLockRef = useRef(0);
  useEffect(() => { pausedRef.current = paused; }, [paused]);
  const showControls = useCallback((autoHide = true) => {
    setControlsVisible(true);
    Animated.timing(controlsOpacity, { toValue: 1, duration: 180, useNativeDriver: true }).start();
    if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current);
    if (autoHide && !pausedRef.current) {
      hideControlsTimer.current = setTimeout(() => {
        setControlsVisible(false);
        Animated.timing(controlsOpacity, { toValue: 0, duration: 180, useNativeDriver: true }).start();
      }, 3000);
    }
  }, [controlsOpacity]);
  const toggleControls = useCallback(() => {
    if (controlsVisible) {
      setControlsVisible(false);
      Animated.timing(controlsOpacity, { toValue: 0, duration: 180, useNativeDriver: true }).start();
    } else {
      showControls();
    }
  }, [controlsVisible, showControls]);
  // 新视频载入即显示控制条，播放中 3 秒无操作自动隐藏（B站式沉浸）
  useEffect(() => { if (playing?.url) showControls(true); }, [playing?.url, showControls]);

  const GROUPS: { label: string; id: number; match: string }[] = [
    { label: '全部', id: 0, match: '' },
    { label: 'SNH', id: 1, match: 'SNH48' },
    { label: 'BEJ', id: 2, match: 'BEJ48' },
    { label: 'GNZ', id: 3, match: 'GNZ48' },
    { label: 'CKG', id: 4, match: 'CKG48' },
    { label: 'CGT', id: 6, match: 'CGT48' },
  ];
  const list = useMemo(() => {
    let raw = tab === 'live' ? liveList : vodList;
    // 团体筛选
    if (groupId !== 0) {
      const g = GROUPS.find((x) => x.id === groupId);
      if (g && g.match) {
        raw = raw.filter((item) =>
          (item.nickname || '').includes(g.match) ||
          (item.title || '').includes(g.match) ||
          (item.liveRoomTitle || '').includes(g.match)
        );
      }
    }
    // 选中成员后：先把列表收敛到该成员（昵称/标题/房间名/ID 命中），再叠加关键词搜索
    if (selectedMember) {
      const key = selectedMember.ownerName.toLowerCase();
      const mid = String(selectedMember.id || '');
      raw = raw.filter((item) =>
        (item.nickname || '').toLowerCase().includes(key) ||
        (item.title || '').toLowerCase().includes(key) ||
        (item.liveRoomTitle || '').toLowerCase().includes(key) ||
        (mid && String(item.liveId || '').includes(mid))
      );
    }
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
      // 数字优先：时间搜索（2026-07-20 / 0720 / 7-20 / 2026/7/20 等自然输入都能命中）
      if (qDigits.length >= 3 && digits.includes(qDigits)) return true;
      if (text.includes(q)) return true;
      return false;
    });
  }, [tab, liveList, vodList, search, groupId, selectedMember, dateFilter]);

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

  // v2.6: auto-play when navigated from room with playLiveId
  useEffect(() => {
    const lid = route.params?.playLiveId;
    if (!lid) return;
    const isLive = route.params?.mode !== 'vod';
    (async () => {
      try {
        let detail: any = await pocketApi.getLiveOne(lid).catch(() => null);
        if (!detail) detail = await pocketApi.getOpenLiveOne(lid).catch(() => null);
        const item = (detail?.content || detail?.data || detail || {}) as any;
        const urls = pickPlayableUrls(item, isLive);
        const url = urls[0] || '';
        if (!url) { showToast('未解析到播放地址'); return; }
        const title = route.params?.playTitle || item.title || item.liveRoomTitle || '直播';
        const cover = route.params?.playCover || item.liveCover || item.coverPath || '';
        setPlaying({
          url,
          urls,
          title,
          cover: normalizeUrl(cover),
          item: { ...item, liveId: lid, title, liveCover: cover },
          isLive,
          needsVlc: streamNeedsProxy(url),
        });
        // Switch tab to match mode
        if (!isLive && tab !== 'vod') switchTab('vod');
      } catch (e) { showToast(`播放失败：${errorMessage(e)}`); }
    })();
  }, [route.params?.playLiveId]);

  useEffect(() => {
    setTabBarHidden(!!playing);
    return () => setTabBarHidden(false);
  }, [playing, setTabBarHidden]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!playing) return false;
      setIsFullscreen(false);
      setIsLandscape(false);
      setLiveImmersiveMode(false);
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
      setPlaying(null);
      return true;
    });
    return () => subscription.remove();
  }, [playing]);

  const doFetch = useCallback(async (mode: 'live' | 'vod', cursor = 0, append = false) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    setError('');
    try {
      const res = await pocketApi.getLiveList({ next: cursor, record: mode === 'vod', debug: true });
      const next = normalizeLiveList(res);
      const nextToken = Number((res as any)?.content?.next ?? (res as any)?.data?.next ?? (res as any)?.next ?? 0) || 0;
      setNextCursor(nextToken);
      // 翻页终止条件：本页有数据 且 游标确有前进（nextToken>0 且不等于本次请求的 cursor）。
      // 加 `nextToken !== cursor` 兜底，防止接口返回不变游标却持续吐相同数据导致的死循环。
      setHasMore(next.length > 0 && nextToken > 0 && nextToken !== cursor);
      if (mode === 'live') setLiveList((prev) => (append ? mergeUniqueLiveItems(prev, next) : next));
      else setVodList((prev) => (append ? mergeUniqueLiveItems(prev, next) : next));
    } catch (err) {
      setError(errorMessage(err));
      setHasMore(false);
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, []); // stable ref, reads groupId from groupIdRef

  const reloadList = useCallback(() => {
    // 刷新时保留当前列表内容，避免列表被清空导致骨架屏闪一下；
    // 仅当列表本就为空（首屏）时才走骨架屏逻辑。
    setNextCursor(0); setHasMore(true);
    doFetch(tab, 0);
  }, [doFetch, tab]);

  // initial load
  useEffect(() => { doFetch(tab, 0); }, [doFetch, tab]);

  // 选中成员时切到「回放」并重置列表，立即触发首屏加载。
  // 用 setTimeout(0) 让上面的 setState 先提交，避免读到切换前的旧 tab；
  // 覆盖「已在 vod tab 时初始加载 effect 不触发」以及「切 tab 时 loadingRef 把自动翻页挡掉」两种情况。
  // 首屏加载后，下方自动翻页 effect 会在未命中该成员时继续补齐更多页。
  useEffect(() => {
    if (!selectedMember) return;
    setVodList([]); setNextCursor(0); setHasMore(true);
    setTab('vod');
    const id = setTimeout(() => doFetch('vod', 0), 0);
    return () => clearTimeout(id);
  }, [selectedMember, doFetch]);

  // 搜索 / 选中成员后：自动翻页直到「翻完所有页」，收集该成员/关键词下的全部录播，
  // 不再只翻到命中 1 条就停（修复「选定成员后只加载一条、刷新也还是一条」）。
  // 未筛选时（无搜索、无成员）不自动翻页，仅靠用户上滑 onEndReached 触发。
  useEffect(() => {
    if (loadingRef.current || loading) return;
    const haveFilter = !!search.trim() || !!selectedMember;
    if (!haveFilter || !hasMore) return;
    if (selectedMember && tab !== 'vod') return; // 成员检索固定在录播页，等 tab 切到 vod 再翻
    const id = setTimeout(() => loadMore(), 150);
    return () => clearTimeout(id);
  }, [search, selectedMember, hasMore, loading, tab]);

  useEffect(() => () => {
    setLiveImmersiveMode(false);
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
  }, []);

  // 横屏/全屏解耦：全屏=沉浸+横屏；横屏切换=仅旋转。两者任一为真即锁定横屏。
  useEffect(() => {
    if (!playing) return;
    const wantLandscape = isFullscreen || isLandscape;
    setLiveImmersiveMode(!!playing && isFullscreen);
    ScreenOrientation.lockAsync(
      wantLandscape ? ScreenOrientation.OrientationLock.LANDSCAPE : ScreenOrientation.OrientationLock.PORTRAIT_UP,
    ).catch(() => {});
  }, [isFullscreen, isLandscape, playing]);

  const closePlayer = () => {
    setIsFullscreen(false);
    setIsLandscape(false);
    setLiveImmersiveMode(false);
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    setPlaying(null);
    setAnnouncement('');
    setAnnounceVisible(false);
    setAnnounceExpanded(false);
  };

  // v2.6: came from room with playLiveId → hide list, back goes to room
  const fromRoom = !!route.params?.playLiveId;
  useEffect(() => {
    if (fromRoom && !playing) {
      navigation.navigate('Rooms' as any);
    }
  }, [fromRoom, playing]);

  const refreshAnnouncement = async () => {
    if (!playing || !playing.isLive) return;
    try {
      const detail = await pocketApi.getLiveOne(playing.item.liveId).catch(() => null);
      const detail2 = !detail ? await pocketApi.getOpenLiveOne(playing.item.liveId).catch(() => null) : null;
      const d = (detail || detail2 || {}) as any;
      const annText = d?.content?.announcement || d?.announcement || d?.data?.announcement || '';
      setAnnouncement(annText || '暂无公告');
      setAnnounceVisible(true);
      setAnnounceExpanded(true);
    } catch {
      setAnnouncement('公告加载失败');
      setAnnounceVisible(true);
      setAnnounceExpanded(true);
    }
  };

  const switchTab = (next: 'live' | 'vod') => {
    setTab(next);
    setNextCursor(0);
    setHasMore(true);
    // rely on useEffect to trigger fetch
  };

  const refreshList = () => {
    reloadList();
  };

  const loadMore = () => {
    if (loading || loadingRef.current || !hasMore) return;
    doFetch(tab, nextCursor, true);
  };

  const startPlay = async (item: VODItem) => {
    setError('');
    setPlayerError('');
    setUseWebPlayer(false);
    setIsFullscreen(false);
    setLiveImmersiveMode(false);
    setPaused(false);
    setDuration(0);
    setPlaybackTime(0);
    setLoading(true);
    try {
      let urls = pickPlayableUrls(item, tab === 'live');
      let detail: any = item;
      const initialUrl = urls[0] || '';
      if (initialUrl) {
        setPlaying({
          url: initialUrl,
          urls,
          title: item.title || item.liveRoomTitle || '直播 / 回放',
          cover: item.liveCover || item.coverPath,
          item,
          isLive: tab === 'live',
          needsVlc: streamNeedsProxy(initialUrl),
        });
      }
      if (item.liveId) {
        detail = await pocketApi.getLiveOne(item.liveId).catch(() => null);
        urls = [...pickPlayableUrls(detail, tab === 'live'), ...urls];
        const d = (detail || {}) as any;
        const annText = d?.content?.announcement || d?.announcement || d?.data?.announcement || '';
        if (annText) {
          setAnnouncement(annText);
          setAnnounceVisible(true);
        }
        else {
          const detail2 = await pocketApi.getOpenLiveOne(item.liveId).catch(() => null);
          if (detail2) {
            const d2 = detail2 as any;
            const annText2 = d2?.content?.announcement || d2?.announcement || d2?.data?.announcement || '';
            if (annText2) { setAnnouncement(annText2); setAnnounceVisible(true); setAnnounceExpanded(false); }
          }
        }
        if (!urls.filter(Boolean).length) {
          detail = await pocketApi.getOpenLiveOne(item.liveId).catch(() => null);
          urls = [...pickPlayableUrls(detail, tab === 'live'), ...urls];
        }
      }
      urls = Array.from(new Set(urls.filter(Boolean)));
      const baseUrl = urls[0] || '';
      if (!baseUrl) {
        setError('这个条目没有可播放地址，接口也没有返回播放流');
        return;
      }
      setPlaying({
        url: baseUrl,
        urls,
        title: item.title || item.liveRoomTitle || '直播 / 回放',
        cover: item.liveCover || item.coverPath,
        item: { ...item, ...(detail?.content || detail?.data || detail) },
        isLive: tab === 'live',
        needsVlc: streamNeedsProxy(baseUrl),
      });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const openGiftPanel = async (source = playingRef.current || playing) => {
    if (!source?.item?.liveId) {
      setGiftStatus('当前直播缺少 liveId，不能送礼');
      setGiftVisible(true);
      return;
    }
    setGiftVisible(true);
    setGiftStatus('');
    setSelectedGift(null);
    try {
      const [giftRes, moneyRes] = await Promise.all([
        pocketApi.getGiftList(String(source.item.liveId)),
        pocketApi.getUserMoney().catch(() => null),
      ]);
      const next = normalizeGiftList(giftRes);
      setGifts(next);
      setBalance(moneyRes?.content?.moneyTotal !== undefined ? String(moneyRes.content.moneyTotal) : '');
      setGiftStatus(next.length ? `已加载 ${next.length} 个礼物` : '礼物列表为空');
    } catch (err) {
      setGifts([]);
      setGiftStatus(`加载礼物失败：${errorMessage(err)}`);
    }
  };

  const sendGift = async () => {
    if (!playing || !selectedGift) {
      setGiftStatus('请先选择礼物');
      return;
    }
    const num = Math.max(1, Math.floor(Number(giftNum) || 1));
    const targetUserId = acceptUserId(playing.item);
    if (!targetUserId) {
      setGiftStatus('无法获取主播 ID，不能送礼');
      return;
    }
    setGiftStatus('正在发送...');
    try {
      await pocketApi.sendGift({
        giftId: String(selectedGift.giftId || selectedGift.id),
        liveId: String(playing.item.liveId),
        acceptUserId: targetUserId,
        giftNum: num,
      });
      setGiftStatus(`已送出 ${num} 个 ${giftName(selectedGift)}`);
      const money = await pocketApi.getUserMoney().catch(() => null);
      if (money?.content?.moneyTotal !== undefined) setBalance(String(money.content.moneyTotal));
    } catch (err) {
      setGiftStatus(`送礼失败：${errorMessage(err)}`);
    }
  };

  const openRankPanel = async (source = playingRef.current || playing) => {
    if (!source?.item?.liveId) {
      setRankRows([]);
      setRankStatus('当前直播缺少 liveId，不能获取贡献榜');
      setRankVisible(true);
      return;
    }
    setRankVisible(true);
    setRankStatus('');
    try {
      const res = await pocketApi.getLiveRank(String(source.item.liveId));
      const rows = normalizeLiveRank(res);
      setRankRows(rows);
      if (rows.some((row, index) => row.userId && (!row.avatar || rankNameIsFallback(row, index)))) {
        setRankStatus(`\u6b63\u5728\u8865\u5168 ${rows.length} \u4f4d\u8d21\u732e\u7528\u6237\u8d44\u6599...`);
        const enriched = await Promise.all(rows.map(async (row, index) => {
          if (!row.userId || (row.avatar && !rankNameIsFallback(row, index))) return row;
          try {
            const profile = profileFromUserRes(await pocketApi.getUserProfile(String(row.userId)));
            return { ...row, name: profile.name || row.name, avatar: profile.avatar || row.avatar };
          } catch {
            return row;
          }
        }));
        setRankRows(enriched);
        setRankStatus(enriched.length ? `\u5df2\u52a0\u8f7d ${enriched.length} \u4f4d\u8d21\u732e\u7528\u6237` : '\u8d21\u732e\u699c\u4e3a\u7a7a');
      } else {
        setRankStatus(rows.length ? `\u5df2\u52a0\u8f7d ${rows.length} \u4f4d\u8d21\u732e\u7528\u6237` : '\u8d21\u732e\u699c\u4e3a\u7a7a');
      }
    } catch (err) {
      setRankRows([]);
      setRankStatus(`贡献榜加载失败：${errorMessage(err)}`);
    }
  };

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('LivePlayerGiftRequested', () => {
      const current = playingRef.current;
      if (!current?.isLive) {
        setGiftStatus('当前没有可送礼的直播上下文');
        setGiftVisible(true);
        return;
      }
      openGiftPanel(current);
    });
    return () => sub.remove();
  }, []);

  // 画面旋转（翻转）：旋转 90° 时交换容器宽高，使视频填满屏幕且不裁剪
  const screen = Dimensions.get('window');
  const videoRotated = videoRotate === 90 || videoRotate === 270;
  const videoBoxW = videoRotated ? screen.height : screen.width;
  const videoBoxH = videoRotated ? screen.width : screen.height;
  const videoRotateDeg = `${videoRotate}deg`;

  if (playing) {
    return (
      <View style={[styles.playerPage, isFullscreen && styles.playerPageFullscreen]}>
        {/* 全屏点击层：始终可点，用于切换控制栏显隐。
            zIndex 20 低于控制栏(30)、高于视频(0)，故：
            - 控制栏可见时，其按钮(z30)优先接收点击；
            - 控制栏隐藏时(pointerEvents none)点击穿透到本层 → 重新唤出。
            用 TouchableWithoutFeedback 而非 responder，规避原生 Video 吞触摸导致「隐藏后再也唤不回」的 bug。 */}
        <TouchableWithoutFeedback onPress={toggleControls}>
          <View style={[StyleSheet.absoluteFill, { zIndex: 20 }]} />
        </TouchableWithoutFeedback>

        <Animated.View style={[{ position: 'absolute', top: 0, left: 0, right: 0, opacity: controlsOpacity, pointerEvents: controlsVisible ? 'box-none' : 'none', zIndex: 30 }]}>
          <PlayerTopBar
            onBack={isFullscreen ? () => setIsFullscreen(false) : closePlayer}
            title={playing.title || (playing.isLive ? '口袋直播' : '回放')}
            onMore={() => setMoreVisible(true)}
            onRefresh={() => startPlay(playing.item)}
          />
        </Animated.View>

        {announceExpanded && announceVisible && announcement ? (
          <View style={styles.announcePanel}>
            <View style={styles.announcePanelTop}>
              <Text style={styles.announcePanelTitle} numberOfLines={1}>📢 公告</Text>
              <View style={styles.announcePanelBtns}>
                <TouchableOpacity onPress={refreshAnnouncement} style={styles.announceSmallBtn}>
                  <Text style={styles.announceSmallBtnText}>刷新</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setAnnounceExpanded(false)} style={styles.announceSmallBtn}>
                  <Text style={styles.announceSmallBtnText}>收起</Text>
                </TouchableOpacity>
              </View>
            </View>
            <ScrollView style={styles.announcePanelBody}>
              <Text style={styles.announcePanelText}>{announcement}</Text>
            </ScrollView>
          </View>
        ) : null}

        {playing.needsVlc && Platform.OS === 'android' && LiveExoView ? (
          <View style={styles.player}>
            <LiveExoView style={styles.nativeVideo} url={playing.url} />
          </View>
        ) : useWebPlayer ? (
          <WebView
            source={{ html: getPlayerHtml(playing.url, playing.cover, webResumeTime) }}
            style={styles.player}
            javaScriptEnabled
            domStorageEnabled
            allowsInlineMediaPlayback
            mediaPlaybackRequiresUserAction={false}
            originWhitelist={['*']}
            mixedContentMode="always"
            allowsFullscreenVideo
            onMessage={(e) => {
              try {
                const data = JSON.parse(e.nativeEvent.data);
                if (!playing?.url) return;
                if (data.type === 'progress') {
                  const t = Number(data.time) || 0;
                  saveResumePosition(playing.url, t);
                  setPlaybackTime(t); // 校正弹幕时间轴，消除插值漂移
                } else if (data.type === 'ended') clearResumePosition(playing.url);
              } catch {}
            }}
          />
        ) : (
          <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
            <View style={{ width: videoBoxW, height: videoBoxH, transform: [{ rotate: videoRotateDeg }] }}>
              <Video
                ref={videoRef}
                source={playerSource(playing.url)}
                style={[styles.nativeVideo, { transform: [{ rotate: videoRotateDeg }] }]}
                resizeMode="contain"
                paused={paused}
                rate={playbackRate}
                progressUpdateInterval={250}
                playInBackground={false}
                playWhenInactive={false}
                ignoreSilentSwitch="ignore"
                onLoad={(e) => { setDuration(e.duration || 0); setPlaybackTime(webResumeTime || 0); setPlayerError(''); }}
                onProgress={(e) => { if (Date.now() < seekLockRef.current) return; if (!paused) setPlaybackTime(e.currentTime || 0); }}
                onEnd={() => clearResumePosition(playing.url)}
                onError={(event) => setPlayerError(`原生播放器失败：${JSON.stringify(event?.error || event).slice(0, 220)}`)}
              />
              {playerError ? (
                <View style={styles.playerError}>
                  <Text style={styles.playerErrorText}>{playerError}</Text>
                  <TouchableOpacity style={styles.webFallbackBtn} onPress={() => { setUseWebPlayer(true); setPaused(false); }}>
                    <Text style={styles.webFallbackText}>切换网页播放器</Text>
                  </TouchableOpacity>
                </View>
              ) : null}
            </View>
          </View>
        )}

        <DanmakuOverlay
          danmaku={danmaku}
          currentTime={playbackTime}
          visible={showDanmaku && !!playing}
          live={!!playing?.isLive}
        />

        {/* 底部控制坞：哔哩哔哩风格单排（播放 · 进度 · 弹幕 · 倍速 · 翻转 · 全屏 · 更多），口袋专属功能收进「更多」 */}
        <Animated.View style={[{ position: 'absolute', bottom: 0, left: 0, right: 0, opacity: controlsOpacity, pointerEvents: controlsVisible ? 'auto' : 'none', zIndex: 30 }]}>
          <PlayerBottomBar
            isLive={!!playing.isLive}
            paused={paused}
            currentTime={playbackTime}
            duration={duration}
            showDanmaku={!useWebPlayer}
            danmakuOn={showDanmaku}
            onToggleDanmaku={() => setShowDanmaku((v) => !v)}
            showRate={!playing.isLive && !useWebPlayer && !playing.needsVlc}
            rate={playbackRate}
            onCycleRate={() => setPlaybackRate((r) => (r === 1 ? 1.5 : r === 1.5 ? 2 : 1))}
            onTogglePlay={() => setPaused((p) => !p)}
            onSeek={(t) => { setPlaybackTime(t); seekLockRef.current = Date.now() + 500; if (videoRef.current && videoRef.current.seek) videoRef.current.seek(t); }}
            onRotate={() => setIsLandscape((v) => !v)}
          />
        </Animated.View>

        <PlayerMorePanel
          visible={moreVisible}
          onClose={() => setMoreVisible(false)}
          title="播放器功能"
          items={[
            ...(playing.isLive ? [{ key: 'gift', icon: 'gift', label: '礼物', onPress: () => openGiftPanel() }] : []),
            { key: 'rank', icon: 'trophy', label: '贡献榜', onPress: () => openRankPanel() },
            ...((announceVisible && announcement) ? [{ key: 'announce', icon: 'bullhorn', label: '公告', active: announceExpanded, onPress: () => setAnnounceExpanded((v) => !v) }] : []),
            { key: 'danmaku', icon: 'cog', label: '弹幕设置', onPress: () => setShowDanmakuSettings(true) },
          ]}
        />

        <Modal visible={giftVisible} transparent animationType="slide" onRequestClose={() => setGiftVisible(false)}>
          <View style={styles.modalShade}>
            <View style={[styles.giftPanel, isDark && styles.giftPanelDark]}>
              <View style={styles.giftHeader}>
                <Text style={[styles.giftTitle, isDark && styles.textLight]}>直播送礼</Text>
                <TouchableOpacity onPress={() => setGiftVisible(false)}>
                  <Text style={styles.backBtnTextPink}>关闭</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.giftTip}>直播送礼主播看不到赠送，仅能统计贡献值</Text>
              <Text style={styles.giftStatus}>
                {balance ? `余额：${balance} 鸡腿 · ` : ''}{giftStatus}
              </Text>
              <ScrollView style={styles.giftGrid}>
                <View style={styles.giftGridInner}>
                  {gifts.map((gift) => {
                    const active = String(selectedGift?.giftId || selectedGift?.id) === String(gift.giftId || gift.id);
                    return (
                      <TouchableOpacity
                        key={String(gift.giftId || gift.id)}
                        style={[styles.giftItem, active && styles.giftItemActive]}
                        onPress={() => setSelectedGift(gift)}
                      >
                        {giftImage(gift) ? <Image source={{ uri: giftImage(gift) }} style={styles.giftImage} /> : <View style={styles.giftImage} />}
                        <Text style={styles.giftName} numberOfLines={1}>{giftName(gift)}</Text>
                        <Text style={styles.giftCost}>{giftCost(gift)} 鸡腿</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </ScrollView>
              <View style={styles.giftFooter}>
                <TextInput
                  style={styles.giftNum}
                  keyboardType="numeric"
                  value={giftNum}
                  onChangeText={setGiftNum}
                />
                <TouchableOpacity style={styles.sendGiftBtn} onPress={sendGift}>
                  <Text style={styles.sendGiftText}>
                    {selectedGift ? `送出 · ${selectedGiftTotal}` : '选择礼物'}
                  </Text>
                </TouchableOpacity>
              </View>
              <TouchableOpacity
                style={styles.rechargeBtn}
                onPress={() => {
                  setGiftVisible(false);
                  (navigation as any).navigate('RechargeScreen');
                }}
              >
                <Text style={styles.rechargeText}>余额不足？去充值鸡腿</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
        <Modal visible={rankVisible} transparent animationType="slide" onRequestClose={() => setRankVisible(false)}>
          <View style={styles.modalShade}>
            <View style={[styles.giftPanel, isDark && styles.giftPanelDark]}>
              <View style={styles.giftHeader}>
                <Text style={[styles.giftTitle, isDark && styles.textLight]}>贡献榜</Text>
                <TouchableOpacity onPress={() => setRankVisible(false)}>
                  <Text style={styles.backBtnTextPink}>关闭</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.giftStatus}>{rankStatus}</Text>
              <ScrollView style={styles.rankList}>
                {rankRows.map((row, index) => (
                  <View key={String(row.userId || row.id || index)} style={styles.rankRow}>
                    <Text style={styles.rankNo}>{row.rank || index + 1}</Text>
                    {row.avatar ? <Image source={{ uri: row.avatar }} style={styles.rankAvatar} /> : <View style={styles.rankAvatar} />}
                    <View style={styles.rankInfo}>
                      <Text style={styles.rankName} numberOfLines={1}>{row.name}</Text>
                      <Text style={styles.rankValue} numberOfLines={1}>{row.value ? `贡献 ${row.value}` : '贡献用户'}</Text>
                    </View>
                  </View>
                ))}
              </ScrollView>
            </View>
          </View>
        </Modal>
        <DanmakuSettingsSheet visible={showDanmakuSettings} onClose={() => setShowDanmakuSettings(false)} />
      </View>
    );
  }

  return (
    <View style={[styles.container, isDark && styles.containerDark]}>
      <ScreenHeader title="直播 · 回放" />
      <View style={styles.toolbarRow}>
        <TouchableOpacity style={[styles.tabBtn, tab === 'live' && styles.tabBtnActive, isDark && tab !== 'live' && styles.tabBtnDark]} onPress={() => switchTab('live')}>
          <Text style={[styles.tabBtnText, tab === 'live' && styles.tabBtnTextActive, isDark && tab !== 'live' && styles.tabBtnTextDark]}>直播</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tabBtn, tab === 'vod' && styles.tabBtnActive, isDark && tab !== 'vod' && styles.tabBtnDark]} onPress={() => switchTab('vod')}>
          <Text style={[styles.tabBtnText, tab === 'vod' && styles.tabBtnTextActive, isDark && tab !== 'vod' && styles.tabBtnTextDark]}>回放</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.refreshBtn, isDark && styles.refreshBtnDark]} onPress={refreshList}>
          <Text style={[styles.refreshText, isDark && styles.refreshTextDark]}>刷新</Text>
        </TouchableOpacity>
      </View>
      {/* v2.6: group selector — client-side text match filter */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.groupRow} contentContainerStyle={styles.groupRowContent}>
        {GROUPS.map((item) => (
          <TouchableOpacity
            key={String(item.id)}
            style={[styles.groupChip, isDark && styles.groupChipDark, groupId === item.id && styles.groupChipActive]}
            onPress={() => setGroupId(item.id)}
          >
            <Text style={[styles.groupChipText, isDark && styles.groupChipTextDark, groupId === item.id && styles.groupChipTextActive]}>{item.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      {/* 搜索：未选成员时按「成员名/缩写」联想出选择框；选中成员后搜索框转为搜该成员标题/日期 */}
      <View style={styles.searchWrap}>
        {selectedMember ? (
          <TouchableOpacity onPress={() => setSelectedMember(null)} style={styles.memberChip}>
            <Text style={[styles.memberChipText, isDark && styles.memberChipTextDark]}>{selectedMember.ownerName}</Text>
            <MaterialCommunityIcons name="close" size={16} color="#fff" style={{ marginLeft: 6 }} />
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity onPress={() => setShowCalendar(true)} style={[styles.calBtn, dateFilter && styles.calBtnActive]} hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}>
          <MaterialCommunityIcons name="calendar-month" size={20} color={dateFilter ? '#ff6f91' : (isDark ? '#ccc' : '#666')} />
        </TouchableOpacity>
        <TextInput
          style={[styles.searchInput, isDark && styles.searchInputDark, selectedMember && styles.searchInputActive]}
          placeholder={selectedMember ? '搜索该成员的标题 / 日期...' : '搜索成员名、标题、时间...'}
          placeholderTextColor={isDark ? '#888' : '#999'}
          value={search}
          onChangeText={setSearch}
          returnKeyType="search"
        />
        {search.trim() ? (
          <TouchableOpacity onPress={() => setSearch('')} style={styles.searchClear} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <MaterialCommunityIcons name="close-circle" size={18} color={isDark ? '#aaa' : '#999'} />
          </TouchableOpacity>
        ) : null}
      </View>
      {dateFilter ? (
        <View style={styles.dateChipRow}>
          <TouchableOpacity style={styles.dateChip} onPress={() => setShowCalendar(true)}>
            <MaterialCommunityIcons name="calendar-month" size={14} color="#ff6f91" />
            <Text style={styles.dateChipText}>{dateKeyOf(dateFilter)}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setDateFilter(null)} style={styles.dateChipClear}>
            <MaterialCommunityIcons name="close-circle" size={16} color={isDark ? '#aaa' : '#999'} />
          </TouchableOpacity>
        </View>
      ) : null}
      {memberHits.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.memberHits} contentContainerStyle={styles.memberHitsContent}>
          {memberHits.map((m) => (
            <TouchableOpacity
              key={m.id}
              style={[styles.memberHitChip, isDark && styles.memberHitChipDark]}
              onPress={() => { setSelectedMember(m); setSearch(''); }}
            >
              <Text style={[styles.memberHitText, isDark && styles.memberHitTextDark]}>{m.ownerName.split('-').pop()}</Text>
              {m.team ? <Text style={[styles.memberHitTeam, isDark && styles.memberHitTeamDark]}>{m.team}</Text> : null}
            </TouchableOpacity>
          ))}
        </ScrollView>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <CalendarSheet
        visible={showCalendar}
        initial={dateFilter}
        onSelect={(d) => { setDateFilter(d); setShowCalendar(false); }}
        onClose={() => setShowCalendar(false)}
      />

      <View style={{ flex: 1 }}>
        <PerfFlatList
          data={list}
          keyExtractor={(item, index) => item.liveId || String(index)}
          renderItem={({ item, index }) => {
            const coverUrl = item.liveCover || item.coverPath;
            const subtitle = [item.nickname, formatTimestamp(item.startTime)].filter(Boolean).join(' · ');
            return (
              <FadeInView delay={index < 16 ? 80 + index * 30 : 0} duration={300}>
                <TouchableOpacity style={[styles.card, isDark && styles.cardDark]} onPress={() => startPlay(item)}>
                  {coverUrl ? (
                    <Image source={{ uri: coverUrl }} style={styles.cover} resizeMode="cover" />
                  ) : (
                    <View style={[styles.cover, styles.coverPlaceholder]}>
                      <Text style={[styles.coverPlaceholderText, isDark && styles.coverPlaceholderTextDark]}>视频</Text>
                    </View>
                  )}
                  <View style={styles.cardInfo}>
                    <Text style={[styles.cardTitle, isDark && styles.textLight]} numberOfLines={2}>
                      {item.title || item.liveRoomTitle || '无标题'}
                    </Text>
                    {subtitle ? <Text style={[styles.cardSub, isDark && styles.cardSubDark]}>{subtitle}</Text> : null}
                    <View style={styles.typeRow}>
                      <View style={styles.typeTag}>
                        <Text style={styles.typeText}>{item.liveType === 2 ? '电台' : '视频'}</Text>
                      </View>
                      {tab === 'live' ? (
                        <View style={[styles.typeTag, styles.giftTag]}>
                          <Text style={styles.typeText}>可送礼</Text>
                        </View>
                      ) : null}
                    </View>
                  </View>
                </TouchableOpacity>
              </FadeInView>
            );
          }}
          ListEmptyComponent={
            loading ? (
              <VodCardSkeleton dark={isDark} />
            ) : (
              <View style={styles.emptyWrap}>
                <Text style={[styles.empty, isDark && styles.emptyDark]}>
                  {search.trim() ? '没有匹配的直播/录播' : '暂无数据'}
                </Text>
              </View>
            )
          }
          onEndReached={loadMore}
          onEndReachedThreshold={0.35}
          ListFooterComponent={
            // 仅在有内容且正在加载更多时显示一条低调的微光条，动画语言与骨架屏一致（不再用转圈）
            list.length > 0 && loading ? (
              <View style={styles.footer}>
                <Skeleton width={120} height={14} radius={7} dark={isDark} />
              </View>
            ) : null
          }
          contentContainerStyle={list.length === 0 ? { flex: 1 } : undefined}
          initialNumToRender={12}
          maxToRenderPerBatch={12}
          windowSize={7}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  containerDark: { backgroundColor: 'transparent' },
  tabRow: { flexDirection: 'row', gap: 8 },
  toolbarRow: { flexDirection: 'row', gap: 6, paddingHorizontal: 14, paddingBottom: 8, alignItems: 'center' },
  playerToolbar: { flexDirection: 'row', paddingHorizontal: 8, paddingTop: 44, paddingBottom: 6, backgroundColor: 'rgba(10,10,10,0.55)', alignItems: 'center' },
  playerToolbarCenter: { flex: 1, flexDirection: 'row', justifyContent: 'center', gap: 6, flexWrap: 'wrap' },
  glassBtn: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.15)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)' },
  glassBtnActive: { backgroundColor: '#ff6f91', borderColor: '#ff6f91' },
  glassBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  tabBtn: { paddingHorizontal: 18, paddingVertical: 8, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.38)' },
  tabBtnActive: { backgroundColor: '#ff6f91' },
  tabBtnText: { fontSize: 13, color: '#444', fontWeight: '700' },
  tabBtnTextActive: { color: '#fff' },
  refreshBtn: { paddingHorizontal: 18, paddingVertical: 8, borderRadius: 18, backgroundColor: '#ddd' },
  refreshText: { fontSize: 13, color: '#444', fontWeight: '700' },
  tabBtnDark: { backgroundColor: 'rgba(42,42,42,0.52)' },
  tabBtnTextDark: { color: '#aaa' },
  refreshBtnDark: { backgroundColor: 'rgba(42,42,42,0.52)' },
  refreshTextDark: { color: '#aaa' },
  footer: { paddingVertical: 14, alignItems: 'center' },
  footerSpinner: { opacity: 0.6 },
  error: { margin: 12, padding: 10, borderRadius: 18, backgroundColor: '#fff3cd', color: '#8a5a00', fontSize: 12, lineHeight: 18 },
  playerPage: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 999, elevation: 999, backgroundColor: '#000' },
  playerPageFullscreen: { backgroundColor: '#000' },
  backBtnTextPink: { color: '#ff6f91', fontSize: 13, fontWeight: '800' },
  giftBtn: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 14, backgroundColor: '#ff6f91' },
  giftBtnText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  switchPlayerBtn: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 14, backgroundColor: '#222', marginLeft: 4 },
  switchPlayerText: { color: '#ff6f91', fontSize: 11, fontWeight: '800' },
  retryPlayerBtn: { backgroundColor: '#ff6f91' },
  retryPlayerText: { color: '#fff' },
  announceHeaderBtn: { backgroundColor: 'rgba(251,114,153,0.25)' },
  announceHeaderText: { color: '#fb7299' },
  exitFullscreenBtn: { position: 'absolute', top: 28, right: 16, zIndex: 1001, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.62)' },
  exitFullscreenText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  announcePill: { alignSelf: 'center', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, backgroundColor: 'rgba(251,114,153,0.20)', borderWidth: 1, borderColor: 'rgba(251,114,153,0.3)', marginVertical: 4 },
  announcePillText: { color: '#fb7299', fontSize: 11, fontWeight: '700' },
  announcePanel: { zIndex: 31, borderRadius: 14, backgroundColor: 'rgba(18,18,20,0.92)', borderWidth: 1, borderColor: 'rgba(251,114,153,0.32)', marginHorizontal: 10, marginBottom: 6, overflow: 'hidden', shadowColor: '#000', shadowOpacity: 0.28, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 6 },
  announcePanelTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(251,114,153,0.18)' },
  announcePanelTitle: { color: '#fff', fontSize: 13, fontWeight: '800', flex: 1 },
  announcePanelBtns: { flexDirection: 'row', gap: 8 },
  announceSmallBtn: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 14, backgroundColor: 'rgba(251,114,153,0.16)' },
  announceSmallBtnText: { color: '#fb7299', fontSize: 11, fontWeight: '700' },
  announcePanelBody: { paddingHorizontal: 14, paddingVertical: 10, maxHeight: 150 },
  announcePanelText: { color: '#f2f2f2', fontSize: 12.5, lineHeight: 21 },
  player: { flex: 1, backgroundColor: '#000' },
  nativeVideo: { flex: 1, backgroundColor: '#000' },
  vlcGate: { flex: 1, backgroundColor: '#050505', justifyContent: 'center', padding: 22 },
  vlcGateTitle: { color: '#fff', fontSize: 22, fontWeight: '900', marginBottom: 12 },
  vlcGateText: { color: '#d8d8d8', fontSize: 14, lineHeight: 22, marginBottom: 14 },
  vlcGateUrl: { color: '#d8d8d8', fontSize: 11, lineHeight: 16, marginBottom: 18 },
  vlcPrimaryBtn: { backgroundColor: '#ff6f91', borderRadius: 16, paddingVertical: 13, alignItems: 'center', marginBottom: 10 },
  vlcPrimaryText: { color: '#fff', fontSize: 15, fontWeight: '900' },
  vlcSecondaryBtn: { backgroundColor: '#222', borderRadius: 16, paddingVertical: 13, alignItems: 'center' },
  vlcSecondaryText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  vlcGateError: { color: '#ffb3c2', fontSize: 12, marginTop: 12 },
  playerError: { position: 'absolute', left: 16, right: 16, bottom: 24, padding: 12, borderRadius: 16, backgroundColor: 'rgba(20,20,20,0.88)' },
  playerErrorText: { color: '#fff', fontSize: 12, lineHeight: 18 },
  webFallbackBtn: { marginTop: 10, alignSelf: 'flex-start', backgroundColor: '#ff6f91', borderRadius: 18, paddingHorizontal: 12, paddingVertical: 8 },
  webFallbackText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  // 哔哩哔哩风格底部控制条（停靠在 bottomDock 内）
  controlsBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, backgroundColor: 'rgba(0,0,0,0.55)' },
  ctrlBtn: { paddingHorizontal: 8, paddingVertical: 4, minWidth: 30, alignItems: 'center', justifyContent: 'center' },
  ctrlIcon: { color: '#fff', fontSize: 18, fontWeight: '800' },
  ctrlIconOn: { color: '#ff6f91' },
  ctrlRate: { color: '#fff', fontSize: 12, fontWeight: '800' },
  ctrlTime: { color: '#fff', fontSize: 11, minWidth: 34, textAlign: 'center' },
  // 进度条：外层是更高的触控区（跟手），内层才是 4px 视觉条
  ctrlTrack: { flex: 1, height: 24, justifyContent: 'center', marginHorizontal: 8, position: 'relative' },
  ctrlBar: { position: 'relative', height: 4, width: '100%', borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.3)' },
  ctrlFill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 2, backgroundColor: '#ff6f91' },
  ctrlKnob: { position: 'absolute', top: -3, width: 10, height: 10, borderRadius: 5, backgroundColor: '#fff', marginLeft: -5 },
  // 底部控制坞（MSG48 风格：半透明黑底，进度/功能图标统一沉浸显隐）
  bottomDock: { position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 20, paddingTop: 10, paddingBottom: 16, paddingHorizontal: 12, backgroundColor: 'rgba(0,0,0,0.55)' },
  funcRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-around', alignItems: 'center', marginTop: 10, gap: 4 },
  funcBtn: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10, paddingVertical: 4, minWidth: 48 },
  funcBtnActive: { opacity: 1 },
  funcBtnText: { color: '#fff', fontSize: 11, fontWeight: '700', marginTop: 3 },
  funcBtnTextActive: { color: '#ff6f91' },
  liveBadgeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 6, gap: 8 },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#ff4d4f' },
  liveBadgeText: { color: '#fff', fontSize: 13, fontWeight: '800' },
  topChrome: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 44, paddingHorizontal: 12, paddingBottom: 8, pointerEvents: 'box-none' },
  card: { flexDirection: 'row', padding: 12, backgroundColor: 'rgba(255,255,255,0.46)', marginHorizontal: 12, marginVertical: 6, borderRadius: 16 },
  cardDark: { backgroundColor: 'rgba(20,20,20,0.58)' },
  cover: { width: 112, height: 78, borderRadius: 18, backgroundColor: '#e0e0e0' },
  coverPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  coverPlaceholderText: { fontSize: 13, color: '#3f3f3f', fontWeight: '700' },
  coverPlaceholderTextDark: { color: '#aaa' },
  cardInfo: { flex: 1, marginLeft: 12, justifyContent: 'center' },
  cardTitle: { fontSize: 15, fontWeight: '700', color: '#333', marginBottom: 4 },
  cardSub: { fontSize: 12, color: '#3f3f3f', marginBottom: 6 },
  cardSubDark: { color: '#aaa' },
  typeRow: { flexDirection: 'row', gap: 4 },
  typeTag: { backgroundColor: '#ff6f9118', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4 },
  giftTag: { backgroundColor: '#13c2c218' },
  typeText: { fontSize: 11, color: '#ff6f91', fontWeight: '700' },
  // v2.6: group + search
  groupRow: { maxHeight: 44, marginBottom: 4 },
  groupRowContent: { paddingHorizontal: 12, alignItems: 'center', gap: 6 },
  groupChip: { paddingHorizontal: 16, paddingVertical: 7, borderRadius: 16, backgroundColor: 'rgba(238,238,238,0.72)' },
  groupChipDark: { backgroundColor: 'rgba(42,42,42,0.52)' },
  groupChipActive: { backgroundColor: '#ff6f91' },
  groupChipText: { fontSize: 12, color: '#555', fontWeight: '700' },
  groupChipTextDark: { color: '#aaa' },
  groupChipTextActive: { color: '#fff' },
  searchWrap: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 12, marginBottom: 4 },
  searchInput: {
    flex: 1, padding: 10, borderRadius: 16,
    borderWidth: 1, borderColor: 'rgba(230,230,230,0.95)',
    backgroundColor: 'rgba(255,255,255,0.52)', color: '#333', fontSize: 13,
  },
  searchInputDark: { backgroundColor: 'rgba(42,42,42,0.52)', borderColor: '#444', color: '#eee' },
  searchInputActive: { borderColor: '#ff6f91' },
  searchClear: { paddingHorizontal: 8, paddingVertical: 8 },
  // 成员选择框
  memberChip: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: '#ff6f91', marginRight: 8 },
  memberChipText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  memberChipTextDark: { color: '#fff' },
  memberHits: { maxHeight: 52, marginBottom: 2 },
  memberHitsContent: { paddingHorizontal: 12, alignItems: 'center', gap: 6 },
  memberHitChip: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 7, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.04)', borderWidth: 1, borderColor: 'rgba(0,0,0,0.12)' },
  memberHitChipDark: { backgroundColor: 'rgba(255,255,255,0.08)', borderColor: 'rgba(255,255,255,0.16)' },
  memberHitText: { fontSize: 12, color: '#555', fontWeight: '700' },
  memberHitTextDark: { color: '#ccc' },
  memberHitTeam: { fontSize: 9, color: '#999', marginLeft: 6, opacity: 0.85 },
  memberHitTeamDark: { color: '#999' },
  loadMoreBtn: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 18, backgroundColor: '#ff6f91' },
  loadMoreText: { color: '#fff', fontSize: 13, fontWeight: '800' },
  textLight: { color: '#eee' },
  emptyWrap: { alignItems: 'center', marginTop: 60 },
  empty: { fontSize: 14, color: '#3f3f3f' },
  emptyDark: { color: '#aaa' },
  modalShade: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.72)' },
  giftPanel: { maxHeight: '82%', backgroundColor: 'rgba(18,18,18,0.92)', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 14 },
  giftPanelDark: { backgroundColor: 'rgba(18,18,18,0.94)' },
  giftHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  giftTitle: { fontSize: 18, fontWeight: '800', color: '#f5f5f5' },
  giftStatus: { color: '#d8d8d8', fontSize: 12, marginBottom: 10 },
  giftTip: { fontSize: 11, color: '#ff4444', marginBottom: 6, textAlign: 'center', fontWeight: '600' },
  giftGrid: { maxHeight: 360 },
  giftGridInner: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  giftItem: { width: '31%', padding: 8, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.24)' },
  giftItemActive: { borderColor: '#ff6f91', backgroundColor: 'rgba(255,111,145,0.2)' },
  giftImage: { width: 44, height: 44, borderRadius: 18, backgroundColor: '#ddd', marginBottom: 6 },
  giftName: { fontSize: 11, color: '#f3f3f3', fontWeight: '700' },
  giftCost: { fontSize: 10, color: '#ff6f91', marginTop: 2 },
  giftFooter: { flexDirection: 'row', gap: 10, paddingTop: 12 },
  giftNum: { width: 82, borderRadius: 18, borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)', paddingHorizontal: 12, color: '#fff', backgroundColor: 'rgba(255,255,255,0.12)' },
  sendGiftBtn: { flex: 1, backgroundColor: '#ff6f91', borderRadius: 18, alignItems: 'center', justifyContent: 'center', minHeight: 44 },
  sendGiftText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  rechargeBtn: { marginTop: 10, alignItems: 'center', paddingVertical: 10 },
  rechargeText: { color: '#ff6f91', fontSize: 13, fontWeight: '800' },
  rankList: { maxHeight: 430 },
  rankRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.10)' },
  rankNo: { width: 32, color: '#ff6f91', fontSize: 15, fontWeight: '900' },
  rankAvatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.16)', marginRight: 10 },
  rankInfo: { flex: 1 },
  rankName: { color: '#f5f5f5', fontSize: 14, fontWeight: '800' },
  rankValue: { color: '#d8d8d8', fontSize: 11, marginTop: 2 },
  // 日历筛选
  calBtn: { padding: 6, marginRight: 2, justifyContent: 'center' },
  calBtnActive: { backgroundColor: 'rgba(255,111,145,0.14)', borderRadius: 10 },
  dateChipRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, marginTop: 8 },
  dateChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14, backgroundColor: 'rgba(255,111,145,0.16)', borderWidth: 1, borderColor: 'rgba(255,111,145,0.4)' },
  dateChipText: { color: '#ff6f91', fontSize: 12, fontWeight: '700' },
  dateChipClear: { marginLeft: 6 },
  calMask: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
  calSheet: { width: '88%', maxWidth: 360, backgroundColor: '#fff', borderRadius: 18, padding: 16, elevation: 8 },
  calHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  calTitle: { fontSize: 17, fontWeight: '800', color: '#222' },
  calWeekRow: { flexDirection: 'row', marginBottom: 6 },
  calWeek: { flex: 1, textAlign: 'center', fontSize: 12, color: '#999', fontWeight: '700' },
  calGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  calDay: { width: '14.28%', aspectRatio: 1, alignItems: 'center', justifyContent: 'center' },
  calDayText: { fontSize: 15, color: '#333' },
  calFooter: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#eee' },
  calCancel: { paddingHorizontal: 14, paddingVertical: 6 },
  calCancelText: { fontSize: 14, color: '#888' },
  calToday: { backgroundColor: '#ff6f91', borderRadius: 14, paddingHorizontal: 18, paddingVertical: 6 },
  calTodayText: { color: '#fff', fontSize: 14, fontWeight: '800' },
});
