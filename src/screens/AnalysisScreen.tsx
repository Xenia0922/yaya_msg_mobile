import React, { useMemo, useState } from 'react';
import { PerfFlatList } from '../components/PerfFlatList';

import { Image, Linking, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Video from 'react-native-video';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/types';
import { Member } from '../types';
import MemberPicker from '../components/MemberPicker';
import ScreenHeader from '../components/ScreenHeader';
import { FadeInView } from '../components/Motion';
import { CenterSpinner } from '../components/Loaders';
import { Pill } from '../components/Pill';
import { useSettingsStore, useUiStore } from '../store';
import pocketApi from '../api/pocket48';
import { errorMessage, messagePayload, messageText, pickText, unwrapList } from '../utils/data';
import { formatTimestamp } from '../utils/format';
import { parseDurationSeconds } from '../utils/duration';
import { useAppTheme } from '../hooks/useAppTheme';
import { usePalette } from '../theme';
import { useI18n } from '../i18n';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';

type Nav = StackNavigationProp<RootStackParamList, 'AnalysisScreen'>;
type TabKey = 'room' | 'dates' | 'senders' | 'media' | 'flip';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'room', label: '房间概览' },
  { key: 'dates', label: '日期统计' },
  { key: 'senders', label: '发言排行' },
  { key: 'media', label: '媒体统计' },
  { key: 'flip', label: '翻牌统计' },
];

function msgTime(item: any) {
  return Number(item.msgTime || item.ctime || item.time || item.timestamp || item.createTime || 0);
}

function msgDate(item: any) {
  const time = msgTime(item);
  if (!time) return '';
  const d = new Date(time);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function parseJsonField(raw: any): any {
  if (!raw || typeof raw === 'object') return raw || {};
  if (typeof raw !== 'string') return {};
  try { return JSON.parse(raw); } catch {
    try { return JSON.parse(raw.replace(/:\s*([0-9]{15,})/g, ':"$1"')); } catch { return {}; }
  }
}

function senderName(item: any, unknownLabel = '未知用户') {
  const ext = parseJsonField(item?.extInfo || item?.ext);
  const body = parseJsonField(item?.bodys || item?.body);
  const paths = ['senderName', 'senderNickName', 'nickName', 'nickname', 'userName', 'name',
    'user.nickName', 'sender.nickName', 'userInfo.nickName'];
  for (const obj of [item, ext, body]) {
    if (!obj || typeof obj !== 'object') continue;
    for (const path of paths) {
      const v = pickText(obj, [path]);
      if (v) return v;
    }
  }
  return unknownLabel;
}

function senderId(item: any) {
  const ext = parseJsonField(item?.extInfo || item?.ext);
  const body = parseJsonField(item?.bodys || item?.body);
  const paths = ['senderId', 'senderUserId', 'fromUserId', 'userId', 'uid', 'account',
    'sender.userId', 'user.userId'];
  for (const obj of [item, ext, body]) {
    if (!obj || typeof obj !== 'object') continue;
    for (const path of paths) {
      const v = pickText(obj, [path]);
      if (v) return v;
    }
  }
  return '';
}

function isIdolMessage(item: any, member: Member | null) {
  if (!member) return false;
  const sid = senderId(item);
  if (!sid) return false;
  // Only compare against member's user IDs, not room IDs (serverId/channelId)
  const ownerIds = [member.id, (member as any).userId, (member as any).memberId]
    .map(String).filter(Boolean);
  return ownerIds.includes(String(sid));
}

function messageKey(item: any, index: number) {
  return String(item.messageId || item.msgId || item.id || `${msgTime(item)}-${senderId(item)}-${messageText(item)}-${index}`);
}

function isMedia(item: any, kind: 'image' | 'audio' | 'video') {
  const type = String(item.msgType || item.type || '').toUpperCase();
  const payload = messagePayload(item);
  const url = pickText(payload, ['url', 'imageUrl', 'audioUrl', 'videoUrl', 'message.url', 'msg.url']);
  if (kind === 'image') return type.includes('IMAGE') || /\.(jpe?g|png|webp|gif)(\?|$)/i.test(url);
  if (kind === 'audio') return type.includes('AUDIO') || type.includes('VOICE') || /\.(mp3|m4a|aac|amr|wav)(\?|$)/i.test(url);
  return type.includes('VIDEO') || /\.(mp4|mov|m4v|3gp|flv|m3u8)(\?|$)/i.test(url);
}

function countBy<T>(items: T[], keyOf: (item: T) => string, unknownLabel = '未知') {
  const map = new Map<string, { key: string; count: number; sample?: T }>();
  items.forEach((item) => {
    const key = keyOf(item) || unknownLabel;
    const old = map.get(key);
    map.set(key, { key, count: (old?.count || 0) + 1, sample: old?.sample || item });
  });
  return [...map.values()].sort((a, b) => b.count - a.count);
}

function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

export default function AnalysisScreen() {
  const navigation = useNavigation<Nav>();
  const isDark = useAppTheme();
  const palette = usePalette();
  const { t } = useI18n();
  const showToast = useUiStore((s) => s.showToast);
  const [member, setMember] = useState<Member | null>(null);
  const [tab, setTab] = useState<TabKey>('room');
  const [messages, setMessages] = useState<any[]>([]);
  const [flips, setFlips] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState(t('暂无数据'));
  const [loadError, setLoadError] = useState('');
  const [mediaFullUrl, setMediaFullUrl] = useState('');
  const [playMedia, setPlayMedia] = useState<{ url: string; type: string } | null>(null);
  const [flipPlayUrl, setFlipPlayUrl] = useState('');
  const [flipMemberFilter, setFlipMemberFilter] = useState('');

  const flipMemberNames = useMemo(() => {
    const set = new Set<string>();
    for (const item of flips) {
      const rec = item as Record<string, any>;
      set.add(pickText(rec, ['memberName', 'starName', 'baseUserInfo.nickname'], '成员'));
    }
    return ['全部成员', ...Array.from(set).sort()];
  }, [flips]);

  const summary = useMemo(() => {
    const total = messages.length;
    const idol = member ? messages.filter((item) => isIdolMessage(item, member)).length : 0;
    const fan = Math.max(0, total - idol);
    const images = messages.filter((item) => isMedia(item, 'image')).length;
    const audios = messages.filter((item) => isMedia(item, 'audio')).length;
    const videos = messages.filter((item) => isMedia(item, 'video')).length;
    const gifts = messages.filter((item) => String(item.msgType || '').toUpperCase().includes('GIFT')).length;
    return { total, idol, fan, images, audios, videos, gifts };
  }, [member, messages]);

  const dateStats = useMemo(() => {
    const map = new Map<string, { total: number; member: number }>();
    messages.forEach((item) => {
      const date = msgDate(item);
      if (!date) return;
      const entry = map.get(date) || { total: 0, member: 0 };
      entry.total++;
      if (member && String(senderId(item)) === String(member.id)) entry.member++;
      map.set(date, entry);
    });
    return [...map.entries()].map(([date, value]) => ({ date, ...value })).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 60);
  }, [member, messages]);

  const dateMax = Math.max(1, ...dateStats.map((d) => d.total));

  const senders = useMemo(() => countBy(messages, senderName, t('未知')).slice(0, 30), [messages, t]);
  // 成员排行前 8 名用于横向条形图；senders 已按 count 降序，maxCount 取首名
  const memberRankTop8 = useMemo(() => senders.slice(0, 8), [senders]);
  const sendersMax = memberRankTop8.length ? memberRankTop8[0].count : 1;
  const recent = useMemo(() => messages.slice().sort((a, b) => msgTime(b) - msgTime(a)).slice(0, 20), [messages]);
  // 媒体消息列表（避免每次渲染内联 filter 生成新引用导致全列表重渲染）
  const mediaMessages = useMemo(
    () => messages.filter((item) => isMedia(item, 'image') || isMedia(item, 'audio') || isMedia(item, 'video')),
    [messages],
  );

  const filteredFlips = useMemo(() => {
    if (!flipMemberFilter || flipMemberFilter === '全部成员') return flips;
    return flips.filter((item: any) => {
      const mn = pickText(item, ['memberName', 'starName', 'baseUserInfo.nickname'], '成员');
      return mn === flipMemberFilter;
    });
  }, [flips, flipMemberFilter]);

  const flipStats = useMemo(() => {
    let totalCost = 0;
    let durSum = 0;
    let answeredCount = 0;
    let minDur = Infinity;
    let maxDur = 0;
    let typeStats = { text: 0, audio: 0, video: 0 };
    const memberMap = new Map<string, any>();
    for (const item of filteredFlips) {
      const rec = item as Record<string, any>;
      const cost = Number(rec['cost']) || 0;
      totalCost += cost;
      const at = Number(rec['answerType']);
      if (at === 1) typeStats.text += 1;
      else if (at === 2) typeStats.audio += 1;
      else if (at === 3) typeStats.video += 1;
      const mn = pickText(rec, ['memberName', 'starName', 'baseUserInfo.nickname'], '成员');
      if (!memberMap.has(mn)) memberMap.set(mn, { name: mn, count: 0, cost: 0, durSum: 0, answeredCount: 0, minDur: Infinity, maxDur: 0, minCost: Infinity, maxCost: 0, typeCounts: { text: 0, audio: 0, video: 0 } });
      const m = memberMap.get(mn)!;
      m.count += 1;
      m.cost += cost;
      if (at === 1) m.typeCounts.text += 1;
      else if (at === 2) m.typeCounts.audio += 1;
      else if (at === 3) m.typeCounts.video += 1;
      if (cost > m.maxCost) m.maxCost = cost;
      if (cost < m.minCost) m.minCost = cost;
      if (rec['status'] === 2 && rec['qtime'] && rec['answerTime']) {
        const diff = Number(rec['answerTime']) - Number(rec['qtime']);
        if (diff > 0) {
          durSum += diff;
          answeredCount += 1;
          if (diff < minDur) minDur = diff;
          if (diff > maxDur) maxDur = diff;
          m.durSum += diff;
          m.answeredCount += 1;
          if (diff < m.minDur) m.minDur = diff;
          if (diff > m.maxDur) m.maxDur = diff;
        }
      }
    }
    const avgDur = answeredCount > 0 ? durSum / answeredCount : 0;
    const memberRank = [...memberMap.values()].sort((a, b) => b.cost - a.cost);
    const topCost = memberRank[0]?.cost || 1;
    return { totalCount: filteredFlips.length, totalCost, typeStats, avgDur, minDur: minDur === Infinity ? 0 : minDur, maxDur, answeredCount, memberRank, topCost };
  }, [filteredFlips]);

  // 翻牌类型分布小条形图的最大值
  const flipTypeMax = Math.max(1, flipStats.typeStats.text, flipStats.typeStats.audio, flipStats.typeStats.video);

  function formatDurationMs(ms: number): string {
    if (ms <= 0) return '-';
    const s = Math.floor(ms / 1000);
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (d > 0) return t('{d}天{h}小时{m}分', { d, h, m });
    if (h > 0) return t('{h}小时{m}分', { h, m });
    return t('{m}分', { m });
  }

  const loadRoomStats = async (nextMember: Member) => {
    setMember(nextMember);
    setLoading(true);
    setStatus('');
    setLoadError('');
    setMessages([]);
    try {
      let nextTime = 0;
      const collected: any[] = [];
      for (let page = 0; page < 20; page += 1) {
        const res = await pocketApi.getRoomMessages({
          channelId: String(nextMember.channelId || ''),
          serverId: String(nextMember.serverId || ''),
          nextTime,
          fetchAll: true,
          limit: 100,
        });
        const list = unwrapList(res, ['content.messageList', 'content.message', 'content.list', 'content.messages', 'data.messageList', 'data.message', 'messageList', 'message', 'list']);
        if (!list.length) break;
        collected.push(...list);
        const contentNext = Number(res?.content?.nextTime || res?.data?.nextTime || 0);
        nextTime = Number.isFinite(contentNext) && contentNext > 0 ? contentNext : 0;
        if (!nextTime) break;
      }
      const seen = new Set<string>();
      const unique = collected.filter((item, index) => {
        const key = messageKey(item, index);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      setMessages(unique);
      setStatus(unique.length ? t('已加载 {count} 条房间消息', { count: unique.length }) : t('没有可统计的房间消息'));
      showToast(unique.length ? t('已加载 {count} 条消息', { count: unique.length }) : t('无房间消息可统计'));
    } catch (error) {
      setMessages([]);
      setLoadError(errorMessage(error));
      setStatus(t('加载失败：{err}', { err: errorMessage(error) }));
      showToast(t('加载失败：{err}', { err: errorMessage(error) }));
    } finally {
      setLoading(false);
    }
  };

  const loadFlipStats = async () => {
    setLoading(true);
    try {
      // 循环拉取直到拉完，移除原先 [0,50,100,150] 的 200 条上限
      const collected: any[] = [];
      let begin = 0;
      let failed = false;
      for (let i = 0; i < 24; i++) {
        let res: any = null;
        try {
          res = await pocketApi.getFlipList(begin, 100);
        } catch {
          failed = true;
          break;
        }
        const list = res ? unwrapList(res, ['content.questions', 'content.list', 'content.data', 'data.questions', 'questions', 'list']) : [];
        if (!list.length) break;
        collected.push(...list);
        const next = Number((res as any)?.content?.next ?? (res as any)?.data?.next ?? 0);
        if (!next || next <= begin) break;
        begin = next;
      }
      setFlips(collected);
      if (failed) {
        setStatus(t('翻牌记录加载不完整：{err}', { err: t('中途请求失败，已显示已获取的部分') }));
        showToast(t('翻牌记录加载不完整'));
      } else {
        setStatus(collected.length ? t('已加载 {count} 条翻牌记录', { count: collected.length }) : t('暂无翻牌记录'));
        showToast(collected.length ? t('已加载 {count} 条翻牌', { count: collected.length }) : t('无翻牌记录'));
      }
    } catch (error) {
      setStatus(t('翻牌统计失败：{err}', { err: errorMessage(error) }));
    } finally {
      setLoading(false);
    }
  };

  const cards = [
    { label: '消息', value: summary.total },
    { label: '成员发言', value: summary.idol },
    { label: '粉丝发言', value: summary.fan },
    { label: '图片', value: summary.images },
    { label: '语音', value: summary.audios },
    { label: '视频', value: summary.videos },
    { label: '礼物', value: summary.gifts },
  ];

  const roomOverview = cards;

  return (
    <View style={[styles.container, isDark && styles.containerDark]}>
      <ScreenHeader title={t('数据统计')} right={
        <TouchableOpacity onPress={() => { setLoadError(''); setLoading(true); loadRoomStats(member!).finally(() => loadFlipStats().finally(() => setLoading(false))); }} disabled={!member || loading}>
          <Text style={[styles.refreshText, { color: palette.tint }, (!member || loading) && { opacity: 0.45 }]}>{t('刷新')}</Text>
        </TouchableOpacity>
      } />

      <View style={styles.pickerWrap}>
        <MemberPicker selectedMember={member} onSelect={loadRoomStats} />
        {loading ? (
          <CenterSpinner dark={isDark} text={t('加载中…')} />
        ) : (
          <>
            <Text style={[styles.statusText, { color: palette.labelSecondary }]}>{status}</Text>
            {loadError ? (
              <TouchableOpacity
                style={[styles.retryBtn, { backgroundColor: palette.tint }]}
                onPress={() => { setLoadError(''); loadRoomStats(member!).finally(() => loadFlipStats()); }}
              >
                <Text style={styles.retryBtnText}>{t('重试')}</Text>
              </TouchableOpacity>
            ) : null}
          </>
        )}
      </View>
      <View style={styles.tabsRow}>
        {TABS.map((item) => (
          <View key={item.key} style={styles.tabWrap}>
            <Pill
              label={t(item.label)}
              selected={tab === item.key}
              onPress={() => { setTab(item.key); if (item.key === 'flip' && !flips.length) loadFlipStats(); }}
              style={styles.tabPill}
            />
          </View>
        ))}
      </View>

      {tab === 'room' ? (
        <FadeInView delay={80} duration={300}>
          <ScrollView contentContainerStyle={styles.content}>
            <View style={[styles.summaryCard, { backgroundColor: palette.surface, borderColor: palette.hairline }]}>
              {chunk(roomOverview, 4).map((row, ri) => (
                <View key={ri} style={[styles.summaryRow, ri > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.hairline }]}>
                  {row.map((item) => (
                    <View key={item.label} style={styles.summaryCell}>
                      <Text style={[styles.summaryValue, { color: palette.tint }]}>{item.value}</Text>
                      <Text style={[styles.summaryLabel, { color: palette.labelSecondary }]}>{t(item.label)}</Text>
                    </View>
                  ))}
                  {row.length < 4 ? <View style={styles.summaryCell} /> : null}
                </View>
              ))}
            </View>

            {/* 成员排行 · 横向条形图（纯 View 宽度百分比，无图表依赖） */}
            <View style={[styles.rankCard, { backgroundColor: palette.surface, borderColor: palette.hairline }]}>
              <Text style={[styles.rankHeaderTitle, { color: palette.label }]}>{t('成员排行')}</Text>
              <Text style={[styles.rankHeaderSub, { color: palette.labelSecondary }]}>{t('按发言次数 Top {count}', { count: memberRankTop8.length })}</Text>
              {memberRankTop8.map((item, index) => {
                const pct = (item.count / sendersMax) * 100;
                return (
                  <View key={item.key} style={styles.rankRow}>
                    <Text style={[styles.rankRowName, { color: palette.label }]} numberOfLines={1}>{index + 1}. {item.key}</Text>
                    <View style={[styles.rankTrack, { backgroundColor: palette.fill2 }]}>
                      <View style={[styles.rankBar, { width: `${pct}%`, backgroundColor: palette.tint }]} />
                    </View>
                    <Text style={[styles.rankRowCount, { color: palette.labelTertiary }]}>{item.count}</Text>
                  </View>
                );
              })}
            </View>

            {recent.map((item, index) => (
              <View key={`${msgTime(item)}-${index}`} style={[styles.rowCard, { backgroundColor: palette.surface, borderColor: palette.hairline }]}>
                <View style={[styles.rowIcon, { backgroundColor: palette.tintSoft }]}>
                  <MaterialCommunityIcons name="message-text-outline" size={20} color={palette.tint} />
                </View>
                <View style={styles.rowBody}>
                  <Text style={[styles.rowTitle, { color: palette.label }]} numberOfLines={1}>{senderName(item, t('未知用户'))}</Text>
                  <Text style={[styles.rowSub, { color: palette.labelSecondary }]} numberOfLines={2}>{messageText(item)}</Text>
                </View>
                <Text style={[styles.rowMeta, { color: palette.labelTertiary }]}>{formatTimestamp(msgTime(item))}</Text>
              </View>
            ))}
          </ScrollView>
        </FadeInView>
      ) : null}

      {tab === 'dates' ? (
        <FadeInView delay={80} duration={300} style={{ flex: 1 }}>
          <PerfFlatList
            data={dateStats}
            keyExtractor={(item) => item.date}
            contentContainerStyle={styles.content}
            initialNumToRender={12}
            maxToRenderPerBatch={12}
            windowSize={7}
            removeClippedSubviews
            ListEmptyComponent={<Text style={[styles.empty, { color: palette.labelTertiary }]}>{t('暂无日期数据')}</Text>}
            renderItem={({ item, index }) => {
              const totalPct = (item.total / dateMax) * 100;
              const memberPct = (item.member / dateMax) * 100;
              return (
                <FadeInView delay={80 + index * 30} duration={300}>
                  <View style={[styles.rowCard, { backgroundColor: palette.surface, borderColor: palette.hairline }]}>
                    <View style={[styles.rowIcon, { backgroundColor: palette.tintSoft }]}>
                      <MaterialCommunityIcons name="calendar-month-outline" size={20} color={palette.tint} />
                    </View>
                    <View style={styles.dateHeader}>
                      <Text style={[styles.rowTitle, { color: palette.label }]}>{item.date}</Text>
                      <Text style={[styles.rowMeta, { color: palette.labelTertiary }]}>
                        <Text style={[styles.dateMember, { color: palette.tint }]}>{t('成员: {count}', { count: item.member })}</Text>{` | `}{t('总: {count}', { count: item.total })}
                      </Text>
                    </View>
                    <View style={[styles.barWrap, { backgroundColor: palette.fill2 }]}>
                      <View style={[styles.barFg, { width: `${totalPct}%`, backgroundColor: palette.tint, opacity: 0.25 }]} />
                      <View style={[styles.barFg2, { width: `${memberPct}%`, backgroundColor: palette.tint }]} />
                    </View>
                  </View>
                </FadeInView>
              );
            }}
          />
        </FadeInView>
      ) : null}

      {tab === 'senders' ? (
        <FadeInView delay={80} duration={300} style={{ flex: 1 }}>
          <PerfFlatList
            data={senders}
            keyExtractor={(item) => item.key}
            contentContainerStyle={styles.content}
            initialNumToRender={12}
            maxToRenderPerBatch={12}
            windowSize={7}
            removeClippedSubviews
            renderItem={({ item, index }) => (
              <FadeInView delay={80 + index * 30} duration={300}>
                <View style={[styles.rowCard, { backgroundColor: palette.surface, borderColor: palette.hairline }]}>
                  <View style={[styles.rowIcon, { backgroundColor: palette.tintSoft }]}>
                    <Text style={[styles.rankNo, { color: palette.tint }]}>{index + 1}</Text>
                  </View>
                  <View style={styles.rowBody}>
                    <Text style={[styles.rowTitle, { color: palette.label }]} numberOfLines={1}>{item.key}</Text>
                    <Text style={[styles.rowSub, { color: palette.labelSecondary }]} numberOfLines={1}>{t('发言 {count} 条', { count: item.count })}</Text>
                  </View>
                  <Text style={[styles.rankValue, { color: palette.tint }]}>{t('{count} 条', { count: item.count })}</Text>
                </View>
              </FadeInView>
            )}
          />
        </FadeInView>
      ) : null}

      {tab === 'media' ? (
        <FadeInView delay={80} duration={300} style={{ flex: 1 }}>
          <PerfFlatList
            data={mediaMessages}
            keyExtractor={(item, index) => `media-${index}`}
            contentContainerStyle={styles.content}
            initialNumToRender={12}
            maxToRenderPerBatch={12}
            windowSize={7}
            removeClippedSubviews
            ListHeaderComponent={
              <View style={[styles.summaryCard, { backgroundColor: palette.surface, borderColor: palette.hairline }]}>
                {chunk(cards.slice(3), 4).map((row, ri) => (
                  <View key={ri} style={[styles.summaryRow, ri > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.hairline }]}>
                    {row.map((item) => (
                      <View key={item.label} style={styles.summaryCell}>
                        <Text style={[styles.summaryValue, { color: palette.tint }]}>{item.value}</Text>
                        <Text style={[styles.summaryLabel, { color: palette.labelSecondary }]}>{t(item.label)}</Text>
                      </View>
                    ))}
                    {row.length < 4 ? <View style={styles.summaryCell} /> : null}
                  </View>
                ))}
              </View>
            }
            renderItem={({ item, index }) => {
              const isImg = isMedia(item, 'image');
              const isAud = isMedia(item, 'audio');
              const isVid = isMedia(item, 'video');
              const payload = messagePayload(item);
              const url = pickText(payload, ['url', 'imageUrl', 'audioUrl', 'videoUrl', 'message.url']);
              const dur = parseDurationSeconds(payload?.duration || payload?.time || payload?.second || payload?.audioTime || payload?.length || 0);
              const durStr = dur > 0 ? (dur < 60 ? `${Math.round(dur)}s` : `${Math.floor(dur/60)}:${String(Math.round(dur)%60).padStart(2,'0')}`) : '';
              const label = isImg ? t('图片') : isAud ? `${t('语音')}${durStr ? ` ${durStr}` : ''}` : `${t('视频')}${durStr ? ` ${durStr}` : ''}`;
              const mediaIcon = isVid ? 'video-outline' : isAud ? 'microphone-outline' : 'image-outline';
              return (
                <FadeInView delay={80 + index * 30} duration={300}>
                  <TouchableOpacity
                    style={[styles.rowCard, { backgroundColor: palette.surface, borderColor: palette.hairline }]}
                    activeOpacity={0.8}
                    onPress={() => {
                      if (url) {
                        if (isImg) setMediaFullUrl(url);
                        else setPlayMedia({ url, type: isAud ? 'audio' : 'video' });
                      }
                    }}
                  >
                    <View style={[styles.rowIcon, { backgroundColor: palette.tintSoft }]}>
                      <MaterialCommunityIcons name={mediaIcon as any} size={20} color={palette.tint} />
                    </View>
                    <View style={styles.rowBody}>
                      <Text style={[styles.rowTitle, { color: palette.label }]} numberOfLines={1}>{label} · {senderName(item, t('未知用户'))}</Text>
                      <Text style={[styles.rowSub, { color: palette.labelSecondary }]} numberOfLines={2}>
                        {messageText(item) || t('(无文字)')}
                      </Text>
                    </View>
                    <Text style={[styles.rowMeta, { color: palette.labelTertiary }]}>{formatTimestamp(msgTime(item))}</Text>
                  </TouchableOpacity>
                </FadeInView>
              );
            }}
          />
        </FadeInView>
      ) : null}

      {tab === 'flip' ? (
        <PerfFlatList
          data={filteredFlips}
          keyExtractor={(item, index) => String(item.questionId || item.id || item.answerId || index)}
          contentContainerStyle={styles.content}
          initialNumToRender={12}
          maxToRenderPerBatch={12}
          windowSize={7}
          removeClippedSubviews
          ListHeaderComponent={
            <View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.flipChipScroll}>
                <View style={styles.flipChipRow}>
                  {flipMemberNames.map((name: string) => (
                    <TouchableOpacity
                      key={name}
                      style={[styles.flipChip, { backgroundColor: flipMemberFilter === name ? palette.tint : palette.fill2 }]}
                      onPress={() => setFlipMemberFilter(name === '全部成员' ? '' : name)}
                    >
                      <Text style={[styles.flipChipText, { color: flipMemberFilter === name ? '#FFFFFF' : palette.labelSecondary }]}>{name === '全部成员' || name === '成员' ? t(name) : name}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>
              <View style={[styles.flipCardsCard, { backgroundColor: palette.surface, borderColor: palette.hairline }]}>
                <View style={[styles.flipCell, { borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: palette.hairline }]}>
                  <Text style={[styles.flipCardValue, { color: palette.tint }]}>{flipStats.totalCount}</Text>
                  <Text style={[styles.flipCardLabel, { color: palette.labelSecondary }]}>{t('总翻牌数')}</Text>
                </View>
                <View style={[styles.flipCell, { borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: palette.hairline }]}>
                  <Text style={[styles.flipCardValue, { color: palette.label }]}>{flipStats.totalCost}</Text>
                  <Text style={[styles.flipCardLabel, { color: palette.labelSecondary }]}>{t('总消耗(鸡腿)')}</Text>
                </View>
                <View style={[styles.flipCell, styles.flipCellBig]}>
                  <Text style={[styles.flipCardValue, { color: palette.label }]}>{formatDurationMs(flipStats.avgDur)}</Text>
                  <Text style={[styles.flipCardLabel, { color: palette.labelSecondary }]}>{t('平均耗时')}</Text>
                  {flipStats.minDur > 0 ? <Text style={[styles.flipCardRange, { color: palette.labelTertiary }]}>{formatDurationMs(flipStats.minDur)} ~ {formatDurationMs(flipStats.maxDur)}</Text> : null}
                </View>
              </View>
              <View style={[styles.typeCard, { backgroundColor: palette.surface, borderColor: palette.hairline }]}>
                <Text style={[styles.sectionSub, { color: palette.labelSecondary }]}>{t('回复类型分布')}</Text>
                {[
                  { key: 'text', label: t('文字'), count: flipStats.typeStats.text },
                  { key: 'audio', label: t('语音'), count: flipStats.typeStats.audio },
                  { key: 'video', label: t('视频'), count: flipStats.typeStats.video },
                ].map((row) => {
                  const tpct = (row.count / flipTypeMax) * 100;
                  return (
                    <View key={row.key} style={styles.rankRow}>
                      <Text style={[styles.rankRowName, { color: palette.label }]} numberOfLines={1}>{row.label}</Text>
                      <View style={[styles.rankTrack, { backgroundColor: palette.fill2 }]}>
                        <View style={[styles.rankBar, { width: `${tpct}%`, backgroundColor: palette.tint }]} />
                      </View>
                      <Text style={[styles.rankRowCount, { color: palette.labelTertiary }]}>{row.count}</Text>
                    </View>
                  );
                })}
              </View>
              <Text style={[styles.sectionSub, { color: palette.labelSecondary }]}>{t('成员排名 · {count} 人 · 共 {total} 条', { count: flipStats.memberRank.length, total: flipStats.totalCount })}</Text>
              {flipStats.memberRank.map((m, idx) => {
                const pct = (m.cost / flipStats.topCost) * 100;
                const avgPrice = m.count > 0 ? Math.round(m.cost / m.count) : 0;
                const avgTime = m.answeredCount > 0 ? formatDurationMs(m.durSum / m.answeredCount) : '';
                return (
                  <View key={m.name} style={[styles.flipMemberCard, { backgroundColor: palette.surface, borderColor: palette.hairline }]}>
                    <View style={styles.flipMemberHeader}>
                      <Text style={[styles.flipMemberName, { color: palette.label }]} numberOfLines={1}>{idx + 1}. {m.name}</Text>
                      <Text style={[styles.flipMemberCost, { color: palette.tint }]}>{t('{cost} 鸡腿', { cost: m.cost })}</Text>
                    </View>
                    <View style={[styles.flipBarBg, { backgroundColor: palette.fill2 }]}>
                      <View style={[styles.flipBarFg, { width: `${pct}%`, backgroundColor: palette.tint }]} />
                    </View>
                    <Text style={[styles.flipMemberMeta, { color: palette.labelSecondary }]}>
                      {t('共 {count} 条 · 文字{text} 语音{audio} 视频{video}', { count: m.count, text: m.typeCounts.text, audio: m.typeCounts.audio, video: m.typeCounts.video })}
                    </Text>
                    <Text style={[styles.flipMemberMeta, { color: palette.labelSecondary, marginTop: 2 }]}>
                      {t('均{avg}鸡腿 · 最高{max} · 最低{min}', { avg: avgPrice, max: m.maxCost, min: m.minCost === Infinity ? '-' : m.minCost })}
                    </Text>
                    {avgTime ? <Text style={[styles.flipMemberMeta, { color: palette.labelSecondary, marginTop: 2 }]}>{t('均耗时{time} · 最快{min} · 最慢{max}', { time: avgTime, min: formatDurationMs(m.minDur), max: formatDurationMs(m.maxDur) })}</Text> : null}
                  </View>
                );
              })}
              <Text style={[styles.statusText, { color: palette.labelSecondary, marginBottom: 8, marginTop: 6 }]}>{t('翻牌明细 · 共 {count} 条', { count: filteredFlips.length })}</Text>
            </View>
          }
          renderItem={({ item, index }) => {
            const flipAnswerType = Number(item.answerType);
            const isText = flipAnswerType === 1;
            const isVoice = flipAnswerType === 2;
            const isVideo = flipAnswerType === 3;
            const answerRaw = pickText(item, ['answerContent', 'answer', 'answerText', 'replyContent'], '');
            let answerText = '';
            let answerUrl = '';
            let answerDuration = 0;
            if (answerRaw) {
              try { const j = JSON.parse(answerRaw); answerText = j?.text || j?.content || ''; answerUrl = (isVoice || isVideo) ? (j?.url || j?.mediaUrl || '') : ''; answerDuration = parseDurationSeconds(j?.duration || j?.time || j?.second || j?.audioTime || j?.length || 0); } catch { answerText = answerRaw; }
            }
            const qTime = Number(item.qtime || item.createTime || 0);
            const aTime = Number(item.answerTime || 0);
            const elapsed = aTime && qTime ? aTime - qTime : 0;
            const d = Math.floor(elapsed / 86400000);
            const h = Math.floor((elapsed % 86400000) / 3600000);
            const m = Math.floor((elapsed % 3600000) / 60000);
            const elapsedStr = elapsed > 0
              ? `${d ? t('{m}天', { m: d }) : ''}${h ? t('{m}小时', { m: h }) : ''}${t('{m}分', { m })}`
              : '';
            const isAnswered = item.status === 2;
            const deadline = qTime ? qTime + 7 * 86400000 : 0;
            const remaining = isAnswered ? 0 : (deadline - Date.now());
            const rd = Math.floor(remaining / 86400000);
            const rh = Math.floor((remaining % 86400000) / 3600000);
            const rm = Math.floor((remaining % 3600000) / 60000);
            const remainStr = remaining > 0 && !isAnswered
              ? `${rd ? t('{m}天', { m: rd }) : ''}${rh ? t('{m}小时', { m: rh }) : ''}${t('{m}分', { m: rm })}`
              : (!isAnswered && remaining <= 0 ? t('已过期') : '');
            return (
              <FadeInView delay={80 + index * 30} duration={300}>
                <View style={[styles.rowCard, { backgroundColor: palette.surface, borderColor: palette.hairline }]}>
                  <View style={[styles.rowIcon, { backgroundColor: palette.tintSoft }]}>
                    <MaterialCommunityIcons
                      name={isVideo ? 'video-outline' : isVoice ? 'microphone-outline' : 'text-box-outline'}
                      size={20}
                      color={palette.tint}
                    />
                  </View>
                  <View style={styles.rowBody}>
                    <View style={styles.flipHeader}>
                      <Text style={[styles.rowTitle, { color: palette.label }]} numberOfLines={1}>
                        {pickText(item, ['memberName', 'starName', 'baseUserInfo.nickname'], t('成员'))}
                      </Text>
                      <Text style={[styles.rowMeta, { color: palette.labelTertiary }]}>{formatTimestamp(qTime)}</Text>
                    </View>
                    <Text style={[styles.flipQ, { color: palette.labelSecondary }]} numberOfLines={10}>{t('问：{text}', { text: pickText(item, ['content', 'questionContent', 'question', 'text'], '') || t('无提问内容') })}</Text>
                    {isAnswered && isText ? (
                      <Text style={[styles.flipAText, { color: palette.labelSecondary }]} numberOfLines={20}>
                        {t('答：{text}', { text: answerText || t('已翻牌') })}
                      </Text>
                    ) : isAnswered && (isVoice || isVideo) ? (
                      <View style={[styles.flipABlock, { backgroundColor: palette.fill2 }]}>
                        <Text style={[styles.flipA, { color: palette.labelSecondary }]} numberOfLines={20}>
                          {t('答：{text}', { text: answerText || (isVoice ? t('[语音回复]') : t('[视频回复]')) })}
                        </Text>
                        {answerUrl ? (
                          <TouchableOpacity style={[styles.flipPlayBtn, { backgroundColor: palette.tint }]} onPress={() => setFlipPlayUrl((prev) => prev === answerUrl ? '' : answerUrl)}>
                            <MaterialCommunityIcons name={flipPlayUrl === answerUrl ? 'chevron-up' : 'play'} size={14} color="#FFFFFF" />
                            <Text style={[styles.flipPlayText, { color: '#FFFFFF' }]}>{flipPlayUrl === answerUrl ? t('收起') : `${answerDuration > 0 ? (answerDuration < 60 ? `${answerDuration}s` : `${Math.floor(answerDuration / 60)}:${String(answerDuration % 60).padStart(2, '0')}`) : (isVoice ? t('语音') : t('视频'))}`}</Text>
                          </TouchableOpacity>
                        ) : null}
                        {flipPlayUrl === answerUrl && answerUrl ? (
                          <Video source={{ uri: answerUrl }} style={isVoice ? styles.flipAudio : styles.flipVideo} controls paused={false} resizeMode="contain" ignoreSilentSwitch="ignore" />
                        ) : null}
                      </View>
                    ) : !isAnswered ? (
                      <Text style={[styles.flipPending, { color: palette.tint }]}>{item.status === 1 ? t('等待回复中') : item.status === 3 ? t('已退款') : t('等待回复中')}</Text>
                    ) : null}
                    <View style={styles.flipMeta}>
                      <Text style={[styles.flipTag, { backgroundColor: palette.tintSoft, color: palette.tint }]}>{isText ? t('文字') : isVoice ? t('语音') : isVideo ? t('视频') : t('未知')}</Text>
                      <Text style={[styles.flipPrivacy, { color: palette.labelTertiary }]}>{item.type === 1 ? t('公开') : item.type === 2 ? t('私密') : item.type === 3 ? t('匿名') : t('未知')}</Text>
                      <Text style={[styles.flipCost, { color: palette.labelSecondary }]}>{t('{cost} 鸡腿', { cost: item.cost || 0 })}</Text>
                      {elapsedStr ? <Text style={[styles.flipElapsed, { color: palette.tint }]}>{t('耗时 {time}', { time: elapsedStr })}</Text> : null}
                      {remainStr ? <Text style={[styles.flipRemain, { color: palette.tint }]}>{t('剩 {time}', { time: remainStr })}</Text> : null}
                    </View>
                  </View>
                </View>
              </FadeInView>
            );
          }}
        />
      ) : null}
      {mediaFullUrl ? (
        <Modal visible transparent animationType="fade" onRequestClose={() => setMediaFullUrl('')}>
          <TouchableOpacity style={styles.imgModal} activeOpacity={1} onPress={() => setMediaFullUrl('')}>
            <Image source={{ uri: mediaFullUrl }} style={styles.imgFull} resizeMode="contain" />
          </TouchableOpacity>
        </Modal>
      ) : null}
      {playMedia ? (
        <Modal visible transparent animationType="slide" onRequestClose={() => setPlayMedia(null)}>
          <View style={styles.videoModal}>
            <TouchableOpacity onPress={() => setPlayMedia(null)} style={styles.videoClose}>
              <Text style={styles.videoCloseText}>{t('关闭')}</Text>
            </TouchableOpacity>
            <Video
              source={{ uri: playMedia.url, headers: { 'User-Agent': 'PocketFans201807/7.0.41 (iPhone; iOS 16.3.1; Scale/2.00)', Referer: 'https://h5.48.cn/' } }}
              style={styles.videoPlayer}
              controls
              resizeMode="contain"
              paused={false}
              ignoreSilentSwitch="ignore"
            />
          </View>
        </Modal>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  containerDark: { backgroundColor: 'transparent' },
  pickerWrap: { paddingHorizontal: 16 },
  refreshText: { fontSize: 14, minWidth: 54, textAlign: 'right', fontWeight: '700' },
  statusText: { marginTop: 8, fontSize: 12 },
  retryBtn: {
    alignSelf: 'center',
    marginTop: 10,
    paddingHorizontal: 22,
    paddingVertical: 8,
    borderRadius: 16,
  },
  retryBtnText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
  tabsRow: { flexDirection: 'row', gap: 6, paddingHorizontal: 16, paddingVertical: 10 },
  tabWrap: { flex: 1 },
  tabPill: { alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center' },
  content: { padding: 14, paddingBottom: 112 },
  summaryCard: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden', marginBottom: 12 },
  summaryRow: { flexDirection: 'row', paddingVertical: 14, paddingHorizontal: 6 },
  summaryCell: { flex: 1, alignItems: 'center' },
  summaryValue: { fontSize: 18, fontWeight: '900' },
  summaryLabel: { fontSize: 11, marginTop: 4 },
  rowCard: {
    flexDirection: 'row', alignItems: 'center', padding: 12, marginBottom: 5,
    borderRadius: 16, borderWidth: StyleSheet.hairlineWidth,
  },
  rowIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  rowBody: { flex: 1, minWidth: 0, paddingRight: 8 },
  rowTitle: { fontSize: 14, fontWeight: '700' },
  rowSub: { fontSize: 12, marginTop: 3, lineHeight: 17 },
  rowMeta: { fontSize: 11 },
  rankNo: { fontSize: 18, fontWeight: '900' },
  rankValue: { fontSize: 13, fontWeight: '800' },
  dateHeader: { flex: 1, minWidth: 0 },
  dateMember: { fontWeight: '700' },
  barWrap: { position: 'relative', height: 6, borderRadius: 3, overflow: 'hidden', marginTop: 8 },
  barFg: { position: 'absolute', top: 0, left: 0, height: '100%', borderRadius: 3 },
  barFg2: { position: 'absolute', top: 0, left: 0, height: '100%', borderRadius: 3 },
  rankCard: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, padding: 14, marginBottom: 12 },
  rankHeaderTitle: { fontSize: 15, fontWeight: '700' },
  rankHeaderSub: { fontSize: 11, marginTop: 3, marginBottom: 6 },
  rankRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 5 },
  rankRowName: { fontSize: 13, fontWeight: '700', width: 72, marginRight: 8 },
  rankTrack: { flex: 1, height: 10, borderRadius: 3, overflow: 'hidden', backgroundColor: 'transparent' },
  rankBar: { height: 10, borderRadius: 3 },
  rankRowCount: { fontSize: 11, width: 28, textAlign: 'right', marginLeft: 8 },
  typeCard: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, padding: 14, marginBottom: 12 },
  empty: { textAlign: 'center', marginTop: 60, fontSize: 14 },
  flipHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  flipQ: { fontSize: 13, lineHeight: 20, marginBottom: 6 },
  flipABlock: { padding: 8, borderRadius: 12, marginBottom: 6 },
  flipA: { fontSize: 13, lineHeight: 20 },
  flipAText: { fontSize: 13, lineHeight: 20, marginBottom: 4 },
  flipPending: { fontSize: 12, fontWeight: '700' },
  flipMeta: { flexDirection: 'row', gap: 8, marginTop: 4, flexWrap: 'wrap' },
  flipTag: { fontSize: 10, fontWeight: '800', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  flipPrivacy: { fontSize: 10, fontWeight: '700' },
  flipCost: { fontSize: 10 },
  flipElapsed: { fontSize: 10, fontWeight: '700' },
  flipRemain: { fontSize: 10, fontWeight: '700' },
  flipPlayBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', marginTop: 8, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18 },
  flipPlayText: { fontSize: 12, fontWeight: '800' },
  flipAudio: { height: 52, marginTop: 8, backgroundColor: 'rgba(0,0,0,0.06)', borderRadius: 10 },
  flipVideo: { height: 150, marginTop: 8, backgroundColor: '#000', borderRadius: 10 },
  imgModal: { flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', alignItems: 'center', justifyContent: 'center' },
  imgFull: { width: '96%', height: '80%' },
  videoModal: { flex: 1, backgroundColor: '#000' },
  videoClose: { paddingTop: 50, paddingHorizontal: 16, paddingBottom: 8, alignSelf: 'flex-start' },
  videoCloseText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  videoPlayer: { flex: 1, backgroundColor: '#000' },
  flipCardsCard: { flexDirection: 'row', paddingVertical: 16, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, marginBottom: 12 },
  flipCell: { flex: 1, alignItems: 'center', paddingVertical: 4, paddingHorizontal: 4 },
  flipCellBig: { flex: 1.4 },
  flipCardValue: { fontSize: 18, fontWeight: '900' },
  flipCardLabel: { fontSize: 11, marginTop: 4 },
  flipCardRange: { fontSize: 10, marginTop: 2 },
  sectionSub: { fontSize: 12, fontWeight: '700', marginBottom: 8 },
  flipMemberCard: { padding: 12, borderRadius: 12, marginBottom: 6, borderWidth: StyleSheet.hairlineWidth },
  flipMemberHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  flipMemberName: { fontSize: 13, fontWeight: '700', flex: 1 },
  flipMemberCost: { fontSize: 12, fontWeight: '800' },
  flipBarBg: { height: 4, borderRadius: 2, marginBottom: 4 },
  flipBarFg: { height: 4, borderRadius: 2 },
  flipMemberMeta: { fontSize: 10, lineHeight: 16 },
  flipChipScroll: { marginBottom: 10, marginTop: 4 },
  flipChipRow: { flexDirection: 'row', gap: 6, paddingHorizontal: 14 },
  flipChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14 },
  flipChipText: { fontSize: 11, fontWeight: '600' },
});
