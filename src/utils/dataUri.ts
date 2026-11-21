export function sniffImageBase64Mime(base64: string): string {
  const head = String(base64 || '').slice(0, 16);
  if (head.startsWith('/9j/')) return 'image/jpeg';
  if (head.startsWith('iVBORw0KGgo')) return 'image/png';
  if (head.startsWith('R0lGOD')) return 'image/gif';
  if (head.startsWith('UklGR')) return 'image/webp';
  if (head.startsWith('Qk')) return 'image/bmp';
  return '';
}

export function fixDataUriMime(uri: string): string {
  const raw = String(uri || '');
  if (!raw.startsWith('data:')) return raw;
  const comma = raw.indexOf(',');
  if (comma < 0) return raw;
  const meta = raw.slice(5, comma);
  if (!/;base64$/i.test(meta)) return raw;
  const declared = meta.slice(0, -';base64'.length);
  const actual = sniffImageBase64Mime(raw.slice(comma + 1, comma + 24));
  if (!actual || actual === declared.toLowerCase()) return raw;
  return `data:${actual};base64,${raw.slice(comma + 1)}`;
}
