import { Asset } from 'expo-asset';
import { generatePaViaWebView, getWebViewSignerError, isWebViewSignerReady } from './webviewSigner';

let WASM_READY = false;
let _paGen: (() => string | null) | null = null;
let _lastError = '';

export function getWasmError(): string { return isWebViewSignerReady() ? '' : (_lastError || getWebViewSignerError()); }
export function isWasmReady(): boolean { return (WASM_READY && _paGen !== null) || isWebViewSignerReady(); }

export async function initWasm(): Promise<void> {
  if (WASM_READY) return;
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
  } catch (e: any) {
    _lastError = e.message || String(e);
  }
  WASM_READY = true;
}

async function fetchWasm(): Promise<ArrayBuffer> {
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
      if (resp.ok) return await resp.arrayBuffer();
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
    return await generatePaViaWebView(10000);
  } catch (e: any) {
    _lastError = e?.message || String(e);
    return null;
  }
}

export { WebViewSigner } from './webviewSigner';
