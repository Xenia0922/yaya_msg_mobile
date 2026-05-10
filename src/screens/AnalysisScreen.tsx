import React, { useMemo, useState } from 'react';
import { FlatList, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/types';
import { Member } from '../types';
import MemberPicker from '../components/MemberPicker';
import { useSettingsStore, useUiStore } from '../store';
import pocketApi from '../api/pocket48';
import { errorMessage, messagePayload, messageText, pickText, unwrapList } from '../utils/data';
import { formatTimestamp } from '../utils/format';

type Nav = StackNavigationProp<RootStackParamList, 'AnalysisScreen'>;
type TabKey = 'room' | 'senders' | 'media' | 'flip';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'room', label: '房间概览' },
  { key: 'senders', label: '发言排行' },
  { key: 'media', label: '媒体统计' },
  { key: 'flip', label: '翻牌统计' },
];

function msgTime(item: any) {
  return Number(item.msgTime || item.ctime || item.time || item.timestamp || item.createTime || 0);
}

function senderName(item: any) {
  return pickText(item, [
    'senderName',
    'senderNickName',
    'nickName',
    'nickname',
    'user.nickName',
    'sender.nickName',
    'extInfo.senderName',
  ], '未知用户');
}

function senderId(item: any) {
  return pickText(item, ['senderId', 'senderUserId', 'fromUserId', 'userId', 'sender.userId']);
}

function isMedia(item: any, kind: 'image' | 'audio' | 'video') {
  const type = String(item.msgType || item.type || '').toUpperCase();
  const payload = messagePayload(item);
  const url = pickText(payload, ['url', 'imageUrl', 'audioUrl', 'videoUrl', 'message.url', 'msg.url']);
  if (kind === 'image') return type.includes('IMAGE') || /\.(jpe?g|png|webp|gif)(\?|$)/i.test(url);
  if (kind === 'audio') return type.includes('AUDIO') || /\.(mp3|m4a|aac|amr|wav)(\?|$)/i.test(url);
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
  const [status, setStatus] = useState('选择成员后读取房间消息，翻牌统计读取账号翻牌记录。');

  const summary = useMemo(() => {
    const total = messages.length;
    const idol = member ? messages.filter((item) => String(senderId(item)) === String(member.id)).length : 0;
    const fan = Math.max(0, total - idol);
    const images = messages.filter((item) => isMedia(item, 'image')).length;
    const audios = messages.filter((item) => isMedia(item, 'audio')).length;
    const videos = messages.filter((item) => isMedia(item, 'video')).length;
    return { total, idol, fan, images, audios, videos };
  }, [member, messages]);

  const senders = useMemo(() => countBy(messages, senderName).slice(0, 30), [messages]);
  const recent = useMemo(() => messages.slice().sort((a, b) => msgTime(b) - msgTime(a)).slice(0, 20), [messages]);
  const flipRows = useMemo(() => countBy(flips, (item) => pickText(item, ['memberName', 'starName', 'member.name'], '翻牌')).slice(0, 30), [flips]);

  const loadRoomStats = async (nextMember: Member) => {
    setMember(nextMember);
    setLoading(true);
    setStatus('正在加载统计数据...');
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
        const list = unwrapList(res, ['content.messageList', 'content.list', 'content.messages', 'data.messageList', 'messageList', 'list']);
        if (!list.length) break;
        collected.push(...list);
        const contentNext = Number(res?.content?.nextTime || res?.data?.nextTime || 0);
        nextTime = contentNext || Math.min(...list.map(msgTime).filter(Boolean));
        if (!nextTime) break;
      }
      const seen = new Set<string>();
      const unique = collected.filter((item, index) => {
        const key = String(item.messageId || item.msgId || item.id || `${msgTime(item)}-${senderId(item)}-${messageText(item)}-${index}`);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      setMessages(unique);
      const text = unique.length ? `已加载 ${unique.length} 条房间消息` : '没有可统计的房间消息';
      setStatus(text);
      showToast(text);
    } catch (error) {
      setMessages([]);
      setStatus(`加载失败：${errorMessage(error)}`);
    } finally {
      setLoading(false);
    }
  };

  const loadFlipStats = async () => {
    setLoading(true);
    setStatus('正在加载翻牌统计...');
    try {
      const pages = await Promise.all([0, 50, 100].map((begin) => pocketApi.getFlipList(begin, 50).catch(() => null)));
      const list = pages.flatMap((res) => unwrapList(res, ['content.questions', 'content.list', 'content.data', 'data.questions', 'questions', 'list']));
      setFlips(list);
      const text = list.length ? `已加载 ${list.length} 条翻牌记录` : '暂无翻牌记录';
      setStatus(text);
      showToast(text);
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
  ];

  return (
    <View style={[styles.container, isDark && styles.containerDark]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}><Text style={styles.backBtn}>返回</Text></TouchableOpacity>
        <Text style={[styles.title, isDark && styles.textLight]}>数据统计</Text>
        <TouchableOpacity onPress={loadFlipStats}><Text style={styles.refreshText}>翻牌</Text></TouchableOpacity>
      </View>

      <View style={styles.pickerWrap}>
        <MemberPicker selectedMember={member} onSelect={loadRoomStats} />
        <Text style={[styles.status, isDark && styles.textSubLight]}>{loading ? '加载中...' : status}</Text>
      </View>

      <View style={styles.tabs}>
        {TABS.map((item) => (
          <TouchableOpacity key={item.key} style={[styles.tab, tab === item.key && styles.tabActive]} onPress={() => setTab(item.key)}>
            <Text style={[styles.tabText, tab === item.key && styles.tabTextActive]}>{item.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {tab === 'room' ? (
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
      ) : null}

      {tab === 'senders' ? (
        <FlatList
          data={senders}
          keyExtractor={(item) => item.key}
          contentContainerStyle={styles.content}
          renderItem={({ item, index }) => (
            <View style={[styles.rankRow, isDark && styles.cardDark]}>
              <Text style={styles.rankNo}>{index + 1}</Text>
              <Text style={[styles.rankName, isDark && styles.textLight]}>{item.key}</Text>
              <Text style={styles.rankValue}>{item.count} 条</Text>
            </View>
          )}
        />
      ) : null}

      {tab === 'media' ? (
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.summaryGrid}>
            {cards.slice(3).map((item) => (
              <View key={item.label} style={[styles.summaryCard, isDark && styles.cardDark]}>
                <Text style={styles.summaryValue}>{item.value}</Text>
                <Text style={[styles.summaryLabel, isDark && styles.textSubLight]}>{item.label}</Text>
              </View>
            ))}
          </View>
        </ScrollView>
      ) : null}

      {tab === 'flip' ? (
        <FlatList
          data={flipRows}
          keyExtractor={(item) => item.key}
          contentContainerStyle={styles.content}
          ListHeaderComponent={<Text style={[styles.status, isDark && styles.textSubLight]}>共 {flips.length} 条翻牌记录</Text>}
          renderItem={({ item, index }) => (
            <View style={[styles.rankRow, isDark && styles.cardDark]}>
              <Text style={styles.rankNo}>{index + 1}</Text>
              <Text style={[styles.rankName, isDark && styles.textLight]}>{item.key}</Text>
              <Text style={styles.rankValue}>{item.count} 条</Text>
            </View>
          )}
        />
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
  status: { marginTop: 8, color: '#555555', fontSize: 12 },
  tabs: { flexDirection: 'row', gap: 6, paddingHorizontal: 14, paddingVertical: 10 },
  tab: { flex: 1, minHeight: 38, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.56)' },
  tabActive: { backgroundColor: '#ff6f91' },
  tabText: { color: '#444444', fontSize: 12, fontWeight: '800' },
  tabTextActive: { color: '#ffffff' },
  content: { padding: 14, paddingBottom: 112 },
  summaryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  summaryCard: { width: '31.5%', minHeight: 74, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.72)' },
  summaryValue: { color: '#ff6f91', fontSize: 22, fontWeight: '900' },
  summaryLabel: { color: '#555555', fontSize: 12, marginTop: 4 },
  rowCard: { padding: 12, marginBottom: 8, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.72)' },
  rowTitle: { color: '#222222', fontSize: 14, fontWeight: '800' },
  rowText: { color: '#555555', fontSize: 13, lineHeight: 20, marginTop: 4 },
  rowMeta: { color: '#ff6f91', fontSize: 11, marginTop: 6 },
  rankRow: { flexDirection: 'row', alignItems: 'center', padding: 13, borderRadius: 18, marginBottom: 8, backgroundColor: 'rgba(255,255,255,0.72)' },
  rankNo: { width: 32, color: '#ff6f91', fontSize: 18, fontWeight: '900' },
  rankName: { flex: 1, color: '#222222', fontSize: 14, fontWeight: '800' },
  rankValue: { color: '#ff6f91', fontSize: 13, fontWeight: '800' },
  cardDark: { backgroundColor: 'rgba(20,20,20,0.68)' },
  textLight: { color: '#ffffff' },
  textSubLight: { color: '#dddddd' },
});
