import { generatePaAsync, getWasmError, isWasmReady } from '../auth';
import { logInfo, logWarn } from '../utils/runtimeLog';

/**
 * 签名（pa）健康自检。
 *
 * 背景：全 App 所有需要鉴权的接口都依赖 `pa`；一旦签名器失效（上游改签名算法/版本戳、
 * 设备时间严重错乱、隐藏 WebView 被回收），表现是「所有联网功能成批失败」，
 * 而没有明显线索——用户只会说「软件坏了」。
 *
 * 这里在启动后静默跑一次自检并把结果写进运行日志（tag = sign.health），
 * 让「被动等用户报障」变成「日志里能一眼看到」。
 *
 * 校验项（都不联网、不消耗账号）：
 *   1. 能否生成 pa；
 *   2. pa 可 base64 解码、长度/结构符合 [13位毫秒][32hex][32hex][版本戳]；
 *   3. pa 内嵌时间与本机时间偏差 < 5s（偏差过大 = 用户手机时间不准，服务端可能拒签）。
 *
 * 刻意不做：不比对固定版本戳（上游可能升级，硬比会造成误报）；不上报服务端。
 */

export type SignatureHealth = {
  /** true = 正常；false = 明确异常；null = 尚不确定（如 WebView 预热未完成） */
  ok: boolean | null;
  reason: string;
  latencyMs: number;
  paLength: number;
  clockSkewMs: number | null;
  at: number;
};

const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** 极简 base64 → ASCII（pa 本身是纯 ASCII，避免依赖 atob/Buffer） */
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

/** 解析 pa：期望 [13 位毫秒][32 hex][32 hex][版本戳 10 位]，共 87 字符 */
function parsePa(pa: string): { shapeOk: boolean; clockMs: number | null } {
  const decoded = b64ToAscii(pa);
  if (!decoded) return { shapeOk: false, clockMs: null };
  const shapeOk = /^\d{13}[0-9a-f]{32}[0-9a-f]{32}\d{10}$/i.test(decoded);
  const clockMs = /^\d{13}/.test(decoded) ? Number(decoded.slice(0, 13)) : null;
  // 13 位毫秒应落在合理区间（2020-01 ~ 2100-01），防把畸形串当成时间
  const plausible = clockMs != null && clockMs > 1577836800000 && clockMs < 4102444800000;
  return { shapeOk, clockMs: plausible ? clockMs : null };
}

/** 跑一次自检（不重试、不抛错） */
export async function checkSignatureHealth(): Promise<SignatureHealth> {
  const at = Date.now();
  const t0 = at;
  let pa: string | null = null;
  try {
    pa = await generatePaAsync();
  } catch {
    pa = null;
  }
  const latencyMs = Date.now() - t0;

  if (!pa) {
    // WebView 尚在预热：标记「不确定」而非失败，避免冷启动误报
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
    return { ok: false, reason: 'pa 结构异常（长度或组成不符合预期）', latencyMs, paLength: pa.length, clockSkewMs, at };
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

/**
 * 启动后静默自检：延迟 delayMs，最多重试 maxRetries 次（WebView 预热需要时间）。
 * 全程吞异常，绝不影响启动。
 */
export function startSignatureHealthCheck(delayMs = 5000, maxRetries = 2): void {
  if (started) return;
  started = true;
  setTimeout(() => {
    (async () => {
      let result: SignatureHealth | null = null;
      for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
        result = await checkSignatureHealth();
        if (result.ok !== null) break; // 已得明确结论
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
