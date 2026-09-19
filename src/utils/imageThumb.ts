/**
 * 48 图床缩略图 URL（对齐桌面端 app-legacy.js:7734 getOptimizedThumbUrl）：
 *   `url + (?|&) + imageView&thumbnail=<w>x0`
 * 只对 48 系图床生效，视频/音频链接与其它域名原样返回；
 * 已带 imageView/thumbnail 参数的 URL 不重复追加。
 *
 * 作用：列表/头像使用小图，显著降低流量与首屏时间（图床按参数裁剪）。
 */
export function thumbUrl(url: any, width = 500): string {
  const raw = String(url ?? '').trim();
  if (!raw) return '';
  // 视频/音频不做缩略图（会 404）
  if (/\.(mp4|mov|m4v|m4a|aac|mp3|amr|flv|ts)(\?|$)/i.test(raw)) return raw;
  // 只处理 48 系图床（source.48.cn / source3.48.cn / pfile.48.cn ...）
  if (!/^https?:\/\/[^/]*\.48\.cn\//i.test(raw)) return raw;
  if (/imageView|thumbnail=/i.test(raw)) return raw;
  return `${raw}${raw.includes('?') ? '&' : '?'}imageView&thumbnail=${Math.max(1, Math.round(width))}x0`;
}

/** 头像类小图（列表/会话/消息里的头像）统一尺寸 */
export const AVATAR_THUMB_WIDTH = 180;
