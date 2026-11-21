const THUMB_HOST = 'https://source1.48.cn';

const LEGACY_IMAGE_HOST_RE = /^https?:\/\/source[23]\.48\.cn(?=\/)/i;

export function normalizeImageHost(url: any): string {
  const raw = String(url ?? '').trim();
  if (!LEGACY_IMAGE_HOST_RE.test(raw)) return raw;
  return raw.replace(LEGACY_IMAGE_HOST_RE, THUMB_HOST);
}

const MEDIA_EXT_RE = /\.(mp4|mov|m4v|m4a|aac|mp3|amr|flv|ts)(\?|$)/i;

const GIF_RE = /\.gif(\?|$)/i;

export function thumbUrlBox(url: any, width: number, height: number): string {
  const raw = String(url ?? '').trim();
  if (!raw) return '';
  if (MEDIA_EXT_RE.test(raw)) return raw;
  if (GIF_RE.test(raw)) return raw;

  if (/^https?:\/\/source1\.48\.cn\/resize_/i.test(raw)) return raw;

  if (/former\.48\.cn/i.test(raw)) return raw;

  const m = /^https?:\/\/[^/]*\.48\.cn(\/[^?#]*)/i.exec(raw);
  if (!m) return raw;
  const path = m[1];
  const w = Math.max(1, Math.round(Number(width) || 0));
  const h = Math.max(1, Math.round(Number(height) || 0));
  return `${THUMB_HOST}/resize_${w}x${h}${path}`;
}

export function thumbUrl(url: any, width = 500): string {
  const w = Math.max(1, Math.round(Number(width) || 0));
  return thumbUrlBox(url, w, w);
}

export const AVATAR_THUMB_WIDTH = 180;
