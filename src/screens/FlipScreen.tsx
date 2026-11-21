import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PerfFlatList } from '../components/PerfFlatList';
import { CenterSpinner } from '../components/Loaders';

import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import PlayerScreen, { buildPocketHeaders } from '../player';
import { RouteProp, useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import MemberPicker from '../components/MemberPicker';
import ScreenHeader from '../components/ScreenHeader';
import { HeaderAction } from '../components/HeaderAction';
import { Pill } from '../components/Pill';
import { Button } from '../components/Button';
import { ScalePressable } from '../components/Motion';
import { EmptyState, ErrorState } from '../components/StateViews';
import { LoginPrompt } from '../components/LoginPrompt';
import { RootStackParamList } from '../navigation/types';
import { useMemberStore, useSettingsStore, useUiStore } from '../store';
import pocketApi from '../api/pocket48';
import { FadeInView } from '../components/Motion';
import { Member } from '../types';
import { errorMessage, normalizeUrl, pickText, unwrapList } from '../utils/data';
import { logInfo } from '../utils/runtimeLog';
import { formatTimestamp, toMs } from '../utils/format';
import { parseDurationSeconds } from '../utils/duration';
import { enqueueDownload } from '../services/downloads';
import { readFollowedIdsCache } from '../services/followedIds';
import { isRoomMember } from '../utils/members';
import { useSafeAreaInsets } from '../hooks/useSafeAreaInsets';
import { usePalette, radii, radiiAlias, fontFamily } from '../theme';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { useI18n } from '../i18n';
import { GlassSurface } from '../components/GlassSurface';
import { FilterChips } from '../components/FilterChips';
import { SearchBar } from '../components/SearchBar';
import { NetworkImage } from '../components/NetworkImage';

type FlipNavProp = StackNavigationProp<RootStackParamList, 'FlipScreen'>;
type FlipRouteProp = RouteProp<RootStackParamList, 'FlipScreen'>;
type PrivacyType = '1' | '2' | '3';

interface FlipPriceConfig {
  answerType: number;
  normalCost: number;
  privateCost: number;
  anonymityCost: number;
  raw: any;
}

const PRIVACY_OPTIONS: { value: PrivacyType; label: string }[] = [
  { value: '1', label: '公开' },
  { value: '2', label: '私密' },
  { value: '3', label: '匿名' },
];

function flipDeadline(timestamp: number | string): number {
  const start = toMs(timestamp);
  return start ? start + 8 * 86400000 : 0;
}

function normalizeFlipList(res: any): any[] {
  return unwrapList(res, [
    'content.questions',
    'content.questionList',
    'content.list',
    'content.data',
    'data.questions',
    'data.questionList',
    'data.list',
    'questions',
    'list',
  ]);
}

function normalizePriceList(res: any): FlipPriceConfig[] {
  const list = unwrapList(res, [
    'content.customs',
    'content.answers',
    'content.answerList',
    'content.customAnswers',
    'content.questions',
    'content.list',
    'content.data',
    'data.customs',
    'data.answers',
    'data.list',
    'customs',
    'answers',
    'list',
  ]);

  const source = list.length ? list : res?.content?.customs ? [res.content.customs] : [];

  return source
    .flatMap((item: any) => {
      if (Array.isArray(item)) return item;
      const vals = Object.values(item);
      return vals.every((v) => v && typeof v === 'object') ? vals : [item];
    })
    .map((item: any) => {
      const fallbackCost = toNumber(item?.price ?? item?.cost ?? item?.normalCost);
      return {
        answerType: toNumber(item?.answerType ?? item?.questionType ?? item?.type),
        normalCost: toNumber(item?.normalCost ?? item?.publicCost ?? fallbackCost),
        privateCost: toNumber(item?.privateCost ?? item?.secretCost ?? fallbackCost),
        anonymityCost: toNumber(item?.anonymityCost ?? item?.anonymousCost ?? fallbackCost),
        raw: item,
      };
    })
    .filter((item) => [1, 2, 3].includes(item.answerType));
}

function toNumber(value: any): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function memberName(item: any, fallback = '成员'): string {
  return pickText(
    item,
    ['memberName', 'baseUserInfo.nickname', 'baseUserInfo.nickName', 'starName'],
    fallback,
  );
}

function answerTypeLabel(type: any): string {
  if (Number(type) === 1) return '文字';
  if (Number(type) === 2) return '语音';
  if (Number(type) === 3) return '视频';
  return '未知';
}

function privacyLabel(type: any): string {
  if (Number(type) === 1) return '公开';
  if (Number(type) === 2) return '私密';
  if (Number(type) === 3) return '匿名';
  return '未知';
}

function statusLabel(status: any): string {
  if (Number(status) === 1) return '等待回复中';
  if (Number(status) === 2) return '已翻牌';
  if (Number(status) === 3) return '已退款';
  if (Number(status) === 5) return '翻牌中';
  return '状态未知';
}

function questionText(item: any): string {
  return pickText(item, ['content', 'questionContent', 'question', 'questionText', 'text'], '');
}

function parseMedia(raw: string): { text: string; url: string; duration: number } {
  if (!raw) return { text: '', url: '', duration: 0 };
  if (/^https?:\/\//i.test(raw.trim())) return { text: '', url: normalizeUrl(raw), duration: 0 };
  try {
    const json = JSON.parse(raw);
    const url = flipMediaUrl(pickText(json, ['url', 'mediaUrl', 'audioUrl', 'videoUrl']));
    const dur = parseDurationSeconds(
      json?.duration || json?.time || json?.second || json?.audioTime || json?.length || 0,
    );
    return {
      url,
      text: pickText(json, ['text', 'content'], ''),
      duration: Number.isFinite(dur) ? Math.round(dur) : 0,
    };
  } catch {
    return { text: raw, url: '', duration: 0 };
  }
}

function flipMediaUrl(value: any): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://mp4.48.cn${raw.startsWith('/') ? '' : '/'}${raw}`;
}

function parseAnswer(
  item: any,
  voiceLabel = '语音回复',
  videoLabel = '视频回复',
): { text: string; url: string; duration: number } {
  if (Number(item?.status) !== 2) return { text: '', url: '', duration: 0 };
  const raw = pickText(item, ['answerContent', 'answer', 'answerText', 'replyContent']);
  let url = '';
  let duration = 0;
  let text = '';
  if (raw) {
    const m = parseMedia(raw);
    url = m.url;
    duration = m.duration;
    text = m.text;
  }

  if (!url) {
    url = flipMediaUrl(
      pickText(item, [
        'answerUrl',
        'ansUrl',
        'voiceUrl',
        'audioUrl',
        'videoUrl',
        'mediaUrl',
        'answerMedia',
        'answerMediaUrl',
        'answerPath',
        'answerVoiceUrl',
        'answerVideoUrl',
      ]),
    );
  }
  if (!duration) {
    const d = parseDurationSeconds(
      pickText(item, ['answerDuration', 'answerSecond', 'duration']) || 0,
    );
    duration = Number.isFinite(d) ? Math.round(d) : 0;
  }

  if (Number(item.answerType) === 2 && !text) text = voiceLabel;
  if (Number(item.answerType) === 3 && !text) text = videoLabel;

  if (!text && !url) text = raw;
  else if (!text && url) text = raw || url;
  return { text, url, duration };
}

function logFlipAnswer(item: any) {
  try {
    const a = parseAnswer(item);
    if (a.url) {
      const raw = pickText(item, ['answerContent', 'answer', 'answerText', 'replyContent']);
      logInfo(
        '[flip.audio] type=' +
          String(item?.answerType) +
          ' dur=' +
          a.duration +
          ' url=' +
          a.url.slice(0, 200) +
          ' raw=' +
          String(raw).slice(0, 600),
        'flip',
      );
    }
  } catch {}
}
function priceFor(config: FlipPriceConfig | undefined, privacyType: PrivacyType): number {
  if (!config) return 0;
  if (privacyType === '2') return config.privateCost;
  if (privacyType === '3') return config.anonymityCost;
  return config.normalCost;
}

export default function FlipScreen() {
  const navigation = useNavigation<FlipNavProp>();
  const route = useRoute<FlipRouteProp>();
  const palette = usePalette();
  const showToast = useUiStore((st) => st.showToast);
  const { t } = useI18n();
  const mode = route.params?.mode || 'view';

  const [flips, setFlips] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [status, setStatus] = useState('');

  const [statusError, setStatusError] = useState(false);

  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashStatus = useCallback((text: string, ms = 2600) => {
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    setStatusError(false);
    setStatus(text);
    statusTimerRef.current = setTimeout(() => {
      setStatus('');
      statusTimerRef.current = null;
    }, ms);
  }, []);
  useEffect(
    () => () => {
      if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    },
    [],
  );
  const pageRef = useRef(1);
  const loadingRef = useRef(false);
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const priceRequestRef = useRef(0);
  const [prices, setPrices] = useState<FlipPriceConfig[]>([]);
  const [answerType, setAnswerType] = useState<number | null>(null);
  const [privacyType, setPrivacyType] = useState<PrivacyType>('1');
  const [cost, setCost] = useState('');
  const [content, setContent] = useState('');
  const [balance, setBalance] = useState('');
  const [memberFilter, setMemberFilter] = useState('');
  const [memberSheetOpen, setMemberSheetOpen] = useState(false);
  const [memberSheetQuery, setMemberSheetQuery] = useState('');
  const [followedIds, setFollowedIds] = useState<Set<string>>(() => new Set());
  const members = useMemberStore((state) => state.members);
  const p48Token = useSettingsStore((state) => state.settings.p48Token || '');
  const insets = useSafeAreaInsets();
  const [playingAnswerUrl, setPlayingAnswerUrl] = useState('');

  useEffect(() => {
    let alive = true;
    void readFollowedIdsCache(p48Token).then((cached) => {
      if (alive && cached.cached) setFollowedIds(new Set(cached.ids));
    });
    return () => {
      alive = false;
    };
  }, [p48Token]);

  const selectedPrice = useMemo(
    () => prices.find((item) => item.answerType === answerType),
    [answerType, prices],
  );
  const minCost = priceFor(selectedPrice, privacyType);

  const loadFlips = useCallback(
    async (nextPage = 1, replace = false): Promise<boolean> => {
      if (loadingRef.current) return false;
      loadingRef.current = true;
      setLoading(true);
      setStatus('');
      try {
        const res = await pocketApi.getFlipList((nextPage - 1) * 100, 100);
        const list = normalizeFlipList(res);
        setFlips((prev) => (replace ? list : [...prev, ...list]));

        setHasMore(list.length >= 100 && list.length > 0);
        if (list.length === 0 && replace) {
          setStatus('');
        } else if (replace) {
          flashStatus(t('已加载 {count} 条翻牌记录', { count: list.length }));
        }
        return true;
      } catch (error) {
        setStatusError(true);
        setStatus(t('加载翻牌记录失败：{err}', { err: errorMessage(error) }));
        return false;
      } finally {
        loadingRef.current = false;
        setLoading(false);
      }
    },
    [flashStatus, t],
  );

  useFocusEffect(
    useCallback(() => {
      if (mode === 'view') {
        pageRef.current = 1;
        loadFlips(1, true);
      }
    }, [loadFlips, mode]),
  );

  useEffect(() => {
    if (mode !== 'send') return;
    pocketApi
      .getUserMoney()
      .then((res) => {
        const money =
          res?.content?.moneyTotal ??
          res?.data?.moneyTotal ??
          res?.content?.money ??
          res?.data?.money ??
          '';
        if (money !== '') setBalance(String(money));
      })
      .catch(() => {});
  }, [mode]);

  useEffect(() => {
    if (!selectedPrice) {
      setCost('');
      return;
    }
    setCost(String(minCost || ''));
  }, [minCost, selectedPrice]);

  const selectMemberForPrice = async (member: Member) => {
    const requestId = ++priceRequestRef.current;
    setSelectedMember(member);
    setPrices([]);
    setAnswerType(null);
    setPrivacyType('1');
    setCost('');
    setStatus('');
    if (!useSettingsStore.getState().settings.p48Token) {
      setStatusError(true);
      setStatus(t('未登录口袋账号，无法获取翻牌配置'));
      return;
    }
    try {
      const res = await pocketApi.getFlipPrices(member.id);
      if (requestId !== priceRequestRef.current) return;
      const list = normalizePriceList(res);
      setPrices(list);
      setAnswerType(list[0]?.answerType ?? null);
      flashStatus(
        list.length
          ? t('已加载 {count} 种回复形式', { count: list.length })
          : t('该成员暂未开放翻牌'),
      );
    } catch (error) {
      if (requestId === priceRequestRef.current) {
        setStatusError(true);
        setStatus(t('加载翻牌配置失败：{err}', { err: errorMessage(error) }));
      }
    }
  };

  const sendFlip = async () => {
    const finalCost = toNumber(cost);
    if (!selectedMember) {
      flashStatus(t('请先选择成员'));
      return;
    }
    if (!answerType || !selectedPrice) {
      flashStatus(t('请选择文字、语音或视频翻牌'));
      return;
    }
    if (!content.trim()) {
      flashStatus(t('请输入翻牌内容'));
      return;
    }
    if (!minCost) {
      flashStatus(
        t('{type}翻牌的{privacy}设置暂未开放', {
          type: t(answerTypeLabel(answerType)),
          privacy: t(privacyLabel(privacyType)),
        }),
      );
      return;
    }
    if (finalCost < minCost) {
      flashStatus(t('鸡腿数不能低于官方底价 {min}', { min: minCost }));
      setCost(String(minCost));
      return;
    }

    setLoading(true);
    setStatusError(false);
    setStatus(t('正在发送翻牌...'));
    try {
      await pocketApi.sendFlipQuestion({
        memberId: parseInt(selectedMember.id, 10),
        content: content.trim(),
        type: Number(privacyType),
        cost: finalCost,
        answerType,
      });
      setContent('');
      flashStatus(t('发送成功，已提交到口袋翻牌'));
    } catch (error) {
      setStatusError(true);
      setStatus(t('发送翻牌失败：{err}', { err: errorMessage(error) }));
    } finally {
      setLoading(false);
    }
  };

  const pageStyle = styles.container;

  const flipMemberCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const f of flips) {
      const n = memberName(f as any, t('成员'));
      counts.set(n, (counts.get(n) || 0) + 1);
    }
    return counts;
  }, [flips, t]);

  const flipMemberNames = useMemo(() => {
    const names = Array.from(flipMemberCounts.keys()).sort((a, b) => {
      const diff = (flipMemberCounts.get(b) || 0) - (flipMemberCounts.get(a) || 0);
      return diff !== 0 ? diff : a.localeCompare(b);
    });
    return ['全部成员', ...names];
  }, [flipMemberCounts]);

  const quickMembers = useMemo(() => {
    const byId = new Map<string, Member>();
    const picked: Member[] = [];
    const seen = new Set<string>();
    const addMember = (m?: Member) => {
      if (!m || !isRoomMember(m) || seen.has(m.id)) return;
      seen.add(m.id);
      picked.push(m);
    };
    for (const m of members) {
      byId.set(String(m.id), m);
      if (m.userId) byId.set(String(m.userId), m);
    }
    for (const f of flips) {
      const fid = String((f as any)?.memberId || (f as any)?.userId || '');
      addMember(byId.get(fid));
      if (picked.length >= 10) break;
    }
    for (const fid of followedIds) {
      addMember(byId.get(String(fid)));
      if (picked.length >= 16) break;
    }
    return picked;
  }, [members, flips, followedIds]);

  const memberAvatarByName = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of members) {
      const uri = normalizeUrl(m.avatar || '');
      if (!uri) continue;
      const shortName = m.ownerName.split('-').pop() || m.ownerName;
      if (shortName && !map.has(shortName)) map.set(shortName, uri);
      if (m.ownerName && !map.has(m.ownerName)) map.set(m.ownerName, uri);
    }
    return map;
  }, [members]);

  const sheetMemberRows = useMemo(() => {
    const q = memberSheetQuery.trim().toLowerCase();
    return flipMemberNames.filter((name) => {
      if (name === '全部成员') return !q;
      return !q || name.toLowerCase().includes(q);
    });
  }, [flipMemberNames, memberSheetQuery]);
  const filteredFlips = useMemo(
    () =>
      !memberFilter || memberFilter === '全部成员'
        ? flips
        : flips.filter((f: any) => memberName(f, t('成员')) === memberFilter),
    [flips, memberFilter, t],
  );

  const flipRows = useMemo(() => {
    const monthOf = (ts: number): string => {
      if (!ts) return t('未知时间');
      const d = new Date(toMs(ts));
      return t('{y}年{m}月', { y: d.getFullYear(), m: d.getMonth() + 1 });
    };
    const order: string[] = [];
    const map = new Map<string, any[]>();
    for (const f of filteredFlips) {
      const key = monthOf(Number(f.qtime || f.createTime || 0));
      if (!map.has(key)) {
        map.set(key, []);
        order.push(key);
      }
      map.get(key)!.push(f);
    }
    const flat: { type: 'header' | 'item'; key: string; title?: string; item?: any }[] = [];
    for (const k of order) {
      flat.push({ type: 'header', key: `h-${k}`, title: k });

      map.get(k)!.forEach((it, idx) =>
        flat.push({
          type: 'item',
          key: `i-${String(it.questionId || it.id || 'x')}-${idx}`,
          item: it,
        }),
      );
    }
    return flat;
  }, [filteredFlips, t]);

  const flipStatsView = useMemo(() => {
    let totalCost = 0;
    let durSum = 0;
    let answered = 0;
    const typeStats = { text: 0, audio: 0, video: 0 };
    const memberMap = new Map<string, { name: string; count: number; cost: number }>();
    for (const f of filteredFlips) {
      const rec = f as any;
      const cost = Number(rec.cost) || 0;
      totalCost += cost;
      const at = Number(rec.answerType);
      if (at === 1) typeStats.text += 1;
      else if (at === 2) typeStats.audio += 1;
      else if (at === 3) typeStats.video += 1;
      const mn = memberName(rec, t('成员'));
      const m = memberMap.get(mn) || { name: mn, count: 0, cost: 0 };
      m.count += 1;
      m.cost += cost;
      memberMap.set(mn, m);
      if (Number(rec.status) === 2 && rec.qtime && rec.answerTime) {
        const diff = Number(rec.answerTime) - Number(rec.qtime);
        if (diff > 0) {
          durSum += diff;
          answered += 1;
        }
      }
    }
    const memberRank = [...memberMap.values()].sort((a, b) => b.cost - a.cost);
    const typeMax = Math.max(1, typeStats.text, typeStats.audio, typeStats.video);
    const fmtDur = (ms: number) => {
      if (ms <= 0) return '-';
      const s = Math.floor(ms / 1000);
      const d = Math.floor(s / 86400),
        h = Math.floor((s % 86400) / 3600),
        mm = Math.floor((s % 3600) / 60);
      return d > 0 ? `${d}天${h}时` : h > 0 ? `${h}时${mm}分` : `${mm}分`;
    };
    return {
      totalCount: filteredFlips.length,
      totalCost,
      typeStats,
      typeMax,
      memberRank,
      avgStr: fmtDur(answered > 0 ? durSum / answered : 0),
    };
  }, [filteredFlips, t]);

  const statsHeader = (
    <View style={styles.statsWrap}>
      <GlassSurface radius={22} role="card" frostedOnly style={styles.statsOverview}>
        <View style={styles.statCell}>
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.7}
            style={[styles.statValue, { color: palette.tint }]}
          >
            {flipStatsView.totalCount}
          </Text>
          <Text style={[styles.statLabel, { color: palette.labelSecondary }]}>{t('总翻牌数')}</Text>
        </View>
        <View style={styles.statCell}>
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.7}
            style={[styles.statValue, { color: palette.tint }]}
          >
            {flipStatsView.totalCost}
          </Text>
          <Text style={[styles.statLabel, { color: palette.labelSecondary }]}>{t('总鸡腿')}</Text>
        </View>
        <View style={styles.statCell}>
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.7}
            style={[styles.statValue, { color: palette.tint }]}
          >
            {flipStatsView.avgStr}
          </Text>
          <Text style={[styles.statLabel, { color: palette.labelSecondary }]}>{t('平均回复')}</Text>
        </View>
      </GlassSurface>

      <GlassSurface radius={22} role="card" frostedOnly style={styles.statsGroup}>
        <Text style={[styles.groupLabel, { color: palette.label }]}>{t('类型分布')}</Text>
        {[
          { key: 'text', label: t('文字'), count: flipStatsView.typeStats.text },
          { key: 'audio', label: t('语音'), count: flipStatsView.typeStats.audio },
          { key: 'video', label: t('视频'), count: flipStatsView.typeStats.video },
        ].map((row) => (
          <View key={row.key} style={styles.typeRow}>
            <Text style={[styles.typeRowLabel, { color: palette.labelSecondary }]}>
              {row.label}
            </Text>
            <View
              style={[
                styles.typeTrack,
                { backgroundColor: palette.fill2, opacity: flipStatsView.typeMax > 0 ? 1 : 0.35 },
              ]}
            >
              {(() => {
                const pct =
                  flipStatsView.typeMax > 0
                    ? Math.max(0, Math.min(100, (row.count / flipStatsView.typeMax) * 100))
                    : 0;
                return (
                  <View
                    style={[styles.typeFill, { width: `${pct}%`, backgroundColor: palette.tint }]}
                  />
                );
              })()}
            </View>
            <Text style={[styles.typeCount, { color: palette.labelTertiary }]}>{row.count}</Text>
          </View>
        ))}
      </GlassSurface>

      {flipStatsView.memberRank.length > 1 ? (
        <GlassSurface radius={22} role="card" frostedOnly style={styles.statsGroup}>
          <Text style={[styles.groupLabel, { color: palette.label }]}>{t('成员排名')}</Text>
          {flipStatsView.memberRank.slice(0, 10).map((m, idx) => (
            <ScalePressable
              key={`${m.name}-${idx}`}
              pressedScale={0.98}
              activeOpacity={0.8}
              onPress={() => setMemberFilter((prev) => (prev === m.name ? '' : m.name))}
              style={styles.rankRow}
            >
              <Text style={[styles.rankNo, { color: palette.tint }]}>{idx + 1}</Text>
              <Text style={[styles.rankName, { color: palette.label }]} numberOfLines={1}>
                {m.name}
              </Text>
              <Text style={[styles.rankVal, { color: palette.labelSecondary }]}>
                {m.cost} · {m.count}
              </Text>
            </ScalePressable>
          ))}
        </GlassSurface>
      ) : null}

      <View style={styles.filterBarRow}>
        <FilterChips
          style={styles.filterRail}
          items={flipMemberNames.slice(0, 14).map((name) => {
            const count = flipMemberCounts.get(name);
            return {
              key: name,
              label:
                name === '全部成员'
                  ? `${t(name)} (${flips.length})`
                  : count
                    ? `${name} · ${count}`
                    : name,
            };
          })}
          value={memberFilter || '全部成员'}
          onSelect={(name) => setMemberFilter(name === '全部成员' ? '' : name)}
        />
        {flipMemberNames.length > 4 ? (
          <ScalePressable
            pressedScale={0.95}
            activeOpacity={0.85}
            onPress={() => {
              setMemberSheetQuery('');
              setMemberSheetOpen(true);
            }}
            style={[
              styles.filterMoreBtn,
              {
                backgroundColor: memberFilter ? palette.tintSoft : palette.fill2,
                borderColor: memberFilter ? palette.tint : palette.hairline,
              },
            ]}
          >
            <MaterialCommunityIcons
              name="account-search-outline"
              size={15}
              color={memberFilter ? palette.tint : palette.labelSecondary}
            />
            <Text
              style={[
                styles.filterMoreText,
                { color: memberFilter ? palette.tint : palette.labelSecondary },
              ]}
              numberOfLines={1}
            >
              {memberFilter || t('筛选成员')}
            </Text>
          </ScalePressable>
        ) : null}
      </View>
      <Text style={[styles.sectionTitle, { color: palette.labelSecondary }]}>
        {t('翻牌明细 · 共 {count} 条', { count: flipStatsView.totalCount })}
      </Text>
    </View>
  );

  if (mode === 'send') {
    return (
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={pageStyle}
      >
        <ScrollView
          style={pageStyle}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.sendContainer}
        >
          <ScreenHeader title={t('发送翻牌')} />

          <FadeInView delay={60} duration={300}>
            <GlassSurface
              radius={22}
              role="card"
              frostedOnly
              style={[
                styles.sendGroup,
                { backgroundColor: 'transparent', borderColor: palette.innerStroke },
              ]}
            >
              <View style={styles.groupRowTop}>
                <View style={[styles.groupIcon, { backgroundColor: palette.tintSoft }]}>
                  <MaterialCommunityIcons
                    name="account-heart-outline"
                    size={18}
                    color={palette.tint}
                  />
                </View>
                <Text style={[styles.groupLabel, { color: palette.label }]}>{t('选择成员')}</Text>
              </View>
              <MemberPicker
                compact
                showTeams
                collapsible
                quickMembers={quickMembers}
                selectedMember={selectedMember}
                onSelect={selectMemberForPrice}
              />
            </GlassSurface>

            <GlassSurface
              radius={22}
              role="card"
              frostedOnly
              style={[
                styles.sendGroup,
                { backgroundColor: 'transparent', borderColor: palette.innerStroke },
              ]}
            >
              <View style={styles.groupRowTop}>
                <View style={[styles.groupIcon, { backgroundColor: palette.tintSoft }]}>
                  <MaterialCommunityIcons
                    name="message-reply-outline"
                    size={18}
                    color={palette.tint}
                  />
                </View>
                <Text style={[styles.groupLabel, { color: palette.label }]}>{t('回复形式')}</Text>
              </View>
              <View style={styles.optionRow}>
                {prices.map((item) => {
                  const active = answerType === item.answerType;
                  return (
                    <Pill
                      key={String(item.answerType)}
                      label={t('{type}翻牌', { type: t(answerTypeLabel(item.answerType)) })}
                      selected={active}
                      onPress={() => setAnswerType(item.answerType)}
                      style={styles.optionPill}
                    />
                  );
                })}
              </View>
              {!prices.length ? (
                <Text style={[styles.hint, { color: palette.labelTertiary }]}>
                  {t('选择成员后显示可用的文字、语音、视频翻牌')}
                </Text>
              ) : null}
            </GlassSurface>

            <GlassSurface
              radius={22}
              role="card"
              frostedOnly
              style={[
                styles.sendGroup,
                { backgroundColor: 'transparent', borderColor: palette.innerStroke },
              ]}
            >
              <View style={styles.groupRowTop}>
                <View style={[styles.groupIcon, { backgroundColor: palette.tintSoft }]}>
                  <MaterialCommunityIcons name="eye-outline" size={18} color={palette.tint} />
                </View>
                <Text style={[styles.groupLabel, { color: palette.label }]}>{t('公开设置')}</Text>
              </View>
              <View style={styles.optionRow}>
                {PRIVACY_OPTIONS.map((item) => {
                  const itemCost = priceFor(selectedPrice, item.value);
                  const active = privacyType === item.value;
                  const disabled = !!selectedPrice && itemCost <= 0;
                  return (
                    <Pill
                      key={item.value}
                      label={`${t(item.label)}${selectedPrice ? ` ${itemCost || t('未开放')}` : ''}`}
                      selected={!disabled && active}
                      onPress={disabled ? undefined : () => setPrivacyType(item.value)}
                      style={[styles.optionPill, disabled && styles.optionDisabled]}
                    />
                  );
                })}
              </View>
            </GlassSurface>

            <GlassSurface
              radius={22}
              role="card"
              frostedOnly
              style={[
                styles.sendGroup,
                { backgroundColor: 'transparent', borderColor: palette.innerStroke },
              ]}
            >
              <View style={styles.groupRowTop}>
                <View style={[styles.groupIcon, { backgroundColor: palette.tintSoft }]}>
                  <MaterialCommunityIcons name="pencil-outline" size={18} color={palette.tint} />
                </View>
                <Text style={[styles.groupLabel, { color: palette.label }]}>{t('翻牌内容')}</Text>
              </View>
              <TextInput
                style={[styles.textArea, { backgroundColor: palette.fill2, color: palette.label }]}
                placeholder={t('输入你想提问的内容...')}
                placeholderTextColor={palette.labelTertiary}
                multiline
                value={content}
                onChangeText={setContent}
                maxLength={200}
                textAlignVertical="top"
              />
              <View style={styles.inputMetaRow}>
                <Text style={[styles.hint, { color: palette.labelTertiary }]}>
                  {t('{len}/200', { len: content.length })}
                </Text>
                {balance ? (
                  <Text style={[styles.balanceText, { color: palette.labelSecondary }]}>
                    {t('当前余额：{balance} 鸡腿', { balance })}
                  </Text>
                ) : null}
              </View>
              {minCost ? (
                <View style={[styles.costRow, { backgroundColor: palette.tintSoft }]}>
                  <Text style={[styles.costLabel, { color: palette.tint }]}>{t('鸡腿数')}</Text>
                  <TextInput
                    style={[styles.costInput, { color: palette.label }]}
                    keyboardType="numeric"
                    value={cost}
                    onChangeText={setCost}
                    placeholder={minCost ? t('最低 {min}', { min: minCost }) : t('先选择翻牌配置')}
                    placeholderTextColor={palette.labelTertiary}
                  />
                  <ScalePressable
                    style={styles.rechargeBtn}
                    onPress={() => navigation.navigate('RechargeScreen')}
                    activeOpacity={0.7}
                    pressedScale={0.97}
                  >
                    <MaterialCommunityIcons
                      name="credit-card-outline"
                      size={16}
                      color={palette.tint}
                    />
                    <Text style={[styles.rechargeText, { color: palette.tint }]}>{t('充值')}</Text>
                  </ScalePressable>
                </View>
              ) : null}
              <Text style={[styles.costHint, { color: palette.labelTertiary }]}>
                {t('当前最低：{min} 鸡腿', { min: minCost || 0 })}
              </Text>
            </GlassSurface>

            <View style={styles.sendFooter}>
              <Button
                title={t('发送翻牌')}
                variant="filled"
                size="lg"
                onPress={sendFlip}
                disabled={loading}
                loading={loading}
                fullWidth
              />
              {status ? (
                <Text
                  style={[
                    styles.statusText,
                    { color: statusError ? palette.danger : palette.tint },
                  ]}
                >
                  {status}
                </Text>
              ) : null}
            </View>
          </FadeInView>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  return (
    <View style={pageStyle}>
      <ScreenHeader
        title={t('翻牌统计')}
        right={
          <HeaderAction
            label={t('发送翻牌')}
            onPress={() => navigation.navigate('FlipScreen', { mode: 'send' })}
          />
        }
      />
      {status ? (
        <Text style={[styles.statusText, { color: statusError ? palette.danger : palette.tint }]}>
          {status}
        </Text>
      ) : null}
      {statusError ? (
        <View style={styles.retryWrap}>
          <Button
            title={t('重试')}
            variant="filled"
            size="sm"
            onPress={() => {
              pageRef.current = 1;
              void loadFlips(1, true);
            }}
          />
        </View>
      ) : null}
      <FadeInView delay={80} duration={300} style={{ flex: 1 }}>
        <PerfFlatList
          data={flipRows}
          keyExtractor={(row) => row.key}
          ListHeaderComponent={statsHeader}

          contentContainerStyle={{ paddingBottom: 32 }}
          keyboardDismissMode="on-drag"
          initialNumToRender={12}
          maxToRenderPerBatch={12}
          windowSize={7}
          refreshing={loading && pageRef.current === 1}
          onRefresh={() => {
            if (loadingRef.current) return;
            pageRef.current = 1;
            void loadFlips(1, true);
          }}
          renderItem={({ item }) => {
            if (item.type === 'header') {
              return (
                <Text style={[styles.monthGroup, { color: palette.labelTertiary }]}>
                  {item.title}
                </Text>
              );
            }
            const flip = item.item as any;
            const parsed = parseAnswer(flip, t('语音回复'), t('视频回复'));
            const answer = parsed.text;
            const answerUrl = parsed.url;
            const flipAnswerType = Number(flip.answerType);
            const ansDur = parsed.duration;
            const qTime = toMs(flip.qtime || flip.createTime || 0);
            const aTime = toMs(flip.answerTime || 0);
            const deadline = flipDeadline(qTime);
            const remaining = deadline - Date.now();
            const remainingDays = Math.max(0, Math.floor(remaining / 86400000));
            const remainingHours = Math.max(0, Math.floor((remaining % 86400000) / 3600000));
            const remainingMinutes = Math.max(0, Math.floor((remaining % 3600000) / 60000));
            const isPending = Number(flip.status) === 1 || Number(flip.status) === 5;
            const remainingStr =
              isPending && qTime
                ? remaining > 0
                  ? t('剩{time}', {
                      time: `${remainingDays > 0 ? t('{m}天', { m: remainingDays }) : ''}${remainingHours > 0 ? t('{m}小时', { m: remainingHours }) : ''}${t('{m}分', { m: remainingMinutes })}`,
                    })
                  : t('已过期')
                : '';
            const elapsed = aTime && qTime ? aTime - qTime : 0;
            const elapsedDays = Math.floor(elapsed / 86400000);
            const elapsedHours = Math.floor((elapsed % 86400000) / 3600000);
            const elapsedMinutes = Math.floor((elapsed % 3600000) / 60000);
            const elapsedStr =
              elapsed > 0
                ? t('耗时 {time}', {
                    time: `${elapsedDays > 0 ? t('{m}天', { m: elapsedDays }) : ''}${elapsedHours > 0 ? t('{m}小时', { m: elapsedHours }) : ''}${t('{m}分', { m: elapsedMinutes })}`,
                  })
                : '';
            return (
              <GlassSurface
                radius={radiiAlias.card}
                role="card"
                frostedOnly
                style={[
                  styles.card,
                  {
                    backgroundColor: 'transparent',
                    borderColor: palette.innerStroke,
                    borderWidth: StyleSheet.hairlineWidth,
                  },
                ]}
              >
                <View style={styles.cardTop}>
                  <View style={styles.tagRow}>
                    <View style={[styles.typeTag, { backgroundColor: palette.tintSoft }]}>
                      <Text style={[styles.typeTagText, { color: palette.tint }]}>
                        {t(answerTypeLabel(flip.answerType))}
                      </Text>
                    </View>
                    <View style={[styles.privacyTag, { backgroundColor: palette.fill3 }]}>
                      <Text style={[styles.privacyTagText, { color: palette.labelSecondary }]}>
                        {t(privacyLabel(flip.type))}
                      </Text>
                    </View>

                    {Number(flip.status) === 1 ? (
                      <View style={[styles.statusBadge, { backgroundColor: palette.tintSoft }]}>
                        <Text style={[styles.statusBadgeText, { color: palette.tint }]}>
                          {t(statusLabel(flip.status))}
                        </Text>
                      </View>
                    ) : Number(flip.status) === 2 ? (
                      <View
                        style={[styles.statusBadge, { backgroundColor: 'rgba(52,199,89,0.14)' }]}
                      >
                        <Text style={[styles.statusBadgeText, { color: palette.success }]}>
                          {t(statusLabel(flip.status))}
                        </Text>
                      </View>
                    ) : Number(flip.status) === 5 ? (
                      <View
                        style={[styles.statusBadge, { backgroundColor: 'rgba(24,144,255,0.14)' }]}
                      >
                        <Text style={[styles.statusBadgeText, { color: '#1890ff' }]}>
                          {t(statusLabel(flip.status))}
                        </Text>
                      </View>
                    ) : (
                      <View
                        style={[
                          styles.statusBadge,
                          {
                            backgroundColor:
                              Number(flip.status) === 3 ? 'rgba(255,59,48,0.12)' : palette.fill3,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.statusBadgeText,
                            {
                              color:
                                Number(flip.status) === 3 ? palette.danger : palette.labelSecondary,
                            },
                          ]}
                        >
                          {t(statusLabel(flip.status))}
                        </Text>
                      </View>
                    )}
                  </View>
                  <Text style={[styles.cardDate, { color: palette.labelTertiary }]}>
                    {formatTimestamp(flip.qtime || flip.createTime)}
                  </Text>
                </View>

                <Text style={[styles.memberName, { color: palette.label }]}>
                  {memberName(flip, t('成员'))}
                </Text>
                <Text style={[styles.cardQ, { color: palette.label }]}>
                  {t('问：{text}', { text: questionText(flip) || t('未返回问题内容') })}
                </Text>

                {answer ? (
                  <View style={styles.answerRow}>
                    <Text style={[styles.cardA, { color: palette.labelSecondary }]}>
                      {t('答：{text}', { text: answer })}
                    </Text>

                    {ansDur > 0 && (flipAnswerType === 2 || flipAnswerType === 3) ? (
                      <Text style={[styles.answerDur, { color: palette.labelTertiary }]}>
                        {`${Math.floor(ansDur / 60)}:${String(ansDur % 60).padStart(2, '0')}`}
                      </Text>
                    ) : null}
                    {answerUrl && (flipAnswerType === 2 || flipAnswerType === 3) ? (
                      <>
                        <ScalePressable
                          style={[styles.answerBtn, { backgroundColor: palette.tintSoft }]}
                          onPress={() => {
                            logFlipAnswer(flip);
                            setPlayingAnswerUrl((prev) => (prev === answerUrl ? '' : answerUrl));
                          }}
                          pressedScale={0.96}
                          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                        >
                          <MaterialCommunityIcons
                            name={playingAnswerUrl === answerUrl ? 'chevron-up' : 'play'}
                            size={16}
                            color={palette.tint}
                          />
                        </ScalePressable>

                        <ScalePressable
                          style={[styles.answerBtn, { backgroundColor: palette.fill2 }]}
                          pressedScale={0.96}
                          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                          onPress={() => {
                            const isVoice = flipAnswerType === 2;
                            void enqueueDownload({
                              url: answerUrl,
                              type: isVoice ? 'voice' : 'video',
                              name: `${memberName(flip, t('成员'))}-${t(isVoice ? '语音翻牌' : '视频翻牌')}-${formatTimestamp(flip.answerTime || flip.qtime || flip.createTime)}`,
                            })
                              .then(() => showToast(t('已加入下载管理')))
                              .catch((e) =>
                                showToast(t('下载失败：{msg}', { msg: errorMessage(e) })),
                              );
                          }}
                        >
                          <MaterialCommunityIcons
                            name="download"
                            size={16}
                            color={palette.labelSecondary}
                          />
                        </ScalePressable>
                      </>
                    ) : null}
                  </View>
                ) : (
                  <Text style={[styles.cardPending, { color: palette.tint }]}>
                    {t(statusLabel(flip.status))}
                  </Text>
                )}

                {playingAnswerUrl === answerUrl && answerUrl ? (
                  <View style={styles.answerMediaCard}>
                    <PlayerScreen
                      inline
                      source={{
                        kind: flipAnswerType === 2 ? 'audio' : 'vod',
                        url: answerUrl,
                        headers: buildPocketHeaders(),
                      }}
                      meta={{ title: t('翻牌答案') }}
                      features={{ kernelSwitch: true, rate: true }}
                      persistent
                    />
                  </View>
                ) : null}

                <Text style={[styles.cardMeta, { color: palette.labelTertiary }]}>
                  {t('{cost} 鸡腿', { cost: flip.cost || 0 })}
                  {remainingStr ? ` · ${remainingStr}` : ''}
                  {elapsedStr ? ` · ${elapsedStr}` : ''}
                  {flip.answerTime
                    ? ` · ${t('回复于 {time}', { time: formatTimestamp(flip.answerTime) })}`
                    : ''}
                </Text>
              </GlassSurface>
            );
          }}
          onEndReached={() => {
            if (loadingRef.current || !hasMore) return;
            const nextPage = pageRef.current + 1;

            void loadFlips(nextPage).then((ok) => {
              if (ok) pageRef.current = nextPage;
            });
          }}
          onEndReachedThreshold={0.5}
          ListEmptyComponent={
            !useSettingsStore.getState().settings.p48Token ? (
              <LoginPrompt hint={t('查看翻牌记录需要登录')} />
            ) : loading ? (
              <CenterSpinner />
            ) : statusError ? (
              <ErrorState
                title={t('加载失败')}
                hint={status}
                onAction={() => {
                  pageRef.current = 1;
                  void loadFlips(1, true);
                }}
              />
            ) : (
              <EmptyState
                icon="card-text-outline"
                title={t('暂无翻牌记录')}
                hint={t('去发送翻牌查询历史记录')}
              />
            )
          }
        />
      </FadeInView>

      {memberSheetOpen ? (
        <Modal
          visible
          transparent
          animationType="slide"
          onRequestClose={() => setMemberSheetOpen(false)}
        >
          <Pressable style={styles.sheetShade} onPress={() => setMemberSheetOpen(false)}>
            <Pressable
              style={[
                styles.sheetPanel,
                {
                  backgroundColor: palette.surface,
                  borderColor: palette.hairline,
                  paddingBottom: Math.max(20, insets.bottom + 10),
                },
              ]}
              onPress={() => undefined}
            >
              <View style={styles.sheetHead}>
                <Text style={[styles.groupLabel, { color: palette.label }]}>{t('筛选成员')}</Text>
                <ScalePressable
                  pressedScale={0.94}
                  onPress={() => setMemberSheetOpen(false)}
                  style={[styles.sheetCloseBtn, { backgroundColor: palette.fill2 }]}
                >
                  <MaterialCommunityIcons name="close" size={18} color={palette.labelSecondary} />
                </ScalePressable>
              </View>
              <SearchBar
                value={memberSheetQuery}
                onChangeText={setMemberSheetQuery}
                placeholder={t('搜索成员...')}
                style={styles.sheetSearch}
              />
              <ScrollView keyboardShouldPersistTaps="handled" style={styles.sheetList}>
                {sheetMemberRows.map((name) => {
                  const isAll = name === '全部成员';
                  const active = isAll ? !memberFilter : memberFilter === name;
                  const count = isAll ? flips.length : flipMemberCounts.get(name) || 0;
                  const avatarUri = isAll ? '' : memberAvatarByName.get(name) || '';
                  return (
                    <ScalePressable
                      key={name}
                      pressedScale={0.98}
                      activeOpacity={0.8}
                      onPress={() => {
                        setMemberFilter(isAll ? '' : name);
                        setMemberSheetOpen(false);
                      }}
                      style={[
                        styles.sheetRow,
                        {
                          backgroundColor: active ? palette.tintSoft : 'transparent',
                          borderBottomColor: palette.hairline,
                        },
                      ]}
                    >
                      {avatarUri ? (
                        <NetworkImage
                          source={{ uri: avatarUri }}
                          style={[styles.sheetAvatar, { backgroundColor: palette.fill2 }]}
                          fallbackIcon="account"
                          thumbnail={96}
                        />
                      ) : (
                        <View style={[styles.sheetAvatar, { backgroundColor: palette.fill2 }]}>
                          <MaterialCommunityIcons
                            name={isAll ? 'account-group-outline' : 'account'}
                            size={16}
                            color={active ? palette.tint : palette.labelTertiary}
                          />
                        </View>
                      )}
                      <Text
                        style={[
                          styles.sheetRowName,
                          { color: active ? palette.tint : palette.label },
                        ]}
                        numberOfLines={1}
                      >
                        {isAll ? t(name) : name}
                      </Text>
                      <Text style={[styles.sheetRowCount, { color: palette.labelTertiary }]}>
                        {count}
                      </Text>
                      {active ? (
                        <MaterialCommunityIcons name="check" size={18} color={palette.tint} />
                      ) : null}
                    </ScalePressable>
                  );
                })}
              </ScrollView>
            </Pressable>
          </Pressable>
        </Modal>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  answerDur: { fontSize: 12, fontFamily: fontFamily.system, fontWeight: '700', marginLeft: 6 },
  container: { flex: 1, backgroundColor: 'transparent' },
  sendContainer: { paddingBottom: 48 },
  retryWrap: { alignItems: 'center', marginTop: 6 },

  sendGroup: {
    padding: 14,
    marginHorizontal: 16,
    marginVertical: 6,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
  },
  groupRowTop: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  groupIcon: {
    width: 32,
    height: 32,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  groupLabel: { fontSize: 15, fontFamily: fontFamily.system, fontWeight: '700' },
  optionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  optionPill: { marginBottom: 0 },
  optionDisabled: { opacity: 0.45 },
  textArea: {
    minHeight: 120,
    padding: 12,
    borderRadius: radiiAlias.input,
    fontSize: 14,
    fontFamily: fontFamily.system,
    lineHeight: 20,
  },
  inputMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  costRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    borderRadius: radiiAlias.input,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  costLabel: { fontSize: 13, fontFamily: fontFamily.system, fontWeight: '700', marginRight: 8 },
  costInput: { flex: 1, paddingVertical: 6, fontSize: 14 },
  costHint: { marginTop: 8, fontSize: 12 },
  rechargeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 10,
    paddingHorizontal: 12,
    minHeight: 40,
  },
  rechargeText: { fontSize: 13, fontFamily: fontFamily.system, fontWeight: '700' },
  hint: { marginTop: 8, fontSize: 12 },
  balanceText: { fontSize: 13, fontWeight: '600' },
  sendFooter: { marginTop: 16, marginHorizontal: 16 },

  statsWrap: { paddingBottom: 8 },
  statsOverview: {
    flexDirection: 'row',
    padding: 14,
    marginHorizontal: 16,
    marginVertical: 6,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
  },
  statCell: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: 18, fontFamily: fontFamily.system, fontWeight: '900' },
  statLabel: { fontSize: 11, marginTop: 2 },
  statsGroup: {
    padding: 14,
    marginHorizontal: 16,
    marginVertical: 6,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
  },
  typeRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 3 },

  typeRowLabel: { minWidth: 34, fontSize: 12, fontFamily: fontFamily.system },
  typeTrack: { flex: 1, height: 8, borderRadius: 4, overflow: 'hidden', marginHorizontal: 8 },
  typeFill: { height: 8, borderRadius: 4 },
  typeCount: { minWidth: 30, fontSize: 11, textAlign: 'right' },
  rankRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 5 },
  rankNo: { minWidth: 22, fontSize: 12, fontFamily: fontFamily.system, fontWeight: '900' },
  rankName: { flex: 1, fontSize: 13 },
  rankVal: { fontSize: 12, marginLeft: 8 },
  sectionTitle: { fontSize: 12, marginHorizontal: 16, marginTop: 12, marginBottom: 4 },
  filterBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginTop: 10,
  },
  filterRail: { flex: 1, minWidth: 0 },
  filterMoreBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 11,
    paddingVertical: 8,
    minHeight: 36,
    maxWidth: 120,
    borderRadius: radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  filterMoreText: { fontSize: 12, fontFamily: fontFamily.system, fontWeight: '700' },
  sheetShade: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.42)',
    justifyContent: 'flex-end',
  },
  sheetPanel: {
    maxHeight: '72%',
    borderTopLeftRadius: radii.sheet,
    borderTopRightRadius: radii.sheet,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingTop: 14,
  },
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  sheetCloseBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetSearch: { marginHorizontal: 0, marginBottom: 8 },
  sheetList: { maxHeight: 400 },
  sheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sheetAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetRowName: { flex: 1, fontSize: 14, fontFamily: fontFamily.system, fontWeight: '600' },
  sheetRowCount: { fontSize: 12, fontFamily: fontFamily.system, fontWeight: '600' },
  statusText: { margin: 12, textAlign: 'center', fontSize: 13, fontFamily: fontFamily.system },

  card: {
    padding: 14,
    marginHorizontal: 16,
    marginVertical: 4,
    borderRadius: radiiAlias.card,
  },
  cardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  cardDate: { fontSize: 11, fontFamily: fontFamily.system, fontWeight: '500' },
  tagRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1, flexWrap: 'wrap' },
  typeTag: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radii.xs },
  typeTagText: { fontSize: 11, fontWeight: '700' },
  privacyTag: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radii.xs },
  privacyTagText: { fontSize: 11, fontFamily: fontFamily.system, fontWeight: '700' },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radii.xs },
  statusBadgeText: { fontSize: 11, fontWeight: '700' },
  memberName: { fontSize: 13, fontWeight: '700', marginBottom: 6 },
  cardQ: { fontSize: 14, fontFamily: fontFamily.system, marginBottom: 8, lineHeight: 20 },
  cardA: { fontSize: 13, lineHeight: 19, flex: 1, marginRight: 10 },
  answerRow: { flexDirection: 'row', alignItems: 'center' },
  answerBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    paddingLeft: 2,
  },
  answerMediaCard: { marginTop: 8 },
  cardPending: { fontSize: 13, fontFamily: fontFamily.system, fontWeight: '700' },
  cardMeta: { fontSize: 11, marginTop: 8 },
  monthGroup: {
    fontSize: 13,
    fontWeight: '700',
    marginTop: 12,
    marginBottom: 2,
    paddingHorizontal: 16,
  },
});
