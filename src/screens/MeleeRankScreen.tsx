import React, { useCallback, useEffect, useRef, useState } from 'react';
import { PerfFlatList } from '../components/PerfFlatList';

import {
  ActivityIndicator,
  FlatList,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { useNavigation } from '@react-navigation/native';
import { useSettingsStore } from '../store';
import ScreenHeader from '../components/ScreenHeader';
import { FadeInView } from '../components/Motion';
import MemberPicker from '../components/MemberPicker';
import pocketApi from '../api/pocket48';
import { errorMessage, normalizeUrl } from '../utils/data';
import { Member } from '../types';
import { SkeletonList } from '../components/Skeleton';

interface WeekItem {
  weekRankId: number;
  weekRankName: string;
}

// 参考电脑版鸡腿榜：周榜 / 总榜 / 年榜 + 成员贡献榜
type ViewMode = 'week' | 'total' | 'year' | 'person';

const MODE_LABELS: { key: ViewMode; label: string; icon: string }[] = [
  { key: 'week', label: '周榜', icon: 'calendar-week' },
  { key: 'total', label: '总榜', icon: 'trophy' },
  { key: 'year', label: '年榜', icon: 'calendar' },
  { key: 'person', label: '成员贡献', icon: 'account-heart' },
];

/** 从多种返回形态中解析出排名数组（官方接口字段不稳定，统一兜底）。 */
function extractRankList(data: any): any[] {
  if (!data || typeof data !== 'object') return [];
  const candidates = [
    data.rankList, data.list, data.data, data.ranks,
    data.content?.rankList, data.content?.list, data.content?.data,
    data.content?.ranks, data.data?.rankList, data.data?.list,
  ];
  for (const c of candidates) {
    if (Array.isArray(c) && c.length) return c;
  }
  // 兜底：遍历一层找首个数组
  for (const key of Object.keys(data)) {
    const v = (data as any)[key];
    if (Array.isArray(v) && v.length && typeof v[0] === 'object') return v;
  }
  return [];
}

export default function MeleeRankScreen() {
  const navigation = useNavigation<any>();
  const isDark = useSettingsStore((state) => state.settings.theme === 'dark');
  const [mode, setMode] = useState<ViewMode>('week');
  const [member, setMember] = useState<Member | null>(null);
  const [weeks, setWeeks] = useState<WeekItem[]>([]);
  const [selectedWeek, setSelectedWeek] = useState<WeekItem | null>(null);
  const selectedWeekRef = useRef(selectedWeek);
  selectedWeekRef.current = selectedWeek;
  const [ranks, setRanks] = useState<any[]>([]);
  const [personRanks, setPersonRanks] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const fetchWeeks = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await pocketApi.getMeleeRankPage();
      const data = res?.content || res?.data || res || {};
      const list =
        data?.weekList || data?.list || data?.rankList || data?.data;
      let items: WeekItem[] = [];
      if (Array.isArray(list) && list.length) {
        items = list
          .map((item: any) => ({
            weekRankId: Number(item.weekRankId || item.rankId || item.id || item.week || 0),
            weekRankName: String(item.weekRankName || item.rankName || item.name || item.title || ''),
          }))
          .filter((w: WeekItem) => w.weekRankId > 0);
      } else {
        // 顶层直接是排名（无周列表）→ 视为总榜
        const top = extractRankList(data);
        if (top.length) setRanks(top);
      }
      setWeeks(items);
      if (items.length > 0 && !selectedWeekRef.current) setSelectedWeek(items[items.length - 1]);
    } catch (e: any) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchWeekRank = useCallback(async (week: WeekItem) => {
    setLoading(true);
    setError('');
    try {
      const res = await pocketApi.getMeleeWeekRank(week.weekRankId);
      const data = res?.content || res?.data || res || {};
      setRanks(extractRankList(data));
    } catch (e: any) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchYearRank = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await pocketApi.getMeleeYearRankPage();
      const data = res?.content || res?.data || res || {};
      setRanks(extractRankList(data));
      if (!ranks.length && !extractRankList(data).length) setError('暂无年榜数据');
    } catch (e: any) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchPersonRank = useCallback(async (m: Member) => {
    if (!m?.id) return;
    setLoading(true);
    setError('');
    try {
      const res = await pocketApi.getPersonMeleeRankPage(Number(m.id));
      const data = res?.content || res?.data || {};
      const list = Array.isArray(data?.charmInfo) ? data.charmInfo : extractRankList(data);
      setPersonRanks(list);
    } catch (e: any) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchWeeks(); }, []);
  useEffect(() => {
    if (mode === 'week' && selectedWeek) fetchWeekRank(selectedWeek);
    else if (mode === 'year') fetchYearRank();
    else if (mode === 'total' && weeks.length) fetchWeekRank(selectedWeek || weeks[weeks.length - 1]);
  }, [mode, selectedWeek, weeks]);
  useEffect(() => {
    if (mode === 'person' && member) fetchPersonRank(member);
  }, [mode, member]);

  const renderWeekChip = ({ item }: { item: WeekItem }) => {
    const active = selectedWeek?.weekRankId === item.weekRankId;
    return (
      <TouchableOpacity
        style={[styles.weekChip, isDark && styles.weekChipDark, active && styles.weekChipActive]}
        onPress={() => setSelectedWeek(item)}
      >
        <Text style={[styles.weekChipText, isDark && styles.textSubLight, active && styles.weekChipTextActive]}>
          {item.weekRankName}
        </Text>
      </TouchableOpacity>
    );
  };

  const renderRank = useCallback(
    ({ item, index }: { item: any; index: number }) => (
      <RankCard item={item} index={index} isDark={isDark} />
    ),
    [isDark],
  );
  const renderPerson = useCallback(
    ({ item, index }: { item: any; index: number }) => (
      <PersonCard item={item} index={index} isDark={isDark} />
    ),
    [isDark],
  );

  const showSkeleton = loading && ranks.length === 0 && personRanks.length === 0 && mode !== 'person';

  return (
    <View style={[styles.container, isDark && styles.containerDark]}>
      <ScreenHeader title="鸡腿榜 🍗" onBack={() => navigation.goBack()} />

      <View style={styles.modeBar}>
        {MODE_LABELS.map((m) => {
          const active = mode === m.key;
          return (
            <TouchableOpacity
              key={m.key}
              style={[styles.modeBtn, active && styles.modeBtnActive]}
              onPress={() => { setRanks([]); setError(''); setMode(m.key); }}
            >
              <MaterialCommunityIcons name={m.icon as any} size={14} color={active ? '#fff' : (isDark ? '#eeeeee' : '#555555')} />
              <Text style={[styles.modeText, isDark && styles.textSubLight, active && styles.modeTextActive]}>{m.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {mode === 'person' && (
        <MemberPicker selectedMember={member} onSelect={(m) => { setPersonRanks([]); setMember(m); }} placeholder="搜索成员查看鸡腿贡献..." />
      )}
      {mode === 'week' && (
        <PerfFlatList
          horizontal
          data={weeks}
          keyExtractor={(item) => String(item.weekRankId)}
          renderItem={renderWeekChip}
          style={styles.weekList}
          contentContainerStyle={styles.weekListContent}
          showsHorizontalScrollIndicator={false}
        />
      )}

      {error ? (
        <View style={styles.errorWrap}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={fetchWeeks}>
            <Text style={styles.retryText}>重试</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {mode === 'person' ? (
        <FadeInView delay={80} duration={300} style={{ flex: 1 }}>
          <PerfFlatList
            data={personRanks}
            keyExtractor={(item: any) => String(item.userId || item.id || item.uid || Math.random())}
            contentContainerStyle={styles.list}
            initialNumToRender={12}
            maxToRenderPerBatch={12}
            windowSize={7}
            removeClippedSubviews
            getItemLayout={(_, index) => ({ length: 72, offset: 72 * index, index })}
            renderItem={renderPerson}
            ListEmptyComponent={
              <Text style={[styles.empty, isDark && styles.textSubLight]}>
                {loading ? '' : member ? '暂无鸡腿贡献数据' : '请选择成员查看贡献榜'}
              </Text>
            }
          />
        </FadeInView>
      ) : (
        <FadeInView delay={80} duration={300} style={{ flex: 1 }}>
          {showSkeleton ? (
            <SkeletonList count={8} dark={isDark} />
          ) : (
            <PerfFlatList
              data={ranks}
              keyExtractor={(item: any) => String(item.userId || item.rankNum || item.resId || Math.random())}
              contentContainerStyle={styles.list}
              initialNumToRender={12}
              maxToRenderPerBatch={12}
              windowSize={7}
              removeClippedSubviews
              getItemLayout={(_, index) => ({ length: 72, offset: 72 * index, index })}
              renderItem={renderRank}
              ListEmptyComponent={
                <Text style={[styles.empty, isDark && styles.textSubLight]}>
                  {loading ? '' : '暂无排名数据'}
                </Text>
              }
              ListFooterComponent={loading ? <ActivityIndicator color="#ff6f91" style={{ padding: 12 }} /> : null}
            />
          )}
        </FadeInView>
      )}
    </View>
  );
}

const RankCard = React.memo(function RankCard({ item, index, isDark }: { item: any; index: number; isDark: boolean }) {
  const rankNum = Number(item.rankNum || item.rank || item.no || index + 1);
  const u = item.baseUserInfo || item.userInfo || item.user || item;
  const topU = item.topUserInfo || item.topUser || {};
  const name = String(u.userName || u.nickname || u.nickName || u.name || '');
  const avatar = normalizeUrl(String(u.userAvatar || u.avatar || u.headImg || u.headUrl || u.picPath || ''));
  const topUser = String(topU.userName || topU.nickname || '');
  const melee = String(item.melee || item.meleeValue || item.score || item.total || item.charm || '0');

  return (
    <FadeInView delay={80 + index * 24} duration={300}>
      <View style={[styles.rankCard, isDark && styles.cardDark]}>
        <View style={styles.rankNumWrap}>
          <Text style={[styles.rankNum, rankNum <= 3 && styles.rankTop3]}>
            {rankNum <= 3 ? ['🥇', '🥈', '🥉'][rankNum - 1] : `#${rankNum}`}
          </Text>
        </View>
        {avatar ? <Image source={{ uri: avatar }} style={styles.avatar} /> : <View style={[styles.avatar, styles.avatarPlaceholder]} />}
        <View style={styles.rankInfo}>
          <Text style={[styles.rankName, isDark && styles.textLight]} numberOfLines={1}>{name || `用户 ${rankNum}`}</Text>
          {topUser ? <Text style={[styles.rankMeta, isDark && styles.textSubLight]} numberOfLines={1}>🏆 榜首: {topUser}</Text> : null}
        </View>
        <View style={styles.meleeWrap}>
          <Text style={styles.meleeEmoji}>🍗</Text>
          <Text style={styles.meleeValue}>{melee}</Text>
        </View>
      </View>
    </FadeInView>
  );
});

const PersonCard = React.memo(function PersonCard({ item, index, isDark }: { item: any; index: number; isDark: boolean }) {
  const name = String(item.userName || item.nickname || item.nickName || item.name || '');
  const u = item.baseUserInfo || item.userInfo || item.user || item;
  const avatar = normalizeUrl(String(u.userAvatar || u.avatar || u.headImg || u.headUrl || u.picPath || item.userAvatar || item.avatar || item.headImg || ''));
  const userId = String(item.userId || item.id || item.uid || '');
  const charm = String(item.charm || item.charmValue || item.total || item.score || item.melee || '0');

  return (
    <FadeInView delay={80 + index * 24} duration={300}>
      <View style={[styles.rankCard, isDark && styles.cardDark]}>
        {avatar ? <Image source={{ uri: avatar }} style={styles.avatar} /> : <View style={[styles.avatar, styles.avatarPlaceholder]} />}
        <View style={styles.rankInfo}>
          <Text style={[styles.rankName, isDark && styles.textLight]} numberOfLines={1}>{name || '未知用户'}</Text>
          <Text style={[styles.rankMeta, isDark && styles.textSubLight]} numberOfLines={1}>ID: {userId}</Text>
        </View>
        <View style={styles.meleeWrap}>
          <Text style={styles.meleeEmoji}>🍗</Text>
          <Text style={styles.meleeValue}>{charm}</Text>
        </View>
      </View>
    </FadeInView>
  );
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  containerDark: { backgroundColor: 'transparent' },
  modeBar: { flexDirection: 'row', paddingHorizontal: 14, marginBottom: 8, gap: 6 },
  modeBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 10, borderRadius: 16, backgroundColor: 'rgba(238,238,238,0.72)' },
  modeBtnActive: { backgroundColor: '#ff6f91' },
  modeText: { fontSize: 13, fontWeight: '800', color: '#555555' },
  modeTextActive: { color: '#fff' },
  weekList: { maxHeight: 46, marginBottom: 4 },
  weekListContent: { paddingHorizontal: 12, alignItems: 'center' },
  weekChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16, backgroundColor: 'rgba(238,238,238,0.72)', marginRight: 8 },
  weekChipDark: { backgroundColor: 'rgba(42,42,42,0.52)' },
  weekChipActive: { backgroundColor: '#ff6f91' },
  weekChipText: { fontSize: 13, color: '#444444', fontWeight: '700' },
  weekChipTextActive: { color: '#fff' },
  list: { padding: 12, paddingBottom: 40 },
  rankCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.72)',
    borderRadius: 14, padding: 12, marginBottom: 8,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.68)',
  },
  cardDark: { backgroundColor: 'rgba(20,20,20,0.68)', borderColor: 'rgba(255,255,255,0.10)' },
  rankNumWrap: { width: 44, alignItems: 'center' },
  rankNum: { fontSize: 15, fontWeight: '800', color: '#555555' },
  rankTop3: { fontSize: 20 },
  avatar: { width: 40, height: 40, borderRadius: 20, marginRight: 10, backgroundColor: 'rgba(128,128,128,0.12)' },
  avatarPlaceholder: {},
  rankInfo: { flex: 1 },
  rankName: { fontSize: 15, fontWeight: '700', color: '#333333' },
  rankMeta: { fontSize: 12, color: '#555555', marginTop: 2 },
  meleeWrap: { flexDirection: 'row', alignItems: 'center' },
  meleeEmoji: { fontSize: 14, marginRight: 2 },
  meleeValue: { fontSize: 15, fontWeight: '800', color: '#ff6f91', marginLeft: 2 },
  errorWrap: { padding: 16, alignItems: 'center' },
  errorText: { color: '#ff6f91', fontSize: 13, marginBottom: 8 },
  retryBtn: { backgroundColor: '#ff6f91', paddingHorizontal: 18, paddingVertical: 8, borderRadius: 18 },
  retryText: { color: '#fff', fontSize: 13, fontWeight: '800' },
  empty: { textAlign: 'center', color: '#555555', fontSize: 14, paddingVertical: 60 },
  textLight: { color: '#ffffff' },
  textSubLight: { color: '#dddddd' },
});
