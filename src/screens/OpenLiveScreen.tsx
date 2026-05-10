import React, { useEffect, useMemo, useState } from 'react';
import {
  FlatList,
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

const GROUPS = [
  { key: 'all', label: '全部', id: 0 },
  { key: 'snh', label: 'SNH', id: 1 },
  { key: 'gnz', label: 'GNZ', id: 2 },
  { key: 'bej', label: 'BEJ', id: 3 },
  { key: 'ckg', label: 'CKG', id: 5 },
  { key: 'cgt', label: 'CGT', id: 6 },
];

function payloadOf(item: any) {
  return parseMaybeJson(item?.body || item?.bodys || item?.msgContent || item?.content || item?.message);
}

function liveIdOf(item: any) {
  const body = payloadOf(item);
  return pickText(item, ['liveId', 'id', 'content.liveId', 'extInfo.liveId'])
    || pickText(body, ['liveId', 'id', 'data.liveId', 'live.liveId']);
}

function liveTitle(item: any) {
  const body = payloadOf(item);
  return pickText(item, ['title', 'liveTitle', 'showName', 'name', 'content.title'])
    || pickText(body, ['title', 'liveTitle', 'showName', 'data.title'])
    || '公演记录';
}

function liveTime(item: any) {
  const body = payloadOf(item);
  return pickText(item, ['showTime', 'startTime', 'ctime', 'msgTime', 'time', 'createTime'])
    || pickText(body, ['showTime', 'startTime', 'ctime', 'time', 'data.startTime']);
}

function memberNameOf(item: any) {
  const body = payloadOf(item);
  return pickText(item, ['memberName', 'starName', 'nickname', 'ownerName', 'content.memberName'])
    || pickText(body, ['memberName', 'starName', 'ownerName', 'data.memberName']);
}

function uniqueShows(items: any[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${liveIdOf(item)}|${liveTitle(item)}|${liveTime(item)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function scoreUrl(url: string) {
  const lower = url.toLowerCase();
  if (lower.includes('.m3u8')) return 100;
  if (lower.includes('.mp4')) return 90;
  if (lower.includes('.flv')) return 70;
  if (lower.startsWith('rtmp://')) return 40;
  return 50;
}

function pickPlayableUrl(res: any) {
  const urls = [
    ...unwrapList(res, ['content.playStreams', 'content.streams', 'data.playStreams', 'playStreams'])
      .map((item) => normalizeUrl(pickText(item, ['streamPath', 'playStreamPath', 'url', 'playUrl', 'flv', 'm3u8']))),
    normalizeUrl(pickText(res, ['content.playStreamPath', 'content.streamPath', 'content.playUrl', 'content.url', 'data.playStreamPath', 'data.streamPath', 'data.playUrl'])),
  ].filter(Boolean);
  return urls.sort((a, b) => scoreUrl(b) - scoreUrl(a))[0] || '';
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
  const [group, setGroup] = useState(GROUPS[0]);
  const [shows, setShows] = useState<any[]>([]);
  const [query, setQuery] = useState('');
  const [nextTime, setNextTime] = useState(0);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('搜索成员或选择团体查看公演记录。');
  const [playing, setPlaying] = useState<{ url: string; title: string; native: boolean } | null>(null);
  const [isLandscape, setIsLandscape] = useState(false);

  useEffect(() => () => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => undefined);
  }, []);

  const filtered = useMemo(() => {
    const text = query.trim().toLowerCase();
    if (!text) return shows;
    return shows.filter((item) => `${liveTitle(item)} ${memberNameOf(item)} ${liveIdOf(item)}`.toLowerCase().includes(text));
  }, [query, shows]);

  const normalizeListFrom = (res: any) => unwrapList(res, [
    'content.message',
    'content.messageList',
    'content.liveList',
    'content.openLiveList',
    'content.records',
    'content.data',
    'content.list',
    'data.liveList',
    'data.openLiveList',
    'data.records',
    'data.list',
    'liveList',
    'openLiveList',
    'records',
    'list',
  ]);

  const loadMemberShows = async (nextMember: Member, append = false) => {
    setMember(nextMember);
    setLoading(true);
    if (!append) setNextTime(0);
    setStatus('正在加载成员公演...');
    try {
      const openRes = await pocketApi.getOpenLive({ memberId: nextMember.id, nextTime: append ? nextTime : 0 }).catch(() => null);
      const memberList = normalizeListFrom(openRes);
      const publicPages = await Promise.all([
        pocketApi.getOpenLivePublicList({ groupId: 0, record: true }).catch(() => null),
        pocketApi.getLiveList({ groupId: 0, record: true, page: 1 }).catch(() => null),
      ]);
      const name = shortMemberName(nextMember);
      const fallback = publicPages.flatMap(normalizeListFrom).filter((item) => {
        const hay = `${liveTitle(item)} ${memberNameOf(item)}`;
        return !name || hay.includes(name) || hay.includes(String(nextMember.id));
      });
      const merged = uniqueShows([...(append ? shows : []), ...memberList, ...fallback]);
      setShows(merged);
      const next = Number(openRes?.content?.nextTime || openRes?.data?.nextTime || 0);
      setNextTime(next);
      const text = merged.length ? `已加载 ${merged.length} 条公演记录` : '暂无公演记录';
      setStatus(text);
      showToast(text);
    } catch (error) {
      setStatus(`加载失败：${errorMessage(error)}`);
      if (!append) setShows([]);
    } finally {
      setLoading(false);
    }
  };

  const loadGroupShows = async (nextGroup = group) => {
    setGroup(nextGroup);
    setMember(null);
    setLoading(true);
    setStatus('正在加载团体公演...');
    try {
      const [openRes, liveRes] = await Promise.all([
        pocketApi.getOpenLivePublicList({ groupId: nextGroup.id, record: true }).catch(() => null),
        pocketApi.getLiveList({ groupId: nextGroup.id, record: true, page: 1 }).catch(() => null),
      ]);
      const list = uniqueShows([...normalizeListFrom(openRes), ...normalizeListFrom(liveRes)]);
      setShows(list);
      const text = list.length ? `已加载 ${list.length} 条公演记录` : '暂无公演记录';
      setStatus(text);
      showToast(text);
    } catch (error) {
      setStatus(`加载失败：${errorMessage(error)}`);
      setShows([]);
    } finally {
      setLoading(false);
    }
  };

  const playShow = async (item: any) => {
    const id = liveIdOf(item);
    if (!id) {
      showToast('没有拿到 liveId');
      return;
    }
    setStatus('正在解析播放地址...');
    try {
      const detail = await pocketApi.getOpenLiveOne(id).catch(() => pocketApi.getLiveOne(id));
      const url = pickPlayableUrl(detail);
      if (!url) throw new Error('没有解析到播放地址');
      const title = liveTitle(item);
      if (needsNative(url)) {
        await openNativeLivePlayer(url, title, { liveId: id });
      } else {
        setPlaying({ url, title, native: false });
      }
      setStatus('播放地址已就绪');
    } catch (error) {
      setStatus(`播放失败：${errorMessage(error)}`);
    }
  };

  const downloadShow = async (item: any) => {
    const id = liveIdOf(item);
    if (!id) return;
    try {
      const detail = await pocketApi.getOpenLiveOne(id).catch(() => pocketApi.getLiveOne(id));
      const url = pickPlayableUrl(detail);
      if (!url) throw new Error('没有解析到下载地址');
      await enqueueDownload({ url, type: 'replay', name: liveTitle(item) });
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
          <TouchableOpacity onPress={() => setPlaying(null)}><Text style={styles.backBtn}>返回</Text></TouchableOpacity>
          <Text style={styles.playerTitle} numberOfLines={1}>{playing.title}</Text>
          <TouchableOpacity onPress={toggleOrientation}><Text style={styles.backBtn}>{isLandscape ? '竖屏' : '全屏'}</Text></TouchableOpacity>
        </View>
        <Video source={{ uri: playing.url }} style={styles.player} controls resizeMode="contain" />
        <TouchableOpacity style={styles.externalBtn} onPress={() => Linking.openURL(playing.url)}>
          <Text style={styles.externalText}>外部打开</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[styles.container, isDark && styles.containerDark]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}><Text style={styles.backBtn}>返回</Text></TouchableOpacity>
        <Text style={[styles.title, isDark && styles.textLight]}>公演记录</Text>
        <TouchableOpacity onPress={() => member ? loadMemberShows(member) : loadGroupShows(group)}><Text style={styles.backBtn}>刷新</Text></TouchableOpacity>
      </View>

      <View style={styles.controls}>
        <MemberPicker selectedMember={member} onSelect={loadMemberShows} />
        <View style={styles.groupRow}>
          {GROUPS.map((item) => (
            <TouchableOpacity key={item.key} style={[styles.groupChip, group.key === item.key && !member && styles.groupChipActive]} onPress={() => loadGroupShows(item)}>
              <Text style={[styles.groupText, group.key === item.key && !member && styles.groupTextActive]}>{item.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <TextInput
          style={[styles.search, isDark && styles.searchDark]}
          placeholder="搜索标题、成员、liveId"
          placeholderTextColor={isDark ? '#aaaaaa' : '#666666'}
          value={query}
          onChangeText={setQuery}
        />
        <Text style={[styles.status, isDark && styles.textSubLight]}>{loading ? '加载中...' : status}</Text>
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(item, index) => `${liveIdOf(item) || index}-${liveTime(item)}`}
        contentContainerStyle={styles.list}
        ListEmptyComponent={<Text style={[styles.empty, isDark && styles.textSubLight]}>{loading ? '加载中...' : '暂无公演记录'}</Text>}
        renderItem={({ item }) => (
          <TouchableOpacity style={[styles.card, isDark && styles.cardDark]} activeOpacity={0.92} onLongPress={() => downloadShow(item)}>
            <Text style={[styles.cardTitle, isDark && styles.textLight]} numberOfLines={2}>{liveTitle(item)}</Text>
            <Text style={[styles.meta, isDark && styles.textSubLight]}>{memberNameOf(item) || '成员'} · {formatTimestamp(liveTime(item))}</Text>
            <View style={styles.actionRow}>
              <TouchableOpacity style={styles.primaryBtn} onPress={() => playShow(item)}><Text style={styles.btnText}>播放</Text></TouchableOpacity>
            </View>
          </TouchableOpacity>
        )}
        ListFooterComponent={member && nextTime ? (
          <TouchableOpacity style={styles.loadMoreBtn} onPress={() => loadMemberShows(member, true)}>
            <Text style={styles.loadMoreText}>继续加载历史记录</Text>
          </TouchableOpacity>
        ) : null}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  containerDark: { backgroundColor: 'transparent' },
  header: { paddingTop: 54, paddingHorizontal: 20, paddingBottom: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  backBtn: { color: '#ff6f91', fontSize: 14, minWidth: 54 },
  title: { flex: 1, color: '#ff6f91', fontSize: 20, fontWeight: '800', textAlign: 'center' },
  controls: { paddingHorizontal: 14, gap: 8 },
  groupRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  groupChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.62)' },
  groupChipActive: { backgroundColor: '#ff6f91' },
  groupText: { color: '#444444', fontSize: 12, fontWeight: '800' },
  groupTextActive: { color: '#ffffff' },
  search: { minHeight: 42, borderRadius: 16, paddingHorizontal: 12, backgroundColor: 'rgba(255,255,255,0.72)', color: '#222222' },
  searchDark: { backgroundColor: 'rgba(255,255,255,0.10)', color: '#ffffff' },
  status: { color: '#555555', fontSize: 12 },
  list: { padding: 14, paddingBottom: 112 },
  card: { padding: 14, marginBottom: 10, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.72)' },
  cardDark: { backgroundColor: 'rgba(20,20,20,0.68)' },
  cardTitle: { color: '#222222', fontSize: 15, fontWeight: '800', lineHeight: 21 },
  meta: { color: '#555555', marginTop: 6, fontSize: 12 },
  actionRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  primaryBtn: { flex: 1, minHeight: 40, borderRadius: 16, backgroundColor: '#ff6f91', alignItems: 'center', justifyContent: 'center' },
  btnText: { color: '#ffffff', fontWeight: '800' },
  loadMoreBtn: { marginVertical: 8, minHeight: 42, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,111,145,0.18)' },
  loadMoreText: { color: '#ff6f91', fontWeight: '800' },
  empty: { textAlign: 'center', marginTop: 60, color: '#555555' },
  textLight: { color: '#ffffff' },
  textSubLight: { color: '#dddddd' },
  playerPage: { flex: 1, backgroundColor: '#000000' },
  playerHeader: { paddingTop: 48, paddingHorizontal: 16, paddingBottom: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  playerTitle: { flex: 1, color: '#ffffff', textAlign: 'center', fontWeight: '800' },
  player: { flex: 1, backgroundColor: '#000000' },
  externalBtn: { margin: 16, minHeight: 44, borderRadius: 18, backgroundColor: '#ff6f91', alignItems: 'center', justifyContent: 'center' },
  externalText: { color: '#ffffff', fontWeight: '800' },
});
