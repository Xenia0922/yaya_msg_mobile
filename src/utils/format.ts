import { RoomMessage } from '../types';

export function formatTimestamp(ts: number | string | null | undefined): string {
  if (ts === null || ts === undefined || ts === '') return '';
  let value: number | string = ts;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return '';
    value = /^\d+$/.test(trimmed) ? Number(trimmed) : trimmed.replace(/-/g, '/');
  }
  if (typeof value === 'number' && Number.isFinite(value) && value > 0 && value < 10000000000) {
    value *= 1000;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  const s = String(date.getSeconds()).padStart(2, '0');
  return `${y}-${m}-${d} ${h}:${mi}:${s}`;
}

export function formatDate(ts: number | string | null | undefined): string {
  const full = formatTimestamp(ts);
  return full ? full.slice(0, 10) : '';
}

export function formatDuration(seconds: number): string {
  const total = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function formatCount(n: number): string {
  if (!Number.isFinite(n)) return '0';
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function parseMsgBody(body: any): { text: string; url?: string; time?: number } {
  if (!body) return { text: '' };
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return { text: body };
    }
  }
  if (body.message) return parseMsgBody(body.message);
  if (body.msg) return parseMsgBody(body.msg);
  if (body.text) return { text: body.text };
  if (body.msgContent) return parseMsgBody(body.msgContent);
  if (body.url && !body.text) return { text: '', url: body.url, time: body.time };
  if (body.url && body.text) return { text: body.text, url: body.url, time: body.time };
  return { text: typeof body === 'object' ? JSON.stringify(body) : String(body) };
}

export function getMessageBodyText(msg: RoomMessage): string {
  return parseMsgBody(msg.bodys || msg.msgContent).text || '';
}

export function getMessageType(msg: RoomMessage): string {
  return msg.msgType || 'TEXT';
}

export function isMessageType(msg: RoomMessage, type: string): boolean {
  const msgType = (msg.msgType || '').toUpperCase();
  if (type === 'text') return !['AUDIO', 'IMAGE', 'VIDEO', 'REPLY', 'GIFTREPLY', 'LIVEPUSH', 'SHARE_LIVE', 'GIFT_TEXT', 'FLIPCARD', 'LIVE_RECORD'].includes(msgType);
  if (type === 'reply') return msgType === 'REPLY' || msgType === 'GIFTREPLY';
  if (type === 'live-record') return msgType === 'LIVEPUSH' || msgType === 'SHARE_LIVE' || msgType === 'LIVE_RECORD';
  return msgType === type.toUpperCase();
}

export function extractNumber(str: string): number | null {
  const match = str?.match(/\d+/);
  return match ? parseInt(match[0], 10) : null;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
