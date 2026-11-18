/**
 * 房间媒体解析工具（从 FollowedRoomsScreen 抽出的纯函数，无 React 依赖）。
 *
 * 抽离目的：该屏 5,000+ 行，媒体/流判定逻辑占其中一大块且全是纯函数；
 * 抽出后主屏只剩 UI 与状态编排，便于维护与单测。
 *
 * 规则与原 FollowedRoomsScreen 实现保持一致；类型收窄时保留了原有 URL 判定范围。
 */
import { getPath, normalizeUrl, parseMaybeJson, pickText } from '../../utils/data';
import { normalizePrivateMediaUrl } from '../../utils/mediaUrl';
import { streamScore } from '../../player/resolve/streamResolver';
import { WireRecord } from '../../types';

export type MediaType = 'audio' | 'video' | 'live' | 'image' | 'link';

const URL_REG = /(https?:\/\/[^\s"'<>，。！？、]+|rtmp:\/\/[^\s"'<>，。！？、]+)/gi;

export function normalizeMediaCandidate(raw: unknown): string {
  const text = String(raw || '').trim();
  if (!text) return '';
  if (/^https?:\/\//i.test(text) || text.startsWith('rtmp://')) return normalizeUrl(text);
  if (
    /\.(mp3|m4a|aac|amr|wav|mp4|mov|m4v|3gp)(\?|$)/i.test(text) ||
    /^(?:\/)?(?:voice|record)\//i.test(text)
  ) {
    return normalizePrivateMediaUrl(text, 'mp4');
  }
  if (
    /\.(jpe?g|png|webp|gif|bmp)(\?|$)/i.test(text) ||
    /^(?:\/)?(?:avatar|mediasource|imagesource)\//i.test(text)
  ) {
    return normalizePrivateMediaUrl(text, 'source');
  }
  return normalizeUrl(text);
}

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
  'voiceInfo.voiceUrl',
  'voiceInfo.audioUrl',
  'voiceInfo.url',
  'voiceInfo.path',
  'voiceInfo.filePath',
  'audioInfo.audioUrl',
  'audioInfo.voiceUrl',
  'audioInfo.url',
  'audioInfo.path',
  'giftReplyInfo.voiceUrl',
  'giftReplyInfo.audioUrl',
  'giftReplyInfo.url',
  'giftReplyInfo.voiceInfo.url',
  'giftReplyInfo.voiceInfo.voiceUrl',
  'replyInfo.voiceUrl',
  'replyInfo.audioUrl',
  'replyInfo.url',
  'replyInfo.voiceInfo.url',
  'replyInfo.voiceInfo.voiceUrl',
  'reply.voiceUrl',
  'reply.audioUrl',
  'replay.voiceUrl',
  'replay.audioUrl',
  'voice.url',
  'attachment.voiceUrl',
  'attachment.audioUrl',
  'attachment.url',
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

export function isRawJsonText(value: string) {
  const text = String(value || '').trim();
  return (
    (text.startsWith('{') && text.endsWith('}')) || (text.startsWith('[') && text.endsWith(']'))
  );
}

export function collectUrls(value: unknown, result: string[] = [], depth = 0) {
  if (!value || depth > 6) return result;
  if (typeof value === 'string') {
    const matches = value.match(URL_REG) || [];
    matches.forEach((url) => result.push(normalizeMediaCandidate(url)));
    const trimmed = value.trim();
    if (
      !/^https?:\/\//i.test(trimmed) &&
      (/\.(mp3|m4a|aac|amr|wav|mp4|mov|m3u8|flv)(\?|$)/i.test(trimmed) ||
        /^(?:\/)?(?:voice|record)\//i.test(trimmed))
    ) {
      result.push(normalizeMediaCandidate(trimmed));
    }
    return result;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectUrls(item, result, depth + 1));
    return result;
  }
  if (typeof value === 'object') {
    const skipKeys = new Set([
      'avatar',
      'headImg',
      'headUrl',
      'picPath',
      'coverPath',
      'coverUrl',
      'avatarUrl',
      'userAvatar',
      'senderAvatar',
      // 队标/粉丝牌等「身份徽章」图：**永远不是消息内容**。此前只跳过头像类键，
      // ext.user.teamLogo 会被下面的正则捞出来当图片消息渲染
      // （用户实测：SNH48-雷薪梦 的文字消息下面挂着绿色 XII 队标大图）。
      'teamLogo',
      'teamLogoUrl',
      'teamPic',
      'teamBadge',
      'teamIcon',
      'teamHeadImg',
      'pfUrl',
      'headFrame',
      'pictureFrame',
      'frameUrl',
      'badgeUrl',
      'medalUrl',
      'levelIcon',
      'vipIcon',
      'badge',
      'badges',
      'badgeList',
      'badgeInfo',
      'badgeInfos',
      'userBadge',
      'seineBadge',
      'seineBadgeList',
      'specialBadge',
      'monthCardBadge',
      'nameplateList',
      'nameplate',
      'decoration',
      'decorations',
      'userDecoration',
      'avatarFrame',
      'avatarPendant',
      'headPendant',
      'pendant',
      'bubbleInfo',
      'user',
      'userInfo',
      'sender',
      // extInfo/msgExtInfo = 序列化元数据（module/channelRole/user 头像/bubbleId），其中 JSON 字符串会被正则
      // 捞出头像等非媒体 URL——徐钰涵公式照泄漏主因，一律跳过（真正的媒体在 body/已解析 ext 中另扫）
      'extInfo',
      'msgExtInfo',
      'extMsgInfo',
      'attachInfo',
    ]);
    for (const [key, val] of Object.entries(value)) {
      if (skipKeys.has(key)) continue;
      if (typeof val === 'string' && isRawJsonText(val)) {
        const parsed = parseMaybeJson(val);
        if (parsed && typeof parsed === 'object') collectUrls(parsed, result, depth + 1);
        continue;
      }
      collectUrls(val, result, depth + 1);
    }
  }
  return result;
}

export function pickPlayableUrls(raw: unknown, preferLive = false): string[] {
  const candidates: string[] = [];
  const listPaths = [
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
  ];
  const sources = Array.isArray(raw) ? raw : [raw];
  for (const source of sources) {
    const direct = normalizeMediaCandidate(pickText(source, PLAY_URL_FIELDS));
    if (direct) candidates.push(direct);
    for (const path of listPaths) {
      const nested = getPath(source, path);
      if (!Array.isArray(nested)) continue;
      nested.forEach((item) => {
        const url = normalizeMediaCandidate(
          typeof item === 'string' ? item : pickText(item, PLAY_URL_FIELDS),
        );
        if (url) candidates.push(url);
      });
    }
  }
  collectUrls(raw).forEach((url) => candidates.push(url));
  return Array.from(new Set(candidates.filter(Boolean))).sort(
    (a, b) => streamScore(b, preferLive) - streamScore(a, preferLive),
  );
}

export function extractLiveIdFromText(value: unknown): string {
  const raw = typeof value === 'string' ? value : JSON.stringify(value || '');
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {}
  const text = `${raw} ${decoded}`;
  return String(
    text.match(/[?&](?:liveId|liveid|live_id)=([0-9]+)/i)?.[1] ||
      text.match(/[?&](?:id|live)=([0-9]{5,})/i)?.[1] ||
      text.match(/(?:liveId|liveid|live_id)["'\s:=]+([0-9]+)/i)?.[1] ||
      text.match(/\/(?:live|playback|record|replay)\/([0-9]+)/i)?.[1] ||
      '',
  );
}

export function isPlayableMediaUrl(url: string) {
  const lower = String(url || '').toLowerCase();
  return (
    lower.startsWith('rtmp://') ||
    lower.includes('.m3u8') ||
    lower.includes('.flv') ||
    /\.(mp4|mov|m4v|3gp|mp3|m4a|aac|amr|wav)(\?|$)/i.test(lower) ||
    lower.includes('playstream') ||
    // 原实现为 includes('stream')：保留对无扩展名 /stream?...、streampath 等地址的兼容。
    lower.includes('stream')
  );
}

export function streamNeedsProxy(url: string): boolean {
  const lower = String(url || '').toLowerCase();
  return lower.startsWith('rtmp://') || lower.includes('.flv');
}

export function isLiveStreamUrl(url: string): boolean {
  const lower = String(url || '').toLowerCase();
  return lower.startsWith('rtmp://') || lower.includes('.flv') || lower.includes('.m3u8');
}

export function classifyMedia(url: string, msgType: string, text: string): MediaType {
  const upperType = String(msgType || '').toUpperCase();
  if (
    upperType === 'AUDIO' ||
    upperType === 'AUDIO_REPLY' ||
    upperType === 'AUDIO_GIFT_REPLY' ||
    upperType === 'FLIPCARD_AUDIO' ||
    upperType.includes('AUDIO') ||
    upperType.includes('VOICE')
  ) {
    return 'audio';
  }
  // 先按明确扩展名判定（最高优先级）：避免 url 里含 "live" 字样的普通 .mp4/.m3u8 视频被误判成直播。
  if (/\.(mp4|mov|m4v|3gp)(\?|$)/i.test(url)) return 'video';
  if (/\.(m3u8|flv|ts)(\?|$)/i.test(url) || url.toLowerCase().startsWith('rtmp://')) return 'live';
  if (/\.(mp3|m4a|aac|amr|wav)(\?|$)/i.test(url)) return 'audio';
  if (
    /\.(jpg|jpeg|png|gif|webp)(\?|$)/i.test(url) ||
    upperType.includes('IMAGE') ||
    upperType.includes('EXPRESS')
  )
    return 'image';
  // 扩展名兜底后再按关键字判定（live/playback/record/replay 等无扩展名场景）
  const lower = `${url} ${msgType} ${text}`.toLowerCase();
  if (lower.includes('live') || lower.includes('playback') || lower.includes('replay'))
    return 'live';
  if (lower.includes('voice') || lower.includes('audio')) return 'audio';
  if (lower.includes('record') && !lower.includes('voice') && !lower.includes('audio'))
    return 'live';
  if (lower.includes('video')) return 'video';
  return 'link';
}

// 诊断：收集媒体消息里所有「疑似时长」的数字字段，用于定位真实 duration 字段名。
// 仅在 duration 取不到（返回空）时打印；限频每 30s 最多一次。
// 注意：release 包也打印（去掉 __DEV__ 守卫），便于真机实跑反馈音频时长字段名；低频无碍。
const __diagThrottle: { last: number } = { last: 0 };
export function diagDurationFields(label: string, sources: unknown[]) {
  const now = Date.now();
  if (now - __diagThrottle.last < 30000) return;
  __diagThrottle.last = now;
  const candidates: Record<string, unknown> = {};
  for (const src of sources) {
    if (!src || typeof src !== 'object') continue;
    for (const [k, v] of Object.entries(src)) {
      if (!/duration|time|length|second|ms$/i.test(k)) continue;
      if (typeof v === 'number' || (typeof v === 'string' && /^\d+(\.\d+)?$/.test(v.trim()))) {
        candidates[k] = v;
      }
    }
  }
  // eslint-disable-next-line no-console
  console.log(
    `[diag:duration:${label}] candidates=`,
    JSON.stringify(candidates),
    'type=',
    String((sources[0] as WireRecord | undefined)?.msgType || ''),
  );
}
