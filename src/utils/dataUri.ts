/**
 * data URI 的 MIME 纠错。
 *
 * 背景：用户自定义背景图以 `data:<mime>;base64,<bytes>` 形式存在 AsyncStorage。
 * 保存时若直接采信图片选择器给的 `mimeType`，就会出现**声明与真实字节不一致**。
 * 实测踩坑：
 *   `data:image/png;base64,/9j/4AAQSkZJRgAB…`   ← 声明 PNG，实际是 JPEG（FF D8 FF E0）
 * 部分解码路径会信任这个声明 → 解码失败 → 背景层什么都没画出来、透出下层黑底
 * （用户反馈的「背景图没加载」）。
 *
 * 这里提供两个能力：
 *   - `sniffImageBase64Mime`：按魔数判定真实类型（保存时用）
 *   - `fixDataUriMime`     ：修正 data URI 头部的 mime（渲染时用，可顺带修好历史脏数据）
 */

/** 从 base64 头部魔数嗅探真实图片类型；识别不出返回空串 */
export function sniffImageBase64Mime(base64: string): string {
  const head = String(base64 || '').slice(0, 16);
  if (head.startsWith('/9j/')) return 'image/jpeg'; // JPEG: FF D8 FF
  if (head.startsWith('iVBORw0KGgo')) return 'image/png'; // PNG: 89 50 4E 47
  if (head.startsWith('R0lGOD')) return 'image/gif'; // GIF: GIF8
  if (head.startsWith('UklGR')) return 'image/webp'; // WEBP: RIFF….WEBP
  if (head.startsWith('Qk')) return 'image/bmp'; // BMP: BM
  return '';
}

/**
 * 修正 data URI 的 mime 使其与真实字节一致（非 data URI 或识别不出时原样返回）。
 * 幂等、纯字符串操作，可直接放在渲染路径上。
 */
export function fixDataUriMime(uri: string): string {
  const raw = String(uri || '');
  if (!raw.startsWith('data:')) return raw;
  const comma = raw.indexOf(',');
  if (comma < 0) return raw;
  const meta = raw.slice(5, comma); // 形如 "image/png;base64"
  if (!/;base64$/i.test(meta)) return raw;
  const declared = meta.slice(0, -';base64'.length);
  const actual = sniffImageBase64Mime(raw.slice(comma + 1, comma + 24));
  if (!actual || actual === declared.toLowerCase()) return raw;
  return `data:${actual};base64,${raw.slice(comma + 1)}`;
}
