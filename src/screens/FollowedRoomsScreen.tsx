import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
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
import * as ScreenOrientation from 'expo-screen-orientation';
import Video from 'react-native-video';
import { useFocusEffect } from '@react-navigation/native';
import { useSettingsStore, useMemberStore, useUiStore } from '../store';
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
import pocketApi from '../api/pocket48';
import MemberPicker from '../components/MemberPicker';
import ZoomImageModal from '../components/ZoomImageModal';
import { LiveExoView, setLiveImmersiveMode } from '../native/LivePlayer';
import { enqueueDownload } from '../services/downloads';
import { pinyinInitials } from '../utils/members';

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
  const raw = member?.ownerName || fallback || '未知成员';
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
    Object.values(value).forEach((item) => collectUrls(item, result, depth + 1));
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
    'user.avatar',
    'user.headImg',
    'message.avatar',
  ]) || deepFindText(objects, ['avatar', 'headImg', 'headUrl']));

  return {
    id,
    name: name || (id ? `用户 ${id}` : '未知用户'),
    avatar: avatar || room.avatar || '',
  };
}

function isIdolMessage(item: any, room: Member, includeFans: boolean) {
  if (!includeFans) return true;
  const body = messageBody(item);
  const ext = extraInfo(item);
  const profile = senderProfile(item, room);
  const ownerIds = [room.id, (room as any).userId, (room as any).memberId].map(String).filter(Boolean);
  if (profile.id && ownerIds.includes(String(profile.id))) return true;
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
  const times = list.map(getMessageTime).filter((time) => time > 0);
  return times.length ? Math.min(...times) : 0;
}

function mergeMessages(prev: RoomMessage[], next: RoomMessage[]) {
  const seen = new Set(prev.map((item) => messageKey(item)));
  const merged = [...prev];
  next.forEach((item) => {
    const key = messageKey(item);
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
    ? `小房间 ${member.yklzId || '未配置'}`
    : `大房间 ${member.channelId || '未配置'}`;
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
  const title = media.title || '直播 / 录播';
  const attempts: Array<() => Promise<any>> = [];
  if (liveId) {
    attempts.push(async () => pocketApi.getLiveOne(liveId));
    attempts.push(async () => pocketApi.getOpenLiveOne(liveId));
    attempts.push(async () => findLiveItem(await pocketApi.getLiveList({ record: false, debug: true, next: 0 }), liveId));
    attempts.push(async () => findLiveItem(await pocketApi.getLiveList({ record: true, debug: true, next: 0 }), liveId));
    attempts.push(async () => findLiveItem(await pocketApi.getOpenLivePublicList({ record: true, next: 0 }), liveId));
    attempts.push(async () => {
      for (let page = 1; page <= 3; page += 1) {
        const found = findLiveItem(await pocketApi.getLiveList({ record: true, debug: true, page, next: page - 1 }), liveId);
        if (found) return found;
      }
      return null;
    });
  }
  for (const attempt of attempts) {
    try {
      const detail = await attempt();
      const urls = pickPlayableUrls(detail, true).filter(isPlayableMediaUrl);
      if (urls[0]) {
        return {
          ...media,
          type: 'live',
          liveId,
          title,
          url: urls[0],
          isLive: isLiveStreamUrl(urls[0]),
          needsVlc: streamNeedsProxy(urls[0]),
        };
      }
    } catch {
      // Try the next endpoint; live shares turn into replays after the stream ends.
    }
  }
  const url = isPlayableMediaUrl(media.url) ? media.url : '';
  return { ...media, liveId, title, url, isLive: isLiveStreamUrl(url), needsVlc: streamNeedsProxy(url) };
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
  const url = urls[0] || '';
  if (!url && !liveId) return null;
  const type = liveId ? 'live' : classifyMedia(url, msgType, text);
  const duration = firstTextFrom([item, ext, body], ['duration', 'time', 'second', 'audioTime', 'message.time']);
  const title = text && !text.startsWith('[') && text !== url
    ? text
    : type === 'audio'
      ? '语音消息'
      : type === 'video'
        ? '视频消息'
        : type === 'live'
          ? '直播 / 录播'
          : '链接';
  return { type, url, title, duration, liveId };
}

function roomGiftInfo(item: any): { name: string; num: number; image: string; total: string } | null {
  const body = messageBody(item);
  const ext = extraInfo(item);
  const msgType = String(item.msgType || item.extMsgType || body.msgType || body.extMsgType || body.messageType || '').toUpperCase();
  const giftInfo = body.giftInfo || body.giftReplyInfo?.giftInfo || body.bodys?.giftInfo || ext.giftInfo || item.giftInfo || null;
  if (!giftInfo && !msgType.includes('GIFT')) return null;
  const source = giftInfo || body || ext || item;
  const name = firstTextFrom([source], ['giftName', 'name', 'giftInfo.giftName']) || '礼物';
  const num = Number(firstTextFrom([source], ['giftNum', 'num', 'count', 'giftInfo.giftNum']) || '1') || 1;
  const image = normalizeUrl(firstTextFrom([source], ['picPath', 'giftPic', 'image', 'icon', 'giftInfo.picPath']));
  const money = Number(firstTextFrom([source], ['money', 'cost', 'price', 'giftInfo.money']) || '0') || 0;
  return { name, num, image, total: money ? `${money * num} 鸡腿` : '' };
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
    ], `用户 ${index + 1}`),
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
  return (name || '用').trim().slice(0, 1).toUpperCase();
}

export default function FollowedRoomsScreen() {
  const theme = useSettingsStore((state) => state.settings.theme);
  const token = useSettingsStore((state) => state.settings.p48Token);
  const isDark = theme === 'dark';
  const setTabBarHidden = useUiStore((state) => state.setTabBarHidden);
  const showToast = useUiStore((state) => state.showToast);
  const members = useMemberStore((state) => state.members);
  const [followed, setFollowed] = useState<FollowedRoom[]>([]);
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
    setTabBarHidden(!!selectedRoom || !!roomPlayer);
  }, [roomPlayer, selectedRoom, setTabBarHidden]);

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

  const loadFollowed = useCallback(async () => {
    if (!token) {
      showToast('请先在设置里登录口袋48，关注房间需要账号 Token。');
      return;
    }
    setLoading(true);
    showToast('正在加载关注房间...');
    try {
      const idsRes = await pocketApi.getFollowedIds();
      const idsArr = unwrapList(idsRes, ['content.data', 'content', 'content.list', 'data', 'list']).map(String);
      const followedMembers = idsArr
        .map((id: string) => {
          const member = members.find((item: any) => String(item.id || item.userId) === id);
          return { memberId: id, member };
        })
        .filter((item) => item.member?.channelId);

      const serverIds = followedMembers
        .map((item) => Number(item.member?.serverId || 0))
        .filter((id) => Number.isFinite(id) && id > 0);
      const lastMsgsRes = serverIds.length ? await pocketApi.getLastMessages(serverIds) : null;
      const lastMsgs = unwrapList(lastMsgsRes, ['content.lastMsgList', 'content.data', 'content', 'data', 'lastMsgList']);

      setFollowed(followedMembers.map((item) => ({
        ...item,
        lastMessage: findLastMessage(lastMsgs, item.member),
      })));
      showToast(followedMembers.length ? `已加载 ${followedMembers.length} 个关注房间` : '没有匹配到关注房间，也可以搜索成员直接打开房间。');
    } catch (error) {
      showToast(`加载失败：${errorMessage(error)}`);
    } finally {
      setLoading(false);
    }
  }, [members, showToast, token]);

  const openRoom = useCallback(async (room: Member, nextMode = roomMode, includeFans = showFanMessages) => {
    const channelId = roomChannelId(room, nextMode);
    if (!channelId) {
      showToast(nextMode === 'small' ? '这个成员缺少小房间 channelId，无法打开小房间。' : '这个成员缺少大房间 channelId，无法打开房间。');
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
    showToast(`正在加载${nextMode === 'small' ? '小房间' : '大房间'}消息...`);
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
      });
      const list = unwrapList(res, ['content.messageList', 'content.messages', 'content.list', 'data.messageList', 'messageList', 'messages', 'list']);
      setRoomMessages(sortMessagesNewestFirst(list));
      const nextTime = getNextTime(res, list);
      setRoomNextTime(nextTime);
      setHasMoreMessages(list.length >= 50 && nextTime > 0);
      showToast(list.length ? `已加载 ${list.length} 条消息 · ${includeFans ? '含粉丝发言' : '仅房主发言'}` : '暂无消息');
    } catch (error) {
      if (nextMode === 'big' && !includeFans && room.yklzId) {
        showToast(`大房间消息接口失败，尝试打开小房间：${errorMessage(error)}`);
        setLoading(false);
        openRoom(room, 'small', includeFans);
        return;
      }
      showToast(`加载失败：${errorMessage(error)}`);
      setRoomMessages([]);
    } finally {
      setLoading(false);
    }
  }, [currentUserId, roomMode, showFanMessages, showToast]);

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
      });
      const list = unwrapList(res, ['content.messageList', 'content.messages', 'content.list', 'data.messageList', 'messageList', 'messages', 'list']);
      const nextTime = getNextTime(res, list);
      setRoomMessages((prev) => {
        const merged = mergeMessages(prev, list as RoomMessage[]);
        showToast(`已加载 ${merged.length} 条消息 · ${showFanMessages ? '含粉丝发言' : '仅房主发言'}`);
        return merged;
      });
      setRoomNextTime(nextTime);
      setHasMoreMessages(list.length >= 50 && nextTime > 0 && nextTime !== roomNextTime);
    } catch (error) {
      showToast(`继续加载失败：${errorMessage(error)}`);
    } finally {
      loadingMoreMessagesRef.current = false;
      setLoadingMoreMessages(false);
    }
  }, [hasMoreMessages, loading, loadingMoreMessages, roomMode, roomNextTime, selectedRoom, showFanMessages, showToast]);

  const playMedia = useCallback(async (media: RoomMedia) => {
    if (media.type === 'link') {
      const url = media.url || media.title;
      if (url) Linking.openURL(url).catch(() => showToast('这个链接无法直接打开。'));
      return;
    }
    if (playingMedia?.url && playingMedia.url === media.url) {
      setPlayingMedia(null);
      return;
    }
    let next = media;
    try {
      if (media.type === 'live' || media.liveId) {
        showToast('正在解析直播 / 录播地址...');
        next = await resolveRoomLiveMedia(media);
      }
      if (!next.url) {
        showToast('这个消息里没有解析到可播放地址。');
        return;
      }
      if (next.type === 'live') {
        setRoomPlayer(next);
        return;
      }
      setPlayingMedia(next);
    } catch (error) {
      showToast(`播放解析失败：${errorMessage(error)}`);
    }
  }, [playingMedia, showToast]);

  const openRoomRankPanel = useCallback(async () => {
    if (!roomPlayer?.liveId) {
      setRankRows([]);
      setRankStatus('当前直播/回放缺少 liveId，不能获取贡献榜');
      setRankVisible(true);
      return;
    }
    setRankVisible(true);
    setRankStatus('正在加载贡献榜...');
    try {
      const res = await pocketApi.getLiveRank(String(roomPlayer.liveId));
      const rows = normalizeLiveRank(res);
      setRankRows(rows);
      setRankStatus(rows.length ? `已加载 ${rows.length} 位贡献用户` : '贡献榜为空');
    } catch (error) {
      setRankRows([]);
      setRankStatus(`贡献榜加载失败：${errorMessage(error)}`);
    }
  }, [roomPlayer]);

  const downloadMedia = useCallback(async (media: RoomMedia) => {
    try {
      let next = media;
      if ((media.type === 'live' || media.liveId) && !media.url) {
        next = await resolveRoomLiveMedia(media);
      }
      const url = next.url || media.url;
      if (!url) {
        showToast('没有可下载地址');
        return;
      }
      await enqueueDownload({
        url,
        type: next.type === 'live' ? 'replay' : next.type === 'audio' ? 'voice' : next.type === 'image' ? 'image' : next.type === 'video' ? 'video' : 'file',
        name: next.title,
      });
      showToast('已加入下载管理');
    } catch (error) {
      showToast(`下载失败：${errorMessage(error)}`);
    }
  }, [showToast]);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return followed;
    return followed.filter((item) => {
      const member = item.member;
      return `${member?.ownerName || ''} ${member?.pinyin || ''} ${pinyinInitials(member?.pinyin)} ${member?.team || ''} ${member?.channelId || ''}`.toLowerCase().includes(q);
    });
  }, [followed, searchQuery]);

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
        (item as any).senderName,
        (item as any).senderNickName,
        (item as any).nickName,
      ].some((value) => String(value || '').toLowerCase().includes(q));
    });
  }, [roomMessages, roomSearchQuery, selectedRoom]);

  if (selectedRoom) {
    return (
      <View style={[styles.container, isDark && styles.containerDark]}>
        {roomPlayer ? (
          <View style={[styles.roomPlayerPage, roomPlayerFullscreen && styles.roomPlayerPageFullscreen]}>
            {!roomPlayerFullscreen ? <View style={styles.roomPlayerHeader}>
              <TouchableOpacity onPress={closeRoomPlayer} style={styles.roomPlayerBack}>
                <Text style={styles.roomPlayerBackText}>返回房间</Text>
              </TouchableOpacity>
              <Text style={styles.roomPlayerTitle} numberOfLines={1}>{roomPlayer.title}</Text>
              <TouchableOpacity onPress={openRoomRankPanel} style={styles.roomPlayerTool}>
                <Text style={styles.roomPlayerToolText}>贡献榜</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setRoomPlayerFullscreen(true)} style={styles.roomPlayerTool}>
                <Text style={styles.roomPlayerToolText}>全屏</Text>
              </TouchableOpacity>
            </View> : (
              <TouchableOpacity onPress={() => setRoomPlayerFullscreen(false)} style={styles.exitRoomFullscreenBtn}>
                <Text style={styles.exitRoomFullscreenText}>退出全屏</Text>
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
              />
            )}
            <Modal visible={rankVisible} transparent animationType="slide" onRequestClose={() => setRankVisible(false)}>
              <View style={styles.roomModalShade}>
                <View style={styles.roomRankPanel}>
                  <View style={styles.roomRankHeader}>
                    <Text style={styles.roomRankTitle}>贡献榜</Text>
                    <TouchableOpacity onPress={() => setRankVisible(false)}>
                      <Text style={styles.roomPlayerBackText}>关闭</Text>
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
                          <Text style={styles.roomRankValue} numberOfLines={1}>{row.value ? `贡献 ${row.value}` : '贡献用户'}</Text>
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
        <View style={styles.chatHeader}>
          <TouchableOpacity style={styles.backWrap} onPress={closeRoom}>
            <Text style={styles.backBtn}>返回房间列表</Text>
          </TouchableOpacity>
          <View style={styles.chatTitleBlock}>
            <Text style={[styles.title, isDark && styles.textDark]} numberOfLines={1}>{shortName(selectedRoom)}</Text>
            <Text style={styles.subtitle} numberOfLines={1}>{selectedRoom.team || selectedRoom.groupName || '成员房间'} · {roomLabel(selectedRoom, roomMode)}</Text>
          </View>
        </View>

        <View style={styles.chatTools}>
          <TouchableOpacity
            style={[styles.modePill, roomMode === 'big' && styles.modePillActive]}
            onPress={() => openRoom(selectedRoom, 'big', showFanMessages)}
          >
            <Text style={[styles.modePillText, roomMode === 'big' && styles.modePillTextActive]}>大房间</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.modePill, roomMode === 'small' && styles.modePillActive]}
            onPress={() => openRoom(selectedRoom, 'small', showFanMessages)}
          >
            <Text style={[styles.modePillText, roomMode === 'small' && styles.modePillTextActive]}>小房间</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.modePill, showFanMessages && styles.modePillActive]}
            onPress={() => openRoom(selectedRoom, roomMode, !showFanMessages)}
          >
            <Text style={[styles.modePillText, showFanMessages && styles.modePillTextActive]}>{showFanMessages ? '成员发言' : '含粉丝发言'}</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.roomSearchWrap}>
          <TextInput
            style={[styles.input, isDark && styles.inputDark]}
            placeholder="搜索聊天记录、成员名、粉丝名..."
            placeholderTextColor="#5a5a5a"
            value={roomSearchQuery}
            onChangeText={setRoomSearchQuery}
          />
        </View>

        <FlatList
          data={filteredRoomMessages}
          keyExtractor={(item, index) => messageKey(item, index)}
          contentContainerStyle={styles.chatContent}
          onEndReached={loadMoreRoomMessages}
          onEndReachedThreshold={0.25}
          ListFooterComponent={
            roomMessages.length ? (
              <View style={styles.chatFooter}>
                {loadingMoreMessages ? (
                  <Text style={styles.empty}>继续加载中...</Text>
                ) : hasMoreMessages ? (
                  <Text style={styles.empty}>上滑继续加载</Text>
                ) : (
                  <Text style={styles.empty}>没有更多消息</Text>
                )}
              </View>
            ) : null
          }
          renderItem={({ item }) => {
            const role = messageRole(item, selectedRoom, showFanMessages, currentUserId);
            const mine = role === 'mine';
            const idol = role === 'idol';
            const profile = idol
              ? { id: selectedRoom.id, name: shortName(selectedRoom), avatar: selectedRoom.avatar }
              : senderProfile(item, selectedRoom);
            const media = roomMedia(item);
            const gift = roomGiftInfo(item);
            const body = messageText(item);
            const bubbleText = body && !gift && (!media || (body !== media.url && !body.includes(media.url) && !isRawJsonText(body))) ? body : '';
            const canInlinePlay = media?.type === 'audio' || media?.type === 'video' || media?.type === 'live';

            return (
              <View style={[styles.chatRow, mine && styles.chatRowMine]}>
                {!mine ? (
                  profile.avatar ? (
                    <Image source={{ uri: profile.avatar }} style={styles.avatar} />
                  ) : (
                    <View style={styles.avatarFallback}><Text style={styles.avatarText}>{avatarInitial(profile.name)}</Text></View>
                  )
                ) : null}
                <View style={[styles.msgBlock, mine && styles.msgBlockMine]}>
                  <View style={[styles.msgMetaLine, mine && styles.msgMetaLineMine]}>
                    <Text style={[styles.msgSender, idol && styles.msgSenderIdol, mine && styles.msgSenderMine, isDark && !mine && styles.textDark]} numberOfLines={1}>
                      {profile.name}
                    </Text>
                    <Text style={[styles.msgTime, mine && styles.msgTimeMine]}>{formatTimestamp(item.msgTime)}</Text>
                  </View>
                  <View style={[styles.msgBubble, idol && styles.msgBubbleIdol, mine && styles.msgBubbleMine, isDark && !mine && !idol && styles.msgBubbleDark]}>
                    {bubbleText ? (
                      <Text style={[styles.msgBody, (idol || mine) && styles.msgBodyHighlight, isDark && !mine && !idol && styles.textSubDark]}>
                        {bubbleText}
                      </Text>
                    ) : null}
                    {gift ? (
                      <View style={styles.giftCard}>
                        {gift.image ? <Image source={{ uri: gift.image }} style={styles.giftImage} /> : <View style={styles.giftImageFallback}><Text style={styles.giftEmoji}>礼</Text></View>}
                        <View style={styles.giftTextWrap}>
                          <Text style={styles.giftName} numberOfLines={1}>送出礼物：{gift.name}</Text>
                          <Text style={styles.giftMeta}>数量 x{gift.num}{gift.total ? ` · ${gift.total}` : ''}</Text>
                        </View>
                      </View>
                    ) : null}
                    {media ? (
                      media.type === 'image' && media.url ? (
                      <>
                        <TouchableOpacity onPress={() => setFullImageUrl(media.url)} onLongPress={() => downloadMedia(media)} activeOpacity={0.9}>
                          <Image source={{ uri: media.url }} style={styles.inlineImage} resizeMode="cover" />
                        </TouchableOpacity>
                      </>
                    ) : (
                      <TouchableOpacity style={[styles.mediaCard, (idol || mine) && styles.mediaCardHighlight]} activeOpacity={0.92} onLongPress={() => downloadMedia(media)}>
                        <View style={styles.mediaMeta}>
                          <Text style={[styles.mediaIcon, (idol || mine) && styles.mediaTextHighlight]}>{mediaLabel(media.type)}</Text>
                          <Text style={[styles.mediaTitle, (idol || mine) && styles.mediaTextHighlight]} numberOfLines={2}>{media.title}</Text>
                          {media.duration ? <Text style={[styles.mediaDuration, (idol || mine) && styles.mediaTextHighlight]}>{media.duration}s</Text> : null}
                        </View>
                        <TouchableOpacity
                          style={[styles.mediaPlayBtn, (idol || mine) && styles.mediaPlayBtnHighlight]}
                          onPress={() => playMedia(media)}
                        >
                          <Text style={[styles.mediaPlayText, (idol || mine) && styles.mediaPlayTextHighlight]}>
                            {playingMedia?.url && media.url && playingMedia.url === media.url ? '收起' : canInlinePlay ? '播放' : '打开'}
                          </Text>
                        </TouchableOpacity>
                      </TouchableOpacity>
                    )) : !bubbleText ? (
                      <Text style={[styles.msgBody, (idol || mine) && styles.msgBodyHighlight, isDark && !mine && !idol && styles.textSubDark]}>[空消息]</Text>
                    ) : null}
                    {media?.url && playingMedia?.url === media.url ? (
                      media.type === 'link' ? (
                        <TouchableOpacity style={styles.openLinkBtn} onPress={() => Linking.openURL(media.url).catch(() => {})}>
                          <Text style={styles.openLinkText} numberOfLines={1}>{media.url}</Text>
                        </TouchableOpacity>
                      ) : (
                        <Video
                          source={playerSource(media.url)}
                          style={media.type === 'audio' ? styles.inlineAudio : styles.inlineVideo}
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
            );
          }}
          ListEmptyComponent={<Text style={styles.empty}>{loading ? '加载中...' : '暂无消息'}</Text>}
        />
      </View>
    );
  }

  return (
    <View style={[styles.container, isDark && styles.containerDark]}>
      <View style={styles.header}>
        <Text style={[styles.title, isDark && styles.textDark]}>口袋房间</Text>
        <Text style={styles.subtitle}>关注房间、大房间和小房间消息</Text>
        <MemberPicker
          selectedMember={selectedRoom}
          onSelect={(member) => openRoom(member)}
          placeholder="搜索成员并打开房间..."
          limit={50}
        />
        <View style={styles.row}>
          <TextInput
            style={[styles.input, isDark && styles.inputDark]}
            placeholder="筛选已关注成员..."
            placeholderTextColor="#5a5a5a"
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          <TouchableOpacity style={[styles.refreshBtn, loading && styles.refreshBtnDisabled]} onPress={loadFollowed} disabled={loading}>
            <Text style={styles.refreshText}>刷新</Text>
          </TouchableOpacity>
        </View>
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(item) => String(item.memberId)}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <TouchableOpacity style={[styles.roomItem, isDark && styles.roomItemDark]} onPress={() => item.member && openRoom(item.member)}>
            <View style={styles.roomTop}>
              <Text style={[styles.roomName, isDark && styles.textDark]} numberOfLines={1}>{shortName(item.member, item.memberId)}</Text>
              <Text style={styles.roomTeam}>{item.member?.team || item.member?.groupName || '未匹配成员库'}</Text>
            </View>
            {item.member ? (
              <View style={styles.roomMetaRow}>
                <Text style={styles.roomMeta}>大 {item.member.channelId || '-'}</Text>
                <Text style={styles.roomMeta}>小 {item.member.yklzId || '-'}</Text>
              </View>
            ) : null}
            <Text style={[styles.lastMessage, isDark && styles.textSubDark]} numberOfLines={1}>
              {item.lastMessage ? messageText(item.lastMessage) : '点击查看房间消息'}
            </Text>
          </TouchableOpacity>
        )}
        ListEmptyComponent={<Text style={styles.empty}>{loading ? '加载中...' : '点击刷新获取关注房间，或直接搜索成员打开房间'}</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  containerDark: { backgroundColor: 'transparent' },
  header: { paddingTop: 54, paddingHorizontal: 16, paddingBottom: 12, gap: 10 },
  chatHeader: { paddingTop: 54, paddingHorizontal: 16, paddingBottom: 12, alignItems: 'center', justifyContent: 'center', minHeight: 108 },
  backWrap: { position: 'absolute', left: 16, top: 54, paddingVertical: 8, paddingRight: 4, zIndex: 2 },
  chatTitleBlock: { minWidth: 0, maxWidth: '64%', alignItems: 'center' },
  chatTools: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingBottom: 8 },
  roomSearchWrap: { paddingHorizontal: 16, paddingBottom: 8 },
  modePill: { flex: 1, minHeight: 46, paddingVertical: 10, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.70)' },
  modePillActive: { backgroundColor: '#ff6f91' },
  modePillText: { color: '#444', fontSize: 13, fontWeight: '800' },
  modePillTextActive: { color: '#fff' },
  title: { fontSize: 24, fontWeight: '900', color: '#ff6f91' },
  subtitle: { fontSize: 12, color: '#3f3f3f', marginTop: 2 },
  row: { flexDirection: 'row', gap: 8 },
  input: { flex: 1, padding: 10, borderRadius: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.58)', backgroundColor: 'rgba(255,255,255,0.76)', color: '#333' },
  inputDark: { backgroundColor: 'rgba(42,42,42,0.68)', borderColor: '#444', color: '#eeeeee' },
  refreshBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 14, backgroundColor: '#ff6f91', justifyContent: 'center' },
  refreshBtnDisabled: { opacity: 0.5 },
  refreshText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  backBtn: { color: '#ff6f91', fontSize: 14, fontWeight: '800' },
  status: { color: '#6b4a00', backgroundColor: 'rgba(255,243,205,0.92)', marginHorizontal: 16, padding: 8, borderRadius: 12, fontSize: 12, lineHeight: 18 },
  mediaStatus: { color: '#6b4a00', backgroundColor: 'rgba(255,243,205,0.92)', marginHorizontal: 16, marginTop: 4, padding: 8, borderRadius: 12, fontSize: 12, lineHeight: 18 },
  statusDark: { color: '#ffe2a0', backgroundColor: 'rgba(70,52,12,0.82)' },
  listContent: { paddingBottom: 112 },
  chatContent: { paddingBottom: 132, paddingTop: 4 },
  roomItem: { padding: 14, backgroundColor: 'rgba(255,255,255,0.76)', marginHorizontal: 16, marginVertical: 5, borderRadius: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.72)' },
  roomItemDark: { backgroundColor: 'rgba(20,20,20,0.70)', borderColor: 'rgba(255,255,255,0.12)' },
  roomTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  roomName: { fontSize: 15, fontWeight: '900', color: '#333', flex: 1 },
  roomTeam: { fontSize: 11, color: '#ff6f91', fontWeight: '800' },
  roomMetaRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  roomMeta: { fontSize: 10, color: '#3f3f3f', backgroundColor: 'rgba(255,111,145,0.14)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, overflow: 'hidden' },
  lastMessage: { fontSize: 12, color: '#3f3f3f', marginTop: 6 },
  chatFooter: { paddingVertical: 16, alignItems: 'center' },
  chatRow: { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: 12, marginVertical: 6 },
  chatRowMine: { justifyContent: 'flex-end' },
  avatar: { width: 36, height: 36, borderRadius: 18, marginRight: 8, backgroundColor: 'rgba(255,255,255,0.5)' },
  avatarFallback: { width: 36, height: 36, borderRadius: 18, marginRight: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.78)' },
  avatarText: { color: '#ff6f91', fontWeight: '900', fontSize: 15 },
  msgBlock: { maxWidth: '78%', minWidth: 120 },
  msgBlockMine: { alignItems: 'flex-end' },
  msgMetaLine: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 3, paddingHorizontal: 4 },
  msgMetaLineMine: { justifyContent: 'flex-end' },
  msgSender: { fontSize: 12, fontWeight: '800', color: '#333', maxWidth: 150 },
  msgSenderIdol: { color: '#ff4f7f' },
  msgSenderMine: { color: '#3a6f99' },
  msgTime: { fontSize: 10, color: '#4a4a4a' },
  msgTimeMine: { color: '#3a6f99' },
  msgBubble: { padding: 12, backgroundColor: 'rgba(255,255,255,0.82)', borderRadius: 18, borderTopLeftRadius: 6, borderWidth: 1, borderColor: 'rgba(255,255,255,0.72)' },
  msgBubbleIdol: { backgroundColor: 'rgba(255,111,145,0.90)', borderColor: 'rgba(255,255,255,0.28)' },
  msgBubbleMine: { backgroundColor: 'rgba(123,198,255,0.92)', borderTopLeftRadius: 18, borderTopRightRadius: 6, borderColor: 'rgba(255,255,255,0.32)' },
  msgBubbleDark: { backgroundColor: 'rgba(20,20,20,0.72)', borderColor: 'rgba(255,255,255,0.10)' },
  msgBody: { fontSize: 14, color: '#444', lineHeight: 21 },
  msgBodyHighlight: { color: '#fff' },
  giftCard: { marginTop: 8, minWidth: 210, padding: 10, borderRadius: 14, backgroundColor: 'rgba(255,240,246,0.88)', borderWidth: 1, borderColor: 'rgba(255,111,145,0.24)', flexDirection: 'row', alignItems: 'center', gap: 10 },
  giftImage: { width: 34, height: 34, borderRadius: 8, backgroundColor: '#fff' },
  giftImageFallback: { width: 34, height: 34, borderRadius: 8, backgroundColor: '#ff6f91', alignItems: 'center', justifyContent: 'center' },
  giftEmoji: { color: '#fff', fontSize: 13, fontWeight: '800' },
  giftTextWrap: { flex: 1, minWidth: 0 },
  giftName: { fontSize: 13, color: '#eb2f96', fontWeight: '800' },
  giftMeta: { marginTop: 3, fontSize: 11, color: '#666' },
  mediaCard: { marginTop: 8, minWidth: 214, padding: 10, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.72)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.68)' },
  mediaCardHighlight: { backgroundColor: 'rgba(255,255,255,0.20)', borderColor: 'rgba(255,255,255,0.30)' },
  mediaMeta: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  mediaIcon: { color: '#ff6f91', fontSize: 12, fontWeight: '900' },
  mediaTitle: { flex: 1, color: '#333', fontSize: 13, fontWeight: '800', lineHeight: 18 },
  mediaDuration: { color: '#3f3f3f', fontSize: 11, fontWeight: '700' },
  mediaTextHighlight: { color: '#fff' },
  mediaPlayBtn: { marginTop: 9, minHeight: 38, paddingVertical: 9, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#ff6f91' },
  mediaPlayBtnHighlight: { backgroundColor: '#fff' },
  mediaPlayText: { color: '#fff', fontSize: 13, fontWeight: '900' },
  mediaPlayTextHighlight: { color: '#ff6f91' },
  inlineAudio: { height: 52, minWidth: 224, marginTop: 8 },
  inlineVideo: { height: 190, minWidth: 246, marginTop: 8, backgroundColor: '#000', borderRadius: 12 },
  inlineImage: { width: 228, height: 228, marginTop: 8, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.10)' },
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
  roomRankPanel: { maxHeight: '82%', padding: 14, borderTopLeftRadius: 22, borderTopRightRadius: 22, backgroundColor: 'rgba(18,18,18,0.94)' },
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
});
