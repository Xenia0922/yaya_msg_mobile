/**
 * 房间相册 v3.0（完整重写，功能对齐当前版本）
 *
 * 布局决策：
 *  - 两层：工具条（成员 + 大/小房间）→ 网格。第一张图从 23% 提到 ~14%。
 *  - 网格 gap 12 ≥ 圆角 8（旧版 gap 5 < 圆角 14，卡片视觉粘连）。
 *  - 卡片上**不放任何文字/遮罩**（旧版每条压 34% 黑渐变 + 发送者名，看着像蒙了一层）。
 *  - 成员选择改为底部面板（搜索 + 列表），不再在页面顶部常驻输入框 + chips 两行。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { useNavigation } from '@react-navigation/native';

import pocketApi from '../../api/pocket48';
import { PerfFlatList } from '../../components/PerfFlatList';
import { NetworkImage } from '../../components/NetworkImage';
import ZoomImageModal from '../../components/ZoomImageModal';
import PlayerScreen from '../../player';
import { buildPocketHeaders } from '../../player/resolve/streamResolver';
import { useMemberStore, useUiStore } from '../../store';
import { useI18n } from '../../i18n';
import { usePalette } from '../../theme';
import { errorMessage, normalizeUrl, parseMaybeJson, pickText, unwrapList } from '../../utils/data';
import { memberSearchText } from '../../utils/members';
import { enqueueDownload } from '../../services/downloads';
import type { Member } from '../../types';

import { Screen } from '../layout/Screen';
import { EmptyHint, GRID_GAP, GRID_RADIUS, gridCellWidth } from '../layout/primitives';
import { Segmented } from '../components/Segmented';
import { contentBottom, GUTTER, R, SPACE, TYPE } from '../tokens';

type Mode = 'big' | 'small';
type AlbumItem = { id: string; url: string; type: 'image' | 'video'; time: number; mode: Mode };

const COLUMNS = 2;

function body(item: any): any {
  const raw = item?.bodys ?? item?.body ?? item?.msgContent ?? item?.content ?? item?.message;
  if (raw && typeof raw === 'object') return raw;
  if (typeof raw !== 'string') return {};
  const direct = parseMaybeJson(raw);
  if (direct && typeof direct === 'object') return direct;
  let clean = raw.replace(/\\\\"/g, '"').replace(/\\\\\\\\/g, '\\\\');
  if (clean.startsWith('"') && clean.endsWith('"')) clean = clean.slice(1, -1);
  const again = parseMaybeJson(clean);
  return again && typeof again === 'object' ? again : {};
}

function urlOf(item: any): string {
  const b = body(item);
  return normalizeUrl(
    pickText(b, ['url', 'imageUrl', 'videoUrl', 'mediaUrl', 'msg.url', 'message.url'])
    || pickText(item, ['url', 'imageUrl', 'videoUrl']),
  );
}

function isVideo(item: any, url: string): boolean {
  const b = body(item);
  const marker = `${item?.sourceType || ''} ${item?.msgType || ''} ${b?.ext || ''} ${b?.type || ''} ${url}`.toUpperCase();
  return marker.includes('VIDEO') || /\.(mp4|mov|m4v|3gp|webm)(\?|$)/i.test(url);
}

function toItems(res: any, mode: Mode): AlbumItem[] {
  const list = unwrapList(res, [
    'content.messageList', 'content.message', 'content.list', 'content.data',
    'data.messageList', 'messageList', 'message', 'list',
  ]);
  return list
    .map((raw: any, i: number) => {
      const url = urlOf(raw);
      const b = body(raw);
      const time = Number(raw?.createTime || raw?.msgTime || raw?.ctime || b?.time || 0);
      return {
        id: String(raw?.id || raw?.msgId || raw?.messageId || `${mode}-${time}-${i}`),
        url,
        type: (isVideo(raw, url) ? 'video' : 'image') as AlbumItem['type'],
        time: Number.isFinite(time) ? time : 0,
        mode,
      };
    })
    .filter((x: AlbumItem) => !!x.url);
}

function nextCursor(res: any, list: AlbumItem[]): number {
  const direct = Number(pickText(res, ['content.nextTime', 'content.next', 'data.nextTime', 'nextTime']));
  if (Number.isFinite(direct) && direct > 0) return direct;
  const times = list.map((i) => i.time).filter((n) => Number.isFinite(n) && n > 0);
  return times.length ? Math.min(...times) : 0;
}

export default function RoomAlbumV3() {
  const navigation = useNavigation<any>();
  const palette = usePalette();
  const { t } = useI18n();
  const members = useMemberStore((s) => s.members);
  const showToast = useUiStore((s) => s.showToast);

  const [member, setMember] = useState<Member | null>(null);
  const [mode, setMode] = useState<Mode>('big');
  const [items, setItems] = useState<AlbumItem[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<AlbumItem | null>(null);
  const [playing, setPlaying] = useState<AlbumItem | null>(null);
  const [pickSheet, setPickSheet] = useState(false);
  const [query, setQuery] = useState('');

  const cursorRef = useRef(0);
  const busyRef = useRef(false);
  const reqRef = useRef(0);

  const load = useCallback(async (target: Member, m: Mode, append: boolean) => {
    if (busyRef.current) return;
    const channelId = m === 'small' ? target.yklzId : target.channelId;
    if (!channelId) {
      setError(m === 'small' ? t('这个成员没有小房间') : t('这个成员没有大房间'));
      setItems([]);
      return;
    }
    busyRef.current = true;
    const rid = ++reqRef.current;
    setLoading(true);
    if (!append) setError('');
    const sent = append ? cursorRef.current : 0;
    try {
      const res = await pocketApi.getRoomAlbum({ channelId: String(channelId), nextTime: sent });
      if (rid !== reqRef.current) return;
      const page = toItems(res, m);
      const next = nextCursor(res, page);
      setItems((prev) => {
        if (!append) return page;
        const seen = new Set(prev.map((x) => x.id));
        return [...prev, ...page.filter((x) => !seen.has(x.id))];
      });
      const advanced = next > 0 && next !== sent;
      cursorRef.current = advanced ? next : cursorRef.current;
      setHasMore(page.length > 0 && advanced);
    } catch (e) {
      if (rid !== reqRef.current) return;
      setError(errorMessage(e));
      if (!append) setItems([]);
      setHasMore(false);
    } finally {
      busyRef.current = false;
      if (rid === reqRef.current) setLoading(false);
    }
  }, [t]);

  const pick = useCallback((m: Member) => {
    setMember(m);
    setMode('big');
    setPickSheet(false);
    setQuery('');
    setItems([]);
    cursorRef.current = 0;
    load(m, 'big', false);
  }, [load]);

  const switchMode = useCallback((m: Mode) => {
    if (!member || m === mode) return;
    setMode(m);
    setItems([]);
    cursorRef.current = 0;
    load(member, m, false);
  }, [member, mode, load]);

  const hits = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [] as Member[];
    return members.filter((m) => memberSearchText(m).includes(q)).slice(0, 30);
  }, [members, query]);

  const onLongPress = useCallback(async (item: AlbumItem) => {
    try {
      await enqueueDownload({ url: item.url, type: item.type, name: `room-${item.id}` });
      showToast(t('已加入下载管理'));
    } catch (e) {
      showToast(t('下载失败：{msg}', { msg: errorMessage(e) }));
    }
  }, [showToast, t]);

  if (playing) {
    return (
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        <PlayerScreen
          source={{ kind: 'vod', url: playing.url, headers: buildPocketHeaders() }}
          meta={{ title: t('房间视频') }}
          features={{ kernelSwitch: true }}
          onClose={() => setPlaying(null)}
          persistent
        />
      </View>
    );
  }

  return (
    <Screen
      title={t('房间相册')}
      onBack={() => navigation.goBack()}
      actions={[{ icon: 'refresh', onPress: () => member && load(member, mode, false), disabled: !member }]}
      toolbar={
        <>
          <Pressable style={styles.memberBtn} onPress={() => setPickSheet(true)} hitSlop={6}>
            <Text style={[TYPE.secondary, { color: member ? palette.label : palette.labelTertiary }]} numberOfLines={1}>
              {member?.ownerName || t('选择成员')}
            </Text>
            <MaterialCommunityIcons name="chevron-down" size={16} color={palette.labelTertiary} />
          </Pressable>
          <View style={{ flex: 1 }} />
          {member?.yklzId ? (
            <Segmented
              options={[{ key: 'big' as const, label: t('大房间') }, { key: 'small' as const, label: t('小房间') }]}
              value={mode}
              onChange={switchMode}
            />
          ) : null}
        </>
      }
    >
      {!member ? (
        <EmptyHint icon="account-search-outline" title={t('先选一位成员')} hint={t('点左上角选择成员')} />
      ) : error ? (
        <EmptyHint icon="alert-circle-outline" title={t('加载失败')} hint={error} />
      ) : loading && items.length === 0 ? (
        <View style={styles.center}><ActivityIndicator color={palette.tint} /></View>
      ) : items.length === 0 ? (
        <EmptyHint icon="image-multiple-outline" title={t('暂无相册内容')} />
      ) : (
        <PerfFlatList
          data={items}
          numColumns={COLUMNS}
          keyExtractor={(item: AlbumItem) => `${item.mode}-${item.id}`}
          contentContainerStyle={styles.grid}
          columnWrapperStyle={{ paddingHorizontal: GUTTER - GRID_GAP / 2 }}
          ItemSeparatorComponent={() => <View style={{ height: GRID_GAP }} />}
          initialNumToRender={12}
          maxToRenderPerBatch={12}
          windowSize={7}
          removeClippedSubviews
          onEndReached={() => { if (member && !busyRef.current && hasMore) load(member, mode, true); }}
          onEndReachedThreshold={0.4}
          ListFooterComponent={
            loading && items.length > 0
              ? <Text style={[TYPE.caption, styles.footer, { color: palette.labelTertiary }]}>{t('加载中…')}</Text>
              : null
          }
          refreshControl={
            <RefreshControl
              refreshing={loading && items.length > 0}
              onRefresh={() => member && load(member, mode, false)}
              tintColor={palette.tint}
              colors={[palette.tint]}
            />
          }
          renderItem={({ item }: { item: AlbumItem }) => (
            <Pressable
              style={[styles.cell, { width: gridCellWidth(COLUMNS), paddingHorizontal: GRID_GAP / 2 }]}
              onPress={() => (item.type === 'video' ? setPlaying(item) : setPreview(item))}
              onLongPress={() => onLongPress(item)}
            >
              <View style={[styles.card, { backgroundColor: palette.fill2 }]}>
                <NetworkImage source={{ uri: item.url }} style={StyleSheet.absoluteFill} resizeMode="cover" thumbnail={360} />
                {item.type === 'video' ? (
                  <View pointerEvents="none" style={styles.playWrap}>
                    <MaterialCommunityIcons name="play" size={18} color="#FFFFFF" />
                  </View>
                ) : null}
              </View>
            </Pressable>
          )}
        />
      )}

      <ZoomImageModal url={preview ? preview.url : ''} onClose={() => setPreview(null)} />

      {/* 成员选择：底部面板 */}
      <Modal visible={pickSheet} transparent animationType="fade" onRequestClose={() => setPickSheet(false)}>
        <Pressable style={styles.backdrop} onPress={() => setPickSheet(false)} />
        <View style={[styles.sheet, { backgroundColor: palette.surfaceElevated }]}>
          <View style={styles.handle} />
          <Text style={[TYPE.title, { color: palette.label, paddingHorizontal: GUTTER, paddingTop: SPACE.md }]}>{t('选择成员')}</Text>
          <View style={[styles.searchRow, { borderBottomColor: palette.hairline }]}>
            <MaterialCommunityIcons name="magnify" size={18} color={palette.labelTertiary} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              autoFocus
              placeholder={t('输入成员名，支持拼音')}
              placeholderTextColor={palette.labelTertiary}
              style={[TYPE.body, styles.searchInput, { color: palette.label }]}
              autoCorrect={false}
            />
          </View>
          {query.trim() ? (
            hits.length ? (
              <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: SPACE.lg }}>
                {hits.map((m) => (
                  <Pressable key={m.id} onPress={() => pick(m)} style={styles.memberRow}>
                    <Text style={[TYPE.body, { flex: 1, color: palette.label }]} numberOfLines={1}>{m.ownerName}</Text>
                    <Text style={[TYPE.caption, { color: palette.labelTertiary }]} numberOfLines={1}>
                      {String((m as any).team || '')}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            ) : (
              <View style={{ padding: SPACE.xl }}><Text style={[TYPE.secondary, { color: palette.labelTertiary }]}>{t('没有匹配成员')}</Text></View>
            )
          ) : (
            <View style={{ padding: SPACE.xl }}><Text style={[TYPE.secondary, { color: palette.labelTertiary }]}>{t('输入成员名，支持拼音')}</Text></View>
          )}
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  memberBtn: { flexDirection: 'row', alignItems: 'center', gap: SPACE.xs, maxWidth: 180 },
  grid: { paddingTop: SPACE.md, paddingBottom: contentBottom(false) },
  cell: { paddingVertical: 0 },
  card: { width: '100%', aspectRatio: 3 / 4, borderRadius: GRID_RADIUS, overflow: 'hidden' },
  playWrap: {
    position: 'absolute', left: '50%', top: '50%', width: 36, height: 36, marginLeft: -18, marginTop: -18,
    borderRadius: 18, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.42)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.5)',
  },
  footer: { textAlign: 'center', paddingVertical: SPACE.lg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '62%', borderTopLeftRadius: R.lg, borderTopRightRadius: R.lg },
  handle: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: 'rgba(128,128,128,0.35)', marginTop: SPACE.sm },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, paddingHorizontal: GUTTER, height: 48, borderBottomWidth: StyleSheet.hairlineWidth },
  searchInput: { flex: 1, padding: 0 },
  memberRow: { height: 48, paddingHorizontal: GUTTER, flexDirection: 'row', alignItems: 'center', gap: SPACE.md },
});
