import React, { useCallback, useEffect, useState } from 'react';
import { PerfFlatList } from '../components/PerfFlatList';

import {
  ActivityIndicator,
  FlatList,
  Linking,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSettingsStore } from '../store';
import { SkeletonList } from '../components/Skeleton';
import ScreenHeader from '../components/ScreenHeader';
import { FadeInView } from '../components/Motion';
import MemberPicker from '../components/MemberPicker';
import pocketApi from '../api/pocket48';
import { errorMessage, unwrapList } from '../utils/data';
import { Member, TripItem } from '../types';

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
  const isDark = useSettingsStore((state) => state.settings.theme === 'dark');
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
      <View style={[styles.card, isDark && styles.cardDark]}>
        <View style={styles.cardHead}>
          <Text style={[styles.cardTitle, isDark && styles.textLight]} numberOfLines={2}>{item.title}</Text>
          {item.date ? <Text style={styles.cardDate}>{item.date}{item.time ? ` ${item.time}` : ''}</Text> : null}
        </View>
        {item.subtitle ? <Text style={[styles.cardSub, isDark && styles.textSubLight]} numberOfLines={2}>{item.subtitle}</Text> : null}
        {item.description ? <Text style={[styles.cardDesc, isDark && styles.textSubLight]} numberOfLines={5}>{item.description}</Text> : null}
        <View style={styles.metaRow}>
          {item.location ? <Text style={[styles.metaText, isDark && styles.textSubLight]}>📍 {item.location}</Text> : null}
          {item.liveText ? <Text style={[styles.metaText, isDark && styles.textSubLight]}>📺 {item.liveText}</Text> : null}
          {item.members.length > 0 ? <Text style={[styles.metaText, isDark && styles.textSubLight]}>👥 {item.members.join(' · ')}</Text> : null}
        </View>
        {item.ticketUrl ? (
          <TouchableOpacity style={styles.linkBtn} onPress={() => Linking.openURL(item.ticketUrl)}>
            <Text style={styles.linkBtnText}>票务链接</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </FadeInView>
  );

  return (
    <View style={[styles.container, isDark && styles.containerDark]}>
      <ScreenHeader title="行程" onBack={() => navigation.goBack()} right={
        <TouchableOpacity disabled={!member || loading} onPress={() => fetchTrips(true)}>
          <Text style={[styles.headerAction, (!member || loading) && styles.disabledText]}>刷新</Text>
        </TouchableOpacity>
      } />
      <MemberPicker selectedMember={member} onSelect={setMember} placeholder="搜索成员查看行程..." />
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
            items.length ? <Text style={[styles.footer, isDark && styles.textSubLight]}>
              {loadingMore ? '' : hasMore ? '上滑加载更多' : '没有更多了'}
            </Text> : null
          }
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              {loading ? <SkeletonList count={6} dark={isDark} /> : null}
              <Text style={[styles.empty, isDark && styles.textSubLight]}>
                {loading ? '' : member ? (error ? error : '暂无行程') : '请搜索选择成员查看行程'}
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
  containerDark: { backgroundColor: 'transparent' },
  headerAction: { color: '#ff6f91', fontSize: 14, fontWeight: '800' },
  disabledText: { opacity: 0.45 },
  list: { padding: 12, paddingBottom: 40 },
  card: {
    backgroundColor: 'rgba(255,255,255,0.72)',
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.68)',
  },
  cardDark: { backgroundColor: 'rgba(20,20,20,0.68)', borderColor: 'rgba(255,255,255,0.10)' },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 },
  cardTitle: { fontSize: 16, fontWeight: '800', color: '#333333', flex: 1, marginRight: 8 },
  cardDate: { fontSize: 11, fontWeight: '700', color: '#ff6f91', minWidth: 80, textAlign: 'right' },
  cardSub: { fontSize: 13, color: '#555555', marginBottom: 4 },
  cardDesc: { fontSize: 13, color: '#555555', marginBottom: 8, lineHeight: 19 },
  metaRow: { gap: 2, marginBottom: 4 },
  metaText: { fontSize: 12, color: '#555555' },
  linkBtn: { alignSelf: 'flex-start', marginTop: 4, backgroundColor: '#ff6f91', paddingHorizontal: 14, paddingVertical: 6, borderRadius: 18 },
  linkBtnText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  footer: { textAlign: 'center', color: '#555555', fontSize: 12, paddingVertical: 10 },
  emptyWrap: { alignItems: 'center', paddingVertical: 60 },
  empty: { color: '#555555', fontSize: 14, marginTop: 8 },
  textLight: { color: '#ffffff' },
  textSubLight: { color: '#dddddd' },
});
