import React, { useMemo, useState } from 'react';
import {
  View, Text, TextInput, FlatList, TouchableOpacity, StyleSheet, Modal,
} from 'react-native';
import { useSettingsStore, useMemberStore, useUiStore } from '../store';
import { Member } from '../types';
import { formatTimestamp } from '../utils/format';
import { errorMessage, messageText, unwrapList } from '../utils/data';
import { pinyinInitials } from '../utils/members';
import pocketApi from '../api/pocket48';

function msgTime(item: any): number {
  const value = Number(item.msgTime || item.messageTime || item.ctime || item.time || item.createTime || 0);
  return Number.isFinite(value) ? value : 0;
}

export default function MessagesScreen() {
  const isDark = useSettingsStore((state) => state.settings.theme === 'dark');
  const members = useMemberStore((state) => state.members);
  const token = useSettingsStore((state) => state.settings.p48Token);
  const showToast = useUiStore((state) => state.showToast);
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState('');

  const pickerList = useMemo(() => {
    const query = pickerQuery.trim().toLowerCase();
    return (query
      ? members.filter((member) => `${member.ownerName} ${member.pinyin} ${pinyinInitials(member.pinyin)} ${member.team}`.toLowerCase().includes(query))
      : members
    ).slice(0, 80);
  }, [members, pickerQuery]);

  const fetchMessages = async (member: Member) => {
    if (!token) {
      showToast('请先在账号设置里登录口袋48或粘贴 Token');
      return;
    }
    setSelectedMember(member);
    setLoading(true);
    showToast('正在加载房间消息...');
    try {
      const res = await pocketApi.getRoomMessages({
        channelId: member.channelId,
        serverId: member.serverId,
        nextTime: 0,
        fetchAll: true,
      });
      const list = unwrapList(res, ['content.messageList', 'content.message', 'content.list', 'data.messageList', 'data.message', 'messageList', 'message', 'list']);
      setMessages(list.slice().sort((a, b) => msgTime(b) - msgTime(a)));
      showToast(`已加载 ${list.length} 条消息`);
    } catch (error) {
      showToast(`加载失败：${errorMessage(error)}`);
      setMessages([]);
    } finally {
      setLoading(false);
    }
  };

  const filtered = messages.filter((item) => {
    const body = messageText(item);
    return !search || body.includes(search) || String(item.senderName || '').includes(search);
  });

  return (
    <View style={[styles.container, isDark && styles.containerDark]}>
      <View style={[styles.header, isDark && styles.headerDark]}>
        <Text style={styles.title}>消息检索</Text>
        <TouchableOpacity style={[styles.picker, isDark && styles.pickerDark]} onPress={() => setPickerOpen(true)}>
          <Text style={{ color: isDark ? '#eeeeee' : '#333', flex: 1 }}>
            {selectedMember?.ownerName || `选择成员 (${members.length})`}
          </Text>
          <Text style={{ color: '#333333' }}>选择</Text>
        </TouchableOpacity>
        <TextInput
          style={[styles.input, isDark && styles.inputDark]}
          placeholder="搜索消息内容..."
          placeholderTextColor="#5a5a5a"
          value={search}
          onChangeText={setSearch}
        />
      </View>

      <Modal visible={pickerOpen} animationType="slide">
        <View style={[styles.modalContainer, isDark && styles.containerDark]}>
          <View style={[styles.modalHeader, isDark && styles.headerDark]}>
            <TouchableOpacity onPress={() => setPickerOpen(false)}>
              <Text style={styles.modalBack}>关闭</Text>
            </TouchableOpacity>
            <Text style={[styles.modalTitle, isDark && { color: '#eee' }]}>选择成员</Text>
            <Text style={{ color: '#333333', fontSize: 12 }}>{members.length} 位</Text>
          </View>
          <TextInput
            style={[styles.input, isDark && styles.inputDark, { margin: 12 }]}
            placeholder="搜索成员..."
            placeholderTextColor="#5a5a5a"
            value={pickerQuery}
            onChangeText={setPickerQuery}
          />
          <FlatList
            data={pickerList}
            keyExtractor={(item) => `${item.id}-${item.channelId}`}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[styles.memberItem, isDark && styles.memberItemDark]}
                onPress={() => {
                  setPickerOpen(false);
                  fetchMessages(item);
                }}
              >
                <Text style={[styles.memberName, isDark && { color: '#eee' }]}>{item.ownerName}</Text>
                <Text style={styles.memberTeam}>{item.team || item.groupName || ''}</Text>
              </TouchableOpacity>
            )}
            ListEmptyComponent={<Text style={styles.empty}>成员列表为空</Text>}
          />
        </View>
      </Modal>

      <FlatList
        data={filtered}
        keyExtractor={(item, index) => String(item.id || item.msgId || item.messageId || index)}
        renderItem={({ item }) => (
          <View style={[styles.msg, isDark && styles.msgDark]}>
            <View style={styles.msgHeader}>
              <Text style={[styles.msgSender, isDark && { color: '#eee' }]}>{item.senderName || item.senderNickName || '成员'}</Text>
              <Text style={styles.msgTime}>{formatTimestamp(item.msgTime || item.time || item.ctime)}</Text>
            </View>
            <Text style={[styles.msgBody, isDark && { color: '#eeeeee' }]}>{messageText(item) || '[空消息]'}</Text>
          </View>
        )}
        ListEmptyComponent={<Text style={styles.empty}>{loading ? '加载中...' : selectedMember ? '暂无消息' : '请选择成员'}</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  containerDark: { backgroundColor: 'transparent' },
  header: { paddingTop: 54, paddingHorizontal: 20, paddingBottom: 14, marginBottom: 4 },
  title: { fontSize: 22, fontWeight: '800', color: '#ff6f91', marginBottom: 12 },
  picker: { flexDirection: 'row', alignItems: 'center', padding: 10, borderRadius: 18, borderWidth: 1, borderColor: 'rgba(255,255,255,0.52)', backgroundColor: 'rgba(255,255,255,0.50)', marginBottom: 8 },
  pickerDark: { backgroundColor: 'rgba(42,42,42,0.52)', borderColor: '#444' },
  input: { padding: 10, borderRadius: 18, borderWidth: 1, borderColor: 'rgba(255,255,255,0.52)', backgroundColor: 'rgba(255,255,255,0.50)', color: '#333', marginBottom: 8 },
  inputDark: { backgroundColor: 'rgba(42,42,42,0.52)', borderColor: '#444', color: '#eeeeee' },
  headerDark: {},
  status: { color: '#8a5a00', backgroundColor: '#fff3cd', padding: 8, borderRadius: 18, fontSize: 12, lineHeight: 18 },
  modalContainer: { flex: 1, backgroundColor: 'transparent', paddingTop: 50 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginHorizontal: 42, marginBottom: 12, paddingVertical: 14, paddingHorizontal: 18, backgroundColor: 'rgba(255,255,255,0.58)', borderRadius: 26, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.64)' },
  modalBack: { color: '#ff6f91', fontSize: 14 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: '#333' },
  memberItem: { flexDirection: 'row', justifyContent: 'space-between', padding: 14, backgroundColor: 'rgba(255,255,255,0.46)', marginHorizontal: 12, marginVertical: 2, borderRadius: 18 },
  memberItemDark: { backgroundColor: 'rgba(20,20,20,0.58)' },
  memberName: { fontSize: 14, color: '#333' },
  memberTeam: { fontSize: 11, color: '#333333' },
  msg: { padding: 12, backgroundColor: 'rgba(255,255,255,0.46)', marginHorizontal: 12, marginVertical: 3, borderRadius: 18 },
  msgDark: { backgroundColor: 'rgba(20,20,20,0.58)' },
  msgHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  msgSender: { fontSize: 13, fontWeight: '700', color: '#333' },
  msgTime: { fontSize: 11, color: '#333333' },
  msgBody: { fontSize: 14, color: '#555', lineHeight: 20 },
  empty: { textAlign: 'center', color: '#333333', marginTop: 60, fontSize: 14 },
});
