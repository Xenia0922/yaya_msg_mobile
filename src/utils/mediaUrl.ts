/**
 * 私信媒体 URL 解析（按官方客户端实现 private-message-formatters-feature.js）。
 *
 * 旧版实现的做法：
 *  - 图片字段优先 imgUrl（口袋私信图片就是这个词），再 imageUrl / pictureUrl / picUrl / photoUrl / cover / url / path
 *  - 地址归一化：相对路径 → source.48.cn（图片）/ mp4.48.cn（音视频），/mediasource、/imagesource → source.48.cn
 *  - 类型判断：扩展名优先，其次看 messageType 里的 IMAGE / AUDIO / VIDEO
 */

const IMAGE_EXT_RE = /\.(jpe?g|png|webp|gif|bmp|heic|avif)$/i;

/** 媒体 URL 可能出现的字段名（顺序与旧版实现一致，imgUrl 在前）。 */
export const MEDIA_URL_KEYS = [
  'imgUrl', 'imageUrl', 'pictureUrl', 'picUrl', 'photoUrl', 'cover', 'coverUrl', 'url', 'path',
  'mediaUrl', 'imgPath', 'picPath', 'imagePath',
  'audioUrl', 'voiceUrl', 'videoUrl', 'mp4Url', 'playUrl',
  'message.url', 'msg.url',
];

/** 图片消息里可能包着图片信息的外层字段（旧版实现会单独作为候选）。 */
export const MEDIA_INFO_KEYS = [
  'imageInfo', 'imgInfo', 'pictureInfo', 'voiceInfo', 'audioInfo', 'videoInfo', 'replyInfo',
];

/**
 * 兜底深扫时要跳过的字段：这些位置放的是头像、徽章、礼物图标等，
 * 不是本条消息的媒体。不跳过的话，纯文字私信会被渲染成对方的头像图片。
 */
const NON_MEDIA_KEYS = new Set([
  'user', 'userinfo', 'userInfo', 'sender', 'senderInfo', 'fromUser', 'toUser', 'targetUser', 'targetUserInfo',
  'starInfo', 'star', 'member', 'memberInfo', 'profile', 'avatar', 'headImage', 'headImg', 'headerImg',
  'badge', 'badgeInfo', 'medal', 'medalInfo', 'levelInfo', 'giftInfo', 'gift', 'rank', 'roomInfo',
]);

function pathnameOf(value: string): string {
  return value.split('?')[0].split('#')[0].toLowerCase();
}

export function isImageLikeUrl(value: unknown): boolean {
  return IMAGE_EXT_RE.test(pathnameOf(String(value ?? '').trim()));
}

/**
 * 相对路径补全。
 * @param preferredHost 'source' = 图片（source.48.cn），其它 = 音视频（mp4.48.cn）
 */
export function normalizePrivateMediaUrl(raw: unknown, preferredHost: 'source' | 'mp4' = 'mp4'): string {
  const value = String(raw ?? '').trim();
  if (!value) return '';
  if (value.startsWith('//')) return `https:${value}`;
  if (/^https?:\/\//i.test(value)) return value.replace(/^http:\/\//i, 'https://');
  if (value.startsWith('/mediasource/') || value.startsWith('/imagesource/')) return `https://source.48.cn${value}`;
  const base = preferredHost === 'source' ? 'https://source.48.cn' : 'https://mp4.48.cn';
  return `${base}${value.startsWith('/') ? '' : '/'}${value}`;
}

/** 递归找第一个像图片地址的字符串（深度有上限，防止大对象/嵌套 JSON 拖慢渲染）。 */
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

/**
 * 私信头像可能出现的字段（会话对象、消息发送者、成员库记录都适用）。
 * 旧版实现读的是 `item.user.avatar`，相对路径同样拼 source.48.cn。
 */
export const AVATAR_KEYS = [
  'user.avatar', 'user.headImg', 'user.headImage', 'user.avatarUrl', 'user.picUrl',
  'avatar', 'headImg', 'headImage', 'avatarUrl', 'picUrl',
];

function readPath(source: any, path: string): string {
  let value: any = source;
  for (const segment of path.split('.')) {
    if (!value || typeof value !== 'object') return '';
    value = value[segment];
  }
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * 按优先级取私信对方头像：消息发送者 → 会话对象 → 成员库记录。
 * 以前只查成员库，普通粉丝（非成员）私信永远没有头像，只剩一个首字母。
 */
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
