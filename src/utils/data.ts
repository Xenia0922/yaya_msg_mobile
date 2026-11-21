import { translate } from '../i18n';
import { sanitizeText } from './html';
import { normalizeImageHost } from './imageThumb';

export function getPath(obj: any, path: string): any {
  return path.split('.').reduce((acc, key) => acc?.[key], obj);
}

export function firstArray(...values: any[]): any[] {
  for (const value of values) {
    if (Array.isArray(value)) return value;
  }
  return [];
}

export function unwrapList(res: any, keys: string[] = []): any[] {
  const candidates = keys.map((key) => getPath(res, key));
  const direct = firstArray(
    ...candidates,
    res,
    res?.list,
    res?.data,
    res?.content,
    res?.content?.list,
    res?.content?.data,
    res?.content?.messageList,
    res?.content?.userMessageList,
    res?.content?.questions,
    res?.content?.nftList,
    res?.content?.liveList,
    res?.content?.roomList,
    res?.content?.records,
  );
  if (direct.length) return direct;

  const seen = new Set<any>();
  const queue = [res?.content, res?.data, res];
  while (queue.length) {
    const node = queue.shift();
    if (!node || typeof node !== 'object' || seen.has(node)) continue;
    seen.add(node);
    if (Array.isArray(node)) return node;
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) return value;
      if (value && typeof value === 'object') queue.push(value);
    }
  }
  return [];
}

export function pickText(obj: any, paths: string[], fallback = ''): string {
  for (const path of paths) {
    const value = getPath(obj, path);
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return String(value);
    }
  }
  return fallback;
}

export function normalizeUrl(value: any): string {
  if (!value) return '';
  const raw = String(value).trim();
  if (!raw) return '';
  if (raw.startsWith('//')) return normalizeImageHost(`https:${raw}`);
  if (/^https?:\/\//i.test(raw)) return normalizeImageHost(raw);

  if (raw.startsWith('/'))
    return `https://${/^(avatar|mediasource|backstage)\b/i.test(raw.slice(1)) ? 'source.48.cn' : 'source1.48.cn'}${raw}`;
  return raw;
}

export function parseMaybeJson(value: any): any {
  if (!value) return null;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return null;

  const fixed = value.replace(/:\s*([0-9]{15,})/g, ':"$1"');
  try {
    return JSON.parse(fixed);
  } catch {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
}

import EMOJI_MAP from './emojiMap';

export type EmojiPart = string | { emoji: string; source: any };

export function splitEmojiParts(text: string): EmojiPart[] {
  if (!text) return [];
  const parts: EmojiPart[] = [];
  const re = /\[([^\]]+)\]/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const src = EMOJI_MAP[m[0]];
    if (m.index > last) parts.push(text.slice(last, m.index));
    if (src) parts.push({ emoji: m[0], source: src });
    else parts.push(m[0]);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

export function replaceEmojiText(text: string): string {
  if (!text) return text;
  return text.replace(/\[([^\]]+)\]/g, (match: string) => {
    const src = EMOJI_MAP[match];

    return typeof src === 'string' ? src : match;
  });
}

export function messagePayload(item: any): any {
  const raw = item?.bodys ?? item?.body ?? item?.msgContent ?? item?.content ?? item?.message;
  const body = parseMaybeJson(raw);
  if (body?.message) return parseMaybeJson(body.message);
  if (body?.msg) return parseMaybeJson(body.msg);
  if (body && typeof body === 'object') {
    const inlineText = typeof body.text === 'string' ? body.text.trim() : '';
    if (inlineText.startsWith('{')) {
      const inner = parseMaybeJson(inlineText);
      if (
        inner &&
        typeof inner === 'object' &&
        (inner.replyInfo ||
          inner.giftReplyInfo ||
          inner.reply ||
          inner.replay ||
          inner.replyGiftInfo ||
          inner.voiceInfo ||
          inner.audioInfo ||
          inner.messageType)
      ) {
        return { ...body, ...inner };
      }
    }
    if (typeof body.attachment === 'string' && body.attachment.trim().startsWith('{')) {
      const parsedAttach = parseMaybeJson(body.attachment);
      if (parsedAttach && typeof parsedAttach === 'object') {
        return { ...body, ...parsedAttach };
      }
    }
    return body;
  }
  if (typeof raw === 'string') return raw;
  return null;
}

export function humanizeRawMessageText(raw: string): string {
  const text = String(raw || '').trim();
  if (!text.startsWith('{')) return text;
  try {
    const body = JSON.parse(text);
    const info = body?.replyInfo || body?.giftReplyInfo;
    if (!info) return text;
    const own = String(info.text || '').trim();
    const quoted = String(info.replyText || '').trim();
    const name = String(info.replyName || '').trim();
    return sanitizeText(own || (name ? `回复 ${name}：${quoted}` : quoted) || text);
  } catch {
    return text;
  }
}

function messageTextRaw(item: any): string {
  const body = messagePayload(item);
  const type = String(
    item?.msgType || body?.msgType || body?.messageType || body?.type || '',
  ).toUpperCase();

  if (
    type === 'AUDIO' ||
    type === 'AUDIO_REPLY' ||
    type === 'AUDIO_GIFT_REPLY' ||
    type === 'FLIPCARD_AUDIO' ||
    type === 'VIDEO' ||
    type === 'IMAGE' ||
    type === 'LIVEPUSH' ||
    type === 'SHARE_LIVE' ||
    type === 'EXPRESSIMAGE' ||
    type === 'EXPRESS'
  ) {
    if (body && typeof body === 'object') {
      const caption =
        (body as any).text || (body as any).caption || (body as any).description || '';
      if (
        typeof caption === 'string' &&
        caption.trim() &&
        !/^(https?:\/\/|voice_|video_|img_|live_)/i.test(caption)
      ) {
        return replaceEmojiText(caption);
      }
    }
    return '';
  }

  if (typeof body === 'string') return replaceEmojiText(body);

  const lastPreview = item?.msgContent ?? item?.content ?? item?.message;
  if (
    typeof lastPreview === 'string' &&
    lastPreview.trim() &&
    !lastPreview.startsWith('{') &&
    !lastPreview.startsWith('[')
  ) {
    return replaceEmojiText(lastPreview);
  }

  if (type === 'TEXT') {
    if (body && typeof body === 'object') {
      const b = body as Record<string, any>;
      const t = b.text || b.bodys || b.body || b.msgContent || b.content;
      if (t) return replaceEmojiText(String(t));
    }

    const raw =
      item?.bodys ?? item?.body ?? item?.msgContent ?? item?.content ?? item?.message ?? '';
    if (typeof raw === 'string' && raw.trim() && !raw.startsWith('{') && !raw.startsWith('[')) {
      return replaceEmojiText(raw);
    }
    if (typeof raw === 'number') return replaceEmojiText(String(raw));
    if (typeof raw === 'object') {
      const r = raw as Record<string, any>;
      const t2 = r.text || r.bodys || r.body || r.msgContent || r.content;
      if (t2) return replaceEmojiText(String(t2));
    }
  }

  const giftReplyInfo = (body?.giftReplyInfo ||
    (body?.bodys as any)?.giftReplyInfo ||
    {}) as Record<string, any>;
  const giftInfo =
    body?.giftInfo ||
    giftReplyInfo?.giftInfo ||
    giftReplyInfo?.replyGiftInfo ||
    body?.bodys?.giftInfo;

  const hasGiftPayload = Boolean(giftInfo || body?.giftName || body?.giftId || body?.giftNum);
  const isGift = type.includes('GIFT') || (hasGiftPayload && !type.includes('LIVE'));
  const isGiftReplyType = type.includes('GIFT') && (type.includes('REPLY') || !!giftReplyInfo);

  const replyInfo =
    body?.replyInfo ||
    body?.giftReplyInfo ||
    (body?.bodys as any)?.replyInfo ||
    (body?.bodys as any)?.giftReplyInfo;
  const isReply = type.includes('REPLY') || !!replyInfo;
  if (isReply && !isGiftReplyType) {
    const rName = replyInfo?.replyName || '';
    const replyText =
      replyInfo?.text || pickText(body, ['text', 'body.text', 'content', 'replyContent']);
    if (rName && replyText) return `回复 ${rName}：${replyText}`;
    if (replyText) return replyText;
    if (rName) return `回复 ${rName}`;
  }

  if (isGift) {
    const source = giftInfo || body || {};
    const giftName = pickText(
      source,
      ['giftName', 'name', 'giftInfo.giftName', 'replyGiftInfo.giftName'],
      translate('礼物'),
    );
    const giftNum = pickText(
      source,
      ['giftNum', 'num', 'count', 'giftInfo.giftNum', 'replyGiftInfo.giftNum'],
      '1',
    );
    const replyText =
      giftReplyInfo.text ||
      body?.text ||
      (typeof body?.body === 'string' && !body.body.startsWith('{') ? body.body : '');

    if (isGiftReplyType) {
      return typeof replyText === 'string' ? replyText.trim() : '';
    }
    const prefix =
      replyText && typeof replyText === 'string' && replyText.trim()
        ? `${replyText.trim()} · `
        : '';
    return `${prefix}${translate('送出礼物')}：${giftName} x${giftNum}`;
  }
  const text = pickText(body, [
    'text',
    'message.text',
    'msg.text',
    'content.text',
    'body.text',
    'bodys.text',
    'title',
  ]);
  if (!text && body && typeof body === 'object') {
    for (const [_key, val] of Object.entries(body as Record<string, any>)) {
      if (
        typeof val === 'string' &&
        val.trim() &&
        !val.startsWith('http') &&
        !val.startsWith('{') &&
        val.length < 500
      ) {
        return replaceEmojiText(val);
      }
      if (val && typeof val === 'object') {
        const t = pickText(val, ['text', 'body', 'content', 'message', 'title', 'description']);
        if (t) return replaceEmojiText(String(t));

        for (const [_k2, v2] of Object.entries(val)) {
          if (typeof v2 === 'string' && v2.trim() && !v2.startsWith('http') && v2.length < 500) {
            return replaceEmojiText(v2);
          }
        }
      }
      if (typeof val === 'number') {
        return replaceEmojiText(String(val));
      }
    }
  }
  if (text) return replaceEmojiText(String(text));
  const url = pickText(body, ['url', 'message.url', 'msg.url', 'audioUrl', 'videoUrl', 'imageUrl']);
  if (url) {
    if (type.includes('AUDIO') || /\.(mp3|m4a|aac|amr|wav)(\?|$)/i.test(url))
      return translate('[语音消息]');
    if (type.includes('VIDEO') || /\.(mp4|mov|m4v|3gp)(\?|$)/i.test(url))
      return translate('[视频消息]');
    if (type.includes('IMAGE') || /\.(jpe?g|png|webp|gif)(\?|$)/i.test(url))
      return translate('[图片消息]');
    return translate('[链接消息]');
  }
  return item?.msgType && !/^(LIVE|SHARE|TEXT)$/i.test(String(item.msgType))
    ? `[${item.msgType}]`
    : '';
}

export function messageText(item: any): string {
  return sanitizeText(messageTextRaw(item));
}

export function messageImageUrl(item: any): string {
  const body = messagePayload(item);
  return normalizeUrl(pickText(body, ['url', 'message.url', 'msg.url', 'imageUrl', 'cover']));
}

export function errorMessage(error: any): string {
  if (!error) return translate('未知错误');
  if (typeof error === 'string') return error;

  const raw = error?.message || error?.msg || JSON.stringify(error).slice(0, 240);
  return translate(String(raw));
}
