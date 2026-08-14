import React, { useCallback, useMemo, useState } from 'react';
import { PerfFlatList } from '../components/PerfFlatList';

import {
  View, Text, TextInput, FlatList, TouchableOpacity, StyleSheet, Modal,
} from 'react-native';
import { useSettingsStore, useMemberStore, useUiStore } from '../store';
import { FadeInView } from '../components/Motion';
import ScreenHeader from '../components/ScreenHeader';
import { Member } from '../types';
import { formatTimestamp } from '../utils/format';
import { errorMessage, messageText, unwrapList } from '../utils/data';
import { memberSearchText } from '../utils/members';
import pocketApi from '../api/pocket48';
import { useAppTheme } from '../hooks/useAppTheme';
import { usePalette } from '../theme';
import { useI18n } from '../i18n';

function msgTime(item: any): number {
  const value = Number(item.msgTime || item.messageTime || item.ctime || item.time || item.createTime || 0);
  return Number.isFinite(value) ? value : 0;
}

export default function MessagesScreen() {
  const isDark = useAppTheme();
  const palette = usePalette();
  const { t } = useI18n();
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
      ? members.filter((member) => memberSearchText(member).includes(query))
      : members
    ).slice(0, 80);
  }, [members, pickerQuery]);

  const fetchMessages = async (member: Member) => {
    if (!token) {
      showToast(t('请先在账号设置里登录口袋48或粘贴 Token'));
      return;
    }
    setSelectedMember(member);
    setLoading(true);
    try {
      const res = await pocketApi.getRoomMessages({
        channelId: member.channelId,
        serverId: member.serverId,
        nextTime: 0,
        fetchAll: true,
      });
      const list = unwrapList(res, ['content.messageList', 'content.message', 'content.list', 'data.messageList', 'data.message', 'messageList', 'message', 'list']);
      setMessages(list.slice().sort((a, b) => msgTime(b) - msgTime(a)));
    } catch (error) {
      showToast(t('加载失败：{msg}', { msg: errorMessage(error) }));
      setMessages([]);
    } finally {
      setLoading(false);
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim();
    if (!q) return messages;
    return messages.filter((item) => {
      const body = messageText(item);
      return body.includes(q) || String(item.senderName || '').includes(q);
    });
  }, [messages, search]);

  const renderMsgItem = useCallback(({ item }: { item: any }) => (
    <View
      style={[
        styles.msg,
        {
          backgroundColor: palette.surfaceGlass,
          borderColor: palette.innerStroke,
          borderWidth: StyleSheet.hairlineWidth,
        },
      ]}
    >
      <View style={styles.msgHeader}>
        <Text style={[styles.msgSender, { color: palette.label }]}>{item.senderName || item.senderNickName || t('成员')}</Text>
        <Text style={[styles.msgTime, { color: palette.labelTertiary }]}>{formatTimestamp(item.msgTime || item.time || item.ctime)}</Text>
      </View>
      <Text style={[styles.msgBody, { color: palette.labelSecondary }]}>{messageText(item) || t('[空消息]')}</Text>
    </View>
  ), [palette, t]);

  return (
    <View style={[styles.container, isDark && styles.containerDark]}>
      <ScreenHeader title={t('消息检索')} />
      <TouchableOpacity
        style={[
          styles.picker,
          { backgroundColor: palette.surfaceGlass, borderColor: palette.innerStroke, borderWidth: StyleSheet.hairlineWidth },
        ]}
        onPress={() => setPickerOpen(true)}
      >
        <Text style={[styles.pickerLabel, { color: palette.label }]}>
          {selectedMember?.ownerName || t('选择成员 ({count})', { count: members.length })}
        </Text>
        <Text style={[styles.pickerButtonText, { color: palette.tint, fontWeight: '700' }]}>{t('选择')}</Text>
      </TouchableOpacity>
      <TextInput
        style={[
          styles.input,
          { backgroundColor: palette.surfaceGlassStrong, borderColor: palette.innerStroke, borderWidth: StyleSheet.hairlineWidth, color: palette.label },
        ]}
        placeholder={t('搜索消息内容...')}
        placeholderTextColor={palette.labelTertiary}
        value={search}
        onChangeText={setSearch}
      />

      <Modal visible={pickerOpen} animationType="slide">
        <View style={[styles.modalContainer, { backgroundColor: palette.background }]}>
          <View
            style={[
              styles.modalHeader,
              { backgroundColor: palette.surfaceGlassStrong, borderColor: palette.innerStroke, borderWidth: StyleSheet.hairlineWidth },
            ]}
          >
            <TouchableOpacity onPress={() => setPickerOpen(false)}>
              <Text style={[styles.modalBack, { color: palette.tint }]}>{t('关闭')}</Text>
            </TouchableOpacity>
            <Text style={[styles.modalTitle, { color: palette.label }]}>{t('选择成员')}</Text>
            <Text style={[styles.pickerCount, { color: palette.labelSecondary }]}>{t('{count} 位', { count: members.length })}</Text>
          </View>
          <TextInput
            style={[
              styles.input,
              { backgroundColor: palette.surfaceGlassStrong, borderColor: palette.innerStroke, borderWidth: StyleSheet.hairlineWidth, color: palette.label, margin: 12 },
            ]}
            placeholder={t('搜索成员...')}
            placeholderTextColor={palette.labelTertiary}
            value={pickerQuery}
            onChangeText={setPickerQuery}
          />
          <PerfFlatList
            data={pickerList}
            keyExtractor={(item) => `${item.id}-${item.channelId}`}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[
                  styles.memberItem,
                  { backgroundColor: palette.surfaceGlass, borderColor: palette.innerStroke, borderWidth: StyleSheet.hairlineWidth },
                ]}
                onPress={() => {
                  setPickerOpen(false);
                  fetchMessages(item);
                }}
              >
                <Text style={[styles.memberName, { color: palette.label }]}>{item.ownerName}</Text>
                <Text style={[styles.memberTeam, { color: palette.labelSecondary }]}>{item.team || item.groupName || ''}</Text>
              </TouchableOpacity>
            )}
            ListEmptyComponent={<Text style={[styles.empty, { color: palette.labelTertiary }]}>{t('成员列表为空')}</Text>}
          />
        </View>
      </Modal>

      <FadeInView delay={80} duration={300} style={{ flex: 1 }}>
        <PerfFlatList
          data={filtered}
          keyExtractor={(item, index) => String(item.id || item.msgId || item.messageId || index)}
          renderItem={renderMsgItem}
          initialNumToRender={12}
          maxToRenderPerBatch={12}
          windowSize={7}
          removeClippedSubviews
        />
      </FadeInView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  containerDark: { backgroundColor: 'transparent' },
  pickerLabel: { color: '#333', flex: 1 },
  pickerButtonText: { color: '#333333' },
  pickerCount: { color: '#333333', fontSize: 12 },
  picker: { flexDirection: 'row', alignItems: 'center', padding: 10, borderRadius: 18, borderWidth: 1, borderColor: 'rgba(255,255,255,0.52)', backgroundColor: '#FFFFFF', marginBottom: 8 },
  pickerDark: { backgroundColor: '#1C1C1F', borderColor: '#444' },
  input: { padding: 10, borderRadius: 18, borderWidth: 1, borderColor: 'rgba(255,255,255,0.52)', backgroundColor: '#FFFFFF', color: '#333', marginBottom: 8 },
  inputDark: { backgroundColor: '#1C1C1F', borderColor: '#444', color: '#eeeeee' },
  status: { color: '#8a5a00', backgroundColor: '#fff3cd', padding: 8, borderRadius: 18, fontSize: 12, lineHeight: 18 },
  modalContainer: { flex: 1, backgroundColor: 'transparent', paddingTop: 50 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginHorizontal: 42, marginBottom: 12, paddingVertical: 14, paddingHorizontal: 18, backgroundColor: '#FFFFFF', borderRadius: 26, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.64)' },
  modalHeaderDark: { backgroundColor: '#1C1C1F', borderColor: 'rgba(255,255,255,0.14)' },
  modalBack: { color: '#ff6f91', fontSize: 14 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: '#333' },
  memberItem: { flexDirection: 'row', justifyContent: 'space-between', padding: 14, backgroundColor: '#FFFFFF', marginHorizontal: 12, marginVertical: 2, borderRadius: 18 },
  memberItemDark: { backgroundColor: '#1C1C1F' },
  memberName: { fontSize: 14, color: '#333' },
  memberTeam: { fontSize: 11, color: '#333333' },
  memberTeamDark: { color: '#aaa' },
  msg: { padding: 12, backgroundColor: '#FFFFFF', marginHorizontal: 12, marginVertical: 3, borderRadius: 18 },
  msgDark: { backgroundColor: '#1C1C1F' },
  msgHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  msgSender: { fontSize: 13, fontWeight: '700', color: '#333' },
  msgTime: { fontSize: 11, color: '#333333' },
  msgTimeDark: { color: '#aaa' },
  msgBody: { fontSize: 14, color: '#555', lineHeight: 20 },
  empty: { textAlign: 'center', color: '#333333', marginTop: 60, fontSize: 14 },
  emptyDark: { color: '#aaa' },
  textLight: { color: '#eeeeee' },
});
