/**
 * 直播间弹幕面板（实时，云信聊天室）。
 *
 * 与录播弹幕不同：本组件订阅云信聊天室长连接，接收 + 发送均走官方同款通道
 * （见 src/services/pocketNim）。样式沿用全站玻璃基元 GlassSurface + palette token。
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Keyboard,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { GlassSurface } from './GlassSurface';
import { useLiveBarrage } from '../hooks/useLiveBarrage';
import { BarrageItem } from '../services/pocketNim/types';
import { useI18n } from '../i18n';
import { usePalette } from '../theme';

export interface LiveBarrageBoardProps {
  /** 直播 id（有值才连接） */
  liveId?: string;
  /** 是否开启弹幕（例如直播中才开） */
  enabled?: boolean;
  /** 'live' 成员直播（默认）/ 'public' 公开直播 */
  module?: 'live' | 'public';
  /** 列表可视高度 */
  height?: number;
  style?: StyleProp<ViewStyle>;
}

/** 按弹幕类别取文字色（成员/超管高亮，进房/系统弱化） */
function textColor(kind: BarrageItem['kind'], palette: ReturnType<typeof usePalette>): string {
  switch (kind) {
    case 'member':
    case 'superman':
      return palette.tint;
    case 'gift':
    case 'pay':
    case 'starwo':
      return palette.tint;
    case 'enter':
    case 'system':
      return palette.labelTertiary;
    default:
      return palette.label;
  }
}

export function LiveBarrageBoard(props: LiveBarrageBoardProps) {
  const { liveId, enabled = true, module = 'live', height = 168, style } = props;
  const { t } = useI18n();
  const palette = usePalette();
  const { items, status, error, ready, send, retry } = useLiveBarrage({ liveId, enabled, module });
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [hint, setHint] = useState('');
  const listRef = useRef<FlatList<BarrageItem>>(null);

  const statusText = useMemo(() => {
    if (!liveId) return t('未开始直播');
    if (status === 'resolving') return t('正在连接弹幕...');
    if (status === 'connecting') return t('正在连接弹幕...');
    if (status === 'reconnecting') return t('弹幕断线重连中...');
    if (status === 'connected') return ready ? t('弹幕已连接') : t('弹幕已连接');
    if (status === 'error') return error || t('弹幕连接失败');
    if (status === 'closed') return t('弹幕已断开');
    return t('弹幕未开启');
  }, [liveId, status, error, ready, t]);

  const handleSend = useCallback(async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setHint('');
    try {
      await send(text);
      setDraft('');
      Keyboard.dismiss();
    } catch (e: any) {
      setHint(String(e?.message || t('发送失败')));
    } finally {
      setSending(false);
    }
  }, [draft, sending, send, t]);

  const renderItem = useCallback(
    ({ item }: { item: BarrageItem }) => (
      <View style={styles.row}>
        <Text style={[styles.rowText, { color: textColor(item.kind, palette) }]} numberOfLines={2}>
          {item.nick ? <Text style={[styles.nick, { color: textColor(item.kind, palette) }]}>{`${item.nick}：`}</Text> : null}
          {item.text}
        </Text>
      </View>
    ),
    [palette]
  );

  return (
    <GlassSurface role="card" radius={16} style={[styles.wrap, style]}>
      <View style={styles.header}>
        <MaterialCommunityIcons name="message-text-outline" size={14} color={palette.labelSecondary} />
        <Text style={[styles.headerText, { color: palette.labelSecondary }]} numberOfLines={1}>
          {statusText}
        </Text>
        {status === 'error' ? (
          <TouchableOpacity onPress={retry} hitSlop={styles.hit} activeOpacity={0.7}>
            <Text style={[styles.headerAction, { color: palette.tint }]}>{t('重连')}</Text>
          </TouchableOpacity>
        ) : null}
        {items.length ? (
          <Text style={[styles.count, { color: palette.labelTertiary }]}>{items.length}</Text>
        ) : null}
      </View>

      <FlatList
        ref={listRef}
        data={items}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        style={[styles.list, { height }]}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          <Text style={[styles.empty, { color: palette.labelTertiary }]}>
            {status === 'connected' ? t('暂无弹幕') : ''}
          </Text>
        }
      />

      {hint ? <Text style={[styles.hint, { color: palette.tint }]}>{hint}</Text> : null}

      <View style={styles.inputRow}>
        <TextInput
          style={[
            styles.input,
            { color: palette.label, backgroundColor: palette.fill2, borderColor: palette.hairline },
          ]}
          value={draft}
          onChangeText={setDraft}
          placeholder={ready ? t('说点什么...') : t('弹幕连接中...')}
          placeholderTextColor={palette.labelTertiary}
          editable={ready && !sending}
          maxLength={60}
          returnKeyType="send"
          onSubmitEditing={handleSend}
        />
        <TouchableOpacity
          onPress={handleSend}
          disabled={!ready || sending || !draft.trim()}
          activeOpacity={0.85}
          style={[
            styles.sendBtn,
            { backgroundColor: ready && draft.trim() ? palette.tint : palette.fill3 },
          ]}
        >
          <Text style={[styles.sendText, { color: ready && draft.trim() ? palette.onTint : palette.labelTertiary }]}>
            {sending ? '··' : t('发送')}
          </Text>
        </TouchableOpacity>
      </View>
    </GlassSurface>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 10, paddingTop: 8, paddingBottom: 8, overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 2, paddingBottom: 6 },
  headerText: { fontSize: 11, flexShrink: 1 },
  headerAction: { fontSize: 11, fontWeight: '700' },
  count: { fontSize: 11, marginLeft: 'auto' },
  list: { width: '100%' },
  listContent: { paddingVertical: 2 },
  row: { paddingVertical: 2 },
  rowText: { fontSize: 12, lineHeight: 17 },
  nick: { fontWeight: '700' },
  empty: { fontSize: 11, textAlign: 'center', paddingVertical: 12 },
  hint: { fontSize: 11, paddingHorizontal: 2, paddingTop: 4 },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 8 },
  input: {
    flex: 1,
    height: 34,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    fontSize: 13,
  },
  sendBtn: { height: 34, borderRadius: 18, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  sendText: { fontSize: 13, fontWeight: '700' },
  hit: { top: 6, bottom: 6, left: 6, right: 6 },
});

export default LiveBarrageBoard;
