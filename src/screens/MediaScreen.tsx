import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  DeviceEventEmitter,
  FlatList,
  Image,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { WebView } from 'react-native-webview';
import Video from 'react-native-video';
import * as ScreenOrientation from 'expo-screen-orientation';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { TabParamList } from '../navigation/types';
import { useSettingsStore, useUiStore } from '../store';
import { VODItem } from '../types';
import { formatTimestamp } from '../utils/format';
import { errorMessage, normalizeUrl, pickText, unwrapList } from '../utils/data';
import pocketApi from '../api/pocket48';
import { getPlayerHtml } from '../components/media/player';
import { LiveExoView, setLiveImmersiveMode } from '../native/LivePlayer';

type MediaRouteProp = RouteProp<TabParamList, 'Media'>;

const PLAY_URL_FIELDS = [
  'playStreamPath',
  'streamUrl',
  'playUrl',
  'playPath',
  'streamPath',
  'pullStreamPath',
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
  'content.playStreamPath',
  'content.streamUrl',
  'content.playUrl',
  'content.playPath',
  'content.url',
  'data.playStreamPath',
  'data.streamUrl',
  'data.playUrl',
  'data.playPath',
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
    userId: pickText(item, ['userId', 'uid', 'id', 'account', 'userInfo.userId', 'userInfo.id', 'user.userId', 'user.id', 'memberInfo.userId', 'memberInfo.id']),
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
      'user.nickName', 'user.nickname',
    ]),
    avatar: normalizeUrl(pickText(info, [
      'avatar', 'headImg', 'headUrl', 'picPath',
      'profile.avatar', 'profile.headImg',
      'userInfo.avatar', 'userInfo.headImg',
      'user.avatar', 'user.headImg',
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
  const [tab, setTab] = useState<'live' | 'vod'>(route.params?.mode ?? 'live');
  const [vodList, setVodList] = useState<VODItem[]>([]);
  const [liveList, setLiveList] = useState<VODItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');
  const [playerError, setPlayerError] = useState('');
  const [useWebPlayer, setUseWebPlayer] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [playing, setPlaying] = useState<{ url: string; urls: string[]; title: string; cover?: string; item: any; isLive: boolean; needsVlc: boolean } | null>(null);
  const [giftVisible, setGiftVisible] = useState(false);
  const [gifts, setGifts] = useState<any[]>([]);
  const [selectedGift, setSelectedGift] = useState<any | null>(null);
  const [giftNum, setGiftNum] = useState('1');
  const [giftStatus, setGiftStatus] = useState('');
  const [balance, setBalance] = useState('');
  const [hasMore, setHasMore] = useState(true);
  const [rankVisible, setRankVisible] = useState(false);
  const [rankRows, setRankRows] = useState<any[]>([]);
  const [rankStatus, setRankStatus] = useState('');
  const loadingRef = useRef(false);
  const playingRef = useRef<typeof playing>(null);

  const list = tab === 'live' ? liveList : vodList;
  const selectedGiftTotal = useMemo(
    () => (selectedGift ? giftCost(selectedGift) * (Number(giftNum) || 1) : 0),
    [giftNum, selectedGift],
  );

  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  useEffect(() => {
    setTabBarHidden(!!playing);
    return () => setTabBarHidden(false);
  }, [playing, setTabBarHidden]);

  const fetchList = useCallback(async (mode: 'live' | 'vod', p = 1) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    setError('');
    try {
      const res = await pocketApi.getLiveList({ page: p, record: mode === 'vod' });
      const next = normalizeLiveList(res);
      setHasMore(next.length > 0);
      if (mode === 'live') setLiveList((prev) => (p === 1 ? next : mergeUniqueLiveItems(prev, next)));
      else setVodList((prev) => (p === 1 ? next : mergeUniqueLiveItems(prev, next)));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchList(tab, 1);
  }, [fetchList, tab]);

  useEffect(() => () => {
    setLiveImmersiveMode(false);
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
  }, []);

  useEffect(() => {
    setLiveImmersiveMode(!!playing && isFullscreen);
    return () => setLiveImmersiveMode(false);
  }, [isFullscreen, playing]);

  const closePlayer = () => {
    setIsFullscreen(false);
    setLiveImmersiveMode(false);
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    setPlaying(null);
  };

  const switchTab = (next: 'live' | 'vod') => {
    setTab(next);
    setPage(1);
    setHasMore(true);
  };

  const refreshList = () => {
    setPage(1);
    setHasMore(true);
    fetchList(tab, 1);
  };

  const loadMore = () => {
    if (loading || loadingRef.current || !hasMore || list.length === 0) return;
    const nextPage = page + 1;
    setPage(nextPage);
    fetchList(tab, nextPage);
  };

  const startPlay = async (item: VODItem) => {
    setError('');
    setPlayerError('');
    setUseWebPlayer(false);
    setIsFullscreen(false);
    setLiveImmersiveMode(false);
    setLoading(true);
    try {
      let urls = pickPlayableUrls(item, tab === 'live');
      let detail: any = item;
      if (item.liveId) {
        detail = await pocketApi.getLiveOne(item.liveId);
        urls = [...pickPlayableUrls(detail, tab === 'live'), ...urls];
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
    setGiftStatus('正在加载礼物...');
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
    setRankStatus('正在加载贡献榜...');
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

  if (playing) {
    return (
      <View style={[styles.playerPage, isFullscreen && styles.playerPageFullscreen]}>
        {!isFullscreen ? (
        <View style={styles.playHeader}>
          <TouchableOpacity
            onPress={closePlayer}
            style={styles.backBtn}
          >
            <Text style={styles.backBtnText}>返回</Text>
          </TouchableOpacity>
          <Text style={styles.playTitle} numberOfLines={1}>{playing.title}</Text>
          {playing.isLive ? (
            <TouchableOpacity onPress={() => openGiftPanel()} style={styles.giftBtn}>
              <Text style={styles.giftBtnText}>礼物</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity onPress={() => openRankPanel()} style={styles.switchPlayerBtn}>
            <Text style={styles.switchPlayerText}>贡献榜</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setIsFullscreen(true)} style={styles.switchPlayerBtn}>
            <Text style={styles.switchPlayerText}>全屏</Text>
          </TouchableOpacity>
        </View>
        ) : (
          <TouchableOpacity onPress={() => setIsFullscreen(false)} style={styles.exitFullscreenBtn}>
            <Text style={styles.exitFullscreenText}>退出全屏</Text>
          </TouchableOpacity>
        )}

        {playing.needsVlc && Platform.OS === 'android' && LiveExoView ? (
          <View style={styles.player}>
            <LiveExoView style={styles.nativeVideo} url={playing.url} />
          </View>
        ) : useWebPlayer ? (
          <WebView
            source={{ html: getPlayerHtml(playing.url, playing.cover) }}
            style={styles.player}
            javaScriptEnabled
            domStorageEnabled
            allowsInlineMediaPlayback
            mediaPlaybackRequiresUserAction={false}
            originWhitelist={['*']}
            mixedContentMode="always"
            allowsFullscreenVideo
          />
        ) : (
          <View style={styles.player}>
            <Video
              source={playerSource(playing.url)}
              style={styles.nativeVideo}
              controls
              resizeMode="contain"
              paused={false}
              playInBackground={false}
              playWhenInactive={false}
              ignoreSilentSwitch="ignore"
              onError={(event) => setPlayerError(`原生播放器失败：${JSON.stringify(event?.error || event).slice(0, 220)}`)}
              onLoad={() => setPlayerError('')}
            />
            {playerError ? (
              <View style={styles.playerError}>
                <Text style={styles.playerErrorText}>{playerError}</Text>
                <TouchableOpacity style={styles.webFallbackBtn} onPress={() => setUseWebPlayer(true)}>
                  <Text style={styles.webFallbackText}>切换网页播放器</Text>
                </TouchableOpacity>
              </View>
            ) : null}
          </View>
        )}

        <Modal visible={giftVisible} transparent animationType="slide" onRequestClose={() => setGiftVisible(false)}>
          <View style={styles.modalShade}>
            <View style={[styles.giftPanel, isDark && styles.giftPanelDark]}>
              <View style={styles.giftHeader}>
                <Text style={[styles.giftTitle, isDark && styles.textLight]}>直播送礼</Text>
                <TouchableOpacity onPress={() => setGiftVisible(false)}>
                  <Text style={styles.backBtnTextPink}>关闭</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.giftStatus}>
                {balance ? `余额：${balance} 口袋币 · ` : ''}{giftStatus}
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
                        <Text style={styles.giftCost}>{giftCost(gift)} 口袋币</Text>
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
      </View>
    );
  }

  return (
    <View style={[styles.container, isDark && styles.containerDark]}>
      <View style={[styles.header, isDark && styles.headerDark]}>
        <Text style={styles.title}>直播 / 回放</Text>
        <View style={styles.tabRow}>
          <TouchableOpacity style={[styles.tabBtn, tab === 'live' && styles.tabBtnActive]} onPress={() => switchTab('live')}>
            <Text style={[styles.tabBtnText, tab === 'live' && styles.tabBtnTextActive]}>直播</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.tabBtn, tab === 'vod' && styles.tabBtnActive]} onPress={() => switchTab('vod')}>
            <Text style={[styles.tabBtnText, tab === 'vod' && styles.tabBtnTextActive]}>回放</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.refreshBtn} onPress={refreshList}>
            <Text style={styles.refreshText}>刷新</Text>
          </TouchableOpacity>
        </View>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <FlatList
        data={list}
        keyExtractor={(item, index) => item.liveId || String(index)}
        renderItem={({ item }) => {
          const coverUrl = item.liveCover || item.coverPath;
          const subtitle = [item.nickname, formatTimestamp(item.startTime)].filter(Boolean).join(' · ');
          return (
            <TouchableOpacity style={[styles.card, isDark && styles.cardDark]} onPress={() => startPlay(item)}>
              {coverUrl ? <Image source={{ uri: coverUrl }} style={styles.cover} /> : (
                <View style={[styles.cover, styles.coverPlaceholder]}>
                  <Text style={styles.coverPlaceholderText}>视频</Text>
                </View>
              )}
              <View style={styles.cardInfo}>
                <Text style={[styles.cardTitle, isDark && styles.textLight]} numberOfLines={2}>
                  {item.title || item.liveRoomTitle || '无标题'}
                </Text>
                {subtitle ? <Text style={styles.cardSub}>{subtitle}</Text> : null}
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
          );
        }}
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <Text style={styles.empty}>{loading ? '加载中...' : '暂无数据，点击刷新重试'}</Text>
            {loading ? <ActivityIndicator style={{ marginTop: 8 }} color="#ff6f91" /> : null}
          </View>
        }
        ListFooterComponent={
          list.length > 0 ? (
            <View style={styles.footer}>
              {loading ? (
                <ActivityIndicator color="#ff6f91" />
              ) : hasMore ? (
                <TouchableOpacity style={styles.loadMoreBtn} onPress={loadMore}>
                  <Text style={styles.loadMoreText}>加载更多</Text>
                </TouchableOpacity>
              ) : (
                <Text style={styles.empty}>没有更多了</Text>
              )}
            </View>
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  containerDark: { backgroundColor: 'transparent' },
  header: { paddingTop: 54, paddingHorizontal: 20, paddingBottom: 14, marginBottom: 4 },
  headerDark: {},
  title: { fontSize: 22, fontWeight: '800', color: '#ff6f91', marginBottom: 12 },
  tabRow: { flexDirection: 'row', gap: 8 },
  tabBtn: { paddingHorizontal: 18, paddingVertical: 8, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.38)' },
  tabBtnActive: { backgroundColor: '#ff6f91' },
  tabBtnText: { fontSize: 13, color: '#444', fontWeight: '700' },
  tabBtnTextActive: { color: '#fff' },
  refreshBtn: { paddingHorizontal: 18, paddingVertical: 8, borderRadius: 18, backgroundColor: '#ddd' },
  refreshText: { fontSize: 13, color: '#444', fontWeight: '700' },
  footer: { padding: 18, alignItems: 'center' },
  loadMoreBtn: { paddingHorizontal: 22, paddingVertical: 10, borderRadius: 18, backgroundColor: '#ff6f91' },
  loadMoreText: { color: '#fff', fontSize: 13, fontWeight: '800' },
  error: { margin: 12, padding: 10, borderRadius: 18, backgroundColor: '#fff3cd', color: '#8a5a00', fontSize: 12, lineHeight: 18 },
  playerPage: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 999, elevation: 999, backgroundColor: '#000' },
  playerPageFullscreen: { backgroundColor: '#000' },
  playHeader: { flexDirection: 'row', alignItems: 'center', padding: 8, paddingTop: 44, backgroundColor: '#0a0a0a' },
  backBtn: { padding: 8 },
  backBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  backBtnTextPink: { color: '#ff6f91', fontSize: 14, fontWeight: '800' },
  playTitle: { color: '#fff', fontSize: 15, fontWeight: '600', flex: 1 },
  giftBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 18, backgroundColor: '#ff6f91', marginRight: 8 },
  giftBtnText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  switchPlayerBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 18, backgroundColor: '#222' },
  switchPlayerText: { color: '#ff6f91', fontSize: 12, fontWeight: '800' },
  exitFullscreenBtn: { position: 'absolute', top: 28, right: 16, zIndex: 1001, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.62)' },
  exitFullscreenText: { color: '#fff', fontSize: 12, fontWeight: '800' },
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
  card: { flexDirection: 'row', padding: 12, backgroundColor: 'rgba(255,255,255,0.46)', marginHorizontal: 12, marginVertical: 6, borderRadius: 16 },
  cardDark: { backgroundColor: 'rgba(20,20,20,0.58)' },
  cover: { width: 112, height: 78, borderRadius: 18, backgroundColor: '#e0e0e0' },
  coverPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  coverPlaceholderText: { fontSize: 13, color: '#3f3f3f', fontWeight: '700' },
  cardInfo: { flex: 1, marginLeft: 12, justifyContent: 'center' },
  cardTitle: { fontSize: 15, fontWeight: '700', color: '#333', marginBottom: 4 },
  cardSub: { fontSize: 12, color: '#3f3f3f', marginBottom: 6 },
  typeRow: { flexDirection: 'row', gap: 4 },
  typeTag: { backgroundColor: '#ff6f9118', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4 },
  giftTag: { backgroundColor: '#13c2c218' },
  typeText: { fontSize: 11, color: '#ff6f91', fontWeight: '700' },
  textLight: { color: '#eee' },
  emptyWrap: { alignItems: 'center', marginTop: 80 },
  empty: { fontSize: 14, color: '#3f3f3f' },
  modalShade: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.72)' },
  giftPanel: { maxHeight: '82%', backgroundColor: 'rgba(18,18,18,0.92)', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 14 },
  giftPanelDark: { backgroundColor: 'rgba(18,18,18,0.94)' },
  giftHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  giftTitle: { fontSize: 18, fontWeight: '800', color: '#f5f5f5' },
  giftStatus: { color: '#d8d8d8', fontSize: 12, marginBottom: 10 },
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
});
