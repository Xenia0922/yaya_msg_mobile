const IMAGE_EXT_RE = /\.(jpe?g|png|webp|gif|bmp|heic|avif)$/i;
const LEGACY_IMAGE_HOST_RE = /^https?:\/\/source[23]\.48\.cn(?=\/)/i;

export const MEDIA_URL_KEYS = [
  'imgUrl',
  'imageUrl',
  'pictureUrl',
  'picUrl',
  'photoUrl',
  'cover',
  'coverUrl',
  'url',
  'path',
  'mediaUrl',
  'imgPath',
  'picPath',
  'imagePath',
  'audioUrl',
  'voiceUrl',
  'videoUrl',
  'mp4Url',
  'playUrl',
  'message.url',
  'msg.url',
];

export const MEDIA_INFO_KEYS = [
  'imageInfo',
  'imgInfo',
  'pictureInfo',
  'voiceInfo',
  'audioInfo',
  'videoInfo',
  'replyInfo',
];

const NON_MEDIA_KEYS = new Set([
  'user',
  'userinfo',
  'userInfo',
  'sender',
  'senderInfo',
  'fromUser',
  'toUser',
  'targetUser',
  'targetUserInfo',
  'starInfo',
  'star',
  'member',
  'memberInfo',
  'profile',
  'avatar',
  'headImage',
  'headImg',
  'headerImg',
  'badge',
  'badgeInfo',
  'medal',
  'medalInfo',
  'levelInfo',
  'giftInfo',
  'gift',
  'rank',
  'roomInfo',
]);

function pathnameOf(value: string): string {
  return value.split('?')[0].split('#')[0].toLowerCase();
}

export function isImageLikeUrl(value: unknown): boolean {
  return IMAGE_EXT_RE.test(pathnameOf(String(value ?? '').trim()));
}

export function normalizePrivateMediaUrl(
  raw: unknown,
  preferredHost: 'source' | 'mp4' = 'mp4',
): string {
  const value = String(raw ?? '').trim();
  if (!value) return '';
  if (value.startsWith('//')) return `https:${value}`;
  if (/^https?:\/\//i.test(value)) {
    const https = value.replace(/^http:\/\//i, 'https://');
    return LEGACY_IMAGE_HOST_RE.test(https)
      ? https.replace(LEGACY_IMAGE_HOST_RE, 'https://source1.48.cn')
      : https;
  }
  if (value.startsWith('/mediasource/') || value.startsWith('/imagesource/'))
    return `https://source.48.cn${value}`;
  const base = preferredHost === 'source' ? 'https://source.48.cn' : 'https://mp4.48.cn';
  return `${base}${value.startsWith('/') ? '' : '/'}${value}`;
}

export function deepFindImageUrl(source: unknown, depth = 3): string {
  if (source == null || depth < 0) return '';
  if (typeof source === 'string') {
    const text = source.trim();
    if (IMAGE_EXT_RE.test(pathnameOf(text))) return text;
    try {
      const parsed = JSON.parse(text);
      return parsed && typeof parsed === 'object' ? deepFindImageUrl(parsed, depth - 1) : '';
    } catch {
      return '';
    }
  }
  if (typeof source !== 'object') return '';
  const record = source as Record<string, unknown>;
  for (const key of MEDIA_URL_KEYS) {
    const value = record[key.includes('.') ? (key.split('.').pop() as string) : key];
    if (typeof value === 'string' && isImageLikeUrl(value)) return value;
  }
  for (const [key, value] of Object.entries(record)) {
    if (!value || NON_MEDIA_KEYS.has(key)) continue;
    const found = deepFindImageUrl(value, depth - 1);
    if (found) return found;
  }
  return '';
}

export const AVATAR_KEYS = [
  'user.avatar',
  'user.headImg',
  'user.headImage',
  'user.avatarUrl',
  'user.picUrl',
  'avatar',
  'headImg',
  'headImage',
  'avatarUrl',
  'picUrl',
];

function readPath(source: any, path: string): string {
  let value: any = source;
  for (const segment of path.split('.')) {
    if (!value || typeof value !== 'object') return '';
    value = value[segment];
  }
  return typeof value === 'string' ? value.trim() : '';
}

export function resolvePrivateAvatar(...sources: any[]): string {
  for (const source of sources) {
    if (!source || typeof source !== 'object') continue;
    for (const key of AVATAR_KEYS) {
      const value = readPath(source, key);
      if (value) return normalizePrivateMediaUrl(value, 'source');
    }
  }
  return '';
}
