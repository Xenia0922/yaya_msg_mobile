import React, { useEffect, useState } from 'react';
import {
  FlatList,
  Linking,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Video from 'react-native-video';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useNavigation } from '@react-navigation/native';
import { useSettingsStore } from '../store';
import { Member } from '../types';
import { formatTimestamp } from '../utils/format';
import { errorMessage, normalizeUrl, parseMaybeJson, pickText, unwrapList } from '../utils/data';
import MemberPicker from '../components/MemberPicker';
import pocketApi from '../api/pocket48';
import { openNativeLivePlayer } from '../native/LivePlayer';

const GROUPS = [
  { key: 'all', label: '全部', id: 0 },
  { key: 'snh', label: 'SNH', id: 1 },
  { key: 'gnz', label: 'GNZ', id: 2 },
  { key: 'bej', label: 'BEJ', id: 3 },
  { key: 'ckg', label: 'CKG', id: 5 },
  { key: 'cgt', label: 'CGT', id: 6 },
];

function liveTitle(item: any) {
  const body = parseMaybeJson(item?.body || item?.bodys || item?.msgContent || item?.content);
  return pickText(item, ['title', 'liveTitle', 'content.title'])
    || pickText(body, ['title', 'liveTitle', 'data.title'])
    || '公演记录';
}

function liveIdOf(item: any) {
  const body = parseMaybeJson(item?.body || item?.bodys || item?.msgContent || item?.content);
  return pickText(item, ['liveId', 'id', 'extInfo.liveId', 'content.liveId'])
    || pickText(body, ['liveId', 'id', 'data.liveId']);
}

function memberShortName(member: Member) {
  return String(member.ownerName || '').replace(/^(SNH48|GNZ48|BEJ48|CKG48|CGT48)-/, '');
}

function needsVlc(url: string) {
  const lower = url.toLowerCase();
  return lower.startsWith('rtmp://') || lower.includes('.flv');
}

function pickOpenLiveUrl(res: any) {
  const score = (url: string) => {
    const lower = url.toLowerCase();
    if (lower.includes('.m3u8')) return 100;
    if (lower.includes('.flv')) return 60;
    if (lower.startsWith('rtmp://')) return 30;
    return 40;
  };
  const streams = unwrapList(res, ['content.playStreams', 'data.playStreams', 'playStreams']);
  const urls = streams
    .map((item) => normalizeUrl(pickText(item, ['streamPath', 'playStreamPath', 'url', 'playUrl'])))
    .filter(Boolean)
    .sort((a, b) => score(b) - score(a));
  return urls[0] || normalizeUrl(pickText(res, ['content.playStreamPath', 'content.streamPath', 'data.playStreamPath', 'data.streamPath']));
}

export default function OpenLiveScreen() {
  const navigation = useNavigation<any>();
  const isDark = useSettingsStore((state) => state.settings.theme === 'dark');
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [shows, setShows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [groupFilter, setGroupFilter] = useState('all');
  const [playing, setPlaying] = useState<{ url: string; title: string; vlc: boolean } | null>(null);
  const [playerError, setPlayerError] = useState('');
  const [isLandscape, setIsLandscape] = useState(false);

  useEffect(() => {
    const parent = navigation.getParent?.();
    parent?.setOptions({ tabBarStyle: playing ? { display: 'none' } : undefined });
    return () => parent?.setOptions({ tabBarStyle: undefined });
  }, [navigation, playing]);

  useEffect(() => () => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
  }, []);

  const toggleOrientation = () => {
    const next = !isLandscape;
    setIsLandscape(next);
    ScreenOrientation.lockAsync(
      next ? ScreenOrientation.OrientationLock.LANDSCAPE : ScreenOrientation.OrientationLock.PORTRAIT_UP,
    ).catch(() => {});
  };

  const loadShows = async (member: Member) => {
    setSelectedMember(member);
    setLoading(true);
    setStatus('加载成员公演...');
    try {
      const res = await pocketApi.getOpenLive({ memberId: member.id });
      let list = unwrapList(res, [
        'content.messageList',
        'content.liveList',
        'content.openLiveList',
        'content.data',
        'content.data.list',
        'content.list',
        'data.messageList',
        'data.liveList',
        'data.openLiveList',
        'data.list',
        'messageList',
        'liveList',
        'openLiveList',
        'list',
      ]);
      if (!list.length) {
        const groupIds = [0, 1, 2, 3, 5, 6];
        const all = await Promise.all(groupIds.map((groupId) =>
          pocketApi.getOpenLivePublicList({ groupId, record: true }).catch(() => null)));
        const name = memberShortName(member);
        list = all.flatMap((item) => unwrapList(item, [
          'content.liveList',
          'content.openLiveList',
          'content.records',
          'content.data',
          'content.data.list',
          'content.list',
          'data.liveList',
          'data.openLiveList',
          'data.records',
          'data.list',
          'liveList',
          'openLiveList',
          'records',
          'list',
        ]))
          .filter((item) => !name || liveTitle(item).includes(name) || String(item.memberName || item.nickname || '').includes(name));
      }
      setShows(list);
      setStatus(list.length ? `加载完成：${list.length} 条` : '暂无公演记录');
    } catch (error) {
      setStatus(`加载失败：${errorMessage(error)}`);
      setShows([]);
    } finally {
      setLoading(false);
    }
  };

  const loadGroupShows = async (group: typeof GROUPS[number]) => {
    setGroupFilter(group.key);
    setSelectedMember(null);
    setLoading(true);
    setStatus('加载团体公演...');
    try {
      const res = await pocketApi.getOpenLivePublicList({ groupId: group.id, record: true });
      const list = unwrapList(res, [
        'content.liveList',
        'content.openLiveList',
        'content.records',
        'content.data',
        'content.data.list',
        'content.list',
        'data.liveList',
        'data.openLiveList',
        'data.records',
        'data.list',
        'liveList',
        'openLiveList',
        'list',
        'records',
      ]);
      setShows(list);
      setStatus(list.length ? `加载完成：${list.length} 条` : '暂无公演记录');
    } catch (error) {
      setStatus(`加载失败：${errorMessage(error)}`);
      setShows([]);
    } finally {
      setLoading(false);
    }
  };

  const playShow = async (item: any) => {
    const liveId = liveIdOf(item);
    if (!liveId) {
      setStatus('这个公演记录缺少 liveId，无法播放');
      return;
    }
    setLoading(true);
    setPlayerError('');
    setIsLandscape(false);
    setStatus('解析公演播放地址...');
    try {
      const res = await pocketApi.getOpenLiveOne(String(liveId));
      const url = pickOpenLiveUrl(res);
      if (!url) throw new Error('公演详情没有返回可播放流');
      setPlaying({ url, title: liveTitle(item), vlc: needsVlc(url) });
      setStatus('');
    } catch (error) {
      setStatus(`解析失败：${errorMessage(error)}`);
    } finally {
      setLoading(false);
    }
  };

  if (playing) {
    return (
      <View style={styles.playerPage}>
        <View style={styles.playHeader}>
          <TouchableOpacity
            onPress={() => {
              setIsLandscape(false);
              ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
              setPlaying(null);
            }}
          >
            <Text style={styles.playBack}>返回</Text>
          </TouchableOpacity>
          <Text style={styles.playTitle} numberOfLines={1}>{playing.title}</Text>
          <TouchableOpacity onPress={toggleOrientation} style={styles.orientationBtn}>
            <Text style={styles.orientationText}>{isLandscape ? '竖屏' : '横屏'}</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.player}>
          {playing.vlc ? (
            <View style={styles.vlcGate}>
              <Text style={styles.vlcGateTitle}>已解析到直播流</Text>
              <Text style={styles.vlcGateText}>
                这个流是 RTMP / HTTP-FLV。当前测试包会使用 ExoPlayer RTMP/FLV 引擎，不再切换到 IJK。
              </Text>
              <Text style={styles.vlcGateUrl} numberOfLines={4}>{playing.url}</Text>
              <TouchableOpacity
                style={styles.vlcPrimaryBtn}
                onPress={() => {
                  try {
                    openNativeLivePlayer(playing.url, playing.title);
                  } catch (err: any) {
                    setPlayerError(err?.message || String(err));
                  }
                }}
              >
                <Text style={styles.vlcPrimaryText}>打开 Exo RTMP 播放器</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.vlcSecondaryBtn} onPress={() => Linking.openURL(playing.url).catch(() => setPlayerError('外部播放器无法打开这个地址'))}>
                <Text style={styles.vlcSecondaryText}>用外部播放器打开</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <Video source={{ uri: playing.url }} style={styles.player} controls paused={false} resizeMode="contain" ignoreSilentSwitch="ignore" />
          )}
          {playerError ? <Text style={styles.playerError}>{playerError}</Text> : null}
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, isDark && styles.containerDark]}>
      <View style={[styles.header, isDark && styles.headerDark]}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backBtn}>返回</Text>
        </TouchableOpacity>
        <Text style={[styles.title, isDark && styles.textDark]}>公演记录</Text>
      </View>
      <View style={styles.pickerWrap}>
        <MemberPicker selectedMember={selectedMember} onSelect={loadShows} />
      </View>
      <View style={styles.groupRow}>
        {GROUPS.map((group) => (
          <TouchableOpacity
            key={group.key}
            style={[styles.chip, groupFilter === group.key && styles.chipActive]}
            onPress={() => loadGroupShows(group)}
          >
            <Text style={[styles.chipText, groupFilter === group.key && styles.chipTextActive]}>{group.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {status ? <Text style={styles.status}>{status}</Text> : null}
      <FlatList
        data={shows}
        keyExtractor={(item, index) => String(liveIdOf(item) || item.msgId || index)}
        renderItem={({ item }) => (
          <TouchableOpacity style={[styles.card, isDark && styles.cardDark]} onPress={() => playShow(item)}>
            <Text style={[styles.cardTitle, isDark && styles.textDark]}>{liveTitle(item)}</Text>
            <Text style={[styles.cardDate, isDark && styles.textSubDark]}>
              {formatTimestamp(item.startTime || item.msgTime || item.ctime)}
            </Text>
          </TouchableOpacity>
        )}
        ListEmptyComponent={<Text style={styles.empty}>{loading ? '加载中...' : '搜索成员或选择团体查看公演'}</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  containerDark: { backgroundColor: 'transparent' },
  header: { paddingTop: 54, paddingHorizontal: 20, paddingBottom: 14, marginBottom: 4 },
  headerDark: {},
  backBtn: { color: '#ff6f91', fontSize: 14, marginBottom: 6 },
  title: { fontSize: 20, fontWeight: 'bold', color: '#ff6f91' },
  pickerWrap: { padding: 16 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.38)', marginRight: 8 },
  chipActive: { backgroundColor: '#ff6f91' },
  chipText: { fontSize: 12, color: '#444' },
  chipTextActive: { color: '#fff' },
  groupRow: { flexDirection: 'row', paddingHorizontal: 16, marginBottom: 8, gap: 6 },
  status: { marginHorizontal: 16, marginBottom: 8, color: '#444', fontSize: 12 },
  card: { padding: 14, backgroundColor: 'rgba(255,255,255,0.46)', marginHorizontal: 16, marginVertical: 4, borderRadius: 16 },
  cardDark: { backgroundColor: 'rgba(20,20,20,0.58)' },
  cardTitle: { fontSize: 14, fontWeight: '600', color: '#333' },
  cardDate: { fontSize: 11, color: '#3f3f3f', marginTop: 4 },
  playerPage: { flex: 1, backgroundColor: '#000' },
  playHeader: { flexDirection: 'row', alignItems: 'center', padding: 8, paddingTop: 22, backgroundColor: '#111' },
  playBack: { color: '#ff6f91', fontSize: 14, fontWeight: '800', padding: 8 },
  playTitle: { color: '#fff', fontSize: 15, fontWeight: '800', flex: 1 },
  orientationBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 18, backgroundColor: '#222' },
  orientationText: { color: '#ff6f91', fontSize: 12, fontWeight: '800' },
  player: { flex: 1, backgroundColor: '#000' },
  vlcGate: { flex: 1, backgroundColor: '#050505', justifyContent: 'center', padding: 22 },
  vlcGateTitle: { color: '#fff', fontSize: 22, fontWeight: '900', marginBottom: 12 },
  vlcGateText: { color: '#d8d8d8', fontSize: 14, lineHeight: 22, marginBottom: 14 },
  vlcGateUrl: { color: '#d8d8d8', fontSize: 11, lineHeight: 16, marginBottom: 18 },
  vlcPrimaryBtn: { backgroundColor: '#ff6f91', borderRadius: 16, paddingVertical: 13, alignItems: 'center', marginBottom: 10 },
  vlcPrimaryText: { color: '#fff', fontSize: 15, fontWeight: '900' },
  vlcSecondaryBtn: { backgroundColor: '#222', borderRadius: 16, paddingVertical: 13, alignItems: 'center' },
  vlcSecondaryText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  playerError: { position: 'absolute', left: 16, right: 16, bottom: 20, color: '#fff', backgroundColor: 'rgba(0,0,0,0.72)', padding: 10, borderRadius: 18 },
  textDark: { color: '#eee' },
  textSubDark: { color: '#eeeeee' },
  empty: { textAlign: 'center', color: '#3f3f3f', marginTop: 60, fontSize: 14 },
});
