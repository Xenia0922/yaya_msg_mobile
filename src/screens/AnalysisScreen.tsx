import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/types';
import { useSettingsStore } from '../store';
import { Member, RoomMessage } from '../types';
import MemberPicker from '../components/MemberPicker';
import pocketApi from '../api/pocket48';
import {
  errorMessage,
  messagePayload,
  messageText,
  normalizeUrl,
  pickText,
  unwrapList,
} from '../utils/data';
import { formatDate, formatTimestamp } from '../utils/format';

type Nav = StackNavigationProp<RootStackParamList, 'AnalysisScreen'>;
type AnalysisTab = 'messages' | 'speech' | 'interaction' | 'gift' | 'flip';

type StatRow = {
  key: string;
  title: string;
  subtitle?: string;
  value: string;
  detail?: string;
  avatar?: string;
};

type SummaryItem = {
  label: string;
  value: string;
  accent?: string;
};

const tabs: { key: AnalysisTab; label: string }[] = [
  { key: 'messages', label: '消息统计' },
  { key: 'speech', label: '发言榜' },
  { key: 'interaction', label: '互动榜' },
  { key: 'gift', label: '礼物榜' },
  { key: 'flip', label: '翻牌统计' },
];

const giftPriceFallback: Record<string, number> = {
  鸡腿: 10,
  咖啡: 20,
  应援棒: 50,
  小电视: 100,
  飞机: 500,
};

function toNumber(value: any): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function shortName(member?: Member | null): string {
  if (!member) return '';
  return member.ownerName.split('-').pop() || member.ownerName;
}

function normalizeMessages(res: any): RoomMessage[] {
  return unwrapList(res, [
    'content.messageList',
    'content.list',
    'content.messages',
    'content.data',
    'data.messageList',
    'data.list',
    'messageList',
    'list',
  ]) as RoomMessage[];
}

function getNextTime(res: any, messages: RoomMessage[]): number {
  const direct = toNumber(pickText(res, [
    'content.nextTime',
    'content.next',
    'content.lastTime',
    'data.nextTime',
    'data.next',
    'nextTime',
  ]));
  if (direct > 0) return direct;
  const last = messages[messages.length - 1] as any;
  return toNumber(last?.msgTime || last?.messageTime || last?.ctime);
}

function senderId(msg: any): string {
  return String(msg.senderUserId || msg.senderId || msg.userId || msg.uid || msg.fromUserId || msg.fromAccount || '');
}

function senderName(msg: any): string {
  const payload = messagePayload(msg);
  const ext = typeof msg.extInfo === 'string' ? messagePayload({ bodys: msg.extInfo }) : msg.extInfo;
  return pickText(msg, ['senderName', 'nickname', 'nickName', 'userName'])
    || pickText(payload, ['user.nickName', 'user.nickname', 'sender.nickName', 'sender.nickname'])
    || pickText(ext, ['user.nickName', 'user.nickname', 'nickName', 'nickname'])
    || senderId(msg)
    || '未知用户';
}

function senderAvatar(msg: any): string {
  const payload = messagePayload(msg);
  const ext = typeof msg.extInfo === 'string' ? messagePayload({ bodys: msg.extInfo }) : msg.extInfo;
  return normalizeUrl(
    pickText(msg, ['avatar', 'senderAvatar'])
    || pickText(payload, ['user.avatar', 'sender.avatar'])
    || pickText(ext, ['user.avatar', 'avatar']),
  );
}

function answerTypeLabel(value: any): string {
  const type = Number(value);
  if (type === 1) return '文字';
  if (type === 2) return '语音';
  if (type === 3) return '视频';
  return '未知';
}

function durationText(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '-';
  const seconds = Math.floor(ms / 1000);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  if (days > 0) return `${days}天${hours}小时`;
  if (hours > 0) return `${hours}小时${minutes}分`;
  if (minutes > 0) return `${minutes}分${rest}秒`;
  return `${rest}秒`;
}

function extractGift(msg: any): { name: string; count: number; cost: number } | null {
  const type = String(msg.msgType || '').toUpperCase();
  const payload = messagePayload(msg);
  const info = payload?.giftInfo || payload?.gift || payload?.giftReplyInfo || payload;
  const text = messageText(msg);

  const name = pickText(info, ['giftName', 'name', 'gift.name'])
    || pickText(payload, ['giftName', 'name'])
    || (text.match(/送出礼物[:：]\s*([^\sxX，,]+)/)?.[1] ?? '');
  const count = toNumber(pickText(info, ['giftNum', 'num', 'count', 'giftCount', 'number'], '1'))
    || toNumber(text.match(/[xX]\s*(\d+)/)?.[1])
    || 1;
  const cost = toNumber(pickText(info, ['cost', 'price', 'gift.cost', 'gift.price']))
    || giftPriceFallback[name]
    || 0;

  if (!name && !type.includes('GIFT') && !text.includes('送出礼物')) return null;
  return { name: name || '未知礼物', count, cost };
}

function extractInteractionTarget(msg: any): string {
  const payload = messagePayload(msg);
  const info = payload?.replyInfo || payload?.giftReplyInfo || payload?.reply || payload;
  return pickText(info, [
    'targetUser.nickName',
    'targetUser.nickname',
    'targetUserName',
    'replyUserName',
    'sourceUser.nickName',
    'sourceUser.nickname',
    'questionUserName',
    'user.nickName',
    'user.nickname',
  ]) || messageText(msg).match(/回复\s*([^:：\s]+)/)?.[1] || '';
}

async function loadRoomMessages(member: Member, maxPages = 8): Promise<RoomMessage[]> {
  const all: RoomMessage[] = [];
  let nextTime = 0;
  const seen = new Set<string>();

  for (let page = 0; page < maxPages; page += 1) {
    const res = await pocketApi.getRoomMessages({
      channelId: member.channelId,
      serverId: member.serverId,
      nextTime,
      fetchAll: true,
    });
    const list = normalizeMessages(res);
    for (const msg of list) {
      const id = String(msg.msgId || msg.messageId || msg.clientMsgId || msg.id || `${msg.msgTime}-${senderId(msg)}`);
      if (!seen.has(id)) {
        seen.add(id);
        all.push(msg);
      }
    }
    const next = getNextTime(res, list);
    if (!list.length || !next || next === nextTime) break;
    nextTime = next;
  }

  return all;
}

async function loadFlipRows(member?: Member | null): Promise<any[]> {
  const all: any[] = [];
  const seen = new Set<string>();
  for (let offset = 0; offset < 300; offset += 50) {
    const res = await pocketApi.getFlipList(offset, 50);
    const list = unwrapList(res, ['content.questions', 'content.list', 'content.data', 'data.questions', 'questions', 'list']);
    if (!list.length) break;
    for (const item of list) {
      const id = String(item.questionId || item.id || `${item.qtime}-${item.memberId}`);
      if (!seen.has(id)) {
        seen.add(id);
        all.push(item);
      }
    }
    if (list.length < 50) break;
  }

  if (!member) return all;
  const targetNames = new Set([member.ownerName, shortName(member), member.id].filter(Boolean).map(String));
  return all.filter((item) => {
    const id = String(item.memberId || item.starId || item.baseUserInfo?.userId || item.baseUserInfo?.userIdStr || '');
    const name = String(item.memberName || item.baseUserInfo?.nickname || item.baseUserInfo?.nickName || '');
    return id === String(member.id) || targetNames.has(name);
  });
}

function buildMessageStats(messages: RoomMessage[]): { summary: SummaryItem[]; rows: StatRow[] } {
  const days: Record<string, { total: number; member: number }> = {};
  messages.forEach((msg) => {
    const date = formatDate(msg.msgTime) || '未知日期';
    if (!days[date]) days[date] = { total: 0, member: 0 };
    days[date].total += 1;
    if (String(msg.msgType || '').toUpperCase().includes('REPLY')) days[date].member += 1;
  });

  const rows = Object.entries(days)
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, value]) => ({
      key: date,
      title: date,
      subtitle: `成员互动 ${value.member} 条`,
      value: `${value.total} 条`,
      detail: value.total ? `成员互动占比 ${Math.round((value.member / value.total) * 100)}%` : '',
    }));

  return {
    summary: [
      { label: '消息总数', value: String(messages.length), accent: '#ff6f91' },
      { label: '日期数', value: String(rows.length), accent: '#1890ff' },
      { label: '互动消息', value: String(messages.filter((m) => String(m.msgType || '').toUpperCase().includes('REPLY')).length), accent: '#722ed1' },
    ],
    rows,
  };
}

function buildSpeechStats(messages: RoomMessage[]): { summary: SummaryItem[]; rows: StatRow[] } {
  const users: Record<string, { name: string; count: number; lastText: string; lastTime: number; avatar: string }> = {};
  messages.forEach((msg) => {
    if (extractGift(msg)) return;
    const id = senderId(msg) || senderName(msg);
    const text = messageText(msg);
    if (!id || !text) return;
    if (!users[id]) users[id] = { name: senderName(msg), count: 0, lastText: '', lastTime: 0, avatar: senderAvatar(msg) };
    users[id].count += 1;
    const time = toNumber(msg.msgTime);
    if (time >= users[id].lastTime) {
      users[id].lastText = text;
      users[id].lastTime = time;
      users[id].name = senderName(msg);
      users[id].avatar = senderAvatar(msg) || users[id].avatar;
    }
  });

  const rows = Object.entries(users)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 100)
    .map(([id, user]) => ({
      key: id,
      title: user.name,
      subtitle: user.lastText.slice(0, 40) || '图片/表情/媒体消息',
      value: `${user.count} 条`,
      detail: user.lastTime ? `最近 ${formatTimestamp(user.lastTime)}` : '',
      avatar: user.avatar,
    }));

  return {
    summary: [
      { label: '发言用户', value: String(rows.length), accent: '#1890ff' },
      { label: '发言总数', value: String(rows.reduce((sum, row) => sum + toNumber(row.value), 0)), accent: '#ff6f91' },
    ],
    rows,
  };
}

function buildInteractionStats(messages: RoomMessage[]): { summary: SummaryItem[]; rows: StatRow[] } {
  const targets: Record<string, { name: string; count: number; latest: string }> = {};
  messages.forEach((msg) => {
    const type = String(msg.msgType || '').toUpperCase();
    if (!type.includes('REPLY') && !type.includes('FLIPCARD')) return;
    const target = extractInteractionTarget(msg);
    if (!target) return;
    if (!targets[target]) targets[target] = { name: target, count: 0, latest: '' };
    targets[target].count += 1;
    targets[target].latest = messageText(msg).slice(0, 50);
  });

  const rows = Object.values(targets)
    .sort((a, b) => b.count - a.count)
    .map((item) => ({
      key: item.name,
      title: item.name,
      subtitle: item.latest || '互动消息',
      value: `${item.count} 次`,
    }));

  return {
    summary: [
      { label: '互动对象', value: String(rows.length), accent: '#722ed1' },
      { label: '互动总数', value: String(rows.reduce((sum, row) => sum + toNumber(row.value), 0)), accent: '#ff6f91' },
    ],
    rows,
  };
}

function buildGiftStats(messages: RoomMessage[]): { summary: SummaryItem[]; rows: StatRow[] } {
  const users: Record<string, { name: string; totalCost: number; totalCount: number; gifts: Record<string, number>; avatar: string }> = {};
  let totalCost = 0;
  let totalCount = 0;

  messages.forEach((msg) => {
    const gift = extractGift(msg);
    if (!gift) return;
    const id = senderId(msg) || senderName(msg);
    if (!users[id]) users[id] = { name: senderName(msg), totalCost: 0, totalCount: 0, gifts: {}, avatar: senderAvatar(msg) };
    const value = gift.cost * gift.count;
    users[id].totalCost += value;
    users[id].totalCount += gift.count;
    users[id].gifts[gift.name] = (users[id].gifts[gift.name] || 0) + gift.count;
    users[id].avatar = senderAvatar(msg) || users[id].avatar;
    totalCost += value;
    totalCount += gift.count;
  });

  const rows = Object.entries(users)
    .sort((a, b) => b[1].totalCost - a[1].totalCost || b[1].totalCount - a[1].totalCount)
    .map(([id, user]) => ({
      key: id,
      title: user.name,
      subtitle: Object.entries(user.gifts).map(([name, count]) => `${name} x${count}`).slice(0, 3).join('，'),
      value: `${user.totalCost} 鸡腿`,
      detail: `送出 ${user.totalCount} 个礼物`,
      avatar: user.avatar,
    }));

  return {
    summary: [
      { label: '鸡腿总数', value: String(totalCost), accent: '#fa8c16' },
      { label: '礼物数量', value: String(totalCount), accent: '#ff6f91' },
      { label: '贡献用户', value: String(rows.length), accent: '#1890ff' },
    ],
    rows,
  };
}

function buildFlipStats(flips: any[]): { summary: SummaryItem[]; rows: StatRow[] } {
  const memberStats: Record<string, {
    name: string;
    count: number;
    cost: number;
    text: number;
    audio: number;
    video: number;
    answered: number;
    durationSum: number;
    latest: string;
  }> = {};

  flips.forEach((item) => {
    const name = pickText(item, ['memberName', 'baseUserInfo.nickname', 'baseUserInfo.nickName'], '未知成员');
    if (!memberStats[name]) {
      memberStats[name] = { name, count: 0, cost: 0, text: 0, audio: 0, video: 0, answered: 0, durationSum: 0, latest: '' };
    }
    const stat = memberStats[name];
    stat.count += 1;
    stat.cost += toNumber(item.cost);
    if (Number(item.answerType) === 1) stat.text += 1;
    if (Number(item.answerType) === 2) stat.audio += 1;
    if (Number(item.answerType) === 3) stat.video += 1;
    const qtime = toNumber(item.qtime);
    const answerTime = toNumber(item.answerTime);
    if (qtime > 0 && answerTime > qtime) {
      stat.answered += 1;
      stat.durationSum += answerTime - qtime;
    }
    const question = pickText(item, ['question', 'content', 'title']);
    if (question) stat.latest = question.slice(0, 40);
  });

  const rows = Object.values(memberStats)
    .sort((a, b) => b.cost - a.cost || b.count - a.count)
    .map((item) => ({
      key: item.name,
      title: item.name,
      subtitle: `共 ${item.count} 条｜文字 ${item.text}｜语音 ${item.audio}｜视频 ${item.video}`,
      value: `${item.cost} 鸡腿`,
      detail: `平均耗时 ${item.answered ? durationText(item.durationSum / item.answered) : '-'}｜最近：${item.latest || '无'}`,
    }));

  return {
    summary: [
      { label: '翻牌总数', value: String(flips.length), accent: '#ff6f91' },
      { label: '鸡腿总数', value: String(flips.reduce((sum, item) => sum + toNumber(item.cost), 0)), accent: '#fa8c16' },
      { label: '成员数', value: String(rows.length), accent: '#1890ff' },
    ],
    rows,
  };
}

export default function AnalysisScreen() {
  const navigation = useNavigation<Nav>();
  const isDark = useSettingsStore((s) => s.settings.theme === 'dark');
  const [tab, setTab] = useState<AnalysisTab>('messages');
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('选择成员后加载统计；翻牌统计可直接加载账号记录。');
  const [rows, setRows] = useState<StatRow[]>([]);
  const [summary, setSummary] = useState<SummaryItem[]>([]);

  const needsMember = tab !== 'flip';

  const loadData = useCallback(async (nextTab = tab, member = selectedMember) => {
    if (nextTab !== 'flip' && !member) {
      setStatus('请先选择成员房间');
      setRows([]);
      setSummary([]);
      return;
    }

    setLoading(true);
    setStatus('正在加载统计数据...');
    setRows([]);
    setSummary([]);
    try {
      let result: { summary: SummaryItem[]; rows: StatRow[] };
      if (nextTab === 'flip') {
        const flips = await loadFlipRows(member);
        result = buildFlipStats(flips);
      } else {
        const messages = await loadRoomMessages(member as Member);
        if (nextTab === 'messages') result = buildMessageStats(messages);
        else if (nextTab === 'speech') result = buildSpeechStats(messages);
        else if (nextTab === 'interaction') result = buildInteractionStats(messages);
        else result = buildGiftStats(messages);
      }

      setSummary(result.summary);
      setRows(result.rows);
      setStatus(result.rows.length ? `加载完成：${result.rows.length} 条统计结果` : '已连接接口，但当前条件下没有可统计的数据');
    } catch (error) {
      setStatus(`加载失败：${errorMessage(error)}`);
    } finally {
      setLoading(false);
    }
  }, [selectedMember, tab]);

  const handleTabPress = (next: AnalysisTab) => {
    setTab(next);
    loadData(next, selectedMember);
  };

  useEffect(() => {
    if (tab === 'flip' && rows.length === 0) loadData('flip', selectedMember);
  }, [loadData, rows.length, selectedMember, tab]);

  const title = useMemo(() => tabs.find((item) => item.key === tab)?.label || '数据统计', [tab]);

  return (
    <View style={[styles.container, isDark && styles.containerDark]}>
      <View style={[styles.header, isDark && styles.headerDark]}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backBtn}>返回</Text>
        </TouchableOpacity>
        <Text style={styles.title}>数据统计</Text>
      </View>

      <View style={styles.content}>
        <View style={styles.tabRow}>
          {tabs.map((item) => (
            <TouchableOpacity
              key={item.key}
              style={[styles.tab, tab === item.key && styles.tabActive]}
              onPress={() => handleTabPress(item.key)}
            >
              <Text style={[styles.tabText, tab === item.key && styles.tabTextActive]}>{item.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={[styles.card, isDark && styles.cardDark]}>
          <Text style={[styles.sectionTitle, isDark && styles.textLight]}>{title}</Text>
          <MemberPicker
            selectedMember={selectedMember}
            onSelect={(member) => {
              setSelectedMember(member);
              loadData(tab, member);
            }}
            placeholder={needsMember ? '搜索成员房间...' : '可选：搜索成员过滤翻牌统计...'}
            limit={60}
          />
          <TouchableOpacity
            style={[styles.primaryBtn, loading && styles.disabledBtn]}
            onPress={() => loadData(tab, selectedMember)}
            disabled={loading}
          >
            <Text style={styles.primaryBtnText}>{loading ? '加载中...' : '重新加载'}</Text>
          </TouchableOpacity>
          <Text style={styles.status}>{status}</Text>
        </View>

        {summary.length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.summaryScroll}>
            {summary.map((item) => (
              <View key={item.label} style={[styles.summaryCard, isDark && styles.cardDark]}>
                <Text style={[styles.summaryValue, { color: item.accent || '#ff6f91' }]}>{item.value}</Text>
                <Text style={styles.summaryLabel}>{item.label}</Text>
              </View>
            ))}
          </ScrollView>
        ) : null}

        {loading ? <ActivityIndicator style={{ padding: 20 }} color="#ff6f91" /> : null}

        <FlatList
          data={rows}
          keyExtractor={(item, index) => `${item.key}-${index}`}
          renderItem={({ item, index }) => (
            <View style={[styles.row, isDark && styles.cardDark]}>
              <Text style={styles.rank}>{index + 1}</Text>
              <View style={styles.rowMain}>
                <Text style={[styles.rowTitle, isDark && styles.textLight]} numberOfLines={1}>{item.title}</Text>
                {item.subtitle ? <Text style={styles.rowSub} numberOfLines={2}>{item.subtitle}</Text> : null}
                {item.detail ? <Text style={styles.rowDetail} numberOfLines={2}>{item.detail}</Text> : null}
              </View>
              <Text style={styles.rowValue}>{item.value}</Text>
            </View>
          )}
          ListEmptyComponent={
            !loading ? <Text style={styles.empty}>暂无统计结果</Text> : null
          }
          contentContainerStyle={styles.listContent}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  containerDark: { backgroundColor: 'transparent' },
  header: { paddingTop: 54, paddingHorizontal: 20, paddingBottom: 14, marginBottom: 4 },
  headerDark: {},
  backBtn: { color: '#ff6f91', fontSize: 14, marginBottom: 6 },
  title: { fontSize: 24, fontWeight: '800', color: '#ff6f91' },
  content: { flex: 1 },
  tabRow: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 12, gap: 6, marginVertical: 10 },
  tab: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, backgroundColor: 'rgba(238,238,238,0.82)' },
  tabActive: { backgroundColor: '#ff6f91' },
  tabText: { fontSize: 12, color: '#444', fontWeight: '700' },
  tabTextActive: { color: '#fff' },
  card: { backgroundColor: 'rgba(255,255,255,0.46)', marginHorizontal: 12, marginBottom: 10, padding: 14, borderRadius: 16 },
  cardDark: { backgroundColor: 'rgba(20,20,20,0.58)' },
  sectionTitle: { fontSize: 16, fontWeight: '800', color: '#333', marginBottom: 10 },
  primaryBtn: { marginTop: 12, backgroundColor: '#ff6f91', borderRadius: 18, paddingVertical: 12, alignItems: 'center' },
  disabledBtn: { opacity: 0.6 },
  primaryBtnText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  status: { marginTop: 10, color: '#444', fontSize: 12, lineHeight: 18 },
  summaryScroll: { paddingHorizontal: 12, marginBottom: 8 },
  summaryCard: { width: 118, backgroundColor: 'rgba(255,255,255,0.46)', padding: 12, borderRadius: 16, marginRight: 8 },
  summaryValue: { fontSize: 20, fontWeight: '900' },
  summaryLabel: { marginTop: 4, fontSize: 12, color: '#444444' },
  listContent: { paddingBottom: 24 },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.46)', marginHorizontal: 12, marginVertical: 4, borderRadius: 16, padding: 12 },
  rank: { width: 30, fontSize: 16, fontWeight: '900', color: '#ff6f91' },
  rowMain: { flex: 1, minWidth: 0 },
  rowTitle: { fontSize: 14, color: '#333', fontWeight: '800' },
  rowSub: { marginTop: 4, fontSize: 12, color: '#555', lineHeight: 17 },
  rowDetail: { marginTop: 3, fontSize: 11, color: '#333333', lineHeight: 16 },
  rowValue: { marginLeft: 8, fontSize: 13, color: '#ff6f91', fontWeight: '900' },
  empty: { textAlign: 'center', color: '#333333', marginTop: 40, fontSize: 14 },
  textLight: { color: '#eee' },
});
