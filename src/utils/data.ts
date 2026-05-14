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
  if (raw.startsWith('/')) return `https://source.48.cn${raw}`;
  return raw;
}

export function parseMaybeJson(value: any): any {
  if (!value) return null;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return null;
  try { return JSON.parse(value); } catch {
    const fixed = value.replace(/:\s*([0-9]{15,})/g, ':"$1"');
    try { return JSON.parse(fixed); } catch { return null; }
  }
}

const EMOJI_MAP: Record<string, string> = {
  '[色]': '😍', '[爱心]': '❤️', '[亲亲]': '😚', '[生病]': '😷', '[大哭]': '😭', '[微笑]': '🙂', '[酷]': '😎', '[坏笑]': '😏',
  '[惊恐]': '😱', '[愉快]': '😊', '[憨笑]': '😄', '[悠闲]': '😌', '[奋斗]': '💪', '[大笑]': '😆', '[疑问]': '❓', '[嘘]': '🤫',
  '[晕]': '😵', '[衰]': '😞', '[骷髅]': '💀', '[敲打]': '🔨', '[再见]': '👋', '[擦汗]': '😓', '[抠鼻]': '👃', '[鼓掌]': '👏',
  '[糗大了]': '😳', '[左哼哼]': '😤', '[右哼哼]': '😤', '[哈欠]': '🥱', '[鄙视]': '👎', '[委屈]': '🥺', '[快哭了]': '😿', '[阴险]': '😈',
  '[吓]': '😨', '[可怜]': '🥺', '[菜刀]': '🔪', '[西瓜]': '🍉', '[啤酒]': '🍺', '[篮球]': '🏀', '[乒乓]': '🏓', '[咖啡]': '☕',
  '[饭]': '🍚', '[猪头]': '🐷', '[玫瑰]': '🌹', '[凋谢]': '🥀', '[嘴唇]': '💋', '[心碎]': '💔', '[蛋糕]': '🎂', '[闪电]': '⚡',
  '[炸弹]': '💣', '[刀]': '🔪', '[足球]': '⚽', '[瓢虫]': '🐞', '[便便]': '💩', '[月亮]': '🌙', '[太阳]': '☀️', '[礼物]': '🎁',
  '[拥抱]': '🤗', '[强]': '👍', '[弱]': '👎', '[握手]': '🤝', '[胜利]': '✌️', '[抱拳]': '🙏', '[勾引]': '☝️', '[拳头]': '✊',
  '[差劲]': '👎', '[爱你]': '🤟', '[NO]': '🙅', '[OK]': '👌', '[跳跳]': '💃', '[发抖]': '🥶', '[怄火]': '😡', '[转圈]': '💫',
  '[磕头]': '🙇', '[回头]': '🔙', '[跳绳]': '🏃', '[挥手]': '🙋', '[激动]': '🤩', '[街舞]': '🕺', '[献吻]': '😽', '[左太极]': '☯️', '[右太极]': '☯️',
};

export function replaceEmojiText(text: string): string {
  if (!text) return text;
  return text.replace(/\[([^\]]+)\]/g, (match: string) => EMOJI_MAP[match] || match);
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
  if (typeof body === 'string') return replaceEmojiText(body);
  const type = String(item?.msgType || body?.msgType || body?.messageType || body?.type || '').toUpperCase();

  if (type === 'EXPRESSIMAGE' || type === 'EXPRESS') {
    return '';
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
    const giftName = pickText(source, ['giftName', 'name', 'giftInfo.giftName'], '礼物');
    const giftNum = pickText(source, ['giftNum', 'num', 'count', 'giftInfo.giftNum'], '1');
    const gr = body?.giftReplyInfo || {};
    const replyText = gr.replyName || body?.replyName || body?.text || body?.body || '';
    const prefix = replyText && typeof replyText === 'string' && replyText.trim() ? `${replyText.trim()} · ` : '';
    return `${prefix}送出礼物：${giftName} x${giftNum}`;
  }
  const text = pickText(body, [
    'text',
    'message.text',
    'msg.text',
    'content.text',
    'body.text',
    'title',
  ]);
  if (text) return replaceEmojiText(text);
  const url = pickText(body, ['url', 'message.url', 'msg.url', 'audioUrl', 'videoUrl', 'imageUrl']);
  if (url) {
    if (type.includes('AUDIO') || /\.(mp3|m4a|aac|amr|wav)(\?|$)/i.test(url)) return '[语音消息]';
    if (type.includes('VIDEO') || /\.(mp4|mov|m4v|3gp)(\?|$)/i.test(url)) return '[视频消息]';
    if (type.includes('IMAGE') || /\.(jpe?g|png|webp|gif)(\?|$)/i.test(url)) return '[图片消息]';
    return '[链接消息]';
  }
  return item?.msgType && !/^LIVE|SHARE/i.test(String(item.msgType)) ? `[${item.msgType}]` : '';
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
  if (!error) return '未知错误';
  if (typeof error === 'string') return error;
  return error?.message || error?.msg || JSON.stringify(error).slice(0, 240);
}
