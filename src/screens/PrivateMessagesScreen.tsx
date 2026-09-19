import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PerfFlatList } from '../components/PerfFlatList';
import { Chat } from '@kesha-antonov/react-native-chat';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useKeyboardHeight } from '../hooks/useKeyboardHeight';

import {
  Platform,
  Alert,
  FlatList,
  Image,
  Linking,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import PlayerScreen from '../player';
import { useNavigation, useRoute } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/types';
import { useMemberStore, useSettingsStore, useUiStore } from '../store';
import { FadeInView, ScalePressable } from '../components/Motion';
import { CenterSpinner } from '../components/Loaders';
import { EmptyState, ErrorState } from '../components/StateViews';
import ScreenHeader from '../components/ScreenHeader';
import { HeaderAction } from '../components/HeaderAction';
import { formatTimestamp , toMs } from '../utils/format';
import { parseDurationSeconds } from '../utils/duration';
import { errorMessage, messagePayload, messageText, normalizeUrl, parseMaybeJson, pickText, unwrapList } from '../utils/data';
import pocketApi from '../api/pocket48';
import { usePalette, usePageBackground } from '../theme';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { translate, useI18n } from '../i18n';
import { GlassSurface } from '../components/GlassSurface';
import { thumbUrl, AVATAR_THUMB_WIDTH } from '../utils/imageThumb';

function convTargetId(conv: any): string {
  return String(conv?.targetUserId || conv?.user?.userId || conv?.userId || '');
}
function convName(conv: any): string {
  return pickText(conv, ['user.nickname', 'user.nickName', 'user.starName', 'user.realNickName', 'nickname', 'starName'], convTargetId(conv) || translate('私信'));
}
function msgId(msg: any): string {
  const direct = msg.messageId || msg.msgId || msg.id || msg.clientMsgId || msg.uuid;
  if (direct) return String(direct);
  // 无稳定 id：用 时间+发送者+内容 作近似键（不含 index，避免同消息在不同批次 index 不同导致去重失败）
  const time = msgTimeNumber(msg);
  const from = msgFromId(msg);
  const body = messageText(msg);
  return String(`${time}-${from}-${body || JSON.stringify(msg).slice(0, 80)}`);
}
function msgTimeNumber(msg: any): number {
  const v = Number(msg.timestamp || msg.msgTime || msg.ctime || msg.time || msg.createTime || msg.sendTime || 0);
  return Number.isFinite(v) ? v : 0;
}
function msgFromId(msg: any): string {
  return String(msg.user?.userId || msg.user?.id || msg.fromUserId || msg.senderUserId || msg.senderId || msg.userId || msg.fromAccount || '');
}
function msgToId(msg: any): string {
  return String(msg.toUserId || msg.targetUserId || msg.receiverUserId || msg.receiveUserId || '');
}
function isMineMessage(msg: any, targetId: string, currentUserId = ''): boolean {
  if (msg.isSelf === true || msg.self === true || msg.isMe === true) return true;
  if (msg.isSelf === false || msg.self === false || msg.isMe === false) return false;
  if (targetId && String(msg.user?.userId || msg.user?.id || '') === String(targetId)) return false;
  const from = msgFromId(msg);
  const to = msgToId(msg);
  if (currentUserId && from === currentUserId) return true;
  if (currentUserId && to === currentUserId) return false;
  if (from && targetId && from === targetId) return false;
  if (to && targetId && to === targetId) return true;
  const d = String(msg.direct || msg.direction || msg.messageDirection || '').toLowerCase();
  if (['out', 'outgoing', 'send', 'sent', '1'].includes(d)) return true;
  if (['in', 'incoming', 'receive', 'received', '0'].includes(d)) return false;
  return false;
}

function privateMessageText(msg: any): string {
  const payload = messagePayload(msg);
  const text = messageText(msg) || pickText(msg, ['content.text', 'text', 'message', 'msg'])
    || pickText(payload, ['text', 'content', 'message.text', 'msg.text']) || '';

  const flipKeys = ['flipCardInfo', 'filpCardInfo', 'flipCardAudioInfo', 'filpCardAudioInfo', 'flipCardVideoInfo', 'filpCardVideoInfo'];
  for (const key of flipKeys) {
    const fi = payload?.[key] || msg?.[key] || msg?.content?.[key];
    if (fi) {
      const parsed = typeof fi === 'string' ? parseMaybeJson(fi) : fi;
      if (parsed) {
        const q = parsed.question || parsed.answerQuestion || '';
        const a = (typeof parsed.answer === 'string') ? parseMaybeJson(parsed.answer) : parsed.answer;
        const answerText = (a && typeof a === 'object') ? (a.text || a.content || '') : (typeof parsed.answer === 'string' ? parsed.answer : '');
        if (q && answerText) return translate('问：{q}\n答：{answer}', { q, answer: answerText });
        if (q) return translate('问：{q}', { q });
        if (answerText) return translate('答：{answer}', { answer: answerText });
        if (a && typeof a === 'object') {
          const au = pickText(a, ['url', 'mediaUrl', 'audioUrl', 'videoUrl', 'voiceUrl', 'mp4Url']);
          if (au) {
            const at = answerTypeFromContext(msg) || answerTypeFromContext(parsed);
            if (at === 2 || looksLikeAudioUrl(au)) return q ? translate('问：{q}\n答：[语音消息]', { q }) : translate('[语音消息]');
            if (at === 3 || looksLikeVideoUrl(au)) return q ? translate('问：{q}\n答：[视频消息]', { q }) : translate('[视频消息]');
            if (looksLikeImageUrl(au)) return q ? translate('问：{q}\n答：[图片消息]', { q }) : translate('[图片消息]');
          }
        }
      }
    }
  }

  const answerRaw = payload?.answer || payload?.answerContent || msg?.answer || msg?.answerContent || '';
  if (answerRaw) {
    const parsed = typeof answerRaw === 'string' ? parseMaybeJson(answerRaw) : answerRaw;
    if (parsed && typeof parsed === 'object') {
      const at = parsed.text || parsed.content || parsed.answer || '';
      if (at) {
        const qtext = payload?.question || msg?.question || '';
        if (qtext) return translate('问：{q}\n答：{answer}', { q: qtext, answer: at });
      }
    } else if (typeof parsed === 'string' && parsed.trim()) {
      return parsed;
    }
  }

  const t = String(text).trim();
  if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))) {
    const json = parseMaybeJson(t);
    if (json && typeof json === 'object') {
      const url = pickText(json, ['url', 'mediaUrl', 'audioUrl', 'videoUrl', 'voiceUrl', 'mp4Url']);
      if (url) {
        if (looksLikeAudioUrl(url) || answerTypeFromContext(msg) === 2) return translate('[语音消息]');
        if (looksLikeVideoUrl(url) || answerTypeFromContext(msg) === 3) return translate('[视频消息]');
        if (looksLikeImageUrl(url)) return translate('[图片消息]');
    }
  }
    const p = payload && typeof payload === 'object' ? payload : {};
    const url = pickText(p, ['url', 'mediaUrl', 'audioUrl', 'videoUrl']);
    if (url) {
      const type = String(msg.msgType || p?.msgType || p?.type || '').toUpperCase();
      if (type.includes('AUDIO') || looksLikeAudioUrl(url)) return translate('[语音消息]');
      if (type.includes('VIDEO') || looksLikeVideoUrl(url)) return translate('[视频消息]');
      if (type.includes('IMAGE') || looksLikeImageUrl(url)) return translate('[图片消息]');
    }
  }
  return text || translate('[空消息]');
}

type MediaInfo = { url: string; type: 'audio' | 'video' | 'image'; title: string; duration?: number } | null;

function looksLikeAudioUrl(url: string): boolean { return /\.(mp3|m4a|aac|amr|wav|ogg)(\?|$)/i.test(url.toLowerCase()); }
function looksLikeVideoUrl(url: string): boolean { return /\.(mp4|mov|m4v|3gp|webm)(\?|$)/i.test(url.toLowerCase()) || url.includes('.m3u8') || url.includes('.flv'); }
function looksLikeImageUrl(url: string): boolean { return /\.(jpe?g|png|webp|gif|bmp)(\?|$)/i.test(url.toLowerCase()); }
function answerTypeFromContext(source: any): number {
  return Number(source?.answerType || source?.answerTypeConfig || source?.type || 0);
}

function extractDuration(source: any): number {
  const v = parseDurationSeconds(source?.duration || source?.time || source?.second || source?.audioTime || source?.length || source?.playTime || source?.videoTime || 0);
  return Number.isFinite(v) && v > 0 ? Math.round(v) : 0;
}

function formatDur(seconds: number): string {
  if (!seconds || seconds <= 0) return '';
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function collectPrivateMessageMediaCandidates(msg: any): any[] {
  const content = msg?.content || {};
  const payload = messagePayload(msg) || {};
  const candidates: any[] = [];

  const flipKeys = ['flipCardInfo', 'filpCardInfo', 'flipCardAudioInfo', 'filpCardAudioInfo', 'flipCardVideoInfo', 'filpCardVideoInfo'];

  function pushBody(source: any) {
    if (!source || typeof source !== 'object') return;
    candidates.push(source);
    for (const key of flipKeys) { if (source[key]) candidates.push(parseMaybeJson(source[key])); }
    for (const k of ['text', 'messageText', 'body', 'content']) {
      if (typeof source[k] === 'string') { const p = parseMaybeJson(source[k]); if (p && typeof p === 'object') candidates.push(p); }
    }
    if (Array.isArray(source.bodys)) {
      for (const b of source.bodys) { const parsed = typeof b === 'string' ? parseMaybeJson(b) : b; if (parsed) pushBody(parsed); }
    } else if (source.bodys && typeof source.bodys === 'object') {
      pushBody(source.bodys);
    }
    if (source.body && typeof source.body === 'object') pushBody(source.body);
    if (source.content && typeof source.content === 'object') pushBody(source.content);
  }

  if (content && typeof content === 'object') pushBody(content);
  if (msg && typeof msg === 'object') pushBody(msg);
  if (payload && typeof payload === 'object') pushBody(payload);

  const bodyRawCandidates = [];
  if (typeof msg?.bodys === 'string') bodyRawCandidates.push(msg.bodys);
  if (typeof content?.bodys === 'string') bodyRawCandidates.push(content.bodys);
  if (typeof msg?.body === 'string') bodyRawCandidates.push(msg.body);
  if (typeof content?.body === 'string') bodyRawCandidates.push(content.body);
  if (typeof msg?.content === 'string') bodyRawCandidates.push(msg.content);
  if (typeof msg?.msgContent === 'string') bodyRawCandidates.push(msg.msgContent);
  if (typeof msg?.message === 'string') bodyRawCandidates.push(msg.message);
  for (const raw of bodyRawCandidates) {
    const parsed = parseMaybeJson(raw);
    if (parsed) pushBody(parsed);
  }

  return candidates.filter(Boolean);
}

function makeMedia(url: string, type: 'audio' | 'video' | 'image', durSources: any[] = []): MediaInfo {
  const d = durSources.reduce((best, src) => best || extractDuration(src), 0);
  const titleMap: Record<string, string> = { audio: translate('语音消息'), video: translate('视频消息'), image: translate('图片消息') };
  return { url, type, title: titleMap[type] || translate('媒体消息'), ...(d > 0 ? { duration: d } : {}) };
}

function privateMessageMedia(msg: any): MediaInfo {
  const content = msg?.content || {};
  const payload = messagePayload(msg) || {};
  const p = payload && typeof payload === 'object' ? payload : {};
  const candidates = collectPrivateMessageMediaCandidates(msg);

  for (const item of candidates) {
    let rawUrl = pickText(item, ['url', 'mediaUrl', 'audioUrl', 'videoUrl', 'imageUrl', 'voiceUrl', 'mp4Url', 'playUrl', 'path', 'message.url', 'msg.url']);
    if (rawUrl) {
      const answerType = answerTypeFromContext(item);
      let url = normalizeUrl(rawUrl);
      if (!/^https?:\/\//i.test(url)) url = `${looksLikeImageUrl(url) ? 'https://source3.48.cn' : 'https://mp4.48.cn'}/${url.replace(/^\//, '')}`;
      if (looksLikeAudioUrl(url) || (answerType === 2 && !looksLikeVideoUrl(url) && !looksLikeImageUrl(url))) return makeMedia(url, 'audio', [item, msg, content]);
      if (looksLikeVideoUrl(url) || (answerType === 3 && !looksLikeAudioUrl(url) && !looksLikeImageUrl(url))) return makeMedia(url, 'video', [item, msg, content]);
      if (looksLikeImageUrl(url)) return makeMedia(url, 'image', [item]);
      const type = String(msg.msgType || item?.msgType || item?.type || p?.msgType || p?.type || '').toUpperCase();
      if (type.includes('AUDIO') || type.includes('VOICE')) return makeMedia(url, 'audio', [item, msg]);
      if (type.includes('VIDEO')) return makeMedia(url, 'video', [item, msg]);
      if (type.includes('IMAGE')) return makeMedia(url, 'image', [item]);
      return makeMedia(url, 'image', []);
    }

    const answerRaw = item.answer || item.answerContent || '';
    if (answerRaw) {
      const parsed = typeof answerRaw === 'string' ? parseMaybeJson(answerRaw) : answerRaw;
      if (parsed && typeof parsed === 'object') {
        rawUrl = pickText(parsed, ['url', 'mediaUrl', 'audioUrl', 'videoUrl', 'voiceUrl', 'mp4Url']);
        if (rawUrl) {
          const answerType = answerTypeFromContext(item) || answerTypeFromContext(parsed) || answerTypeFromContext(content) || answerTypeFromContext(msg);
          let url2 = normalizeUrl(rawUrl);
          if (!/^https?:\/\//i.test(url2)) url2 = `${looksLikeImageUrl(url2) ? 'https://source3.48.cn' : 'https://mp4.48.cn'}/${url2.replace(/^\//, '')}`;
          if (answerType === 2 || looksLikeAudioUrl(url2)) return makeMedia(url2, 'audio', [parsed, item, msg]);
          if (answerType === 3 || looksLikeVideoUrl(url2)) return makeMedia(url2, 'video', [parsed, item, msg]);
          if (looksLikeImageUrl(url2)) return makeMedia(url2, 'image', [parsed]);
          return makeMedia(url2, 'image', [parsed]);
        }
      }
    }
  }

  const rawText = String(msg?.body || msg?.bodys || msg?.msgContent || msg?.content || msg?.message || '');
  const urlMatch = rawText.match(/https?:\/\/[^\s"'<>]+/i);
  if (urlMatch) {
    const url3 = urlMatch[0];
    if (looksLikeAudioUrl(url3)) return makeMedia(url3, 'audio', [msg]);
    if (looksLikeVideoUrl(url3)) return makeMedia(url3, 'video', [msg]);
    if (looksLikeImageUrl(url3)) return makeMedia(url3, 'image', []);
  }

  const directAnswers = [
    payload?.answer, payload?.answerContent,
    content?.answer, content?.answerContent,
    msg?.answer, msg?.answerContent,
  ];
  for (const ans of directAnswers) {
    const pda = typeof ans === 'string' ? parseMaybeJson(ans) : ans;
    if (pda && typeof pda === 'object') {
      const daUrl = pickText(pda, ['url', 'mediaUrl', 'audioUrl', 'videoUrl', 'voiceUrl', 'mp4Url']);
      if (daUrl) {
        const daAt = answerTypeFromContext(pda) || answerTypeFromContext(msg) || answerTypeFromContext(content);
        let daNorm = normalizeUrl(daUrl);
        if (!/^https?:\/\//i.test(daNorm)) daNorm = `${looksLikeImageUrl(daNorm) ? 'https://source3.48.cn' : 'https://mp4.48.cn'}/${daNorm.replace(/^\//, '')}`;
        if (daAt === 2 || looksLikeAudioUrl(daNorm)) return makeMedia(daNorm, 'audio', [pda, msg]);
        if (daAt === 3 || looksLikeVideoUrl(daNorm)) return makeMedia(daNorm, 'video', [pda, msg]);
        if (looksLikeImageUrl(daNorm)) return makeMedia(daNorm, 'image', [pda]);
        return makeMedia(daNorm, 'image', [pda]);
      }
    }
  }

  return null;
}

function oldestFirst<T>(list: T[], timeOf: (item: T) => number): T[] { return list.slice().sort((a, b) => timeOf(a) - timeOf(b)); }

function flipTypeName(value: any) { const id = Number(value); if (id === 1) return translate('文字'); if (id === 2) return translate('语音'); if (id === 3) return translate('视频'); return translate('类型{value}', { value: value || '' }); }
function lowestPrice(item: any) {
  const arr = [item.normalCost, item.privateCost, item.anonymityCost].map(Number).filter((v: number) => isFinite(v) && v >= 0);
  // Y21: 全部非法时 Math.min(...[]) = Infinity → 兜底 0
  return arr.length ? Math.min(...arr) : 0;
}

export default function PrivateMessagesScreen() {
  const navigation = useNavigation<StackNavigationProp<RootStackParamList>>();
  const palette = usePalette();
  const { t } = useI18n();
  const members = useMemberStore((s) => s.members);
  const showToast = useUiStore((s) => s.showToast);
  const [convs, setConvs] = useState<any[]>([]);
  const [hasMoreConvs, setHasMoreConvs] = useState(false);
  const convCursorRef = useRef(0);
  const convLoadingRef = useRef(false);
  // 置顶会话（私信区同理：可置顶 + 可调换顺序），按目标用户 id 持久化
  const [pinnedConvs, setPinnedConvs] = useState<string[]>([]);
  useEffect(() => {
    AsyncStorage.getItem('yaya_pinned_convs').then((v) => {
      if (v) { try { setPinnedConvs(JSON.parse(v)); } catch { setPinnedConvs([]); } }
    });
  }, []);
  const persistPinned = async (next: string[]) => {
    setPinnedConvs(next);
    try {
      await AsyncStorage.setItem('yaya_pinned_convs', JSON.stringify(next));
    } catch (error: any) {
      showToast(t('置顶保存失败：{msg}', { msg: error?.message || String(error) }));
    }
  };
  const togglePinConv = (conv: any) => {
    const id = convTargetId(conv);
    if (!id) return;
    const next = pinnedConvs.includes(id) ? pinnedConvs.filter((x) => x !== id) : [...pinnedConvs, id];
    persistPinned(next);
  };
  const movePinConv = (id: string, dir: -1 | 1) => {
    const idx = pinnedConvs.indexOf(id);
    const to = idx + dir;
    if (idx < 0 || to < 0 || to >= pinnedConvs.length) return;
    const next = [...pinnedConvs];
    [next[idx], next[to]] = [next[to], next[idx]];
    persistPinned(next);
  };
  // 会话按时间分组（今天/昨天/更早）：组头 + 组内会话行
  const todayStr = (() => {
    const d = new Date();
    const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  })();
  const convRows = useMemo(() => {
    const groups: { key: string; title: string; items: any[] }[] = [
      { key: 'today', title: t('今天'), items: [] },
      { key: 'yesterday', title: t('昨天'), items: [] },
      { key: 'more', title: t('更早'), items: [] },
    ];
    const idxOf: Record<string, number> = { today: 0, yesterday: 1, more: 2 };
    const groupOf = (ts: number): string => {
      if (!ts) return 'more';
      const d = new Date(toMs(ts));
      const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
      const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      if (key === todayStr) return 'today';
      const y = new Date(ts - 86400000);
      const yKey = `${y.getFullYear()}-${pad(y.getMonth() + 1)}-${pad(y.getDate())}`;
      return key === yKey ? 'yesterday' : 'more';
    };
    const pinnedSet = new Set(pinnedConvs);
    const pinnedItems: any[] = [];
    const rest: any[] = [];
    for (const c of convs) {
      const target = convTargetId(c);
      if (target && pinnedSet.has(target)) pinnedItems.push(c);
      else rest.push(c);
    }
    // 置顶会话按 pinnedConvs 顺序排列（可调换），其余按时间分组
    const pinnedOrdered = pinnedItems
      .slice()
      .sort((a, b) => pinnedConvs.indexOf(convTargetId(a)) - pinnedConvs.indexOf(convTargetId(b)));
    const flat: { type: 'header' | 'item'; key: string; title?: string; item?: any }[] = [];
    if (pinnedOrdered.length) {
      flat.push({ type: 'header', key: 'h-pinned', title: t('置顶') });
      pinnedOrdered.forEach((it, i) => flat.push({ type: 'item', key: `i-pinned-${String(convTargetId(it) || i)}`, item: it }));
    }
    for (const c of rest) {
      groups[idxOf[groupOf(Number(c.lastTime || c.msgTime || 0))]].items.push(c);
    }
    groups.forEach((g) => {
      if (!g.items.length) return;
      flat.push({ type: 'header', key: `h-${g.key}`, title: g.title });
      g.items.forEach((it, i) => flat.push({ type: 'item', key: `i-${g.key}-${String(convTargetId(it) || i)}`, item: it }));
    });
    return flat;
  }, [convs, todayStr, t, pinnedConvs]);
  const [sel, setSel] = useState<any>(null);
  // 键盘高度：edge-to-edge 下 adjustResize 不生效（窗口不缩），手动把聊天容器底部抬起，
  // 让「消息列表 + 输入框」整体上移（与房间页共用同一 hook）。
  // ⚠️ 必须挂在组件顶层 —— 之前误放进条件分支（列表/会话两个 return），钩子数量随分支变化直接崩
  const keyboardHeight = useKeyboardHeight();
  const [msgs, setMsgs] = useState<any[]>([]);
  const [text, setText] = useState('');
  const [uid, setUid] = useState('');
  const token = useSettingsStore((s) => s.settings.p48Token);
  // Reset uid when token changes, so next openConv re-fetches
  useEffect(() => { setUid(''); }, [token]);
  const [prices, setPrices] = useState<any[]>([]);
  const [money, setMoney] = useState('');
  const [flipType, setFlipType] = useState(0);
  const [loading, setLoading] = useState(false);
  const [convError, setConvError] = useState('');
  const [nextTime, setNextTime] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const flatRef = useRef<FlatList>(null);
  const [playUrl, setPlayUrl] = useState('');
  const requestIdRef = useRef(0);
  // 会话切换竞态防护：快速切换会话时丢弃慢响应，避免旧会话数据覆盖新会话
  const convRequestIdRef = useRef(0);
  // 回底滚动定时器句柄：卸载/切换会话时清理，防止卸载后触发
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current); }, []);

  /**
   * 对方是不是「成员」：**只有命中成员库才算**（房主/其他成员）。
   * ⚠️ id 为空必须直接 null —— 否则 `String(m.userId) === ''` 会匹配到 userId 为空的成员记录，
   *    粉丝会话被误判成成员 → 错误地显示翻牌条（用户要求：非成员不显示翻牌）。
   */
  const selTargetId = String(sel ? convTargetId(sel) : '').trim();
  const member = useMemo(() => {
    if (!selTargetId) return null;
    return (
      members.find((m: any) =>
        [m?.id, m?.userId, m?.memberId].some((v) => {
          const s = String(v ?? '').trim();
          return !!s && s === selTargetId;
        }),
      ) || null
    );
  }, [members, selTargetId]);

  useEffect(() => { loadConvs(); }, []);

  useEffect(() => {
    if (!member) { setPrices([]); setMoney(''); return; }
    let a = true;
    (async () => {
      try {
        const [pr, mr] = await Promise.all([pocketApi.getFlipPrices(String(member.id)), pocketApi.getUserMoney().catch(() => null)]);
        if (!a) return;
        const list = unwrapList(pr, ['content.customs', 'content.list', 'data.customs', 'customs', 'list']);
        setPrices(list || []);
        setMoney(pickText(mr, ['content.moneyTotal', 'content.total', 'content.money', 'content.balance', 'data.moneyTotal', 'data.money', 'money', 'balance']) || '');
      } catch { if (a) setPrices([]); }
    })();
    return () => { a = false; };
  }, [member]);

  // 首屏只拉少量批次，剩余走「上滑加载更多」，避免一次性 60 轮全量拉取
  const loadConvs = async (initial = true) => {
    if (convLoadingRef.current) return;
    const requestId = ++requestIdRef.current;
    convLoadingRef.current = true;
    if (initial) setLoading(true);
    setConvError('');
    try {
      let cursor = initial ? Date.now() : (convCursorRef.current || Date.now());
      let all: any[] = [];
      let loops = 0;
      const maxLoops = initial ? 5 : 10;
      while (loops < maxLoops) {
        const res = await pocketApi.getPrivateMessageList(cursor);
        if (requestId !== requestIdRef.current) return;
        const list = unwrapList(res, ['content.userMessageList', 'content.list', 'content.data', 'data.userMessageList', 'userMessageList', 'list']);
        const incoming = Array.isArray(list) ? list : [];
        all = all.concat(incoming.filter((it: any) => !all.find((a: any) => (convTargetId(a) || a.userMessageId) === (convTargetId(it) || it.userMessageId))));
        const nextCursor = Number(res?.content?.lastTime || res?.data?.lastTime || 0);
        if (!nextCursor || !incoming.length) break;
        cursor = nextCursor;
        loops += 1;
      }
      convCursorRef.current = cursor;
      setConvs((prev) => {
        const merged = initial ? all : [...prev, ...all];
        const seen = new Set<string>();
        return merged
          .filter((it) => {
            const key = convTargetId(it) || it.userMessageId;
            if (!key || seen.has(key)) return false;
            seen.add(key);
            return true;
          })
          .sort((a: any, b: any) => Number(b.lastTime || b.msgTime || 0) - Number(a.lastTime || a.msgTime || 0));
      });
      // 是否还有更多（本批拉满 且 游标有前进）
      setHasMoreConvs(loops >= maxLoops && cursor > 0);
    } catch (e) { setConvError(errorMessage(e)); showToast(t('加载失败：{msg}', { msg: errorMessage(e) })); }
    finally {
      if (requestId === requestIdRef.current) {
        convLoadingRef.current = false;
        setLoading(false);
      }
    }
  };

  const openConv = async (c: any) => {
    const requestId = ++convRequestIdRef.current;
    setSel(c); setMsgs([]); setNextTime(0); setHasMore(false); setFlipType(0); setPlayUrl('');
    setLoading(true);
    if (scrollTimerRef.current) { clearTimeout(scrollTimerRef.current); scrollTimerRef.current = null; }
    try {
      if (!uid) {
        const info = await pocketApi.getNimLoginInfo().catch(() => null);
        const id = pickText(info, ['content.userInfo.userId', 'content.userId', 'id', 'userId']);
        if (id && requestId === convRequestIdRef.current) setUid(String(id));
      }
      const res = await pocketApi.getPrivateMessageDetail(convTargetId(c));
      if (requestId !== convRequestIdRef.current) return; // 已切换会话，丢弃慢响应
      const list = unwrapList(res, ['content.messageList', 'content.messages', 'content.list', 'messageList', 'list']);
      const sorted = oldestFirst(list, msgTimeNumber);
      setMsgs(sorted);
      setNextTime(Number(res?.content?.nextTime || res?.data?.nextTime || 0));
      setHasMore(sorted.length > 0);
      scrollTimerRef.current = setTimeout(() => flatRef.current?.scrollToEnd?.({ animated: false }), 150);
    } catch (e) {
      if (requestId !== convRequestIdRef.current) return;
      showToast(t('加载失败：{msg}', { msg: errorMessage(e) }));
    } finally {
      if (requestId === convRequestIdRef.current) setLoading(false);
    }
  };

  const loadMore = async () => {
    if (!sel || loading || !hasMore || !nextTime) return;
    setLoading(true);
    try {
      const res = await pocketApi.getPrivateMessageDetail(convTargetId(sel), nextTime);
      const list = unwrapList(res, ['content.messageList', 'content.messages', 'content.list', 'messageList', 'list']);
      if (!list.length) { setHasMore(false); return; }
      const older = oldestFirst(list, msgTimeNumber);
      setMsgs((prev) => {
        const seen = new Set(prev.map((m) => msgId(m)));
        const dedupedOlder = older.filter((m) => !seen.has(msgId(m)));
        return oldestFirst([...dedupedOlder, ...prev], msgTimeNumber);
      });
      const nextCursor = Number(res?.content?.nextTime || res?.data?.nextTime || 0);
      setNextTime(nextCursor);
      // 游标无前进时终止（防恒定游标死循环）
      setHasMore(list.length > 0 && nextCursor > 0 && nextCursor !== nextTime);
    } catch (e) { showToast(t('历史加载失败：{msg}', { msg: errorMessage(e) })); }
    finally { setLoading(false); }
  };

  /**
   * 带 targetUserId 直接进会话（房间点粉丝头像 → 用户资料卡「私信」）。
   * 不依赖会话列表里已存在该会话：直接构造最小会话打开。
   * 对方不在成员库 → member 为 null → 不显示翻牌条（纯私信会话）。
   */
  const route = useRoute<any>();
  const initialRouteTargetRef = useRef('');
  const routeTargetId = String(route?.params?.targetUserId || '').trim();
  const routeTargetName = String(route?.params?.targetName || '');
  useEffect(() => {
    if (!routeTargetId || initialRouteTargetRef.current === routeTargetId) return;
    initialRouteTargetRef.current = routeTargetId;
    void openConv({ targetUserId: routeTargetId, user: { userId: routeTargetId, nickname: routeTargetName } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeTargetId]);

  /** 私信发图片（对齐桌面 handlePrivateMessageImageSelected）：选图 → 上传 pfile → 发 IMAGE 私信 */
  const pickAndSendImage = async () => {
    if (!sel) return;
    if (flipType > 0) { showToast(t('翻牌模式不能发送图片')); return; }
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) { showToast(t('需要相册权限才能发图片')); return; }
      const picked = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.9,
      });
      if (picked.canceled || !picked.assets?.length) return;
      const asset = picked.assets[0];
      const mime = String(asset.mimeType || 'image/jpeg').toLowerCase();
      if (!['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'].includes(mime)) {
        showToast(t('请选择 JPG、PNG、WEBP 或 GIF 图片'));
        return;
      }
      if (Number(asset.fileSize || 0) > 20 * 1024 * 1024) { showToast(t('图片不能超过 20MB')); return; }
      const targetId = convTargetId(sel);
      if (!targetId) return;
      setLoading(true);
      // 复用已有上传通道（uploadPocketImage 不传 fromType → 私信图片不带 fromType，与桌面端一致）
      const uploaded: any = await pocketApi.uploadPocketImage({
        uri: asset.uri,
        fileName: asset.fileName || `private-message-${Date.now()}.jpg`,
        mimeType: mime,
      });
      const uploadedItem = uploaded?.content || {};
      // 图片尺寸：优先用 picker 直接给的 width/height（最可靠），再用接口返回，最后才用 Image.getSize
      //（getSize 对部分 Android content:// URI 不会回调，只能拿到 0）
      const pickerW = Number((asset as any).width) || 0;
      const pickerH = Number((asset as any).height) || 0;
      const localSize = pickerW > 0 && pickerH > 0
        ? { width: pickerW, height: pickerH }
        : await new Promise<{ width: number; height: number }>((resolve) => {
            Image.getSize(asset.uri, (width, height) => resolve({ width, height }), () => resolve({ width: 0, height: 0 }));
          });
      await pocketApi.sendPrivateImageMessage(targetId, {
        imgUrl: uploaded.path,
        imgWidth: Number(uploadedItem.width) || localSize.width || 0,
        imgHeight: Number(uploadedItem.height) || localSize.height || 0,
        imgSize: Number(uploadedItem.size) || Number(asset.fileSize || 0) || 0,
      });
      showToast(t('已发送'));
      await openConv(sel);
    } catch (e) {
      showToast(t('发送图片失败：{msg}', { msg: errorMessage(e) }));
    } finally {
      setLoading(false);
    }
  };

  /** 长按自己的私信 → 删除（桌面 deletePrivateMessageFromContext 同款） */
  const confirmDeletePrivateMessage = useCallback((item: any) => {
    const id = msgId(item);
    if (!id) { showToast(t('该消息不支持删除')); return; }
    Alert.alert(t('删除消息'), t('删除这条私信？'), [
      { text: t('取消'), style: 'cancel' },
      {
        text: t('删除'),
        style: 'destructive',
        onPress: () => {
          void pocketApi
            .deletePrivateMessage(id)
            .then(() => {
              setMsgs((prev) => prev.filter((m) => msgId(m) !== id));
              showToast(t('已删除'));
            })
            .catch((e) => showToast(t('删除失败：{msg}', { msg: errorMessage(e) })));
        },
      },
    ]);
  }, [showToast, t]);

  const doSend = async (override?: string) => {    const txt = String(override ?? text).trim();
    if (!txt || !sel) return;
    setLoading(true);
    try {
      if (flipType && member) {
        const p = prices.find((x) => x.answerType === flipType);
        const cost = p ? (p.privateCost || p.normalCost || lowestPrice(p)) : 0;
        // 桌面 checkPrivateMessageFlipCostMin 同款：价格缺失或为 0 = 该类型未启用 → 拦下不发
        if (!p || cost <= 0) {
          showToast(t('该类型翻牌未启用，请换一种类型'));
          setLoading(false);
          return;
        }
        await pocketApi.sendFlipQuestion({
          memberId: parseInt(String(member.id), 10) || 0,
          content: txt,
          type: 2,
          cost,
          answerType: flipType,
        });
        showToast(t('翻牌已提交'));
      } else {
        await pocketApi.sendPrivateMessageReply(convTargetId(sel), txt);
        showToast(t('已发送'));
        await openConv(sel);
      }
      if (!override) setText('');
    } catch (e) { showToast(t('发送失败：{msg}', { msg: errorMessage(e) })); }
    finally { setLoading(false); }
  };

  if (sel) {
    const targetId = convTargetId(sel);
    // 聊天行数据：按天插入日期分隔条 + 3 分钟内同侧消息分组（组内连排小圆角）
    const pad2 = (n: number) => (n < 10 ? `0${n}` : String(n));
    const dayKeyOf = (ts: number) => {
      const d = new Date(toMs(ts));
      return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    };
    const todayK = dayKeyOf(Date.now());
    const yesterdayK = dayKeyOf(Date.now() - 86400000);
    const dayLabel = (ts: number) => {
      const k = dayKeyOf(ts);
      if (k === todayK) return t('今天');
      if (k === yesterdayK) return t('昨天');
      return `${pad2(new Date(toMs(ts)).getMonth() + 1)}-${pad2(new Date(toMs(ts)).getDate())}`;
    };
    const chatRows: { type: 'date' | 'msg'; key: string; label?: string; item?: any; groupStart?: boolean }[] = [];
    let prevDay = '';
    let prevMine: boolean | null = null;
    let prevTs = 0;
    // 统一按时间正序（旧→新）喂给聊天库：接口返回可能是「新→旧」，
    // 不排序会让最新一条回复跑到列表最上面（用户反馈「最新回复消息是反过来的」）
    // ⚠️ 聊天库默认 inverted=true：FlatList 反转渲染，**数组第 0 项显示在最下面**。
    // 所以 messages 必须是「新的在前（倒序）」——第十批我误改成 oldestFirst(正序)，
    // 结果最旧的沉底、最新的跑到最上面（用户反馈「她的消息在我的消息上面」就是这个）。
    // 排序键与 createdAt 用同一套「秒→毫秒」归一化，避免顺序与气泡显示的时间对不上。
    [...msgs].sort((a: any, b: any) => {
      const va = msgTimeNumber(a); const vb = msgTimeNumber(b);
      const ka = va > 0 && va < 1e12 ? va * 1000 : va;
      const kb = vb > 0 && vb < 1e12 ? vb * 1000 : vb;
      return kb - ka;
    }).forEach((item, i) => {
      const ts = msgTimeNumber(item);
      const mine = isMineMessage(item, targetId, uid);
      const dk = dayKeyOf(ts);
      if (dk !== prevDay) {
        chatRows.push({ type: 'date', key: `d-${dk}`, label: dayLabel(ts) });
        prevDay = dk;
        prevMine = null;
        prevTs = 0;
      }
      const groupStart = prevMine === null || prevMine !== mine || ts - prevTs > 3 * 60 * 1000;
      chatRows.push({ type: 'msg', key: `m-${msgId(item)}`, item, groupStart });
      prevMine = mine;
      prevTs = ts;
    });
    // ── 聊天库接线（A+B）：行 → IMessage（original/groupStart 透传） ──
    // 日期分隔交给聊天库自带（renderDay），这里只喂真实消息。
    // ⚠️ 两个必须：① user._id 按真实发送者（库按它决定左右）② createdAt 归一化到毫秒
    //（接口给的是秒，直接 new Date(秒) 会变成 1970）
    const ims: any[] = chatRows
      .filter((row) => row.type === 'msg')
      .map((row) => {
        const mine = isMineMessage(row.item, targetId, uid);
        const t = msgTimeNumber(row.item);
        /** 对方头像：成员资料里的 avatar（会话页从 members 里按目标 id 取） */
        const peerAvatar = (member as any)?.avatar || (member as any)?.avatarUrl || '';
        return {
          _id: row.key,
          text: privateMessageText(row.item) || '',
          createdAt: new Date(t < 1e12 ? t * 1000 : t),
          user: {
            _id: mine ? 'SELF' : String(targetId || 'peer'),
            ...(mine ? {} : { avatar: peerAvatar, name: convName(sel) }),
          },
          original: row.item,
          groupStart: row.groupStart,
          isMine: mine,
          // 交给库自带的媒体渲染
          ...(privateMessageMedia(row.item)?.type === 'image' ? { image: privateMessageMedia(row.item)!.url } : {}),
          ...(privateMessageMedia(row.item)?.type === 'audio' ? { audio: privateMessageMedia(row.item)!.url } : {}),
          ...(privateMessageMedia(row.item)?.type === 'video' ? { video: privateMessageMedia(row.item)!.url } : {}),
        };
      });

    /**
     * 日期分隔：统一纯数字 yyyy/mm/dd（库自带的 zh 输出是「14 9月」这种不符合中文习惯的格式）
     */
    const renderDayLabel = ({ createdAt, date }: any) => {
      // ⚠️ 库回调传的是 createdAt（DayAnimated/index.js: renderDay({...rest, createdAt, isAnimated})），
      // 不是 date —— 只读 date 会得到 undefined → NaN → 返回 null → 日期分隔根本不显示。
      const d = new Date(createdAt ?? date);
      if (Number.isNaN(d.getTime())) return null;
      const p2 = (n: number) => (n < 10 ? `0${n}` : String(n));
      const label = `${d.getFullYear()}/${p2(d.getMonth() + 1)}/${p2(d.getDate())}`;
      // 用户要求：日期分隔**居中**（库的 Day 容器居中，但自定义 renderDay 的返回被塞进
      // 无 alignItems 的普通 View → 被拉伸满宽、默认左对齐）→ 用 alignSelf 居中。
      return <Text style={[styles.dateSepText, { color: palette.labelTertiary, alignSelf: 'center' }]}>{label}</Text>;
    };

    /**
     * 纯椭圆玻璃气泡（材质 = 全站同一套 GlassSurface）。
     * 只做气泡本身：左右分列仍由库的 position 决定（不再包一层 row，避免阶梯错位）。
     */
    const renderEllipseGlassBubble = ({ currentMessage, position }: any) => {
      const msg = currentMessage as any;
      const item = msg.original;
      const mine = position === 'right';
      const t0 = msg.createdAt instanceof Date ? msg.createdAt : new Date(msg.createdAt);
      const hh = Number.isNaN(t0.getTime()) ? '' : `${String(t0.getHours()).padStart(2, '0')}:${String(t0.getMinutes()).padStart(2, '0')}`;
      // 语音/视频/图片消息：这个气泡原来只渲染 msg.text → 媒体消息只剩「[语音消息]」文字、点不动。
      // 补上内联媒体：图片直显；语音/视频给播放键 + 内联 PlayerScreen。
      const media = item ? privateMessageMedia(item) : null;
      const hasText = !!msg.text && !/^\[(语音|视频|图片|媒体|链接)消息\]$/.test(String(msg.text)) && msg.text !== '[空消息]';
      const mediaLabel = media ? (formatDur(media.duration || 0) || (media.type === 'audio' ? t('语音') : t('视频'))) : '';
      return (
        <GlassSurface
          role="chip"
          radius={22}
          tintColor={mine ? palette.tint : undefined}
          // 长按自己的消息 → 删除（桌面端右键删除同款）
          onLongPress={mine && item ? () => confirmDeletePrivateMessage(item) : undefined}
          style={styles.ellipseBubble}
        >
          {hasText ? (
            <Text style={[styles.ellipseText, { color: mine ? palette.onTint : palette.label }]}>{msg.text}</Text>
          ) : null}
          {media ? (
            media.type === 'image' ? (
              <Image source={{ uri: media.url }} style={[styles.inlineImg, { backgroundColor: palette.fill2 }]} resizeMode="cover" />
            ) : (
              <ScalePressable
                style={[styles.mediaBtn, { backgroundColor: mine ? palette.tintSoft : palette.fill2 }]}
                onPress={() => setPlayUrl((p) => (p === media.url ? '' : media.url))}
              >
                <Text style={[styles.mediaBtnText, mine && { color: palette.onTint }, !mine && { color: palette.tint }]}>
                  {playUrl === media.url ? t('收起') : mediaLabel}
                </Text>
                {playUrl !== media.url ? <MaterialCommunityIcons name="play" size={14} color={mine ? palette.onTint : palette.tint} style={{ marginLeft: 4 }} /> : null}
              </ScalePressable>
            )
          ) : null}
          {media && playUrl === media.url ? (
            <PlayerScreen
              inline
              source={{ kind: media.type === 'audio' ? 'audio' : 'vod', url: media.url }}
              meta={{ title: t('消息媒体') }}
              persistent
            />
          ) : null}
          {hh ? (
            <Text style={[styles.ellipseTime, { color: mine ? 'rgba(255,255,255,0.75)' : palette.labelTertiary }]}>{hh}</Text>
          ) : null}
        </GlassSurface>
      );
    };

    /** 玻璃气泡（沿用原实现：媒体内联 + 时间戳，「自己」用 tint 染色玻璃） */
    const renderGlassBubble = ({ currentMessage }: any) => {
      const msg = currentMessage as any;
      if (msg.system) {
        return (
          <View style={styles.dateSepWrap}>
            <View style={[styles.dateSep, { backgroundColor: palette.fill2 }]}>
              <Text style={[styles.dateSepText, { color: palette.labelTertiary }]}>{msg.text}</Text>
            </View>
          </View>
        );
      }
      const item = msg.original;
      const mine = !!msg.isMine;
      const groupStart = !!msg.groupStart;
      const media = privateMessageMedia(item);
      const txt = privateMessageText(item);
      const hasText = txt && !/^\[(语音|视频|图片|媒体|链接)消息\]$/.test(txt) && txt !== '[空消息]';
      const mediaLabel = media ? (formatDur(media.duration || 0) || (media.type === 'audio' ? t('语音') : t('视频'))) : '';
      return (
        <View style={[styles.msgRow, mine && styles.msgRowMine]}>
          <GlassSurface
            role="chip"
            radius={18}
            tintColor={mine ? palette.tint : undefined}
            style={[
              styles.bubble,
              mine ? styles.bubbleMine : null,
              !groupStart && mine && styles.bubbleMineMid,
              !groupStart && !mine && styles.bubbleOtherMid,
              mine ? null : { borderColor: palette.hairline, borderWidth: StyleSheet.hairlineWidth },
            ]}
          >
            {hasText ? <Text style={[styles.msgText, mine && { color: palette.onTint }, !mine && { color: palette.label }]}>{txt}</Text> : null}
            {media ? (
              media.type === 'image' ? (
                <Image source={{ uri: media.url }} style={[styles.inlineImg, { backgroundColor: palette.fill2 }]} resizeMode="cover" />
              ) : (
                <ScalePressable style={[styles.mediaBtn, { backgroundColor: mine ? palette.tintSoft : palette.fill2 }]} onPress={() => setPlayUrl((p) => p === media.url ? '' : media.url)}>
                  <Text style={[styles.mediaBtnText, mine && { color: palette.onTint }, !mine && { color: palette.tint }]}>{playUrl === media.url ? t('收起') : `${mediaLabel}`}</Text>
                  {playUrl !== media.url ? <MaterialCommunityIcons name="play" size={14} color={mine ? palette.onTint : palette.tint} style={{ marginLeft: 4 }} /> : null}
                </ScalePressable>
              )
            ) : !hasText ? <Text style={[styles.msgText, mine && { color: palette.onTint }, !mine && { color: palette.label }]}>{t('[空消息]')}</Text> : null}
            {playUrl === media?.url ? (
              <PlayerScreen
                inline
                source={{ kind: media!.type === 'audio' ? 'audio' : 'vod', url: media!.url }}
                meta={{ title: t('消息媒体') }}
                persistent
              />
            ) : null}
            <Text style={[styles.msgTime, mine && { color: 'rgba(255,255,255,0.75)' }, !mine && { color: palette.labelTertiary }]}>
              {(() => { const t = msgTimeNumber(item); return formatTimestamp(t < 1e12 ? t * 1000 : t).slice(11, 16); })()}
            </Text>
          </GlassSurface>
        </View>
      );
    };


    return (
      <View style={styles.screenContainer}>
        <View style={[styles.screen, { backgroundColor: usePageBackground(), paddingBottom: keyboardHeight }]}>
        <ScreenHeader title={convName(sel)} onBack={() => setSel(null)} />
        {/* 官方 demo 用法：只给 messages / user / onSend，其余全用库默认（气泡、日期、输入条） */}
        <View style={{ flex: 1 }}>
        <Chat
          messages={ims}
          // 背景透明：露出页面/房间背景图（库默认灰底会把它整块盖住）
          theme={{ colors: { background: 'transparent' } }}
          locale="zh"
          renderBubble={renderEllipseGlassBubble}
          // 日期分隔（用户要求加回）：跨天消息只显示 HH:mm 会看反顺序，加 yyyy/mm/dd 分隔
          renderDay={renderDayLabel}
          isDayAnimationEnabled={false}
          user={{ _id: 'SELF' }}
          onSend={(msgs) => {
            const outgoing = String((msgs as any)?.[0]?.text ?? '').trim();
            if (outgoing) void doSend(outgoing);
          }}
          renderInputToolbar={() => null}
        />
        </View>
        {member ? (
          <GlassSurface radius={20} role="card" style={[styles.flipBar, { backgroundColor: 'transparent', borderTopColor: palette.hairline }]}>
            <Text style={[styles.flipName, { color: palette.labelSecondary }]}>{t('{name} 翻牌', { name: member.ownerName || '' })}</Text>
            <View style={styles.flipRow}>
              {prices.slice(0, 3).map((p) => (
                <ScalePressable
                  key={p.answerType}
                  style={[
                    styles.flipChip,
                    flipType === p.answerType
                      ? { backgroundColor: palette.tint }
                      : { backgroundColor: palette.fill2 },
                  ]}
                  onPress={() => setFlipType((v) => v === p.answerType ? 0 : p.answerType)}
                >
                  <Text
                    style={[
                      styles.flipChipT,
                      flipType === p.answerType ? { color: palette.onTint } : { color: palette.labelSecondary },
                    ]}
                  >
                    {flipTypeName(p.answerType)}·{lowestPrice(p)}
                  </Text>
                </ScalePressable>
              ))}
              <View style={styles.flipSpacer} />
              {money ? <Text style={[styles.flipMoney, { color: palette.tint }]}>{t('余额 {money}', { money })}</Text> : null}
              <ScalePressable style={[styles.flipRechargeBtn, { backgroundColor: palette.tint }]} onPress={() => navigation.navigate('RechargeScreen')}>
                <Text style={[styles.flipRechargeT, { color: palette.onTint }]}>{t('充值')}</Text>
              </ScalePressable>
            </View>
          </GlassSurface>
        ) : null}
        <GlassSurface radius={20} role="card" style={[styles.inputBar, { backgroundColor: 'transparent', borderTopColor: palette.hairline }]}>
          {flipType > 0 ? <Text style={[styles.flipLabel, { color: palette.tint }]}>{t('私密翻牌·{type}', { type: flipTypeName(flipType) })}</Text> : null}
          <View style={styles.inputRow}>
            {/* 发图片（翻牌模式下禁用 —— 桌面端同语义） */}
            <ScalePressable
              style={[styles.imgPickerBtn, { backgroundColor: palette.fill2 }]}
              onPress={() => { void pickAndSendImage(); }}
              disabled={loading || flipType > 0}
            >
              <MaterialCommunityIcons
                name="image-plus"
                size={19}
                color={flipType > 0 ? palette.labelTertiary : palette.tint}
              />
            </ScalePressable>
            <TextInput
              style={[styles.input, { backgroundColor: palette.surfaceGlassStrong, borderColor: palette.innerStroke, color: palette.label }]}
              placeholder={t('输入内容...')}
              placeholderTextColor={palette.labelTertiary}
              value={text}
              onChangeText={setText}
              multiline
            />
            <ScalePressable style={[styles.sendBtn, { backgroundColor: palette.tint }]} onPress={() => { void doSend(); }} disabled={loading || !text.trim()}>
              <Text style={[styles.sendT, { color: palette.onTint }]}>{loading ? '..' : flipType ? t('翻牌') : t('发送')}</Text>
            </ScalePressable>
          </View>
        </GlassSurface>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: usePageBackground() }]}>
      <ScreenHeader title={t('私信列表')} right={
        <HeaderAction label={t('刷新')} onPress={() => loadConvs(true)} />
      } />
      <FadeInView delay={80} duration={300} style={{ flex: 1 }}>
        <PerfFlatList
          data={convRows}
          // 滚动锚点（B6）：刷新/置顶重排后保持可见位置
          maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
          keyExtractor={(item) => item.key}
          initialNumToRender={12}
          maxToRenderPerBatch={12}
          windowSize={7}
          removeClippedSubviews
          contentContainerStyle={styles.convList}
          renderItem={({ item, index }) => {
            if (item.type === 'header') {
              return (
                <Text style={[styles.groupTitle, { color: palette.labelTertiary }]}>{item.title}</Text>
              );
            }
            const conv = item.item as any;
            const name = convName(conv);
            const unread = Number(conv.noreadNum);
            const latestTime = Number(conv.lastTime || conv.msgTime || 0);
            const isPinned = pinnedConvs.includes(convTargetId(conv));
            // 真实成员头像：按会话目标 id 从成员库匹配；无头像时回落首字母
            const convTarget = String(convTargetId(conv));
            const convMember = members.find((m: any) => String(m.id || m.userId || m.memberId) === convTarget);
            const convAvatarUrl = (convMember as any)?.avatar || (convMember as any)?.avatarUrl || '';
            return (
              <FadeInView delay={index < 12 ? 80 + index * 30 : 0} duration={300}>
                <View style={styles.convRowWrap}>
                <TouchableOpacity
                  style={[
                    styles.convCard,
                    { backgroundColor: 'transparent', borderColor: isPinned ? palette.tint : palette.hairline, borderWidth: StyleSheet.hairlineWidth, borderRadius: 20 },
                  ]}
                  onPress={() => openConv(conv)}
                  activeOpacity={0.88}
                >
                <GlassSurface radius={20} role="card">
                  {/* ⚠️ 行布局必须放在玻璃内部：GlassSurface 的 children 容器是 column，
                      若把 flexDirection:'row'/padding 留在外层 TouchableOpacity 上，
                      内容会在玻璃里竖直堆叠、宽度被压到只剩 1 个字符（名字显示不全） */}
                  <View style={styles.convCardRow}>
                  <View style={[styles.convAvatar, { backgroundColor: palette.tintSoft }]}>
                    {convAvatarUrl ? (
                      <Image source={{ uri: thumbUrl(convAvatarUrl, AVATAR_THUMB_WIDTH) }} style={styles.convAvatarImg} resizeMode="cover" />
                    ) : (
                      <Text style={[styles.convAvatarText, { color: palette.tint }]}>{name.trim().slice(0, 1).toUpperCase()}</Text>
                    )}
                  </View>
                  <View style={styles.convInfo}>
                    <View style={styles.convTitleRow}>
                      <Text style={[styles.convName, { color: palette.label }]} numberOfLines={1}>{name}</Text>
                      {latestTime ? <Text style={[styles.convTime, { color: palette.labelTertiary }]} numberOfLines={1}>{formatTimestamp(latestTime).slice(5, 16)}</Text> : null}
                    </View>
                    <View style={styles.convMetaRow}>
                      <Text style={[styles.convPrev, { color: palette.labelSecondary }]} numberOfLines={1}>{conv.newestMessage || t('点击查看')}</Text>
                      {unread > 0 ? (
                        <View style={[styles.badge, { backgroundColor: palette.tint }]}>
                          <Text style={styles.badgeT}>{unread > 99 ? '99+' : unread}</Text>
                        </View>
                      ) : (
                        <MaterialCommunityIcons name="chevron-right" size={20} color={palette.labelTertiary} />
                      )}
                    </View>
                  </View>
                  </View>
                </GlassSurface>
                </TouchableOpacity>
                <View style={styles.convActions}>
                  {isPinned && pinnedConvs.length > 1 ? (
                    <View style={styles.pinMoveCol}>
                      <ScalePressable
                        style={[styles.pinMoveBtn, { backgroundColor: palette.fill2 }]}
                        onPress={() => movePinConv(convTargetId(conv), -1)}
                        pressedScale={0.85}
                        hitSlop={{ top: 4, bottom: 2, left: 4, right: 4 }}
                        disabled={pinnedConvs.indexOf(convTargetId(conv)) === 0}
                      >
                        <MaterialCommunityIcons name="chevron-up" size={13} color={palette.labelSecondary} />
                      </ScalePressable>
                      <ScalePressable
                        style={[styles.pinMoveBtn, { backgroundColor: palette.fill2 }]}
                        onPress={() => movePinConv(convTargetId(conv), 1)}
                        pressedScale={0.85}
                        hitSlop={{ top: 2, bottom: 4, left: 4, right: 4 }}
                        disabled={pinnedConvs.indexOf(convTargetId(conv)) === pinnedConvs.length - 1}
                      >
                        <MaterialCommunityIcons name="chevron-down" size={13} color={palette.labelSecondary} />
                      </ScalePressable>
                    </View>
                  ) : null}
                  <ScalePressable
                    style={[styles.convPinBtn, { backgroundColor: isPinned ? palette.tintSoft : palette.fill2 }]}
                    onPress={() => togglePinConv(conv)}
                    pressedScale={0.9}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <MaterialCommunityIcons
                      name={isPinned ? 'pin' : 'pin-outline'}
                      size={15}
                      color={isPinned ? palette.tint : palette.labelTertiary}
                    />
                  </ScalePressable>
                </View>
                </View>
              </FadeInView>
            );
          }}
          ListEmptyComponent={
            loading ? <CenterSpinner text={t('正在加载会话…')} />
            : convError ? (
              <ErrorState title={t('加载失败')} hint={convError} onAction={() => loadConvs()} />
            ) : (
              <EmptyState icon="message-outline" title={t('暂无私信')} />
            )
          }
          onEndReached={() => { if (hasMoreConvs) loadConvs(false); }}
          onEndReachedThreshold={0.4}
          ListFooterComponent={
            hasMoreConvs ? <CenterSpinner text={t('加载更多会话…')} /> : null
          }
        />
      </FadeInView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  screenContainer: { flex: 1 },
  convList: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 16 },
  groupTitle: { fontSize: 13, fontWeight: '800', marginTop: 12, marginBottom: 2, paddingLeft: 4 },
  convCard: { marginVertical: 4, flex: 1 },
  /** 玻璃内部的行布局（padding + row 必须在这里，见上方注释） */
  convCardRow: { padding: 12, flexDirection: 'row', alignItems: 'center' },
  convRowWrap: { flexDirection: 'row', alignItems: 'center' },
  convActions: { marginLeft: 8, gap: 8, alignItems: 'center' },
  convPinBtn: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  pinMoveCol: { gap: 2, alignItems: 'center' },
  pinMoveBtn: { width: 22, height: 18, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  convAvatar: {
    width: 44,
    height: 44,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  convAvatarImg: { width: 44, height: 44, borderRadius: 999 },
  convAvatarText: { fontSize: 17, fontWeight: '800' },
  convInfo: { flex: 1, marginLeft: 12 },
  convTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  convName: { fontSize: 15, fontWeight: '700', flex: 1, marginRight: 8 },
  convTime: { fontSize: 11 },
  convMetaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 3 },
  convPrev: { fontSize: 12, flex: 1, marginRight: 8 },
  badge: { borderRadius: 999, minWidth: 20, height: 20, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  badgeT: { color: '#fff', fontSize: 11, fontWeight: '700' },
  msgList: { paddingHorizontal: 12, paddingVertical: 8 },
  dateSepWrap: { alignItems: 'center', marginVertical: 10 },
  dateSep: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999 },
  dateSepText: { fontSize: 10, fontWeight: '700' },
  msgRow: { marginVertical: 2, alignItems: 'flex-start' },
  msgRowMine: { alignItems: 'flex-end' },
  bubble: { maxWidth: '82%', padding: 10, borderWidth: StyleSheet.hairlineWidth, borderRadius: 20, borderTopLeftRadius: 6 },
  bubbleMine: { borderTopLeftRadius: 16, borderTopRightRadius: 6 },
  bubbleMineMid: { borderTopRightRadius: 16, borderBottomRightRadius: 6 },
  bubbleOtherMid: { borderTopLeftRadius: 16, borderBottomLeftRadius: 6 },
  msgText: { fontSize: 14, lineHeight: 20 },
  msgTime: { fontSize: 10, marginTop: 4 },
  mediaBtn: { marginTop: 4, paddingVertical: 6, paddingHorizontal: 12, borderRadius: 14, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center' },
  mediaBtnText: { fontSize: 12, fontWeight: '800' },
  inlineImg: { width: 200, height: 200, marginTop: 4, borderRadius: 14 },
  audio: { height: 48, minWidth: 200, marginTop: 4, borderRadius: 10 },
  video: { height: 150, minWidth: 200, marginTop: 4, backgroundColor: '#000', borderRadius: 10 },
  flipBar: { paddingHorizontal: 12, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth },
  flipName: { fontSize: 11, fontWeight: '700', marginBottom: 4 },
  flipRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  flipChip: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10 },
  flipChipT: { fontSize: 11, fontWeight: '700' },
  flipSpacer: { flex: 1 },
  flipMoney: { fontSize: 11, fontWeight: '700' },
  flipRechargeBtn: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 18 },
  flipRechargeT: { fontSize: 10, fontWeight: '800' },
  flipLabel: { fontSize: 10, fontWeight: '800', marginBottom: 2 },
  inputBar: { paddingHorizontal: 10, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  imgPickerBtn: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  input: { flex: 1, padding: 10, borderRadius: 18, borderWidth: 1, fontSize: 14, maxHeight: 80 },
  sendBtn: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 18 },
  ellipseBubble: { paddingVertical: 9, paddingHorizontal: 14, maxWidth: '78%', marginVertical: 2 },
  ellipseText: { fontSize: 15, lineHeight: 21 },
  ellipseTime: { fontSize: 11, marginTop: 3, alignSelf: 'flex-end' },
  chatAvatarWrap: { width: 40, height: 40, borderRadius: 20, overflow: 'hidden', marginHorizontal: 6 },
  chatAvatar: { width: '100%', height: '100%' },
  sendT: { fontWeight: '800', fontSize: 13 },
});
