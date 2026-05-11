import React, { useMemo, useState } from 'react';
import { FlatList, Image, Linking, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Video from 'react-native-video';
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
  const [status, setStatus] = useState('选择成员后读取房间消息，翻牌统计读取账号翻牌记录。');
  const [mediaFullUrl, setMediaFullUrl] = useState('');
  const [playMedia, setPlayMedia] = useState<{ url: string; type: string } | null>(null);

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
  const flipRows = useMemo(() => countBy(flips, (item) => pickText(item, ['memberName', 'starName', 'member.name', 'question'], '翻牌')).slice(0, 30), [flips]);

  const loadRoomStats = async (nextMember: Member) => {
    setMember(nextMember);
    setLoading(true);
    setStatus('正在加载统计数据...');
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
    setStatus('正在加载翻牌统计...');
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
        <TouchableOpacity onPress={loadFlipStats}><Text style={styles.refreshText}>翻牌</Text></TouchableOpacity>
      </View>

      <View style={styles.pickerWrap}>
        <MemberPicker selectedMember={member} onSelect={loadRoomStats} />
        <Text style={[styles.statusText, isDark && styles.textSubLight]}>{loading ? '加载中...' : status}</Text>
      </View>

      <View style={styles.tabs}>
        {TABS.map((item) => (
          <TouchableOpacity key={item.key} style={[styles.tab, tab === item.key && styles.tabActive]} onPress={() => setTab(item.key)}>
            <Text style={[styles.tabText, tab === item.key && styles.tabTextActive]} numberOfLines={1}>{item.label}</Text>
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

      {tab === 'dates' ? (
        <FlatList
          data={dateStats}
          keyExtractor={(item) => item.date}
          contentContainerStyle={styles.content}
          ListEmptyComponent={<Text style={styles.empty}>暂无日期数据</Text>}
          renderItem={({ item }) => {
            const totalPct = (item.total / dateMax) * 100;
            const memberPct = (item.member / dateMax) * 100;
            return (
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
            );
          }}
        />
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
          renderItem={({ item }) => {
            const isImg = isMedia(item, 'image');
            const isAud = isMedia(item, 'audio');
            const isVid = isMedia(item, 'video');
            const type = isImg ? '🖼' : isAud ? '🎵' : '🎬';
            const label = isImg ? '图片' : isAud ? '语音' : '视频';
            const payload = messagePayload(item);
            const url = pickText(payload, ['url', 'imageUrl', 'audioUrl', 'videoUrl', 'message.url']);
            return (
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
                <Text style={[styles.rowTitle, isDark && styles.textLight]}>{type} {label} · {senderName(item)}</Text>
                <Text style={[styles.rowText, isDark && styles.textSubLight]} numberOfLines={2}>
                  {messageText(item) || '(无文字)'}
                </Text>
                <Text style={styles.rowMeta}>{formatTimestamp(msgTime(item))}</Text>
              </TouchableOpacity>
            );
          }}
        />
      ) : null}

      {tab === 'flip' ? (
        <FlatList
          data={flipRows}
          keyExtractor={(item) => item.key}
          contentContainerStyle={styles.content}
          ListHeaderComponent={<Text style={[styles.statusText, isDark && styles.textSubLight, { marginBottom: 8 }]}>共 {flips.length} 条翻牌记录</Text>}
          renderItem={({ item, index }) => (
            <View style={[styles.rankRow, isDark && styles.cardDark]}>
              <Text style={styles.rankNo}>{index + 1}</Text>
              <Text style={[styles.rankName, isDark && styles.textLight]} numberOfLines={1}>{item.key}</Text>
              <Text style={styles.rankValue}>{item.count} 条</Text>
            </View>
          )}
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
  imgModal: { flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', alignItems: 'center', justifyContent: 'center' },
  imgFull: { width: '96%', height: '80%' },
  videoModal: { flex: 1, backgroundColor: '#000' },
  videoClose: { paddingTop: 50, paddingHorizontal: 16, paddingBottom: 8, alignSelf: 'flex-start' },
  videoCloseText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  videoPlayer: { flex: 1, backgroundColor: '#000' },
  cardDark: { backgroundColor: 'rgba(20,20,20,0.68)' },
  textLight: { color: '#ffffff' },
  textSubLight: { color: '#dddddd' },
});
