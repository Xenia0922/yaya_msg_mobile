import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PerfFlatList } from '../components/PerfFlatList';
import { usePalette, radii, radiiAlias } from '../theme';
import { useResolvedTheme } from '../hooks/useAppTheme';

import {
  ActivityIndicator,
  Alert,
  BackHandler,
  Image,
  ImageBackground,
  Linking,
  Modal,
  Platform,
  ScrollView,
  View,
  Text,
  FlatList,
  TouchableOpacity,
  TextInput,
  StyleSheet,
} from 'react-native';
import { BlurView } from 'expo-blur';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ScreenOrientation from 'expo-screen-orientation';
import Video from 'react-native-video';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useSettingsStore, useMemberStore, useUiStore } from '../store';
import { CenterSpinner } from '../components/Loaders';
import { EmptyState, ErrorState } from '../components/StateViews';
import { FadeInView, ScalePressable } from '../components/Motion';
import ScreenHeader from '../components/ScreenHeader';
import { Member, RoomMessage } from '../types';
import { formatTimestamp } from '../utils/format';
import { setPipPlaying } from '../utils/pip';
import { useMiniPlayerStore } from '../store/miniPlayerStore';
import {
  errorMessage,
  messagePayload,
  messageText,
  normalizeUrl,
  parseMaybeJson,
  pickText,
  unwrapList,
} from '../utils/data';
import { t, useI18n } from '../i18n';
import pocketApi from '../api/pocket48';
import ZoomImageModal from '../components/ZoomImageModal';
import { LiveExoView, setLiveImmersiveMode } from '../native/LivePlayer';
import { enqueueDownload } from '../services/downloads';
import { memberSearchText } from '../utils/members';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';

type FollowedRoom = {
  memberId: string;
  member?: Member;
  lastMessage?: any;
};

type RoomMode = 'big' | 'small';
type MediaType = 'audio' | 'video' | 'live' | 'image' | 'link';

type RoomMedia = {
  type: MediaType;
  url: string;
  title: string;
  duration?: string;
  liveId?: string;
  isLive?: boolean;
  needsVlc?: boolean;
  cover?: string;
  /** 消息/卡片已明示「回放/录播」：播放时应走可拖进度条的录播播放器，而非直播播放器 */
  replayHint?: boolean;
};

type SenderProfile = {
  id: string;
  name: string;
  avatar: string;
};

type MessageRole = 'idol' | 'mine' | 'fan';

const URL_REG = /(https?:\/\/[^\s"'<>，。！？、]+|rtmp:\/\/[^\s"'<>，。！？、]+)/gi;

const PLAY_URL_FIELDS = [
  'playStreamPath',
  'playUrlPath',
  'playPathUrl',
  'streamUrl',
  'streamURL',
  'playUrl',
  'urlPath',
  'playPath',
  'streamPath',
  'path',
  'src',
  'pullStreamPath',
  'liveStreamPath',
  'livePlayStreamPath',
  'streamPathHd',
  'streamPathHigh',
  'streamPathNormal',
  'streamPathOrigin',
  'url',
  'liveUrl',
  'm3u8Url',
  'flvUrl',
  'hlsUrl',
  'videoUrl',
  'audioUrl',
  'voiceUrl',
  'recordUrl',
  'mediaUrl',
  'filePath',
  'imageUrl',
  'imagePath',
  'picPath',
  'picturePath',
  'cover',
  'content.playStreamPath',
  'content.playUrlPath',
  'content.playPathUrl',
  'content.streamUrl',
  'content.playUrl',
  'content.playPath',
  'content.streamPath',
  'content.pullStreamPath',
  'content.liveStreamPath',
  'content.livePlayStreamPath',
  'content.url',
  'content.imageUrl',
  'content.imagePath',
  'content.picPath',
  'data.playStreamPath',
  'data.playUrlPath',
  'data.playPathUrl',
  'data.streamUrl',
  'data.playUrl',
  'data.playPath',
  'data.streamPath',
  'data.pullStreamPath',
  'data.liveStreamPath',
  'data.livePlayStreamPath',
  'data.url',
  'data.imageUrl',
  'data.imagePath',
  'data.picPath',
];

function shortName(member?: Member, fallback = '') {
  const raw = member?.ownerName || fallback || t('未知成员');
  return raw.replace(/^(SNH48|GNZ48|BEJ48|CKG48|CGT48)-/, '');
}

/** 通用文本限位（房间名等） */
function capText(text: string, max = 18) {
  const clean = (text || '').trim();
  if (!clean) return '';
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function parseObject(value: any) {
  const parsed = parseMaybeJson(value);
  if (parsed && typeof parsed === 'object') return parsed;
  return {};
}

function extraInfo(item: any) {
  return parseObject(item?.extInfo);
}

function messageBody(item: any) {
  const body = messagePayload(item);
  return body && typeof body === 'object' ? body : {};
}

function firstTextFrom(objects: any[], paths: string[]) {
  for (const obj of objects) {
    const value = pickText(obj, paths);
    if (value) return value;
  }
  return '';
}

function deepFindText(value: any, keys: string[], depth = 0): string {
  if (!value || depth > 5) return '';
  if (typeof value === 'string') return '';
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = deepFindText(item, keys, depth + 1);
      if (found) return found;
    }
    return '';
  }
  if (typeof value !== 'object') return '';
  for (const key of keys) {
    const direct = value[key];
    if (direct !== undefined && direct !== null && String(direct).trim()) return String(direct);
  }
  for (const child of Object.values(value)) {
    const found = deepFindText(child, keys, depth + 1);
    if (found) return found;
  }
  return '';
}

function collectUrls(value: any, result: string[] = [], depth = 0) {
  if (!value || depth > 6) return result;
  if (typeof value === 'string') {
    const matches = value.match(URL_REG) || [];
    matches.forEach((url) => result.push(normalizeUrl(url)));
    return result;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectUrls(item, result, depth + 1));
    return result;
  }
  if (typeof value === 'object') {
    const skipKeys = new Set(['avatar', 'headImg', 'headUrl', 'picPath', 'coverPath', 'coverUrl', 'avatarUrl', 'userAvatar', 'senderAvatar']);
    for (const [key, val] of Object.entries(value)) {
      if (skipKeys.has(key) && typeof val === 'string') continue;
      collectUrls(val, result, depth + 1);
    }
  }
  return result;
}

function senderProfile(item: any, room: Member): SenderProfile {
  const body = messageBody(item);
  const ext = extraInfo(item);
  const objects = [item, ext, body];
  const id = firstTextFrom(objects, [
    'senderUserId',
    'senderId',
    'fromUserId',
    'fromAccount',
    'userId',
    'uid',
    'account',
    'sender.userId',
    'sender.id',
    'user.userId',
    'user.id',
    'message.userId',
    'message.senderId',
  ]) || deepFindText(objects, ['senderUserId', 'fromUserId', 'userId', 'uid']);
  const name = firstTextFrom(objects, [
    'senderName',
    'senderNickName',
    'nickName',
    'nickname',
    'userName',
    'name',
    'fromNickName',
    'sender.nickName',
    'sender.nickname',
    'sender.name',
    'user.nickName',
    'user.nickname',
    'user.name',
    'message.nickName',
    'message.nickname',
  ]) || deepFindText(objects, ['nickName', 'nickname', 'senderName', 'userName', 'name']);
  const avatar = normalizeUrl(firstTextFrom(objects, [
    'avatar',
    'senderAvatar',
    'headImg',
    'headUrl',
    'sender.avatar',
    'sender.headImg',
    'user.avatar',
    'user.headImg',
    'userInfo.avatar',
    'userInfo.headImg',
    'message.avatar',
    'message.headImg',
  ]) || deepFindText(objects, ['avatar', 'headImg', 'headUrl', 'picPath']));

  return {
    id,
    name: name || (id ? t('用户 {id}', { id }) : t('未知用户')),
    avatar: avatar || '',
  };
}

function isIdolMessage(item: any, room: Member, includeFans: boolean) {
  const body = messageBody(item);
  const ext = extraInfo(item);
  const profile = senderProfile(item, room);
  const ownerIds = [room.id, (room as any).userId, (room as any).memberId].map(String).filter(Boolean);
  if (profile.id && ownerIds.includes(String(profile.id))) return true;
  // 已识别出发送者 ID 且不是房主（其他成员/粉丝在别人房间发言）：显示自己的名字，不套用房主身份
  if (profile.id) return false;
  // 拿不到发送者 ID：退回原来的判断逻辑
  if (!includeFans) return true;
  const role = firstTextFrom([item, ext, body], ['roleId', 'user.roleId', 'sender.roleId', 'message.roleId']);
  if (role && ['2', '3', '4', 'star', 'idol'].includes(String(role).toLowerCase())) return true;
  return false;
}

function currentUserIdFrom(res: any): string {
  return firstTextFrom([res?.content, res?.data, res], [
    'userInfo.userId',
    'userInfo.id',
    'user.userId',
    'user.id',
    'userId',
    'id',
    'account',
  ]);
}

function messageRole(item: any, room: Member, includeFans: boolean, currentUserId: string): MessageRole {
  const profile = senderProfile(item, room);
  if (includeFans && currentUserId && profile.id && String(profile.id) === String(currentUserId)) return 'mine';
  if (isIdolMessage(item, room, includeFans)) return 'idol';
  return 'fan';
}

function messageKey(item: any, index = 0) {
  const direct = item.id || item.msgId || item.messageId || item.clientMsgId || item.uuid || item.msgUuid;
  if (direct) return String(direct);
  const profile = senderProfile(item, {} as Member);
  const body = messageBody(item);
  const text = firstTextFrom([body, item], ['text', 'message', 'msgContent', 'content', 'bodys', 'body']);
  const media = firstTextFrom([body, item], ['url', 'fileUrl', 'pictureUrl', 'coverUrl', 'liveId']);
  return String(`${getMessageTime(item)}-${profile.id || profile.name || ''}-${text || media || JSON.stringify(body).slice(0, 120)}-${index}`);
}

function getMessageTime(item: any): number {
  const value = Number(item?.msgTime || item?.messageTime || item?.ctime || item?.time || 0);
  return Number.isFinite(value) ? value : 0;
}

function getNextTime(res: any, list: any[]): number {
  const direct = Number(firstTextFrom([res?.content, res?.data, res], ['nextTime', 'next', 'lastTime']));
  if (Number.isFinite(direct) && direct > 0) return direct;
  return 0;
}

function mergeMessages(prev: RoomMessage[], next: RoomMessage[]) {
  const seen = new Set(prev.map((item, index) => messageKey(item, index)));
  const merged = [...prev];
  next.forEach((item, index) => {
    const key = messageKey(item, index);
    if (seen.has(key)) return;
    seen.add(key);
    merged.push(item);
  });
  return sortMessagesNewestFirst(merged);
}

function sortMessagesNewestFirst<T>(list: T[]): T[] {
  return list.slice().sort((a: any, b: any) => getMessageTime(b) - getMessageTime(a));
}

function findLastMessage(messages: any[], member?: Member) {
  if (!member) return null;
  return messages.find((msg) => (
    String(msg.channelId || '') === String(member.channelId || '')
    || String(msg.channelId || '') === String(member.yklzId || '')
    || String(msg.serverId || '') === String(member.serverId || '')
    || String(msg.userId || msg.ownerId || '') === String(member.id || '')
  ));
}

function roomChannelId(member: Member, mode: RoomMode) {
  return String(mode === 'small' ? (member.yklzId || '') : (member.channelId || ''));
}

function roomLabel(member: Member, mode: RoomMode) {
  return mode === 'small'
    ? t('小房间 {id}', { id: member.yklzId || t('未配置') })
    : t('大房间 {id}', { id: member.channelId || t('未配置') });
}

function streamScore(url: string, preferLive = false): number {
  const lower = url.toLowerCase();
  if (preferLive && lower.startsWith('rtmp://')) return 130;
  if (lower.includes('.m3u8') || lower.includes('format=hls')) return preferLive ? 100 : 90;
  if (lower.includes('.flv')) return preferLive ? 110 : 70;
  if (lower.startsWith('rtmp://')) return 60;
  if (/\.(mp4|mov)(\?|$)/i.test(lower)) return 80;
  if (/\.(mp3|m4a|aac|amr|wav)(\?|$)/i.test(lower)) return 80;
  return 40;
}

function pickPlayableUrls(raw: any, preferLive = false): string[] {
  const candidates: string[] = [];
  const direct = normalizeUrl(pickText(raw, PLAY_URL_FIELDS));
  if (direct) candidates.push(direct);
  const nested = unwrapList(raw, [
    'streams',
    'playStreams',
    'liveStreams',
    'urls',
    'content.streams',
    'content.playStreams',
    'content.liveStreams',
    'content.streamList',
    'content.playStreamList',
    'content.urls',
    'data.streams',
    'data.playStreams',
    'data.liveStreams',
    'data.streamList',
    'data.playStreamList',
    'data.urls',
  ]);
  nested.forEach((item) => {
    const url = normalizeUrl(pickText(item, PLAY_URL_FIELDS));
    if (url) candidates.push(url);
  });
  collectUrls(raw).forEach((url) => candidates.push(url));
  return Array.from(new Set(candidates.filter(Boolean))).sort((a, b) => streamScore(b, preferLive) - streamScore(a, preferLive));
}

function extractLiveIdFromText(value: any): string {
  const raw = typeof value === 'string' ? value : JSON.stringify(value || '');
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {}
  const text = `${raw} ${decoded}`;
  return String(
    text.match(/[?&](?:liveId|liveid|live_id)=([0-9]+)/i)?.[1]
    || text.match(/[?&](?:id|live)=([0-9]{5,})/i)?.[1]
    || text.match(/(?:liveId|liveid|live_id)["'\s:=]+([0-9]+)/i)?.[1]
    || text.match(/\/(?:live|playback|record|replay)\/([0-9]+)/i)?.[1]
    || '',
  );
}

function isPlayableMediaUrl(url: string) {
  const lower = String(url || '').toLowerCase();
  return lower.startsWith('rtmp://')
    || lower.includes('.m3u8')
    || lower.includes('.flv')
    || /\.(mp4|mov|m4v|3gp|mp3|m4a|aac|amr|wav)(\?|$)/i.test(lower)
    || lower.includes('playstream')
    || lower.includes('stream');
}

function streamNeedsProxy(url: string): boolean {
  const lower = String(url || '').toLowerCase();
  return lower.startsWith('rtmp://') || lower.includes('.flv');
}

function isLiveStreamUrl(url: string): boolean {
  const lower = String(url || '').toLowerCase();
  return lower.startsWith('rtmp://') || lower.includes('.flv') || lower.includes('.m3u8');
}

/** 从已拉取的直播/录播详情判断当前状态。
 *  口袋 48 接口的事实字段：录播详情带 content.msgFilePath / content.lrcUrl（LRC 弹幕文件，
 *  见 pocket48.getLiveLrc 的既有用法），直播详情带 isLiving / living / isEnd 等状态位。
 *  无法确定时返回 'unknown'，交由上层按 URL 形态兜底。 */
function detailLiveState(detail: any): 'live' | 'replay' | 'unknown' {
  const d = detail?.content || detail?.data || detail || {};
  if (d.isLiving === true || d.living === true || d.isLive === true) return 'live';
  if (d.isLiving === false || d.living === false || d.isLive === false
    || d.isEnd === true || d.isEnded === true || d.isFinished === true
    || d.isRecord === 1 || d.isRecord === true || d.record === 1 || d.record === true
    || d.isReplay === 1 || d.isReplay === true || d.isPlayback === true
    || Boolean(d.msgFilePath) || Boolean(d.lrcUrl)) return 'replay';
  return 'unknown';
}

function isRawJsonText(value: string) {
  const text = String(value || '').trim();
  return (text.startsWith('{') && text.endsWith('}')) || (text.startsWith('[') && text.endsWith(']'));
}

function findLiveItem(listRes: any, liveId: string) {
  const list = unwrapList(listRes, [
    'content.liveList',
    'content.list',
    'content.data',
    'data.liveList',
    'data.list',
    'liveList',
    'list',
  ]);
  return list.find((item: any) => String(item.liveId || item.id || item.live_id || '') === String(liveId));
}

async function resolveRoomLiveMedia(media: RoomMedia): Promise<RoomMedia> {
  const liveId = String(media.liveId || extractLiveIdFromText(media) || '');
  const title = media.title || t('直播 / 录播');
  // 消息里已带可播放地址：直接返回，不再请求任何接口（直播分享/录播卡片通常自带 URL）
  const ownUrl = isPlayableMediaUrl(media.url) ? media.url : '';
  if (ownUrl) {
    // rtmp 推流只可能是直播；消息明示回放时按录播处理（.m3u8/.flv 既可能是直播流也可能是回放流）
    const isLive = !media.replayHint || ownUrl.toLowerCase().startsWith('rtmp://')
      ? isLiveStreamUrl(ownUrl)
      : false;
    return { ...media, liveId, title, url: ownUrl, isLive, needsVlc: streamNeedsProxy(ownUrl) };
  }
  const attempts: Array<{ label: 'live' | 'replay' | 'detail'; run: () => Promise<any> }> = [];
  if (liveId) {
    attempts.push({ label: 'detail', run: () => pocketApi.getLiveOne(liveId) });
    attempts.push({ label: 'detail', run: () => pocketApi.getOpenLiveOne(liveId) });
    attempts.push({ label: 'live', run: async () => findLiveItem(await pocketApi.getLiveList({ record: false, debug: true, next: 0 }), liveId) });
    attempts.push({ label: 'replay', run: async () => findLiveItem(await pocketApi.getLiveList({ record: true, debug: true, next: 0 }), liveId) });
    attempts.push({ label: 'replay', run: async () => findLiveItem(await pocketApi.getOpenLivePublicList({ record: true, next: 0 }), liveId) });
    attempts.push({ label: 'replay', run: async () => {
      for (let page = 1; page <= 3; page += 1) {
        const found = findLiveItem(await pocketApi.getLiveList({ record: true, debug: true, page, next: page - 1 }), liveId);
        if (found) return found;
      }
      return null;
    } });
  }
  // 并行发起全部候选接口，按优先级取第一个出 URL 的结果；
  // 原来 6 个接口串行（最坏每个 15s 超时），是「解析卡死、第一次点击无响应」的根因。
  const ATTEMPT_TIMEOUT = 8000;
  const settled = await Promise.allSettled(
    attempts.map((attempt) => Promise.race([
      attempt.run(),
      new Promise<any>((resolve) => setTimeout(() => resolve(null), ATTEMPT_TIMEOUT)),
    ])),
  );
  // 先分辨直播还是录播，再决定播放器：
  // 回放列表（record:true）命中的结果确定是录播，优先采用；
  // 其余（正在直播列表 / 详情）按接口状态位或 URL 形态兜底判断，避免把回放流误当直播播放。
  for (let pass = 0; pass < 2; pass += 1) {
    for (let i = 0; i < attempts.length; i += 1) {
      if ((pass === 0) !== (attempts[i].label === 'replay')) continue;
      const result = settled[i];
      if (result.status !== 'fulfilled' || !result.value) continue;
      const detail = result.value;
      const urls = pickPlayableUrls(detail, true).filter(isPlayableMediaUrl);
      if (urls[0]) {
        const d = detail?.content || detail?.data || detail || {};
        const cover = normalizeUrl(
          d.liveCover || d.coverPath || d.cover || d.coverUrl || d.picPath || d.liveRoomCover || ''
        ) || media.cover;
        let isLive: boolean;
        if (attempts[i].label === 'replay') {
          isLive = false;
        } else if (attempts[i].label === 'live') {
          isLive = true;
        } else {
          const state = detailLiveState(detail);
          if (state === 'replay') isLive = false;
          else if (state === 'live') isLive = true;
          else {
            // 详情无明确状态位：URL 兜底；消息明示回放且非 rtmp 推流时按录播优先
            isLive = isLiveStreamUrl(urls[0]);
            if (isLive && media.replayHint && !urls[0].toLowerCase().startsWith('rtmp://')) isLive = false;
          }
        }
        return {
          ...media,
          type: 'live',
          liveId,
          title,
          url: urls[0],
          cover,
          isLive,
          needsVlc: streamNeedsProxy(urls[0]),
        };
      }
    }
  }
  return { ...media, liveId, title, url: ownUrl, isLive: isLiveStreamUrl(ownUrl), needsVlc: streamNeedsProxy(ownUrl) };
}

function classifyMedia(url: string, msgType: string, text: string): MediaType {
  const lower = `${url} ${msgType} ${text}`.toLowerCase();
  if (lower.includes('image') || lower.includes('expressimage') || /\.(jpg|jpeg|png|gif|webp)(\?|$)/i.test(url)) return 'image';
  if (lower.includes('live') || lower.includes('playback') || lower.includes('record') || lower.includes('replay') || lower.startsWith('rtmp://') || lower.includes('.flv') || lower.includes('.m3u8')) return 'live';
  if (lower.includes('voice') || lower.includes('audio') || /\.(mp3|m4a|aac|amr|wav)(\?|$)/i.test(url)) return 'audio';
  if (lower.includes('video') || /\.(mp4|mov|m4v|3gp)(\?|$)/i.test(url)) return 'video';
  return 'link';
}

function roomMedia(item: any): RoomMedia | null {
  const body = messageBody(item);
  const ext = extraInfo(item);
  const text = messageText(item);
  const msgType = String(item.msgType || item.extMsgType || body.msgType || body.extMsgType || '').toUpperCase();
  if (msgType.includes('GIFT') || String(item.msgType) === '7') return null;

  if (msgType === 'EXPRESSIMAGE' || msgType === 'EXPRESS') {
    const exprUrl = normalizeUrl(body?.expressImgInfo?.emotionRemote || body?.url || '');
    if (exprUrl) return { type: 'image' as const, url: exprUrl, title: t('表情') };
  }

  const liveId = firstTextFrom([item, ext, body], [
    'liveId',
    'liveid',
    'live_id',
    'message.liveId',
    'msg.liveId',
    'content.liveId',
    'data.liveId',
  ]) || deepFindText([item, ext, body], ['liveId', 'liveid', 'live_id']) || extractLiveIdFromText([item, ext, body, text]);
  const urls = pickPlayableUrls([item, ext, body], !!liveId || msgType.includes('LIVE'));
  let url = urls[0] || '';
  // Fallback: try collecting all URLs from raw data
  if (!url && !liveId) {
    const allUrls: string[] = [];
    collectUrls(item, allUrls);
    collectUrls(ext, allUrls);
    collectUrls(body, allUrls);
    url = allUrls.find(u => u && /^https?:\/\//i.test(u)) || '';
  }
  // Fallback: if still no url but text/body has a URL, use it
  if (!url && !liveId) {
    const rawUrls: string[] = [];
    collectUrls(item, rawUrls);
    collectUrls(ext, rawUrls);
    collectUrls(body, rawUrls);
    // Also check the raw text for URLs
    const textMatch = String(text || '').match(/(https?:\/\/[^\s]+)/i);
    if (textMatch) rawUrls.push(textMatch[1]);
    url = rawUrls.find(u => u && /^https?:\/\//i.test(u)) || '';
  }
  // Still no URL? Check if text IS a media indicator
  if (!url && !liveId) {
    const t = String(text || '').toLowerCase();
    if (t.includes('[图片]') || t.includes('[语音]') || t.includes('[视频]') || t.includes('[链接]') || t.includes('[直播]')) {
      // It's a media placeholder - don't show raw text, render as empty media
      url = t; // mark as "has media" so we don't return null
    }
  }
  if (!url && !liveId) return null;
  const type = liveId ? 'live' : classifyMedia(url, msgType, text);
  const durationSec = [item, ext, body].reduce((best, src) => best || deepFindDuration(src), 0);
  const duration = durationSec > 0 ? String(Math.round(durationSec)) : '';
  // Audio/video 在房间里只用两个字前缀，避免「语音 语音消息」这种重复；live 保留完整标签
  const title = type === 'audio' ? t('语音')
    : type === 'video' ? t('视频')
    : type === 'live' ? t('直播 / 录播')
    : type === 'image' ? t('图片')
    : text && !text.startsWith('[') && text !== url ? text
    : t('链接');
  const cover = normalizeUrl(firstTextFrom([item, ext, body], [
    'coverUrl', 'coverPath', 'cover', 'liveCover', 'picPath', 'picturePath', 'imageUrl', 'poster', 'thumb',
    'videoCover', 'videoPoster', 'thumbnail', 'thumbUrl',
    'message.coverUrl', 'message.cover', 'content.coverUrl', 'data.coverUrl',
  ]) || '') || normalizeUrl(deepFindText([item, ext, body], [
    'coverUrl', 'cover', 'liveCover', 'picPath', 'coverPath', 'imageUrl', 'poster', 'thumb',
  ]));
  // 消息/卡片本身已明示「回放/录播」时，播放器应走「可拖进度条的录播模式」，
  // 而不是仅凭 .flv/.m3u8 后缀误判成直播（回放地址常见 HLS/FLV 形态）。
  const replayHint = !!(msgType.match(/RECORD|PLAYBACK|VOD|REPLAY|回放/)
    || /(回放|录播|replay|playback)/i.test(`${String(text || '')} ${String(body?.title || '')} ${String(body?.content || '')} ${String(body?.desc || '')} ${String(item?.title || '')}`)
    || /(replayUrl|playbackUrl|recordUrl|\/replay\/|\/record\/|\/playback\/)/i.test(`${url} ${String(body?.replayUrl || '')} ${String(body?.playbackUrl || '')} ${String(body?.recordUrl || '')}`));
  return { type, url, title, duration, liveId, cover, replayHint };
}

function roomGiftInfo(item: any): { name: string; num: number; image: string; total: string } | null {
  const body = messageBody(item);
  const ext = extraInfo(item);
  const msgType = String(item.msgType || item.extMsgType || body.msgType || body.extMsgType || body.messageType || '').toUpperCase();
  const giftReplyInfo = body.giftReplyInfo || ext.giftReplyInfo || {};
  const giftInfo = body.giftInfo || giftReplyInfo.giftInfo || ext.giftInfo || item.giftInfo || null;
  if (!giftInfo && !msgType.includes('GIFT') && String(item.msgType) !== '7') return null;
  if (msgType.includes('LIVE') && !giftInfo) return null;
  const source = giftInfo || giftReplyInfo || body;
  const name = firstTextFrom([giftInfo, giftReplyInfo, body], ['giftName', 'replyName', 'name']) || t('礼物');
  const num = Number(firstTextFrom([giftInfo, giftReplyInfo, body], ['giftNum', 'replyNum', 'num', 'count']) || '1') || 1;
  const image = normalizeUrl(firstTextFrom([giftInfo, giftReplyInfo, body], ['picPath', 'giftPic', 'image', 'icon']));
  const money = Number(firstTextFrom([giftInfo, giftReplyInfo, body], ['money', 'replyMoney', 'cost', 'price']) || '0') || 0;
  return { name, num, image, total: money ? t('{count} 鸡腿', { count: money * num }) : '' };
}

function mediaLabel(type: MediaType) {
  if (type === 'audio') return '\u8bed\u97f3';
  if (type === 'video') return '\u89c6\u9891';
  if (type === 'live') return '\u76f4\u64ad';
  if (type === 'image') return '\u56fe\u7247';
  return '\u94fe\u63a5';
}

function playerSource(url: string) {
  return {
    uri: url,
    headers: {
      'User-Agent': 'PocketFans201807/7.0.41 (iPhone; iOS 16.3.1; Scale/2.00)',
      Referer: 'https://h5.48.cn/',
    },
  };
}

function VideoCoverCard({ media, onPress, onLongPress }: { media: RoomMedia; onPress: () => void; onLongPress: () => void }) {
  const palette = usePalette();
  const [loaded, setLoaded] = useState(false);
  const hasCover = !!media.cover;
  return (
    <TouchableOpacity style={styles.videoCoverWrap} onPress={onPress} onLongPress={onLongPress} activeOpacity={0.9}>
      {hasCover ? (
        <Image source={{ uri: media.cover }} style={styles.videoCoverImg} resizeMode="cover" />
      ) : (
        <View style={styles.videoCoverImg}>
          <Video
            source={playerSource(media.url)}
            style={StyleSheet.absoluteFill}
            paused
            controls={false}
            resizeMode="cover"
            muted
            playWhenInactive
            playInBackground
            onLoad={() => setLoaded(true)}
          />
          {!loaded ? (
            <View style={styles.videoCoverPlaceholder}>
              <Text style={[styles.videoCoverPlaceholderText, { color: palette.tint }]}>{t('视频')}</Text>
            </View>
          ) : null}
        </View>
      )}
      <View style={styles.videoCoverOverlay}>
        <View style={styles.livePlayCircle}>
          <MaterialCommunityIcons name="play" size={22} color="#FFFFFF" style={{ marginLeft: 3 }} />
        </View>
      </View>
      {media.duration ? (
        <View style={styles.videoCoverDuration}>
          <Text style={styles.videoCoverDurationText}>{media.duration}s</Text>
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

function normalizeLiveRank(res: any): any[] {
  let list = unwrapList(res, [
    'content.rankList',
    'content.userRankList',
    'content.userRankingList',
    'content.contributionList',
    'content.list',
    'content.data',
    'data.rankList',
    'data.userRankList',
    'data.userRankingList',
    'data.contributionList',
    'data.list',
    'rankList',
    'userRankList',
    'userRankingList',
    'contributionList',
    'list',
  ]);
  if (!list.length) {
    const content = res?.content || res?.data || res;
    const found: any[] = [];
    const walk = (node: any, depth = 0) => {
      if (!node || depth > 5) return;
      if (Array.isArray(node)) {
        node.forEach((item) => walk(item, depth + 1));
        return;
      }
      if (typeof node !== 'object') return;
      const hasUser = pickText(node, ['nickName', 'nickname', 'userName', 'name', 'userInfo.nickname', 'userInfo.nickName', 'user.nickname', 'user.nickName']);
      const hasValue = pickText(node, ['score', 'total', 'cost', 'money', 'giftValue', 'value', 'amount', 'contribution', 'count', 'giftNum']);
      if (hasUser || hasValue || node.userInfo || node.user) found.push(node);
      Object.values(node).forEach((value) => walk(value, depth + 1));
    };
    walk(content);
    list = found;
  }
  return list.map((item: any, index: number) => ({
    ...item,
    userId: pickText(item, ['userId', 'uid', 'id', 'account', 'userInfo.userId', 'userInfo.id', 'user.userId', 'user.id', 'user.userIdStr', 'memberInfo.userId', 'memberInfo.id']),
    rank: Number(item.rank || item.no || item.index || index + 1),
    name: pickText(item, [
      'nickName',
      'nickname',
      'userName',
      'name',
      'senderName',
      'userInfo.nickName',
      'userInfo.nickname',
      'userInfo.name',
      'user.nickName',
      'user.nickname',
      'user.userName',
      'user.name',
      'memberInfo.nickName',
      'memberInfo.nickname',
    ], t('用户 {id}', { id: index + 1 })),
    avatar: normalizeUrl(pickText(item, [
      'avatar',
      'headImg',
      'picPath',
      'userInfo.avatar',
      'userInfo.headImg',
      'user.avatar',
      'user.headImg',
      'user.userAvatar',
      'memberInfo.avatar',
    ])),
    value: pickText(item, ['score', 'total', 'cost', 'money', 'giftValue', 'value', 'amount', 'contribution', 'count', 'giftNum'], ''),
  }));
}

function avatarInitial(name: string) {
  return (name || t('用')).trim().slice(0, 1).toUpperCase();
}

const DURATION_KEYS = new Set([
  'duration', 'audioTime', 'voiceTime', 'voiceLength', 'fileDuration',
  'mediaDuration', 'msgDuration', 'seconds', 'playTime', 'totalTime',
  'length', 'timeLength', 'mediaLength', 'videoTime', 'time',
]);

function deepFindDuration(value: any, depth = 0): number {
  if (!value || depth > 5) return 0;
  // 时长归一：0-24h 内视为秒；24h~24h*1000 视为毫秒（÷1000，房间消息语音/视频时长常为毫秒）；
  // 更大的（Unix 秒/毫秒时间戳，如 time 字段）一律无效，防止误显示成时间戳
  const normalize = (n: number): number => {
    if (!Number.isFinite(n) || n <= 0) return 0;
    if (n <= 86400) return n;
    if (n <= 86400000) return Math.round(n / 1000);
    return 0;
  };
  if (typeof value === 'number') return normalize(value);
  if (typeof value === 'string') {
    return normalize(parseFloat(value.trim()));
  }
  if (typeof value !== 'object') return 0;
  if (Array.isArray(value)) {
    for (const item of value) {
      const d = deepFindDuration(item, depth + 1);
      if (d > 0) return d;
    }
    return 0;
  }
  for (const [key, v] of Object.entries(value)) {
    if (DURATION_KEYS.has(key)) {
      const n = typeof v === 'number' ? v : parseFloat(String(v || '').trim());
      const d = normalize(n);
      if (d > 0) return d;
    }
  }
  for (const child of Object.values(value)) {
    const d = deepFindDuration(child, depth + 1);
    if (d > 0) return d;
  }
  return 0;
}

export default function FollowedRoomsScreen() {
  const palette = usePalette();
  const resolvedTheme = useResolvedTheme();
  const { t } = useI18n();
  const token = useSettingsStore((state) => state.settings.p48Token);
  const setTabBarHidden = useUiStore((state) => state.setTabBarHidden);
  const showToast = useUiStore((state) => state.showToast);
  const navigation = useNavigation<any>();
  const members = useMemberStore((state) => state.members);
  const [followed, setFollowed] = useState<FollowedRoom[]>([]);
  // 直播状态：ids=直播中主播 id 集合，names=直播中昵称集合（接口字段不一，昵称兜底）
  const [liveNow, setLiveNow] = useState<{ ids: Set<string>; names: Set<string> }>({ ids: new Set(), names: new Set() });
  const [pinned, setPinned] = useState<string[]>([]);
  const [selectedRoom, setSelectedRoom] = useState<Member | null>(null);
  const [roomMessages, setRoomMessages] = useState<RoomMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [followedError, setFollowedError] = useState('');
  const [roomMsgError, setRoomMsgError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [roomSearchQuery, setRoomSearchQuery] = useState('');
  const [roomSearchOpen, setRoomSearchOpen] = useState(false);
  const [roomMode, setRoomMode] = useState<RoomMode>('big');
  const [showFanMessages, setShowFanMessages] = useState(false);
  const [playingMedia, setPlayingMedia] = useState<RoomMedia | null>(null);
  const [roomNextTime, setRoomNextTime] = useState(0);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  // 房间内展示：房间名（channelInfo.channelName）+ 背景图（channelInfo.bgImg）
  const [roomMeta, setRoomMeta] = useState<{ name: string; bg: string }>({ name: '', bg: '' });
  const roomMetaCache = useRef<Record<string, { name: string; bg: string }>>({});
  const activeChannelRef = useRef('');
  const [loadingMoreMessages, setLoadingMoreMessages] = useState(false);
  const loadingMoreMessagesRef = useRef(false);
  const [currentUserId, setCurrentUserId] = useState('');
  const [fullImageUrl, setFullImageUrl] = useState('');
  const [roomPlayer, setRoomPlayer] = useState<RoomMedia | null>(null);
  const [roomPlayerFullscreen, setRoomPlayerFullscreen] = useState(false);

  // 画中画（悬浮窗）状态同步：房间播放器打开且未全屏时置位
  useEffect(() => {
    // 应用内小窗已接管 PiP 标志时不覆盖（防小窗切后台不进悬浮窗）
    if (useMiniPlayerStore.getState().visible) return;
    setPipPlaying(!!roomPlayer && !roomPlayerFullscreen);
  }, [roomPlayer, roomPlayerFullscreen]);
  const [rankVisible, setRankVisible] = useState(false);
  const [rankRows, setRankRows] = useState<any[]>([]);
  const [rankStatus, setRankStatus] = useState('');
  const [followedIds, setFollowedIds] = useState<Set<string>>(new Set());
  const [followBusy, setFollowBusy] = useState<Set<string>>(new Set());
  // 用 ref 持有最新值，避免 toggleFollow 的 useCallback 闭包捕获到过期的 followedIds/followBusy
  const followedIdsRef = useRef(followedIds);
  const followBusyRef = useRef(followBusy);
  followedIdsRef.current = followedIds;
  followBusyRef.current = followBusy;
  // loadFollowed 定义在 toggleFollow 之后，用 ref 持有以避免前向引用报错
  const loadFollowedRef = useRef<(silent?: boolean) => void>(() => {});

  useFocusEffect(useCallback(() => {
    setTabBarHidden(!!selectedRoom || !!roomPlayer);
    return () => {
      setTabBarHidden(false);
      setLiveImmersiveMode(false);
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    };
  }, [roomPlayer, selectedRoom, setTabBarHidden]));

  useEffect(() => {
    setTabBarHidden(!!selectedRoom);
    if (!selectedRoom) {
      setRoomPlayer(null);
      setLiveImmersiveMode(false);
      setRoomPlayerFullscreen(false);
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    }
    return () => {
      setTabBarHidden(false);
      setLiveImmersiveMode(false);
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    };
  }, [selectedRoom, setTabBarHidden]);

  useEffect(() => {
    setLiveImmersiveMode(!!roomPlayer && roomPlayerFullscreen);
    // 不再强制锁横/竖屏：方向跟随手机持握（旋转手机自然横屏），
    // 避免点开房间消息视频被强制全屏+强制横屏与持握方向冲突
    return () => setLiveImmersiveMode(false);
  }, [roomPlayer, roomPlayerFullscreen]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (roomPlayer) {
        setRoomPlayer(null);
        setRoomPlayerFullscreen(false);
        setLiveImmersiveMode(false);
        ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
        setTabBarHidden(!!selectedRoom);
        return true;
      }
      if (selectedRoom) {
        setRoomPlayer(null);
        setRoomPlayerFullscreen(false);
        setPlayingMedia(null);
        setSelectedRoom(null);
        setLiveImmersiveMode(false);
        ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
        setTabBarHidden(false);
        return true;
      }
      return false;
    });
    return () => subscription.remove();
  }, [roomPlayer, selectedRoom, setTabBarHidden]);

  const closeRoomPlayer = useCallback(() => {
    setRoomPlayer(null);
    setRoomPlayerFullscreen(false);
    setLiveImmersiveMode(false);
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    setTabBarHidden(!!selectedRoom);
  }, [selectedRoom, setTabBarHidden]);

  // 应用内小窗：房间播放器交棒给悬浮小窗
  const handleRoomMiniPlayer = useCallback(() => {
    const cur = roomPlayer;
    if (!cur?.url) return;
    useMiniPlayerStore.getState().open({
      url: cur.url,
      title: cur.title,
      cover: cur.cover,
      isLive: !!cur.isLive,
      position: 0,
      backTo: { mode: 'vod', playUrl: cur.url, playTitle: cur.title, playCover: cur.cover },
    });
    closeRoomPlayer();
  }, [roomPlayer, closeRoomPlayer]);

  const closeRoom = useCallback(() => {
    setRoomPlayer(null);
    setRoomPlayerFullscreen(false);
    setPlayingMedia(null);
    setSelectedRoom(null);
    setRoomMeta({ name: '', bg: '' });
    activeChannelRef.current = '';
    setLiveImmersiveMode(false);
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    setTabBarHidden(false);
  }, [setTabBarHidden]);

  const togglePin = async (memberId: string) => {
    const next = pinned.includes(memberId) ? pinned.filter((id) => id !== memberId) : [...pinned, memberId];
    setPinned(next);
    try {
      await AsyncStorage.setItem('yaya_pinned_rooms', JSON.stringify(next));
    } catch (error: any) {
      showToast(t('置顶保存失败：{msg}', { msg: error?.message || String(error) }));
    }
  };

  /** 置顶成员调换：dir=-1 上移 / 1 下移（交换相邻置顶位） */
  const movePin = async (memberId: string, dir: -1 | 1) => {
    const idx = pinned.indexOf(memberId);
    const to = idx + dir;
    if (idx < 0 || to < 0 || to >= pinned.length) return;
    const next = [...pinned];
    [next[idx], next[to]] = [next[to], next[idx]];
    setPinned(next);
    try {
      await AsyncStorage.setItem('yaya_pinned_rooms', JSON.stringify(next));
    } catch (error: any) {
      showToast(t('置顶保存失败：{msg}', { msg: error?.message || String(error) }));
    }
  };

  const toggleFollow = useCallback(async (member: Member) => {
    if (!token) { showToast(t('请先登录后再关注成员')); return; }
    const id = String((member as any).id || (member as any).userId || '');
    if (!id || id === '0') { showToast(t('该成员缺少可关注的 ID')); return; }
    if (followBusyRef.current.has(id)) return;
    // 关键：用 ref 读取最新关注状态，避免 useCallback 闭包捕获到过期的 followedIds，
    // 否则「已关注」状态下再次点击会误判为未关注而重复调用 followMember（表现为取消关注无效）
    const isFollowing = followedIdsRef.current.has(id);
    setFollowedIds((prev) => { const n = new Set(prev); if (isFollowing) n.delete(id); else n.add(id); return n; });
    setFollowBusy((prev) => { const b = new Set(prev); b.add(id); return b; });
    try {
      if (isFollowing) await pocketApi.unfollowMember(id);
      else await pocketApi.followMember(id);
      showToast(isFollowing ? t('已取消关注 {name}', { name: member.ownerName }) : t('已关注 {name}', { name: member.ownerName }));
      // 让房间里的关注/取关结果立即反映到关注列表（无需回列表手动刷新）
      setFollowed((prev) => {
        const exists = prev.some((p) => String(p.memberId) === id);
        if (isFollowing) return prev.filter((p) => String(p.memberId) !== id);
        if (exists) return prev;
        return [{ memberId: id, member }, ...prev];
      });
      // 与电脑版一致：操作后延迟从服务器拉取最新关注列表，保证状态权威同步
      setTimeout(() => { loadFollowedRef.current(true); }, 600);
    } catch (e) {
      setFollowedIds((prev) => { const r = new Set(prev); if (isFollowing) r.add(id); else r.delete(id); return r; });
      showToast(t('操作失败：{msg}', { msg: errorMessage(e) }));
    } finally {
      setFollowBusy((prev) => { const b = new Set(prev); b.delete(id); return b; });
    }
  }, [showToast, t, token]);

  useEffect(() => {
    AsyncStorage.getItem('yaya_pinned_rooms').then((v) => {
      if (v) { try { setPinned(JSON.parse(v)); } catch { setPinned([]); } }
    });
  }, []);

  const loadFollowed = useCallback(async (silent = false) => {
    if (!token) {
      setFollowed([]);
      return;
    }
    setLoading(true);
    try {
      const idsRes = await pocketApi.getFollowedIds();
      const idsArr = unwrapList(idsRes, ['content.data', 'content', 'data', 'list']).map(String);
      setFollowedIds(new Set(idsArr));
      const followedMembers = idsArr.map((id: string) => {
        const member = members.find((item: any) => String(item.id || item.userId) === id);
        return { memberId: id, member };
      }).filter((item: any) => item.member?.channelId);
      const serverIds = followedMembers.map((item: any) => Number(item.member?.serverId || 0)).filter((id: number) => id > 0);
      // 小房间没有独立 serverId，用 yklzId（小房间 channelId）一起查询最新消息，
      // 否则小房间在列表里永远显示「暂无消息」
      const smallRoomIds = followedMembers.map((item: any) => Number(item.member?.yklzId || 0)).filter((id: number) => id > 0);
      const queryIds = Array.from(new Set([...serverIds, ...smallRoomIds]));
      const lastMsgsRes = queryIds.length ? await pocketApi.getLastMessages(queryIds) : null;
      const lastMsgs = unwrapList(lastMsgsRes, ['content.lastMsgList', 'content.data', 'data', 'lastMsgList']);
      setFollowed(followedMembers.map((item: any) => ({
        ...item,
        lastMessage: findLastMessage(lastMsgs, item.member),
      })));
      // 直播状态：拉取首页直播列表（非阻塞），按主播 id / liveRoomId / 昵称匹配关注成员点亮状态点
      pocketApi.getLiveList({ record: false, next: 0, size: 100 }).then((res: any) => {
        const liveItems = unwrapList(res, ['content.liveList', 'content.list', 'data.liveList', 'liveList', 'list', 'data']);
        const ids = new Set<string>();
        const names = new Set<string>();
        liveItems.forEach((it: any) => {
          const owner = String(it.userId || it.ownerId || it.memberId || it.userInfo?.userId || it.userInfo?.id || it.user?.userId || it.owner?.userId || it.memberInfo?.userId || it.hostId || it.account || '');
          if (owner) ids.add(owner);
          const lr = String(it.liveRoomId || it.roomId || '');
          if (lr) ids.add(lr);
          const nick = String(it.nickname || it.nickName || it.userInfo?.nickname || it.userInfo?.starName || '').replace(/^(SNH48|GNZ48|BEJ48|CKG48|CGT48)-/i, '').trim().toLowerCase();
          if (nick) names.add(nick);
        });
        setLiveNow({ ids, names });
      }).catch(() => {});
      if (!silent) showToast(t('已加载 {count} 个房间', { count: followedMembers.length }));
      setFollowedError('');
    } catch (e) {
      setFollowedError(errorMessage(e));
      if (!silent) showToast(t('加载失败：{msg}', { msg: errorMessage(e) }));
    }
    finally { setLoading(false); }
  }, [members, showToast, t, token]);
  loadFollowedRef.current = loadFollowed;

  useEffect(() => { loadFollowed(true); }, [loadFollowed]);

  const openRoom = useCallback(async (room: Member, nextMode: RoomMode = 'big', includeFans = showFanMessages) => {
    const channelId = roomChannelId(room, nextMode);
    if (!channelId) {
      showToast(nextMode === 'small' ? t('这个成员缺少小房间 channelId，无法打开小房间。') : t('这个成员缺少大房间 channelId，无法打开房间。'));
      return;
    }
    setSelectedRoom(room);
    const channelChanged = activeChannelRef.current !== channelId;
    activeChannelRef.current = channelId;
    // 同房间（如切换成员/粉丝发言）不清 meta，避免背景图闪烁
    if (channelChanged) setRoomMeta({ name: '', bg: '' });
    setRoomSearchQuery('');
    setPlayingMedia(null);
    setLoading(true);
    setRoomMessages([]);
    setRoomMsgError('');
    setRoomNextTime(0);
    setHasMoreMessages(false);
    setRoomMode(nextMode);
    setShowFanMessages(includeFans);
    try {
      const userInfo = includeFans && !currentUserId
        ? await pocketApi.getNimLoginInfo().catch(() => null)
        : null;
      const nextCurrentUserId = currentUserId || currentUserIdFrom(userInfo);
      if (nextCurrentUserId) setCurrentUserId(nextCurrentUserId);
      const res = await pocketApi.getRoomMessages({
        channelId,
        serverId: room.serverId,
        nextTime: 0,
        fetchAll: includeFans,
        fallbackChannelId: nextMode === 'small' ? room.channelId : undefined,
      });
      const list = unwrapList(res, ['content.messageList', 'content.message', 'content.messages', 'content.list', 'data.messageList', 'data.message', 'messageList', 'message', 'messages', 'list']);
      const sorted = sortMessagesNewestFirst(list);
      setRoomMessages(sorted);
      setRoomMsgError('');
      const nextTime = getNextTime(res, list);
      setRoomNextTime(nextTime);
      setHasMoreMessages(nextTime > 0 && list.length > 0);
      // 房间名 + 背景图：room/info -> channelInfo.channelName / channelInfo.bgImg（按 channelId 缓存，异步拉取不阻塞消息）
      const cachedMeta = roomMetaCache.current[channelId];
      if (cachedMeta !== undefined) {
        setRoomMeta(cachedMeta);
      } else {
        roomMetaCache.current[channelId] = { name: '', bg: '' };
        // 小房间 room/info 服务端 2001 无权限（实测）→ 塞纳河 server/detail 拿 channelInfoList 房间名 + 背景墙图
        pocketApi.getRoomMeta(channelId, nextMode === 'small' ? room.channelId : undefined, room.serverId)
          .then((meta) => { roomMetaCache.current[channelId] = meta; setRoomMeta(meta); })
          .catch(() => { roomMetaCache.current[channelId] = { name: '', bg: '' }; });
      }
    } catch (error) {
      showToast(t('加载失败：{msg}', { msg: errorMessage(error) }));
      setRoomMessages([]);
      setRoomMsgError(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [currentUserId, roomMode, showFanMessages, showToast, t]);

  const loadMoreRoomMessages = useCallback(async () => {
    if (!selectedRoom || loading || loadingMoreMessages || loadingMoreMessagesRef.current || !hasMoreMessages || !roomNextTime) return;
    const channelId = roomChannelId(selectedRoom, roomMode);
    if (!channelId) return;
    loadingMoreMessagesRef.current = true;
    setLoadingMoreMessages(true);
    try {
      const res = await pocketApi.getRoomMessages({
        channelId,
        serverId: selectedRoom.serverId,
        nextTime: roomNextTime,
        fetchAll: showFanMessages,
        fallbackChannelId: roomMode === 'small' ? selectedRoom.channelId : undefined,
      });
      const list = unwrapList(res, ['content.messageList', 'content.message', 'content.messages', 'content.list', 'data.messageList', 'data.message', 'messageList', 'message', 'messages', 'list']);
      const nextTime = getNextTime(res, list);
      setRoomMessages((prev) => {
        const merged = mergeMessages(prev, list as RoomMessage[]);
        return merged;
      });
      setRoomNextTime(nextTime);
      setHasMoreMessages(nextTime > 0 && list.length > 0);
    } catch (error) {
      showToast(t('继续加载失败：{msg}', { msg: errorMessage(error) }));
    } finally {
      loadingMoreMessagesRef.current = false;
      setLoadingMoreMessages(false);
    }
  }, [hasMoreMessages, loading, loadingMoreMessages, roomMode, roomNextTime, selectedRoom, showFanMessages, showToast, t]);

  const playMedia = useCallback(async (media: RoomMedia) => {
    if (media.type === 'link') {
      const url = media.url || media.title;
      if (url) Linking.openURL(url).catch(() => showToast(t('这个链接无法直接打开。')));
      return;
    }
    if (playingMedia?.url && playingMedia.url === media.url) {
      setPlayingMedia(null);
      return;
    }
    let next = media;
    try {
      if (media.type === 'live' || media.liveId) {
        // v2.7: 点击即进统一播放器（MediaScreen 内先渲染播放器 shell 再解析地址并播放）。
        // 不再在房间页前置解析（串行接口解析慢、失败时用户被留在列表页，体验差）；
        // 播放器内有「正在解析…」loading 与失败重试反馈。
        const targetMode = media.isLive ? 'live' : 'vod';
        navigation.navigate('Media', {
          mode: targetMode,
          playLiveId: media.liveId,
          playTitle: media.title,
          playCover: media.cover,
          playNonce: Date.now(),
          fromRoom: true,
        });
        return;
      }
      if (next.type === 'video') {
        // 点击内嵌播放（不自动全屏）；要看全屏自己点「全屏」按钮
        setPlayingMedia(next);
        return;
      }
      setPlayingMedia(next);
    } catch (error) {
      Alert.alert(t('播放失败'), errorMessage(error));
    }
  }, [playingMedia, showToast, navigation, t]);

  const openRoomRankPanel = useCallback(async () => {
    if (!roomPlayer?.liveId) {
      setRankRows([]);
      setRankStatus(t('当前直播/回放缺少 liveId，不能获取贡献榜'));
      setRankVisible(true);
      return;
    }
    setRankVisible(true);
    setRankStatus('');
    try {
      const res = await pocketApi.getLiveRank(String(roomPlayer.liveId));
      const rows = normalizeLiveRank(res);
      setRankRows(rows);
      setRankStatus(rows.length ? t('已加载 {count} 位贡献用户', { count: rows.length }) : t('贡献榜为空'));
    } catch (error) {
      setRankRows([]);
      setRankStatus(t('贡献榜加载失败：{msg}', { msg: errorMessage(error) }));
    }
  }, [roomPlayer, t]);

  const downloadMedia = useCallback(async (media: RoomMedia) => {
    try {
      let next = media;
      if ((media.type === 'live' || media.liveId) && !media.url) {
        next = await resolveRoomLiveMedia(media);
      }
      const url = next.url || media.url;
      if (!url) {
        showToast(t('没有可下载地址'));
        return;
      }
      await enqueueDownload({
        url,
        type: next.type === 'live' ? 'replay' : next.type === 'audio' ? 'voice' : next.type === 'image' ? 'image' : next.type === 'video' ? 'video' : 'file',
        name: next.title,
      });
      showToast(t('已加入下载管理'));
    } catch (error) {
      showToast(t('下载失败：{msg}', { msg: errorMessage(error) }));
    }
  }, [showToast, t]);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let list = followed;
    if (q) {
      list = followed.filter((item) => {
        const member = item.member;
        if (!member) return false;
        return memberSearchText(member).includes(q);
      });
    }
    const pinnedIds = new Set(pinned);
    // 置顶成员按 pinned 数组顺序排列（可调换），未置顶保持原序
    const pinIdx = (id: string) => pinned.indexOf(id);
    return [...list].sort((a, b) => {
      const pa = pinnedIds.has(a.memberId) ? pinIdx(a.memberId) : Number.MAX_SAFE_INTEGER;
      const pb = pinnedIds.has(b.memberId) ? pinIdx(b.memberId) : Number.MAX_SAFE_INTEGER;
      if (pa !== pb) return pa - pb;
      return 0;
    });
  }, [followed, searchQuery, pinned]);

  // 搜索时从全量成员库匹配（未关注的成员可直接在此关注）
  const memberHits = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return members
      .filter((m) => memberSearchText(m).includes(q))
      .sort((a, b) => {
        // 已关注排前，方便快速打开房间
        const af = followedIds.has(String((a as any).id || (a as any).userId || '')) ? 0 : 1;
        const bf = followedIds.has(String((b as any).id || (b as any).userId || '')) ? 0 : 1;
        return af - bf;
      })
      .slice(0, 10);
  }, [members, searchQuery, followedIds]);

  const filteredRoomMessages = useMemo(() => {
    const q = roomSearchQuery.trim().toLowerCase();
    if (!q || !selectedRoom) return roomMessages;
    return roomMessages.filter((item) => {
      const profile = senderProfile(item, selectedRoom);
      const text = messageText(item);
      return [
        text,
        profile.name,
        profile.id,
        selectedRoom.ownerName,
        selectedRoom.team,
        selectedRoom.groupName,
      ].some((value) => String(value || '').toLowerCase().includes(q));
    });
  }, [roomMessages, roomSearchQuery, selectedRoom]);

  // 消息流按日期分组：今天/昨天/月日 分隔条（消息是新→旧排序，分隔条插在换日处）
  const chatRows = useMemo(() => {
    const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
    const fmt = (ms: number) => {
      const d = new Date(ms);
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    };
    const now = new Date();
    const todayStr = fmt(now.getTime());
    const yestStr = fmt(now.getTime() - 86400000);
    const rows: { type: 'date' | 'msg'; key: string; label?: string; item?: any; index?: number; groupStart?: boolean }[] = [];
    let lastDay = '';
    let lastGroupKey = '';
    let lastMsgTime = 0;
    filteredRoomMessages.forEach((item, index) => {
      const day = fmt(Number((item as any)?.msgTime || (item as any)?.ctime || 0) * (Number((item as any)?.msgTime) > 1e12 ? 1 : 1000));
      if (day !== lastDay) {
        lastDay = day;
        lastGroupKey = '';
        const label = day === todayStr ? t('今天') : day === yestStr ? t('昨天') : `${Number(day.slice(5, 7))}月${Number(day.slice(8, 10))}日`;
        rows.push({ type: 'date', key: `d-${day}`, label });
      }
      // 同一发送者、间隔 < 3 分钟的消息合并为一组（组首带头像+名字，后续连排）
      const t0 = getMessageTime(item);
      // 用 senderProfile 的 id 做分组键（覆盖 senderUserId/senderId/fromUserId/user.userId 等全部来源）
      const sender = senderProfile(item, selectedRoom!).id || String((item as any)?.fromAccount || '');
      const sameSender = sender && sender === lastGroupKey;
      const withinGap = t0 > 0 && lastMsgTime > 0 && (lastMsgTime - t0) < 3 * 60000;
      const groupStart = !sameSender || !withinGap;
      if (groupStart) lastGroupKey = sender;
      if (t0 > 0) lastMsgTime = t0;
      rows.push({ type: 'msg', key: messageKey(item, index), item, index, groupStart });
    });
    return rows;
  }, [filteredRoomMessages, selectedRoom, t]);

  if (selectedRoom) {
    const fid = String(selectedRoom.id || '');
    const isFollowingRoom = followedIds.has(fid);
    const followBusyRoom = followBusy.has(fid);
    const headerTitle = roomMeta.name ? capText(roomMeta.name, 18) : shortName(selectedRoom);
    const roomBgUri = roomMeta.bg || '';
    const roomScrim = resolvedTheme === 'dark' ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.42)';
    return (
      <View style={[styles.container]}>
        {roomBgUri ? (
          <>
            <ImageBackground source={{ uri: roomBgUri }} resizeMode="cover" style={styles.roomBgLayer} onError={() => setRoomMeta((m) => ({ ...m, bg: '' }))} />
            <View pointerEvents="none" style={[styles.roomBgLayer, { backgroundColor: roomScrim }]} />
          </>
        ) : null}
        {roomPlayer ? (
          <View style={[styles.roomPlayerPage, roomPlayerFullscreen && styles.roomPlayerPageFullscreen]}>
            {!roomPlayerFullscreen ? <View style={styles.roomPlayerHeader}>
              <TouchableOpacity onPress={closeRoomPlayer} style={styles.roomPlayerBack} activeOpacity={0.85}>
                <Text style={[styles.roomPlayerBackText, { color: palette.tint }]}>{t('返回房间')}</Text>
              </TouchableOpacity>
              <Text style={styles.roomPlayerTitle} numberOfLines={1}>{roomPlayer.title}</Text>
              <TouchableOpacity onPress={handleRoomMiniPlayer} style={styles.roomPlayerTool} activeOpacity={0.85} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                <MaterialCommunityIcons name="picture-in-picture-bottom-right-outline" size={17} color={palette.tint} />
              </TouchableOpacity>
              <TouchableOpacity onPress={openRoomRankPanel} style={styles.roomPlayerTool} activeOpacity={0.85} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                <Text style={styles.roomPlayerToolText}>{t('贡献榜')}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setRoomPlayerFullscreen(true)} style={styles.roomPlayerTool} activeOpacity={0.85} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                <Text style={styles.roomPlayerToolText}>{t('全屏')}</Text>
              </TouchableOpacity>
            </View> : (
              <TouchableOpacity onPress={() => setRoomPlayerFullscreen(false)} style={styles.exitRoomFullscreenBtn} activeOpacity={0.85}>
                <Text style={styles.exitRoomFullscreenText}>{t('退出全屏')}</Text>
              </TouchableOpacity>
            )}
            {roomPlayer.needsVlc && Platform.OS === 'android' && LiveExoView ? (
              <LiveExoView style={styles.roomNativeVideo} url={roomPlayer.url} />
            ) : (
              <Video
                source={playerSource(roomPlayer.url)}
                style={styles.roomNativeVideo}
                controls
                paused={false}
                resizeMode="contain"
                ignoreSilentSwitch="ignore" playInBackground playWhenInactive
              />
            )}
            <Modal visible={rankVisible} transparent animationType="slide" onRequestClose={() => setRankVisible(false)}>
              <View style={styles.roomModalShade}>
                <View style={[styles.roomRankPanel, { backgroundColor: palette.surface }]}>
                  {/* 顶部 handle */}
                  <View style={styles.roomRankHandleWrap}>
                    <View style={[styles.roomRankHandle, { backgroundColor: palette.fill3 }]} />
                  </View>
                  <View style={styles.roomRankHeader}>
                    <Text style={[styles.roomRankTitle, { color: palette.label }]}>{t('贡献榜')}</Text>
                    <ScalePressable onPress={() => setRankVisible(false)} pressedScale={0.92} activeOpacity={0.8} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                      <View style={[styles.roomRankClose, { backgroundColor: palette.fill2 }]}>
                        <MaterialCommunityIcons name="close" color={palette.labelSecondary} size={18} />
                      </View>
                    </ScalePressable>
                  </View>
                  <Text style={[styles.roomRankStatus, { color: palette.labelSecondary }]}>{rankStatus}</Text>
                  <ScrollView style={styles.roomRankList} showsVerticalScrollIndicator={false}>
                    {(() => {
                      // 归一化进度条：取最高贡献值作为基准
                      const maxValue = rankRows.reduce((max, r) => Math.max(max, Number(r.value) || 0), 0);
                      return rankRows.map((row, index) => {
                        const valNum = Number(row.value) || 0;
                        const progress = maxValue > 0 ? Math.max(0, Math.min(1, valNum / maxValue)) : 0;
                        return (
                          <View key={String(row.userId || row.id || index)} style={[styles.roomRankRow, { borderBottomColor: palette.hairline }]}>
                            <Text style={[styles.roomRankNo, { color: palette.tint }]}>{row.rank || index + 1}</Text>
                            {row.avatar ? <Image source={{ uri: row.avatar }} style={[styles.roomRankAvatar, { backgroundColor: palette.fill3 }]} /> : <View style={[styles.roomRankAvatar, { backgroundColor: palette.fill3 }]} />}
                            <View style={styles.roomRankInfo}>
                              <Text style={[styles.roomRankName, { color: palette.label }]} numberOfLines={1}>{row.name}</Text>
                              <View style={[styles.roomRankProgressTrack, { backgroundColor: palette.fill3 }]}>
                                <View style={[styles.roomRankProgressFill, { width: `${progress * 100}%`, backgroundColor: palette.tint }]} />
                              </View>
                            </View>
                            <Text style={[styles.roomRankValue, { color: palette.labelSecondary }]} numberOfLines={1}>{row.value ? t('贡献 {value}', { value: row.value }) : t('贡献用户')}</Text>
                          </View>
                        );
                      });
                    })()}
                  </ScrollView>
                </View>
              </View>
            </Modal>
          </View>
        ) : null}
        <ZoomImageModal url={fullImageUrl} onClose={() => setFullImageUrl('')} />
        <ScreenHeader title={headerTitle} onBack={closeRoom} overlay={!!roomBgUri} right={
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <TouchableOpacity
              style={[styles.followBtn, { backgroundColor: isFollowingRoom ? palette.tintSoft : palette.tint }]}
              disabled={followBusyRoom}
              onPress={() => toggleFollow(selectedRoom)}
              activeOpacity={0.85}
              hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
            >
              {followBusyRoom ? (
                <ActivityIndicator color={isFollowingRoom ? palette.tint : palette.onTint} size="small" />
              ) : (
                <Text style={[styles.followBtnText, { color: isFollowingRoom ? palette.tint : palette.onTint }]}>{isFollowingRoom ? t('已关注') : t('关注')}</Text>
              )}
            </TouchableOpacity>
          </View>
        } />

          {/* 聊天工具条：高斯模糊玻璃（按深浅色 tint，不挡房间背景）*/}
          <View style={[styles.chatToolsClip, { borderColor: palette.innerStroke }]}>
            <BlurView
              intensity={70}
              tint={resolvedTheme === 'dark' ? 'dark' : 'light'}
              experimentalBlurMethod="dimezisBlurView"
              style={styles.chatTools}
            >
          {/* 分段切换：大房间 / 小房间 */}
          <View style={[styles.segment, { backgroundColor: palette.fill2 }]}>
            <TouchableOpacity
              style={[styles.segmentItem, roomMode === 'big' && { backgroundColor: palette.tint }]}
              onPress={() => openRoom(selectedRoom, 'big', showFanMessages)}
              activeOpacity={0.85}
            >
              <Text style={[styles.segmentText, { color: roomMode === 'big' ? palette.onTint : palette.labelSecondary }]}>{t('大房间')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.segmentItem, roomMode === 'small' && { backgroundColor: palette.tint }]}
              onPress={() => openRoom(selectedRoom, 'small', showFanMessages)}
              activeOpacity={0.85}
            >
              <Text style={[styles.segmentText, { color: roomMode === 'small' ? palette.onTint : palette.labelSecondary }]}>{t('小房间')}</Text>
            </TouchableOpacity>
          </View>
          <View style={{ flex: 1 }} />
          <ScalePressable
            style={[styles.chatToolCircle, { backgroundColor: roomSearchOpen ? palette.tint : palette.fill2 }]}
            onPress={() => setRoomSearchOpen((v) => !v)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            pressedScale={0.9}
          >
            <MaterialCommunityIcons
              name={roomSearchOpen ? 'close' : 'magnify'}
              size={18}
              color={roomSearchOpen ? palette.onTint : palette.labelSecondary}
            />
          </ScalePressable>
          <ScalePressable
            style={[styles.chatToolCircle, { backgroundColor: showFanMessages ? palette.tint : palette.fill2 }]}
            onPress={() => openRoom(selectedRoom, roomMode, !showFanMessages)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            pressedScale={0.9}
          >
            <MaterialCommunityIcons
              name="account-group"
              size={18}
              color={showFanMessages ? palette.onTint : palette.labelSecondary}
            />
          </ScalePressable>
            </BlurView>
          </View>

        {roomSearchOpen ? (
          <View style={[styles.roomSearchBar, { backgroundColor: palette.fill2, borderColor: palette.hairline }]}>
            <MaterialCommunityIcons name="magnify" size={17} color={palette.labelTertiary} />
            <TextInput
              style={[styles.roomSearchInput, { color: palette.label }]}
              placeholder={t('搜索聊天记录、成员名、粉丝名...')}
              placeholderTextColor={palette.labelTertiary}
              value={roomSearchQuery}
              onChangeText={setRoomSearchQuery}
              autoFocus
              returnKeyType="search"
            />
            {roomSearchQuery ? (
              <TouchableOpacity onPress={() => setRoomSearchQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} activeOpacity={0.7}>
                <MaterialCommunityIcons name="close-circle" size={16} color={palette.labelTertiary} />
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}

        <FadeInView delay={80} duration={300} style={{ flex: 1 }}>
          <PerfFlatList
            data={chatRows}
            keyExtractor={(row: any) => String(row.key)}
            contentContainerStyle={styles.chatContent}
            initialNumToRender={12}
            maxToRenderPerBatch={12}
            windowSize={7}
            removeClippedSubviews
            onEndReached={loadMoreRoomMessages}
            onEndReachedThreshold={0.25}
            ListFooterComponent={
            roomMessages.length ? (
              <View style={styles.chatFooter}>
                {loadingMoreMessages ? (
                  <CenterSpinner />
                ) : hasMoreMessages ? (
                  <Text style={[styles.empty, { color: palette.labelTertiary }]}>{t('上滑加载更多')}</Text>
                ) : (
                  <Text style={[styles.empty, { color: palette.labelTertiary }]}>{t('没有更多消息')}</Text>
                )}
              </View>
            ) : null
          }
          ListEmptyComponent={
            loading ? (
              <CenterSpinner text={t('正在加载消息…')} />
            ) : roomSearchQuery.trim() ? (
              <Text style={[styles.empty, { color: palette.labelTertiary }]}>{t('没有匹配的消息')}</Text>
            ) : roomMsgError ? (
              <ErrorState title={t('加载失败')} hint={roomMsgError} onAction={() => selectedRoom && openRoom(selectedRoom, roomMode, showFanMessages)} />
            ) : (
              <EmptyState icon="message-text-outline" title={t('暂无消息，切换大/小房间试试')} />
            )
          }
          renderItem={({ item: row }: any) => {
            // 日期分隔条：居中胶囊 fill2 底
            if (row.type === 'date') {
              return (
                <View style={styles.chatDateRow}>
                  <View style={[styles.chatDatePill, { backgroundColor: palette.fill2 }]}>
                    <Text style={[styles.chatDateText, { color: palette.labelTertiary }]}>{row.label}</Text>
                  </View>
                </View>
              );
            }
            const item = row.item;
            const index = row.index;
            const role = messageRole(item, selectedRoom, showFanMessages, currentUserId);
            const mine = role === 'mine';
            const idol = role === 'idol';
            const msgProfile = senderProfile(item, selectedRoom);
            const profile = idol
              ? { id: selectedRoom.id, name: (msgProfile.name || '').trim() || shortName(selectedRoom), avatar: msgProfile.avatar || selectedRoom.avatar }
              : msgProfile;
            const media = roomMedia(item);
            const gift = roomGiftInfo(item);
            const payload = messagePayload(item) as any;
            const replyInfo = payload?.replyInfo || payload?.giftReplyInfo;
            const replyName = replyInfo?.replyName || '';
            const replyQuoted = replyInfo?.replyText || '';
            const body = messageText(item);
            let giftReplyText = '';
            if (gift) {
              const gr = payload?.giftReplyInfo || {};
              giftReplyText = gr.text || payload.text || payload.body || gr.replyName || gr.replyText || '';
              if (typeof giftReplyText === 'string') giftReplyText = giftReplyText.trim();
              else giftReplyText = '';
            }
            const isMediaLabel = /^\[(语音|图片|视频|链接|直播)\]/.test(body);
            const looksLikeFile = !media && /^https?:\/\//i.test(String(body || '')) || /\.(amr|mp3|m4a|aac|mp4|mov|jpg|jpeg|png|gif|webp)(\?|$)/i.test(String(body || ''));
            const bubbleText = gift ? giftReplyText : (media ? (!isMediaLabel ? body : '') : (looksLikeFile ? '' : body));
            const canInlinePlay = media?.type === 'audio' || media?.type === 'video' || media?.type === 'live';

            return (
              <View style={[styles.chatRow, mine && styles.chatRowMine, !row.groupStart && styles.chatRowTight]}>
                {!mine ? (
                  row.groupStart ? (
                    profile.avatar ? (
                      <Image source={{ uri: profile.avatar }} style={styles.avatar} />
                    ) : (
                      <View style={[styles.avatarFallback, { backgroundColor: palette.fill2 }]}><Text style={[styles.avatarText, { color: palette.tint }]}>{avatarInitial(profile.name)}</Text></View>
                    )
                  ) : (
                    /* 组内连排：占位保持气泡左对齐 */
                    <View style={styles.avatarPlaceholder} />
                  )
                ) : null}
                <View style={[styles.msgBlock, mine && styles.msgBlockMine]}>
                  {/* 组首显示名字 + HH:mm；组内不重复 */}
                  {row.groupStart ? (
                    <View style={[styles.msgMetaLine, mine && styles.msgMetaLineMine]}>
                      <Text style={[styles.msgSender, { color: idol ? palette.tint : mine ? palette.tint : palette.labelSecondary }]} numberOfLines={1}>
                        {profile.name}
                      </Text>
                      <Text style={[styles.msgTime, { color: palette.labelTertiary }]}>
                        {formatTimestamp(item.msgTime).slice(11, 16)}
                      </Text>
                    </View>
                  ) : null}
                  <View style={[styles.msgBubble, idol && styles.msgBubbleIdol, mine && styles.msgBubbleMine, !row.groupStart && styles.msgBubbleMid, { backgroundColor: idol ? palette.tint : mine ? palette.tint : palette.surfaceGlass, borderColor: idol || mine ? 'rgba(255,255,255,0.38)' : palette.innerStroke, borderWidth: !row.groupStart ? 0 : StyleSheet.hairlineWidth }]}>
                    {replyName || replyQuoted ? (
                      <View style={[styles.replyCard, { backgroundColor: (idol || mine) ? 'rgba(255,255,255,0.18)' : palette.fill2, borderLeftColor: (idol || mine) ? 'rgba(255,255,255,0.85)' : palette.tint }]}>
                        {replyName ? <Text style={[styles.replyName, { color: (idol || mine) ? palette.onTint : palette.tint }]} numberOfLines={1}>{replyName}</Text> : null}
                        {replyQuoted ? <Text style={[styles.replyText, { color: (idol || mine) ? 'rgba(255,255,255,0.85)' : palette.labelSecondary }]} numberOfLines={3}>{replyQuoted}</Text> : null}
                      </View>
                    ) : null}
                    {bubbleText ? (
                      <Text style={[styles.msgBody, (idol || mine) && styles.msgBodyHighlight, (idol || mine) ? { color: palette.onTint } : { color: palette.labelSecondary }]}>
                        {bubbleText}
                      </Text>
                    ) : null}
                    {gift && !giftReplyText ? (
                      <View style={[styles.giftCard, { backgroundColor: palette.fill2, borderColor: palette.tintSoft }, giftReplyText ? styles.giftCardCompact : null]}>
                        {!giftReplyText ? (gift.image ? <Image source={{ uri: gift.image }} style={[styles.giftImage, { backgroundColor: palette.surface }]} /> : <View style={[styles.giftImageFallback, { backgroundColor: palette.tint }]}><MaterialCommunityIcons name="gift" size={16} color={palette.onTint} /></View>) : null}
                        <View style={styles.giftTextWrap}>
                          <Text style={[styles.giftName, { color: palette.label }]} numberOfLines={1}>{idol ? t('感谢礼物') : t('送出礼物')}：{gift.name}</Text>
                          <Text style={[styles.giftMeta, { color: palette.labelSecondary }]}>{t('数量')} x{gift.num}{gift.total ? ` · ${gift.total}` : ''}</Text>
                        </View>
                      </View>
                    ) : null}
                    {media ? (
                      media.type === 'image' && media.url ? (
                      <>
                        <TouchableOpacity onPress={() => setFullImageUrl(media.url)} onLongPress={() => downloadMedia(media)} activeOpacity={0.9}>
                          <Image source={{ uri: media.url }} style={media.title === t('表情') ? styles.inlineSticker : styles.inlineImage} resizeMode="cover" />
                        </TouchableOpacity>
                      </>
                    ) : media.type === 'live' && media.cover ? (
                      // 直播/录播：封面 + 播放按钮 + 底部标题条
                      <TouchableOpacity style={styles.liveCardWrap} onPress={() => playMedia(media)} onLongPress={() => downloadMedia(media)} activeOpacity={0.9}>
                        <Image source={{ uri: media.cover }} style={styles.liveCardImg} resizeMode="cover" />
                        <View style={styles.liveCardOverlay}>
                          <View style={styles.livePlayCircle}>
                            <MaterialCommunityIcons name="play" size={22} color="#FFFFFF" style={{ marginLeft: 3 }} />
                          </View>
                        </View>
                        <View style={styles.liveCardTitleBar}>
                          <Text style={styles.liveCardTitle} numberOfLines={1}>{media.title}</Text>
                        </View>
                      </TouchableOpacity>
                    ) : media.type === 'video' && media.url ? (
                      // 视频消息：优先用服务器封面，否则用视频首帧（paused 渲染）做封面
                      <VideoCoverCard media={media} onPress={() => playMedia(media)} onLongPress={() => downloadMedia(media)} />
                    ) : (
                      <TouchableOpacity style={[styles.mediaCard, { backgroundColor: (idol || mine) ? palette.tint : palette.surfaceGlass, borderColor: (idol || mine) ? 'rgba(255,255,255,0.38)' : palette.innerStroke, borderWidth: StyleSheet.hairlineWidth }]} activeOpacity={0.92} onLongPress={() => downloadMedia(media)}>
                        {media.cover ? (
                          <Image source={{ uri: media.cover }} style={styles.liveCover} resizeMode="cover" />
                        ) : null}
                        <View style={styles.mediaMeta}>
                          <Text style={[styles.mediaIcon, (idol || mine) ? { color: palette.onTint } : { color: palette.tint }]}>{t(mediaLabel(media.type))}</Text>
                          {media.type !== 'audio' && media.type !== 'video' && media.title ? (
                            <Text style={[styles.mediaTitle, (idol || mine) ? { color: palette.onTint } : { color: palette.label }]} numberOfLines={2}>{media.title}</Text>
                          ) : null}
                          {media.duration ? <Text style={[styles.mediaDuration, (idol || mine) ? { color: palette.onTint } : { color: palette.labelSecondary }]}>{media.duration}s</Text> : null}
                        </View>
                        <TouchableOpacity
                          style={[styles.mediaPlayBtn, { backgroundColor: palette.tint, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 }]}
                          onPress={() => playMedia(media)}
                          activeOpacity={0.85}
                        >
                          <MaterialCommunityIcons
                            name={playingMedia?.url && media.url && playingMedia.url === media.url ? 'pause' : 'play'}
                            size={14}
                            color={palette.onTint}
                          />
                          <Text style={[styles.mediaPlayText, { color: palette.onTint }]}>
                            {playingMedia?.url && media.url && playingMedia.url === media.url ? t('暂停') : media.duration ? `${media.duration}s` : t('播放')}
                          </Text>
                        </TouchableOpacity>
                      </TouchableOpacity>
                    )) : (!bubbleText && !gift) ? (
                      <Text style={[styles.msgBody, (idol || mine) && styles.msgBodyHighlight, (idol || mine) ? { color: palette.onTint } : { color: palette.labelSecondary }]}>{t('[空消息]')}</Text>
                    ) : null}
                    {media?.url && playingMedia?.url === media.url ? (
                      media.type === 'link' ? (
                        <TouchableOpacity style={styles.openLinkBtn} onPress={() => Linking.openURL(media.url).catch(() => {})} activeOpacity={0.85}>
                          <Text style={[styles.openLinkText, { color: palette.tint }]} numberOfLines={1}>{media.url}</Text>
                        </TouchableOpacity>
                      ) : media.type === 'audio' ? (
                        <View style={styles.inlineAudioWrap}>
                          <Video
                            source={playerSource(media.url)}
                            style={styles.inlineAudioHidden}
                            paused={false}
                            ignoreSilentSwitch="ignore" playInBackground playWhenInactive
                            onEnd={() => setPlayingMedia(null)}
                          />
                        </View>
                      ) : (
                        <Video
                          source={playerSource(media.url)}
                          style={styles.inlineVideo}
                          controls
                          paused={false}
                          resizeMode="contain"
                          ignoreSilentSwitch="ignore" playInBackground playWhenInactive
                        />
                      )
                    ) : null}
                  </View>
                </View>
              </View>
            );
          }}
        />
        </FadeInView>
      </View>
    );
  }

  return (
    <View style={[styles.container]}>
      <ScreenHeader title={t('房间')} hideBack right={
        <View style={styles.headerActions}>
          <TouchableOpacity onPress={() => { if (searchOpen) setSearchQuery(''); setSearchOpen((v) => !v); }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} activeOpacity={0.85}>
            <MaterialCommunityIcons
              name={searchOpen ? 'close' : 'magnify'}
              size={22}
              color={palette.label}
            />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => loadFollowed()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} activeOpacity={0.85}>
            <MaterialCommunityIcons name="refresh" size={22} color={palette.label} />
          </TouchableOpacity>
        </View>
      } />

      {searchOpen ? (
        <View style={[styles.searchBar, { backgroundColor: palette.fill2, borderColor: palette.hairline }]}>
          <MaterialCommunityIcons name="magnify" size={18} color={palette.labelTertiary} />
          <TextInput
            style={[styles.searchInput, { color: palette.label }]}
            placeholder={t('搜索成员...')}
            placeholderTextColor={palette.labelTertiary}
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoFocus
            returnKeyType="search"
          />
          {searchQuery ? (
            <TouchableOpacity onPress={() => setSearchQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} activeOpacity={0.85}>
              <MaterialCommunityIcons name="close-circle" size={16} color={palette.labelTertiary} />
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

      <FadeInView delay={80} duration={300} style={{ flex: 1 }}>
        {searchOpen && searchQuery.trim() ? (
          /* 搜索态：成员库结果直接走 FlatList（可滚动、虚拟化） */
          memberHits.length === 0 ? (
            <Text style={[styles.memberHitsEmpty, { color: palette.labelTertiary }]}>{t('没有匹配的成员')}</Text>
          ) : (
          <PerfFlatList
            data={memberHits}
            keyExtractor={(member: any) => String((member as any).id || (member as any).userId || member.ownerName)}
            contentContainerStyle={styles.memberHitsListContent}
            numColumns={2}
            columnWrapperStyle={styles.memberGridRow}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item: member, index }) => {
              const mid = String((member as any).id || (member as any).userId || '');
              const isFollowing = followedIds.has(mid);
              const busy = followBusy.has(mid);
              const name = shortName(member, mid);
              return (
                <FadeInView delay={index < 12 ? 80 + index * 30 : 0} duration={300} style={styles.memberGridItem}>
                  <TouchableOpacity
                    style={[
                      styles.memberHitCard,
                      { backgroundColor: palette.surface, borderColor: palette.hairline, borderWidth: StyleSheet.hairlineWidth },
                    ]}
                    onPress={() => openRoom(member)}
                    activeOpacity={0.88}
                  >
                    <View style={[styles.memberHitAvatar, { backgroundColor: palette.tintSoft, borderColor: palette.hairline }]}>
                      {member.avatar ? (
                        <Image source={{ uri: member.avatar }} style={styles.memberHitAvatarImg} />
                      ) : (
                        <Text style={[styles.memberHitAvatarText, { color: palette.tint }]}>{avatarInitial(name)}</Text>
                      )}
                    </View>
                    <Text style={[styles.memberHitName, { color: palette.label }]} numberOfLines={1}>{name}</Text>
                    <Text style={[styles.memberHitTeam, { color: palette.labelTertiary }]} numberOfLines={1}>
                      {member.team || member.groupName || t('成员')}
                    </Text>
                    <TouchableOpacity
                      style={[styles.memberHitBtn, { backgroundColor: isFollowing ? palette.tintSoft : palette.tint }]}
                      disabled={busy}
                      onPress={() => toggleFollow(member)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      activeOpacity={0.85}
                    >
                      {busy ? (
                        <ActivityIndicator color={isFollowing ? palette.tint : palette.onTint} size="small" />
                      ) : (
                        <Text style={[styles.memberHitBtnText, { color: isFollowing ? palette.tint : palette.onTint }]}>
                          {isFollowing ? t('已关注') : t('关注')}
                        </Text>
                      )}
                    </TouchableOpacity>
                  </TouchableOpacity>
                </FadeInView>
              );
            }}
          />
          )
        ) : (
        <PerfFlatList
          key="rooms-list"
          data={filtered}
          keyExtractor={(item) => String(item.memberId)}
          contentContainerStyle={styles.listContent}
          renderItem={({ item, index }) => {
            const fid = String(item.member?.id || item.memberId);
            const isFollowing = followedIds.has(fid);
            const busy = followBusy.has(fid);
            const isPinned = pinned.includes(item.memberId);
            const name = shortName(item.member, item.memberId);
            const team = item.member?.team || item.member?.groupName || '';
            const lastTime = Number(item.lastMessage?.msgTime || item.lastMessage?.ctime || 0);
            const lastText = item.lastMessage ? messageText(item.lastMessage) : '';
            // 直播中判定：以直播列表接口为准（id / liveRoomId / account / 昵称命中关注成员）
            const mid = String(item.member?.id || item.memberId);
            const mroom = String((item.member as any)?.liveRoomId || '');
            const macct = String((item.member as any)?.account || '');
            const mnick = String(item.member?.ownerName || '').replace(/^(SNH48|GNZ48|BEJ48|CKG48|CGT48)-/i, '').trim().toLowerCase();
            const isLiveNow = liveNow.ids.has(mid) || (mroom && liveNow.ids.has(mroom)) || (macct && liveNow.ids.has(macct)) || (mnick && liveNow.names.has(mnick));
            return (
            <FadeInView delay={index < 12 ? 80 + index * 30 : 0} duration={300} style={styles.roomRow}>
              <View style={[styles.roomRowCard, { backgroundColor: palette.surface, borderColor: palette.hairline, borderWidth: StyleSheet.hairlineWidth }]}>
                <ScalePressable
                  style={styles.roomRowMain}
                  onPress={() => item.member && openRoom(item.member)}
                  pressedScale={0.98}
                  activeOpacity={0.9}
                >
                  {/* 封面 56 圆角 12 */}
                  <View style={[styles.roomCover, { backgroundColor: palette.tintSoft, borderColor: palette.hairline }]}>
                    {item.member?.avatar ? (
                      <Image source={{ uri: item.member.avatar }} style={styles.roomCoverImg} />
                    ) : (
                      <Text style={[styles.roomCoverText, { color: palette.tint }]} numberOfLines={1}>{avatarInitial(name)}</Text>
                    )}
                  </View>
                  <View style={styles.roomInfo}>
                    <View style={styles.roomNameRow}>
                      <Text style={[styles.roomName, { color: palette.label }]} numberOfLines={1}>{name}</Text>
                      {/* 在线状态点：有最近消息视为在线 */}
                      <View style={[styles.statusDot, { backgroundColor: isLiveNow ? palette.success : palette.labelTertiary }]} />
                      {isLiveNow ? (
                        <View style={[styles.liveBadgeChip, { backgroundColor: palette.tint }]}>
                          <MaterialCommunityIcons name="broadcast" size={10} color={palette.onTint} />
                          <Text style={styles.liveBadgeChipText}>{t('直播中')}</Text>
                        </View>
                      ) : null}
                      {isPinned ? (
                        <View style={[styles.pinTagChip, { backgroundColor: palette.tintSoft }]}>
                          <MaterialCommunityIcons name="pin" size={10} color={palette.tint} />
                          <Text style={[styles.pinTagChipText, { color: palette.tint }]}>{t('置顶')}</Text>
                        </View>
                      ) : null}
                    </View>
                    {team ? (
                      <Text style={[styles.roomTeam, { color: palette.labelTertiary }]} numberOfLines={1}>{team}</Text>
                    ) : null}
                    <Text style={[styles.roomLast, { color: palette.labelSecondary }]} numberOfLines={1}>
                      {lastText || t('点击查看房间消息')}
                    </Text>
                    <View style={styles.roomFoot}>
                      <Text style={[styles.roomTime, { color: palette.labelTertiary }]} numberOfLines={1}>
                        {lastTime ? formatTimestamp(lastTime).slice(5, 16) : ''}
                      </Text>
                    </View>
                  </View>
                </ScalePressable>
                <View style={styles.roomActions}>
                  {isPinned && pinned.length > 1 ? (
                    /* 排序胶囊：单个圆角方块内竖向排列 ↑ / ↓，整体像一个排序手柄 */
                    <View style={[styles.sortCapsule, { backgroundColor: palette.fill2, borderColor: palette.hairline }]}>
                      <ScalePressable
                        style={styles.sortHalfV}
                        onPress={() => movePin(item.memberId, -1)}
                        pressedScale={0.8}
                        hitSlop={{ top: 4, bottom: 1, left: 6, right: 6 }}
                        disabled={pinned.indexOf(item.memberId) === 0}
                      >
                        <MaterialCommunityIcons name="chevron-up" size={14} color={pinned.indexOf(item.memberId) === 0 ? palette.labelTertiary : palette.labelSecondary} />
                      </ScalePressable>
                      <View style={[styles.sortDividerV, { backgroundColor: palette.innerStroke }]} />
                      <ScalePressable
                        style={styles.sortHalfV}
                        onPress={() => movePin(item.memberId, 1)}
                        pressedScale={0.8}
                        hitSlop={{ top: 1, bottom: 4, left: 6, right: 6 }}
                        disabled={pinned.indexOf(item.memberId) === pinned.length - 1}
                      >
                        <MaterialCommunityIcons name="chevron-down" size={14} color={pinned.indexOf(item.memberId) === pinned.length - 1 ? palette.labelTertiary : palette.labelSecondary} />
                      </ScalePressable>
                    </View>
                  ) : null}
                  <ScalePressable
                    style={[styles.roomPinBtn, { backgroundColor: isPinned ? palette.tintSoft : palette.fill2 }]}
                    onPress={() => togglePin(item.memberId)}
                    pressedScale={0.9}
                    hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                  >
                    <MaterialCommunityIcons
                      name={isPinned ? 'pin' : 'pin-outline'}
                      size={15}
                      color={isPinned ? palette.tint : palette.labelTertiary}
                    />
                  </ScalePressable>
                  <ScalePressable
                    style={[styles.roomFollowBtn, { backgroundColor: isFollowing ? palette.tintSoft : palette.fill2 }]}
                    disabled={busy}
                    pressedScale={0.9}
                    activeOpacity={0.85}
                    hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                    onPress={() => {
                      if (isFollowing) {
                        Alert.alert(
                          t('取消关注'),
                          t('确定不再关注 {name} 吗？', { name: shortName(item.member, item.memberId) }),
                          [
                            { text: t('保留'), style: 'cancel' },
                            { text: t('取消关注'), style: 'destructive', onPress: () => item.member && toggleFollow(item.member) },
                          ],
                        );
                      } else if (item.member) {
                        toggleFollow(item.member);
                      }
                    }}
                  >
                    {busy ? (
                      <ActivityIndicator color={palette.tint} size="small" />
                    ) : (
                      <MaterialCommunityIcons
                        name={isFollowing ? 'heart' : 'heart-outline'}
                        size={17}
                        color={isFollowing ? palette.tint : palette.labelTertiary}
                      />
                    )}
                  </ScalePressable>
                </View>
              </View>
            </FadeInView>
            );
          }}
          ListEmptyComponent={
            searchOpen && searchQuery.trim() ? null : loading ? (
            <CenterSpinner text={t('加载中…')} />
          ) : !token ? (
            <EmptyState
              icon="account-key-outline"
              title={t('登录后可查看关注房间和最新消息')}
              actionLabel={t('去登录')}
              onAction={() => navigation.navigate('LoginScreen')}
            />
          ) : followedError ? (
            <ErrorState title={t('加载失败')} hint={followedError} onAction={() => loadFollowed(true)} />
          ) : (
            <EmptyState icon="heart-outline" title={t('暂无关注房间')} />
          )}
          initialNumToRender={12}
          maxToRenderPerBatch={12}
          windowSize={7}
          removeClippedSubviews
        />
        )}
      </FadeInView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  roomBgLayer: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
  chatToolsClip: { marginHorizontal: 12, marginBottom: 8, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  chatTools: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 6, borderRadius: 18 },
  segment: {
    flexDirection: 'row',
    borderRadius: radii.pill,
    padding: 3,
    gap: 2,
  },
  segmentItem: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 64,
  },
  segmentText: { fontSize: 12, fontWeight: '800' },
  chatToolCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chatDateRow: {
    alignItems: 'center',
    paddingVertical: 10,
  },
  chatDatePill: {
    alignSelf: 'center',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: radii.pill,
  },
  chatDateText: { fontSize: 11, fontWeight: '600' },
  roomSearchWrap: { paddingHorizontal: 16, paddingBottom: 8 },
  roomSearchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: 12,
    height: 40,
    borderRadius: radiiAlias.input,
    borderWidth: StyleSheet.hairlineWidth,
  },
  roomSearchInput: { flex: 1, fontSize: 14, padding: 0, height: 40 },
  input: { flex: 1, padding: 10, borderRadius: radiiAlias.input, borderWidth: StyleSheet.hairlineWidth },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 10,
    paddingHorizontal: 12,
    height: 40,
    borderRadius: radiiAlias.input,
    borderWidth: StyleSheet.hairlineWidth,
  },
  searchInput: { flex: 1, fontSize: 15, padding: 0 },
  memberHitsListContent: { paddingHorizontal: 8, paddingBottom: 112 },
  memberHitCard: {
    flex: 1,
    padding: 14,
    borderRadius: 18,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 1,
    marginBottom: 8,
  },
  memberHitAvatar: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  memberHitAvatarImg: { width: 68, height: 68, borderRadius: 34 },
  memberHitAvatarText: { fontSize: 22, fontWeight: '800' },
  memberHitName: { fontSize: 16, fontWeight: '800', marginTop: 10, maxWidth: '90%' },
  memberHitTeam: { fontSize: 12, marginTop: 3 },
  memberHitBtn: {
    paddingHorizontal: 18,
    paddingVertical: 7,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 64,
    marginTop: 10,
  },
  memberHitBtnText: { fontSize: 13, fontWeight: '800' },
  memberHitsEmpty: { textAlign: 'center', marginTop: 40, fontSize: 14 },
  memberGridRow: { paddingHorizontal: 8 },
  memberGridItem: { width: '50%', padding: 4 },
  memberCard: {
    flex: 1,
    padding: 14,
    borderRadius: 18,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 1,
  },
  memberPin: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  memberAvatar: {
    width: 76,
    height: 76,
    borderRadius: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  memberAvatarImg: { width: 76, height: 76, borderRadius: 38 },
  memberAvatarText: { fontSize: 26, fontWeight: '800' },
  memberInfo: { alignSelf: 'stretch', marginTop: 12 },
  memberNameRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  memberName: { fontSize: 17, fontWeight: '800', flexShrink: 1 },
  memberTeam: { fontSize: 12, fontWeight: '700', textAlign: 'center', marginTop: 4 },
  memberLast: { fontSize: 13, lineHeight: 18, textAlign: 'center', marginTop: 6 },
  memberFoot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  memberTime: { fontSize: 12 },
  listContent: { paddingBottom: 112, paddingTop: 4 },
  /** 房间行卡：封面 56 圆角 12 + 房间名 + 状态点 + 直播中徽标 */
  roomRow: { paddingHorizontal: 16, marginBottom: 8 },
  roomRowCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  roomRowMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
  },
  roomCover: {
    width: 56,
    height: 56,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  roomCoverImg: { width: 56, height: 56, borderRadius: 12 },
  roomCoverText: { fontSize: 22, fontWeight: '800' },
  roomInfo: { flex: 1, minWidth: 0, marginLeft: 12 },
  roomNameRow: { flexDirection: 'row', alignItems: 'center' },
  roomName: { fontSize: 15, fontWeight: '700', flexShrink: 1 },
  statusDot: { width: 8, height: 8, borderRadius: 4, marginLeft: 6 },
  liveBadgeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginLeft: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
  },
  liveBadgeChipText: { color: '#FFFFFF', fontSize: 9, fontWeight: '800' },
  roomTeam: { fontSize: 11, marginTop: 3, fontWeight: '600' },
  roomLast: { fontSize: 12, marginTop: 4, lineHeight: 16 },
  roomFoot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  roomTime: { fontSize: 11 },
  roomPinTag: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  pinTagChip: {
    flexDirection: 'row', alignItems: 'center', gap: 2,
    marginLeft: 8, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8,
  },
  pinTagChipText: { fontSize: 9, fontWeight: '800' },
  roomActions: { marginLeft: 6, gap: 6, alignItems: 'center', paddingRight: 12, paddingVertical: 10 },
  /* 排序胶囊：单个圆角方块内竖向排列 ↑ / ↓ */
  sortCapsule: {
    width: 32, height: 32, borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden',
  },
  sortHalfV: { width: 32, height: 15, alignItems: 'center', justifyContent: 'center' },
  sortDividerV: { width: 14, height: StyleSheet.hairlineWidth, alignSelf: 'center' },
  roomPinBtn: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  roomFollowBtn: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  chatContent: { paddingBottom: 132, paddingTop: 4 },
  followBtn: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: radiiAlias.button, alignItems: 'center', justifyContent: 'center', minWidth: 52, height: 26 },
  followBtnText: { fontSize: 11, fontWeight: '800' },
  chatFooter: { paddingVertical: 16, alignItems: 'center' },
  chatRow: { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: 12, marginTop: 7, marginBottom: 2 },
  chatRowTight: { marginTop: 2, marginBottom: 1 },
  chatRowMine: { justifyContent: 'flex-end' },
  avatar: { width: 40, height: 40, borderRadius: 20, marginRight: 9 },
  avatarPlaceholder: { width: 40, height: 40, marginRight: 9 },
  avatarFallback: { width: 40, height: 40, borderRadius: 20, marginRight: 9, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontWeight: '900', fontSize: 15 },
  msgBlock: { maxWidth: '78%', minWidth: 48 },
  msgBlockMine: { alignItems: 'flex-end' },
  replyCard: { marginBottom: 6, padding: 8, borderRadius: radii.sm, borderLeftWidth: 3, borderLeftColor: '#ff6f91' },
  replyName: { fontSize: 12, fontWeight: '700', marginBottom: 2 },
  replyText: { fontSize: 13, lineHeight: 18 },
  msgMetaLine: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4, paddingHorizontal: 6 },
  msgMetaLineMine: { justifyContent: 'flex-end' },
  msgSender: { fontSize: 12, fontWeight: '600', maxWidth: 150 },
  msgTime: { fontSize: 10 },
  msgBubble: { padding: 10, paddingHorizontal: 14, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth },
  msgBubbleMid: { borderRadius: 6 },
  msgBubbleIdol: { borderTopLeftRadius: 6 },
  msgBubbleMine: { borderTopRightRadius: 6 },
  msgBody: { fontSize: 15, lineHeight: 22 },
  msgBodyHighlight: {},
  giftCard: { marginTop: 8, minWidth: 210, padding: 10, borderRadius: radiiAlias.cardCompact, backgroundColor: 'rgba(255,240,246,0.88)', borderWidth: 1, borderColor: 'rgba(255,111,145,0.24)', flexDirection: 'row', alignItems: 'center', gap: 10 },
  giftCardCompact: { minWidth: 0, padding: 8, gap: 0 } as any,
  giftImage: { width: 34, height: 34, borderRadius: radii.xs, backgroundColor: '#fff' },
  giftImageFallback: { width: 34, height: 34, borderRadius: radii.xs, backgroundColor: '#ff6f91', alignItems: 'center', justifyContent: 'center' },
  giftEmoji: { color: '#fff', fontSize: 13, fontWeight: '800' },
  giftTextWrap: { flex: 1, minWidth: 0 },
  giftName: { fontSize: 13, fontWeight: '800' },
  giftMeta: { marginTop: 3, fontSize: 11 },
  mediaCard: { marginTop: 8, minWidth: 214, padding: 10, borderRadius: radiiAlias.cardCompact, borderWidth: StyleSheet.hairlineWidth },
  liveCover: { width: '100%', height: 130, borderRadius: 10, marginBottom: 8, backgroundColor: 'rgba(128,128,128,0.1)' },
  liveCardWrap: { marginTop: 8, width: 228, borderRadius: 14, overflow: 'hidden', backgroundColor: 'rgba(0,0,0,0.1)' },
  liveCardImg: { width: 228, height: 228, borderRadius: 14 },
  liveCardOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 36, alignItems: 'center', justifyContent: 'center' },
  videoCoverWrap: { marginTop: 8, width: 228, height: 228, borderRadius: 14, overflow: 'hidden', backgroundColor: 'rgba(0,0,0,0.1)', alignItems: 'center', justifyContent: 'center' },
  videoCoverImg: { width: 228, height: 228, borderRadius: 14 },
  videoCoverOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  videoCoverDuration: { position: 'absolute', right: 8, bottom: 8, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: 'rgba(0,0,0,0.5)' },
  videoCoverDurationText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  videoCoverPlaceholder: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.05)' },
  videoCoverPlaceholderText: { color: '#ff6f91', fontSize: 13, fontWeight: '800' },
  livePlayCircle: { width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
  livePlayIcon: { color: '#fff', fontSize: 24, marginLeft: 4 },
  liveCardTitleBar: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: 'rgba(0,0,0,0.5)' },
  liveCardTitle: { color: '#fff', fontSize: 13, fontWeight: '700' },
  mediaMeta: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  mediaIcon: { fontSize: 12, fontWeight: '900' },
  mediaTitle: { flex: 1, fontSize: 13, fontWeight: '800', lineHeight: 18 },
  mediaDuration: { fontSize: 11, fontWeight: '700' },
  mediaPlayBtn: { marginTop: 9, minHeight: 38, paddingVertical: 9, borderRadius: radiiAlias.button, alignItems: 'center', justifyContent: 'center' },
  mediaPlayText: { fontSize: 13, fontWeight: '900' },
  inlineAudio: { height: 52, minWidth: 224, marginTop: 8 },
  inlineAudioWrap: { height: 0, overflow: 'hidden' },
  inlineAudioHidden: { height: 0, width: 0 },
  inlineVideo: { height: 190, minWidth: 246, marginTop: 8, backgroundColor: '#000', borderRadius: 12 },
  inlineImage: { width: 228, height: 228, marginTop: 8, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.10)' },
  inlineSticker: { width: 120, height: 120, marginTop: 6, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.05)' },
  openLinkBtn: { marginTop: 8, padding: 8, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.10)', maxWidth: '100%', alignSelf: 'flex-start' },
  openLinkText: { color: '#ff6f91', fontSize: 11, fontWeight: '800' },
  roomPlayerPage: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, zIndex: 1000, elevation: 1000, backgroundColor: '#000' },
  roomPlayerPageFullscreen: { paddingTop: 0 },
  roomPlayerHeader: { flexDirection: 'row', alignItems: 'center', paddingTop: 44, paddingHorizontal: 10, paddingBottom: 8, backgroundColor: '#080808' },
  roomPlayerBack: { padding: 8 },
  roomPlayerBackText: { color: '#ff6f91', fontSize: 14, fontWeight: '900' },
  roomPlayerTitle: { flex: 1, color: '#fff', fontSize: 14, fontWeight: '800' },
  roomPlayerTool: { paddingHorizontal: 10, paddingVertical: 7, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.12)', marginLeft: 6 },
  roomPlayerToolText: { color: '#fff', fontSize: 12, fontWeight: '900' },
  exitRoomFullscreenBtn: { position: 'absolute', top: 14, right: 14, zIndex: 10, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.58)' },
  exitRoomFullscreenText: { color: '#fff', fontSize: 12, fontWeight: '900' },
  roomNativeVideo: { flex: 1, backgroundColor: '#000' },
  roomModalShade: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
  roomRankPanel: { maxHeight: '82%', padding: 14, paddingBottom: 24, borderTopLeftRadius: radii.sheet, borderTopRightRadius: radii.sheet },
  roomRankHandleWrap: { alignItems: 'center', paddingTop: 2, paddingBottom: 10 },
  roomRankHandle: { width: 40, height: 5, borderRadius: 3 },
  roomRankHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  roomRankClose: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  roomRankTitle: { fontSize: 18, fontWeight: '900' },
  roomRankStatus: { fontSize: 12, marginBottom: 10 },
  roomRankList: { maxHeight: 420 },
  roomRankRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  roomRankNo: { width: 24, fontSize: 13, fontWeight: '900', textAlign: 'center' },
  roomRankAvatar: { width: 34, height: 34, borderRadius: 17 },
  roomRankInfo: { flex: 1, minWidth: 0 },
  roomRankName: { fontSize: 13, fontWeight: '800' },
  roomRankProgressTrack: { height: 4, borderRadius: 2, marginTop: 6, overflow: 'hidden' },
  roomRankProgressFill: { height: 4, borderRadius: 2 },
  roomRankValue: { fontSize: 11, fontWeight: '700', marginLeft: 6, flexShrink: 1 },
  empty: { textAlign: 'center', marginTop: 60, fontSize: 14, paddingHorizontal: 24, lineHeight: 20 },
});
