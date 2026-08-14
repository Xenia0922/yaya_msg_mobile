import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PerfFlatList } from '../components/PerfFlatList';
import { useAppTheme } from '../hooks/useAppTheme';
import { usePalette } from '../theme';

import {
  ActivityIndicator,
  Alert,
  BackHandler,
  Image,
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
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ScreenOrientation from 'expo-screen-orientation';
import Video from 'react-native-video';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useSettingsStore, useMemberStore, useUiStore } from '../store';
import { CenterSpinner } from '../components/Loaders';
import { FadeInView } from '../components/Motion';
import ScreenHeader from '../components/ScreenHeader';
import { Member, RoomMessage } from '../types';
import { formatTimestamp } from '../utils/format';
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
import MemberPicker from '../components/MemberPicker';
import ZoomImageModal from '../components/ZoomImageModal';
import { LiveExoView, setLiveImmersiveMode } from '../native/LivePlayer';
import { enqueueDownload } from '../services/downloads';
import { memberSearchText, pinyinInitials } from '../utils/members';

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
    || String(msg.serverId || '') === String(member.serverId || '')
    || String(msg.userId || msg.ownerId || '') === String(member.id || '')
  ));
}

function roomChannelId(member: Member, mode: RoomMode) {
  return String(mode === 'small' ? (member.yklzId || member.channelId || '') : (member.channelId || ''));
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
            playWhenInactive={false}
            playInBackground={false}
            onLoad={() => setLoaded(true)}
          />
          {!loaded ? (
            <View style={styles.videoCoverPlaceholder}>
              <Text style={styles.videoCoverPlaceholderText}>{t('视频')}</Text>
            </View>
          ) : null}
        </View>
      )}
      <View style={styles.videoCoverOverlay}>
        <View style={styles.livePlayCircle}>
          <Text style={styles.livePlayIcon}>▶</Text>
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
  // 秒数上限 24h：防止把毫秒/Unix 时间戳（如 time 字段）误当播放时长显示成时间戳
  const plausible = (n: number) => n > 0 && n <= 86400;
  if (typeof value === 'number') return plausible(value) ? value : 0;
  if (typeof value === 'string') {
    const n = parseFloat(value.trim());
    return plausible(n) ? n : 0;
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
      if (plausible(n)) return n;
    }
  }
  for (const child of Object.values(value)) {
    const d = deepFindDuration(child, depth + 1);
    if (d > 0) return d;
  }
  return 0;
}

export default function FollowedRoomsScreen() {
  const isDark = useAppTheme();
  const palette = usePalette();
  const { t } = useI18n();
  const token = useSettingsStore((state) => state.settings.p48Token);
  const setTabBarHidden = useUiStore((state) => state.setTabBarHidden);
  const showToast = useUiStore((state) => state.showToast);
  const navigation = useNavigation<any>();
  const members = useMemberStore((state) => state.members);
  const [followed, setFollowed] = useState<FollowedRoom[]>([]);
  const [pinned, setPinned] = useState<string[]>([]);
  const [selectedRoom, setSelectedRoom] = useState<Member | null>(null);
  const [roomMessages, setRoomMessages] = useState<RoomMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [roomSearchQuery, setRoomSearchQuery] = useState('');
  const [roomMode, setRoomMode] = useState<RoomMode>('big');
  const [showFanMessages, setShowFanMessages] = useState(false);
  const [playingMedia, setPlayingMedia] = useState<RoomMedia | null>(null);
  const [roomNextTime, setRoomNextTime] = useState(0);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [loadingMoreMessages, setLoadingMoreMessages] = useState(false);
  const loadingMoreMessagesRef = useRef(false);
  const [currentUserId, setCurrentUserId] = useState('');
  const [fullImageUrl, setFullImageUrl] = useState('');
  const [roomPlayer, setRoomPlayer] = useState<RoomMedia | null>(null);
  const [roomPlayerFullscreen, setRoomPlayerFullscreen] = useState(false);
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
    if (roomPlayerFullscreen) {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => {});
    } else {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    }
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

  const closeRoom = useCallback(() => {
    setRoomPlayer(null);
    setRoomPlayerFullscreen(false);
    setPlayingMedia(null);
    setSelectedRoom(null);
    setLiveImmersiveMode(false);
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    setTabBarHidden(false);
  }, [setTabBarHidden]);

  const togglePin = async (memberId: string) => {
    const next = pinned.includes(memberId) ? pinned.filter((id) => id !== memberId) : [...pinned, memberId];
    setPinned(next);
    await AsyncStorage.setItem('yaya_pinned_rooms', JSON.stringify(next));
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
      const lastMsgsRes = serverIds.length ? await pocketApi.getLastMessages(serverIds) : null;
      const lastMsgs = unwrapList(lastMsgsRes, ['content.lastMsgList', 'content.data', 'data', 'lastMsgList']);
      setFollowed(followedMembers.map((item: any) => ({
        ...item,
        lastMessage: findLastMessage(lastMsgs, item.member),
      })));
      if (!silent) showToast(t('已加载 {count} 个房间', { count: followedMembers.length }));
    } catch (e) { if (!silent) showToast(t('加载失败：{msg}', { msg: errorMessage(e) })); }
    finally { setLoading(false); }
  }, [members, showToast, t, token]);
  loadFollowedRef.current = loadFollowed;

  useEffect(() => { loadFollowed(true); }, [loadFollowed]);

  const openRoom = useCallback(async (room: Member, nextMode = roomMode, includeFans = showFanMessages) => {
    const channelId = roomChannelId(room, nextMode);
    if (!channelId) {
      showToast(nextMode === 'small' ? t('这个成员缺少小房间 channelId，无法打开小房间。') : t('这个成员缺少大房间 channelId，无法打开房间。'));
      return;
    }
    setSelectedRoom(room);
    setRoomSearchQuery('');
    setPlayingMedia(null);
    setLoading(true);
    setRoomMessages([]);
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
      setRoomMessages(sortMessagesNewestFirst(list));
      const nextTime = getNextTime(res, list);
      setRoomNextTime(nextTime);
      setHasMoreMessages(nextTime > 0 && list.length > 0);
    } catch (error) {
      showToast(t('加载失败：{msg}', { msg: errorMessage(error) }));
      setRoomMessages([]);
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
        showToast(t('正在解析直播/录播地址...'));
        // 接口串行重试最坏可卡 1 分钟以上，这里加 12s 总超时，失败立即给出明确反馈
        next = await Promise.race([
          resolveRoomLiveMedia(media),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error(t('解析播放地址超时，请稍后重试'))), 12000)),
        ]);
      }
      if (!next.url) {
        Alert.alert(t('播放失败'), t('没有解析到可播放地址。\n可稍后重试，或前往「直播」页的回放列表查找该录播。'));
        return;
      }
      if (next.type === 'live') {
        // v2.6: use unified MediaScreen player; pass the already-resolved URL directly
        // so MediaScreen doesn't re-resolve (which failed and left the user on the list)
        const targetMode = next.isLive ? 'live' : 'vod';
        navigation.navigate('Media', {
          mode: targetMode,
          playLiveId: next.liveId,
          playTitle: next.title,
          playCover: next.cover,
          playUrl: next.url,
          playNonce: Date.now(),
        });
        return;
      }
      if (next.type === 'video') {
        // 视频点击直接进入全屏播放器，不再在消息下方展开内嵌播放器
        setRoomPlayer({ ...next, needsVlc: streamNeedsProxy(next.url) });
        setRoomPlayerFullscreen(true);
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
    return [...list].sort((a, b) => (pinnedIds.has(b.memberId) ? 1 : 0) - (pinnedIds.has(a.memberId) ? 1 : 0));
  }, [followed, searchQuery, pinned]);

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

  if (selectedRoom) {
    const fid = String(selectedRoom.id || '');
    const isFollowingRoom = followedIds.has(fid);
    const followBusyRoom = followBusy.has(fid);
    return (
      <View style={[styles.container, isDark && styles.containerDark]}>
        {roomPlayer ? (
          <View style={[styles.roomPlayerPage, roomPlayerFullscreen && styles.roomPlayerPageFullscreen]}>
            {!roomPlayerFullscreen ? <View style={styles.roomPlayerHeader}>
              <TouchableOpacity onPress={closeRoomPlayer} style={styles.roomPlayerBack}>
                <Text style={styles.roomPlayerBackText}>{t('返回房间')}</Text>
              </TouchableOpacity>
              <Text style={styles.roomPlayerTitle} numberOfLines={1}>{roomPlayer.title}</Text>
              <TouchableOpacity onPress={openRoomRankPanel} style={styles.roomPlayerTool}>
                <Text style={styles.roomPlayerToolText}>{t('贡献榜')}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setRoomPlayerFullscreen(true)} style={styles.roomPlayerTool}>
                <Text style={styles.roomPlayerToolText}>{t('全屏')}</Text>
              </TouchableOpacity>
            </View> : (
              <TouchableOpacity onPress={() => setRoomPlayerFullscreen(false)} style={styles.exitRoomFullscreenBtn}>
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
                ignoreSilentSwitch="ignore"
                playInBackground={false}
                playWhenInactive={false}
              />
            )}
            <Modal visible={rankVisible} transparent animationType="slide" onRequestClose={() => setRankVisible(false)}>
              <View style={styles.roomModalShade}>
                <View style={styles.roomRankPanel}>
                  <View style={styles.roomRankHeader}>
                    <Text style={styles.roomRankTitle}>{t('贡献榜')}</Text>
                    <TouchableOpacity onPress={() => setRankVisible(false)}>
                      <Text style={styles.roomPlayerBackText}>{t('关闭')}</Text>
                    </TouchableOpacity>
                  </View>
                  <Text style={styles.roomRankStatus}>{rankStatus}</Text>
                  <ScrollView style={styles.roomRankList}>
                    {rankRows.map((row, index) => (
                      <View key={String(row.userId || row.id || index)} style={styles.roomRankRow}>
                        <Text style={styles.roomRankNo}>{row.rank || index + 1}</Text>
                        {row.avatar ? <Image source={{ uri: row.avatar }} style={styles.roomRankAvatar} /> : <View style={styles.roomRankAvatar} />}
                        <View style={styles.roomRankInfo}>
                          <Text style={styles.roomRankName} numberOfLines={1}>{row.name}</Text>
                          <Text style={styles.roomRankValue} numberOfLines={1}>{row.value ? t('贡献 {value}', { value: row.value }) : t('贡献用户')}</Text>
                        </View>
                      </View>
                    ))}
                  </ScrollView>
                </View>
              </View>
            </Modal>
          </View>
        ) : null}
        <ZoomImageModal url={fullImageUrl} onClose={() => setFullImageUrl('')} />
        <ScreenHeader title={shortName(selectedRoom)} onBack={closeRoom} right={
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <TouchableOpacity
              style={[styles.followBtn, isFollowingRoom && styles.followBtnOn]}
              disabled={followBusyRoom}
              onPress={() => toggleFollow(selectedRoom)}
            >
              {followBusyRoom ? (
                <ActivityIndicator color={isFollowingRoom ? '#ff6f91' : '#ffffff'} size="small" />
              ) : (
                <Text style={[styles.followBtnText, isFollowingRoom && styles.followBtnTextOn]}>{isFollowingRoom ? t('已关注') : t('关注')}</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity style={styles.pinBtn} onPress={() => togglePin(String(selectedRoom.id || ''))}>
              <Text style={styles.pinBtnText}>{pinned.includes(String(selectedRoom.id || '')) ? t('取消置顶') : t('置顶')}</Text>
            </TouchableOpacity>
          </View>
        } />

          <View style={styles.chatTools}>
          <TouchableOpacity
            style={[styles.modePill, roomMode === 'big' && styles.modePillActive, { backgroundColor: roomMode === 'big' ? palette.tint : palette.surfaceGlass }]}
            onPress={() => openRoom(selectedRoom, 'big', showFanMessages)}
          >
            <Text style={[styles.modePillText, { color: roomMode === 'big' ? '#FFFFFF' : palette.labelSecondary }]}>{t('大房间')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.modePill, roomMode === 'small' && styles.modePillActive, { backgroundColor: roomMode === 'small' ? palette.tint : palette.surfaceGlass }]}
            onPress={() => openRoom(selectedRoom, 'small', showFanMessages)}
          >
            <Text style={[styles.modePillText, { color: roomMode === 'small' ? '#FFFFFF' : palette.labelSecondary }]}>{t('小房间')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.modePill, showFanMessages && styles.modePillActive, { backgroundColor: showFanMessages ? palette.tint : palette.surfaceGlass }]}
            onPress={() => openRoom(selectedRoom, roomMode, !showFanMessages)}
          >
            <Text style={[styles.modePillText, { color: showFanMessages ? '#FFFFFF' : palette.labelSecondary }]}>{showFanMessages ? t('成员发言') : t('含粉丝发言')}</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.roomSearchWrap}>
          <TextInput
            style={[
              styles.input,
              {
                backgroundColor: palette.surfaceGlassStrong,
                borderColor: palette.innerStroke,
                borderWidth: StyleSheet.hairlineWidth,
                color: palette.label,
              },
            ]}
            placeholder={t('搜索聊天记录、成员名、粉丝名...')}
            placeholderTextColor={palette.labelTertiary}
            value={roomSearchQuery}
            onChangeText={setRoomSearchQuery}
          />
        </View>

        <FadeInView delay={80} duration={300} style={{ flex: 1 }}>
          <PerfFlatList
            data={filteredRoomMessages}
            keyExtractor={(item, index) => messageKey(item, index)}
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
                  <CenterSpinner dark={isDark} />
                ) : hasMoreMessages ? (
                  <Text style={[styles.empty, isDark && styles.emptyDark]}>{t('上滑加载更多')}</Text>
                ) : (
                  <Text style={[styles.empty, isDark && styles.emptyDark]}>{t('没有更多消息')}</Text>
                )}
              </View>
            ) : null
          }
          renderItem={({ item, index }) => {
            const role = messageRole(item, selectedRoom, showFanMessages, currentUserId);
            const mine = role === 'mine';
            const idol = role === 'idol';
            const msgProfile = senderProfile(item, selectedRoom);
            const profile = idol
              ? { id: selectedRoom.id, name: shortName(selectedRoom), avatar: msgProfile.avatar || selectedRoom.avatar }
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
              <FadeInView delay={index < 12 ? 80 + index * 30 : 0} duration={300}>
                <View style={[styles.chatRow, mine && styles.chatRowMine]}>
                  {!mine ? (
                  profile.avatar ? (
                    <Image source={{ uri: profile.avatar }} style={styles.avatar} />
                  ) : (
                    <View style={[styles.avatarFallback, { backgroundColor: palette.fill2 }]}><Text style={[styles.avatarText, { color: palette.tint }]}>{avatarInitial(profile.name)}</Text></View>
                  )
                ) : null}
                 <View style={[styles.msgBlock, mine && styles.msgBlockMine]}>
                  {replyName || replyQuoted ? (
                    <View style={[styles.replyCard, { backgroundColor: palette.fill3, borderLeftColor: palette.tint }]}>
                      {replyName ? <Text style={[styles.replyName, { color: palette.tint }]} numberOfLines={1}>{replyName}</Text> : null}
                      {replyQuoted ? <Text style={[styles.replyText, { color: palette.labelSecondary }]} numberOfLines={3}>{replyQuoted}</Text> : null}
                    </View>
                  ) : null}
                   <View style={[styles.msgMetaLine, mine && styles.msgMetaLineMine]}>
                    <Text style={[styles.msgSender, { color: idol ? '#e8436e' : mine ? '#3a6f99' : palette.label }, idol && styles.msgSenderIdol, mine && styles.msgSenderMine]} numberOfLines={1}>
                      {profile.name}
                    </Text>
                    <Text style={[styles.msgTime, { color: mine ? '#3a6f99' : palette.labelTertiary }, mine && styles.msgTimeMine]}>{formatTimestamp(item.msgTime)}</Text>
                  </View>
                  <View style={[styles.msgBubble, idol && styles.msgBubbleIdol, mine && styles.msgBubbleMine, { backgroundColor: (!idol && !mine) ? palette.surfaceGlass : undefined, borderColor: (!idol && !mine) ? palette.innerStroke : undefined, borderWidth: (!idol && !mine) ? StyleSheet.hairlineWidth : 0 }]}>
                    {bubbleText ? (
                      <Text style={[styles.msgBody, (idol || mine) && styles.msgBodyHighlight, (!idol && !mine) && { color: palette.labelSecondary }]}>
                        {bubbleText}
                      </Text>
                    ) : null}
                    {gift && !giftReplyText ? (
                      <View style={[styles.giftCard, giftReplyText ? styles.giftCardCompact : null]}>
                        {!giftReplyText ? (gift.image ? <Image source={{ uri: gift.image }} style={styles.giftImage} /> : <View style={styles.giftImageFallback}><Text style={styles.giftEmoji}>{t('礼')}</Text></View>) : null}
                        <View style={styles.giftTextWrap}>
                          <Text style={styles.giftName} numberOfLines={1}>{idol ? t('感谢礼物') : t('送出礼物')}：{gift.name}</Text>
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
                            <Text style={styles.livePlayIcon}>▶</Text>
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
                      <TouchableOpacity style={[styles.mediaCard, (idol || mine) && styles.mediaCardHighlight]} activeOpacity={0.92} onLongPress={() => downloadMedia(media)} onPress={() => media.type === 'live' ? playMedia(media) : undefined}>
                        {media.cover ? (
                          <Image source={{ uri: media.cover }} style={styles.liveCover} resizeMode="cover" />
                        ) : null}
                        <View style={styles.mediaMeta}>
                          <Text style={[styles.mediaIcon, (idol || mine) && styles.mediaTextHighlight]}>{t(mediaLabel(media.type))}</Text>
                          {media.type !== 'audio' && media.type !== 'video' && media.title ? (
                            <Text style={[styles.mediaTitle, (idol || mine) && styles.mediaTextHighlight, isDark && !(idol || mine) && styles.mediaTitleDark]} numberOfLines={2}>{media.title}</Text>
                          ) : null}
                          {media.duration ? <Text style={[styles.mediaDuration, (idol || mine) && styles.mediaTextHighlight, isDark && !(idol || mine) && styles.mediaDurationDark]}>{media.duration}s</Text> : null}
                        </View>
                        <TouchableOpacity
                          style={[styles.mediaPlayBtn, (idol || mine) && styles.mediaPlayBtnHighlight]}
                          onPress={() => playMedia(media)}
                        >
                          <Text style={[styles.mediaPlayText, (idol || mine) && styles.mediaPlayTextHighlight]}>
                            {playingMedia?.url && media.url && playingMedia.url === media.url ? t('⏸ 暂停') : `▶ ${media.duration ? `${media.duration}s` : t('播放')}`}
                          </Text>
                        </TouchableOpacity>
                      </TouchableOpacity>
                    )) : (!bubbleText && !gift) ? (
                      <Text style={[styles.msgBody, (idol || mine) && styles.msgBodyHighlight, isDark && !mine && !idol && styles.textSubDark]}>{t('[空消息]')}</Text>
                    ) : null}
                    {media?.url && playingMedia?.url === media.url ? (
                      media.type === 'link' ? (
                        <TouchableOpacity style={styles.openLinkBtn} onPress={() => Linking.openURL(media.url).catch(() => {})}>
                          <Text style={styles.openLinkText} numberOfLines={1}>{media.url}</Text>
                        </TouchableOpacity>
                      ) : media.type === 'audio' ? (
                        <View style={styles.inlineAudioWrap}>
                          <Video
                            source={playerSource(media.url)}
                            style={styles.inlineAudioHidden}
                            paused={false}
                            ignoreSilentSwitch="ignore"
                            playInBackground={false}
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
                          ignoreSilentSwitch="ignore"
                        />
                      )
                    ) : null}
                  </View>
                </View>
              </View>
              </FadeInView>
            );
          }}
        />
        </FadeInView>
      </View>
    );
  }

  return (
    <View style={[styles.container, isDark && styles.containerDark]}>
      <ScreenHeader title={t('口袋房间')} right={
        <TouchableOpacity onPress={() => loadFollowed()}>
          <Text style={styles.headerAction}>{t('刷新')}</Text>
        </TouchableOpacity>
      } />
      <Text style={[styles.subtitle, { color: palette.labelSecondary }]}>{t('关注房间、大房间和小房间消息')}</Text>
      <MemberPicker
        selectedMember={selectedRoom}
        onSelect={(member) => openRoom(member)}
        placeholder={t('搜索成员并打开房间...')}
        limit={50}
      />

      <FadeInView delay={80} duration={300} style={{ flex: 1 }}>
        <PerfFlatList
          data={filtered}
          keyExtractor={(item) => String(item.memberId)}
          contentContainerStyle={styles.listContent}
          renderItem={({ item, index }) => {
            const fid = String(item.member?.id || item.memberId);
            const isFollowing = followedIds.has(fid);
            const busy = followBusy.has(fid);
            return (
            <FadeInView delay={index < 12 ? 80 + index * 30 : 0} duration={300}>
              <TouchableOpacity
                style={[
                  styles.roomItem,
                  {
                    backgroundColor: palette.surfaceGlass,
                    borderColor: palette.innerStroke,
                    borderWidth: StyleSheet.hairlineWidth,
                    borderRadius: 20,
                  },
                ]}
                onPress={() => item.member && openRoom(item.member)}
              >
                <View style={styles.roomTop}>
                  <Text style={[styles.roomName, { color: palette.label }]} numberOfLines={1}>{shortName(item.member, item.memberId)}</Text>
                  {item.member ? (
                    <TouchableOpacity
                      style={[styles.followBtn, { backgroundColor: isFollowing ? palette.tintSoft : palette.tint }]}
                      disabled={busy}
                      onPress={() => toggleFollow(item.member!)}
                    >
                      {busy ? (
                        <ActivityIndicator color={isFollowing ? palette.tint : '#ffffff'} size="small" />
                      ) : (
                        <Text style={[styles.followBtnText, isFollowing && { color: palette.tint }]}>{isFollowing ? t('已关注') : t('关注')}</Text>
                      )}
                    </TouchableOpacity>
                  ) : null}
                  <Text style={[styles.roomTeam, { color: palette.tint }]}>{item.member?.team || item.member?.groupName || t('未匹配成员库')}</Text>
                  <TouchableOpacity style={[styles.pinBtn, { backgroundColor: palette.tintSoft }]} onPress={() => togglePin(item.memberId)}>
                    <Text style={[styles.pinBtnText, { color: palette.tint }]}>{pinned.includes(item.memberId) ? t('取消置顶') : t('置顶')}</Text>
                  </TouchableOpacity>
                </View>
                {item.member ? (
                  <View style={styles.roomMetaRow}>
                    <Text style={[styles.roomMeta, { backgroundColor: palette.tintSoft, color: palette.tint }]}>{t('大 {id}', { id: item.member.channelId || '-' })}</Text>
                    <Text style={[styles.roomMeta, { backgroundColor: palette.tintSoft, color: palette.tint }]}>{t('小 {id}', { id: item.member.yklzId || '-' })}</Text>
                  </View>
                ) : null}
                <Text style={[styles.lastMessage, { color: palette.labelSecondary }]} numberOfLines={1}>
                  {item.lastMessage ? messageText(item.lastMessage) : t('点击查看房间消息')}
                </Text>
              </TouchableOpacity>
            </FadeInView>
            );
          }}
          ListEmptyComponent={loading ? (
            <CenterSpinner dark={isDark} text={t('加载中…')} />
          ) : !token ? (
            <View style={styles.emptyWrap}>
              <Text style={[styles.empty, isDark && styles.emptyDark]}>{t('登录后可查看关注房间和最新消息')}</Text>
              <TouchableOpacity onPress={() => navigation.navigate('LoginScreen')} style={styles.emptyLink}>
                <Text style={[styles.loginLink, isDark && styles.loginLinkDark]}>{t('去登录')}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <Text style={[styles.empty, isDark && styles.emptyDark]}>{t('暂无关注房间')}</Text>
          )}
          initialNumToRender={12}
          maxToRenderPerBatch={12}
          windowSize={7}
          removeClippedSubviews
        />
      </FadeInView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  containerDark: { backgroundColor: 'transparent' },
  chatTools: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingBottom: 8 },
  roomSearchWrap: { paddingHorizontal: 16, paddingBottom: 8 },
  modePill: { flex: 1, minHeight: 46, paddingVertical: 10, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF' },
  modePillActive: { backgroundColor: '#ff6f91' },
  modePillText: { color: '#444', fontSize: 13, fontWeight: '800' },
  modePillTextActive: { color: '#fff' },
  modePillDark: { backgroundColor: '#1C1C1F' },
  modePillTextDark: { color: '#aaa' },
  subtitle: { fontSize: 12, color: '#3f3f3f', marginTop: 2, paddingHorizontal: 16 },
  row: { flexDirection: 'row', gap: 8, paddingHorizontal: 16 },
  input: { flex: 1, padding: 10, borderRadius: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.58)', backgroundColor: '#FFFFFF', color: '#333' },
  inputDark: { backgroundColor: '#1C1C1F', borderColor: '#444', color: '#eeeeee' },
  refreshBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 18, backgroundColor: '#ff6f91', justifyContent: 'center' },
  refreshBtnDisabled: { opacity: 0.5 },
  refreshText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  headerAction: { color: '#ff6f91', fontWeight: '800', fontSize: 13 },
  loginLink: { color: '#333', fontWeight: '800', fontSize: 13 },
  loginLinkDark: { color: '#eee', fontWeight: '800', fontSize: 13 },
  status: { color: '#6b4a00', backgroundColor: 'rgba(255,243,205,0.92)', marginHorizontal: 16, padding: 8, borderRadius: 12, fontSize: 12, lineHeight: 18 },
  mediaStatus: { color: '#6b4a00', backgroundColor: 'rgba(255,243,205,0.92)', marginHorizontal: 16, marginTop: 4, padding: 8, borderRadius: 12, fontSize: 12, lineHeight: 18 },
  statusDark: { color: '#ffe2a0', backgroundColor: 'rgba(70,52,12,0.82)' },
  listContent: { paddingBottom: 112 },
  chatContent: { paddingBottom: 132, paddingTop: 4 },
  roomItem: { padding: 14, backgroundColor: '#FFFFFF', marginHorizontal: 16, marginVertical: 5, borderRadius: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.72)' },
  roomItemDark: { backgroundColor: '#1C1C1F', borderColor: 'rgba(255,255,255,0.12)' },
  roomTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  roomName: { fontSize: 15, fontWeight: '900', color: '#333', flex: 1 },
  roomTeam: { fontSize: 11, color: '#ff6f91', fontWeight: '800' },
  pinBtn: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: 'rgba(255,111,145,0.12)' },
  pinBtnText: { fontSize: 9, color: '#ff6f91', fontWeight: '800' },
  followBtn: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 12, backgroundColor: '#ff6f91', alignItems: 'center', justifyContent: 'center', minWidth: 46, height: 24 },
  followBtnOn: { backgroundColor: 'rgba(255,111,145,0.16)' },
  followBtnText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  followBtnTextOn: { color: '#ff6f91' },
  roomMetaRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  roomMeta: { fontSize: 10, color: '#3f3f3f', backgroundColor: 'rgba(255,111,145,0.14)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, overflow: 'hidden' },
  lastMessage: { fontSize: 12, color: '#3f3f3f', marginTop: 6 },
  chatFooter: { paddingVertical: 16, alignItems: 'center' },
  chatRow: { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: 12, marginVertical: 6 },
  chatRowMine: { justifyContent: 'flex-end' },
  avatar: { width: 36, height: 36, borderRadius: 18, marginRight: 8, backgroundColor: '#FFFFFF' },
  avatarFallback: { width: 36, height: 36, borderRadius: 18, marginRight: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF' },
  avatarText: { color: '#ff6f91', fontWeight: '900', fontSize: 15 },
  msgBlock: { maxWidth: '78%', minWidth: 120 },
  msgBlockMine: { alignItems: 'flex-end' },
  replyCard: { marginBottom: 6, padding: 8, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.05)', borderLeftWidth: 3, borderLeftColor: '#ff6f91' },
  replyCardDark: { backgroundColor: 'rgba(255,255,255,0.08)' },
  replyName: { fontSize: 11, color: '#ff6f91', fontWeight: '800', marginBottom: 2 },
  replyText: { fontSize: 12, color: '#555', lineHeight: 17 },
  replyTextDark: { color: '#aaa' },
  msgMetaLine: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 3, paddingHorizontal: 4 },
  msgMetaLineMine: { justifyContent: 'flex-end' },
  msgSender: { fontSize: 12, fontWeight: '800', color: '#333', maxWidth: 150 },
  msgSenderIdol: { color: '#ff4f7f' },
  msgSenderMine: { color: '#3a6f99' },
  msgTime: { fontSize: 10, color: '#4a4a4a' },
  msgTimeMine: { color: '#3a6f99' },
  msgTimeDark: { color: '#aaa' },
  msgBubble: { padding: 12, backgroundColor: '#FFFFFF', borderRadius: 18, borderTopLeftRadius: 6, borderWidth: 1, borderColor: 'rgba(255,255,255,0.72)' },
  msgBubbleIdol: { backgroundColor: 'rgba(255,111,145,0.90)', borderColor: 'rgba(255,255,255,0.28)' },
  msgBubbleMine: { backgroundColor: 'rgba(123,198,255,0.92)', borderTopLeftRadius: 18, borderTopRightRadius: 6, borderColor: 'rgba(255,255,255,0.32)' },
  msgBubbleDark: { backgroundColor: '#1C1C1F', borderColor: 'rgba(255,255,255,0.10)' },
  msgBody: { fontSize: 14, color: '#444', lineHeight: 21 },
  msgBodyHighlight: { color: '#fff' },
  giftCard: { marginTop: 8, minWidth: 210, padding: 10, borderRadius: 14, backgroundColor: 'rgba(255,240,246,0.88)', borderWidth: 1, borderColor: 'rgba(255,111,145,0.24)', flexDirection: 'row', alignItems: 'center', gap: 10 },
  giftCardCompact: { minWidth: 0, padding: 8, gap: 0 } as any,
  giftImage: { width: 34, height: 34, borderRadius: 8, backgroundColor: '#fff' },
  giftImageFallback: { width: 34, height: 34, borderRadius: 8, backgroundColor: '#ff6f91', alignItems: 'center', justifyContent: 'center' },
  giftEmoji: { color: '#fff', fontSize: 13, fontWeight: '800' },
  giftTextWrap: { flex: 1, minWidth: 0 },
  giftName: { fontSize: 13, color: '#ff6f91', fontWeight: '800' },
  giftMeta: { marginTop: 3, fontSize: 11, color: '#666' },
  giftMetaDark: { color: '#aaa' },
  mediaCard: { marginTop: 8, minWidth: 214, padding: 10, borderRadius: 14, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: 'rgba(255,255,255,0.68)' },
  mediaCardHighlight: { backgroundColor: 'rgba(255,255,255,0.20)', borderColor: 'rgba(255,255,255,0.30)' },
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
  mediaIcon: { color: '#ff6f91', fontSize: 12, fontWeight: '900' },
  mediaTitle: { flex: 1, color: '#333', fontSize: 13, fontWeight: '800', lineHeight: 18 },
  mediaTitleDark: { color: '#aaa' },
  mediaDuration: { color: '#3f3f3f', fontSize: 11, fontWeight: '700' },
  mediaDurationDark: { color: '#aaa' },
  mediaTextHighlight: { color: '#fff' },
  mediaPlayBtn: { marginTop: 9, minHeight: 38, paddingVertical: 9, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: '#ff6f91' },
  mediaPlayBtnHighlight: { backgroundColor: '#fff' },
  mediaPlayText: { color: '#fff', fontSize: 13, fontWeight: '900' },
  mediaPlayTextHighlight: { color: '#ff6f91' },
  inlineAudio: { height: 52, minWidth: 224, marginTop: 8 },
  inlineAudioWrap: { height: 0, overflow: 'hidden' },
  inlineAudioHidden: { height: 0, width: 0 },
  inlineVideo: { height: 190, minWidth: 246, marginTop: 8, backgroundColor: '#000', borderRadius: 12 },
  inlineImage: { width: 228, height: 228, marginTop: 8, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.10)' },
  inlineSticker: { width: 120, height: 120, marginTop: 6, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.05)' },
  openLinkBtn: { marginTop: 8, padding: 8, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.10)' },
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
  roomRankPanel: { maxHeight: '82%', padding: 14, borderTopLeftRadius: 22, borderTopRightRadius: 22, backgroundColor: '#1C1C1F' },
  roomRankHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  roomRankTitle: { color: '#fff', fontSize: 18, fontWeight: '900' },
  roomRankStatus: { color: '#d8d8d8', fontSize: 12, marginBottom: 10 },
  roomRankList: { maxHeight: 420 },
  roomRankRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.10)' },
  roomRankNo: { width: 24, color: '#ff6f91', fontSize: 13, fontWeight: '900', textAlign: 'center' },
  roomRankAvatar: { width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.18)' },
  roomRankInfo: { flex: 1, minWidth: 0 },
  roomRankName: { color: '#fff', fontSize: 13, fontWeight: '800' },
  roomRankValue: { color: '#cfcfcf', fontSize: 11, marginTop: 2 },
  textDark: { color: '#eee' },
  textSubDark: { color: '#eeeeee' },
  empty: { textAlign: 'center', color: '#3f3f3f', marginTop: 60, fontSize: 14, paddingHorizontal: 24, lineHeight: 20 },
  emptyDark: { color: '#aaa' },
  emptyWrap: { alignItems: 'center', paddingVertical: 60 },
  emptyLink: { marginTop: 12 },
});
