import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  FlatList,
  Image,
  Linking,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Video from 'react-native-video';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useNavigation } from '@react-navigation/native';
import { Member } from '../types';
import MemberPicker from '../components/MemberPicker';
import { useSettingsStore, useUiStore } from '../store';
import pocketApi from '../api/pocket48';
import { enqueueDownload } from '../services/downloads';
import { errorMessage, normalizeUrl, parseMaybeJson, pickText, unwrapList } from '../utils/data';
import { formatTimestamp } from '../utils/format';
import { openNativeLivePlayer } from '../native/LivePlayer';

interface OpenLiveItem {
  key: string;
  liveId: string;
  pageId: string;
  title: string;
  nickname: string;
  cover: string;
  msgTime: number;
  raw: any;
}

function parseExtInfo(item: any) {
  const raw = item?.extInfo || item?.ext || item?.body || item?.bodys || item?.msgContent || '';
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  const fixed = String(raw).replace(/:\s*([0-9]{16,})/g, ':"$1"');
  return parseMaybeJson(fixed) || {};
}

function normalizeCover(value: string) {
  const url = String(value || '').trim();
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;
  return `https://source.48.cn${url.startsWith('/') ? '' : '/'}${url}`;
}

function messageTime(item: any) {
  const time = Number(item?.msgTime || item?.ctime || item?.time || 0);
  return Number.isFinite(time) ? time : 0;
}

function normalizeOpenLiveMessage(item: any, index: number): OpenLiveItem | null {
  const info = parseExtInfo(item);
  const liveId = String(info.liveId || info.live_id || info.videoId || '').trim();
  const pageId = String(info.id || info.openLivePageId || liveId || '').trim();
  if (!liveId && !pageId) return null;
  const title = String(info.title || info.liveTitle || item?.title || '公演记录');
  const nickname = String(info.user?.nickname || info.nickname || info.memberName || info.ownerName || '');
  const msgTime = messageTime(item);
  const msgId = String(item?.msgidClient || item?.msgId || item?.messageId || item?.id || '');
  return {
    key: msgId || `${liveId || pageId}-${msgTime}-${index}`,
    liveId: liveId || pageId,
    pageId: pageId || liveId,
    title,
    nickname,
    cover: normalizeCover(String(info.coverUrl || info.coverPath || info.picPath || '')),
    msgTime,
    raw: item,
  };
}

function normalizeOpenLiveList(res: any): OpenLiveItem[] {
  const list = unwrapList(res, [
    'content.message',
    'content.messageList',
    'content.list',
    'data.message',
    'data.messageList',
    'message',
    'messageList',
    'list',
  ]);
  return list
    .map(normalizeOpenLiveMessage)
    .filter(Boolean) as OpenLiveItem[];
}

function nextTimeFrom(res: any) {
  const value = Number(pickText(res, ['content.nextTime', 'data.nextTime', 'nextTime']));
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function mergeOpenLive(prev: OpenLiveItem[], next: OpenLiveItem[]) {
  const seen = new Set(prev.map((item) => item.key || item.liveId));
  const merged = [...prev];
  next.forEach((item) => {
    const key = item.key || item.liveId;
    if (!key || seen.has(key)) return;
    seen.add(key);
    merged.push(item);
  });
  return merged;
}

function scoreStream(url: string) {
  const lower = url.toLowerCase();
  if (lower.includes('.mp4')) return 100;
  if (lower.includes('.m3u8')) return 90;
  if (lower.includes('.flv')) return 70;
  if (lower.startsWith('rtmp://')) return 60;
  return 40;
}

function pickPlayableUrl(res: any) {
  const streams = unwrapList(res, ['content.playStreams', 'content.streams', 'data.playStreams', 'playStreams']);
  const highQuality = streams.find((stream: any) => Number(stream?.streamType) === 2);
  const highQualityUrl = normalizeUrl(pickText(highQuality, ['streamPath', 'playStreamPath', 'url', 'playUrl']));
  if (highQualityUrl) return highQualityUrl;
  const urls = [
    ...streams.map((item) => normalizeUrl(pickText(item, ['streamPath', 'playStreamPath', 'url', 'playUrl', 'flv', 'm3u8']))),
    normalizeUrl(pickText(res, [
      'content.playStreamPath',
      'content.streamPath',
      'content.playUrl',
      'content.url',
      'data.playStreamPath',
      'data.streamPath',
      'data.playUrl',
      'playStreamPath',
      'streamPath',
      'url',
    ])),
  ].filter(Boolean);
  return Array.from(new Set(urls)).sort((a, b) => scoreStream(b) - scoreStream(a))[0] || '';
}

function needsNative(url: string) {
  const lower = url.toLowerCase();
  return lower.startsWith('rtmp://') || lower.includes('.flv');
}

function shortMemberName(member?: Member | null) {
  return String(member?.ownerName || '').replace(/^(SNH48|GNZ48|BEJ48|CKG48|CGT48)-/, '');
}

export default function OpenLiveScreen() {
  const navigation = useNavigation<any>();
  const isDark = useSettingsStore((state) => state.settings.theme === 'dark');
  const showToast = useUiStore((state) => state.showToast);
  const [member, setMember] = useState<Member | null>(null);
  const [items, setItems] = useState<OpenLiveItem[]>([]);
  const [query, setQuery] = useState('');
  const [nextTime, setNextTime] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('搜索并选择成员后查看公演记录。');
  const [playing, setPlaying] = useState<{ url: string; title: string } | null>(null);
  const [isLandscape, setIsLandscape] = useState(false);
  const loadingRef = useRef(false);

  useEffect(() => () => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => undefined);
  }, []);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!playing) return false;
      setPlaying(null);
      setIsLandscape(false);
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => undefined);
      return true;
    });
    return () => subscription.remove();
  }, [playing]);

  const filtered = useMemo(() => {
    const text = query.trim().toLowerCase();
    if (!text) return items;
    return items.filter((item) => `${item.title} ${item.nickname} ${item.liveId}`.toLowerCase().includes(text));
  }, [items, query]);

  const loadMemberShows = async (nextMember: Member, append = false) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    setMember(nextMember);
    if (!append) {
      setItems([]);
      setNextTime(0);
      setHasMore(false);
    }
    setStatus(`正在加载 ${shortMemberName(nextMember)} 的公演记录...`);
    try {
      const cursor = append ? nextTime : 0;
      const res = await pocketApi.getOpenLive({ memberId: nextMember.id, nextTime: cursor });
      const nextItems = normalizeOpenLiveList(res);
      const nextCursor = nextTimeFrom(res);
      const merged = append ? mergeOpenLive(items, nextItems) : nextItems;
      setItems((prev) => (append ? mergeOpenLive(prev, nextItems) : nextItems));
      setNextTime(nextCursor);
      setHasMore(nextItems.length > 0 && !!nextCursor && nextCursor !== cursor);
      const text = merged.length ? `共 ${merged.length} 场` : '未找到相关记录';
      setStatus(text);
      showToast(text);
    } catch (error) {
      const text = `加载失败：${errorMessage(error)}`;
      setStatus(text);
      showToast(text);
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  };

  const loadMore = () => {
    if (!member || loading || loadingRef.current || !hasMore || !nextTime) return;
    loadMemberShows(member, true);
  };

  const resolveStream = async (item: OpenLiveItem) => {
    const detail = await pocketApi.getOpenLiveOne(item.liveId);
    const url = pickPlayableUrl(detail);
    if (!url) throw new Error('没有解析到播放地址');
    return url;
  };

  const playItem = async (item: OpenLiveItem) => {
    setStatus('正在解析播放地址...');
    try {
      const url = await resolveStream(item);
      if (needsNative(url)) {
        await openNativeLivePlayer(url, item.title, { liveId: item.liveId });
      } else {
        setPlaying({ url, title: item.title });
      }
      setStatus('播放地址已就绪');
    } catch (error) {
      const text = `播放失败：${errorMessage(error)}`;
      setStatus(text);
      showToast(text);
    }
  };

  const downloadItem = async (item: OpenLiveItem) => {
    try {
      const url = await resolveStream(item);
      await enqueueDownload({ url, type: 'replay', name: item.title });
      showToast('已加入下载管理');
    } catch (error) {
      showToast(`下载失败：${errorMessage(error)}`);
    }
  };

  const toggleOrientation = () => {
    const next = !isLandscape;
    setIsLandscape(next);
    ScreenOrientation.lockAsync(next ? ScreenOrientation.OrientationLock.LANDSCAPE : ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => undefined);
  };

  if (playing) {
    return (
      <View style={styles.playerPage}>
        <View style={styles.playerHeader}>
          <TouchableOpacity onPress={() => setPlaying(null)}><Text style={styles.headerAction}>返回</Text></TouchableOpacity>
          <Text style={styles.playerTitle} numberOfLines={1}>{playing.title}</Text>
          <TouchableOpacity onPress={toggleOrientation}><Text style={styles.headerAction}>{isLandscape ? '竖屏' : '横屏'}</Text></TouchableOpacity>
        </View>
        <Video source={{ uri: playing.url }} style={styles.player} controls resizeMode="contain" ignoreSilentSwitch="ignore" />
        <TouchableOpacity style={styles.externalBtn} onPress={() => Linking.openURL(playing.url)}>
          <Text style={styles.externalText}>外部打开</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[styles.container, isDark && styles.containerDark]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}><Text style={styles.headerAction}>返回</Text></TouchableOpacity>
        <Text style={[styles.title, isDark && styles.textLight]}>公演记录</Text>
        <TouchableOpacity disabled={!member || loading} onPress={() => member && loadMemberShows(member)}>
          <Text style={[styles.headerAction, (!member || loading) && styles.disabledText]}>刷新</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.controls}>
        <MemberPicker selectedMember={member} onSelect={(next) => loadMemberShows(next, false)} placeholder="搜索成员并打开公演记录..." />
        <TextInput
          style={[styles.search, isDark && styles.searchDark]}
          placeholder="筛选标题、成员、liveId..."
          placeholderTextColor={isDark ? '#aaaaaa' : '#666666'}
          value={query}
          onChangeText={setQuery}
        />
        <Text style={[styles.status, isDark && styles.textSubLight]}>{loading && !items.length ? '加载中...' : status}</Text>
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.key}
        contentContainerStyle={styles.list}
        onEndReached={loadMore}
        onEndReachedThreshold={0.35}
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            {loading ? <ActivityIndicator color="#ff6f91" /> : null}
            <Text style={[styles.empty, isDark && styles.textSubLight]}>{loading ? '加载中...' : '暂无公演记录'}</Text>
          </View>
        }
        ListFooterComponent={items.length ? (
          <Text style={[styles.footerText, isDark && styles.textSubLight]}>
            {loading ? '加载中...' : hasMore ? '上滑继续加载' : '没有更多了'}
          </Text>
        ) : null}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[styles.card, isDark && styles.cardDark]}
            activeOpacity={0.9}
            onPress={() => playItem(item)}
            onLongPress={() => downloadItem(item)}
          >
            {item.cover ? <Image source={{ uri: item.cover }} style={styles.cover} resizeMode="cover" /> : <View style={styles.coverPlaceholder}><Text style={styles.coverText}>LIVE</Text></View>}
            <View style={styles.cardBody}>
              <Text style={[styles.cardTitle, isDark && styles.textLight]} numberOfLines={2}>{item.title}</Text>
              <Text style={[styles.meta, isDark && styles.textSubLight]} numberOfLines={1}>{item.nickname || shortMemberName(member) || '成员'}</Text>
              <Text style={[styles.time, isDark && styles.textSubLight]}>{formatTimestamp(item.msgTime)}</Text>
            </View>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  containerDark: { backgroundColor: 'transparent' },
  header: { paddingTop: 54, paddingHorizontal: 20, paddingBottom: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerAction: { color: '#ff6f91', fontSize: 14, fontWeight: '800', minWidth: 54 },
  disabledText: { opacity: 0.45 },
  title: { flex: 1, color: '#ff6f91', fontSize: 22, fontWeight: '900', textAlign: 'center' },
  controls: { paddingHorizontal: 14, gap: 8 },
  search: { minHeight: 42, borderRadius: 16, paddingHorizontal: 12, backgroundColor: 'rgba(255,255,255,0.72)', color: '#222222' },
  searchDark: { backgroundColor: 'rgba(255,255,255,0.10)', color: '#ffffff' },
  status: { color: '#555555', fontSize: 12, lineHeight: 18 },
  list: { padding: 14, paddingBottom: 112 },
  card: { flexDirection: 'row', padding: 10, marginBottom: 10, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.72)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.66)' },
  cardDark: { backgroundColor: 'rgba(20,20,20,0.68)', borderColor: 'rgba(255,255,255,0.14)' },
  cover: { width: 82, height: 82, borderRadius: 10, backgroundColor: '#111111' },
  coverPlaceholder: { width: 82, height: 82, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: '#111111' },
  coverText: { color: '#ff6f91', fontSize: 13, fontWeight: '900' },
  cardBody: { flex: 1, minWidth: 0, paddingLeft: 12, justifyContent: 'space-between' },
  cardTitle: { color: '#222222', fontSize: 15, fontWeight: '900', lineHeight: 21 },
  meta: { color: '#555555', fontSize: 12 },
  time: { color: '#555555', fontSize: 11 },
  footerText: { marginVertical: 14, textAlign: 'center', color: '#555555', fontSize: 12, fontWeight: '700' },
  emptyWrap: { minHeight: 220, alignItems: 'center', justifyContent: 'center', gap: 8 },
  empty: { textAlign: 'center', color: '#555555', fontSize: 14 },
  textLight: { color: '#ffffff' },
  textSubLight: { color: '#dddddd' },
  playerPage: { flex: 1, backgroundColor: '#000000' },
  playerHeader: { paddingTop: 48, paddingHorizontal: 16, paddingBottom: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  playerTitle: { flex: 1, color: '#ffffff', textAlign: 'center', fontWeight: '900' },
  player: { flex: 1, backgroundColor: '#000000' },
  externalBtn: { margin: 16, minHeight: 44, borderRadius: 18, backgroundColor: '#ff6f91', alignItems: 'center', justifyContent: 'center' },
  externalText: { color: '#ffffff', fontWeight: '900' },
});
