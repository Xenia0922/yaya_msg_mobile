/**
 * 首页 v3.0（完整重写，逻辑对齐当前版本）
 *
 * 布局决策（对应 README 铁律）：
 *  - 一整页只有一个大色块区：**正在直播**（横滑大卡）。其余入口全部降级为「图标 + 文字」，无底色。
 *  - 快捷 4 项（直播/回放/音乐/私信）一行等分；工具入口改**横向滚动单行**，不再铺 4 行 chips。
 *  - 不再逐块包玻璃：全页只有分隔线（Divider），分组靠间距（组间 24）。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { useNavigation } from '@react-navigation/native';

import pocketApi from '../../api/pocket48';
import { NetworkImage } from '../../components/NetworkImage';
import { useI18n } from '../../i18n';
import { usePalette } from '../../theme';
import { normalizeUrl, pickText, unwrapList } from '../../utils/data';

import { Screen, statusTop } from '../layout/Screen';
import { Divider, EmptyHint, SectionHeader } from '../layout/primitives';
import { contentBottom, GUTTER, R, SPACE, TYPE } from '../tokens';

type LiveItem = { liveId: string; title: string; nickname: string; cover: string };

/** 快捷入口（与当前版本一致：直播 / 回放 / 音乐 / 私信） */
const QUICK = [
  { key: 'live', label: '直播', icon: 'access-point', route: 'Media', params: { mode: 'live' } },
  { key: 'vod', label: '回放', icon: 'play-box-multiple', route: 'Media', params: { mode: 'vod' } },
  { key: 'music', label: '音乐', icon: 'music-note', route: 'MusicLibraryScreen', params: undefined },
  { key: 'dm', label: '私信', icon: 'email-outline', route: 'PrivateMessagesScreen', params: undefined },
] as const;

/** 工具入口（横向滚动单行） */
const TOOLS = [
  { key: 'flip', label: '翻牌', icon: 'comment-question-outline', route: 'FlipScreen' },
  { key: 'onmic', label: '上麦', icon: 'microphone', route: 'OnMicScreen' },
  { key: 'melee', label: '鸡腿榜', icon: 'trophy', route: 'MeleeRankScreen' },
  { key: 'album', label: '相册', icon: 'image-multiple', route: 'RoomAlbumScreen' },
  { key: 'analysis', label: '统计', icon: 'chart-bar', route: 'AnalysisScreen' },
  { key: 'download', label: '下载', icon: 'download', route: 'DownloadScreen' },
  { key: 'openlive', label: '公演', icon: 'theater', route: 'OpenLiveScreen' },
  { key: 'bili', label: 'B站', icon: 'broadcast', route: 'BilibiliLiveScreen' },
  { key: 'account', label: '账号', icon: 'key-variant', route: 'LoginScreen' },
  { key: 'db', label: '数据库', icon: 'database', route: 'DatabaseScreen' },
  { key: 'invoice', label: '发票', icon: 'file-document-outline', route: 'InvoiceScreen' },
] as const;

function toLives(res: any): LiveItem[] {
  const source = unwrapList(res, [
    'content.liveList', 'content.list', 'content.data', 'content.records',
    'data.liveList', 'liveList', 'list', 'data',
  ]);
  return source
    .map((raw: any, i: number) => ({
      liveId: String(pickText(raw, ['liveId', 'id', 'live_id', 'roomId'], String(i))),
      title: pickText(raw, ['title', 'liveTitle', 'liveRoomTitle', 'roomName', 'subject'], ''),
      nickname: pickText(raw, ['nickname', 'nickName', 'userInfo.nickname', 'userInfo.nickName', 'ownerName'], ''),
      cover: normalizeUrl(pickText(raw, ['liveCover', 'coverPath', 'cover', 'coverUrl', 'picPath', 'path', 'imageUrl', 'poster', 'thumb', 'userInfo.avatar'], '')),
    }))
    .filter((x) => !!x.title)
    .slice(0, 10);
}

export default function HomeV3() {
  const navigation = useNavigation<any>();
  const palette = usePalette();
  const { t } = useI18n();

  const [lives, setLives] = useState<LiveItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await pocketApi.getLiveList({ groupId: 0, liveType: 0, next: 0, record: false });
      if (!alive.current) return;
      setLives(toLives(res));
    } catch (e: any) {
      if (alive.current) setError(String(e?.message || e));
    } finally {
      if (alive.current) setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openLive = useCallback((item: LiveItem) => {
    navigation.navigate('Media', {
      mode: 'live',
      playLiveId: item.liveId,
      playTitle: item.title,
      playCover: item.cover,
      playNonce: Date.now(),
    });
  }, [navigation]);

  return (
    <Screen title={t('牙牙消息')} actions={[{ icon: 'refresh', onPress: load }]}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: contentBottom(false) }}
        refreshControl={<RefreshControl refreshing={loading && lives.length > 0} onRefresh={load} tintColor={palette.tint} colors={[palette.tint]} />}
        showsVerticalScrollIndicator={false}
      >
        {/* ── 正在直播（本页唯一的大色块区）── */}
        <SectionHeader title={t('正在直播')} action={{ label: t('全部'), onPress: () => navigation.navigate('Media', { mode: 'live' }) }} />
        {loading && lives.length === 0 ? (
          <View style={styles.liveLoading}><ActivityIndicator color={palette.tint} /></View>
        ) : lives.length === 0 ? (
          <View style={styles.liveEmpty}>
            <Text style={[TYPE.secondary, { color: palette.labelTertiary }]}>
              {error ? t('加载失败：{msg}', { msg: error }) : t('暂时没有成员在直播')}
            </Text>
          </View>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.liveRow}>
            {lives.map((item) => (
              <TouchableOpacity key={item.liveId} onPress={() => openLive(item)} activeOpacity={0.85} style={styles.liveCard}>
                <View style={[styles.liveCoverWrap, { backgroundColor: palette.fill2 }]}>
                  <NetworkImage source={{ uri: item.cover }} style={styles.liveCover} resizeMode="cover" thumbnail={420} />
                  <View style={styles.liveBadge}>
                    <View style={styles.liveDot} />
                    <Text style={styles.liveBadgeText}>LIVE</Text>
                  </View>
                </View>
                <Text style={[TYPE.secondary, { color: palette.label, marginTop: SPACE.sm }]} numberOfLines={1}>
                  {item.nickname || item.title}
                </Text>
                <Text style={[TYPE.caption, { color: palette.labelTertiary, marginTop: 2 }]} numberOfLines={1}>
                  {item.title}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}

        <Divider inset={0} />

        {/* ── 快捷 4 项：一行等分，无底色 ── */}
        <View style={styles.quickRow}>
          {QUICK.map((q) => (
            <TouchableOpacity
              key={q.key}
              style={styles.quickItem}
              activeOpacity={0.7}
              onPress={() => navigation.navigate(q.route as any, q.params as any)}
            >
              <MaterialCommunityIcons name={q.icon as any} size={24} color={palette.label} />
              <Text style={[TYPE.caption, { color: palette.labelSecondary, marginTop: SPACE.sm }]}>{t(q.label)}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Divider inset={0} />

        {/* ── 工具：横向滚动单行（不再铺 4 行 chips）── */}
        <SectionHeader title={t('工具')} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.toolRow}>
          {TOOLS.map((tool) => (
            <TouchableOpacity key={tool.key} style={styles.toolItem} activeOpacity={0.7} onPress={() => navigation.navigate(tool.route as any)}>
              <MaterialCommunityIcons name={tool.icon as any} size={18} color={palette.labelSecondary} />
              <Text style={[TYPE.caption, { color: palette.labelSecondary, marginLeft: SPACE.xs }]}>{t(tool.label)}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* 底部留给"我的/设置"：一行两个安静入口 */}
        <View style={[styles.footerRow, { borderTopColor: palette.hairline }]}>
          <TouchableOpacity style={styles.footerItem} onPress={() => navigation.navigate('ProfileScreen')}>
            <Text style={[TYPE.secondary, { color: palette.labelSecondary }]}>{t('我的')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.footerItem} onPress={() => navigation.navigate('Settings')}>
            <Text style={[TYPE.secondary, { color: palette.labelSecondary }]}>{t('设置')}</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  liveLoading: { height: 120, alignItems: 'center', justifyContent: 'center' },
  liveEmpty: { height: 96, alignItems: 'center', justifyContent: 'center' },
  liveRow: { paddingHorizontal: GUTTER, gap: SPACE.md, paddingBottom: SPACE.lg },
  liveCard: { width: 132 },
  liveCoverWrap: { width: 132, height: 176, borderRadius: R.md, overflow: 'hidden' },
  liveCover: { width: '100%', height: '100%' },
  liveBadge: {
    position: 'absolute', left: 8, top: 8, flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: R.pill, backgroundColor: 'rgba(0,0,0,0.55)',
  },
  liveDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#FF4D4F' },
  liveBadgeText: { color: '#FFFFFF', fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },

  quickRow: { flexDirection: 'row', paddingHorizontal: GUTTER, paddingVertical: SPACE.md },
  quickItem: { flex: 1, alignItems: 'center' },

  toolRow: { paddingHorizontal: GUTTER, gap: SPACE.lg, paddingBottom: SPACE.lg },
  toolItem: { flexDirection: 'row', alignItems: 'center', height: 32 },

  footerRow: { flexDirection: 'row', marginTop: SPACE.sm, borderTopWidth: StyleSheet.hairlineWidth },
  footerItem: { flex: 1, height: 48, alignItems: 'center', justifyContent: 'center' },
});
