import React, { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  AppState,
  DeviceEventEmitter,
  InteractionManager,
  Keyboard,
  NativeModules,
  Platform,
  Pressable,
  useWindowDimensions,
} from 'react-native';
import Reanimated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { USER_AGENT } from '../constants';
import { showDialog } from '../components/AppDialog';
import { PerfFlatList } from '../components/PerfFlatList';
import { Chat } from '@kesha-antonov/react-native-chat';
import { setLiveImmersiveMode } from '../native/LivePlayer';
import {
  deleteRoomMessage,
  observeRoomMessages,
  onQChatConnected,
  sendRoomSticker,
  sendRoomTextMessage,
  subscribeRoomChannel,
  subscribeRoomChannelsBatch,
  type RoomSticker,
} from '../services/pocketNim/qchat';
import { getNimSessionEpoch, subscribeNimSession } from '../services/pocketNim/session';
import { LiveBarrageBoard } from '../components/LiveBarrageBoard';
import { NetworkImage } from '../components/NetworkImage';
import { useLiveBarrage } from '../hooks/useLiveBarrage';
import DanmakuListSheet, { type DanmakuListEntry } from '../components/DanmakuListSheet';
import {
  enrichReplayDanmaku,
  parseDanmaku,
  replayBarrageToDanmaku,
  type DanmakuItem,
} from '../utils/danmaku';
import { fetchMemberRadioStream } from '../services/radio';
import { usePalette, fontFamily } from '../theme';
import { styles } from './followedRooms/styles';
import type { Palette } from '../theme/colors';
import { useResolvedTheme } from '../hooks/useAppTheme';
import { useKeyboardHeight } from '../hooks/useKeyboardHeight';
import { useDualPane } from '../hooks/useDualPane';
import {
  type MediaType,
  pickPlayableUrls,
  extractLiveIdFromText,
  isPlayableMediaUrl,
  streamNeedsProxy,
  isLiveStreamUrl,
  collectUrls,
  classifyMedia,
  diagDurationFields,
} from './followedRooms/mediaUtils';
import {
  capText,
  rgiftImage,
  extraInfo,
  messageBody,
  firstTextFrom,
  deepFindText,
  getMessageTime,
  getNextTime,
  diagnoseUndefined,
  sortMessagesNewestFirst,
  qchatToRoomMessage,
  findLastMessage,
  findSmallLastMessage,
  roomChannelId,
  type RoomMode,
} from './followedRooms/messageUtils';
import {
  shortName,
  senderProfile,
  isIdolMessage,
  currentUserIdFrom,
  messageRole,
  buildMemberIdSet,
  userCardFromUserRes,
  messageKey,
  mergeMessages,
  getRoomMessageSearchHaystack,
  buildRoomMetaSearchHaystack,
  roomGiftInfo,
  mediaLabel,
  __diagStamp,
  firstFrameFrom,
  findFrameUrl,
  normalizeLiveRank,
  avatarInitial,
  collectRoomMessageIds,
  filterVisibleRoomMessages,
  matchesDeletedMessageId,
  type LiveRankItem,
} from './followedRooms/roomDomain';

import {
  ActivityIndicator,
  BackHandler,
  Image,
  Linking,
  Modal,
  ScrollView,
  View,
  Text,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { BlurView } from 'expo-blur';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ScreenOrientation from 'expo-screen-orientation';
import Video from 'react-native-video';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/types';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { shareRemoteImage } from '../services/shareImage';
import { useSettingsStore, useMemberStore, useUiStore } from '../store';
import { CenterSpinner } from '../components/Loaders';
import { EmptyState, ErrorState } from '../components/StateViews';
import { ScalePressable } from '../components/Motion';
import {
  FLOATING_BAR_HEIGHT,
  FloatingHeaderAction,
  FloatingTabHeader,
  getFloatingHeaderOffset,
} from '../components/FloatingTabHeader';
import { type Member, type RoomMessage, type RoomMessageWire, type WireRecord } from '../types';
import { formatTimestamp } from '../utils/format';
import { fetchLiveEndSummary, type LiveEndSummary } from '../utils/liveSummary';
import { findMediaDurationSeconds } from '../utils/mediaDuration';
import { normalizePrivateMediaUrl } from '../utils/mediaUrl';
import { normalizeGiftList } from '../utils/giftList';
import {
  ROOM_AT_BOTTOM_OFFSET,
  ROOM_REFRESH_LIMIT,
  ROOM_SEARCH_DEBOUNCE_MS,
  ROOM_LOAD_MORE_COOLDOWN_MS,
  ROOM_SEARCH_MIN_HITS,
  ROOM_SEARCH_BURST_PAGES,
  ROOM_SEARCH_PAGE_DELAY_MS,
  ROOM_SEARCH_MAX_CONSECUTIVE_ERRORS,
  computeHistoryCursorAdvance,
  shouldAutoLoadMoreOnScroll,
  shouldSearchAutoContinue,
  splitByFreezeAnchor,
} from '../services/roomLivePolicy';
import { useMiniPlayerStore } from '../store/miniPlayerStore';
import { usePlayerStore } from '../player/store/playerStore';
import { isOnMicStreamFresh, useOnMicStore, type OnMicEntry } from '../store/onMicStore';
import { getTaskBudget, notifyTransitionStart, waitForIdleSlot } from '../services/perfScheduler';
import { useDiscoveredLivesStore } from '../store/discoveredLivesStore';
import { parseVoiceEvent } from '../services/pocketNim/voiceEvent';
import {
  errorMessage,
  extractDeletedMessageIds,
  messagePayload,
  humanizeRawMessageText,
  isDeletedMessage,
  isHiddenControlMessage,
  messagePreviewText,
  messageText,
  normalizeUrl,
  splitEmojiParts,
  unwrapList,
} from '../utils/data';
import { UserDecorRow, AvatarWithFrame, TeamLogoImage } from '../components/UserDecor';
import { t, useI18n } from '../i18n';
import { logInfo, logWarn } from '../utils/runtimeLog';
import pocketApi from '../api/pocket48';
import PlayerScreen from '../player';
import Clipboard from '@react-native-clipboard/clipboard';
import DanmakuSettingsSheet from '../components/DanmakuSettingsSheet';
import {
  clearGiftEffectQueue,
  isGiftEffectSupported,
  playGiftEffect,
} from '../services/giftEffect';
import ZoomImageModal from '../components/ZoomImageModal';
import { VoiceMessageBar } from '../components/VoiceMessageBar';
import { enqueueDownload } from '../services/downloads';
import { memberSearchText, isRoomMember, resolveOfficialTeamLogo } from '../utils/members';
import {
  ensureBgCached,
  getBgDisplayUri,
  initRoomBgCache,
  invalidateBgCache,
  normalizeBgUrl,
  warmRoomBgs,
} from '../services/roomBgCache';
import {
  cacheRoomMetasFromSeineDetail,
  getRoomMetaCached,
  loadRoomMetaCache,
  mergeRoomMetaCached,
  type RoomMeta,
} from '../services/roomMetaCache';
import { readFollowedRoomsSnapshot, writeFollowedRoomsSnapshot } from '../services/followedIds';
import {
  fetchFollowedIdsShared,
  fetchLiveListShared,
  hydrateFollowedIdsShared,
  mutateFollowedIdShared,
  subscribeFollowedIds,
} from '../services/pocketSharedData';
import { seedRoomMapFromMembers } from '../services/roomMapCache';
import { thumbUrl, AVATAR_THUMB_WIDTH } from '../utils/imageThumb';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { GlassSurface } from '../components/GlassSurface';
import { SearchBar } from '../components/SearchBar';
import RoomStickerPanel from '../components/RoomStickerPanel';
import RoomFlipQuestion from '../components/RoomFlipQuestion';
import { getRoomFlipInfo } from '../utils/roomFlip';

const USE_FROSTED_TOOLBAR = Platform.OS === 'android';

const ToolbarShell = (USE_FROSTED_TOOLBAR ? View : BlurView) as unknown as React.ComponentType<
  React.ComponentProps<typeof BlurView>
>;
import { useBlurTarget } from '../components/BlurTarget';
import { GlassSegmented } from '../components/GlassSegmented';
import { setPipPlaying } from '../utils/pip';
import { ListBottomSpacer } from '../components/ListBottomSpacer';

const ROOMS_LIST_FOOTER = <ListBottomSpacer />;
const EMPTY_ONMIC: Record<string, OnMicEntry> = {};
const EMPTY_VOICEROOMS: Record<string, boolean> = {};
const EMPTY_MEMBERS: Member[] = [];
type FollowedRoom = {
  memberId: string;
  member?: Member;
  lastMessage?: RoomMessageWire | null;

  lastSmallMessage?: RoomMessageWire | null;
};

type RoomListFilter = 'all' | 'pinned' | 'live';

const ZH_COLLATOR =
  typeof Intl !== 'undefined' && typeof Intl.Collator === 'function'
    ? new Intl.Collator('zh-CN')
    : null;

function extractLiveItemsFromRes(res: unknown): WireRecord[] {
  return unwrapList(res, [
    'content.liveList',
    'content.list',
    'data.liveList',
    'liveList',
    'list',
    'data',
  ]) as WireRecord[];
}

function collectLiveNowSets(liveItems: WireRecord[]): { ids: Set<string>; names: Set<string> } {
  const ids = new Set<string>();
  const names = new Set<string>();
  liveItems.forEach((it) => {
    const owner = String(
      it.userId ||
        it.ownerId ||
        it.memberId ||
        it.userInfo?.userId ||
        it.userInfo?.id ||
        it.user?.userId ||
        it.owner?.userId ||
        it.memberInfo?.userId ||
        it.hostId ||
        it.account ||
        '',
    );
    if (owner) ids.add(owner);
    const lr = String(it.liveRoomId || it.roomId || '');
    if (lr) ids.add(lr);
    const nick = String(
      it.nickname || it.nickName || it.userInfo?.nickname || it.userInfo?.starName || '',
    )
      .replace(/^(SNH48|GNZ48|BEJ48|CKG48|CGT48)-/i, '')
      .trim()
      .toLowerCase();
    if (nick) names.add(nick);
  });
  return { ids, names };
}

function resolveFollowedLiveFlags(
  member: Member | undefined,
  memberId: string,
  liveNow: { ids: Set<string>; names: Set<string> },
  onMicMap: Record<string, unknown>,
  voiceRooms: Record<string, unknown>,
) {
  const mid = String(member?.id || memberId);
  const mroom = String(member?.liveRoomId || '');
  const macct = String(member?.account || '');
  const mnick = String(member?.ownerName || '')
    .replace(/^(SNH48|GNZ48|BEJ48|CKG48|CGT48)-/i, '')
    .trim()
    .toLowerCase();
  const isLiveNow =
    liveNow.ids.has(mid) ||
    (!!mroom && liveNow.ids.has(mroom)) ||
    (!!macct && liveNow.ids.has(macct)) ||
    (!!mnick && liveNow.names.has(mnick));
  const isOnMic = !isLiveNow && !!onMicMap[mid];
  const roomKey = `${String(member?.serverId || '')}:${String(member?.channelId || '')}`;
  const isVoiceRoom = !isLiveNow && !isOnMic && !!voiceRooms[roomKey];
  return {
    isLiveNow,
    isOnMic,
    isVoiceRoom,
    isActiveLive: isLiveNow || isOnMic || isVoiceRoom,
  };
}

function resolveRoomMemberTeamLogo(member?: Member): { teamLogo: string; teamLabel: string } {
  const teamLabel = String(member?.team || member?.groupName || '').trim();

  const dbLogo = String(member?.teamLogo || resolveOfficialTeamLogo(member) || '').trim();
  return { teamLogo: dbLogo, teamLabel };
}

const ROOM_LAST_TIME_CACHE_KEY = 'yaya_room_last_time_v2';
const MIN_VALID_ROOM_TIME_MS = 946684800000;
const MAX_ROOM_TIME_CACHE_ENTRIES = 400;
const ROOM_TIME_HYDRATE_CONCURRENCY = 4;
const ROOM_TIME_VER_FLUSH_MS = 120;
const ROOM_TIME_HYDRATE_START_DELAY_MS = 450;

type RoomLastTimeEntry = {
  timeMs: number;
  preview?: string;
};

function resolveRoomPreviewTimeMs(
  directMs: number,
  channelId: string,
  previewText: string,
  cache: Record<string, RoomLastTimeEntry>,
): number {
  if (directMs > 0) return directMs;
  if (!channelId || channelId === '0') return 0;
  const cached = cache[channelId];
  if (!cached || cached.timeMs <= 0) return 0;
  const cleanPreview = previewText.trim();
  if (cached.preview && cleanPreview && cached.preview !== cleanPreview) return 0;
  return cached.timeMs;
}

function formatRoomPreviewTime(ms: number, yesterdayLabel: string): string {
  if (!Number.isFinite(ms) || ms <= 0) return '';
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 86400000;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (ms >= startOfToday) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (ms >= startOfYesterday) return yesterdayLabel;
  if (d.getFullYear() === now.getFullYear()) return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return `${String(d.getFullYear()).slice(2)}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
}

type GiftRow = {
  giftId?: string | number;
  id?: string | number;
  name?: string;
  giftName?: string;
  cost?: number | string;
  money?: number | string;
  price?: number | string;
  isPocketGift?: number | string;
  [key: string]: unknown;
};

type ChatRow = {
  type: 'date' | 'msg';
  key: string;
  label?: string;
  item?: RoomMessageWire;
  index?: number;
  groupStart?: boolean;
};

type RoomChatIM = {
  _id: string;
  __row: ChatRow;
  text: string;
  createdAt: Date;
  user: { _id: string; avatar?: string; name?: string };
};

type RoomMedia = {
  type: MediaType;
  url: string;
  title: string;
  duration?: string;
  liveId?: string;
  isLive?: boolean;
  needsVlc?: boolean;
  cover?: string;

  liveType?: number;

  urls?: string[];

  replayHint?: boolean;
};

function RoomPlayerDanmakuSheet({
  entries,
  live,
  loading,
  onClose,
  onOpenProfile,
}: {
  entries: DanmakuListEntry[];
  live: boolean;
  loading: boolean;
  onClose: () => void;
  onOpenProfile?: (_entry: DanmakuListEntry) => void;
}) {
  const position = usePlayerStore((state) => state.position);
  return (
    <DanmakuListSheet
      visible
      onClose={onClose}
      entries={entries}
      live={live}
      loading={loading}
      currentTime={live ? undefined : position}
      onSeek={live ? undefined : (time) => usePlayerStore.getState().setSeekTarget(time)}
      onOpenProfile={onOpenProfile}
    />
  );
}

function roomTapIsVod(next: RoomMedia): boolean {
  if (next.replayHint) return true;
  const u = String(next.url || '').toLowerCase();
  if (u.startsWith('rtmp://') || u.includes('.flv')) return false;
  return !next.isLive;
}

const LIVE_LIST_CACHE_TTL = 40 * 1000;
const liveListCache: Record<string, { t: number; res: unknown }> = {};
async function cachedLiveList(record: boolean, page = 0, next = 0): Promise<unknown> {
  const key = `r:${record ? 1 : 0}:p:${page}:n:${next}`;
  const hit = liveListCache[key];
  if (hit && Date.now() - hit.t < LIVE_LIST_CACHE_TTL) return hit.res;
  const res = await pocketApi.getLiveList({ record, debug: true, page, next });
  liveListCache[key] = { t: Date.now(), res };
  return res;
}

function detailLiveState(detail: unknown): 'live' | 'replay' | 'unknown' {
  const root = (detail || {}) as WireRecord;
  const d = (root.content || root.data || root) as WireRecord;
  if (d.isLiving === true || d.living === true || d.isLive === true) return 'live';

  if (d.review === true || d.type === 2 || d.type === 3 || d.isRecord === 1 || d.isRecord === true)
    return 'replay';
  if (d.type === 1 || d.liveType === 1 || d.liveType === 2) return 'live';
  if (
    d.isLiving === false ||
    d.living === false ||
    d.isLive === false ||
    d.isEnd === true ||
    d.isEnded === true ||
    d.isFinished === true ||
    d.isRecord === 1 ||
    d.isRecord === true ||
    d.record === 1 ||
    d.record === true ||
    d.isReplay === 1 ||
    d.isReplay === true ||
    d.isPlayback === true ||
    Boolean(d.msgFilePath) ||
    Boolean(d.lrcUrl)
  )
    return 'replay';
  return 'unknown';
}

function findLiveItem(listRes: unknown, liveId: string) {
  const list = unwrapList(listRes, [
    'content.liveList',
    'content.list',
    'content.data',
    'data.liveList',
    'data.list',
    'liveList',
    'list',
  ]);
  return list.find((entry) => {
    const row = entry as WireRecord;
    return String(row.liveId || row.id || row.live_id || '') === String(liveId);
  });
}

async function resolveRoomLiveMedia(media: RoomMedia): Promise<RoomMedia> {
  const liveId = String(media.liveId || extractLiveIdFromText(media) || '');
  const title = media.title || t('直播 / 录播');

  const ownUrl = isPlayableMediaUrl(media.url) ? media.url : '';
  if (ownUrl) {
    const lower = ownUrl.toLowerCase();
    const isRtmp = lower.startsWith('rtmp://') || lower.includes('.flv');
    if (isRtmp) {
      return {
        ...media,
        liveId,
        title,
        url: ownUrl,
        urls: [ownUrl],
        isLive: true,
        needsVlc: streamNeedsProxy(ownUrl),
      };
    }
    if (media.replayHint) {
      return {
        ...media,
        liveId,
        title,
        url: ownUrl,
        isLive: false,
        needsVlc: streamNeedsProxy(ownUrl),
      };
    }

    let isLive = false;
    if (liveId) {
      try {
        const found = await findLiveItem(await cachedLiveList(false, 0, 0), liveId);
        isLive = !!found;
      } catch {
        isLive = false;
      }
    }
    return { ...media, liveId, title, url: ownUrl, isLive, needsVlc: streamNeedsProxy(ownUrl) };
  }
  const attempts: Array<{ label: 'live' | 'replay' | 'detail'; run: () => Promise<unknown> }> = [];
  if (liveId) {
    attempts.push({ label: 'detail', run: () => pocketApi.getLiveOne(liveId) });
    attempts.push({ label: 'detail', run: () => pocketApi.getOpenLiveOne(liveId) });
    attempts.push({
      label: 'live',
      run: async () => findLiveItem(await cachedLiveList(false, 0, 0), liveId),
    });
    attempts.push({
      label: 'replay',
      run: async () => findLiveItem(await cachedLiveList(true, 0, 0), liveId),
    });
    attempts.push({
      label: 'replay',
      run: async () =>
        findLiveItem(await pocketApi.getOpenLivePublicList({ record: true, next: 0 }), liveId),
    });
  }

  const ATTEMPT_TIMEOUT = 4000;
  const settled = await Promise.allSettled(
    attempts.map((attempt) =>
      Promise.race([
        attempt.run(),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), ATTEMPT_TIMEOUT)),
      ]),
    ),
  );

  const rank = (i: number): number => {
    if (attempts[i].label === 'replay') return 2;
    const result = settled[i];
    if (result.status !== 'fulfilled' || !result.value) return 3;
    return detailLiveState(result.value) === 'live' ? 0 : 1;
  };
  const order = attempts.map((_, i) => i).sort((a, b) => rank(a) - rank(b));
  {
    for (const i of order) {
      const result = settled[i];
      if (result.status !== 'fulfilled' || !result.value) continue;
      const detail = result.value as WireRecord;
      const urls = pickPlayableUrls(detail, true).filter(isPlayableMediaUrl);
      if (urls[0]) {
        const d = detail?.content || detail?.data || detail || {};
        const cover =
          normalizeUrl(
            d.liveCover ||
              d.coverPath ||
              d.cover ||
              d.coverUrl ||
              d.picPath ||
              d.liveRoomCover ||
              '',
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
            const u0 = String(urls[0] || '').toLowerCase();
            isLive = u0.startsWith('rtmp://') || u0.includes('.flv');
          }
        }
        return {
          ...media,
          type: 'live',
          liveId,
          title,
          url: urls[0],
          urls,
          cover,
          isLive,
          needsVlc: streamNeedsProxy(urls[0]),
        };
      }
    }
  }
  return {
    ...media,
    liveId,
    title,
    url: ownUrl,
    isLive: isLiveStreamUrl(ownUrl),
    needsVlc: streamNeedsProxy(ownUrl),
  };
}

async function resolveRoomLiveMediaWithRetry(media: RoomMedia): Promise<RoomMedia> {
  const started = Date.now();
  const first = await resolveRoomLiveMedia(media);
  if (first.url) return first;
  if (Date.now() - started > 2500) return first;
  await new Promise((resolve) => setTimeout(resolve, 400));
  return resolveRoomLiveMedia(media);
}

function computeRoomMedia(item: RoomMessageWire): RoomMedia | null {
  if (!item) return null;
  const body = messageBody(item);
  const ext = extraInfo(item);
  const text = messageText(item);
  const msgType = String(
    item.msgType || item.extMsgType || body.msgType || body.extMsgType || body.messageType || '',
  ).toUpperCase();

  const isReplyOrGiftReply =
    msgType === 'GIFTREPLY' ||
    msgType === 'AUDIO_GIFT_REPLY' ||
    msgType === 'AUDIO_REPLY' ||
    msgType === 'REPLY' ||
    msgType.endsWith('_REPLY') ||
    msgType.includes('REPLY') ||
    msgType.includes('FLIPCARD') ||
    Boolean(
      body?.replyInfo ||
      body?.giftReplyInfo ||
      body?.reply ||
      body?.replay ||
      body?.replyGiftInfo ||
      ext?.replyInfo ||
      ext?.giftReplyInfo,
    );

  if (!isReplyOrGiftReply && msgType.includes('GIFT')) {
    return null;
  }

  if (msgType === 'EXPRESSIMAGE' || msgType === 'EXPRESS') {
    const exprUrl = normalizeUrl(body?.expressImgInfo?.emotionRemote || body?.url || '');
    if (exprUrl) return { type: 'image' as const, url: exprUrl, title: t('表情') };
  }

  const replyInfo = (body?.replyInfo ||
    body?.giftReplyInfo ||
    body?.reply ||
    body?.replay ||
    body?.replyGiftInfo ||
    ext?.replyInfo ||
    ext?.giftReplyInfo) as WireRecord | undefined;

  const hasVoicePayload = Boolean(
    /VOICE|AUDIO/.test(msgType) ||
    body?.voiceInfo ||
    body?.audioInfo ||
    body?.voice ||
    body?.giftReplyInfo?.voiceInfo ||
    body?.giftReplyInfo?.audioInfo ||
    ext?.voiceInfo ||
    ext?.audioInfo ||
    replyInfo?.voiceInfo ||
    replyInfo?.audioInfo ||
    replyInfo?.replyGiftInfo?.voiceInfo ||
    replyInfo?.replyGiftInfo?.audioInfo ||
    replyInfo?.replyGiftInfo?.voiceUrl ||
    replyInfo?.replyGiftInfo?.audioUrl,
  );
  const explicitVoiceCandidate = hasVoicePayload
    ? firstTextFrom(
        [
          replyInfo,
          replyInfo?.replyGiftInfo,
          replyInfo?.voiceInfo,
          replyInfo?.audioInfo,
          body,
          body?.giftReplyInfo,
          body?.voiceInfo,
          body?.audioInfo,
          body?.voice,
          body?.attachment,
          ext?.voiceInfo,
          ext?.audioInfo,
          item,
        ],
        [
          'voiceUrl',
          'audioUrl',
          'url',
          'path',
          'mediaUrl',
          'voicePath',
          'audioPath',
          'fileUrl',
          'streamPath',
          'voiceInfo.voiceUrl',
          'voiceInfo.url',
          'audioInfo.audioUrl',
          'audioInfo.url',
          'voice.url',
          'attach.url',
          'attachment.url',
        ],
      )
    : '';

  const liveId =
    firstTextFrom(
      [item, ext, body, replyInfo],
      [
        'liveId',
        'liveid',
        'live_id',
        'message.liveId',
        'msg.liveId',
        'content.liveId',
        'data.liveId',
      ],
    ) ||
    deepFindText([item, ext, body, replyInfo], ['liveId', 'liveid', 'live_id']) ||
    extractLiveIdFromText([item, ext, body, replyInfo, text]);

  let url = '';
  let type: MediaType = 'link';

  if (explicitVoiceCandidate) {
    url = normalizePrivateMediaUrl(explicitVoiceCandidate, 'mp4');
    type = 'audio';
  }

  if (!url) {
    const urls = pickPlayableUrls(
      [item, ext, body, replyInfo],
      !!liveId || msgType.includes('LIVE'),
    );
    url = urls[0] || '';

    if (!url && !liveId) {
      const allUrls: string[] = [];
      collectUrls(ext, allUrls);
      collectUrls(body, allUrls);
      if (replyInfo) collectUrls(replyInfo, allUrls);
      url = allUrls.find((u) => u && /^https?:\/\//i.test(u)) || '';
    }

    if (!url && !liveId) {
      const rawUrls: string[] = [];
      collectUrls(ext, rawUrls);
      collectUrls(body, rawUrls);
      if (replyInfo) collectUrls(replyInfo, rawUrls);
      const textMatch = String(text || '').match(/(https?:\/\/[^\s]+)/i);
      if (textMatch) rawUrls.push(textMatch[1]);
      url = rawUrls.find((u) => u && /^https?:\/\//i.test(u)) || '';
    }

    if (!url && !liveId) {
      const t = String(text || '').toLowerCase();
      if (
        t.includes('[图片]') ||
        t.includes('[语音]') ||
        t.includes('[视频]') ||
        t.includes('[链接]') ||
        t.includes('[直播]')
      ) {
        return null;
      }
    }

    const senderTeamLogo = String(extraInfo(item)?.user?.teamLogo || '').trim();
    if (url && senderTeamLogo && url === senderTeamLogo) return null;
    if (!url && !liveId) return null;
    type = liveId ? 'live' : classifyMedia(url, msgType, text);
  }

  const durationSec = [replyInfo, body?.voiceInfo, replyInfo?.voiceInfo, body, ext, item].reduce(
    (best, src) => best || findMediaDurationSeconds(src),
    0,
  );
  const duration = durationSec > 0 ? String(Math.round(durationSec)) : '';

  if ((type === 'audio' || type === 'video') && !duration) {
    diagDurationFields(type, [replyInfo, body, ext, item]);
  }

  const title =
    type === 'audio'
      ? t('语音')
      : type === 'video'
        ? t('视频')
        : type === 'live'
          ? t('直播 / 录播')
          : type === 'image'
            ? t('图片')
            : text && !text.startsWith('[') && text !== url
              ? text
              : t('链接');

  const rawCover =
    firstTextFrom(
      [item, ext, body],
      [
        'thumbPath',
        'coverUrl',
        'coverPath',
        'cover',
        'liveCover',
        'picPath',
        'picturePath',
        'imageUrl',
        'poster',
        'videoCover',
        'videoPoster',
        'thumbnail',
        'thumbUrl',
        'message.coverUrl',
        'message.cover',
        'content.coverUrl',
        'data.coverUrl',
      ],
    ) ||
    deepFindText(
      [item, ext, body],
      [
        'thumbPath',
        'coverUrl',
        'cover',
        'liveCover',
        'picPath',
        'coverPath',
        'imageUrl',
        'poster',
        'thumb',
      ],
    ) ||
    '';
  let cover = '';
  if (rawCover) {
    const s = String(rawCover).trim();
    if (/^https?:\/\//i.test(s)) cover = normalizeUrl(s);
    else if (s.startsWith('/')) cover = `https://source.48.cn${s}`;
    else if (!s.startsWith('[')) cover = normalizeUrl(s);
  }

  const replayHint = !!(
    msgType.match(/RECORD|PLAYBACK|VOD|REPLAY|回放/) ||
    /(回放|录播|replay|playback)/i.test(
      `${String(text || '')} ${String(body?.title || '')} ${String(body?.content || '')} ${String(body?.desc || '')} ${String(item?.title || '')}`,
    ) ||
    /(replayUrl|playbackUrl|recordUrl|\/replay\/|\/record\/|\/playback\/)/i.test(
      `${url} ${String(body?.replayUrl || '')} ${String(body?.playbackUrl || '')} ${String(body?.recordUrl || '')}`,
    )
  );
  const mediaResult = { type, url, title, duration, liveId, cover, replayHint };
  return mediaResult;
}

const roomMediaCache = new WeakMap<object, { lang: string; value: RoomMedia | null }>();

function roomMedia(item: RoomMessageWire): RoomMedia | null {
  if (!item || typeof item !== 'object') return null;
  const lang = t('图片');
  const cached = roomMediaCache.get(item);
  if (cached && cached.lang === lang) return cached.value;
  const value = computeRoomMedia(item);
  roomMediaCache.set(item, { lang, value });
  return value;
}

function playerSource(url: string) {
  return {
    uri: url,
    headers: {
      'User-Agent': USER_AGENT,
      Referer: 'https://h5.48.cn/',
      Origin: 'https://h5.48.cn',
    },
  };
}

function VideoCoverCard({
  media,
  onPress,
  onLongPress,
}: {
  media: RoomMedia;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const palette = usePalette();
  const { t } = useI18n();

  const resolvedDur = media.duration || '';
  const [coverError, setCoverError] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const hasCover = !!media.cover && !coverError;

  return (
    <TouchableOpacity
      style={styles.videoCoverWrap as any}
      onPress={onPress}
      onLongPress={onLongPress}
      activeOpacity={0.9}
      accessibilityLabel={t('视频')}
    >
      {hasCover ? (
        <NetworkImage
          source={{ uri: media.cover }}
          style={styles.videoCoverImg as any}
          resizeMode="cover"
          thumbnail={700}
          fallback={false}
          onError={() => setCoverError(true)}
        />
      ) : (
        <View style={styles.videoCoverImg as any}>
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
            <View
              style={[
                StyleSheet.absoluteFill,
                { backgroundColor: palette.fill2, alignItems: 'center', justifyContent: 'center' },
              ]}
            >
              <MaterialCommunityIcons
                name="play-circle-outline"
                size={40}
                color={palette.labelTertiary}
              />
            </View>
          ) : null}
        </View>
      )}
      <View style={styles.videoCoverOverlay}>
        <View style={styles.livePlayCircle}>
          <MaterialCommunityIcons name="play" size={22} color="#FFFFFF" style={{ marginLeft: 3 }} />
        </View>
      </View>
      {resolvedDur ? (
        <View style={styles.videoCoverDuration}>
          <Text style={styles.videoCoverDurationText}>{resolvedDur}s</Text>
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

function LiveCoverImage({ uri, palette }: { uri: string; palette: Palette }) {
  const [err, setErr] = useState(false);
  if (err) {
    return (
      <View
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor: palette.fill2, alignItems: 'center', justifyContent: 'center' },
        ]}
      >
        <MaterialCommunityIcons
          name="play-circle-outline"
          size={34}
          color={palette.labelTertiary}
        />
      </View>
    );
  }
  return (
    <NetworkImage
      source={{ uri }}
      style={styles.liveCardImg}
      resizeMode="cover"
      onError={() => setErr(true)}
      thumbnail={700}
    />
  );
}

function AudioMediaCard({
  media,
  mine = false,
  onPlay,
  onLongPress,
}: {
  media: RoomMedia;
  mine?: boolean;
  onPlay: () => void;
  onLongPress: () => void;
}) {
  return (
    <VoiceMessageBar
      url={media.url}
      duration={Number(media.duration) || 0}
      onTint={mine}
      onLongPress={onLongPress}
      onFallbackPlay={onPlay}
    />
  );
}

const USER_CARD_AVATAR_SIZE = 64;

const ROOM_AVATAR_SIZE = 40;

type RoomChatListScrollEvent =
  | NativeSyntheticEvent<NativeScrollEvent>
  | {
      readonly eventName?: string;
      readonly contentOffset?: { readonly y?: number };
      readonly contentSize?: { readonly height?: number };
      readonly layoutMeasurement?: { readonly height?: number };
    };

function renderHighlightedTextParts(
  text: string,
  qLower: string,
  highlightStyle: { backgroundColor: string; color: string; fontWeight: '700' },
  keyPrefix: string,
) {
  if (!qLower) return text;
  const lower = text.toLowerCase();
  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  let matchIdx = lower.indexOf(qLower, cursor);
  if (matchIdx === -1) return text;
  let count = 0;
  while (matchIdx !== -1) {
    if (matchIdx > cursor) nodes.push(text.slice(cursor, matchIdx));
    const end = matchIdx + qLower.length;
    nodes.push(
      <Text key={`${keyPrefix}-h-${count++}`} style={highlightStyle}>
        {text.slice(matchIdx, end)}
      </Text>,
    );
    cursor = end;
    matchIdx = lower.indexOf(qLower, cursor);
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

interface RoomChatRowProps {
  row: ChatRow;
  room: Member;
  showFanMessages: boolean;
  currentUserId: string;
  memberIdSet: Set<string>;
  token: string;
  palette: Palette;
  hideVideoCard: boolean;
  isMediaPlaying: boolean;
  highlightQuery: string;
  memberLookupRef: React.MutableRefObject<Map<string, Member>>;
  t: (key: string, vars?: Record<string, string | number>) => string;
  onOpenProfile: (opts: {
    id: string;
    name: string;
    avatar: string;
    member?: Member | null;
    userIds?: string[];
    missingIdMessage?: string;
  }) => void;
  onOpenActions: (
    item: RoomMessageWire,
    mine: boolean,
    senderName: string,
    media?: RoomMedia | null,
  ) => void;
  onPlayMedia: (media: RoomMedia) => void;
  onPreviewImage: (url: string) => void;
}

const RoomChatRow = React.memo(function RoomChatRow({
  row,
  room,
  showFanMessages,
  currentUserId,
  memberIdSet,
  token,
  palette,
  hideVideoCard,
  isMediaPlaying,
  highlightQuery,
  memberLookupRef,
  t,
  onOpenProfile,
  onOpenActions,
  onPlayMedia,
  onPreviewImage,
}: RoomChatRowProps) {
  const item = row.item;
  if (!item) return <View />;

  const role = messageRole(item, room, showFanMessages, currentUserId, memberIdSet);
  const mine = role === 'mine';
  const idol = role === 'idol';
  const msgProfile = senderProfile(item, room);
  const isRoomOwner = isIdolMessage(item, room, showFanMessages, msgProfile);

  const senderId = String(msgProfile.id || '').trim();
  const senderMember = senderId ? memberLookupRef.current.get(senderId) : undefined;
  const isMemberSender = !!senderMember || (Number(extraInfo(item)?.user?.roleId ?? 0) || 0) > 1;

  const profile = senderMember
    ? {
        id: senderMember.id,
        name: (msgProfile.name || '').trim() || senderMember.ownerName,
        avatar: msgProfile.avatar || senderMember.avatar,
      }
    : isRoomOwner
      ? {
          id: room.id,
          name: (msgProfile.name || '').trim() || shortName(room),
          avatar: msgProfile.avatar || room.avatar,
        }
      : msgProfile;

  const tagSource: Member | undefined = senderMember || (isRoomOwner ? room : undefined);
  const teamLogo = String(tagSource?.teamLogo || '').trim();
  const media = roomMedia(item);
  const gift = roomGiftInfo(item);
  const payload = messagePayload(item);
  const extPayload = extraInfo(item);
  const flipInfo = getRoomFlipInfo(payload, String(item?.msgType || item?.extMsgType || ''));
  const replyInfo =
    payload?.replyInfo ||
    payload?.giftReplyInfo ||
    payload?.reply ||
    payload?.replay ||
    payload?.replyGiftInfo ||
    extPayload?.replyInfo ||
    extPayload?.giftReplyInfo;
  const replyName = replyInfo?.replyName || '';
  const replyQuoted = replyInfo?.replyText || '';
  const msgTypeUpper = String(
    item?.msgType || item?.extMsgType || payload?.msgType || payload?.messageType || '',
  ).toUpperCase();
  const isGiftReply = Boolean(
    payload?.giftReplyInfo ||
    extPayload?.giftReplyInfo ||
    payload?.replay?.mReplyGiftInfo ||
    payload?.replyGiftInfo ||
    msgTypeUpper === 'GIFTREPLY' ||
    msgTypeUpper === 'AUDIO_GIFT_REPLY',
  );
  const body = messageText(item);
  let giftReplyText = '';
  if (gift) {
    const gr = (payload?.giftReplyInfo ||
      extPayload?.giftReplyInfo ||
      payload?.replay ||
      payload?.replyGiftInfo ||
      payload?.replyInfo ||
      {}) as WireRecord;

    const rawText =
      gr.text ||
      payload.text ||
      (typeof payload.body === 'string' && !payload.body.startsWith('{') ? payload.body : '');
    if (typeof rawText === 'string') giftReplyText = rawText.trim();
  }

  const flipAnswerRaw = firstTextFrom(
    [payload, item, body],
    ['answerContent', 'answer', 'answerText', 'replyContent'],
  );
  let flipAnswer = '';
  if (flipAnswerRaw) {
    try {
      const j = typeof flipAnswerRaw === 'string' ? JSON.parse(flipAnswerRaw) : flipAnswerRaw;
      flipAnswer =
        j && typeof j === 'object'
          ? String((j as WireRecord).text || (j as WireRecord).content || '')
          : String(flipAnswerRaw);
    } catch {
      flipAnswer = String(flipAnswerRaw);
    }
  }
  const baseText = flipInfo ? flipInfo.answerText : flipAnswer || body;
  const isMediaLabel = /^\[(语音|图片|视频|链接|直播)\]/.test(baseText);
  const looksLikeFile =
    (!media && /^https?:\/\//i.test(String(baseText || ''))) ||
    /\.(amr|mp3|m4a|aac|mp4|mov|jpg|jpeg|png|gif|webp)(\?|$)/i.test(String(baseText || ''));
  const bubbleText = gift
    ? giftReplyText
    : media
      ? !isMediaLabel
        ? baseText
        : ''
      : looksLikeFile
        ? ''
        : baseText;
  const mediaA11yLabel = media
    ? media.type === 'image'
      ? media.title === t('表情')
        ? t('表情')
        : t('图片')
      : media.type === 'video'
        ? t('视频')
        : media.title || t('播放')
    : '';

  const avatarMember: Member | null = senderMember || (isRoomOwner ? room : null);
  const extUser: WireRecord = extraInfo(item)?.user || payload?.user || {};
  const extUserId = String(extUser?.userId ?? extUser?.user_id ?? extUser?.id ?? '').trim();
  const canOpenProfile = !!avatarMember || !!senderId || !!extUserId;
  const senderFrameUrl = firstFrameFrom(extUser);
  const qLower = highlightQuery.trim().toLowerCase();
  const matchHighlightStyle = {
    backgroundColor: mine ? 'rgba(255,255,255,0.28)' : palette.tintSoft,
    color: mine ? palette.onTint : palette.tint,
    fontWeight: '700' as const,
  };

  return (
    <View
      style={[styles.chatRow, mine && styles.chatRowMine, !row.groupStart && styles.chatRowTight]}
    >
      {!mine ? (
        row.groupStart ? (
          <TouchableOpacity
            activeOpacity={0.8}
            disabled={!canOpenProfile}
            accessibilityLabel={t('头像')}
            onPress={() =>
              onOpenProfile({
                id: senderId,
                name: profile.name,
                avatar: profile.avatar,
                member: avatarMember,
                userIds: [extUserId],
              })
            }
          >
            <View>
              <AvatarWithFrame
                avatarUri={profile.avatar ? thumbUrl(profile.avatar, AVATAR_THUMB_WIDTH) : ''}
                frameUri={senderFrameUrl}
                size={ROOM_AVATAR_SIZE}
                fallbackText={avatarInitial(profile.name)}
                fallbackColor={palette.tint}
                fallbackBg={palette.fill2}
              />
            </View>
          </TouchableOpacity>
        ) : (
          <View style={styles.avatarPlaceholder} />
        )
      ) : null}
      <View style={[styles.msgBlock, mine && styles.msgBlockMine]}>
        {row.groupStart ? (
          <View style={[styles.msgMetaLine, mine && styles.msgMetaLineMine]}>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                flexShrink: 1,
                minWidth: 0,
              }}
            >
              {isRoomOwner ? (
                <MaterialCommunityIcons name="crown" size={11} color={palette.tint} />
              ) : null}
              <Text
                style={[
                  styles.msgSender,
                  {
                    color:
                      isRoomOwner || isMemberSender
                        ? palette.tint
                        : mine
                          ? palette.tint
                          : palette.labelSecondary,
                  },
                ]}
                numberOfLines={1}
              >
                {profile.name}
              </Text>
              <UserDecorRow
                decor={{
                  isStar: isRoomOwner || isMemberSender,
                  roleId: isMemberSender ? 2 : Number(extUser?.roleId ?? extUser?.userRole ?? 0),
                  teamLogo: String(extUser?.teamLogo || teamLogo || ''),
                  pfUrl: String(extUser?.pfUrl || ''),
                  vip: !!extUser?.vip,
                  level: extUser?.level ?? extUser?.userLevel ?? extUser?.grade,
                }}
                size={11}
              />
            </View>
            <Text
              style={[styles.msgTime, { color: palette.labelSecondary }]}
              allowFontScaling={false}
            >
              {formatTimestamp(getMessageTime(item)).slice(11, 16)}
            </Text>
          </View>
        ) : null}

        <GlassSurface
          role="chip"
          radius={18}
          frostedOnly
          onLongPress={() =>
            onOpenActions(item, mine, (profile.name || '').trim() || t('未知用户'))
          }
          tintColor={mine ? palette.tint : undefined}
          accessibilityLabel={mediaA11yLabel || undefined}
          style={[styles.msgBubble, { alignSelf: mine ? 'flex-end' : 'flex-start' }]}
        >
          {flipInfo ? (
            <RoomFlipQuestion
              question={flipInfo.question}
              questionId={flipInfo.questionId}
              answerId={flipInfo.answerId}
              token={token || ''}
              mine={mine}
              onOpenProfile={onOpenProfile}
            />
          ) : null}
          {replyName || replyQuoted ? (
            <View
              style={[
                styles.replyCard,
                {
                  backgroundColor: mine
                    ? 'rgba(255,255,255,0.18)'
                    : idol
                      ? palette.tintSoft
                      : palette.fill2,
                  borderLeftColor: mine ? 'rgba(255,255,255,0.85)' : palette.tint,
                },
              ]}
            >
              {replyName ? (
                <Text
                  style={[styles.replyName, { color: mine ? palette.onTint : palette.tint }]}
                  numberOfLines={1}
                >
                  {replyName}
                </Text>
              ) : null}
              {replyQuoted ? (
                <Text
                  style={[
                    styles.replyText,
                    { color: mine ? 'rgba(255,255,255,0.85)' : palette.labelSecondary },
                  ]}
                  numberOfLines={3}
                >
                  {replyQuoted}
                </Text>
              ) : null}
            </View>
          ) : null}
          {bubbleText
            ? (() => {
                const parts = splitEmojiParts(bubbleText);
                return (
                  <Text
                    style={[
                      styles.msgBody,
                      (mine || idol) && styles.msgBodyHighlight,
                      {
                        color: mine
                          ? palette.onTint
                          : idol
                            ? palette.label
                            : palette.labelSecondary,
                      },
                    ]}
                  >
                    {parts.map((p, i) =>
                      typeof p === 'string' ? (
                        renderHighlightedTextParts(p, qLower, matchHighlightStyle, `e-${i}`)
                      ) : (
                        <Image
                          key={`${p.emoji}-${i}`}
                          source={p.source}
                          style={{ width: 20, height: 20 }}
                          resizeMode="contain"
                        />
                      ),
                    )}
                  </Text>
                );
              })()
            : null}
          {gift && !giftReplyText && !isGiftReply && !replyName && !replyQuoted ? (
            <View
              style={[
                styles.giftCard,
                { backgroundColor: palette.fill2, borderColor: palette.tintSoft },
              ]}
            >
              {gift.image ? (
                <NetworkImage
                  source={{ uri: gift.image }}
                  style={[styles.giftImage, { backgroundColor: palette.surfaceGlassStrong }]}
                  thumbnail={180}
                />
              ) : (
                <View style={[styles.giftImageFallback, { backgroundColor: palette.tint }]}>
                  <MaterialCommunityIcons name="gift" size={16} color={palette.onTint} />
                </View>
              )}
              <View style={styles.giftTextWrap}>
                <Text style={[styles.giftName, { color: palette.label }]} numberOfLines={1}>
                  {isRoomOwner ? t('感谢礼物') : t('送出礼物')}：{gift.name}
                </Text>
                <Text style={[styles.giftMeta, { color: palette.labelSecondary }]}>
                  {t('数量')} x{gift.num}
                  {gift.total ? ` · ${gift.total}` : ''}
                </Text>
              </View>
            </View>
          ) : null}
          {media ? (
            media.type === 'image' && media.url ? (
              <TouchableOpacity
                style={[
                  styles.inlineImageWrap,
                  media.title === t('表情') && styles.inlineStickerWrap,
                  (bubbleText || replyName || replyQuoted) && { marginTop: 8 },
                ]}
                onPress={() => onPreviewImage(media.url)}
                onLongPress={() =>
                  onOpenActions(item, mine, (profile.name || '').trim() || t('未知用户'), media)
                }
                activeOpacity={0.9}
                accessibilityLabel={media.title === t('表情') ? t('表情') : t('图片')}
              >
                <NetworkImage
                  source={{ uri: media.url }}
                  style={media.title === t('表情') ? styles.inlineSticker : styles.inlineImage}
                  resizeMode="cover"
                  thumbnail={media.title === t('表情') ? 400 : 700}
                />
              </TouchableOpacity>
            ) : media.type === 'live' && media.cover ? (
              <TouchableOpacity
                style={styles.liveCardWrap}
                onPress={() => onPlayMedia(media)}
                onLongPress={() =>
                  onOpenActions(item, mine, (profile.name || '').trim() || t('未知用户'), media)
                }
                activeOpacity={0.9}
                accessibilityLabel={media.title || t('播放')}
              >
                <LiveCoverImage uri={media.cover} palette={palette} />
                <View style={styles.liveCardOverlay}>
                  <View style={styles.livePlayCircle}>
                    <MaterialCommunityIcons
                      name="play"
                      size={22}
                      color="#FFFFFF"
                      style={{ marginLeft: 3 }}
                    />
                  </View>
                </View>
                <View style={styles.liveCardTitleBar}>
                  <Text style={styles.liveCardTitle} numberOfLines={1}>
                    {media.title}
                  </Text>
                </View>
              </TouchableOpacity>
            ) : media.type === 'video' && media.url ? (
              hideVideoCard ? null : (
                <VideoCoverCard
                  media={media}
                  onPress={() => onPlayMedia(media)}
                  onLongPress={() =>
                    onOpenActions(item, mine, (profile.name || '').trim() || t('未知用户'), media)
                  }
                />
              )
            ) : media.type === 'audio' ? (
              <View style={bubbleText || replyName || replyQuoted ? { marginTop: 8 } : null}>
                <AudioMediaCard
                  media={media}
                  mine={mine}
                  onPlay={() => onPlayMedia(media)}
                  onLongPress={() =>
                    onOpenActions(item, mine, (profile.name || '').trim() || t('未知用户'), media)
                  }
                />
              </View>
            ) : (
              <TouchableOpacity
                style={[
                  styles.mediaCard,
                  {
                    backgroundColor: idol || mine ? palette.tint : palette.surfaceGlass,
                    borderColor: idol || mine ? 'rgba(255,255,255,0.38)' : palette.innerStroke,
                    borderWidth: StyleSheet.hairlineWidth,
                  },
                ]}
                activeOpacity={0.92}
                onLongPress={() =>
                  onOpenActions(item, mine, (profile.name || '').trim() || t('未知用户'), media)
                }
              >
                {media.cover ? (
                  <NetworkImage
                    source={{ uri: media.cover }}
                    style={styles.liveCover}
                    resizeMode="cover"
                    thumbnail={700}
                  />
                ) : null}
                <View style={styles.mediaMeta}>
                  <Text
                    style={[
                      styles.mediaIcon,
                      idol || mine ? { color: palette.onTint } : { color: palette.tint },
                    ]}
                  >
                    {t(mediaLabel(media.type))}
                  </Text>
                  {media.type !== 'video' && media.title ? (
                    <Text
                      style={[
                        styles.mediaTitle,
                        idol || mine ? { color: palette.onTint } : { color: palette.label },
                      ]}
                      numberOfLines={2}
                    >
                      {media.title}
                    </Text>
                  ) : null}
                  {media.duration ? (
                    <Text
                      style={[
                        styles.mediaDuration,
                        idol || mine
                          ? { color: palette.onTint }
                          : { color: palette.labelSecondary },
                      ]}
                    >
                      {media.duration}s
                    </Text>
                  ) : null}
                </View>
                <TouchableOpacity
                  style={[
                    styles.mediaPlayBtn,
                    {
                      backgroundColor: palette.tint,
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 4,
                    },
                  ]}
                  onPress={() => onPlayMedia(media)}
                  activeOpacity={0.85}
                >
                  <MaterialCommunityIcons
                    name={isMediaPlaying ? 'pause' : 'play'}
                    size={14}
                    color={palette.onTint}
                  />
                  <Text style={[styles.mediaPlayText, { color: palette.onTint }]}>
                    {isMediaPlaying ? t('暂停') : media.duration ? `${media.duration}s` : t('播放')}
                  </Text>
                </TouchableOpacity>
              </TouchableOpacity>
            )
          ) : !bubbleText && !gift ? (
            <Text
              style={[
                styles.msgBody,
                (idol || mine) && styles.msgBodyHighlight,
                idol || mine ? { color: palette.onTint } : { color: palette.labelSecondary },
              ]}
            >
              {t('[空消息]')}
            </Text>
          ) : null}
          {media?.url && isMediaPlaying && media.type === 'link' ? (
            <TouchableOpacity
              style={styles.openLinkBtn}
              onPress={() => Linking.openURL(media.url).catch(() => {})}
              activeOpacity={0.85}
            >
              <Text style={[styles.openLinkText, { color: palette.tint }]} numberOfLines={1}>
                {media.url}
              </Text>
            </TouchableOpacity>
          ) : null}
        </GlassSurface>
      </View>
    </View>
  );
});

const ROOM_CHAT_THEME = { colors: { background: 'transparent' } } as const;
const ROOM_CHAT_USER = { _id: 'SELF' } as const;
const ROOM_CHAT_MESSAGES_CONTAINER_STYLE = { backgroundColor: 'transparent' } as const;
const ROOM_CHAT_NO_INPUT_TOOLBAR = () => null;
const ROOM_CHAT_NOOP_SEND = () => {};

const RoomChatListPane = React.memo(function RoomChatListPane({
  messages,
  listRef,
  listProps,
  renderMessage,
  renderDay,
  loadEarlierProps,
  showJumpBtn,
  pendingCount,
  onJumpOut,
  palette,
  t,
}: {
  messages: RoomChatIM[];
  listRef: React.RefObject<any>;
  listProps: any;
  renderMessage: (props: { currentMessage?: { __row?: ChatRow } }) => React.ReactElement | null;
  renderDay: (props: {
    date?: Date | number | string;
    createdAt?: Date | number | string;
  }) => React.ReactElement | null;
  loadEarlierProps: any;
  showJumpBtn: boolean;
  pendingCount: number;
  onJumpOut: () => void;
  palette: Palette;
  t: (k: string, p?: any) => string;
}) {
  return (
    <View style={{ flex: 1, overflow: 'hidden' }}>
      <Chat
        messages={messages}
        theme={ROOM_CHAT_THEME as any}
        darkTheme={ROOM_CHAT_THEME as any}
        messagesContainerStyle={ROOM_CHAT_MESSAGES_CONTAINER_STYLE as any}
        isScrollToBottomEnabled={false}
        messagesContainerRef={listRef}
        listProps={listProps}
        locale="zh"
        renderMessage={renderMessage as any}
        renderDay={renderDay}
        isDayAnimationEnabled={false}
        user={ROOM_CHAT_USER as any}
        onSend={ROOM_CHAT_NOOP_SEND}
        renderInputToolbar={ROOM_CHAT_NO_INPUT_TOOLBAR}
        loadEarlierMessagesProps={loadEarlierProps}
      />

      {showJumpBtn ? (
        <ScalePressable
          onPress={onJumpOut}
          pressedScale={0.92}
          activeOpacity={0.9}
          hitSlop={{ top: 12, bottom: 12, left: 16, right: 16 }}
          style={[
            styles.roomJumpBtn,
            {
              backgroundColor: palette.surfaceGlassStrong,
              borderColor: palette.hairline,
            },
          ]}
        >
          <MaterialCommunityIcons name="chevron-down" size={15} color={palette.tint} />
          <Text style={[styles.roomJumpText, { color: palette.tint }]}>
            {pendingCount > 0 ? t('{count} 条新消息', { count: pendingCount }) : t('回到底部')}
          </Text>
        </ScalePressable>
      ) : null}
    </View>
  );
});

const RoomComposerBar = React.memo(function RoomComposerBar({
  resetKey,
  inputRef,
  replyTarget,
  onClearReply,
  sendHint,
  onClearSendHint,
  sending,
  onSendText,
  onSendSticker,
  onOpenGift,
  channelId,
  memberId,
  roomKeyboardHeight,
  bottomInset,
  stickerBottomInset,
  resolvedTheme,
  palette,
  t,
}: {
  resetKey: string;
  inputRef: React.RefObject<TextInput | null>;
  replyTarget: { replyMessageId: string; replyName: string; replyText: string } | null;
  onClearReply: () => void;
  sendHint: string;
  onClearSendHint: () => void;
  sending: boolean;
  onSendText: (text: string) => Promise<boolean>;
  onSendSticker: (sticker: RoomSticker) => Promise<void>;
  onOpenGift: () => void;
  channelId: string;
  memberId: string;
  roomKeyboardHeight: number;
  bottomInset: number;
  stickerBottomInset: number;
  resolvedTheme: string;
  palette: Palette;
  t: (k: string, p?: any) => string;
}) {
  const [draft, setDraft] = useState('');
  const [stickerOpen, setStickerOpen] = useState(false);

  useEffect(() => {
    setDraft('');
    setStickerOpen(false);
  }, [resetKey]);

  const handleSubmit = useCallback(async () => {
    const ok = await onSendText(draft);
    if (ok) setDraft('');
  }, [draft, onSendText]);

  const trimmed = draft.trim();
  return (
    <>
      {replyTarget ? (
        <View style={[styles.replyBar, { borderLeftColor: palette.tint }]}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[styles.replyBarName, { color: palette.tint }]} numberOfLines={1}>
              {t('回复 {name}', { name: replyTarget.replyName })}
            </Text>
            <Text
              style={[styles.replyBarText, { color: palette.labelSecondary }]}
              numberOfLines={1}
            >
              {replyTarget.replyText}
            </Text>
          </View>
          <TouchableOpacity onPress={onClearReply} hitSlop={10}>
            <MaterialCommunityIcons name="close" size={18} color={palette.labelTertiary} />
          </TouchableOpacity>
        </View>
      ) : null}
      {sendHint ? (
        <Text style={[styles.roomSendHint, { color: palette.tint }]} numberOfLines={2}>
          {sendHint}
        </Text>
      ) : null}
      <GlassSurface
        role="bar"
        radius={25}
        frostedOnly
        tintColor={resolvedTheme === 'dark' ? 'rgba(24,24,30,0.84)' : 'rgba(244,245,251,0.88)'}
        style={[
          styles.roomInputBar,
          {
            backgroundColor: 'transparent',
            borderColor:
              resolvedTheme === 'dark' ? 'rgba(255,255,255,0.14)' : 'rgba(18,22,36,0.08)',
            borderWidth: StyleSheet.hairlineWidth,
            marginBottom: stickerOpen || roomKeyboardHeight ? 8 : bottomInset,
          },
        ]}
      >
        <TouchableOpacity
          onPress={onOpenGift}
          activeOpacity={0.85}
          style={[styles.roomGiftBtn, { backgroundColor: palette.tintSoft }]}
          accessibilityLabel={t('礼物')}
        >
          <MaterialCommunityIcons name="gift-outline" size={20} color={palette.tint} />
        </TouchableOpacity>
        <TextInput
          ref={inputRef}
          style={[styles.roomInput, { color: palette.label }]}
          value={draft}
          onChangeText={(next) => {
            setDraft(next);
            if (sendHint) onClearSendHint();
          }}
          onFocus={() => setStickerOpen(false)}
          placeholder={t('说点什么…')}
          placeholderTextColor={palette.labelTertiary}
          maxLength={200}
          returnKeyType="send"
          onSubmitEditing={() => void handleSubmit()}
        />
        <TouchableOpacity
          onPress={() => {
            Keyboard.dismiss();
            setStickerOpen((open) => !open);
          }}
          style={styles.roomEmojiBtn}
          accessibilityLabel={t('表情包')}
        >
          <MaterialCommunityIcons name="emoticon-outline" size={21} color={palette.tint} />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => void handleSubmit()}
          disabled={sending || !trimmed}
          activeOpacity={0.85}
          style={[styles.roomSendBtn, { backgroundColor: trimmed ? palette.tint : palette.fill3 }]}
        >
          <Text
            style={[
              styles.roomSendBtnText,
              { color: trimmed ? palette.onTint : palette.labelTertiary },
            ]}
          >
            {sending ? '··' : t('发送')}
          </Text>
        </TouchableOpacity>
      </GlassSurface>
      {stickerOpen ? (
        <View style={{ paddingBottom: stickerBottomInset }}>
          <RoomStickerPanel
            channelId={channelId}
            ownerId={memberId}
            disabled={sending}
            onEmoji={(tag) => setDraft((d) => (d + tag).slice(0, 200))}
            onSticker={onSendSticker}
          />
        </View>
      ) : null}
    </>
  );
});

export default function FollowedRoomsScreen() {
  const insets = useSafeAreaInsets();
  const palette = usePalette();

  const blurTarget = useBlurTarget();
  const resolvedTheme = useResolvedTheme();
  const { t } = useI18n();
  const token = useSettingsStore((state) => state.settings.p48Token);
  const showRoomListTime = useSettingsStore(
    (state) => state.settings.yaya_room_list_time !== false,
  );
  const sendBubbleId = useSettingsStore((state) => state.settings.yaya_send_bubble_id);
  const setDockHidden = useUiStore((state) => state.setTabBarHidden);
  const setTabBarHidden = useCallback(
    (hidden: boolean) => setDockHidden(hidden, 'Rooms'),
    [setDockHidden],
  );
  const showToast = useUiStore((state) => state.showToast);
  const setScreenBackdrop = useUiStore((state) => state.setScreenBackdrop);
  const navigation = useNavigation<StackNavigationProp<RootStackParamList>>();
  const roomBackdropAppliedRef = useRef(false);
  const roomOrientationTouchedRef = useRef(false);
  const members = useMemberStore((state) => state.members);

  const memberIdSet = useMemo(() => buildMemberIdSet(members), [members]);

  const memberLookupMap = useMemo(() => {
    const map = new Map<string, Member>();
    for (const item of members) {
      for (const rawId of [item?.id, item?.userId, item?.memberId, item?.account]) {
        const key = String(rawId ?? '').trim();
        if (key && !map.has(key)) map.set(key, item);
      }
    }
    return map;
  }, [members]);
  const memberLookupRef = useRef(memberLookupMap);
  memberLookupRef.current = memberLookupMap;
  const channelMemberMap = useMemo(() => {
    const map = new Map<string, Member>();
    for (const m of members) {
      const ch = String(m.channelId || '');
      if (ch && !map.has(ch)) map.set(ch, m);
      const yk = String(m.yklzId || '');
      if (yk && !map.has(yk)) map.set(yk, m);
    }
    return map;
  }, [members]);
  const channelMemberRef = useRef(channelMemberMap);
  channelMemberRef.current = channelMemberMap;
  const lastRoomsLoadedAtRef = useRef(0);
  const smallRoomProbedRef = useRef<Set<string>>(new Set());
  const roomMetaRevalidatedRef = useRef<Set<string>>(new Set());
  const onMicStartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const roomEnterRafRef = useRef<number | null>(null);
  const roomEnterPendingRef = useRef(false);
  const closeSeqRef = useRef(0);
  useEffect(
    () => () => {
      if (onMicStartTimerRef.current) {
        clearTimeout(onMicStartTimerRef.current);
        onMicStartTimerRef.current = null;
      }
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
      if (roomEnterRafRef.current !== null) {
        cancelAnimationFrame(roomEnterRafRef.current);
        roomEnterRafRef.current = null;
      }
    },
    [],
  );
  const [selectedRoom, setSelectedRoom] = useState<Member | null>(null);
  const selectedRoomRef = useRef<Member | null>(null);
  selectedRoomRef.current = selectedRoom;
  const isRoomsFocusedRef = useRef(navigation.isFocused());
  const onMicDirtyRef = useRef(false);
  const roomTimeDirtyRef = useRef(false);
  const pendingQChatByChannelRef = useRef<Map<string, RoomMessageWire>>(new Map());
  const activeRoomKey = selectedRoom ? String(selectedRoom.id || selectedRoom.userId || '') : '';
  const hasActiveRoomOnMic = useOnMicStore((state) =>
    activeRoomKey ? Boolean(state.onMic[activeRoomKey]) : false,
  );
  const [onMicState, setOnMicState] = useState<Record<string, OnMicEntry>>(
    () => useOnMicStore.getState().onMic,
  );
  const [voiceRoomsState, setVoiceRoomsState] = useState<Record<string, boolean>>(
    () => useOnMicStore.getState().voiceRooms,
  );
  const onMicMap = selectedRoom ? EMPTY_ONMIC : onMicState;
  const voiceRooms = selectedRoom ? EMPTY_VOICEROOMS : voiceRoomsState;
  const [followed, setFollowed] = useState<FollowedRoom[]>([]);
  const followedRef = useRef<FollowedRoom[]>([]);
  followedRef.current = followed;
  const [followedLoading, setFollowedLoading] = useState(false);

  const [liveNow, setLiveNow] = useState<{ ids: Set<string>; names: Set<string> }>({
    ids: new Set(),
    names: new Set(),
  });

  const liveNowRef = useRef<{ ids: Set<string>; names: Set<string> }>({
    ids: new Set(),
    names: new Set(),
  });
  liveNowRef.current = liveNow;
  const liveEmptyTicksRef = useRef(0);
  const discoveredLives = useDiscoveredLivesStore((s) => s.items);
  const effectiveLiveNow = useMemo(() => {
    if (!discoveredLives.length) return liveNow;
    const ids = new Set(liveNow.ids);
    const names = new Set(liveNow.names);
    for (const it of discoveredLives) {
      if (it.userId) ids.add(String(it.userId));
      const nick = String(it.nickname || '')
        .replace(/^(SNH48|GNZ48|BEJ48|CKG48|CGT48)-/i, '')
        .trim()
        .toLowerCase();
      if (nick) names.add(nick);
    }
    return { ids, names };
  }, [liveNow, discoveredLives]);
  const [pinned, setPinned] = useState<string[]>([]);

  const pinnedRef = useRef<string[]>([]);
  const pinnedWriteRef = useRef<Promise<void>>(Promise.resolve());
  const [roomClosing, setRoomClosing] = useState(false);
  const roomClosingRef = useRef(false);

  const roomEnter = useSharedValue(0);
  const roomEnterStyle = useAnimatedStyle(() => ({
    opacity: roomEnter.value,
    transform: [{ translateX: (1 - roomEnter.value) * 24 }],
  }));
  useEffect(() => {
    if (!selectedRoom || !roomEnterPendingRef.current) return;
    roomEnterPendingRef.current = false;
    if (roomEnterRafRef.current !== null) cancelAnimationFrame(roomEnterRafRef.current);
    roomEnterRafRef.current = requestAnimationFrame(() => {
      roomEnterRafRef.current = null;
      if (!roomClosingRef.current) {
        roomEnter.value = withTiming(1, {
          duration: 210,
          easing: Easing.bezier(0.22, 1, 0.36, 1),
        });
      }
    });
  }, [selectedRoom, roomEnter]);
  const [roomMessages, setRoomMessages] = useState<RoomMessage[]>([]);

  const roomMessagesCache = useRef<
    Record<string, { messages: RoomMessage[]; nextTime: number; hasMore: boolean }>
  >({});

  const deletedRoomMsgIdsRef = useRef<Set<string>>(new Set());
  const rememberDeletedMsgIds = useCallback((ids: string[]) => {
    if (!ids.length) return;
    const store = deletedRoomMsgIdsRef.current;
    for (let i = 0; i < ids.length; i += 1) {
      const id = String(ids[i] || '').trim();
      if (!id) continue;
      if (store.has(id)) store.delete(id);
      store.add(id);
    }
    while (store.size > 300) {
      const oldest = store.values().next().value;
      if (!oldest) break;
      store.delete(oldest);
    }
  }, []);

  const roomMessagesRef = useRef<RoomMessage[]>([]);
  roomMessagesRef.current = roomMessages;

  const lastRoomPushAtRef = useRef(0);

  const roomPushCountRef = useRef(0);

  const roomKeyboardHeight = useKeyboardHeight(Boolean(selectedRoom));
  const [loading, setLoading] = useState(false);
  const loadingRef = useRef(false);
  loadingRef.current = loading;

  const [roomLoadedOnce, setRoomLoadedOnce] = useState(false);

  const [followedError, setFollowedError] = useState('');
  const [, setRoomMsgError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [memberBrowseOpen, setMemberBrowseOpen] = useState(false);
  const roomTimeCacheRef = useRef<Record<string, RoomLastTimeEntry>>({});
  const [roomTimeCacheVer, setRoomTimeCacheVer] = useState(0);
  const [roomTimeCacheLoaded, setRoomTimeCacheLoaded] = useState(false);
  const roomTimePersistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const roomTimeVerFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hydratedPreviewKeysRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(ROOM_LAST_TIME_CACHE_KEY)
      .then((raw) => {
        if (!alive || !raw) return;
        const parsed = JSON.parse(raw) as Record<string, RoomLastTimeEntry>;
        if (!parsed || typeof parsed !== 'object') return;
        const merged: Record<string, RoomLastTimeEntry> = { ...roomTimeCacheRef.current };
        for (const [cid, entry] of Object.entries(parsed)) {
          if (!cid || !entry || typeof entry.timeMs !== 'number') continue;
          if (entry.timeMs < MIN_VALID_ROOM_TIME_MS) continue;
          if (!merged[cid] || entry.timeMs >= merged[cid].timeMs) {
            merged[cid] = {
              timeMs: entry.timeMs,
              ...(entry.preview ? { preview: String(entry.preview) } : {}),
            };
          }
        }
        roomTimeCacheRef.current = merged;
        setRoomTimeCacheVer((v) => v + 1);
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setRoomTimeCacheLoaded(true);
      });
    return () => {
      alive = false;
      if (roomTimePersistTimerRef.current) {
        clearTimeout(roomTimePersistTimerRef.current);
        roomTimePersistTimerRef.current = null;
      }
      if (roomTimeVerFlushTimerRef.current) {
        clearTimeout(roomTimeVerFlushTimerRef.current);
        roomTimeVerFlushTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    let focusSyncTimer: ReturnType<typeof setTimeout> | null = null;
    const syncFromStore = () => {
      onMicDirtyRef.current = false;
      const st = useOnMicStore.getState();
      setOnMicState(st.onMic);
      setVoiceRoomsState(st.voiceRooms);
    };
    const offStore = useOnMicStore.subscribe((state, prev) => {
      if (state.onMic === prev.onMic && state.voiceRooms === prev.voiceRooms) return;
      if (!isRoomsFocusedRef.current || selectedRoomRef.current) {
        onMicDirtyRef.current = true;
        return;
      }
      onMicDirtyRef.current = false;
      setOnMicState(state.onMic);
      setVoiceRoomsState(state.voiceRooms);
    });
    const offFocus = navigation.addListener('focus', () => {
      isRoomsFocusedRef.current = true;
      if (focusSyncTimer) clearTimeout(focusSyncTimer);
      focusSyncTimer = setTimeout(() => {
        focusSyncTimer = null;
        if (!isRoomsFocusedRef.current) return;
        startTransition(() => {
          if (onMicDirtyRef.current) syncFromStore();
          if (roomTimeDirtyRef.current) {
            roomTimeDirtyRef.current = false;
            setRoomTimeCacheVer((v) => v + 1);
          }
          if (pendingQChatByChannelRef.current.size > 0) {
            const batch = new Map(pendingQChatByChannelRef.current);
            pendingQChatByChannelRef.current.clear();
            setFollowed((prev) => {
              let changed = false;
              const next = prev.map((entry) => {
                const bigCid = String(entry.member?.channelId || '').trim();
                const smallCid = String(entry.member?.yklzId || '').trim();
                const bigMsg = bigCid ? batch.get(bigCid) : undefined;
                const smallMsg = smallCid ? batch.get(smallCid) : undefined;
                if (!bigMsg && !smallMsg) return entry;
                changed = true;
                return {
                  ...entry,
                  ...(bigMsg ? { lastMessage: bigMsg as unknown as RoomMessageWire } : null),
                  ...(smallMsg
                    ? { lastSmallMessage: smallMsg as unknown as RoomMessageWire }
                    : null),
                };
              });
              return changed ? next : prev;
            });
          }
        });
      }, 120);
    });
    const offBlur = navigation.addListener('blur', () => {
      isRoomsFocusedRef.current = false;
      if (focusSyncTimer) {
        clearTimeout(focusSyncTimer);
        focusSyncTimer = null;
      }
    });
    return () => {
      if (focusSyncTimer) clearTimeout(focusSyncTimer);
      offStore();
      offFocus();
      offBlur();
    };
  }, [navigation]);

  useEffect(() => {
    if (selectedRoom || !onMicDirtyRef.current || !isRoomsFocusedRef.current) return;
    onMicDirtyRef.current = false;
    const st = useOnMicStore.getState();
    startTransition(() => {
      setOnMicState(st.onMic);
      setVoiceRoomsState(st.voiceRooms);
    });
  }, [selectedRoom]);

  const recordRoomPreviewTime = useCallback(
    (channelId: string | number | undefined, timeMs: number, preview?: string) => {
      const cid = String(channelId || '').trim();
      if (!cid || cid === '0') return;
      if (!Number.isFinite(timeMs) || timeMs < MIN_VALID_ROOM_TIME_MS) return;
      const cleanPreview = preview ? String(preview).trim() : undefined;
      const prev = roomTimeCacheRef.current[cid];
      if (prev && prev.timeMs === timeMs && (!cleanPreview || prev.preview === cleanPreview)) {
        return;
      }
      const next: Record<string, RoomLastTimeEntry> = {
        ...roomTimeCacheRef.current,
        [cid]: {
          timeMs:
            prev &&
            prev.timeMs > timeMs &&
            (!cleanPreview || !prev.preview || prev.preview === cleanPreview)
              ? prev.timeMs
              : timeMs,
          ...(cleanPreview || prev?.preview ? { preview: cleanPreview || prev?.preview } : {}),
        },
      };
      const keys = Object.keys(next);
      if (keys.length > MAX_ROOM_TIME_CACHE_ENTRIES) {
        keys.sort((a, b) => (next[b]?.timeMs || 0) - (next[a]?.timeMs || 0));
        const trimmed: Record<string, RoomLastTimeEntry> = {};
        for (const k of keys.slice(0, MAX_ROOM_TIME_CACHE_ENTRIES)) {
          trimmed[k] = next[k];
        }
        roomTimeCacheRef.current = trimmed;
      } else {
        roomTimeCacheRef.current = next;
      }

      if (!isRoomsFocusedRef.current || selectedRoomRef.current) {
        roomTimeDirtyRef.current = true;
      } else if (!roomTimeVerFlushTimerRef.current) {
        roomTimeVerFlushTimerRef.current = setTimeout(() => {
          roomTimeVerFlushTimerRef.current = null;
          setRoomTimeCacheVer((v) => v + 1);
        }, ROOM_TIME_VER_FLUSH_MS);
      }
      if (roomTimePersistTimerRef.current) clearTimeout(roomTimePersistTimerRef.current);
      roomTimePersistTimerRef.current = setTimeout(() => {
        roomTimePersistTimerRef.current = null;
        AsyncStorage.setItem(
          ROOM_LAST_TIME_CACHE_KEY,
          JSON.stringify(roomTimeCacheRef.current),
        ).catch(() => {});
      }, 600);
    },
    [],
  );

  const recordPreviewTimesFromList = useCallback(
    (items: FollowedRoom[]) => {
      for (const item of items) {
        const bigCid = String(item.member?.channelId || '');
        if (bigCid && item.lastMessage) {
          const ms = getMessageTime(item.lastMessage);
          if (ms > 0) recordRoomPreviewTime(bigCid, ms, messagePreviewText(item.lastMessage));
        }
        const smallCid = String(item.member?.yklzId || '');
        if (smallCid && smallCid !== '0' && item.lastSmallMessage) {
          const ms = getMessageTime(item.lastSmallMessage);
          if (ms > 0)
            recordRoomPreviewTime(smallCid, ms, messagePreviewText(item.lastSmallMessage));
        }
      }
    },
    [recordRoomPreviewTime],
  );
  const [roomFilter, setRoomFilter] = useState<RoomListFilter>('all');
  const [roomSearchQuery, setRoomSearchQuery] = useState('');
  const [debouncedRoomSearch, setDebouncedRoomSearch] = useState('');
  const debouncedRoomSearchRef = useRef('');
  debouncedRoomSearchRef.current = debouncedRoomSearch;
  const [roomSearchOpen, setRoomSearchOpen] = useState(false);
  const [searchScanState, setSearchScanState] = useState<{
    scanning: boolean;
    scannedCount: number;
    pausedAtLimit: boolean;
    pausedByUser: boolean;
  }>({ scanning: false, scannedCount: 0, pausedAtLimit: false, pausedByUser: false });
  const searchScanSeqRef = useRef(0);
  const searchPausedByUserRef = useRef(false);
  const roomSearchInputRef = useRef<TextInput>(null);
  const roomChatInputRef = useRef<TextInput>(null);
  const [roomMode, setRoomMode] = useState<RoomMode>('big');
  const roomModeRef = useRef<RoomMode>('big');
  roomModeRef.current = roomMode;
  const [showFanMessages, setShowFanMessages] = useState(false);
  const showFanMessagesRef = useRef(false);
  showFanMessagesRef.current = showFanMessages;
  const [playingMedia, setPlayingMedia] = useState<RoomMedia | null>(null);
  const [roomNextTime, setRoomNextTime] = useState(0);
  const roomNextTimeRef = useRef(0);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const hasMoreMessagesRef = useRef(false);
  const lastLoadMoreAtRef = useRef(0);
  const historyInFlightRef = useRef<Promise<{
    added: number;
    fetched: number;
    hasMore: boolean;
    newItems?: RoomMessage[];
    merged?: RoomMessage[];
    error?: boolean;
    errorMessage?: string;
  }> | null>(null);

  useEffect(() => {
    const trimmed = roomSearchQuery.trim();
    if (!roomSearchOpen || !trimmed) {
      searchScanSeqRef.current += 1;
      searchPausedByUserRef.current = false;
      setDebouncedRoomSearch('');
      setSearchScanState({
        scanning: false,
        scannedCount: 0,
        pausedAtLimit: false,
        pausedByUser: false,
      });
      return undefined;
    }
    const timer = setTimeout(() => {
      searchPausedByUserRef.current = false;
      setDebouncedRoomSearch(trimmed);
    }, ROOM_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [roomSearchQuery, roomSearchOpen]);

  useEffect(() => {
    if (activeChannelRef.current && (roomMessages.length > 0 || roomLoadedOnce)) {
      const cacheKey = `${activeChannelRef.current}_${showFanMessages ? 'all' : 'idol'}`;
      roomMessagesCache.current[cacheKey] = {
        messages: roomMessages,
        nextTime: roomNextTimeRef.current,
        hasMore: hasMoreMessagesRef.current,
      };
    }
  }, [roomMessages, showFanMessages, roomNextTime, hasMoreMessages, roomLoadedOnce]);

  const [roomAtBottom, setRoomAtBottom] = useState(true);

  const [roomFreezeKey, setRoomFreezeKey] = useState<string | null>(null);
  const roomLatestImsRef = useRef<RoomChatIM[]>([]);
  const roomAtBottomRef = useRef(true);

  const roomListRef = useRef<any>(null);

  const [roomMeta, setRoomMeta] = useState<RoomMeta>({ name: '', bg: '' });
  const roomMetaInflightRef = useRef<Map<string, Promise<{ meta: RoomMeta | null; ok: boolean }>>>(
    new Map(),
  );
  const warmedBgUrlsRef = useRef<Set<string>>(new Set());
  const roomBgWarmSeqRef = useRef(0);

  type BgLayerState = { canonical: string; uri: string; source: { uri: string }; seq: number };
  const bgBaseOpacity = useRef(new Animated.Value(1)).current;
  const bgOverlayOpacity = useRef(new Animated.Value(0)).current;
  const [bgBase, setBgBase] = useState<BgLayerState | null>(null);
  const [bgOverlay, setBgOverlay] = useState<BgLayerState | null>(null);

  const bgBaseRef = useRef<BgLayerState | null>(null);
  const bgOverlayRef = useRef<BgLayerState | null>(null);
  const bgTargetCanonicalRef = useRef('');
  const bgSeqRef = useRef(0);
  const bgCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bgPromoteClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bgPendingPromoteSeqRef = useRef(0);

  const clearBgTimers = useCallback(() => {
    if (bgCommitTimerRef.current) {
      clearTimeout(bgCommitTimerRef.current);
      bgCommitTimerRef.current = null;
    }
    if (bgPromoteClearTimerRef.current) {
      clearTimeout(bgPromoteClearTimerRef.current);
      bgPromoteClearTimerRef.current = null;
    }
    bgPendingPromoteSeqRef.current = 0;
  }, []);

  useEffect(() => () => clearBgTimers(), [clearBgTimers]);

  const resetBgLayers = useCallback(() => {
    clearBgTimers();
    bgSeqRef.current += 1;
    bgBaseOpacity.stopAnimation();
    bgOverlayOpacity.stopAnimation();
    bgBaseOpacity.setValue(1);
    bgOverlayOpacity.setValue(0);
    bgTargetCanonicalRef.current = '';
    bgBaseRef.current = null;
    bgOverlayRef.current = null;
    setBgBase(null);
    setBgOverlay(null);
  }, [bgBaseOpacity, bgOverlayOpacity, clearBgTimers]);

  const commitOverlayToBase = useCallback(
    (layer: BgLayerState) => {
      if (bgSeqRef.current !== layer.seq) return;
      clearBgTimers();
      bgOverlayOpacity.stopAnimation();
      bgOverlayOpacity.setValue(1);
      bgBaseOpacity.stopAnimation();
      bgBaseOpacity.setValue(1);
      bgPendingPromoteSeqRef.current = layer.seq;
      bgBaseRef.current = layer;
      setBgBase(layer);
      bgPromoteClearTimerRef.current = setTimeout(() => {
        bgPromoteClearTimerRef.current = null;
        if (bgPendingPromoteSeqRef.current === layer.seq) {
          bgPendingPromoteSeqRef.current = 0;
          if (bgOverlayRef.current?.seq === layer.seq) {
            bgOverlayOpacity.setValue(0);
            bgOverlayRef.current = null;
            setBgOverlay(null);
          }
        }
      }, 90);
    },
    [bgBaseOpacity, bgOverlayOpacity, clearBgTimers],
  );

  useEffect(() => {
    const canonical = normalizeBgUrl(roomMeta.bg);
    if (canonical === bgTargetCanonicalRef.current) return;
    bgTargetCanonicalRef.current = canonical;

    if (!canonical) {
      clearBgTimers();
      const seq = ++bgSeqRef.current;
      bgOverlayOpacity.stopAnimation();
      bgOverlayOpacity.setValue(0);
      bgOverlayRef.current = null;
      setBgOverlay(null);
      if (!bgBaseRef.current) return;
      bgBaseOpacity.stopAnimation();
      Animated.timing(bgBaseOpacity, {
        toValue: 0,
        duration: 160,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished && bgSeqRef.current === seq) {
          bgBaseRef.current = null;
          setBgBase(null);
          bgBaseOpacity.setValue(1);
        }
      });
      return;
    }

    const uri = getBgDisplayUri(canonical);
    if (
      bgBaseRef.current?.canonical === canonical &&
      bgBaseRef.current?.uri === uri &&
      !bgOverlayRef.current
    ) {
      bgBaseOpacity.stopAnimation();
      bgBaseOpacity.setValue(1);
      return;
    }

    clearBgTimers();
    const seq = ++bgSeqRef.current;
    bgOverlayOpacity.stopAnimation();
    bgOverlayOpacity.setValue(0);
    const nextLayer: BgLayerState = { canonical, uri, source: { uri }, seq };
    bgOverlayRef.current = nextLayer;
    setBgOverlay(nextLayer);
  }, [roomMeta.bg, bgBaseOpacity, bgOverlayOpacity, clearBgTimers]);

  const onBgBaseLoad = useCallback(
    (seq: number) => {
      if (bgPendingPromoteSeqRef.current === seq) {
        bgPendingPromoteSeqRef.current = 0;
        if (bgPromoteClearTimerRef.current) {
          clearTimeout(bgPromoteClearTimerRef.current);
          bgPromoteClearTimerRef.current = null;
        }
        if (bgOverlayRef.current?.seq === seq) {
          bgOverlayOpacity.stopAnimation();
          bgOverlayOpacity.setValue(0);
          bgOverlayRef.current = null;
          setBgOverlay(null);
        }
      }
    },
    [bgOverlayOpacity],
  );

  const onBgOverlayLoad = useCallback(
    (layer: BgLayerState) => {
      if (bgSeqRef.current !== layer.seq || bgOverlayRef.current?.seq !== layer.seq) return;
      if (bgCommitTimerRef.current) {
        clearTimeout(bgCommitTimerRef.current);
        bgCommitTimerRef.current = null;
      }
      const fast = layer.uri.startsWith('file://') && !bgBaseRef.current;
      const duration = fast ? 120 : 180;
      bgOverlayOpacity.stopAnimation();
      bgCommitTimerRef.current = setTimeout(() => {
        bgCommitTimerRef.current = null;
        commitOverlayToBase(layer);
      }, duration + 80);
      Animated.timing(bgOverlayOpacity, {
        toValue: 1,
        duration,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) commitOverlayToBase(layer);
      });
    },
    [bgOverlayOpacity, commitOverlayToBase],
  );

  const onBgOverlayError = useCallback(
    (layer: BgLayerState) => {
      if (layer.uri.startsWith('file://')) {
        void invalidateBgCache(layer.canonical);
        void ensureBgCached(layer.canonical);
        if (bgSeqRef.current === layer.seq && bgTargetCanonicalRef.current === layer.canonical) {
          const remoteUri = layer.canonical;
          const retryLayer: BgLayerState = {
            canonical: layer.canonical,
            uri: remoteUri,
            source: { uri: remoteUri },
            seq: layer.seq,
          };
          bgOverlayOpacity.stopAnimation();
          bgOverlayOpacity.setValue(0);
          bgOverlayRef.current = retryLayer;
          setBgOverlay(retryLayer);
        }
      }
    },
    [bgOverlayOpacity],
  );

  const onBgBaseError = useCallback((layer: BgLayerState) => {
    if (layer.uri.startsWith('file://')) {
      void invalidateBgCache(layer.canonical);
      void ensureBgCached(layer.canonical);
      if (
        bgBaseRef.current?.canonical === layer.canonical &&
        bgBaseRef.current?.uri === layer.uri
      ) {
        const remoteUri = layer.canonical;
        const fallbackLayer: BgLayerState = {
          canonical: layer.canonical,
          uri: remoteUri,
          source: { uri: remoteUri },
          seq: layer.seq,
        };
        bgBaseRef.current = fallbackLayer;
        setBgBase(fallbackLayer);
      }
    }
  }, []);

  const fetchAndCacheRoomMeta = useCallback(
    async (
      cid: string,
      fallbackChannelId?: string,
      serverId?: string | number,
    ): Promise<{ meta: RoomMeta | null; ok: boolean }> => {
      const existing = roomMetaInflightRef.current.get(cid);
      if (existing) return existing;
      const task = (async () => {
        try {
          await Promise.all([loadRoomMetaCache(), initRoomBgCache()]).catch(() => {});
          const res = await pocketApi.getRoomMeta(cid, fallbackChannelId, serverId);
          for (const [sibCid, sibMeta] of Object.entries(res.siblings || {})) {
            if (sibCid === cid) continue;
            const mergedSib = mergeRoomMetaCached(sibCid, sibMeta, { allowClearBg: false });
            if (mergedSib.bg) void ensureBgCached(mergedSib.bg);
          }
          if (!res.ok) {
            return { meta: getRoomMetaCached(cid) ?? null, ok: false };
          }
          const saved = mergeRoomMetaCached(
            cid,
            { name: res.name, bg: res.bg },
            { allowClearBg: res.bgAuthoritative },
          );
          if (res.bgAuthoritative || Boolean(saved.bg)) {
            roomMetaRevalidatedRef.current.add(cid);
          }
          if (saved.bg) void ensureBgCached(saved.bg);
          return { meta: saved, ok: true };
        } catch {
          return { meta: getRoomMetaCached(cid) ?? null, ok: false };
        }
      })();
      roomMetaInflightRef.current.set(cid, task);
      try {
        return await task;
      } finally {
        if (roomMetaInflightRef.current.get(cid) === task) {
          roomMetaInflightRef.current.delete(cid);
        }
      }
    },
    [],
  );

  const activeChannelRef = useRef('');

  useEffect(() => {
    let alive = true;
    Promise.all([loadRoomMetaCache(), initRoomBgCache()])
      .then(() => {
        if (!alive) return;
        const curCid = activeChannelRef.current;
        if (!curCid) return;
        const hit = getRoomMetaCached(curCid);
        if (!hit) return;
        setRoomMeta((prev) => {
          const normBg = normalizeBgUrl(hit.bg);
          const nextName = prev.name || hit.name;
          const nextBg = prev.bg || normBg;
          if (nextName === prev.name && nextBg === prev.bg) return prev;
          return { name: nextName, bg: nextBg };
        });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const followedWarmKey = useMemo(
    () =>
      followed
        .map((item) => item.memberId)
        .filter(Boolean)
        .sort()
        .join(','),
    [followed],
  );

  useEffect(() => {
    const list = followedRef.current;
    if (!followedWarmKey || !list.length) return undefined;
    const seq = ++roomBgWarmSeqRef.current;
    const task = InteractionManager.runAfterInteractions(() => {
      if (seq !== roomBgWarmSeqRef.current || selectedRoomRef.current) return;
      void (async () => {
        await Promise.all([loadRoomMetaCache(), initRoomBgCache()]).catch(() => {});
        if (seq !== roomBgWarmSeqRef.current || selectedRoomRef.current) return;
        const curList = followedRef.current;
        const toWarm: string[] = [];
        const missingMetaRooms: Array<{ channelId: string; serverId?: string }> = [];
        for (let i = 0; i < curList.length; i += 1) {
          const m = curList[i]?.member;
          if (!m) continue;
          const bigCid = String(m.channelId || '').trim();
          for (const cid of [bigCid, m.yklzId]) {
            const s = String(cid || '').trim();
            if (!s || s === '0' || s === 'undefined') continue;
            const bg = getRoomMetaCached(s)?.bg;
            if (bg && !warmedBgUrlsRef.current.has(bg)) {
              warmedBgUrlsRef.current.add(bg);
              toWarm.push(bg);
            }
          }
          if (
            bigCid &&
            bigCid !== '0' &&
            missingMetaRooms.length < 10 &&
            !roomMetaRevalidatedRef.current.has(bigCid) &&
            !getRoomMetaCached(bigCid)?.bg
          ) {
            missingMetaRooms.push({
              channelId: bigCid,
              serverId: String(m.serverId || '').trim() || undefined,
            });
          }
        }
        if (toWarm.length) void warmRoomBgs(toWarm);
        for (const item of missingMetaRooms) {
          const ok = await waitForIdleSlot(
            'background',
            () => seq === roomBgWarmSeqRef.current && !selectedRoomRef.current,
          );
          if (!ok) break;
          await fetchAndCacheRoomMeta(item.channelId, undefined, item.serverId);
          if (seq !== roomBgWarmSeqRef.current || selectedRoomRef.current) break;
          const gap = getTaskBudget('Rooms', 'roomBg').focused ? 160 : 320;
          await new Promise((r) => setTimeout(r, gap));
        }
      })();
    });
    return () => {
      roomBgWarmSeqRef.current += 1;
      task.cancel();
    };
  }, [fetchAndCacheRoomMeta, followedWarmKey]);

  const activeRoomRef = useRef<{ channelId: string; serverId: string; memberId: string }>({
    channelId: '',
    serverId: '',
    memberId: '',
  });
  const roomSeqRef = useRef(0);

  const scrollPosCache = useRef<Record<string, number>>({});

  const [loadingMoreMessages, setLoadingMoreMessages] = useState(false);
  const loadingMoreMessagesRef = useRef(false);
  const memberIdSetRef = useRef(memberIdSet);
  memberIdSetRef.current = memberIdSet;

  const refreshingRef = useRef(false);
  const [currentUserId, setCurrentUserId] = useState('');
  const currentUserIdRef = useRef('');
  currentUserIdRef.current = currentUserId;

  const [nimEpoch, setNimEpoch] = useState(getNimSessionEpoch);
  useEffect(
    () =>
      subscribeNimSession((epoch) => {
        setNimEpoch(epoch);
        setCurrentUserId('');
      }),
    [],
  );

  useEffect(() => {
    if (!selectedRoom || currentUserId) return;
    let alive = true;
    pocketApi
      .getNimLoginInfo()
      .then((res: unknown) => {
        if (!alive) return;
        const id = currentUserIdFrom(res);
        if (id) setCurrentUserId(id);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [selectedRoom, currentUserId, nimEpoch]);
  const [imagePreview, setImagePreview] = useState<{
    url: string;
    images: string[];
    index: number;
  } | null>(null);
  const [roomPlayer, setRoomPlayer] = useState<RoomMedia | null>(null);
  const roomPlayerRef = useRef(roomPlayer);
  roomPlayerRef.current = roomPlayer;
  const hidePlayerEffects = usePlayerStore((s) =>
    roomPlayer ? s.hideEffects || s.cleanScreen : false,
  );
  const playerCleanScreen = usePlayerStore((s) => (roomPlayer ? s.cleanScreen : false));
  const roomPlaybackState = usePlayerStore((s) => (roomPlayer ? s.state : 'idle'));

  const roomVideoAspectRef = useRef<{ w: number; h: number } | null>(null);
  const [roomPlayerFullscreen, setRoomPlayerFullscreen] = useState(false);
  const roomPlayerFullscreenRef = useRef(false);
  useEffect(() => {
    roomPlayerFullscreenRef.current = roomPlayerFullscreen;
  }, [roomPlayerFullscreen]);

  useFocusEffect(
    useCallback(() => {
      if (Platform.OS === 'android') return;
      let cancelled = false;
      const timer = setTimeout(() => {
        if (cancelled) return;
        const nextBackdrop =
          selectedRoom && roomMeta.bg
            ? {
                uri: getBgDisplayUri(roomMeta.bg),
                scrim: resolvedTheme === 'dark' ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.42)',
              }
            : null;
        if (nextBackdrop) {
          roomBackdropAppliedRef.current = true;
          setScreenBackdrop(nextBackdrop);
        } else if (roomBackdropAppliedRef.current) {
          roomBackdropAppliedRef.current = false;
          setScreenBackdrop(null);
        }
      }, 240);
      return () => {
        cancelled = true;
        clearTimeout(timer);
        if (roomBackdropAppliedRef.current) {
          roomBackdropAppliedRef.current = false;
          setScreenBackdrop(null);
        }
      };
    }, [selectedRoom, roomMeta.bg, resolvedTheme, setScreenBackdrop]),
  );

  const roomBarrageLiveId =
    roomPlayer?.isLive && roomPlayer.liveId ? String(roomPlayer.liveId) : '';
  const roomBarrage = useLiveBarrage({
    liveId: roomBarrageLiveId,
    enabled: !!roomBarrageLiveId,
    module: 'live',
  });
  const [roomLiveEnded, setRoomLiveEnded] = useState(false);
  const [roomLiveSummary, setRoomLiveSummary] = useState<LiveEndSummary | null>(null);
  const roomRetryFollowupRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    setRoomLiveEnded(false);
    setRoomLiveSummary(null);
    if (roomRetryFollowupRef.current) {
      clearTimeout(roomRetryFollowupRef.current);
      roomRetryFollowupRef.current = null;
    }
  }, [roomPlayer?.liveId, roomPlayer?.url]);
  useEffect(() => {
    if (!roomBarrage.liveEnded && !roomLiveEnded) return;
    if (!roomPlayer?.isLive) return;
    setRoomLiveEnded(true);
    const liveId = String(roomPlayer.liveId || '');
    if (!liveId) return;
    useDiscoveredLivesStore.getState().removeDiscoveredLive(liveId);
    let active = true;
    void fetchLiveEndSummary({
      liveId,
      fallbackTitle: roomPlayer.title,
      fallbackMember:
        roomBarrage.liveInfo.hostName || selectedRoom?.ownerName || roomPlayer.title || '',
    }).then((summary) => {
      if (active) setRoomLiveSummary(summary);
    });
    return () => {
      active = false;
    };
  }, [
    roomBarrage.liveEnded,
    roomLiveEnded,
    roomPlayer?.isLive,
    roomPlayer?.liveId,
    roomPlayer?.title,
    roomBarrage.liveInfo.hostName,
    selectedRoom?.ownerName,
  ]);
  const [roomReplayDanmaku, setRoomReplayDanmaku] = useState<DanmakuItem[]>([]);
  useEffect(() => {
    let active = true;
    setRoomReplayDanmaku([]);
    if (roomPlayer && !roomPlayer.isLive && roomPlayer.liveId) {
      const liveId = String(roomPlayer.liveId);
      Promise.all([pocketApi.getLiveLrc(liveId), pocketApi.getLiveBarrage(liveId)])
        .then(([text, rows]) => {
          if (!active) return;
          const lrc = parseDanmaku(text || '');
          if (lrc.length) {
            setRoomReplayDanmaku(enrichReplayDanmaku(lrc, rows));
          } else {
            setRoomReplayDanmaku(replayBarrageToDanmaku(rows));
          }
        })
        .catch(() => {});
    }
    return () => {
      active = false;
    };
  }, [roomPlayer, roomPlayer?.liveId, roomPlayer?.isLive]);

  useEffect(() => {
    const on = !!roomPlayer?.isLive && !!roomPlayer?.url && roomPlaybackState === 'playing';
    setPipPlaying(on, 'roomlive');
    return () => setPipPlaying(false, 'roomlive');
  }, [roomPlayer?.url, roomPlayer?.isLive, roomPlaybackState]);

  const [showRoomDanmakuList, setShowRoomDanmakuList] = useState(false);
  const [showRoomDanmakuSettings, setShowRoomDanmakuSettings] = useState(false);

  const [inRoomSystemPip, setInRoomSystemPip] = useState(false);
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('PipEnteredChanged', (entered: boolean) => {
      setInRoomSystemPip(!!entered);
      if (!entered) setRoomPlayerFullscreen((v) => v);
    });
    return () => sub.remove();
  }, []);

  const roomPlayedEffectsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!isGiftEffectSupported()) return;
    const items = roomBarrage.items;
    if (!items.length) return;
    for (const item of items) {
      const zip = item.gift?.zipPath;
      if (!zip || roomPlayedEffectsRef.current.has(item.id)) continue;
      roomPlayedEffectsRef.current.add(item.id);
      if (!hidePlayerEffects)
        playGiftEffect({ zipPath: zip, zipMd5: item.gift?.zipMd5, giftName: item.gift?.giftName });
    }
    if (roomPlayedEffectsRef.current.size > 200) roomPlayedEffectsRef.current.clear();
  }, [roomBarrage.items, hidePlayerEffects]);
  useEffect(
    () => () => {
      clearGiftEffectQueue();
    },
    [],
  );

  const roomDanmakuEntries = useMemo<DanmakuListEntry[]>(
    () =>
      roomPlayer?.isLive
        ? roomBarrage.items.map((item) => ({
            id: item.id,
            time: 0,
            nick: item.nick || '',
            text: item.text || '',
            kind: item.kind,
            userId: item.userId || undefined,
            avatar: item.avatar || undefined,
          }))
        : roomReplayDanmaku.map((item, index) => ({
            id: `replay-${index}`,
            time: item.time,
            nick: item.nick || '',
            text: item.text,
            userId: item.userId,
            avatar: item.avatar,
          })),
    [roomBarrage.items, roomPlayer?.isLive, roomReplayDanmaku],
  );

  const [replyTarget, setReplyTarget] = useState<{
    replyMessageId: string;
    replyName: string;
    replyText: string;
  } | null>(null);
  const clearReplyTarget = useCallback(() => setReplyTarget(null), []);
  const clearRoomSendHint = useCallback(() => setRoomSendHint(''), []);

  const [roomEssences, setRoomEssences] = useState<RoomMessageWire[]>([]);

  const [msgMenu, setMsgMenu] = useState<{
    item: RoomMessageWire;
    mine: boolean;
    name: string;
    text: string;
    media: RoomMedia | null;
  } | null>(null);
  const msgReplyRef = useRef<{ replyMessageId: string; senderName: string; text: string } | null>(
    null,
  );
  const [essenceSheetOpen, setEssenceSheetOpen] = useState(false);
  const [essenceLoading, setEssenceLoading] = useState(false);
  const [composerResetSeq, setComposerResetSeq] = useState(0);
  const [roomSending, setRoomSending] = useState(false);
  const roomSendingRef = useRef(false);
  roomSendingRef.current = roomSending;
  const [roomSendHint, setRoomSendHint] = useState('');
  const { width: roomWidth, height: roomHeight } = useWindowDimensions();
  const roomLandscape = roomWidth > roomHeight;

  const { dual } = useDualPane();
  const roomInsetFallback =
    Platform.OS === 'ios' ? 34 : Platform.OS === 'android' ? (roomLandscape ? 16 : 24) : 0;
  const [roomNavigationInset, setRoomNavigationInset] = useState(roomInsetFallback);
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    const readInset = () => {
      attempts += 1;
      NativeModules.PipController?.getNavigationInset?.()
        .then((inset: number) => {
          if (!alive) return;
          const value = Math.max(0, Number(inset) || 0);
          if (value > 0) setRoomNavigationInset(value);
          else if (attempts < 5) timer = setTimeout(readInset, 180);
        })
        .catch(() => {
          if (alive && attempts < 5) timer = setTimeout(readInset, 180);
        });
    };
    readInset();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [roomLandscape, roomInsetFallback]);

  const [liveResolve, setLiveResolve] = useState<null | {
    key: string;
    error: string;
    media: RoomMedia;
  }>(null);
  const liveResolveToken = useRef(0);

  const [rankVisible, setRankVisible] = useState(false);

  const [giftVisible, setGiftVisible] = useState(false);
  const [giftStatus, setGiftStatus] = useState('');
  const [giftBalance, setGiftBalance] = useState('');
  const [giftList, setGiftList] = useState<GiftRow[]>([]);
  const [giftSel, setGiftSel] = useState<GiftRow | null>(null);
  const [giftNum, setGiftNum] = useState(1);

  const [giftMode, setGiftMode] = useState<'live' | 'room'>('live');

  const [giftTarget, setGiftTarget] = useState<null | {
    serverId: string;
    channelId: string;
    memberId: string;
    memberName: string;
  }>(null);
  const [rankRows, setRankRows] = useState<LiveRankItem[]>([]);
  const [rankStatus, setRankStatus] = useState('');

  const [rankLoading, setRankLoading] = useState(false);

  const [userCard, setUserCard] = useState<null | {
    id: string;
    name: string;
    avatar: string;
    loading: boolean;
    error: string;

    following: boolean;

    mutual: boolean;
    followBusy: boolean;

    isMember: boolean;

    memberDbId: string;

    frameUrl: string;
    detail: {
      name: string;
      avatar: string;
      level: string;
      signature: string;
      team: string;
      period: string;
      isStar: boolean;
    };
  }>(null);

  const userCardSeqRef = useRef(0);
  const [followedIds, setFollowedIds] = useState<Set<string>>(new Set());
  const [followBusy, setFollowBusy] = useState<Set<string>>(new Set());

  const followedIdsRef = useRef(followedIds);
  const followBusyRef = useRef(followBusy);
  followedIdsRef.current = followedIds;
  followBusyRef.current = followBusy;

  const loadFollowedRef = useRef<(silent?: boolean) => void>(() => {});

  const loadFollowedSeqRef = useRef(0);

  useEffect(() => {
    setTabBarHidden((!!selectedRoom && !roomClosing) || !!roomPlayer);
  }, [roomPlayer, selectedRoom, roomClosing, setTabBarHidden]);

  useFocusEffect(
    useCallback(() => {
      return () => {
        if (roomOrientationTouchedRef.current || roomPlayerRef.current) {
          roomOrientationTouchedRef.current = false;
          setLiveImmersiveMode(false);
          ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(
            () => {},
          );
        }
      };
    }, []),
  );

  useEffect(() => {
    if (!selectedRoom) {
      setRoomPlayer(null);
      setRoomPlayerFullscreen(false);
      if (roomOrientationTouchedRef.current) {
        roomOrientationTouchedRef.current = false;
        setLiveImmersiveMode(false);
        ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
      }
    }
    return () => {
      if (roomOrientationTouchedRef.current) {
        roomOrientationTouchedRef.current = false;
        setLiveImmersiveMode(false);
        ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
      }
    };
  }, [selectedRoom]);

  const isWideTablet = Math.min(roomWidth, roomHeight) >= 600;
  useEffect(() => {
    setLiveImmersiveMode(!!roomPlayer && roomPlayerFullscreen);
    if (roomPlayerFullscreen) {
      roomOrientationTouchedRef.current = true;
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => {});
    } else if (isWideTablet && selectedRoom) {
      roomOrientationTouchedRef.current = true;
      ScreenOrientation.unlockAsync().catch(() => {});
    } else if (roomOrientationTouchedRef.current) {
      roomOrientationTouchedRef.current = false;
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    }
    return () => setLiveImmersiveMode(false);
  }, [roomPlayer, roomPlayerFullscreen, isWideTablet, selectedRoom]);

  const closeRoomRef = useRef<() => void>(() => {});
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!navigation.isFocused()) return false;

      if (Keyboard.isVisible()) {
        Keyboard.dismiss();
        return true;
      }
      if (roomPlayerFullscreenRef.current) {
        setRoomPlayerFullscreen(false);
        setLiveImmersiveMode(false);
        ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
        setTabBarHidden(!!selectedRoomRef.current && !roomClosingRef.current);
        return true;
      }
      if (roomPlayerRef.current) {
        setRoomPlayer(null);
        setRoomPlayerFullscreen(false);
        setLiveImmersiveMode(false);
        ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
        setTabBarHidden(!!selectedRoomRef.current && !roomClosingRef.current);
        return true;
      }
      if (selectedRoomRef.current && !roomClosingRef.current) {
        closeRoomRef.current();
        return true;
      }
      return false;
    });
    return () => subscription.remove();
  }, [navigation, setTabBarHidden]);

  const closeRoomPlayer = useCallback(() => {
    if (roomRetryFollowupRef.current) {
      clearTimeout(roomRetryFollowupRef.current);
      roomRetryFollowupRef.current = null;
    }
    setRoomLiveEnded(false);
    setRoomLiveSummary(null);
    setRoomPlayer(null);
    setRoomPlayerFullscreen(false);
    setLiveImmersiveMode(false);
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    setTabBarHidden(!!selectedRoom);
  }, [selectedRoom, setTabBarHidden]);

  const openRoomGiftPanel = useCallback(async () => {
    const liveId = String(roomPlayer?.liveId || '');
    setGiftVisible(true);
    setGiftStatus('');
    setGiftSel(null);
    setGiftNum(1);
    setGiftTarget(null);

    if (!liveId) {
      setGiftMode('room');
      try {
        const target = activeRoomRef.current;
        const channelId = String(target.channelId || '');
        let serverId = String(target.serverId || '');

        if (!serverId || serverId === '0') {
          serverId = await pocketApi.resolveRoomServerId(channelId).catch(() => '');
        }

        const targetMember =
          (selectedRoom?.id ? selectedRoom : null) ||
          useMemberStore
            .getState()
            .members.find((m) => String(m.id) === String(target.memberId || ''));
        const ctx = await pocketApi.getMemberRoomGiftContext({
          serverId,
          channelId,
          bigChannelId: String(targetMember?.channelId || '') || channelId,
          memberId: String(target.memberId || targetMember?.id || ''),
        });
        setGiftTarget(ctx.target);
        let giftsAll: GiftRow[] = (ctx.gifts || []) as GiftRow[];
        try {
          const memberIdForGift = String(targetMember?.id || target.memberId || '');
          if (memberIdForGift) {
            const scoreRes = await pocketApi
              .getScoreGiftListByMember(memberIdForGift)
              .catch(() => null);
            const scoreGifts = normalizeGiftList(scoreRes) as GiftRow[];
            if (scoreGifts.length) {
              const seen = new Set(giftsAll.map((g) => String(g.giftId || g.id)));
              giftsAll = giftsAll.concat(
                scoreGifts.filter((g) => !seen.has(String(g.giftId || g.id))),
              );
            }
          }
        } catch {}
        setGiftList(giftsAll);
        setGiftBalance(ctx.balance != null ? String(ctx.balance) : '');
        setGiftStatus(
          ctx.gifts.length
            ? t('已加载 {count} 个礼物', { count: ctx.gifts.length })
            : t('礼物列表为空'),
        );
      } catch (err) {
        setGiftList([]);
        setGiftStatus(errorMessage(err));
      }
      return;
    }
    setGiftMode('live');
    try {
      const giftMemberId = String(
        selectedRoom?.id || (roomPlayer as unknown as { memberId?: string } | null)?.memberId || '',
      );

      const liveSceneRes = giftMemberId
        ? await pocketApi.getLiveGiftList(liveId, giftMemberId).catch(() => null)
        : null;
      let giftsAll: GiftRow[] = normalizeGiftList(liveSceneRes) as GiftRow[];
      const moneyResPromise = pocketApi.getUserMoney().catch(() => null);
      if (!giftsAll.length) {
        const giftRes = await pocketApi.getGiftList(liveId).catch(() => null);
        giftsAll = normalizeGiftList(giftRes) as GiftRow[];
      }
      const moneyRes = await moneyResPromise;

      try {
        if (giftMemberId) {
          const scoreRes = await pocketApi.getScoreGiftListByMember(giftMemberId).catch(() => null);
          const scoreGifts = normalizeGiftList(scoreRes) as GiftRow[];
          if (scoreGifts.length) {
            const seen = new Set(giftsAll.map((g) => String(g.giftId || g.id)));
            giftsAll = giftsAll.concat(
              scoreGifts.filter((g) => !seen.has(String(g.giftId || g.id))),
            );
          }
        }
      } catch {}
      try {
        const qin = giftsAll.filter((g) => String(g.giftName || g.name || '').includes('琴音生花'));
        if (qin.length) giftsAll = [...qin, ...giftsAll.filter((g) => !qin.includes(g))];
      } catch {}
      const gifts = giftsAll;
      setGiftList(gifts);
      try {
        const names = gifts.map((g) => String(g.giftName || g.name || '')).filter(Boolean);
        logInfo(
          `[gift.list] room count=${gifts.length} hasQinYin=${names.some((n) => n.includes('琴音生花')) ? 'yes' : 'no'} names=${names.slice(0, 40).join('|')}`,
          'gift',
        );
      } catch {}
      const money = moneyRes?.content?.moneyTotal ?? moneyRes?.data?.moneyTotal ?? '';
      if (money !== '' && money !== undefined && money !== null) setGiftBalance(String(money));
      setGiftStatus(
        gifts.length ? t('已加载 {count} 个礼物', { count: gifts.length }) : t('礼物列表为空'),
      );
    } catch (err) {
      setGiftList([]);
      setGiftStatus(t('加载礼物失败：{error}', { error: errorMessage(err) }));
    }
  }, [roomPlayer, selectedRoom, t]);

  const sendRoomGift = useCallback(async () => {
    if (!giftSel) {
      setGiftStatus(t('请先选择礼物'));
      return;
    }
    const num = Math.max(1, Math.floor(Number(giftNum) || 1));

    if (giftMode === 'room' && giftTarget) {
      setGiftStatus(t('正在发送...'));
      try {
        const out = await pocketApi.sendMemberRoomGift({
          serverId: giftTarget.serverId,
          channelId: giftTarget.channelId,
          giftId: String(giftSel.giftId || giftSel.id || ''),
          giftNum: num,
          isPocketGift: Number(giftSel.isPocketGift || 0),
          unitPrice: Number(giftSel.money || giftSel.cost || giftSel.price || 0),
          acceptUserId: giftTarget.memberId,
        });
        setGiftStatus(
          t('已送出 {num} 个 {giftName}', {
            num,
            giftName: String(giftSel.giftName || giftSel.name || ''),
          }),
        );
        if (out.balance != null) setGiftBalance(String(out.balance));
      } catch (err) {
        setGiftStatus(t('送礼失败：{error}', { error: errorMessage(err) }));
      }
      return;
    }
    if (!roomPlayer) {
      setGiftStatus(t('请先选择礼物'));
      return;
    }
    const ownerId = String(selectedRoom?.id || '');
    const liveId = String(roomPlayer.liveId || '');
    setGiftStatus(t('正在发送...'));
    try {
      let crm = '';
      try {
        const one = await pocketApi.getLiveOne(liveId);
        crm = String(one?.content?.crm || '');
      } catch {}
      const giftNameText = String(giftSel.giftName || giftSel.name || '');
      const preferredCode = Number(roomPlayer.liveType) === 5 ? 7 : 0;
      const codes = Array.from(
        new Set([preferredCode, ...(giftNameText.includes('琴音生花') ? [5] : [])]),
      );
      let sent = false;
      let lastErr: unknown = null;
      for (const code of codes) {
        try {
          await pocketApi.sendGift({
            giftId: String(giftSel.giftId || giftSel.id),
            liveId,
            acceptUserId: ownerId,
            giftNum: num,
            crm,
            businessCode: code,
          });
          sent = true;
          break;
        } catch (e) {
          lastErr = e;
        }
      }
      if (!sent) throw lastErr || new Error(t('送礼失败'));
      setGiftStatus(t('已送出 {num} 个 {giftName}', { num, giftName: giftNameText }));
      const money = await pocketApi.getUserMoney().catch(() => null);
      if (money?.content?.moneyTotal !== undefined)
        setGiftBalance(String(money.content.moneyTotal));
    } catch (err) {
      setGiftStatus(t('送礼失败：{error}', { error: errorMessage(err) }));
    }
  }, [roomPlayer, selectedRoom, giftSel, giftNum, giftMode, giftTarget, t]);

  const loadRoomEssences = useCallback(async (channelId: string) => {
    if (!channelId) {
      setRoomEssences([]);
      return;
    }
    setEssenceLoading(true);
    try {
      const res = await pocketApi.getEssenceMessages({ channelId });
      const list = unwrapList(res, [
        'content.essenceMessageList',
        'content.messageList',
        'content.list',
        'content.data',
        'data.essenceMessageList',
        'data.messageList',
        'list',
        'data',
      ]);
      setRoomEssences(list as RoomMessageWire[]);
    } catch {
      setRoomEssences([]);
    } finally {
      setEssenceLoading(false);
    }
  }, []);

  const essenceChannelId = selectedRoom ? roomChannelId(selectedRoom, roomMode) : '';
  useEffect(() => {
    void loadRoomEssences(essenceChannelId);
  }, [essenceChannelId, loadRoomEssences]);

  const handleSendRoomSticker = useCallback(
    async (sticker: RoomSticker) => {
      if (roomSendingRef.current) return;
      const followId = String(selectedRoom?.id || selectedRoom?.userId || '');
      if (followId && !followedIdsRef.current.has(followId)) {
        setRoomSendHint(t('关注后才能发房间消息'));
        return;
      }
      const target = { ...activeRoomRef.current };
      if (!target.channelId) {
        setRoomSendHint(t('房间未就绪'));
        return;
      }
      roomSendingRef.current = true;
      setRoomSending(true);
      setRoomSendHint('');
      try {
        const serverId =
          target.serverId && target.serverId !== '0'
            ? target.serverId
            : await pocketApi.resolveRoomServerId(target.channelId);
        if (!serverId || serverId === '0') throw new Error(t('缺少房间 serverId，无法发言'));
        if (activeRoomRef.current.channelId !== target.channelId) return;
        await sendRoomSticker(
          { serverId, channelId: target.channelId, bubbleId: sendBubbleId },
          sticker,
        );
        if (activeRoomRef.current.channelId !== target.channelId) return;

        roomAtBottomRef.current = true;
        setRoomAtBottom(true);
        setRoomFreezeKey(null);
        setTimeout(() => refreshRoomMessagesRef.current?.(), 500);
        setTimeout(() => refreshRoomMessagesRef.current?.(), 1500);
      } catch (err) {
        setRoomSendHint(errorMessage(err));
      } finally {
        roomSendingRef.current = false;
        setRoomSending(false);
      }
    },
    [sendBubbleId, t, selectedRoom?.id, selectedRoom?.userId],
  );

  const handleSendRoomMessage = useCallback(
    async (rawText: string): Promise<boolean> => {
      const text = rawText.trim();
      if (!text || roomSendingRef.current) return false;

      const followId = String(selectedRoom?.id || selectedRoom?.userId || '');
      if (followId && !followedIdsRef.current.has(followId)) {
        setRoomSendHint(t('关注后才能发房间消息'));
        return false;
      }

      const target = activeRoomRef.current;
      const channelId = target.channelId;
      if (!channelId) {
        setRoomSendHint(t('房间未就绪'));
        return false;
      }
      roomSendingRef.current = true;
      setRoomSending(true);
      setRoomSendHint('');
      try {
        let serverId = target.serverId;
        if (!serverId || serverId === '0') {
          serverId = await pocketApi.resolveRoomServerId(channelId).catch(() => '');
        }
        if (!serverId || serverId === '0') {
          throw new Error(t('缺少房间 serverId，无法发言'));
        }
        if (activeRoomRef.current.channelId !== channelId) return false;
        await sendRoomTextMessage(
          { serverId, channelId, bubbleId: sendBubbleId },
          text,
          replyTarget,
        );
        if (activeRoomRef.current.channelId !== channelId) return false;
        setReplyTarget(null);
        roomAtBottomRef.current = true;
        setRoomAtBottom(true);
        setRoomFreezeKey(null);

        setTimeout(() => refreshRoomMessagesRef.current?.(), 500);
        setTimeout(() => refreshRoomMessagesRef.current?.(), 1500);
        return true;
      } catch (err) {
        setRoomSendHint(errorMessage(err));
        return false;
      } finally {
        roomSendingRef.current = false;
        setRoomSending(false);
      }
    },
    [t, replyTarget, sendBubbleId, selectedRoom?.id, selectedRoom?.userId],
  );

  const handleRoomMiniPlayer = useCallback(() => {
    const cur = roomPlayer;
    if (!cur?.url) return;

    let pos = 0;
    if (!cur.isLive) {
      try {
        const pst = usePlayerStore.getState();
        if (
          pst.source &&
          pst.source.url === cur.url &&
          (pst.state === 'playing' || pst.state === 'paused')
        ) {
          pos = Math.max(0, Number(pst.position) || 0);
        }
      } catch {}
    }
    const pst = usePlayerStore.getState();
    useMiniPlayerStore.getState().open({
      url: cur.url,
      title: cur.title,
      cover: cur.cover,
      isLive: !!cur.isLive,

      audioOnly: cur.type === 'audio',
      position: pos,

      aspectW: pst.detectedAspect?.w || roomVideoAspectRef.current?.w,
      aspectH: pst.detectedAspect?.h || roomVideoAspectRef.current?.h,
      isLandscape: pst.detectedAspect ? pst.detectedLandscape : undefined,

      backTo: {
        mode: cur.isLive ? 'live' : 'vod',
        playUrl: cur.url,
        playLiveId: cur.liveId ? String(cur.liveId) : undefined,
        playTitle: cur.title,
        playCover: cur.cover,
        playPosition: pos,
      },
    });
    closeRoomPlayer();
  }, [roomPlayer, closeRoomPlayer]);

  const [roomAnnouncement, setRoomAnnouncement] = useState('');
  const [roomAnnounceOpen, setRoomAnnounceOpen] = useState(false);
  useEffect(() => {
    const lid = roomPlayer?.isLive ? String(roomPlayer?.liveId || '') : '';
    if (!lid) {
      setRoomAnnouncement('');
      setRoomAnnounceOpen(false);
      return;
    }
    let alive = true;
    (async () => {
      const d = await pocketApi.getLiveOne(lid).catch(() => null);
      if (!alive) return;
      const c = (d?.content || d?.data || d || {}) as WireRecord;
      const ann = String(c?.announcement || '').trim();
      setRoomAnnouncement(ann);
      setRoomAnnounceOpen(!!ann);
    })();
    return () => {
      alive = false;
    };
  }, [roomPlayer?.isLive, roomPlayer?.liveId]);

  const finalizeCloseRoom = useCallback(
    (token: number) => {
      if (token !== closeSeqRef.current) return;
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
      roomClosingRef.current = false;
      setRoomClosing(false);
      roomEnterPendingRef.current = false;
      searchScanSeqRef.current += 1;
      searchPausedByUserRef.current = false;
      setTabBarHidden(false);
      setRoomSearchOpen(false);
      setRoomSearchQuery('');
      setDebouncedRoomSearch('');
      setSearchScanState({
        scanning: false,
        scannedCount: 0,
        pausedAtLimit: false,
        pausedByUser: false,
      });
      setSelectedRoom(null);
      startTransition(() => {
        setRoomPlayer(null);
        setRoomPlayerFullscreen(false);
        setPlayingMedia(null);
        setImagePreview(null);
        setScreenBackdrop(null);
        resetBgLayers();
        setRoomMeta({ name: '', bg: '' });
        setComposerResetSeq((v) => v + 1);
        setRoomSendHint('');
        setRoomMessages([]);
      });
    },
    [resetBgLayers, setScreenBackdrop, setTabBarHidden],
  );

  const closeRoom = useCallback(() => {
    if (roomClosingRef.current || !selectedRoomRef.current) return;
    notifyTransitionStart('room-overlay', 260);
    roomEnterPendingRef.current = false;
    if (roomEnterRafRef.current !== null) {
      cancelAnimationFrame(roomEnterRafRef.current);
      roomEnterRafRef.current = null;
    }
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    roomSearchInputRef.current?.blur();
    roomChatInputRef.current?.blur();
    Keyboard.dismiss();
    roomSeqRef.current += 1;
    searchScanSeqRef.current += 1;
    const closeToken = ++closeSeqRef.current;
    activeChannelRef.current = '';
    activeRoomRef.current = { channelId: '', serverId: '', memberId: '' };
    if (roomPlayerRef.current || roomOrientationTouchedRef.current) {
      setLiveImmersiveMode(false);
    }
    if (roomOrientationTouchedRef.current) {
      roomOrientationTouchedRef.current = false;
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    }
    roomClosingRef.current = true;
    setRoomClosing(true);
    setTabBarHidden(false);
    closeTimerRef.current = setTimeout(() => {
      finalizeCloseRoom(closeToken);
    }, 240);
    roomEnter.value = withTiming(
      0,
      { duration: 185, easing: Easing.out(Easing.cubic) },
      (finished) => {
        if (finished) {
          runOnJS(finalizeCloseRoom)(closeToken);
        }
      },
    );
  }, [finalizeCloseRoom, roomEnter, setTabBarHidden]);
  closeRoomRef.current = closeRoom;

  const persistPinned = useCallback(
    (next: string[]) => {
      pinnedRef.current = next;
      setPinned(next);
      pinnedWriteRef.current = pinnedWriteRef.current.then(async () => {
        try {
          await AsyncStorage.setItem('yaya_pinned_rooms', JSON.stringify(next));
        } catch (error: unknown) {
          showToast(t('置顶保存失败：{msg}', { msg: errorMessage(error) }));
        }
      });
    },
    [showToast, t],
  );

  const togglePin = useCallback(
    (memberId: string) => {
      const cur = pinnedRef.current;
      const next = cur.includes(memberId)
        ? cur.filter((id) => id !== memberId)
        : [...cur, memberId];
      persistPinned(next);
    },
    [persistPinned],
  );

  const movePin = useCallback(
    (memberId: string, dir: -1 | 1) => {
      const cur = pinnedRef.current;
      const idx = cur.indexOf(memberId);
      const to = idx + dir;
      if (idx < 0 || to < 0 || to >= cur.length) return;
      const next = [...cur];
      [next[idx], next[to]] = [next[to], next[idx]];
      persistPinned(next);
    },
    [persistPinned],
  );

  const toggleFollow = useCallback(
    async (member: Member) => {
      if (!token) {
        showToast(t('请先登录后再关注成员'));
        return;
      }
      const id = String(member.id || member.userId || '');
      if (!id || id === '0') {
        showToast(t('该成员缺少可关注的 ID'));
        return;
      }
      if (followBusyRef.current.has(id)) return;

      const isFollowing = followedIdsRef.current.has(id);
      const nextFollowedIds = new Set(followedIdsRef.current);
      if (isFollowing) nextFollowedIds.delete(id);
      else nextFollowedIds.add(id);
      followedIdsRef.current = nextFollowedIds;
      setFollowedIds(nextFollowedIds);
      mutateFollowedIdShared(token, id, !isFollowing);
      setFollowBusy((prev) => {
        const b = new Set(prev);
        b.add(id);
        return b;
      });
      try {
        if (isFollowing) await pocketApi.unfollowMember(id);
        else await pocketApi.followMember(id);
        showToast(
          isFollowing
            ? t('已取消关注 {name}', { name: member.ownerName })
            : t('已关注 {name}', { name: member.ownerName }),
        );

        setFollowed((prev) => {
          const exists = prev.some((p) => String(p.memberId) === id);
          const nextList = isFollowing
            ? prev.filter((p) => String(p.memberId) !== id)
            : exists
              ? prev
              : [{ memberId: id, member }, ...prev];
          void writeFollowedRoomsSnapshot(token, nextList);
          return nextList;
        });
        setTimeout(() => {
          loadFollowedRef.current(true);
        }, 600);
      } catch (e) {
        const revertedIds = new Set(followedIdsRef.current);
        if (isFollowing) revertedIds.add(id);
        else revertedIds.delete(id);
        followedIdsRef.current = revertedIds;
        setFollowedIds(revertedIds);
        mutateFollowedIdShared(token, id, isFollowing);
        showToast(t('操作失败：{msg}', { msg: errorMessage(e) }));
      } finally {
        setFollowBusy((prev) => {
          const b = new Set(prev);
          b.delete(id);
          return b;
        });
      }
    },
    [showToast, t, token],
  );

  useEffect(() => {
    AsyncStorage.getItem('yaya_pinned_rooms').then((v) => {
      if (!v) return;
      try {
        const parsed = JSON.parse(v);
        const next = Array.isArray(parsed) ? parsed.map(String) : [];
        pinnedRef.current = next;
        setPinned(next);
      } catch {
        pinnedRef.current = [];
        setPinned([]);
      }
    });
  }, []);

  const loadFollowed = useCallback(
    async (silent = false) => {
      const seq = ++loadFollowedSeqRef.current;
      if (!token) {
        setFollowed([]);
        setFollowedLoading(false);
        return;
      }
      if (!silent || followedRef.current.length === 0) setFollowedLoading(true);
      try {
        const livePromise = fetchLiveListShared({ force: !silent }).catch(() => null);
        const idsArr = await fetchFollowedIdsShared(token, { force: !silent });
        if (seq !== loadFollowedSeqRef.current) return;
        setFollowedIds(new Set(idsArr));
        const followedMembers = idsArr
          .map((id: string) => {
            const member = memberLookupRef.current.get(id.trim());
            return { memberId: id, member };
          })
          .filter((item): item is { memberId: string; member: Member } => !!item.member?.channelId);
        if (followedRef.current.length === 0 && followedMembers.length > 0) {
          setFollowed(followedMembers.map((item) => ({ ...item })));
        }
        const serverIds = followedMembers
          .map((item) => Number(item.member?.serverId || 0))
          .filter((id: number) => id > 0);

        const smallRoomIds = followedMembers
          .map((item) => Number(item.member?.yklzId || 0))
          .filter((id: number) => id > 0);
        const queryIds = Array.from(new Set([...serverIds, ...smallRoomIds]));
        const lastMsgsRes = queryIds.length ? await pocketApi.getLastMessages(queryIds) : null;
        if (seq !== loadFollowedSeqRef.current) return;
        const lastMsgs = unwrapList(lastMsgsRes, [
          'content.lastMsgList',
          'content.data',
          'data',
          'lastMsgList',
        ]);
        const prevByMember = new Map<string, FollowedRoom>();
        for (const prevItem of followedRef.current) {
          prevByMember.set(prevItem.memberId, prevItem);
        }
        const mappedFollowed = followedMembers.map((item) => {
          const prevEntry = prevByMember.get(item.memberId);
          return {
            ...item,
            lastMessage: findLastMessage(lastMsgs, item.member) || prevEntry?.lastMessage || null,
            lastSmallMessage:
              findSmallLastMessage(lastMsgs, item.member) || prevEntry?.lastSmallMessage || null,
          };
        });
        recordPreviewTimesFromList(mappedFollowed);
        setFollowed(mappedFollowed);
        void writeFollowedRoomsSnapshot(token, mappedFollowed);
        lastRoomsLoadedAtRef.current = Date.now();

        const missingSmall = followedMembers.filter((item) => {
          const sid = String(item.member?.serverId || '').trim();
          const ykid = String(item.member?.yklzId || '').trim();
          return (
            sid &&
            sid !== '0' &&
            (!ykid || ykid === '0' || ykid === 'undefined') &&
            !smallRoomProbedRef.current.has(sid)
          );
        });
        if (missingSmall.length) {
          setTimeout(() => {
            if (seq !== loadFollowedSeqRef.current) return;
            void (async () => {
              const discovered = new Map<string, { bigCid: string; smallCid: string }>();
              let cursor = 0;
              const worker = async () => {
                while (cursor < missingSmall.length) {
                  if (seq !== loadFollowedSeqRef.current) return;
                  const target = missingSmall[cursor++];
                  const sid = String(target.member.serverId || '').trim();
                  const bigCid = String(target.member.channelId || '').trim();
                  if (!sid || !bigCid || smallRoomProbedRef.current.has(sid)) continue;
                  smallRoomProbedRef.current.add(sid);
                  try {
                    const detail = await pocketApi
                      .getSeineServerDetail(Number(sid))
                      .catch(() => null);
                    const content = (detail?.content || detail?.data || {}) as WireRecord;
                    const metas = cacheRoomMetasFromSeineDetail(content);
                    const bgUrls = Object.values(metas)
                      .map((m) => m.bg)
                      .filter(Boolean);
                    if (bgUrls.length) void warmRoomBgs(bgUrls);
                    const list = Array.isArray(content.channelInfoList)
                      ? (content.channelInfoList as WireRecord[])
                      : [];
                    const candidates = list.filter((c) => {
                      const cid = String(c?.channelId || '').trim();
                      return cid && cid !== '0' && cid !== bigCid;
                    });
                    const picked =
                      candidates.find((c) => /小/i.test(String(c?.channelName || ''))) ||
                      candidates[0];
                    const smallCid = picked ? String(picked.channelId || '').trim() : '';
                    if (smallCid) {
                      discovered.set(target.memberId, { bigCid, smallCid });
                    }
                  } catch {}
                }
              };
              await Promise.all(
                Array.from({ length: Math.min(4, missingSmall.length) }, () => worker()),
              );
              if (!discovered.size || seq !== loadFollowedSeqRef.current) return;
              useMemberStore.getState().batchUpdateSmallRooms(
                Array.from(discovered.values()).map(({ bigCid, smallCid }) => ({
                  channelId: bigCid,
                  yklzId: smallCid,
                })),
              );
              seedRoomMapFromMembers(useMemberStore.getState().members);
              const smallQueryIds = Array.from(
                new Set(
                  Array.from(discovered.values())
                    .map(({ smallCid }) => Number(smallCid))
                    .filter((n) => n > 0),
                ),
              );
              const smallRes = smallQueryIds.length
                ? await pocketApi.getLastMessages(smallQueryIds).catch(() => null)
                : null;
              if (seq !== loadFollowedSeqRef.current) return;
              const smallMsgs = unwrapList(smallRes, [
                'content.lastMsgList',
                'content.data',
                'data',
                'lastMsgList',
              ]);
              setFollowed((prev) => {
                const next = prev.map((entry) => {
                  const hit = discovered.get(entry.memberId);
                  if (!hit || !entry.member) return entry;
                  const patchedMember: Member = { ...entry.member, yklzId: hit.smallCid };
                  return {
                    ...entry,
                    member: patchedMember,
                    lastSmallMessage:
                      findSmallLastMessage(smallMsgs, patchedMember) || entry.lastSmallMessage,
                  };
                });
                recordPreviewTimesFromList(next);
                void writeFollowedRoomsSnapshot(token, next);
                return next;
              });
            })();
          }, 1200);
        }

        const onMicInputs = followedMembers
          .map((item) => ({
            memberId: item.memberId,
            name: String(
              item.member?.ownerName ||
                (item.member as (Member & { name?: string }) | undefined)?.name ||
                item.memberId,
            ),
            channelId: String(item.member?.channelId || ''),
            serverId: String(item.member?.serverId || ''),
            smallChannelId: String(item.member?.yklzId || ''),
            state: String(item.member?.state || ''),
          }))
          .filter((m) => m.channelId);

        if (onMicStartTimerRef.current) {
          clearTimeout(onMicStartTimerRef.current);
          onMicStartTimerRef.current = null;
        }
        if (onMicInputs.length && navigation.isFocused()) {
          onMicStartTimerRef.current = setTimeout(() => {
            onMicStartTimerRef.current = null;
            if (navigation.isFocused() && AppState.currentState === 'active') {
              useOnMicStore
                .getState()
                .scan(onMicInputs, { source: 'rooms', priorityIds: followedIdsRef.current });
            }
          }, 1100);
        }

        livePromise.then((res) => {
          if (!res || seq !== loadFollowedSeqRef.current) return;
          const liveItems = extractLiveItemsFromRes(res);
          if (!liveItems.length && liveNowRef.current.ids.size > 0) {
            liveEmptyTicksRef.current += 1;
            if (liveEmptyTicksRef.current < 2) return;
          } else {
            liveEmptyTicksRef.current = 0;
          }
          const nextLiveNow = collectLiveNowSets(liveItems);
          liveNowRef.current = nextLiveNow;
          setLiveNow(nextLiveNow);
        });
        if (!silent) showToast(t('已加载 {count} 个房间', { count: followedMembers.length }));
        setFollowedError('');
      } catch (e) {
        if (seq !== loadFollowedSeqRef.current) return;
        setFollowedError(errorMessage(e));
        if (!silent) showToast(t('加载失败：{msg}', { msg: errorMessage(e) }));
      } finally {
        if (seq === loadFollowedSeqRef.current) setFollowedLoading(false);
      }
    },
    [navigation, recordPreviewTimesFromList, showToast, t, token],
  );
  loadFollowedRef.current = loadFollowed;

  useEffect(() => {
    if (selectedRoom) return;
    let active = true;
    const refreshLiveAndMic = () => {
      if (!active) return;
      fetchLiveListShared()
        .then((res) => {
          if (!active) return;
          const liveItems = extractLiveItemsFromRes(res);
          if (!liveItems.length && liveNowRef.current.ids.size > 0) {
            liveEmptyTicksRef.current += 1;
            if (liveEmptyTicksRef.current < 2) return;
          } else {
            liveEmptyTicksRef.current = 0;
          }
          const nextLiveNow = collectLiveNowSets(liveItems);
          liveNowRef.current = nextLiveNow;
          setLiveNow(nextLiveNow);
        })
        .catch(() => {});
      const cur = followedRef.current;
      if (cur.length) {
        const onMicInputs = cur
          .map((item) => ({
            memberId: item.memberId,
            name: String(
              item.member?.ownerName ||
                (item.member as (Member & { name?: string }) | undefined)?.name ||
                item.memberId,
            ),
            channelId: String(item.member?.channelId || ''),
            serverId: String(item.member?.serverId || ''),
            smallChannelId: String(item.member?.yklzId || ''),
            state: String(item.member?.state || ''),
          }))
          .filter((m) => m.channelId);
        if (onMicInputs.length && navigation.isFocused()) {
          useOnMicStore
            .getState()
            .scan(onMicInputs, { source: 'rooms', priorityIds: followedIdsRef.current });
        }
      }
    };
    const refreshLastMessages = () => {
      if (!active) return;
      const cur = followedRef.current;
      if (!cur.length) return;
      const serverIds = cur
        .map((item) => Number(item.member?.serverId || 0))
        .filter((id: number) => id > 0);
      const smallRoomIds = cur
        .map((item) => Number(item.member?.yklzId || 0))
        .filter((id: number) => id > 0);
      const queryIds = Array.from(new Set([...serverIds, ...smallRoomIds]));
      if (!queryIds.length) return;
      pocketApi
        .getLastMessages(queryIds)
        .then((res: unknown) => {
          if (!active) return;
          const lastMsgs = unwrapList(res, [
            'content.lastMsgList',
            'content.data',
            'data',
            'lastMsgList',
          ]);
          setFollowed((prev) => {
            const nextFollowed = prev.map((f) => ({
              ...f,
              lastMessage: findLastMessage(lastMsgs, f.member) || f.lastMessage,
              lastSmallMessage: findSmallLastMessage(lastMsgs, f.member) || f.lastSmallMessage,
            }));
            recordPreviewTimesFromList(nextFollowed);
            return nextFollowed;
          });
        })
        .catch(() => {});
    };
    let lastTickAt = 0;
    let focusTimer: ReturnType<typeof setTimeout> | null = null;
    const cancelFocusTimer = () => {
      if (focusTimer) {
        clearTimeout(focusTimer);
        focusTimer = null;
      }
    };
    const tick = () => {
      if (AppState.currentState !== 'active') return;
      if (!navigation.isFocused()) return;
      lastTickAt = Date.now();
      refreshLiveAndMic();
      refreshLastMessages();
    };
    const scheduleTickIfStale = () => {
      if (Date.now() - Math.max(lastTickAt, lastRoomsLoadedAtRef.current) < 20000) return;
      cancelFocusTimer();
      focusTimer = setTimeout(() => {
        focusTimer = null;
        if (active && navigation.isFocused()) tick();
      }, 950);
    };
    if (navigation.isFocused() && AppState.currentState === 'active') {
      scheduleTickIfStale();
    }
    const offFocus = navigation.addListener('focus', scheduleTickIfStale);
    const offBlur = navigation.addListener('blur', () => {
      cancelFocusTimer();
      if (onMicStartTimerRef.current) {
        clearTimeout(onMicStartTimerRef.current);
        onMicStartTimerRef.current = null;
      }
    });
    const appSub = AppState.addEventListener('change', (next) => {
      if (next === 'active' && navigation.isFocused()) scheduleTickIfStale();
      else cancelFocusTimer();
    });
    return () => {
      active = false;
      cancelFocusTimer();
      offFocus();
      offBlur();
      appSub.remove();
    };
  }, [navigation, recordPreviewTimesFromList, selectedRoom]);

  useEffect(() => {
    const curFollowed = followedRef.current;
    if (
      !token ||
      !showRoomListTime ||
      !roomTimeCacheLoaded ||
      selectedRoom ||
      !curFollowed.length
    ) {
      return;
    }
    type HydrateTarget = {
      channelId: string;
      serverId: string;
      preview: string;
      sig: string;
      isSmall: boolean;
      room?: Member;
    };
    const MESSAGE_LIST_PATHS = [
      'content.messageList',
      'content.message',
      'content.messages',
      'content.list',
      'data.messageList',
      'data.message',
      'messageList',
      'message',
      'messages',
      'list',
    ];
    let alive = false;
    let startTimer: ReturnType<typeof setTimeout> | null = null;
    const stopHydrate = () => {
      alive = false;
      if (startTimer) {
        clearTimeout(startTimer);
        startTimer = null;
      }
    };
    const startHydrate = () => {
      stopHydrate();
      const bigQueue: HydrateTarget[] = [];
      const smallQueue: HydrateTarget[] = [];
      for (const item of followedRef.current) {
        const m = item.member;
        const srv = String(m?.serverId || '');
        const bigCid = String(m?.channelId || '');
        const bigPreview = item.lastMessage ? messagePreviewText(item.lastMessage).trim() : '';
        if (bigCid && bigCid !== '0' && item.lastMessage && bigPreview) {
          const directMs = getMessageTime(item.lastMessage);
          const cached = roomTimeCacheRef.current[bigCid];
          const sig = `${bigCid}|${bigPreview}`;
          if (
            directMs <= 0 &&
            !(cached && cached.timeMs > 0 && cached.preview === bigPreview) &&
            !hydratedPreviewKeysRef.current.has(sig)
          ) {
            hydratedPreviewKeysRef.current.add(sig);
            bigQueue.push({
              channelId: bigCid,
              serverId: srv,
              preview: bigPreview,
              sig,
              isSmall: false,
              room: m,
            });
          }
        }
        const smallCid = String(m?.yklzId || '');
        const smallPreview = item.lastSmallMessage
          ? messagePreviewText(item.lastSmallMessage).trim()
          : '';
        if (smallCid && smallCid !== '0' && item.lastSmallMessage && smallPreview) {
          const directMs = getMessageTime(item.lastSmallMessage);
          const cached = roomTimeCacheRef.current[smallCid];
          const sig = `${smallCid}|${smallPreview}`;
          if (
            directMs <= 0 &&
            !(cached && cached.timeMs > 0 && cached.preview === smallPreview) &&
            !hydratedPreviewKeysRef.current.has(sig)
          ) {
            hydratedPreviewKeysRef.current.add(sig);
            smallQueue.push({
              channelId: smallCid,
              serverId: srv,
              preview: smallPreview,
              sig,
              isSmall: true,
              room: m,
            });
          }
        }
      }
      const queue = [...bigQueue, ...smallQueue];
      if (!queue.length) return;
      alive = true;
      let cursor = 0;
      const fetchLatestTime = async (target: HydrateTarget): Promise<number> => {
        const ownerRes = await pocketApi.getLatestRoomMessage({
          channelId: target.channelId,
          serverId: target.serverId,
          fetchAll: false,
          timeout: target.isSmall ? 3000 : 4500,
        });
        if (!alive) return 0;
        const ownerList = sortMessagesNewestFirst(
          unwrapList(ownerRes, MESSAGE_LIST_PATHS).filter(
            (msg) => Boolean(msg) && !isHiddenControlMessage(msg),
          ),
        );
        const ownerTs = ownerList.length ? getMessageTime(ownerList[0]) : 0;
        if (ownerTs > 0 || target.isSmall) return ownerTs;

        const allRes = await pocketApi.getLatestRoomMessage({
          channelId: target.channelId,
          serverId: target.serverId,
          fetchAll: true,
          timeout: 4000,
        });
        if (!alive) return 0;
        const allList = sortMessagesNewestFirst(
          unwrapList(allRes, MESSAGE_LIST_PATHS).filter(
            (msg) => Boolean(msg) && !isHiddenControlMessage(msg),
          ),
        );
        const roomMember = target.room;
        if (!roomMember) return 0;
        const latestIdol = allList.find((msg) => isIdolMessage(msg, roomMember, true));
        return latestIdol ? getMessageTime(latestIdol) : 0;
      };
      const worker = async (workerIdx: number) => {
        while (alive && cursor < queue.length) {
          const ok = await waitForIdleSlot('background', () => alive);
          if (!ok || !alive || cursor >= queue.length) break;
          const budget = getTaskBudget('Rooms', 'roomTime');
          if (workerIdx >= budget.concurrency) {
            await new Promise<void>((r) => setTimeout(r, 260));
            continue;
          }
          const idx = cursor++;
          if (idx >= queue.length) break;
          const target = queue[idx];
          try {
            const ts = await fetchLatestTime(target);
            if (!alive) break;
            if (ts > 0) {
              recordRoomPreviewTime(target.channelId, ts, target.preview);
            }
          } catch {
            if (!target.isSmall && !alive) {
              hydratedPreviewKeysRef.current.delete(target.sig);
            }
          }
          if (alive && cursor < queue.length) {
            const gap = getTaskBudget('Rooms', 'roomTime').gapMs;
            if (gap > 0) await new Promise<void>((r) => setTimeout(r, gap));
          }
        }
      };
      startTimer = setTimeout(() => {
        startTimer = null;
        if (!alive) return;
        const workerCount = Math.min(ROOM_TIME_HYDRATE_CONCURRENCY, queue.length);
        for (let i = 0; i < workerCount; i += 1) {
          void worker(i);
        }
      }, ROOM_TIME_HYDRATE_START_DELAY_MS);
    };
    startHydrate();
    return () => {
      stopHydrate();
    };
  }, [
    followedWarmKey,
    recordRoomPreviewTime,
    roomTimeCacheLoaded,
    selectedRoom,
    showRoomListTime,
    token,
  ]);

  const followedFetchedRef = useRef(false);
  const followedMatchedMembersRef = useRef<Member[] | null>(null);
  const followedTokenRef = useRef(token);
  const hydratedSnapshotTokenRef = useRef('');

  useEffect(() => {
    if (followedTokenRef.current === token) return;
    followedTokenRef.current = token;
    followedFetchedRef.current = false;
    followedMatchedMembersRef.current = null;
    hydratedSnapshotTokenRef.current = '';
    hydratedPreviewKeysRef.current.clear();
    smallRoomProbedRef.current.clear();
    roomMetaRevalidatedRef.current.clear();
    roomMessagesCache.current = {};
    deletedRoomMsgIdsRef.current.clear();
    followedIdsRef.current = new Set();
    setFollowedIds(new Set());
    setFollowed([]);
    if (selectedRoomRef.current) {
      finalizeCloseRoom(++closeSeqRef.current);
    }
    if (members.length) loadFollowed(true);
  }, [token, members.length, loadFollowed, finalizeCloseRoom]);

  useEffect(() => {
    const trimmed = String(token || '').trim();
    if (!trimmed) return undefined;
    return subscribeFollowedIds((ids, tk) => {
      if (tk !== trimmed) return;
      followedIdsRef.current = ids;
      setFollowedIds(ids);
      setFollowed((prev) => {
        if (!prev.length && !followedFetchedRef.current) return prev;
        const filtered = prev.filter((item) => ids.has(String(item.memberId)));
        const existing = new Set(filtered.map((item) => String(item.memberId)));
        let changed = filtered.length !== prev.length;
        const additions: FollowedRoom[] = [];
        ids.forEach((id) => {
          if (existing.has(id)) return;
          const m = memberLookupRef.current.get(id.trim());
          if (m?.channelId) {
            additions.push({ memberId: id, member: m });
            changed = true;
          }
        });
        if (!changed) return prev;
        const nextList = additions.length ? [...additions, ...filtered] : filtered;
        void writeFollowedRoomsSnapshot(trimmed, nextList);
        return nextList;
      });
    });
  }, [token]);

  useEffect(() => {
    if (!token) {
      hydratedSnapshotTokenRef.current = '';
      return;
    }
    if (!members.length || hydratedSnapshotTokenRef.current === token) return;
    hydratedSnapshotTokenRef.current = token;
    let alive = true;
    void Promise.all([readFollowedRoomsSnapshot(token), hydrateFollowedIdsShared(token)])
      .then(([snapRes, idsRes]) => {
        if (!alive || followedTokenRef.current !== token) return;
        const snapMap = new Map(snapRes.entries.map((e) => [e.memberId, e]));
        const ids = idsRes.ids.length ? idsRes.ids : snapRes.entries.map((e) => e.memberId);
        if (!ids.length) return;
        setFollowedIds((prev) => (prev.size > 0 ? prev : new Set(ids)));
        if (followedRef.current.length > 0) return;
        const hydratedFollowed = ids
          .map((id) => {
            const member = memberLookupRef.current.get(id.trim());
            if (!member?.channelId) return null;
            const snap = snapMap.get(id);
            return {
              memberId: id,
              member,
              lastMessage: (snap?.lastMessage as RoomMessageWire | undefined) || null,
              lastSmallMessage: (snap?.lastSmallMessage as RoomMessageWire | undefined) || null,
            } as FollowedRoom;
          })
          .filter((item): item is FollowedRoom => Boolean(item));
        if (!hydratedFollowed.length) return;
        recordPreviewTimesFromList(hydratedFollowed);
        setFollowed((prev) => (prev.length > 0 ? prev : hydratedFollowed));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [token, members, recordPreviewTimesFromList]);

  useEffect(() => {
    if (!members.length) return;
    if (followedFetchedRef.current && followedMatchedMembersRef.current === members) return;
    const firstFetch = !followedFetchedRef.current;
    followedFetchedRef.current = true;
    followedMatchedMembersRef.current = members;
    if (!firstFetch && followedRef.current.length > 0) {
      setFollowed((prev) =>
        prev.map((entry) => {
          const updated = memberLookupRef.current.get(String(entry.memberId).trim());
          return updated ? { ...entry, member: updated } : entry;
        }),
      );
      if (Date.now() - lastRoomsLoadedAtRef.current < 15000) return;
    }
    loadFollowed(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [members]);

  const openRoom = useCallback(
    async (
      room: Member,
      nextMode: RoomMode = 'big',
      includeFans = showFanMessages,
      mode: 'internal' | 'enter' = 'enter',
    ) => {
      if (mode === 'enter') {
        Keyboard.dismiss();
        setSearchOpen((prev) => (prev ? false : prev));
        setMemberBrowseOpen((prev) => (prev ? false : prev));
        setSearchQuery((prev) => (prev ? '' : prev));
      }

      const roomOpenStart = Date.now();
      const channelId = roomChannelId(room, nextMode);
      if (!channelId) {
        showToast(
          nextMode === 'small'
            ? t('这个成员缺少小房间 channelId，无法打开小房间。')
            : t('这个成员缺少大房间 channelId，无法打开房间。'),
        );
        return;
      }
      if (mode === 'enter') {
        notifyTransitionStart('room-overlay', 260);
        const shouldAnimateEnter = !selectedRoomRef.current || roomClosingRef.current;
        if (closeTimerRef.current) {
          clearTimeout(closeTimerRef.current);
          closeTimerRef.current = null;
        }
        if (roomEnterRafRef.current !== null) {
          cancelAnimationFrame(roomEnterRafRef.current);
          roomEnterRafRef.current = null;
        }
        closeSeqRef.current += 1;
        roomClosingRef.current = false;
        setRoomClosing(false);
        if (shouldAnimateEnter) {
          roomEnter.value = 0;
          roomEnterPendingRef.current = true;
        }
      }
      setSelectedRoom(room);
      lastRoomPushAtRef.current = 0;
      roomPushCountRef.current = 0;
      const openSeq = ++roomSeqRef.current;
      searchScanSeqRef.current += 1;
      const channelChanged = activeChannelRef.current !== channelId;
      activeChannelRef.current = channelId;

      activeRoomRef.current = {
        channelId,
        serverId: String(room.serverId || ''),
        memberId: String(room.id || ''),
      };

      {
        const sidStr = String(room.serverId || '').trim();
        const cidStr = String(channelId || '').trim();
        if (sidStr && sidStr !== '0' && cidStr && cidStr !== '0') {
          void subscribeRoomChannel(sidStr, cidStr).then((ok) => {
            if (!ok) logWarn(`[qchat] joinChannel 未成功 sid=${sidStr} cid=${cidStr}`);
          });
        }
      }

      if (channelChanged) {
        const earlyMeta = getRoomMetaCached(channelId);
        if (mode === 'internal') {
          if (earlyMeta?.bg) {
            setRoomMeta({
              name: earlyMeta.name || room.ownerName || '',
              bg: normalizeBgUrl(earlyMeta.bg),
            });
          } else if (earlyMeta && roomMetaRevalidatedRef.current.has(channelId)) {
            setRoomMeta({
              name: earlyMeta.name || room.ownerName || '',
              bg: '',
            });
          } else {
            setRoomMeta((prev) => ({
              name: earlyMeta?.name || room.ownerName || '',
              bg: prev.bg,
            }));
          }
        } else {
          setRoomMeta(
            earlyMeta
              ? {
                  name: earlyMeta.name || room.ownerName || '',
                  bg: normalizeBgUrl(earlyMeta.bg),
                }
              : { name: room.ownerName || '', bg: '' },
          );
          setComposerResetSeq((v) => v + 1);
          setRoomSendHint('');
        }
      }
      searchPausedByUserRef.current = false;
      setRoomSearchQuery('');
      setDebouncedRoomSearch('');
      setSearchScanState({
        scanning: false,
        scannedCount: 0,
        pausedAtLimit: false,
        pausedByUser: false,
      });
      setPlayingMedia(null);
      setImagePreview(null);
      const cacheKey = `${channelId}_${includeFans ? 'all' : 'idol'}`;
      const cached = roomMessagesCache.current[cacheKey];
      const cachedVisible =
        cached && cached.messages.length > 0
          ? filterVisibleRoomMessages(cached.messages, deletedRoomMsgIdsRef.current).visible
          : [];

      if (mode === 'internal') {
        if (cachedVisible.length > 0) {
          roomMessagesRef.current = cachedVisible;
          setRoomMessages(cachedVisible);
          setLoading(false);
          roomNextTimeRef.current = cached!.nextTime;
          hasMoreMessagesRef.current = cached!.hasMore;
          setRoomNextTime(cached!.nextTime);
          setHasMoreMessages(cached!.hasMore);
        } else {
          roomMessagesRef.current = [];
          setRoomMessages([]);
          setLoading(true);
          roomNextTimeRef.current = 0;
          hasMoreMessagesRef.current = false;
          setRoomNextTime(0);
          setHasMoreMessages(false);
        }
      } else if (channelChanged) {
        if (cachedVisible.length > 0) {
          roomMessagesRef.current = cachedVisible;
          setRoomMessages(cachedVisible);
          setRoomLoadedOnce(true);
          setLoading(false);
          roomNextTimeRef.current = cached!.nextTime;
          hasMoreMessagesRef.current = cached!.hasMore;
          setRoomNextTime(cached!.nextTime);
          setHasMoreMessages(cached!.hasMore);
        } else {
          roomMessagesRef.current = [];
          setRoomMessages([]);
          setLoading(true);
          setRoomLoadedOnce(false);
          roomNextTimeRef.current = 0;
          hasMoreMessagesRef.current = false;
          setRoomNextTime(0);
          setHasMoreMessages(false);
        }
      }
      setRoomMsgError('');

      roomAtBottomRef.current = true;
      setRoomAtBottom(true);
      setRoomFreezeKey(null);
      setRoomMode(nextMode);
      setShowFanMessages(includeFans);

      const fallbackCid = nextMode === 'small' ? room.channelId : undefined;
      const siblingCid = nextMode === 'big' ? room.yklzId : room.channelId;
      const cleanSiblingCid =
        siblingCid && String(siblingCid) !== '0' && String(siblingCid) !== 'undefined'
          ? String(siblingCid)
          : '';
      const cachedMeta = getRoomMetaCached(channelId);
      if (cachedMeta?.bg) void ensureBgCached(cachedMeta.bg);

      if (!cachedMeta || !roomMetaRevalidatedRef.current.has(channelId)) {
        void fetchAndCacheRoomMeta(channelId, fallbackCid, room.serverId).then(({ meta }) => {
          if (!meta) return;
          if (activeChannelRef.current !== channelId) return;
          setRoomMeta({
            name: meta.name || room.ownerName || '',
            bg: normalizeBgUrl(meta.bg),
          });
        });
      }

      if (cleanSiblingCid && cleanSiblingCid !== channelId) {
        const sibCached = getRoomMetaCached(cleanSiblingCid);
        if (sibCached?.bg) void ensureBgCached(sibCached.bg);
        if (!roomMetaRevalidatedRef.current.has(cleanSiblingCid)) {
          const targetMemberId = String(room.id || '');
          setTimeout(() => {
            if (activeRoomRef.current.memberId !== targetMemberId) return;
            void fetchAndCacheRoomMeta(
              cleanSiblingCid,
              nextMode === 'big' ? channelId : undefined,
              room.serverId,
            );
          }, 120);
        }
      }

      try {
        const userInfoPromise = !currentUserId
          ? pocketApi.getNimLoginInfo().catch(() => null)
          : Promise.resolve(null);
        const messagesPromise = pocketApi.getRoomMessages({
          channelId,
          serverId: room.serverId,
          nextTime: 0,
          fetchAll: includeFans,
          fallbackChannelId: nextMode === 'small' ? room.channelId : undefined,
        });
        const [userInfo, res] = await Promise.all([userInfoPromise, messagesPromise]);
        const nextCurrentUserId = currentUserId || currentUserIdFrom(userInfo);
        if (nextCurrentUserId) setCurrentUserId(nextCurrentUserId);
        const list = unwrapList(res, [
          'content.messageList',
          'content.message',
          'content.messages',
          'content.list',
          'data.messageList',
          'data.message',
          'messageList',
          'message',
          'messages',
          'list',
        ]);
        const { visible, deletedIdsFound } = filterVisibleRoomMessages(
          list.filter(Boolean) as RoomMessage[],
          deletedRoomMsgIdsRef.current,
        );
        if (deletedIdsFound.length) rememberDeletedMsgIds(deletedIdsFound);
        const sorted = sortMessagesNewestFirst(visible);
        diagnoseUndefined(sorted, 'OPEN');

        if (openSeq !== roomSeqRef.current) return;
        if (sorted.length > 0) {
          const latestIdolMsg = sorted.find((m) => isIdolMessage(m, room, true));
          if (latestIdolMsg) {
            const latestTs = getMessageTime(latestIdolMsg);
            if (latestTs > 0) {
              recordRoomPreviewTime(channelId, latestTs, messagePreviewText(latestIdolMsg));
            }
          }

          if (nextMode === 'small' && room.channelId && channelId !== String(room.channelId)) {
            if (String(room.yklzId || '') !== channelId) {
              useMemberStore.getState().updateMemberRoomIds(String(room.channelId), {
                yklzId: channelId,
              });
              seedRoomMapFromMembers(useMemberStore.getState().members);
            }
          }
          if (latestIdolMsg) {
            setFollowed((prev) => {
              let changed = false;
              const next = prev.map((entry) => {
                const matchMember =
                  entry.memberId === String(room.id) ||
                  (room.channelId &&
                    String(entry.member?.channelId || '') === String(room.channelId));
                if (!matchMember) return entry;
                if (
                  nextMode === 'small' &&
                  room.channelId &&
                  channelId !== String(room.channelId)
                ) {
                  changed = true;
                  const patchedMember =
                    entry.member && String(entry.member.yklzId || '') !== channelId
                      ? { ...entry.member, yklzId: channelId }
                      : entry.member;
                  return {
                    ...entry,
                    member: patchedMember,
                    lastSmallMessage: latestIdolMsg as unknown as RoomMessageWire,
                  };
                }
                if (nextMode === 'big') {
                  const prevTs = entry.lastMessage ? getMessageTime(entry.lastMessage) : 0;
                  const nextTs = getMessageTime(latestIdolMsg);
                  if (!entry.lastMessage || nextTs >= prevTs) {
                    changed = true;
                    return {
                      ...entry,
                      lastMessage: latestIdolMsg as unknown as RoomMessageWire,
                    };
                  }
                }
                return entry;
              });
              if (changed && token) void writeFollowedRoomsSnapshot(token, next);
              return changed ? next : prev;
            });
          }
        }
        const rawNextTime = getNextTime(res, list);
        const freshNextTime = rawNextTime > 0 && list.length > 0 ? rawNextTime : 0;
        const freshHasMore = freshNextTime > 0;
        let finalMessages = sorted;
        let finalNextTime = freshNextTime;
        let finalHasMore = freshHasMore;
        const freshCachedVisible =
          cached && cached.messages.length > 0
            ? filterVisibleRoomMessages(cached.messages, deletedRoomMsgIdsRef.current).visible
            : [];
        if (
          cached &&
          freshCachedVisible.length > sorted.length &&
          sorted.length > 0 &&
          getMessageTime(sorted[sorted.length - 1]) <= getMessageTime(freshCachedVisible[0])
        ) {
          finalMessages = mergeMessages(freshCachedVisible, sorted);
          if (cached.nextTime > 0 && (!freshNextTime || cached.nextTime < freshNextTime)) {
            finalNextTime = cached.nextTime;
            finalHasMore = cached.hasMore;
          }
        }
        roomMessagesRef.current = finalMessages;
        roomNextTimeRef.current = finalNextTime;
        hasMoreMessagesRef.current = finalHasMore;
        setRoomMessages(finalMessages);
        roomMessagesCache.current[cacheKey] = {
          messages: finalMessages,
          nextTime: finalNextTime,
          hasMore: finalHasMore,
        };

        setRoomLoadedOnce(true);
        setRoomMsgError('');
        logInfo(
          `[room] 进房 ${room.ownerName || channelId} ${nextMode} 消息加载耗时 ${Date.now() - roomOpenStart}ms (${finalMessages.length}条)`,
          'room',
        );
        setRoomNextTime(finalNextTime);
        setHasMoreMessages(finalHasMore);

        if (roomChannelId(room, nextMode)) {
          void useOnMicStore.getState().probeMember({
            memberId: String(room.id || ''),
            name: String(room.ownerName || room.id || ''),
            channelId: String(room.channelId || ''),
            serverId: String(room.serverId || ''),
            smallChannelId: String(room.yklzId || ''),
          });
        }
      } catch (error) {
        if (openSeq !== roomSeqRef.current || activeChannelRef.current !== channelId) return;
        showToast(t('加载失败：{msg}', { msg: errorMessage(error) }));
        if (!roomMessagesCache.current[cacheKey]?.messages?.length) setRoomMessages([]);
        setRoomMsgError(errorMessage(error));
      } finally {
        if (openSeq === roomSeqRef.current) setLoading(false);
      }
    },
    [
      currentUserId,
      fetchAndCacheRoomMeta,
      recordRoomPreviewTime,
      rememberDeletedMsgIds,
      roomEnter,
      showFanMessages,
      showToast,
      t,
      token,
    ],
  );

  const countSearchMatches = useCallback(
    (messages: RoomMessage[], qLower: string, room: Member | null, includeFans: boolean) => {
      if (!room || !qLower) return messages.length;
      const roomMetaLower = buildRoomMetaSearchHaystack(room);
      const roomMatchesAll = roomMetaLower.includes(qLower);
      const uid = currentUserIdRef.current;
      const mids = memberIdSetRef.current;
      let count = 0;
      for (let i = 0; i < messages.length; i++) {
        const item = messages[i];
        if (!item) continue;
        if (!includeFans && messageRole(item, room, false, uid, mids) === 'fan') continue;
        if (roomMatchesAll || getRoomMessageSearchHaystack(item, room).includes(qLower)) {
          count += 1;
        }
      }
      return count;
    },
    [],
  );

  const fetchSingleOlderPage = useCallback(
    async (options?: { silent?: boolean; suppressErrorToast?: boolean }) => {
      if (historyInFlightRef.current) return historyInFlightRef.current;
      const room = selectedRoomRef.current;
      const modeNow = roomModeRef.current;
      const includeFans = showFanMessagesRef.current;
      const prevCursor = roomNextTimeRef.current;
      const silent = options?.silent === true;
      const suppressErrorToast = options?.suppressErrorToast === true;
      if (!room || !hasMoreMessagesRef.current || prevCursor <= 0) {
        return { added: 0, fetched: 0, hasMore: false, newItems: [] as RoomMessage[] };
      }
      const channelId = roomChannelId(room, modeNow);
      if (!channelId) {
        return { added: 0, fetched: 0, hasMore: false, newItems: [] as RoomMessage[] };
      }
      const seq = roomSeqRef.current;

      let promise: Promise<{
        added: number;
        fetched: number;
        hasMore: boolean;
        newItems?: RoomMessage[];
        merged?: RoomMessage[];
        error?: boolean;
        errorMessage?: string;
      }> | null = null;
      promise = (async () => {
        try {
          const res = await pocketApi.getRoomMessages({
            channelId,
            serverId: room.serverId,
            nextTime: prevCursor,
            fetchAll: includeFans,
            fallbackChannelId: modeNow === 'small' ? room.channelId : undefined,
          });
          if (seq !== roomSeqRef.current || activeChannelRef.current !== channelId) {
            return {
              added: 0,
              fetched: 0,
              hasMore: hasMoreMessagesRef.current,
              newItems: [] as RoomMessage[],
            };
          }
          const list = unwrapList(res, [
            'content.messageList',
            'content.message',
            'content.messages',
            'content.list',
            'data.messageList',
            'data.message',
            'messageList',
            'message',
            'messages',
            'list',
          ]);
          const rawNextTime = getNextTime(res, list);
          const { visible, deletedIdsFound } = filterVisibleRoomMessages(
            list.filter(Boolean) as RoomMessage[],
            deletedRoomMsgIdsRef.current,
          );
          if (deletedIdsFound.length) rememberDeletedMsgIds(deletedIdsFound);
          const prevMsgs = roomMessagesRef.current;
          const prevKeys = new Set(prevMsgs.map((m) => messageKey(m)));
          const merged = mergeMessages(prevMsgs, visible);
          const newItems = merged.filter((m) => !prevKeys.has(messageKey(m)));
          const added = Math.max(newItems.length, merged.length - prevMsgs.length);
          const advance = computeHistoryCursorAdvance(prevCursor, rawNextTime, list.length, added);
          roomNextTimeRef.current = advance.nextTime;
          hasMoreMessagesRef.current = advance.hasMore;
          setRoomNextTime(advance.nextTime);
          setHasMoreMessages(advance.hasMore);
          if (merged !== prevMsgs) {
            diagnoseUndefined(merged, 'LOADMORE');
            roomMessagesRef.current = merged;
            if (!silent) {
              setRoomMessages(merged);
            }
            const cacheKey = `${channelId}_${includeFans ? 'all' : 'idol'}`;
            roomMessagesCache.current[cacheKey] = {
              messages: merged,
              nextTime: advance.nextTime,
              hasMore: advance.hasMore,
            };
          }
          return {
            added,
            fetched: list.length,
            hasMore: advance.hasMore,
            newItems,
            merged,
          };
        } catch (error) {
          const errMsg = errorMessage(error);
          if (
            !suppressErrorToast &&
            seq === roomSeqRef.current &&
            activeChannelRef.current === channelId
          ) {
            showToast(t('继续加载失败：{msg}', { msg: errMsg }));
          }
          return {
            added: 0,
            fetched: 0,
            hasMore: hasMoreMessagesRef.current,
            newItems: [] as RoomMessage[],
            error: true,
            errorMessage: errMsg,
          };
        } finally {
          if (historyInFlightRef.current === promise) {
            historyInFlightRef.current = null;
          }
        }
      })();

      historyInFlightRef.current = promise;
      return promise;
    },
    [rememberDeletedMsgIds, showToast, t],
  );

  const runSearchHistoryBurst = useCallback(
    async (qRaw: string, targetMatches: number, scanToken: number) => {
      const qLower = qRaw.trim().toLowerCase();
      const room = selectedRoomRef.current;
      const roomToken = roomSeqRef.current;
      const channelId = activeChannelRef.current;
      const includeFans = showFanMessagesRef.current;
      if (!qLower || !room || !channelId) return;
      if (loadingMoreMessagesRef.current) return;

      let matchCount = countSearchMatches(roomMessagesRef.current, qLower, room, includeFans);
      if (
        !shouldSearchAutoContinue({
          query: qLower,
          matchCount,
          targetMatchCount: targetMatches,
          pagesScannedInBurst: 0,
          maxPagesPerBurst: ROOM_SEARCH_BURST_PAGES,
          hasMore: hasMoreMessagesRef.current,
          nextTime: roomNextTimeRef.current,
          pausedByUser: searchPausedByUserRef.current,
        })
      ) {
        setSearchScanState({
          scanning: false,
          scannedCount: roomMessagesRef.current.length,
          pausedAtLimit: false,
          pausedByUser: searchPausedByUserRef.current,
        });
        return;
      }

      const roomMetaMatches = buildRoomMetaSearchHaystack(room).includes(qLower);
      const uid = currentUserIdRef.current;
      const mids = memberIdSetRef.current;
      let hasUncommittedMerged = false;
      let lastStatusUpdateAt = Date.now();

      loadingMoreMessagesRef.current = true;
      setLoadingMoreMessages(true);
      setSearchScanState({
        scanning: true,
        scannedCount: roomMessagesRef.current.length,
        pausedAtLimit: false,
        pausedByUser: false,
      });

      let burstPages = 0;
      let hitError = false;
      let consecutiveErrors = 0;
      try {
        while (
          shouldSearchAutoContinue({
            query: qLower,
            matchCount,
            targetMatchCount: targetMatches,
            pagesScannedInBurst: burstPages,
            maxPagesPerBurst: ROOM_SEARCH_BURST_PAGES,
            hasMore: hasMoreMessagesRef.current,
            nextTime: roomNextTimeRef.current,
            pausedByUser: searchPausedByUserRef.current,
          })
        ) {
          if (
            scanToken !== searchScanSeqRef.current ||
            roomToken !== roomSeqRef.current ||
            activeChannelRef.current !== channelId ||
            debouncedRoomSearchRef.current.trim().toLowerCase() !== qLower ||
            searchPausedByUserRef.current
          ) {
            return;
          }
          const stepRes = await fetchSingleOlderPage({
            silent: true,
            suppressErrorToast: true,
          });
          if (
            scanToken !== searchScanSeqRef.current ||
            roomToken !== roomSeqRef.current ||
            activeChannelRef.current !== channelId ||
            debouncedRoomSearchRef.current.trim().toLowerCase() !== qLower ||
            searchPausedByUserRef.current
          ) {
            if (stepRes.added > 0) hasUncommittedMerged = true;
            return;
          }

          if (stepRes.error) {
            consecutiveErrors += 1;
            if (consecutiveErrors <= ROOM_SEARCH_MAX_CONSECUTIVE_ERRORS) {
              await new Promise<void>((resolve) => setTimeout(resolve, 700 * consecutiveErrors));
              if (
                scanToken !== searchScanSeqRef.current ||
                roomToken !== roomSeqRef.current ||
                activeChannelRef.current !== channelId ||
                debouncedRoomSearchRef.current.trim().toLowerCase() !== qLower ||
                searchPausedByUserRef.current
              ) {
                return;
              }
              continue;
            }
            showToast(t('继续加载失败：{msg}', { msg: stepRes.errorMessage || 'network error' }));
            hitError = true;
            break;
          }
          consecutiveErrors = 0;
          burstPages += 1;

          let newHits = 0;
          const newItems = stepRes.newItems || [];
          for (let i = 0; i < newItems.length; i += 1) {
            const msgItem = newItems[i];
            if (!msgItem) continue;
            if (!includeFans && messageRole(msgItem, room, false, uid, mids) === 'fan') continue;
            if (roomMetaMatches || getRoomMessageSearchHaystack(msgItem, room).includes(qLower)) {
              newHits += 1;
            }
          }
          matchCount += newHits;

          if (stepRes.added > 0) {
            if (newHits > 0) {
              const snapshot = stepRes.merged || roomMessagesRef.current;
              setRoomMessages((prev) => mergeMessages(prev, snapshot));
              hasUncommittedMerged = false;
            } else {
              hasUncommittedMerged = true;
            }
          }

          const now = Date.now();
          if (newHits > 0 || now - lastStatusUpdateAt >= 220) {
            lastStatusUpdateAt = now;
            setSearchScanState({
              scanning: true,
              scannedCount: roomMessagesRef.current.length,
              pausedAtLimit: false,
              pausedByUser: false,
            });
          }

          if (
            shouldSearchAutoContinue({
              query: qLower,
              matchCount,
              targetMatchCount: targetMatches,
              pagesScannedInBurst: burstPages,
              maxPagesPerBurst: ROOM_SEARCH_BURST_PAGES,
              hasMore: hasMoreMessagesRef.current,
              nextTime: roomNextTimeRef.current,
              pausedByUser: searchPausedByUserRef.current,
            })
          ) {
            await new Promise<void>((resolve) => setTimeout(resolve, ROOM_SEARCH_PAGE_DELAY_MS));
          }
        }
      } finally {
        loadingMoreMessagesRef.current = false;
        setLoadingMoreMessages(false);
        if (
          hasUncommittedMerged &&
          roomToken === roomSeqRef.current &&
          activeChannelRef.current === channelId
        ) {
          const snapshot = roomMessagesRef.current;
          startTransition(() => {
            setRoomMessages((prev) => mergeMessages(prev, snapshot));
          });
        }
        if (
          scanToken === searchScanSeqRef.current &&
          roomToken === roomSeqRef.current &&
          activeChannelRef.current === channelId &&
          debouncedRoomSearchRef.current.trim().toLowerCase() === qLower
        ) {
          const pausedAtLimit =
            !searchPausedByUserRef.current &&
            hasMoreMessagesRef.current &&
            (hitError || matchCount < targetMatches);
          setSearchScanState({
            scanning: false,
            scannedCount: roomMessagesRef.current.length,
            pausedAtLimit,
            pausedByUser: searchPausedByUserRef.current,
          });
        }
      }
    },
    [countSearchMatches, fetchSingleOlderPage, showToast, t],
  );

  useEffect(() => {
    const q = debouncedRoomSearch.trim().toLowerCase();
    if (!selectedRoom || !roomSearchOpen || !q || loading) return;
    if (searchPausedByUserRef.current) return;
    const scanToken = ++searchScanSeqRef.current;
    void runSearchHistoryBurst(q, ROOM_SEARCH_MIN_HITS, scanToken);
  }, [
    debouncedRoomSearch,
    roomSearchOpen,
    selectedRoom,
    loading,
    roomMode,
    showFanMessages,
    runSearchHistoryBurst,
  ]);

  const refreshRoomMessagesRef = useRef<(() => void) | null>(null);
  const loadMoreRoomMessages = useCallback(async () => {
    const now = Date.now();
    if (
      !selectedRoomRef.current ||
      loadingRef.current ||
      loadingMoreMessagesRef.current ||
      refreshingRef.current ||
      !hasMoreMessagesRef.current ||
      roomNextTimeRef.current <= 0 ||
      now - lastLoadMoreAtRef.current < ROOM_LOAD_MORE_COOLDOWN_MS
    ) {
      return;
    }
    lastLoadMoreAtRef.current = now;
    const q = debouncedRoomSearchRef.current.trim().toLowerCase();
    if (q) {
      searchPausedByUserRef.current = false;
      const scanToken = ++searchScanSeqRef.current;
      const curHits = countSearchMatches(
        roomMessagesRef.current,
        q,
        selectedRoomRef.current,
        showFanMessagesRef.current,
      );
      await runSearchHistoryBurst(q, curHits + 12, scanToken);
      return;
    }

    loadingMoreMessagesRef.current = true;
    setLoadingMoreMessages(true);
    try {
      await fetchSingleOlderPage();
    } finally {
      loadingMoreMessagesRef.current = false;
      setLoadingMoreMessages(false);
    }
  }, [countSearchMatches, fetchSingleOlderPage, runSearchHistoryBurst]);
  const loadMoreRoomMessagesRef = useRef(loadMoreRoomMessages);
  loadMoreRoomMessagesRef.current = loadMoreRoomMessages;

  const refreshRoomMessages = useCallback(async () => {
    if (!selectedRoom || refreshingRef.current) return;
    const channelId = roomChannelId(selectedRoom, roomMode);
    if (!channelId) return;
    const seq = roomSeqRef.current;
    refreshingRef.current = true;
    try {
      const res = await pocketApi.getRoomMessages({
        channelId,
        serverId: selectedRoom.serverId,
        nextTime: 0,
        limit: ROOM_REFRESH_LIMIT,
        fetchAll: showFanMessages,
        fallbackChannelId: roomMode === 'small' ? selectedRoom.channelId : undefined,
      });
      const list = unwrapList(res, [
        'content.messageList',
        'content.message',
        'content.messages',
        'content.list',
        'data.messageList',
        'data.message',
        'messageList',
        'message',
        'messages',
        'list',
      ]);
      if (!list || list.length === 0) return;
      const { visible, deletedIdsFound } = filterVisibleRoomMessages(
        list.filter(Boolean) as RoomMessage[],
        deletedRoomMsgIdsRef.current,
      );
      if (deletedIdsFound.length) rememberDeletedMsgIds(deletedIdsFound);
      const sorted = sortMessagesNewestFirst(visible);

      const prevMsgs = roomMessagesRef.current;
      const prevNewest = prevMsgs.length ? getMessageTime(prevMsgs[0]) : 0;

      const prevKeys = new Set(prevMsgs.map((m) => messageKey(m)));
      const hasFresh = sorted.some(
        (m) => !prevKeys.has(messageKey(m)) && getMessageTime(m) >= prevNewest,
      );
      const prevHasDeleted = prevMsgs.some(
        (m) =>
          isHiddenControlMessage(m) || matchesDeletedMessageId(m, deletedRoomMsgIdsRef.current),
      );
      if (!hasFresh && !prevHasDeleted) return;

      if (seq !== roomSeqRef.current || activeChannelRef.current !== channelId) return;
      if (sorted.length > 0) {
        const latestIdolMsg = sorted.find((m) => isIdolMessage(m, selectedRoom, true));
        if (latestIdolMsg) {
          const latestTs = getMessageTime(latestIdolMsg);
          if (latestTs > 0) {
            recordRoomPreviewTime(channelId, latestTs, messageText(latestIdolMsg));
          }
        }
      }

      setRoomMessages((prev) => {
        const cleanedPrev = prev.filter(
          (m) =>
            !isHiddenControlMessage(m) && !matchesDeletedMessageId(m, deletedRoomMsgIdsRef.current),
        );
        const newest = cleanedPrev.length ? getMessageTime(cleanedPrev[0]) : 0;
        const fresh = sorted.filter(
          (m) =>
            getMessageTime(m) >= newest ||
            (cleanedPrev[0] ? messageKey(m) === messageKey(cleanedPrev[0]) : false),
        );
        if (!fresh.length && cleanedPrev.length === prev.length) return prev;
        const merged = fresh.length ? mergeMessages(cleanedPrev, fresh) : cleanedPrev;
        diagnoseUndefined(merged, 'REFRESH');
        roomMessagesRef.current = merged;
        return merged;
      });
    } catch {
    } finally {
      refreshingRef.current = false;
    }
  }, [recordRoomPreviewTime, rememberDeletedMsgIds, roomMode, selectedRoom, showFanMessages]);
  refreshRoomMessagesRef.current = refreshRoomMessages;

  const rejoinActiveChannel = useCallback(() => {
    const target = activeRoomRef.current;
    const sid = String(target?.serverId || '').trim();
    const cid = String(target?.channelId || '').trim();
    if (sid && sid !== '0' && cid && cid !== '0') {
      void subscribeRoomChannel(sid, cid).then((ok) => {
        if (!ok && __DEV__) logWarn(`[qchat] rejoin 未成功 sid=${sid} cid=${cid}`);
      });
    }
  }, []);

  const followedServerIdsKey = useMemo(
    () =>
      Array.from(
        new Set(
          followed
            .map((item) => String(item.member?.serverId || '').trim())
            .filter((sid) => sid && sid !== '0'),
        ),
      )
        .sort()
        .join(','),
    [followed],
  );
  useEffect(() => {
    if (!followedServerIdsKey) return;
    void subscribeRoomChannelsBatch(followedServerIdsKey.split(','));
  }, [followedServerIdsKey]);

  useEffect(() => {
    if (!selectedRoom) return undefined;
    const canRefresh = () => navigation.isFocused() && AppState.currentState === 'active';
    const syncOnce = () => {
      rejoinActiveChannel();
      if (canRefresh()) void refreshRoomMessages();
    };
    const offConnected = onQChatConnected(syncOnce);
    const appStateSub = AppState.addEventListener('change', (next) => {
      if (next === 'active') syncOnce();
    });
    const focusSub = navigation.addListener('focus', syncOnce);
    return () => {
      offConnected();
      appStateSub.remove();
      focusSub();
    };
  }, [selectedRoom, refreshRoomMessages, navigation, rejoinActiveChannel]);

  useEffect(() => {
    let disposed = false;
    let unsubscribe: (() => void) | null = null;
    observeRoomMessages((messages) => {
      if (disposed || !messages.length) return;
      const cid = activeChannelRef.current;
      const mappedPairs = messages.map((raw) => ({
        raw,
        mapped: qchatToRoomMessage(raw),
      }));
      const channelOwnerMap = new Map<string, Member>();
      for (const entry of followedRef.current) {
        if (!entry.member) continue;
        const bigCid = String(entry.member.channelId || '').trim();
        const smallCid = String(entry.member.yklzId || '').trim();
        if (bigCid) channelOwnerMap.set(bigCid, entry.member);
        if (smallCid && smallCid !== '0') channelOwnerMap.set(smallCid, entry.member);
      }
      const byChannel = new Map<string, RoomMessageWire>();
      const deletedInActiveChannel = new Set<string>();
      const visibleFresh: RoomMessageWire[] = [];
      for (const { raw, mapped } of mappedPairs) {
        const voiceEvent = parseVoiceEvent(raw);
        if (voiceEvent) {
          useOnMicStore.getState().applyVoiceEvent(voiceEvent);
          continue;
        }
        if (isDeletedMessage(raw) || isDeletedMessage(mapped)) {
          const delIds = Array.from(
            new Set([...extractDeletedMessageIds(raw), ...extractDeletedMessageIds(mapped)]),
          );
          if (delIds.length) rememberDeletedMsgIds(delIds);
          if (cid && String(raw.channelId) === String(cid)) {
            delIds.forEach((id) => deletedInActiveChannel.add(id));
          }
          continue;
        }
        if (isHiddenControlMessage(mapped)) continue;
        if (
          cid &&
          selectedRoomRef.current &&
          String(raw.channelId) === String(cid) &&
          !matchesDeletedMessageId(mapped, deletedRoomMsgIdsRef.current)
        ) {
          visibleFresh.push(mapped);
        }
        const msgCid = String(raw.channelId || '').trim();
        if (!msgCid) continue;
        let roomOwner = channelOwnerMap.get(msgCid);
        if (!roomOwner) {
          roomOwner = channelMemberRef.current.get(msgCid);
          if (roomOwner) channelOwnerMap.set(msgCid, roomOwner);
        }

        if (!roomOwner || !isIdolMessage(mapped, roomOwner, true)) continue;
        const msgTs = getMessageTime(mapped);
        const existing = byChannel.get(msgCid);
        if (!existing || msgTs >= getMessageTime(existing)) {
          byChannel.set(msgCid, mapped);
        }
        if (msgTs > 0) recordRoomPreviewTime(msgCid, msgTs, messageText(mapped));
      }
      if (byChannel.size > 0) {
        if (!isRoomsFocusedRef.current && !selectedRoomRef.current) {
          byChannel.forEach((msg, chId) => {
            pendingQChatByChannelRef.current.set(chId, msg);
          });
        } else {
          setFollowed((prev) => {
            let changed = false;
            const next = prev.map((entry) => {
              const bigCid = String(entry.member?.channelId || '').trim();
              const smallCid = String(entry.member?.yklzId || '').trim();
              const bigMsg = bigCid ? byChannel.get(bigCid) : undefined;
              const smallMsg = smallCid ? byChannel.get(smallCid) : undefined;
              if (!bigMsg && !smallMsg) return entry;
              changed = true;
              return {
                ...entry,
                ...(bigMsg ? { lastMessage: bigMsg as unknown as RoomMessageWire } : null),
                ...(smallMsg ? { lastSmallMessage: smallMsg as unknown as RoomMessageWire } : null),
              };
            });
            return changed ? next : prev;
          });
        }
      }
      if (!cid || !selectedRoomRef.current) return;
      if (__DEV__) {
        logWarn(
          `[qchat] recv=${messages.length} matched=${visibleFresh.length} del=${deletedInActiveChannel.size}`,
        );
      }
      if (!visibleFresh.length && deletedInActiveChannel.size === 0) return;
      if (visibleFresh.length > 0) {
        lastRoomPushAtRef.current = Date.now();
        roomPushCountRef.current += 1;
        if (roomPushCountRef.current <= 3) {
          logInfo(
            `[qchat] 实时推送到达 ${visibleFresh.length} 条（本房间第 ${roomPushCountRef.current} 次）`,
            'room.live',
          );
        }
      }
      setRoomMessages((prev) => {
        const cleanedPrev =
          deletedInActiveChannel.size > 0
            ? prev.filter(
                (m) =>
                  !matchesDeletedMessageId(m, deletedInActiveChannel) && !isHiddenControlMessage(m),
              )
            : prev;
        const merged =
          visibleFresh.length > 0 ? mergeMessages(cleanedPrev, visibleFresh) : cleanedPrev;
        diagnoseUndefined(merged, 'QCHAT');
        roomMessagesRef.current = merged;
        return merged;
      });
    })
      .then((unsub) => {
        if (disposed) {
          unsub();
          return;
        }
        unsubscribe = unsub;
        if (selectedRoomRef.current) rejoinActiveChannel();
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      if (unsubscribe) unsubscribe();
    };
  }, [nimEpoch, recordRoomPreviewTime, rejoinActiveChannel, rememberDeletedMsgIds]);

  const resolveLiveAndOpen = useCallback(
    async (media: RoomMedia) => {
      const key = String(media.liveId || media.url || 'live');

      if (liveResolve?.key === key && !liveResolve.error) return;
      const token = ++liveResolveToken.current;
      setLiveResolve({ key, error: '', media });
      try {
        const resolved = await resolveRoomLiveMediaWithRetry(media);
        if (token !== liveResolveToken.current) return;
        if (!resolved.url) {
          setLiveResolve({ key, error: t('解析直播地址失败，请检查网络后重试'), media });
          return;
        }
        setLiveResolve(null);

        const isVod = roomTapIsVod(resolved);
        const liveUrl = resolved.url;
        setRoomPlayer({
          ...resolved,
          isLive: !isVod,
          needsVlc: resolved.needsVlc || streamNeedsProxy(liveUrl),
        });
        if (!isVod && resolved.liveId) {
          const rm = selectedRoomRef.current;
          useDiscoveredLivesStore.getState().addDiscoveredLive({
            liveId: String(resolved.liveId),
            title: resolved.title || rm?.ownerName || '',
            liveRoomTitle: resolved.title || '',
            screenDirection: 0,
            liveType: resolved.type === 'audio' ? 2 : 1,
            startTime: Date.now(),
            endTime: 0,
            playUrl: liveUrl,
            playPath: liveUrl,
            liveCover: resolved.cover || rm?.avatar || '',
            coverPath: resolved.cover || rm?.avatar || '',
            nickname: rm?.ownerName || resolved.title || '',
            isRecording: false,
            clubId: '',
            groupId: 0,
            userId: rm?.userId ? String(rm.userId) : rm?.id ? String(rm.id) : '',
          });
        }

        setRoomPlayerFullscreen(false);
      } catch (e) {
        if (token === liveResolveToken.current) {
          setLiveResolve({
            key,
            error: errorMessage(e) || t('解析直播地址失败，请检查网络后重试'),
            media,
          });
        }
      }
    },
    [liveResolve, t],
  );

  const cancelLiveResolve = useCallback(() => {
    liveResolveToken.current += 1;
    setLiveResolve(null);
  }, []);

  useEffect(() => {
    if (!liveResolve) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!navigation.isFocused()) return false;
      cancelLiveResolve();
      return true;
    });
    return () => sub.remove();
  }, [liveResolve, cancelLiveResolve, navigation]);

  const playMedia = useCallback(
    async (media: RoomMedia) => {
      if (media.type === 'link') {
        const url = media.url || media.title;
        if (url) Linking.openURL(url).catch(() => showToast(t('这个链接无法直接打开。')));
        return;
      }
      if (playingMedia?.url && playingMedia.url === media.url) {
        setPlayingMedia(null);
        return;
      }
      const next = media;
      try {
        if (media.type === 'live' || media.liveId) {
          if (media.url) {
            const isVod = roomTapIsVod(media);
            setRoomPlayer({
              ...media,
              isLive: !isVod,
              needsVlc: media.needsVlc || streamNeedsProxy(media.url),
            });
            setRoomPlayerFullscreen(false);
            return;
          }
          if (!media.liveId) {
            showToast(t('无法解析直播地址，请重试'));
            return;
          }

          resolveLiveAndOpen(media);
          return;
        }
        if (next.type === 'video' || next.type === 'audio') {
          setRoomPlayer({
            ...next,
            isLive: false,
            needsVlc: streamNeedsProxy(next.url),
          });
          setRoomPlayerFullscreen(false);
          return;
        }
        setPlayingMedia(next);
      } catch (error) {
        showDialog(t('播放失败'), errorMessage(error));
      }
    },
    [playingMedia, showToast, t, resolveLiveAndOpen],
  );

  const openRoomRankPanel = useCallback(async () => {
    if (!roomPlayer?.liveId) {
      setRankRows([]);
      setRankLoading(false);
      setRankStatus(t('该直播来源暂不支持贡献榜（如快捷开播/分享卡）'));
      setRankVisible(true);
      return;
    }
    setRankVisible(true);
    setRankStatus('');
    setRankRows([]);
    setRankLoading(true);
    try {
      const res = await pocketApi.getLiveRank(String(roomPlayer.liveId));
      const rows = normalizeLiveRank(res);
      setRankRows(rows);
      setRankStatus(
        rows.length ? t('已加载 {count} 位贡献用户', { count: rows.length }) : t('贡献榜为空'),
      );
    } catch (error) {
      setRankRows([]);
      setRankStatus(t('贡献榜加载失败：{msg}', { msg: errorMessage(error) }));
    } finally {
      setRankLoading(false);
    }
  }, [roomPlayer, t]);

  const downloadMedia = useCallback(
    async (media: RoomMedia) => {
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
          type:
            next.type === 'live'
              ? 'replay'
              : next.type === 'audio'
                ? 'voice'
                : next.type === 'image'
                  ? 'image'
                  : next.type === 'video'
                    ? 'video'
                    : 'file',
          name: next.title,
        });
        showToast(t('已加入下载管理'));
      } catch (error) {
        showToast(t('下载失败：{msg}', { msg: errorMessage(error) }));
      }
    },
    [showToast, t],
  );

  const liveMemberMap = useMemo(() => {
    const map = new Map<string, Member>();
    followed.forEach((item) => {
      const matched = memberLookupMap.get(String(item.memberId || '').trim());
      if (matched) map.set(item.memberId, matched);
    });
    return map;
  }, [followed, memberLookupMap]);

  const liveOrMicCount = useMemo(
    () =>
      followed.filter((item) => {
        const m = liveMemberMap.get(item.memberId) || item.member;
        if (m && !isRoomMember(m)) return false;
        return resolveFollowedLiveFlags(m, item.memberId, effectiveLiveNow, onMicMap, voiceRooms)
          .isActiveLive;
      }).length,
    [followed, liveMemberMap, effectiveLiveNow, onMicMap, voiceRooms],
  );

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let list = followed.filter((item) => {
      const m = liveMemberMap.get(item.memberId) || item.member;
      return !m || isRoomMember(m);
    });
    const pinnedIds = new Set(pinned);
    if (q) {
      list = list.filter((item) => {
        const member = liveMemberMap.get(item.memberId) || item.member;
        if (!member) return false;
        return memberSearchText(member).includes(q);
      });
    } else if (roomFilter === 'pinned') {
      list = list.filter((item) => pinnedIds.has(item.memberId));
    } else if (roomFilter === 'live') {
      list = list.filter((item) => {
        const m = liveMemberMap.get(item.memberId) || item.member;
        return resolveFollowedLiveFlags(m, item.memberId, effectiveLiveNow, onMicMap, voiceRooms)
          .isActiveLive;
      });
    }

    const pinRank = new Map<string, number>();
    pinned.forEach((id, idx) => pinRank.set(id, idx));
    return [...list].sort((a, b) => {
      const pa = pinRank.get(a.memberId) ?? Number.MAX_SAFE_INTEGER;
      const pb = pinRank.get(b.memberId) ?? Number.MAX_SAFE_INTEGER;
      if (pa !== pb) return pa - pb;
      return 0;
    });
  }, [
    followed,
    liveMemberMap,
    searchQuery,
    pinned,
    roomFilter,
    effectiveLiveNow,
    onMicMap,
    voiceRooms,
  ]);

  const roomsHeaderLeft = useMemo(
    () => (
      <GlassSegmented
        role="bar"
        options={[
          { key: 'all', label: t('全部') },
          { key: 'pinned', label: t('置顶') },
          { key: 'live', label: t('在播'), dot: liveOrMicCount > 0 },
        ]}
        value={roomFilter}
        onChange={(k) => startTransition(() => setRoomFilter(k as RoomListFilter))}
        height={FLOATING_BAR_HEIGHT}
        labelFontSize={13}
        frostedOnly={!!selectedRoom && !roomClosing}
        style={styles.headerSeg}
      />
    ),
    [liveOrMicCount, roomClosing, roomFilter, selectedRoom, t],
  );

  const roomsHeaderRight = useMemo(
    () => (
      <>
        <FloatingHeaderAction
          icon={memberBrowseOpen ? 'close' : 'account-plus-outline'}
          active={memberBrowseOpen}
          accessibilityLabel={memberBrowseOpen ? t('关闭') : t('全部成员')}
          onPress={() => {
            if (memberBrowseOpen) {
              Keyboard.dismiss();
              startTransition(() => {
                setMemberBrowseOpen(false);
                setSearchOpen(false);
                setSearchQuery('');
              });
            } else {
              startTransition(() => {
                setSearchQuery('');
                setSearchOpen(true);
                setMemberBrowseOpen(true);
              });
            }
          }}
        />
        <FloatingHeaderAction
          icon={searchOpen && !memberBrowseOpen ? 'close' : 'magnify'}
          active={searchOpen && !memberBrowseOpen}
          accessibilityLabel={searchOpen && !memberBrowseOpen ? t('关闭搜索') : t('搜索')}
          onPress={() => {
            if (searchOpen) {
              Keyboard.dismiss();
              startTransition(() => {
                setSearchOpen(false);
                setMemberBrowseOpen(false);
                setSearchQuery('');
              });
            } else {
              startTransition(() => {
                setMemberBrowseOpen(false);
                setSearchOpen(true);
              });
            }
          }}
        />
        <FloatingHeaderAction
          icon="refresh"
          accessibilityLabel={t('刷新')}
          onPress={() => {
            smallRoomProbedRef.current.clear();
            loadFollowed();
          }}
        />
      </>
    ),
    [loadFollowed, memberBrowseOpen, searchOpen, t],
  );

  const sortedRoomMembers = useMemo(() => {
    if (!searchOpen && !memberBrowseOpen && !searchQuery.trim()) return EMPTY_MEMBERS;
    return members
      .filter(isRoomMember)
      .sort((a, b) =>
        ZH_COLLATOR
          ? ZH_COLLATOR.compare(shortName(a, ''), shortName(b, ''))
          : shortName(a, '').localeCompare(shortName(b, ''), 'zh-CN'),
      );
  }, [members, searchOpen, memberBrowseOpen, searchQuery]);

  const memberHits = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q && !memberBrowseOpen) return [];
    const followedArr: Member[] = [];
    const otherArr: Member[] = [];
    for (const m of sortedRoomMembers) {
      if (q && !memberSearchText(m).includes(q)) continue;
      if (followedIds.has(String(m.id || m.userId || ''))) {
        followedArr.push(m);
      } else {
        otherArr.push(m);
      }
      if (q && followedArr.length >= 30) break;
    }
    const ordered = [...followedArr, ...otherArr];
    return q ? ordered.slice(0, 30) : ordered;
  }, [sortedRoomMembers, searchQuery, followedIds, memberBrowseOpen]);

  const roomsExtraData = useMemo(
    () => ({ showRoomListTime, roomTimeCacheVer, followedIds, followBusy }),
    [showRoomListTime, roomTimeCacheVer, followedIds, followBusy],
  );

  const filteredRoomMessages = useMemo(() => {
    const clean = roomMessages.filter(
      (item) =>
        Boolean(item) &&
        !isHiddenControlMessage(item) &&
        !matchesDeletedMessageId(item, deletedRoomMsgIdsRef.current),
    );
    if (!selectedRoom) return clean;

    const base = showFanMessages
      ? clean
      : clean.filter(
          (item) => messageRole(item, selectedRoom, false, currentUserId, memberIdSet) !== 'fan',
        );
    const q = debouncedRoomSearch.trim().toLowerCase();
    if (!q) return base;
    const roomMetaLower = buildRoomMetaSearchHaystack(selectedRoom);
    if (roomMetaLower.includes(q)) return base;
    return base.filter((item) => getRoomMessageSearchHaystack(item, selectedRoom).includes(q));
  }, [
    roomMessages,
    debouncedRoomSearch,
    selectedRoom,
    showFanMessages,
    currentUserId,
    memberIdSet,
  ]);

  const roomGalleryUrls = useMemo(() => {
    const urls: string[] = [];
    const seen = new Set<string>();
    const stickerTitle = t('表情');
    for (let i = filteredRoomMessages.length - 1; i >= 0; i -= 1) {
      const msgItem = filteredRoomMessages[i];
      if (!msgItem) continue;
      const m = roomMedia(msgItem);
      if (m?.type === 'image' && m.url && m.title !== stickerTitle && !seen.has(m.url)) {
        seen.add(m.url);
        urls.push(m.url);
      }
    }
    return urls;
  }, [filteredRoomMessages, t]);

  const roomGalleryUrlsRef = useRef<string[]>([]);
  roomGalleryUrlsRef.current = roomGalleryUrls;

  const openRoomImagePreview = useCallback((url: string) => {
    if (!url) return;
    const list = roomGalleryUrlsRef.current;
    const idx = list.indexOf(url);
    if (idx >= 0) {
      setImagePreview({ url, images: list, index: idx });
    } else {
      setImagePreview({ url, images: [url], index: 0 });
    }
  }, []);

  const imagePreviewRef = useRef<{ url: string; images?: string[]; index?: number } | null>(null);
  imagePreviewRef.current = imagePreview;

  const handleCloseImagePreview = useCallback(() => {
    setImagePreview(null);
  }, []);

  const handleDownloadPreviewImage = useCallback(
    async (activeUrl?: string) => {
      const target = activeUrl || imagePreviewRef.current?.url;
      if (!target) return;
      try {
        await enqueueDownload({
          url: target,
          type: 'image',
          name: `image-${Date.now()}.jpg`,
        });
        showToast(t('下载完成'));
      } catch (err) {
        showToast(errorMessage(err));
        throw err;
      }
    },
    [showToast, t],
  );

  const handleSharePreviewImage = useCallback(
    (activeUrl?: string) => {
      const target = activeUrl || imagePreviewRef.current?.url;
      if (!target) return;
      void shareRemoteImage(target).catch(() => showToast(t('分享失败')));
    },
    [showToast, t],
  );

  const essenceGalleryUrls = useMemo(() => {
    const urls: string[] = [];
    const seen = new Set<string>();
    const stickerTitle = t('表情');
    for (let i = 0; i < roomEssences.length; i += 1) {
      const msgItem = roomEssences[i];
      if (!msgItem) continue;
      const m = roomMedia(msgItem);
      if (m?.type === 'image' && m.url && m.title !== stickerTitle && !seen.has(m.url)) {
        seen.add(m.url);
        urls.push(m.url);
      }
    }
    return urls;
  }, [roomEssences, t]);

  const openEssenceImagePreview = useCallback(
    (url: string) => {
      if (!url) return;
      const idx = essenceGalleryUrls.indexOf(url);
      if (idx >= 0) {
        setImagePreview({ url, images: essenceGalleryUrls, index: idx });
      } else {
        setImagePreview({ url, images: [url], index: 0 });
      }
    },
    [essenceGalleryUrls],
  );

  const chatRows = useMemo(() => {
    if (!selectedRoom) return [];
    const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
    const fmt = (ms: number) => {
      const d = new Date(ms);
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    };
    const now = new Date();
    const todayStr = fmt(now.getTime());
    const yestStr = fmt(now.getTime() - 86400000);
    const rows: ChatRow[] = [];
    let lastDay = '';
    filteredRoomMessages.filter(Boolean).forEach((item, index) => {
      const day = fmt(getMessageTime(item));
      if (day !== lastDay) {
        lastDay = day;
        const label =
          day === todayStr
            ? t('今天')
            : day === yestStr
              ? t('昨天')
              : `${Number(day.slice(5, 7))}月${Number(day.slice(8, 10))}日`;
        rows.push({ type: 'date', key: `d-${day}`, label });
      }

      rows.push({ type: 'msg', key: messageKey(item), item, index, groupStart: true });
    });
    return rows;
  }, [filteredRoomMessages, selectedRoom, t]);

  const renderDayLabel = useCallback(
    ({
      date,
      createdAt,
    }: {
      date?: Date | number | string;
      createdAt?: Date | number | string;
    }) => {
      const d = new Date(createdAt ?? date ?? 0);
      if (Number.isNaN(d.getTime())) return null;
      const p2 = (n: number) => (n < 10 ? `0${n}` : String(n));
      const dayStr = `${d.getFullYear()}/${p2(d.getMonth() + 1)}/${p2(d.getDate())}`;
      const now = new Date();
      const todayStr = `${now.getFullYear()}/${p2(now.getMonth() + 1)}/${p2(now.getDate())}`;
      const yest = new Date(now.getTime() - 86400000);
      const yestStr = `${yest.getFullYear()}/${p2(yest.getMonth() + 1)}/${p2(yest.getDate())}`;
      const label =
        dayStr === todayStr
          ? '今天'
          : dayStr === yestStr
            ? '昨天'
            : `${d.getMonth() + 1}月${d.getDate()}日`;

      return <Text style={[styles.daySepText, { color: palette.labelSecondary }]}>{label}</Text>;
    },
    [palette],
  );

  const roomImsCacheRef = useRef<Map<string, { sig: string; im: RoomChatIM }>>(new Map());

  const chatIms = useMemo(() => {
    if (!selectedRoom) return [];
    const cache = roomImsCacheRef.current;
    const nextCache = new Map<string, { sig: string; im: RoomChatIM }>();
    const result = chatRows
      .filter((row) => row.type === 'msg' && row.item)
      .map((row) => {
        const item = row.item as RoomMessageWire;
        const room = selectedRoom as Member;
        const role = messageRole(item, room, showFanMessages, currentUserId, memberIdSet);
        const mine = role === 'mine';
        const sec = Number(item?.msgTime || item?.ctime || item?.timestamp || 0);
        const ms = sec > 1e12 ? sec : sec * 1000;
        const senderId = String(
          item?.user?.userId ||
            item?.user?.id ||
            item?.senderUserId ||
            item?.senderId ||
            item?.fromUserId ||
            item?.userId ||
            senderProfile(item, room)?.id ||
            (mine ? currentUserId : 'peer'),
        );
        const prof = senderProfile(item, room);
        const text = messageText(item) || '';
        const avatar = mine ? '' : String(prof?.avatar || room?.avatar || '');
        const name = mine ? '' : String(prof?.name || '');
        const key = String(row.key);
        const sig = `${text}\u0001${senderId}\u0001${ms}\u0001${avatar}\u0001${name}\u0001${mine ? 1 : 0}\u0001${row.groupStart ? 1 : 0}`;
        const hit = cache.get(key);
        if (hit && hit.sig === sig) {
          nextCache.set(key, hit);
          return hit.im;
        }
        const im = {
          _id: key,

          __row: row,
          text,
          createdAt: new Date(ms),
          user: {
            _id: mine ? 'SELF' : senderId,
            ...(mine ? {} : { avatar, name }),
          },
        };
        nextCache.set(key, { sig, im });
        return im;
      });
    roomImsCacheRef.current = nextCache;
    return result;
  }, [chatRows, selectedRoom, showFanMessages, currentUserId, memberIdSet]);

  roomLatestImsRef.current = chatIms;

  const handleRoomListScroll = useCallback((event: RoomChatListScrollEvent) => {
    const src: any = 'nativeEvent' in event && event.nativeEvent ? event.nativeEvent : event;
    const y = Number(src?.contentOffset?.y) || 0;
    const contentH = Number(src?.contentSize?.height) || 0;
    const layoutH = Number(src?.layoutMeasurement?.height) || 0;
    const nearBottom = y <= ROOM_AT_BOTTOM_OFFSET;
    if (nearBottom !== roomAtBottomRef.current) {
      roomAtBottomRef.current = nearBottom;
      setRoomAtBottom(nearBottom);
    }
    if (!debouncedRoomSearchRef.current && activeChannelRef.current) {
      scrollPosCache.current[activeChannelRef.current] = y;
    }
    if (
      shouldAutoLoadMoreOnScroll({
        offsetY: y,
        contentHeight: contentH,
        layoutHeight: layoutH,
        hasMore: hasMoreMessagesRef.current,
        loading: loadingRef.current,
        loadingMore: loadingMoreMessagesRef.current,
        pausedAtSearchLimit: Boolean(
          debouncedRoomSearchRef.current && searchPausedByUserRef.current,
        ),
      }) &&
      Date.now() - lastLoadMoreAtRef.current >= ROOM_LOAD_MORE_COOLDOWN_MS
    ) {
      void loadMoreRoomMessagesRef.current();
    }
  }, []);

  const roomJumpOut = useCallback(() => {
    roomAtBottomRef.current = true;
    setRoomAtBottom(true);
    setRoomFreezeKey(null);
    try {
      roomListRef.current?.scrollToOffset?.({ offset: 0, animated: true });
    } catch {}
  }, []);

  const loadEarlierWrapperStyle = useMemo(
    () => ({
      backgroundColor: palette.fill2,
      borderColor: palette.hairline,
      borderWidth: StyleSheet.hairlineWidth,
    }),
    [palette],
  );
  const loadEarlierTextStyle = useMemo(
    () => ({
      color: palette.labelSecondary,
      fontFamily: fontFamily.system,
      fontWeight: '600' as const,
    }),
    [palette],
  );

  const roomLoadEarlierProps = useMemo(
    () => ({
      isAvailable: hasMoreMessages,
      onPress: loadMoreRoomMessages,
      isLoading: loadingMoreMessages,
      label: debouncedRoomSearch ? t('继续搜更早消息') : t('上滑加载更多'),
      activityIndicatorColor: palette.tint,
      wrapperStyle: loadEarlierWrapperStyle,
      textStyle: loadEarlierTextStyle,
      isInfiniteScrollEnabled: true,
    }),
    [
      hasMoreMessages,
      loadMoreRoomMessages,
      loadingMoreMessages,
      debouncedRoomSearch,
      t,
      palette.tint,
      loadEarlierWrapperStyle,
      loadEarlierTextStyle,
    ],
  );

  const roomChatListProps = useMemo(
    () => ({
      style: { flex: 1, backgroundColor: 'transparent' },

      contentContainerStyle: ROOM_CHAT_LIST_CONTENT_STYLE,

      scrollEventThrottle: 80,
      onEndReachedThreshold: 0.55,
      onScroll: handleRoomListScroll,

      onScrollEndDrag: handleRoomListScroll,
      onMomentumScrollEnd: handleRoomListScroll,

      keyboardDismissMode: 'on-drag' as const,
      keyboardShouldPersistTaps: 'handled' as const,
      initialNumToRender: 10,
      maxToRenderPerBatch: 8,
      updateCellsBatchingPeriod: 40,
      windowSize: 9,
    }),
    [handleRoomListScroll],
  );

  useEffect(() => {
    if (roomAtBottom || debouncedRoomSearch) {
      setRoomFreezeKey(null);
    } else {
      setRoomFreezeKey((prev) => prev ?? roomLatestImsRef.current[0]?._id ?? null);
    }
  }, [roomAtBottom, debouncedRoomSearch]);

  const roomListImsRef = useRef<RoomChatIM[]>([]);
  const { list: roomListIms, pending: roomPendingCount } = useMemo(() => {
    const sliced = splitByFreezeAnchor(chatIms, roomFreezeKey);

    const prev = roomListImsRef.current;
    const same = prev.length === sliced.list.length && sliced.list.every((m, i) => m === prev[i]);
    const list = same ? prev : sliced.list;
    roomListImsRef.current = list;
    return { list, pending: sliced.pending };
  }, [chatIms, roomFreezeKey]);

  const playRoomRadioInline = useCallback(async () => {
    const room = selectedRoom;
    if (!room) return;
    const key = String(room.id || room.userId || '');
    const entry = useOnMicStore.getState().onMic[key];
    const preferredMode: 'big' | 'small' =
      entry?.smallVoice && !entry?.bigVoice
        ? 'small'
        : entry?.bigVoice && !entry?.smallVoice
          ? 'big'
          : roomMode;
    let resolvedMode: 'big' | 'small' = preferredMode;
    let url = '';
    const entryModeMatches =
      preferredMode === 'small'
        ? Boolean(entry?.smallVoice)
        : Boolean(entry?.bigVoice ?? !entry?.smallVoice);
    if (isOnMicStreamFresh(entry) && entryModeMatches && entry?.streamUrl) {
      url = String(entry.streamUrl);
    }
    if (!url) {
      try {
        const res = await fetchMemberRadioStream(room as Member, preferredMode, {
          allowFallbackMode: true,
        });
        url = res.url || '';
        resolvedMode = res.mode;
      } catch {
        url = '';
      }
    }
    if (!url) {
      showToast(t('该房间当前没有开启语音电台'));
      return;
    }

    const title = `${shortName(room, key)} · ${t('上麦')}`;
    useMiniPlayerStore.getState().open({
      url,
      title,
      cover: room.avatar,
      isLive: true,
      audioOnly: true,
      radioRefresh: { member: room as Member, mode: resolvedMode },
      backTo: {
        screen: 'RoomRadioScreen',
        mode: 'live',
        playUrl: url,
        playTitle: title,
        playCover: room.avatar,
        radioMember: room as Member,
        radioMode: resolvedMode,
      },
    });
  }, [roomMode, selectedRoom, showToast, t]);

  const openSenderProfile = useCallback(
    (opts: {
      id: string;
      name: string;
      avatar: string;
      member?: Member | null;
      userIds?: string[];
      missingIdMessage?: string;
    }) => {
      const m = opts.member || null;

      const candidates = Array.from(
        new Set(
          [...(opts.userIds || []), m ? String(m.userId || '') : '', m?.id, opts.id]
            .map((v) => String(v ?? '').trim())
            .filter((v) => /^\d+$/.test(v) && v !== '0'),
        ),
      );
      const cardId = candidates[0] || String(opts.id || '').trim();
      const seq = ++userCardSeqRef.current;
      const apply = (patch: Partial<NonNullable<typeof userCard>>) =>
        setUserCard((c) => (c && userCardSeqRef.current === seq ? { ...c, ...patch } : c));
      setUserCard({
        id: cardId,
        name: opts.name || m?.ownerName || '',
        avatar: opts.avatar || m?.avatar || '',
        loading: candidates.length > 0,
        error: '',
        following: false,
        mutual: false,
        followBusy: false,
        isMember: !!m,
        memberDbId: m ? String(m.id || '') : '',
        frameUrl: '',
        detail: {
          name: '',
          avatar: '',
          level: '',
          signature: '',
          team: m ? String(m.groupName || m.team || '') : '',
          period: '',
          isStar: !!m,
        },
      });
      if (!candidates.length) {
        apply({
          loading: false,
          error: opts.missingIdMessage || t('该用户没有可加载的口袋48资料'),
        });
        return;
      }

      void (async () => {
        for (const id of candidates) {
          try {
            const res = await pocketApi.getUserProfile(id);
            if (userCardSeqRef.current !== seq) return;
            const detail = userCardFromUserRes(res);

            setUserCard((c) =>
              c && userCardSeqRef.current === seq
                ? {
                    ...c,
                    id,
                    loading: false,
                    error: '',
                    following: detail.following,
                    mutual: detail.mutual,
                    detail: { ...c.detail, ...detail },
                  }
                : c,
            );

            pocketApi
              .getUserHomeInfo(id)
              .then((home: unknown) => {
                if (userCardSeqRef.current !== seq) return;
                const frame = findFrameUrl(home);
                if (frame) apply({ frameUrl: frame });
              })
              .catch(() => {});
            return;
          } catch {}
        }
        if (userCardSeqRef.current !== seq) return;
        apply({ loading: false, error: t('未获取到更多资料') });
      })();
    },
    [t],
  );

  const toggleFollowUser = useCallback(
    async (card: { id: string; following: boolean }) => {
      const id = String(card?.id || '').trim();
      if (!/^\d+$/.test(id)) {
        showToast(t('该用户不支持关注'));
        return;
      }
      const next = !card.following;
      setUserCard((c) => (c && c.id === id ? { ...c, followBusy: true } : c));
      try {
        if (next) await pocketApi.followMember(id);
        else await pocketApi.unfollowMember(id);
        setUserCard((c) =>
          c && c.id === id
            ? { ...c, following: next, mutual: next ? c.mutual : false, followBusy: false }
            : c,
        );
        mutateFollowedIdShared(token, id, next);
        showToast(next ? t('已关注') : t('已取消关注'));
      } catch (err) {
        setUserCard((c) => (c && c.id === id ? { ...c, followBusy: false } : c));
        showToast(t('操作失败：{msg}', { msg: errorMessage(err) }));
      }
    },
    [showToast, t, token],
  );

  const openUserPrivateMessage = useCallback(
    (card: { id: string; name: string }) => {
      const id = String(card?.id || '').trim();
      if (!id) return;
      setUserCard(null);
      navigation.navigate('PrivateMessagesScreen', {
        targetUserId: id,
        targetName: card.name || '',
      });
    },
    [navigation],
  );

  const [roomMenu, setRoomMenu] = useState<FollowedRoom | null>(null);
  const closeRoomMenu = useCallback(() => setRoomMenu(null), []);
  const roomMenuActions = useMemo(() => {
    const item = roomMenu;
    if (!item)
      return [] as {
        key: string;
        icon: string;
        label: string;
        danger?: boolean;
        onPress: () => void;
      }[];
    const member = item.member;
    const isPinned = pinned.includes(item.memberId);
    const pIdx = pinned.indexOf(item.memberId);
    const fid = String(member?.id || item.memberId);
    const isFollowing = followedIds.has(fid);
    const run = (fn: () => void) => () => {
      setRoomMenu(null);
      fn();
    };
    const rows: {
      key: string;
      icon: string;
      label: string;
      danger?: boolean;
      onPress: () => void;
    }[] = [
      {
        key: 'big',
        icon: 'home-city-outline',
        label: t('进入大房间'),
        onPress: run(() => member && openRoom(member, 'big', showFanMessages)),
      },
      {
        key: 'small',
        icon: 'home-outline',
        label: t('进入小房间'),
        onPress: run(() => member && openRoom(member, 'small', showFanMessages)),
      },
      {
        key: 'pin',
        icon: isPinned ? 'pin-off-outline' : 'pin-outline',
        label: isPinned ? t('取消置顶') : t('置顶'),
        onPress: run(() => togglePin(item.memberId)),
      },
    ];
    if (isPinned && pIdx > 0)
      rows.push({
        key: 'up',
        icon: 'arrow-up',
        label: t('置顶上移'),
        onPress: run(() => movePin(item.memberId, -1)),
      });
    if (isPinned && pIdx >= 0 && pIdx < pinned.length - 1)
      rows.push({
        key: 'down',
        icon: 'arrow-down',
        label: t('置顶下移'),
        onPress: run(() => movePin(item.memberId, 1)),
      });
    rows.push({
      key: 'follow',
      icon: isFollowing ? 'account-remove-outline' : 'account-plus-outline',
      label: isFollowing ? t('取消关注') : t('关注'),
      danger: isFollowing,
      onPress: run(() => member && toggleFollow(member)),
    });
    return rows;
  }, [
    roomMenu,
    pinned,
    followedIds,
    openRoom,
    showFanMessages,
    t,
    togglePin,
    movePin,
    toggleFollow,
  ]);

  const confirmDeleteMessage = useCallback(
    (item: RoomMessageWire) => {
      const msgIdClient = String(item?.msgIdClient || item?.uuid || item?.msgId || '');
      const msgTime = getMessageTime(item);
      const channelId = Number(item?.channelId || activeChannelRef.current || 0);
      if (!msgIdClient || !msgTime || !channelId) {
        showToast(t('该消息不支持撤回'));
        return;
      }
      const targetIds = [messageKey(item), ...collectRoomMessageIds(item)].filter(Boolean);
      const targetSet = new Set(targetIds);
      showDialog(t('删除消息'), t('撤回并删除这条你发送的消息？'), [
        { text: t('取消'), style: 'cancel' },
        {
          text: t('删除'),
          style: 'destructive',
          onPress: () => {
            deleteRoomMessage({ channelId, msgIdClient, msgTime })
              .then(() => {
                rememberDeletedMsgIds(targetIds);
                const cacheKey = activeChannelRef.current
                  ? `${activeChannelRef.current}_${showFanMessagesRef.current ? 'all' : 'idol'}`
                  : '';
                setRoomMessages((prev) => {
                  const next = prev.filter((m) => !matchesDeletedMessageId(m, targetSet));
                  roomMessagesRef.current = next;
                  if (cacheKey) {
                    roomMessagesCache.current[cacheKey] = {
                      messages: next,
                      nextTime: roomNextTimeRef.current,
                      hasMore: hasMoreMessagesRef.current,
                    };
                  }
                  return next;
                });
                showToast(t('已删除'));
              })
              .catch((err) => showToast(errorMessage(err)));
          },
        },
      ]);
    },
    [rememberDeletedMsgIds, showToast, t],
  );

  const openMessageActions = useCallback(
    (item: RoomMessageWire, mine: boolean, senderName: string, media?: RoomMedia | null) => {
      const text = humanizeRawMessageText(String(messageText(item) || '').trim());
      const replyMessageId = String(item?.msgIdClient || item?.uuid || item?.msgId || '');
      const isMedia = !!media;
      if (!isMedia && !text) {
        showToast(t('该消息暂不支持操作'));
        return;
      }
      setMsgMenu({ item, mine, name: senderName, text, media: media || null });

      msgReplyRef.current = { replyMessageId, senderName, text };
    },
    [showToast, t],
  );

  const msgMenuReply = useCallback(() => {
    const meta = msgReplyRef.current;
    setMsgMenu(null);
    if (!meta) return;
    setReplyTarget({
      replyMessageId: meta.replyMessageId,
      replyName: meta.senderName,
      replyText: meta.text || t('媒体消息'),
    });
  }, [t]);

  const msgMenuCopy = useCallback(() => {
    const cur = msgMenu;
    setMsgMenu(null);
    const text = cur?.text || '';
    if (!text) return;
    try {
      Clipboard.setString(text);
      showToast(t('已复制'));
    } catch {
      showToast(t('复制失败'));
    }
  }, [msgMenu, showToast, t]);

  const renderChatMessage = useCallback(
    ({ currentMessage }: { currentMessage?: { __row?: ChatRow } }) => {
      const row = currentMessage?.__row;
      const item = row?.item;
      if (!row || !item || !selectedRoom) return <View />;
      const media = roomMedia(item);
      const hideVideoCard = Boolean(
        media?.type === 'video' &&
        media.url &&
        (roomPlayerFullscreen || roomPlayer?.url === media.url || playingMedia?.url === media.url),
      );
      const isMediaPlaying = Boolean(
        playingMedia?.url && media?.url && playingMedia.url === media.url,
      );
      return (
        <RoomChatRow
          row={row}
          room={selectedRoom}
          showFanMessages={showFanMessages}
          currentUserId={currentUserId}
          memberIdSet={memberIdSet}
          token={token || ''}
          palette={palette}
          hideVideoCard={hideVideoCard}
          isMediaPlaying={isMediaPlaying}
          highlightQuery={debouncedRoomSearch}
          memberLookupRef={memberLookupRef}
          t={t}
          onOpenProfile={openSenderProfile}
          onOpenActions={openMessageActions}
          onPlayMedia={playMedia}
          onPreviewImage={openRoomImagePreview}
        />
      );
    },
    [
      selectedRoom,
      showFanMessages,
      currentUserId,
      memberIdSet,
      token,
      palette,
      roomPlayerFullscreen,
      roomPlayer?.url,
      playingMedia?.url,
      debouncedRoomSearch,
      t,
      openSenderProfile,
      openMessageActions,
      playMedia,
      openRoomImagePreview,
    ],
  );

  const openRoomRef = useRef(openRoom);
  openRoomRef.current = openRoom;
  const toggleFollowRef = useRef(toggleFollow);
  toggleFollowRef.current = toggleFollow;

  const handleListOpenRoom = useCallback((member: Member, mode?: RoomMode) => {
    void openRoomRef.current(member, mode);
  }, []);

  const roomModeOptions = useMemo(
    () => [
      { key: 'big', label: t('大房间') },
      { key: 'small', label: t('小房间') },
    ],
    [t],
  );

  const handleRoomModeChange = useCallback((modeKey: string) => {
    const room = selectedRoomRef.current;
    if (!room) return;
    void openRoomRef.current(
      room,
      modeKey as 'big' | 'small',
      showFanMessagesRef.current,
      'internal',
    );
  }, []);

  const handleListOpenMenu = useCallback((item: FollowedRoom) => {
    setRoomMenu(item);
  }, []);

  const handleListFollowPress = useCallback(
    (member: Member, memberId: string, isFollowing: boolean) => {
      if (isFollowing) {
        showDialog(
          t('取消关注'),
          t('确定不再关注 {name} 吗？', {
            name: shortName(member, memberId),
          }),
          [
            { text: t('保留'), style: 'cancel' },
            {
              text: t('取消关注'),
              style: 'destructive',
              onPress: () => void toggleFollowRef.current(member),
            },
          ],
        );
      } else {
        void toggleFollowRef.current(member);
      }
    },
    [t],
  );

  const roomsKeyExtractor = useCallback((item: FollowedRoom) => String(item.memberId), []);

  const renderRoomsListItem = useCallback(
    ({ item }: { item: FollowedRoom }) => {
      const activeMember = liveMemberMap.get(item.memberId) || item.member;
      const isPinned = pinned.includes(item.memberId);
      const name = shortName(activeMember, item.memberId);
      const { teamLogo, teamLabel } = resolveRoomMemberTeamLogo(activeMember);
      const lastText = item.lastMessage ? messagePreviewText(item.lastMessage) : '';
      const bigCid = String(activeMember?.channelId || '');
      const bigDirectMs = item.lastMessage ? getMessageTime(item.lastMessage) : 0;
      const bigResolvedMs = resolveRoomPreviewTimeMs(
        bigDirectMs,
        bigCid,
        lastText,
        roomTimeCacheRef.current,
      );
      const bigTime =
        showRoomListTime && item.lastMessage ? formatRoomPreviewTime(bigResolvedMs, t('昨天')) : '';
      const { isLiveNow, isOnMic, isVoiceRoom, isActiveLive } = resolveFollowedLiveFlags(
        activeMember,
        item.memberId,
        effectiveLiveNow,
        onMicMap,
        voiceRooms,
      );
      const ykid = String(activeMember?.yklzId || '');
      const sMsg = item.lastSmallMessage;
      const sText = sMsg ? messagePreviewText(sMsg) : '';
      const smallDirectMs = sMsg ? getMessageTime(sMsg) : 0;
      const smallResolvedMs = resolveRoomPreviewTimeMs(
        smallDirectMs,
        ykid,
        sText,
        roomTimeCacheRef.current,
      );
      const smallTime =
        showRoomListTime && sMsg ? formatRoomPreviewTime(smallResolvedMs, t('昨天')) : '';
      const followKey = String(activeMember?.id || activeMember?.userId || item.memberId);
      const isFollowing = followedIds.has(followKey);
      const followIsBusy = followBusy.has(followKey);
      const showSmallRow = !!ykid && ykid !== '0' && ykid !== 'undefined' && ykid !== bigCid;

      return (
        <FollowedRoomRowCard
          item={item}
          activeMember={activeMember}
          isPinned={isPinned}
          name={name}
          teamLogo={teamLogo}
          teamLabel={teamLabel}
          lastText={lastText}
          bigTime={bigTime}
          isLiveNow={isLiveNow}
          isOnMic={isOnMic}
          isVoiceRoom={isVoiceRoom}
          isActiveLive={isActiveLive}
          ykid={ykid}
          sText={sText}
          smallTime={smallTime}
          isFollowing={isFollowing}
          followIsBusy={followIsBusy}
          showSmallRow={showSmallRow}
          palette={palette}
          t={t}
          onOpenRoom={handleListOpenRoom}
          onOpenMenu={handleListOpenMenu}
          onFollowPress={handleListFollowPress}
        />
      );
    },
    [
      effectiveLiveNow,
      followBusy,
      followedIds,
      handleListFollowPress,
      handleListOpenMenu,
      handleListOpenRoom,
      liveMemberMap,
      onMicMap,
      palette,
      pinned,
      showRoomListTime,
      t,
      voiceRooms,
    ],
  );

  const roomsHeaderOffset = getFloatingHeaderOffset(insets.top);
  const roomsListContentStyle = useMemo(
    () => [
      styles.listContent,
      { paddingTop: searchOpen || memberBrowseOpen ? 2 : roomsHeaderOffset },
    ],
    [searchOpen, memberBrowseOpen, roomsHeaderOffset],
  );

  const roomOverlayNode = (() => {
    if (!selectedRoom) return null;
    const fid = String(selectedRoom.id || '');
    const isFollowingRoom = followedIds.has(fid);
    const followBusyRoom = followBusy.has(fid);

    const headerTitle = roomMeta.name
      ? capText(roomMeta.name, 18)
      : selectedRoom.ownerName
        ? capText(selectedRoom.ownerName, 18)
        : t('房间');
    const roomScrim = resolvedTheme === 'dark' ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.42)';
    const roomSolidBg = resolvedTheme === 'dark' ? '#0B0B0F' : '#ECEDF1';
    return (
      <Reanimated.View
        pointerEvents="auto"
        style={[
          StyleSheet.absoluteFill,
          styles.roomRoot,
          { backgroundColor: roomSolidBg },
          roomEnterStyle,
        ]}
      >
        {(bgBase || bgOverlay) && !roomPlayerFullscreen ? (
          <View pointerEvents="none" style={styles.roomBgLayer}>
            {bgBase ? (
              <Animated.View
                pointerEvents="none"
                style={[styles.roomBgLayer, { opacity: bgBaseOpacity }]}
              >
                <NetworkImage
                  key={bgBase.uri}
                  source={bgBase.source}
                  resizeMode="cover"
                  style={StyleSheet.absoluteFill}
                  fallback={false}
                  fadeDuration={0}
                  onLoad={() => onBgBaseLoad(bgBase.seq)}
                  onError={() => onBgBaseError(bgBase)}
                />
              </Animated.View>
            ) : null}
            {bgOverlay ? (
              <Animated.View
                pointerEvents="none"
                style={[styles.roomBgLayer, { opacity: bgOverlayOpacity }]}
              >
                <NetworkImage
                  key={bgOverlay.uri}
                  source={bgOverlay.source}
                  resizeMode="cover"
                  style={StyleSheet.absoluteFill}
                  fallback={false}
                  fadeDuration={0}
                  onLoad={() => onBgOverlayLoad(bgOverlay)}
                  onError={() => onBgOverlayError(bgOverlay)}
                />
              </Animated.View>
            ) : null}
            <View
              pointerEvents="none"
              style={[styles.roomBgLayer, { backgroundColor: roomScrim }]}
            />
          </View>
        ) : null}
        <View
          style={[
            styles.container,
            { paddingBottom: roomPlayer && !dual ? 0 : roomKeyboardHeight },
          ]}
        >
          <View style={{ flex: 1, flexDirection: dual ? 'row-reverse' : 'column' }}>
            {roomPlayer ? (
              <View
                style={
                  dual && !roomPlayerFullscreen
                    ? styles.roomPlayerPaneDual
                    : [styles.roomPlayerPage, { backgroundColor: '#000' }]
                }
              >
                {roomPlayer.isLive && roomAnnouncement && !playerCleanScreen ? (
                  roomAnnounceOpen ? (
                    <>
                      <Pressable
                        style={[StyleSheet.absoluteFillObject, { zIndex: 28 }]}
                        onPress={() => setRoomAnnounceOpen(false)}
                      />
                      <View
                        nativeID="yaya.pip.overlay"
                        collapsable={false}
                        style={[styles.roomAnnouncePanel, { top: insets.top + 56 }]}
                      >
                        <View style={styles.roomAnnounceHead}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                            <MaterialCommunityIcons name="bullhorn" size={13} color="#fff" />
                            <Text style={styles.roomAnnounceTitle}>{t('公告')}</Text>
                          </View>
                          <TouchableOpacity onPress={() => setRoomAnnounceOpen(false)}>
                            <Text style={styles.roomAnnounceClose}>{t('收起')}</Text>
                          </TouchableOpacity>
                        </View>
                        <ScrollView style={styles.roomAnnounceBody}>
                          <Text style={styles.roomAnnounceText}>{roomAnnouncement}</Text>
                        </ScrollView>
                      </View>
                    </>
                  ) : (
                    <TouchableOpacity
                      {...({ nativeID: 'yaya.pip.overlay', collapsable: false } as any)}
                      style={[styles.roomAnnounceBadge, { top: insets.top + 56 }]}
                      onPress={() => setRoomAnnounceOpen(true)}
                      activeOpacity={0.85}
                    >
                      <MaterialCommunityIcons name="bullhorn" size={14} color="#fff" />
                      <Text style={styles.roomAnnounceBadgeText}>{t('公告')}</Text>
                    </TouchableOpacity>
                  )
                ) : null}
                <PlayerScreen
                  source={{
                    kind: roomPlayer.isLive ? 'live' : 'vod',
                    url: roomPlayer.url,
                    urls: roomPlayer.urls,
                    liveId: roomPlayer.liveId,
                    needsNativeExo: roomPlayer.needsVlc,

                    audioOnly: roomPlayer.type === 'audio',
                    coverPortrait: roomPlayer.type !== 'audio',
                    headers: {
                      'User-Agent': USER_AGENT,
                      Referer: 'https://h5.48.cn/',
                      Origin: 'https://h5.48.cn',
                    },
                  }}
                  meta={{ title: roomPlayer.title, cover: roomPlayer.cover }}
                  pocket={
                    roomPlayer.type !== 'audio'
                      ? {
                          name:
                            roomBarrage.liveInfo.hostName ||
                            roomPlayer.title ||
                            selectedRoom?.ownerName ||
                            '',
                          avatar: normalizeUrl(roomBarrage.liveInfo.hostAvatar || ''),
                          liveId: roomPlayer.liveId,
                          audience: roomBarrage.liveInfo.audience,
                          rankAvatars: roomBarrage.liveInfo.rankAvatars,
                          comments: roomPlayer.isLive
                            ? roomBarrage.items
                                .slice()
                                .reverse()
                                .map((item) => ({
                                  id: item.id,
                                  text: item.text,
                                  nick: item.nick,
                                  level: item.level,
                                  kind: item.kind,
                                  userId: item.userId,
                                  avatar: item.avatar,
                                }))
                            : [],
                          replayComments: roomPlayer.isLive ? undefined : roomReplayDanmaku,
                          onRankPress: openRoomRankPanel,
                          onHostPress: () => {
                            const hostName =
                              roomBarrage.liveInfo.hostName ||
                              roomPlayer.title ||
                              selectedRoom?.ownerName ||
                              '';
                            const hostAvatar = normalizeUrl(
                              roomBarrage.liveInfo.hostAvatar || selectedRoom?.avatar || '',
                            );
                            const hostId = String(
                              roomBarrage.liveInfo.hostId ||
                                selectedRoom?.userId ||
                                selectedRoom?.id ||
                                '',
                            ).trim();
                            const matched = members.find((m) =>
                              [m.id, m.userId].some((v) => String(v ?? '').trim() === hostId),
                            );
                            openSenderProfile({
                              id: hostId,
                              name: hostName,
                              avatar: hostAvatar,
                              member: matched || selectedRoom,
                              userIds: [
                                roomBarrage.liveInfo.hostId || '',
                                String(selectedRoom?.userId || ''),
                                String(selectedRoom?.id || ''),
                              ].filter(Boolean),
                            });
                          },
                          onCommentPress: (item) =>
                            openSenderProfile({
                              id: String(item.userId || ''),
                              name: item.nick || '',
                              avatar: item.avatar || '',
                              missingIdMessage: roomPlayer.isLive
                                ? undefined
                                : t('录播弹幕未提供用户 ID，无法加载完整资料'),
                            }),
                        }
                      : undefined
                  }
                  onVideoSize={(w, h) => {
                    if (w > 0 && h > 0) roomVideoAspectRef.current = { w, h };
                  }}
                  danmaku={
                    roomPlayer.isLive
                      ? { type: 'poll', liveId: roomBarrageLiveId }
                      : { type: 'lrc', lrcUrl: '' }
                  }
                  features={{
                    rate: !roomPlayer.isLive,
                    danmaku: true,
                    kernelSwitch: true,
                    resume: !roomPlayer.isLive,
                  }}
                  chromeHidden={inRoomSystemPip}
                  extraActions={[
                    ...(roomPlayer.isLive
                      ? [
                          {
                            key: 'gift',
                            icon: 'gift',
                            label: t('礼物'),
                            onPress: () => openRoomGiftPanel(),
                          },
                        ]
                      : []),
                    { key: 'rank', icon: 'trophy', label: t('贡献榜'), onPress: openRoomRankPanel },
                    {
                      key: 'danmaku',
                      icon: 'cog',
                      label: t('弹幕设置'),
                      onPress: () => setShowRoomDanmakuSettings(true),
                    },
                    {
                      key: 'danmakuList',
                      icon: 'format-list-bulleted',
                      label: t('弹幕列表'),
                      active: showRoomDanmakuList,
                      onPress: () => setShowRoomDanmakuList((v) => !v),
                    },

                    ...(dual
                      ? []
                      : [
                          {
                            key: 'pip',
                            icon: 'picture-in-picture-bottom-right-outline',
                            label: t('小窗'),
                            onPress: handleRoomMiniPlayer,
                          },
                        ]),
                  ]}
                  barrageInput={
                    roomPlayer.isLive ? (
                      <LiveBarrageBoard
                        source={roomBarrage}
                        liveId={roomBarrageLiveId}
                        module="live"
                        inputOnly
                        variant="pocket"
                      />
                    ) : undefined
                  }
                  onClose={closeRoomPlayer}
                  liveTransitionKey={roomBarrage.streamRevision}
                  onRetry={
                    roomPlayer.isLive
                      ? () => {
                          const retryRoomLive = async (allowFollowup: boolean) => {
                            const current = roomPlayerRef.current;
                            if (!current?.liveId) {
                              usePlayerStore.getState().requestKernelRebuild();
                              return;
                            }
                            if (roomRetryFollowupRef.current) {
                              clearTimeout(roomRetryFollowupRef.current);
                              roomRetryFollowupRef.current = null;
                            }
                            const detail =
                              (await pocketApi.getLiveOne(current.liveId).catch(() => null)) ||
                              (await pocketApi.getOpenLiveOne(current.liveId).catch(() => null));
                            if (roomPlayerRef.current !== current) return;
                            const rawDetail = (detail?.content ||
                              detail?.data ||
                              detail ||
                              {}) as Record<string, any>;
                            const urls = pickPlayableUrls(detail, true).filter(isPlayableMediaUrl);
                            if (urls[0] && urls[0] !== current.url) {
                              setRoomPlayer({
                                ...current,
                                url: urls[0],
                                urls,
                                needsVlc: streamNeedsProxy(urls[0]),
                              });
                              return;
                            }
                            if (!urls.length && Number(rawDetail.status) === 2) {
                              useDiscoveredLivesStore
                                .getState()
                                .removeDiscoveredLive(current.liveId);
                              setRoomLiveEnded(true);
                              return;
                            }
                            usePlayerStore.getState().requestKernelRebuild();
                            if (allowFollowup) {
                              roomRetryFollowupRef.current = setTimeout(() => {
                                roomRetryFollowupRef.current = null;
                                if (roomPlayerRef.current === current) {
                                  void retryRoomLive(false);
                                }
                              }, 1800);
                            }
                          };
                          void retryRoomLive(true);
                        }
                      : undefined
                  }
                  persistent
                >
                  {showRoomDanmakuList ? (
                    <RoomPlayerDanmakuSheet
                      onClose={() => setShowRoomDanmakuList(false)}
                      entries={roomDanmakuEntries}
                      live={!!roomPlayer.isLive}
                      loading={
                        !!roomPlayer.isLive &&
                        (roomBarrage.status === 'connecting' || roomBarrage.status === 'resolving')
                      }
                      onOpenProfile={(entry) =>
                        openSenderProfile({
                          id: String(entry.userId || ''),
                          name: entry.nick || '',
                          avatar: entry.avatar || '',
                        })
                      }
                    />
                  ) : null}
                </PlayerScreen>

                {roomLiveEnded && !playerCleanScreen && !inRoomSystemPip ? (
                  <View style={styles.roomLiveEndedOverlay} pointerEvents="auto">
                    <View style={styles.roomLiveEndedCard}>
                      <MaterialCommunityIcons name="broadcast-off" size={34} color="#FFFFFF" />
                      <Text style={styles.roomLiveEndedTitle}>{t('直播已结束')}</Text>
                      <Text style={styles.roomLiveEndedSub} numberOfLines={2}>
                        {roomLiveSummary?.title || roomPlayer.title}
                      </Text>
                      {roomLiveSummary ? (
                        <View style={styles.roomLiveEndedSummary}>
                          <Text style={styles.roomLiveEndedMeta} numberOfLines={1}>
                            {[
                              roomLiveSummary.member,
                              roomLiveSummary.startTime,
                              roomLiveSummary.duration,
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </Text>
                          {roomLiveSummary.top.length ? (
                            <View style={styles.roomLiveEndedTop}>
                              <Text style={styles.roomLiveEndedTopTitle}>{t('贡献榜')}</Text>
                              {roomLiveSummary.top.map((row, index) => (
                                <Text
                                  key={`${row.name}-${index}`}
                                  style={styles.roomLiveEndedTopRow}
                                >
                                  {index + 1}. {row.name} {row.value}
                                </Text>
                              ))}
                            </View>
                          ) : null}
                        </View>
                      ) : null}
                      <TouchableOpacity
                        onPress={closeRoomPlayer}
                        activeOpacity={0.85}
                        style={[styles.roomLiveEndedBtn, { backgroundColor: palette.tint }]}
                      >
                        <Text style={styles.roomLiveEndedBtnText}>{t('返回')}</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : null}
                <DanmakuSettingsSheet
                  staticFeed
                  visible={showRoomDanmakuSettings}
                  onClose={() => setShowRoomDanmakuSettings(false)}
                />
              </View>
            ) : null}

            {rankVisible ? (
              <Modal
                visible
                transparent
                animationType="slide"
                statusBarTranslucent
                navigationBarTranslucent
                onRequestClose={() => setRankVisible(false)}
              >
                <View style={styles.roomModalShade}>
                  <Pressable
                    style={StyleSheet.absoluteFill}
                    onPress={() => setRankVisible(false)}
                  />
                  <View
                    style={[
                      styles.roomRankPanel,
                      {
                        backgroundColor: palette.surfaceElevated,
                        borderTopWidth: StyleSheet.hairlineWidth,
                        borderTopColor: palette.hairline,
                        paddingBottom: Math.max(18, insets.bottom + 12),
                      },
                    ]}
                  >
                    <View style={styles.roomRankHandleWrap}>
                      <View style={[styles.roomRankHandle, { backgroundColor: palette.fill3 }]} />
                    </View>
                    <View style={styles.roomRankHeader}>
                      <Text style={[styles.roomRankTitle, { color: palette.label }]}>
                        {t('贡献榜')}
                      </Text>
                      <ScalePressable
                        onPress={() => setRankVisible(false)}
                        pressedScale={0.92}
                        activeOpacity={0.8}
                        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                      >
                        <View style={[styles.roomRankClose, { backgroundColor: palette.fill2 }]}>
                          <MaterialCommunityIcons
                            name="close"
                            color={palette.labelSecondary}
                            size={18}
                          />
                        </View>
                      </ScalePressable>
                    </View>
                    <Text style={[styles.roomRankStatus, { color: palette.labelSecondary }]}>
                      {rankStatus}
                    </Text>
                    {rankLoading ? (
                      <View style={styles.roomRankLoading}>
                        <ActivityIndicator color={palette.tint} />
                        <Text style={[styles.roomRankStatus, { color: palette.labelSecondary }]}>
                          {t('加载中…')}
                        </Text>
                      </View>
                    ) : (
                      <ScrollView style={styles.roomRankList} showsVerticalScrollIndicator={false}>
                        {(() => {
                          const maxValue = rankRows.reduce(
                            (max, r) => Math.max(max, Number(r.value) || 0),
                            0,
                          );
                          return rankRows.map((row, index) => {
                            const valNum = Number(row.value) || 0;
                            const progress =
                              maxValue > 0 ? Math.max(0, Math.min(1, valNum / maxValue)) : 0;
                            return (
                              <View
                                key={String(row.userId || row.id || index)}
                                style={[
                                  styles.roomRankRow,
                                  { borderBottomColor: palette.hairline },
                                ]}
                              >
                                <Text style={[styles.roomRankNo, { color: palette.tint }]}>
                                  {row.rank || index + 1}
                                </Text>
                                {row.avatar ? (
                                  <NetworkImage
                                    source={{ uri: row.avatar }}
                                    style={[
                                      styles.roomRankAvatar,
                                      { backgroundColor: palette.fill3 },
                                    ]}
                                    thumbnail={180}
                                  />
                                ) : (
                                  <View
                                    style={[
                                      styles.roomRankAvatar,
                                      { backgroundColor: palette.fill3 },
                                    ]}
                                  />
                                )}
                                <View style={styles.roomRankInfo}>
                                  <Text
                                    style={[styles.roomRankName, { color: palette.label }]}
                                    numberOfLines={1}
                                  >
                                    {row.name}
                                  </Text>
                                  <View
                                    style={[
                                      styles.roomRankProgressTrack,
                                      { backgroundColor: palette.fill3 },
                                    ]}
                                  >
                                    <View
                                      style={[
                                        styles.roomRankProgressFill,
                                        {
                                          width: `${progress * 100}%`,
                                          backgroundColor: palette.tint,
                                        },
                                      ]}
                                    />
                                  </View>
                                </View>
                                <Text
                                  style={[styles.roomRankValue, { color: palette.labelSecondary }]}
                                  numberOfLines={1}
                                >
                                  {row.value
                                    ? t('贡献 {value}', { value: row.value })
                                    : t('贡献用户')}
                                </Text>
                              </View>
                            );
                          });
                        })()}
                      </ScrollView>
                    )}
                  </View>
                </View>
              </Modal>
            ) : null}
            {giftVisible ? (
              <Modal
                visible
                transparent
                animationType="slide"
                statusBarTranslucent
                navigationBarTranslucent
                onRequestClose={() => setGiftVisible(false)}
              >
                <View style={styles.roomModalShade}>
                  <Pressable
                    style={StyleSheet.absoluteFill}
                    onPress={() => setGiftVisible(false)}
                  />
                  <View
                    style={[
                      styles.rgPanel,
                      {
                        backgroundColor: palette.surfaceElevated,
                        borderTopWidth: StyleSheet.hairlineWidth,
                        borderTopColor: palette.hairline,
                        paddingBottom: Math.max(18, insets.bottom + 12),
                      },
                    ]}
                  >
                    <View style={styles.roomRankHandleWrap}>
                      <View style={[styles.roomRankHandle, { backgroundColor: palette.fill3 }]} />
                    </View>
                    <View style={styles.rgHeader}>
                      <Text style={[styles.rgTitle, { color: palette.label }]}>
                        {giftMode === 'room' ? t('房间送礼') : t('直播送礼')}
                      </Text>
                      <ScalePressable
                        onPress={() => setGiftVisible(false)}
                        pressedScale={0.92}
                        activeOpacity={0.8}
                        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                        accessibilityRole="button"
                        accessibilityLabel={t('关闭')}
                      >
                        <View style={[styles.roomRankClose, { backgroundColor: palette.fill2 }]}>
                          <MaterialCommunityIcons
                            name="close"
                            color={palette.labelSecondary}
                            size={18}
                          />
                        </View>
                      </ScalePressable>
                    </View>
                    <Text
                      style={[styles.rgStatus, { color: palette.labelSecondary }]}
                      numberOfLines={1}
                    >
                      {giftMode === 'room' && giftTarget?.memberName
                        ? `${t('收礼：{name}', { name: giftTarget.memberName })} · `
                        : ''}
                      {giftBalance
                        ? `${t('余额：{balance} 鸡腿', { balance: giftBalance })} · `
                        : ''}
                      {giftStatus}
                    </Text>
                    <ScrollView style={styles.rgGrid} showsVerticalScrollIndicator={false}>
                      <View style={styles.rgGridInner}>
                        {giftList.map((g, index) => {
                          const gid = String(g.giftId || g.id || '');
                          const pocket = Number(g.isPocketGift || 0) === 1;
                          const stock = Number(g.giftTotal || g.stock || 0);
                          const cost = Number(g.money ?? g.cost ?? g.price ?? 0) || 0;
                          const active =
                            !!giftSel && String(giftSel.giftId || giftSel.id || '') === gid;
                          const img = rgiftImage(g);
                          return (
                            <TouchableOpacity
                              key={`${gid}:${pocket ? 1 : 0}`}
                              style={[
                                styles.rgCell,
                                {
                                  backgroundColor: active ? palette.tintSoft : palette.fill2,
                                  borderColor: active ? palette.tint : palette.hairline,
                                },
                              ]}
                              onPress={() => {
                                setGiftSel(g);
                                setGiftNum(1);
                              }}
                              activeOpacity={0.85}
                            >
                              {img ? (
                                <NetworkImage
                                  source={{ uri: img }}
                                  style={styles.rgCellImg}
                                  thumbnail={96}
                                />
                              ) : (
                                <View
                                  style={[
                                    styles.rgCellImg,
                                    {
                                      backgroundColor: palette.fill3,
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                    },
                                  ]}
                                >
                                  <MaterialCommunityIcons
                                    name="gift-outline"
                                    size={18}
                                    color={palette.labelTertiary}
                                  />
                                </View>
                              )}
                              <Text
                                style={[styles.rgCellName, { color: palette.label }]}
                                numberOfLines={1}
                              >
                                {String(g.giftName || g.name || t('礼物 {n}', { n: index + 1 }))}
                                {pocket ? t('（背包）') : ''}
                              </Text>
                              {pocket ? (
                                <Text style={[styles.rgCellCost, { color: palette.labelTertiary }]}>
                                  ×{stock}
                                </Text>
                              ) : (
                                <Text style={[styles.rgCellCost, { color: palette.tint }]}>
                                  {t('{count} 鸡腿', { count: cost })}
                                </Text>
                              )}
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    </ScrollView>
                    <View style={styles.rgFooter}>
                      <TextInput
                        style={[
                          styles.rgNum,
                          {
                            color: palette.label,
                            borderColor: palette.hairline,
                            backgroundColor: palette.fill2,
                          },
                        ]}
                        keyboardType="numeric"
                        value={giftNum ? String(giftNum) : ''}

                        onChangeText={(s) => {
                          const digits = String(s).replace(/\D/g, '').slice(0, 3);
                          setGiftNum(digits ? Math.min(999, Number(digits)) : 0);
                        }}
                      />
                      <TouchableOpacity
                        style={[
                          styles.rgSendBtn,
                          { backgroundColor: giftSel ? palette.tint : palette.fill3 },
                        ]}
                        onPress={sendRoomGift}
                        activeOpacity={0.85}
                      >
                        <Text
                          style={[
                            styles.rgSendText,
                            { color: giftSel ? palette.onTint : palette.labelTertiary },
                          ]}
                        >
                          {giftSel
                            ? t('送出 · {count}', {
                                count:
                                  Number(giftSel.isPocketGift) === 1
                                    ? Number(giftNum) || 1
                                    : (Number(
                                        giftSel.money ?? giftSel.cost ?? giftSel.price ?? 0,
                                      ) || 0) * (Number(giftNum) || 1),
                              })
                            : t('选择礼物')}
                        </Text>
                      </TouchableOpacity>
                    </View>
                    <TouchableOpacity
                      style={styles.rgRecharge}
                      onPress={() => {
                        setGiftVisible(false);
                        navigation.navigate('RechargeScreen');
                      }}
                      activeOpacity={0.8}
                    >
                      <Text style={[styles.rgRechargeText, { color: palette.tint }]}>
                        {t('余额不足？去充值鸡腿')}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </Modal>
            ) : null}
            {liveResolve ? (
              <View style={[styles.roomPlayerPage, { backgroundColor: '#000' }]}>
                <TouchableOpacity
                  style={styles.liveResolveClose}
                  onPress={cancelLiveResolve}
                  activeOpacity={0.8}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <View style={styles.liveResolveCloseBtn}>
                    <MaterialCommunityIcons name="close" color="#fff" size={20} />
                  </View>
                </TouchableOpacity>
                <View style={styles.liveResolveWrap}>
                  {liveResolve.error ? (
                    <>
                      <MaterialCommunityIcons
                        name="alert-decagram-outline"
                        color={palette.tint}
                        size={46}
                      />
                      <Text style={styles.liveResolveTitle}>{t('直播地址解析失败')}</Text>
                      <Text style={styles.liveResolveText}>{liveResolve.error}</Text>
                      <View style={styles.liveResolveBtns}>
                        <ScalePressable
                          style={[styles.liveResolveBtn, { backgroundColor: palette.tint }]}
                          pressedScale={0.96}
                          activeOpacity={0.85}
                          onPress={() => resolveLiveAndOpen(liveResolve.media)}
                        >
                          <Text style={styles.liveResolveBtnText}>{t('重试')}</Text>
                        </ScalePressable>
                        <ScalePressable
                          style={[
                            styles.liveResolveBtnGhost,
                            { borderColor: 'rgba(255,255,255,0.35)' },
                          ]}
                          pressedScale={0.96}
                          activeOpacity={0.85}
                          onPress={cancelLiveResolve}
                        >
                          <Text style={styles.liveResolveBtnGhostText}>{t('关闭')}</Text>
                        </ScalePressable>
                      </View>
                    </>
                  ) : (
                    <ActivityIndicator color={palette.tint} size="large" />
                  )}
                </View>
              </View>
            ) : null}

            <ZoomImageModal
              url={imagePreview?.url || ''}
              images={imagePreview?.images}
              initialIndex={imagePreview?.index ?? 0}
              onClose={handleCloseImagePreview}
              onDownload={handleDownloadPreviewImage}
              onShare={handleSharePreviewImage}
            />

            {userCard ? (
              <Modal
                visible
                transparent
                animationType="slide"
                statusBarTranslucent
                navigationBarTranslucent
                onRequestClose={() => setUserCard(null)}
              >
                <TouchableOpacity
                  style={styles.roomModalShade}
                  activeOpacity={1}
                  onPress={() => setUserCard(null)}
                >
                  <TouchableOpacity
                    activeOpacity={1}
                    onPress={() => {}}
                    style={styles.userCardWrap}
                  >
                    <View
                      style={[
                        styles.userCardPanel,
                        {
                          backgroundColor: palette.surfaceElevated,
                          borderTopColor: palette.hairline,
                          paddingBottom: Math.max(20, insets.bottom + 14),
                        },
                      ]}
                    >
                      <View style={styles.roomRankHandleWrap}>
                        <View style={[styles.roomRankHandle, { backgroundColor: palette.fill3 }]} />
                      </View>
                      <View style={styles.userCardHead}>
                        {(() => {
                          const cardAvatar = userCard?.detail?.avatar || userCard?.avatar || '';
                          const cardName =
                            userCard?.detail?.name || userCard?.name || t('未知用户');
                          return (
                            <>
                              {cardAvatar ? (
                                <View>
                                  <NetworkImage
                                    source={{ uri: cardAvatar }}
                                    style={[
                                      styles.userCardAvatar,
                                      { backgroundColor: palette.fill2 },
                                    ]}
                                    thumbnail={180}
                                  />
                                  {userCard?.frameUrl ? (
                                    <NetworkImage
                                      source={{ uri: normalizeUrl(userCard.frameUrl) }}
                                      style={{
                                        position: 'absolute',
                                        width: USER_CARD_AVATAR_SIZE * 1.42,
                                        height: USER_CARD_AVATAR_SIZE * 1.42,
                                        left:
                                          (USER_CARD_AVATAR_SIZE - USER_CARD_AVATAR_SIZE * 1.42) /
                                          2,
                                        top:
                                          (USER_CARD_AVATAR_SIZE - USER_CARD_AVATAR_SIZE * 1.42) /
                                          2,
                                      }}
                                      resizeMode="contain"
                                      fallback={false}
                                    />
                                  ) : null}
                                </View>
                              ) : (
                                <View
                                  style={[
                                    styles.userCardAvatar,
                                    {
                                      backgroundColor: palette.fill2,
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                    },
                                  ]}
                                >
                                  <MaterialCommunityIcons
                                    name="account"
                                    size={30}
                                    color={palette.labelTertiary}
                                  />
                                </View>
                              )}
                              <View style={styles.userCardTitleWrap}>
                                <Text
                                  style={[styles.userCardName, { color: palette.label }]}
                                  numberOfLines={1}
                                >
                                  {cardName}
                                </Text>
                                <Text
                                  style={[styles.userCardMeta, { color: palette.labelSecondary }]}
                                  numberOfLines={1}
                                >
                                  {userCard?.id && /^\d+$/.test(userCard.id)
                                    ? `${t('用户 ID')}：${userCard.id}`
                                    : ''}
                                  {userCard?.detail?.level
                                    ? ` · ${t('等级 {level}', { level: userCard.detail.level })}`
                                    : ''}
                                </Text>
                                {userCard?.isMember ||
                                userCard?.detail?.team ||
                                userCard?.detail?.period ? (
                                  <Text
                                    style={[styles.userCardMeta, { color: palette.tint }]}
                                    numberOfLines={1}
                                  >
                                    {[
                                      userCard?.isMember ? t('成员') : '',
                                      userCard?.detail?.team || '',
                                      userCard?.detail?.period || '',
                                    ]
                                      .filter(Boolean)
                                      .join(' · ')}
                                  </Text>
                                ) : null}
                              </View>
                            </>
                          );
                        })()}
                        <ScalePressable
                          onPress={() => setUserCard(null)}
                          pressedScale={0.92}
                          activeOpacity={0.8}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          accessibilityRole="button"
                          accessibilityLabel={t('关闭')}
                          style={[styles.userCardCloseBtn, { backgroundColor: palette.fill2 }]}
                        >
                          <MaterialCommunityIcons
                            name="close"
                            size={18}
                            color={palette.labelSecondary}
                          />
                        </ScalePressable>
                      </View>
                      {userCard?.loading ? (
                        <View style={styles.userCardStatus}>
                          <ActivityIndicator color={palette.tint} />
                          <Text style={[styles.userCardTip, { color: palette.labelSecondary }]}>
                            {t('正在加载用户资料…')}
                          </Text>
                        </View>
                      ) : null}
                      {userCard?.error ? (
                        <View style={[styles.userCardNotice, { backgroundColor: palette.fill2 }]}>
                          <Text style={[styles.userCardTip, { color: palette.labelSecondary }]}>
                            {userCard.error}
                          </Text>
                        </View>
                      ) : null}
                      {userCard?.detail?.signature ? (
                        <View style={[styles.userCardNotice, { backgroundColor: palette.fill2 }]}>
                          <Text style={[styles.userCardTip, { color: palette.labelSecondary }]}>
                            {userCard.detail.signature}
                          </Text>
                        </View>
                      ) : null}
                      <View style={styles.userCardActions}>
                        <ScalePressable
                          style={[
                            styles.userCardBtn,
                            { backgroundColor: userCard?.following ? palette.fill2 : palette.tint },
                          ]}
                          pressedScale={0.95}
                          activeOpacity={0.85}
                          disabled={!userCard || userCard.followBusy}
                          onPress={() => userCard && void toggleFollowUser(userCard)}
                        >
                          <MaterialCommunityIcons
                            name={userCard?.following ? 'account-check' : 'account-plus'}
                            size={14}
                            color={userCard?.following ? palette.labelSecondary : palette.onTint}
                          />
                          <Text
                            style={[
                              styles.userCardBtnText,
                              {
                                color: userCard?.following
                                  ? palette.labelSecondary
                                  : palette.onTint,
                              },
                            ]}
                          >
                            {userCard?.mutual
                              ? t('互相关注')
                              : userCard?.following
                                ? t('已关注')
                                : t('关注')}
                          </Text>
                        </ScalePressable>
                        <ScalePressable
                          style={[styles.userCardBtn, { backgroundColor: palette.fill2 }]}
                          pressedScale={0.95}
                          activeOpacity={0.85}
                          disabled={!userCard}
                          onPress={() => userCard && openUserPrivateMessage(userCard)}
                        >
                          <MaterialCommunityIcons
                            name="message-text-outline"
                            size={14}
                            color={palette.tint}
                          />
                          <Text style={[styles.userCardBtnText, { color: palette.tint }]}>
                            {t('私信')}
                          </Text>
                        </ScalePressable>

                        {userCard?.isMember && userCard.memberDbId ? (
                          <ScalePressable
                            style={[styles.userCardBtn, { backgroundColor: palette.fill2 }]}
                            pressedScale={0.95}
                            activeOpacity={0.85}
                            onPress={() => {
                              const mid = userCard.memberDbId;
                              if (usePlayerStore.getState().fullscreen) {
                                usePlayerStore.getState().setFullscreen(false);
                              }
                              setUserCard(null);
                              navigation.navigate('ProfileScreen', {
                                memberId: mid,
                                nonce: Date.now(),
                              });
                            }}
                          >
                            <MaterialCommunityIcons
                              name="card-account-details-outline"
                              size={14}
                              color={palette.tint}
                            />
                            <Text
                              style={[styles.userCardBtnText, { color: palette.tint }]}
                              numberOfLines={1}
                            >
                              {t('成员档案')}
                            </Text>
                          </ScalePressable>
                        ) : null}
                      </View>
                    </View>
                  </TouchableOpacity>
                </TouchableOpacity>
              </Modal>
            ) : null}

            {essenceSheetOpen ? (
              <Modal
                visible
                transparent
                animationType="fade"
                statusBarTranslucent
                navigationBarTranslucent
                onRequestClose={() => setEssenceSheetOpen(false)}
              >
                <Pressable
                  style={styles.essenceBackdrop}
                  onPress={() => setEssenceSheetOpen(false)}
                />
                <View
                  style={[
                    styles.essenceSheet,
                    {
                      backgroundColor: palette.surfaceElevated,
                      paddingBottom: Math.max(18, insets.bottom + 12),
                    },
                  ]}
                >
                  <View style={styles.essenceHandle} />
                  <View style={styles.essenceHead}>
                    <MaterialCommunityIcons name="star" size={15} color={palette.tint} />
                    <Text style={[styles.essenceHeadText, { color: palette.label }]}>
                      {t('精华消息')}
                      {roomEssences.length ? ` · ${roomEssences.length}` : ''}
                    </Text>
                    <TouchableOpacity onPress={() => setEssenceSheetOpen(false)} hitSlop={10}>
                      <MaterialCommunityIcons
                        name="close"
                        size={20}
                        color={palette.labelTertiary}
                      />
                    </TouchableOpacity>
                  </View>
                  {roomEssences.length === 0 ? (
                    <Text style={[styles.essenceEmpty, { color: palette.labelTertiary }]}>
                      {essenceLoading ? t('加载中…') : t('暂无精华消息')}
                    </Text>
                  ) : (
                    <ScrollView
                      style={styles.essenceList}
                      keyboardShouldPersistTaps="handled"
                      nestedScrollEnabled
                    >
                      {roomEssences.map((m, i) => {
                        const name = String(senderProfile(m, selectedRoom as Member)?.name || '');
                        const text = String(messageText(m) || '').trim();

                        const em = roomMedia(m);
                        if (!text && !em) return null;
                        return (
                          <View
                            key={String(m?.msgIdClient || m?.msgId || i)}
                            style={styles.essenceRow}
                          >
                            <Text
                              style={[styles.essenceName, { color: palette.tint }]}
                              numberOfLines={1}
                            >
                              {name}
                            </Text>
                            {text ? (
                              <Text style={[styles.essenceText, { color: palette.label }]}>
                                {text}
                              </Text>
                            ) : null}
                            {em?.type === 'image' && em.url ? (
                              <TouchableOpacity
                                onPress={() => openEssenceImagePreview(em.url)}
                                activeOpacity={0.9}
                                style={styles.essenceImageWrap}
                              >
                                <NetworkImage
                                  source={{ uri: em.url }}
                                  style={styles.essenceImage}
                                  resizeMode="cover"
                                  thumbnail={700}
                                />
                              </TouchableOpacity>
                            ) : null}
                          </View>
                        );
                      })}
                    </ScrollView>
                  )}
                </View>
              </Modal>
            ) : null}

            <View
              nativeID="yaya.pip.overlay"
              collapsable={false}
              style={{ flex: 1, minWidth: 0, flexDirection: 'column' }}
            >
              <View style={[styles.roomTopBar, { paddingTop: insets.top + 8 }]}>
                <ScalePressable
                  onPress={closeRoom}
                  pressedScale={0.96}
                  accessibilityRole="button"
                  accessibilityLabel={t('返回')}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                  style={styles.roomHeaderPress}
                >
                  <GlassSurface
                    role="bar"
                    radius={FLOATING_BAR_HEIGHT / 2}
                    frostedOnly
                    style={styles.roomHeaderGlass}
                  >
                    <View style={styles.roomBackIcon}>
                      <MaterialCommunityIcons name="arrow-left" size={20} color={palette.label} />
                    </View>
                    <Text
                      numberOfLines={1}
                      style={[styles.roomHeaderTitle, { color: palette.label }]}
                    >
                      {headerTitle}
                    </Text>
                  </GlassSurface>
                </ScalePressable>

                <ScalePressable
                  onPress={() => toggleFollow(selectedRoom)}
                  disabled={followBusyRoom}
                  pressedScale={0.94}
                  accessibilityRole="button"
                  accessibilityLabel={isFollowingRoom ? t('已关注') : t('关注')}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                >
                  <GlassSurface
                    role="bar"
                    radius={17}
                    frostedOnly
                    tintColor={isFollowingRoom ? undefined : palette.tint}
                    style={[
                      styles.roomFollowPill,
                      !isFollowingRoom && { borderColor: palette.tint },
                    ]}
                  >
                    {followBusyRoom ? (
                      <ActivityIndicator
                        color={isFollowingRoom ? palette.tint : palette.onTint}
                        size="small"
                      />
                    ) : (
                      <Text
                        style={[
                          styles.roomFollowPillText,
                          { color: isFollowingRoom ? palette.tint : palette.onTint },
                        ]}
                      >
                        {isFollowingRoom ? t('已关注') : t('关注')}
                      </Text>
                    )}
                  </GlassSurface>
                </ScalePressable>
              </View>

              <View style={{ zIndex: 10 }}>
                <View
                  style={[
                    styles.chatToolsClip,
                    {
                      borderColor:
                        resolvedTheme === 'dark' ? 'rgba(255,255,255,0.14)' : 'rgba(18,22,36,0.08)',
                    },
                  ]}
                >
                  <ToolbarShell
                    {...(USE_FROSTED_TOOLBAR
                      ? {}
                      : {
                          intensity: 36,
                          tint: resolvedTheme === 'dark' ? 'dark' : 'light',
                          blurTarget: blurTarget ?? undefined,
                          blurMethod: 'dimezisBlurViewSdk31Plus',

                          blurReductionFactor: Platform.OS === 'android' ? 6 : 4,
                        })}
                    style={[
                      styles.chatTools,
                      USE_FROSTED_TOOLBAR
                        ? {
                            backgroundColor:
                              resolvedTheme === 'dark'
                                ? 'rgba(24,24,30,0.82)'
                                : 'rgba(244,245,251,0.86)',
                          }
                        : {
                            backgroundColor:
                              resolvedTheme === 'dark'
                                ? 'rgba(20,20,24,0.34)'
                                : 'rgba(255,255,255,0.42)',
                          },
                    ]}
                  >
                    {roomSearchOpen ? (
                      <>
                        <MaterialCommunityIcons
                          name="magnify"
                          size={17}
                          color={palette.labelTertiary}
                        />
                        <TextInput
                          ref={roomSearchInputRef}
                          style={{
                            flex: 1,
                            fontSize: 14,
                            fontFamily: fontFamily.system,
                            color: palette.label,
                            padding: 0,
                            height: 34,
                            alignSelf: 'center',
                          }}
                          placeholder={t('搜索聊天记录...')}
                          placeholderTextColor={palette.labelTertiary}
                          value={roomSearchQuery}
                          onChangeText={setRoomSearchQuery}
                          autoFocus
                          returnKeyType="search"
                        />
                        {!!roomSearchQuery ? (
                          <TouchableOpacity
                            onPress={() => {
                              searchScanSeqRef.current += 1;
                              searchPausedByUserRef.current = false;
                              setRoomSearchQuery('');
                              setDebouncedRoomSearch('');
                              setSearchScanState({
                                scanning: false,
                                scannedCount: 0,
                                pausedAtLimit: false,
                                pausedByUser: false,
                              });
                              roomSearchInputRef.current?.blur();
                              Keyboard.dismiss();
                            }}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            activeOpacity={0.7}
                          >
                            <MaterialCommunityIcons
                              name="close-circle"
                              size={16}
                              color={palette.labelTertiary}
                            />
                          </TouchableOpacity>
                        ) : null}
                      </>
                    ) : (
                      <>
                        <GlassSegmented
                          options={roomModeOptions}
                          value={roomMode}
                          onChange={handleRoomModeChange}
                          height={34}
                          style={{ width: 150 }}
                        />
                        <View style={{ flex: 1 }} />
                      </>
                    )}
                    <ScalePressable
                      style={[
                        styles.chatToolCircle,
                        {
                          backgroundColor: essenceSheetOpen
                            ? palette.tint
                            : resolvedTheme === 'dark'
                              ? 'rgba(255,255,255,0.12)'
                              : 'rgba(255,255,255,0.88)',
                        },
                      ]}
                      onPress={() => {
                        setEssenceSheetOpen(true);
                        void loadRoomEssences(essenceChannelId);
                      }}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      pressedScale={0.9}
                    >
                      <MaterialCommunityIcons
                        name="star"
                        size={18}
                        color={
                          essenceSheetOpen
                            ? palette.onTint
                            : roomEssences.length
                              ? palette.tint
                              : palette.label
                        }
                      />
                    </ScalePressable>
                    <ScalePressable
                      style={[
                        styles.chatToolCircle,
                        {
                          backgroundColor: roomSearchOpen
                            ? palette.tint
                            : resolvedTheme === 'dark'
                              ? 'rgba(255,255,255,0.12)'
                              : 'rgba(255,255,255,0.88)',
                        },
                      ]}
                      onPress={() => {
                        if (roomSearchOpen) {
                          roomSearchInputRef.current?.blur();
                          Keyboard.dismiss();
                          searchScanSeqRef.current += 1;
                          searchPausedByUserRef.current = false;
                          setRoomSearchOpen(false);
                          setRoomSearchQuery('');
                          setDebouncedRoomSearch('');
                          setSearchScanState({
                            scanning: false,
                            scannedCount: 0,
                            pausedAtLimit: false,
                            pausedByUser: false,
                          });
                        } else {
                          setRoomSearchOpen(true);
                        }
                      }}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      pressedScale={0.9}
                    >
                      <MaterialCommunityIcons
                        name={roomSearchOpen ? 'close' : 'magnify'}
                        size={18}
                        color={roomSearchOpen ? palette.onTint : palette.label}
                      />
                    </ScalePressable>
                    <ScalePressable
                      style={[
                        styles.chatToolCircle,
                        {
                          backgroundColor: showFanMessages
                            ? palette.tint
                            : resolvedTheme === 'dark'
                              ? 'rgba(255,255,255,0.12)'
                              : 'rgba(255,255,255,0.88)',
                        },
                      ]}
                      onPress={() => openRoom(selectedRoom, roomMode, !showFanMessages, 'internal')}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      pressedScale={0.9}
                    >
                      <MaterialCommunityIcons
                        name="account-group"
                        size={18}
                        color={showFanMessages ? palette.onTint : palette.label}
                      />
                    </ScalePressable>
                    {hasActiveRoomOnMic ? (
                      <ScalePressable
                        style={[styles.chatToolCircle, { backgroundColor: palette.tint }]}
                        onPress={() => {
                          void playRoomRadioInline();
                        }}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        pressedScale={0.9}
                      >
                        <MaterialCommunityIcons
                          name="microphone"
                          size={18}
                          color={palette.onTint}
                        />
                      </ScalePressable>
                    ) : null}
                  </ToolbarShell>
                </View>
              </View>

              {roomSearchOpen && debouncedRoomSearch ? (
                <View
                  style={{
                    alignSelf: 'center',
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 8,
                    marginBottom: 6,
                    paddingHorizontal: 12,
                    paddingVertical: 5,
                    borderRadius: 16,
                    backgroundColor:
                      resolvedTheme === 'dark' ? 'rgba(28,28,34,0.84)' : 'rgba(255,255,255,0.88)',
                    borderWidth: StyleSheet.hairlineWidth,
                    borderColor: palette.hairline,
                    maxWidth: '92%',
                  }}
                >
                  <ScalePressable
                    disabled={searchScanState.scanning || !hasMoreMessages}
                    onPress={() => {
                      if (!searchScanState.scanning && hasMoreMessages) {
                        void loadMoreRoomMessages();
                      }
                    }}
                    pressedScale={0.97}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 6,
                      flexShrink: 1,
                    }}
                  >
                    {searchScanState.scanning ? (
                      <ActivityIndicator size="small" color={palette.tint} />
                    ) : (
                      <MaterialCommunityIcons
                        name={hasMoreMessages ? 'history' : 'check-circle-outline'}
                        size={13}
                        color={hasMoreMessages ? palette.tint : palette.labelSecondary}
                      />
                    )}
                    <Text
                      numberOfLines={1}
                      style={{
                        fontSize: 11,
                        fontFamily: fontFamily.system,
                        fontWeight: '600',
                        color: hasMoreMessages ? palette.label : palette.labelSecondary,
                        flexShrink: 1,
                      }}
                    >
                      {searchScanState.scanning
                        ? t('正在深搜历史 · 已查 {scanned} 条 · 命中 {hits} 条', {
                            scanned: Math.max(roomMessages.length, searchScanState.scannedCount),
                            hits: filteredRoomMessages.length,
                          })
                        : searchScanState.pausedByUser && hasMoreMessages
                          ? t('已暂停 · 已查 {scanned} 条 · 命中 {hits} 条 · 继续搜更早', {
                              scanned: Math.max(roomMessages.length, searchScanState.scannedCount),
                              hits: filteredRoomMessages.length,
                            })
                          : hasMoreMessages
                            ? t('已查 {scanned} 条 · 命中 {hits} 条 · 继续搜更早', {
                                scanned: roomMessages.length,
                                hits: filteredRoomMessages.length,
                              })
                            : t('已搜全部 {scanned} 条消息 · 命中 {hits} 条', {
                                scanned: roomMessages.length,
                                hits: filteredRoomMessages.length,
                              })}
                    </Text>
                  </ScalePressable>
                  {searchScanState.scanning ? (
                    <ScalePressable
                      pressedScale={0.92}
                      hitSlop={{ top: 6, bottom: 6, left: 4, right: 6 }}
                      onPress={() => {
                        searchPausedByUserRef.current = true;
                        searchScanSeqRef.current += 1;
                        setSearchScanState((prev) => ({
                          ...prev,
                          scanning: false,
                          pausedAtLimit: false,
                          pausedByUser: true,
                        }));
                      }}
                      style={{
                        paddingHorizontal: 8,
                        paddingVertical: 2,
                        borderRadius: 10,
                        backgroundColor: palette.tintSoft,
                      }}
                    >
                      <Text
                        style={{
                          fontSize: 11,
                          fontFamily: fontFamily.system,
                          fontWeight: '700',
                          color: palette.tint,
                        }}
                      >
                        {t('暂停')}
                      </Text>
                    </ScalePressable>
                  ) : null}
                </View>
              ) : null}

              <RoomChatListPane
                messages={roomListIms}
                listRef={roomListRef}
                listProps={roomChatListProps}
                renderMessage={renderChatMessage}
                renderDay={renderDayLabel}
                loadEarlierProps={roomLoadEarlierProps}
                showJumpBtn={!roomAtBottom || roomPendingCount > 0}
                pendingCount={roomPendingCount}
                onJumpOut={roomJumpOut}
                palette={palette}
                t={t}
              />

              {roomPlayer?.isLive && roomPlayer.liveId ? (
                <LiveBarrageBoard
                  source={roomBarrage}
                  liveId={roomBarrageLiveId}
                  module="live"
                  height={149}
                  hideInput
                  style={styles.roomBarrageBoard}
                />
              ) : null}

              <RoomComposerBar
                resetKey={`${String(selectedRoom.id || '')}:${essenceChannelId}:${composerResetSeq}`}
                inputRef={roomChatInputRef}
                replyTarget={replyTarget}
                onClearReply={clearReplyTarget}
                sendHint={roomSendHint}
                onClearSendHint={clearRoomSendHint}
                sending={roomSending}
                onSendText={handleSendRoomMessage}
                onSendSticker={handleSendRoomSticker}
                onOpenGift={openRoomGiftPanel}
                channelId={activeRoomRef.current.channelId}
                memberId={activeRoomRef.current.memberId}
                roomKeyboardHeight={roomKeyboardHeight}
                bottomInset={Platform.OS === 'ios' ? Math.max(16, insets.bottom) : 16}
                stickerBottomInset={Math.max(8, roomNavigationInset)}
                resolvedTheme={resolvedTheme}
                palette={palette}
                t={t}
              />
            </View>
          </View>

          {msgMenu ? (
            <Modal
              visible
              transparent
              animationType="fade"
              statusBarTranslucent
              navigationBarTranslucent
              onRequestClose={() => setMsgMenu(null)}
            >
              <TouchableOpacity
                style={styles.roomModalShade}
                activeOpacity={1}
                onPress={() => setMsgMenu(null)}
              >
                <TouchableOpacity activeOpacity={1} onPress={() => {}} style={styles.roomMenuWrap}>
                  <View
                    style={[
                      styles.roomMenuPanel,
                      {
                        backgroundColor: palette.surfaceElevated,
                        borderTopWidth: StyleSheet.hairlineWidth,
                        borderTopColor: palette.hairline,
                        paddingBottom: Math.max(18, insets.bottom + 12),
                      },
                    ]}
                  >
                    <View style={styles.roomRankHandleWrap}>
                      <View style={[styles.roomRankHandle, { backgroundColor: palette.fill3 }]} />
                    </View>
                    {msgMenu?.name ? (
                      <Text
                        style={[styles.roomMenuTitle, { color: palette.labelSecondary }]}
                        numberOfLines={1}
                      >
                        {msgMenu.name}
                      </Text>
                    ) : null}
                    {msgMenu?.media ? (
                      <>
                        <TouchableOpacity
                          style={[styles.roomMenuItem, { borderTopColor: palette.hairline }]}
                          onPress={msgMenuReply}
                          activeOpacity={0.85}
                        >
                          <MaterialCommunityIcons name="reply" size={18} color={palette.label} />
                          <Text style={[styles.roomMenuItemText, { color: palette.label }]}>
                            {t('回复')}
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.roomMenuItem, { borderTopColor: palette.hairline }]}
                          onPress={() => {
                            const m = msgMenu?.media;
                            setMsgMenu(null);
                            if (m) void downloadMedia(m);
                          }}
                          activeOpacity={0.85}
                        >
                          <MaterialCommunityIcons name="download" size={18} color={palette.label} />
                          <Text style={[styles.roomMenuItemText, { color: palette.label }]}>
                            {t('下载')}
                          </Text>
                        </TouchableOpacity>
                      </>
                    ) : (
                      <>
                        <TouchableOpacity
                          style={[styles.roomMenuItem, { borderTopColor: palette.hairline }]}
                          onPress={msgMenuReply}
                          activeOpacity={0.85}
                        >
                          <MaterialCommunityIcons name="reply" size={18} color={palette.label} />
                          <Text style={[styles.roomMenuItemText, { color: palette.label }]}>
                            {t('回复')}
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.roomMenuItem, { borderTopColor: palette.hairline }]}
                          onPress={msgMenuCopy}
                          activeOpacity={0.85}
                        >
                          <MaterialCommunityIcons
                            name="content-copy"
                            size={18}
                            color={palette.label}
                          />
                          <Text style={[styles.roomMenuItemText, { color: palette.label }]}>
                            {t('复制')}
                          </Text>
                        </TouchableOpacity>
                      </>
                    )}
                    {msgMenu?.mine ? (
                      <TouchableOpacity
                        style={[styles.roomMenuItem, { borderTopColor: palette.hairline }]}
                        onPress={() => {
                          const it = msgMenu?.item;
                          setMsgMenu(null);
                          if (it) confirmDeleteMessage(it);
                        }}
                        activeOpacity={0.85}
                      >
                        <MaterialCommunityIcons
                          name="delete-outline"
                          size={18}
                          color={palette.danger}
                        />
                        <Text style={[styles.roomMenuItemText, { color: palette.danger }]}>
                          {t('删除')}
                        </Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                </TouchableOpacity>
              </TouchableOpacity>
            </Modal>
          ) : null}
        </View>
      </Reanimated.View>
    );
  })();

  return (
    <View style={styles.container}>
      <View
        style={styles.container}
        pointerEvents={selectedRoom && !roomClosing ? 'none' : 'auto'}
        importantForAccessibility={selectedRoom && !roomClosing ? 'no-hide-descendants' : 'auto'}
        accessibilityElementsHidden={!!selectedRoom && !roomClosing}
      >
        <FloatingTabHeader
          frostedOnly={!!selectedRoom && !roomClosing}
          hidden={!!selectedRoom && !roomClosing}
          leftIsland={roomsHeaderLeft}
          right={roomsHeaderRight}
        />

        {roomMenu ? (
          <Modal
            visible
            transparent
            animationType="fade"
            statusBarTranslucent
            navigationBarTranslucent
            onRequestClose={closeRoomMenu}
          >
            <TouchableOpacity
              style={styles.roomModalShade}
              activeOpacity={1}
              onPress={closeRoomMenu}
            >
              <TouchableOpacity activeOpacity={1} onPress={() => {}} style={styles.roomMenuWrap}>
                <View
                  style={[
                    styles.roomMenuPanel,
                    {
                      backgroundColor: palette.surfaceElevated,
                      borderTopWidth: StyleSheet.hairlineWidth,
                      borderTopColor: palette.hairline,
                      paddingBottom: Math.max(18, insets.bottom + 12),
                    },
                  ]}
                >
                  <View style={styles.roomRankHandleWrap}>
                    <View style={[styles.roomRankHandle, { backgroundColor: palette.fill3 }]} />
                  </View>
                  <Text style={[styles.roomMenuTitle, { color: palette.label }]} numberOfLines={1}>
                    {roomMenu?.member ? shortName(roomMenu.member, roomMenu.memberId) : ''}
                  </Text>
                  <ScrollView style={styles.roomMenuList} showsVerticalScrollIndicator={false}>
                    {roomMenuActions.map((act) => (
                      <TouchableOpacity
                        key={act.key}
                        style={[styles.roomMenuItem, { borderTopColor: palette.hairline }]}
                        onPress={act.onPress}
                        activeOpacity={0.85}
                      >
                        <MaterialCommunityIcons
                          name={act.icon as any}
                          size={18}
                          color={act.danger ? palette.danger : palette.label}
                        />
                        <Text
                          style={[
                            styles.roomMenuItemText,
                            { color: act.danger ? palette.danger : palette.label },
                          ]}
                        >
                          {act.label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              </TouchableOpacity>
            </TouchableOpacity>
          </Modal>
        ) : null}

        {searchOpen || memberBrowseOpen ? (
          <View style={{ paddingTop: roomsHeaderOffset, paddingHorizontal: 14, paddingBottom: 8 }}>
            <SearchBar
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder={t('搜索成员...')}
              autoFocus={!memberBrowseOpen}
              onClear={() => Keyboard.dismiss()}
            />
          </View>
        ) : null}

        <View style={{ flex: 1 }}>
          {(searchOpen && searchQuery.trim()) || memberBrowseOpen ? (
            memberHits.length === 0 ? (
              <Text style={[styles.memberHitsEmpty, { color: palette.labelTertiary }]}>
                {t('没有匹配的成员')}
              </Text>
            ) : (
              <PerfFlatList
                data={memberHits}
                keyExtractor={(member) => String(member.id || member.userId || member.ownerName)}
                contentContainerStyle={styles.memberHitsListContent}
                keyboardDismissMode="on-drag"
                keyboardShouldPersistTaps="handled"
                initialNumToRender={12}
                maxToRenderPerBatch={8}
                windowSize={5}
                ListHeaderComponent={
                  <View style={styles.memberHitsHeader}>
                    <Text style={[styles.memberHitsTitle, { color: palette.label }]}>
                      {memberBrowseOpen && !searchQuery.trim() ? t('全部成员') : t('成员')}
                    </Text>
                    <Text style={[styles.memberHitsCount, { color: palette.labelTertiary }]}>
                      {t('{count} 位', { count: memberHits.length })}
                    </Text>
                  </View>
                }
                ItemSeparatorComponent={() => (
                  <View
                    style={[styles.memberHitSeparator, { backgroundColor: palette.hairline }]}
                  />
                )}
                renderItem={({ item: member }) => {
                  const mid = String(member.id || member.userId || '');
                  const isFollowing = followedIds.has(mid);
                  const busy = followBusy.has(mid);
                  const name = shortName(member, mid);
                  const team = member.team || member.groupName || t('成员');
                  return (
                    <View style={styles.memberGridItem}>
                      <TouchableOpacity
                        style={styles.memberHitCard}
                        onPress={() => openRoom(member)}
                        activeOpacity={0.88}
                      >
                        <View
                          style={[
                            styles.memberHitAvatar,
                            { backgroundColor: palette.tintSoft, borderColor: palette.hairline },
                          ]}
                        >
                          {member.avatar ? (
                            <NetworkImage
                              source={{ uri: member.avatar }}
                              style={styles.memberHitAvatarImg}
                              thumbnail={180}
                            />
                          ) : (
                            <Text style={[styles.memberHitAvatarText, { color: palette.tint }]}>
                              {avatarInitial(name)}
                            </Text>
                          )}
                        </View>
                        <View style={styles.memberHitMeta}>
                          <Text
                            style={[styles.memberHitName, { color: palette.label }]}
                            numberOfLines={1}
                          >
                            {name}
                          </Text>
                          <Text
                            style={[styles.memberHitTeam, { color: palette.labelSecondary }]}
                            numberOfLines={1}
                          >
                            {team}
                          </Text>
                        </View>
                        <TouchableOpacity
                          style={[
                            styles.memberHitBtn,
                            {
                              backgroundColor: isFollowing ? palette.fill2 : palette.tintSoft,
                              borderColor: isFollowing ? palette.hairline : 'transparent',
                            },
                          ]}
                          disabled={busy}
                          onPress={() => toggleFollow(member)}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          activeOpacity={0.85}
                        >
                          {busy ? (
                            <ActivityIndicator color={palette.tint} size="small" />
                          ) : (
                            <Text
                              style={[
                                styles.memberHitBtnText,
                                { color: isFollowing ? palette.labelSecondary : palette.tint },
                              ]}
                            >
                              {isFollowing ? t('已关注') : t('关注')}
                            </Text>
                          )}
                        </TouchableOpacity>
                      </TouchableOpacity>
                    </View>
                  );
                }}
              />
            )
          ) : (
            <PerfFlatList
              key="rooms-list"
              data={filtered}
              extraData={roomsExtraData}
              keyExtractor={roomsKeyExtractor}
              contentContainerStyle={roomsListContentStyle}
              ListFooterComponent={ROOMS_LIST_FOOTER}
              keyboardDismissMode="on-drag"
              keyboardShouldPersistTaps="handled"
              renderItem={renderRoomsListItem}
              ListEmptyComponent={
                (searchOpen && searchQuery.trim()) || memberBrowseOpen ? null : followedLoading ? (
                  <CenterSpinner />
                ) : !token ? (
                  <EmptyState
                    icon="account-key-outline"
                    title={t('登录后可查看关注房间和最新消息')}
                    actionLabel={t('去登录')}
                    onAction={() => navigation.navigate('LoginScreen')}
                  />
                ) : followedError ? (
                  <ErrorState
                    title={t('加载失败')}
                    hint={followedError}
                    onAction={() => loadFollowed(true)}
                  />
                ) : followed.length > 0 && roomFilter === 'pinned' ? (
                  <EmptyState
                    icon="pin-outline"
                    title={t('暂无置顶房间')}
                    hint={t('长按任意房间卡片即可置顶或调整排序')}
                    actionLabel={t('查看全部')}
                    onAction={() => setRoomFilter('all')}
                  />
                ) : followed.length > 0 && roomFilter === 'live' ? (
                  <EmptyState
                    icon="broadcast-off"
                    title={t('当前暂无人开播或上麦')}
                    actionLabel={t('查看全部')}
                    onAction={() => setRoomFilter('all')}
                  />
                ) : (
                  <EmptyState
                    icon="heart-outline"
                    title={t('暂无关注房间')}
                    actionLabel={t('全部成员')}
                    onAction={() => {
                      setSearchQuery('');
                      setSearchOpen(true);
                      setMemberBrowseOpen(true);
                    }}
                  />
                )
              }
              initialNumToRender={10}
              maxToRenderPerBatch={8}
              windowSize={5}
              removeClippedSubviews={false}
            />
          )}
        </View>
      </View>
      {roomOverlayNode}
    </View>
  );
}

const FollowedRoomRowCard = React.memo(function FollowedRoomRowCard({
  item,
  activeMember,
  isPinned,
  name,
  teamLogo,
  teamLabel,
  lastText,
  bigTime,
  isLiveNow,
  isOnMic,
  isVoiceRoom,
  isActiveLive,
  ykid,
  sText,
  smallTime,
  isFollowing,
  followIsBusy,
  showSmallRow,
  palette,
  t,
  onOpenRoom,
  onOpenMenu,
  onFollowPress,
}: {
  item: FollowedRoom;
  activeMember: Member | undefined;
  isPinned: boolean;
  name: string;
  teamLogo: string;
  teamLabel: string;
  lastText: string;
  bigTime: string;
  isLiveNow: boolean;
  isOnMic: boolean;
  isVoiceRoom: boolean;
  isActiveLive: boolean;
  ykid: string;
  sText: string;
  smallTime: string;
  isFollowing: boolean;
  followIsBusy: boolean;
  showSmallRow: boolean;
  palette: Palette;
  t: (key: string, vars?: Record<string, string | number>) => string;
  onOpenRoom: (member: Member, mode?: RoomMode) => void;
  onOpenMenu: (item: FollowedRoom) => void;
  onFollowPress: (member: Member, memberId: string, isFollowing: boolean) => void;
}) {
  return (
    <View style={styles.roomRow}>
      <View
        style={[
          styles.roomRowCard,
          {
            backgroundColor: palette.surfaceGlassStrong,
            borderColor: isPinned ? palette.tintSoft : palette.innerStroke,
          },
        ]}
      >
        <TouchableOpacity
          style={styles.roomRowMain}
          onPress={() => activeMember && onOpenRoom(activeMember)}
          onLongPress={() => onOpenMenu(item)}
          delayLongPress={400}
          activeOpacity={0.88}
        >
          <View style={styles.roomCoverWrap}>
            <View
              style={[
                styles.roomCover,
                isActiveLive && styles.roomCoverLiveRing,
                {
                  backgroundColor: palette.tintSoft,
                  borderColor: isActiveLive ? palette.tint : palette.hairline,
                },
              ]}
            >
              {activeMember?.avatar ? (
                <NetworkImage
                  source={{ uri: thumbUrl(activeMember.avatar, AVATAR_THUMB_WIDTH) }}
                  style={styles.roomCoverImg}
                />
              ) : (
                <Text style={[styles.roomCoverText, { color: palette.tint }]} numberOfLines={1}>
                  {avatarInitial(name)}
                </Text>
              )}
            </View>
            {isLiveNow ? (
              <View style={[styles.roomCoverLivePill, { backgroundColor: palette.tint }]}>
                <Text style={styles.roomCoverLivePillText}>LIVE</Text>
              </View>
            ) : null}
          </View>

          <View style={styles.roomInfo}>
            <View style={styles.roomNameRow}>
              <View style={styles.roomNameLeft}>
                <Text style={[styles.roomName, { color: palette.label }]} numberOfLines={1}>
                  {name}
                </Text>
                <TeamLogoImage
                  uri={teamLogo}
                  size={14}
                  widthRatio={2.2}
                  fallback={
                    teamLabel ? (
                      <Text
                        style={[styles.roomTeamFallback, { color: palette.labelTertiary }]}
                        numberOfLines={1}
                      >
                        {teamLabel}
                      </Text>
                    ) : null
                  }
                />
              </View>
              <View style={styles.roomRightStatus}>
                {isLiveNow ? (
                  <View style={[styles.liveBadgeChip, { backgroundColor: palette.tint }]}>
                    <MaterialCommunityIcons name="broadcast" size={10} color={palette.onTint} />
                    <Text style={styles.liveBadgeChipText}>{t('直播中')}</Text>
                  </View>
                ) : isOnMic ? (
                  <View style={[styles.liveBadgeChip, { backgroundColor: palette.tint }]}>
                    <MaterialCommunityIcons name="microphone" size={10} color={palette.onTint} />
                    <Text style={styles.liveBadgeChipText}>{t('上麦中')}</Text>
                  </View>
                ) : isVoiceRoom ? (
                  <View style={[styles.liveBadgeChip, { backgroundColor: palette.tint }]}>
                    <MaterialCommunityIcons
                      name="microphone-outline"
                      size={10}
                      color={palette.onTint}
                    />
                    <Text style={styles.liveBadgeChipText}>{t('语聊中')}</Text>
                  </View>
                ) : null}
                {isPinned ? (
                  <View style={[styles.roomPinBadge, { backgroundColor: palette.tintSoft }]}>
                    <MaterialCommunityIcons name="pin" size={11} color={palette.tint} />
                  </View>
                ) : null}
                <TouchableOpacity
                  style={[
                    styles.roomFollowBtn,
                    {
                      backgroundColor: isFollowing ? palette.tintSoft : palette.fill2,
                    },
                  ]}
                  disabled={followIsBusy}
                  activeOpacity={0.75}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityLabel={isFollowing ? t('已关注') : t('关注')}
                  onPress={(e) => {
                    e.stopPropagation?.();
                    const targetMember = activeMember || item.member;
                    if (targetMember) onFollowPress(targetMember, item.memberId, isFollowing);
                  }}
                >
                  {followIsBusy ? (
                    <ActivityIndicator color={palette.tint} size="small" />
                  ) : (
                    <MaterialCommunityIcons
                      name={isFollowing ? 'heart' : 'heart-outline'}
                      size={13}
                      color={isFollowing ? palette.tint : palette.labelTertiary}
                    />
                  )}
                </TouchableOpacity>
              </View>
            </View>

            {lastText ? (
              <View style={styles.lastRow}>
                <View style={styles.lastRowLeft}>
                  <View style={[styles.lastTag, { backgroundColor: palette.tintSoft }]}>
                    <Text style={[styles.lastTagText, { color: palette.tint }]}>{t('大')}</Text>
                  </View>
                  <Text
                    style={[styles.roomLast, { color: palette.labelSecondary }]}
                    numberOfLines={1}
                  >
                    {lastText}
                  </Text>
                </View>
                {bigTime ? (
                  <Text
                    style={[styles.lastMsgTime, { color: palette.labelTertiary }]}
                    allowFontScaling={false}
                  >
                    {bigTime}
                  </Text>
                ) : null}
              </View>
            ) : null}

            {showSmallRow ? (
              <View style={styles.lastRow}>
                <View style={styles.lastRowLeft}>
                  <TouchableOpacity
                    style={styles.smallMsgTap}
                    onPress={() => activeMember && onOpenRoom(activeMember, 'small')}
                    onLongPress={() => onOpenMenu(item)}
                    delayLongPress={400}
                    activeOpacity={0.75}
                  >
                    <View style={[styles.lastTag, { backgroundColor: palette.fill2 }]}>
                      <Text style={[styles.lastTagText, { color: palette.labelSecondary }]}>
                        {t('小')}
                      </Text>
                    </View>
                    <Text
                      style={[styles.roomLastInline, { color: palette.labelTertiary }]}
                      numberOfLines={1}
                    >
                      {sText || t('小房间 {id}', { id: ykid })}
                    </Text>
                  </TouchableOpacity>
                </View>
                {smallTime ? (
                  <Text
                    style={[styles.lastMsgTime, { color: palette.labelTertiary }]}
                    allowFontScaling={false}
                  >
                    {smallTime}
                  </Text>
                ) : null}
              </View>
            ) : null}
          </View>
        </TouchableOpacity>
      </View>
    </View>
  );
});

const ROOM_CHAT_LIST_CONTENT_STYLE = { paddingBottom: 4, paddingTop: 0 } as const;
