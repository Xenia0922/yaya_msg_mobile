import React, { useState } from 'react';
import {
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import MemberPicker from '../components/MemberPicker';
import pocketApi from '../api/pocket48';
import { useSettingsStore } from '../store';
import { Member } from '../types';
import { errorMessage, messageText, unwrapList } from '../utils/data';
import { formatTimestamp } from '../utils/format';

type MessageMode = 'all' | 'owner';
type RoomMode = 'big' | 'small';

function normalizeMessages(res: any): any[] {
  return unwrapList(res, [
    'content.messageList',
    'content.message',
    'content.messages',
    'content.list',
    'content.data',
    'data.content.messageList',
    'data.content.message',
    'data.messageList',
    'data.message',
    'data.list',
    'messageList',
    'message',
    'messages',
    'list',
  ]);
}

function getChannelId(member: Member, roomMode: RoomMode): string {
  if (roomMode === 'small') return String(member.yklzId || member.channelId || '');
  return String(member.channelId || '');
}

export default function FetchScreen() {
  const navigation = useNavigation();
  const isDark = useSettingsStore((state) => state.settings.theme === 'dark');
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [messageMode, setMessageMode] = useState<MessageMode>('all');
  const [roomMode, setRoomMode] = useState<RoomMode>('big');
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');

  const fetchOnce = async (member: Member, targetRoomMode: RoomMode) => {
    const channelId = getChannelId(member, targetRoomMode);
    if (!channelId) throw new Error(targetRoomMode === 'small' ? '该成员没有小房间 channelId' : '该成员没有房间 channelId');
    const res = await pocketApi.getRoomMessages({
      channelId,
      serverId: member.serverId,
      nextTime: 0,
      fetchAll: messageMode === 'all',
    });
    return normalizeMessages(res);
  };

  const startFetch = async () => {
    if (!selectedMember) {
      setStatus('请先选择成员');
      return;
    }
    setLoading(true);
    setStatus('抓取中...');
    setResults([]);
    try {
      let list = await fetchOnce(selectedMember, roomMode);
      let usedRoomMode = roomMode;

      if (!list.length && roomMode === 'big' && selectedMember.yklzId) {
        setStatus('大房间没有返回消息，正在尝试小房间...');
        list = await fetchOnce(selectedMember, 'small');
        usedRoomMode = 'small';
      }

      setResults(list);
      setStatus(`抓取完成：${list.length} 条消息 · ${usedRoomMode === 'small' ? '小房间' : '大房间'} · ${messageMode === 'all' ? '全部消息' : '成员消息'}`);
    } catch (error) {
      setStatus(`抓取失败：${errorMessage(error)}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={[styles.container, isDark && styles.containerDark]}>
      <View style={[styles.header, isDark && styles.headerDark]}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backBtn}>返回</Text>
        </TouchableOpacity>
        <Text style={[styles.title, isDark && styles.textDark]}>抓取消息</Text>
      </View>

      <View style={styles.section}>
        <MemberPicker selectedMember={selectedMember} onSelect={setSelectedMember} />
      </View>

      <View style={styles.section}>
        <View style={styles.row}>
          <TouchableOpacity style={[styles.modeBtn, messageMode === 'all' && styles.modeBtnActive]} onPress={() => setMessageMode('all')}>
            <Text style={[styles.modeText, messageMode === 'all' && styles.modeTextActive]}>全部消息</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.modeBtn, messageMode === 'owner' && styles.modeBtnActive]} onPress={() => setMessageMode('owner')}>
            <Text style={[styles.modeText, messageMode === 'owner' && styles.modeTextActive]}>成员消息</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.row}>
          <TouchableOpacity style={[styles.modeBtn, roomMode === 'big' && styles.modeBtnActive]} onPress={() => setRoomMode('big')}>
            <Text style={[styles.modeText, roomMode === 'big' && styles.modeTextActive]}>大房间</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.modeBtn, roomMode === 'small' && styles.modeBtnActive]} onPress={() => setRoomMode('small')}>
            <Text style={[styles.modeText, roomMode === 'small' && styles.modeTextActive]}>小房间</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={[styles.fetchBtn, loading && styles.fetchBtnDisabled]} onPress={startFetch} disabled={loading}>
          <Text style={styles.fetchBtnText}>{loading ? '抓取中...' : '开始抓取'}</Text>
        </TouchableOpacity>
        {status ? <Text style={[styles.status, isDark && styles.textSubDark]}>{status}</Text> : null}
      </View>

      <FlatList
        data={results}
        keyExtractor={(item, index) => String(item.id || item.msgId || item.messageId || item.clientMsgId || index)}
        renderItem={({ item }) => (
          <View style={[styles.msgItem, isDark && styles.msgItemDark]}>
            <Text style={[styles.msgTime, isDark && styles.textSubDark]}>
              {formatTimestamp(item.msgTime || item.time || item.ctime)}
            </Text>
            <Text style={[styles.msgText, isDark && styles.textDark]}>
              {(item.senderName || item.senderNickName || item.extInfo?.user?.nickName || '成员')}: {messageText(item) || '[空消息]'}
            </Text>
          </View>
        )}
        ListEmptyComponent={!loading ? <Text style={styles.empty}>选择成员后开始抓取</Text> : null}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  containerDark: { backgroundColor: 'transparent' },
  header: { paddingTop: 54, paddingHorizontal: 20, paddingBottom: 14, marginBottom: 4 },
  headerDark: {},
  backBtn: { color: '#ff6f91', fontSize: 14, marginBottom: 6 },
  title: { fontSize: 22, fontWeight: '800', color: '#ff6f91' },
  section: { padding: 16 },
  row: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  modeBtn: { flex: 1, paddingVertical: 10, borderRadius: 18, backgroundColor: 'rgba(238,238,238,0.82)', alignItems: 'center' },
  modeBtnActive: { backgroundColor: '#ff6f91' },
  modeText: { fontSize: 13, color: '#444', fontWeight: '700' },
  modeTextActive: { color: '#fff' },
  fetchBtn: { padding: 14, borderRadius: 18, backgroundColor: '#ff6f91', alignItems: 'center' },
  fetchBtnDisabled: { opacity: 0.5 },
  fetchBtnText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  status: { marginTop: 10, textAlign: 'center', color: '#444', fontSize: 13, lineHeight: 18 },
  msgItem: { padding: 10, backgroundColor: 'rgba(255,255,255,0.46)', marginHorizontal: 16, marginVertical: 3, borderRadius: 18 },
  msgItemDark: { backgroundColor: 'rgba(20,20,20,0.58)' },
  msgTime: { fontSize: 11, color: '#333333', marginBottom: 4 },
  msgText: { fontSize: 13, color: '#333', lineHeight: 18 },
  textDark: { color: '#eee' },
  textSubDark: { color: '#eeeeee' },
  empty: { textAlign: 'center', color: '#333333', marginTop: 60, fontSize: 14 },
});
