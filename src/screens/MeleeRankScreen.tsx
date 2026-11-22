import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PerfFlatList } from '../components/PerfFlatList';
import { NetworkImage } from '../components/NetworkImage';

import {
  InteractionManager,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { useNavigation } from '@react-navigation/native';
import ScreenHeader from '../components/ScreenHeader';
import { GlassSegmented } from '../components/GlassSegmented';
import MemberPicker from '../components/MemberPicker';
import pocketApi from '../api/pocket48';
import { useI18n } from '../i18n';
import { errorMessage, normalizeUrl } from '../utils/data';
import { Member } from '../types';
import { extractRankList, extractWeeks, WeekItem } from '../utils/meleeParse';
import { usePalette, radiiAlias, fontFamily } from '../theme';
import { typography } from '../theme/typography';
import { EmptyState, ErrorState } from '../components/StateViews';
import { Skeleton } from '../components/Skeleton';
import { GlassSurface } from '../components/GlassSurface';

type ViewMode = 'week' | 'person';

const MODES: { key: ViewMode; label: string }[] = [
  { key: 'week', label: '周榜' },
  { key: 'person', label: '成员贡献' },
];

function pickNum(...vals: any[]): number {
  for (const v of vals) {
    if (v === undefined || v === null || v === '') continue;
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

async function withTransientRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: any;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (e: any) {
      lastErr = e;
      const msg = String(e?.message || e || '');
      const transient =
        /timeout|timed out|超时|network|Network|failed to fetch|50[0-9]|Unexpected end|JSON/i.test(
          msg,
        );
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

  const [personTotal, setPersonTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const nextIdRef = useRef('');
  const hasMoreRef = useRef(false);
  const reqIdRef = useRef(0);
  const personReqIdRef = useRef(0);
  const moreReqIdRef = useRef(0);

  const switchMode = (m: ViewMode) => {
    if (m === mode) return;

    personReqIdRef.current += 1;
    moreReqIdRef.current += 1;
    setLoadingMore(false);
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

    moreReqIdRef.current += 1;
    setLoadingMore(false);
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

      const ws = extractWeeks(data);
      if (ws.length) {
        ws.sort((a, b) => Number(b.weekRankId) - Number(a.weekRankId));
        setWeeks((prev) => (prev.length ? prev : ws));

        if (!selectedWeekRef.current) {
          const latest = ws.reduce(
            (a, b) => (Number(b.weekRankId) > Number(a.weekRankId) ? b : a),
            ws[0],
          );
          setSelectedWeek(latest);
        }
      }
      const list = extractRankList(data);

      if (rid !== reqIdRef.current) return;
      setRanks(list);

      const nextId = String(data?.nextId || data?.next || '');
      nextIdRef.current = nextId;
      hasMoreRef.current = !!nextId && list.length > 0;

      if (rid !== reqIdRef.current) return;
    } catch (e: any) {
      if (rid !== reqIdRef.current) return;
      setError(errorMessage(e));
      setRanks([]);
    } finally {
      if (rid === reqIdRef.current) setLoading(false);
    }
  }, [mode]);

  const loadMoreRank = useCallback(async () => {
    if (loading || loadingMore || !hasMoreRef.current || !nextIdRef.current) return;
    const rid = ++moreReqIdRef.current;
    const prevNextId = nextIdRef.current;
    const prevHasMore = hasMoreRef.current;
    const weekKey = String(selectedWeekRef.current?.weekRankId ?? '');
    setLoadingMore(true);
    try {
      let res: any;
      if (mode === 'week') {
        const wk2 = selectedWeekRef.current;
        if (String(wk2?.weekRankId ?? '') !== weekKey) return;
        res = wk2
          ? await withTransientRetry(() => pocketApi.getMeleeWeekRank(wk2.weekRankId, prevNextId))
          : await withTransientRetry(() => pocketApi.getMeleeRankPage(0, prevNextId));
      } else {
        return;
      }

      if (rid !== moreReqIdRef.current) return;
      const data = res?.content ?? res?.data ?? res ?? {};
      const list = extractRankList(data);
      const nextId = String(data?.nextId || data?.next || '');
      setRanks((prev) => {
        const seen = new Set(
          prev.map((it) => String(it.userId || it.rankNum || it.resId || it.id)),
        );
        const fresh = list.filter((raw) => {
          const it = raw as Record<string, unknown>;
          return !seen.has(String(it.userId || it.rankNum || it.resId || it.id));
        });
        return [...prev, ...fresh];
      });

      if (nextId && nextId === String(prevNextId || '')) {
        nextIdRef.current = '';
        hasMoreRef.current = false;
      } else {
        nextIdRef.current = nextId;
        hasMoreRef.current = !!nextId && list.length > 0;
      }
    } catch {
      if (rid === moreReqIdRef.current) {
        nextIdRef.current = prevNextId;
        hasMoreRef.current = prevHasMore;
      }
    } finally {
      if (rid === moreReqIdRef.current) setLoadingMore(false);
    }
  }, [loading, loadingMore, mode]);

  const loadPerson = useCallback(async (m: Member) => {
    const rid = ++personReqIdRef.current;
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
      if (rid !== personReqIdRef.current) return;
      const data = res?.content ?? res?.data ?? {};
      const list = Array.isArray(data?.charmInfo) ? data.charmInfo : extractRankList(data);
      setPersonRanks(list);

      const total = list.reduce(
        (sum: number, it: any) =>
          sum + pickNum(it?.totalCharm, it?.charm, it?.charmValue, it?.total, it?.score),
        0,
      );
      setPersonTotal(total);
    } catch (e: any) {
      if (rid !== personReqIdRef.current) return;
      setError(errorMessage(e));
      setPersonRanks([]);
      setPersonTotal(null);
    } finally {
      if (rid === personReqIdRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (mode !== 'week') return;
    const task = InteractionManager.runAfterInteractions(() => {
      void loadRank();
    });
    return () => task.cancel();
  }, [mode, selectedWeek, loadRank]);

  useEffect(() => {
    if (mode !== 'person') return;
    if (member) loadPerson(member);
    else {
      personReqIdRef.current += 1;
      setPersonRanks([]);
      setPersonTotal(null);
      setLoading(false);
    }
  }, [mode, member, loadPerson]);

  const renderWeekChip = ({ item }: { item: WeekItem }) => {
    const active = selectedWeek?.weekRankId === item.weekRankId;

    return (
      <Pressable
        onPress={() => {
          if (selectedWeek?.weekRankId === item.weekRankId) return;

          moreReqIdRef.current += 1;
          setLoadingMore(false);
          setSelectedWeek(item);
        }}
        style={styles.weekChipWrap}
      >
        <View
          pointerEvents="none"
          style={[styles.weekChipBg, { backgroundColor: active ? palette.tint : palette.fill2 }]}
        />
        <Text
          numberOfLines={1}
          style={[
            typography.footnote,
            { fontWeight: '600', color: active ? '#fff' : palette.label },
          ]}
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
        <GlassSegmented
          options={MODES.map((m) => ({ key: m.key, label: t(m.label) }))}
          value={mode}
          onChange={switchMode}
        />
      </View>

      {mode === 'person' && (
        <MemberPicker
          selectedMember={member}
          onSelect={(m) => {
            setPersonRanks([]);
            setMember(m);
          }}
          placeholder={t('搜索成员查看鸡腿贡献...')}
        />
      )}

      {weeks.length > 0 && (
        <PerfFlatList
          horizontal
          data={weeks}
          keyExtractor={(item) => String(item.weekRankId)}
          renderItem={renderWeekChip}
          style={styles.weekList}
          contentContainerStyle={styles.weekListContent}
          showsHorizontalScrollIndicator={false}

          removeClippedSubviews={false}
        />
      )}

      {error ? (
        <ErrorState
          title={error}
          onAction={() => (mode === 'person' && member ? loadPerson(member) : loadRank())}
        />
      ) : null}

      {mode === 'person' ? (
        showPersonSkeleton ? (
          <SkeletonRankList />
        ) : (
          <PerfFlatList
            data={personRanks}
            keyExtractor={(item: any, index: number) =>
              String(item.userId || item.id || item.uid || item.resId || `p${index}`)
            }
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
            ListHeaderComponent={
              member ? (
                <PersonSummary member={member} total={personTotal} count={personRanks.length} />
              ) : null
            }
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
          keyExtractor={(item: any, index: number) =>
            String(item.userId || item.rankNum || item.resId || item.id || `r${index}`)
          }
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
          ListEmptyComponent={<EmptyState icon="trophy-outline" title={t('暂无排名数据')} />}
          ListFooterComponent={null}
        />
      )}
    </View>
  );
}

const Podium = React.memo(function Podium({ ranks }: { ranks: any[] }) {
  const palette = usePalette();
  const { t } = useI18n();
  const medal = (i: number) => (i === 0 ? 'trophy' : i === 1 ? 'medal-outline' : 'medal-outline');
  const order = [ranks[1], ranks[0], ranks[2]];

  const heights = [60, 46, 36];
  const tones = [palette.fill2, palette.tintSoft, palette.fill2];
  return (
    <View style={{ marginBottom: 12 }}>
      <GlassSurface
        radius={22}
        role="card"
        style={[
          styles.podiumCard,
          { backgroundColor: 'transparent', borderColor: palette.hairline },
        ]}
      >
        <Text style={[styles.podiumTitle, { color: palette.label }]}>{t('领奖台')}</Text>
        <View style={styles.podiumRow}>
          {order.map((item: any, idx: number) => {
            const realIndex = idx === 0 ? 1 : idx === 1 ? 0 : 2;
            const u = item.baseUserInfo || item.userInfo || item.user || item;
            const name = String(
              u.userName ||
                u.nickname ||
                u.nickName ||
                u.name ||
                t('用户 {rank}', { rank: realIndex + 1 }),
            );
            const avatar = normalizeUrl(
              String(u.userAvatar || u.avatar || u.headImg || u.headUrl || u.picPath || ''),
            );
            const melee = pickNum(item.melee, item.meleeValue, item.score, item.total, item.charm);
            const isFirst = realIndex === 0;
            return (
              <View key={realIndex} style={[styles.podiumCell, { flex: isFirst ? 1.15 : 1 }]}>
                <View style={[styles.podiumAvatarWrap, { backgroundColor: tones[realIndex] }]}>
                  {avatar ? (
                    <NetworkImage
                      source={{ uri: avatar }}
                      style={styles.podiumAvatar}
                      thumbnail={160}
                    />
                  ) : (
                    <MaterialCommunityIcons
                      name="account"
                      size={26}
                      color={palette.labelTertiary}
                    />
                  )}
                </View>
                <MaterialCommunityIcons
                  name={medal(realIndex) as any}
                  size={18}
                  color={isFirst ? palette.warning : palette.labelTertiary}
                  style={{ marginTop: 6 }}
                />
                <Text
                  style={[
                    styles.podiumName,
                    { color: palette.label, fontWeight: isFirst ? '800' : '600' },
                  ]}
                  numberOfLines={1}
                >
                  {name}
                </Text>
                <View
                  style={[
                    styles.podiumBar,
                    {
                      height: heights[realIndex],
                      backgroundColor: isFirst ? palette.tintSoft : palette.fill2,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.podiumMelee,
                      { color: isFirst ? palette.tint : palette.labelSecondary },
                    ]}
                    numberOfLines={1}
                  >
                    {melee >= 10000 ? `${(melee / 10000).toFixed(1)}w` : String(melee)}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
      </GlassSurface>
    </View>
  );
});

function SkeletonRankList() {
  return (
    <View style={styles.list}>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <GlassSurface
          radius={22}
          role="card"
          key={i}
          style={[styles.rankCard, { backgroundColor: 'transparent' }]}
        >
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

const RankCard = React.memo(function RankCard({
  item,
  index,
  max,
}: {
  item: any;
  index: number;
  max: number;
}) {
  const palette = usePalette();
  const { t } = useI18n();
  const rankNum = Number(item.rankNum || item.rank || item.no || index + 1);
  const u = item.baseUserInfo || item.userInfo || item.user || item;
  const topU = item.topUserInfo || item.topUser || {};
  const name = String(u.nickname || u.starName || u.userName || u.nickName || u.name || '');
  const avatar = normalizeUrl(
    String(u.userAvatar || u.avatar || u.headImg || u.headUrl || u.picPath || ''),
  );
  const topUser = String(topU.userName || topU.nickname || '');
  const melee = pickNum(item.melee, item.meleeValue, item.score, item.total, item.charm);
  const isTop = rankNum <= 3;

  const pct = max > 0 ? Math.max(2, Math.min(100, (melee / max) * 100)) : 2;

  return (
    <GlassSurface
      radius={radiiAlias.card}
      role="card"
      frostedOnly
      style={[
        styles.rankCard,
        { backgroundColor: 'transparent', borderColor: palette.innerStroke },
      ]}
    >
      <View
        style={[
          styles.rankBadge,
          isTop ? { backgroundColor: palette.tint } : { backgroundColor: palette.fill2 },
        ]}
      >
        <Text
          style={[
            styles.rankBadgeText,
            {
              color: isTop ? palette.onTint : palette.labelSecondary,
              fontSize: isTop ? 16 : 14,
              fontWeight: isTop ? '900' : '800',
            },
          ]}
        >
          {rankNum}
        </Text>
      </View>
      {avatar ? (
        <NetworkImage
          source={{ uri: avatar }}
          style={[styles.avatar, { backgroundColor: palette.fill2 }]}
          thumbnail={96}
        />
      ) : (
        <View style={[styles.avatar, styles.avatarPlaceholder, { backgroundColor: palette.fill3 }]}>
          <MaterialCommunityIcons name="account" size={20} color={palette.labelTertiary} />
        </View>
      )}
      <View style={styles.rankInfo}>
        <Text style={[styles.rankName, { color: palette.label }]} numberOfLines={1}>
          {name || t('用户 {rank}', { rank: rankNum })}
        </Text>
        {topUser ? (
          <View style={styles.rankMetaRow}>
            <MaterialCommunityIcons name="crown" size={12} color={palette.warning} />
            <Text style={[styles.rankMeta, { color: palette.labelSecondary }]} numberOfLines={1}>
              {t('榜首: {topUser}', { topUser })}
            </Text>
          </View>
        ) : null}
        <View style={[styles.miniTrack, { backgroundColor: palette.fill3 }]}>
          <View style={[styles.miniFill, { backgroundColor: palette.tint, width: `${pct}%` }]} />
        </View>
      </View>
      <View style={styles.meleeWrap}>
        <MaterialCommunityIcons name="food-drumstick-outline" size={16} color={palette.tint} />

        <Text style={[styles.meleeValue, { color: palette.tint }]} numberOfLines={1}>
          {melee >= 10000 ? `${(melee / 10000).toFixed(1)}w` : String(melee)}
        </Text>
      </View>
    </GlassSurface>
  );
});

const PersonSummary = React.memo(function PersonSummary({
  member,
  total,
  count,
}: {
  member: Member;
  total: number | null;
  count: number;
}) {
  const palette = usePalette();
  const { t } = useI18n();
  const name = String(member.ownerName || member.id || '');
  return (
    <View style={{ marginBottom: 10 }}>
      <GlassSurface
        radius={22}
        role="card"
        style={[
          styles.podiumCard,
          { backgroundColor: 'transparent', borderColor: palette.hairline },
        ]}
      >
        <View style={styles.personSummaryRow}>
          <View style={styles.personSummaryCell}>
            <Text style={[styles.personSummaryLabel, { color: palette.labelSecondary }]}>
              {t('查询成员')}
            </Text>
            <Text style={[styles.personSummaryValue, { color: palette.label }]} numberOfLines={1}>
              {name}
            </Text>
          </View>
          <View style={styles.personSummaryCell}>
            <Text style={[styles.personSummaryLabel, { color: palette.labelSecondary }]}>
              {t('总贡献值')}
            </Text>
            <View style={styles.personSummaryValueRow}>
              <MaterialCommunityIcons name="food-drumstick" size={16} color={palette.tint} />
              <Text style={[styles.personSummaryValue, { color: palette.tint }]}>
                {total == null
                  ? '--'
                  : total >= 10000
                    ? `${(total / 10000).toFixed(1)}w`
                    : String(total)}
              </Text>
            </View>
          </View>
          <View style={styles.personSummaryCell}>
            <Text style={[styles.personSummaryLabel, { color: palette.labelSecondary }]}>
              {t('贡献人数')}
            </Text>
            <Text style={[styles.personSummaryValue, { color: palette.label }]}>
              {String(count)}
            </Text>
          </View>
        </View>
      </GlassSurface>
    </View>
  );
});

const PersonCard = React.memo(function PersonCard({
  item,
  index,
  max,
}: {
  item: any;
  index: number;
  max: number;
}) {
  const palette = usePalette();
  const { t } = useI18n();
  const u = item.userInfo || item.baseUserInfo || item.user || item;
  const name = String(u.nickname || u.realNickName || u.userName || u.nickName || u.name || '');
  const avatar = normalizeUrl(
    String(
      u.avatar ||
        u.userAvatar ||
        u.headImg ||
        u.headUrl ||
        u.picPath ||
        item.userAvatar ||
        item.avatar ||
        item.headImg ||
        '',
    ),
  );
  const userId = String(u.userId || u.id || item.userId || item.uid || '');
  const charm = pickNum(
    item.totalCharm,
    item.charm,
    item.charmValue,
    item.total,
    item.score,
    item.melee,
  );
  const rankNum = Number(item.rankNum || item.rank || 0) || index + 1;
  const privacy = !!item.privacy;
  const isTop = rankNum <= 3;

  const pct = max > 0 ? Math.max(2, Math.min(100, (charm / max) * 100)) : 2;

  return (
    <GlassSurface
      radius={radiiAlias.card}
      role="card"
      frostedOnly
      style={[
        styles.rankCard,
        { backgroundColor: 'transparent', borderColor: palette.innerStroke },
      ]}
    >
      <View
        style={[
          styles.rankBadge,
          isTop ? { backgroundColor: palette.tint } : { backgroundColor: palette.fill2 },
        ]}
      >
        <Text
          style={[
            styles.rankBadgeText,
            {
              color: isTop ? palette.onTint : palette.labelSecondary,
              fontSize: isTop ? 16 : 14,
              fontWeight: isTop ? '900' : '800',
            },
          ]}
        >
          {rankNum}
        </Text>
      </View>
      {avatar ? (
        <NetworkImage
          source={{ uri: avatar }}
          style={[styles.avatar, { backgroundColor: palette.fill2 }]}
          thumbnail={96}
        />
      ) : (
        <View style={[styles.avatar, styles.avatarPlaceholder, { backgroundColor: palette.fill3 }]}>
          <MaterialCommunityIcons name="account" size={20} color={palette.labelTertiary} />
        </View>
      )}
      <View style={styles.rankInfo}>
        <Text style={[styles.rankName, { color: palette.label }]} numberOfLines={1}>
          {name || t('未知用户')}
        </Text>
        <Text style={[styles.rankMeta, { color: palette.labelSecondary }]} numberOfLines={1}>
          {t('ID: {id}', { id: userId })}
          {privacy ? t(' · 隐私用户') : ''}
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
  );
});

const WEEK_CHIP_H = 32;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  modeRow: { paddingHorizontal: 16, marginBottom: 10 },

  weekList: { height: 44, marginBottom: 6 },
  weekListContent: { paddingHorizontal: 16, alignItems: 'center', gap: 8 },

  weekChipWrap: {
    height: WEEK_CHIP_H,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },

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
  podiumTitle: { fontSize: 13, fontFamily: fontFamily.system, fontWeight: '700', marginBottom: 10 },
  podiumRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
  podiumCell: { alignItems: 'center', minWidth: 0 },
  podiumAvatarWrap: {
    width: 64,
    height: 64,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  podiumAvatar: { width: 64, height: 64, borderRadius: 36 },
  podiumName: {
    fontSize: 12,
    fontFamily: fontFamily.system,
    marginTop: 4,
    width: '100%',
    textAlign: 'center',
  },
  podiumBar: {
    marginTop: 6,
    width: '100%',
    borderRadius: 12,
    alignItems: 'center',

    justifyContent: 'center',
    minHeight: 40,
  },
  podiumMelee: { fontSize: 11, fontFamily: fontFamily.system, fontWeight: '800', maxWidth: '92%' },

  personSummaryRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  personSummaryCell: { flex: 1, minWidth: 0 },
  personSummaryLabel: { fontSize: 11, fontFamily: fontFamily.system, fontWeight: '600' },
  personSummaryValue: { fontSize: 15, fontWeight: '800', marginTop: 3 },
  personSummaryValueRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 },
  rankCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radiiAlias.card,
    padding: 12,
    marginBottom: 5,
    borderWidth: StyleSheet.hairlineWidth,
  },
  rankBadge: {
    width: 30,
    height: 30,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  rankBadgeText: { fontWeight: '900' },
  avatar: { width: 44, height: 44, borderRadius: radiiAlias.avatar, marginRight: 10 },
  avatarPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  rankInfo: { flex: 1, minWidth: 0 },
  rankName: { fontSize: 14, fontFamily: fontFamily.system, fontWeight: '600' },
  rankMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 2 },
  rankMeta: { fontSize: 12, marginTop: 2, flex: 1 },
  miniTrack: { height: 4, borderRadius: 2, overflow: 'hidden', marginTop: 6 },
  miniFill: { height: 4, borderRadius: 2 },
  meleeWrap: { flexDirection: 'row', alignItems: 'center', gap: 3, marginLeft: 8 },
  meleeValue: { fontSize: 13, fontFamily: fontFamily.system, fontWeight: '800' },
});
