/**
 * 房间相册 —— 重写版（2026-10-12）
 *
 * 旧实现（531 行，`0ee880f` 以「有问题未实现」删除后本轮短暂恢复）实测三处硬伤，本版针对性重写：
 *  1. **2 列网格整行塌成一张全宽变形图、50 张图一张都看不见** —— 旧版每个网格项外面包了
 *     `FadeInView` 但没给它宽度，内层卡片的 `flex:1` 没有可依据的宽度。
 *     本版：**格容器自己 `width:'50%'`**（不用 flex:1，奇数张时最后一张也不会被拉成整行），
 *     且**不再逐项包 FadeInView**（50 项逐个入场动画既卡又容易出布局问题）。
 *  2. **相册页顶部挂着一张房间背景大图** —— 相册页不该出现房间背景图，本版**整块删除**，
 *     连带那次多余的 roomMeta 请求（房间名对浏览相册没有价值，模式由分段控件表达）。
 *  3. **状态文案混乱**：`status` 初值就是「暂无数据」，加载完成后又同时弹 toast + 行内文字。
 *     本版：状态机收敛为「未选成员 / 加载中 / 失败 / 空 / 列表」五态，只在一处渲染。
 *
 * 列表图片一律走 48 图床缩略图（`NetworkImage thumbnail`），滚动不拉原图；点开大图才用原图。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { useNavigation } from '@react-navigation/native';

import ScreenHeader from '../components/ScreenHeader';
import { HeaderAction } from '../components/HeaderAction';
import { PerfFlatList } from '../components/PerfFlatList';
import { NetworkImage } from '../components/NetworkImage';
import MemberPicker from '../components/MemberPicker';
import ZoomImageModal from '../components/ZoomImageModal';
import { GlassSegmented } from '../components/GlassSegmented';
import { ScalePressable } from '../components/Motion';
import { Skeleton } from '../components/Skeleton';
import { EmptyState, ErrorState } from '../components/StateViews';
import PlayerScreen from '../player';
import { buildPocketHeaders } from '../player/resolve/streamResolver';

import pocketApi from '../api/pocket48';
import { enqueueDownload } from '../services/downloads';
import { useUiStore } from '../store';
import { useI18n } from '../i18n';
import { errorMessage, normalizeUrl, parseMaybeJson, pickText, unwrapList } from '../utils/data';
import { formatDuration } from '../utils/format';
import { usePalette, radiiAlias } from '../theme';
import { typography } from '../theme/typography';
import type { Member } from '../types';

type RoomMode = 'big' | 'small';

type AlbumItem = {
  id: string;
  url: string;
  type: 'image' | 'video';
  title: string;
  time: number;
  mode: RoomMode;
};

const COLUMNS = 2;
/** 网格态缩略图宽度（48 图床 resize 参数） */
const THUMB_W = 360;

/** 相册条目正文可能被双层转义成字符串（\" → "），逐层降级解析 */
function parseAlbumBody(item: any): any {
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

function mediaUrl(item: any): string {
  const body = parseAlbumBody(item);
  return normalizeUrl(
    pickText(body, ['url', 'imageUrl', 'videoUrl', 'mediaUrl', 'msg.url', 'message.url'])
    || pickText(item, ['url', 'imageUrl', 'videoUrl']),
  );
}

function isVideoItem(item: any, url: string): boolean {
  const body = parseAlbumBody(item);
  const marker = `${item?.sourceType || ''} ${item?.msgType || ''} ${body?.ext || ''} ${body?.type || ''} ${url}`.toUpperCase();
  return marker.includes('VIDEO') || /\.(mp4|mov|m4v|3gp|webm)(\?|$)/i.test(url);
}

function mediaDuration(item: any): number {
  const body = parseAlbumBody(item);
  const n = Number(
    pickText(body, ['duration', 'time', 'videoDuration', 'videoTime', 'length'])
    || pickText(item, ['duration', 'videoDuration', 'videoTime', 'length']),
  );
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** 列表 → 视图模型（丢掉没解析出 url 的脏条目） */
function toItems(res: any, mode: RoomMode): AlbumItem[] {
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
  return list
    .map((raw: any, index: number) => {
      const url = mediaUrl(raw);
      const body = parseAlbumBody(raw);
      const type: AlbumItem['type'] = isVideoItem(raw, url) ? 'video' : 'image';
      const time = Number(raw?.createTime || raw?.msgTime || raw?.ctime || body?.time || 0);
      return {
        id: String(raw?.id || raw?.msgId || raw?.messageId || `${mode}-${time}-${index}`),
        url,
        type,
        title: pickText(raw, ['starName', 'senderName', 'senderNickName', 'nickName'], ''),
        time: Number.isFinite(time) ? time : 0,
        mode,
      };
    })
    .filter((item: AlbumItem) => !!item.url);
}

/** 下一页游标：优先取响应体，退化到本页最早一条的时间戳 */
function nextCursor(res: any, list: AlbumItem[]): number {
  const direct = Number(pickText(res, ['content.nextTime', 'content.next', 'data.nextTime', 'nextTime']));
  if (Number.isFinite(direct) && direct > 0) return direct;
  const times = list.map((item) => item.time).filter((time) => Number.isFinite(time) && time > 0);
  return times.length ? Math.min(...times) : 0;
}

export default function RoomAlbumScreen() {
  const navigation = useNavigation<any>();
  const palette = usePalette();
  const { t } = useI18n();
  const showToast = useUiStore((state) => state.showToast);

  const [member, setMember] = useState<Member | null>(null);
  const [mode, setMode] = useState<RoomMode>('big');
  const [items, setItems] = useState<AlbumItem[]>([]);
  const [cursor, setCursor] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<AlbumItem | null>(null);
  const [playing, setPlaying] = useState<AlbumItem | null>(null);

  /** 请求序号：切成员/切房间时丢弃过期响应（否则旧请求会把新列表覆盖回去） */
  const reqRef = useRef(0);
  const busyRef = useRef(false);
  const cursorRef = useRef(0);

  const load = useCallback(
    async (target: Member, roomMode: RoomMode, append: boolean) => {
      const channelId = roomMode === 'small' ? target.yklzId : target.channelId;
      if (!channelId) {
        ++reqRef.current;
        busyRef.current = false;
        setLoading(false);
        setError(roomMode === 'small' ? t('这个成员没有小房间') : t('这个成员没有大房间'));
        setItems([]);
        setHasMore(false);
        return;
      }
      const rid = ++reqRef.current;
      busyRef.current = true;
      setLoading(true);
      if (!append) setError('');
      const sentCursor = append ? cursorRef.current : 0;
      try {
        const res = await pocketApi.getRoomAlbum({ channelId: String(channelId), nextTime: sentCursor });
        if (rid !== reqRef.current) return; // 已切走，丢弃
        const page = toItems(res, roomMode);
        const next = nextCursor(res, page);
        setItems((prev) => {
          if (!append) return page;
          const seen = new Set(prev.map((item) => item.id));
          return [...prev, ...page.filter((item) => !seen.has(item.id))];
        });
        // 游标没前进（或本页为空）就终止，防死循环
        const advanced = next > 0 && next !== sentCursor;
        cursorRef.current = advanced ? next : cursorRef.current;
        setCursor(cursorRef.current);
        setHasMore(page.length > 0 && advanced);
      } catch (e) {
        if (rid !== reqRef.current) return;
        setError(errorMessage(e));
        if (!append) setItems([]);
        setHasMore(false);
      } finally {
        if (rid === reqRef.current) {
          busyRef.current = false;
          setLoading(false);
        }
      }
    },
    [t],
  );

  const pickMember = useCallback(
    (next: Member) => {
      setMember(next);
      setMode('big');
      setItems([]);
      setHasMore(false);
      cursorRef.current = 0;
      setCursor(0);
      load(next, 'big', false);
    },
    [load],
  );

  const switchMode = useCallback(
    (next: RoomMode) => {
      if (!member || next === mode) return;
      setMode(next);
      setItems([]);
      setHasMore(false);
      cursorRef.current = 0;
      setCursor(0);
      load(member, next, false);
    },
    [member, mode, load],
  );

  const refresh = useCallback(() => {
    if (!member) return;
    cursorRef.current = 0;
    setCursor(0);
    load(member, mode, false);
  }, [member, mode, load]);

  const loadMore = useCallback(() => {
    if (!member || loading || busyRef.current || !hasMore) return;
    load(member, mode, true);
  }, [member, mode, loading, hasMore, load]);

  /** 长按下载（图片/视频都以原图地址入队） */
  const download = useCallback(
    async (item: AlbumItem) => {
      try {
        await enqueueDownload({
          url: item.url,
          type: item.type,
          name: `${member?.ownerName || 'room'}-${item.mode === 'small' ? t('小房间') : t('大房间')}-${item.id}`,
        });
        showToast(t('已加入下载管理'));
      } catch (e) {
        showToast(t('下载失败：{msg}', { msg: errorMessage(e) }));
      }
    },
    [member, showToast, t],
  );

  const openItem = useCallback((item: AlbumItem) => {
    if (item.type === 'video') setPlaying(item);
    else setPreview(item);
  }, []);

  const counts = useMemo(() => {
    let image = 0;
    let video = 0;
    for (const item of items) {
      if (item.type === 'video') video += 1;
      else image += 1;
    }
    return { image, video };
  }, [items]);

  const renderItem = useCallback(
    ({ item }: { item: AlbumItem }) => (
      <View style={styles.cell}>
        <ScalePressable
          style={[styles.card, { backgroundColor: palette.fill3 }]}
          onPress={() => openItem(item)}
          onLongPress={() => download(item)}
          pressedScale={0.96}
        >
          <NetworkImage
            source={{ uri: item.url }}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
            thumbnail={THUMB_W}
          />
          {item.type === 'video' ? (
            <>
              <View style={styles.videoShade} pointerEvents="none" />
              <View style={styles.playWrap} pointerEvents="none">
                <MaterialCommunityIcons name="play" size={20} color="#FFFFFF" />
              </View>
              {mediaDuration(item) > 0 ? (
                <View style={styles.durationBadge} pointerEvents="none">
                  <Text style={styles.durationText}>{formatDuration(mediaDuration(item))}</Text>
                </View>
              ) : null}
            </>
          ) : null}
        </ScalePressable>
      </View>
    ),
    [palette.fill3, openItem, download],
  );

  const renderFooter = useCallback(() => {
    if (loading && items.length > 0) {
      return <Text style={[styles.footer, { color: palette.labelTertiary }]}>{t('加载中…')}</Text>;
    }
    if (items.length > 0 && !hasMore) {
      return <Text style={[styles.footer, { color: palette.labelTertiary }]}>{t('没有更多了')}</Text>;
    }
    return null;
  }, [loading, items.length, hasMore, palette.labelTertiary, t]);

  // 视频播放：整页交给统一播放器（控制条/全屏/内核切换/错误重试都在里面）
  if (playing) {
    return (
      <View style={styles.playerPage}>
        <PlayerScreen
          source={{ kind: 'vod', url: playing.url, headers: buildPocketHeaders() }}
          meta={{ title: playing.title || t('房间视频') }}
          features={{ kernelSwitch: true }}
          onClose={() => setPlaying(null)}
          persistent
        />
      </View>
    );
  }

  const modeOptions = [
    { key: 'big' as const, label: t('大房间') },
    { key: 'small' as const, label: t('小房间') },
  ];

  return (
    <View style={styles.container}>
      <ScreenHeader
        title={t('房间相册')}
        right={member
          ? <HeaderAction label={t('刷新')} onPress={refresh} loading={loading && items.length > 0} />
          : undefined}
      />

      <View style={styles.top}>
        <MemberPicker
          selectedMember={member}
          onSelect={pickMember}
          placeholder={t('输入成员名搜索，如“柏欣妤”')}
        />
        {member?.yklzId ? (
          <GlassSegmented options={modeOptions} value={mode} onChange={switchMode} />
        ) : null}
        {member && items.length > 0 ? (
          <View style={styles.countRow}>
            <MaterialCommunityIcons name="image-multiple" size={13} color={palette.labelTertiary} />
            <Text style={[styles.countText, { color: palette.labelTertiary }]}>
              {t('图片 {image} · 视频 {video}', { image: counts.image, video: counts.video })}
            </Text>
          </View>
        ) : null}
      </View>

      {!member ? (
        <EmptyState
          icon="account-search-outline"
          title={t('先选一位成员')}
          hint={t('在上方搜索框输入成员名（支持拼音），点选后即可浏览 TA 的房间相册')}
        />
      ) : error ? (
        <ErrorState title={t('加载失败')} hint={error} onAction={refresh} />
      ) : loading && items.length === 0 ? (
        <SkeletonGrid />
      ) : items.length === 0 ? (
        <EmptyState
          icon="image-multiple-outline"
          title={t('暂无相册内容')}
          hint={mode === 'small' ? t('该成员的小房间还没有图片或视频') : t('该成员的大房间还没有图片或视频')}
        />
      ) : (
        <PerfFlatList
          data={items}
          numColumns={COLUMNS}
          keyExtractor={(item) => `${item.mode}-${item.id}`}
          renderItem={renderItem}
          contentContainerStyle={styles.grid}
          initialNumToRender={12}
          maxToRenderPerBatch={12}
          windowSize={7}
          removeClippedSubviews
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          ListFooterComponent={renderFooter}
          refreshControl={
            <RefreshControl
              refreshing={loading && items.length > 0}
              onRefresh={refresh}
              tintColor={palette.tint}
              colors={[palette.tint]}
            />
          }
        />
      )}

      <ZoomImageModal url={preview ? preview.url : ''} onClose={() => setPreview(null)} />
    </View>
  );
}

/** 首屏骨架：与真实网格同构（2 列 · 3:4），避免「先空后跳」的观感 */
function SkeletonGrid() {
  return (
    <View style={styles.skeletonWrap}>
      {[0, 1, 2].map((row) => (
        <View key={row} style={styles.skeletonRow}>
          {Array.from({ length: COLUMNS }).map((_, col) => (
            <View key={col} style={styles.cell}>
              <Skeleton height={0} style={styles.skeletonCard} radius={radiiAlias.cardCompact} />
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  top: { paddingHorizontal: 16, gap: 10, paddingBottom: 12 },
  countRow: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 2 },
  countText: { ...typography.footnote },

  grid: { paddingHorizontal: 11, paddingTop: 2, paddingBottom: 110 },
  /** 格：自己占半宽。**不用 flex:1** —— 奇数张时最后一张不会被拉成整行 */
  cell: { width: `${100 / COLUMNS}%` as any, padding: 5 },
  card: {
    width: '100%',
    aspectRatio: 3 / 4,
    borderRadius: radiiAlias.cardCompact,
    overflow: 'hidden',
  },

  videoShade: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.16)' },
  playWrap: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: 40,
    height: 40,
    marginTop: -20,
    marginLeft: -20,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.42)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.55)',
  },
  durationBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 6,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  durationText: { color: '#FFFFFF', fontSize: 10, fontWeight: '700' },

  footer: { ...typography.footnote, textAlign: 'center', paddingVertical: 14 },

  skeletonWrap: { paddingHorizontal: 11, paddingTop: 2 },
  skeletonRow: { flexDirection: 'row' },
  /** 用 aspectRatio 撑出与真实卡片同高的占位 */
  skeletonCard: { width: '100%' as any, aspectRatio: 3 / 4, height: undefined },

  playerPage: { flex: 1, backgroundColor: '#000000' },
});
