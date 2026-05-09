import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Image,
  TextInput,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSettingsStore, useMemberStore } from '../store';
import { Member } from '../types';
import pocketApi from '../api/pocket48';

type ArchiveState = {
  data: any;
  history: any[];
  error: string;
};

function displayName(member?: Member | null, starInfo?: any) {
  return starInfo?.starName || member?.ownerName?.split('-').pop() || member?.ownerName || '未选择成员';
}

function firstText(...values: any[]) {
  const value = values.find((v) => v !== undefined && v !== null && String(v).trim() !== '');
  return value === undefined ? '-' : String(value);
}

function normalizeList(value: any): any[] {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.list)) return value.list;
  if (Array.isArray(value?.content)) return value.content;
  if (Array.isArray(value?.content?.list)) return value.content.list;
  return [];
}

export default function ProfileScreen() {
  const navigation = useNavigation();
  const theme = useSettingsStore((s) => s.settings.theme);
  const isDark = theme === 'dark';
  const members = useMemberStore((s) => s.members);
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [archive, setArchive] = useState<ArchiveState>({ data: null, history: [], error: '' });
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const list = q
      ? members.filter((m) => {
        const haystack = [
          m.ownerName,
          m.pinyin,
          m.team,
          m.groupName,
          m.id,
          m.serverId,
          m.channelId,
        ].join(' ').toLowerCase();
        return haystack.includes(q);
      })
      : members;
    return list.slice(0, 30);
  }, [members, searchQuery]);

  const loadProfile = async (member: Member) => {
    setSelectedMember(member);
    setArchive({ data: null, history: [], error: '' });
    setLoading(true);
    try {
      const memberId = parseInt(member.id, 10);
      const [archiveRes, historyRes] = await Promise.all([
        pocketApi.getStarArchives(memberId).catch((e: any) => ({ __error: e?.message || String(e) })),
        pocketApi.getStarHistory(memberId).catch(() => null),
      ]);

      const data = archiveRes?.content || archiveRes?.data || archiveRes;
      const error = data?.__error ? String(data.__error) : '';
      setArchive({
        data: error ? null : data,
        history: [
          ...normalizeList(data?.history),
          ...normalizeList(historyRes?.content || historyRes?.data || historyRes),
        ],
        error,
      });
    } finally {
      setLoading(false);
    }
  };

  const starInfo = archive.data?.starInfo || archive.data?.star || archive.data || {};
  const fanRanks = normalizeList(archive.data?.fansRank || archive.data?.rankList);
  const avatar = firstText(starInfo?.starAvatar, starInfo?.avatar, selectedMember?.avatar);
  const name = displayName(selectedMember, starInfo);

  return (
    <ScrollView style={[styles.container, isDark && styles.containerDark]} contentContainerStyle={styles.content}>
      <View style={[styles.header, isDark && styles.headerDark]}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Text style={styles.backBtn}>← 返回</Text>
        </TouchableOpacity>
        <Text style={[styles.title, isDark && styles.textDark]}>成员档案</Text>
      </View>

      <TextInput
        style={[styles.input, isDark && styles.inputDark]}
        placeholder="搜索成员..."
        placeholderTextColor="#5a5a5a"
        value={searchQuery}
        onChangeText={setSearchQuery}
      />

      <View style={styles.chipRow}>
        {filtered.map((m) => (
          <TouchableOpacity
            key={`${m.id}-${m.channelId}`}
            style={[styles.chip, selectedMember?.id === m.id && styles.chipActive]}
            onPress={() => loadProfile(m)}
            activeOpacity={0.75}
          >
            <Text style={[styles.chipText, selectedMember?.id === m.id && styles.chipTextActive]} numberOfLines={1}>
              {m.ownerName.split('-').pop()}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {selectedMember ? (
        <View style={[styles.card, isDark && styles.cardDark]}>
          <View style={styles.profileHead}>
            {avatar !== '-' ? <Image source={{ uri: avatar }} style={styles.avatar} /> : <View style={styles.avatarFallback} />}
            <View style={styles.profileTitleWrap}>
              <Text style={[styles.name, isDark && styles.textDark]} numberOfLines={1}>{name}</Text>
              <Text style={styles.subLine} numberOfLines={1}>
                {firstText(selectedMember.groupName)} · {firstText(selectedMember.team)}
              </Text>
            </View>
          </View>

          {archive.error ? (
            <View style={styles.notice}>
              <Text style={styles.noticeTitle}>在线档案暂不可用</Text>
              <Text style={styles.noticeText}>已显示本地成员库资料；需要口袋签名的排行和经历可能无法加载。</Text>
            </View>
          ) : null}

          <View style={styles.infoGrid}>
            <InfoItem label="成员 ID" value={firstText(starInfo?.userId, selectedMember.id)} dark={isDark} />
            <InfoItem label="房间 ID" value={firstText(selectedMember.channelId)} dark={isDark} />
            <InfoItem label="服务器" value={firstText(selectedMember.serverId)} dark={isDark} />
            <InfoItem label="拼音" value={firstText(selectedMember.pinyin)} dark={isDark} />
          </View>
        </View>
      ) : (
        <View style={[styles.emptyCard, isDark && styles.cardDark]}>
          <Text style={[styles.emptyTitle, isDark && styles.textDark]}>选择一个成员查看档案</Text>
          <Text style={styles.emptyText}>可按姓名、拼音、队伍或房间号搜索。</Text>
        </View>
      )}

      {fanRanks.length > 0 ? (
        <View style={[styles.card, isDark && styles.cardDark]}>
          <Text style={styles.sectionTitle}>粉丝排行</Text>
          {fanRanks.slice(0, 10).map((fan: any, index: number) => (
            <View key={`${fan.userId || fan.nickName || index}`} style={styles.rankRow}>
              <Text style={styles.rankNo}>{index + 1}</Text>
              <Text style={[styles.rankName, isDark && styles.textDark]} numberOfLines={1}>
                {firstText(fan.nickName, fan.nickname, fan.userName)}
              </Text>
              <Text style={styles.rankMeta} numberOfLines={1}>{firstText(fan.userId, fan.level, fan.score)}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {archive.history.length > 0 ? (
        <View style={[styles.card, isDark && styles.cardDark]}>
          <Text style={styles.sectionTitle}>重要经历</Text>
          {archive.history.slice(0, 20).map((item: any, index: number) => (
            <View key={`${item.ctime || item.time || index}`} style={styles.timelineRow}>
              <Text style={styles.timelineTime}>{firstText(item.ctime, item.time, item.date)}</Text>
              <Text style={[styles.timelineText, isDark && styles.textDark]}>
                {firstText(item.content, item.title, item.eventName, item.desc)}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      {loading ? <Text style={styles.loading}>加载中...</Text> : null}
    </ScrollView>
  );
}

function InfoItem({ label, value, dark }: { label: string; value: string; dark: boolean }) {
  return (
    <View style={styles.infoItem}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={[styles.infoValue, dark && styles.textDark]} numberOfLines={1}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  containerDark: { backgroundColor: 'transparent' },
  content: { paddingBottom: 36 },
  header: {
    paddingTop: 54,
    paddingHorizontal: 20,
    paddingBottom: 14,
    marginBottom: 4,
  },
  headerDark: {},
  backBtn: { color: '#ff6f91', fontSize: 15, marginBottom: 8 },
  title: { fontSize: 24, fontWeight: '800', color: '#ff6f91' },
  input: {
    margin: 16,
    marginBottom: 10,
    paddingHorizontal: 14,
    height: 46,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#ddd',
    backgroundColor: 'rgba(255,255,255,0.46)',
    color: '#333',
    fontSize: 15,
  },
  inputDark: { backgroundColor: 'rgba(20,20,20,0.58)', borderColor: '#444', color: '#eee' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16, gap: 8, marginBottom: 14 },
  chip: { maxWidth: 104, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.38)' },
  chipActive: { backgroundColor: '#ff6f91' },
  chipText: { fontSize: 13, color: '#444' },
  chipTextActive: { color: '#fff', fontWeight: '700' },
  card: { marginHorizontal: 16, marginBottom: 14, padding: 16, backgroundColor: 'rgba(255,255,255,0.46)', borderRadius: 18 },
  cardDark: { backgroundColor: 'rgba(20,20,20,0.58)' },
  emptyCard: { marginHorizontal: 16, marginBottom: 14, padding: 18, backgroundColor: 'rgba(255,255,255,0.46)', borderRadius: 18 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: '#333', marginBottom: 6 },
  emptyText: { color: '#333333', fontSize: 13 },
  profileHead: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  avatar: { width: 68, height: 68, borderRadius: 34, backgroundColor: 'rgba(238,238,238,0.82)' },
  avatarFallback: { width: 68, height: 68, borderRadius: 34, backgroundColor: '#f3d6df' },
  profileTitleWrap: { flex: 1, marginLeft: 14 },
  name: { fontSize: 22, fontWeight: '800', color: '#333' },
  subLine: { marginTop: 5, fontSize: 13, color: '#333333' },
  notice: { padding: 12, borderRadius: 18, backgroundColor: '#fff3cd', marginBottom: 14, borderLeftWidth: 3, borderLeftColor: '#ff9800' },
  noticeTitle: { fontSize: 13, fontWeight: '700', color: '#e65100', marginBottom: 4 },
  noticeText: { fontSize: 12, color: '#555', lineHeight: 18 },
  infoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  infoItem: { width: '48%', padding: 10, borderRadius: 18, backgroundColor: '#f7f7f7' },
  infoLabel: { color: '#333333', fontSize: 11, marginBottom: 4 },
  infoValue: { color: '#333', fontSize: 13, fontWeight: '600' },
  sectionTitle: { color: '#ff6f91', fontSize: 17, fontWeight: '800', marginBottom: 12 },
  rankRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.42)' },
  rankNo: { width: 28, color: '#ff6f91', fontWeight: '800' },
  rankName: { flex: 1, color: '#333', fontSize: 14, fontWeight: '600' },
  rankMeta: { maxWidth: 96, color: '#333333', fontSize: 12, textAlign: 'right' },
  timelineRow: { paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.42)' },
  timelineTime: { color: '#ff6f91', fontSize: 12, fontWeight: '700', marginBottom: 4 },
  timelineText: { color: '#444', fontSize: 14, lineHeight: 20 },
  loading: { textAlign: 'center', color: '#333333', marginTop: 6, marginBottom: 18 },
  textDark: { color: '#eee' },
});
