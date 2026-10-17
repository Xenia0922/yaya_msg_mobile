/**
 * v3.0 最后三屏：私信 / 房间消息 / 发票
 *
 * 私信：会话列表 → 详情（只读拉取 + 发送回复）
 * 房间消息：成员（房间）选择 → 消息列表（**只读**；发言仍走旧版，因为发送链路含云信会话与 414/serverId 处理，
 *   不能为了布局重写把已验证的发送链路拆掉）
 * 发票：订单列表（申请动作保留入口）
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
  FlatList,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { useNavigation } from '@react-navigation/native';

import pocketApi from '../../api/pocket48';
import { useMemberStore, useSettingsStore, useUiStore } from '../../store';
import { useI18n } from '../../i18n';
import { usePalette } from '../../theme';
import { normalizeUrl, pickText, unwrapList, errorMessage, messageText } from '../../utils/data';
import { formatTimestamp } from '../../utils/format';
import type { Member } from '../../types';

import { Screen } from '../layout/Screen';
import { DataListPage, type RowModel } from '../layout/DataListPage';
import { Divider, EmptyHint, ListRow } from '../layout/primitives';
import { MemberSheet, MemberTrigger } from '../components/MemberSheet';
import { contentBottom, GUTTER, R, SPACE, TYPE } from '../tokens';

/* ───────────────── 私信 ───────────────── */

function convRows(res: any): RowModel[] {
  return unwrapList(res, ['content.list', 'content.data', 'content.messages', 'data.list', 'list', 'data'])
    .map((raw: any, i: number) => {
      const name = String(pickText(raw, ['nickname', 'nickName', 'userName', 'name', 'senderName'], ''));
      const last = String(pickText(raw, ['lastMessage', 'text', 'content', 'message'], ''));
      const t = Number(pickText(raw, ['lastTime', 'time', 'createTime', 'msgTime'], '0'));
      return {
        key: String(pickText(raw, ['targetUserId', 'userId', 'id', 'accId'], String(i))),
        title: name || String(pickText(raw, ['targetUserId', 'userId'], '')),
        subtitle: last,
        value: t ? formatTimestamp(t) : undefined,
        raw,
      } as RowModel;
    })
    .filter((x: RowModel) => !!x.title);
}

export function PrivateMessagesV3() {
  const navigation = useNavigation<any>();
  const palette = usePalette();
  const { t } = useI18n();
  const showToast = useUiStore((s) => s.showToast);

  const [target, setTarget] = useState<{ id: string; name: string } | null>(null);
  const [detail, setDetail] = useState<RowModel[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  const open = useCallback(async (item: RowModel) => {
    setTarget({ id: item.key, name: item.title });
    setBusy(true);
    try {
      const res = await pocketApi.getPrivateMessageDetail(item.key, 0);
      const list = unwrapList(res, ['content.list', 'content.data', 'data.list', 'list', 'data'])
        .map((raw: any, i: number) => ({
          key: String(raw?.id || raw?.msgId || i),
          title: messageText(raw) || String(pickText(raw, ['text', 'content'], '')),
          subtitle: raw?.msgTime || raw?.createTime ? formatTimestamp(Number(raw?.msgTime || raw?.createTime)) : undefined,
          raw,
        }))
        .filter((x: RowModel) => !!x.title)
        .reverse();
      setDetail(list);
    } catch (e) {
      showToast(t('加载失败：{msg}', { msg: errorMessage(e) }));
    } finally {
      setBusy(false);
    }
  }, [showToast, t]);

  const send = useCallback(async () => {
    const value = text.trim();
    if (!value || !target) return;
    setBusy(true);
    try {
      await pocketApi.sendPrivateMessageReply(target.id, value);
      setText('');
      await open({ key: target.id, title: target.name } as RowModel);
    } catch (e) {
      showToast(t('发送失败：{msg}', { msg: errorMessage(e) }));
    } finally {
      setBusy(false);
    }
  }, [text, target, open, showToast, t]);

  if (target) {
    return (
      <Screen
        title={target.name}
        onBack={() => setTarget(null)}
        actions={[{ icon: 'refresh', onPress: () => open({ key: target.id, title: target.name } as RowModel) }]}
      >
        <FlatList
          data={detail}
          keyExtractor={(i) => i.key}
          contentContainerStyle={{ paddingVertical: SPACE.md, gap: SPACE.sm, paddingHorizontal: GUTTER }}
          renderItem={({ item }) => (
            <View style={[styles.bubble, { backgroundColor: palette.fill2 }]}>
              <Text style={[TYPE.body, { color: palette.label }]}>{item.title}</Text>
              {item.subtitle ? <Text style={[TYPE.caption, { color: palette.labelTertiary, marginTop: 2 }]}>{item.subtitle}</Text> : null}
            </View>
          )}
          ListEmptyComponent={busy ? null : <EmptyHint icon="email-open-outline" title={t('暂无消息')} />}
        />
        <View style={[styles.sendBar, { borderTopColor: palette.hairline }]}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={t('输入消息')}
            placeholderTextColor={palette.labelTertiary}
            style={[TYPE.body, styles.sendInput, { color: palette.label }]}
            multiline
          />
          <TouchableOpacity onPress={send} disabled={busy || !text.trim()} style={[styles.sendBtn, { backgroundColor: palette.tint, opacity: busy || !text.trim() ? 0.4 : 1 }]}>
            <MaterialCommunityIcons name="send" size={16} color={palette.onTint} />
          </TouchableOpacity>
        </View>
      </Screen>
    );
  }

  return (
    <DataListPage
      title={t('私信')}
      onBack={() => navigation.goBack()}
      fetcher={() => pocketApi.getPrivateMessageList()}
      toItems={convRows}
      onPressItem={open}
      emptyTitle={t('暂无私信')}
      emptyIcon="email-outline"
    />
  );
}

/* ───────────────── 房间消息（只读） ───────────────── */

function roomRows(res: any): RowModel[] {
  return unwrapList(res, ['content.messageList', 'content.message', 'content.list', 'data.messageList', 'messageList', 'list', 'data'])
    .map((raw: any, i: number) => {
      const sender = String(pickText(raw, ['starName', 'senderName', 'nickName', 'nickname', 'userInfo.nickname'], ''));
      const body = messageText(raw) || String(pickText(raw, ['text', 'content'], ''));
      const time = Number(pickText(raw, ['msgTime', 'createTime', 'ctime', 'time'], '0'));
      return {
        key: String(raw?.msgId || raw?.id || i),
        title: body,
        subtitle: [sender, time ? formatTimestamp(time) : ''].filter(Boolean).join(' · '),
        raw,
      } as RowModel;
    })
    .filter((x: RowModel) => !!x.title)
    .reverse();
}

export function RoomsV3() {
  const navigation = useNavigation<any>();
  const { t } = useI18n();
  const members = useMemberStore((s) => s.members);
  const token = useSettingsStore((s) => s.settings.p48Token);
  const [member, setMember] = useState<Member | null>(null);
  const [sheet, setSheet] = useState(false);

  const fetcher = useCallback(async () => {
    if (!member || !token) return null;
    return pocketApi.getRoomMessages({
      channelId: String(member.channelId || ''),
      serverId: String((member as any).serverId || ''),
      nextTime: 0,
      limit: 60,
    }).catch(() => null);
  }, [member, token]);

  const header = useMemo(
    () => (
      <View style={styles.notice}>
        <MaterialCommunityIcons name="information-outline" size={13} color="#888" />
        <Text style={[TYPE.caption, { color: '#888', flex: 1 }]}>
          {t('3.0 目前只读；发言仍在旧版房间页（发送链路含云信会话与 serverId 处理，尚未迁移）')}
        </Text>
      </View>
    ),
    [t],
  );

  return (
    <>
      {member ? (
        <DataListPage
          title={member.ownerName || t('房间消息')}
          onBack={() => navigation.goBack()}
          toolbar={<MemberTrigger member={member} onPress={() => setSheet(true)} />}
          fetcher={fetcher}
          toItems={roomRows}
          header={header}
          emptyTitle={t('暂无消息')}
          emptyIcon="message-text-outline"
        />
      ) : (
        <Screen title={t('房间消息')} onBack={() => navigation.goBack()} toolbar={<MemberTrigger member={null} onPress={() => setSheet(true)} />}>
          <EmptyHint icon="account-search-outline" title={t('先选一个房间')} hint={t('点左上角选择成员，进入 TA 的房间消息')} />
        </Screen>
      )}
      <MemberSheet visible={sheet} onClose={() => setSheet(false)} onPick={(m) => { setMember(m); setSheet(false); }} />
    </>
  );
}

/* ───────────────── 发票 ───────────────── */

function orderRows(res: any): RowModel[] {
  return unwrapList(res, ['content.list', 'content.data', 'data.list', 'list', 'data'])
    .map((raw: any, i: number) => {
      const t2 = Number(pickText(raw, ['createTime', 'time', 'orderTime'], '0'));
      return {
        key: String(pickText(raw, ['orderId', 'id', 'tradeNo'], String(i))),
        title: String(pickText(raw, ['orderName', 'title', 'productName', 'desc'], '')),
        subtitle: String(pickText(raw, ['statusText', 'status'], '')),
        value: String(pickText(raw, ['amount', 'price', 'money'], '')),
        valueHint: t2 ? formatTimestamp(t2) : undefined,
        raw,
      } as RowModel;
    })
    .filter((x: RowModel) => !!x.title);
}

export function InvoiceV3() {
  const navigation = useNavigation<any>();
  const { t } = useI18n();
  return (
    <DataListPage
      title={t('发票')}
      onBack={() => navigation.goBack()}
      fetcher={() => pocketApi.getInvoiceOrderList()}
      toItems={orderRows}
      emptyTitle={t('暂无可开票订单')}
      emptyIcon="file-document-outline"
    />
  );
}

const styles = StyleSheet.create({
  bubble: { paddingHorizontal: SPACE.md, paddingVertical: SPACE.sm, borderRadius: R.md },
  sendBar: { flexDirection: 'row', alignItems: 'flex-end', gap: SPACE.sm, padding: SPACE.sm, borderTopWidth: StyleSheet.hairlineWidth },
  sendInput: { flex: 1, maxHeight: 96, paddingHorizontal: SPACE.md, paddingVertical: SPACE.sm },
  sendBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  notice: { flexDirection: 'row', gap: SPACE.xs, alignItems: 'center', paddingHorizontal: GUTTER, paddingVertical: SPACE.sm },
});
