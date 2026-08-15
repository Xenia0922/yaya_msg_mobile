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

/** 行程节点状态：today = 今天（粉实心），past = 已过期（灰），future = 未来（粉描边） */
type TripNodeState = 'today' | 'past' | 'future';

function tripDateKey(showDate: string): string {
  return String(showDate || '').trim().replace(/-/g, '/');
}

function tripNodeState(showDate: string, todayKey: string): TripNodeState {
  const key = tripDateKey(showDate);
  if (!key) return 'future';
  const t = todayKey.replace(/-/g, '/');
  if (key === t) return 'today';
  // 字符串比较 YYYY/MM/DD 可直接判断先后
  return key < t ? 'past' : 'future';
}

function todayKey(d = new Date()): string {
  const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
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
  const today = todayKey();

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
      const cursor = res?.content?.nextTime || res?.content?.next || res?.content?.lastTime;
      // 翻页终止：本页有数据 且 游标确有前进（防止接口返回恒定游标导致死循环）
      setHasMore(list.length >= 20 && !!cursor && String(cursor) !== lastTime);
      if (cursor) setLastTime(String(cursor));
    } catch (e: any) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [member, lastTime]);

  useEffect(() => { if (member) fetchTrips(true); }, [member]);

  const renderItem = ({ item, index }: { item: TripItem; index: number }) => {
    const state = tripNodeState(item.showDate, today);
    const expired = state === 'past';
    const isToday = state === 'today';
    return (
      <FadeInView delay={index < 12 ? 80 + index * 30 : 0} duration={300}>
        <View style={styles.timelineRow}>
          {/* 左侧时间轴：竖线 + 圆形节点 */}
          <View style={styles.railWrap}>
            <View
              style={[
                styles.rail,
                {
                  backgroundColor: isToday ? palette.tint : palette.fill2,
                },
              ]}
            />
            <View
              style={[
                styles.nodeOuter,
                isToday
                  ? { borderColor: palette.tint }
                  : { borderColor: state === 'past' ? palette.fill3 : palette.tint },
              ]}
            >
              <View
                style={[
                  styles.nodeInner,
                  isToday ? { backgroundColor: palette.tint } : { backgroundColor: 'transparent' },
                ]}
              >
                {isToday ? <View style={[styles.nodeDot, { backgroundColor: '#FFFFFF' }]} /> : null}
              </View>
            </View>
          </View>

          {/* 右侧内容卡（实心白卡圆角16） */}
          <View
            style={[
              styles.card,
              {
                backgroundColor: palette.surface,
                borderColor: isToday ? palette.tint : palette.hairline,
                opacity: expired ? 0.55 : 1,
              },
            ]}
          >
            <View style={styles.cardHead}>
              {item.date ? (
                <View style={[styles.datePill, { backgroundColor: isToday ? palette.tintSoft : palette.fill2 }]}>
                  <MaterialCommunityIcons
                    name={isToday ? 'calendar-today' : 'calendar-blank-outline'}
                    size={13}
                    color={isToday ? palette.tint : palette.labelTertiary}
                    style={{ marginRight: 4 }}
                  />
                  <Text style={[styles.datePillText, { color: isToday ? palette.tint : palette.labelSecondary }]}>
                    {item.date}{item.time ? ` ${item.time}` : ''}
                  </Text>
                </View>
              ) : null}
            </View>
            <Text style={[styles.cardTitle, { color: palette.label }]} numberOfLines={2}>{item.title}</Text>
            {item.subtitle ? (
              <Text style={[styles.cardSub, { color: palette.labelSecondary }]} numberOfLines={2}>{item.subtitle}</Text>
            ) : null}
            {item.location ? (
              <View style={styles.locationRow}>
                <MaterialCommunityIcons name="map-marker" size={14} color={palette.tint} />
                <Text style={[styles.locationText, { color: palette.labelSecondary }]} numberOfLines={1}>{item.location}</Text>
              </View>
            ) : null}
            {item.description ? (
              <Text style={[styles.cardDesc, { color: palette.labelSecondary }]} numberOfLines={4}>{item.description}</Text>
            ) : null}
            {item.ticketUrl ? (
              <TouchableOpacity
                style={[styles.linkBtn, { backgroundColor: palette.tint }]}
                onPress={() => Linking.openURL(item.ticketUrl)}
              >
                <MaterialCommunityIcons name="ticket-outline" size={14} color="#FFFFFF" style={{ marginRight: 4 }} />
                <Text style={styles.linkBtnText}>{t('票务链接')}</Text>
                <MaterialCommunityIcons name="chevron-right" size={14} color="#FFFFFF" style={{ marginLeft: 2 }} />
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      </FadeInView>
    );
  };

  const subtitle = member
    ? `${t('当前成员')}${items.length ? ` · ${t('{count} 行程', { count: items.length })}` : ''}`
    : '';

  return (
    <View style={styles.container}>
      <ScreenHeader title={t('行程')} onBack={() => navigation.goBack()} right={
        <TouchableOpacity disabled={!member || loading} onPress={() => fetchTrips(true)}>
          <Text style={[styles.headerAction, { color: palette.tint }, (!member || loading) && styles.disabledText]}>{t('刷新')}</Text>
        </TouchableOpacity>
      } />
      {subtitle ? (
        <Text style={[styles.subtitle, { color: palette.labelSecondary }]}>{subtitle}</Text>
      ) : null}
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
  subtitle: { paddingHorizontal: 16, fontSize: 13, fontWeight: '700', marginBottom: 4 },
  list: { padding: 16, paddingBottom: 40 },
  timelineRow: { flexDirection: 'row', alignItems: 'stretch', marginBottom: 5 },
  railWrap: { width: 20, alignItems: 'center' },
  rail: {
    position: 'absolute',
    left: 9,
    top: 0,
    bottom: 0,
    width: 2,
  },
  nodeOuter: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    marginTop: 20,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  nodeInner: {
    width: 8,
    height: 8,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nodeDot: { width: 4, height: 4, borderRadius: 2 },
  card: {
    flex: 1,
    minWidth: 0,
    marginLeft: 10,
    borderRadius: 16,
    padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  cardHead: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 6 },
  datePill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  datePillText: { fontSize: 12, fontWeight: '700' },
  cardTitle: { fontSize: 15, fontWeight: '700', lineHeight: 20 },
  cardSub: { fontSize: 12, marginTop: 3, lineHeight: 17 },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  locationText: { fontSize: 12, flex: 1 },
  cardDesc: { fontSize: 12, marginTop: 6, lineHeight: 17 },
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
