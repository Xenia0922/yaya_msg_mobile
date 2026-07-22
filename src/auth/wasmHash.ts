// 签名 wasm 的完整性锚点 + 纯 JS SHA-256（Hermes 无 crypto.subtle 时也能跑）。
//
// 安全说明：
// - assets/2.wasm 是随 APK 打包的可信产物，其 SHA-256 钉在 WASM_SHA256。
// - fetchWasm 从 GitHub 代理下载 wasm 后必须用本哈希校验，任一代理被投毒即拒绝执行（供应链止血点）。
// - wasmBase64.ts（WebView 兜底用的内联副本）必须由 scripts/gen-wasm-base64.mjs 从同一份
//   assets/2.wasm 生成，确保两端字节一致；更新 wasm 时务必同步本常量。

export const WASM_SHA256 = '764de771c46d9eb3e545deb7d72ee23f3a8ded8f63ac0fe56d3b0521bd027528';

export function sha256Hex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a,
    h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;

  const len = bytes.length;
  const bitLen = len * 8;
  const withOne = len + 1;
  const k = (56 - (withOne % 64) + 64) % 64;
  const total = withOne + k + 8;
  const m = new Uint8Array(total);
  m.set(bytes);
  m[len] = 0x80;
  const dv = new DataView(m.buffer);
  dv.setUint32(total - 8, Math.floor(bitLen / 0x100000000));
  dv.setUint32(total - 4, bitLen >>> 0);

  const w = new Uint32Array(64);
  const ror = (x: number, n: number): number => ((x >>> n) | (x << (32 - n))) | 0;

  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = ror(w[i - 15], 7) ^ ror(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = ror(w[i - 2], 17) ^ ror(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, hh = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = ror(e, 6) ^ ror(e, 11) ^ ror(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[i] + w[i]) | 0;
      const S0 = ror(a, 2) ^ ror(a, 13) ^ ror(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + hh) | 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((x) => (x >>> 0).toString(16).padStart(8, '0'))
    .join('');
}

function base64ToBytes(b64: string): Uint8Array {
  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const lut = new Int16Array(128).fill(-1);
  for (let i = 0; i < B64.length; i++) lut[B64.charCodeAt(i)] = i;
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '');
  let n = 0;
  for (let i = 0; i + 1 < clean.length; i += 4) {
    const c2 = lut[clean.charCodeAt(i + 2)];
    const c3 = lut[clean.charCodeAt(i + 3)];
    n += 1 + (c2 >= 0 ? 1 : 0) + (c3 >= 0 ? 1 : 0);
  }
  const out = new Uint8Array(n);
  let p = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const c0 = lut[clean.charCodeAt(i)];
    const c1 = lut[clean.charCodeAt(i + 1)];
    const c2 = lut[clean.charCodeAt(i + 2)];
    const c3 = lut[clean.charCodeAt(i + 3)];
    out[p++] = ((c0 << 2) | (c1 >> 4)) & 0xff;
    if (c2 >= 0) out[p++] = ((c1 << 4) | (c2 >> 2)) & 0xff;
    if (c3 >= 0) out[p++] = ((c2 << 6) | c3) & 0xff;
  }
  return out;
}

export function verifyWasm(buf: ArrayBuffer): boolean {
  try {
    return sha256Hex(buf) === WASM_SHA256;
  } catch {
    return false;
  }
}

export function wasmBase64MatchesPin(b64: string): boolean {
  try {
    return sha256Hex(base64ToBytes(b64).buffer as ArrayBuffer) === WASM_SHA256;
  } catch {
    return false;
  }
}
