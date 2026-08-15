import React, { useState } from 'react';
import { PerfFlatList } from '../components/PerfFlatList';

import {
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
import { CenterSpinner } from '../components/Loaders';
import { FadeInView } from '../components/Motion';
import { Member } from '../types';
import { errorMessage, messageText, unwrapList } from '../utils/data';
import { formatTimestamp } from '../utils/format';
import { useAppTheme } from '../hooks/useAppTheme';
import { usePalette } from '../theme';

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

function nextTimeFrom(res: any): number {
  const v = Number(res?.content?.nextTime || res?.data?.nextTime || res?.nextTime || 0);
  return Number.isFinite(v) && v > 0 ? v : 0;
}

function getChannelId(member: Member, roomMode: RoomMode): string {
  if (roomMode === 'small') return String(member.yklzId || member.channelId || '');
  return String(member.channelId || '');
}

export default function FetchScreen() {
  const navigation = useNavigation();
  const isDark = useAppTheme();
  const palette = usePalette();
  const { t } = useI18n();
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [messageMode, setMessageMode] = useState<MessageMode>('all');
  const [roomMode, setRoomMode] = useState<RoomMode>('big');
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');

  const fetchOnce = async (member: Member, targetRoomMode: RoomMode, nextTime = 0) => {
    const channelId = getChannelId(member, targetRoomMode);
    if (!channelId) throw new Error(targetRoomMode === 'small' ? t('该成员没有小房间 channelId') : t('该成员没有房间 channelId'));
    const res = await pocketApi.getRoomMessages({
      channelId,
      serverId: member.serverId,
      nextTime,
      fetchAll: messageMode === 'all',
    });
    return { list: normalizeMessages(res), next: nextTimeFrom(res) };
  };

  const startFetch = async () => {
    if (!selectedMember) {
      setStatus(t('请先选择成员'));
      return;
    }
    setLoading(true);
    setStatus(t('抓取中...'));
    try {
      // 循环抓取全部历史（成员消息模式同样分页，避免只取一页漏数据）
      let all: any[] = [];
      let usedRoomMode = roomMode;
      const seen = new Set<string>();
      let cursor = 0;
      let guard = 0;
      while (guard < 50) {
        guard += 1;
        const { list, next } = await fetchOnce(selectedMember, usedRoomMode, cursor);
        if (!list.length && usedRoomMode === 'big' && selectedMember.yklzId && all.length === 0) {
          setStatus(t('大房间没有返回消息，正在尝试小房间...'));
          usedRoomMode = 'small';
          cursor = 0;
          continue;
        }
        const fresh = list.filter((item: any) => {
          const key = String(item.id || item.msgId || item.messageId || item.clientMsgId || '');
          if (!key || seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        all = all.concat(fresh);
        if (!next || next <= cursor || fresh.length === 0) break;
        cursor = next;
        if (guard % 5 === 0) setStatus(t('已抓取 {count} 条，继续...', { count: all.length }));
      }

      setResults(all);
      setStatus(t('抓取完成：{count} 条消息 · {room} · {mode}', {
        count: all.length,
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
        <View style={[styles.section, { backgroundColor: palette.surface, borderColor: palette.hairline }]}>
          <MemberPicker selectedMember={selectedMember} onSelect={setSelectedMember} />
        </View>

        <View style={[styles.section, { backgroundColor: palette.surface, borderColor: palette.hairline }]}>
          <View style={styles.row}>
            <TouchableOpacity style={[styles.modeBtn, { backgroundColor: messageMode === 'all' ? palette.tint : palette.fill2 }]} onPress={() => setMessageMode('all')}>
              <Text style={[styles.modeText, { color: messageMode === 'all' ? '#FFFFFF' : palette.labelSecondary }]}>{t('全部消息')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.modeBtn, { backgroundColor: messageMode === 'owner' ? palette.tint : palette.fill2 }]} onPress={() => setMessageMode('owner')}>
              <Text style={[styles.modeText, { color: messageMode === 'owner' ? '#FFFFFF' : palette.labelSecondary }]}>{t('成员消息')}</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.row}>
            <TouchableOpacity style={[styles.modeBtn, { backgroundColor: roomMode === 'big' ? palette.tint : palette.fill2 }]} onPress={() => setRoomMode('big')}>
              <Text style={[styles.modeText, { color: roomMode === 'big' ? '#FFFFFF' : palette.labelSecondary }]}>{t('大房间')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.modeBtn, { backgroundColor: roomMode === 'small' ? palette.tint : palette.fill2 }]} onPress={() => setRoomMode('small')}>
              <Text style={[styles.modeText, { color: roomMode === 'small' ? '#FFFFFF' : palette.labelSecondary }]}>{t('小房间')}</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={[styles.fetchBtn, { backgroundColor: palette.tint }, loading && styles.fetchBtnDisabled]} onPress={startFetch} disabled={loading}>
            <Text style={styles.fetchBtnText}>{loading ? t('抓取中...') : t('开始抓取')}</Text>
          </TouchableOpacity>
          {status ? <Text style={[styles.status, { color: palette.labelSecondary }]}>{status}</Text> : null}
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
              <View style={[styles.msgItem, { backgroundColor: palette.surface, borderColor: palette.hairline }]}>
                <View style={styles.msgHead}>
                  <Text style={[styles.msgSender, { color: palette.tint }]} numberOfLines={1}>
                    {item.senderName || item.senderNickName || item.extInfo?.user?.nickName || t('成员')}
                  </Text>
                  <Text style={[styles.msgTime, { color: palette.labelTertiary }]}>
                    {formatTimestamp(item.msgTime || item.time || item.ctime).slice(5, 16)}
                  </Text>
                </View>
                <Text style={[styles.msgText, { color: palette.label }]}>
                  {messageText(item) || t('[空消息]')}
                </Text>
              </View>
            </FadeInView>
          )}
          ListEmptyComponent={loading ? <CenterSpinner dark={isDark} text={t('抓取中…')} /> : <Text style={[styles.empty, { color: palette.labelTertiary }]}>{t('暂无数据')}</Text>}
        />
      </FadeInView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  containerDark: { backgroundColor: 'transparent' },
  section: { padding: 14, marginHorizontal: 16, marginVertical: 4, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  modeBtn: { flex: 1, paddingVertical: 10, borderRadius: 14, alignItems: 'center' },
  modeText: { fontSize: 13, fontWeight: '700' },
  fetchBtn: { padding: 14, borderRadius: 18, alignItems: 'center' },
  fetchBtnDisabled: { opacity: 0.5 },
  fetchBtnText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  status: { marginTop: 10, textAlign: 'center', fontSize: 13, lineHeight: 18 },
  msgItem: { padding: 12, marginHorizontal: 16, marginVertical: 4, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth },
  msgHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 },
  msgSender: { fontSize: 12, fontWeight: '800', flex: 1, marginRight: 8 },
  msgTime: { fontSize: 11, marginBottom: 0 },
  msgText: { fontSize: 14, lineHeight: 20 },
  empty: { textAlign: 'center', marginTop: 60, fontSize: 14 },
});
