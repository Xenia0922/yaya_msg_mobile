/**
 * 鸡腿榜 v3.0 —— **参考实现**（其他页面照这个结构写）
 *
 * 布局与旧版（src/screens/MeleeRankScreen.tsx）的差别：
 *   旧：header → 成员选择 → 分段 → 日期胶囊行 → 计数行 → 领奖台 → 列表（5 层，内容起点 23%）
 *   新：header → 一行工具条（分段 + 周次）→ 列表（2 层，内容起点 14%）
 *
 * 具体决策（对应 README 的规则）：
 *   1. 周次 = **次级**：文字 + caret，点开底部面板；不再用第二个胶囊行（旧版两个胶囊同级，主次不分）
 *   2. 删掉计数行（元信息混在筛选区是错误层级）
 *   3. 删掉领奖台（与列表前三名重复，且三个大色块抢走了数字的焦点）
 *   4. 行内只留一个数字焦点：贡献值右对齐 + tabular-nums，眼睛能竖着比
 *   5. 名次只用色区分前三（主色），不做背景块
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { useNavigation } from '@react-navigation/native';

import pocketApi from '../../api/pocket48';
import { PerfFlatList } from '../../components/PerfFlatList';
import { NetworkImage } from '../../components/NetworkImage';
import { useMemberStore } from '../../store';
import { useI18n } from '../../i18n';
import { usePalette } from '../../theme';
import { normalizeUrl } from '../../utils/data';
import { extractRankList, extractWeeks, WeekItem } from '../../utils/meleeParse';
import type { Member } from '../../types';

import { Screen } from '../layout/Screen';
import { Divider, EmptyHint, ListRow } from '../layout/primitives';
import { Segmented } from '../components/Segmented';
import { contentBottom, GUTTER, R, SPACE, TYPE } from '../tokens';

type Mode = 'week' | 'person';

function pickNum(...vals: any[]): number {
  for (const v of vals) {
    if (v === undefined || v === null || v === '') continue;
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function fmt(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

/** 榜单项 → 统一视图模型（字段兜底顺序与旧版一致） */
function toRow(item: any, index: number) {
  const u = item?.baseUserInfo || item?.userInfo || item?.user || item || {};
  const rankNum = Number(item?.rankNum || item?.rank || item?.no || index + 1);
  const name = String(u.nickname || u.nickName || u.name || item?.starName || '');
  const avatar = normalizeUrl(String(u.userAvatar || u.avatar || u.headImg || u.headUrl || u.picPath || ''));
  const melee = pickNum(item?.melee, item?.meleeValue, item?.score, item?.total, item?.charm);
  const team = String(u.teamName || u.team || item?.starTeam || '');
  return { key: String(u.userId || item?.rankNum || item?.resId || item?.id || index), rankNum, name, avatar, melee, team };
}

export default function MeleeRankV3() {
  const navigation = useNavigation<any>();
  const palette = usePalette();
  const { t } = useI18n();
  const members = useMemberStore((s) => s.members);

  const [mode, setMode] = useState<Mode>('week');
  const [weeks, setWeeks] = useState<WeekItem[]>([]);
  const [week, setWeek] = useState<WeekItem | null>(null);
  const [rows, setRows] = useState<any[]>([]);
  const [member, setMember] = useState<Member | null>(null);
  const [personRows, setPersonRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [weekSheet, setWeekSheet] = useState(false);
  const [query, setQuery] = useState('');

  /** 周榜：先取索引（周列表 + 当前周），再取该周榜 */
  const loadWeek = useCallback(async (wk?: WeekItem | null) => {
    setLoading(true);
    setError('');
    try {
      let target = wk || week;
      if (!target) {
        const index = await pocketApi.getMeleeRankPage();
        const list = extractWeeks(index);
        setWeeks(list);
        target = list[0] || null;
        if (target) setWeek(target);
      }
      if (!target) {
        setRows([]);
        return;
      }
      const res = await pocketApi.getMeleeWeekRank((target as WeekItem).weekRankId);
      setRows(extractRankList(res));
    } catch (e: any) {
      setError(String(e?.message || e));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [week]);

  const loadPerson = useCallback(async (m: Member) => {
    setLoading(true);
    setError('');
    try {
      const res = await pocketApi.getPersonMeleeRankPage(Number(m.id));
      setPersonRows(extractRankList(res));
    } catch (e: any) {
      setError(String(e?.message || e));
      setPersonRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadWeek(); /* 首屏 */ }, []);

  const data = mode === 'week' ? rows : personRows;
  const view = useMemo(() => data.map(toRow), [data]);

  const memberHits = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [] as Member[];
    return members.filter((m) => String(m.ownerName || '').toLowerCase().includes(q)).slice(0, 12);
  }, [members, query]);

  const toolbar = (
    <>
      <Segmented
        options={[{ key: 'week' as const, label: t('周榜') }, { key: 'person' as const, label: t('成员贡献') }]}
        value={mode}
        onChange={(k) => {
          setMode(k);
          if (k === 'person' && member) loadPerson(member);
        }}
      />
      <View style={{ flex: 1 }} />
      {mode === 'week' ? (
        <Pressable onPress={() => setWeekSheet(true)} style={styles.weekBtn} hitSlop={8}>
          <Text style={[TYPE.secondary, { color: palette.label }]} numberOfLines={1}>
            {week?.weekRankName || t('选择周次')}
          </Text>
          <MaterialCommunityIcons name="chevron-down" size={16} color={palette.labelTertiary} />
        </Pressable>
      ) : null}
    </>
  );

  return (
    <Screen
      title={t('鸡腿榜')}
      onBack={() => navigation.goBack()}
      actions={[{ icon: 'refresh', onPress: () => (mode === 'week' ? loadWeek(week) : member && loadPerson(member)) }]}
      toolbar={toolbar}
    >
      {mode === 'person' ? (
        <View style={[styles.searchWrap, { borderBottomColor: palette.hairline }]}>
          <MaterialCommunityIcons name="magnify" size={18} color={palette.labelTertiary} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={t('搜索成员')}
            placeholderTextColor={palette.labelTertiary}
            style={[TYPE.body, styles.searchInput, { color: palette.label }]}
            autoCorrect={false}
          />
          {member ? (
            <Text style={[TYPE.caption, { color: palette.labelSecondary }]} numberOfLines={1}>
              {member.ownerName}
            </Text>
          ) : null}
        </View>
      ) : null}

      {mode === 'person' && query.trim() ? (
        <View style={{ flex: 1 }}>
          {memberHits.map((m) => (
            <Pressable
              key={m.id}
              onPress={() => { setMember(m); setQuery(''); loadPerson(m); }}
            >
              <ListRow title={String(m.ownerName || '')} subtitle={String((m as any).team || '')} />
            </Pressable>
          ))}
          {memberHits.length === 0 ? <EmptyHint icon="account-search-outline" title={t('没有匹配成员')} /> : null}
        </View>
      ) : loading && view.length === 0 ? (
        <View style={styles.center}><ActivityIndicator color={palette.tint} /></View>
      ) : error ? (
        <EmptyHint icon="alert-circle-outline" title={t('加载失败')} hint={error} />
      ) : mode === 'person' && !member ? (
        <EmptyHint icon="account-outline" title={t('先选成员')} hint={t('在上方搜索框输入成员名')} />
      ) : view.length === 0 ? (
        <EmptyHint icon="chart-bar" title={t('暂无排名数据')} />
      ) : (
        <PerfFlatList
          data={view}
          keyExtractor={(item: any) => item.key}
          contentContainerStyle={{ paddingBottom: contentBottom(false) }}
          ItemSeparatorComponent={() => <Divider inset={GUTTER + 28 + SPACE.md + 36 + SPACE.md} />}
          refreshControl={
            <RefreshControl
              refreshing={loading}
              onRefresh={() => (mode === 'week' ? loadWeek(week) : member && loadPerson(member))}
              tintColor={palette.tint}
              colors={[palette.tint]}
            />
          }
          renderItem={({ item }: any) => (
            <ListRow
              leading={
                <Text
                  style={[
                    TYPE.body,
                    { fontVariant: ['tabular-nums'], color: item.rankNum <= 3 ? palette.tint : palette.labelTertiary },
                  ]}
                >
                  {item.rankNum}
                </Text>
              }
              avatar={item.avatar || undefined}
              title={item.name || t('未知成员')}
              subtitle={item.team || undefined}
              value={fmt(item.melee)}
              highlightValue={item.rankNum <= 3}
            />
          )}
        />
      )}

      {/* 周次选择：底部面板（Sheet 允许用玻璃/实底；这里用实底 + 大圆角，避免和内容抢注意力） */}
      <Modal visible={weekSheet} transparent animationType="fade" onRequestClose={() => setWeekSheet(false)}>
        <Pressable style={styles.backdrop} onPress={() => setWeekSheet(false)} />
        <View style={[styles.sheet, { backgroundColor: palette.surfaceElevated }]}>
          <View style={styles.sheetHandle} />
          <Text style={[TYPE.title, { color: palette.label, paddingHorizontal: GUTTER, paddingVertical: SPACE.md }]}>
            {t('选择周次')}
          </Text>
          <PerfFlatList
            data={weeks}
            keyExtractor={(w: any) => String(w.weekRankId)}
            contentContainerStyle={{ paddingBottom: SPACE.lg }}
            renderItem={({ item }: any) => {
              const active = week?.weekRankId === item.weekRankId;
              return (
                <Pressable
                  onPress={() => { setWeek(item); setWeekSheet(false); loadWeek(item); }}
                  style={styles.weekRow}
                >
                  <Text style={[TYPE.body, { flex: 1, color: active ? palette.tint : palette.label }]}>
                    {item.weekRankName}
                  </Text>
                  {active ? <MaterialCommunityIcons name="check" size={18} color={palette.tint} /> : null}
                </Pressable>
              );
            }}
          />
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  weekBtn: { flexDirection: 'row', alignItems: 'center', gap: SPACE.xs, maxWidth: 160 },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.sm,
    paddingHorizontal: GUTTER,
    height: 44,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  searchInput: { flex: 1, padding: 0 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '60%', borderTopLeftRadius: R.lg, borderTopRightRadius: R.lg },
  sheetHandle: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: 'rgba(128,128,128,0.35)', marginTop: SPACE.sm },
  weekRow: { height: 48, paddingHorizontal: GUTTER, flexDirection: 'row', alignItems: 'center' },
});
