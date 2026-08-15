import React, { useCallback, useMemo, useRef, useState } from 'react';
import { PerfFlatList } from '../components/PerfFlatList';
import { NetworkImage } from '../components/NetworkImage';

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
import ScreenHeader from '../components/ScreenHeader';
import { useAppTheme } from '../hooks/useAppTheme';
import { usePalette } from '../theme';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { translate, useI18n } from '../i18n';

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
    // Only attempt cleaning if JSON parse fails
    const direct = parseMaybeJson(raw);
    if (direct && typeof direct === 'object') return direct;
    // Clean double-escaped strings: \\" -> " and \\ -> \
    let clean = raw.replace(/\\\\"/g, '"').replace(/\\\\\\\\/g, '\\\\');
    if (clean.startsWith('"') && clean.endsWith('"')) clean = clean.slice(1, -1);
    try { return JSON.parse(clean) || {}; } catch { return {}; }
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
      title: pickText(item, ['starName', 'senderName', 'senderNickName', 'nickName'], type === 'video' ? translate('房间视频') : translate('房间图片')),
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
  const isDark = useAppTheme();
  const palette = usePalette();
  const { t } = useI18n();
  const showToast = useUiStore((state) => state.showToast);
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [roomMode, setRoomMode] = useState<RoomMode>('big');
  const [items, setItems] = useState<AlbumItem[]>([]);
  const [nextTime, setNextTime] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [previewUrl, setPreviewUrl] = useState('');
  const [playing, setPlaying] = useState<AlbumItem | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState(t('暂无数据'));
  const loadingRef = useRef(false);

  const currentChannelId = useMemo(() => selectedMember ? channelFor(selectedMember, roomMode) : '', [roomMode, selectedMember]);

  const loadAlbum = async (member: Member, mode: RoomMode = roomMode, append = false) => {
    if (loadingRef.current) return;
    const channelId = channelFor(member, mode);
    if (!channelId) {
      setStatus(mode === 'small' ? t('这个成员没有小房间 channelId。') : t('这个成员没有大房间 channelId。'));
      setItems([]);
      setHasMore(false);
      return;
    }

    loadingRef.current = true;
    setSelectedMember(member);
    setRoomMode(mode);
    setLoading(true);
    setStatus('');
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
      const text = t('已加载 {count} 条 · 图片 {image} · 视频 {video}', { count: merged.length, image: imageCount, video: videoCount });
      setStatus(text);
      showToast(text);
    } catch (error) {
      setStatus(t('加载失败：{msg}', { msg: errorMessage(error) }));
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
    setRoomMode(mode); // update UI immediately, don't wait for loadAlbum
    loadAlbum(selectedMember, mode, false);
  };

  const loadMoreAlbum = () => {
    if (!selectedMember || loading || loadingRef.current || !hasMore) return;
    loadAlbum(selectedMember, roomMode, true);
  };

  const downloadItem = useCallback(async (item: AlbumItem) => {
    try {
      await enqueueDownload({
        url: item.url,
        type: item.type,
        name: selectedMember ? `${selectedMember.ownerName}-${item.roomMode}-${item.type}` : `room-${item.type}`,
      });
      showToast(t('已加入下载管理'));
    } catch (error) {
      showToast(t('下载失败：{msg}', { msg: errorMessage(error) }));
    }
  }, [selectedMember, showToast]);

  // 稳定回调：让网格行组件可被 React.memo 记忆，避免父组件状态变化引发整网格重渲染/重解码。
  const handleOpen = useCallback((item: AlbumItem) => {
    if (item.type === 'video') setPlaying(item);
    else setPreviewUrl(item.url);
  }, [setPlaying, setPreviewUrl]);

  const handleLong = useCallback((item: AlbumItem) => {
    downloadItem(item);
  }, [downloadItem]);

  const renderAlbumItem = useCallback(({ item }: { item: AlbumItem }) => (
    <AlbumGridItem item={item} isDark={isDark} palette={palette} onOpen={handleOpen} onLongPress={handleLong} />
  ), [isDark, palette, handleOpen, handleLong]);

  if (playing) {
    return (
      <View style={styles.playerPage}>
        <ScreenHeader title={playing.title} onBack={() => setPlaying(null)} />
        <Video source={{ uri: playing.url }} style={styles.player} controls resizeMode="contain" ignoreSilentSwitch="ignore" onError={() => setPlaying(null)} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScreenHeader title={t('房间相册')} right={
        <TouchableOpacity onPress={() => selectedMember && loadAlbum(selectedMember, roomMode, false)}>
          <Text style={[styles.backBtn, { color: palette.tint }]}>{t('刷新')}</Text>
        </TouchableOpacity>
      } />

      <FadeInView delay={80} duration={300} style={{ flex: 1 }}>
        <View style={styles.pickerWrap}>
          <MemberPicker selectedMember={selectedMember} onSelect={(member) => loadAlbum(member, 'big', false)} />
          <View style={styles.modeRow}>
            <TouchableOpacity
              style={[styles.modeBtn, { backgroundColor: roomMode === 'big' ? palette.tint : palette.surface, borderColor: palette.hairline, borderWidth: StyleSheet.hairlineWidth }]}
              onPress={() => switchMode('big')}
            >
              <Text style={[styles.modeText, { color: roomMode === 'big' ? '#FFFFFF' : palette.labelSecondary }]}>{t('大房间')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modeBtn, { backgroundColor: roomMode === 'small' ? palette.tint : palette.surface, borderColor: palette.hairline, borderWidth: StyleSheet.hairlineWidth }, !selectedMember?.yklzId && styles.modeBtnDisabled]}
              onPress={() => switchMode('small')}
            >
              <Text style={[styles.modeText, { color: roomMode === 'small' ? '#FFFFFF' : palette.labelSecondary }]}>{t('小房间')}</Text>
            </TouchableOpacity>
          </View>
          <Text style={[styles.channelText, { color: palette.labelSecondary }]}>
            {t('当前 channelId：{id}', { id: currentChannelId || '--' })}
          </Text>
          <Text style={[styles.status, { color: palette.labelSecondary }]}>{loading ? '' : status}</Text>
        </View>

        <ZoomImageModal url={previewUrl} onClose={() => setPreviewUrl('')} />
        <PerfFlatList
          data={items}
          numColumns={2}
            keyExtractor={(item) => `${item.roomMode}-${item.id}`}
            contentContainerStyle={styles.grid}
            initialNumToRender={12}
            maxToRenderPerBatch={12}
            windowSize={7}
            removeClippedSubviews
            renderItem={renderAlbumItem}
          ListEmptyComponent={<Text style={[styles.empty, { color: palette.labelTertiary }]}>{loading ? '' : t('暂无相册内容')}</Text>}
          onEndReached={loadMoreAlbum}
          onEndReachedThreshold={0.35}
          ListFooterComponent={hasMore ? (
            <Text style={[styles.footerText, { color: palette.labelSecondary }]}>{loading ? '' : t('上滑加载更多')}</Text>
          ) : null}
        />
      </FadeInView>
    </View>
  );
}

// --- 模块级记忆化网格项：避免翻页/loading 状态变化引发整网格重渲染 ---
const AlbumGridItem = React.memo(function AlbumGridItem({
  item,
  isDark,
  palette,
  onOpen,
  onLongPress,
}: {
  item: AlbumItem;
  isDark: boolean;
  palette: any;
  onOpen: (item: AlbumItem) => void;
  onLongPress: (item: AlbumItem) => void;
}) {
  const { t } = useI18n();
  return (
    <FadeInView duration={300} style={{ flex: 1 }}>
      <TouchableOpacity
        style={[styles.mediaCard, { backgroundColor: palette.surface, borderColor: palette.hairline, borderWidth: StyleSheet.hairlineWidth }]}
        activeOpacity={0.9}
        onPress={() => onOpen(item)}
        onLongPress={() => onLongPress(item)}
      >
        {item.type === 'video' ? (
          <View style={[styles.videoThumb, { backgroundColor: palette.fill3 }]}>
            <View style={[styles.videoBadge, { backgroundColor: palette.tint }]}>
              <MaterialCommunityIcons name="video" size={11} color="#FFFFFF" style={{ marginRight: 3 }} />
              <Text style={styles.videoBadgeText}>{t('视频')}</Text>
            </View>
            <MaterialCommunityIcons name="play" size={26} color="#FFFFFF" style={styles.playMark} />
          </View>
        ) : (
          <NetworkImage source={{ uri: item.url }} style={[styles.photo, { backgroundColor: palette.fill3 }]} resizeMode="cover" />
        )}
        <View style={styles.info}>
          <Text style={[styles.mediaTitle, { color: palette.label }]} numberOfLines={1}>{item.title}</Text>
          <Text style={[styles.mediaMeta, { color: palette.labelTertiary }]} numberOfLines={1}>{item.roomMode === 'small' ? t('小房间') : t('大房间')} · {formatTimestamp(item.time)}</Text>
        </View>
      </TouchableOpacity>
    </FadeInView>
  );
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  backBtn: { fontSize: 14, fontWeight: '800', minWidth: 56 },
  pickerWrap: { paddingHorizontal: 16, gap: 8 },
  modeRow: { flexDirection: 'row', gap: 10 },
  modeBtn: { flex: 1, minHeight: 42, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  modeBtnDisabled: { opacity: 0.48 },
  modeText: { fontWeight: '800', fontSize: 13 },
  channelText: { fontSize: 12 },
  status: { fontSize: 12 },
  grid: { padding: 10, paddingBottom: 112 },
  mediaCard: { flex: 1, margin: 4, borderRadius: 16, overflow: 'hidden' },
  photo: { width: '100%', aspectRatio: 1 },
  videoThumb: { width: '100%', aspectRatio: 1, alignItems: 'center', justifyContent: 'center' },
  videoBadge: { position: 'absolute', top: 8, right: 8, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, overflow: 'hidden' },
  videoBadgeText: { color: '#FFFFFF', fontSize: 11, fontWeight: '800' },
  playMark: { marginLeft: 2 },
  info: { padding: 10 },
  mediaTitle: { fontSize: 13, fontWeight: '700', lineHeight: 17 },
  mediaMeta: { marginTop: 4, fontSize: 11 },
  footerText: { marginTop: 12, marginBottom: 6, textAlign: 'center', fontSize: 12, fontWeight: '800' },
  empty: { textAlign: 'center', marginTop: 60, fontSize: 14 },
  playerPage: { flex: 1, backgroundColor: '#000000' },
  player: { flex: 1, backgroundColor: '#000000' },
});
