import React, { useCallback, useEffect, useState } from 'react';
import { PerfFlatList } from '../components/PerfFlatList';

import {
  Linking,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { CenterSpinner } from '../components/Loaders';
import ScreenHeader from '../components/ScreenHeader';
import { FadeInView } from '../components/Motion';
import MemberPicker from '../components/MemberPicker';
import pocketApi from '../api/pocket48';
import { errorMessage, unwrapList } from '../utils/data';
import { Member, TripItem } from '../types';
import { useAppTheme } from '../hooks/useAppTheme';
import { usePalette } from '../theme';
import { useI18n } from '../i18n';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';

function parseTripDate(raw: string): { date: string; time: string } {
  const str = String(raw || '');
  const parts = str.split(/\s+/);
  return { date: parts[0] || '', time: parts.slice(1).join(' ') || '' };
}

function normalizeTripItem(raw: any, index: number): TripItem | null {
  const id = String(raw.id || raw.tripId || raw.dataId || `trip-${index}`);
  const showDate = String(raw.showDate || raw.show_date || raw.date || '');
  const showTime = String(raw.showTime || raw.show_time || raw.time || '');
  const { date, time } = showDate
    ? parseTripDate(`${showDate} ${showTime}`)
    : { date: '', time: '' };
  return {
    id,
    title: String(raw.title || raw.tripName || '').trim(),
    subtitle: String(raw.subtitle || raw.subTitle || '').trim(),
    description: String(raw.description || raw.desc || '').trim(),
    date,
    time,
    showDate,
    showTime,
    members: Array.isArray(raw.members) ? raw.members.map(String) : [],
    location: String(raw.location || raw.place || '').trim(),
    liveText: String(raw.liveText || raw.live_text || '').trim(),
    ticketUrl: String(raw.ticketUrl || raw.ticket_url || '').trim(),
    groupId: Number(raw.groupId || raw.group_id || 0),
    memberId: String(raw.memberId || raw.member_id || ''),
    userId: String(raw.userId || raw.user_id || ''),
  };
}

function normalizeTripList(res: any): TripItem[] {
  const list = unwrapList(res?.content || res?.data || res);
  return (Array.isArray(list) ? list : [])
    .map((item: any, idx: number) => normalizeTripItem(item, idx))
    .filter(Boolean) as TripItem[];
}

export default function TripScreen() {
  const navigation = useNavigation<any>();
  const palette = usePalette();
  const isDark = useAppTheme();
  const { t } = useI18n();
  const [member, setMember] = useState<Member | null>(null);
  const [items, setItems] = useState<TripItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [lastTime, setLastTime] = useState('0');
  const [hasMore, setHasMore] = useState(true);

  const fetchTrips = useCallback(async (reset = false) => {
    if (reset) { setLoading(true); setLastTime('0'); } else { setLoadingMore(true); }
    setError('');
    try {
      const res = await pocketApi.getTripList({
        memberId: member?.id || '',
        lastTime: reset ? '0' : lastTime,
        isMore: !reset,
      });
      const list = normalizeTripList(res);
      if (reset) setItems(list);
      else setItems((prev) => [...prev, ...list]);
      setHasMore(list.length >= 20);
      const cursor = res?.content?.nextTime || res?.content?.next || res?.content?.lastTime;
      if (cursor) setLastTime(String(cursor));
    } catch (e: any) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [member, lastTime]);

  useEffect(() => { if (member) fetchTrips(true); }, [member]);

  const renderItem = ({ item, index }: { item: TripItem; index: number }) => (
    <FadeInView delay={index < 12 ? 80 + index * 30 : 0} duration={300}>
      <View
        style={[
          styles.card,
          {
            backgroundColor: palette.surface,
            borderColor: palette.hairline,
          },
        ]}
      >
        <View style={styles.cardTop}>
          <View style={[styles.iconWrap, { backgroundColor: palette.tintSoft }]}>
            <MaterialCommunityIcons name="calendar-clock" size={20} color={palette.tint} />
          </View>
          <View style={styles.infoWrap}>
            <Text style={[styles.cardTitle, { color: palette.label }]} numberOfLines={2}>{item.title}</Text>
            {item.date ? (
              <Text style={[styles.cardDate, { color: palette.labelSecondary }]}>
                {item.date}{item.time ? ` ${item.time}` : ''}
              </Text>
            ) : null}
          </View>
        </View>
        {item.subtitle ? <Text style={[styles.cardSub, { color: palette.labelSecondary }]} numberOfLines={2}>{item.subtitle}</Text> : null}
        {item.description ? <Text style={[styles.cardDesc, { color: palette.labelSecondary }]} numberOfLines={5}>{item.description}</Text> : null}
        <View style={styles.metaRow}>
          {item.location ? (
            <View style={styles.metaLine}>
              <MaterialCommunityIcons name="map-marker-outline" size={14} color={palette.tint} />
              <Text style={[styles.metaText, { color: palette.labelSecondary }]} numberOfLines={1}>{item.location}</Text>
            </View>
          ) : null}
          {item.liveText ? (
            <View style={styles.metaLine}>
              <MaterialCommunityIcons name="television-play" size={14} color={palette.tint} />
              <Text style={[styles.metaText, { color: palette.labelSecondary }]} numberOfLines={1}>{item.liveText}</Text>
            </View>
          ) : null}
          {item.members.length > 0 ? (
            <View style={styles.metaLine}>
              <MaterialCommunityIcons name="account-group-outline" size={14} color={palette.tint} />
              <Text style={[styles.metaText, { color: palette.labelSecondary }]} numberOfLines={1}>{item.members.join(' · ')}</Text>
            </View>
          ) : null}
        </View>
        {item.ticketUrl ? (
          <TouchableOpacity
            style={[styles.linkBtn, { backgroundColor: palette.tint }]}
            onPress={() => Linking.openURL(item.ticketUrl)}
          >
            <Text style={styles.linkBtnText}>{t('票务链接')}</Text>
            <MaterialCommunityIcons name="chevron-right" size={14} color="#FFFFFF" style={{ marginLeft: 2 }} />
          </TouchableOpacity>
        ) : null}
      </View>
    </FadeInView>
  );

  return (
    <View style={styles.container}>
      <ScreenHeader title={t('行程')} onBack={() => navigation.goBack()} right={
        <TouchableOpacity disabled={!member || loading} onPress={() => fetchTrips(true)}>
          <Text style={[styles.headerAction, { color: palette.tint }, (!member || loading) && styles.disabledText]}>{t('刷新')}</Text>
        </TouchableOpacity>
      } />
      <MemberPicker selectedMember={member} onSelect={setMember} placeholder={t('搜索成员查看行程...')} />
      <FadeInView delay={80} duration={300} style={{ flex: 1 }}>
        <PerfFlatList
          data={items}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          initialNumToRender={12}
          maxToRenderPerBatch={12}
          windowSize={7}
          removeClippedSubviews
          onEndReached={() => { if (hasMore && !loadingMore) fetchTrips(false); }}
          onEndReachedThreshold={0.35}
          renderItem={renderItem}
          ListFooterComponent={
            items.length ? <Text style={[styles.footer, { color: palette.labelTertiary }]}>
              {loadingMore ? '' : hasMore ? t('上滑加载更多') : t('没有更多了')}
            </Text> : null
          }
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              {loading ? <CenterSpinner dark={isDark} /> : null}
              <Text style={[styles.empty, { color: palette.labelTertiary }]}>
                {loading ? '' : member ? (error ? error : t('暂无行程')) : t('请搜索选择成员查看行程')}
              </Text>
            </View>
          }
        />
      </FadeInView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  headerAction: { color: '#ff6f91', fontSize: 14, fontWeight: '800' },
  disabledText: { opacity: 0.45 },
  list: { padding: 16, paddingBottom: 40 },
  card: {
    borderRadius: 16,
    padding: 14,
    marginBottom: 5,
    borderWidth: StyleSheet.hairlineWidth,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoWrap: { flex: 1, minWidth: 0, marginLeft: 12 },
  cardTitle: { fontSize: 15, fontWeight: '700', lineHeight: 20 },
  cardDate: { fontSize: 12, marginTop: 3 },
  cardSub: { fontSize: 13, marginBottom: 4, lineHeight: 19 },
  cardDesc: { fontSize: 13, marginBottom: 8, lineHeight: 19 },
  metaRow: { gap: 4, marginBottom: 4 },
  metaLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaText: { fontSize: 12, flex: 1 },
  linkBtn: {
    alignSelf: 'flex-start',
    marginTop: 8,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 18,
    flexDirection: 'row',
    alignItems: 'center',
  },
  linkBtnText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  footer: { textAlign: 'center', fontSize: 12, paddingVertical: 10 },
  emptyWrap: { alignItems: 'center', paddingVertical: 60 },
  empty: { fontSize: 13, marginTop: 8 },
});
