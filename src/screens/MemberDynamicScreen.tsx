import React, { useCallback, useEffect, useState } from 'react';
import { PerfFlatList } from '../components/PerfFlatList';
import { usePaginator } from '../hooks/usePaginator';

import {
  ActivityIndicator,
  FlatList,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSettingsStore } from '../store';
import ScreenHeader from '../components/ScreenHeader';
import { FadeInView } from '../components/Motion';
import MemberPicker from '../components/MemberPicker';
import ZoomImageModal from '../components/ZoomImageModal';
import pocketApi from '../api/pocket48';
import { errorMessage, parseMaybeJson } from '../utils/data';
import { formatTimestamp } from '../utils/format';
import { Member } from '../types';
import { CenterSpinner } from '../components/Loaders';
import { useAppTheme } from '../hooks/useAppTheme';
import { usePalette } from '../theme';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { useI18n } from '../i18n';

interface DynItem {
  key: string;
  title: string;
  content: string;
  coverUrls: string[];
  time: number;
  ownerName: string;
  ownerAvatar: string;
}

function parseExt(raw: any) {
  try {
    const ext = typeof raw === 'string' ? (() => {
      try { return JSON.parse(raw); } catch {
        const fixed = String(raw).replace(/:\s*([0-9]{15,})/g, ':"$1"');
        return parseMaybeJson(fixed) || {};
      }
    })() : (raw || {});
    const coverList = Array.isArray(ext.coverUrlList) ? ext.coverUrlList
      : Array.isArray(ext.body?.coverUrlList) ? ext.body.coverUrlList : [];
    return {
      title: String(ext.title || ext.body?.title || '').trim(),
      content: String(ext.content || ext.body?.text || ext.text || '').trim(),
      coverUrls: coverList.map((u: any) => String(u?.url || u || '').trim()).filter(Boolean),
      ownerName: String(ext.user?.nickname || ext.nickname || '').trim(),
      ownerAvatar: String(ext.user?.avatar || ext.avatar || '').trim(),
    };
  } catch { return { title: '', content: '', coverUrls: [], ownerName: '', ownerAvatar: '' }; }
}

function normalizeItem(raw: any, index: number): DynItem | null {
  const ext = parseExt(raw?.extInfo || raw?.bodys || raw?.msgContent);
  const time = Number(raw?.msgTime || raw?.ctime || 0);
  if (!ext.title && !ext.content && !ext.coverUrls.length) return null;
  return { key: String(raw?.msgId || raw?.id || `dyn-${index}`), ...ext, time: Number.isFinite(time) ? time : 0 };
}

export default function MemberDynamicScreen() {
  const navigation = useNavigation<any>();
  const isDark = useAppTheme();
  const palette = usePalette();
  const { t } = useI18n();
  const [member, setMember] = useState<Member | null>(null);
  const [error, setError] = useState('');
  const [zoomUrl, setZoomUrl] = useState('');

  // 翻页串行化：
  // 用同步 ref 锁挡住 onEndReached 连发，再用 runId 丢弃过期响应，避免重复请求/重复追加/cursor 漂移
  const fetchPage = useCallback(async (cursor: number) => {
    if (!member) return { items: [] as DynItem[], nextCursor: cursor, hasMore: false };
    setError('');
    try {
      const res = await pocketApi.getMemberDynamic({ ownerId: member.id, nextTime: cursor });
      const data = res?.content || res?.data || {};
      const list = Array.isArray(data?.messageList || data?.message || data?.list || data)
        ? (data?.messageList || data?.message || data?.list || data) : [];
      const normalized = list.map((item: any, idx: number) => normalizeItem(item, idx)).filter(Boolean) as DynItem[];
      const nextCursor = Number(data?.nextTime || data?.next || 0);
      return { items: normalized, nextCursor, hasMore: nextCursor > 0 && normalized.length > 0 };
    } catch (e: any) {
      setError(errorMessage(e));
      return { items: [] as DynItem[], nextCursor: cursor, hasMore: false };
    }
  }, [member]);

  const pag = usePaginator<DynItem>({ fetchPage, initialCursor: 0 });
  const { items, loading, hasMore, refresh, loadMore } = pag;

  useEffect(() => {
    if (member) refresh();
  }, [member, refresh]);

  const renderItem = ({ item, index }: { item: DynItem; index: number }) => (
    <FadeInView delay={index < 12 ? 80 + index * 30 : 0} duration={300}>
      <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.hairline, borderWidth: StyleSheet.hairlineWidth }]}>
        {item.ownerName ? (
          <View style={styles.ownerRow}>
            {item.ownerAvatar ? (
              <Image source={{ uri: item.ownerAvatar }} style={[styles.ownerAvatar, { backgroundColor: palette.fill3 }]} />
            ) : null}
            <Text style={[styles.ownerName, { color: palette.labelSecondary }]} numberOfLines={1}>{item.ownerName}</Text>
            {item.time > 0 ? <Text style={[styles.ownerTime, { color: palette.labelTertiary }]}>{formatTimestamp(item.time)}</Text> : null}
          </View>
        ) : null}
        {item.title ? <Text style={[styles.dynTitle, { color: palette.label }]} numberOfLines={3}>{item.title}</Text> : null}
        {item.content ? <Text style={[styles.dynContent, { color: palette.labelSecondary }]} numberOfLines={10}>{item.content}</Text> : null}
        {item.coverUrls.length > 0 && (
          <View style={styles.imageGrid}>
            {item.coverUrls.slice(0, 9).map((url, idx) => (
              <TouchableOpacity key={idx} onPress={() => setZoomUrl(url)} activeOpacity={0.85}>
                <Image source={{ uri: url }} style={[styles.gridImage, { backgroundColor: palette.fill3 }]} resizeMode="cover" />
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>
    </FadeInView>
  );

  return (
    <View style={styles.container}>
      <ScreenHeader title={t('成员动态')} onBack={() => navigation.goBack()} right={
        <TouchableOpacity disabled={!member || loading} onPress={() => refresh()}>
          <Text style={[styles.headerAction, { color: palette.tint }, (!member || loading) && styles.disabledText]}>{t('刷新')}</Text>
        </TouchableOpacity>
      } />
      <MemberPicker selectedMember={member} onSelect={setMember} placeholder={t('搜索成员查看动态...')} />
      <FadeInView delay={80} duration={300} style={{ flex: 1 }}>
        <PerfFlatList
          data={items}
          keyExtractor={(item) => item.key}
          contentContainerStyle={styles.list}
          initialNumToRender={12}
          maxToRenderPerBatch={12}
          windowSize={7}
          removeClippedSubviews
          onEndReached={loadMore}
          onEndReachedThreshold={0.35}
          renderItem={renderItem}
          ListFooterComponent={
            items.length ? <Text style={[styles.footer, { color: palette.labelSecondary }]}>
              {loading ? '' : hasMore ? t('上滑继续加载') : t('没有更多了')}
            </Text> : null
          }
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              {loading ? <CenterSpinner dark={isDark} /> : null}
              <Text style={[styles.empty, { color: palette.labelSecondary }]}>
                {loading ? '' : member ? (error ? error : t('暂无动态')) : t('请搜索选择成员查看动态')}
              </Text>
            </View>
          }
        />
      </FadeInView>
      <ZoomImageModal url={zoomUrl} onClose={() => setZoomUrl('')} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  headerAction: { fontSize: 14, fontWeight: '800' },
  disabledText: { opacity: 0.45 },
  list: { padding: 8, paddingBottom: 40 },
  card: { borderRadius: 16, padding: 14, marginVertical: 4 },
  ownerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  ownerAvatar: { width: 28, height: 28, borderRadius: 14, marginRight: 8 },
  ownerName: { fontSize: 12, fontWeight: '700', flex: 1 },
  ownerTime: { fontSize: 11 },
  dynTitle: { fontSize: 15, fontWeight: '700', marginBottom: 6, lineHeight: 21 },
  dynContent: { fontSize: 13, lineHeight: 20, marginBottom: 8 },
  imageGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  gridImage: { width: 100, height: 100, borderRadius: 10 },
  footer: { textAlign: 'center', fontSize: 12, paddingVertical: 10 },
  emptyWrap: { alignItems: 'center', paddingVertical: 60 },
  empty: { fontSize: 14, marginTop: 8 },
});
