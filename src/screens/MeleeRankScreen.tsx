import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PerfFlatList } from '../components/PerfFlatList';

import {
  ActivityIndicator,
  Image,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { useNavigation } from '@react-navigation/native';
import ScreenHeader from '../components/ScreenHeader';
import { FadeInView } from '../components/Motion';
import { GlassSegmented } from '../components/GlassSegmented';
import MemberPicker from '../components/MemberPicker';
import pocketApi from '../api/pocket48';
import { useI18n } from '../i18n';
import { errorMessage, normalizeUrl } from '../utils/data';
import { Member } from '../types';
import { extractRankList, extractWeeks, WeekItem } from '../utils/meleeParse';
import { usePalette, radiiAlias } from '../theme';
import { typography } from '../theme/typography';
import { EmptyState, ErrorState } from '../components/StateViews';
import { Skeleton } from '../components/Skeleton';
import { GlassSurface } from '../components/GlassSurface';

// 鸡腿榜页签：周榜 + 成员贡献（年榜已按需求移除 2026-10-19）
type ViewMode = 'week' | 'person';

const MODES: { key: ViewMode; label: string }[] = [
  { key: 'week', label: '周榜' },
  { key: 'person', label: '成员贡献' },
];

/**
 * 取首个有效数值：只跳过 undefined/null/''，**保留 0**。
 * 数值字段此前用 `a || b || c` 串联 → 真实值 0（新用户/0 贡献）会被跳过并落到下一字段，
 * 显示成别的字段的数值（榜单出现"0 显示为别的数"）。
 */
function pickNum(...vals: any[]): number {
  for (const v of vals) {
    if (v === undefined || v === null || v === '') continue;
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

/**
 * 瞬时失败重试（2026-10-06 新增）：鸡腿榜走官方网关，实测**偶发 504 / 超时** ——
 * 同一个请求时好时坏，用户看到的就是「偶尔加载不出来」。
 * 只对「看起来是瞬时」的错误重试（超时/网络/5xx），业务错误（4xx、业务码）不重试，
 * 避免把明确的失败拖成 3 倍等待。
 */
async function withTransientRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: any;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (e: any) {
      lastErr = e;
      const msg = String(e?.message || e || '');
      const transient = /timeout|timed out|超时|network|Network|failed to fetch|50[0-9]|Unexpected end|JSON/i.test(msg);
      if (!transient || i === attempts - 1) throw e;
      await new Promise((r) => setTimeout(r, i === 0 ? 400 : 900));
    }
  }
  throw lastErr;
}

export default function MeleeRankScreen() {
  const navigation = useNavigation<any>();
  const palette = usePalette();
  const { t } = useI18n();
  const [mode, setMode] = useState<ViewMode>('week');
  const [member, setMember] = useState<Member | null>(null);
  const [weeks, setWeeks] = useState<WeekItem[]>([]);
  const [selectedWeek, setSelectedWeek] = useState<WeekItem | null>(null);
  const selectedWeekRef = useRef(selectedWeek);
  selectedWeekRef.current = selectedWeek;
  const [ranks, setRanks] = useState<any[]>([]);
  const [personRanks, setPersonRanks] = useState<any[]>([]);
  /** 成员贡献头部：查询成员 + 总贡献值（上游 queryPersonMeleeRankData summary 语义） */
  const [personTotal, setPersonTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const nextIdRef = useRef('');
  const hasMoreRef = useRef(false);
  const reqIdRef = useRef(0); // Y31: 请求序号（切榜/切周时丢弃过期响应）

  const switchMode = (m: ViewMode) => {
    /**
     * ⚠️ 已在该页签 → 直接返回（2026-10-06 修复）：`GlassSegmented` 的每一格
     * **每次点击都会回调 onChange（含点当前已选中那格）**。
     * 此前无条件 `setRanks([])` 而 `setMode(同一个值)` 不触发下面的加载 effect →
     * **榜单被清空后永不重载**，表现为「点一下当前页签 → 榜单变『暂无排名数据』」。
     */
    if (m === mode) return;
    setRanks([]);
    setPersonRanks([]);
    setPersonTotal(null);
    setError('');
    nextIdRef.current = '';
    hasMoreRef.current = false;
    setMode(m);
  };

  const loadRank = useCallback(async () => {
    const rid = ++reqIdRef.current;
    setLoading(true);
    setError('');
    try {
      let res: any;
      if (mode === 'week') {
        const wk = selectedWeekRef.current;
        res = wk
          ? await withTransientRetry(() => pocketApi.getMeleeWeekRank(wk.weekRankId))
          : await withTransientRetry(() => pocketApi.getMeleeRankPage());
      } else {
        return;
      }
      const data = res?.content ?? res?.data ?? res ?? {};
      // 优先从返回体补齐周列表（部分接口把 weekList 挂在 content 下）
      const ws = extractWeeks(data);
      if (ws.length) {
        // 稳定排序：按 weekRankId 降序（最新在前）——接口返回顺序不保证，
        // chips 顺序飘忽会让用户找不到刚看过的那期
        ws.sort((a, b) => Number(b.weekRankId) - Number(a.weekRankId));
        setWeeks((prev) => (prev.length ? prev : ws));
        // 默认选中「最新一期」：不能假设数组顺序（接口可能降序，取末项会选到最旧周）
        if (!selectedWeekRef.current) {
          const latest = ws.reduce((a, b) => (Number(b.weekRankId) > Number(a.weekRankId) ? b : a), ws[0]);
          setSelectedWeek(latest);
        }
      }
      const list = extractRankList(data);
      // Y31: 过期响应丢弃（期间已切榜/切周）
      if (rid !== reqIdRef.current) return;
      setRanks(list);
      // 分页游标：getMeleeRankPage 支持 nextId
      const nextId = String(data?.nextId || data?.next || '');
      nextIdRef.current = nextId;
      hasMoreRef.current = !!nextId && list.length > 0;
      // Y31: 空数据不 setError（否则错误态与空态同时渲染）——列表自显空态
      if (rid !== reqIdRef.current) return;
    } catch (e: any) {
      if (rid !== reqIdRef.current) return; // Y31
      setError(errorMessage(e));
      setRanks([]);
    } finally {
      if (rid === reqIdRef.current) setLoading(false);
    }
  }, [mode, t]);

  const loadMoreRank = useCallback(async () => {
    if (loading || loadingMore || !hasMoreRef.current || !nextIdRef.current) return;
    setLoadingMore(true);
    try {
      let res: any;
      if (mode === 'week') {
        const wk2 = selectedWeekRef.current;
        res = wk2
          ? await withTransientRetry(() => pocketApi.getMeleeWeekRank(wk2.weekRankId, nextIdRef.current))
          : await withTransientRetry(() => pocketApi.getMeleeRankPage(0, nextIdRef.current));
      } else {
        return;
      }
      const data = res?.content ?? res?.data ?? res ?? {};
      const list = extractRankList(data);
      const nextId = String(data?.nextId || data?.next || '');
      setRanks((prev) => {
        const seen = new Set(prev.map((it) => String(it.userId || it.rankNum || it.resId || it.id)));
        const fresh = list.filter((it) => !seen.has(String(it.userId || it.rankNum || it.resId || it.id)));
        return [...prev, ...fresh];
      });
      /**
       * ⚠️ 上游 getMeleeWeekRank 的 nextId 是**失效字段**（2026-10-06 实测）：
       * 把返回的 nextId 原样传回去，返回的 nextId 还是同一个值，rankUserList 也**逐条相同**
       * （试过 int/字符串/0/offset/page/lastId/next/limit 共 9 种传参，全部返回同一份）。
       * 且周榜本身只有 7 个名额（weekRankId 415~424 共 10 期实测：全部 7 条、rankNum=[1..7]）。
       * 若不自判，上拉会无限触发、每次拿回同一批又被 seen 去重全滤掉 → 表现为「滑到底没反应」。
       * 判定：返回值与本次传入相同时视为不可翻页，直接停止。
       */
      if (nextId && nextId === String(nextIdRef.current || '')) {
        nextIdRef.current = '';
        hasMoreRef.current = false;
      } else {
        nextIdRef.current = nextId;
        hasMoreRef.current = !!nextId && list.length > 0;
      }
    } catch {
      hasMoreRef.current = false;
    } finally {
      setLoadingMore(false);
    }
  }, [loading, loadingMore, mode, t]);

  const loadPerson = useCallback(async (m: Member) => {
    if (!m?.id) {
      setPersonRanks([]);
      setPersonTotal(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await withTransientRetry(() => pocketApi.getPersonMeleeRankPage(Number(m.id)));
      const data = res?.content ?? res?.data ?? {};
      const list = Array.isArray(data?.charmInfo) ? data.charmInfo : extractRankList(data);
      setPersonRanks(list);
      // 总贡献值 = 各贡献用户 totalCharm 之和（上游 queryPersonMeleeRankData 同口径）
      const total = list.reduce((sum: number, it: any) => sum + pickNum(it?.totalCharm, it?.charm, it?.charmValue, it?.total, it?.score), 0);
      setPersonTotal(total);
      // 空数据不 setError：交给列表 ListEmptyComponent 渲染，避免错误态与空态重叠（与周榜分支一致）
    } catch (e: any) {
      setError(errorMessage(e));
      setPersonRanks([]);
      setPersonTotal(null);
    } finally {
      setLoading(false);
    }
  }, [t]);

  /**
   * ⚠️ 拆成两个 effect（2026-10-06）：日期栏现在在两个页签下都常驻，
   * 若沿用「一个 effect 同时依赖 selectedWeek」的写法，在成员贡献页点日期会**白跑一次
   * loadPerson**（贡献榜数据与周次无关）。拆开后各自只依赖自己真正关心的输入。
   */
  // 周榜：模式 或 选中周次 变化 → 拉对应榜单
  useEffect(() => {
    if (mode === 'week') loadRank();
  }, [mode, selectedWeek, loadRank]);

  // 成员贡献：模式 或 选中成员 变化 → 拉贡献榜（与周次无关）
  useEffect(() => {
    if (mode !== 'person') return;
    if (member) loadPerson(member);
    else {
      setPersonRanks([]);
      setPersonTotal(null);
      setLoading(false);
    }
  }, [mode, member, loadPerson]);

  const renderWeekChip = ({ item }: { item: WeekItem }) => {
    const active = selectedWeek?.weekRankId === item.weekRankId;
    /**
     * ⚠️ 这里**故意不用 `Pill`**（2026-10-06 实测修复「切换日期瞬间 chip 被挤压」）：
     * `Pill` 在选中/未选中之间会切换**两套完全不同的元素树**（实心 Pressable ↔ GlassSurface 包裹），
     * 换树会给 Android 一帧未完成测量的重排 —— 连拍实测：切换那一帧粉色胶囊高度塌成 12dp
     * （文字仍是全尺寸、溢出在外），用户看到的就是「日期被挤压一下」。
     * 这里用**结构恒定**的实底 chip：只改 backgroundColor，子树永不变化 → 不重排、无闪帧。
     *
     * 附带好处：逐卡 `GlassSurface` 违反项目自己的规则（列表/网格逐卡禁玻璃 —— 每个 chip 一次
     * backdrop 采样，滚动时逐帧重算模糊）。实底 chip 既符合规范又快。
     */
    return (
      <Pressable
        onPress={() => {
          /**
           * ⚠️ 点已选中的同一周 → 无操作（2026-10-06 修复）：
           * 此前无条件 `setRanks([]) + setSelectedWeek(item)`，而 `item` 就是当前
           * `selectedWeek` 的同一个对象引用 → setState 被 React 判为无变化、**加载 effect 不重跑**
           * → 榜单被清空后卡在「暂无排名数据」（用户反馈的「双击日期像是刷新/变空」）。
           */
          if (selectedWeek?.weekRankId === item.weekRankId) return;
          /**
           * ⚠️ 刻意**不** `setRanks([])`（2026-10-06）：清空会让列表瞬间塌成骨架屏 →
           * 页面内容高度骤变、整块区域重排，切换瞬间看起来「被挤一下」。
           * 改为保留上一周数据直到新数据到达（loadRank 成功时整体替换），
           * 切换期间只在标题旁显示小转圈 —— 页面高度全程不变。
           */
          setSelectedWeek(item);
        }}
        style={styles.weekChipWrap}
      >
        {/* 背景层独立：尺寸由 weekChipWrap 定死（32dp），背景层只是 absoluteFill + 小圆角。
            ⚠️ 之前把 backgroundColor + borderRadius:999 直接放在定尺寸的节点上，实测切换那一帧
            粉色矩形会按**文字外框**绘制（连拍：h=36px 且文字同步上移 31px）→ 用户看到「日期被挤一下」。
            圆角也刻意用 16（= 高度一半）而不是 999：超过半高的半径在 Android 上会走另一条绘制路径。 */}
        <View
          pointerEvents="none"
          style={[styles.weekChipBg, { backgroundColor: active ? palette.tint : palette.fill2 }]}
        />
        <Text
          numberOfLines={1}
          style={[typography.footnote, { fontWeight: '600', color: active ? '#fff' : palette.label }]}
        >
          {item.weekRankName}
        </Text>
      </Pressable>
    );
  };

  const rankMax = useMemo(() => {
    let m = 1;
    for (const it of ranks) {
      const v = pickNum(it.melee, it.meleeValue, it.score, it.total, it.charm);
      if (v > m) m = v;
    }
    return m;
  }, [ranks]);

  // 成员贡献进度条基准（同 RankCard 逻辑；除零保护）
  const personMax = useMemo(() => {
    let m = 1;
    for (const it of personRanks) {
      const v = pickNum(it?.totalCharm, it?.charm, it?.charmValue, it?.total, it?.score);
      if (v > m) m = v;
    }
    return m;
  }, [personRanks]);

  const renderRank = useCallback(
    ({ item, index }: { item: any; index: number }) => (
      <RankCard item={item} index={index} max={rankMax} />
    ),
    [rankMax],
  );
  const renderPerson = useCallback(
    ({ item, index }: { item: any; index: number }) => (
      <PersonCard item={item} index={index} max={personMax} />
    ),
    [personMax],
  );

  const showSkeleton = loading && ranks.length === 0 && mode !== 'person';
  const showPersonSkeleton = loading && personRanks.length === 0 && mode === 'person';

  return (
    <View style={styles.container}>
      <ScreenHeader title={t('鸡腿榜')} onBack={() => navigation.goBack()} />

      <View style={styles.modeRow}>
        {/* 页签用全站标准分段控件（GlassSegmented：玻璃轨道 + 滑动玻璃胶囊 + tint 文字）。
            ⚠️ 此前是 2 个 `flex:1` 的 Pill —— selected 态是**实心 tint 填充**，
            被 flex:1 拉到各占半屏 → 一块占半屏宽的纯粉胶囊，与全站玻璃语言冲突（用户实测截图反馈）。 */}
        <GlassSegmented
          options={MODES.map((m) => ({ key: m.key, label: t(m.label) }))}
          value={mode}
          onChange={switchMode}
        />
      </View>

      {mode === 'person' && (
        <MemberPicker selectedMember={member} onSelect={(m) => { setPersonRanks([]); setMember(m); }} placeholder={t('搜索成员查看鸡腿贡献...')} />
      )}

      {/*
        ⚠️ 日期栏**两个页签下都常驻**（2026-10-06 修复「切换时日期栏塌陷」）：
        此前写成 `mode === 'week' && ...` → 切到「成员贡献」时整行被卸载，
        切回来时**重新挂载**：挂载后的第 1 帧父级尚未完成布局，chip 只有一行文字高（连拍实测 12dp，
        白字溢出在粉色块外），用户看到的就是「日期栏塌陷一下」。
        常驻即可：不卸载 → 无挂载帧 → 不塌陷；同时保留横向滚动位置，
        切回「周榜」时你上次选的那一期仍在原位。
        （选中周次只影响周榜；在成员贡献页点它不改变当前视图，切回即生效。）
      */}
      {weeks.length > 0 && (
        <PerfFlatList
          horizontal
          data={weeks}
          keyExtractor={(item) => String(item.weekRankId)}
          renderItem={renderWeekChip}
          style={styles.weekList}
          contentContainerStyle={styles.weekListContent}
          showsHorizontalScrollIndicator={false}
          /* 短横列表不需要裁剪优化；Android 上 removeClippedSubviews 对横向列表有已知渲染瑕疵 */
          removeClippedSubviews={false}
        />
      )}

      {error ? (
        <ErrorState title={error} onAction={() => (mode === 'person' && member ? loadPerson(member) : loadRank())} />
      ) : null}

      {mode === 'person' ? (
        showPersonSkeleton ? (
          <SkeletonRankList />
        ) : (
          <PerfFlatList
            data={personRanks}
            keyExtractor={(item: any, index: number) => String(item.userId || item.id || item.uid || item.resId || `p${index}`)}
            contentContainerStyle={styles.list}
            initialNumToRender={12}
            maxToRenderPerBatch={12}
            windowSize={7}
            renderItem={renderPerson}
            refreshControl={
              <RefreshControl
                refreshing={loading}
                onRefresh={() => (member ? loadPerson(member) : setLoading(false))}
                tintColor={palette.tint}
                colors={[palette.tint]}
              />
            }
            ListHeaderComponent={member ? <PersonSummary member={member} total={personTotal} count={personRanks.length} /> : null}
            ListEmptyComponent={
              <EmptyState
                icon="account-heart"
                title={member ? t('暂无鸡腿贡献数据') : t('请选择成员查看贡献榜')}
              />
            }
          />
        )
      ) : showSkeleton ? (
        <SkeletonRankList />
      ) : (
        <PerfFlatList
          data={ranks}
          keyExtractor={(item: any, index: number) => String(item.userId || item.rankNum || item.resId || item.id || `r${index}`)}
          contentContainerStyle={styles.list}
          initialNumToRender={12}
          maxToRenderPerBatch={12}
          windowSize={7}
          renderItem={renderRank}
          onEndReached={loadMoreRank}
          onEndReachedThreshold={0.35}
          refreshControl={
            <RefreshControl
              refreshing={loading}
              onRefresh={() => loadRank()}
              tintColor={palette.tint}
              colors={[palette.tint]}
            />
          }
          ListHeaderComponent={ranks.length >= 3 ? <Podium ranks={ranks.slice(0, 3)} /> : null}
          ListEmptyComponent={
            <EmptyState icon="trophy-outline" title={t('暂无排名数据')} />
          }
          ListFooterComponent={null}
        />
      )}
    </View>
  );
}

/**
 * 前三名领奖台（结构升级）：第 1 名居中放大 + tint 强调，第 2/3 名两侧；
 * 让用户一眼看到头部格局，而不是从第一行往下数。
 */
const Podium = React.memo(function Podium({ ranks }: { ranks: any[] }) {
  const palette = usePalette();
  const { t } = useI18n();
  const medal = (i: number) => (i === 0 ? 'trophy' : i === 1 ? 'medal-outline' : 'medal-outline');
  const order = [ranks[1], ranks[0], ranks[2]]; // 2nd | 1st | 3rd
  // 柱高按「名次」索引（0=第1名），此前写成 order 顺序 [76,96,64] 却用 realIndex 取值，
  // 导致第 2 名柱子比第 1 名还高（领奖台排版错乱）
  // 2026-10-06 压低整体高度（原 96/76/64）：第一名柱子比头像还高，实心色块占掉近半屏，观感很重
  const heights = [60, 46, 36];
  const tones = [palette.fill2, palette.tintSoft, palette.fill2];
  return (
    <FadeInView delay={60} duration={320} style={{ marginBottom: 12 }}>
      <GlassSurface radius={22} role="card" style={[styles.podiumCard, { backgroundColor: 'transparent', borderColor: palette.hairline }]}>
        <Text style={[styles.podiumTitle, { color: palette.label }]}>{t('领奖台')}</Text>
        <View style={styles.podiumRow}>
          {order.map((item: any, idx: number) => {
            const realIndex = idx === 0 ? 1 : idx === 1 ? 0 : 2;
            const u = item.baseUserInfo || item.userInfo || item.user || item;
            const name = String(u.userName || u.nickname || u.nickName || u.name || t('用户 {rank}', { rank: realIndex + 1 }));
            const avatar = normalizeUrl(String(u.userAvatar || u.avatar || u.headImg || u.headUrl || u.picPath || ''));
            const melee = pickNum(item.melee, item.meleeValue, item.score, item.total, item.charm);
            const isFirst = realIndex === 0;
            return (
              <View key={realIndex} style={[styles.podiumCell, { flex: isFirst ? 1.15 : 1 }]}>
                <View style={[styles.podiumAvatarWrap, { backgroundColor: tones[realIndex] }]}>
                  {avatar ? (
                    <Image source={{ uri: avatar }} style={styles.podiumAvatar} />
                  ) : (
                    <MaterialCommunityIcons name="account" size={26} color={palette.labelTertiary} />
                  )}
                </View>
                <MaterialCommunityIcons name={medal(realIndex) as any} size={18} color={isFirst ? palette.warning : palette.labelTertiary} style={{ marginTop: 6 }} />
                <Text style={[styles.podiumName, { color: palette.label, fontWeight: isFirst ? '800' : '600' }]} numberOfLines={1}>{name}</Text>
                <View style={[styles.podiumBar, { height: heights[realIndex], backgroundColor: isFirst ? palette.tintSoft : palette.fill2 }]}>
                  <Text style={[styles.podiumMelee, { color: isFirst ? palette.tint : palette.labelSecondary }]} numberOfLines={1}>
                    {melee >= 10000 ? `${(melee / 10000).toFixed(1)}w` : String(melee)}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
      </GlassSurface>
    </FadeInView>
  );
});

/** 首屏榜单骨架：与真实榜单行同构的 Skeleton（spec §8） */
function SkeletonRankList() {
  const palette = usePalette();
  return (
    <View style={styles.list}>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <GlassSurface radius={20} role="card" key={i} style={[styles.rankCard, { backgroundColor: 'transparent' }]}>
          <Skeleton width={30} height={30} radius={10} style={{ marginRight: 10 }} />
          <Skeleton width={44} height={44} radius={22} style={{ marginRight: 10 }} />
          <View style={[styles.rankInfo, { gap: 6 }]}>
            <Skeleton width="55%" height={14} radius={6} />
            <Skeleton width="80%" height={4} radius={2} />
          </View>
          <Skeleton width={52} height={14} radius={6} />
        </GlassSurface>
      ))}
    </View>
  );
}

const RankCard = React.memo(function RankCard({ item, index, max }: { item: any; index: number; max: number }) {
  const palette = usePalette();
  const { t } = useI18n();
  const rankNum = Number(item.rankNum || item.rank || item.no || index + 1);
  const u = item.baseUserInfo || item.userInfo || item.user || item;
  const topU = item.topUserInfo || item.topUser || {};
  const name = String(u.nickname || u.starName || u.userName || u.nickName || u.name || '');
  const avatar = normalizeUrl(String(u.userAvatar || u.avatar || u.headImg || u.headUrl || u.picPath || ''));
  const topUser = String(topU.userName || topU.nickname || '');
  const melee = pickNum(item.melee, item.meleeValue, item.score, item.total, item.charm);
  const isTop = rankNum <= 3;
  // 除零保护：max 为 0（全榜 0 值/异常）时此前会产生 Infinity% → RN 宽度告警 + 进度条错乱
  const pct = max > 0 ? Math.max(2, Math.min(100, (melee / max) * 100)) : 2;

  return (
    <FadeInView delay={60 + (index < 12 ? index * 25 : 0)} duration={300}>
      <GlassSurface radius={20} role="card" style={[styles.rankCard, { backgroundColor: 'transparent', borderColor: palette.hairline }]}>
        {/* 名次徽标：前三名 tint 实底白字 16/900，其余 fill2 底 14/800 */}
        <View
          style={[
            styles.rankBadge,
            isTop
              ? { backgroundColor: palette.tint }
              : { backgroundColor: palette.fill2 },
          ]}
        >
          <Text style={[styles.rankBadgeText, { color: isTop ? palette.onTint : palette.labelSecondary, fontSize: isTop ? 16 : 14, fontWeight: isTop ? '900' : '800' }]}>
            {rankNum}
          </Text>
        </View>
        {avatar ? (
          <Image source={{ uri: avatar }} style={[styles.avatar, { backgroundColor: palette.fill2 }]} />
        ) : (
          <View style={[styles.avatar, styles.avatarPlaceholder, { backgroundColor: palette.fill3 }]}>
            <MaterialCommunityIcons name="account" size={20} color={palette.labelTertiary} />
          </View>
        )}
        <View style={styles.rankInfo}>
          <Text style={[styles.rankName, { color: palette.label }]} numberOfLines={1}>{name || t('用户 {rank}', { rank: rankNum })}</Text>
          {topUser ? (
            <View style={styles.rankMetaRow}>
              <MaterialCommunityIcons name="crown" size={12} color={palette.warning} />
              <Text style={[styles.rankMeta, { color: palette.labelSecondary }]} numberOfLines={1}>{t('榜首: {topUser}', { topUser })}</Text>
            </View>
          ) : null}
          <View style={[styles.miniTrack, { backgroundColor: palette.fill3 }]}>
            <View style={[styles.miniFill, { backgroundColor: palette.tint, width: `${pct}%` }]} />
          </View>
        </View>
        <View style={styles.meleeWrap}>
          <MaterialCommunityIcons name="food-drumstick-outline" size={16} color={palette.tint} />
          {/* 大数值缩写 + 单行：此前长数字会挤压名字列/换行破版 */}
          <Text style={[styles.meleeValue, { color: palette.tint }]} numberOfLines={1}>
            {melee >= 10000 ? `${(melee / 10000).toFixed(1)}w` : String(melee)}
          </Text>
        </View>
      </GlassSurface>
    </FadeInView>
  );
});

/**
 * 成员贡献头部 summary（对齐上游 queryPersonMeleeRankData 输出）：
 * 查询成员 + 总贡献值 + 贡献人数，一眼看到头部格局。
 */
const PersonSummary = React.memo(function PersonSummary({ member, total, count }: { member: Member; total: number | null; count: number }) {
  const palette = usePalette();
  const { t } = useI18n();
  const name = String(member.ownerName || member.id || '');
  return (
    <FadeInView delay={40} duration={280} style={{ marginBottom: 10 }}>
      <GlassSurface radius={22} role="card" style={[styles.podiumCard, { backgroundColor: 'transparent', borderColor: palette.hairline }]}>
        <View style={styles.personSummaryRow}>
          <View style={styles.personSummaryCell}>
            <Text style={[styles.personSummaryLabel, { color: palette.labelSecondary }]}>{t('查询成员')}</Text>
            <Text style={[styles.personSummaryValue, { color: palette.label }]} numberOfLines={1}>{name}</Text>
          </View>
          <View style={styles.personSummaryCell}>
            <Text style={[styles.personSummaryLabel, { color: palette.labelSecondary }]}>{t('总贡献值')}</Text>
            <View style={styles.personSummaryValueRow}>
              <MaterialCommunityIcons name="food-drumstick" size={16} color={palette.tint} />
              <Text style={[styles.personSummaryValue, { color: palette.tint }]}>
                {total == null ? '--' : total >= 10000 ? `${(total / 10000).toFixed(1)}w` : String(total)}
              </Text>
            </View>
          </View>
          <View style={styles.personSummaryCell}>
            <Text style={[styles.personSummaryLabel, { color: palette.labelSecondary }]}>{t('贡献人数')}</Text>
            <Text style={[styles.personSummaryValue, { color: palette.label }]}>{String(count)}</Text>
          </View>
        </View>
      </GlassSurface>
    </FadeInView>
  );
});

const PersonCard = React.memo(function PersonCard({ item, index, max }: { item: any; index: number; max: number }) {
  const palette = usePalette();
  const { t } = useI18n();
  const u = item.userInfo || item.baseUserInfo || item.user || item;
  const name = String(u.nickname || u.realNickName || u.userName || u.nickName || u.name || '');
  const avatar = normalizeUrl(String(u.avatar || u.userAvatar || u.headImg || u.headUrl || u.picPath || item.userAvatar || item.avatar || item.headImg || ''));
  const userId = String(u.userId || u.id || item.userId || item.uid || '');
  const charm = pickNum(item.totalCharm, item.charm, item.charmValue, item.total, item.score, item.melee);
  const rankNum = Number(item.rankNum || item.rank || 0) || index + 1;
  const privacy = !!item.privacy;
  const isTop = rankNum <= 3;
  // 除零保护：max 为 0 时避免 Infinity%（与 RankCard 同规则）
  const pct = max > 0 ? Math.max(2, Math.min(100, (charm / max) * 100)) : 2;

  return (
    <FadeInView delay={60 + (index < 12 ? index * 25 : 0)} duration={300}>
      <GlassSurface radius={20} role="card" style={[styles.rankCard, { backgroundColor: 'transparent', borderColor: palette.hairline }]}>
        {/* 名次徽标：前三 tint 实底白字，其余 fill2 底（与周榜 RankCard 一致） */}
        <View
          style={[
            styles.rankBadge,
            isTop
              ? { backgroundColor: palette.tint }
              : { backgroundColor: palette.fill2 },
          ]}
        >
          <Text style={[styles.rankBadgeText, { color: isTop ? palette.onTint : palette.labelSecondary, fontSize: isTop ? 16 : 14, fontWeight: isTop ? '900' : '800' }]}>{rankNum}</Text>
        </View>
        {avatar ? (
          <Image source={{ uri: avatar }} style={[styles.avatar, { backgroundColor: palette.fill2 }]} />
        ) : (
          <View style={[styles.avatar, styles.avatarPlaceholder, { backgroundColor: palette.fill3 }]}>
            <MaterialCommunityIcons name="account" size={20} color={palette.labelTertiary} />
          </View>
        )}
        <View style={styles.rankInfo}>
          <Text style={[styles.rankName, { color: palette.label }]} numberOfLines={1}>{name || t('未知用户')}</Text>
          <Text style={[styles.rankMeta, { color: palette.labelSecondary }]} numberOfLines={1}>
            {t('ID: {id}', { id: userId })}{privacy ? t(' · 隐私用户') : ''}
          </Text>
          <View style={[styles.miniTrack, { backgroundColor: palette.fill3 }]}>
            <View style={[styles.miniFill, { backgroundColor: palette.tint, width: `${pct}%` }]} />
          </View>
        </View>
        <View style={styles.meleeWrap}>
          <MaterialCommunityIcons name="food-drumstick-outline" size={16} color={palette.tint} />
          <Text style={[styles.meleeValue, { color: palette.tint }]} numberOfLines={1}>
            {charm >= 10000 ? `${(charm / 10000).toFixed(1)}w` : String(charm)}
          </Text>
        </View>
      </GlassSurface>
    </FadeInView>
  );
});

/** 周次 chip 高度（= 18dp 行高 + 上下各 7dp）。尺寸节点与背景层共用同一个常量，避免两处不一致。 */
const WEEK_CHIP_H = 32;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  modeRow: { paddingHorizontal: 16, marginBottom: 10 },
  // ⚠️ 用显式 height（不再是 maxHeight:46）：给 chip 留足空间，避免任何父级约束把它压扁
  weekList: { height: 44, marginBottom: 6 },
  weekListContent: { paddingHorizontal: 16, alignItems: 'center', gap: 8 },
  /**
   * ⚠️ 尺寸节点（结构恒定、无背景、无圆角、无 overflow）：高度给死 32dp
   * （= 18dp 行高 + 上下各 7dp）。此前不设高度被父容器压到 25dp 后只剩 11dp 放 18dp 行高
   * → **字形被裁**（实测「09月28日」显示成「09日28日」）。显式 height 在 Yoga 里优先于 alignSelf:stretch。
   */
  weekChipWrap: {
    height: WEEK_CHIP_H,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /**
   * 背景层：**不参与尺寸计算，也不依赖父级布局**。
   * ⚠️ 刻意用显式 height 而不是 `StyleSheet.absoluteFillObject`（2026-10-06 实测）：
   * 日期栏在切模式时会被卸载/重新挂载，**挂载后的第 1 帧父级还没完成布局**（高度=文字高度 12dp），
   * absoluteFill 的 bottom:0 于是也跟着塌成 12dp → 用户看到「切换瞬间日期栏塌陷」。
   * 给死高度后背景层任何一帧都恒为 32dp。
   */
  weekChipBg: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    height: WEEK_CHIP_H,
    borderRadius: WEEK_CHIP_H / 2,
  },
  list: { padding: 14, paddingBottom: 40 },
  podiumCard: {
    borderRadius: radiiAlias.card,
    padding: 14,
    marginBottom: 4,
    borderWidth: StyleSheet.hairlineWidth,
  },
  podiumTitle: { fontSize: 13, fontWeight: '700', marginBottom: 10 },
  podiumRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
  podiumCell: { alignItems: 'center', minWidth: 0 },
  podiumAvatarWrap: {
    width: 64, height: 64, borderRadius: 36,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  podiumAvatar: { width: 64, height: 64, borderRadius: 36 },
  podiumName: { fontSize: 12, marginTop: 4, width: '100%', textAlign: 'center' },
  podiumBar: {
    marginTop: 6,
    width: '100%',
    borderRadius: 12,
    alignItems: 'center',
    // 数值垂直居中：此前 justifyContent flex-start + paddingTop 6 → 数值贴顶、
    // 下方留一大片空色块，像「没渲染完」（实测截图）
    justifyContent: 'center',
    minHeight: 40,
  },
  podiumMelee: { fontSize: 11, fontWeight: '800', maxWidth: '92%' },
  // 成员贡献 summary（查询成员 / 总贡献值 / 贡献人数）
  personSummaryRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  personSummaryCell: { flex: 1, minWidth: 0 },
  personSummaryLabel: { fontSize: 11, fontWeight: '600' },
  personSummaryValue: { fontSize: 15, fontWeight: '800', marginTop: 3 },
  personSummaryValueRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 },
  rankCard: {
    flexDirection: 'row', alignItems: 'center',
    borderRadius: radiiAlias.card, padding: 12, marginBottom: 5,
    borderWidth: StyleSheet.hairlineWidth,
  },
  rankBadge: {
    width: 30, height: 30, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center', marginRight: 10,
  },
  rankBadgeText: { fontWeight: '900' },
  avatar: { width: 44, height: 44, borderRadius: radiiAlias.avatar, marginRight: 10 },
  avatarPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  rankInfo: { flex: 1, minWidth: 0 },
  rankName: { fontSize: 14, fontWeight: '600' },
  rankMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 2 },
  rankMeta: { fontSize: 12, marginTop: 2, flex: 1 },
  miniTrack: { height: 4, borderRadius: 2, overflow: 'hidden', marginTop: 6 },
  miniFill: { height: 4, borderRadius: 2 },
  meleeWrap: { flexDirection: 'row', alignItems: 'center', gap: 3, marginLeft: 8 },
  meleeValue: { fontSize: 13, fontWeight: '800' },
});
