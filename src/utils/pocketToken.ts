export function extractPocketTokenFromObject(value: unknown): string {
  const seen = new Set<unknown>();
  const walk = (node: unknown): string => {
    if (!node || typeof node !== 'object' || seen.has(node)) return '';
    seen.add(node);
    const rec = node as Record<string, any>;
    const direct = [
      rec.token,
      rec.accessToken,
      rec.access_token,
      rec.p48Token,
      rec.sessionToken,
      rec?.userInfo?.token,
      rec?.userInfo?.accessToken,
      rec?.content?.token,
      rec?.content?.accessToken,
      rec?.content?.userInfo?.token,
      rec?.data?.token,
      rec?.data?.accessToken,
    ].find((item) => typeof item === 'string' && item.trim().length > 10);
    if (typeof direct === 'string') return direct.trim();
    for (const item of Object.values(rec)) {
      const found = walk(item);
      if (found) return found;
    }
    return '';
  };
  return walk(value);
}

function stripOuterQuotes(value: string): string {
  let current = value.trim();
  while (current.length >= 2) {
    const first = current[0];
    const last = current[current.length - 1];
    if (
      (first === '"' && last === '"') ||
      (first === "'" && last === "'") ||
      (first === '`' && last === '`')
    ) {
      current = current.slice(1, -1).trim();
    } else {
      break;
    }
  }
  return current;
}

function unwrapPrefixAndQuery(value: string): string {
  let current = stripOuterQuotes(value);

  current = current.replace(/^(?:authorization\s*[:=]\s*)?bearer\s+/i, '');
  const kvMatch = current.match(
    /^(?:p48_?token|access_?token|session_?token|token)\s*[:=]\s*(.+)$/i,
  );
  if (kvMatch) {
    current = kvMatch[1].trim();
  } else if (
    current.includes('&') &&
    /(?:^|[?&;])(?:p48_?token|access_?token|token)=/i.test(current)
  ) {
    const seg = current
      .split(/[&;]/)
      .map((part) => part.trim())
      .find((part) => /^(?:p48_?token|access_?token|token)=/i.test(part));
    if (seg) current = seg.replace(/^(?:p48_?token|access_?token|token)=/i, '').trim();
  }

  if (/^[A-Za-z0-9+/=%_-]+[&;]\w+=/.test(current)) {
    current = current.split(/[&;]/)[0].trim();
  }
  return stripOuterQuotes(current);
}

function repairBase64Padding(token: string): string {
  if (!/^[A-Za-z0-9+/]+={0,3}$/.test(token) || token.length < 16) {
    return token;
  }
  const hasPad = token.endsWith('=');
  const body = token.replace(/=+$/, '');
  const rem = body.length % 4;

  if (rem === 1) return token;
  if (rem === 0) {
    return hasPad ? body : token;
  }
  const expectedPad = rem === 2 ? '==' : '=';

  if (hasPad || body.length >= 20) {
    return `${body}${expectedPad}`;
  }
  return token;
}

export function normalizePocketToken(raw: unknown): string {
  if (raw == null) return '';
  if (typeof raw === 'object') {
    const extracted = extractPocketTokenFromObject(raw);
    return extracted ? normalizePocketToken(extracted) : '';
  }

  let current = String(raw)
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim();
  if (!current) return '';

  for (let pass = 0; pass < 2; pass += 1) {
    current = stripOuterQuotes(current);
    if (current.startsWith('{') || current.startsWith('[')) {
      try {
        const parsed = JSON.parse(current);
        const extracted = extractPocketTokenFromObject(parsed);
        if (extracted) {
          current = extracted;
          continue;
        }
      } catch {
        const keyHit = current.match(
          /["'](?:p48Token|accessToken|access_token|token)["']\s*:\s*["']([^"']+)["']/,
        );
        if (keyHit?.[1]) {
          current = keyHit[1];
          continue;
        }
      }
    }
    break;
  }

  current = unwrapPrefixAndQuery(current);

  for (let pass = 0; pass < 2; pass += 1) {
    if (!/%[0-9A-Fa-f]{2}/.test(current)) break;
    try {
      const decoded = decodeURIComponent(current);
      if (decoded === current) break;
      current = unwrapPrefixAndQuery(decoded);
    } catch {
      break;
    }
  }

  current = current.replace(/\s+/g, '');
  if (!current) return '';
  return repairBase64Padding(current);
}

export function normalizePocketDeviceId(raw: unknown): string {
  if (raw == null) return '';
  const cleaned = stripOuterQuotes(String(raw).replace(/[\u200B-\u200D\uFEFF]/g, ''))
    .replace(/\s+/g, '')
    .slice(0, 64);
  if (cleaned.length < 8 || !/^[a-z0-9-]+$/i.test(cleaned)) return '';
  if (/^[a-f0-9]{16}$/i.test(cleaned) || /^[a-f0-9]{32}$/i.test(cleaned)) {
    return cleaned.toLowerCase();
  }
  return cleaned;
}

export function extractPocketDeviceIdFromObject(value: unknown): string {
  const seen = new Set<unknown>();
  const walk = (node: unknown): string => {
    if (!node || typeof node !== 'object' || seen.has(node)) return '';
    seen.add(node);
    const rec = node as Record<string, unknown>;
    for (const key of ['p48DeviceId', 'deviceId', 'device_id', 'IMEI', 'imei']) {
      const normalized = normalizePocketDeviceId(rec[key]);
      if (normalized) return normalized;
    }
    for (const item of Object.values(rec)) {
      const found = walk(item);
      if (found) return found;
    }
    return '';
  };
  return walk(value);
}

export function parsePocketTokenBundle(raw: unknown): { token: string; deviceId: string } {
  const token = normalizePocketToken(raw);
  if (raw == null) return { token, deviceId: '' };
  if (typeof raw === 'object') {
    return { token, deviceId: extractPocketDeviceIdFromObject(raw) };
  }
  let text = String(raw)
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim();
  if (!text) return { token: '', deviceId: '' };
  for (let pass = 0; pass < 2; pass += 1) {
    text = stripOuterQuotes(text);
    if (text.startsWith('{') || text.startsWith('[')) {
      try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === 'object') {
          return { token, deviceId: extractPocketDeviceIdFromObject(parsed) };
        }
      } catch {
        const match = text.match(
          /["'](?:p48DeviceId|deviceId|device_id|IMEI|imei)["']\s*:\s*["']([^"']+)["']/,
        );
        if (match?.[1]) {
          return { token, deviceId: normalizePocketDeviceId(match[1]) };
        }
      }
    }
    break;
  }
  const kvMatch = text.match(/(?:^|[?&;\s])(?:p48_?device_?id|device_?id|imei)=([^&\s;]+)/i);
  if (kvMatch?.[1]) {
    let candidate = kvMatch[1];
    try {
      candidate = decodeURIComponent(candidate);
    } catch {}
    return { token, deviceId: normalizePocketDeviceId(candidate) };
  }
  return { token, deviceId: '' };
}

export function formatPocketTokenBundle(token: unknown, deviceId?: unknown): string {
  const cleanToken = normalizePocketToken(token);
  if (!cleanToken) return '';
  const cleanDeviceId = normalizePocketDeviceId(deviceId);
  if (!cleanDeviceId) return cleanToken;
  return JSON.stringify({ token: cleanToken, deviceId: cleanDeviceId });
}
