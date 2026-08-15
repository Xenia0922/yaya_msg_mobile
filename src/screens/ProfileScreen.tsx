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
import { useAppTheme } from '../hooks/useAppTheme';
import { FadeInView } from '../components/Motion';
import ScreenHeader from '../components/ScreenHeader';
import { CenterSpinner } from '../components/Loaders';
import { Member } from '../types';
import MemberPicker from '../components/MemberPicker';
import pocketApi from '../api/pocket48';
import { translate, useI18n } from '../i18n';
import { usePalette } from '../theme';

type ArchiveState = {
  data: any;
  history: any[];
  error: string;
};

function displayName(member?: Member | null, starInfo?: any) {
  return starInfo?.starName || member?.ownerName?.split('-').pop() || member?.ownerName || translate('未选择成员');
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
  const isDark = useAppTheme();
  const palette = usePalette();
  const { t } = useI18n();
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
      <ScreenHeader title={t('成员档案')} />

      <FadeInView delay={80} duration={300}>
        <View style={styles.pickerWrap}>
          <MemberPicker selectedMember={selectedMember} onSelect={loadProfile} placeholder={t('搜索成员查看档案...')} />
        </View>

        {selectedMember ? (
        <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.hairline }]}>
          <View style={styles.profileHead}>
            {avatar !== '-' ? <Image source={{ uri: avatar }} style={[styles.avatar, { backgroundColor: palette.fill2 }]} /> : <View style={[styles.avatarFallback, { backgroundColor: palette.tintSoft }]} />}
            <View style={styles.profileTitleWrap}>
              <Text style={[styles.name, { color: palette.label }]} numberOfLines={1}>{name}</Text>
              <Text style={[styles.subLine, { color: palette.labelSecondary }]} numberOfLines={1}>
                {firstText(selectedMember.groupName)} · {firstText(selectedMember.team)}
              </Text>
            </View>
          </View>

          {archive.error ? (
            <View style={[styles.notice, { backgroundColor: palette.fill2 }]}>
              <Text style={[styles.noticeTitle, { color: palette.tint }]}>{t('在线档案暂不可用')}</Text>
              <Text style={[styles.noticeText, { color: palette.labelSecondary }]}>{t('已显示本地成员库资料；需要口袋签名的排行和经历可能无法加载。')}</Text>
            </View>
          ) : null}

          <Text style={[styles.sectionTitle, { color: palette.tint }]}>{t('基本信息')}</Text>
          <View style={styles.infoGrid}>
            <InfoItem label={t('成员 ID')} value={firstText(selectedMember.id)} palette={palette} />
            <InfoItem label={t('拼音')} value={firstText(selectedMember.pinyin)} palette={palette} />
            {raw.birthday ? <InfoItem label={t('生日')} value={firstText(raw.birthday)} palette={palette} /> : null}
            {raw.birthplace ? <InfoItem label={t('出生地')} value={firstText(raw.birthplace)} palette={palette} /> : null}
            {raw.constellation ? <InfoItem label={t('星座')} value={firstText(raw.constellation)} palette={palette} /> : null}
            {raw.height ? <InfoItem label={t('身高')} value={`${raw.height} cm`} palette={palette} /> : null}
            {raw.bloodType ? <InfoItem label={t('血型')} value={t('{type}型', { type: raw.bloodType })} palette={palette} /> : null}
            {raw.hobbies ? <InfoItem label={t('爱好')} value={firstText(raw.hobbies)} palette={palette} /> : null}
            {raw.specialty ? <InfoItem label={t('特长')} value={firstText(raw.specialty)} palette={palette} /> : null}
          </View>

          <Text style={[styles.sectionTitle, { color: palette.tint }]}>{t('生涯历程')}</Text>
          <View style={styles.infoGrid}>
            {raw.periodName ? <InfoItem label={t('期数')} value={firstText(raw.periodName)} palette={palette} /> : null}
            {raw.rank ? <InfoItem label={t('最高排名')} value={firstText(raw.rank)} palette={palette} /> : null}
            {raw.jtime ? <InfoItem label={t('加入时间')} value={formatDate(raw.jtime)} palette={palette} /> : null}
            {raw.ptime ? <InfoItem label={t('升格时间')} value={formatDate(raw.ptime)} palette={palette} /> : null}
            {raw.gtime ? <InfoItem label={t('毕业时间')} value={formatDate(raw.gtime)} palette={palette} /> : null}
            {raw.qtime ? <InfoItem label={t('退团时间')} value={formatDate(raw.qtime)} palette={palette} /> : null}
          </View>

          <Text style={[styles.sectionTitle, { color: palette.tint }]}>{t('技术参数')}</Text>
          <View style={styles.infoGrid}>
            <InfoItem label={t('大房间')} value={firstText(selectedMember.channelId)} palette={palette} />
            <InfoItem label={t('服务器')} value={firstText(selectedMember.serverId)} palette={palette} />
            {selectedMember.yklzId ? <InfoItem label={t('小房间')} value={firstText(selectedMember.yklzId)} palette={palette} /> : null}
            {selectedMember.roomId ? <InfoItem label="roomId" value={firstText(selectedMember.roomId)} palette={palette} /> : null}
            {selectedMember.liveRoomId ? <InfoItem label={t('直播间')} value={firstText(selectedMember.liveRoomId)} palette={palette} /> : null}
            {raw.wbName ? <InfoItem label={t('微博')} value={firstText(raw.wbName)} palette={palette} /> : null}
            {raw.wbUid ? <InfoItem label={t('微博UID')} value={firstText(raw.wbUid)} palette={palette} /> : null}
          </View>

          {raw.note ? (
            <View style={[styles.noteBox, { backgroundColor: palette.tintSoft }]}>
              <Text style={[styles.noteLabel, { color: palette.tint }]}>{t('备注')}</Text>
              <Text style={[styles.noteText, { color: palette.labelSecondary }]}>{raw.note}</Text>
            </View>
          ) : null}

          {raw.fullPhoto1 ? (
            <View>
              <Text style={[styles.sectionTitle, { color: palette.tint }]}>{t('公式照')}</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {['fullPhoto1', 'fullPhoto2', 'fullPhoto3', 'fullPhoto4'].filter((k) => raw[k]).map((k) => (
                  <Image key={k} source={{ uri: raw[k] }} style={[styles.photoItem, { backgroundColor: palette.fill2 }]} resizeMode="cover" />
                ))}
              </ScrollView>
            </View>
          ) : null}
        </View>
      ) : (
        <View style={[styles.emptyCard, { backgroundColor: palette.surface, borderColor: palette.hairline }]}>
          <Text style={[styles.emptyTitle, { color: palette.label }]}>{t('暂无数据')}</Text>
          <Text style={[styles.emptyText, { color: palette.labelSecondary }]}>{t('搜索成员查看档案')}</Text>
        </View>
      )}

      {fanRanks.length > 0 ? (
        <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.hairline }]}>
          <Text style={[styles.sectionTitle, { color: palette.tint }]}>{t('粉丝排行')}</Text>
          {fanRanks.slice(0, 10).map((fan: any, index: number) => (
            <View key={`${fan.userId || fan.nickName || index}`} style={[styles.rankRow, { borderBottomColor: palette.innerStroke }]}>
              <Text style={[styles.rankNo, { color: palette.tint }]}>{index + 1}</Text>
              <Text style={[styles.rankName, { color: palette.label }]} numberOfLines={1}>
                {firstText(fan.nickName, fan.nickname, fan.userName)}
              </Text>
              <Text style={[styles.rankMeta, { color: palette.labelSecondary }]} numberOfLines={1}>{firstText(fan.userId, fan.level, fan.score)}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {archive.history.length > 0 ? (
        <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.hairline }]}>
          <Text style={[styles.sectionTitle, { color: palette.tint }]}>{t('重要经历')}</Text>
          {archive.history.slice(0, 20).map((item: any, index: number) => (
            <View key={`${item.ctime || item.time || index}`} style={[styles.timelineRow, { borderBottomColor: palette.innerStroke }]}>
              <Text style={[styles.timelineTime, { color: palette.tint }]}>{formatDate(item.ctime || item.time)}</Text>
              <Text style={[styles.timelineText, { color: palette.label }]}>
                {firstText(item.content, item.title, item.eventName, item.desc)}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      </FadeInView>
      {loading ? <CenterSpinner dark={isDark} /> : null}
    </ScrollView>
  );
}

function InfoItem({ label, value, palette }: { label: string; value: string; palette: any }) {
  return (
    <View style={[styles.infoItem, { backgroundColor: palette.fill2 }]}>
      <Text style={[styles.infoLabel, { color: palette.labelTertiary }]}>{label}</Text>
      <Text style={[styles.infoValue, { color: palette.label }]} numberOfLines={1}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  containerDark: { backgroundColor: 'transparent' },
  content: { paddingBottom: 36 },
  pickerWrap: { paddingHorizontal: 16, marginBottom: 10 },
  card: { marginHorizontal: 16, marginVertical: 4, padding: 14, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth },
  emptyCard: { marginHorizontal: 16, marginVertical: 4, padding: 18, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth },
  emptyTitle: { fontSize: 16, fontWeight: '700', marginBottom: 6 },
  emptyText: { fontSize: 13 },
  profileHead: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  avatar: { width: 68, height: 68, borderRadius: 34 },
  avatarFallback: { width: 68, height: 68, borderRadius: 34, alignItems: 'center', justifyContent: 'center' },
  profileTitleWrap: { flex: 1, marginLeft: 14 },
  name: { fontSize: 22, fontWeight: '800' },
  subLine: { marginTop: 5, fontSize: 13 },
  notice: { padding: 12, borderRadius: 14, marginBottom: 14, borderLeftWidth: 3, borderLeftColor: '#ff9800' },
  noticeTitle: { fontSize: 13, fontWeight: '700', marginBottom: 4 },
  noticeText: { fontSize: 12, lineHeight: 18 },
  sectionTitle: { fontSize: 15, fontWeight: '800', marginBottom: 10, marginTop: 14 },
  infoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  infoItem: { width: '48%', padding: 10, borderRadius: 14 },
  infoLabel: { fontSize: 11, marginBottom: 4 },
  infoValue: { fontSize: 13, fontWeight: '600' },
  noteBox: { marginTop: 14, padding: 12, borderRadius: 14 },
  noteLabel: { fontSize: 11, fontWeight: '700', marginBottom: 4 },
  noteText: { fontSize: 13, lineHeight: 20 },
  photoItem: { width: 120, height: 160, borderRadius: 12, marginRight: 8 },
  rankRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  rankNo: { width: 28, fontWeight: '800' },
  rankName: { flex: 1, fontSize: 14, fontWeight: '600' },
  rankMeta: { maxWidth: 96, fontSize: 12, textAlign: 'right' },
  timelineRow: { paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth },
  timelineTime: { fontSize: 12, fontWeight: '700', marginBottom: 4 },
  timelineText: { fontSize: 14, lineHeight: 20 },
});
