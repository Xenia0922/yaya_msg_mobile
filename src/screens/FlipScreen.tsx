import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Video from 'react-native-video';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import MemberPicker from '../components/MemberPicker';
import { RootStackParamList } from '../navigation/types';
import pocketApi from '../api/pocket48';
import { useSettingsStore } from '../store';
import { Member } from '../types';
import { errorMessage, normalizeUrl, pickText, unwrapList } from '../utils/data';
import { formatTimestamp } from '../utils/format';

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
    .flatMap((item: any) => (Array.isArray(item) ? item : [item]))
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

function memberName(item: any): string {
  return pickText(item, ['memberName', 'baseUserInfo.nickname', 'baseUserInfo.nickName', 'starName'], '成员');
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
  return '等待回复中';
}

function questionText(item: any): string {
  return pickText(item, ['content', 'questionContent', 'question', 'questionText', 'text'], '');
}

function parseMedia(raw: string): { text: string; url: string } {
  if (!raw) return { text: '', url: '' };
  if (/^https?:\/\//i.test(raw.trim())) return { text: '', url: normalizeUrl(raw) };
  try {
    const json = JSON.parse(raw);
    const url = normalizeUrl(pickText(json, ['url', 'mediaUrl', 'audioUrl', 'videoUrl']));
    return { url, text: pickText(json, ['text', 'content'], '') };
  } catch {
    return { text: raw, url: '' };
  }
}

function answerText(item: any): string {
  const raw = pickText(item, ['answerContent', 'answer', 'answerText', 'replyContent']);
  if (!raw) return '';
  const parsed = parseMedia(raw);
  if (Number(item.answerType) === 2) return parsed.text || '语音回复';
  if (Number(item.answerType) === 3) return parsed.text || '视频回复';
  return parsed.text || parsed.url || raw;
}

function answerMediaUrl(item: any): string {
  const raw = pickText(item, ['answerContent', 'answer', 'answerText', 'replyContent']);
  return parseMedia(raw).url;
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
  const isDark = useSettingsStore((state) => state.settings.theme === 'dark');
  const mode = route.params?.mode || 'view';

  const [flips, setFlips] = useState<any[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [prices, setPrices] = useState<FlipPriceConfig[]>([]);
  const [answerType, setAnswerType] = useState<number | null>(null);
  const [privacyType, setPrivacyType] = useState<PrivacyType>('1');
  const [cost, setCost] = useState('');
  const [content, setContent] = useState('');
  const [balance, setBalance] = useState('');
  const [playingAnswerUrl, setPlayingAnswerUrl] = useState('');

  const selectedPrice = useMemo(
    () => prices.find((item) => item.answerType === answerType),
    [answerType, prices],
  );
  const minCost = priceFor(selectedPrice, privacyType);

  const loadFlips = useCallback(async (nextPage = 1) => {
    setLoading(true);
    setStatus('');
    try {
      const res = await pocketApi.getFlipList((nextPage - 1) * 50, 50);
      const list = normalizeFlipList(res);
      setFlips((prev) => (nextPage === 1 ? list : [...prev, ...list]));
      setStatus(list.length ? `已加载 ${nextPage === 1 ? list.length : flips.length + list.length} 条翻牌记录` : '暂无翻牌记录');
    } catch (error) {
      setStatus(`加载翻牌记录失败：${errorMessage(error)}`);
    } finally {
      setLoading(false);
    }
  }, [flips.length]);

  useEffect(() => {
    if (mode === 'view') loadFlips(1);
  }, [loadFlips, mode]);

  useEffect(() => {
    if (mode !== 'send') return;
    pocketApi.getUserMoney()
      .then((res) => {
        const money = res?.content?.moneyTotal ?? res?.data?.moneyTotal ?? res?.content?.money ?? res?.data?.money ?? '';
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
    setSelectedMember(member);
    setPrices([]);
    setAnswerType(null);
    setPrivacyType('1');
    setCost('');
    setStatus('正在加载翻牌配置...');
    try {
      const res = await pocketApi.getFlipPrices(member.id);
      const list = normalizePriceList(res);
      setPrices(list);
      setAnswerType(list[0]?.answerType ?? null);
      setStatus(list.length ? `已加载 ${list.length} 种回复形式` : '该成员暂未开放翻牌');
    } catch (error) {
      setStatus(`加载翻牌配置失败：${errorMessage(error)}`);
    }
  };

  const sendFlip = async () => {
    const finalCost = toNumber(cost);
    if (!selectedMember) {
      setStatus('请先选择成员');
      return;
    }
    if (!answerType || !selectedPrice) {
      setStatus('请选择文字、语音或视频翻牌');
      return;
    }
    if (!content.trim()) {
      setStatus('请输入翻牌内容');
      return;
    }
    if (!minCost) {
      setStatus(`${answerTypeLabel(answerType)}翻牌的${privacyLabel(privacyType)}设置暂未开放`);
      return;
    }
    if (finalCost < minCost) {
      setStatus(`鸡腿数不能低于官方底价 ${minCost}`);
      setCost(String(minCost));
      return;
    }

    setLoading(true);
    setStatus('正在发送翻牌...');
    try {
      await pocketApi.sendFlipQuestion({
        memberId: parseInt(selectedMember.id, 10),
        content: content.trim(),
        type: Number(privacyType),
        cost: finalCost,
        answerType,
      });
      setContent('');
      setStatus('发送成功，已提交到口袋翻牌');
    } catch (error) {
      setStatus(`发送翻牌失败：${errorMessage(error)}`);
    } finally {
      setLoading(false);
    }
  };

  const pageStyle = [styles.container, isDark && styles.containerDark];
  const headerStyle = [styles.header, isDark && styles.headerDark];

  if (mode === 'send') {
    return (
      <ScrollView style={pageStyle} keyboardShouldPersistTaps="handled">
        <View style={headerStyle}>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Text style={styles.backBtn}>返回</Text>
          </TouchableOpacity>
          <Text style={styles.title}>发送翻牌</Text>
        </View>

        <View style={styles.section}>
          <Text style={[styles.label, isDark && styles.textLight]}>选择成员</Text>
          <MemberPicker selectedMember={selectedMember} onSelect={selectMemberForPrice} />
        </View>

        <View style={styles.section}>
          <Text style={[styles.label, isDark && styles.textLight]}>回复形式</Text>
          <View style={styles.optionRow}>
            {prices.map((item) => {
              const active = answerType === item.answerType;
              return (
                <TouchableOpacity
                  key={String(item.answerType)}
                  style={[styles.optionChip, active && styles.optionChipActive]}
                  onPress={() => setAnswerType(item.answerType)}
                >
                  <Text style={[styles.optionText, active && styles.optionTextActive]}>
                    {answerTypeLabel(item.answerType)}翻牌
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          {!prices.length ? <Text style={styles.hint}>选择成员后显示可用的文字、语音、视频翻牌</Text> : null}
        </View>

        <View style={styles.section}>
          <Text style={[styles.label, isDark && styles.textLight]}>公开设置</Text>
          <View style={styles.optionRow}>
            {PRIVACY_OPTIONS.map((item) => {
              const itemCost = priceFor(selectedPrice, item.value);
              const active = privacyType === item.value;
              const disabled = !!selectedPrice && itemCost <= 0;
              return (
                <TouchableOpacity
                  key={item.value}
                  style={[styles.optionChip, active && styles.optionChipActive, disabled && styles.optionDisabled]}
                  disabled={disabled}
                  onPress={() => setPrivacyType(item.value)}
                >
                  <Text style={[styles.optionText, active && styles.optionTextActive, disabled && styles.disabledText]}>
                    {item.label}{selectedPrice ? ` ${itemCost || '未开放'}` : ''}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={[styles.label, isDark && styles.textLight]}>鸡腿数</Text>
          {balance ? <Text style={[styles.balanceText, isDark && styles.textSub]}>当前余额：{balance} 口袋币</Text> : null}
          <TextInput
            style={[styles.input, isDark && styles.inputDark]}
            keyboardType="numeric"
            value={cost}
            onChangeText={setCost}
            placeholder={minCost ? `最低 ${minCost}` : '先选择翻牌配置'}
            placeholderTextColor="#5a5a5a"
          />
          {minCost ? <Text style={styles.hint}>当前最低：{minCost} 口袋币</Text> : null}
          <TouchableOpacity style={styles.rechargeBtn} onPress={() => navigation.navigate('RechargeScreen')}>
            <Text style={styles.rechargeText}>鸡腿不足？去充值</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.section}>
          <Text style={[styles.label, isDark && styles.textLight]}>翻牌内容</Text>
          <TextInput
            style={[styles.textArea, isDark && styles.inputDark]}
            placeholder="输入你想提问的内容..."
            placeholderTextColor="#5a5a5a"
            multiline
            value={content}
            onChangeText={setContent}
            maxLength={200}
            textAlignVertical="top"
          />
          <Text style={styles.hint}>{content.length}/200</Text>
          <TouchableOpacity style={[styles.sendBtn, loading && styles.disabledBtn]} onPress={sendFlip} disabled={loading}>
            <Text style={styles.sendBtnText}>{loading ? '发送中...' : '发送翻牌'}</Text>
          </TouchableOpacity>
          {status ? <Text style={styles.statusText}>{status}</Text> : null}
        </View>
      </ScrollView>
    );
  }

  return (
    <View style={pageStyle}>
      <View style={headerStyle}>
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Text style={styles.backBtn}>返回</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => navigation.navigate('FlipScreen', { mode: 'send' })}>
            <Text style={styles.actionBtn}>发送翻牌</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.title}>翻牌记录</Text>
      </View>
      {status ? <Text style={styles.statusText}>{status}</Text> : null}
      <FlatList
        data={flips}
        keyExtractor={(item, index) => String(item.questionId || item.id || index)}
        renderItem={({ item }) => {
          const answer = answerText(item);
          const answerUrl = answerMediaUrl(item);
          const flipAnswerType = Number(item.answerType);
          return (
            <View style={[styles.card, isDark && styles.cardDark]}>
              <View style={styles.cardTop}>
                <Text style={styles.cardDate}>{formatTimestamp(item.qtime || item.createTime)}</Text>
                <View style={styles.tagRow}>
                  <Text style={styles.typeTag}>{answerTypeLabel(item.answerType)}</Text>
                  <Text style={styles.privacyTag}>{privacyLabel(item.type)}</Text>
                </View>
              </View>
              <Text style={[styles.memberName, isDark && styles.textLight]}>{memberName(item)}</Text>
              <Text style={[styles.cardQ, isDark && styles.textLight]}>问：{questionText(item) || '未返回问题内容'}</Text>
              {answer ? (
                <>
                  <Text style={[styles.cardA, isDark && styles.textSub]}>答：{answer}</Text>
                  {answerUrl && (flipAnswerType === 2 || flipAnswerType === 3) ? (
                    <View style={styles.answerMediaCard}>
                      <TouchableOpacity
                        style={styles.answerMediaBtn}
                        onPress={() => setPlayingAnswerUrl((prev) => (prev === answerUrl ? '' : answerUrl))}
                      >
                        <Text style={styles.answerMediaBtnText}>{flipAnswerType === 2 ? '播放语音' : '播放视频'}</Text>
                      </TouchableOpacity>
                      {playingAnswerUrl === answerUrl ? (
                        <Video
                          source={{ uri: answerUrl }}
                          style={flipAnswerType === 2 ? styles.answerAudio : styles.answerVideo}
                          controls
                          paused={false}
                          resizeMode="contain"
                          ignoreSilentSwitch="ignore"
                        />
                      ) : null}
                    </View>
                  ) : null}
                </>
              ) : (
                <Text style={styles.cardPending}>{statusLabel(item.status)}</Text>
              )}
              <Text style={styles.cardMeta}>
                {item.cost || 0} 口袋币
                {item.answerTime ? ` · 回复时间 ${formatTimestamp(item.answerTime)}` : ''}
              </Text>
            </View>
          );
        }}
        onEndReached={() => {
          if (loading) return;
          const nextPage = page + 1;
          setPage(nextPage);
          loadFlips(nextPage);
        }}
        onEndReachedThreshold={0.5}
        ListEmptyComponent={<Text style={styles.empty}>{loading ? '加载中...' : '暂无翻牌记录'}</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  containerDark: { backgroundColor: 'transparent' },
  header: { paddingTop: 54, paddingHorizontal: 20, paddingBottom: 14, marginBottom: 4 },
  headerDark: {},
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  backBtn: { color: '#ff6f91', fontSize: 14 },
  actionBtn: { color: '#ff6f91', fontSize: 14, fontWeight: '700' },
  title: { fontSize: 26, fontWeight: '800', color: '#ff6f91', marginTop: 8 },
  section: { padding: 16 },
  label: { fontSize: 16, fontWeight: '800', color: '#333', marginBottom: 10 },
  optionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  optionChip: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.38)' },
  optionChipActive: { backgroundColor: '#ff6f91' },
  optionDisabled: { opacity: 0.45 },
  optionText: { fontSize: 13, color: '#444', fontWeight: '700' },
  optionTextActive: { color: '#fff' },
  disabledText: { color: '#333333' },
  input: {
    padding: 12,
    borderRadius: 18, borderWidth: 1, borderColor: 'rgba(255,255,255,0.52)', backgroundColor: 'rgba(255,255,255,0.50)',
    color: '#333',
    fontSize: 14,
  },
  inputDark: { backgroundColor: 'rgba(42,42,42,0.52)', borderColor: '#444', color: '#ddd' },
  textArea: {
    minHeight: 120,
    padding: 12,
    borderRadius: 18, borderWidth: 1, borderColor: 'rgba(255,255,255,0.52)', backgroundColor: 'rgba(255,255,255,0.50)',
    color: '#333',
    fontSize: 14,
  },
  sendBtn: { marginTop: 12, padding: 14, borderRadius: 18, backgroundColor: '#ff6f91', alignItems: 'center' },
  rechargeBtn: { marginTop: 10, padding: 12, borderRadius: 18, backgroundColor: '#fff0f4', alignItems: 'center' },
  rechargeText: { color: '#ff6f91', fontSize: 13, fontWeight: '800' },
  disabledBtn: { opacity: 0.65 },
  sendBtnText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  hint: { marginTop: 8, color: '#333333', fontSize: 12 },
  balanceText: { marginBottom: 8, color: '#333333', fontSize: 13, fontWeight: '700' },
  statusText: { margin: 12, color: '#ff6f91', textAlign: 'center', fontSize: 13 },
  card: { padding: 14, backgroundColor: 'rgba(255,255,255,0.46)', marginHorizontal: 16, marginVertical: 6, borderRadius: 16 },
  cardDark: { backgroundColor: 'rgba(20,20,20,0.58)' },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  cardDate: { fontSize: 11, color: '#333333' },
  tagRow: { flexDirection: 'row', gap: 6 },
  typeTag: { fontSize: 11, color: '#ff6f91', fontWeight: '800', backgroundColor: '#ff6f9115', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  privacyTag: { fontSize: 11, color: '#13a8a8', fontWeight: '800', backgroundColor: '#13c2c215', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  memberName: { fontSize: 13, color: '#333', fontWeight: '800', marginBottom: 8 },
  cardQ: { fontSize: 14, color: '#333', marginBottom: 8, lineHeight: 20 },
  cardA: { fontSize: 13, color: '#444', lineHeight: 20, marginBottom: 6 },
  answerMediaCard: { marginTop: 4, marginBottom: 8 },
  answerMediaBtn: { alignSelf: 'flex-start', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 14, backgroundColor: '#ff6f91' },
  answerMediaBtnText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  answerAudio: { height: 52, marginTop: 8, backgroundColor: 'rgba(0,0,0,0.08)', borderRadius: 12 },
  answerVideo: { height: 190, marginTop: 8, backgroundColor: '#000', borderRadius: 12 },
  cardPending: { fontSize: 13, color: '#c58a00' },
  cardMeta: { fontSize: 11, color: '#ff6f91', marginTop: 6 },
  empty: { textAlign: 'center', color: '#333333', marginTop: 60, fontSize: 14 },
  textLight: { color: '#eee' },
  textSub: { color: '#eeeeee' },
});
