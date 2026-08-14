import React, { useState } from 'react';
import { PerfFlatList } from '../components/PerfFlatList';

import {
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import MemberPicker from '../components/MemberPicker';
import ScreenHeader from '../components/ScreenHeader';
import { useI18n } from '../i18n';
import pocketApi from '../api/pocket48';
import { useSettingsStore } from '../store';
import { FadeInView } from '../components/Motion';
import { Member } from '../types';
import { errorMessage, messageText, unwrapList } from '../utils/data';
import { formatTimestamp } from '../utils/format';
import { useAppTheme } from '../hooks/useAppTheme';

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
  const isDark = useAppTheme();
  const { t } = useI18n();
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [messageMode, setMessageMode] = useState<MessageMode>('all');
  const [roomMode, setRoomMode] = useState<RoomMode>('big');
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');

  const fetchOnce = async (member: Member, targetRoomMode: RoomMode) => {
    const channelId = getChannelId(member, targetRoomMode);
    if (!channelId) throw new Error(targetRoomMode === 'small' ? t('该成员没有小房间 channelId') : t('该成员没有房间 channelId'));
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
      setStatus(t('请先选择成员'));
      return;
    }
    setLoading(true);
    setStatus(t('抓取中...'));
    try {
      let list = await fetchOnce(selectedMember, roomMode);
      let usedRoomMode = roomMode;

      if (!list.length && roomMode === 'big' && selectedMember.yklzId) {
        setStatus(t('大房间没有返回消息，正在尝试小房间...'));
        list = await fetchOnce(selectedMember, 'small');
        usedRoomMode = 'small';
      }

      setResults(list);
      setStatus(t('抓取完成：{count} 条消息 · {room} · {mode}', {
        count: list.length,
        room: usedRoomMode === 'small' ? t('小房间') : t('大房间'),
        mode: messageMode === 'all' ? t('全部消息') : t('成员消息'),
      }));
    } catch (error) {
      setStatus(t('抓取失败：{error}', { error: errorMessage(error) }));
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={[styles.container, isDark && styles.containerDark]}>
      <ScreenHeader title={t('抓取消息')} />

      <FadeInView delay={80} duration={300} style={{ flex: 1 }}>
        <View style={[styles.section, isDark && styles.sectionDark]}>
          <MemberPicker selectedMember={selectedMember} onSelect={setSelectedMember} />
        </View>

        <View style={[styles.section, isDark && styles.sectionDark]}>
          <View style={styles.row}>
            <TouchableOpacity style={[styles.modeBtn, isDark && styles.modeBtnDark, messageMode === 'all' && styles.modeBtnActive]} onPress={() => setMessageMode('all')}>
              <Text style={[styles.modeText, isDark && styles.textDark, messageMode === 'all' && styles.modeTextActive]}>{t('全部消息')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.modeBtn, isDark && styles.modeBtnDark, messageMode === 'owner' && styles.modeBtnActive]} onPress={() => setMessageMode('owner')}>
              <Text style={[styles.modeText, isDark && styles.textDark, messageMode === 'owner' && styles.modeTextActive]}>{t('成员消息')}</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.row}>
            <TouchableOpacity style={[styles.modeBtn, isDark && styles.modeBtnDark, roomMode === 'big' && styles.modeBtnActive]} onPress={() => setRoomMode('big')}>
              <Text style={[styles.modeText, isDark && styles.textDark, roomMode === 'big' && styles.modeTextActive]}>{t('大房间')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.modeBtn, isDark && styles.modeBtnDark, roomMode === 'small' && styles.modeBtnActive]} onPress={() => setRoomMode('small')}>
              <Text style={[styles.modeText, isDark && styles.textDark, roomMode === 'small' && styles.modeTextActive]}>{t('小房间')}</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={[styles.fetchBtn, loading && styles.fetchBtnDisabled]} onPress={startFetch} disabled={loading}>
            <Text style={styles.fetchBtnText}>{loading ? t('抓取中...') : t('开始抓取')}</Text>
          </TouchableOpacity>
          {status ? <Text style={[styles.status, isDark && styles.textSubDark]}>{status}</Text> : null}
        </View>

        <PerfFlatList
          data={results}
          keyExtractor={(item, index) => String(item.id || item.msgId || item.messageId || item.clientMsgId || index)}
          initialNumToRender={12}
          maxToRenderPerBatch={12}
          windowSize={7}
          removeClippedSubviews
          renderItem={({ item, index }) => (
            <FadeInView delay={80 + index * 30} duration={300}>
              <View style={[styles.msgItem, isDark && styles.msgItemDark]}>
                <Text style={[styles.msgTime, isDark && styles.textSubDark]}>
                  {formatTimestamp(item.msgTime || item.time || item.ctime)}
                </Text>
                <Text style={[styles.msgText, isDark && styles.textDark]}>
                  {(item.senderName || item.senderNickName || item.extInfo?.user?.nickName || t('成员'))}: {messageText(item) || t('[空消息]')}
                </Text>
              </View>
            </FadeInView>
          )}
          ListEmptyComponent={!loading ? <Text style={[styles.empty, isDark && styles.textDark]}>{t('暂无数据')}</Text> : null}
        />
      </FadeInView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  containerDark: { backgroundColor: 'transparent' },
  section: { padding: 16 },
  sectionDark: { backgroundColor: '#1C1C1F' },
  row: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  modeBtn: { flex: 1, paddingVertical: 10, borderRadius: 18, backgroundColor: 'rgba(238,238,238,0.82)', alignItems: 'center' },
  modeBtnDark: { backgroundColor: '#1C1C1F' },
  modeBtnActive: { backgroundColor: '#ff6f91' },
  modeText: { fontSize: 13, color: '#444', fontWeight: '700' },
  modeTextActive: { color: '#fff' },
  fetchBtn: { padding: 14, borderRadius: 18, backgroundColor: '#ff6f91', alignItems: 'center' },
  fetchBtnDisabled: { opacity: 0.5 },
  fetchBtnText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  status: { marginTop: 10, textAlign: 'center', color: '#444', fontSize: 13, lineHeight: 18 },
  msgItem: { padding: 10, backgroundColor: '#FFFFFF', marginHorizontal: 16, marginVertical: 3, borderRadius: 18 },
  msgItemDark: { backgroundColor: '#1C1C1F' },
  msgTime: { fontSize: 11, color: '#333333', marginBottom: 4 },
  msgText: { fontSize: 13, color: '#333', lineHeight: 18 },
  textDark: { color: '#eee' },
  textSubDark: { color: '#eeeeee' },
  empty: { textAlign: 'center', color: '#333333', marginTop: 60, fontSize: 14 },
});
