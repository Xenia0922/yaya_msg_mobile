import React, { useCallback, useState } from 'react';
import {
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSettingsStore } from '../store';
import { formatTimestamp } from '../utils/format';
import { errorMessage, messagePayload, messageText, pickText, unwrapList } from '../utils/data';
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

function msgFromId(msg: any): string {
  return String(msg.fromUserId || msg.senderUserId || msg.senderId || msg.userId || msg.fromAccount || msg.sender?.userId || '');
}

function msgToId(msg: any): string {
  return String(msg.toUserId || msg.targetUserId || msg.receiverUserId || msg.receiveUserId || '');
}

function isMineMessage(msg: any, targetId: string, currentUserId = ''): boolean {
  if (msg.isSelf === true || msg.self === true || msg.isMe === true) return true;
  if (msg.isSelf === false || msg.self === false || msg.isMe === false) return false;
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
  return messageText(msg)
    || pickText(msg, ['content.text', 'text', 'message', 'msg'])
    || pickText(payload, ['text', 'content', 'message.text', 'msg.text'])
    || '[空消息]';
}

export default function PrivateMessagesScreen() {
  const navigation = useNavigation();
  const isDark = useSettingsStore((state) => state.settings.theme === 'dark');
  const [conversations, setConversations] = useState<any[]>([]);
  const [selectedConv, setSelectedConv] = useState<any>(null);
  const [detail, setDetail] = useState<any[]>([]);
  const [replyText, setReplyText] = useState('');
  const [currentUserId, setCurrentUserId] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');

  const loadConversations = useCallback(async () => {
    setLoading(true);
    setStatus('加载私信列表...');
    try {
      const res = await pocketApi.getPrivateMessageList();
      const list = unwrapList(res, ['content.userMessageList', 'content.list', 'content.data', 'data.userMessageList', 'userMessageList', 'list']);
      setConversations(list);
      setStatus(`加载完成：${list.length} 个会话`);
    } catch (error) {
      setStatus(`加载失败：${errorMessage(error)}`);
      setConversations([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const openConversation = async (conv: any) => {
    setSelectedConv(conv);
    setLoading(true);
    setStatus('加载会话...');
    try {
      if (!currentUserId) {
        pocketApi.getNimLoginInfo()
          .then((info) => {
            const id = pickText(info, ['content.userInfo.userId', 'content.userId', 'content.id', 'userId', 'id']);
            if (id) setCurrentUserId(String(id));
          })
          .catch(() => {});
      }
      const res = await pocketApi.getPrivateMessageDetail(convTargetId(conv));
      const list = unwrapList(res, ['content.messageList', 'content.messages', 'content.list', 'content.data', 'data.messageList', 'messageList', 'list']);
      setDetail(list.slice().reverse());
      setStatus(`加载完成：${list.length} 条消息`);
    } catch (error) {
      setStatus(`加载失败：${errorMessage(error)}`);
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
      setStatus('已发送');
      await openConversation(selectedConv);
    } catch (error) {
      setStatus(`发送失败：${errorMessage(error)}`);
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
        </View>
        {status ? <Text style={styles.status}>{status}</Text> : null}
        <FlatList
          data={detail}
          keyExtractor={(item, index) => msgId(item, index)}
          renderItem={({ item, index }) => {
            const mine = isMineMessage(item, targetId, currentUserId);
            return (
              <View style={[styles.msgRow, mine && styles.msgRowMine]}>
                <View style={[styles.msgBubble, mine && styles.msgBubbleMine, isDark && !mine && styles.msgBubbleDark]}>
                  <Text style={[styles.msgAuthor, mine && styles.msgAuthorMine]}>{mine ? '我' : convName(selectedConv)}</Text>
                  <Text style={[styles.msgText, mine && styles.msgTextMine, isDark && !mine && styles.textLight]}>
                    {privateMessageText(item)}
                  </Text>
                  <Text style={[styles.msgTime, mine && styles.msgTimeMine]}>{formatTimestamp(msgTime(item))}</Text>
                </View>
              </View>
            );
          }}
          ListEmptyComponent={<Text style={styles.empty}>{loading ? '加载中...' : '暂无私信'}</Text>}
        />
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
      {status ? <Text style={styles.status}>{status}</Text> : null}
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
  backBtn: { color: '#ff6f91', fontSize: 14 },
  title: { flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '800', color: '#ff6f91' },
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
  replyBar: { flexDirection: 'row', padding: 10, backgroundColor: 'rgba(255,255,255,0.46)', borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.42)', alignItems: 'center' },
  replyBarDark: { backgroundColor: 'rgba(20,20,20,0.58)', borderTopColor: 'rgba(255,255,255,0.12)' },
  replyInput: { flex: 1, padding: 10, borderRadius: 20, borderWidth: 1, borderColor: '#ddd', color: '#333', marginRight: 8, fontSize: 14 },
  replyInputDark: { backgroundColor: 'rgba(42,42,42,0.52)', borderColor: '#444', color: '#eeeeee' },
  sendBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, backgroundColor: '#ff6f91' },
  sendBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  textLight: { color: '#eee' },
  empty: { textAlign: 'center', color: '#333333', marginTop: 60, fontSize: 14 },
});
