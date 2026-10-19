import { translate } from '../i18n';

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
  if (raw.startsWith('//')) return `https:${raw}`;
  // ⚠️ 相对路径按「宿主」拼，不能一律拼 source.48.cn：
  // 48 图床（avatar/mediasource/backstage…）→ source.48.cn；
  // 用户徽章/头像框等资源实际在 source1.48.cn（拼错域名 → 勋章框加载 404/不渲染，2026-10-19 用户反馈）。
  if (raw.startsWith('/')) return `https://${/^(avatar|mediasource|backstage)\b/i.test(raw.slice(1)) ? 'source.48.cn' : 'source1.48.cn'}${raw}`;
  return raw;
}

export function parseMaybeJson(value: any): any {
  if (!value) return null;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return null;
  // ⚠️ 必须先替换长数字再 parse：JSON.parse 对 15+ 位数字**不会失败**，只会静默丢精度，
  // 「先 parse 失败再修」的写法永远走不到修复分支（2026-10-19 审计 D3）。
  const fixed = value.replace(/:\s*([0-9]{15,})/g, ':"$1"');
  try { return JSON.parse(fixed); } catch {
    // 替换后仍失败 → 按原始文本再试一次（可能是转义/编码问题，非长数字导致）
    try { return JSON.parse(value); } catch { return null; }
  }
}

// 表情映射：官方 PopoEmoticons 107 tag → 本地表情图（require 资源，与官方客户端同款表情）。
// 文本里的 [xx] 标签渲染为表情图片而非 unicode 近似字符（[发呆] 等此前直接漏渲染，2026-10-19 用户反馈）。
// 映射表见 ./emojiMap（生成自官方 emoji.xml Tag↔File）。
import EMOJI_MAP from './emojiMap';

export type EmojiPart = string | { emoji: string; source: any };

/** 把文本按 [表情] 标签切成 文本/表情图 片段（供消息气泡内联渲染） */
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
    // 图片映射在纯文本场景（消息列表预览/搜索）保留原始 [xx] 标签（避免出现 [object Object]）
    return typeof src === 'string' ? src : match;
  });
}

export function messagePayload(item: any): any {
  const raw = item?.bodys ?? item?.body ?? item?.msgContent ?? item?.content ?? item?.message;
  const body = parseMaybeJson(raw);
  if (body?.message) return parseMaybeJson(body.message);
  if (body?.msg) return parseMaybeJson(body.msg);
  if (body) return body;
  if (typeof raw === 'string') return raw;
  return null;
}

export function messageText(item: any): string {
  const body = messagePayload(item);
  const type = String(item?.msgType || body?.msgType || body?.messageType || body?.type || '').toUpperCase();

  // Media types: don't return raw body (file names, URLs) — let media card handle it
  if (type === 'AUDIO' || type === 'VIDEO' || type === 'IMAGE' || type === 'LIVEPUSH' || type === 'SHARE_LIVE' || type === 'EXPRESSIMAGE' || type === 'EXPRESS') {
    // Only return text if there's a meaningful caption alongside the media
    if (body && typeof body === 'object') {
      const caption = (body as any).text || (body as any).caption || (body as any).description || '';
      if (typeof caption === 'string' && caption.trim() && !/^(https?:\/\/|voice_|video_|img_|live_)/i.test(caption)) {
        return replaceEmojiText(caption);
      }
    }
    return '';
  }

  if (typeof body === 'string') return replaceEmojiText(body);

  // last/message/get 返回的 lastMsgList[] 只有 msgContent（无 bodys/msgType）——
  // 房间列表大/小房间预览走的就是这条，缺这段兜底会导致「有最新消息但预览空白」
  const lastPreview = item?.msgContent ?? item?.content ?? item?.message;
  if (typeof lastPreview === 'string' && lastPreview.trim() && !lastPreview.startsWith('{') && !lastPreview.startsWith('[')) {
    return replaceEmojiText(lastPreview);
  }

  if (type === 'TEXT') {
    if (body && typeof body === 'object') {
      const b = body as Record<string, any>;
      const t = b.text || b.bodys || b.body || b.msgContent || b.content;
      if (t) return replaceEmojiText(String(t));
    }
    // Fallback: try raw fields on item directly
    const raw = item?.bodys ?? item?.body ?? item?.msgContent ?? item?.content ?? item?.message ?? '';
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

  const giftInfo = body?.giftInfo || body?.giftReplyInfo?.giftInfo || body?.bodys?.giftInfo;
  const isGift = type.includes('GIFT') || (giftInfo && !type.includes('LIVE')) || String(item?.msgType) === '7';

  const replyInfo = body?.replyInfo || body?.giftReplyInfo || (body?.bodys as any)?.replyInfo || (body?.bodys as any)?.giftReplyInfo;
  const isReply = type.includes('REPLY') || !!replyInfo;
  if (isReply) {
    const rName = replyInfo?.replyName || '';
    const replyText = replyInfo?.text || pickText(body, ['text', 'body.text', 'content', 'replyContent']);
    if (rName && replyText) return `回复 ${rName}：${replyText}`;
    if (replyText) return replyText;
    if (rName) return `回复 ${rName}`;
  }

  if (isGift) {
    const source = giftInfo || body || {};
    const giftName = pickText(source, ['giftName', 'name', 'giftInfo.giftName'], translate('礼物'));
    const giftNum = pickText(source, ['giftNum', 'num', 'count', 'giftInfo.giftNum'], '1');
    const gr = body?.giftReplyInfo || {};
    const replyText = gr.replyName || body?.replyName || body?.text || body?.body || '';
    const prefix = replyText && typeof replyText === 'string' && replyText.trim() ? `${replyText.trim()} · ` : '';
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
    // search deeper for text in nested objects
    for (const [_key, val] of Object.entries(body as Record<string, any>)) {
      if (typeof val === 'string' && val.trim() && !val.startsWith('http') && !val.startsWith('{') && val.length < 500) {
        return replaceEmojiText(val);
      }
      if (val && typeof val === 'object') {
        const t = pickText(val, ['text', 'body', 'content', 'message', 'title', 'description']);
        if (t) return replaceEmojiText(String(t));
        // try first string value of nested object
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
    if (type.includes('AUDIO') || /\.(mp3|m4a|aac|amr|wav)(\?|$)/i.test(url)) return translate('[语音消息]');
    if (type.includes('VIDEO') || /\.(mp4|mov|m4v|3gp)(\?|$)/i.test(url)) return translate('[视频消息]');
    if (type.includes('IMAGE') || /\.(jpe?g|png|webp|gif)(\?|$)/i.test(url)) return translate('[图片消息]');
    return translate('[链接消息]');
  }
  return item?.msgType && !/^(LIVE|SHARE|TEXT)$/i.test(String(item.msgType)) ? `[${item.msgType}]` : '';
}

export function messageImageUrl(item: any): string {
  const body = messagePayload(item);
  return normalizeUrl(pickText(body, [
    'url',
    'message.url',
    'msg.url',
    'imageUrl',
    'cover',
  ]));
}

export function errorMessage(error: any): string {
  if (!error) return translate('未知错误');
  if (typeof error === 'string') return error;
  // 统一出口：把工具/网络层抛出的中文错误过一次字典（有 key 则翻译，
  // 无 key 或动态内容原样回退；en/ja/ko 用户不再看到中文报错）
  const raw = error?.message || error?.msg || JSON.stringify(error).slice(0, 240);
  return translate(String(raw));
}
