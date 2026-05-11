import React, { useState } from 'react';
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
import MemberPicker from '../components/MemberPicker';
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
  return value === undefined || value === null || value === '' ? '-' : String(value);
}

function normalizeList(value: any): any[] {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.list)) return value.list;
  if (Array.isArray(value?.content)) return value.content;
  if (Array.isArray(value?.content?.list)) return value.content.list;
  return [];
}

function formatDate(time: any) {
  const d = new Date(Number(time));
  if (isNaN(d.getTime())) return '-';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function ProfileScreen() {
  const navigation = useNavigation();
  const theme = useSettingsStore((s) => s.settings.theme);
  const isDark = theme === 'dark';
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [archive, setArchive] = useState<ArchiveState>({ data: null, history: [], error: '' });
  const [loading, setLoading] = useState(false);

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
  const raw = selectedMember as any;

  return (
    <ScrollView style={[styles.container, isDark && styles.containerDark]} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={[styles.header, isDark && styles.headerDark]}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Text style={styles.backBtn}>← 返回</Text>
        </TouchableOpacity>
        <Text style={[styles.title, isDark && styles.textDark]}>成员档案</Text>
      </View>

      <View style={styles.pickerWrap}>
        <MemberPicker selectedMember={selectedMember} onSelect={loadProfile} placeholder="搜索成员查看档案..." />
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

          <Text style={styles.sectionTitle}>基本信息</Text>
          <View style={styles.infoGrid}>
            <InfoItem label="成员 ID" value={firstText(selectedMember.id)} dark={isDark} />
            <InfoItem label="拼音" value={firstText(selectedMember.pinyin)} dark={isDark} />
            {raw.birthday ? <InfoItem label="生日" value={firstText(raw.birthday)} dark={isDark} /> : null}
            {raw.birthplace ? <InfoItem label="出生地" value={firstText(raw.birthplace)} dark={isDark} /> : null}
            {raw.constellation ? <InfoItem label="星座" value={firstText(raw.constellation)} dark={isDark} /> : null}
            {raw.height ? <InfoItem label="身高" value={`${raw.height} cm`} dark={isDark} /> : null}
            {raw.bloodType ? <InfoItem label="血型" value={`${raw.bloodType}型`} dark={isDark} /> : null}
            {raw.hobbies ? <InfoItem label="爱好" value={firstText(raw.hobbies)} dark={isDark} /> : null}
            {raw.specialty ? <InfoItem label="特长" value={firstText(raw.specialty)} dark={isDark} /> : null}
          </View>

          <Text style={styles.sectionTitle}>生涯历程</Text>
          <View style={styles.infoGrid}>
            {raw.periodName ? <InfoItem label="期数" value={firstText(raw.periodName)} dark={isDark} /> : null}
            {raw.rank ? <InfoItem label="最高排名" value={firstText(raw.rank)} dark={isDark} /> : null}
            {raw.jtime ? <InfoItem label="加入时间" value={formatDate(raw.jtime)} dark={isDark} /> : null}
            {raw.ptime ? <InfoItem label="升格时间" value={formatDate(raw.ptime)} dark={isDark} /> : null}
            {raw.gtime ? <InfoItem label="毕业时间" value={formatDate(raw.gtime)} dark={isDark} /> : null}
            {raw.qtime ? <InfoItem label="退团时间" value={formatDate(raw.qtime)} dark={isDark} /> : null}
          </View>

          <Text style={styles.sectionTitle}>技术参数</Text>
          <View style={styles.infoGrid}>
            <InfoItem label="大房间" value={firstText(selectedMember.channelId)} dark={isDark} />
            <InfoItem label="服务器" value={firstText(selectedMember.serverId)} dark={isDark} />
            {selectedMember.yklzId ? <InfoItem label="小房间" value={firstText(selectedMember.yklzId)} dark={isDark} /> : null}
            {selectedMember.roomId ? <InfoItem label="roomId" value={firstText(selectedMember.roomId)} dark={isDark} /> : null}
            {selectedMember.liveRoomId ? <InfoItem label="直播间" value={firstText(selectedMember.liveRoomId)} dark={isDark} /> : null}
            {raw.wbName ? <InfoItem label="微博" value={firstText(raw.wbName)} dark={isDark} /> : null}
            {raw.wbUid ? <InfoItem label="微博UID" value={firstText(raw.wbUid)} dark={isDark} /> : null}
          </View>

          {raw.note ? (
            <View style={styles.noteBox}>
              <Text style={styles.noteLabel}>备注</Text>
              <Text style={styles.noteText}>{raw.note}</Text>
            </View>
          ) : null}

          {raw.fullPhoto1 ? (
            <View>
              <Text style={styles.sectionTitle}>公式照</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {['fullPhoto1', 'fullPhoto2', 'fullPhoto3', 'fullPhoto4'].filter((k) => raw[k]).map((k) => (
                  <Image key={k} source={{ uri: raw[k] }} style={styles.photoItem} resizeMode="cover" />
                ))}
              </ScrollView>
            </View>
          ) : null}
        </View>
      ) : (
        <View style={[styles.emptyCard, isDark && styles.cardDark]}>
          <Text style={[styles.emptyTitle, isDark && styles.textDark]}>搜索选择一个成员查看档案</Text>
          <Text style={styles.emptyText}>可按姓名、拼音、队伍搜索，查看完整资料和在线档案。</Text>
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
              <Text style={styles.timelineTime}>{formatDate(item.ctime || item.time)}</Text>
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
  header: { paddingTop: 54, paddingHorizontal: 20, paddingBottom: 14, marginBottom: 4 },
  headerDark: {},
  backBtn: { color: '#ff6f91', fontSize: 15, marginBottom: 8 },
  title: { fontSize: 24, fontWeight: '800', color: '#ff6f91' },
  pickerWrap: { paddingHorizontal: 16, marginBottom: 10 },
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
  sectionTitle: { color: '#ff6f91', fontSize: 15, fontWeight: '800', marginBottom: 10, marginTop: 14 },
  infoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  infoItem: { width: '48%', padding: 10, borderRadius: 14, backgroundColor: '#f7f7f7' },
  infoLabel: { color: '#333333', fontSize: 11, marginBottom: 4 },
  infoValue: { color: '#333', fontSize: 13, fontWeight: '600' },
  noteBox: { marginTop: 14, padding: 12, borderRadius: 14, backgroundColor: '#fff3cd' },
  noteLabel: { fontSize: 11, color: '#e65100', fontWeight: '700', marginBottom: 4 },
  noteText: { fontSize: 13, color: '#555', lineHeight: 20 },
  photoItem: { width: 120, height: 160, borderRadius: 12, marginRight: 8, backgroundColor: '#e0e0e0' },
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
