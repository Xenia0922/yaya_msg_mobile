import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { usePalette, fontFamily } from '../theme';

const BARRAGE_ROW_MIN_HEIGHT = 21;

export interface LiveBarrageBoardProps {
  source: Pick<UseLiveBarrageResult, 'items' | 'status' | 'error' | 'ready' | 'send' | 'retry'>;

  liveId?: string;

  module?: 'live' | 'public';

  height?: number;

  variant?: 'glass' | 'plain' | 'pocket';

  compact?: boolean;

  inputOnly?: boolean;

  hideInput?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function LiveBarrageBoard(props: LiveBarrageBoardProps) {
  const {
    source,
    liveId,
    height = 189,
    variant = 'glass',
    compact = false,
    inputOnly = false,
    hideInput = false,
    style,
  } = props;
  const { items, status, error, ready, send, retry } = source;
  const { t } = useI18n();
  const palette = usePalette();
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [hint, setHint] = useState('');

  const plain = variant !== 'glass';
  const pocket = variant === 'pocket';

  const tone = useMemo(
    () => ({
      primary: plain ? 'rgba(255,255,255,0.94)' : palette.label,
      secondary: plain ? 'rgba(255,255,255,0.72)' : palette.labelSecondary,
      tertiary: plain ? 'rgba(255,255,255,0.5)' : palette.labelTertiary,
      fieldBg: plain ? 'rgba(255,255,255,0.16)' : palette.fill2,
      fieldBorder: plain ? 'rgba(255,255,255,0.22)' : palette.hairline,
    }),
    [plain, palette],
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
    [palette, tone],
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

  const listRef = useRef<FlatList<BarrageItem>>(null);
  const followLatestRef = useRef(true);
  const [followLatest, setFollowLatest] = useState(true);

  const listItems = useMemo(() => items.slice().reverse(), [items]);
  const lastItemId = listItems.length ? listItems[listItems.length - 1]?.id : '';
  const scrollScheduledRef = useRef(false);
  const draggingRef = useRef(false);

  const scrollToLatest = useCallback(() => {
    if (!followLatestRef.current || !listItems.length) return;
    if (scrollScheduledRef.current) return;
    scrollScheduledRef.current = true;
    requestAnimationFrame(() => {
      scrollScheduledRef.current = false;
      listRef.current?.scrollToEnd({ animated: false });
    });
  }, [listItems.length]);

  useEffect(() => {
    if (!items.length) {
      followLatestRef.current = true;
      setFollowLatest(true);
      return;
    }
    scrollToLatest();
  }, [items.length, lastItemId, scrollToLatest]);

  const updateScrollStickiness = useCallback((e: any) => {
    const native = e?.nativeEvent;
    if (!native) return;
    const { contentOffset, contentSize, layoutMeasurement } = native;
    const contentH = Number(contentSize?.height) || 0;
    const viewH = Number(layoutMeasurement?.height) || 0;
    const offsetY = Number(contentOffset?.y) || 0;
    const fitsViewport = contentH <= viewH + 8;
    const distanceToEnd = contentH - viewH - offsetY;
    if (fitsViewport || distanceToEnd <= 32) {
      if (!followLatestRef.current) {
        followLatestRef.current = true;
        setFollowLatest(true);
      }
    } else if (draggingRef.current && distanceToEnd > 48) {
      if (followLatestRef.current) {
        followLatestRef.current = false;
        setFollowLatest(false);
      }
    }
  }, []);

  const handleScrollBegin = useCallback(() => {
    draggingRef.current = true;
  }, []);

  const handleScrollEnd = useCallback((e: any) => {
    draggingRef.current = false;
    const native = e?.nativeEvent;
    if (!native) return;
    const { contentOffset, contentSize, layoutMeasurement } = native;
    const contentH = Number(contentSize?.height) || 0;
    const viewH = Number(layoutMeasurement?.height) || 0;
    const offsetY = Number(contentOffset?.y) || 0;
    const distanceToEnd = contentH - viewH - offsetY;
    if (contentH <= viewH + 8 || distanceToEnd <= 32) {
      followLatestRef.current = true;
      setFollowLatest(true);
    } else {
      followLatestRef.current = false;
      setFollowLatest(false);
    }
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: BarrageItem }) => (
      <View style={styles.row}>
        <Text style={[styles.rowText, { color: itemColor(item.kind) }]}>{item.text}</Text>
      </View>
    ),
    [itemColor],
  );

  const inputRow = (
    <View style={[styles.inputRow, pocket && styles.pocketInputRow]}>
      <View style={{ flex: 1 }}>
        <TextInput
          style={[
            styles.input,
            { color: tone.primary, backgroundColor: tone.fieldBg, borderColor: tone.fieldBorder },
            pocket && styles.pocketInput,
          ]}
          value={draft}
          onChangeText={setDraft}
          placeholder={
            ready ? t(pocket ? '对成员说...' : '发条弹幕...') : t('弹幕连接中，点此重连')
          }
          placeholderTextColor={tone.tertiary}

          editable={!sending}
          onFocus={() => {
            if (!ready) {
              try {
                retry();
              } catch {}
            }
          }}
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
        style={[
          styles.sendBtn,
          pocket && styles.pocketSendBtn,
          {
            backgroundColor:
              ready && draft.trim() && !sending
                ? palette.tint
                : pocket
                  ? 'rgba(20,20,24,0.48)'
                  : tone.fieldBg,
          },
        ]}
      >
        {sending ? (
          <Text
            style={[styles.sendText, { color: pocket ? 'rgba(255,255,255,0.75)' : tone.tertiary }]}
          >
            ··
          </Text>
        ) : (
          <MaterialCommunityIcons
            name="send"
            size={pocket ? 18 : 16}
            color={
              ready && draft.trim()
                ? palette.onTint
                : pocket
                  ? 'rgba(255,255,255,0.55)'
                  : tone.tertiary
            }
          />
        )}
      </TouchableOpacity>
    </View>
  );

  const header =
    compact || inputOnly ? null : (
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
        {items.length ? (
          <Text style={[styles.count, { color: tone.tertiary }]}>{items.length}</Text>
        ) : null}
      </View>
    );

  const inner = inputOnly ? (
    <>
      {hint ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={[styles.hint, { color: palette.tint, flex: 1 }]} numberOfLines={1}>
            {hint}
          </Text>
          <TouchableOpacity
            onPress={() => {
              setHint('');
              handleSend();
            }}
            hitSlop={styles.hit}
            activeOpacity={0.7}
          >
            <Text
              style={{
                color: palette.tint,
                fontSize: 12,
                fontFamily: fontFamily.system,
                fontWeight: '700',
              }}
            >
              {t('重试')}
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}
      {ready || pocket ? null : (
        <Text
          style={[styles.empty, { color: tone.tertiary, paddingVertical: 2 }]}
          numberOfLines={1}
        >
          {statusText}
        </Text>
      )}
      {inputRow}
    </>
  ) : (
    <>
      {header}
      <FlatList
        ref={listRef}
        data={listItems}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        style={[styles.list, { height }]}
        contentContainerStyle={[styles.listContent, { flexGrow: 1, justifyContent: 'flex-end' }]}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={16}
        maxToRenderPerBatch={16}
        windowSize={5}
        removeClippedSubviews={false}
        onScroll={updateScrollStickiness}
        onContentSizeChange={scrollToLatest}
        onScrollBeginDrag={handleScrollBegin}
        onScrollEndDrag={handleScrollEnd}
        onMomentumScrollEnd={handleScrollEnd}
        scrollEventThrottle={100}
        ListEmptyComponent={
          <Text style={[styles.empty, { color: tone.tertiary }]}>
            {status === 'connected' ? t('暂无弹幕') : statusText}
          </Text>
        }
      />

      {!followLatest ? (
        <TouchableOpacity
          style={[
            styles.scrollBottomBtn,
            { bottom: hideInput ? 12 : 58, backgroundColor: palette.tint },
          ]}
          onPress={() => {
            draggingRef.current = false;
            followLatestRef.current = true;
            setFollowLatest(true);
            scrollToLatest();
          }}
          activeOpacity={0.85}
          accessibilityLabel={t('回到底部')}
        >
          <MaterialCommunityIcons name="chevron-down" size={22} color={palette.onTint} />
        </TouchableOpacity>
      ) : null}
      {hint ? <Text style={[styles.hint, { color: palette.tint }]}>{hint}</Text> : null}
      {hideInput ? null : inputRow}
    </>
  );

  if (plain) {
    return <View style={[styles.wrapPlain, pocket && styles.wrapPocket, style]}>{inner}</View>;
  }
  return (
    <GlassSurface role="card" radius={16} style={[styles.wrap, style]}>
      {inner}
    </GlassSurface>
  );
}

export interface LiveBarragePanelProps extends Omit<LiveBarrageBoardProps, 'source'> {
  liveId?: string;
  enabled?: boolean;
}

export function LiveBarragePanel({
  liveId,
  enabled = true,
  module = 'live',
  ...rest
}: LiveBarragePanelProps) {
  const source = useLiveBarrage({ liveId, enabled, module });
  return <LiveBarrageBoard source={source} liveId={liveId} module={module} {...rest} />;
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 10, paddingTop: 8, paddingBottom: 8, overflow: 'hidden' },

  wrapPlain: {
    paddingHorizontal: 10,
    paddingTop: 6,
    paddingBottom: 8,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.42)',
  },
  wrapPocket: {
    paddingHorizontal: 0,
    paddingTop: 0,
    paddingBottom: 0,
    backgroundColor: 'transparent',
  },
  pocketInputRow: { paddingTop: 0 },
  pocketInput: {
    minHeight: 44,
    borderRadius: 22,
    borderWidth: 0,
    backgroundColor: 'rgba(20,20,24,0.48)',
    paddingHorizontal: 16,
    fontSize: 16,
    fontFamily: fontFamily.system,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 2,
    paddingBottom: 6,
  },
  headerText: { fontSize: 11, fontFamily: fontFamily.system, flexShrink: 1 },
  headerAction: { fontSize: 11, fontWeight: '700' },
  count: { fontSize: 11, marginLeft: 'auto' },
  list: { width: '100%' },
  scrollBottomBtn: {
    position: 'absolute',
    right: 12,
    bottom: 58,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
  },
  listContent: { paddingVertical: 2 },

  row: { minHeight: BARRAGE_ROW_MIN_HEIGHT, paddingVertical: 2 },

  rowText: { fontSize: 12, fontFamily: fontFamily.system, lineHeight: 17, flexShrink: 1 },
  empty: { fontSize: 11, textAlign: 'center', paddingVertical: 12 },
  hint: { fontSize: 11, paddingHorizontal: 2, paddingTop: 4 },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 6 },
  input: {
    flex: 1,
    minHeight: 34,
    maxHeight: 96,
    borderRadius: 17,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 6,
    fontSize: 13,
    fontFamily: fontFamily.system,
    textAlignVertical: 'center',
    includeFontPadding: false,
  },
  sendBtn: {
    height: 34,
    width: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pocketSendBtn: {
    height: 42,
    width: 42,
    borderRadius: 21,
  },
  counter: {
    position: 'absolute',
    right: 8,
    bottom: -14,
    fontSize: 10,
    fontFamily: fontFamily.system,
  },
  sendText: { fontSize: 13, fontWeight: '700' },
  hit: { top: 6, bottom: 6, left: 6, right: 6 },
});

export default LiveBarragePanel;
