import { generatePaAsync, getWasmError, isWasmReady } from '../auth';
import { logInfo, logWarn } from '../utils/runtimeLog';

export type SignatureHealth = {
  ok: boolean | null;
  reason: string;
  latencyMs: number;
  paLength: number;
  clockSkewMs: number | null;
  at: number;
};

const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function b64ToAscii(b64: string): string | null {
  const clean = b64.replace(/=+$/, '');
  let bits = 0;
  let acc = 0;
  let out = '';
  for (let i = 0; i < clean.length; i += 1) {
    const v = B64_CHARS.indexOf(clean[i]);
    if (v < 0) return null;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out += String.fromCharCode((acc >> bits) & 0xff);
    }
  }
  return out;
}

function parsePa(pa: string): { shapeOk: boolean; clockMs: number | null } {
  const decoded = b64ToAscii(pa);
  if (!decoded) return { shapeOk: false, clockMs: null };
  const shapeOk = /^\d{13}[0-9a-f]{32}[0-9a-f]{32}\d{10}$/i.test(decoded);
  const clockMs = /^\d{13}/.test(decoded) ? Number(decoded.slice(0, 13)) : null;

  const plausible = clockMs != null && clockMs > 1577836800000 && clockMs < 4102444800000;
  return { shapeOk, clockMs: plausible ? clockMs : null };
}

export async function checkSignatureHealth(): Promise<SignatureHealth> {
  const at = Date.now();
  const t0 = at;
  let pa: string | null = null;
  try {
    pa = await generatePaAsync({ fresh: true });
  } catch {
    pa = null;
  }
  const latencyMs = Date.now() - t0;

  if (!pa) {
    const ready = isWasmReady();
    return {
      ok: ready ? false : null,
      reason: getWasmError() || (ready ? 'pa 生成为空' : '签名器尚未就绪（预热中）'),
      latencyMs,
      paLength: 0,
      clockSkewMs: null,
      at,
    };
  }

  const { shapeOk, clockMs } = parsePa(pa);
  const clockSkewMs = clockMs == null ? null : Math.abs(Date.now() - clockMs);
  if (!shapeOk) {
    return {
      ok: false,
      reason: 'pa 结构异常（长度或组成不符合预期）',
      latencyMs,
      paLength: pa.length,
      clockSkewMs,
      at,
    };
  }
  if (clockSkewMs != null && clockSkewMs > 5000) {
    return {
      ok: false,
      reason: `设备时间偏差 ${Math.round(clockSkewMs / 1000)}s，可能导致服务端拒签`,
      latencyMs,
      paLength: pa.length,
      clockSkewMs,
      at,
    };
  }
  return { ok: true, reason: '', latencyMs, paLength: pa.length, clockSkewMs, at };
}

let lastResult: SignatureHealth | null = null;
let started = false;

export function getLastSignatureHealth(): SignatureHealth | null {
  return lastResult;
}

export function startSignatureHealthCheck(delayMs = 5000, maxRetries = 2): void {
  if (started) return;
  started = true;
  setTimeout(() => {
    (async () => {
      let result: SignatureHealth | null = null;
      for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
        result = await checkSignatureHealth();
        if (result.ok !== null) break;
        await new Promise((r) => setTimeout(r, 3000));
      }
      lastResult = result;
      if (!result) return;
      const detail = `ok=${String(result.ok)} latency=${result.latencyMs}ms len=${result.paLength} skew=${result.clockSkewMs == null ? '?' : `${result.clockSkewMs}ms`}`;
      if (result.ok) {
        logInfo(`[sign.health] 签名正常 ${detail}`, 'sign');
      } else {
        logWarn(`[sign.health] 签名异常：${result.reason} ${detail}`, 'sign');
      }
    })().catch(() => {});
  }, delayMs);
}
