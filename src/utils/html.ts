export function looksLikeHtml(text: string): boolean {
  if (!text) return false;
  const s = String(text);
  const blockOrMedia =
    /<\s*\/?\s*(div|span|p|br|img|table|thead|tbody|tr|td|li|ul|ol|h[1-6]|font|strong|em|iframe|video|audio)\b/i.test(
      s,
    );
  const closingTag = /<\s*\/\s*[a-z][a-z0-9]*\s*>/i.test(s);
  const attrTag = /<\s*[a-z][a-z0-9]*\s+[a-z_:][-a-z0-9_:.]*\s*=/i.test(s);
  return blockOrMedia || closingTag || attrTag;
}

export function htmlToPlain(html: string): string {
  if (!html) return '';
  let s = String(html);

  s = s.replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, ' ');

  s = s.replace(/<\s*br\s*\/?\s*>/gi, '\n');
  s = s.replace(/<\s*\/\s*(div|p|li|tr|h[1-6])\s*>/gi, '\n');

  s = s.replace(/<[^>]*>/g, '');

  s = s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&');

  return s
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

export function sanitizeText(text: string): string {
  if (!text) return '';
  const raw = String(text);
  return looksLikeHtml(raw) ? htmlToPlain(raw) : raw;
}

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
