import { Asset } from 'expo-asset';
import { generatePaViaWebView, getWebViewSignerError, isWebViewSignerReady } from './webviewSigner';
import { verifyWasm } from './wasmHash';

let WASM_READY = false;
let _paGen: (() => string | null) | null = null;
let _lastError = '';

export function getWasmError(): string { return isWebViewSignerReady() ? '' : (_lastError || getWebViewSignerError()); }
export function isWasmReady(): boolean { return (WASM_READY && _paGen !== null) || isWebViewSignerReady(); }

let _initPromise: Promise<void> | null = null;

export function initWasm(): Promise<void> {
  if (WASM_READY) return Promise.resolve();
  if (_initPromise) return _initPromise;
  _initPromise = (async () => {
    try {
      if (typeof WebAssembly === 'undefined') {
        throw new Error('当前手机环境不支持 WebAssembly');
      }
      const m = require('./wasm');
      const initFn = m.default || m;
      const paFn = m.__x6c2adf8__;
      if (!initFn || !paFn) throw new Error('WASM 加载器异常');

      const buf = await fetchWasm();
      await initFn(buf);
      _paGen = paFn;
      WASM_READY = true;
    } catch (e: any) {
      _lastError = e?.message || String(e);
      // 失败不置 WASM_READY：原生通道可重试（下次调用重跑），generatePaAsync 仍会兜底 WebView。
    } finally {
      _initPromise = null;
    }
  })();
  return _initPromise;
}

async function fetchWasm(): Promise<ArrayBuffer> {
  // 1) 本地打包资源（APK 内置，来源可信，直接执行）
  try {
    const [asset] = await Asset.loadAsync(require('../../assets/2.wasm'));
    const uri = asset.localUri || asset.uri;
    if (uri) {
      const resp = await fetch(uri);
      if (resp.ok) return await resp.arrayBuffer();
    }
  } catch (e: any) {
    _lastError = e.message || String(e);
  }

  // 2) 代理下载（不可信，必须哈希校验，防供应链投毒：任一代理被篡改即拒绝执行）
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
  const localPa = generatePa();
  if (localPa) return localPa;
  try {
    return await generatePaViaWebView(6000);
  } catch (e: any) {
    _lastError = e?.message || String(e);
    return null;
  }
}

export { WebViewSigner } from './webviewSigner';
