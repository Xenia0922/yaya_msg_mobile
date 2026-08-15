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
import { Pill } from '../components/Pill';
import MemberPicker from '../components/MemberPicker';
import pocketApi from '../api/pocket48';
import { useI18n } from '../i18n';
import { errorMessage, normalizeUrl } from '../utils/data';
import { Member } from '../types';
import { CenterSpinner } from '../components/Loaders';
import { extractRankList, extractWeeks, WeekItem } from '../utils/meleeParse';
import { useAppTheme } from '../hooks/useAppTheme';
import { usePalette } from '../theme';

// 参考电脑版鸡腿榜：周榜 / 总榜 / 年榜 + 成员贡献榜
type ViewMode = 'week' | 'total' | 'year' | 'person';

const MODES: { key: ViewMode; label: string }[] = [
  { key: 'week', label: '周榜' },
  { key: 'total', label: '总榜' },
  { key: 'year', label: '年榜' },
  { key: 'person', label: '成员贡献' },
];

export default function MeleeRankScreen() {
  const navigation = useNavigation<any>();
  const isDark = useAppTheme();
  const palette = usePalette();
  const { t } = useI18n();
  const [mode, setMode] = useState<ViewMode>('week');
  const [member, setMember] = useState<Member | null>(null);
  const [weeks, setWeeks] = useState<WeekItem[]>([]);
  const [selectedWeek, setSelectedWeek] = useState<WeekItem | null>(null);
  const selectedWeekRef = useRef(selectedWeek);
  selectedWeekRef.current = selectedWeek;
  const [ranks, setRanks] = useState<any[]>([]);
  const [personRanks, setPersonRanks] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const nextIdRef = useRef('');
  const hasMoreRef = useRef(false);

  const switchMode = (m: ViewMode) => {
    setRanks([]);
    setPersonRanks([]);
    setError('');
    nextIdRef.current = '';
    hasMoreRef.current = false;
    setMode(m);
  };

  const loadRank = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      let res: any;
      if (mode === 'year') res = await pocketApi.getMeleeYearRankPage();
      else if (mode === 'total') res = await pocketApi.getMeleeRankPage();
      else if (mode === 'week') {
        res = selectedWeekRef.current
          ? await pocketApi.getMeleeWeekRank(selectedWeekRef.current.weekRankId)
          : await pocketApi.getMeleeRankPage();
      } else {
        return;
      }
      const data = res?.content ?? res?.data ?? res ?? {};
      // 优先从返回体补齐周列表（部分接口把 weekList 挂在 content 下）
      const ws = extractWeeks(data);
      if (ws.length) {
        setWeeks((prev) => (prev.length ? prev : ws));
        if (!selectedWeekRef.current) setSelectedWeek(ws[ws.length - 1]);
      }
      const list = extractRankList(data);
      setRanks(list);
      // 分页游标：getMeleeRankPage / getMeleeYearRankPage 支持 nextId
      const nextId = String(data?.nextId || data?.next || '');
      nextIdRef.current = nextId;
      hasMoreRef.current = !!nextId && list.length > 0;
      if (!list.length) setError(mode === 'year' ? t('暂无年榜数据') : t('暂无排名数据'));
    } catch (e: any) {
      setError(errorMessage(e));
      setRanks([]);
    } finally {
      setLoading(false);
    }
  }, [mode, t]);

  const loadMoreRank = useCallback(async () => {
    if (loading || loadingMore || !hasMoreRef.current || !nextIdRef.current) return;
    setLoadingMore(true);
    try {
      let res: any;
      if (mode === 'year') res = await pocketApi.getMeleeYearRankPage(0, nextIdRef.current);
      else if (mode === 'total') res = await pocketApi.getMeleeRankPage(0, nextIdRef.current);
      else if (mode === 'week') {
        res = selectedWeekRef.current
          ? await pocketApi.getMeleeWeekRank(selectedWeekRef.current.weekRankId, nextIdRef.current)
          : await pocketApi.getMeleeRankPage(0, nextIdRef.current);
      } else {
        return;
      }
      const data = res?.content ?? res?.data ?? res ?? {};
      const list = extractRankList(data);
      const nextId = String(data?.nextId || data?.next || '');
      setRanks((prev) => {
        const seen = new Set(prev.map((it) => String(it.userId || it.rankNum || it.resId || it.id)));
        const fresh = list.filter((it) => !seen.has(String(it.userId || it.rankNum || it.resId || it.id)));
        return [...prev, ...fresh];
      });
      nextIdRef.current = nextId;
      hasMoreRef.current = !!nextId && list.length > 0;
    } catch {
      hasMoreRef.current = false;
    } finally {
      setLoadingMore(false);
    }
  }, [loading, loadingMore, mode, t]);

  const loadPerson = useCallback(async (m: Member) => {
    if (!m?.id) {
      setPersonRanks([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await pocketApi.getPersonMeleeRankPage(Number(m.id));
      const data = res?.content ?? res?.data ?? {};
      const list = Array.isArray(data?.charmInfo) ? data.charmInfo : extractRankList(data);
      setPersonRanks(list);
      if (!list.length) setError(t('暂无鸡腿贡献数据'));
    } catch (e: any) {
      setError(errorMessage(e));
      setPersonRanks([]);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (mode === 'person') {
      if (member) loadPerson(member);
      else {
        setPersonRanks([]);
        setLoading(false);
      }
    } else {
      loadRank();
    }
  }, [mode, selectedWeek, member, loadRank, loadPerson]);

  const renderWeekChip = ({ item }: { item: WeekItem }) => {
    const active = selectedWeek?.weekRankId === item.weekRankId;
    return (
      <Pill
        label={item.weekRankName}
        selected={active}
        onPress={() => { setRanks([]); setSelectedWeek(item); }}
        style={styles.weekChip}
      />
    );
  };

  const renderRank = useCallback(
    ({ item, index }: { item: any; index: number }) => (
      <RankCard item={item} index={index} />
    ),
    [],
  );
  const renderPerson = useCallback(
    ({ item, index }: { item: any; index: number }) => (
      <PersonCard item={item} index={index} />
    ),
    [],
  );

  const showSkeleton = loading && ranks.length === 0 && mode !== 'person';
  const showPersonSkeleton = loading && personRanks.length === 0 && mode === 'person';

  return (
    <View style={[styles.container, isDark && styles.containerDark]}>
      <ScreenHeader title={t('鸡腿榜')} onBack={() => navigation.goBack()} />

      <View style={styles.modeRow}>
        {MODES.map((m) => (
          <View key={m.key} style={styles.modeWrap}>
            <Pill
              label={t(m.label)}
              selected={mode === m.key}
              onPress={() => switchMode(m.key)}
              style={styles.modePill}
            />
          </View>
        ))}
      </View>

      {mode === 'person' && (
        <MemberPicker selectedMember={member} onSelect={(m) => { setPersonRanks([]); setMember(m); }} placeholder={t('搜索成员查看鸡腿贡献...')} />
      )}

      {mode === 'week' && weeks.length > 0 && (
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
          <Text style={[styles.errorText, { color: palette.tint }]}>{error}</Text>
          <TouchableOpacity style={[styles.retryBtn, { backgroundColor: palette.tint }]} onPress={() => (mode === 'person' && member ? loadPerson(member) : loadRank())}>
            <Text style={styles.retryText}>{t('重试')}</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {mode === 'person' ? (
        <FadeInView delay={80} duration={300} style={{ flex: 1 }}>
          {showPersonSkeleton ? (
            <CenterSpinner dark={isDark} text={t('加载中…')} />
          ) : (
            <PerfFlatList
              data={personRanks}
              keyExtractor={(item: any, index: number) => String(item.userId || item.id || item.uid || item.resId || `p${index}`)}
              contentContainerStyle={styles.list}
              initialNumToRender={12}
              maxToRenderPerBatch={12}
              windowSize={7}
              renderItem={renderPerson}
              ListEmptyComponent={
                <Text style={[styles.empty, { color: palette.labelTertiary }]}>
                  {loading ? '' : member ? t('暂无鸡腿贡献数据') : t('请选择成员查看贡献榜')}
                </Text>
              }
            />
          )}
        </FadeInView>
      ) : (
        <FadeInView delay={80} duration={300} style={{ flex: 1 }}>
          {showSkeleton ? (
            <CenterSpinner dark={isDark} text={t('加载中…')} />
          ) : (
            <PerfFlatList
              data={ranks}
              keyExtractor={(item: any, index: number) => String(item.userId || item.rankNum || item.resId || item.id || `r${index}`)}
              contentContainerStyle={styles.list}
              initialNumToRender={12}
              maxToRenderPerBatch={12}
              windowSize={7}
              renderItem={renderRank}
              onEndReached={loadMoreRank}
              onEndReachedThreshold={0.35}
              ListEmptyComponent={
                <Text style={[styles.empty, { color: palette.labelTertiary }]}>
                  {loading ? '' : t('暂无排名数据')}
                </Text>
              }
              ListFooterComponent={
                loadingMore ? <ActivityIndicator color={palette.tint} style={{ padding: 12 }} />
                : loading ? <ActivityIndicator color={palette.tint} style={{ padding: 12 }} /> : null
              }
            />
          )}
        </FadeInView>
      )}
    </View>
  );
}

const RankCard = React.memo(function RankCard({ item, index }: { item: any; index: number }) {
  const palette = usePalette();
  const { t } = useI18n();
  const rankNum = Number(item.rankNum || item.rank || item.no || index + 1);
  const u = item.baseUserInfo || item.userInfo || item.user || item;
  const topU = item.topUserInfo || item.topUser || {};
  const name = String(u.userName || u.nickname || u.nickName || u.name || '');
  const avatar = normalizeUrl(String(u.userAvatar || u.avatar || u.headImg || u.headUrl || u.picPath || ''));
  const topUser = String(topU.userName || topU.nickname || '');
  const melee = String(item.melee || item.meleeValue || item.score || item.total || item.charm || '0');

  return (
    <FadeInView delay={80 + index * 24} duration={300}>
      <View style={[styles.rankCard, { backgroundColor: palette.surface, borderColor: palette.hairline }]}>
        <View style={[styles.leadIcon, { backgroundColor: palette.tintSoft }]}>
          {rankNum <= 3 ? (
            <MaterialCommunityIcons name="medal" size={20} color={palette.tint} />
          ) : (
            <Text style={[styles.rankNum, { color: palette.tint }]}>{rankNum}</Text>
          )}
        </View>
        {avatar ? <Image source={{ uri: avatar }} style={[styles.avatar, { backgroundColor: palette.fill2 }]} /> : <View style={[styles.avatar, styles.avatarPlaceholder, { backgroundColor: palette.fill2 }]} />}
        <View style={styles.rankInfo}>
          <Text style={[styles.rankName, { color: palette.label }]} numberOfLines={1}>{name || t('用户 {rank}', { rank: rankNum })}</Text>
          {topUser ? (
            <View style={styles.rankMetaRow}>
              <MaterialCommunityIcons name="crown" size={13} color={palette.tint} />
              <Text style={[styles.rankMeta, { color: palette.labelSecondary }]} numberOfLines={1}>{t('榜首: {topUser}', { topUser })}</Text>
            </View>
          ) : null}
        </View>
        <View style={styles.meleeWrap}>
          <MaterialCommunityIcons name="food-drumstick-outline" size={16} color={palette.tint} />
          <Text style={[styles.meleeValue, { color: palette.tint }]}>{melee}</Text>
        </View>
      </View>
    </FadeInView>
  );
});

const PersonCard = React.memo(function PersonCard({ item, index }: { item: any; index: number }) {
  const palette = usePalette();
  const { t } = useI18n();
  const name = String(item.userName || item.nickname || item.nickName || item.name || '');
  const u = item.baseUserInfo || item.userInfo || item.user || item;
  const avatar = normalizeUrl(String(u.userAvatar || u.avatar || u.headImg || u.headUrl || u.picPath || item.userAvatar || item.avatar || item.headImg || ''));
  const userId = String(item.userId || item.id || item.uid || '');
  const charm = String(item.charm || item.charmValue || item.total || item.score || item.melee || '0');

  return (
    <FadeInView delay={80 + index * 24} duration={300}>
      <View style={[styles.rankCard, { backgroundColor: palette.surface, borderColor: palette.hairline }]}>
        <View style={[styles.leadIcon, { backgroundColor: palette.tintSoft }]}>
          <MaterialCommunityIcons name="account-heart" size={20} color={palette.tint} />
        </View>
        {avatar ? <Image source={{ uri: avatar }} style={[styles.avatar, { backgroundColor: palette.fill2 }]} /> : <View style={[styles.avatar, styles.avatarPlaceholder, { backgroundColor: palette.fill2 }]} />}
        <View style={styles.rankInfo}>
          <Text style={[styles.rankName, { color: palette.label }]} numberOfLines={1}>{name || t('未知用户')}</Text>
          <Text style={[styles.rankMeta, { color: palette.labelSecondary }]} numberOfLines={1}>{t('ID: {id}', { id: userId })}</Text>
        </View>
        <View style={styles.meleeWrap}>
          <MaterialCommunityIcons name="food-drumstick-outline" size={16} color={palette.tint} />
          <Text style={[styles.meleeValue, { color: palette.tint }]}>{charm}</Text>
        </View>
      </View>
    </FadeInView>
  );
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  containerDark: { backgroundColor: 'transparent' },
  modeRow: { flexDirection: 'row', paddingHorizontal: 16, marginBottom: 8, gap: 6 },
  modeWrap: { flex: 1 },
  modePill: { alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center' },
  weekList: { maxHeight: 46, marginBottom: 4 },
  weekListContent: { paddingHorizontal: 16, alignItems: 'center', gap: 6 },
  weekChip: { marginRight: 0 },
  list: { padding: 14, paddingBottom: 40 },
  rankCard: {
    flexDirection: 'row', alignItems: 'center',
    borderRadius: 16, padding: 12, marginBottom: 5,
    borderWidth: StyleSheet.hairlineWidth,
  },
  leadIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  rankNum: { fontSize: 18, fontWeight: '900' },
  avatar: { width: 34, height: 34, borderRadius: 17, marginRight: 10 },
  avatarPlaceholder: {},
  rankInfo: { flex: 1, minWidth: 0 },
  rankName: { fontSize: 15, fontWeight: '700' },
  rankMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 2 },
  rankMeta: { fontSize: 12, marginTop: 2, flex: 1 },
  meleeWrap: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  meleeValue: { fontSize: 15, fontWeight: '800' },
  errorWrap: { padding: 16, alignItems: 'center' },
  errorText: { fontSize: 13, marginBottom: 8 },
  retryBtn: { paddingHorizontal: 18, paddingVertical: 8, borderRadius: 18 },
  retryText: { color: '#fff', fontSize: 13, fontWeight: '800' },
  empty: { textAlign: 'center', fontSize: 14, paddingVertical: 60 },
});
