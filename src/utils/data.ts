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
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export function messagePayload(item: any): any {
  const raw = item?.bodys ?? item?.body ?? item?.msgContent ?? item?.content ?? item?.message;
  const body = parseMaybeJson(raw);
  if (body?.message) return parseMaybeJson(body.message);
  if (body?.msg) return parseMaybeJson(body.msg);
  return body;
}

export function messageText(item: any): string {
  const body = messagePayload(item);
  if (typeof body === 'string') return body;
  const type = String(item?.msgType || body?.msgType || body?.messageType || body?.type || '').toUpperCase();
  const giftInfo = body?.giftInfo || body?.giftReplyInfo?.giftInfo || body?.bodys?.giftInfo;
  if (type.includes('GIFT') || giftInfo) {
    const source = giftInfo || body;
    const giftName = pickText(source, ['giftName', 'name', 'giftInfo.giftName'], '礼物');
    const giftNum = pickText(source, ['giftNum', 'num', 'count', 'giftInfo.giftNum'], '1');
    return `送出礼物：${giftName} x${giftNum}`;
  }
  const text = pickText(body, [
    'text',
    'message.text',
    'msg.text',
    'content.text',
    'body.text',
    'title',
  ]);
  if (text) return text;
  const url = pickText(body, ['url', 'message.url', 'msg.url', 'audioUrl', 'videoUrl', 'imageUrl']);
  if (url) {
    if (type.includes('AUDIO') || /\.(mp3|m4a|aac|amr|wav)(\?|$)/i.test(url)) return '[语音消息]';
    if (type.includes('VIDEO') || /\.(mp4|mov|m4v|3gp)(\?|$)/i.test(url)) return '[视频消息]';
    if (type.includes('IMAGE') || /\.(jpe?g|png|webp|gif)(\?|$)/i.test(url)) return '[图片消息]';
    return '[链接消息]';
  }
  return item?.msgType ? `[${item.msgType}]` : '';
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
