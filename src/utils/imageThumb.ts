/**
 * 48 图床缩略图 URL。
 *
 * ══ 之前为什么没生效（2026-09-19 实测定位）══
 * 旧实现照抄了官方的一个 helper（`str + "?imageView&thumbnail=%dx%d"`），
 * 但 48 的 CDN **完全忽略这个查询参数**：原图 783,734 bytes，加参数后仍是 783,734 bytes
 * （`imageView2` / `x-oss-process` / `imageMogr2` / `?w=` 等 8 种写法逐一试过，全部相同）。
 * 于是列表/网格每张图都在下原图（封面 356KB~1.38MB，均值 ~0.78MB / 828×1104），
 * 滚动时滚动帧里挤满「下载 + JPEG 解码 + 纹理上传」→ 实测网格滚动帧耗时 48ms（21FPS），
 * 而几乎无图的设置页是 16ms（60FPS 满帧）。
 *
 * ══ 真正生效的形式（官方 Pocket48 App 用的那条）══
 *   https://source1.48.cn/resize_{W}x{H}/{path}
 * 注意三点：
 *   1. 是**路径前缀**，不是查询参数；
 *   2. 域名是 **source1**.48.cn（source.48.cn / source3.48.cn 上这套前缀返回 415）；
 *   3. W 与 H **都必须 > 0**，只给宽度（如 resize_500x0）会被 nginx 判 415。
 * 返回的是**等比缩放进 W×H 盒子**的图（828×1104 请求 500x500 → 375×500）。
 * 实测收益：783,734 → 29,035 bytes（27×），1,380,698 → 8,729 bytes（158×）。
 *
 * 非 48 图床、gif（缩了会丢动画）、音视频链接一律原样返回。
 */

/** 缩略图专用域名（官方 App 同款） */
const THUMB_HOST = 'https://source1.48.cn';

/** 视频/音频不做缩略图（会 404） */
const MEDIA_EXT_RE = /\.(mp4|mov|m4v|m4a|aac|mp3|amr|flv|ts)(\?|$)/i;
/** gif 不做缩略图（会变静态图） */
const GIF_RE = /\.gif(\?|$)/i;

/**
 * 生成「装进 W×H 盒子」的缩略图 URL。
 * W/H 必须 > 0；宽高比由服务端保持（contain 语义，不会拉伸）。
 */
export function thumbUrlBox(url: any, width: number, height: number): string {
  const raw = String(url ?? '').trim();
  if (!raw) return '';
  if (MEDIA_EXT_RE.test(raw)) return raw;
  if (GIF_RE.test(raw)) return raw;
  // 已经是 source1 的 resize 链接 → 幂等返回
  if (/^https?:\/\/source1\.48\.cn\/resize_/i.test(raw)) return raw;
  // former.48.cn 官方也跳过（另一套老存储，前缀不认）
  if (/former\.48\.cn/i.test(raw)) return raw;
  // 只处理 48 系图床，取出「路径部分」（丢掉原有 query：那套参数本来就不生效，
  // 留着只会让缓存键多一个变体）
  const m = /^https?:\/\/[^/]*\.48\.cn(\/[^?#]*)/i.exec(raw);
  if (!m) return raw;
  const path = m[1];
  const w = Math.max(1, Math.round(Number(width) || 0));
  const h = Math.max(1, Math.round(Number(height) || 0));
  return `${THUMB_HOST}/resize_${w}x${h}${path}`;
}

/**
 * 方形盒子缩略图（列表/网格封面、头像等）。
 * 用 W×W 盒子让服务端按原图比例 contain，横图竖图都不会变形。
 */
export function thumbUrl(url: any, width = 500): string {
  const w = Math.max(1, Math.round(Number(width) || 0));
  return thumbUrlBox(url, w, w);
}

/** 头像类小图（列表/会话/消息里的头像）统一尺寸 */
export const AVATAR_THUMB_WIDTH = 180;
