const THUMB_HOST = 'https://source1.48.cn';

const LEGACY_IMAGE_HOST_RE = /^https?:\/\/source[23]\.48\.cn(?=\/)/i;
const HTTPS_UPGRADE_HOST_RE =
  /^http:\/\/([^/]*(?:\.48\.cn|\.yunxinsvr\.com|\.netease\.im|\.netease\.com|\.127\.net|\.163yun\.com))(?=\/|$)/i;
const NOS_IMAGE_HOST_RE =
  /^https?:\/\/[^/]*(?:\.yunxinsvr\.com|\.netease\.im|\.netease\.com|\.127\.net|\.163yun\.com)(?=\/)/i;
const POCKET_IMAGE_HOST_RE = /^https?:\/\/[^/]*\.48\.cn(?=\/|$)/i;
const SIGNED_QUERY_RE = /(?:^|[?&])(?:Signature|wsSecret|WSABSTIME|Expires|token|sign)=/i;

export interface ImageCandidate {
  uri: string;
  headerMode: 'pocket' | 'ua' | 'none';
}

export function isPocket48ImageHost(url: string): boolean {
  return POCKET_IMAGE_HOST_RE.test(url);
}

export function isNosImageHost(url: string): boolean {
  return NOS_IMAGE_HOST_RE.test(url);
}

export function normalizeImageHost(url: any): string {
  const raw = String(url ?? '')
    .trim()
    .replace(/\\\//g, '/');
  if (!raw) return '';
  if (LEGACY_IMAGE_HOST_RE.test(raw)) {
    return raw.replace(LEGACY_IMAGE_HOST_RE, THUMB_HOST);
  }
  if (HTTPS_UPGRADE_HOST_RE.test(raw)) {
    return raw.replace(HTTPS_UPGRADE_HOST_RE, 'https://$1');
  }
  return raw;
}

const MEDIA_EXT_RE = /\.(mp4|mov|m4v|m4a|aac|mp3|amr|flv|ts|webm|3gp)(\?|$)/i;

const GIF_RE = /\.gif(\?|$)/i;

export function thumbUrlBox(url: any, width: number, height: number): string {
  const raw = normalizeImageHost(url);
  if (!raw) return '';
  if (MEDIA_EXT_RE.test(raw)) return raw;
  if (GIF_RE.test(raw)) return raw;

  const w = Math.max(1, Math.round(Number(width) || 0));
  const h = Math.max(1, Math.round(Number(height) || 0));

  if (isNosImageHost(raw) && !/imageView/i.test(raw) && !SIGNED_QUERY_RE.test(raw)) {
    return `${raw}${raw.includes('?') ? '&' : '?'}imageView&thumbnail=${w}x0`;
  }

  if (/^https?:\/\/source1\.48\.cn\/resize_/i.test(raw)) return raw;

  if (/former\.48\.cn/i.test(raw)) return raw;

  const m = /^https?:\/\/[^/]*\.48\.cn(\/[^?#]*)/i.exec(raw);
  if (!m) return raw;
  const path = m[1];
  return `${THUMB_HOST}/resize_${w}x${h}${path}`;
}

export function thumbUrl(url: any, width = 500): string {
  const w = Math.max(1, Math.round(Number(width) || 0));
  return thumbUrlBox(url, w, w);
}

export function buildImageFallbackCandidates(
  rawUrl: any,
  options?: { thumbnail?: number; highResWidth?: number },
): ImageCandidate[] {
  const clean = String(rawUrl ?? '')
    .trim()
    .replace(/\\\//g, '/');
  if (!clean) return [];
  const norm = normalizeImageHost(clean);
  if (!norm) return [];

  const is48 = isPocket48ImageHost(norm);
  const isNos = isNosImageHost(norm);
  const isHttp = /^https?:\/\//i.test(norm);
  const isResizable = !MEDIA_EXT_RE.test(norm) && !GIF_RE.test(norm);

  const out: ImageCandidate[] = [];
  const seen = new Set<string>();
  const push = (uri: string, headerMode: ImageCandidate['headerMode']) => {
    const trimmed = String(uri || '').trim();
    if (!trimmed) return;
    const key = `${trimmed}|${headerMode}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ uri: trimmed, headerMode });
  };

  if (options?.thumbnail) {
    const thumb = thumbUrl(norm, options.thumbnail);
    if (thumb && thumb !== norm) {
      push(thumb, is48 ? 'pocket' : isHttp ? 'ua' : 'none');
    }
  }

  push(norm, is48 ? 'pocket' : isHttp ? 'ua' : 'none');

  let mirrorUri = '';
  const mAlt = /^https?:\/\/(?:source|mp4|source4)\.48\.cn(\/[^?#]*)/i.exec(norm);
  if (mAlt && !/^\/resize_/i.test(mAlt[1])) {
    mirrorUri = `${THUMB_HOST}${mAlt[1]}`;
    push(mirrorUri, 'pocket');
  } else {
    const mS1 = /^https?:\/\/source1\.48\.cn(\/[^?#]*)/i.exec(norm);
    if (mS1 && !/^\/resize_/i.test(mS1[1])) {
      mirrorUri = `https://source.48.cn${mS1[1]}`;
      push(mirrorUri, 'pocket');
    }
  }

  const hi = Math.max(1, Math.round(Number(options?.highResWidth) || 1600));
  if (is48 && isResizable) {
    push(thumbUrlBox(norm, hi, hi), 'pocket');
    push(thumbUrlBox(norm, 800, 800), 'pocket');
  } else if (isNos && isResizable && !SIGNED_QUERY_RE.test(norm) && !/imageView/i.test(norm)) {
    const sep = norm.includes('?') ? '&' : '?';
    push(`${norm}${sep}imageView&thumbnail=${hi}x0&type=jpg`, 'none');
    push(`${norm}${sep}imageView&thumbnail=${hi}x0`, 'none');
  }

  if (is48) {
    push(norm, 'none');
    if (mirrorUri) push(mirrorUri, 'none');
  } else if (isHttp) {
    push(norm, 'none');
  }

  if (clean !== norm && /^https?:\/\//i.test(clean)) {
    push(clean, 'none');
  }

  return out;
}

export const AVATAR_THUMB_WIDTH = 180;
