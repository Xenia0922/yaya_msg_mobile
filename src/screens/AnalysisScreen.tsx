import React, { useMemo, useState } from 'react';
import { FlatList, Image, Linking, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Video from 'react-native-video';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/types';
import { Member } from '../types';
import MemberPicker from '../components/MemberPicker';
import { FadeInView } from '../components/Motion';
import { useSettingsStore, useUiStore } from '../store';
import pocketApi from '../api/pocket48';
import { errorMessage, messagePayload, messageText, pickText, unwrapList } from '../utils/data';
import { formatTimestamp } from '../utils/format';

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

function senderName(item: any) {
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
  return '未知用户';
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
  const ownerIds = [member.id, (member as any).userId, (member as any).memberId, member.serverId, member.channelId]
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

function countBy<T>(items: T[], keyOf: (item: T) => string) {
  const map = new Map<string, { key: string; count: number; sample?: T }>();
  items.forEach((item) => {
    const key = keyOf(item) || '未知';
    const old = map.get(key);
    map.set(key, { key, count: (old?.count || 0) + 1, sample: old?.sample || item });
  });
  return [...map.values()].sort((a, b) => b.count - a.count);
}

export default function AnalysisScreen() {
  const navigation = useNavigation<Nav>();
  const isDark = useSettingsStore((s) => s.settings.theme === 'dark');
  const showToast = useUiStore((s) => s.showToast);
  const [member, setMember] = useState<Member | null>(null);
  const [tab, setTab] = useState<TabKey>('room');
  const [messages, setMessages] = useState<any[]>([]);
  const [flips, setFlips] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('暂无数据');
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

  const senders = useMemo(() => countBy(messages, senderName).slice(0, 30), [messages]);
  const recent = useMemo(() => messages.slice().sort((a, b) => msgTime(b) - msgTime(a)).slice(0, 20), [messages]);

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

  function formatDurationMs(ms: number): string {
    if (ms <= 0) return '-';
    const s = Math.floor(ms / 1000);
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (d > 0) return `${d}天${h}小时${m}分`;
    if (h > 0) return `${h}小时${m}分`;
    return `${m}分`;
  }

  const loadRoomStats = async (nextMember: Member) => {
    setMember(nextMember);
    setLoading(true);
    setStatus('加载中...统计数据...');
    setMessages([]);
    try {
      let nextTime = 0;
      const collected: any[] = [];
      for (let page = 0; page < 5; page += 1) {
        const res = await pocketApi.getRoomMessages({
          channelId: String(nextMember.channelId || ''),
          serverId: String(nextMember.serverId || ''),
          nextTime,
          fetchAll: true,
          limit: 50,
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
      setStatus(unique.length ? `已加载 ${unique.length} 条房间消息` : '没有可统计的房间消息');
      showToast(unique.length ? `已加载 ${unique.length} 条消息` : '无房间消息可统计');
    } catch (error) {
      setMessages([]);
      setStatus(`加载失败：${errorMessage(error)}`);
      showToast(`加载失败：${errorMessage(error)}`);
    } finally {
      setLoading(false);
    }
  };

  const loadFlipStats = async () => {
    setLoading(true);
    setStatus('加载中...翻牌统计...');
    try {
      const pages = await Promise.all([0, 50, 100, 150].map((begin) => pocketApi.getFlipList(begin, 50).catch(() => null)));
      const list = pages.flatMap((res) => unwrapList(res, ['content.questions', 'content.list', 'content.data', 'data.questions', 'questions', 'list']));
      setFlips(list);
      setStatus(list.length ? `已加载 ${list.length} 条翻牌记录` : '暂无翻牌记录');
      showToast(list.length ? `已加载 ${list.length} 条翻牌` : '无翻牌记录');
    } catch (error) {
      setStatus(`翻牌统计失败：${errorMessage(error)}`);
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

  return (
    <View style={[styles.container, isDark && styles.containerDark]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}><Text style={styles.backBtn}>返回</Text></TouchableOpacity>
        <Text style={[styles.title, isDark && styles.textLight]}>数据统计</Text>
        <TouchableOpacity onPress={() => { setLoading(true); loadRoomStats(member!).finally(() => loadFlipStats().finally(() => setLoading(false))); }} disabled={!member || loading}>
          <Text style={[styles.refreshText, (!member || loading) && { opacity: 0.45 }]}>刷新</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.pickerWrap}>
        <MemberPicker selectedMember={member} onSelect={loadRoomStats} />
        <Text style={[styles.statusText, isDark && styles.textSubLight]}>{loading ? '加载中...' : status}</Text>
      </View>

      <View style={styles.tabs}>
        {TABS.map((item) => (
          <TouchableOpacity key={item.key} style={[styles.tab, tab === item.key && styles.tabActive]} onPress={() => { setTab(item.key); if (item.key === 'flip' && !flips.length) loadFlipStats(); }}>
            <Text style={[styles.tabText, tab === item.key && styles.tabTextActive, isDark && tab !== item.key && styles.textSubLight]} numberOfLines={1}>{item.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {tab === 'room' ? (
        <FadeInView delay={80} duration={300}>
          <ScrollView contentContainerStyle={styles.content}>
            <View style={styles.summaryGrid}>
              {cards.map((item) => (
                <View key={item.label} style={[styles.summaryCard, isDark && styles.cardDark]}>
                  <Text style={styles.summaryValue}>{item.value}</Text>
                  <Text style={[styles.summaryLabel, isDark && styles.textSubLight]}>{item.label}</Text>
                </View>
              ))}
            </View>
            {recent.map((item, index) => (
              <View key={`${msgTime(item)}-${index}`} style={[styles.rowCard, isDark && styles.cardDark]}>
                <Text style={[styles.rowTitle, isDark && styles.textLight]}>{senderName(item)}</Text>
                <Text style={[styles.rowText, isDark && styles.textSubLight]} numberOfLines={3}>{messageText(item)}</Text>
                <Text style={styles.rowMeta}>{formatTimestamp(msgTime(item))}</Text>
              </View>
            ))}
          </ScrollView>
        </FadeInView>
      ) : null}

      {tab === 'dates' ? (
        <FadeInView delay={80} duration={300} style={{ flex: 1 }}>
          <FlatList
            data={dateStats}
            keyExtractor={(item) => item.date}
            contentContainerStyle={styles.content}
            ListEmptyComponent={<Text style={[styles.empty, isDark && styles.textSubLight]}>暂无日期数据</Text>}
            renderItem={({ item, index }) => {
              const totalPct = (item.total / dateMax) * 100;
              const memberPct = (item.member / dateMax) * 100;
              return (
                <FadeInView delay={80 + index * 30} duration={300}>
                  <View style={[styles.dateRow, isDark && styles.cardDark]}>
                    <View style={styles.dateHeader}>
                      <Text style={[styles.dateTitle, isDark && styles.textLight]}>{item.date}</Text>
                      <Text style={styles.dateMeta}>
                        <Text style={styles.dateMember}>成员: {item.member}</Text> | 总: {item.total}
                      </Text>
                    </View>
                    <View style={styles.barWrap}>
                      <View style={[styles.barBg, { width: `${totalPct}%`, opacity: 0.25 }]} />
                      <View style={[styles.barFg, { width: `${memberPct}%` }]} />
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
          <FlatList
            data={senders}
            keyExtractor={(item) => item.key}
            contentContainerStyle={styles.content}
            renderItem={({ item, index }) => (
              <FadeInView delay={80 + index * 30} duration={300}>
                <View style={[styles.rankRow, isDark && styles.cardDark]}>
                  <Text style={styles.rankNo}>{index + 1}</Text>
                  <Text style={[styles.rankName, isDark && styles.textLight]}>{item.key}</Text>
                  <Text style={styles.rankValue}>{item.count} 条</Text>
                </View>
              </FadeInView>
            )}
          />
        </FadeInView>
      ) : null}

      {tab === 'media' ? (
        <FadeInView delay={80} duration={300} style={{ flex: 1 }}>
          <FlatList
            data={messages.filter((item) => isMedia(item, 'image') || isMedia(item, 'audio') || isMedia(item, 'video'))}
            keyExtractor={(item, index) => `media-${index}`}
            contentContainerStyle={styles.content}
            ListHeaderComponent={
              <View style={styles.summaryGrid}>
                {cards.slice(3).map((item) => (
                  <View key={item.label} style={[styles.summaryCard, isDark && styles.cardDark]}>
                    <Text style={styles.summaryValue}>{item.value}</Text>
                    <Text style={[styles.summaryLabel, isDark && styles.textSubLight]}>{item.label}</Text>
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
              const dur = Number(payload?.duration || payload?.time || payload?.second || payload?.audioTime || payload?.length || 0);
              const durStr = dur > 0 ? (dur < 60 ? `${Math.round(dur)}s` : `${Math.floor(dur/60)}:${String(Math.round(dur)%60).padStart(2,'0')}`) : '';
              const label = isImg ? '图片' : isAud ? `语音${durStr ? ` ${durStr}` : ''}` : `视频${durStr ? ` ${durStr}` : ''}`;
              return (
                <FadeInView delay={80 + index * 30} duration={300}>
                  <TouchableOpacity
                    style={[styles.rowCard, isDark && styles.cardDark]}
                    activeOpacity={0.8}
                    onPress={() => {
                      if (url) {
                        if (isImg) setMediaFullUrl(url);
                        else setPlayMedia({ url, type: isAud ? 'audio' : 'video' });
                      }
                    }}
                  >
                    <Text style={[styles.rowTitle, isDark && styles.textLight]}>▶ {label} · {senderName(item)}</Text>
                    <Text style={[styles.rowText, isDark && styles.textSubLight]} numberOfLines={2}>
                      {messageText(item) || '(无文字)'}
                    </Text>
                    <Text style={styles.rowMeta}>{formatTimestamp(msgTime(item))}</Text>
                  </TouchableOpacity>
                </FadeInView>
              );
            }}
          />
        </FadeInView>
      ) : null}

      {tab === 'flip' ? (
        <FlatList
          data={filteredFlips}
          keyExtractor={(item, index) => String(item.questionId || item.id || item.answerId || index)}
          contentContainerStyle={styles.content}
          ListHeaderComponent={
            <View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10, marginTop: 4 }}>
                <View style={{ flexDirection: 'row', gap: 6, paddingHorizontal: 14 }}>
                  {flipMemberNames.map((name: string) => (
                    <TouchableOpacity
                      key={name}
                      style={[styles.flipChip, flipMemberFilter === name && styles.flipChipActive, isDark && styles.flipChipDark]}
                      onPress={() => setFlipMemberFilter(name === '全部成员' ? '' : name)}
                    >
                      <Text style={[styles.flipChipText, flipMemberFilter === name && styles.flipChipTextActive]}>{name}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>
              <View style={[styles.flipCardsRow, isDark && styles.cardDark]}>
                <View style={styles.flipCard}>
                  <Text style={styles.flipCardValue}>{flipStats.totalCount}</Text>
                  <Text style={[styles.flipCardLabel, isDark && styles.textSubLight]}>总翻牌数</Text>
                </View>
                <View style={[styles.flipCardBorder, isDark && styles.flipCardBorderDark]} />
                <View style={styles.flipCard}>
                  <Text style={[styles.flipCardValue, { color: '#fa8c16' }]}>{flipStats.totalCost}</Text>
                  <Text style={[styles.flipCardLabel, isDark && styles.textSubLight]}>总消耗(鸡腿)</Text>
                </View>
                <View style={[styles.flipCardBorder, isDark && styles.flipCardBorderDark]} />
                <View style={styles.flipCardBig}>
                  <Text style={[styles.flipCardValue, { color: '#722ed1' }]}>{formatDurationMs(flipStats.avgDur)}</Text>
                  <Text style={[styles.flipCardLabel, isDark && styles.textSubLight]}>平均耗时</Text>
                  {flipStats.minDur > 0 ? <Text style={styles.flipCardRange}>{formatDurationMs(flipStats.minDur)} ~ {formatDurationMs(flipStats.maxDur)}</Text> : null}
                </View>
              </View>
              <View style={styles.flipTypeRow}>
                <Text style={[styles.flipTypePill, { backgroundColor: 'rgba(24,144,255,0.12)', color: '#1890ff' }]}>文字 {flipStats.typeStats.text}</Text>
                <Text style={[styles.flipTypePill, { backgroundColor: 'rgba(114,46,209,0.12)', color: '#722ed1' }]}>语音 {flipStats.typeStats.audio}</Text>
                <Text style={[styles.flipTypePill, { backgroundColor: 'rgba(235,47,150,0.12)', color: '#eb2f96' }]}>视频 {flipStats.typeStats.video}</Text>
              </View>
              <Text style={[styles.sectionSub, isDark && styles.textSubLight]}>成员排名 · {flipStats.memberRank.length} 人 · 共 {flipStats.totalCount} 条</Text>
              {flipStats.memberRank.map((m, idx) => {
                const pct = (m.cost / flipStats.topCost) * 100;
                const avgPrice = m.count > 0 ? Math.round(m.cost / m.count) : 0;
                const avgTime = m.answeredCount > 0 ? formatDurationMs(m.durSum / m.answeredCount) : '';
                return (
                  <View key={m.name} style={[styles.flipMemberCard, isDark && styles.cardDark]}>
                    <View style={styles.flipMemberHeader}>
                      <Text style={[styles.flipMemberName, isDark && styles.textLight]} numberOfLines={1}>{idx + 1}. {m.name}</Text>
                      <Text style={styles.flipMemberCost}>{m.cost} 鸡腿</Text>
                    </View>
                    <View style={styles.flipBarBg}>
                      <View style={[styles.flipBarFg, { width: `${pct}%` }]} />
                    </View>
                    <Text style={[styles.flipMemberMeta, isDark && styles.textSubLight]}>
                      共 {m.count} 条 · 文字{m.typeCounts.text} 语音{m.typeCounts.audio} 视频{m.typeCounts.video}
                    </Text>
                    <Text style={[styles.flipMemberMeta, isDark && styles.textSubLight, { marginTop: 2 }]}>
                      均{avgPrice}鸡腿 · 最高{m.maxCost} · 最低{m.minCost === Infinity ? '-' : m.minCost}
                    </Text>
                    {avgTime ? <Text style={[styles.flipMemberMeta, isDark && styles.textSubLight, { marginTop: 2 }]}>均耗时{avgTime} · 最快{formatDurationMs(m.minDur)} · 最慢{formatDurationMs(m.maxDur)}</Text> : null}
                  </View>
                );
              })}
              <Text style={[styles.statusText, isDark && styles.textSubLight, { marginBottom: 8, marginTop: 6 }]}>翻牌明细 · 共 {filteredFlips.length} 条</Text>
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
              try { const j = JSON.parse(answerRaw); answerText = j?.text || j?.content || ''; answerUrl = (isVoice || isVideo) ? (j?.url || j?.mediaUrl || '') : ''; answerDuration = Number(j?.duration || j?.time || j?.second || j?.audioTime || j?.length || 0); } catch { answerText = answerRaw; }
            }
            const qTime = Number(item.qtime || item.createTime || 0);
            const aTime = Number(item.answerTime || 0);
            const elapsed = aTime && qTime ? aTime - qTime : 0;
            const d = Math.floor(elapsed / 86400000);
            const h = Math.floor((elapsed % 86400000) / 3600000);
            const m = Math.floor((elapsed % 3600000) / 60000);
            const elapsedStr = elapsed > 0 ? `${d ? `${d}天` : ''}${h ? `${h}小时` : ''}${m}分` : '';
            const isAnswered = item.status === 2;
            const deadline = qTime ? qTime + 7 * 86400000 : 0;
            const remaining = isAnswered ? 0 : (deadline - Date.now());
            const rd = Math.floor(remaining / 86400000);
            const rh = Math.floor((remaining % 86400000) / 3600000);
            const rm = Math.floor((remaining % 3600000) / 60000);
            const remainStr = remaining > 0 && !isAnswered ? `${rd ? `${rd}天` : ''}${rh ? `${rh}小时` : ''}${rm}分` : (!isAnswered && remaining <= 0 ? '已过期' : '');
            return (
              <FadeInView delay={80 + index * 30} duration={300}>
                <View style={[styles.rowCard, isDark && styles.cardDark]}>
                  <View style={styles.flipHeader}>
                    <Text style={[styles.flipMember, isDark && styles.textLight]} numberOfLines={1}>
                      {pickText(item, ['memberName', 'starName', 'baseUserInfo.nickname'], '成员')}
                    </Text>
                    <Text style={styles.flipTime}>{formatTimestamp(qTime)}</Text>
                  </View>
                  <Text style={[styles.flipQ, isDark && styles.textSubLight]} numberOfLines={10}>问：{pickText(item, ['content', 'questionContent', 'question', 'text'], '') || '无提问内容'}</Text>
                  {isAnswered && isText ? (
                    <Text style={[styles.flipAText, isDark && styles.textSubLight]} numberOfLines={20}>
                      答：{answerText || '已翻牌'}
                    </Text>
                  ) : isAnswered && (isVoice || isVideo) ? (
                    <View style={styles.flipABlock}>
                      <Text style={[styles.flipA, isDark && styles.textSubLight]} numberOfLines={20}>
                        答：{answerText || (isVoice ? '[语音回复]' : '[视频回复]')}
                      </Text>
                      {answerUrl ? (
                        <TouchableOpacity style={styles.flipPlayBtn} onPress={() => setFlipPlayUrl((prev) => prev === answerUrl ? '' : answerUrl)}>
                          <Text style={styles.flipPlayText}>{flipPlayUrl === answerUrl ? '收起' : `▶ ${answerDuration > 0 ? (answerDuration < 60 ? `${answerDuration}s` : `${Math.floor(answerDuration / 60)}:${String(answerDuration % 60).padStart(2, '0')}`) : (isVoice ? '语音' : '视频')}`}</Text>
                        </TouchableOpacity>
                      ) : null}
                      {flipPlayUrl === answerUrl && answerUrl ? (
                        <Video source={{ uri: answerUrl }} style={isVoice ? styles.flipAudio : styles.flipVideo} controls paused={false} resizeMode="contain" ignoreSilentSwitch="ignore" />
                      ) : null}
                    </View>
                  ) : !isAnswered ? (
                    <Text style={styles.flipPending}>{item.status === 1 ? '等待回复中' : item.status === 3 ? '已退款' : '等待回复中'}</Text>
                  ) : null}
                  <View style={styles.flipMeta}>
                    <Text style={styles.flipTag}>{isText ? '文字' : isVoice ? '语音' : isVideo ? '视频' : '未知'}</Text>
                    <Text style={styles.flipPrivacy}>{item.type === 1 ? '公开' : item.type === 2 ? '私密' : item.type === 3 ? '匿名' : '未知'}</Text>
                    <Text style={styles.flipCost}>{item.cost || 0} 鸡腿</Text>
                    {elapsedStr ? <Text style={styles.flipElapsed}>耗时 {elapsedStr}</Text> : null}
                    {remainStr ? <Text style={styles.flipRemain}>剩 {remainStr}</Text> : null}
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
              <Text style={styles.videoCloseText}>关闭</Text>
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
  header: { paddingTop: 54, paddingHorizontal: 20, paddingBottom: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  backBtn: { color: '#ff6f91', fontSize: 14, minWidth: 54 },
  title: { flex: 1, color: '#ff6f91', fontSize: 20, fontWeight: '800', textAlign: 'center' },
  refreshText: { color: '#ff6f91', fontSize: 14, minWidth: 54, textAlign: 'right' },
  pickerWrap: { paddingHorizontal: 14 },
  statusText: { marginTop: 8, color: '#555555', fontSize: 12 },
  tabs: { flexDirection: 'row', gap: 4, paddingHorizontal: 10, paddingVertical: 10 },
  tab: { flex: 1, minHeight: 36, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.56)', paddingHorizontal: 6 },
  tabActive: { backgroundColor: '#ff6f91' },
  tabText: { color: '#444444', fontSize: 11, fontWeight: '800' },
  tabTextActive: { color: '#ffffff' },
  content: { padding: 14, paddingBottom: 112 },
  summaryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  summaryCard: { width: '23%', minHeight: 68, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.72)' },
  summaryValue: { color: '#ff6f91', fontSize: 20, fontWeight: '900' },
  summaryLabel: { color: '#555555', fontSize: 10, marginTop: 4 },
  rowCard: { padding: 12, marginBottom: 8, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.72)' },
  rowTitle: { color: '#222222', fontSize: 14, fontWeight: '800' },
  rowText: { color: '#555555', fontSize: 13, lineHeight: 20, marginTop: 4 },
  rowMeta: { color: '#ff6f91', fontSize: 11, marginTop: 6 },
  rankRow: { flexDirection: 'row', alignItems: 'center', padding: 13, borderRadius: 16, marginBottom: 8, backgroundColor: 'rgba(255,255,255,0.72)' },
  rankNo: { width: 32, color: '#ff6f91', fontSize: 18, fontWeight: '900' },
  rankName: { flex: 1, color: '#222222', fontSize: 14, fontWeight: '800' },
  rankValue: { color: '#ff6f91', fontSize: 13, fontWeight: '800' },
  dateRow: { padding: 12, marginBottom: 6, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.72)' },
  dateHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  dateTitle: { color: '#222222', fontSize: 14, fontWeight: '800' },
  dateMeta: { color: '#555', fontSize: 11 },
  dateMember: { color: '#ff6f91', fontWeight: '700' },
  barWrap: { position: 'relative', height: 6, borderRadius: 3, backgroundColor: 'rgba(0,0,0,0.06)', overflow: 'hidden' },
  barBg: { position: 'absolute', top: 0, left: 0, height: '100%', backgroundColor: '#555', borderRadius: 3 },
  barFg: { position: 'absolute', top: 0, left: 0, height: '100%', backgroundColor: '#ff6f91', borderRadius: 3 },
  empty: { textAlign: 'center', color: '#333333', marginTop: 40, fontSize: 14 },
  flipHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  flipMember: { fontSize: 14, fontWeight: '800', color: '#ff6f91', flex: 1 },
  flipTime: { fontSize: 11, color: '#555' },
  flipQ: { fontSize: 13, color: '#444', lineHeight: 20, marginBottom: 6 },
  flipABlock: { backgroundColor: 'rgba(255,111,145,0.06)', padding: 8, borderRadius: 10, marginBottom: 6 },
  flipA: { fontSize: 13, color: '#444', lineHeight: 20 },
  flipAText: { fontSize: 13, color: '#444', lineHeight: 20, marginBottom: 6 },
  flipPending: { fontSize: 12, color: '#c58a00', fontWeight: '700' },
  flipMeta: { flexDirection: 'row', gap: 8, marginTop: 4 },
  flipTag: { fontSize: 10, color: '#ff6f91', fontWeight: '800', backgroundColor: 'rgba(255,111,145,0.12)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  flipPrivacy: { fontSize: 10, color: '#13a8a8', fontWeight: '800', backgroundColor: 'rgba(19,168,168,0.12)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  flipCost: { fontSize: 10, color: '#555' },
  flipElapsed: { fontSize: 10, color: '#ff6f91', fontWeight: '700' },
  flipRemain: { fontSize: 10, color: '#e67e22', fontWeight: '700' },
  flipPlayBtn: { alignSelf: 'flex-start', marginTop: 8, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 14, backgroundColor: '#ff6f91' },
  flipPlayText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  flipAudio: { height: 52, marginTop: 8, backgroundColor: 'rgba(0,0,0,0.06)', borderRadius: 10 },
  flipVideo: { height: 150, marginTop: 8, backgroundColor: '#000', borderRadius: 10 },
  imgModal: { flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', alignItems: 'center', justifyContent: 'center' },
  imgFull: { width: '96%', height: '80%' },
  videoModal: { flex: 1, backgroundColor: '#000' },
  videoClose: { paddingTop: 50, paddingHorizontal: 16, paddingBottom: 8, alignSelf: 'flex-start' },
  videoCloseText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  videoPlayer: { flex: 1, backgroundColor: '#000' },
  cardDark: { backgroundColor: 'rgba(20,20,20,0.68)' },
  textLight: { color: '#ffffff' },
  textSubLight: { color: '#dddddd' },
  flipCardsRow: { flexDirection: 'row', justifyContent: 'space-between', padding: 16, backgroundColor: 'rgba(255,255,255,0.72)', borderRadius: 16, marginBottom: 12 },
  flipCard: { flex: 1, alignItems: 'center', paddingVertical: 4 },
  flipCardBig: { flex: 1.4, alignItems: 'center', paddingVertical: 4 },
  flipCardValue: { fontSize: 20, fontWeight: '800', color: '#ff6f91' },
  flipCardLabel: { fontSize: 11, color: '#777', marginTop: 4 },
  flipCardRange: { fontSize: 10, color: '#999', marginTop: 2 },
  flipCardBorder: { width: 1, backgroundColor: 'rgba(0,0,0,0.08)' },
  flipCardBorderDark: { backgroundColor: 'rgba(255,255,255,0.10)' },
  flipTypeRow: { flexDirection: 'row', gap: 8, justifyContent: 'center', marginBottom: 14 },
  flipTypePill: { fontSize: 11, fontWeight: '700', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 8 },
  sectionSub: { fontSize: 12, fontWeight: '700', color: '#555', marginBottom: 8 },
  flipMemberCard: { padding: 12, backgroundColor: 'rgba(255,255,255,0.60)', borderRadius: 12, marginBottom: 6 },
  flipMemberHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  flipMemberName: { fontSize: 13, fontWeight: '700', color: '#333', flex: 1 },
  flipMemberCost: { fontSize: 12, fontWeight: '800', color: '#fa8c16' },
  flipBarBg: { height: 4, borderRadius: 2, backgroundColor: 'rgba(0,0,0,0.06)', marginBottom: 4 },
  flipBarFg: { height: 4, borderRadius: 2, backgroundColor: '#ff6f91' },
  flipMemberMeta: { fontSize: 10, color: '#777', lineHeight: 16 },
  flipChip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.06)' },
  flipChipActive: { backgroundColor: '#ff6f91' },
  flipChipDark: { backgroundColor: 'rgba(255,255,255,0.12)' },
  flipChipText: { fontSize: 11, color: '#555', fontWeight: '600' },
  flipChipTextActive: { color: '#fff' },
});
