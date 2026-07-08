import React, { useCallback, useEffect, useRef, useState } from 'react';
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
import pocketApi from '../api/pocket48';
import { errorMessage, unwrapList } from '../utils/data';
import { Member } from '../types';

interface WeekItem {
  weekRankId: number;
  weekRankName: string;
}

type ViewMode = 'total' | 'person';

export default function MeleeRankScreen() {
  const navigation = useNavigation<any>();
  const isDark = useSettingsStore((state) => state.settings.theme === 'dark');
  const [mode, setMode] = useState<ViewMode>('total');
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
      // The API returns a list of rank weeks
      let list = data?.weekList || data?.list || data?.rankList || data?.data;
      if (!Array.isArray(list) && data && typeof data === 'object') {
        // Try to find any array in the response
        for (const key of Object.keys(data)) {
          if (Array.isArray(data[key]) && data[key].length > 0) {
            list = data[key];
            break;
          }
        }
      }
      const items: WeekItem[] = (Array.isArray(list) ? list : [])
        .map((item: any) => ({
          weekRankId: Number(item.weekRankId || item.rankId || item.id || item.week || 0),
          weekRankName: String(item.weekRankName || item.rankName || item.name || item.title || ''),
        }))
        .filter((w: WeekItem) => w.weekRankId > 0);
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
      // API returns rank list with user info
      let list = data?.rankList || data?.list || data?.data || data?.ranks;
      if (!Array.isArray(list) && data && typeof data === 'object') {
        for (const key of Object.keys(data)) {
          if (Array.isArray(data[key]) && data[key].length > 0) {
            list = data[key];
            break;
          }
        }
      }
      setRanks(Array.isArray(list) ? list : []);
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
      setPersonRanks(Array.isArray(data?.charmInfo) ? data.charmInfo : []);
    } catch (e: any) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchWeeks(); }, []);
  useEffect(() => {
    if (mode === 'total' && selectedWeek) fetchWeekRank(selectedWeek);
  }, [mode, selectedWeek]);
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

  const renderRankItem = ({ item, index }: { item: any; index: number }) => {
    const rankNum = Number(item.rankNum || item.rank || item.no || index + 1);
    // User info can be at baseUserInfo, userInfo, user, or top-level
    const u = item.baseUserInfo || item.userInfo || item.user || item;
    const topU = item.topUserInfo || item.topUser || {};
    const name = String(u.userName || u.nickname || u.nickName || u.name || '');
    const avatar = String(u.userAvatar || u.avatar || u.headImg || u.headUrl || '');
    const topUser = String(topU.userName || topU.nickname || '');
    const melee = String(item.melee || item.meleeValue || item.score || item.total || '0');

    return (
      <FadeInView delay={80 + index * 30} duration={300}>
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
          <Text style={styles.meleeValue}>{melee}</Text>
        </View>
      </FadeInView>
    );
  };

  const renderPersonItem = ({ item, index }: { item: any; index: number }) => {
    const name = String(item.userName || item.nickname || item.nickName || item.name || '');
    const avatar = String(item.userAvatar || item.avatar || item.headImg || '');
    const userId = String(item.userId || item.id || item.uid || '');
    const charm = String(item.charm || item.charmValue || item.total || item.score || '0');

    return (
      <FadeInView delay={80 + index * 30} duration={300}>
        <View style={[styles.rankCard, isDark && styles.cardDark]}>
          {avatar ? <Image source={{ uri: avatar }} style={styles.avatar} /> : <View style={[styles.avatar, styles.avatarPlaceholder]} />}
          <View style={styles.rankInfo}>
            <Text style={[styles.rankName, isDark && styles.textLight]} numberOfLines={1}>{name || '未知用户'}</Text>
            <Text style={[styles.rankMeta, isDark && styles.textSubLight]} numberOfLines={1}>ID: {userId}</Text>
          </View>
          <Text style={styles.meleeValue}>{charm}</Text>
        </View>
      </FadeInView>
    );
  };

  return (
    <View style={[styles.container, isDark && styles.containerDark]}>
      <ScreenHeader title="乱斗榜" onBack={() => navigation.goBack()} />

      <View style={styles.modeBar}>
        <TouchableOpacity style={[styles.modeBtn, mode === 'total' && styles.modeBtnActive]} onPress={() => setMode('total')}>
          <Text style={[styles.modeText, isDark && styles.textSubLight, mode === 'total' && styles.modeTextActive]}>总榜</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.modeBtn, mode === 'person' && styles.modeBtnActive]} onPress={() => setMode('person')}>
          <Text style={[styles.modeText, isDark && styles.textSubLight, mode === 'person' && styles.modeTextActive]}>成员榜</Text>
        </TouchableOpacity>
      </View>

      {mode === 'person' && <MemberPicker selectedMember={member} onSelect={setMember} placeholder="搜索成员查看贡献榜..." />}

      {error ? (
        <View style={styles.errorWrap}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={fetchWeeks}>
            <Text style={styles.retryText}>重试</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {mode === 'total' && (
        <>
          <FlatList
            horizontal
            data={weeks}
            keyExtractor={(item) => String(item.weekRankId)}
            renderItem={renderWeekChip}
            style={styles.weekList}
            contentContainerStyle={styles.weekListContent}
            showsHorizontalScrollIndicator={false}
          />
          <FadeInView delay={80} duration={300} style={{ flex: 1 }}>
            <FlatList
              data={ranks}
              keyExtractor={(item: any) => String(item.userId || item.rankNum || item.resId || Math.random())}
              contentContainerStyle={styles.list}
              initialNumToRender={12}
              maxToRenderPerBatch={12}
              windowSize={7}
              removeClippedSubviews
              renderItem={renderRankItem}
              ListEmptyComponent={
                <Text style={[styles.empty, isDark && styles.textSubLight]}>
                  {loading ? '加载中...' : selectedWeek ? '暂无排名数据' : '选择排行榜查看详情'}
                </Text>
              }
            />
          </FadeInView>
        </>
      )}

      {mode === 'person' && (
        <FadeInView delay={80} duration={300} style={{ flex: 1 }}>
          <FlatList
            data={personRanks}
            keyExtractor={(item: any) => String(item.userId || item.charm || Math.random())}
            contentContainerStyle={styles.list}
            initialNumToRender={12}
            maxToRenderPerBatch={12}
            windowSize={7}
            removeClippedSubviews
            renderItem={renderPersonItem}
            ListEmptyComponent={
              <Text style={[styles.empty, isDark && styles.textSubLight]}>
                {loading ? '加载中...' : member ? '暂无贡献数据' : '请选择成员查看贡献榜'}
              </Text>
            }
          />
        </FadeInView>
      )}

      {loading && <ActivityIndicator color="#ff6f91" style={{ padding: 16 }} />}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  containerDark: { backgroundColor: 'transparent' },
  modeBar: { flexDirection: 'row', paddingHorizontal: 14, marginBottom: 8, gap: 6 },
  modeBtn: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 16, backgroundColor: 'rgba(238,238,238,0.72)' },
  modeBtnActive: { backgroundColor: '#ff6f91' },
  modeText: { fontSize: 14, fontWeight: '800', color: '#555555' },
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
  meleeValue: { fontSize: 15, fontWeight: '800', color: '#ff6f91', marginLeft: 8 },
  errorWrap: { padding: 16, alignItems: 'center' },
  errorText: { color: '#ff6f91', fontSize: 13, marginBottom: 8 },
  retryBtn: { backgroundColor: '#ff6f91', paddingHorizontal: 18, paddingVertical: 8, borderRadius: 18 },
  retryText: { color: '#fff', fontSize: 13, fontWeight: '800' },
  empty: { textAlign: 'center', color: '#555555', fontSize: 14, paddingVertical: 60 },
  textLight: { color: '#ffffff' },
  textSubLight: { color: '#dddddd' },
});
