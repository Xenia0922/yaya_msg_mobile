import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { showDialog } from '../components/AppDialog';
import { PerfFlatList } from '../components/PerfFlatList';
import { Chat } from '@kesha-antonov/react-native-chat';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useKeyboardHeight } from '../hooks/useKeyboardHeight';
import { useSafeAreaInsets } from '../hooks/useSafeAreaInsets';

import {
  BackHandler,
  FlatList,
  Image,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import PlayerScreen from '../player';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/types';
import { useMemberStore, useSettingsStore, useUiStore } from '../store';
import { FadeInView, ScalePressable } from '../components/Motion';
import { CenterSpinner } from '../components/Loaders';
import { EmptyState, ErrorState } from '../components/StateViews';
import ScreenHeader from '../components/ScreenHeader';
import { HeaderAction } from '../components/HeaderAction';
import { formatTimestamp, toMs } from '../utils/format';
import { parseDurationSeconds } from '../utils/duration';
import {
  errorMessage,
  messagePayload,
  messageText,
  parseMaybeJson,
  pickText,
  unwrapList,
} from '../utils/data';
import pocketApi from '../api/pocket48';
import { usePalette, getPageBackground, fontFamily, radii } from '../theme';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { translate, useI18n } from '../i18n';
import { GlassSurface } from '../components/GlassSurface';
import { sumPrivateConversationUnread } from '../utils/privateUnread';
import { AVATAR_THUMB_WIDTH } from '../utils/imageThumb';
import { NetworkImage } from '../components/NetworkImage';
import ZoomImageModal from '../components/ZoomImageModal';
import { UserProfileSheet, type UserProfileTarget } from '../components/UserProfileSheet';
import {
  MEDIA_INFO_KEYS,
  MEDIA_URL_KEYS,
  deepFindImageUrl,
  normalizePrivateMediaUrl,
  resolvePrivateAvatar,
} from '../utils/mediaUrl';
import type {
  MemberSummary,
  PrivateConversationWire,
  PrivateMessageWire,
  WireRecord,
} from '../types';

type FlipPriceRow = {
  answerType?: number;
  privateCost?: number | string;
  questionType?: number;
  price?: number;
  [key: string]: unknown;
};

function convTargetId(conv: PrivateConversationWire | null | undefined): string {
  return String(conv?.targetUserId || conv?.user?.userId || conv?.userId || '');
}
function convName(conv: PrivateConversationWire): string {
  return pickText(
    conv,
    [
      'user.nickname',
      'user.nickName',
      'user.starName',
      'user.realNickName',
      'nickname',
      'starName',
    ],
    convTargetId(conv) || translate('私信'),
  );
}

function peerAvatarUrl(
  conv: PrivateConversationWire | null,
  member?: MemberSummary | null,
  message?: PrivateMessageWire | null,
): string {
  return resolvePrivateAvatar(message?.user, conv, member);
}

function realServerMsgId(msg: PrivateMessageWire): string | null {
  const direct = msg.messageId || msg.msgId || msg.id || msg.clientMsgId || msg.uuid;
  return direct ? String(direct) : null;
}

function msgId(msg: PrivateMessageWire): string {
  const direct = msg.messageId || msg.msgId || msg.id || msg.clientMsgId || msg.uuid;
  if (direct) return String(direct);

  const time = msgTimeNumber(msg);
  const from = msgFromId(msg);
  const body = messageText(msg);
  return String(`${time}-${from}-${body || JSON.stringify(msg).slice(0, 80)}`);
}
function msgTimeNumber(msg: PrivateMessageWire): number {
  const v = Number(
    msg.timestamp || msg.msgTime || msg.ctime || msg.time || msg.createTime || msg.sendTime || 0,
  );
  return Number.isFinite(v) ? v : 0;
}
function msgFromId(msg: PrivateMessageWire): string {
  return String(
    msg.user?.userId ||
      msg.user?.id ||
      msg.fromUserId ||
      msg.senderUserId ||
      msg.senderId ||
      msg.userId ||
      msg.fromAccount ||
      '',
  );
}
function msgToId(msg: PrivateMessageWire): string {
  return String(msg.toUserId || msg.targetUserId || msg.receiverUserId || msg.receiveUserId || '');
}
function isMineMessage(msg: PrivateMessageWire, targetId: string, currentUserId = ''): boolean {
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

function privateMessageText(msg: PrivateMessageWire): string {
  const payload = messagePayload(msg);
  const text =
    messageText(msg) ||
    pickText(msg, ['content.text', 'text', 'message', 'msg']) ||
    pickText(payload, ['text', 'content', 'message.text', 'msg.text']) ||
    '';

  const flipKeys = [
    'flipCardInfo',
    'filpCardInfo',
    'flipCardAudioInfo',
    'filpCardAudioInfo',
    'flipCardVideoInfo',
    'filpCardVideoInfo',
  ];
  for (const key of flipKeys) {
    const fi = payload?.[key] || msg?.[key] || msg?.content?.[key];
    if (fi) {
      const parsed = typeof fi === 'string' ? parseMaybeJson(fi) : fi;
      if (parsed) {
        const q = parsed.question || parsed.answerQuestion || '';
        const a = typeof parsed.answer === 'string' ? parseMaybeJson(parsed.answer) : parsed.answer;
        const answerText =
          a && typeof a === 'object'
            ? a.text || a.content || ''
            : typeof parsed.answer === 'string'
              ? parsed.answer
              : '';
        if (q && answerText) return translate('问：{q}\n答：{answer}', { q, answer: answerText });
        if (q) return translate('问：{q}', { q });
        if (answerText) return translate('答：{answer}', { answer: answerText });
        if (a && typeof a === 'object') {
          const au = pickText(a, ['url', 'mediaUrl', 'audioUrl', 'videoUrl', 'voiceUrl', 'mp4Url']);
          if (au) {
            const at = answerTypeFromContext(msg) || answerTypeFromContext(parsed);
            if (at === 2 || looksLikeAudioUrl(au))
              return q ? translate('问：{q}\n答：[语音消息]', { q }) : translate('[语音消息]');
            if (at === 3 || looksLikeVideoUrl(au))
              return q ? translate('问：{q}\n答：[视频消息]', { q }) : translate('[视频消息]');
            if (looksLikeImageUrl(au))
              return q ? translate('问：{q}\n答：[图片消息]', { q }) : translate('[图片消息]');
          }
        }
      }
    }
  }

  const answerRaw =
    payload?.answer || payload?.answerContent || msg?.answer || msg?.answerContent || '';
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
        if (looksLikeAudioUrl(url) || answerTypeFromContext(msg) === 2)
          return translate('[语音消息]');
        if (looksLikeVideoUrl(url) || answerTypeFromContext(msg) === 3)
          return translate('[视频消息]');
        if (looksLikeImageUrl(url)) return translate('[图片消息]');
      }
    }
    const p = payload && typeof payload === 'object' ? payload : {};
    const url = pickText(p, ['url', 'mediaUrl', 'audioUrl', 'videoUrl']);
    if (url) {
      const type = messageTypeOf(msg, p, msg?.content);
      if (type.includes('AUDIO') || looksLikeAudioUrl(url)) return translate('[语音消息]');
      if (type.includes('VIDEO') || looksLikeVideoUrl(url)) return translate('[视频消息]');
      if (type.includes('IMAGE') || looksLikeImageUrl(url)) return translate('[图片消息]');
    }
  }
  return text || translate('[空消息]');
}

type MediaInfo = {
  url: string;
  type: 'audio' | 'video' | 'image';
  title: string;
  duration?: number;
  width?: number;
  height?: number;
} | null;

type PrivateChatIM = {
  _id: string;
  text: string;
  createdAt: Date;
  user: { _id: string; avatar?: string; name?: string };
  original: PrivateMessageWire;
  groupStart: boolean;
  isMine: boolean;
  image?: string;
  video?: string;
  audio?: string;
  [key: string]: unknown;
};

function looksLikeAudioUrl(url: string): boolean {
  return /\.(mp3|m4a|aac|amr|wav|ogg)(\?|$)/i.test(url.toLowerCase());
}
function looksLikeVideoUrl(url: string): boolean {
  return (
    /\.(mp4|mov|m4v|3gp|webm)(\?|$)/i.test(url.toLowerCase()) ||
    url.includes('.m3u8') ||
    url.includes('.flv')
  );
}
function looksLikeImageUrl(url: string): boolean {
  return /\.(jpe?g|png|webp|gif|bmp)(\?|$)/i.test(url.toLowerCase());
}
function answerTypeFromContext(source: unknown): number {
  const src = source as WireRecord | null | undefined;
  return Number(src?.answerType || src?.answerTypeConfig || src?.type || 0);
}

function messageTypeOf(...sources: unknown[]): string {
  for (const source of sources) {
    if (!source || typeof source !== 'object') continue;
    const record = source as WireRecord;
    const raw = record.messageType || record.msgType || record.contentType || record.type;
    const value = String(raw ?? '')
      .trim()
      .toUpperCase();
    if (value) return value;
  }
  return '';
}

function extractDuration(source: unknown): number {
  const src = source as WireRecord | null | undefined;
  const v = parseDurationSeconds(
    src?.duration ||
      src?.time ||
      src?.second ||
      src?.audioTime ||
      src?.length ||
      src?.playTime ||
      src?.videoTime ||
      0,
  );
  return Number.isFinite(v) && v > 0 ? Math.round(v) : 0;
}

function formatDur(seconds: number): string {
  if (!seconds || seconds <= 0) return '';
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function collectPrivateMessageMediaCandidates(msg: PrivateMessageWire): WireRecord[] {
  const content = msg?.content || {};
  const payload = messagePayload(msg) || {};
  const candidates: WireRecord[] = [];

  const flipKeys = [
    'flipCardInfo',
    'filpCardInfo',
    'flipCardAudioInfo',
    'filpCardAudioInfo',
    'flipCardVideoInfo',
    'filpCardVideoInfo',
  ];

  function pushBody(source: unknown) {
    if (!source || typeof source !== 'object') return;
    const record = source as WireRecord;
    candidates.push(record);
    for (const key of flipKeys) {
      if (record[key]) candidates.push(parseMaybeJson(record[key]));
    }

    for (const key of MEDIA_INFO_KEYS) {
      if (!record[key]) continue;
      const parsed = parseMaybeJson(record[key]);
      candidates.push(parsed && typeof parsed === 'object' ? parsed : record[key]);
    }
    for (const k of ['text', 'messageText', 'body', 'content']) {
      if (typeof record[k] === 'string') {
        const p = parseMaybeJson(record[k]);
        if (p && typeof p === 'object') candidates.push(p);
      }
    }
    if (Array.isArray(record.bodys)) {
      for (const b of record.bodys) {
        const parsed = typeof b === 'string' ? parseMaybeJson(b) : b;
        if (parsed) pushBody(parsed);
      }
    } else if (record.bodys && typeof record.bodys === 'object') {
      pushBody(record.bodys);
    }
    if (record.body && typeof record.body === 'object') pushBody(record.body);
    if (record.content && typeof record.content === 'object') pushBody(record.content);
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

function makeMedia(
  url: string,
  type: 'audio' | 'video' | 'image',
  durSources: unknown[] = [],
): MediaInfo {
  const d = durSources.reduce<number>((best, src) => best || extractDuration(src), 0);
  const titleMap: Record<string, string> = {
    audio: translate('语音消息'),
    video: translate('视频消息'),
    image: translate('图片消息'),
  };
  const size = type === 'image' ? pickImageSize(durSources) : { width: 0, height: 0 };
  return {
    url,
    type,
    title: titleMap[type] || translate('媒体消息'),
    ...(d > 0 ? { duration: d } : {}),
    ...(size.width > 0 && size.height > 0 ? { width: size.width, height: size.height } : {}),
  };
}

function pickImageSize(sources: unknown[]): { width: number; height: number } {
  for (const src of sources) {
    if (!src || typeof src !== 'object') continue;
    const record = src as WireRecord;
    const width = Number(
      record.imgWidth || record.width || record.imageWidth || record.picWidth || 0,
    );
    const height = Number(
      record.imgHeight || record.height || record.imageHeight || record.picHeight || 0,
    );
    if (width > 0 && height > 0) return { width, height };
  }
  return { width: 0, height: 0 };
}

function imageBox(width?: number, height?: number) {
  const w = Number(width) || 0;
  const h = Number(height) || 0;
  if (w <= 0 || h <= 0) return { width: 200, height: 200 };
  const scale = Math.min(200 / w, 260 / h);
  return {
    width: Math.max(96, Math.round(w * scale)),
    height: Math.max(96, Math.round(h * scale)),
  };
}

function privateMessageMedia(msg: PrivateMessageWire): MediaInfo {
  const content = msg?.content || {};
  const payload = messagePayload(msg) || {};
  const p = payload && typeof payload === 'object' ? payload : {};
  const candidates = collectPrivateMessageMediaCandidates(msg);

  for (const item of candidates) {
    let rawUrl = pickText(item, MEDIA_URL_KEYS);
    if (rawUrl) {
      const type = messageTypeOf(item, msg, content, p);
      const answerType =
        answerTypeFromContext(item) || answerTypeFromContext(msg) || answerTypeFromContext(content);
      const imageLike = looksLikeImageUrl(rawUrl) || type.includes('IMAGE') || type.includes('PIC');
      const url = normalizePrivateMediaUrl(rawUrl, imageLike ? 'source' : 'mp4');
      if (
        looksLikeAudioUrl(url) ||
        type.includes('AUDIO') ||
        type.includes('VOICE') ||
        (answerType === 2 && !imageLike)
      )
        return makeMedia(url, 'audio', [item, msg, content]);
      if (looksLikeVideoUrl(url) || type.includes('VIDEO') || (answerType === 3 && !imageLike))
        return makeMedia(url, 'video', [item, msg, content]);
      if (imageLike) return makeMedia(url, 'image', [item, msg, content]);
      return makeMedia(url, 'image', [item, msg, content]);
    }

    const answerRaw = item.answer || item.answerContent || '';
    if (answerRaw) {
      const parsed = typeof answerRaw === 'string' ? parseMaybeJson(answerRaw) : answerRaw;
      if (parsed && typeof parsed === 'object') {
        rawUrl = pickText(parsed, MEDIA_URL_KEYS);
        if (rawUrl) {
          const answerType =
            answerTypeFromContext(item) ||
            answerTypeFromContext(parsed) ||
            answerTypeFromContext(content) ||
            answerTypeFromContext(msg);
          const parsedType = messageTypeOf(parsed, item, msg, content);
          const imageLike =
            looksLikeImageUrl(rawUrl) || parsedType.includes('IMAGE') || parsedType.includes('PIC');
          const url2 = normalizePrivateMediaUrl(rawUrl, imageLike ? 'source' : 'mp4');
          if (
            answerType === 2 ||
            looksLikeAudioUrl(url2) ||
            parsedType.includes('AUDIO') ||
            parsedType.includes('VOICE')
          )
            return makeMedia(url2, 'audio', [parsed, item, msg]);
          if (answerType === 3 || looksLikeVideoUrl(url2) || parsedType.includes('VIDEO'))
            return makeMedia(url2, 'video', [parsed, item, msg]);
          return makeMedia(url2, 'image', [parsed, msg, content]);
        }
      }
    }
  }

  const rawText = String(
    msg?.body || msg?.bodys || msg?.msgContent || msg?.content || msg?.message || '',
  );
  const urlMatch = rawText.match(/https?:\/\/[^\s"'<>]+/i);
  if (urlMatch) {
    const url3 = urlMatch[0];
    if (looksLikeAudioUrl(url3)) return makeMedia(url3, 'audio', [msg]);
    if (looksLikeVideoUrl(url3)) return makeMedia(url3, 'video', [msg]);
    if (looksLikeImageUrl(url3)) return makeMedia(url3, 'image', [msg, content]);
  }

  const directAnswers = [
    payload?.answer,
    payload?.answerContent,
    content?.answer,
    content?.answerContent,
    msg?.answer,
    msg?.answerContent,
  ];
  for (const ans of directAnswers) {
    const pda = typeof ans === 'string' ? parseMaybeJson(ans) : ans;
    if (pda && typeof pda === 'object') {
      const daUrl = pickText(pda, MEDIA_URL_KEYS);
      if (daUrl) {
        const daAt =
          answerTypeFromContext(pda) ||
          answerTypeFromContext(msg) ||
          answerTypeFromContext(content);
        const daNorm = normalizePrivateMediaUrl(daUrl, looksLikeImageUrl(daUrl) ? 'source' : 'mp4');
        if (daAt === 2 || looksLikeAudioUrl(daNorm)) return makeMedia(daNorm, 'audio', [pda, msg]);
        if (daAt === 3 || looksLikeVideoUrl(daNorm)) return makeMedia(daNorm, 'video', [pda, msg]);
        if (looksLikeImageUrl(daNorm)) return makeMedia(daNorm, 'image', [pda]);
        return makeMedia(daNorm, 'image', [pda]);
      }
    }
  }

  const deepImage = deepFindImageUrl(msg) || deepFindImageUrl(content) || deepFindImageUrl(payload);
  if (deepImage)
    return makeMedia(normalizePrivateMediaUrl(deepImage, 'source'), 'image', [
      msg,
      content,
      payload,
    ]);

  return null;
}

function oldestFirst<T>(list: T[], timeOf: (item: T) => number): T[] {
  return list.slice().sort((a, b) => timeOf(a) - timeOf(b));
}

function flipTypeName(value: unknown) {
  const id = Number(value);
  if (id === 1) return translate('文字');
  if (id === 2) return translate('语音');
  if (id === 3) return translate('视频');
  return translate('类型{value}', { value: String(value ?? '') });
}

function buildPrivateIms(
  msgs: PrivateMessageWire[],
  targetId: string,
  uid: string,
  peerName: string,
  peerAvatar: string,
): PrivateChatIM[] {
  const out: PrivateChatIM[] = [];
  let prevMine: boolean | null = null;
  let prevTs = 0;
  let prevDay = '';
  const dayOf = (ts: number) => {
    const d = new Date(ts > 0 && ts < 1e12 ? ts * 1000 : ts);
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  };
  [...msgs]
    .sort((a, b) => {
      const va = msgTimeNumber(a);
      const vb = msgTimeNumber(b);
      const ka = va > 0 && va < 1e12 ? va * 1000 : va;
      const kb = vb > 0 && vb < 1e12 ? vb * 1000 : vb;
      return kb - ka;
    })
    .forEach((item) => {
      const ts = msgTimeNumber(item);
      const mine = isMineMessage(item, targetId, uid);
      const day = dayOf(ts);
      if (day !== prevDay) {
        prevDay = day;
        prevMine = null;
        prevTs = 0;
      }

      const curMs = toMs(ts);
      const prevMs = toMs(prevTs);
      const groupStart =
        prevMine === null || prevMine !== mine || Math.abs(prevMs - curMs) > 3 * 60 * 1000;

      const senderAvatar = peerAvatarUrl(null, null, item) || peerAvatar;

      const media = privateMessageMedia(item);
      out.push({
        _id: `m-${msgId(item)}`,
        text: privateMessageText(item) || '',
        createdAt: new Date(ts > 0 && ts < 1e12 ? ts * 1000 : ts),
        user: {
          _id: mine ? 'SELF' : String(targetId || 'peer'),
          ...(mine ? {} : { avatar: senderAvatar, name: peerName }),
        },
        original: item,
        groupStart,
        isMine: mine,

        ...(media ? { [media.type]: media.url } : {}),
      });
      prevMine = mine;
      prevTs = ts;
    });
  return out;
}

export default function PrivateMessagesScreen() {
  const navigation = useNavigation<StackNavigationProp<RootStackParamList>>();
  const palette = usePalette();
  const { t } = useI18n();
  const members = useMemberStore((s) => s.members);

  const memberById = useMemo(() => {
    const map = new Map<string, MemberSummary>();
    for (const item of members as MemberSummary[]) {
      for (const field of ['id', 'userId', 'memberId']) {
        const key = String(item?.[field] ?? '').trim();
        if (key) map.set(key, item);
      }
    }
    return map;
  }, [members]);
  const showToast = useUiStore((s) => s.showToast);
  const setPmUnread = useUiStore((s) => s.setPmUnread);
  const [convs, setConvs] = useState<PrivateConversationWire[]>([]);
  const convsLoadedOnceRef = useRef(false);
  useEffect(() => {
    if (!convsLoadedOnceRef.current) return;
    const total = sumPrivateConversationUnread(convs);
    if (total !== null) setPmUnread(total);
  }, [convs, setPmUnread]);
  const [hasMoreConvs, setHasMoreConvs] = useState(false);
  const convCursorRef = useRef(0);
  const convLoadingRef = useRef(false);

  const [pinnedConvs, setPinnedConvs] = useState<string[]>([]);
  useEffect(() => {
    AsyncStorage.getItem('yaya_pinned_convs').then((v) => {
      if (v) {
        try {
          setPinnedConvs(JSON.parse(v));
        } catch {
          setPinnedConvs([]);
        }
      }
    });
  }, []);
  const persistPinned = async (next: string[]) => {
    setPinnedConvs(next);
    try {
      await AsyncStorage.setItem('yaya_pinned_convs', JSON.stringify(next));
    } catch (error) {
      showToast(t('置顶保存失败：{msg}', { msg: errorMessage(error) }));
    }
  };
  const togglePinConv = (conv: PrivateConversationWire) => {
    const id = convTargetId(conv);
    if (!id) return;
    const next = pinnedConvs.includes(id)
      ? pinnedConvs.filter((x) => x !== id)
      : [...pinnedConvs, id];
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

  const { todayStr, yesterdayStr } = (() => {
    const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
    const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const now = Date.now();
    return {
      todayStr: fmt(new Date(now)),
      yesterdayStr: fmt(new Date(now - 86400000)),
    };
  })();
  const convRows = useMemo(() => {
    const groups: { key: string; title: string; items: PrivateConversationWire[] }[] = [
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
      return key === yesterdayStr ? 'yesterday' : 'more';
    };
    const pinnedSet = new Set(pinnedConvs);
    const pinnedItems: PrivateConversationWire[] = [];
    const rest: PrivateConversationWire[] = [];
    for (const c of convs) {
      const target = convTargetId(c);
      if (target && pinnedSet.has(target)) pinnedItems.push(c);
      else rest.push(c);
    }

    const pinnedOrdered = pinnedItems
      .slice()
      .sort((a, b) => pinnedConvs.indexOf(convTargetId(a)) - pinnedConvs.indexOf(convTargetId(b)));
    const flat: {
      type: 'header' | 'item';
      key: string;
      title?: string;
      item?: PrivateConversationWire;
    }[] = [];
    if (pinnedOrdered.length) {
      flat.push({ type: 'header', key: 'h-pinned', title: t('置顶') });
      pinnedOrdered.forEach((it, i) =>
        flat.push({ type: 'item', key: `i-pinned-${String(convTargetId(it) || i)}`, item: it }),
      );
    }
    for (const c of rest) {
      groups[idxOf[groupOf(Number(c.lastTime || c.msgTime || 0))]].items.push(c);
    }
    groups.forEach((g) => {
      if (!g.items.length) return;
      flat.push({ type: 'header', key: `h-${g.key}`, title: g.title });
      g.items.forEach((it, i) =>
        flat.push({ type: 'item', key: `i-${g.key}-${String(convTargetId(it) || i)}`, item: it }),
      );
    });
    return flat;
  }, [convs, todayStr, yesterdayStr, t, pinnedConvs]);
  const [sel, setSel] = useState<PrivateConversationWire | null>(null);

  const keyboardHeight = useKeyboardHeight();
  const insets = useSafeAreaInsets();

  const inputBarSafeBottom = Math.max(10, Math.min(insets.bottom, 24));
  const [msgs, setMsgs] = useState<PrivateMessageWire[]>([]);
  const [text, setText] = useState('');
  const [uid, setUid] = useState('');
  const token = useSettingsStore((s) => s.settings.p48Token);

  useEffect(() => {
    setUid('');
  }, [token]);
  const [prices, setPrices] = useState<FlipPriceRow[]>([]);
  const [money, setMoney] = useState('');
  const [flipType, setFlipType] = useState(0);
  const [loading, setLoading] = useState(false);

  const [convLoading, setConvLoading] = useState(false);
  const [convError, setConvError] = useState('');
  const flatRef = useRef<FlatList>(null);
  const [playUrl, setPlayUrl] = useState('');

  const [zoomUrl, setZoomUrl] = useState('');

  const [profileTarget, setProfileTarget] = useState<UserProfileTarget | null>(null);
  const requestIdRef = useRef(0);

  const convRequestIdRef = useRef(0);

  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
    },
    [],
  );

  const selTargetId = String(sel ? convTargetId(sel) : '').trim();
  const member = useMemo(() => {
    if (!selTargetId) return null;
    return (
      members.find((m) =>
        [m?.id, m?.userId, m?.memberId].some((v) => {
          const s = String(v ?? '').trim();
          return !!s && s === selTargetId;
        }),
      ) || null
    );
  }, [members, selTargetId]);

  const loadConvsRef = useRef<(initial?: boolean) => Promise<void>>(() => Promise.resolve());
  useEffect(() => {
    void loadConvsRef.current();
  }, []);

  useEffect(() => {
    if (!member) {
      setPrices([]);
      setMoney('');
      return;
    }
    let a = true;
    (async () => {
      try {
        const [pr, mr] = await Promise.all([
          pocketApi.getFlipPrices(String(member.id)),
          pocketApi.getUserMoney().catch(() => null),
        ]);
        if (!a) return;
        const list = unwrapList(pr, [
          'content.customs',
          'content.list',
          'data.customs',
          'customs',
          'list',
        ]);
        setPrices(list || []);
        setMoney(
          pickText(mr, [
            'content.moneyTotal',
            'content.total',
            'content.money',
            'content.balance',
            'data.moneyTotal',
            'data.money',
            'money',
            'balance',
          ]) || '',
        );
      } catch {
        if (a) setPrices([]);
      }
    })();
    return () => {
      a = false;
    };
  }, [member]);

  const loadConvs = async (initial = true) => {
    if (convLoadingRef.current) return;
    const requestId = ++requestIdRef.current;
    convLoadingRef.current = true;
    if (initial) setConvLoading(true);
    setConvError('');
    try {
      let cursor = initial ? Date.now() : convCursorRef.current || Date.now();
      let all: PrivateConversationWire[] = [];
      let loops = 0;
      const maxLoops = initial ? 5 : 10;
      while (loops < maxLoops) {
        const res = await pocketApi.getPrivateMessageList(cursor);
        if (requestId !== requestIdRef.current) return;
        const list = unwrapList(res, [
          'content.userMessageList',
          'content.list',
          'content.data',
          'data.userMessageList',
          'userMessageList',
          'list',
        ]);
        const incoming = Array.isArray(list) ? list : [];
        all = all.concat(
          incoming.filter(
            (it: PrivateConversationWire) =>
              !all.find(
                (a: PrivateConversationWire) =>
                  (convTargetId(a) || a.userMessageId) === (convTargetId(it) || it.userMessageId),
              ),
          ),
        );
        const nextCursor = Number(res?.content?.lastTime || res?.data?.lastTime || 0);
        if (!nextCursor || !incoming.length) break;
        cursor = nextCursor;
        loops += 1;
      }
      convCursorRef.current = cursor;
      convsLoadedOnceRef.current = true;
      setConvs((prev) => {
        const merged = initial ? all : [...prev, ...all];
        const seen = new Set<string>();
        return merged
          .filter((it) => {
            const key = convTargetId(it) || String(it.userMessageId ?? '');
            if (!key || seen.has(key)) return false;
            seen.add(key);
            return true;
          })
          .sort(
            (a, b) => Number(b.lastTime || b.msgTime || 0) - Number(a.lastTime || a.msgTime || 0),
          );
      });

      setHasMoreConvs(loops >= maxLoops && cursor > 0);
    } catch (e) {
      setConvError(errorMessage(e));
      showToast(t('加载失败：{msg}', { msg: errorMessage(e) }));
    } finally {
      if (requestId === requestIdRef.current) {
        convLoadingRef.current = false;
        setConvLoading(false);
      }
    }
  };
  loadConvsRef.current = loadConvs;

  const openConv = async (c: PrivateConversationWire, opts?: { silent?: boolean }) => {
    const silent = opts?.silent === true;
    const requestId = ++convRequestIdRef.current;
    setSel(c);
    if (!silent) {
      setMsgs([]);
      setFlipType(0);
      setPlayUrl('');
      setLoading(true);
      if (scrollTimerRef.current) {
        clearTimeout(scrollTimerRef.current);
        scrollTimerRef.current = null;
      }
    }
    try {
      if (!uid) {
        const info = await pocketApi.getNimLoginInfo().catch(() => null);
        const id = pickText(info, ['content.userInfo.userId', 'content.userId', 'id', 'userId']);
        if (id && requestId === convRequestIdRef.current) setUid(String(id));
      }
      const res = await pocketApi.getPrivateMessageDetail(convTargetId(c));
      if (requestId !== convRequestIdRef.current) return;
      const list = unwrapList(res, [
        'content.messageList',
        'content.messages',
        'content.list',
        'messageList',
        'list',
      ]);
      const targetId = convTargetId(c);
      setConvs((prev) =>
        prev.map((item) => (convTargetId(item) === targetId ? { ...item, noreadNum: 0 } : item)),
      );
      const sorted = oldestFirst(list, msgTimeNumber);
      setMsgs(sorted);
      scrollTimerRef.current = setTimeout(
        () => flatRef.current?.scrollToEnd?.({ animated: false }),
        150,
      );
    } catch (e) {
      if (requestId !== convRequestIdRef.current) return;
      showToast(t('加载失败：{msg}', { msg: errorMessage(e) }));
    } finally {
      if (requestId === convRequestIdRef.current) setLoading(false);
    }
  };

  const closeConv = useCallback(() => {
    ++convRequestIdRef.current;
    setSel(null);
    setLoading(false);
    void loadConvsRef.current();
  }, []);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!navigation.isFocused()) return false;
      if (sel) {
        closeConv();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [navigation, sel, closeConv]);

  const route = useRoute<RouteProp<RootStackParamList, 'PrivateMessagesScreen'>>();
  const initialRouteTargetRef = useRef('');
  const routeTargetId = String(route?.params?.targetUserId || '').trim();
  const routeTargetName = String(route?.params?.targetName || '');
  useEffect(() => {
    if (!routeTargetId || initialRouteTargetRef.current === routeTargetId) return;
    initialRouteTargetRef.current = routeTargetId;
    void openConv({
      targetUserId: routeTargetId,
      user: { userId: routeTargetId, nickname: routeTargetName },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeTargetId]);

  const pickAndSendImage = async () => {
    if (!sel) return;
    const selectedConv = sel;
    const requestId = convRequestIdRef.current;

    if (member) {
      showToast(t('成员私信不支持发送图片'));
      return;
    }
    if (flipType > 0) {
      showToast(t('翻牌模式不能发送图片'));
      return;
    }
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        showToast(t('需要相册权限才能发图片'));
        return;
      }
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
      if (Number(asset.fileSize || 0) > 20 * 1024 * 1024) {
        showToast(t('图片不能超过 20MB'));
        return;
      }
      const targetId = convTargetId(selectedConv);
      if (!targetId) return;
      setLoading(true);
      const uploaded: WireRecord = await pocketApi.uploadPocketImage({
        uri: asset.uri,
        fileName: asset.fileName || `private-message-${Date.now()}.jpg`,
        mimeType: mime,
      });
      const uploadedItem: WireRecord = uploaded?.content || {};

      const pickerW = Number(asset.width || 0) || 0;
      const pickerH = Number(asset.height || 0) || 0;
      const localSize =
        pickerW > 0 && pickerH > 0
          ? { width: pickerW, height: pickerH }
          : await new Promise<{ width: number; height: number }>((resolve) => {
              Image.getSize(
                asset.uri,
                (width, height) => resolve({ width, height }),
                () => resolve({ width: 0, height: 0 }),
              );
            });
      await pocketApi.sendPrivateImageMessage(targetId, {
        imgUrl: uploaded.path,
        imgWidth: Number(uploadedItem.width) || localSize.width || 0,
        imgHeight: Number(uploadedItem.height) || localSize.height || 0,
        imgSize: Number(uploadedItem.size) || Number(asset.fileSize || 0) || 0,
      });
      if (requestId !== convRequestIdRef.current) return;
      showToast(t('已发送'));
      await openConv(selectedConv, { silent: true });
    } catch (e) {
      if (requestId === convRequestIdRef.current)
        showToast(t('发送图片失败：{msg}', { msg: errorMessage(e) }));
    } finally {
      if (requestId === convRequestIdRef.current) setLoading(false);
    }
  };

  const confirmDeletePrivateMessage = useCallback(
    (item: PrivateMessageWire) => {
      const realId = realServerMsgId(item);
      if (!realId) {
        showToast(t('该消息缺少服务器标识，不支持删除'));
        return;
      }
      const localId = msgId(item);
      showDialog(t('删除消息'), t('删除这条私信？'), [
        { text: t('取消'), style: 'cancel' },
        {
          text: t('删除'),
          style: 'destructive',
          onPress: () => {
            void pocketApi
              .deletePrivateMessage(realId)
              .then(() => {
                setMsgs((prev) => prev.filter((m) => msgId(m) !== localId));
                showToast(t('已删除'));
              })
              .catch((e) => showToast(t('删除失败：{msg}', { msg: errorMessage(e) })));
          },
        },
      ]);
    },
    [showToast, t],
  );

  const doSend = async (override?: string) => {
    const txt = String(override ?? text).trim();
    if (!txt || !sel) return;
    const selectedConv = sel;
    const requestId = convRequestIdRef.current;
    setLoading(true);
    try {
      if (flipType && member) {
        const p = prices.find((x) => x.answerType === flipType);
        const cost = p ? Number(p.privateCost) || 0 : 0;
        if (!p || cost <= 0) {
          showToast(t('该类型私密翻牌未开放，请换一种类型'));
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
        if (!override) setText('');
      } else {
        await pocketApi.sendPrivateMessageReply(convTargetId(selectedConv), txt);
        if (!override) setText('');
        if (requestId !== convRequestIdRef.current) return;
        showToast(t('已发送'));
        await openConv(selectedConv, { silent: true });
      }
      if (requestId !== convRequestIdRef.current) return;
      if (!override) setText('');
    } catch (e) {
      if (requestId === convRequestIdRef.current)
        showToast(t('发送失败：{msg}', { msg: errorMessage(e) }));
    } finally {
      if (requestId === convRequestIdRef.current) setLoading(false);
    }
  };

  const dmIms = useMemo(
    () =>
      sel
        ? buildPrivateIms(msgs, convTargetId(sel), uid, convName(sel), peerAvatarUrl(sel, member))
        : [],
    [msgs, sel, uid, member],
  );

  const dmTargetId = sel ? convTargetId(sel) : '';
  const dmPeerName = sel ? convName(sel) : '';
  const dmPeerAvatar = sel ? peerAvatarUrl(sel, member) : '';
  const openPeerProfile = useCallback(() => {
    if (!dmTargetId) return;
    setProfileTarget({ userId: dmTargetId, nick: dmPeerName, avatar: dmPeerAvatar });
  }, [dmTargetId, dmPeerName, dmPeerAvatar]);

  const renderPeerAvatar = useCallback(
    (props?: { currentMessage?: { original?: PrivateMessageWire } }) => {
      const url = peerAvatarUrl(sel, member, props?.currentMessage?.original) || dmPeerAvatar;
      const initial = dmPeerName.trim().slice(0, 1).toUpperCase();
      if (!url) {
        return (
          <ScalePressable
            style={[styles.msgAvatar, { backgroundColor: palette.tintSoft }]}
            onPress={openPeerProfile}
            accessibilityLabel={t('查看资料')}
          >
            <Text style={[styles.msgAvatarText, { color: palette.tint }]}>{initial}</Text>
          </ScalePressable>
        );
      }
      return (
        <ScalePressable onPress={openPeerProfile} accessibilityLabel={t('查看资料')}>
          <NetworkImage
            source={{ uri: url }}
            style={styles.msgAvatar}
            resizeMode="cover"
            thumbnail={160}
            fallbackIcon="account-outline"
          />
        </ScalePressable>
      );
    },
    [sel, member, dmPeerAvatar, dmPeerName, openPeerProfile, palette, t],
  );

  const renderDayLabel = useCallback(
    ({
      createdAt,
      date,
    }: {
      createdAt?: Date | number | string;
      date?: Date | number | string;
    }) => {
      const input = createdAt ?? date;
      const d = input instanceof Date ? input : new Date(input ?? 0);
      if (Number.isNaN(d.getTime())) return null;
      const p2 = (n: number) => (n < 10 ? `0${n}` : String(n));
      const label = `${d.getFullYear()}/${p2(d.getMonth() + 1)}/${p2(d.getDate())}`;

      return (
        <Text style={[styles.dateSepText, { color: palette.labelSecondary, alignSelf: 'center' }]}>
          {label}
        </Text>
      );
    },
    [palette],
  );

  const renderEllipseGlassBubble = useCallback(
    ({
      currentMessage,
      position,
    }: {
      currentMessage: {
        original?: PrivateMessageWire;
        text?: string;
        createdAt?: Date | number | string;
      };
      position?: 'left' | 'right';
    }) => {
      const msg = currentMessage;
      const item = msg?.original;
      const mine = position === 'right';
      const t0 = msg?.createdAt instanceof Date ? msg.createdAt : new Date(msg?.createdAt ?? 0);
      const hh = Number.isNaN(t0.getTime())
        ? ''
        : `${String(t0.getHours()).padStart(2, '0')}:${String(t0.getMinutes()).padStart(2, '0')}`;

      const media = item ? privateMessageMedia(item) : null;
      const hasText =
        !!msg.text &&
        !/^\[(语音|视频|图片|媒体|链接)消息\]$/.test(String(msg.text)) &&
        msg.text !== '[空消息]';
      const mediaLabel = media
        ? formatDur(media.duration || 0) || (media.type === 'audio' ? t('语音') : t('视频'))
        : '';
      return (
        <GlassSurface
          role="chip"
          radius={22}
          tintColor={mine ? palette.tint : undefined}
          onLongPress={mine && item ? () => confirmDeletePrivateMessage(item) : undefined}
          style={styles.ellipseBubble}
        >
          {hasText ? (
            <Text style={[styles.ellipseText, { color: mine ? palette.onTint : palette.label }]}>
              {msg.text}
            </Text>
          ) : null}
          {media ? (
            media.type === 'image' ? (
              <ScalePressable onPress={() => setZoomUrl(media.url)} accessibilityLabel={t('图片')}>
                <NetworkImage
                  source={{ uri: media.url }}
                  style={[
                    styles.inlineImg,
                    imageBox(media.width, media.height),
                    { backgroundColor: palette.fill2 },
                  ]}
                  resizeMode="cover"
                  thumbnail={400}
                  fallbackIcon="image-off-outline"
                />
              </ScalePressable>
            ) : (
              <ScalePressable
                style={[
                  styles.mediaBtn,
                  { backgroundColor: mine ? palette.tintSoft : palette.fill2 },
                ]}
                onPress={() => setPlayUrl((p) => (p === media.url ? '' : media.url))}
              >
                <Text
                  style={[
                    styles.mediaBtnText,
                    mine && { color: palette.onTint },
                    !mine && { color: palette.tint },
                  ]}
                >
                  {playUrl === media.url ? t('收起') : mediaLabel}
                </Text>
                {playUrl !== media.url ? (
                  <MaterialCommunityIcons
                    name="play"
                    size={14}
                    color={mine ? palette.onTint : palette.tint}
                    style={{ marginLeft: 4 }}
                  />
                ) : null}
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
            <Text
              style={[
                styles.ellipseTime,
                { color: mine ? 'rgba(255,255,255,0.85)' : palette.labelSecondary },
              ]}
            >
              {hh}
            </Text>
          ) : null}
        </GlassSurface>
      );
    },
    [palette, t, playUrl, confirmDeletePrivateMessage],
  );

  if (sel) {
    const peerName = dmPeerName;
    const peerAvatar = dmPeerAvatar;
    const ims = dmIms;

    return (
      <View style={styles.screenContainer}>
        <View
          style={[
            styles.screen,
            {
              backgroundColor: getPageBackground(),
              paddingBottom: keyboardHeight > 0 ? keyboardHeight + 6 : inputBarSafeBottom,
            },
          ]}
        >
          <ScreenHeader
            title={peerName}
            onBack={closeConv}
            leading={
              <ScalePressable onPress={openPeerProfile} accessibilityLabel={t('查看资料')}>
                {peerAvatar ? (
                  <NetworkImage
                    source={{ uri: peerAvatar }}
                    style={styles.headerAvatar}
                    resizeMode="cover"
                    thumbnail={120}
                    fallbackIcon="account-outline"
                  />
                ) : (
                  <View
                    style={[
                      styles.headerAvatar,
                      styles.headerAvatarFallback,
                      { backgroundColor: palette.tintSoft },
                    ]}
                  >
                    <Text style={[styles.headerAvatarText, { color: palette.tint }]}>
                      {peerName.trim().slice(0, 1).toUpperCase()}
                    </Text>
                  </View>
                )}
              </ScalePressable>
            }
          />

          <View style={{ flex: 1 }}>
            <Chat
              messages={ims}

              theme={DM_CHAT_THEME as any}
              locale="zh"
              renderBubble={renderEllipseGlassBubble}

              renderAvatar={renderPeerAvatar}

              isScrollToBottomEnabled
              scrollToBottomOffset={80}

              renderDay={renderDayLabel}
              isDayAnimationEnabled={false}
              user={DM_CHAT_USER as any}
              onSend={(msgs) => {
                const outgoing = String(msgs?.[0]?.text ?? '').trim();
                if (outgoing) void doSend(outgoing);
              }}
              renderInputToolbar={DM_NO_INPUT_TOOLBAR}

              listProps={{ keyboardDismissMode: 'on-drag', keyboardShouldPersistTaps: 'handled' }}
            />
          </View>
          {member ? (
            <GlassSurface
              radius={22}
              role="card"
              style={[
                styles.flipBar,
                { backgroundColor: 'transparent', borderTopColor: palette.hairline },
              ]}
            >
              <Text style={[styles.flipName, { color: palette.labelSecondary }]}>
                {t('{name} 翻牌', { name: member.ownerName || '' })}
              </Text>
              <View style={styles.flipRow}>
                {prices.slice(0, 3).map((p) => (
                  <ScalePressable
                    key={p.answerType}
                    disabled={Number(p.privateCost) <= 0}
                    style={[
                      styles.flipChip,
                      flipType === p.answerType
                        ? { backgroundColor: palette.tint }
                        : {
                            backgroundColor:
                              Number(p.privateCost) > 0 ? palette.fill2 : palette.fill3,
                          },
                    ]}
                    onPress={() =>
                      setFlipType((v) => (v === p.answerType ? 0 : (p.answerType ?? 0)))
                    }
                  >
                    <Text
                      style={[
                        styles.flipChipT,
                        flipType === p.answerType
                          ? { color: palette.onTint }
                          : { color: palette.labelSecondary },
                      ]}
                    >
                      {flipTypeName(p.answerType)}·
                      {Number(p.privateCost) > 0 ? Number(p.privateCost) : t('未开放')}
                    </Text>
                  </ScalePressable>
                ))}
                <View style={styles.flipSpacer} />
                {money ? (
                  <Text style={[styles.flipMoney, { color: palette.tint }]}>
                    {t('余额 {money}', { money })}
                  </Text>
                ) : null}
                <ScalePressable
                  style={[styles.flipRechargeBtn, { backgroundColor: palette.tint }]}
                  onPress={() => navigation.navigate('RechargeScreen')}
                >
                  <Text style={[styles.flipRechargeT, { color: palette.onTint }]}>{t('充值')}</Text>
                </ScalePressable>
              </View>
            </GlassSurface>
          ) : null}
          <GlassSurface
            radius={22}
            role="card"
            style={[
              styles.inputBar,
              { backgroundColor: 'transparent', borderTopColor: palette.hairline },
            ]}
          >
            {flipType > 0 ? (
              <Text style={[styles.flipLabel, { color: palette.tint }]}>
                {t('私密翻牌·{type}', { type: flipTypeName(flipType) })}
              </Text>
            ) : null}
            <View style={styles.inputRow}>
              {member ? null : (
                <ScalePressable
                  style={[styles.imgPickerBtn, { backgroundColor: palette.fill2 }]}
                  onPress={() => {
                    void pickAndSendImage();
                  }}
                  disabled={loading || flipType > 0}
                  accessibilityLabel={t('图片')}
                >
                  <MaterialCommunityIcons
                    name="image-plus"
                    size={19}
                    color={flipType > 0 ? palette.labelTertiary : palette.tint}
                  />
                </ScalePressable>
              )}
              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor: palette.surfaceGlassStrong,
                    borderColor: palette.innerStroke,
                    color: palette.label,
                  },
                ]}
                placeholder={t('输入内容...')}
                placeholderTextColor={palette.labelTertiary}
                value={text}
                onChangeText={setText}
                multiline
              />
              <ScalePressable
                style={[
                  styles.sendBtn,
                  { backgroundColor: loading || !text.trim() ? palette.fill3 : palette.tint },
                ]}
                onPress={() => {
                  void doSend();
                }}
                disabled={loading || !text.trim()}
              >
                <Text
                  style={[
                    styles.sendT,
                    { color: loading || !text.trim() ? palette.labelTertiary : palette.onTint },
                  ]}
                >
                  {loading ? t('发送中') : flipType ? t('翻牌') : t('发送')}
                </Text>
              </ScalePressable>
            </View>
          </GlassSurface>
        </View>

        {zoomUrl ? <ZoomImageModal url={zoomUrl} onClose={() => setZoomUrl('')} /> : null}

        <UserProfileSheet
          visible={!!profileTarget}
          target={profileTarget}
          onClose={() => setProfileTarget(null)}

          onOpenChat={() => setProfileTarget(null)}
        />
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: getPageBackground() }]}>
      <ScreenHeader
        title={t('私信列表')}
        right={<HeaderAction label={t('刷新')} onPress={() => loadConvs(true)} />}
      />
      <FadeInView delay={80} duration={300} style={{ flex: 1 }}>
        <PerfFlatList
          data={convRows}

          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"

          maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
          keyExtractor={(item) => item.key}
          initialNumToRender={12}
          maxToRenderPerBatch={12}
          windowSize={7}
          contentContainerStyle={styles.convList}
          renderItem={({ item }) => {
            if (item.type === 'header') {
              return (
                <Text style={[styles.groupTitle, { color: palette.labelTertiary }]}>
                  {item.title}
                </Text>
              );
            }
            const conv = item.item;
            if (!conv) return null;
            const name = convName(conv);
            const unread = Number(conv.noreadNum);
            const latestTime = Number(conv.lastTime || conv.msgTime || 0);
            const isPinned = pinnedConvs.includes(convTargetId(conv));

            const convTarget = String(convTargetId(conv));
            const convMember = memberById.get(convTarget);
            const convAvatarUrl = peerAvatarUrl(conv, convMember);
            return (
              <View style={styles.convRowWrap}>
                <TouchableOpacity
                  style={{ flex: 1 }}
                  onPress={() => openConv(conv)}
                  activeOpacity={0.88}
                >
                  <GlassSurface
                    radius={radii.lg}
                    role="card"
                    frostedOnly
                    style={[
                      styles.convCard,
                      {
                        backgroundColor: 'transparent',
                        borderColor: isPinned ? palette.tint : palette.innerStroke,
                        borderWidth: StyleSheet.hairlineWidth,
                      },
                    ]}
                  >
                    <View style={styles.convCardRow}>
                      <ScalePressable
                        style={[styles.convAvatar, { backgroundColor: palette.tintSoft }]}
                        onPress={() =>
                          setProfileTarget({
                            userId: convTarget,
                            nick: name,
                            avatar: convAvatarUrl,
                          })
                        }
                        accessibilityLabel={t('头像')}
                      >
                        {convAvatarUrl ? (
                          <NetworkImage
                            source={{ uri: convAvatarUrl }}
                            style={styles.convAvatarImg}
                            resizeMode="cover"
                            thumbnail={AVATAR_THUMB_WIDTH}
                            fallbackIcon="account-outline"
                          />
                        ) : (
                          <Text style={[styles.convAvatarText, { color: palette.tint }]}>
                            {name.trim().slice(0, 1).toUpperCase()}
                          </Text>
                        )}
                      </ScalePressable>
                      <View style={styles.convInfo}>
                        <View style={styles.convTitleRow}>
                          <Text
                            style={[styles.convName, { color: palette.label }]}
                            numberOfLines={1}
                          >
                            {name}
                          </Text>
                          {latestTime ? (
                            <Text
                              style={[styles.convTime, { color: palette.labelTertiary }]}
                              numberOfLines={1}
                            >
                              {formatTimestamp(latestTime).slice(5, 16)}
                            </Text>
                          ) : null}
                        </View>
                        <View style={styles.convMetaRow}>
                          <Text
                            style={[styles.convPrev, { color: palette.labelSecondary }]}
                            numberOfLines={1}
                          >
                            {conv.newestMessage || t('点击查看')}
                          </Text>
                          {unread > 0 ? (
                            <View style={[styles.badge, { backgroundColor: palette.tint }]}>
                              <Text style={styles.badgeT}>{unread > 99 ? '99+' : unread}</Text>
                            </View>
                          ) : (
                            <MaterialCommunityIcons
                              name="chevron-right"
                              size={20}
                              color={palette.labelTertiary}
                            />
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
                        <MaterialCommunityIcons
                          name="chevron-up"
                          size={13}
                          color={palette.labelSecondary}
                        />
                      </ScalePressable>
                      <ScalePressable
                        style={[styles.pinMoveBtn, { backgroundColor: palette.fill2 }]}
                        onPress={() => movePinConv(convTargetId(conv), 1)}
                        pressedScale={0.85}
                        hitSlop={{ top: 2, bottom: 4, left: 4, right: 4 }}
                        disabled={
                          pinnedConvs.indexOf(convTargetId(conv)) === pinnedConvs.length - 1
                        }
                      >
                        <MaterialCommunityIcons
                          name="chevron-down"
                          size={13}
                          color={palette.labelSecondary}
                        />
                      </ScalePressable>
                    </View>
                  ) : null}
                  <ScalePressable
                    style={[
                      styles.convPinBtn,
                      { backgroundColor: isPinned ? palette.tintSoft : palette.fill2 },
                    ]}
                    onPress={() => togglePinConv(conv)}
                    pressedScale={0.9}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    accessibilityLabel={isPinned ? t('取消置顶') : t('置顶')}
                  >
                    <MaterialCommunityIcons
                      name={isPinned ? 'pin' : 'pin-outline'}
                      size={15}
                      color={isPinned ? palette.tint : palette.labelTertiary}
                    />
                  </ScalePressable>
                </View>
              </View>
            );
          }}
          ListEmptyComponent={
            convLoading ? (
              <CenterSpinner text={t('正在加载会话…')} />
            ) : convError ? (
              <ErrorState title={t('加载失败')} hint={convError} onAction={() => loadConvs()} />
            ) : (
              <EmptyState icon="message-outline" title={t('暂无私信')} />
            )
          }
          onEndReached={() => {
            if (hasMoreConvs) loadConvs(false);
          }}
          onEndReachedThreshold={0.4}
          ListFooterComponent={hasMoreConvs ? <CenterSpinner text={t('加载更多会话…')} /> : null}
        />
      </FadeInView>

      <UserProfileSheet
        visible={!!profileTarget}
        target={profileTarget}
        onClose={() => setProfileTarget(null)}
        onOpenChat={({ id }) => {
          setProfileTarget(null);
          const conv = convs.find((c) => convTargetId(c) === String(id));
          if (conv) openConv(conv);
        }}
      />
    </View>
  );
}

const DM_CHAT_THEME = { colors: { background: 'transparent' } } as const;
const DM_CHAT_USER = { _id: 'SELF' } as const;
const DM_NO_INPUT_TOOLBAR = () => null;

const styles = StyleSheet.create({
  screen: { flex: 1 },
  screenContainer: { flex: 1 },
  convList: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 16 },
  groupTitle: {
    fontSize: 13,
    fontFamily: fontFamily.system,
    fontWeight: '800',
    marginTop: 12,
    marginBottom: 2,
    paddingLeft: 4,
  },
  convCard: { marginVertical: 4, flex: 1 },

  convCardRow: { padding: 12, flexDirection: 'row', alignItems: 'center' },
  convRowWrap: { flexDirection: 'row', alignItems: 'center' },
  convActions: { marginLeft: 8, gap: 8, alignItems: 'center' },
  convPinBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinMoveCol: { gap: 2, alignItems: 'center' },
  pinMoveBtn: {
    width: 22,
    height: 18,
    borderRadius: 8,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  convAvatar: {
    width: 44,
    height: 44,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  convAvatarImg: { width: 44, height: 44, borderRadius: 999 },
  convAvatarText: { fontSize: 17, fontFamily: fontFamily.system, fontWeight: '800' },

  msgAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  msgAvatarText: { fontSize: 15, fontFamily: fontFamily.system, fontWeight: '800' },
  headerAvatar: { width: 34, height: 34, borderRadius: 17 },
  headerAvatarFallback: { alignItems: 'center', justifyContent: 'center' },
  headerAvatarText: { fontSize: 14, fontWeight: '800' },
  convInfo: { flex: 1, marginLeft: 12 },
  convTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  convName: {
    fontSize: 15,
    fontFamily: fontFamily.system,
    fontWeight: '700',
    flex: 1,
    marginRight: 8,
  },
  convTime: { fontSize: 11 },
  convMetaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 3 },
  convPrev: { fontSize: 12, flex: 1, marginRight: 8 },
  badge: {
    borderRadius: 999,
    minWidth: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  badgeT: { color: '#fff', fontSize: 11, fontFamily: fontFamily.system, fontWeight: '700' },
  dateSepText: { fontSize: 10, fontWeight: '700' },
  mediaBtn: {
    marginTop: 4,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 14,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
  },
  mediaBtnText: { fontSize: 12, fontFamily: fontFamily.system, fontWeight: '800' },
  inlineImg: { marginTop: 4, borderRadius: 14 },
  flipBar: { paddingHorizontal: 12, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth },
  flipName: { fontSize: 11, fontWeight: '700', marginBottom: 4 },
  flipRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  flipChip: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10 },
  flipChipT: { fontSize: 11, fontFamily: fontFamily.system, fontWeight: '700' },
  flipSpacer: { flex: 1 },
  flipMoney: { fontSize: 11, fontWeight: '700' },
  flipRechargeBtn: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 18 },
  flipRechargeT: { fontSize: 10, fontFamily: fontFamily.system, fontWeight: '800' },
  flipLabel: { fontSize: 10, fontWeight: '800', marginBottom: 2 },
  inputBar: { paddingHorizontal: 10, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  imgPickerBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    flex: 1,
    padding: 10,
    borderRadius: 18,
    borderWidth: 1,
    fontSize: 14,
    fontFamily: fontFamily.system,
    maxHeight: 80,
  },
  sendBtn: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 18 },
  ellipseBubble: { paddingVertical: 9, paddingHorizontal: 14, maxWidth: '78%', marginVertical: 2 },
  ellipseText: { fontSize: 15, lineHeight: 21 },
  ellipseTime: { fontSize: 11, fontFamily: fontFamily.system, marginTop: 3, alignSelf: 'flex-end' },
  sendT: { fontWeight: '800', fontSize: 13 },
});
