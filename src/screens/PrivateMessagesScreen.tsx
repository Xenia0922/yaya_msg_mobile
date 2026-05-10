import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Image,
  Linking,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Video from 'react-native-video';
import { useNavigation } from '@react-navigation/native';
import { useMemberStore, useSettingsStore, useUiStore } from '../store';
import { formatTimestamp } from '../utils/format';
import { errorMessage, messagePayload, messageText, normalizeUrl, pickText, unwrapList } from '../utils/data';
import pocketApi from '../api/pocket48';

function convTargetId(conv: any): string {
  return String(conv?.targetUserId || conv?.user?.userId || conv?.userId || '');
}

function convName(conv: any): string {
  return pickText(conv, ['user.nickname', 'user.nickName', 'user.starName', 'user.realNickName', 'nickname', 'starName'], convTargetId(conv) || '私信');
}

function msgId(msg: any, index: number): string {
  return String(msg.messageId || msg.msgId || msg.id || msg.clientMsgId || index);
}

function msgTime(msg: any): any {
  return msg.timestamp || msg.msgTime || msg.ctime || msg.time || msg.createTime || msg.sendTime;
}

function msgTimeNumber(msg: any): number {
  const value = Number(msgTime(msg));
  return Number.isFinite(value) ? value : 0;
}

function msgFromId(msg: any): string {
  return String(msg.user?.userId || msg.user?.id || msg.fromUserId || msg.senderUserId || msg.senderId || msg.userId || msg.fromAccount || msg.sender?.userId || '');
}

function msgToId(msg: any): string {
  return String(msg.toUserId || msg.targetUserId || msg.receiverUserId || msg.receiveUserId || '');
}

function isMineMessage(msg: any, targetId: string, currentUserId = ''): boolean {
  if (msg.isSelf === true || msg.self === true || msg.isMe === true) return true;
  if (msg.isSelf === false || msg.self === false || msg.isMe === false) return false;
  if (targetId && String(msg.user?.userId || msg.user?.id || '') === String(targetId)) return false;
  const from = msgFromId(msg);
  const to = msgToId(msg);
  if (currentUserId && from === currentUserId) return true;
  if (currentUserId && to === currentUserId) return false;
  if (from && targetId && from === targetId) return false;
  if (to && targetId && to === targetId) return true;
  const direct = String(msg.direct || msg.direction || msg.messageDirection || '').toLowerCase();
  if (['out', 'outgoing', 'send', 'sent', '1'].includes(direct)) return true;
  if (['in', 'incoming', 'receive', 'received', '0'].includes(direct)) return false;
  return false;
}

function privateMessageText(msg: any): string {
  const payload = messagePayload(msg);
  const text = messageText(msg)
    || pickText(msg, ['content.text', 'text', 'message', 'msg'])
    || pickText(payload, ['text', 'content', 'message.text', 'msg.text'])
    || '[空消息]';
  const trimmed = String(text).trim();
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    const url = pickText(payload, ['url', 'mediaUrl', 'audioUrl', 'videoUrl', 'message.url', 'msg.url']);
    if (url) {
      const type = String(msg.msgType || payload?.msgType || payload?.type || '').toUpperCase();
      if (type.includes('AUDIO') || /\.(mp3|m4a|aac|amr|wav)(\?|$)/i.test(url)) return '[语音消息]';
      if (type.includes('VIDEO') || /\.(mp4|mov|m4v|3gp)(\?|$)/i.test(url)) return '[视频消息]';
      if (type.includes('IMAGE') || /\.(jpe?g|png|webp|gif)(\?|$)/i.test(url)) return '[图片消息]';
      return '[媒体消息]';
    }
  }
  return text;
}

function privateMessageMedia(msg: any): { url: string; type: 'audio' | 'video' | 'image' | 'link'; title: string } | null {
  const payload = messagePayload(msg);
  const rawUrl = pickText(payload, [
    'url',
    'mediaUrl',
    'audioUrl',
    'videoUrl',
    'imageUrl',
    'message.url',
    'msg.url',
    'content.url',
  ]);
  if (!rawUrl) return null;
  const typeText = String(msg.msgType || msg.messageType || payload?.msgType || payload?.messageType || payload?.type || '').toUpperCase();
  let url = normalizeUrl(rawUrl);
  const lowerRaw = String(rawUrl).toLowerCase();
  if (!/^https?:\/\//i.test(url)) {
    const prefix = typeText.includes('IMAGE') || /\.(jpe?g|png|webp|gif)(\?|$)/i.test(lowerRaw)
      ? 'https://source3.48.cn'
      : 'https://mp4.48.cn';
    url = `${prefix}${String(rawUrl).startsWith('/') ? '' : '/'}${rawUrl}`;
  }
  const lower = url.toLowerCase();
  const type = typeText.includes('AUDIO') || /\.(mp3|m4a|aac|amr|wav)(\?|$)/i.test(lower)
    ? 'audio'
    : typeText.includes('VIDEO') || /\.(mp4|mov|m4v|3gp)(\?|$)/i.test(lower)
      ? 'video'
      : typeText.includes('IMAGE') || /\.(jpe?g|png|webp|gif)(\?|$)/i.test(lower)
        ? 'image'
        : 'link';
  return {
    url,
    type,
    title: type === 'audio' ? '语音消息' : type === 'video' ? '视频消息' : type === 'image' ? '图片消息' : '打开链接',
  };
}

function newestFirst<T>(list: T[], timeOf: (item: T) => number): T[] {
  return list.slice().sort((a, b) => timeOf(b) - timeOf(a));
}

function oldestFirst<T>(list: T[], timeOf: (item: T) => number): T[] {
  return list.slice().sort((a, b) => timeOf(a) - timeOf(b));
}

function normalizeFlipPrices(res: any): any[] {
  return unwrapList(res, ['content.customs', 'content.list', 'content.data.customs', 'data.customs', 'customs', 'list']);
}

function flipTypeName(value: any) {
  const id = Number(value);
  if (id === 1) return '文字';
  if (id === 2) return '语音';
  if (id === 3) return '视频';
  return `类型${value || ''}`;
}

function lowestPrice(item: any) {
  const values = [item.normalCost, item.privateCost, item.anonymityCost]
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value >= 0);
  return values.length ? Math.min(...values) : 0;
}

export default function PrivateMessagesScreen() {
  const navigation = useNavigation();
  const isDark = useSettingsStore((state) => state.settings.theme === 'dark');
  const members = useMemberStore((state) => state.members);
  const showToast = useUiStore((state) => state.showToast);
  const [conversations, setConversations] = useState<any[]>([]);
  const [selectedConv, setSelectedConv] = useState<any>(null);
  const [detail, setDetail] = useState<any[]>([]);
  const [replyText, setReplyText] = useState('');
  const [currentUserId, setCurrentUserId] = useState('');
  const [flipPrices, setFlipPrices] = useState<any[]>([]);
  const [money, setMoney] = useState('');
  const [flipLoading, setFlipLoading] = useState(false);
  const [loading, setLoading] = useState(false);

  const flipMember = useMemo(() => {
    if (!selectedConv) return null;
    const targetId = convTargetId(selectedConv);
    return members.find((item: any) => String(item.id) === targetId || String(item.userId) === targetId || String(item.memberId) === targetId) || null;
  }, [members, selectedConv]);

  useEffect(() => {
    let alive = true;
    async function loadFlipPrompt() {
      if (!flipMember) {
        setFlipPrices([]);
        setMoney('');
        return;
      }
      setFlipLoading(true);
      try {
        const [priceRes, moneyRes] = await Promise.all([
          pocketApi.getFlipPrices(String(flipMember.id)),
          pocketApi.getUserMoney().catch(() => null),
        ]);
        if (!alive) return;
        setFlipPrices(normalizeFlipPrices(priceRes));
        setMoney(pickText(moneyRes, ['content.money', 'content.balance', 'content.userMoney', 'data.money', 'money', 'balance']));
      } catch (error) {
        if (alive) showToast(`翻牌配置读取失败：${errorMessage(error)}`);
        setFlipPrices([]);
      } finally {
        if (alive) setFlipLoading(false);
      }
    }
    loadFlipPrompt();
    return () => { alive = false; };
  }, [flipMember, showToast]);

  const loadConversations = useCallback(async () => {
    setLoading(true);
    showToast('正在加载私信列表...');
    try {
      const res = await pocketApi.getPrivateMessageList();
      const list = unwrapList(res, ['content.userMessageList', 'content.list', 'content.data', 'data.userMessageList', 'userMessageList', 'list']);
      setConversations(newestFirst(list, (item) => Number(item.lastTime || item.msgTime || item.ctime || item.time || 0)));
      showToast(`加载完成：${list.length} 个会话`);
    } catch (error) {
      showToast(`加载失败：${errorMessage(error)}`);
      setConversations([]);
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  const openConversation = async (conv: any) => {
    setSelectedConv(conv);
    setLoading(true);
    showToast('正在加载会话...');
    try {
      if (!currentUserId) {
        const info = await pocketApi.getNimLoginInfo().catch(() => null);
        const id = pickText(info, ['content.userInfo.userId', 'content.userId', 'content.id', 'userId', 'id']);
        if (id) setCurrentUserId(String(id));
      }
      const res = await pocketApi.getPrivateMessageDetail(convTargetId(conv));
      const list = unwrapList(res, ['content.messageList', 'content.messages', 'content.list', 'content.data', 'data.messageList', 'messageList', 'list']);
      setDetail(oldestFirst(list, msgTimeNumber));
      showToast(`加载完成：${list.length} 条消息`);
    } catch (error) {
      showToast(`加载失败：${errorMessage(error)}`);
      setDetail([]);
    } finally {
      setLoading(false);
    }
  };

  const sendReply = async () => {
    if (!replyText.trim() || !selectedConv) return;
    setLoading(true);
    try {
      await pocketApi.sendPrivateMessageReply(convTargetId(selectedConv), replyText.trim());
      setReplyText('');
      showToast('已发送');
      await openConversation(selectedConv);
    } catch (error) {
      showToast(`发送失败：${errorMessage(error)}`);
    } finally {
      setLoading(false);
    }
  };

  if (selectedConv) {
    const targetId = convTargetId(selectedConv);
    return (
      <View style={[styles.container, isDark && styles.containerDark]}>
        <View style={[styles.header, isDark && styles.headerDark]}>
          <TouchableOpacity onPress={() => setSelectedConv(null)}>
            <Text style={styles.backBtn}>返回列表</Text>
          </TouchableOpacity>
          <Text style={[styles.title, isDark && styles.textLight]} numberOfLines={1}>{convName(selectedConv)}</Text>
          <View style={styles.headerSide} />
        </View>
        <FlatList
          data={detail}
          keyExtractor={(item, index) => msgId(item, index)}
          renderItem={({ item, index }) => {
            const mine = isMineMessage(item, targetId, currentUserId);
            const media = privateMessageMedia(item);
            const text = privateMessageText(item);
            const hasText = text && !/^\[(语音|视频|图片|媒体|链接)消息\]$/.test(text);
            return (
              <View style={[styles.msgRow, mine && styles.msgRowMine]}>
                <View style={[styles.msgBubble, mine && styles.msgBubbleMine, isDark && !mine && styles.msgBubbleDark]}>
                  <Text style={[styles.msgAuthor, mine && styles.msgAuthorMine]}>{mine ? '我' : convName(selectedConv)}</Text>
                  {hasText ? (
                    <Text style={[styles.msgText, mine && styles.msgTextMine, isDark && !mine && styles.textLight]}>
                      {text}
                    </Text>
                  ) : null}
                  {media ? (
                    media.type === 'link' ? (
                      <TouchableOpacity style={styles.mediaCard} onPress={() => Linking.openURL(media.url).catch(() => showToast('链接无法打开'))}>
                        <Text style={[styles.mediaTitle, mine && styles.msgTextMine]} numberOfLines={1}>{media.title}</Text>
                        <Text style={[styles.mediaUrl, mine && styles.msgTimeMine]} numberOfLines={1}>{media.url}</Text>
                      </TouchableOpacity>
                    ) : media.type === 'image' ? (
                      <Image source={{ uri: media.url }} style={styles.inlineImage} resizeMode="cover" />
                    ) : (
                      <View style={styles.mediaCard}>
                        <Text style={[styles.mediaTitle, mine && styles.msgTextMine]}>{media.title}</Text>
                        <Video
                          source={{ uri: media.url }}
                          style={media.type === 'audio' ? styles.inlineAudio : styles.inlineVideo}
                          controls
                          paused
                          resizeMode="contain"
                          ignoreSilentSwitch="ignore"
                        />
                      </View>
                    )
                  ) : !hasText ? (
                    <Text style={[styles.msgText, mine && styles.msgTextMine, isDark && !mine && styles.textLight]}>[空消息]</Text>
                  ) : null}
                  <Text style={[styles.msgTime, mine && styles.msgTimeMine]}>{formatTimestamp(msgTime(item))}</Text>
                </View>
              </View>
            );
          }}
          ListEmptyComponent={<Text style={styles.empty}>{loading ? '加载中...' : '暂无私信'}</Text>}
        />
        {flipMember ? (
          <View style={[styles.flipPanel, isDark && styles.flipPanelDark]}>
            <Text style={[styles.flipPanelTitle, isDark && styles.textLight]}>
              {flipLoading ? '正在读取翻牌配置...' : `${flipMember.ownerName || convName(selectedConv)} 翻牌`}
            </Text>
            <Text style={[styles.flipMeta, isDark && styles.textSubLight]}>
              鸡腿余额：{money || '--'} · {flipPrices.length ? `已开放 ${flipPrices.length} 种形式` : '暂无开放翻牌形式'}
            </Text>
            {flipPrices.length ? (
              <View style={styles.flipTypeRow}>
                {flipPrices.slice(0, 4).map((item, index) => (
                  <View key={`${item.answerType || index}`} style={styles.flipChip}>
                    <Text style={styles.flipChipText}>{flipTypeName(item.answerType)} · {lowestPrice(item)}鸡腿起</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        ) : null}
        <View style={[styles.replyBar, isDark && styles.replyBarDark]}>
          <TextInput
            style={[styles.replyInput, isDark && styles.replyInputDark]}
            placeholder="输入回复..."
            placeholderTextColor="#5a5a5a"
            value={replyText}
            onChangeText={setReplyText}
          />
          <TouchableOpacity style={styles.sendBtn} onPress={sendReply} disabled={loading}>
            <Text style={styles.sendBtnText}>发送</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, isDark && styles.containerDark]}>
      <View style={[styles.header, isDark && styles.headerDark]}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backBtn}>返回</Text>
        </TouchableOpacity>
        <Text style={[styles.title, isDark && styles.textLight]}>私信列表</Text>
        <TouchableOpacity onPress={loadConversations} style={styles.refresh}>
          <Text style={styles.refreshText}>刷新</Text>
        </TouchableOpacity>
      </View>
      <FlatList
        data={conversations}
        keyExtractor={(item, index) => String(convTargetId(item) || index)}
        renderItem={({ item }) => (
          <TouchableOpacity style={[styles.convItem, isDark && styles.convItemDark]} onPress={() => openConversation(item)}>
            <View style={styles.convInfo}>
              <Text style={[styles.convName, isDark && styles.textLight]}>{convName(item)}</Text>
              <Text style={styles.convPreview} numberOfLines={1}>{item.newestMessage || messageText(item) || '点击查看会话'}</Text>
            </View>
            {Number(item.noreadNum) > 0 ? (
              <View style={styles.unreadBadge}>
                <Text style={styles.unreadText}>{item.noreadNum}</Text>
              </View>
            ) : null}
          </TouchableOpacity>
        )}
        ListEmptyComponent={<Text style={styles.empty}>{loading ? '加载中...' : '点击刷新获取私信列表'}</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  containerDark: { backgroundColor: 'transparent' },
  header: { paddingTop: 54, paddingHorizontal: 20, paddingBottom: 14, marginBottom: 4, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  headerDark: {},
  backBtn: { color: '#ff6f91', fontSize: 14, minWidth: 54 },
  title: { flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '800', color: '#ff6f91' },
  headerSide: { width: 54 },
  refresh: { padding: 6 },
  refreshText: { color: '#ff6f91', fontSize: 13 },
  status: { marginHorizontal: 16, marginTop: 10, color: '#444', fontSize: 12 },
  convItem: { padding: 14, backgroundColor: 'rgba(255,255,255,0.46)', marginHorizontal: 16, marginVertical: 4, borderRadius: 16, flexDirection: 'row', alignItems: 'center' },
  convItemDark: { backgroundColor: 'rgba(20,20,20,0.58)' },
  convInfo: { flex: 1 },
  convName: { fontSize: 15, fontWeight: '700', color: '#333' },
  convPreview: { fontSize: 12, color: '#333333', marginTop: 4 },
  unreadBadge: { backgroundColor: '#ff4444', borderRadius: 16, minWidth: 20, height: 20, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  unreadText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  msgRow: { paddingHorizontal: 12, marginVertical: 4, alignItems: 'flex-start' },
  msgRowMine: { alignItems: 'flex-end' },
  msgBubble: { maxWidth: '82%', padding: 10, backgroundColor: 'rgba(255,255,255,0.46)', borderRadius: 18 },
  msgBubbleMine: { backgroundColor: '#ff6f91' },
  msgBubbleDark: { backgroundColor: 'rgba(42,42,42,0.52)' },
  msgAuthor: { fontSize: 11, color: '#ff6f91', fontWeight: '800', marginBottom: 4 },
  msgAuthorMine: { color: '#fff' },
  msgText: { fontSize: 14, color: '#333', lineHeight: 20 },
  msgTextMine: { color: '#fff' },
  msgTime: { fontSize: 10, color: '#333333', marginTop: 6 },
  msgTimeMine: { color: '#ffe8ef' },
  mediaCard: { marginTop: 6, minWidth: 210, borderRadius: 14, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.20)' },
  mediaTitle: { paddingHorizontal: 10, paddingTop: 8, paddingBottom: 6, color: '#333', fontSize: 12, fontWeight: '800' },
  mediaUrl: { paddingHorizontal: 10, paddingBottom: 8, color: '#555', fontSize: 10 },
  inlineAudio: { height: 52, minWidth: 220, backgroundColor: 'rgba(0,0,0,0.12)' },
  inlineVideo: { height: 180, minWidth: 230, backgroundColor: '#000' },
  inlineImage: { width: 220, height: 220, marginTop: 6, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.12)' },
  flipPanel: { marginHorizontal: 10, marginBottom: 8, padding: 10, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.72)' },
  flipPanelDark: { backgroundColor: 'rgba(20,20,20,0.68)' },
  flipPanelTitle: { color: '#333333', fontSize: 13, fontWeight: '800' },
  flipMeta: { color: '#555555', fontSize: 12, marginTop: 4 },
  flipTypeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  flipChip: { paddingHorizontal: 9, paddingVertical: 6, borderRadius: 12, backgroundColor: '#ff6f91' },
  flipChipText: { color: '#ffffff', fontSize: 11, fontWeight: '800' },
  replyBar: { flexDirection: 'row', padding: 10, backgroundColor: 'rgba(255,255,255,0.46)', borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.42)', alignItems: 'center' },
  replyBarDark: { backgroundColor: 'rgba(20,20,20,0.58)', borderTopColor: 'rgba(255,255,255,0.12)' },
  replyInput: { flex: 1, padding: 10, borderRadius: 20, borderWidth: 1, borderColor: '#ddd', color: '#333', marginRight: 8, fontSize: 14 },
  replyInputDark: { backgroundColor: 'rgba(42,42,42,0.52)', borderColor: '#444', color: '#eeeeee' },
  sendBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, backgroundColor: '#ff6f91' },
  sendBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  textLight: { color: '#eee' },
  textSubLight: { color: '#dddddd' },
  empty: { textAlign: 'center', color: '#333333', marginTop: 60, fontSize: 14 },
});
