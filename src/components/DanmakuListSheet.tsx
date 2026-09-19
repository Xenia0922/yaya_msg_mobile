/**
 * DanmakuListSheet · 弹幕列表抽屉（直播 / 录播通用）
 *
 * 对齐桌面端 danmu-timeline-feature.js 的能力（移动端等价实现）：
 *   ① 弹幕时间轴列表：时间 + 发送者 + 内容（录播按时间升序；直播按最新在上）
 *   ② 搜索：内容 / 发送者
 *   ③ 按发送者筛选：点条目昵称即「只看 TA」；另有「发送者」页按条数排行，点行即筛
 *   ④ 点击条目跳转到该时间（录播）
 *   ⑤ 播放跟随：自动滚到当前播放位置那一条并高亮，手动滚动即暂停跟随
 *
 * UI 按移动端播放器浮层规范：半透明深底 + 白系文字（叠在视频上时不能用玻璃，
 * 逐帧抓背景又贵又糊），面板高度可拖拽。
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useI18n } from '../i18n';

export interface DanmakuListEntry {
  id: string;
  /** 出现时间（秒）。录播 = 播放时间轴；直播无时间轴（传 0） */
  time: number;
  /** 发送者昵称 */
  nick: string;
  /** 正文 */
  text: string;
  /** 类别（直播弹幕用：member/gift/enter/...），用于高亮与配色 */
  kind?: string;
}

export interface DanmakuListSheetProps {
  visible: boolean;
  onClose: () => void;
  /** 弹幕条目。录播请按时间升序传入；直播请按最新在前传入 */
  entries: DanmakuListEntry[];
  /** 当前播放时间（秒）；直播不传 */
  currentTime?: number;
  /** 点击条目跳转（秒）；直播不传 */
  onSeek?: (time: number) => void;
  /** 直播模式：隐藏时间列与跟随，按实时列表展示 */
  live?: boolean;
  /** 弹幕仍在加载 */
  loading?: boolean;
  /** 面板标题（默认「弹幕列表」） */
  title?: string;
}

/** 固定行高（getItemLayout 精确滚动依赖它） */
const ROW_H = 44;
/** 发送者榜最多展示的发送者数 */
const USER_TOP = 60;
const FOLLOW_KEY = 'yaya_danmu_list_follow_v1';

function fmtTime(sec: number): string {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(ss)}` : `${pad(m)}:${pad(ss)}`;
}

/** 直播弹幕类别 → 强调色（成员/礼物/进场用主色与弱化色区分，普通观众保持白色） */
function kindColor(kind: string | undefined): string | null {
  switch (kind) {
    case 'member':
    case 'superman':
    case 'gift':
    case 'pay':
    case 'starwo':
      return '#FF6FA5';
    case 'enter':
    case 'system':
      return 'rgba(255,255,255,0.45)';
    default:
      return null;
  }
}

export function DanmakuListSheet({
  visible,
  onClose,
  entries,
  currentTime = 0,
  onSeek,
  live = false,
  loading = false,
  title,
}: DanmakuListSheetProps) {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const { height: screenH } = useWindowDimensions();

  const MIN_H = Math.round(screenH * 0.3);
  const MAX_H = Math.round(screenH * 0.86);
  const [panelH, setPanelH] = useState(Math.round(screenH * 0.52));
  const panelHRef = useRef(panelH);
  panelHRef.current = panelH;

  const [query, setQuery] = useState('');
  const [nickFilter, setNickFilter] = useState('');
  const [tab, setTab] = useState<'list' | 'users'>('list');
  const [follow, setFollow] = useState(false);
  const listRef = useRef<FlatList<DanmakuListEntry> | null>(null);

  // 跟随开关持久化（对齐桌面 yaya_danmu_follow_enabled）
  useEffect(() => {
    AsyncStorage.getItem(FOLLOW_KEY)
      .then((v) => setFollow(v === '1'))
      .catch(() => undefined);
  }, []);
  const toggleFollow = useCallback(() => {
    setFollow((prev) => {
      const next = !prev;
      AsyncStorage.setItem(FOLLOW_KEY, next ? '1' : '0').catch(() => undefined);
      return next;
    });
  }, []);

  // 关闭时清掉搜索与筛选，下次打开是干净态（筛选容易忘记自己开着 → 误以为弹幕丢了）
  useEffect(() => {
    if (!visible) {
      setQuery('');
      setNickFilter('');
      setTab('list');
    }
  }, [visible]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const nick = nickFilter.toLowerCase();
    if (!q && !nick) return entries;
    return entries.filter((item) => {
      if (nick && item.nick.toLowerCase() !== nick) return false;
      if (!q) return true;
      return item.text.toLowerCase().includes(q) || item.nick.toLowerCase().includes(q);
    });
  }, [entries, query, nickFilter]);

  /** 发送者榜：条数降序（桌面端弹幕分析的等价物） */
  const users = useMemo(() => {
    const map = new Map<string, { nick: string; count: number; first: number }>();
    for (const item of entries) {
      const nick = item.nick || t('匿名');
      const cur = map.get(nick);
      if (cur) cur.count += 1;
      else map.set(nick, { nick, count: 1, first: item.time });
    }
    return Array.from(map.values())
      .sort((a, b) => b.count - a.count || a.first - b.first)
      .slice(0, USER_TOP);
  }, [entries, t]);

  /** 当前播放位置对应的条目下标（仅录播；filtered 为升序，二分查找，长录播也不卡） */
  const activeIndex = useMemo(() => {
    if (live || !filtered.length) return -1;
    const target = currentTime + 0.05;
    let lo = 0;
    let hi = filtered.length - 1;
    let idx = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (filtered[mid].time <= target) {
        idx = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return idx;
  }, [filtered, currentTime, live]);

  // 跟随播放：把当前条目滚到列表上方 1/3 处（提词器式，不做动画避免逐帧重排）
  useEffect(() => {
    if (!visible || !follow || activeIndex < 0) return;
    const list = listRef.current;
    if (!list) return;
    const offset = Math.max(0, (activeIndex - 2) * ROW_H);
    try {
      list.scrollToOffset({ offset, animated: false });
    } catch {
      /* 列表尚未渲染完成 */
    }
  }, [activeIndex, follow, visible]);

  const jumpTo = useCallback(
    (item: DanmakuListEntry) => {
      if (live || !onSeek) return;
      onSeek(item.time);
    },
    [live, onSeek],
  );

  const filterByUser = useCallback((nick: string) => {
    setNickFilter(nick);
    setQuery('');
    setTab('list');
  }, []);

  /** 面板高度拖拽（原生 PanResponder，避免引入 reanimated 依赖） */
  const dragStartRef = useRef(panelH);
  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          dragStartRef.current = panelHRef.current;
        },
        onPanResponderMove: (_e, g) => {
          const next = Math.min(MAX_H, Math.max(MIN_H, dragStartRef.current - g.dy));
          setPanelH(next);
        },
      }),
    [MAX_H, MIN_H],
  );

  const renderRow = useCallback(
    ({ item, index }: { item: DanmakuListEntry; index: number }) => {
      const accent = kindColor(item.kind);
      const isActive = index === activeIndex;
      return (
        <Pressable
          onPress={() => jumpTo(item)}
          style={({ pressed }) => [
            styles.row,
            isActive && styles.rowActive,
            pressed && { backgroundColor: 'rgba(255,255,255,0.1)' },
          ]}
        >
          {isActive ? <View style={styles.activeBar} /> : null}
          {live ? null : (
            <Text style={[styles.time, isActive && { color: '#FF6FA5' }]}>{fmtTime(item.time)}</Text>
          )}
          <Text style={styles.rowText} numberOfLines={2}>
            <Text
              style={[styles.nick, accent ? { color: accent } : null]}
              onPress={(e) => {
                // 点昵称 = 只看 TA；必须阻止冒泡，否则同一手势还会触发外层「跳转到该时间」
                e?.stopPropagation?.();
                if (item.nick) filterByUser(item.nick);
              }}
              suppressHighlighting
            >
              {item.nick ? `${item.nick}：` : ''}
            </Text>
            <Text style={accent ? { color: accent } : undefined}>{item.text}</Text>
          </Text>
        </Pressable>
      );
    },
    [activeIndex, filterByUser, jumpTo, live],
  );

  const renderUserRow = useCallback(
    ({ item }: { item: { nick: string; count: number; first: number } }) => (
      <TouchableOpacity style={styles.row} activeOpacity={0.75} onPress={() => filterByUser(item.nick)}>
        <MaterialCommunityIcons name="account-outline" size={15} color="rgba(255,255,255,0.6)" style={{ marginRight: 8 }} />
        <Text style={[styles.rowText, { flex: 1 }]} numberOfLines={1}>
          <Text style={styles.nick}>{item.nick}</Text>
        </Text>
        <Text style={styles.count}>{t('{n} 条', { n: item.count })}</Text>
        <MaterialCommunityIcons name="filter-variant" size={15} color="rgba(255,255,255,0.5)" style={{ marginLeft: 6 }} />
      </TouchableOpacity>
    ),
    [filterByUser, t],
  );

  const body = (
    <View style={[styles.sheet, { height: panelH, paddingBottom: Math.max(insets.bottom, 8) }]}>
      {/* 拖拽手柄 + 标题行 */}
      <View {...pan.panHandlers} style={styles.handleArea}>
        <View style={styles.handle} />
      </View>
      <View style={styles.headerRow}>
        <MaterialCommunityIcons name="comment-text-multiple-outline" size={15} color="rgba(255,255,255,0.85)" />
        <Text style={styles.title} numberOfLines={1}>
          {title || t('弹幕列表')}
        </Text>
        <Text style={styles.total}>
          {filtered.length === entries.length
            ? t('{n} 条', { n: entries.length })
            : `${filtered.length}/${entries.length}`}
        </Text>
        {!live && onSeek ? (
          <TouchableOpacity onPress={toggleFollow} activeOpacity={0.75} style={[styles.followBtn, follow && styles.followBtnOn]}>
            <MaterialCommunityIcons
              name={follow ? 'crosshairs-gps' : 'crosshairs'}
              size={12}
              color={follow ? '#fff' : 'rgba(255,255,255,0.75)'}
            />
            <Text style={[styles.followText, follow && { color: '#fff' }]}>{t('跟随')}</Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} activeOpacity={0.7}>
          <MaterialCommunityIcons name="close" size={18} color="rgba(255,255,255,0.85)" />
        </TouchableOpacity>
      </View>

      {/* 分段：弹幕 / 发送者（发送者榜点行即筛） */}
      <View style={styles.tabRow}>
        {(['list', 'users'] as const).map((key) => {
          const on = tab === key;
          return (
            <TouchableOpacity
              key={key}
              activeOpacity={0.8}
              onPress={() => setTab(key)}
              style={[styles.tab, on && styles.tabOn]}
            >
              <Text style={[styles.tabText, on && styles.tabTextOn]}>
                {key === 'list' ? t('弹幕') : t('发送者')}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {tab === 'list' ? (
        <>
          <View style={styles.searchRow}>
            <MaterialCommunityIcons name="magnify" size={15} color="rgba(255,255,255,0.55)" />
            <TextInput
              style={styles.searchInput}
              value={query}
              onChangeText={setQuery}
              placeholder={t('搜索内容 / 发送者')}
              placeholderTextColor="rgba(255,255,255,0.4)"
              returnKeyType="search"
            />
            {query ? (
              <TouchableOpacity onPress={() => setQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <MaterialCommunityIcons name="close-circle" size={14} color="rgba(255,255,255,0.5)" />
              </TouchableOpacity>
            ) : null}
          </View>
          {nickFilter ? (
            <View style={styles.filterRow}>
              <Text style={styles.filterLabel} numberOfLines={1}>
                {t('只看：{name}', { name: nickFilter })}
              </Text>
              <TouchableOpacity onPress={() => setNickFilter('')} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                <Text style={styles.filterClear}>{t('清除')}</Text>
              </TouchableOpacity>
            </View>
          ) : null}
          <FlatList
            ref={listRef}
            data={filtered}
            renderItem={renderRow}
            keyExtractor={(item) => item.id}
            getItemLayout={(_d, index) => ({ length: ROW_H, offset: ROW_H * index, index })}
            extraData={activeIndex}
            style={{ flex: 1 }}
            contentContainerStyle={styles.listContent}
            initialNumToRender={16}
            maxToRenderPerBatch={16}
            windowSize={9}
            removeClippedSubviews
            keyboardShouldPersistTaps="handled"
            // 手动滚动 = 用户在看历史 → 自动暂停跟随（再点「跟随」可恢复）
            onScrollBeginDrag={() => follow && toggleFollow()}
            ListEmptyComponent={
              <Text style={styles.empty}>
                {loading
                  ? t('弹幕加载中…')
                  : entries.length
                    ? t('没有匹配的弹幕')
                    : live
                      ? t('暂无弹幕')
                      : t('该视频暂无弹幕')}
              </Text>
            }
          />
        </>
      ) : (
        <FlatList
          data={users}
          renderItem={renderUserRow}
          keyExtractor={(item) => item.nick}
          style={{ flex: 1 }}
          contentContainerStyle={styles.listContent}
          initialNumToRender={16}
          maxToRenderPerBatch={16}
          windowSize={9}
          ListEmptyComponent={<Text style={styles.empty}>{t('暂无弹幕')}</Text>}
        />
      )}
    </View>
  );

  return (
    <Modal visible={visible} transparent animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.root}>
        {/* 点空白处关闭；面板自身是兄弟节点，不会误触关闭 */}
        <Pressable style={styles.backdrop} onPress={onClose} />
        {body}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.42)' },
  sheet: {
    backgroundColor: 'rgba(18,18,20,0.96)',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: 'hidden',
  },
  // 手柄命中区做高一些（22px）：太窄会「拖不动面板」
  handleArea: { alignItems: 'center', justifyContent: 'center', height: 22 },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.35)' },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingBottom: 8 },
  title: { fontSize: 13, fontWeight: '700', color: 'rgba(255,255,255,0.94)', flexShrink: 1 },
  total: { fontSize: 11, color: 'rgba(255,255,255,0.5)', marginLeft: 'auto' },
  followBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  followBtnOn: { backgroundColor: '#FF6FA5' },
  followText: { fontSize: 10, fontWeight: '700', color: 'rgba(255,255,255,0.75)' },
  tabRow: { flexDirection: 'row', gap: 6, paddingHorizontal: 14, paddingBottom: 8 },
  tab: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.1)' },
  tabOn: { backgroundColor: 'rgba(255,255,255,0.9)' },
  tabText: { fontSize: 11, fontWeight: '700', color: 'rgba(255,255,255,0.75)' },
  tabTextOn: { color: '#111' },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginHorizontal: 14,
    paddingHorizontal: 10,
    height: 34,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  searchInput: { flex: 1, fontSize: 12, color: 'rgba(255,255,255,0.94)', padding: 0 },
  filterRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingTop: 8 },
  filterLabel: { fontSize: 11, color: 'rgba(255,255,255,0.7)', flexShrink: 1 },
  filterClear: { fontSize: 11, fontWeight: '700', color: '#FF6FA5' },
  listContent: { paddingTop: 6, paddingBottom: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: ROW_H,
    paddingHorizontal: 14,
    paddingVertical: 4,
  },
  rowActive: { backgroundColor: 'rgba(255,111,165,0.16)' },
  activeBar: { position: 'absolute', left: 0, top: 6, bottom: 6, width: 3, borderRadius: 2, backgroundColor: '#FF6FA5' },
  time: { fontSize: 11, color: 'rgba(255,255,255,0.45)', width: 52, fontVariant: ['tabular-nums'] },
  rowText: { flex: 1, fontSize: 12.5, lineHeight: 18, color: 'rgba(255,255,255,0.92)' },
  nick: { fontWeight: '700', color: 'rgba(255,255,255,0.72)' },
  count: { fontSize: 11, color: 'rgba(255,255,255,0.5)' },
  empty: { textAlign: 'center', fontSize: 12, color: 'rgba(255,255,255,0.5)', paddingVertical: 28 },
});

export default DanmakuListSheet;
