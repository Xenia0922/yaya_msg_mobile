import { StreamKind, PlayerSource } from '../types';
import { normalizeUrl, pickText, unwrapList } from '../../utils/data';
import { USER_AGENT } from '../../constants';

const RE_VIDEO_EXT = /\.(mp4|mov|m4v|3gp)(\?|$)/i;
const RE_LIVE_EXT = /\.(m3u8|flv|ts)(\?|$)/i;
const RE_AUDIO_EXT = /\.(mp3|m4a|aac|amr|wav)(\?|$)/i;
const RE_IMAGE_EXT = /\.(jpg|jpeg|png|gif|webp)(\?|$)/i;
const RE_RTMP = /^rtmps?:\/\//i;

const RE_MEDIA_QUERY_HINT =
  /[?&](?:format|type|ext|suffix)=(?:hls|m3u8|flv|mp4|mov|m4v|mp3|m4a|aac|amr|wav)\b/i;

export function isRtmpUrl(url: string): boolean {
  return RE_RTMP.test(String(url || '').trim());
}

export function classifyUrl(url: string, msgType = '', text = ''): StreamKind {
  const lower = `${url} ${msgType} ${text}`.toLowerCase();
  if (RE_VIDEO_EXT.test(url)) return 'vod';
  if (RE_LIVE_EXT.test(url) || isRtmpUrl(url)) return 'live';
  if (RE_AUDIO_EXT.test(url)) return 'audio';
  if (RE_IMAGE_EXT.test(url) || lower.includes('image') || lower.includes('expressimage'))
    return 'image';

  if (
    lower.includes('live') ||
    lower.includes('playback') ||
    lower.includes('record') ||
    lower.includes('replay')
  )
    return 'live';
  if (lower.includes('voice') || lower.includes('audio')) return 'audio';
  if (lower.includes('video')) return 'vod';
  return 'link';
}

export function streamScore(url: string, preferLive = false): number {
  const lower = String(url || '').toLowerCase();
  if (preferLive && isRtmpUrl(lower)) return 130;
  if (lower.includes('.m3u8') || lower.includes('format=hls')) return preferLive ? 100 : 90;
  if (lower.includes('.flv')) return preferLive ? 110 : 70;
  if (isRtmpUrl(lower)) return 60;
  if (RE_VIDEO_EXT.test(lower)) return 80;
  if (RE_AUDIO_EXT.test(lower)) return 80;
  return 40;
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
  'content.playStreams.0.streamPath',
  'data.playStreams.0.streamPath',
];

const STREAM_LIST_KEYS = [
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

function collectUrlsDeep(value: any, result: string[] = [], depth = 0): void {
  if (!value || depth > 5) return;
  if (typeof value === 'string') {
    if (/^(?:https?|rtmps?):\/\//i.test(value) && isPlayableMediaUrl(value)) result.push(value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectUrlsDeep(item, result, depth + 1));
    return;
  }
  if (typeof value === 'object') {
    Object.values(value).forEach((item) => collectUrlsDeep(item, result, depth + 1));
  }
}

export function pickPlayableUrls(raw: any, preferLive = false): string[] {
  const candidates: string[] = [];
  const direct = normalizeUrl(pickText(raw, PLAY_URL_FIELDS));
  if (direct) candidates.push(direct);
  const nested = unwrapList(raw, STREAM_LIST_KEYS);
  nested.forEach((item) => {
    const url = normalizeUrl(pickText(item, PLAY_URL_FIELDS));
    if (url) candidates.push(url);
  });
  const deep: string[] = [];
  collectUrlsDeep(raw, deep);

  deep.forEach((url) => candidates.push(url));
  return Array.from(new Set(candidates.filter(Boolean)))
    .filter((url) => classifyUrl(url) !== 'image')
    .sort((a, b) => streamScore(b, preferLive) - streamScore(a, preferLive));
}

export function needsNativeExo(url: string): boolean {
  const lower = String(url || '').toLowerCase();
  return isRtmpUrl(lower) || lower.includes('.flv');
}

export function isLiveStreamUrl(url: string): boolean {
  const lower = String(url || '').toLowerCase();
  return isRtmpUrl(lower) || lower.includes('.flv') || lower.includes('.m3u8');
}

export function isPlayableMediaUrl(url: string): boolean {
  const lower = String(url || '').toLowerCase();
  return (
    isRtmpUrl(lower) ||
    RE_LIVE_EXT.test(lower) ||
    lower.includes('.m3u8') ||
    lower.includes('.flv') ||
    RE_VIDEO_EXT.test(lower) ||
    RE_AUDIO_EXT.test(lower) ||
    RE_MEDIA_QUERY_HINT.test(lower) ||
    lower.includes('playstream') ||
    lower.includes('streampath')
  );
}

export function buildPocketHeaders(cookie?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent': USER_AGENT,
    Referer: 'https://h5.48.cn/',
    Origin: 'https://h5.48.cn',
  };
  if (cookie) headers.Cookie = cookie;
  return headers;
}

export function resolveSource(
  raw: any,
  opts: {
    preferLive?: boolean;
    kindHint?: StreamKind;
    title?: string;
    liveId?: string;
    replayHint?: boolean;
    headers?: Record<string, string>;
  } = {},
): PlayerSource | null {
  const urls = pickPlayableUrls(raw, opts.preferLive);
  if (!urls.length) return null;
  const url = urls[0];
  let kind = opts.kindHint || classifyUrl(url);

  if (opts.replayHint && kind === 'live' && !isRtmpUrl(url)) {
    kind = 'vod';
  }
  return {
    kind,
    url,
    urls,
    liveId: opts.liveId,
    needsNativeExo: needsNativeExo(url),
    headers: opts.headers || (kind === 'live' || kind === 'vod' ? buildPocketHeaders() : undefined),
  };
}

export default {
  classifyUrl,
  streamScore,
  pickPlayableUrls,
  needsNativeExo,
  isLiveStreamUrl,
  isPlayableMediaUrl,
  isRtmpUrl,
  buildPocketHeaders,
  resolveSource,
};
