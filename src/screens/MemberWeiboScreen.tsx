import React, { useCallback, useEffect, useState } from 'react';
import { PerfFlatList } from '../components/PerfFlatList';

import {
  ActivityIndicator,
  FlatList,
  Image,
  Linking,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSettingsStore } from '../store';
import { CenterSpinner } from '../components/Loaders';
import ScreenHeader from '../components/ScreenHeader';
import { FadeInView } from '../components/Motion';
import MemberPicker from '../components/MemberPicker';
import ZoomImageModal from '../components/ZoomImageModal';
import pocketApi from '../api/pocket48';
import { errorMessage, parseMaybeJson } from '../utils/data';
import { formatTimestamp } from '../utils/format';
import { Member } from '../types';
import { useAppTheme } from '../hooks/useAppTheme';
import { usePalette } from '../theme';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { useI18n } from '../i18n';

interface WbItem {
  key: string;
  title: string;
  content: string;
  imageUrls: string[];
  jumpUrl: string;
  time: number;
  ownerName: string;
  ownerAvatar: string;
}

function parseWbExt(raw: any) {
  try {
    const ext = typeof raw === 'string' ? (() => {
      try { return JSON.parse(raw); } catch {
        const fixed = String(raw).replace(/:\s*([0-9]{15,})/g, ':"$1"');
        return parseMaybeJson(fixed) || {};
      }
    })() : (raw || {});
    const jp = String(ext.jumpPath || ext.body?.jumpPath || ext.url || ext.schemeUrl || '').trim();
    const imgList = Array.isArray(ext.imageList) ? ext.imageList : Array.isArray(ext.body?.imageList) ? ext.body.imageList : [];
    return {
      title: String(ext.title || ext.body?.title || '').trim(),
      content: String(ext.text || ext.body?.text || ext.content || '').trim(),
      imageUrls: imgList.map((u: any) => String(u?.url || u || '').trim()).filter(Boolean),
      jumpUrl: jp.startsWith('http') ? jp : (jp ? `https://m.weibo.cn${jp.startsWith('/') ? '' : '/'}${jp}` : ''),
      ownerName: String(ext.user?.nickname || ext.nickname || '').trim(),
      ownerAvatar: String(ext.user?.avatar || ext.avatar || '').trim(),
    };
  } catch { return { title: '', content: '', imageUrls: [], jumpUrl: '', ownerName: '', ownerAvatar: '' }; }
}

function normalizeItem(raw: any, index: number): WbItem | null {
  const ext = parseWbExt(raw?.extInfo || raw?.bodys || raw?.msgContent);
  const time = Number(raw?.msgTime || raw?.ctime || 0);
  if (!ext.content && !ext.imageUrls.length) return null;
  return { key: String(raw?.msgId || raw?.id || `wb-${index}`), ...ext, time: Number.isFinite(time) ? time : 0 };
}

export default function MemberWeiboScreen() {
  const navigation = useNavigation<any>();
  const isDark = useAppTheme();
  const palette = usePalette();
  const { t } = useI18n();
  const [member, setMember] = useState<Member | null>(null);
  const [items, setItems] = useState<WbItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [nextTime, setNextTime] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [zoomUrl, setZoomUrl] = useState('');

  const fetchData = useCallback(async (reset = false) => {
    if (!member) return;
    if (reset) { setLoading(true); setNextTime(0); } else { setLoadingMore(true); }
    setError('');
    try {
      const res = await pocketApi.getMemberWeibo({ ownerId: member.id, nextTime: reset ? 0 : nextTime });
      const data = res?.content || res?.data || {};
      const list = Array.isArray(data?.messageList || data?.message || data?.list || data)
        ? (data?.messageList || data?.message || data?.list || data) : [];
      const normalized = list.map((item: any, idx: number) => normalizeItem(item, idx)).filter(Boolean) as WbItem[];
      if (reset) setItems(normalized); else setItems((prev) => [...prev, ...normalized]);
      const cursor = Number(data?.nextTime || data?.next || 0);
      setNextTime(cursor);
      // 游标不前进（恒同本次请求值）即终止，防死循环
      setHasMore(cursor > 0 && normalized.length > 0 && cursor !== nextTime);
    } catch (e: any) { setError(errorMessage(e)); }
    finally { setLoading(false); setLoadingMore(false); }
  }, [member, nextTime]);

  useEffect(() => { if (member) fetchData(true); }, [member]);

  const renderItem = ({ item, index }: { item: WbItem; index: number }) => (
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
        {item.title ? <Text style={[styles.wbTitle, { color: palette.label }]} numberOfLines={3}>{item.title}</Text> : null}
        {item.content ? <Text style={[styles.wbContent, { color: palette.labelSecondary }]} numberOfLines={12}>{item.content}</Text> : null}
        {item.imageUrls.length > 0 && (
          <View style={styles.imageGrid}>
            {item.imageUrls.slice(0, 9).map((url, idx) => (
              <TouchableOpacity key={idx} onPress={() => setZoomUrl(url)} activeOpacity={0.85}>
                <Image source={{ uri: url }} style={[styles.gridImage, { backgroundColor: palette.fill3 }]} resizeMode="cover" />
              </TouchableOpacity>
            ))}
          </View>
        )}
        {item.jumpUrl ? (
          <TouchableOpacity style={[styles.linkBtn, { backgroundColor: palette.fill2 }]} onPress={() => Linking.openURL(item.jumpUrl)}>
            <MaterialCommunityIcons name="open-in-new" size={14} color={palette.tint} style={styles.linkIcon} />
            <Text style={[styles.linkBtnText, { color: palette.tint }]}>{t('查看微博原文')}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </FadeInView>
  );

  return (
    <View style={styles.container}>
      <ScreenHeader title={t('成员微博')} onBack={() => navigation.goBack()} right={
        <TouchableOpacity disabled={!member || loading} onPress={() => fetchData(true)}>
          <Text style={[styles.headerAction, { color: palette.tint }, (!member || loading) && styles.disabledText]}>{t('刷新')}</Text>
        </TouchableOpacity>
      } />
      <MemberPicker selectedMember={member} onSelect={setMember} placeholder={t('搜索成员查看微博...')} />
      <FadeInView delay={80} duration={300} style={{ flex: 1 }}>
        <PerfFlatList
          data={items}
          keyExtractor={(item) => item.key}
          contentContainerStyle={styles.list}
          initialNumToRender={12}
          maxToRenderPerBatch={12}
          windowSize={7}
          removeClippedSubviews
          onEndReached={() => { if (hasMore && !loadingMore) fetchData(false); }}
          onEndReachedThreshold={0.35}
          renderItem={renderItem}
          ListFooterComponent={
            items.length ? <Text style={[styles.footer, { color: palette.labelSecondary }]}>
              {loadingMore ? '' : hasMore ? t('上滑加载更多') : t('没有更多了')}
            </Text> : null
          }
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              {loading ? <CenterSpinner dark={isDark} /> : null}
              <Text style={[styles.empty, { color: palette.labelSecondary }]}>
                {loading ? '' : member ? (error ? error : t('暂无微博')) : t('请搜索选择成员查看微博')}
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
  wbTitle: { fontSize: 15, fontWeight: '700', marginBottom: 6, lineHeight: 21 },
  wbContent: { fontSize: 13, lineHeight: 20, marginBottom: 8 },
  imageGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginBottom: 10 },
  gridImage: { width: 100, height: 100, borderRadius: 10 },
  linkBtn: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 7, borderRadius: 18 },
  linkIcon: { marginRight: 2 },
  linkBtnText: { fontSize: 12, fontWeight: '800' },
  footer: { textAlign: 'center', fontSize: 12, paddingVertical: 10 },
  emptyWrap: { alignItems: 'center', paddingVertical: 60 },
  empty: { fontSize: 14, marginTop: 8 },
});
