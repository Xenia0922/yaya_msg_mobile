/**
 * MessagesScreen · 消息检索 v2.6 布局重做
 * - 顶部成员选择改为行卡（48 圆底图标 + 主标题成员名 + 副标题「共 N 位成员」+ chevron，ScalePressable）
 * - 搜索条按规范（圆角 14 fill2 底 + magnify 图标 + 清除按钮）
 * - 消息列表改「气泡卡行」：sender 名 13/700 tint + 时间 10 右对齐 + 正文 14，行卡圆角 16
 * - 成员选择 Modal 改底部 sheet（Modal transparent + 底部圆角 radii.sheet=22 + 顶部 handle + 搜索条 + 带头像+名字+team 的虚拟化行）
 * 业务逻辑 / API / 数据流 / 路由 / i18n 原文一律不动，仅重组布局。
 */
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { PerfFlatList } from '../components/PerfFlatList';

import {
  View, Text, TextInput, StyleSheet, Modal, ScrollView,
} from 'react-native';
import { useSettingsStore, useMemberStore, useUiStore } from '../store';
import { FadeInView, ScalePressable } from '../components/Motion';
import { CenterSpinner } from '../components/Loaders';
import { EmptyState, ErrorState } from '../components/StateViews';
import ScreenHeader from '../components/ScreenHeader';
import { Member } from '../types';
import { formatTimestamp } from '../utils/format';
import { errorMessage, messageText, unwrapList } from '../utils/data';
import { memberSearchText } from '../utils/members';
import pocketApi from '../api/pocket48';
import { usePalette, radii, radiiAlias, usePageBackground } from '../theme';
import { typography } from '../theme/typography';
import { useI18n } from '../i18n';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';

function msgTime(item: any): number {
  const value = Number(item.msgTime || item.messageTime || item.ctime || item.time || item.createTime || 0);
  return Number.isFinite(value) ? value : 0;
}

export default function MessagesScreen() {
  const palette = usePalette();
  const { t } = useI18n();
  const members = useMemberStore((state) => state.members);
  const token = useSettingsStore((state) => state.settings.p48Token);
  const showToast = useUiStore((state) => state.showToast);
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState('');
  const requestIdRef = useRef(0);

  const pickerList = useMemo(() => {
    const query = pickerQuery.trim().toLowerCase();
    return (query
      ? members.filter((member) => memberSearchText(member).includes(query))
      : members
    ).slice(0, 80);
  }, [members, pickerQuery]);

  const fetchMessages = useCallback(async (member: Member) => {
    if (!token) {
      showToast(t('请先在账号设置里登录口袋48或粘贴 Token'));
      return;
    }
    const requestId = ++requestIdRef.current;
    setSelectedMember(member);
    setLoading(true);
    setLoadError('');
    try {
      const res = await pocketApi.getRoomMessages({
        channelId: member.channelId,
        serverId: member.serverId,
        nextTime: 0,
        fetchAll: true,
      });
      const list = unwrapList(res, ['content.messageList', 'content.message', 'content.list', 'data.messageList', 'data.message', 'messageList', 'message', 'list']);
      if (requestId !== requestIdRef.current) return;
      setMessages(list.slice().sort((a, b) => msgTime(b) - msgTime(a)));
    } catch (error) {
      if (requestId !== requestIdRef.current) return;
      setLoadError(errorMessage(error));
      setMessages([]);
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [showToast, t, token]);

  const filtered = useMemo(() => {
    const q = search.trim();
    if (!q) return messages;
    return messages.filter((item) => {
      const body = messageText(item);
      return body.includes(q) || String(item.senderName || '').includes(q);
    });
  }, [messages, search]);

  const renderMsgItem = useCallback(({ item }: { item: any }) => (
    <FadeInView delay={80} duration={300} distance={8}>
      <View
        style={[
          styles.msg,
          {
            backgroundColor: palette.surface,
            borderColor: palette.hairline,
            borderWidth: StyleSheet.hairlineWidth,
          },
        ]}
      >
        <View style={styles.msgHeader}>
          <Text style={[styles.msgSender, { color: palette.tint }]} numberOfLines={1}>{item.senderName || item.senderNickName || t('成员')}</Text>
          <Text style={[styles.msgTime, { color: palette.labelTertiary }]}>{formatTimestamp(item.msgTime || item.time || item.ctime)}</Text>
        </View>
        <Text style={[styles.msgBody, { color: palette.labelSecondary }]}>{messageText(item) || t('[空消息]')}</Text>
      </View>
    </FadeInView>
  ), [palette, t]);

  return (
    <View style={[styles.container, { backgroundColor: usePageBackground() }]}>
      <ScreenHeader title={t('消息检索')} />

      {/* 顶部留白区 */}
      <View style={styles.topBar}>
        {/* 成员选择行卡：48 圆底图标 + 成员名 + 「共 N 位成员」 + chevron */}
        <ScalePressable
          style={[styles.pickerRow, { backgroundColor: palette.surface, borderColor: palette.hairline, borderWidth: StyleSheet.hairlineWidth }]}
          onPress={() => setPickerOpen(true)}
          pressedScale={0.98}
          activeOpacity={0.9}
        >
          <View style={[styles.pickerAvatar, { backgroundColor: palette.tintSoft }]}>
            <MaterialCommunityIcons name="account-star" color={palette.tint} size={24} />
          </View>
          <View style={{ flex: 1, marginLeft: 12, minWidth: 0 }}>
            <Text style={[typography.subhead, { color: palette.label, fontWeight: '700' }]} numberOfLines={1}>
              {selectedMember?.ownerName || t('选择成员')}
            </Text>
            <Text style={[typography.caption1, { color: palette.labelSecondary, marginTop: 2 }]}>
              {t('共 {count} 位成员', { count: members.length })}
            </Text>
          </View>
          <View style={[styles.pickerTag, { backgroundColor: palette.fill2 }]}>
            <MaterialCommunityIcons name="chevron-down" color={palette.tint} size={18} />
          </View>
        </ScalePressable>

        {/* 搜索条：圆角 14 fill2 底 + magnify + 清除按钮 */}
        <View style={[styles.searchBar, { backgroundColor: palette.fill2 }]}>
          <MaterialCommunityIcons name="magnify" size={16} color={palette.labelTertiary} />
          <TextInput
            style={[styles.searchInput, { color: palette.label }]}
            placeholder={t('搜索消息内容...')}
            placeholderTextColor={palette.labelTertiary}
            value={search}
            onChangeText={setSearch}
          />
          {search ? (
            <ScalePressable onPress={() => setSearch('')} activeOpacity={0.7} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={styles.clearBtn}>
              <MaterialCommunityIcons name="close-circle" size={16} color={palette.labelTertiary} />
            </ScalePressable>
          ) : null}
        </View>
      </View>

      {/* 成员选择底部 sheet */}
      <Modal visible={pickerOpen} transparent animationType="slide" onRequestClose={() => setPickerOpen(false)}>
        <View style={[styles.sheetShade, { backgroundColor: usePageBackground() }]}>
          <View style={[styles.sheetPanel, { backgroundColor: palette.surface, borderColor: palette.innerStroke, borderWidth: StyleSheet.hairlineWidth }]}>
            {/* 顶部 handle */}
            <View style={styles.sheetHandleWrap}>
              <View style={[styles.sheetHandle, { backgroundColor: palette.fill3 }]} />
            </View>
            <View style={styles.sheetHeader}>
              <Text style={[typography.title3, { color: palette.label }]}>{t('选择成员')}</Text>
              <Text style={[typography.caption1, { color: palette.labelSecondary }]}>{t('{count} 位', { count: members.length })}</Text>
            </View>
            {/* sheet 内搜索条 */}
            <View style={[styles.searchBar, styles.sheetSearch, { backgroundColor: palette.fill2 }]}>
              <MaterialCommunityIcons name="magnify" size={16} color={palette.labelTertiary} />
              <TextInput
                style={[styles.searchInput, { color: palette.label }]}
                placeholder={t('搜索成员...')}
                placeholderTextColor={palette.labelTertiary}
                value={pickerQuery}
                onChangeText={setPickerQuery}
                autoFocus
              />
              {pickerQuery ? (
                <ScalePressable onPress={() => setPickerQuery('')} activeOpacity={0.7} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={styles.clearBtn}>
                  <MaterialCommunityIcons name="close-circle" size={16} color={palette.labelTertiary} />
                </ScalePressable>
              ) : null}
            </View>
            <PerfFlatList
              data={pickerList}
              keyExtractor={(item) => `${item.id}-${item.channelId}`}
              renderItem={({ item, index }) => (
                <FadeInView delay={index < 12 ? 60 + index * 25 : 0} duration={260} distance={8}>
                  <ScalePressable
                    style={styles.memberRow}
                    onPress={() => {
                      setPickerOpen(false);
                      fetchMessages(item);
                    }}
                    pressedScale={0.98}
                  >
                    <View style={[styles.memberAvatar, { backgroundColor: palette.fill3 }]}>
                      <MaterialCommunityIcons name="account" color={palette.tint} size={22} />
                    </View>
                    <View style={{ flex: 1, marginLeft: 12, minWidth: 0 }}>
                      <Text style={[typography.subhead, { color: palette.label }]} numberOfLines={1}>{item.ownerName}</Text>
                      <Text style={[typography.caption1, { color: palette.labelSecondary, marginTop: 1 }]} numberOfLines={1}>
                        {item.team || item.groupName || ''}
                      </Text>
                    </View>
                    <MaterialCommunityIcons name="chevron-right" color={palette.labelTertiary} size={18} />
                  </ScalePressable>
                </FadeInView>
              )}
              ListEmptyComponent={<EmptyState icon="account-search-outline" title={t('成员列表为空')} />}
            />
            <ScalePressable
              style={[styles.sheetClose, { backgroundColor: palette.fill2 }]}
              onPress={() => setPickerOpen(false)}
              pressedScale={0.98}
              activeOpacity={0.85}
            >
              <Text style={[typography.headline, { color: palette.label, fontWeight: '600' }]}>{t('关闭')}</Text>
            </ScalePressable>
          </View>
        </View>
      </Modal>

      <View style={styles.body}>
        {loading ? (
          <CenterSpinner text={t('正在加载消息…')} />
        ) : loadError ? (
          <ErrorState
            title={t('加载失败')}
            hint={loadError}
            onAction={() => selectedMember && fetchMessages(selectedMember)}
          />
        ) : !selectedMember ? (
          <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }} showsVerticalScrollIndicator={false}>
            <EmptyState
              icon="message-text-outline"
              title={t('选择成员查看消息')}
              hint={t('在上方选择一位成员，检索其房间的全部消息')}
              actionLabel={t('选择成员')}
              onAction={() => setPickerOpen(true)}
            />
          </ScrollView>
        ) : filtered.length === 0 ? (
          <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }} showsVerticalScrollIndicator={false}>
            <EmptyState
              icon="file-search-outline"
              title={search.trim() ? t('没有匹配的消息') : t('暂无消息')}
              hint={search.trim() ? t('换个关键词试试') : t('这个房间暂时没有可显示的消息')}
            />
          </ScrollView>
        ) : (
          <PerfFlatList
            data={filtered}
            keyExtractor={(item, index) => String(item.id || item.msgId || item.messageId || index)}
            renderItem={renderMsgItem}
            contentContainerStyle={styles.msgListContent}
            initialNumToRender={12}
            maxToRenderPerBatch={12}
            windowSize={7}
            removeClippedSubviews
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 10, gap: 10 },
  body: { flex: 1 },
  // 成员选择行卡
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  pickerAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickerTag: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.04)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // 搜索条
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 40,
    borderRadius: radiiAlias.input,
    paddingHorizontal: 12,
    gap: 8,
  },
  searchInput: { flex: 1, fontSize: 15, padding: 0 },
  clearBtn: { padding: 2, alignItems: 'center', justifyContent: 'center' },
  // 底部 sheet
  sheetShade: { flex: 1, justifyContent: 'flex-end' },
  sheetPanel: {
    maxHeight: '88%',
    borderTopLeftRadius: radii.sheet,
    borderTopRightRadius: radii.sheet,
    paddingBottom: 24,
    overflow: 'hidden',
  },
  sheetHandleWrap: { alignItems: 'center', paddingTop: 8 },
  sheetHandle: { width: 40, height: 5, borderRadius: 3 },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 4,
  },
  sheetSearch: { marginHorizontal: 16, marginTop: 8, marginBottom: 6 },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  memberAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberAvatarText: { fontWeight: '800', fontSize: 16 },
  sheetClose: {
    marginHorizontal: 16,
    marginTop: 8,
    height: 46,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // 消息气泡卡行
  msg: {
    padding: 12,
    marginHorizontal: 16,
    marginVertical: 4,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  msgListContent: { paddingBottom: 32, paddingTop: 4 },
  msgHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  msgSender: { fontSize: 13, fontWeight: '700', flex: 1, marginRight: 8 },
  msgTime: { fontSize: 10, fontWeight: '500' },
  msgBody: { fontSize: 14, lineHeight: 20 },
});
