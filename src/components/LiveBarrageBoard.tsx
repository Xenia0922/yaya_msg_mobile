/**
 * 直播间弹幕面板（实时，云信聊天室）。
 *
 * 与录播弹幕不同：本组件订阅云信聊天室长连接，接收 + 发送均走官方同款通道
 * （见 src/services/pocketNim）。
 *
 * 两个导出：
 *   - `LiveBarragePanel`：自带连接（内部 useLiveBarrage），用于页面内独立面板
 *   - `LiveBarrageBoard`：纯展示（连接由调用方持有），用于播放器内共用同一条连接
 *
 * 两种外观：
 *   - variant='glass'（默认）：玻璃卡，用于页面内的独立面板
 *   - variant='plain'        ：半透明深色浮层，用于直接叠在播放器画面上
 *     （播放器区域每帧都在变，玻璃的 RenderEffect 抓背景代价高且会糊画面，
 *       这里沿用播放器覆盖层的既有做法使用半透明底）
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
import { useLiveBarrage, type UseLiveBarrageResult } from '../hooks/useLiveBarrage';
import { BarrageItem } from '../services/pocketNim/types';
import { useI18n } from '../i18n';
import { usePalette } from '../theme';

export interface LiveBarrageBoardProps {
  /** 弹幕数据源（由调用方持有连接） */
  source: Pick<UseLiveBarrageResult, 'items' | 'status' | 'error' | 'ready' | 'send' | 'retry'>;
  /** 直播 id（仅用于状态文案「未开始直播」判断） */
  liveId?: string;
  /** 'live' 成员直播（默认）/ 'public' 公开直播 */
  module?: 'live' | 'public';
  /** 列表可视高度 */
  height?: number;
  /** 外观：玻璃卡（页面内）/ 半透明浮层（叠在播放器上） */
  variant?: 'glass' | 'plain';
  /** 紧凑模式：隐藏标题行 */
  compact?: boolean;
  /** 只渲染输入条（弹幕本体已由视频上的滚动层展示） */
  inputOnly?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function LiveBarrageBoard(props: LiveBarrageBoardProps) {
  const {
    source,
    liveId,
    height = 168,
    variant = 'glass',
    compact = false,
    inputOnly = false,
    style,
  } = props;
  const { items, status, error, ready, send, retry } = source;
  const { t } = useI18n();
  const palette = usePalette();
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const lastFailedRef = useRef('');
  const [hint, setHint] = useState('');

  const plain = variant === 'plain';
  /**
   * 浮层（plain）下所有文字改走白色系：叠在视频上时 palette 的深色 label 会看不清。
   * 高亮（成员/礼物）仍用主色 tint，浅深底都可读。
   */
  const tone = useMemo(
    () => ({
      primary: plain ? 'rgba(255,255,255,0.94)' : palette.label,
      secondary: plain ? 'rgba(255,255,255,0.72)' : palette.labelSecondary,
      tertiary: plain ? 'rgba(255,255,255,0.5)' : palette.labelTertiary,
      fieldBg: plain ? 'rgba(255,255,255,0.16)' : palette.fill2,
      fieldBorder: plain ? 'rgba(255,255,255,0.22)' : palette.hairline,
    }),
    [plain, palette]
  );

  const statusText = useMemo(() => {
    if (!liveId) return t('未开始直播');
    if (status === 'resolving' || status === 'connecting') return t('正在连接弹幕...');
    if (status === 'reconnecting') return t('弹幕断线重连中...');
    if (status === 'connected') return t('弹幕已连接');
    if (status === 'error') return error || t('弹幕连接失败');
    if (status === 'closed') return t('弹幕已断开');
    return t('弹幕未开启');
  }, [liveId, status, error, t]);

  /** 弹幕类别 → 文字色（成员/超管/礼物高亮，进房/系统弱化） */
  const itemColor = useCallback(
    (kind: BarrageItem['kind']): string => {
      switch (kind) {
        case 'member':
        case 'superman':
        case 'gift':
        case 'pay':
        case 'starwo':
          return palette.tint;
        case 'enter':
        case 'system':
          return tone.tertiary;
        default:
          return tone.primary;
      }
    },
    [palette, tone]
  );

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
        <Text style={[styles.rowText, { color: itemColor(item.kind) }]} numberOfLines={2}>
          {item.nick ? <Text style={styles.nick}>{`${item.nick}：`}</Text> : null}
          {item.text}
        </Text>
      </View>
    ),
    [itemColor]
  );

  const inputRow = (
    <View style={styles.inputRow}>
      <View style={{ flex: 1 }}>
        <TextInput
          style={[styles.input, { color: tone.primary, backgroundColor: tone.fieldBg, borderColor: tone.fieldBorder }]}
          value={draft}
          onChangeText={setDraft}
          placeholder={ready ? t('发条弹幕...') : t('弹幕连接中...')}
          placeholderTextColor={tone.tertiary}
          editable={ready && !sending}
          maxLength={60}
          returnKeyType="send"
          onSubmitEditing={handleSend}
        />
        {draft ? (
          <Text style={[styles.counter, { color: tone.tertiary }]}>{draft.length}/60</Text>
        ) : null}
      </View>
      <TouchableOpacity
        onPress={handleSend}
        disabled={!ready || sending || !draft.trim()}
        activeOpacity={0.85}
        style={[styles.sendBtn, { backgroundColor: ready && draft.trim() && !sending ? palette.tint : tone.fieldBg }]}
      >
        {sending ? (
          <Text style={[styles.sendText, { color: tone.tertiary }]}>··</Text>
        ) : (
          <MaterialCommunityIcons
            name="send"
            size={16}
            color={ready && draft.trim() ? palette.onTint : tone.tertiary}
          />
        )}
      </TouchableOpacity>
    </View>
  );

  const header = compact || inputOnly ? null : (
    <View style={styles.header}>
      <MaterialCommunityIcons name="message-text-outline" size={14} color={tone.secondary} />
      <Text style={[styles.headerText, { color: tone.secondary }]} numberOfLines={1}>
        {statusText}
      </Text>
      {status === 'error' ? (
        <TouchableOpacity onPress={retry} hitSlop={styles.hit} activeOpacity={0.7}>
          <Text style={[styles.headerAction, { color: palette.tint }]}>{t('重连')}</Text>
        </TouchableOpacity>
      ) : null}
      {items.length ? <Text style={[styles.count, { color: tone.tertiary }]}>{items.length}</Text> : null}
    </View>
  );

  const inner = inputOnly ? (
    <>
      {hint ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={[styles.hint, { color: palette.tint, flex: 1 }]} numberOfLines={1}>{hint}</Text>
          <TouchableOpacity
            onPress={() => { setHint(''); handleSend(); }}
            hitSlop={styles.hit}
            activeOpacity={0.7}
          >
            <Text style={{ color: palette.tint, fontSize: 12, fontWeight: '700' }}>{t('重试')}</Text>
          </TouchableOpacity>
        </View>
      ) : null}
      {ready ? null : (
        <Text style={[styles.empty, { color: tone.tertiary, paddingVertical: 2 }]} numberOfLines={1}>
          {statusText}
        </Text>
      )}
      {inputRow}
    </>
  ) : (
    <>
      {header}
      <FlatList
        data={items}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        style={[styles.list, { height }]}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          <Text style={[styles.empty, { color: tone.tertiary }]}>
            {status === 'connected' ? t('暂无弹幕') : statusText}
          </Text>
        }
      />
      {hint ? <Text style={[styles.hint, { color: palette.tint }]}>{hint}</Text> : null}
      {inputRow}
    </>
  );

  if (plain) {
    return <View style={[styles.wrapPlain, style]}>{inner}</View>;
  }
  return (
    <GlassSurface role="card" radius={16} style={[styles.wrap, style]}>
      {inner}
    </GlassSurface>
  );
}

/** 自带连接的面板（页面内使用）：内部建立云信聊天室连接 */
export interface LiveBarragePanelProps extends Omit<LiveBarrageBoardProps, 'source'> {
  /** 直播 id；为空不连接 */
  liveId?: string;
  enabled?: boolean;
}

export function LiveBarragePanel({ liveId, enabled = true, module = 'live', ...rest }: LiveBarragePanelProps) {
  const source = useLiveBarrage({ liveId, enabled, module });
  return <LiveBarrageBoard source={source} liveId={liveId} module={module} {...rest} />;
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 10, paddingTop: 8, paddingBottom: 8, overflow: 'hidden' },
  // 播放器浮层：半透明深底 + 圆角，不参与玻璃（避免对视频逐帧抓背景）
  wrapPlain: {
    paddingHorizontal: 10,
    paddingTop: 6,
    paddingBottom: 8,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.42)',
  },
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
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 6 },
  input: {
    flex: 1,
    minHeight: 36,
    maxHeight: 96,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 13,
    textAlignVertical: 'center',
    includeFontPadding: false,
  },
  sendBtn: { height: 34, width: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  counter: { position: 'absolute', right: 8, bottom: -14, fontSize: 10 },
  sendText: { fontSize: 13, fontWeight: '700' },
  hit: { top: 6, bottom: 6, left: 6, right: 6 },
});

export default LiveBarragePanel;
