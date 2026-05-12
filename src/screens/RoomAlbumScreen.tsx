import React, { useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Video from 'react-native-video';
import { useNavigation } from '@react-navigation/native';
import { Member } from '../types';
import MemberPicker from '../components/MemberPicker';
import ZoomImageModal from '../components/ZoomImageModal';
import { useSettingsStore, useUiStore } from '../store';
import { FadeInView } from '../components/Motion';
import pocketApi from '../api/pocket48';
import { enqueueDownload } from '../services/downloads';
import { errorMessage, normalizeUrl, parseMaybeJson, pickText, unwrapList } from '../utils/data';
import { formatTimestamp } from '../utils/format';

type RoomMode = 'big' | 'small';

type AlbumItem = {
  id: string;
  url: string;
  type: 'image' | 'video';
  title: string;
  time: any;
  roomMode: RoomMode;
  raw: any;
};

function parseAlbumBody(item: any) {
  const raw = item?.bodys ?? item?.body ?? item?.msgContent ?? item?.content ?? item?.message;
  if (raw && typeof raw === 'object') return raw;
  if (typeof raw !== 'string') return {};
  const direct = parseMaybeJson(raw);
  if (direct && typeof direct === 'object') return direct;
  try {
    let clean = raw.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    if (clean.startsWith('"') && clean.endsWith('"')) clean = clean.slice(1, -1);
    const parsed = JSON.parse(clean);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function mediaUrl(item: any) {
  const body = parseAlbumBody(item);
  return normalizeUrl(pickText(body, [
    'url',
    'imageUrl',
    'videoUrl',
    'mediaUrl',
    'msg.url',
    'message.url',
  ]) || pickText(item, ['url', 'imageUrl', 'videoUrl']));
}

function isVideoItem(item: any, url: string) {
  const body = parseAlbumBody(item);
  const marker = `${item?.sourceType || ''} ${item?.msgType || ''} ${body?.ext || ''} ${body?.type || ''} ${url}`.toUpperCase();
  return marker.includes('VIDEO') || /\.(mp4|mov|m4v|3gp|webm)(\?|$)/i.test(url);
}

function normalizeAlbumItems(res: any, mode: RoomMode): AlbumItem[] {
  const list = unwrapList(res, [
    'content.messageList',
    'content.message',
    'content.list',
    'content.data',
    'data.messageList',
    'messageList',
    'message',
    'list',
  ]);

  return list.map((item, index) => {
    const body = parseAlbumBody(item);
    const url = mediaUrl(item);
    const type: AlbumItem['type'] = isVideoItem(item, url) ? 'video' : 'image';
    return {
      id: String(item.id || item.msgId || item.messageId || `${mode}-${item.createTime || item.msgTime || index}-${url}`),
      url,
      type,
      title: pickText(item, ['starName', 'senderName', 'senderNickName', 'nickName'], type === 'video' ? '房间视频' : '房间图片'),
      time: item.createTime || item.msgTime || item.ctime || body.time,
      roomMode: mode,
      raw: item,
    };
  }).filter((item) => item.url);
}

function nextTimeFrom(res: any, list: AlbumItem[]) {
  const direct = Number(pickText(res, ['content.nextTime', 'content.next', 'data.nextTime', 'nextTime']));
  if (Number.isFinite(direct) && direct > 0) return direct;
  const times = list.map((item) => Number(item.time)).filter((time) => Number.isFinite(time) && time > 0);
  return times.length ? Math.min(...times) : 0;
}

function uniqueMerge(prev: AlbumItem[], next: AlbumItem[]) {
  const seen = new Set(prev.map((item) => `${item.roomMode}:${item.url || item.id}`));
  const merged = [...prev];
  next.forEach((item) => {
    const key = `${item.roomMode}:${item.url || item.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    merged.push(item);
  });
  return merged.sort((a, b) => Number(b.time || 0) - Number(a.time || 0));
}

function channelFor(member: Member, mode: RoomMode) {
  return String(mode === 'small' ? (member.yklzId || '') : (member.channelId || ''));
}

export default function RoomAlbumScreen() {
  const navigation = useNavigation();
  const isDark = useSettingsStore((state) => state.settings.theme === 'dark');
  const showToast = useUiStore((state) => state.showToast);
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [roomMode, setRoomMode] = useState<RoomMode>('big');
  const [items, setItems] = useState<AlbumItem[]>([]);
  const [nextTime, setNextTime] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [previewUrl, setPreviewUrl] = useState('');
  const [playing, setPlaying] = useState<AlbumItem | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('暂无数据');
  const loadingRef = useRef(false);

  const currentChannelId = useMemo(() => selectedMember ? channelFor(selectedMember, roomMode) : '', [roomMode, selectedMember]);

  const loadAlbum = async (member: Member, mode: RoomMode = roomMode, append = false) => {
    if (loadingRef.current) return;
    const channelId = channelFor(member, mode);
    if (!channelId) {
      setStatus(mode === 'small' ? '这个成员没有小房间 channelId。' : '这个成员没有大房间 channelId。');
      setItems([]);
      setHasMore(false);
      return;
    }

    loadingRef.current = true;
    setSelectedMember(member);
    setRoomMode(mode);
    setLoading(true);
    setStatus(`加载中...${mode === 'small' ? '小房间' : '大房间'}相册...`);
    try {
      const res = await pocketApi.getRoomAlbum({ channelId, nextTime: append ? nextTime : 0 });
      const nextItems = normalizeAlbumItems(res, mode);
      const merged = append ? uniqueMerge(items, nextItems) : uniqueMerge([], nextItems);
      const next = nextTimeFrom(res, nextItems);
      setItems(merged);
      setNextTime(next);
      setHasMore(nextItems.length > 0 && next > 0);
      const imageCount = merged.filter((item) => item.type === 'image').length;
      const videoCount = merged.filter((item) => item.type === 'video').length;
      const text = `已加载 ${merged.length} 条 · 图片 ${imageCount} · 视频 ${videoCount}`;
      setStatus(text);
      showToast(text);
    } catch (error) {
      setStatus(`加载失败：${errorMessage(error)}`);
      if (!append) setItems([]);
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  };

  const switchMode = (mode: RoomMode) => {
    if (!selectedMember || mode === roomMode) return;
    setItems([]);
    setNextTime(0);
    setHasMore(false);
    loadAlbum(selectedMember, mode, false);
  };

  const loadMoreAlbum = () => {
    if (!selectedMember || loading || loadingRef.current || !hasMore) return;
    loadAlbum(selectedMember, roomMode, true);
  };

  const downloadItem = async (item: AlbumItem) => {
    try {
      await enqueueDownload({
        url: item.url,
        type: item.type,
        name: selectedMember ? `${selectedMember.ownerName}-${item.roomMode}-${item.type}` : `room-${item.type}`,
      });
      showToast('已加入下载管理');
    } catch (error) {
      showToast(`下载失败：${errorMessage(error)}`);
    }
  };

  if (playing) {
    return (
      <View style={styles.playerPage}>
        <View style={styles.playerHeader}>
          <TouchableOpacity onPress={() => setPlaying(null)}>
            <Text style={styles.backBtn}>返回相册</Text>
          </TouchableOpacity>
          <Text style={styles.playerTitle} numberOfLines={1}>{playing.title}</Text>
          <View style={styles.headerSide} />
        </View>
        <Video source={{ uri: playing.url }} style={styles.player} controls resizeMode="contain" />
      </View>
    );
  }

  return (
    <View style={[styles.container, isDark && styles.containerDark]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backBtn}>返回</Text>
        </TouchableOpacity>
        <Text style={[styles.title, isDark && styles.textLight]}>房间相册</Text>
        <TouchableOpacity onPress={() => selectedMember && loadAlbum(selectedMember, roomMode, false)}>
          <Text style={styles.backBtn}>刷新</Text>
        </TouchableOpacity>
      </View>

      <FadeInView delay={80} duration={300} style={{ flex: 1 }}>
        <View style={styles.pickerWrap}>
          <MemberPicker selectedMember={selectedMember} onSelect={(member) => loadAlbum(member, 'big', false)} />
          <View style={styles.modeRow}>
            <TouchableOpacity style={[styles.modeBtn, roomMode === 'big' && styles.modeBtnActive]} onPress={() => switchMode('big')}>
              <Text style={[styles.modeText, roomMode === 'big' && styles.modeTextActive, isDark && roomMode !== 'big' && styles.textLight]}>大房间</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.modeBtn, roomMode === 'small' && styles.modeBtnActive, !selectedMember?.yklzId && styles.modeBtnDisabled]} onPress={() => switchMode('small')}>
              <Text style={[styles.modeText, roomMode === 'small' && styles.modeTextActive, isDark && roomMode !== 'small' && styles.textLight]}>小房间</Text>
            </TouchableOpacity>
          </View>
          <Text style={[styles.channelText, isDark && styles.textSubLight]}>
            当前 channelId：{currentChannelId || '--'}
          </Text>
          <Text style={[styles.status, isDark && styles.textSubLight]}>{loading ? '加载中...' : status}</Text>
        </View>

        <ZoomImageModal url={previewUrl} onClose={() => setPreviewUrl('')} />
        <FlatList
          data={items}
          numColumns={2}
          keyExtractor={(item) => `${item.roomMode}-${item.id}`}
          contentContainerStyle={styles.grid}
          renderItem={({ item, index }) => (
            <FadeInView delay={80 + index * 30} duration={300} style={{ flex: 1 }}>
              <TouchableOpacity
                style={[styles.mediaCard, isDark && styles.mediaCardDark]}
                activeOpacity={0.9}
                onPress={() => item.type === 'video' ? setPlaying(item) : setPreviewUrl(item.url)}
                onLongPress={() => downloadItem(item)}
              >
                {item.type === 'video' ? (
                  <View style={styles.videoThumb}>
                    <Text style={styles.videoBadge}>视频</Text>
                    <Text style={styles.playMark}>播放</Text>
                  </View>
                ) : (
                  <Image source={{ uri: item.url }} style={styles.photo} resizeMode="cover" />
                )}
                <View style={styles.info}>
                  <Text style={[styles.mediaTitle, isDark && styles.textLight]} numberOfLines={1}>{item.title}</Text>
                  <Text style={[styles.mediaMeta, isDark && styles.textSubLight]}>{item.roomMode === 'small' ? '小房间' : '大房间'} · {formatTimestamp(item.time)}</Text>
                </View>
              </TouchableOpacity>
            </FadeInView>
          )}
          ListEmptyComponent={<Text style={[styles.empty, isDark && styles.textSubLight]}>{loading ? '加载中...' : '暂无相册内容'}</Text>}
          onEndReached={loadMoreAlbum}
          onEndReachedThreshold={0.35}
          ListFooterComponent={hasMore ? (
            <Text style={[styles.footerText, isDark && styles.textSubLight]}>{loading ? '加载中...' : '上滑继续加载'}</Text>
          ) : null}
        />
      </FadeInView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  containerDark: { backgroundColor: 'transparent' },
  header: { paddingTop: 54, paddingHorizontal: 20, paddingBottom: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  backBtn: { color: '#ff6f91', fontSize: 14, fontWeight: '800', minWidth: 56 },
  title: { flex: 1, textAlign: 'center', fontSize: 20, fontWeight: '900', color: '#ff6f91' },
  pickerWrap: { paddingHorizontal: 14, gap: 8 },
  modeRow: { flexDirection: 'row', gap: 10 },
  modeBtn: { flex: 1, minHeight: 42, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.66)' },
  modeBtnActive: { backgroundColor: '#ff6f91' },
  modeBtnDisabled: { opacity: 0.48 },
  modeText: { color: '#444444', fontWeight: '900' },
  modeTextActive: { color: '#ffffff' },
  channelText: { color: '#555555', fontSize: 12 },
  status: { color: '#555555', fontSize: 12 },
  grid: { padding: 10, paddingBottom: 112 },
  mediaCard: { flex: 1, margin: 5, borderRadius: 18, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.72)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.66)' },
  mediaCardDark: { backgroundColor: 'rgba(20,20,20,0.68)', borderColor: 'rgba(255,255,255,0.14)' },
  photo: { width: '100%', aspectRatio: 1, backgroundColor: 'rgba(221,221,221,0.82)' },
  videoThumb: { width: '100%', aspectRatio: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#111111' },
  videoBadge: { position: 'absolute', top: 8, right: 8, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, overflow: 'hidden', backgroundColor: 'rgba(255,111,145,0.90)', color: '#ffffff', fontSize: 11, fontWeight: '900' },
  playMark: { color: '#ffffff', fontSize: 15, fontWeight: '900' },
  info: { padding: 9 },
  mediaTitle: { color: '#222222', fontSize: 13, fontWeight: '900' },
  mediaMeta: { marginTop: 4, color: '#555555', fontSize: 11 },
  footerText: { marginTop: 12, marginBottom: 6, textAlign: 'center', color: '#555555', fontSize: 12, fontWeight: '800' },
  empty: { textAlign: 'center', color: '#555555', marginTop: 60, fontSize: 14 },
  playerPage: { flex: 1, backgroundColor: '#000000' },
  playerHeader: { paddingTop: 48, paddingHorizontal: 16, paddingBottom: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  playerTitle: { flex: 1, color: '#ffffff', fontSize: 15, fontWeight: '900', textAlign: 'center' },
  headerSide: { width: 56 },
  player: { flex: 1, backgroundColor: '#000000' },
  textLight: { color: '#ffffff' },
  textSubLight: { color: '#dddddd' },
});
