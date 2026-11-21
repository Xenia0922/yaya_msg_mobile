import { generatePaViaWebView, getWebViewSignerError, isWebViewSignerReady } from './webviewSigner';
import { verifyWasm, wasmBase64MatchesPin, base64ToBytes } from './wasmHash';
import wasmBase64 from './wasmBase64';

const dbg = __DEV__ ? (console.debug || console.log).bind(console) : () => {};

let WASM_READY = false;
let _paGen: (() => string | null) | null = null;

const PA_CACHE_TTL_MS = 15000;
let _cachedPa: string | null = null;
let _cachedPaAt = 0;
let _lastError = '';

let _nativeSucceeded = false;

let _nativeWarned = false;

let _paFailLoggedAt = 0;
let _paFailSuppressed = 0;
function logPaFailure(message: string) {
  const now = Date.now();
  if (now - _paFailLoggedAt > 5000) {
    const extra =
      _paFailSuppressed > 0 ? `（同一窗口内另有 ${_paFailSuppressed} 次相同失败已折叠）` : '';
    console.error('[generatePaAsync] WebView PA generation FAILED:', `${message}${extra}`);
    _paFailLoggedAt = now;
    _paFailSuppressed = 0;
    return;
  }
  _paFailSuppressed += 1;
}

export function getWasmError(): string {
  if (_nativeSucceeded && !isWebViewSignerReady())
    return getWebViewSignerError() || _lastError || '';
  if (isWebViewSignerReady()) return '';

  return getWebViewSignerError() || _lastError || '';
}
function hasFreshCachedPa(): boolean {
  if (!_cachedPa) return false;
  const delta = Date.now() - _cachedPaAt;
  return delta >= 0 && delta < PA_CACHE_TTL_MS;
}

export function invalidatePaCache(): void {
  _cachedPa = null;
  _cachedPaAt = 0;
}

export function isWasmReady(): boolean {
  return (WASM_READY && _paGen !== null) || isWebViewSignerReady() || hasFreshCachedPa();
}

let _initPromise: Promise<void> | null = null;

let _nativeUnavailable = false;

export function initWasm(): Promise<void> {
  if (WASM_READY && _paGen) return Promise.resolve();
  if (_nativeUnavailable) return Promise.resolve();
  if (_initPromise) return _initPromise;
  _initPromise = (async () => {
    try {
      dbg('[initWasm] Starting native WASM initialization...');
      if (typeof WebAssembly === 'undefined') {
        _nativeUnavailable = true;
        throw new Error('当前运行环境缺少 WebAssembly 支持');
      }
      dbg('[initWasm] Loading wasm module...');
      const m = require('./wasm');
      const initFn = m.default || m;
      const paFn = m.__x6c2adf8__;
      if (!initFn || !paFn) throw new Error('WASM 加载器异常');

      dbg('[initWasm] Fetching WASM bytes...');
      const buf = await fetchWasm();
      dbg('[initWasm] WASM bytes fetched, length:', buf.byteLength);
      await initFn(buf);
      _paGen = paFn;
      WASM_READY = true;
      _nativeSucceeded = true;
      dbg('[initWasm] Native WASM initialization SUCCESS');
    } catch (e: any) {
      _lastError = e?.message || String(e);

      if (!_nativeWarned) {
        _nativeWarned = true;
        console.warn(
          '[initWasm] Native WASM unavailable (Hermes), falling back to WebView signer:',
          _lastError,
        );
      }
    } finally {
      _initPromise = null;
    }
  })();
  return _initPromise;
}

async function fetchWasm(): Promise<ArrayBuffer> {
  try {
    if (!wasmBase64MatchesPin(wasmBase64)) {
      throw new Error('内联 wasmBase64 完整性校验失败');
    }
    const bytes = base64ToBytes(wasmBase64);

    return bytes.buffer.slice(0, bytes.length) as ArrayBuffer;
  } catch (e: any) {
    _lastError = e.message || String(e);
  }

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

  const urls = [
    'https://ghproxy.net/https://raw.githubusercontent.com/yk1z/yaya_msg/refs/heads/main/2.wasm',
    'https://mirror.ghproxy.com/https://raw.githubusercontent.com/yk1z/yaya_msg/refs/heads/main/2.wasm',
    'https://raw.githubusercontent.com/yk1z/yaya_msg/refs/heads/main/2.wasm',
  ];
  let lastErr = '';
  for (const url of urls) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      const ctrl = new AbortController();
      timer = setTimeout(() => ctrl.abort(), 8000);
      const resp = await fetch(url, { signal: ctrl.signal });
      if (!resp.ok) continue;

      const buf = await resp.arrayBuffer();
      if (!verifyWasm(buf)) {
        lastErr = '下载的 wasm 完整性校验失败，已拒绝执行（疑似被篡改）';
        continue;
      }
      return buf;
    } catch (e: any) {
      lastErr = e.message || String(e);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  throw new Error(lastErr || '所有源下载失败');
}

export function generatePa(): string | null {
  if (!_paGen) return null;
  try {
    return _paGen();
  } catch {
    return null;
  }
}

export async function generatePaAsync(options?: { fresh?: boolean }): Promise<string | null> {
  dbg(
    '[generatePaAsync] ERROR-LEVEL: Checking native WASM status, WASM_READY:',
    WASM_READY,
    '_paGen:',
    !!_paGen,
    '_initPromise:',
    !!_initPromise,
  );
  if ((!WASM_READY || !_paGen) && _initPromise) {
    try {
      dbg('[generatePaAsync] Waiting for native initPromise...');
      await _initPromise;
      dbg('[generatePaAsync] Native initPromise resolved');
    } catch {
      dbg('[generatePaAsync] Native initPromise failed, will try WebView');
    }
  }
  const cached = !options?.fresh && hasFreshCachedPa() ? _cachedPa : null;
  if (cached) {
    dbg('[generatePaAsync] Using cached PA');
    return cached;
  }
  const localPa = generatePa();
  if (localPa) {
    _cachedPa = localPa;
    _cachedPaAt = Date.now();
    dbg('[generatePaAsync] Native PA generated successfully');
    return localPa;
  }
  dbg('[generatePaAsync] Native PA unavailable, trying WebView...');
  dbg(
    '[generatePaAsync] ERROR-LEVEL: isWebViewSignerReady:',
    isWebViewSignerReady(),
    'getWebViewSignerError:',
    getWebViewSignerError(),
  );
  try {
    const webviewPa = await generatePaViaWebView(10000);
    if (webviewPa) {
      _cachedPa = webviewPa;
      _cachedPaAt = Date.now();
      dbg('[generatePaAsync] WebView PA generated successfully');
    } else {
      dbg('[generatePaAsync] WebView PA returned null');
    }
    return webviewPa;
  } catch (e: any) {
    _lastError = e?.message || String(e);
    logPaFailure(_lastError);
    return null;
  }
}

export { WebViewSigner, WebViewSignerHost } from './webviewSigner';
