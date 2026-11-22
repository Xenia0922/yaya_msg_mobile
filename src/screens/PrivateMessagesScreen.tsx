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
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Reanimated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
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
import { useResolvedTheme } from '../hooks/useAppTheme';
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
function convTimeNumber(conv: PrivateConversationWire | null | undefined): number {
  return Number(
    conv?.lastTime ||
      conv?.newestMessagetime ||
      conv?.msgTime ||
      (conv as any)?.updateTime ||
      (conv as any)?.ctime ||
      (conv as any)?.time ||
      0,
  );
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
  const resolvedTheme = useResolvedTheme();
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
      groups[idxOf[groupOf(convTimeNumber(c))]].items.push(c);
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
  const selRef = useRef<PrivateConversationWire | null>(null);
  selRef.current = sel;
  const [convClosing, setConvClosing] = useState(false);
  const convClosingRef = useRef(false);
  convClosingRef.current = convClosing;
  const convCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const convCloseSeqRef = useRef(0);
  const convEnter = useSharedValue(0);
  const convEnterStyle = useAnimatedStyle(() => ({
    opacity: convEnter.value,
    transform: [{ translateX: (1 - convEnter.value) * 28 }],
  }));

  const keyboardHeight = useKeyboardHeight(Boolean(sel && !convClosing));
  const insets = useSafeAreaInsets();

  const inputBarSafeBottom = Platform.OS === 'ios' ? Math.max(16, insets.bottom) : 16;
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
  const [actionConv, setActionConv] = useState<PrivateConversationWire | null>(null);
  const requestIdRef = useRef(0);

  const convRequestIdRef = useRef(0);

  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
      if (convCloseTimerRef.current) clearTimeout(convCloseTimerRef.current);
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
        const normalizedPrices = (list || []).slice(0, 3);
        setPrices(normalizedPrices);
        const firstOpen = normalizedPrices.find(
          (row: FlipPriceRow) => Number(row?.privateCost) > 0,
        );
        setFlipType(firstOpen ? Number(firstOpen.answerType) : 0);
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
          .sort((a, b) => convTimeNumber(b) - convTimeNumber(a));
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

  const finalizeCloseConv = useCallback((tokenId: number) => {
    if (tokenId !== convCloseSeqRef.current) return;
    if (convCloseTimerRef.current) {
      clearTimeout(convCloseTimerRef.current);
      convCloseTimerRef.current = null;
    }
    convClosingRef.current = false;
    setConvClosing(false);
    setSel(null);
    setMsgs([]);
    void loadConvsRef.current();
  }, []);

  const openConv = async (c: PrivateConversationWire, opts?: { silent?: boolean }) => {
    const silent = opts?.silent === true;
    const requestId = ++convRequestIdRef.current;
    if (!silent) {
      const shouldAnimateEnter = !selRef.current || convClosingRef.current;
      if (convCloseTimerRef.current) {
        clearTimeout(convCloseTimerRef.current);
        convCloseTimerRef.current = null;
      }
      convCloseSeqRef.current += 1;
      convClosingRef.current = false;
      setConvClosing(false);
      if (shouldAnimateEnter) {
        convEnter.value = 0;
        convEnter.value = withTiming(1, { duration: 190, easing: Easing.out(Easing.cubic) });
      }
      setSel(c);
      setMsgs([]);
      setFlipType(0);
      setPlayUrl('');
      setLoading(true);
      if (scrollTimerRef.current) {
        clearTimeout(scrollTimerRef.current);
        scrollTimerRef.current = null;
      }
    } else {
      setSel(c);
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
    if (convClosingRef.current || !selRef.current) return;
    ++convRequestIdRef.current;
    const closeToken = ++convCloseSeqRef.current;
    setLoading(false);
    convClosingRef.current = true;
    setConvClosing(true);
    convCloseTimerRef.current = setTimeout(() => {
      finalizeCloseConv(closeToken);
    }, 220);
    convEnter.value = withTiming(
      0,
      { duration: 160, easing: Easing.out(Easing.cubic) },
      (finished) => {
        if (finished) {
          runOnJS(finalizeCloseConv)(closeToken);
        }
      },
    );
  }, [convEnter, finalizeCloseConv]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!navigation.isFocused()) return false;
      if (selRef.current && !convClosingRef.current) {
        closeConv();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [navigation, closeConv]);

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
      if (member) {
        const p = prices.find((x) => x.answerType === flipType);
        const cost = p ? Number(p.privateCost) || 0 : 0;
        if (!p || cost <= 0) {
          showToast(t('该成员暂未开放私密翻牌'));
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
      if (!url) {
        return (
          <ScalePressable
            style={[styles.msgAvatar, { backgroundColor: palette.fill2 }]}
            onPress={openPeerProfile}
            accessibilityLabel={t('查看资料')}
          >
            <MaterialCommunityIcons name="account" size={18} color={palette.labelTertiary} />
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
            fallbackIcon="account"
          />
        </ScalePressable>
      );
    },
    [sel, member, dmPeerAvatar, openPeerProfile, palette, t],
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
      const isMediaOnly = !hasText && !!media && (media.type === 'audio' || media.type === 'video');
      const isPlaying = !!media && playUrl === media.url;
      const tailStyle = {
        borderBottomRightRadius: mine ? 8 : 20,
        borderBottomLeftRadius: mine ? 20 : 8,
      };
      return (
        <GlassSurface
          role="chip"
          radius={22}
          tintColor={mine ? palette.tint : undefined}
          onPress={
            isMediaOnly && media
              ? () => setPlayUrl((p) => (p === media.url ? '' : media.url))
              : undefined
          }
          onLongPress={mine && item ? () => confirmDeletePrivateMessage(item) : undefined}
          style={[styles.ellipseBubble, tailStyle]}
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
            ) : isMediaOnly ? (
              <View style={styles.mediaInlineRow}>
                <View
                  style={[
                    styles.mediaCircleIcon,
                    {
                      backgroundColor: mine ? 'rgba(255,255,255,0.22)' : palette.tintSoft,
                    },
                  ]}
                >
                  <MaterialCommunityIcons
                    name={isPlaying ? 'chevron-up' : 'play'}
                    size={16}
                    color={mine ? palette.onTint : palette.tint}
                  />
                </View>
                <View style={styles.mediaInlineMeta}>
                  <Text
                    style={[
                      styles.mediaInlineTitle,
                      { color: mine ? palette.onTint : palette.tint },
                    ]}
                  >
                    {isPlaying
                      ? t('收起')
                      : `${t(media.type === 'audio' ? '语音' : '视频')} · ${mediaLabel}`}
                  </Text>
                  {hh ? (
                    <Text
                      style={[
                        styles.mediaInlineTime,
                        { color: mine ? 'rgba(255,255,255,0.82)' : palette.labelTertiary },
                      ]}
                    >
                      {hh}
                    </Text>
                  ) : null}
                </View>
              </View>
            ) : (
              <ScalePressable
                style={[
                  styles.mediaBtn,
                  { backgroundColor: mine ? 'rgba(255,255,255,0.20)' : palette.tintSoft },
                ]}
                onPress={() => setPlayUrl((p) => (p === media.url ? '' : media.url))}
              >
                <MaterialCommunityIcons
                  name={isPlaying ? 'chevron-up' : 'play'}
                  size={14}
                  color={mine ? palette.onTint : palette.tint}
                />
                <Text
                  style={[styles.mediaBtnText, { color: mine ? palette.onTint : palette.tint }]}
                >
                  {isPlaying ? t('收起') : mediaLabel}
                </Text>
              </ScalePressable>
            )
          ) : null}
          {media && isPlaying ? (
            <View style={styles.inlinePlayerWrap}>
              <PlayerScreen
                inline
                source={{ kind: media.type === 'audio' ? 'audio' : 'vod', url: media.url }}
                meta={{ title: t('消息媒体') }}
                persistent
              />
            </View>
          ) : null}
          {hh && !isMediaOnly ? (
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

  const activePriceRow = member ? prices.find((x) => x.answerType === flipType) : undefined;
  const activeFlipCost = activePriceRow ? Number(activePriceRow.privateCost) || 0 : 0;
  const memberSendDisabled = loading || !text.trim() || !activePriceRow || activeFlipCost <= 0;
  const dmSendDisabled = loading || !text.trim();
  const sheetBg = resolvedTheme === 'dark' ? '#0B0B0F' : '#ECEDF1';
  const listCardBg = resolvedTheme === 'dark' ? 'rgba(28,28,36,0.78)' : 'rgba(255,255,255,0.82)';
  const composerTint = resolvedTheme === 'dark' ? 'rgba(24,24,30,0.86)' : 'rgba(244,245,251,0.90)';
  const composerBorder =
    resolvedTheme === 'dark' ? 'rgba(255,255,255,0.14)' : 'rgba(18,22,36,0.08)';
  const actionTargetId = actionConv ? convTargetId(actionConv) : '';
  const actionPinnedIdx = actionTargetId ? pinnedConvs.indexOf(actionTargetId) : -1;
  const actionIsPinned = actionPinnedIdx >= 0;
  const actionMember = actionTargetId ? memberById.get(actionTargetId) : undefined;
  const actionAvatar = actionConv ? peerAvatarUrl(actionConv, actionMember) : '';
  const actionName = actionConv ? convName(actionConv) : '';

  return (
    <View style={[styles.screen, { backgroundColor: getPageBackground() }]}>
      <View style={styles.screen} pointerEvents={sel && !convClosing ? 'none' : 'auto'}>
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
              const latestTime = convTimeNumber(conv);
              const isPinned = pinnedConvs.includes(convTargetId(conv));
              const convTarget = String(convTargetId(conv));
              const convMember = memberById.get(convTarget);
              const convAvatarUrl = peerAvatarUrl(conv, convMember);
              return (
                <TouchableOpacity
                  onPress={() => openConv(conv)}
                  onLongPress={() => setActionConv(conv)}
                  activeOpacity={0.86}
                  style={styles.convItemOuter}
                >
                  <View
                    style={[
                      styles.convCard,
                      {
                        backgroundColor: listCardBg,
                        borderColor: palette.innerStroke,
                      },
                    ]}
                  >
                    <ScalePressable
                      style={[styles.convAvatar, { backgroundColor: palette.fill2 }]}
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
                          fallbackIcon="account"
                        />
                      ) : (
                        <MaterialCommunityIcons
                          name="account"
                          size={22}
                          color={palette.labelTertiary}
                        />
                      )}
                    </ScalePressable>
                    <View style={styles.convInfo}>
                      <View style={styles.convTitleRow}>
                        <View style={styles.convTitleLeft}>
                          <Text
                            style={[styles.convName, { color: palette.label }]}
                            numberOfLines={1}
                          >
                            {name}
                          </Text>
                          {isPinned ? (
                            <View style={[styles.pinTag, { backgroundColor: palette.tintSoft }]}>
                              <MaterialCommunityIcons name="pin" size={11} color={palette.tint} />
                            </View>
                          ) : null}
                        </View>
                        {latestTime > 0 ? (
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
                        ) : null}
                      </View>
                    </View>
                  </View>
                </TouchableOpacity>
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
      </View>

      {sel ? (
        <Reanimated.View
          pointerEvents={convClosing ? 'none' : 'auto'}
          style={[
            StyleSheet.absoluteFill,
            styles.screenContainer,
            { backgroundColor: sheetBg },
            convEnterStyle,
          ]}
        >
          <View
            style={[
              styles.screen,
              {
                paddingBottom: keyboardHeight > 0 ? keyboardHeight + 6 : inputBarSafeBottom,
              },
            ]}
          >
            <ScreenHeader
              title={dmPeerName}
              onBack={closeConv}
              leading={
                <ScalePressable onPress={openPeerProfile} accessibilityLabel={t('查看资料')}>
                  {dmPeerAvatar ? (
                    <NetworkImage
                      source={{ uri: dmPeerAvatar }}
                      style={styles.headerAvatar}
                      resizeMode="cover"
                      thumbnail={120}
                      fallbackIcon="account"
                    />
                  ) : (
                    <View
                      style={[
                        styles.headerAvatar,
                        styles.headerAvatarFallback,
                        { backgroundColor: palette.fill2 },
                      ]}
                    >
                      <MaterialCommunityIcons
                        name="account"
                        size={18}
                        color={palette.labelTertiary}
                      />
                    </View>
                  )}
                </ScalePressable>
              }
            />

            <View style={{ flex: 1 }}>
              <Chat
                messages={dmIms}
                theme={DM_CHAT_THEME as any}
                darkTheme={DM_CHAT_THEME as any}
                locale="zh"
                renderBubble={renderEllipseGlassBubble}
                renderAvatar={renderPeerAvatar}
                isScrollToBottomEnabled
                scrollToBottomOffset={80}
                renderDay={renderDayLabel}
                isDayAnimationEnabled={false}
                user={DM_CHAT_USER as any}
                onSend={(sentMsgs) => {
                  const outgoing = String(sentMsgs?.[0]?.text ?? '').trim();
                  if (outgoing) void doSend(outgoing);
                }}
                renderInputToolbar={DM_NO_INPUT_TOOLBAR}
                listProps={{ keyboardDismissMode: 'on-drag', keyboardShouldPersistTaps: 'handled' }}
              />
            </View>

            {member ? (
              <GlassSurface
                role="bar"
                radius={24}
                frostedOnly
                tintColor={composerTint}
                style={[
                  styles.memberComposerCard,
                  {
                    backgroundColor: 'transparent',
                    borderColor: composerBorder,
                    borderWidth: StyleSheet.hairlineWidth,
                  },
                ]}
              >
                <View style={styles.flipTierBar}>
                  <View style={styles.flipTierGroup}>
                    {prices.length > 0 ? (
                      prices.map((p) => {
                        const costVal = Number(p.privateCost);
                        const open = costVal > 0;
                        const active = open && flipType === p.answerType;
                        return (
                          <ScalePressable
                            key={p.answerType}
                            disabled={!open}
                            pressedScale={0.94}
                            style={[
                              styles.flipTierChip,
                              active
                                ? { backgroundColor: palette.tint }
                                : {
                                    backgroundColor: open ? palette.fill2 : palette.fill3,
                                    opacity: open ? 1 : 0.48,
                                  },
                            ]}
                            onPress={() => open && setFlipType(Number(p.answerType) || 0)}
                          >
                            <Text
                              style={[
                                styles.flipTierText,
                                { color: active ? palette.onTint : palette.labelSecondary },
                              ]}
                            >
                              {flipTypeName(p.answerType)}·{open ? costVal : t('未开放')}
                            </Text>
                          </ScalePressable>
                        );
                      })
                    ) : (
                      <Text style={[styles.flipEmptyText, { color: palette.labelTertiary }]}>
                        {t('该成员暂未开放私密翻牌')}
                      </Text>
                    )}
                  </View>
                  <ScalePressable
                    pressedScale={0.94}
                    onPress={() => navigation.navigate('RechargeScreen')}
                    style={[styles.flipRechargePill, { backgroundColor: palette.tintSoft }]}
                  >
                    <Text style={[styles.flipRechargeText, { color: palette.tint }]}>
                      {money ? `${t('余额 {money}', { money })} · ` : ''}
                      {t('充值')}
                    </Text>
                  </ScalePressable>
                </View>

                <View style={[styles.composerDivider, { backgroundColor: composerBorder }]} />

                <View style={styles.memberInputRow}>
                  <TextInput
                    style={[styles.composerInput, { color: palette.label }]}
                    placeholder={t('输入你想提问的内容...')}
                    placeholderTextColor={palette.labelTertiary}
                    value={text}
                    onChangeText={setText}
                    multiline
                    maxLength={200}
                  />
                  <ScalePressable
                    style={[
                      styles.memberSendBtn,
                      { backgroundColor: memberSendDisabled ? palette.fill3 : palette.tint },
                    ]}
                    onPress={() => {
                      void doSend();
                    }}
                    disabled={memberSendDisabled}
                    pressedScale={0.95}
                  >
                    <Text
                      style={[
                        styles.composerSendText,
                        { color: memberSendDisabled ? palette.labelTertiary : palette.onTint },
                      ]}
                    >
                      {loading
                        ? t('发送中')
                        : activeFlipCost > 0
                          ? `${activeFlipCost} ${t('翻牌')}`
                          : t('翻牌')}
                    </Text>
                  </ScalePressable>
                </View>
              </GlassSurface>
            ) : (
              <GlassSurface
                role="bar"
                radius={25}
                frostedOnly
                tintColor={composerTint}
                style={[
                  styles.dmComposerPill,
                  {
                    backgroundColor: 'transparent',
                    borderColor: composerBorder,
                    borderWidth: StyleSheet.hairlineWidth,
                  },
                ]}
              >
                <ScalePressable
                  style={[styles.imgPickerBtn, { backgroundColor: palette.tintSoft }]}
                  onPress={() => {
                    void pickAndSendImage();
                  }}
                  disabled={loading}
                  pressedScale={0.92}
                  accessibilityLabel={t('图片')}
                >
                  <MaterialCommunityIcons name="image-plus" size={20} color={palette.tint} />
                </ScalePressable>
                <TextInput
                  style={[styles.composerInput, styles.dmComposerInput, { color: palette.label }]}
                  placeholder={t('输入内容...')}
                  placeholderTextColor={palette.labelTertiary}
                  value={text}
                  onChangeText={setText}
                  multiline
                />
                <ScalePressable
                  style={[
                    styles.dmSendBtn,
                    { backgroundColor: dmSendDisabled ? palette.fill3 : palette.tint },
                  ]}
                  onPress={() => {
                    void doSend();
                  }}
                  disabled={dmSendDisabled}
                  pressedScale={0.95}
                >
                  <Text
                    style={[
                      styles.composerSendText,
                      { color: dmSendDisabled ? palette.labelTertiary : palette.onTint },
                    ]}
                  >
                    {loading ? t('发送中') : t('发送')}
                  </Text>
                </ScalePressable>
              </GlassSurface>
            )}
          </View>
          {zoomUrl ? <ZoomImageModal url={zoomUrl} onClose={() => setZoomUrl('')} /> : null}
        </Reanimated.View>
      ) : null}

      <Modal
        visible={!!actionConv}
        transparent
        animationType="slide"
        statusBarTranslucent
        navigationBarTranslucent
        onRequestClose={() => setActionConv(null)}
      >
        <Pressable style={styles.actionSheetShade} onPress={() => setActionConv(null)}>
          <Pressable
            style={[
              styles.actionSheetPanel,
              {
                backgroundColor: palette.surface,
                borderColor: palette.hairline,
                paddingBottom: Math.max(20, insets.bottom + 12),
              },
            ]}
            onPress={() => undefined}
          >
            <View style={[styles.actionHandle, { backgroundColor: palette.fill3 }]} />
            <View style={styles.actionHeaderRow}>
              <View style={[styles.actionAvatar, { backgroundColor: palette.fill2 }]}>
                {actionAvatar ? (
                  <NetworkImage
                    source={{ uri: actionAvatar }}
                    style={styles.actionAvatarImg}
                    resizeMode="cover"
                    thumbnail={120}
                    fallbackIcon="account"
                  />
                ) : (
                  <MaterialCommunityIcons name="account" size={20} color={palette.labelTertiary} />
                )}
              </View>
              <Text style={[styles.actionTitle, { color: palette.label }]} numberOfLines={1}>
                {actionName}
              </Text>
            </View>
            <ScalePressable
              pressedScale={0.98}
              style={[styles.actionItem, { backgroundColor: palette.fill2 }]}
              onPress={() => {
                const c = actionConv;
                setActionConv(null);
                if (c) togglePinConv(c);
              }}
            >
              <MaterialCommunityIcons
                name={actionIsPinned ? 'pin-off-outline' : 'pin-outline'}
                size={18}
                color={palette.tint}
              />
              <Text style={[styles.actionItemText, { color: palette.label }]}>
                {actionIsPinned ? t('取消置顶') : t('置顶')}
              </Text>
            </ScalePressable>
            {actionIsPinned && pinnedConvs.length > 1 ? (
              <View style={styles.actionReorderRow}>
                <ScalePressable
                  pressedScale={0.98}
                  disabled={actionPinnedIdx === 0}
                  style={[
                    styles.actionHalfBtn,
                    {
                      backgroundColor: palette.fill2,
                      opacity: actionPinnedIdx === 0 ? 0.45 : 1,
                    },
                  ]}
                  onPress={() => {
                    if (actionTargetId) movePinConv(actionTargetId, -1);
                    setActionConv(null);
                  }}
                >
                  <MaterialCommunityIcons name="chevron-up" size={18} color={palette.label} />
                  <Text style={[styles.actionItemText, { color: palette.label }]}>
                    {t('置顶上移')}
                  </Text>
                </ScalePressable>
                <ScalePressable
                  pressedScale={0.98}
                  disabled={actionPinnedIdx === pinnedConvs.length - 1}
                  style={[
                    styles.actionHalfBtn,
                    {
                      backgroundColor: palette.fill2,
                      opacity: actionPinnedIdx === pinnedConvs.length - 1 ? 0.45 : 1,
                    },
                  ]}
                  onPress={() => {
                    if (actionTargetId) movePinConv(actionTargetId, 1);
                    setActionConv(null);
                  }}
                >
                  <MaterialCommunityIcons name="chevron-down" size={18} color={palette.label} />
                  <Text style={[styles.actionItemText, { color: palette.label }]}>
                    {t('置顶下移')}
                  </Text>
                </ScalePressable>
              </View>
            ) : null}
            <ScalePressable
              pressedScale={0.98}
              style={[styles.actionItem, { backgroundColor: palette.fill2 }]}
              onPress={() => {
                setActionConv(null);
                if (actionTargetId) {
                  setProfileTarget({
                    userId: actionTargetId,
                    nick: actionName,
                    avatar: actionAvatar,
                  });
                }
              }}
            >
              <MaterialCommunityIcons
                name="account-circle-outline"
                size={18}
                color={palette.labelSecondary}
              />
              <Text style={[styles.actionItemText, { color: palette.label }]}>{t('查看资料')}</Text>
            </ScalePressable>
          </Pressable>
        </Pressable>
      </Modal>

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
  screenContainer: { flex: 1, zIndex: 20 },
  convList: { paddingHorizontal: 14, paddingTop: 4, paddingBottom: 24 },
  groupTitle: {
    fontSize: 12,
    fontFamily: fontFamily.system,
    fontWeight: '700',
    marginTop: 12,
    marginBottom: 6,
    paddingLeft: 4,
  },
  convItemOuter: { marginBottom: 8 },
  convCard: {
    borderRadius: radii.lg,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 11,
    flexDirection: 'row',
    alignItems: 'center',
  },
  convAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  convAvatarImg: { width: 48, height: 48, borderRadius: 24 },

  msgAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  headerAvatar: { width: 34, height: 34, borderRadius: 17 },
  headerAvatarFallback: { alignItems: 'center', justifyContent: 'center' },
  convInfo: { flex: 1, minWidth: 0, marginLeft: 12 },
  convTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  convTitleLeft: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 6 },
  convName: {
    fontSize: 15,
    fontFamily: fontFamily.system,
    fontWeight: '700',
    flexShrink: 1,
  },
  pinTag: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  convTime: { fontSize: 11, fontFamily: fontFamily.system, flexShrink: 0 },
  convMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
    gap: 8,
  },
  convPrev: { fontSize: 13, fontFamily: fontFamily.system, flex: 1 },
  badge: {
    borderRadius: 999,
    minWidth: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  badgeT: { color: '#fff', fontSize: 11, fontFamily: fontFamily.system, fontWeight: '700' },
  dateSepText: { fontSize: 11, fontFamily: fontFamily.system, fontWeight: '600' },
  mediaBtn: {
    marginTop: 6,
    paddingVertical: 6,
    paddingHorizontal: 11,
    borderRadius: 14,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  mediaBtnText: { fontSize: 12, fontFamily: fontFamily.system, fontWeight: '700' },
  mediaInlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minWidth: 132,
  },
  mediaCircleIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mediaInlineMeta: { gap: 2 },
  mediaInlineTitle: {
    fontSize: 13,
    fontFamily: fontFamily.system,
    fontWeight: '700',
    includeFontPadding: false,
  },
  mediaInlineTime: { fontSize: 11, fontFamily: fontFamily.system },
  inlinePlayerWrap: { marginTop: 8 },
  inlineImg: { marginTop: 4, borderRadius: 14 },

  memberComposerCard: {
    marginHorizontal: 12,
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 8,
    gap: 6,
  },
  flipTierBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  flipTierGroup: { flex: 1, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  flipTierChip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14 },
  flipTierText: {
    fontSize: 12,
    fontFamily: fontFamily.system,
    fontWeight: '700',
    includeFontPadding: false,
  },
  flipEmptyText: { fontSize: 12, fontFamily: fontFamily.system },
  flipRechargePill: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14 },
  flipRechargeText: {
    fontSize: 11,
    fontFamily: fontFamily.system,
    fontWeight: '700',
    includeFontPadding: false,
  },
  composerDivider: { height: StyleSheet.hairlineWidth, marginHorizontal: 2 },
  memberInputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingLeft: 4 },
  memberSendBtn: {
    height: 38,
    minWidth: 72,
    paddingHorizontal: 14,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },

  dmComposerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 50,
    marginHorizontal: 12,
    paddingHorizontal: 6,
    paddingVertical: 6,
    borderRadius: 25,
    borderWidth: StyleSheet.hairlineWidth,
  },
  imgPickerBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  composerInput: {
    flex: 1,
    minHeight: 38,
    maxHeight: 96,
    paddingHorizontal: 6,
    paddingVertical: 6,
    fontSize: 15,
    lineHeight: 20,
    fontFamily: fontFamily.system,
    textAlignVertical: 'center',
    includeFontPadding: false,
  },
  dmComposerInput: { paddingVertical: 6 },
  dmSendBtn: {
    height: 38,
    minWidth: 62,
    paddingHorizontal: 16,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  composerSendText: {
    fontSize: 13,
    lineHeight: 17,
    fontFamily: fontFamily.system,
    fontWeight: '700',
    includeFontPadding: false,
    textAlignVertical: 'center',
    ...Platform.select({ android: { paddingTop: 1 }, default: null }),
  },
  ellipseBubble: { paddingVertical: 9, paddingHorizontal: 14, maxWidth: '78%', marginVertical: 2 },
  ellipseText: { fontSize: 15, lineHeight: 21 },
  ellipseTime: { fontSize: 11, fontFamily: fontFamily.system, marginTop: 3, alignSelf: 'flex-end' },

  actionSheetShade: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.42)',
    justifyContent: 'flex-end',
  },
  actionSheetPanel: {
    borderTopLeftRadius: radii.sheet,
    borderTopRightRadius: radii.sheet,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 8,
  },
  actionHandle: { width: 38, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 4 },
  actionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingBottom: 6,
  },
  actionAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  actionAvatarImg: { width: 36, height: 36, borderRadius: 18 },
  actionTitle: { fontSize: 16, fontFamily: fontFamily.system, fontWeight: '700', flex: 1 },
  actionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 13,
    borderRadius: 14,
  },
  actionItemText: { fontSize: 14, fontFamily: fontFamily.system, fontWeight: '600' },
  actionReorderRow: { flexDirection: 'row', gap: 8 },
  actionHalfBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 14,
  },
});
