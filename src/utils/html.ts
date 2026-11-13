/**
 * 富文本消息清洗。
 *
 * 背景（2026-11-07 用户截图）：房间消息里存在官方下发的 HTML 富文本
 * （形如 `<div><span style="color:#ffffff">欢迎</span>…<img src="/backstage/…webp"/></div>`），
 * 原实现直接把整串当纯文本渲染 → 气泡里出现原始标签。
 *
 * 处理策略（**保守**）：
 * - 只对「看起来确实是 HTML」的串做清洗（白名单标签，避免误伤 `a<b` 这类普通文本）；
 * - 保留内部文字，`<br>` / 块级闭合转换为换行；
 * - 去掉 script/style 内容；
 * - 解常见 HTML 实体；
 * - 折叠多余空白。
 * 不做完整 HTML 渲染（不引入 WebView/解析库）：只要「别把标签当文字显示」。
 */

/** 是否是「像 HTML」的串
 *  判定从严，避免把 `a<b 且 c>d` 这类普通文本误当标签：
 *  满足任一即为 HTML —— ① 含明确块级/媒体标签；② 含闭合标签；③ 含带属性的标签（`<x k="v">`）；
 *  单独的 `<b>`、`<i>` 这类含义模糊的短标签不单独作为依据。
 */
export function looksLikeHtml(text: string): boolean {
  if (!text) return false;
  const s = String(text);
  const blockOrMedia = /<\s*\/?\s*(div|span|p|br|img|table|thead|tbody|tr|td|li|ul|ol|h[1-6]|font|strong|em|iframe|video|audio)\b/i.test(s);
  const closingTag = /<\s*\/\s*[a-z][a-z0-9]*\s*>/i.test(s);
  const attrTag = /<\s*[a-z][a-z0-9]*\s+[a-z_:][-a-z0-9_:.]*\s*=/i.test(s);
  return blockOrMedia || closingTag || attrTag;
}

/** HTML → 纯文本（去标签、留内文、解常见实体） */
export function htmlToPlain(html: string): string {
  if (!html) return '';
  let s = String(html);
  // 1) 去掉脚本/样式块（含内容）
  s = s.replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, ' ');
  // 2) 换行语义
  s = s.replace(/<\s*br\s*\/?\s*>/gi, '\n');
  s = s.replace(/<\s*\/\s*(div|p|li|tr|h[1-6])\s*>/gi, '\n');
  // 3) 去所有标签
  s = s.replace(/<[^>]*>/g, '');
  // 4) 解实体（只处理常见几种）
  s = s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&');
  // 5) 折叠空白
  return s
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/** 统一入口：像 HTML 才清洗，否则原样返回 */
export function sanitizeText(text: string): string {
  if (!text) return '';
  const raw = String(text);
  return looksLikeHtml(raw) ? htmlToPlain(raw) : raw;
}

/** 提取 HTML 内的图片地址（相对路径原样返回，由 normalizeUrl 补域名） */
export function extractHtmlImageUrls(html: string): string[] {
  if (!html) return [];
  const out: string[] = [];
  const re = /<img\b[^>]*\bsrc\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(String(html)))) {
    const src = (m[2] || m[3] || m[4] || '').trim();
    if (src && !/^data:/i.test(src)) out.push(src);
  }
  return Array.from(new Set(out));
}
