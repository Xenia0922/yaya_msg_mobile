import { generatePaViaWebView, getWebViewSignerError, isWebViewSignerReady } from './webviewSigner';
import { verifyWasm, wasmBase64MatchesPin, base64ToBytes } from './wasmHash';
import wasmBase64 from './wasmBase64';

let WASM_READY = false;
let _paGen: (() => string | null) | null = null;
let _lastError = '';
// 原生通道是否曾经成功（用于区分「原生不支持/失败」与「WebView 兜底未就绪」）
let _nativeSucceeded = false;

export function getWasmError(): string {
  // 原生已成功但 pa 仍为空 → 真实阻塞点在 WebView 兜底，优先报 WebView 错误，避免把原生引导期的
  // 中间态（如 "WebAssembly undefined" 守卫串）误当成设备不支持而吓到用户。
  if (_nativeSucceeded && !isWebViewSignerReady()) return getWebViewSignerError() || _lastError || '';
  if (isWebViewSignerReady()) return '';
  // WebView 是实际依赖的兜底通道：若它未就绪，优先报其错误而非原生引导期的守卫串
  return getWebViewSignerError() || _lastError || '';
}
export function isWasmReady(): boolean { return (WASM_READY && _paGen !== null) || isWebViewSignerReady(); }

let _initPromise: Promise<void> | null = null;

export function initWasm(): Promise<void> {
  if (WASM_READY && _paGen) return Promise.resolve();
  if (_initPromise) return _initPromise;
  _initPromise = (async () => {
    try {
      console.log('[initWasm] Starting native WASM initialization...');
      if (typeof WebAssembly === 'undefined') {
        // 真实设备几乎不会走到这里；仅作守卫，不当作致命错误污染用户可见文案
        throw new Error('当前运行环境缺少 WebAssembly 支持');
      }
      console.log('[initWasm] Loading wasm module...');
      const m = require('./wasm');
      const initFn = m.default || m;
      const paFn = m.__x6c2adf8__;
      if (!initFn || !paFn) throw new Error('WASM 加载器异常');

      console.log('[initWasm] Fetching WASM bytes...');
      const buf = await fetchWasm();
      console.log('[initWasm] WASM bytes fetched, length:', buf.byteLength);
      await initFn(buf);
      _paGen = paFn;
      WASM_READY = true;
      _nativeSucceeded = true;
      console.log('[initWasm] Native WASM initialization SUCCESS');
    } catch (e: any) {
      _lastError = e?.message || String(e);
      console.error('[initWasm] Native WASM initialization FAILED:', _lastError);
      // 失败不置 WASM_READY：原生通道可重试（下次调用重跑），generatePaAsync 仍会兜底 WebView。
    } finally {
      _initPromise = null;
    }
  })();
  return _initPromise;
}

async function fetchWasm(): Promise<ArrayBuffer> {
  // 1) 构建期内联 base64（JS bundle 内置，release 包也可靠，与 WebView 通道同源）
  try {
    if (!wasmBase64MatchesPin(wasmBase64)) {
      throw new Error('内联 wasmBase64 完整性校验失败');
    }
    const bytes = base64ToBytes(wasmBase64);
    // 类型修正：base64ToBytes 返回的 Uint8Array 底层为常规 ArrayBuffer（非 SharedArrayBuffer），
    // 此处转换仅为通过 tsc 的 ArrayBufferLike 收窄，不改变运行时行为。
    return bytes.buffer.slice(0, bytes.length) as ArrayBuffer;
  } catch (e: any) {
    _lastError = e.message || String(e);
  }

  // 2) 本地打包资源（APK 内置，来源可信，直接执行）
  try {
    const { Asset } = await import('expo-asset');
    const [asset] = await Asset.loadAsync(require('../../assets/2.wasm'));
    const uri = asset.localUri || asset.uri;
    if (uri) {
      const resp = await fetch(uri);
      if (resp.ok) {
        const buf = await resp.arrayBuffer();
        if (verifyWasm(buf)) return buf;
        _lastError = 'assets/2.wasm 完整性校验失败';
      }
    }
  } catch (e: any) {
    _lastError = e.message || String(e);
  }

  // 3) 代理下载（不可信，必须哈希校验，防供应链投毒：任一代理被篡改即拒绝执行）
  const urls = [
    'https://ghproxy.net/https://raw.githubusercontent.com/yk1z/yaya_msg/refs/heads/main/2.wasm',
    'https://mirror.ghproxy.com/https://raw.githubusercontent.com/yk1z/yaya_msg/refs/heads/main/2.wasm',
    'https://raw.githubusercontent.com/yk1z/yaya_msg/refs/heads/main/2.wasm',
  ];
  let lastErr = '';
  for (const url of urls) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      const resp = await fetch(url, { signal: ctrl.signal });
      clearTimeout(timer);
      if (!resp.ok) continue;
      const buf = await resp.arrayBuffer();
      if (!verifyWasm(buf)) {
        lastErr = '下载的 wasm 完整性校验失败，已拒绝执行（疑似被篡改）';
        continue;
      }
      return buf;
    } catch (e: any) { lastErr = e.message || String(e); }
  }
  throw new Error(lastErr || '所有源下载失败');
}

export function generatePa(): string | null {
  if (!_paGen) return null;
  try { return _paGen(); } catch { return null; }
}

export async function generatePaAsync(): Promise<string | null> {
  // 先等原生通道初始化完成再判定（避免「initWasm 还在异步加载、_paGen 尚为 null」就误判为不可用，
  // 进而过早落到 WebView 兜底并被 6s 超时打断 —— 这正是 1305 后「设备不支持 WebAssembly」误报的根因）。
  console.log('[generatePaAsync] ERROR-LEVEL: Checking native WASM status, WASM_READY:', WASM_READY, '_paGen:', !!_paGen, '_initPromise:', !!_initPromise);
  if ((!WASM_READY || !_paGen) && _initPromise) {
    try { 
      console.log('[generatePaAsync] Waiting for native initPromise...');
      await _initPromise; 
      console.log('[generatePaAsync] Native initPromise resolved');
    } catch { 
      console.log('[generatePaAsync] Native initPromise failed, will try WebView');
      /* 原生失败则继续走 WebView 兜底 */ 
    }
  }
  const localPa = generatePa();
  if (localPa) {
    console.log('[generatePaAsync] Native PA generated successfully');
    return localPa;
  }
  console.log('[generatePaAsync] Native PA unavailable, trying WebView...');
  console.log('[generatePaAsync] ERROR-LEVEL: isWebViewSignerReady:', isWebViewSignerReady(), 'getWebViewSignerError:', getWebViewSignerError());
  try {
    // 冷启动 WebView 签名容器需要时间预热，给足 10s（同 1305 之前的默认），避免首调超时误报
    const webviewPa = await generatePaViaWebView(10000);
    if (webviewPa) {
      console.log('[generatePaAsync] WebView PA generated successfully');
    } else {
      console.log('[generatePaAsync] WebView PA returned null');
    }
    return webviewPa;
  } catch (e: any) {
    _lastError = e?.message || String(e);
    console.error('[generatePaAsync] WebView PA generation FAILED:', _lastError);
    return null;
  }
}

export { WebViewSigner } from './webviewSigner';
