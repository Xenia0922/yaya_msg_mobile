import React, { useEffect, useRef, useState } from 'react';
import { useRoute } from '@react-navigation/native';
import { toMs } from '../utils/format';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { FadeInView, ScalePressable } from '../components/Motion';
import { NetworkImage } from '../components/NetworkImage';
import ScreenHeader from '../components/ScreenHeader';
import { Button } from '../components/Button';
import { EmptyState } from '../components/StateViews';
import { CenterSpinner } from '../components/Loaders';
import { Member } from '../types';
import MemberPicker from '../components/MemberPicker';
import { userCardFromUserRes } from '../components/UserProfileSheet';
import pocketApi from '../api/pocket48';
import { translate, useI18n } from '../i18n';
import { usePalette, fontFamily } from '../theme';
import { useMemberStore, useSettingsStore, useUiStore } from '../store';
import { GlassSurface } from '../components/GlassSurface';
import { readFollowedIdsCache, writeFollowedIdsCache } from '../services/followedIds';
import { errorMessage } from '../utils/data';

type ArchiveState = {
  data: any;
  history: any[];
  error: string;
};

function displayName(member?: Member | null, starInfo?: any) {
  return (
    starInfo?.starName ||
    member?.ownerName?.split('-').pop() ||
    member?.ownerName ||
    translate('未选择成员')
  );
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
  const d = new Date(toMs(Number(time)));
  if (isNaN(d.getTime())) return '-';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDateValue(value: any) {
  if (value === undefined || value === null || String(value).trim() === '') return '-';
  const text = String(value).trim();
  const numeric = Number(text);
  if (Number.isFinite(numeric) && numeric > 0) return formatDate(numeric);
  return text.length >= 10 ? text.slice(0, 10) : text;
}

export default function ProfileScreen() {
  const palette = usePalette();
  const { t } = useI18n();
  const token = useSettingsStore((s) => s.settings.p48Token);
  const showToast = useUiStore((s) => s.showToast);
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [archive, setArchive] = useState<ArchiveState>({ data: null, history: [], error: '' });
  const [loading, setLoading] = useState(false);
  const [followState, setFollowState] = useState<{
    uid: string;
    following: boolean;
    busy: boolean;
  }>({ uid: '', following: false, busy: false });

  const profileReqRef = useRef(0);

  const loadProfile = async (member: Member): Promise<boolean> => {
    const requestId = ++profileReqRef.current;
    setSelectedMember(member);
    setArchive({ data: null, history: [], error: '' });
    setLoading(true);
    const followUid = String(member.userId || member.id || '').trim();
    const followCandidates = Array.from(
      new Set(
        [String(member.userId || '').trim(), String(member.id || '').trim()].filter((v) =>
          /^\d+$/.test(v),
        ),
      ),
    );
    setFollowState({ uid: followCandidates[0] || followUid, following: false, busy: false });
    if (followCandidates.length > 0) {
      void readFollowedIdsCache(token).then((cached) => {
        if (requestId !== profileReqRef.current) return;
        const set = new Set(cached.ids.map(String));
        if (followCandidates.some((id) => set.has(id))) {
          setFollowState((prev) => ({ ...prev, following: true }));
        }
      });
      void (async () => {
        for (const cid of followCandidates) {
          try {
            const res = await pocketApi.getUserProfile(cid);
            if (requestId !== profileReqRef.current) return;
            const parsed = userCardFromUserRes(res);
            setFollowState({ uid: cid, following: parsed.following, busy: false });
            return;
          } catch {}
        }
      })();
    }
    try {
      const memberId = parseInt(String(member.id || ''), 10);
      if (!Number.isFinite(memberId)) {
        setLoading(false);
        return false;
      }
      const [archiveRes, historyRes] = await Promise.all([
        pocketApi
          .getStarArchives(memberId)
          .catch((e: any) => ({ __error: e?.message || String(e) })),
        pocketApi.getStarHistory(memberId).catch(() => null),
      ]);
      if (requestId !== profileReqRef.current) return false;

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
      return !error;
    } catch (e: any) {
      if (requestId === profileReqRef.current) {
        setArchive({ data: null, history: [], error: e?.message || String(e) });
      }
      return false;
    } finally {
      if (requestId === profileReqRef.current) setLoading(false);
    }
  };

  const route = useRoute<any>();
  const members = useMemberStore((s) => s.members);
  const autoLoadedRef = useRef('');
  const routeParams = route?.params || {};
  const routeMemberId = String(routeParams.memberId || routeParams.member?.id || '').trim();
  const routeNonce = Number(routeParams.nonce) || 0;
  useEffect(() => {
    if (!routeMemberId) return;
    const key = `${routeMemberId}:${routeNonce}`;
    if (autoLoadedRef.current === key) return;
    const found = (members as any[]).find((m) =>
      [m?.id, m?.userId, m?.memberId].some((v) => String(v ?? '').trim() === routeMemberId),
    );

    const target = (found ||
      routeParams.member || {
        id: routeMemberId,
        ownerName: String(routeParams.memberName || routeMemberId),
        avatar: String(routeParams.memberAvatar || ''),
      }) as Member;

    void loadProfile(target).then((ok) => {
      if (ok) autoLoadedRef.current = key;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeMemberId, routeNonce, members]);

  const starInfo = archive.data?.starInfo || archive.data?.star || archive.data || {};
  const fanRanks = normalizeList(archive.data?.fansRank || archive.data?.rankList);
  const avatar = firstText(starInfo?.starAvatar, starInfo?.avatar, selectedMember?.avatar);
  const name = displayName(selectedMember, starInfo);
  const raw = selectedMember as any;

  const profile = { ...(raw || {}) } as Record<string, any>;
  for (const [key, value] of Object.entries(starInfo || {})) {
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      profile[key] = value;
    }
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <ScreenHeader title={t('成员档案')} />

      <FadeInView delay={80} duration={300}>
        <View style={styles.pickerWrap}>
          <MemberPicker
            compact
            selectedMember={selectedMember}
            onSelect={loadProfile}
            placeholder={t('搜索成员查看档案...')}
          />
        </View>

        {selectedMember ? (
          <GlassSurface
            radius={22}
            role="card"
            style={[styles.card, { backgroundColor: 'transparent', borderColor: palette.hairline }]}
          >
            <View style={styles.profileHead}>
              {avatar !== '-' ? (
                <NetworkImage
                  source={{ uri: avatar }}
                  style={[styles.avatar, { backgroundColor: palette.fill2 }]}
                  thumbnail={96}
                />
              ) : (
                <View style={[styles.avatarFallback, { backgroundColor: palette.tintSoft }]} />
              )}
              <View style={styles.profileTitleWrap}>
                <Text style={[styles.name, { color: palette.label }]} numberOfLines={1}>
                  {name}
                </Text>
                <Text style={[styles.subLine, { color: palette.labelSecondary }]} numberOfLines={1}>
                  {firstText(profile.groupName, selectedMember.groupName)} ·{' '}
                  {firstText(profile.teamName, profile.team, selectedMember.team)}
                </Text>
              </View>
              {/^\d+$/.test(followState.uid) ? (
                <ScalePressable
                  onPress={async () => {
                    if (followState.busy) return;
                    const uid = followState.uid;
                    const next = !followState.following;
                    setFollowState((prev) => ({ ...prev, busy: true }));
                    try {
                      if (next) await pocketApi.followMember(uid);
                      else await pocketApi.unfollowMember(uid);
                      setFollowState((prev) => ({ ...prev, following: next, busy: false }));
                      const cached = await readFollowedIdsCache(token).catch(() => ({ ids: [] }));
                      const nextIds = new Set(cached.ids.map(String));
                      if (next) nextIds.add(uid);
                      else nextIds.delete(uid);
                      void writeFollowedIdsCache(token, Array.from(nextIds));
                      showToast(
                        next ? t('已关注 {name}', { name }) : t('已取消关注 {name}', { name }),
                      );
                    } catch (err) {
                      setFollowState((prev) => ({ ...prev, busy: false }));
                      showToast(t('操作失败：{msg}', { msg: errorMessage(err) }));
                    }
                  }}
                  disabled={followState.busy}
                  pressedScale={0.94}
                  activeOpacity={0.85}
                  style={[
                    styles.followBtn,
                    {
                      backgroundColor: followState.following ? palette.fill2 : palette.tint,
                      opacity: followState.busy ? 0.6 : 1,
                    },
                  ]}
                >
                  <MaterialCommunityIcons
                    name={followState.following ? 'account-check' : 'account-plus'}
                    size={14}
                    color={followState.following ? palette.labelSecondary : palette.onTint}
                  />
                  <Text
                    style={[
                      styles.followBtnText,
                      { color: followState.following ? palette.labelSecondary : palette.onTint },
                    ]}
                  >
                    {followState.following ? t('已关注') : t('关注')}
                  </Text>
                </ScalePressable>
              ) : null}
            </View>

            {archive.error ? (
              <View
                style={[
                  styles.notice,
                  { backgroundColor: palette.fill2, borderLeftColor: palette.warning },
                ]}
              >
                <Text style={[styles.noticeTitle, { color: palette.tint }]}>
                  {t('在线档案暂不可用')}
                </Text>
                <Text style={[styles.noticeText, { color: palette.labelSecondary }]}>
                  {t('已显示本地成员库资料；需要口袋签名的排行和经历可能无法加载。')}
                </Text>
                <View style={styles.retryWrap}>
                  <Button
                    title={t('重试')}
                    variant="filled"
                    size="sm"
                    onPress={() => selectedMember && loadProfile(selectedMember)}
                    disabled={loading}
                    loading={loading}
                  />
                </View>
              </View>
            ) : null}

            <Text style={[styles.sectionTitle, { color: palette.tint }]}>{t('基本信息')}</Text>
            <View style={styles.infoGrid}>
              <InfoItem label={t('成员 ID')} value={firstText(selectedMember.id)} />
              <InfoItem label={t('拼音')} value={firstText(selectedMember.pinyin)} />

              {selectedMember.state && selectedMember.state !== 'unknown' ? (
                <InfoItem
                  label={t('状态')}
                  value={t(
                    {
                      active: '在团',
                      left: '退团',
                      graduated: '毕业',
                      paused: '暂休',
                    }[selectedMember.state] || '未知',
                  )}
                />
              ) : null}
              {profile.birthday ? (
                <InfoItem label={t('生日')} value={firstText(profile.birthday)} />
              ) : null}
              {profile.birthplace ? (
                <InfoItem label={t('出生地')} value={firstText(profile.birthplace)} />
              ) : null}
              {profile.constellation ? (
                <InfoItem label={t('星座')} value={firstText(profile.constellation)} />
              ) : null}
              {profile.height ? (
                <InfoItem label={t('身高')} value={`${profile.height} cm`} />
              ) : null}
              {profile.bloodType ? (
                <InfoItem label={t('血型')} value={t('{type}型', { type: profile.bloodType })} />
              ) : null}
              {profile.hobbies ? (
                <InfoItem label={t('爱好')} value={firstText(profile.hobbies)} />
              ) : null}
              {profile.specialty ? (
                <InfoItem label={t('特长')} value={firstText(profile.specialty)} />
              ) : null}
            </View>

            <Text style={[styles.sectionTitle, { color: palette.tint }]}>{t('生涯历程')}</Text>
            <View style={styles.infoGrid}>
              {profile.periodName ? (
                <InfoItem label={t('期数')} value={firstText(profile.periodName)} />
              ) : null}
              {profile.rank ? (
                <InfoItem label={t('最高排名')} value={firstText(profile.rank)} />
              ) : null}
              {profile.joinTime || profile.jtime ? (
                <InfoItem
                  label={t('加入时间')}
                  value={formatDateValue(profile.joinTime || profile.jtime)}
                />
              ) : null}
              {profile.promotionTime || profile.ptime ? (
                <InfoItem
                  label={t('升格时间')}
                  value={formatDateValue(profile.promotionTime || profile.ptime)}
                />
              ) : null}
              {profile.graduateTime || profile.gtime ? (
                <InfoItem
                  label={t('毕业时间')}
                  value={formatDateValue(profile.graduateTime || profile.gtime)}
                />
              ) : null}
              {profile.quitTime || profile.qtime ? (
                <InfoItem
                  label={t('退团时间')}
                  value={formatDateValue(profile.quitTime || profile.qtime)}
                />
              ) : null}
            </View>

            <Text style={[styles.sectionTitle, { color: palette.tint }]}>{t('技术参数')}</Text>
            <View style={styles.infoGrid}>
              <InfoItem label={t('大房间')} value={firstText(selectedMember.channelId)} />
              <InfoItem label={t('服务器')} value={firstText(selectedMember.serverId)} />
              {selectedMember.yklzId ? (
                <InfoItem label={t('小房间')} value={firstText(selectedMember.yklzId)} />
              ) : null}
              {selectedMember.roomId ? (
                <InfoItem label={t('房间ID')} value={firstText(selectedMember.roomId)} />
              ) : null}
              {selectedMember.liveRoomId ? (
                <InfoItem label={t('直播间')} value={firstText(selectedMember.liveRoomId)} />
              ) : null}
              {profile.wbName ? (
                <InfoItem label={t('微博')} value={firstText(profile.wbName)} />
              ) : null}
              {profile.wbUid ? (
                <InfoItem label={t('微博UID')} value={firstText(profile.wbUid)} />
              ) : null}
            </View>

            {profile.note ? (
              <View style={[styles.noteBox, { backgroundColor: palette.tintSoft }]}>
                <Text style={[styles.noteLabel, { color: palette.tint }]}>{t('备注')}</Text>
                <Text style={[styles.noteText, { color: palette.labelSecondary }]}>
                  {profile.note}
                </Text>
              </View>
            ) : null}

            {profile.fullPhoto1 ? (
              <View>
                <Text style={[styles.sectionTitle, { color: palette.tint }]}>{t('公式照')}</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  {['fullPhoto1', 'fullPhoto2', 'fullPhoto3', 'fullPhoto4']
                    .filter((k) => profile[k])
                    .map((k) => (
                      <NetworkImage
                        key={k}
                        source={{ uri: profile[k] }}
                        style={[styles.photoItem, { backgroundColor: palette.fill2 }]}
                        resizeMode="cover"
                        thumbnail={360}
                      />
                    ))}
                </ScrollView>
              </View>
            ) : null}
          </GlassSurface>
        ) : (
          <View style={styles.emptyCard}>
            <EmptyState
              icon="account-search-outline"
              title={t('暂无数据')}
              hint={t('搜索成员查看档案')}
            />
          </View>
        )}

        {fanRanks.length > 0 ? (
          <GlassSurface
            radius={22}
            role="card"
            style={[styles.card, { backgroundColor: 'transparent', borderColor: palette.hairline }]}
          >
            <Text style={[styles.sectionTitle, { color: palette.tint }]}>{t('粉丝排行')}</Text>
            {fanRanks.slice(0, 10).map((fan: any, index: number) => (
              <View
                key={`${fan.userId || fan.nickName || index}`}
                style={[styles.rankRow, { borderBottomColor: palette.innerStroke }]}
              >
                <Text style={[styles.rankNo, { color: palette.tint }]}>{index + 1}</Text>
                <Text style={[styles.rankName, { color: palette.label }]} numberOfLines={1}>
                  {firstText(fan.nickName, fan.nickname, fan.userName)}
                </Text>
                <Text
                  style={[styles.rankMeta, { color: palette.labelSecondary }]}
                  numberOfLines={1}
                >
                  {firstText(fan.userId, fan.level, fan.score)}
                </Text>
              </View>
            ))}
          </GlassSurface>
        ) : null}

        {archive.history.length > 0 ? (
          <GlassSurface
            radius={22}
            role="card"
            style={[styles.card, { backgroundColor: 'transparent', borderColor: palette.hairline }]}
          >
            <Text style={[styles.sectionTitle, { color: palette.tint }]}>{t('重要经历')}</Text>
            {archive.history.slice(0, 20).map((item: any, index: number) => (
              <View
                key={`${item.ctime || item.time || index}`}
                style={[styles.timelineRow, { borderBottomColor: palette.innerStroke }]}
              >
                <Text style={[styles.timelineTime, { color: palette.tint }]}>
                  {formatDate(item.ctime || item.time)}
                </Text>
                <Text style={[styles.timelineText, { color: palette.label }]}>
                  {firstText(item.content, item.title, item.eventName, item.desc)}
                </Text>
              </View>
            ))}
          </GlassSurface>
        ) : null}
      </FadeInView>
      {loading ? <CenterSpinner /> : null}
    </ScrollView>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  const palette = usePalette();
  return (
    <View style={[styles.infoItem, { backgroundColor: palette.fill2 }]}>
      <Text style={[styles.infoLabel, { color: palette.labelTertiary }]}>{label}</Text>
      <Text style={[styles.infoValue, { color: palette.label }]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  content: { paddingBottom: 36 },
  pickerWrap: { paddingHorizontal: 16, marginBottom: 10 },
  card: {
    marginHorizontal: 16,
    marginVertical: 4,
    padding: 14,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
  },
  emptyCard: { marginHorizontal: 16, marginVertical: 4, borderRadius: 22 },
  profileHead: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  avatar: { width: 68, height: 68, borderRadius: 36 },
  avatarFallback: {
    width: 68,
    height: 68,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileTitleWrap: { flex: 1, marginLeft: 14, minWidth: 0 },
  followBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    marginLeft: 8,
    flexShrink: 0,
  },
  followBtnText: { fontSize: 12, fontFamily: fontFamily.system, fontWeight: '700' },
  name: { fontSize: 22, fontFamily: fontFamily.system, fontWeight: '800' },
  subLine: { marginTop: 5, fontSize: 13 },
  notice: { padding: 12, borderRadius: 14, marginBottom: 14, borderLeftWidth: 3 },
  noticeTitle: { fontSize: 13, fontWeight: '700', marginBottom: 4 },
  noticeText: { fontSize: 12, fontFamily: fontFamily.system, lineHeight: 18 },
  retryWrap: { alignSelf: 'flex-start', marginTop: 10 },
  sectionTitle: { fontSize: 15, fontWeight: '800', marginBottom: 10, marginTop: 14 },
  infoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  infoItem: { width: '48.5%', padding: 10, borderRadius: 14 },
  infoLabel: { fontSize: 11, fontFamily: fontFamily.system, marginBottom: 4 },
  infoValue: { fontSize: 13, fontWeight: '600' },
  noteBox: { marginTop: 14, padding: 12, borderRadius: 14 },
  noteLabel: { fontSize: 11, fontWeight: '700', marginBottom: 4 },
  noteText: { fontSize: 13, fontFamily: fontFamily.system, lineHeight: 20 },
  photoItem: { width: 120, height: 160, borderRadius: 14, marginRight: 8 },
  rankRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rankNo: { width: 28, fontWeight: '800' },
  rankName: { flex: 1, fontSize: 14, fontFamily: fontFamily.system, fontWeight: '600' },
  rankMeta: { maxWidth: 96, fontSize: 12, textAlign: 'right' },
  timelineRow: { paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth },
  timelineTime: { fontSize: 12, fontWeight: '700', marginBottom: 4 },
  timelineText: { fontSize: 14, fontFamily: fontFamily.system, lineHeight: 20 },
});
