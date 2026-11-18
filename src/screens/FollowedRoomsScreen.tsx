import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  AppState,
  DeviceEventEmitter,
  Keyboard,
  NativeModules,
  Platform,
  Pressable,
  useWindowDimensions,
} from 'react-native';
import Reanimated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { USER_AGENT } from '../constants';
import { showDialog } from '../components/AppDialog';
import { PerfFlatList } from '../components/PerfFlatList';
import { Chat } from '@kesha-antonov/react-native-chat';
import { setLiveImmersiveMode } from '../native/LivePlayer';
import {
  deleteRoomMessage,
  observeRoomMessages,
  resetQChatSession,
  sendRoomSticker,
  sendRoomTextMessage,
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
import { fetchMemberRadioUrl } from '../services/radio';
import { usePalette } from '../theme';
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
  matchFollowedMember,
  buildMemberIdSet,
  userCardFromUserRes,
  messageKey,
  mergeMessages,
  roomGiftInfo,
  mediaLabel,
  __diagStamp,
  firstFrameFrom,
  firstBadgeFrom,
  findFrameUrl,
  normalizeLiveRank,
  avatarInitial,
  type LiveRankItem,
} from './followedRooms/roomDomain';

import {
  ActivityIndicator,
  BackHandler,
  Image,
  ImageBackground,
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
import Video, { type OnLoadData } from 'react-native-video';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/types';
import { useSafeAreaInsets } from '../hooks/useSafeAreaInsets';
import { shareRemoteImage } from '../services/shareImage';
import { useSettingsStore, useMemberStore, useUiStore } from '../store';
import { CenterSpinner } from '../components/Loaders';
import { EmptyState, ErrorState } from '../components/StateViews';
import { FadeInView, ScalePressable } from '../components/Motion';
import ScreenHeader from '../components/ScreenHeader';
import { type Member, type RoomMessage, type RoomMessageWire, type WireRecord } from '../types';
import { formatTimestamp } from '../utils/format';
import { findMediaDurationSeconds } from '../utils/mediaDuration';
import { normalizePrivateMediaUrl } from '../utils/mediaUrl';
import { normalizeGiftList } from '../utils/giftList';
import {
  ROOM_AT_BOTTOM_OFFSET,
  ROOM_POLL_INTERVAL_MS,
  ROOM_REFRESH_LIMIT,
  ROOM_REJOIN_AFTER_MS,
  splitByFreezeAnchor,
} from '../services/roomLivePolicy';
import { probeMediaDurationSeconds } from '../native/MediaProbe';
import { useMiniPlayerStore } from '../store/miniPlayerStore';
import { usePlayerStore } from '../player/store/playerStore';
import { useOnMicStore } from '../store/onMicStore';
import { parseVoiceEvent } from '../services/pocketNim/voiceEvent';
import {
  errorMessage,
  messagePayload,
  humanizeRawMessageText,
  messageText,
  normalizeUrl,
  splitEmojiParts,
  unwrapList,
} from '../utils/data';
import { UserDecorRow, AvatarWithFrame } from '../components/UserDecor';
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
import { enqueueDownload } from '../services/downloads';
import { memberSearchText, isRoomMember } from '../utils/members';
import { getBgDisplayUri, ensureBgCached } from '../services/roomBgCache';
import { loadRoomMetaCache, setRoomMetaCached } from '../services/roomMetaCache';
import { thumbUrl, AVATAR_THUMB_WIDTH } from '../utils/imageThumb';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { GlassSurface } from '../components/GlassSurface';
import RoomStickerPanel from '../components/RoomStickerPanel';
import RoomFlipQuestion from '../components/RoomFlipQuestion';
import { getRoomFlipInfo } from '../utils/roomFlip';

/**
 * OneUI（三星）降级开关：expo-blur 的 RenderEffect 实时模糊在三星机上极易掉帧/发热
 *（用户反馈「性能够但卡卡卡、热热热」）。房间工具条改用半透明实底替代实时模糊。
 */
const platformConstants = Platform.constants as unknown as Record<string, string | undefined>;
const IS_SAMSUNG =
  Platform.OS === 'android' &&
  /samsung/i.test(String(platformConstants.Brand || platformConstants.Manufacturer || ''));
/** 工具条外壳：三星用普通 View（无 RenderEffect），其他机型保持玻璃 */
const ToolbarShell = (IS_SAMSUNG ? View : BlurView) as unknown as React.ComponentType<
  React.ComponentProps<typeof BlurView>
>;
import { useBlurTarget } from '../components/BlurTarget';
import { GlassSegmented } from '../components/GlassSegmented';
import { pocketImJoinChannel } from '../native/PocketIm';
import { setPipPlaying } from '../utils/pip';
import { ListBottomSpacer } from '../components/ListBottomSpacer';
type FollowedRoom = {
  memberId: string;
  member?: Member;
  lastMessage?: RoomMessageWire | null;
  /** 小房间（yklzId）最新消息，与大房间分开显示 */
  lastSmallMessage?: RoomMessageWire | null;
};

/** 礼物列表行（服务端字段名不统一：giftId/id、giftName/name、money/cost/price 都可能出现） */
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

/** 消息流行：日期分隔条或一条房间消息 */
type ChatRow = {
  type: 'date' | 'msg';
  key: string;
  label?: string;
  item?: RoomMessageWire;
  index?: number;
  groupStart?: boolean;
};

/** 交给聊天库渲染的 IMessage（带 __row 回指原始消息行） */
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
  /** 直播详情返回的直播类型（1=单人直播 2=PK）；礼物 businessCode 选择用 */
  liveType?: number;
  /** 候选流地址（按优先级）：整组交给 PlayerScreen，首条失败自动换线。
   * 多人 PK 等场景首条常不可用，只取 urls[0] 会黑屏/卡住。 */
  urls?: string[];
  /** 消息/卡片已明示「回放/录播」：播放时应走可拖进度条的录播播放器，而非直播播放器 */
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

/**
 * 房间点击判「是否录播（可拖进度 vod）」。事实：
 * - 房间消息条目（roomMedia）同步构建、不带 isLive 标记；回放地址常见 HLS(.m3u8)/FLV 形态，
 * 若把 .m3u8 一律当直播流，消息里的录播卡就全部套上直播播放器（无进度条）——本 bug 根因。
 * - rtmp/flv 推流只可能是直播；消息明示回放(replayHint)即使 rtmp/flv 也按录播。
 * - m3u8/mp4 二义：仅当明确带 isLive 标记（直播列表 record:false 命中 / 详情状态位）才直播，否则录播。
 */
function roomTapIsVod(next: RoomMedia): boolean {
  if (next.replayHint) return true;
  const u = String(next.url || '').toLowerCase();
  if (u.startsWith('rtmp://') || u.includes('.flv')) return false;
  return !next.isLive;
}

/** 直播/回放列表短缓存：同一房间短时间内的多次「抓流比对」只打一次接口 */
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

/** 从已拉取的直播/录播详情判断当前状态。
 * 口袋 48 接口的事实字段：录播详情带 content.msgFilePath / content.lrcUrl（LRC 弹幕文件，
 * 见 pocket48.getLiveLrc 的既有用法），直播详情带 isLiving / living / isEnd 等状态位。
 * 无法确定时返回 'unknown'，交由上层按 URL 形态兜底。 */
function detailLiveState(detail: unknown): 'live' | 'replay' | 'unknown' {
  const root = (detail || {}) as WireRecord;
  const d = (root.content || root.data || root) as WireRecord;
  if (d.isLiving === true || d.living === true || d.isLive === true) return 'live';
  // 官方权威状态位：type=1 直播（2/3=回放/录播）；liveType 1=单人直播 2=PK（同样是在播）；
  // review=true 表示已下播转回放。此前只看 isLiving 之类衍生字段，PK 场全部落进 unknown。
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
  // 消息里已带可播放地址：直接返回，不再请求任何接口（直播分享/录播卡片通常自带 URL）
  const ownUrl = isPlayableMediaUrl(media.url) ? media.url : '';
  if (ownUrl) {
    const lower = ownUrl.toLowerCase();
    const isRtmp = lower.startsWith('rtmp://') || lower.includes('.flv');
    if (isRtmp) {
      // rtmp/flv 推流只可能是直播
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
      // 消息明示回放（录播卡）
      return {
        ...media,
        liveId,
        title,
        url: ownUrl,
        isLive: false,
        needsVlc: streamNeedsProxy(ownUrl),
      };
    }
    // m3u8/mp4 二义：默认按「回放」（录播可拖进度条）；直播列表(record:false)命中才视为直播。
    // 直播(rtmp/flv) 已在上方直接返回 live；Exo 直播状态已修复可正常出画面，因此不再为防黑屏牺牲录播判定
    let isLive = false;
    if (liveId) {
      try {
        const found = await findLiveItem(await cachedLiveList(false, 0, 0), liveId);
        isLive = !!found;
      } catch {
        isLive = false; // 查询失败按回放处理（录播优先，进度条可用；真直播多为 rtmp/flv 不受影响）
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
  // 并行发起全部候选接口，按优先级取第一个出 URL 的结果；
  // 原来 6 个接口串行（最坏每个 15s 超时），是「解析卡死、第一次点击无响应」的根因。
  const ATTEMPT_TIMEOUT = 4000;
  const settled = await Promise.allSettled(
    attempts.map((attempt) =>
      Promise.race([
        attempt.run(),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), ATTEMPT_TIMEOUT)),
      ]),
    ),
  );
  // 先分辨直播还是录播，再决定播放器：
  // 回放列表（record:true）命中的结果确定是录播，优先采用；
  // 其余（正在直播列表 / 详情）按接口状态位或 URL 形态兜底判断，避免把回放流误当直播播放。
  // 优先级：明确在播 > 未知 > 回放。
  // 原先是「回放优先」，多人 PK 这类 liveType=2 的场次会被回放列表抢走、播成录播。
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
            // 详情无明确状态位：rtmp/flv 视为直播；m3u8/mp4 一律按回放（录播可拖，防录播套直播控件）
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

/**
 * 解析直播地址 + 瞬时失败自动重试：首轮全部候选接口都拿不到地址、且是「快速失败」
 * （网络抖动/接口偶发 500，几秒内就结束）时，稍候 600ms 整轮重试一次。
 * 若首轮是慢超时（已等满 5s+）则不再重试——慢网重试无意义，避免把点击拖成 20s。
 */
async function resolveRoomLiveMediaWithRetry(media: RoomMedia): Promise<RoomMedia> {
  const started = Date.now();
  const first = await resolveRoomLiveMedia(media);
  if (first.url) return first;
  if (Date.now() - started > 2500) return first;
  await new Promise((resolve) => setTimeout(resolve, 400));
  return resolveRoomLiveMedia(media);
}

function roomMedia(item: RoomMessageWire): RoomMedia | null {
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

  // 送礼消息（粉丝给偶像送礼）不是媒体附件，直接跳过；但成员回复礼物/消息（带 REPLY / giftReplyInfo 等）绝不能拦截
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

  // 成员回复消息的专属语音快速通道：直接从官方结构读取 voiceUrl/audioUrl/voiceInfo 等字段。
  // ⚠️ 只有明确是语音/音频类型或存在 voiceInfo/audioInfo 容器时才走这里；
  // 否则图片消息的顶层 url 会被误判成语音（用户反馈：房间图片变成语音卡片）。
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
    // Fallback: try collecting all URLs from parsed media containers.
    // ⚠️ 不再扫描原始 item：其中 extInfo 是序列化 JSON 字符串，正则会把 ext.user.avatar
    // （成员公式照等）误当图片附件——徐钰涵每条文字消息带公式照的根因。
    // ext 已 parseObject（avatar/headImg/picPath 等键被 collectUrls 跳过），body 是消息正文，
    // 两者都不会泄漏头像。
    if (!url && !liveId) {
      const allUrls: string[] = [];
      collectUrls(ext, allUrls);
      collectUrls(body, allUrls);
      if (replyInfo) collectUrls(replyInfo, allUrls);
      url = allUrls.find((u) => u && /^https?:\/\//i.test(u)) || '';
    }
    // Fallback: if still no url but body/text itself contains a URL (typed link), use it
    if (!url && !liveId) {
      const rawUrls: string[] = [];
      collectUrls(ext, rawUrls);
      collectUrls(body, rawUrls);
      if (replyInfo) collectUrls(replyInfo, rawUrls);
      const textMatch = String(text || '').match(/(https?:\/\/[^\s]+)/i);
      if (textMatch) rawUrls.push(textMatch[1]);
      url = rawUrls.find((u) => u && /^https?:\/\//i.test(u)) || '';
    }
    // Still no URL? Check if text IS a media indicator
    if (!url && !liveId) {
      const t = String(text || '').toLowerCase();
      if (
        t.includes('[图片]') ||
        t.includes('[语音]') ||
        t.includes('[视频]') ||
        t.includes('[链接]') ||
        t.includes('[直播]')
      ) {
        // Y20: 占位文本不是可播放媒体——return null 走普通文本气泡，
        // 不再把 '[图片]'/'[直播]' 当 url（此前 classifyMedia 后渲染成破图/误调 Linking）
        return null;
      }
    }
    // 兜底：若识别出的 url 恰好等于发送者的队标，说明是把身份徽章当成了消息内容 —— 不渲染。
    // （`collectUrls` 的 skipKeys 已跳过队标键；这里再挡一层，防其它路径漏进来。）
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
  // 诊断：audio/video 取不到时长时，dump 真实字段名（DEV 限频）
  if ((type === 'audio' || type === 'video') && !duration) {
    diagDurationFields(type, [replyInfo, body, ext, item]);
  }
  // Audio/video 在房间里只用两个字前缀，避免「语音 语音消息」这种重复；live 保留完整标签
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
  // 拼 https://source.48.cn 前缀（thumbPath 是相对路径，normalizeUrl 不会拼，需单独处理）。
  // 退而求其次再用 coverUrl/coverPath/cover/liveCover/picPath 等绝对地址字段。
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
    else if (!s.startsWith('[')) cover = normalizeUrl(s); // 非占位文本
  }
  // 封面字段已在上方优先 thumbPath/cover 等绝对地址字段；fix7u 已确认服务端对房间视频消息不回独立 cover 字段
  // （fix7t 的 [diag:cover2] 全量扫描证明 finalCover 恒为空，仅 ext.user.avatar 误命中），故无 cover 时一律走首帧。

  // 消息/卡片本身已明示「回放/录播」时，播放器应走「可拖进度条的录播模式」，
  // 而不是仅凭 .flv/.m3u8 后缀误判成直播（回放地址常见 HLS/FLV 形态）。
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

function playerSource(url: string) {
  // 与小窗 MiniPlayer 完全一致的防盗链 headers（含 Origin）——fix7u：统一播放器配置，消除封面/放大视频与小窗的方向差异
  return {
    uri: url,
    headers: {
      'User-Agent': USER_AGENT,
      Referer: 'https://h5.48.cn/',
      Origin: 'https://h5.48.cn',
    },
  };
}

// 自适应宽高比的视频容器：监听 react-native-video onLoad 取 naturalSize，
// 用真实宽高比驱动容器 aspectRatio，避免硬编码高度把竖屏 9:16 / 横屏 16:9 / 方屏 1:1 视频全部压扁或上下拉黑出现"上下两条"。
// - 默认 16:9，避免第一帧 onLoad 之前视觉塌陷
// - maxHeight 防止异常长方形视频挤爆消息气泡
// - borderRadius / backgroundColor 与 inlineVideo 旧样式一致
// ExoPlayer 解析的真实 duration（秒）回填角标。探测 Video 不显示画面，不受旋转影响。
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
  // 全局时长缓存：同一条语音重渲染/滚回列表时不再重复探测（探测 Video 每次创建 Exo 实例，数量一多必然失败）
  const cachedDur = media.url ? ROOM_DUR_CACHE.get(media.url) : '';
  const [resolvedDur] = useState(media.duration || cachedDur || '');
  const [coverError, setCoverError] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const hasCover = !!media.cover && !coverError;
  // 封面（fix7y 回退）：放弃自动播放/方向修正实验，恢复原始静止首帧封面（paused <Video> 首帧 + 灰占位过渡态）。
  // 服务端不回独立封面字段这一事实未变，且 Android ExoPlayer 对带方向元数据的视频在暂停首帧下会镜像——
  // 用户确认「修不好」，故回退到「有画面、静止、不播放」的原始行为，不再尝试修正方向。
  return (
    <TouchableOpacity
      style={styles.videoCoverWrap as any}
      onPress={onPress}
      onLongPress={onLongPress}
      activeOpacity={0.9}
      accessibilityLabel={t('视频')}
    >
      {hasCover ? (
        <Image
          source={{ uri: media.cover }}
          style={styles.videoCoverImg as any}
          resizeMode="cover"
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

// 直播/录播封面图：加载失败（source.48.cn 移动端偶发被拒）时回退灰底，避免破图/空白块
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

// 音频消息卡片。消息体里没有 duration 字段（实测只有 msgTime 时间戳），时长只能靠播放器解析。
// 内部用隐藏探测 Video（1px 透明、不可见）拿 ExoPlayer 真实 duration 回填角标，与 VideoCoverCard 同机制。
function AudioMediaCard({
  media,
  palette,
  onPlay,
  onLongPress,
  playing,
}: {
  media: RoomMedia;
  palette: Palette;
  onPlay: () => void;
  onLongPress: () => void;
  playing: boolean;
}) {
  // 命中缓存直接用（滚回列表/重渲染不重复探测）
  const cachedDur = media.url ? ROOM_DUR_CACHE.get(media.url) : '';
  const [resolvedDur, setResolvedDur] = useState(media.duration || cachedDur || '');
  // 主路径：原生 MediaMetadataRetriever 读时长（不起播放器，稳定、快）
  useEffect(() => {
    if (resolvedDur || !media.url) return;
    let alive = true;
    probeMediaDurationSeconds(media.url).then((sec) => {
      if (!alive || !(sec > 0)) return;
      const s = String(Math.round(sec));
      ROOM_DUR_CACHE.set(media.url, s);
      setResolvedDur(s);
    });
    return () => {
      alive = false;
    };
  }, [media.url, resolvedDur]);
  const card = (
    <TouchableOpacity
      // 语音播放卡玻璃化（用户要求）：任何人（含房主/自己）一律 GlassSurface，
      // 与房间文本气泡同语言；此前「idol/mine 粉实底」分支让房主语音卡与深色气泡割裂，已废
      style={[styles.mediaCard, { backgroundColor: 'transparent', borderWidth: 0, marginTop: 0 }]}
      activeOpacity={0.92}
      onLongPress={onLongPress}
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
        <Text style={[styles.mediaIcon, { color: palette.tint }]}>{t(mediaLabel(media.type))}</Text>
        {media.type !== 'audio' && media.type !== 'video' && media.title ? (
          <Text style={[styles.mediaTitle, { color: palette.label }]} numberOfLines={2}>
            {media.title}
          </Text>
        ) : null}
        {resolvedDur ? (
          <Text style={[styles.mediaDuration, { color: palette.labelSecondary }]}>
            {resolvedDur}s
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
        onPress={onPlay}
        activeOpacity={0.85}
      >
        <MaterialCommunityIcons
          name={playing ? 'pause' : 'play'}
          size={14}
          color={palette.onTint}
        />
        <Text style={[styles.mediaPlayText, { color: palette.onTint }]}>
          {playing ? t('暂停') : resolvedDur ? `${resolvedDur}s` : t('播放')}
        </Text>
      </TouchableOpacity>
      {/* 隐藏探测 Video：只在未知时长时挂载（解析完立即卸载，避免同屏几十个 Exo 实例互相抢资源） */}
      {!resolvedDur && media.url ? (
        <Video
          source={playerSource(media.url)}
          style={{ width: 1, height: 1, opacity: 0, position: 'absolute', top: -9999, left: -9999 }}
          paused
          controls={false}
          resizeMode="cover"
          muted
          onLoad={(data: OnLoadData) => {
            const d = Number(data?.duration || 0);
            if (d > 0) {
              const sec = String(Math.round(d));
              if (media.url) ROOM_DUR_CACHE.set(media.url, sec);
              setResolvedDur(sec);
            }
          }}
        />
      ) : null}
    </TouchableOpacity>
  );
  return (
    <GlassSurface radius={14} role="card" style={{ marginTop: 8, alignSelf: 'flex-start' }}>
      {card}
    </GlassSurface>
  );
}

/** 房间语音时长缓存（url → "秒"）：探测结果全局复用，避免重复创建 Exo 实例 */
const ROOM_DUR_CACHE = new Map<string, string>();

/** 资料卡头像尺寸（与 styles.userCardAvatar 同步；头像框叠加按此放大） */
const USER_CARD_AVATAR_SIZE = 64;

/** 消息头像尺寸（与 styles.avatar 同步） */
const ROOM_AVATAR_SIZE = 40;

/** 发送者头像框：官方消息 ext.user.pfUrl / headFrame / pictureFrame（badge[] 是勋章图，**不是**头像框，
 * 此前优先取 badge 把粉丝勋章画成了头像框 —— 用户反馈「头像框被当成勋章、勋章被当成头像框」） */

// 时长归一逻辑：详见 src/utils/mediaDuration.ts（findMediaDurationSeconds）。
// 该工具按字段名区分秒/毫秒，过滤掉「time」「seconds」等与时长无关的宽泛字段。

/**
 * Chat 的 listProps 把 onScroll 声明成 Reanimated 事件（去掉 nativeEvent、把
 * contentOffset 提到顶层），而 onScrollEndDrag/onMomentumScrollEnd 仍是原生事件。
 * 同一个处理器同时挂到两者上，故用联合类型分别读取两种结构。
 */
type RoomChatListScrollEvent =
  | NativeSyntheticEvent<NativeScrollEvent>
  | { readonly eventName?: string; readonly contentOffset?: { readonly y?: number } };

export default function FollowedRoomsScreen() {
  const insets = useSafeAreaInsets();
  const palette = usePalette();
  /** 模糊背板（房间工具条的 BlurView 需要它才有真模糊） */
  const blurTarget = useBlurTarget();
  const resolvedTheme = useResolvedTheme();
  const { t } = useI18n();
  const token = useSettingsStore((state) => state.settings.p48Token);
  const sendBubbleId = useSettingsStore((state) => state.settings.yaya_send_bubble_id);
  const setDockHidden = useUiStore((state) => state.setTabBarHidden);
  const setTabBarHidden = useCallback(
    (hidden: boolean) => setDockHidden(hidden, 'Rooms'),
    [setDockHidden],
  );
  const showToast = useUiStore((state) => state.showToast);
  const setScreenBackdrop = useUiStore((state) => state.setScreenBackdrop);
  const navigation = useNavigation<StackNavigationProp<RootStackParamList>>();
  const members = useMemberStore((state) => state.members);
  // 成员库 id 集合：「成员消息」视图要把别的成员（非房主）也算成员消息（用户要求）
  const memberIdSet = useMemo(() => buildMemberIdSet(members), [members]);
  const onMicMap = useOnMicStore((state) => state.onMic);
  const voiceRooms = useOnMicStore((state) => state.voiceRooms);
  const [followed, setFollowed] = useState<FollowedRoom[]>([]);
  const followedRef = useRef<FollowedRoom[]>([]);
  followedRef.current = followed;
  const [followedLoading, setFollowedLoading] = useState(false);
  // 直播状态：ids=直播中主播 id 集合，names=直播中昵称集合（接口字段不一，昵称兜底）
  const [liveNow, setLiveNow] = useState<{ ids: Set<string>; names: Set<string> }>({
    ids: new Set(),
    names: new Set(),
  });
  // 最新直播状态 ref：异步回调 / 30s 轮询里读它，避免闭包拿到过期 liveNow（会把已点亮的直播状态清空）
  const liveNowRef = useRef<{ ids: Set<string>; names: Set<string> }>({
    ids: new Set(),
    names: new Set(),
  });
  liveNowRef.current = liveNow;
  const liveEmptyTicksRef = useRef(0);
  const [pinned, setPinned] = useState<string[]>([]);
  // 置顶列表 ref + 写入队列：快速连续点置顶/上移下移时，异步落盘必须串行，否则旧快照后写会覆盖新状态
  const pinnedRef = useRef<string[]>([]);
  const pinnedWriteRef = useRef<Promise<void>>(Promise.resolve());
  const [selectedRoom, setSelectedRoom] = useState<Member | null>(null);
  // 从房间列表进入具体房间：页面整体做一次轻量上滑淡入（不参与 Dock 的 pager 动画）
  const roomEnter = useSharedValue(0);
  const roomEnterStyle = useAnimatedStyle(() => ({
    opacity: roomEnter.value,
    transform: [{ translateY: (1 - roomEnter.value) * 14 }],
  }));
  useEffect(() => {
    if (selectedRoom) {
      roomEnter.value = 0;
      roomEnter.value = withTiming(1, { duration: 220 });
    }
  }, [selectedRoom, roomEnter]);
  const [roomMessages, setRoomMessages] = useState<RoomMessage[]>([]);
  // 内存消息缓存：按 channelId + 模式（all / idol）缓存最近消息，进房秒开（0ms 呈现），后台静默补新
  const roomMessagesCache = useRef<Record<string, RoomMessage[]>>({});
  // 持有一份最新 roomMessages 引用，供 refreshRoomMessages 预判「是否有新消息」而无需把 roomMessages 列入 deps（避免定时器频繁重建）
  const roomMessagesRef = useRef<RoomMessage[]>([]);
  roomMessagesRef.current = roomMessages;
  // 最近一次收到「本频道」QChat 推送的时间：长时间没有推送就补订一次频道（不影响 2s 持续刷新）
  const lastRoomPushAtRef = useRef(0);
  // 推送到达计数：只在前几次写运行日志，用来判断长连接到底通没通（导出日志可查）
  const roomPushCountRef = useRef(0);
  // 键盘高度：edge-to-edge 下 adjustResize 失效，手动抬升房间容器 —— 消息列表 + 输入框整体上移
  const roomKeyboardHeight = useKeyboardHeight();
  const [loading, setLoading] = useState(false);
  // 标记「房间消息已成功加载过一次」。仅用它来压制进房/切房间切换瞬间的「暂无消息」空态——
  // 比单纯依赖 loading 更可靠（不依赖 React 批处理时序）。切换/进房期间恒为 false，绝不闪空态；
  // 加载成功返回（即便为空数组）才置 true，此时才允许显示「暂无消息」真实空态。
  const [, setRoomLoadedOnce] = useState(false);
  // 切换房间瞬间的「干净中间态」：true 时列表区只渲染骨架，既不显示旧房间残留消息、也不显示空态。
  // 进新房间的第一帧立刻置 true，新消息 setRoomMessages 后置 false → 彻底消除旧房间内容闪一帧。
  const [followedError, setFollowedError] = useState('');
  const [, setRoomMsgError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [roomSearchQuery, setRoomSearchQuery] = useState('');
  const [roomSearchOpen, setRoomSearchOpen] = useState(false);
  const [roomMode, setRoomMode] = useState<RoomMode>('big');
  const [showFanMessages, setShowFanMessages] = useState(false);
  useEffect(() => {
    if (activeChannelRef.current && roomMessages.length > 0) {
      const cacheKey = `${activeChannelRef.current}_${showFanMessages ? 'all' : 'idol'}`;
      roomMessagesCache.current[cacheKey] = roomMessages;
    }
  }, [roomMessages, showFanMessages]);
  const [playingMedia, setPlayingMedia] = useState<RoomMedia | null>(null);
  const [roomNextTime, setRoomNextTime] = useState(0);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  /**
   * 是否贴着最新消息（inverted 列表 offset≈0）。
   * false = 用户在上划看历史：**冻结列表数据**，新消息只计数不插进来，
   * 这样才能像 QQ 那样「你翻你的，新消息等着你」，不会被 2s 轮询反复拽回底部。
   */
  const [roomAtBottom, setRoomAtBottom] = useState(true);
  /**
   * 冻结锚点：开始上划那一刻的「最新一条」消息 id。
   * 只冻结比它**更新**的消息（列表头部），比它更旧的历史照常进列表 ——
   * 这样上滑触发的「加载更多」不会被冻住看不到。
   */
  const [roomFreezeKey, setRoomFreezeKey] = useState<string | null>(null);
  const roomLatestImsRef = useRef<RoomChatIM[]>([]);
  const roomAtBottomRef = useRef(true);
  /** 「回到底部」气泡：列表 ref（按下即滚，不依赖库内部状态） */
  // 第三方 Chat 库把 messagesContainerRef 声明为 RefObject<AnimatedList<RoomChatIM>>，
  // 其中 AnimatedList 是组件类型而非实例类型，无法安全构造，保留 any 适配。
  const roomListRef = useRef<any>(null);
  // 房间内展示：房间名（channelInfo.channelName）+ 背景图（channelInfo.bgImg）
  const [roomMeta, setRoomMeta] = useState<{ name: string; bg: string }>({ name: '', bg: '' });
  const roomMetaCache = useRef<Record<string, { name: string; bg: string }>>({});
  /**
   * 把上次持久化的房间名/背景灌进内存缓存。
   * 原来这份映射纯内存，App 重启后再进房间标题是空的、背景先白一下 —— 用户反馈
   * 「房间背景和名字应该本地缓存」。灌进去之后进房间第一帧就有名字和背景（图本体在 roomBgCache 里）。
   * 只补空缺：本次已拉到的（更新）优先。
   */
  useEffect(() => {
    let alive = true;
    loadRoomMetaCache()
      .then((saved) => {
        if (!alive) return;
        Object.keys(saved).forEach((cid) => {
          if (roomMetaCache.current[cid] === undefined) roomMetaCache.current[cid] = saved[cid];
        });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  // 背景图渐显：新背景 uri 变化时重置为 0，ImageBackground onLoad 后淡入到 1，消除「从无到有硬跳变」
  /**
   * 背景图 **双层常驻 crossfade**（用户反馈：大小房间切换底图会闪一下）。
   *
   * 旧做法「新图新挂载一层 + 旧图垫底」的问题是：新挂载的 Image 首帧必然空白
   * （哪怕图在磁盘缓存，解码也要 1-2 帧），垫底层反而来不及兜 → 还是闪。
   *
   * 标准做法：A/B 两层**永远挂载**，换图时把新 uri 写进**当前隐藏的那一层**
   * （隐藏层保留着旧帧，不会白屏），等它 onLoad（解码完成）后两层交叉淡入淡出。
   * 同一张图则什么都不做 —— 对同一 uri 归零 opacity 就是「闪一下」的直接来源。
   */
  const bgOpacityA = useRef(new Animated.Value(0)).current;
  const bgOpacityB = useRef(new Animated.Value(0)).current;
  const [bgLayerA, setBgLayerA] = useState('');
  const [bgLayerB, setBgLayerB] = useState('');
  /** 槽位 uri 镜像 ref：setState 同值不会重渲染/onLoad，必须用 ref 判断「槽里已是什么」 */
  const bgLayerARef = useRef('');
  const bgLayerBRef = useRef('');
  const setBgLayer = (slot: 'A' | 'B', uri: string) => {
    if (slot === 'A') {
      bgLayerARef.current = uri;
      setBgLayerA(uri);
    } else {
      bgLayerBRef.current = uri;
      setBgLayerB(uri);
    }
  };
  const bgTopIsARef = useRef(true);
  const bgLastUriRef = useRef('');
  /** 待淡入的槽位（该槽 onLoad 后执行交叉淡入淡出） */
  const bgPendingFadeRef = useRef<'A' | 'B' | null>(null);

  /** 交叉淡入淡出：target 槽 0→1（280ms），另一槽延迟归 0；翻转顶层标记 */
  const crossfadeTo = useCallback(
    (slot: 'A' | 'B') => {
      const inVal = slot === 'A' ? bgOpacityA : bgOpacityB;
      const outVal = slot === 'A' ? bgOpacityB : bgOpacityA;
      Animated.timing(inVal, { toValue: 1, duration: 280, useNativeDriver: true }).start();
      Animated.timing(outVal, {
        toValue: 0,
        duration: 280,
        delay: 120,
        useNativeDriver: true,
      }).start();
      bgTopIsARef.current = slot === 'A';
    },
    [bgOpacityA, bgOpacityB],
  );

  useEffect(() => {
    const next = roomMeta.bg;
    const last = bgLastUriRef.current;
    bgLastUriRef.current = next;
    if (next === last) return; // 同一张图：绝不能动 opacity（归零 = 闪）

    if (!next) {
      // 切到无背景房间：两层一起淡出，露出全局底衬
      Animated.parallel([
        Animated.timing(bgOpacityA, { toValue: 0, duration: 200, useNativeDriver: true }),
        Animated.timing(bgOpacityB, { toValue: 0, duration: 200, useNativeDriver: true }),
      ]).start();
      bgPendingFadeRef.current = null;
      return;
    }

    // 换图：写进「非顶层」槽。⚠️ 状态机死角修复：若目标槽**已经装着同一张图**
    //（A→B→A 来回切时必现），setState 同值不触发重渲染/onLoad → 交叉淡入永远不执行，
    // 背景停在旧房间的图（用户反馈「大小切换不过来」）—— 此时该图早已解码完成，直接交叉淡入。
    const targetSlot: 'A' | 'B' = bgTopIsARef.current ? 'B' : 'A';
    const targetUri = targetSlot === 'A' ? bgLayerARef.current : bgLayerBRef.current;
    if (targetUri === next) {
      bgPendingFadeRef.current = null;
      crossfadeTo(targetSlot);
      return;
    }
    setBgLayer(targetSlot, next);
    bgPendingFadeRef.current = targetSlot;
  }, [roomMeta.bg, bgOpacityA, bgOpacityB, crossfadeTo]);

  /** 槽位 onLoad：若它是待淡入槽 → 交叉淡入淡出 */
  const onBgSlotLoad = useCallback(
    (slot: 'A' | 'B') => {
      if (bgPendingFadeRef.current === slot) {
        bgPendingFadeRef.current = null;
        crossfadeTo(slot);
      }
    },
    [crossfadeTo],
  );

  /** 槽位加载失败：放弃本次待淡入（保留当前可见背景，不闪不黑） */
  const onBgSlotError = useCallback((slot: 'A' | 'B') => {
    if (bgPendingFadeRef.current === slot) bgPendingFadeRef.current = null;
  }, []);
  const activeChannelRef = useRef('');
  /**
   * 当前房间的「发言坐标」配对（channelId + serverId + 房主 id）。
   * ⚠️ 发言必须整体取自这里，不能 activeChannelRef（新房间）配 selectedRoom（旧房间）：
   * 切房那一瞬间两者不同步，拼出来的 serverId(旧)+channelId(新) 会把消息发到**错误的房间**
   * ——用户反馈的「有概率发送错误信息」。
   */
  const activeRoomRef = useRef<{ channelId: string; serverId: string; memberId: string }>({
    channelId: '',
    serverId: '',
    memberId: '',
  });
  const roomSeqRef = useRef(0); // Y22: 进房序号（快速切房丢弃慢响应）
  const msgListRef = useRef<{
    scrollToOffset?: (params: { offset: number; animated?: boolean }) => void;
  } | null>(null);
  // 大/小房间滑动位置【各自分开记忆】：key = channelId（大小房间 channelId 不同 → 天然分离），
  // 切回某房间数据到位后恢复到该房间上次位置；无记忆（首次）才停在顶部最新。
  const scrollPosCache = useRef<Record<string, number>>({});
  // 消息列表 ref：开房/大小房间切换数据到位后滚回顶部（最新消息）——
  // 否则旧房间滚动 offset 套到新房间数据上「滑动位置不对」（用户反馈）

  const [loadingMoreMessages, setLoadingMoreMessages] = useState(false);
  const loadingMoreMessagesRef = useRef(false);
  // 实时刷新进行中标志：与 loadMore 互斥，避免两者同时 setRoomMessages 造成列表重排/滚动弹回
  const refreshingRef = useRef(false);
  const [currentUserId, setCurrentUserId] = useState('');
  /**
   * 云信会话世代：切号 / 换号后 +1。
   * 换号后「我是谁」也变了 —— 旧的 currentUserId 会让自己的消息被判成别人
   * （气泡左右、身份徽标全错），同时实时通道要按新账号重连。
   */
  const [nimEpoch, setNimEpoch] = useState(getNimSessionEpoch);
  useEffect(
    () =>
      subscribeNimSession((epoch) => {
        setNimEpoch(epoch);
        setCurrentUserId('');
      }),
    [],
  );
  // 会话重置（切号）清空 currentUserId 后补拉一次：否则「自己的消息」判定没有 id，
  // 房间里自己发的消息会被排到左侧（气泡方向/身份徽标全错）
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
  const [fullImageUrl, setFullImageUrl] = useState('');
  const [roomPlayer, setRoomPlayer] = useState<RoomMedia | null>(null);
  const roomPlayerRef = useRef(roomPlayer);
  roomPlayerRef.current = roomPlayer;
  const hidePlayerEffects = usePlayerStore((s) => s.hideEffects || s.cleanScreen);
  const playerCleanScreen = usePlayerStore((s) => s.cleanScreen);
  const roomPlaybackState = usePlayerStore((s) => s.state);
  /** 房间播放器视频真实宽高（PlayerScreen onVideoSize）：交棒小窗时带上，小窗立即按比例适配 */
  const roomVideoAspectRef = useRef<{ w: number; h: number } | null>(null);
  const [roomPlayerFullscreen, setRoomPlayerFullscreen] = useState(false);
  const roomPlayerFullscreenRef = useRef(false);
  useEffect(() => {
    roomPlayerFullscreenRef.current = roomPlayerFullscreen;
  }, [roomPlayerFullscreen]);

  /**
   * ⚠️【玻璃折射】把房间背景图挂进 blur 目标层。
   * 玻璃（BlurView）只折射 BlurTargetSurface 那一层（全局软件背景），
   * 而房间自己的背景图渲染在页面里、在那层之外 —— 不挂的话房间里的玻璃
   * 折射的是全局背景图而不是房间背景（用户反馈）。
   * 失焦（切 tab）/ 关房间时清 null，还原全局背景。
   */
  useFocusEffect(
    useCallback(() => {
      // 等 Tab pager 的切换动画结束再换房间背景，避免房间大图解码和转场抢主线程。
      // 不用 InteractionManager（RN 0.83 已 deprecated），用短定时器等价 defer。
      let cancelled = false;
      const timer = setTimeout(() => {
        if (cancelled) return;
        setScreenBackdrop(
          selectedRoom && roomMeta.bg
            ? {
                uri: roomMeta.bg,
                scrim: resolvedTheme === 'dark' ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.42)',
              }
            : null,
        );
      }, 240);
      return () => {
        cancelled = true;
        clearTimeout(timer);
        setScreenBackdrop(null);
      };
    }, [selectedRoom, roomMeta.bg, resolvedTheme, setScreenBackdrop]),
  );
  // 直播弹幕：页面浮层 + 播放器底坞输入条共用同一条云信连接（避免重复建连）
  const roomBarrageLiveId =
    roomPlayer?.isLive && roomPlayer.liveId ? String(roomPlayer.liveId) : '';
  const roomBarrage = useLiveBarrage({
    liveId: roomBarrageLiveId,
    enabled: !!roomBarrageLiveId,
    module: 'live',
  });
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
  /**
   * 房间内直播在播 → 登记 PiP 播放态。
   * ⚠️ 此前只有 MiniPlayer / FullscreenManager / MediaScreen 三处登记，
   * 房间里的直播窗口没登记 → MainActivity.onUserLeaveHint 判定 videoPlaying=false
   * → 按 Home/退到桌面**不会进系统小窗**（用户反馈「退出没系统小窗」）。
   */
  useEffect(() => {
    const on = !!roomPlayer?.isLive && !!roomPlayer?.url && roomPlaybackState === 'playing';
    setPipPlaying(on, 'roomlive');
    return () => setPipPlaying(false, 'roomlive');
  }, [roomPlayer?.url, roomPlayer?.isLive, roomPlaybackState]);
  /** 弹幕列表抽屉（房间内直播弹幕）：与飘屏/输入条共用同一条云信连接的数据 */
  const [showRoomDanmakuList, setShowRoomDanmakuList] = useState(false);
  const [showRoomDanmakuSettings, setShowRoomDanmakuSettings] = useState(false);

  /** 系统画中画（PiP）状态：与 Media 页一致，进小窗时隐藏播放器 chrome */
  const [inRoomSystemPip, setInRoomSystemPip] = useState(false);
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('PipEnteredChanged', (entered: boolean) => {
      setInRoomSystemPip(!!entered);
      if (!entered) setRoomPlayerFullscreen((v) => v);
    });
    return () => sub.remove();
  }, []);

  /** 礼物全屏特效（与 Media 页一致：别人送的与自己送的都播） */
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
  // 房间发言（云信圈组）：草稿 + 发送中 + 错误提示
  const [roomDraft, setRoomDraft] = useState('');
  /** 回复目标：长按消息 → 回复；发送后清空（字段同官方 replyInfo） */
  const [replyTarget, setReplyTarget] = useState<{
    replyMessageId: string;
    replyName: string;
    replyText: string;
  } | null>(null);
  /** 房间精华消息（成员在官方端设为精华，服务端存储，全员可见） */
  const [roomEssences, setRoomEssences] = useState<RoomMessageWire[]>([]);
  /** 消息长按操作面板（自绘圆角，替代原生 Alert） */
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
  const [roomSending, setRoomSending] = useState(false);
  const [roomSendHint, setRoomSendHint] = useState('');
  const [stickerPanelOpen, setStickerPanelOpen] = useState(false);
  const { width: roomWidth, height: roomHeight } = useWindowDimensions();
  const roomLandscape = roomWidth > roomHeight;
  // C5 双栏判定：宽 ≥720dp 且横屏 → 房间内双栏；竖屏/窄屏保持单栏（S1 hook 复用）。
  // 必须放在组件所有早退（selectedRoom 分支）之前。
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
  /** 直播解析占位：点击无流地址的直播卡 → 立即弹全屏「解析中」，不再干等无反馈（连击才加载进去的元凶） */
  const [liveResolve, setLiveResolve] = useState<null | {
    key: string;
    error: string;
    media: RoomMedia;
  }>(null);
  const liveResolveToken = useRef(0);

  const [rankVisible, setRankVisible] = useState(false);
  // 房间直播送礼（与 Media 页同 API；roomPlayer 面板此前漏接）
  const [giftVisible, setGiftVisible] = useState(false);
  const [giftStatus, setGiftStatus] = useState('');
  const [giftBalance, setGiftBalance] = useState('');
  const [giftList, setGiftList] = useState<GiftRow[]>([]);
  const [giftSel, setGiftSel] = useState<GiftRow | null>(null);
  const [giftNum, setGiftNum] = useState(1);
  /** 礼物面板模式：live=直播送礼（roomPlayer.liveId，businessCode 按直播类型）；room=房间送礼（无直播，businessCode=5） */
  const [giftMode, setGiftMode] = useState<'live' | 'room'>('live');
  /** 房间送礼目标（team/room/info → channelInfo.ownerId） */
  const [giftTarget, setGiftTarget] = useState<null | {
    serverId: string;
    channelId: string;
    memberId: string;
    memberName: string;
  }>(null);
  const [rankRows, setRankRows] = useState<LiveRankItem[]>([]);
  const [rankStatus, setRankStatus] = useState('');
  /** 贡献榜请求在途：此前无 loading 态 → 点开面板先看到一片空白（只有标题+关闭），像卡住 */
  const [rankLoading, setRankLoading] = useState(false);
  /**
   * 用户资料卡：房间内点「非成员」头像（粉丝）时弹出。
   * 成员（含房主）直接跳「成员档案」页 —— 见 openSenderProfile。
   */
  const [userCard, setUserCard] = useState<null | {
    id: string;
    name: string;
    avatar: string;
    loading: boolean;
    error: string;
    /** 关注态（口袋48 用户间可互相关注：friendships/friends/add|remove, toType=1） */
    following: boolean;

    mutual: boolean;
    followBusy: boolean;
    /** 成员（含房主）走同一个资料卡界面，只是多加身份/队伍行 */
    isMember: boolean;
    /** 成员库 id（仅成员有）：资料卡「主页」按钮跳 ProfileScreen 用 */
    memberDbId: string;
    /** 头像框地址（user/info/home 泛匹配；拿不到为空，不渲染） */
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
  /** 资料卡请求序号：连点不同头像时丢弃旧响应（避免慢响应覆盖新卡） */
  const userCardSeqRef = useRef(0);
  const [followedIds, setFollowedIds] = useState<Set<string>>(new Set());
  const [followBusy, setFollowBusy] = useState<Set<string>>(new Set());
  // 用 ref 持有最新值，避免 toggleFollow 的 useCallback 闭包捕获到过期的 followedIds/followBusy
  const followedIdsRef = useRef(followedIds);
  const followBusyRef = useRef(followBusy);
  followedIdsRef.current = followedIds;
  followBusyRef.current = followBusy;
  // loadFollowed 定义在 toggleFollow 之后，用 ref 持有以避免前向引用报错
  const loadFollowedRef = useRef<(silent?: boolean) => void>(() => {});
  /** loadFollowed 在途序号（并发时只认最新一次的结果） */
  const loadFollowedSeqRef = useRef(0);

  useFocusEffect(
    useCallback(() => {
      setTabBarHidden(!!selectedRoom || !!roomPlayer);
      return () => {
        setLiveImmersiveMode(false);
        ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
      };
    }, [roomPlayer, selectedRoom, setTabBarHidden]),
  );

  useEffect(() => {
    if (!selectedRoom) {
      setRoomPlayer(null);
      setLiveImmersiveMode(false);
      setRoomPlayerFullscreen(false);
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    }
    return () => {
      setLiveImmersiveMode(false);
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    };
  }, [selectedRoom]);

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
      // ⚠️ 失焦的 tab 页仍持有订阅：切到别的 tab 后按返回会关掉后台房间而不是当前页（修复）
      if (!navigation.isFocused()) return false;
      // 返回键先收键盘（房间评论框展开中）
      if (Keyboard.isVisible()) {
        Keyboard.dismiss();
        return true;
      }
      if (roomPlayerFullscreenRef.current) {
        setRoomPlayerFullscreen(false);
        setLiveImmersiveMode(false);
        ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
        setTabBarHidden(!!selectedRoom);
        return true;
      }
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
  }, [navigation, roomPlayer, selectedRoom, setTabBarHidden]);

  const closeRoomPlayer = useCallback(() => {
    setRoomPlayer(null);
    setRoomPlayerFullscreen(false);
    setLiveImmersiveMode(false);
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    setTabBarHidden(!!selectedRoom);
  }, [selectedRoom, setTabBarHidden]);

  // 应用内小窗：房间播放器交棒给悬浮小窗
  const openRoomGiftPanel = useCallback(async () => {
    const liveId = String(roomPlayer?.liveId || '');
    setGiftVisible(true);
    setGiftStatus('');
    setGiftSel(null);
    setGiftNum(1);
    setGiftTarget(null);
    // 无 liveId → 房间送礼模式（businessCode=5，收礼人 = 房间 ownerId）
    if (!liveId) {
      setGiftMode('room');
      try {
        // ⚠️ 坐标整体取自 activeRoomRef（与 handleSendRoomMessage 一致）：
        // selectedRoom.channelId/serverId 是「大房间」坐标，用户当前若在小房间（yklzId），
        // 用 selectedRoom 覆盖 target 会把大房间 channelId 拼上小房间的配对坐标 →
        // getMemberRoomGiftContext 校验 `info.serverId !== serverId` 抛「房间信息已变化」，
        // catch 里 setGiftList([]) → 面板只剩状态文字 = 「点了礼物没出现礼物列表」。
        const target = activeRoomRef.current;
        const channelId = String(target.channelId || '');
        let serverId = String(target.serverId || '');
        // 成员库缺失 serverId 时按 channelId 解析（与发言路径同一兜底）
        if (!serverId || serverId === '0') {
          serverId = await pocketApi.resolveRoomServerId(channelId).catch(() => '');
        }
        // 小房间 room/info 返回 2002（准入门槛）→ 送礼上下文改用成员「大房间」解析 ownerId/权限
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
      // 官方直播礼物面板参数是 {memberId, businessCode:1, liveId}；旧 businessId
      // 参数会漏掉「琴音生花」。先按直播场景取，空再回退旧参数。
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
      // 记分礼物（琴音生花等）仍需合并 giftType=2 分组兜底
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
    // selectedRoom 不再参与坐标（room 分支走 activeRoomRef），依赖里去掉避免无谓重生成
  }, [roomPlayer, selectedRoom, t]);

  const sendRoomGift = useCallback(async () => {
    if (!giftSel) {
      setGiftStatus(t('请先选择礼物'));
      return;
    }
    const num = Math.max(1, Math.floor(Number(giftNum) || 1));
    // 房间送礼（无直播）：businessCode=5 + sendToRoomId=channelId + businessId=serverId
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
        // 含「官方未确认有效赠送」等失败文案；网络异常时提示勿重复发送
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
      // 直播详情里的 crm（DES 加密的聊天室 id）——服务端靠它把礼物广播进直播间，缺失则成员端无感知
      let crm = '';
      try {
        const one = await pocketApi.getLiveOne(liveId);
        crm = String(one?.content?.crm || '');
      } catch {
        /* 拿不到 crm 时按官方空 crm 路径发送 */
      }
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

  /**
   * 房间发言（云信圈组 QChat）。
   *
   * 口袋48 的「房间消息」= 云信圈组频道消息：HTTP 侧只有历史列表，没有发送接口
   * （已实测 /im/api/v1/team/message/send 等候选全部 404），发送只能走云信。
   * 圈组仅官方 Android/iOS SDK 支持 → 走原生桥 PocketIm（PocketImModule.java）。
   */
  /** 拉取当前房间的精华消息（响应与房间历史同构：content.messageList[]） */
  const loadRoomEssences = useCallback(async (channelId: string) => {
    if (!channelId) {
      setRoomEssences([]);
      return;
    }
    setEssenceLoading(true);
    try {
      const res = await pocketApi.getEssenceMessages({ channelId });
      const list = unwrapList(res, [
        // 官方字段是 essenceMessageList（实测）；原先只认 messageList → 永远为空
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

  // 进房/切房：重置展开态并拉取该房间的精华消息
  const essenceChannelId = String(selectedRoom?.channelId || '');
  useEffect(() => {
    void loadRoomEssences(essenceChannelId);
    setStickerPanelOpen(false);
  }, [essenceChannelId, loadRoomEssences]);

  const handleSendRoomSticker = useCallback(
    async (sticker: RoomSticker) => {
      if (roomSending) return;
      const target = { ...activeRoomRef.current };
      if (!target.channelId) {
        setRoomSendHint(t('房间未就绪'));
        return;
      }
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
        // 自己发言后视口回到底部（否则冻结快照里看不到刚发的消息）
        roomAtBottomRef.current = true;
        setRoomAtBottom(true);
        setRoomFreezeKey(null);
        setTimeout(() => refreshRoomMessagesRef.current?.(), 500);
        setTimeout(() => refreshRoomMessagesRef.current?.(), 1500);
      } catch (err) {
        setRoomSendHint(errorMessage(err));
      } finally {
        setRoomSending(false);
      }
    },
    [roomSending, sendBubbleId, t],
  );

  const handleSendRoomMessage = useCallback(async () => {
    const text = roomDraft.trim();
    if (!text || roomSending) return;
    // 口袋48 房间发言要求先关注该成员：未关注直接提示，避免发送后才报错（用户反馈）
    const followId = String(selectedRoom?.id || selectedRoom?.userId || '');
    if (followId && !followedIdsRef.current.has(followId)) {
      setRoomSendHint(t('关注后才能发房间消息'));
      return;
    }
    // 发送坐标整体取自 activeRoomRef（channelId 与 serverId 配对的唯一来源）
    const target = activeRoomRef.current;
    const channelId = target.channelId;
    if (!channelId) {
      setRoomSendHint(t('房间未就绪'));
      return;
    }
    setRoomSending(true);
    setRoomSendHint('');
    try {
      // 圈组发送必须带 serverId：成员库缺失时先按 channelId 解析（否则云信返回 414 参数错误）
      let serverId = target.serverId;
      if (!serverId || serverId === '0') {
        serverId = await pocketApi.resolveRoomServerId(channelId).catch(() => '');
      }
      if (!serverId || serverId === '0') {
        throw new Error(t('缺少房间 serverId，无法发言'));
      }
      await sendRoomTextMessage({ serverId, channelId, bubbleId: sendBubbleId }, text, replyTarget);
      setRoomDraft('');
      setReplyTarget(null);
      // ⚠️ 自己发的消息立即上屏：QChat 回显链路不稳定，等 15s 轮询太久（用户反馈）。
      // 发送成功即静默拉最新页合并（mergeMessages 按 msgId 去重，与轮询同路径、不会重复）。
      setTimeout(() => refreshRoomMessagesRef.current?.(), 500);
      setTimeout(() => refreshRoomMessagesRef.current?.(), 1500);
    } catch (err) {
      setRoomSendHint(errorMessage(err));
    } finally {
      setRoomSending(false);
    }
  }, [
    roomDraft,
    roomSending,
    t,
    replyTarget,
    sendBubbleId,
    selectedRoom?.id,
    selectedRoom?.userId,
  ]);

  const handleRoomMiniPlayer = useCallback(() => {
    const cur = roomPlayer;
    if (!cur?.url) return;
    // 成员直播（口袋48 房间流 = rtmp/flv，见 resolveRoomLiveMedia）也能进小窗：
    // MiniPlayer 对 rtmp/.flv + isLive 的 url 渲染原生 LiveExoView（与大播放器同内核），
    // 录播/HLS 走 RNV Video —— 全部交 MiniPlayer 内部路由，不再全屏拦截。
    // 录播转小窗续播：读取当前播放位置（统一播放器 store 实时 position），
    // 传给小窗做 onLoad seek + backTo 供回大窗 Media 续播（此前写死 0 = 重头放）
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
    useMiniPlayerStore.getState().open({
      url: cur.url,
      title: cur.title,
      cover: cur.cover,
      isLive: !!cur.isLive,
      // 上麦/电台：小窗渲染为紧凑音频胶囊（不显示视频框）
      audioOnly: cur.type === 'audio',
      position: pos,
      // ⚠️ 带上大窗已知的视频宽高：小窗挂载即按比例适配，不再等 onLoad（拿不到就停在默认条）
      aspectW: roomVideoAspectRef.current?.w,
      aspectH: roomVideoAspectRef.current?.h,
      // ⚠️ 必须按实际类型回填：cur.isLive 为真时若写死 'vod'，回大窗会被当录播处理
      //（出现进度条/倍速，且拖动进度条 seek 直播流会触发原生闪退）。
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

  /** 房间内直播公告：进入房间直播时拉取，默认展开，可收起为左上角小按钮 */
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

  const closeRoom = useCallback(() => {
    // ⚠️ 自增房间序号：使在途的进房/轮询/加载更多响应全部作废（否则关房后旧响应仍会写状态）
    roomSeqRef.current += 1;
    setRoomPlayer(null);
    setRoomPlayerFullscreen(false);
    setPlayingMedia(null);
    setSelectedRoom(null);
    setScreenBackdrop(null); // 玻璃折射背景还原全局
    setRoomMeta({ name: '', bg: '' });
    activeChannelRef.current = '';
    activeRoomRef.current = { channelId: '', serverId: '', memberId: '' };
    setRoomDraft('');
    setRoomSendHint('');
    setLiveImmersiveMode(false);
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    setTabBarHidden(false);
  }, [setScreenBackdrop, setTabBarHidden]);

  /** 置顶状态统一出口：先同步内存/ref，再串行落盘（上一个写完成才写下一个，防止旧快照覆盖新状态） */
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

  /** 置顶成员调换：dir=-1 上移 / 1 下移（交换相邻置顶位） */
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
      // 关键：用 ref 读取最新关注状态，避免 useCallback 闭包捕获到过期的 followedIds，
      // 否则「已关注」状态下再次点击会误判为未关注而重复调用 followMember（表现为取消关注无效）
      const isFollowing = followedIdsRef.current.has(id);
      setFollowedIds((prev) => {
        const n = new Set(prev);
        if (isFollowing) n.delete(id);
        else n.add(id);
        return n;
      });
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
        // 让房间里的关注/取关结果立即反映到关注列表（无需回列表手动刷新）
        setFollowed((prev) => {
          const exists = prev.some((p) => String(p.memberId) === id);
          if (isFollowing) return prev.filter((p) => String(p.memberId) !== id);
          if (exists) return prev;
          return [{ memberId: id, member }, ...prev];
        });
        setTimeout(() => {
          loadFollowedRef.current(true);
        }, 600);
      } catch (e) {
        setFollowedIds((prev) => {
          const r = new Set(prev);
          if (isFollowing) r.add(id);
          else r.delete(id);
          return r;
        });
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
      /**
       * 在途序号：手动刷新、30s 轮询、切账号都会并发触发 loadFollowed，
       * 慢响应回来时会用旧数据覆盖新数据（列表倒退/闪回）。
       * 每次调用自增，回到主线程后比对，不是最新就直接丢弃。
       */
      const seq = ++loadFollowedSeqRef.current;
      if (!token) {
        setFollowed([]);
        setFollowedLoading(false);
        return;
      }
      setFollowedLoading(true);
      try {
        const idsRes = await pocketApi.getFollowedIds();
        if (seq !== loadFollowedSeqRef.current) return;
        const idsArr = unwrapList(idsRes, ['content.data', 'content', 'data', 'list']).map(String);
        setFollowedIds(new Set(idsArr));
        const followedMembers = idsArr
          .map((id: string) => {
            const member = matchFollowedMember(members, id);
            return { memberId: id, member };
          })
          .filter((item): item is { memberId: string; member: Member } => !!item.member?.channelId);
        const serverIds = followedMembers
          .map((item) => Number(item.member?.serverId || 0))
          .filter((id: number) => id > 0);
        // 小房间没有独立 serverId，用 yklzId（小房间 channelId）一起查询最新消息，
        // 否则小房间在列表里永远显示「暂无消息」
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
        setFollowed(
          followedMembers.map((item) => ({
            ...item,
            lastMessage: findLastMessage(lastMsgs, item.member),
            lastSmallMessage: findSmallLastMessage(lastMsgs, item.member),
          })),
        );
        // 上麦检测：扫描关注成员房间语音状态（静默，失败忽略）。结果写入 onMicStore 供
        // 房间列表「上麦中」徽标与房间内上麦按钮共用。
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
        // 首页/其它 tab 打开时不要在后台扫描全部关注房间（64 个任务会拖慢启动），
        // 等用户真正进入房间 tab 后再由刷新链路触发扫描。
        if (onMicInputs.length && navigation.isFocused()) {
          useOnMicStore.getState().scan(onMicInputs);
        }
        // 直播状态：拉取首页直播列表（非阻塞），按主播 id / liveRoomId / 昵称匹配关注成员点亮状态点
        pocketApi
          .getLiveList({ record: false, next: 0, size: 100 })
          .then((res: unknown) => {
            const liveItems = unwrapList(res, [
              'content.liveList',
              'content.list',
              'data.liveList',
              'liveList',
              'list',
              'data',
            ]) as WireRecord[];
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
            if (seq !== loadFollowedSeqRef.current) return;
            if (!liveItems.length && liveNowRef.current.ids.size > 0) {
              liveEmptyTicksRef.current += 1;
              if (liveEmptyTicksRef.current < 2) return;
            } else {
              liveEmptyTicksRef.current = 0;
            }
            liveNowRef.current = { ids, names };
            setLiveNow({ ids, names });
          })
          .catch(() => {});
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
    [members, navigation, showToast, t, token],
  );
  loadFollowedRef.current = loadFollowed;

  // 列表页实时刷新：关注成员的直播状态 + 上麦状态，每 60s 静默刷新（仅列表视图时）
  // 列表页实时刷新：关注成员的直播状态 + 上麦状态 + 最新消息，每 30s 静默刷新（仅列表视图时）。
  // 之前直播状态 60s、最新消息完全不刷新（只有 loadFollowed 手动拉一次）→ 卡片「最新消息」长期静止。
  // 现在合并到一个 tick：直播/上麦 + 最新消息一起 30s 刷新；followedRef 持最新列表避免闭包过期。
  useEffect(() => {
    if (selectedRoom) return;
    let active = true;
    const refreshLiveAndMic = () => {
      if (!active) return;
      pocketApi
        .getLiveList({ record: false, next: 0, size: 100 })
        .then((res: unknown) => {
          if (!active) return;
          const liveItems = unwrapList(res, [
            'content.liveList',
            'content.list',
            'data.liveList',
            'liveList',
            'list',
            'data',
          ]) as WireRecord[];
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
          if (!liveItems.length && liveNowRef.current.ids.size > 0) {
            liveEmptyTicksRef.current += 1;
            if (liveEmptyTicksRef.current < 2) return;
          } else {
            liveEmptyTicksRef.current = 0;
          }
          liveNowRef.current = { ids, names };
          setLiveNow({ ids, names });
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
        if (onMicInputs.length) useOnMicStore.getState().scan(onMicInputs);
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
          setFollowed((prev) =>
            prev.map((f) => ({
              ...f,
              lastMessage: findLastMessage(lastMsgs, f.member),
              lastSmallMessage: findSmallLastMessage(lastMsgs, f.member),
            })),
          );
        })
        .catch(() => {});
    };
    const tick = () => {
      // ⚠️ 此前不看前后台/焦点：切 tab、退后台、锁屏都照每 30s 请求（房间内轮询早已用 AppState 暂停）
      // → 统一加双门卫（修复）
      if (AppState.currentState !== 'active') return;
      if (!navigation.isFocused()) return;
      refreshLiveAndMic();
      refreshLastMessages();
    };
    tick();
    const id = setInterval(tick, 30000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [navigation, selectedRoom]);

  // Y23: 关注列表在 members 就绪后只拉一次（loadFollowed 依赖 members，随其变化会反复重拉）。
  // ⚠️ 但「只拉一次」不能卡在**旧缓存**上：启动先载入本地缓存（可能缺 9 月新成员），
  // 若 followedFetchedRef 在缓存阶段就置 true，后台静默刷新补齐新成员后也不会重新匹配
  // → 新成员（如周文迪）已关注却永远不进房间列表（用户反馈）。
  // 记录上次匹配用的 members 引用，成员库更新（setMembers 换新数组）后重拉一次静默刷新。
  const followedFetchedRef = useRef(false);
  const followedMatchedMembersRef = useRef<Member[] | null>(null);
  const followedTokenRef = useRef(token);
  // 切换账号后必须重新拉关注列表；之前只看 members，账号切换但成员库未变时列表不会更新。
  useEffect(() => {
    if (followedTokenRef.current === token) return;
    followedTokenRef.current = token;
    followedFetchedRef.current = false;
    followedMatchedMembersRef.current = null;
    setFollowed([]);
    if (members.length) loadFollowed(true);
  }, [token, members.length, loadFollowed]);
  useEffect(() => {
    if (!members.length) return;
    if (followedFetchedRef.current && followedMatchedMembersRef.current === members) return;
    followedFetchedRef.current = true;
    followedMatchedMembersRef.current = members;
    loadFollowed(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [members]);

  // mode: 'internal' = 同房间内切换大/小房间或成员/粉丝发言（同一成员，标题/背景不变，必须秒切、无骨架）
  // 'enter' = 从房间列表点成员进入（跨成员/跨房间，保留骨架隔离旧房间残留）
  const openRoom = useCallback(
    async (
      room: Member,
      nextMode: RoomMode = 'big',
      includeFans = showFanMessages,
      mode: 'internal' | 'enter' = 'enter',
    ) => {
      // 从成员搜索/列表进房时先收键盘：否则搜索框已卸载但键盘仍在，
      // 房间聊天输入框会被系统自动聚焦，表现为「进房就弹键盘、直接变成输入消息」。
      if (mode === 'enter') {
        Keyboard.dismiss();
        setSearchOpen(false);
        setSearchQuery('');
      }
      // D3：进房耗时诊断（runtimeLog 可查看；真机反馈卡顿时据此定位是消息接口慢还是渲染慢）
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
      setSelectedRoom(room);
      lastRoomPushAtRef.current = 0; // 上一房间的推送不能算作新房间的长连接存活证据
      roomPushCountRef.current = 0;
      const openSeq = ++roomSeqRef.current;
      const channelChanged = activeChannelRef.current !== channelId;
      activeChannelRef.current = channelId;
      // 发送坐标同步刷新（与 channelId 同一事务，保证 serverId 与 channelId 永远配对）
      activeRoomRef.current = {
        channelId,
        serverId: String(room.serverId || ''),
        memberId: String(room.id || ''),
      };
      // ⚠️ 云信圈组：必须 join 频道，服务端才会推送该频道消息。
      // 此前从未 join → QChat 一条推送都收不到，房间消息只能靠轮询（"不实时"的真正根因）。
      {
        const sidNum = Number(room.serverId || 0);
        const cidNum = Number(channelId || 0);
        if (sidNum > 0 && cidNum > 0) {
          void pocketImJoinChannel(sidNum, cidNum).then((ok) => {
            if (!ok) logWarn(`[qchat] joinChannel 未成功 sid=${sidNum} cid=${cidNum}`);
          });
        }
      }
      // internal：同房间内切换大/小房间或成员/粉丝发言（同一成员、同一背景）。
      // 不清 meta、不进骨架，上一帧消息直接被新数据覆盖 → 标题/背景秒切、无割裂（fix7 回归修复点）。
      // enter：从列表点成员进入房间（跨成员/跨房间），保留骨架隔离旧房间残留 + 清 meta 让本地缓存瞬时显示。
      if (mode === 'internal') {
        // 同房间内切换：不清 meta、不进骨架 —— 标题/背景秒切、无割裂（fix7 回归修复点）
      } else {
        if (channelChanged) {
          // 先显示缓存里的真实房间名/背景，若无则回退成员名，避免进房瞬间标题空缺或闪「房间」
          const earlyMeta = roomMetaCache.current[channelId];
          setRoomMeta(
            earlyMeta
              ? { ...earlyMeta, bg: getBgDisplayUri(earlyMeta.bg) }
              : { name: room.ownerName || '', bg: '' },
          );
          // 跨房间：清掉上一房间的草稿与错误提示 —— 否则草稿会跟着进新房间，
          // 一点发送就把给 A 房间的话发到了 B 房间（「发送错误信息」的另一条路径）
          setRoomDraft('');
          setRoomSendHint('');
        }
      }
      setRoomSearchQuery('');
      setPlayingMedia(null);
      const cacheKey = `${channelId}_${includeFans ? 'all' : 'idol'}`;
      const cached = roomMessagesCache.current[cacheKey];
      // internal 切换：保留上一帧消息或命中缓存直接覆盖（秒切，不闪「暂无消息」、无割裂）；
      // enter 跨房间：命中缓存则瞬时上屏（0ms 秒开），未命中则清空并等待首包，避免旧成员消息残影。
      if (mode === 'internal') {
        if (cached && cached.length > 0) {
          setRoomMessages(cached);
        }
      } else if (channelChanged) {
        if (cached && cached.length > 0) {
          setRoomMessages(cached);
          setRoomLoadedOnce(true);
          setLoading(false);
        } else {
          setRoomMessages([]);
          setLoading(true);
          setRoomLoadedOnce(false);
        }
      }
      setRoomMsgError('');
      setRoomNextTime(0);
      setHasMoreMessages(false);
      // 换房/换模式：视口重新贴底，清掉冻结快照与新消息计数
      roomAtBottomRef.current = true;
      setRoomAtBottom(true);
      setRoomFreezeKey(null);
      setRoomMode(nextMode);
      setShowFanMessages(includeFans);
      try {
        // 并行拉取用户信息与首包房间消息，彻底消除串行网络往返延迟
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
        const sorted = sortMessagesNewestFirst(list.filter(Boolean));
        diagnoseUndefined(sorted, 'OPEN');
        // Y22: 进房竞态——用户已切到别的房间/模式，丢弃慢响应，避免旧房间消息覆盖新房间
        if (openSeq !== roomSeqRef.current) return;
        setRoomMessages(sorted);
        roomMessagesCache.current[cacheKey] = sorted;
        // 恢复该房间（大/小）各自上次滑动位置；无记忆则停留顶部（最新）
        const cidNow = activeChannelRef.current;
        const saved = cidNow ? scrollPosCache.current[cidNow] || 0 : 0;
        setTimeout(() => {
          if (openSeq !== roomSeqRef.current) return; // 期间已切房则放弃
          msgListRef.current?.scrollToOffset?.({ offset: saved, animated: false });
        }, 60);
        setRoomLoadedOnce(true);
        setRoomMsgError('');
        logInfo(
          `[room] 进房 ${room.ownerName || channelId} ${nextMode} 消息加载耗时 ${Date.now() - roomOpenStart}ms (${sorted.length}条)`,
          'room',
        );
        const nextTime = getNextTime(res, list);
        setRoomNextTime(nextTime);
        setHasMoreMessages(nextTime > 0 && list.length > 0);
        // 房间名 + 背景图：room/info -> channelInfo.channelName / channelInfo.bgImg（按 channelId 缓存，异步拉取不阻塞消息）
        const cachedMeta = roomMetaCache.current[channelId];
        if (cachedMeta !== undefined) {
          // 背景优先走本地缓存（瞬时显示，避免二次进房间重新联网/解码跳变）
          setRoomMeta({ ...cachedMeta, bg: getBgDisplayUri(cachedMeta.bg) });
          if (cachedMeta.bg) ensureBgCached(cachedMeta.bg); // 后台补齐/校验本地副本
        } else {
          roomMetaCache.current[channelId] = { name: '', bg: '' };
          setRoomMetaCached(channelId, { name: '', bg: '' }); // 负结果也落盘：避免每次进房间都白拉一次
          // 小房间 room/info 服务端 2001 无权限（实测）→ 塞纳河 server/detail 拿 channelInfoList 房间名 + 背景墙图
          pocketApi
            .getRoomMeta(
              channelId,
              nextMode === 'small' ? room.channelId : undefined,
              room.serverId,
            )
            .then((meta) => {
              // Y22: 期间已切房（seq 过期或 channelId 变化）则丢弃，避免旧房间标题/背景覆盖
              if (openSeq !== roomSeqRef.current || activeChannelRef.current !== channelId) return;
              roomMetaCache.current[channelId] = meta;
              setRoomMetaCached(channelId, meta); // 落盘：下次启动进房间秒显名字/背景
              setRoomMeta({ ...meta, bg: getBgDisplayUri(meta.bg) });
              if (meta.bg) ensureBgCached(meta.bg); // 后台落盘，下次进房间直接本地显示
            })
            .catch(() => {
              roomMetaCache.current[channelId] = { name: '', bg: '' };
              setRoomMetaCached(channelId, { name: '', bg: '' });
            });
        }
        // 进入房间后立即检测该成员上麦状态（驱动房间内上麦按钮；单成员扫描不影响其它成员）
        const ocChannel = roomChannelId(room, nextMode);
        if (ocChannel) {
          useOnMicStore.getState().scan([
            {
              memberId: String(room.id || ''),
              name: String(room.ownerName || room.id || ''),
              channelId: ocChannel,
              serverId: String(room.serverId || ''),
              smallChannelId: String(
                nextMode === 'small' ? room.yklzId || '' : room.channelId || '',
              ),
            },
          ]);
        }
      } catch (error) {
        // ⚠️ 切房守卫：失败分支同样要判序号 ——
        // 否则 A 房间的加载失败会把 B 房间刚加载好的消息清空。
        if (openSeq !== roomSeqRef.current || activeChannelRef.current !== channelId) return;
        showToast(t('加载失败：{msg}', { msg: errorMessage(error) }));
        if (!roomMessagesCache.current[cacheKey]?.length) setRoomMessages([]);
        setRoomMsgError(errorMessage(error));
      } finally {
        // 仅当仍是当前房间时才复位 loading，避免提前关掉新房间的加载态
        if (openSeq === roomSeqRef.current) setLoading(false);
      }
    },
    [currentUserId, showFanMessages, showToast, t],
  );

  /** 供声明顺序在前的发送逻辑调用（发送成功后立即刷新，不再等 15s 轮询） */
  const refreshRoomMessagesRef = useRef<(() => void) | null>(null);
  const loadMoreRoomMessages = useCallback(async () => {
    if (
      !selectedRoom ||
      loading ||
      loadingMoreMessages ||
      loadingMoreMessagesRef.current ||
      refreshingRef.current ||
      !hasMoreMessages ||
      !roomNextTime
    )
      return;
    const channelId = roomChannelId(selectedRoom, roomMode);
    if (!channelId) return;
    const seq = roomSeqRef.current; // 记录发起时的房间序号，响应回来时校验
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
      // ⚠️ 切房守卫：期间已切房/关房 → 丢弃。否则旧房间消息会并入新房间列表，
      // 且 roomNextTime 被旧值覆盖 → 新房间「加载更多」拉到重复/错误页。
      if (seq !== roomSeqRef.current || activeChannelRef.current !== channelId) return;
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
      const nextTime = getNextTime(res, list);
      setRoomMessages((prev) => {
        const merged = mergeMessages(prev, list as RoomMessage[]);
        diagnoseUndefined(merged, 'LOADMORE');
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
  }, [
    hasMoreMessages,
    loading,
    loadingMoreMessages,
    roomMode,
    roomNextTime,
    selectedRoom,
    showFanMessages,
    showToast,
    t,
  ]);

  // 房间内实时刷新：静默拉取最新消息并合并（不提示、不清空），供轮询调用
  const refreshRoomMessages = useCallback(async () => {
    if (!selectedRoom || refreshingRef.current) return;
    const channelId = roomChannelId(selectedRoom, roomMode);
    if (!channelId) return;
    const seq = roomSeqRef.current; // 记录发起时的房间序号，响应回来时校验
    refreshingRef.current = true;
    try {
      const res = await pocketApi.getRoomMessages({
        channelId,
        serverId: selectedRoom.serverId,
        nextTime: 0, // 实时刷新永远拉「最新页」，只用于把新消息合并进顶部
        limit: ROOM_REFRESH_LIMIT, // 只取最新一小页：8s 一轮也不至于每轮拉 100 条
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
      const sorted = sortMessagesNewestFirst(list.filter(Boolean));
      // A 优化：无新消息时完全不触发 state 更新（零渲染开销轮询）。
      // 预判当前列表最新消息时间，若服务端最新条不比它新，直接 return，连 reducer 都不跑。
      const prevMsgs = roomMessagesRef.current;
      const prevNewest = prevMsgs.length ? getMessageTime(prevMsgs[0]) : 0;
      // 判新按消息 key，不只看时间：HTTP 历史消息的 msgTime 只到秒，
      // 同一秒内到达的第二条消息时间戳与最新条相等，用 `>` 会永远判成「没有新消息」。
      const prevKeys = new Set(prevMsgs.map((m) => messageKey(m)));
      const hasFresh = sorted.some(
        (m) => !prevKeys.has(messageKey(m)) && getMessageTime(m) >= prevNewest,
      );
      if (!hasFresh) return;
      // ⚠️ 切房守卫：请求在途时用户可能已切房/关房，
      // 此时合并会把 A 房间的消息写进 B 房间列表（跨成员消息串台）。
      if (seq !== roomSeqRef.current || activeChannelRef.current !== channelId) return;
      // 关键：实时刷新【绝不改写 roomNextTime】—— roomNextTime 是「上拉加载更多」往前翻的游标，
      // 只能由 loadMoreRoomMessages 更新。否则会被反复重置成最新页游标，导致上拉加载更多拉回重叠/重复内容。
      setRoomMessages((prev) => {
        // 只合并比当前列表最新消息更新的条目，避免重复累积（双保险，配合 messageKey 去重）
        const newest = prev.length ? getMessageTime(prev[0]) : 0;
        const fresh = sorted.filter(
          (m) => getMessageTime(m) >= newest || messageKey(m) === messageKey(prev[0]),
        );
        if (!fresh.length) return prev;
        const merged = mergeMessages(prev, fresh);
        diagnoseUndefined(merged, 'REFRESH');
        return merged;
      });
    } catch {
      // 静默失败：实时刷新不打扰用户
    } finally {
      refreshingRef.current = false;
    }
  }, [roomMode, selectedRoom, showFanMessages]);
  refreshRoomMessagesRef.current = refreshRoomMessages;

  /**
   * 重新订阅当前房间频道。
   * 推送依赖「已登录 + 已订阅」两个条件，二者都可能晚于进房动作完成：
   * 冷启动时 joinChannel 常常跑在 QChat 登录之前，订阅被服务端丢弃后不会自动补，
   * 表现就是进房后一条实时消息都收不到、只能靠轮询。
   */
  const rejoinActiveChannel = useCallback(() => {
    const target = activeRoomRef.current;
    const sid = Number(target?.serverId || 0);
    const cid = Number(target?.channelId || 0);
    if (sid > 0 && cid > 0) {
      void pocketImJoinChannel(sid, cid).then((ok) => {
        if (!ok && __DEV__) logWarn(`[qchat] rejoin 未成功 sid=${sid} cid=${cid}`);
      });
    }
  }, []);

  // 房间内持续刷新：停在房间页时每 2s 拉一次最新消息，列表自己动，不用手动下拉。
  // QChat 推送仍是实时主通道（到了先上屏）；HTTP 刷新只保证「任何情况下都在更新」。
  // 切回本页 / 回前台立即补一次，不等下一个 tick。
  useEffect(() => {
    if (!selectedRoom) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    const canRefresh = () => navigation.isFocused() && AppState.currentState === 'active';
    const schedule = () => {
      if (stopped) return;
      timer = setTimeout(async () => {
        if (!stopped && canRefresh()) {
          await refreshRoomMessages();
          // 长连接可能被服务端回收：60s 内没收到本频道推送就补订一次（这个时间戳同时当节流用）
          const lastPush = lastRoomPushAtRef.current;
          if (!lastPush || Date.now() - lastPush >= ROOM_REJOIN_AFTER_MS) {
            lastRoomPushAtRef.current = Date.now();
            rejoinActiveChannel();
          }
        }
        schedule();
      }, ROOM_POLL_INTERVAL_MS);
    };
    const refreshNow = () => {
      if (canRefresh()) void refreshRoomMessages();
    };
    schedule();
    const appStateSub = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        rejoinActiveChannel();
        refreshNow();
      }
    });
    const focusSub = navigation.addListener('focus', refreshNow);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      appStateSub.remove();
      focusSub();
    };
  }, [selectedRoom, refreshRoomMessages, navigation, rejoinActiveChannel]);

  /**
   * 云信连接生命周期：只在「房间页 + 有房间 + 前台」保持。
   *
   * 云信同一 appKey 只认一条活跃会话，长连接常驻会和官方客户端 / 本机另一个账号互相顶号。
   * 所以离开房间页、切到后台都主动断开；回到页面/前台再重建（房间消息有 2s 轮询兜底，不会丢）。
   */
  const [roomLinkTick, setRoomLinkTick] = useState(0);
  useFocusEffect(
    useCallback(() => {
      setRoomLinkTick((v) => v + 1);
      return () => {
        try {
          resetQChatSession('离开房间页');
        } catch {
          /* 忽略 */
        }
      };
    }, []),
  );
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'background') {
        try {
          resetQChatSession('切到后台');
        } catch {
          /* 忽略 */
        }
      } else if (next === 'active') {
        setRoomLinkTick((v) => v + 1);
      }
    });
    return () => sub.remove();
  }, []);

  /**
   * 房间消息「实时」接收：云信圈组（QChat）推送。
   *
   * 实时消息主通道是云信圈组（QChat）推送，HTTP 轮询只做兜底（间隔自适应，见 roomLivePolicy）。
   * 原生桥不可用 / 未登录 / 非 Android 时 observeRoomMessages 内部静默降级，
   * 房间仍按轮询工作，不影响既有行为。
   */
  useEffect(() => {
    if (!selectedRoom) return undefined;
    let disposed = false;
    let unsubscribe: (() => void) | null = null;
    observeRoomMessages((messages) => {
      if (disposed) return;
      const cid = activeChannelRef.current;
      if (!cid) return;
      const fresh = messages
        .filter((m) => String(m.channelId) === String(cid))
        .map(qchatToRoomMessage);
      if (__DEV__) logWarn(`[qchat] recv=${messages.length} matched=${fresh.length}`);
      for (const message of messages) {
        const voiceEvent = parseVoiceEvent(message);
        if (voiceEvent) useOnMicStore.getState().applyVoiceEvent(voiceEvent);
      }
      if (!fresh.length) return;
      lastRoomPushAtRef.current = Date.now();
      roomPushCountRef.current += 1;
      if (roomPushCountRef.current <= 3) {
        logInfo(
          `[qchat] 实时推送到达 ${fresh.length} 条（本房间第 ${roomPushCountRef.current} 次）`,
          'room.live',
        );
      }
      setRoomMessages((prev) => {
        const merged = mergeMessages(prev, fresh);
        diagnoseUndefined(merged, 'QCHAT');
        return merged;
      });
    })
      .then((unsub) => {
        if (disposed) {
          unsub();
          return;
        }
        unsubscribe = unsub;
        // 订阅晚于进房时登录可能还没完成：登录成功后再补一次订阅，否则该房间永远收不到推送
        rejoinActiveChannel();
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      if (unsubscribe) unsubscribe();
    };
  }, [selectedRoom, nimEpoch, rejoinActiveChannel, roomLinkTick]);

  /** 直播解析并开播（占位式）：点击即反馈，出地址后无缝换正式播放器 */
  const resolveLiveAndOpen = useCallback(
    async (media: RoomMedia) => {
      const key = String(media.liveId || media.url || 'live');
      // 同一路正在解析中：忽略重复点击（防连击并发网络风暴）
      if (liveResolve?.key === key && !liveResolve.error) return;
      const token = ++liveResolveToken.current;
      setLiveResolve({ key, error: '', media });
      try {
        const resolved = await resolveRoomLiveMediaWithRetry(media);
        if (token !== liveResolveToken.current) return; // 期间已关闭/改点其它：丢弃过期结果
        if (!resolved.url) {
          setLiveResolve({ key, error: t('解析直播地址失败，请检查网络后重试'), media });
          return;
        }
        setLiveResolve(null);
        // 统一按「是否录播」判定（见 roomTapIsVod：replayHint 回放 / m3u8-mp4 无 live 标记 → vod 可拖）
        const isVod = roomTapIsVod(resolved);
        setRoomPlayer({
          ...resolved,
          isLive: !isVod,
          needsVlc: resolved.needsVlc || streamNeedsProxy(resolved.url),
        });
        // 默认竖屏播放（同视频）；用户手动点全屏才横屏——不要一进就横屏沉浸
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
    liveResolveToken.current += 1; // 使在途解析结果失效
    setLiveResolve(null);
  }, []);

  // 直播解析占位期间：Android 硬件返回 = 取消解析（不退出房间）
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
          // 已带可播地址：直接开播（零等待，不弹解析占位）
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
          // 无流地址：交给占位式解析（立即弹「解析中」全屏层，首击即有反馈；失败留层内重试）。
          // 修复「有概率点不进去、连击多点才能加载」——此前 await 解析数秒无任何反馈，
          // 瞬时网络失败又只弹一次 toast，用户只能反复点卡片碰运气。
          resolveLiveAndOpen(media);
          return;
        }
        if (next.type === 'video') {
          // 视频点击进入播放器，但默认不强制全屏（竖屏播放，用户可手动点全屏按钮）
          setRoomPlayer({ ...next, needsVlc: streamNeedsProxy(next.url) });
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

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let list = followed.filter((item) => !item.member || isRoomMember(item.member));
    if (q) {
      list = list.filter((item) => {
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
      .filter((m) => isRoomMember(m) && memberSearchText(m).includes(q))
      .sort((a, b) => {
        // 已关注排前，方便快速打开房间
        const af = followedIds.has(String(a.id || a.userId || '')) ? 0 : 1;
        const bf = followedIds.has(String(b.id || b.userId || '')) ? 0 : 1;
        return af - bf;
      })
      .slice(0, 10);
  }, [members, searchQuery, followedIds]);

  const filteredRoomMessages = useMemo(() => {
    if (!selectedRoom) return roomMessages;
    // ① 关闭「所有人发言」时，粉丝消息必须从列表里剔除。
    // —— 服务端 fetchAll 只影响「新拉的」数据，之前拉过的粉丝消息会留在本地：
    // 既会被显示出来，又会把同一位成员的连续发言「隔开」（用户反馈的老问题）。
    const base = showFanMessages
      ? roomMessages
      : roomMessages.filter(
          (item) => messageRole(item, selectedRoom, false, currentUserId, memberIdSet) !== 'fan',
        );
    const q = roomSearchQuery.trim().toLowerCase();
    if (!q) return base;
    return base.filter((item) => {
      const profile = senderProfile(item, selectedRoom);
      const text = messageText(item);
      return [
        text,
        profile.name,
        profile.id,
        selectedRoom.ownerName,
        selectedRoom.team,
        selectedRoom.groupName,
      ].some((value) =>
        String(value || '')
          .toLowerCase()
          .includes(q),
      );
    });
  }, [roomMessages, roomSearchQuery, selectedRoom, showFanMessages, currentUserId, memberIdSet]);

  // 消息流按日期分组：今天/昨天/月日 分隔条（消息是新→旧排序，分隔条插在换日处）
  const chatRows = useMemo(() => {
    // 房间已切走/关闭时不能算：messageRole → isIdolMessage 会读 room.id（null 崩）
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
      // 用户要求（A）：**取消「同发送者 + 3 分钟」的时间叠加合并**——
      // 每条消息都独立成组：都带头像、名字（含队伍标签）和时间。
      // （此前 groupStart = !sameSender || !withinGap，会把连续发言并成一组只显一次身份。）
      rows.push({ type: 'msg', key: messageKey(item), item, index, groupStart: true });
    });
    return rows;
  }, [filteredRoomMessages, selectedRoom, t]);

  /**
   * 聊天库接线（A+B）：把 chatRows 映射成 IMessage，`__row` 带回原始行，
   * renderBubble 直接复用 renderChatItem —— 头像/名字/回复/礼物/媒体全保留。
   * ⚠️ user._id 必须按真实发送者（库按它决定左右），createdAt 必须毫秒。
   */
  /**
   * 日期分隔：统一纯数字 yyyy/mm/dd（库自带的 zh 输出是「14 9月」这种不符合中文习惯的格式）
   */
  const renderDayLabel = useCallback(
    ({
      date,
      createdAt,
    }: {
      date?: Date | number | string;
      createdAt?: Date | number | string;
    }) => {
      // ⚠️ 库回调传的是 createdAt（不是 date）——只读 date 会 undefined → NaN → null，
      // 于是「日期分隔根本不显示」（私信页同一个 bug）。
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
      // 用户要求：日期分隔**居中**显示（库的 Day 容器是居中的，但自定义 renderDay 会被塞进
      // 与消息时间（msgTime）统一使用 labelSecondary，避免“今天/昨天”在浅色背景上太浅。
      return <Text style={[styles.daySepText, { color: palette.labelSecondary }]}>{label}</Text>;
    },
    [palette],
  );

  /**
   * IMessage 对象复用缓存：2s 轮询每次都会重建 chatRows / 新对象引用，
   * 若每次都给库全新的 message 对象，FlatList 里所有行的 memo 全部失效 →
   * 每 2 秒整屏重渲染（长会话明显掉帧）。这里按「行 key + 内容签名」复用旧对象，
   * 内容没变的行引用不变，库那边直接跳过重渲染。
   */
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
          // 带回原始行：renderMessage 整行渲染要用（groupStart 决定是否显示头像/名字）
          __row: row,
          text,
          createdAt: new Date(ms),
          user: {
            // 固定常量 SELF：与 <Chat user={{_id:'SELF'}}> 严格相等，库才判成右侧
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

  /**
   * inverted 列表：offset 0 = 最新消息。
   * 门槛与「回到底部」气泡的 scrollToBottomOffset 保持一致（60px）：
   * 过线即冻结并同时露出气泡，不会出现「已经冻结了但看不到按钮」的空窗。
   */
  const handleRoomListScroll = useCallback((event: RoomChatListScrollEvent) => {
    const y =
      Number(
        'nativeEvent' in event ? event.nativeEvent?.contentOffset?.y : event.contentOffset?.y,
      ) || 0;
    const nearBottom = y <= ROOM_AT_BOTTOM_OFFSET;
    if (nearBottom === roomAtBottomRef.current) return;
    roomAtBottomRef.current = nearBottom;
    setRoomAtBottom(nearBottom);
  }, []);

  /**
   * 「回到底部」气泡：ScalePressable 自身给按压反馈；按下即解冻并滚到底。
   * 不等 onScroll 回调 —— 解冻晚一拍会看到「点了没反应」。
   */
  const roomJumpOut = useCallback(() => {
    roomAtBottomRef.current = true;
    setRoomAtBottom(true);
    setRoomFreezeKey(null);
    try {
      roomListRef.current?.scrollToOffset?.({ offset: 0, animated: true });
    } catch {
      /* 忽略 */
    }
  }, []);

  /**
   * 「加载更多历史」props（引用稳定）。
   * 内联对象每次渲染都是新的 → 库里 ListHeaderComponent 跟着重建（列表顶部挂件反复重挂载）。
   */
  const roomLoadEarlierProps = useMemo(
    () => ({
      isAvailable: hasMoreMessages,
      onPress: loadMoreRoomMessages,
      isLoading: loading,
      /**
       * ⚠️ 上划到顶自动加载（用户反馈：到顶只出现按钮、还要再点一下，太别扭）。
       * FlatList 的 onEndReached 在 inverted 列表里正好落在视觉顶部（最旧消息），
       * 打开这个开关后接近顶部就会自动调 onPress；按钮保留作兜底。
       * 防重入/去重由 loadMoreRoomMessages 自己的护栏保证，可安全重复触发。
       */
      isInfiniteScrollEnabled: true,
    }),
    [hasMoreMessages, loadMoreRoomMessages, loading],
  );

  /** Chat 列表 props（引用稳定，避免每次渲染重建 FlatList 的 props） */
  const roomChatListProps = useMemo(
    () => ({
      style: { flex: 1, backgroundColor: 'transparent' },
      // 列表内容容器：inverted 列表的「视觉顶部」留白 = paddingBottom（见常量注释）。
      // 库会把 contentContainerStyle 整体替换（listProps 最后展开），故此处显式给全。
      contentContainerStyle: ROOM_CHAT_LIST_CONTENT_STYLE,
      // 滚动位置只用来判定「是否贴底」，100ms 足够，避免每帧过 JS 桥
      scrollEventThrottle: 100,
      onScroll: handleRoomListScroll,
      // 库里 `{...listProps} onScroll={scrollHandler}` 会把 onScroll 换成自己的 Reanimated
      // handler，惯性滑动结束那一下不一定回传；补 drag / momentum 结束兜底，
      // 否则「回到底部」浮层的显隐会卡在旧状态（用户反馈：按钮不出来）。
      onScrollEndDrag: handleRoomListScroll,
      onMomentumScrollEnd: handleRoomListScroll,
      // 滑消息列表即收键盘（微信/QQ 行为）。此前没设，键盘弹着时滑历史一直挡半屏。
      keyboardDismissMode: 'on-drag' as const,
      keyboardShouldPersistTaps: 'handled' as const,
      // ⚠️ 不要加 maintainVisibleContentPosition：
      // 倒序列表本身在 offset=0 时新消息就是「贴底可见」的，而 MVCP 会把可见内容钉住
      // （插入新消息后自动把 offset 推大），表现为「回到底部后不跟新消息滚动、
      // 而且 offset 被推离底部 → 又被判成不在底部」，和上滑冻结互相打架。
    }),
    [handleRoomListScroll],
  );

  // 上划离开底部 → 记住当时的最新消息作为锚点；回到底部 → 解冻
  useEffect(() => {
    if (roomAtBottom) {
      setRoomFreezeKey(null);
    } else {
      setRoomFreezeKey((prev) => prev ?? roomLatestImsRef.current[0]?._id ?? null);
    }
  }, [roomAtBottom]);

  /**
   * 传给 Chat 的数据：
   * 冻结锚点之前的都是「比它更新」的新消息 —— 先按住不显示（只计数），
   * 锚点及其之后（更旧的历史，含上滑新加载的）照常进列表。QQ 就是这个行为。
   */
  const roomListImsRef = useRef<RoomChatIM[]>([]);
  const { list: roomListIms, pending: roomPendingCount } = useMemo(() => {
    const sliced = splitByFreezeAnchor(chatIms, roomFreezeKey);
    // 冻结期间 chatIms 每轮都是新数组（元素引用没变）：沿用旧数组，
    // FlatList 的 data 引用不变 → 一行都不重渲染，滚动更稳。
    const prev = roomListImsRef.current;
    const same = prev.length === sliced.list.length && sliced.list.every((m, i) => m === prev[i]);
    const list = same ? prev : sliced.list;
    roomListImsRef.current = list;
    return { list, pending: sliced.pending };
  }, [chatIms, roomFreezeKey]);

  /**
   * 房间内「上麦」直接收听（用户要求：不跳转，当前页直接播放）。
   * 秒开：上麦扫描已拿到 streamUrl 就直接播；否则现取一次。
   * 复用房间内联播放器（roomPlayer → PlayerScreen）。
   */
  const playRoomRadioInline = useCallback(async () => {
    const room = selectedRoom;
    if (!room) return;
    const key = String(room.id || room.userId || '');
    const entry = onMicMap[key];
    const mode: 'big' | 'small' = entry?.smallVoice ? 'small' : 'big';
    let url = String(entry?.streamUrl || '');
    if (!url) {
      try {
        url = (await fetchMemberRadioUrl(room as Member, mode)) || '';
      } catch {
        url = '';
      }
    }
    if (!url) {
      showToast(t('该房间当前没有开启语音电台'));
      return;
    }
    // 用户要求：点「上麦」按钮**直接以小胶囊（纯音频）播放**，
    // 不要走房间内联那个「直播播放器」（视频播放器样式，观感不对）。
    const title = `${shortName(room, key)} · ${t('上麦')}`;
    useMiniPlayerStore.getState().open({
      url,
      title,
      cover: room.avatar,
      isLive: true,
      audioOnly: true,
      backTo: { mode: 'live', playUrl: url, playTitle: title, playCover: room.avatar },
    });
  }, [selectedRoom, onMicMap, showToast, t]);

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
      // 候选 id：**消息 ext.user.userId 优先**（官方 getChannelBaseParams / 我们自己 buildChannelExt 都写的是发送者的口袋 userId），
      // 再退成员库的 userId / id，最后退消息里取到的发送者字段（可能是云信 accid，查不到就会自动换下一个）。
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
      // 依次尝试候选 id：命中第一个能查到资料的即用（查不到再换下一个）
      void (async () => {
        for (const id of candidates) {
          try {
            const res = await pocketApi.getUserProfile(id);
            if (userCardSeqRef.current !== seq) return;
            const detail = userCardFromUserRes(res);
            // 合并而非覆盖：成员先用成员库填了队伍/成员标记，线上资料只补能拿到的字段
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
            // 头像框：user/info/home 泛匹配（字段名各端不一；拿不到静默跳过）
            pocketApi
              .getUserHomeInfo(id)
              .then((home: unknown) => {
                if (userCardSeqRef.current !== seq) return;
                const frame = findFrameUrl(home);
                if (frame) apply({ frameUrl: frame });
              })
              .catch(() => {});
            return;
          } catch {
            // 该 id 查不到（如非口袋 userId）→ 试下一个
          }
        }
        if (userCardSeqRef.current !== seq) return;
        apply({ loading: false, error: t('未获取到更多资料') });
      })();
    },
    [t],
  );

  /** 资料卡「关注 / 取消关注」：口袋48 用户间可互关（v2/friendships/friends/add|remove，toType=1） */
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
        showToast(next ? t('已关注') : t('已取消关注'));
      } catch (err) {
        setUserCard((c) => (c && c.id === id ? { ...c, followBusy: false } : c));
        showToast(t('操作失败：{msg}', { msg: errorMessage(err) }));
      }
    },
    [showToast, t],
  );

  /** 资料卡「私信」：带 targetUserId 进私信页（对方不是成员 → 无翻牌，纯私信会话） */
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

  // 列表项渲染提取为 useCallback：避免每次 render 重建内联函数，配合 PerfFlatList 的 memo 提升长列表滚动性能
  /** 长按自己的消息 → 撤回删除（官方 im/api/v1/team/msg/delete，服务端校验只能删本人的） */
  const confirmDeleteMessage = useCallback(
    (item: RoomMessageWire) => {
      const msgIdClient = String(item?.msgIdClient || item?.uuid || item?.msgId || '');
      const msgTime = getMessageTime(item);
      const channelId = Number(item?.channelId || activeChannelRef.current || 0);
      if (!msgIdClient || !msgTime || !channelId) {
        showToast(t('该消息不支持撤回'));
        return;
      }
      showDialog(t('删除消息'), t('撤回并删除这条你发送的消息？'), [
        { text: t('取消'), style: 'cancel' },
        {
          text: t('删除'),
          style: 'destructive',
          onPress: () => {
            deleteRoomMessage({ channelId, msgIdClient, msgTime })
              .then(() => {
                setRoomMessages((prev) => prev.filter((m) => messageKey(m) !== messageKey(item)));
                showToast(t('已删除'));
              })
              .catch((err) => showToast(errorMessage(err)));
          },
        },
      ]);
    },
    [showToast, t],
  );

  /** 长按消息：所有人可回复；自己额外保留撤回删除 */
  /**
   * 长按消息 → 自绘圆角操作面板（与 App 风格统一；原生 Alert 只有 3 个按钮且样式割裂）。
   * 规则：文本消息可复制、回复；媒体消息可回复、下载；本人消息均可删除。
   */
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
      // 供面板按钮复用（存 ref 便于回调读取最新值）
      msgReplyRef.current = { replyMessageId, senderName, text };
    },
    [showToast, t],
  );

  /** 面板内动作：回复 */
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

  /** 面板内动作：复制 */
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

  const renderChatItem = useCallback(
    ({ item: row }: { item: ChatRow }) => {
      const item = row.item;
      // 最后一道防线：服务端偶发脏数据（undefined/null 元素）直接渲染空行，不崩
      if (!item) return <View />;
      const room = selectedRoom as Member;
      const role = messageRole(item, room, showFanMessages, currentUserId, memberIdSet);
      const mine = role === 'mine';
      const idol = role === 'idol';
      const msgProfile = senderProfile(item, room);
      // 发送者是否是「本房房主」：皇冠（房主标）只给房主（用户要求：别的成员不带皇冠）
      const isRoomOwner = isIdolMessage(item, room, showFanMessages);
      // 发送者若是「成员库里的成员」（**不一定是房主**），就用他自己的档案 + 他自己的队伍标签。
      // 此前非房主成员在别人房间发言，被 isIdolMessage 直接判成 fan
      //（只要 profile.id 存在且 ≠ 房主就 return false）→ 没名字/没头像/没队标。
      // ⚠️ senderMember 必须优先于「房主房间档案」：否则其他成员发言会套用房主的名字/头像。
      const senderId = String(msgProfile.id || '').trim();
      const senderMember = senderId
        ? (members.find((m) =>
            [m.id, m.userId, m.memberId].some((v) => String(v ?? '').trim() === senderId),
          ) as Member | undefined)
        : undefined;
      const isMemberSender =
        !!senderMember || (Number(extraInfo(item)?.user?.roleId ?? 0) || 0) > 1;
      // 成员发言头像：优先用 API（消息携带）的真实头像；成员库 avatar 多为公式照，仅兜底
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
      // 消息里的官方队标优先；缺失时使用该发送者的官方成员资料。
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
        // 修复：回复礼物感谢时成员自己发送的正文只能是真实回复文本（text 或 body），
        // 绝对不能回退到送礼人名字 (replyName) 或送礼内容 (replyText)，否则纯语音回复会被错误显示为送礼人名字。
        const rawText =
          gr.text ||
          payload.text ||
          (typeof payload.body === 'string' && !payload.body.startsWith('{') ? payload.body : '');
        if (typeof rawText === 'string') giftReplyText = rawText.trim();
      }
      // 成员公开翻牌回复：正文应是「回答」，提问放在 replyInfo 引用卡里。
      // 历史 bug（#10）：正文只取到 content（=提问）→ 房间内看不到成员回复内容。
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
        ? isGiftReply
          ? giftReplyText
          : giftReplyText
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
      // 点头像能打开什么：成员（房主 / 成员库里的其他成员）→ 资料卡（带成员信息）；否则按发送者 id 试用户资料
      const avatarMember: Member | null = senderMember || (isRoomOwner ? room : null);
      // 消息 ext.user.userId = 发送者的口袋 userId（官方 getChannelBaseParams 结构）→ 查资料最靠谱的 id
      const extUser: WireRecord = extraInfo(item)?.user || payload?.user || {};
      const extUserId = String(extUser?.userId ?? extUser?.user_id ?? extUser?.id ?? '').trim();
      const canOpenProfile = !!avatarMember || !!senderId || !!extUserId;
      // 头像框和勋章来自不同字段。
      const senderFrameUrl = firstFrameFrom(extUser);
      const senderBadgeUrl = firstBadgeFrom(extUser);

      return (
        <View
          style={[
            styles.chatRow,
            mine && styles.chatRowMine,
            !row.groupStart && styles.chatRowTight,
          ]}
        >
          {!mine ? (
            row.groupStart ? (
              /* 点头像 → 加载对方个人资料：成员进「成员档案」，非成员弹「用户资料卡」 */
              <TouchableOpacity
                activeOpacity={0.8}
                disabled={!canOpenProfile}
                accessibilityLabel={t('头像')}
                onPress={() =>
                  openSenderProfile({
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
            {/* 组首显示名字 + HH:mm；组内不重复 */}
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
                  {/* 皇冠 = 房主标：只给本房房主（用户要求：别的成员不带皇冠） */}
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
                  {/* 身份装饰：成员队标 / 粉丝账号等级。 */}
                  {row.groupStart ? (
                    <UserDecorRow
                      decor={{
                        isStar: isRoomOwner || isMemberSender,
                        roleId: isMemberSender
                          ? 2
                          : Number(extUser?.roleId ?? extUser?.userRole ?? 0),
                        teamLogo: String(extUser?.teamLogo || teamLogo || ''),
                        pfUrl: String(extUser?.pfUrl || ''),
                        vip: !!extUser?.vip,
                        level: extUser?.level ?? extUser?.userLevel ?? extUser?.grade,
                      }}
                      size={11}
                    />
                  ) : null}
                  {senderBadgeUrl ? (
                    <NetworkImage
                      source={{ uri: senderBadgeUrl }}
                      style={{ width: 19, height: 19 }}
                      resizeMode="contain"
                      fallback={false}
                    />
                  ) : null}
                </View>
                <Text
                  style={[styles.msgTime, { color: palette.labelSecondary }]}
                  allowFontScaling={false}
                >
                  {formatTimestamp(getMessageTime(item)).slice(11, 16)}
                </Text>
              </View>
            ) : null}
            {/* 气泡 = 玻璃（内容进玻璃）。「自己」用 tint 染色玻璃（实心强调），
                主播/他人走默认白深纱玻璃 —— 与底栏同一套材质 */}
            <GlassSurface
              role="chip"
              radius={18}
              onLongPress={() =>
                openMessageActions(item, mine, (profile.name || '').trim() || t('未知用户'))
              }
              tintColor={mine ? palette.tint : undefined}
              accessibilityLabel={mediaA11yLabel || undefined}
              style={[
                styles.msgBubble,
                // 用户要求：气泡统一纯椭圆，不做「贴头像侧方角」的尾巴变体。
                // 也不再叠自己的 hairline 描边 —— 全部交给 GlassSurface 的材质描边，
                // 这样气泡与底栏/卡片是同一套玻璃（描边不会双重叠、不会显得“另一个材质”）。
              ]}
            >
              {flipInfo ? (
                <RoomFlipQuestion
                  question={flipInfo.question}
                  questionId={flipInfo.questionId}
                  answerId={flipInfo.answerId}
                  token={token || ''}
                  mine={mine}
                  onOpenProfile={openSenderProfile}
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
                      style={[
                        styles.replyName,
                        { color: mine ? palette.onTint : idol ? palette.tint : palette.tint },
                      ]}
                      numberOfLines={1}
                    >
                      {replyName}
                    </Text>
                  ) : null}
                  {replyQuoted ? (
                    <Text
                      style={[
                        styles.replyText,
                        {
                          color: mine
                            ? 'rgba(255,255,255,0.85)'
                            : idol
                              ? palette.labelSecondary
                              : palette.labelSecondary,
                        },
                      ]}
                      numberOfLines={3}
                    >
                      {replyQuoted}
                    </Text>
                  ) : null}
                </View>
              ) : null}
              {bubbleText
                ? /* [表情] 标签内联渲染为官方表情图（107 个 PopoEmoticons），不再是漏渲染的 [发呆] 文本 */
                  (() => {
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
                            p
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
                    giftReplyText ? styles.giftCardCompact : null,
                  ]}
                >
                  {!giftReplyText ? (
                    gift.image ? (
                      <NetworkImage
                        source={{ uri: gift.image }}
                        style={[styles.giftImage, { backgroundColor: palette.surfaceGlassStrong }]}
                        thumbnail={180}
                      />
                    ) : (
                      <View style={[styles.giftImageFallback, { backgroundColor: palette.tint }]}>
                        <MaterialCommunityIcons name="gift" size={16} color={palette.onTint} />
                      </View>
                    )
                  ) : null}
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
                  <>
                    <TouchableOpacity
                      style={[
                        styles.inlineImageWrap,
                        media.title === t('表情') && styles.inlineStickerWrap,
                        (bubbleText || replyName || replyQuoted) && { marginTop: 8 },
                      ]}
                      onPress={() => setFullImageUrl(media.url)}
                      onLongPress={() =>
                        openMessageActions(
                          item,
                          mine,
                          (profile.name || '').trim() || t('未知用户'),
                          media,
                        )
                      }
                      activeOpacity={0.9}
                      accessibilityLabel={media.title === t('表情') ? t('表情') : t('图片')}
                    >
                      {/* ⚠️ 房间图片消息走缩略图：原图动辄 1-3MB/张（1080-3000px），显示仅 228dp。
                        缩略图失败自动退回原图（NetworkImage 两段兜底）；点开大图仍是原图。 */}
                      <NetworkImage
                        source={{ uri: media.url }}
                        style={
                          media.title === t('表情') ? styles.inlineSticker : styles.inlineImage
                        }
                        resizeMode="cover"
                        thumbnail={media.title === t('表情') ? 400 : 700}
                      />
                    </TouchableOpacity>
                  </>
                ) : media.type === 'live' && media.cover ? (
                  <TouchableOpacity
                    style={styles.liveCardWrap}
                    onPress={() => playMedia(media)}
                    onLongPress={() =>
                      openMessageActions(
                        item,
                        mine,
                        (profile.name || '').trim() || t('未知用户'),
                        media,
                      )
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
                  roomPlayerFullscreen ||
                  roomPlayer?.url === media.url ||
                  playingMedia?.url === media.url ? null : (
                    <VideoCoverCard
                      media={media}
                      onPress={() => playMedia(media)}
                      onLongPress={() =>
                        openMessageActions(
                          item,
                          mine,
                          (profile.name || '').trim() || t('未知用户'),
                          media,
                        )
                      }
                    />
                  )
                ) : media.type === 'audio' ? (
                  // 音频播放时不返回 null（否则整张卡片塌缩成小方块）：AudioMediaCard 自带播放中态（暂停按钮）。
                  // 隐藏探测 Video 在 AudioMediaCard 内部，无需外部 inlineAudio 撑高。
                  <View style={bubbleText || replyName || replyQuoted ? { marginTop: 8 } : null}>
                    <AudioMediaCard
                      media={media}
                      palette={palette}
                      playing={!!(playingMedia?.url && media.url && playingMedia.url === media.url)}
                      onPlay={() => playMedia(media)}
                      onLongPress={() =>
                        openMessageActions(
                          item,
                          mine,
                          (profile.name || '').trim() || t('未知用户'),
                          media,
                        )
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
                      openMessageActions(
                        item,
                        mine,
                        (profile.name || '').trim() || t('未知用户'),
                        media,
                      )
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
                      onPress={() => playMedia(media)}
                      activeOpacity={0.85}
                    >
                      <MaterialCommunityIcons
                        name={
                          playingMedia?.url && media.url && playingMedia.url === media.url
                            ? 'pause'
                            : 'play'
                        }
                        size={14}
                        color={palette.onTint}
                      />
                      <Text style={[styles.mediaPlayText, { color: palette.onTint }]}>
                        {playingMedia?.url && media.url && playingMedia.url === media.url
                          ? t('暂停')
                          : media.duration
                            ? `${media.duration}s`
                            : t('播放')}
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
              {media?.url && playingMedia?.url === media.url && media.type === 'link' ? (
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
    },
    [
      selectedRoom,
      showFanMessages,
      currentUserId,
      memberIdSet,
      members,
      token,
      openSenderProfile,
      openMessageActions,
      roomPlayerFullscreen,
      roomPlayer,
      playingMedia,
      palette,
      t,
      playMedia,
      setFullImageUrl,
    ],
  );

  /**
   * Chat 的 renderMessage 必须是稳定引用：内联箭头函数每次父渲染都是新函数 →
   * Chat 内部会重渲染所有可见消息项（重新测量/重绘）→ 房间高频刷新（QChat 推送 / 精华加载）
   * 时整片消息区看起来在「闪」。 用户反馈「房间页消息在闪」修复。
   */
  const renderChatMessage = useCallback(
    ({ currentMessage }: { currentMessage?: { __row?: ChatRow } }) => {
      const row = currentMessage?.__row;
      // 库要求必须返回元素（null 不合法）
      if (!row) return <View />;
      return renderChatItem({ item: row });
    },
    [renderChatItem],
  );

  if (selectedRoom) {
    const fid = String(selectedRoom.id || '');
    const isFollowingRoom = followedIds.has(fid);
    const followBusyRoom = followBusy.has(fid);
    // 房间名加载前用中性占位「房间」，不回退成员名 —— 避免「先显示成员名再被真实房间名替换」的闪烁
    const headerTitle = roomMeta.name
      ? capText(roomMeta.name, 18)
      : selectedRoom.ownerName
        ? capText(selectedRoom.ownerName, 18)
        : t('房间');
    const roomBgUri = roomMeta.bg || '';
    const roomScrim = resolvedTheme === 'dark' ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.42)';
    return (
      /*
       * ⚠️【背景图修复】背景层必须放在**键盘 padding 容器之外**。
       * 原结构：<容器 style={{paddingBottom: 键盘高度}}> 里放 absolute 背景层 ——
       * React Native（Yoga）会把父容器的 padding 也作用到 absolute 子节点上，
       * 于是键盘高度一旦非 0（含「手势返回没触发 keyboardDidHide」导致卡住的旧值），
       * 背景层 bottom 就被抬高，屏幕下方露出一条没有背景的黑边
       * —— 用户反馈的「房间背景图显示不完全」。
       * 现在背景铺在整屏外层，padding 只影响内容，背景永远满幅。
       */
      <Reanimated.View style={[styles.roomRoot, roomEnterStyle]}>
        {/* 背景双层常驻 crossfade（两层永不卸载，换图写隐藏槽 → onLoad 交叉淡入淡出，不闪底） */}
        {(bgLayerA || bgLayerB) && !roomPlayerFullscreen ? (
          <>
            {bgLayerA ? (
              <Animated.View
                pointerEvents="none"
                style={[styles.roomBgLayer, { opacity: bgOpacityA }]}
              >
                <ImageBackground
                  source={{ uri: bgLayerA }}
                  resizeMode="cover"
                  style={StyleSheet.absoluteFill}
                  onLoad={() => onBgSlotLoad('A')}
                  onError={() => onBgSlotError('A')}
                />
              </Animated.View>
            ) : null}
            {bgLayerB ? (
              <Animated.View
                pointerEvents="none"
                style={[styles.roomBgLayer, { opacity: bgOpacityB }]}
              >
                <ImageBackground
                  source={{ uri: bgLayerB }}
                  resizeMode="cover"
                  style={StyleSheet.absoluteFill}
                  onLoad={() => onBgSlotLoad('B')}
                  onError={() => onBgSlotError('B')}
                />
              </Animated.View>
            ) : null}
            <View
              pointerEvents="none"
              style={[styles.roomBgLayer, { backgroundColor: roomScrim }]}
            />
          </>
        ) : null}
        <View
          style={[
            styles.container,
            { paddingBottom: roomPlayer && !dual ? 0 : roomKeyboardHeight },
          ]}
        >
          {/* C5-S2/S3 双栏容器：单栏=column（播放器绝对覆盖，渲染树与旧版等价）；
            dual=row-reverse（播放器[第一个 flow 子节点]在右、聊天[第二个]在左）。
            聊天与播放器始终是「同一父容器下、同位置」的兄弟：切换 dual 只改 flexDirection/样式，
            不改变挂载树 → Chat 的 FlatList 实例与 PlayerScreen 都不 remount（冻结锚点安全）。 */}
          <View style={{ flex: 1, flexDirection: dual ? 'row-reverse' : 'column' }}>
            {roomPlayer ? (
              /* 统一播放器（重写）：房间直播/录播 → PlayerScreen（控制条/全屏/内核路由/小窗/贡献榜） */
              <View
                style={
                  dual
                    ? styles.roomPlayerPaneDual
                    : [styles.roomPlayerPage, { backgroundColor: '#000' }]
                }
              >
                {/* 房间直播公告：展开面板 / 收起后左上角小按钮；清屏时整组隐藏 */}
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
                        style={[styles.roomAnnouncePanel, { top: insets.top + 46 }]}
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
                      style={[styles.roomAnnounceBadge, { top: insets.top + 42 }]}
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
                    // 上麦/电台（type='audio'）走纯音频：不渲染画面，省一层黑屏
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
                    // dual 下右侧播放器常驻，隐藏「小窗」按钮避免双实例/双播放器
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
                          const current = roomPlayerRef.current;
                          if (!current?.liveId) {
                            usePlayerStore.getState().requestKernelRebuild();
                            return;
                          }
                          void (async () => {
                            const detail =
                              (await pocketApi.getLiveOne(current.liveId!).catch(() => null)) ||
                              (await pocketApi.getOpenLiveOne(current.liveId!).catch(() => null));
                            if (roomPlayerRef.current !== current) return;
                            const urls = pickPlayableUrls(detail, true).filter(isPlayableMediaUrl);
                            if (urls[0] && urls[0] !== current.url) {
                              setRoomPlayer({
                                ...current,
                                url: urls[0],
                                urls,
                                needsVlc: streamNeedsProxy(urls[0]),
                              });
                            } else {
                              usePlayerStore.getState().requestKernelRebuild();
                            }
                          })();
                        }
                      : undefined
                  }
                  persistent
                >
                  {/* 弹幕列表抽屉：房间直播弹幕（列表 + 搜索 + 按发送者筛选） */}
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
                <DanmakuSettingsSheet
                  staticFeed
                  visible={showRoomDanmakuSettings}
                  onClose={() => setShowRoomDanmakuSettings(false)}
                />
              </View>
            ) : null}
            {/* 挂载短路：visible=false 的 Modal 常驻房间根节点时，每次房间重渲染都会 flush Modal 窗口 → 整页闪 */}
            {rankVisible ? (
              <Modal
                visible
                transparent
                animationType="slide"
                onRequestClose={() => setRankVisible(false)}
              >
                {/* 遮罩点击层必须与面板**同级**、且排在面板之前（下层）：
              此前用 TouchableWithoutFeedback 包住整个 shade（包含面板），Pressability 会在
              手指抬起时判定 onPress → 面板内 ScrollView 刚滑一点点（或内容不足一屏没产生滚动）
              就被当成「点遮罩」直接关闭，用户感知为「下滑返回太灵敏」（2026-10-21 反馈）。
              flex:1 仍留在 shade 上：TouchableOpacity 作 Modal 直子会塌缩、面板悬空（10-19 教训）。 */}
                <View style={styles.roomModalShade}>
                  <Pressable
                    style={StyleSheet.absoluteFill}
                    onPress={() => setRankVisible(false)}
                  />
                  <GlassSurface
                    radius={22}
                    role="card"
                    style={[styles.roomRankPanel, { backgroundColor: 'transparent' }]}
                  >
                    {/* 顶部 handle */}
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
                          // 归一化进度条：取最高贡献值作为基准
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
                  </GlassSurface>
                </View>
              </Modal>
            ) : null}
            {giftVisible ? (
              <Modal
                visible
                transparent
                animationType="slide"
                onRequestClose={() => setGiftVisible(false)}
              >
                {/* 同贡献榜：点击层与面板同级、排在面板之前，礼物网格滑动不会被判成点击关闭 */}
                <View style={styles.roomModalShade}>
                  <Pressable
                    style={StyleSheet.absoluteFill}
                    onPress={() => setGiftVisible(false)}
                  />
                  <GlassSurface
                    radius={22}
                    role="card"
                    style={[styles.rgPanel, { backgroundColor: 'transparent' }]}
                  >
                    <View style={styles.rgHeader}>
                      <Text style={[styles.rgTitle, { color: palette.label }]}>
                        {giftMode === 'room' ? t('房间送礼') : t('直播送礼')}
                      </Text>
                      <TouchableOpacity
                        onPress={() => setGiftVisible(false)}
                        activeOpacity={0.8}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <Text style={[styles.rgCloseText, { color: palette.tint }]}>
                          {t('关闭')}
                        </Text>
                      </TouchableOpacity>
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
                        // 允许清空：原来 `|| 1` 会把空串立刻回填成 1，想输「5」会变成「15」（1 打底再拼 5）
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
                  </GlassSurface>
                </View>
              </Modal>
            ) : null}
            {liveResolve ? (
              /* 直播解析占位：无流地址直播卡点击后立即反馈（转圈/失败重试），出地址后由正式播放器接管 */
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
                    /* 解析中：只转圈不给过程说明（用户反馈「没必要写明出来」；40s 列表缓存+4s 超时已大幅提速） */
                    <ActivityIndicator color={palette.tint} size="large" />
                  )}
                </View>
              </View>
            ) : null}
            {/* 语音消息实际播放器：页面级隐藏 Video（仅气泡卡片交互，不渲染任何可见控件） */}
            {playingMedia && playingMedia.type === 'audio' && playingMedia.url ? (
              <Video
                key={playingMedia.url}
                source={playerSource(playingMedia.url)}
                style={styles.hiddenAudioVideo}
                paused={false}
                playInBackground
                ignoreSilentSwitch="ignore"
                onEnd={() => setPlayingMedia(null)}
                onError={() => setPlayingMedia(null)}
              />
            ) : null}
            <ZoomImageModal
              url={fullImageUrl}
              onClose={() => setFullImageUrl('')}
              onDownload={() => {
                if (!fullImageUrl) return;
                void enqueueDownload({
                  url: fullImageUrl,
                  type: 'image',
                  name: `image-${Date.now()}.jpg`,
                })
                  .then(() => showToast(t('已加入下载管理')))
                  .catch((err) => showToast(errorMessage(err)));
              }}
              onShare={() => {
                if (!fullImageUrl) return;
                void shareRemoteImage(fullImageUrl).catch(() => showToast(t('分享失败')));
              }}
            />
            {/* 用户资料卡（房间内点非成员头像）：口袋48 user/info 拉昵称/头像/等级/签名 */}
            {userCard ? (
              <Modal
                visible
                transparent
                animationType="slide"
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
                    <GlassSurface
                      radius={22}
                      role="card"
                      style={[styles.userCardPanel, { backgroundColor: 'transparent' }]}
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
                                    <Image
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
                                  {/* 只在拿到「数字 userId」时展示 ID 行：云信 accid 等内部 id 不露给用户看 */}
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
                        {/* 成员才有「主页」：跳成员档案页（公演记录/历史），粉丝没有档案页 */}
                        {userCard?.isMember && userCard.memberDbId ? (
                          <ScalePressable
                            style={[styles.userCardBtn, { backgroundColor: palette.fill2 }]}
                            pressedScale={0.95}
                            activeOpacity={0.85}
                            onPress={() => {
                              const mid = userCard.memberDbId;
                              setUserCard(null);
                              navigation.navigate('ProfileScreen', {
                                memberId: mid,
                                nonce: Date.now(),
                              });
                            }}
                          >
                            <MaterialCommunityIcons
                              name="account-details-outline"
                              size={14}
                              color={palette.tint}
                            />
                            <Text style={[styles.userCardBtnText, { color: palette.tint }]}>
                              {t('主页')}
                            </Text>
                          </ScalePressable>
                        ) : null}
                        <ScalePressable
                          style={[
                            styles.liveResolveBtnGhost,
                            {
                              paddingHorizontal: 16,
                              paddingVertical: 8,
                              borderColor: palette.hairline,
                            },
                          ]}
                          pressedScale={0.95}
                          activeOpacity={0.85}
                          onPress={() => setUserCard(null)}
                        >
                          <Text
                            style={[
                              styles.liveResolveBtnGhostText,
                              { color: palette.labelSecondary },
                            ]}
                          >
                            {t('关闭')}
                          </Text>
                        </ScalePressable>
                      </View>
                    </GlassSurface>
                  </TouchableOpacity>
                </TouchableOpacity>
              </Modal>
            ) : null}
            {/* 精华消息：工具条 ⭐ 打开。成员在官方端设为精华、全员可见（服务端接口）。
            挂载短路：抽屉关闭时不做 roomEssences.map（每条精华都要跑 senderProfile/messageBody/
            roomMedia 深解析，40+ 条 × 每次房间重渲染 = JS 抖动，用户感知为「消息在闪」） */}
            {essenceSheetOpen ? (
              <Modal
                visible
                transparent
                animationType="fade"
                onRequestClose={() => setEssenceSheetOpen(false)}
              >
                <Pressable
                  style={styles.essenceBackdrop}
                  onPress={() => setEssenceSheetOpen(false)}
                />
                <View style={[styles.essenceSheet, { backgroundColor: palette.surfaceElevated }]}>
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
                        // 图片/表情类精华没有正文，messageText 返回空 —— 走媒体分支，否则整条被丢掉
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
                                onPress={() => setFullImageUrl(em.url)}
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
            {/* 聊天区（header + 工具条 + 消息列表 + 输入条）= 双栏左栏（row-reverse 下第二个 flow 子节点）。
            单栏时同样包这层 flex:1 column，尺寸与旧渲染树等价。 */}
            <View
              nativeID="yaya.pip.overlay"
              collapsable={false}
              style={{ flex: 1, minWidth: 0, flexDirection: 'column' }}
            >
              <ScreenHeader
                title={headerTitle}
                onBack={closeRoom}
                overlay={!!roomBgUri}
                right={
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <TouchableOpacity
                      style={[
                        styles.followBtn,
                        { backgroundColor: isFollowingRoom ? palette.tintSoft : palette.tint },
                      ]}
                      disabled={followBusyRoom}
                      onPress={() => toggleFollow(selectedRoom)}
                      activeOpacity={0.85}
                      hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
                    >
                      {followBusyRoom ? (
                        <ActivityIndicator
                          color={isFollowingRoom ? palette.tint : palette.onTint}
                          size="small"
                        />
                      ) : (
                        <Text
                          style={[
                            styles.followBtnText,
                            { color: isFollowingRoom ? palette.tint : palette.onTint },
                          ]}
                        >
                          {isFollowingRoom ? t('已关注') : t('关注')}
                        </Text>
                      )}
                    </TouchableOpacity>
                  </View>
                }
              />

              {/* 聊天工具条：玻璃浮层（消息从下方滚过，滚到标题下方红线为止）*/}
              <View style={{ height: 0, zIndex: 30, elevation: 30 }}>
                <View style={[styles.chatToolsClip, { borderColor: palette.innerStroke }]}>
                  <ToolbarShell
                    {...(IS_SAMSUNG
                      ? {}
                      : {
                          intensity: 36,
                          tint: resolvedTheme === 'dark' ? 'dark' : 'light',
                          blurTarget: blurTarget ?? undefined,
                          blurMethod: 'dimezisBlurViewSdk31Plus',
                          /* ⚠️【功耗/卡顿】必须给降采样系数：不传 = 全分辨率模糊，
                       这条工具条常驻且叠在滚动消息列表上方，逐帧按原分辨率算 RenderEffect
                       是房间页掉帧/发热的大头（尤其三星）。6 与 GlassSurface 保持同一档。 */
                          blurReductionFactor: Platform.OS === 'android' ? 6 : 4,
                        })}
                    style={[
                      styles.chatTools,
                      /* 半透明：让房间背景/下方内容透出来（用户要求「信息流透过顶部工具条」）。
                   三星走实底兜底（OneUI blur 不稳），其余平台用低透明度 tint。 */
                      IS_SAMSUNG
                        ? {
                            backgroundColor:
                              resolvedTheme === 'dark'
                                ? 'rgba(20,20,24,0.55)'
                                : 'rgba(255,255,255,0.55)',
                          }
                        : {
                            backgroundColor:
                              resolvedTheme === 'dark'
                                ? 'rgba(20,20,24,0.28)'
                                : 'rgba(255,255,255,0.30)',
                          },
                    ]}
                  >
                    {roomSearchOpen ? (
                      /* 搜索态：输入框原位替换分段切换（房间内搜索 = 搜消息） */
                      <>
                        <MaterialCommunityIcons
                          name="magnify"
                          size={17}
                          color={palette.labelTertiary}
                        />
                        <TextInput
                          style={{
                            flex: 1,
                            fontSize: 14,
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
                            onPress={() => setRoomSearchQuery('')}
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
                        {/* 分段切换：大房间 / 小房间（玻璃滑动选中） */}
                        <GlassSegmented
                          options={[
                            { key: 'big', label: t('大房间') },
                            { key: 'small', label: t('小房间') },
                          ]}
                          value={roomMode}
                          onChange={(k) =>
                            selectedRoom &&
                            openRoom(
                              selectedRoom,
                              k as 'big' | 'small',
                              showFanMessages,
                              'internal',
                            )
                          }
                          height={34}
                          style={{ width: 150 }}
                        />
                        <View style={{ flex: 1 }} />
                      </>
                    )}
                    <ScalePressable
                      style={[
                        styles.chatToolCircle,
                        { backgroundColor: essenceSheetOpen ? palette.tint : palette.fill2 },
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
                              : palette.labelSecondary
                        }
                      />
                    </ScalePressable>
                    <ScalePressable
                      style={[
                        styles.chatToolCircle,
                        { backgroundColor: roomSearchOpen ? palette.tint : palette.fill2 },
                      ]}
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
                      style={[
                        styles.chatToolCircle,
                        { backgroundColor: showFanMessages ? palette.tint : palette.fill2 },
                      ]}
                      onPress={() => openRoom(selectedRoom, roomMode, !showFanMessages, 'internal')}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      pressedScale={0.9}
                    >
                      <MaterialCommunityIcons
                        name="account-group"
                        size={18}
                        color={showFanMessages ? palette.onTint : palette.labelSecondary}
                      />
                    </ScalePressable>
                    {!!onMicMap[String(selectedRoom.id || selectedRoom.userId || '')] ? (
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

              <FadeInView delay={0} duration={160} style={{ flex: 1 }}>
                {/* 官方 demo 用法：messages / user / onSend + 官方 loadEarlierMessagesProps */}
                <Chat
                  // 上划看历史时用冻结快照，新消息只计数（QQ 行为），不会被拽回底部
                  messages={roomListIms}
                  // 背景透明：露出页面/房间背景图（库默认灰底会把它整块盖住）
                  // ⚠️ OneUI/三星：只传 theme 仍可能被库/系统解析成深色底 → 同时传 darkTheme，
                  // 并显式给列表容器透明，确保消息区不盖住房间背景图。
                  theme={CHAT_THEME as any}
                  darkTheme={CHAT_THEME as any}
                  messagesContainerStyle={CHAT_MESSAGES_CONTAINER_STYLE as any}
                  // ⚠️ 不用库自带的「回到底部」气泡：它渲染在列表**内部**，
                  // 安卓 ScrollView 在惯性滑动时会拦截触摸（第一下只停止滚动），
                  // 表现为「滑消息时按回到底部很难按」。改用页面自绘浮层（见下方 roomJumpBtn）。
                  isScrollToBottomEnabled={false}
                  messagesContainerRef={roomListRef}
                  listProps={roomChatListProps}
                  locale="zh"
                  // 日期分隔：纯数字「今天/昨天/x月x日」，居中显示（renderDayLabel）
                  // 整行自定义：用页面既有的 renderChatItem —— 头像、气泡外的发送者名字、
                  // 回复卡片、礼物、媒体全都保留；气泡本身是玻璃（GlassSurface）。
                  // 不再用 renderBubble：它只能改气泡内部，名字被迫塞进气泡里（与设计不符）。
                  renderMessage={renderChatMessage}
                  renderDay={renderDayLabel}
                  isDayAnimationEnabled={false}
                  user={CHAT_USER as any}
                  onSend={NOOP_SEND}
                  renderInputToolbar={NO_INPUT_TOOLBAR}
                  loadEarlierMessagesProps={roomLoadEarlierProps}
                />
                {/* 「回到底部 / N 条新消息」浮层：挂在 Chat 之外（列表之上的兄弟节点），
              惯性滑动时按下也能立即命中——库自带的按钮在列表内部会被 ScrollView 吃掉第一下触摸。 */}
                {!roomAtBottom || roomPendingCount > 0 ? (
                  <ScalePressable
                    onPress={roomJumpOut}
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
                      {roomPendingCount > 0
                        ? t('{count} 条新消息', { count: roomPendingCount })
                        : t('回到底部')}
                    </Text>
                  </ScalePressable>
                ) : null}
              </FadeInView>

              {/* 直播中的实时弹幕（云信聊天室）：与录播弹幕（LRC）是两条独立链路 */}
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

              {/* 房间发言（云信圈组）：HTTP 侧只有历史，发送必须走云信 */}
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
                  <TouchableOpacity onPress={() => setReplyTarget(null)} hitSlop={10}>
                    <MaterialCommunityIcons name="close" size={18} color={palette.labelTertiary} />
                  </TouchableOpacity>
                </View>
              ) : null}
              {roomSendHint ? (
                <Text style={[styles.roomSendHint, { color: palette.tint }]} numberOfLines={2}>
                  {roomSendHint}
                </Text>
              ) : null}
              <GlassSurface
                role="chip"
                radius={18}
                style={[
                  styles.roomInputBar,
                  {
                    backgroundColor: 'transparent',
                    borderColor: palette.hairline,
                    borderWidth: StyleSheet.hairlineWidth,
                    marginBottom:
                      stickerPanelOpen || roomKeyboardHeight
                        ? 8
                        : 16 /* 与底部 Dock 的 paddingBottom(16) 对齐：最低处同一条线 */,
                  },
                ]}
              >
                <TouchableOpacity
                  onPress={() => openRoomGiftPanel()}
                  activeOpacity={0.85}
                  style={styles.roomGiftBtn}
                  accessibilityLabel={t('礼物')}
                >
                  <MaterialCommunityIcons name="gift-outline" size={20} color={palette.tint} />
                </TouchableOpacity>
                <TextInput
                  style={[styles.roomInput, { color: palette.label }]}
                  value={roomDraft}
                  onChangeText={(next) => {
                    setRoomDraft(next);
                    if (roomSendHint) setRoomSendHint('');
                  }}
                  onFocus={() => setStickerPanelOpen(false)}
                  placeholder={t('说点什么…')}
                  placeholderTextColor={palette.labelTertiary}
                  maxLength={200}
                  returnKeyType="send"
                  onSubmitEditing={handleSendRoomMessage}
                />
                <TouchableOpacity
                  onPress={() => {
                    Keyboard.dismiss();
                    setStickerPanelOpen((open) => !open);
                  }}
                  style={styles.roomEmojiBtn}
                  accessibilityLabel={t('表情包')}
                >
                  <MaterialCommunityIcons name="emoticon-outline" size={22} color={palette.tint} />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleSendRoomMessage}
                  disabled={roomSending || !roomDraft.trim()}
                  activeOpacity={0.85}
                  style={[
                    styles.roomSendBtn,
                    { backgroundColor: roomDraft.trim() ? palette.tint : palette.fill3 },
                  ]}
                >
                  <Text
                    style={[
                      styles.roomSendBtnText,
                      { color: roomDraft.trim() ? palette.onTint : palette.labelTertiary },
                    ]}
                  >
                    {roomSending ? '··' : t('发送')}
                  </Text>
                </TouchableOpacity>
              </GlassSurface>
              {stickerPanelOpen ? (
                <View style={{ paddingBottom: Math.max(8, roomNavigationInset) }}>
                  <RoomStickerPanel
                    channelId={activeRoomRef.current.channelId}
                    ownerId={activeRoomRef.current.memberId}
                    disabled={roomSending}
                    onEmoji={(tag) => setRoomDraft((draft) => (draft + tag).slice(0, 200))}
                    onSticker={handleSendRoomSticker}
                  />
                </View>
              ) : null}
            </View>
            {/* chatPane end（双栏左栏） */}
          </View>
          {/* pane container end（C5-S2/S3） */}
          {/* 消息长按操作面板：圆角玻璃卡，与成员菜单同一套视觉（替代原生 Alert） */}
          {msgMenu ? (
            <Modal visible transparent animationType="fade" onRequestClose={() => setMsgMenu(null)}>
              <TouchableOpacity
                style={styles.roomModalShade}
                activeOpacity={1}
                onPress={() => setMsgMenu(null)}
              >
                <TouchableOpacity activeOpacity={1} onPress={() => {}} style={styles.roomMenuWrap}>
                  <GlassSurface
                    radius={22}
                    role="card"
                    style={[styles.roomMenuPanel, { backgroundColor: 'transparent' }]}
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
                  </GlassSurface>
                </TouchableOpacity>
              </TouchableOpacity>
            </Modal>
          ) : null}
        </View>
      </Reanimated.View>
    );
  }

  return (
    <View style={[styles.container]}>
      <ScreenHeader
        title={t('房间')}
        hideBack
        right={
          <View style={styles.headerActions}>
            <TouchableOpacity
              onPress={() => {
                if (searchOpen) {
                  setSearchQuery('');
                  Keyboard.dismiss();
                }
                setSearchOpen((v) => !v);
              }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              activeOpacity={0.85}
            >
              <MaterialCommunityIcons
                name={searchOpen ? 'close' : 'magnify'}
                size={22}
                color={palette.label}
              />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => loadFollowed()}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              activeOpacity={0.85}
            >
              <MaterialCommunityIcons name="refresh" size={22} color={palette.label} />
            </TouchableOpacity>
          </View>
        }
      />

      {/* 房间长按快捷菜单（自研 Modal：Android 的 Alert 只显示前 3 个按钮） */}
      {roomMenu ? (
        <Modal visible transparent animationType="fade" onRequestClose={closeRoomMenu}>
          <TouchableOpacity style={styles.roomModalShade} activeOpacity={1} onPress={closeRoomMenu}>
            <TouchableOpacity activeOpacity={1} onPress={() => {}} style={styles.roomMenuWrap}>
              <GlassSurface
                radius={22}
                role="card"
                style={[styles.roomMenuPanel, { backgroundColor: 'transparent' }]}
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
              </GlassSurface>
            </TouchableOpacity>
          </TouchableOpacity>
        </Modal>
      ) : null}

      {searchOpen ? (
        <View
          style={[
            styles.searchBar,
            {
              backgroundColor:
                palette.name === 'dark' ? 'rgba(255,255,255,0.09)' : 'rgba(255,255,255,0.74)',
              borderColor: palette.hairline,
            },
          ]}
        >
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
            <TouchableOpacity
              onPress={() => {
                setSearchQuery('');
                // 用户点 × 是「结束这次搜索」，不是只清文本：必须同时收键盘。
                Keyboard.dismiss();
              }}
              accessibilityLabel={t('清除搜索')}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              activeOpacity={0.85}
            >
              <MaterialCommunityIcons name="close-circle" size={16} color={palette.labelTertiary} />
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

      <FadeInView delay={80} duration={300} style={{ flex: 1 }}>
        {searchOpen && searchQuery.trim() ? (
          /* 搜索态：成员库结果直接走 FlatList（可滚动、虚拟化）。
             单列整行卡（原来是 2 列竖排大卡，一屏只容 3 行、信息密度太低） */
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
              ListHeaderComponent={
                <View style={styles.memberHitsHeader}>
                  <Text style={[styles.memberHitsTitle, { color: palette.label }]}>
                    {t('成员')}
                  </Text>
                  <Text style={[styles.memberHitsCount, { color: palette.labelTertiary }]}>
                    {t('{count} 位', { count: memberHits.length })}
                  </Text>
                </View>
              }
              ItemSeparatorComponent={() => (
                <View style={[styles.memberHitSeparator, { backgroundColor: palette.hairline }]} />
              )}
              renderItem={({ item: member }) => {
                const mid = String(member.id || member.userId || '');
                const isFollowing = followedIds.has(mid);
                const busy = followBusy.has(mid);
                const name = shortName(member, mid);
                const team = member.team || member.groupName || t('成员');
                return (
                  <View style={styles.memberGridItem}>
                    {/* ⚠️ 列表逐行禁止 GlassSurface（滚动逐帧重算模糊 → 掉帧）。
                      搜索结果改用「无卡片 + 分隔线」的 iOS 列表样式，信息密度更高、视觉更轻。 */}
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
                        {}
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
            // 滚动锚点（B6）：30s 静默刷新替换数据 / 置顶重排时保持用户当前可见位置，不被弹回顶部
            maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
            keyExtractor={(item) => String(item.memberId)}
            contentContainerStyle={styles.listContent}
            ListFooterComponent={<ListBottomSpacer />}
            // 房间列表页顶部有搜索框：滑列表时收键盘，否则键盘一直压着大半个列表（用户截图现象）
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => {
              const fid = String(item.member?.id || item.memberId);
              const isFollowing = followedIds.has(fid);
              const busy = followBusy.has(fid);
              const isPinned = pinned.includes(item.memberId);
              const name = shortName(item.member, item.memberId);
              const team = item.member?.team || item.member?.groupName || '';
              const lastText = item.lastMessage ? messageText(item.lastMessage) : '';
              // 直播中判定：以直播列表接口为准（id / liveRoomId / account / 昵称命中关注成员）
              const mid = String(item.member?.id || item.memberId);
              const mroom = String(item.member?.liveRoomId || '');
              const macct = String(item.member?.account || '');
              const mnick = String(item.member?.ownerName || '')
                .replace(/^(SNH48|GNZ48|BEJ48|CKG48|CGT48)-/i, '')
                .trim()
                .toLowerCase();
              const isLiveNow =
                liveNow.ids.has(mid) ||
                (mroom && liveNow.ids.has(mroom)) ||
                (macct && liveNow.ids.has(macct)) ||
                (mnick && liveNow.names.has(mnick));
              // 上麦中/语聊中：与直播中互斥，复用直播中徽标槽位
              const isOnMic = !isLiveNow && !!onMicMap[mid];
              const roomKey = `${String(item.member?.serverId || '')}:${String(item.member?.channelId || '')}`;
              const isVoiceRoom = !isLiveNow && !isOnMic && !!voiceRooms[roomKey];
              return (
                <View style={styles.roomRow}>
                  {/* 半透明底色保留背景，同时避免长列表逐卡模糊。 */}
                  <View
                    style={[
                      styles.roomRowCard,
                      {
                        backgroundColor:
                          palette.name === 'dark'
                            ? 'rgba(28,28,34,0.68)'
                            : 'rgba(255,255,255,0.58)',
                        borderColor:
                          palette.name === 'dark'
                            ? 'rgba(255,255,255,0.10)'
                            : 'rgba(255,255,255,0.66)',
                      },
                    ]}
                  >
                    <ScalePressable
                      style={styles.roomRowMain}
                      onPress={() => item.member && openRoom(item.member)}
                      onLongPress={() => setRoomMenu(item)}
                      delayLongPress={400}
                      pressedScale={0.98}
                      activeOpacity={0.9}
                    >
                      {/* 封面 56 圆角 12 */}
                      <View
                        style={[
                          styles.roomCover,
                          { backgroundColor: palette.tintSoft, borderColor: palette.hairline },
                        ]}
                      >
                        {item.member?.avatar ? (
                          <NetworkImage
                            source={{ uri: thumbUrl(item.member.avatar, AVATAR_THUMB_WIDTH) }}
                            style={styles.roomCoverImg}
                          />
                        ) : (
                          <Text
                            style={[styles.roomCoverText, { color: palette.tint }]}
                            numberOfLines={1}
                          >
                            {avatarInitial(name)}
                          </Text>
                        )}
                      </View>
                      <View style={styles.roomInfo}>
                        <View style={styles.roomNameRow}>
                          <Text
                            style={[styles.roomName, { color: palette.label }]}
                            numberOfLines={1}
                          >
                            {name}
                          </Text>
                          {/* 在线状态点：有最近消息视为在线 */}
                          <View
                            style={[
                              styles.statusDot,
                              {
                                backgroundColor: isLiveNow
                                  ? palette.success
                                  : palette.labelTertiary,
                              },
                            ]}
                          />
                          {isLiveNow ? (
                            <View style={[styles.liveBadgeChip, { backgroundColor: palette.tint }]}>
                              <MaterialCommunityIcons
                                name="broadcast"
                                size={10}
                                color={palette.onTint}
                              />
                              <Text style={styles.liveBadgeChipText}>{t('直播中')}</Text>
                            </View>
                          ) : isOnMic ? (
                            <View style={[styles.liveBadgeChip, { backgroundColor: palette.tint }]}>
                              <MaterialCommunityIcons
                                name="microphone"
                                size={10}
                                color={palette.onTint}
                              />
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
                            <View
                              style={[styles.pinTagChip, { backgroundColor: palette.tintSoft }]}
                            >
                              <MaterialCommunityIcons name="pin" size={10} color={palette.tint} />
                              <Text style={[styles.pinTagChipText, { color: palette.tint }]}>
                                {t('置顶')}
                              </Text>
                            </View>
                          ) : null}
                        </View>
                        {/* 房间列表信息区恢复原版布局：team 独立行 + 大房间预览 + 小房间预览（各一行）。
                        卡片总高用 minHeight 拉齐：行少成员内容靠底部留白补足 */}
                        {team ? (
                          <Text
                            style={[styles.roomTeam, { color: palette.labelTertiary }]}
                            numberOfLines={1}
                          >
                            {team}
                          </Text>
                        ) : null}
                        {lastText ? (
                          <View style={styles.lastRow}>
                            <View style={[styles.lastTag, { backgroundColor: palette.tintSoft }]}>
                              <Text style={[styles.lastTagText, { color: palette.tint }]}>
                                {t('大')}
                              </Text>
                            </View>
                            <Text
                              style={[
                                styles.roomLast,
                                { color: palette.labelSecondary, marginTop: 0, flex: 1 },
                              ]}
                              numberOfLines={1}
                            >
                              {lastText}
                            </Text>
                          </View>
                        ) : null}
                        {(() => {
                          // 小房间始终显示入口行（有 yklzId 即可），不再依赖是否有小房间消息 ——
                          // 否则「有小房间但还没消息」时用户看不到小房间入口（周文迪 反馈）
                          const ykid = String(item.member?.yklzId || '');
                          if (!ykid || ykid === '0' || ykid === 'undefined') return null;
                          const sMsg = item.lastSmallMessage;
                          const sText = sMsg ? messageText(sMsg) : '';
                          if (sText && sText === lastText) return null; // 与大房间预览相同时省略重复行
                          return (
                            <View style={styles.lastRow}>
                              <View style={[styles.lastTag, { backgroundColor: palette.fill2 }]}>
                                <Text
                                  style={[styles.lastTagText, { color: palette.labelSecondary }]}
                                >
                                  {t('小')}
                                </Text>
                              </View>
                              <Text
                                style={[styles.roomLast, { color: palette.labelTertiary }]}
                                numberOfLines={1}
                              >
                                {sText || t('小房间 {id}', { id: ykid })}
                              </Text>
                            </View>
                          );
                        })()}
                      </View>
                    </ScalePressable>
                    <View style={styles.roomActions}>
                      <ScalePressable
                        style={[
                          styles.roomPinBtn,
                          { backgroundColor: isPinned ? palette.tintSoft : palette.fill2 },
                        ]}
                        onPress={() => togglePin(item.memberId)}
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
                      <ScalePressable
                        style={[
                          styles.roomFollowBtn,
                          { backgroundColor: isFollowing ? palette.tintSoft : palette.fill2 },
                        ]}
                        disabled={busy}
                        pressedScale={0.9}
                        activeOpacity={0.85}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        accessibilityLabel={isFollowing ? t('已关注') : t('关注')}
                        onPress={() => {
                          if (isFollowing) {
                            showDialog(
                              t('取消关注'),
                              t('确定不再关注 {name} 吗？', {
                                name: shortName(item.member, item.memberId),
                              }),
                              [
                                { text: t('保留'), style: 'cancel' },
                                {
                                  text: t('取消关注'),
                                  style: 'destructive',
                                  onPress: () => item.member && toggleFollow(item.member),
                                },
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
                </View>
              );
            }}
            ListEmptyComponent={
              searchOpen && searchQuery.trim() ? null : followedLoading ? (
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
              ) : (
                <EmptyState icon="heart-outline" title={t('暂无关注房间')} />
              )
            }
            initialNumToRender={12}
            maxToRenderPerBatch={12}
            windowSize={7}
            // removeClippedSubviews 已移除：Fabric 新架构下会快速卸载/挂载离屏子视图，
            // 与 addViewAt 挂载指令竞态 → RetryableMountingLayerException 真机崩溃。
            // PerfFlatList 默认已关闭该项，这里不再显式传。
          />
        )}
      </FadeInView>
    </View>
  );
}

/**
 * Chat 的常量 props。
 * 以前这些都写成内联字面量（`theme={{...}}`），父组件每 setState 一次
 * （打字、收到弹幕、开面板）都会生成新对象 → Chat 整棵树重渲染。
 */
const CHAT_THEME = { colors: { background: 'transparent' } } as const;
const CHAT_USER = { _id: 'SELF' } as const;
/**
 * Chat 外层包裹容器（`messagesContainerStyle` 作用于列表**外层 View**，不是列表内容）。
 * ⚠️ 这里只能保持透明、不要再加 paddingTop/paddingBottom：
 * 外层的 padding 会整体压缩/下推列表（此前 paddingTop:54 把消息压到工具条下方、
 * paddingBottom:54 又把底部内容截断），方向与「inverted 列表」无关。
 * 首条留白请走下面 `roomChatListProps.contentContainerStyle`。
 */
const CHAT_MESSAGES_CONTAINER_STYLE = { backgroundColor: 'transparent' } as const;
/**
 * 房间消息列表的**内容容器**样式。
 * 聊天列表是 inverted（视觉翻转）：contentContainerStyle 的 paddingBottom 才是
 * **视觉顶部**留白（paddingTop 对应视觉底部）。顶部需要留出工具条的高度，
 * 让滚到最上面的首条消息停在工具条下方、不被永久遮住。
 * 46 ≈ 工具条高度（chatTools: padding 6*2 + 内容 34），再多给 8 的间隙。
 * 默认库自带 paddingBottom:10 会被整体覆盖，这里显式给足。
 */
const ROOM_CHAT_LIST_CONTENT_STYLE = { paddingBottom: 54, paddingTop: 0 } as const;
/** 房间页不用库的输入条：常量函数，避免每次渲染换引用 */
const NO_INPUT_TOOLBAR = () => null;
const NOOP_SEND = () => {};
