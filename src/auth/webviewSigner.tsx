import React, { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { WebView } from 'react-native-webview';
import wasmBase64 from './wasmBase64';
import wasmGlueSource from './wasmGlueSource';
import { verifyWasm, wasmBase64MatchesPin } from './wasmHash';

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b1 = bytes[i];
    const b2 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b3 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += B64[b1 >> 2];
    out += B64[((b1 & 3) << 4) | (b2 >> 4)];
    out += i + 1 < bytes.length ? B64[((b2 & 15) << 2) | (b3 >> 6)] : '=';
    out += i + 2 < bytes.length ? B64[b3 & 63] : '=';
  }
  return out;
}

type PendingRequest = {
  resolve: (value: string | null) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

let signerReady = false;
let signerError = '';
let signerRequest: ((timeoutMs?: number) => Promise<string | null>) | null = null;
let readyWaiters: Array<(ready: boolean) => void> = [];
let mountWaiters: Array<(ready: boolean) => void> = [];

function notifyMount(ready: boolean) {
  const waiters = mountWaiters;
  mountWaiters = [];
  waiters.forEach((resolve) => resolve(ready));
}
function waitForMount(timeoutMs: number): Promise<boolean> {
  console.error('[waitForMount] Called, signerRequest:', !!signerRequest);
  if (signerRequest) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      mountWaiters = mountWaiters.filter((item) => item !== done);
      console.error('[waitForMount] Timeout');
      resolve(false);
    }, timeoutMs);
    const done = (ready: boolean) => {
      clearTimeout(timer);
      console.error('[waitForMount] Resolved:', ready);
      resolve(ready);
    };
    mountWaiters.push(done);
  });
}

export function isWebViewSignerReady(): boolean {
  return signerReady;
}

export function getWebViewSignerError(): string {
  return signerError;
}

export async function generatePaViaWebView(timeoutMs = 10000): Promise<string | null> {
  console.error('[generatePaViaWebView] Called, signerRequest:', !!signerRequest, 'signerReady:', signerReady);
  if (!signerRequest) {
    const mounted = await waitForMount(timeoutMs);
    console.error('[generatePaViaWebView] waitForMount result:', mounted);
    if (!mounted || !signerRequest) {
      signerError = signerError || 'WebView 签名容器尚未挂载';
      console.error('[generatePaViaWebView] WebView not mounted, error:', signerError);
      return null;
    }
  }
  console.error('[generatePaViaWebView] Calling signerRequest...');
  return signerRequest(timeoutMs);
}

function notifyReady(ready: boolean) {
  const waiters = readyWaiters;
  readyWaiters = [];
  waiters.forEach((resolve) => resolve(ready));
}

function waitForReady(timeoutMs: number): Promise<boolean> {
  if (signerReady) return Promise.resolve(true);
  if (signerError) return Promise.resolve(false);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      readyWaiters = readyWaiters.filter((item) => item !== done);
      console.error('[waitForReady] Timeout');
      resolve(false);
    }, timeoutMs);
    const done = (ready: boolean) => {
      clearTimeout(timer);
      console.error('[waitForReady] Resolved:', ready);
      resolve(ready);
    };
    readyWaiters.push(done);
  });
}

function makeHtml(wasmBase64: string) {
  const shim = `var module = (typeof module !== 'undefined') ? module : {};
module.require = function() { return undefined; };`;

  return `<!doctype html>
<html>
<head><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body>
<script>
window.onerror = function(message) {
  window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'error', error: String(message) }));
};
${shim}
${wasmGlueSource}
function bytesFromBase64(base64) {
  var binary = atob(base64);
  var len = binary.length;
  var bytes = new Uint8Array(len);
  for (var i = 0; i < len; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
function send(payload) {
  window.ReactNativeWebView.postMessage(JSON.stringify(payload));
}
function handleMessage(event) {
  var payload;
  try { payload = JSON.parse(event.data); } catch (e) { return; }
  if (!payload || payload.type !== 'pa') return;
  try {
    send({ type: 'pa', id: payload.id, value: __x6c2adf8__() });
  } catch (e) {
    send({ type: 'pa', id: payload.id, error: e && e.message ? e.message : String(e) });
  }
}
document.addEventListener('message', handleMessage);
window.addEventListener('message', handleMessage);
__wbg_init(bytesFromBase64(${JSON.stringify(wasmBase64)}))
  .then(function() { send({ type: 'ready' }); })
  .catch(function(e) { send({ type: 'error', error: e && e.message ? e.message : String(e) }); });
</script>
</body>
</html>`;
}

export function WebViewSigner() {
  const webRef = useRef<WebView>(null);
  const pending = useRef<Record<string, PendingRequest>>({});
  const seq = useRef(1);
  const [html, setHtml] = useState<string>('');
  const htmlRef = useRef<string>('');

  useEffect(() => {
    let mounted = true;
    signerError = '';

    console.error('[WebViewSigner] Effect mounted, starting wasm injection');

    // 使用构建期内联的 wasm base64，避免运行时 Asset.loadAsync 在 release 包中失效
    // wasmBase64.ts 由 scripts/gen-wasm-base64.mjs 从同一份 assets/2.wasm 生成，确保字节一致
    (async () => {
      try {
        console.error('[WebViewSigner] Verifying wasmBase64 hash...');
        // 完整性校验（与原生通道相同的哈希）
        if (!wasmBase64MatchesPin(wasmBase64)) {
          throw new Error('内联 wasmBase64 完整性校验失败');
        }
        console.error('[WebViewSigner] Hash verified, setting HTML...');
        const built = makeHtml(wasmBase64);
        htmlRef.current = built;
        if (mounted) {
          setHtml(built);
          console.error('[WebViewSigner] HTML set, waiting for WebView ready...');
        }
      } catch (e: any) {
        if (mounted) {
          signerError = e?.message || String(e);
          console.error('[WebViewSigner] wasm base64 校验失败:', signerError);
        }
      }
    })();

    signerRequest = async (timeoutMs = 10000) => {
      console.error('[WebViewSigner] signerRequest called, html:', !!htmlRef.current, 'webRef:', !!webRef.current);
      if (!htmlRef.current) {
        // 等待 wasm 注入完成
        let waited = 0;
        while (!htmlRef.current && waited < timeoutMs) {
          await new Promise(r => setTimeout(r, 50));
          waited += 50;
        }
        if (!htmlRef.current) {
          signerError = signerError || 'WebView wasm 注入超时';
          console.error('[WebViewSigner] wasm注入超时');
          return null;
        }
      }
      console.error('[WebViewSigner] Waiting for WebView ready...');
      const ready = await waitForReady(timeoutMs);
      if (!ready) {
        signerError = signerError || 'WebView 签名初始化超时';
        console.error('[WebViewSigner] WebView初始化超时');
        return null;
      }
      console.error('[WebViewSigner] WebView ready, requesting PA...');
      return new Promise((resolve, reject) => {
        if (!webRef.current) {
          console.error('[WebViewSigner] webRef.current is null!');
          resolve(null);
          return;
        }
        const id = String(seq.current++);
        const timer = setTimeout(() => {
          delete pending.current[id];
          reject(new Error('签名生成超时'));
        }, timeoutMs);
        pending.current[id] = { resolve, reject, timer };
        console.error('[WebViewSigner] Sending PA request to WebView, id:', id);
        webRef.current.postMessage(JSON.stringify({ type: 'pa', id }));
      });
    };
    notifyMount(true);
    return () => {
      mounted = false;
      signerRequest = null;
      signerReady = false;
      signerError = 'WebView 签名容器已卸载';
      notifyReady(false);
      notifyMount(false);
      Object.values(pending.current).forEach((item) => {
        clearTimeout(item.timer);
        item.resolve(null);
      });
      pending.current = {};
    };
  }, []);

  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: 0,
        bottom: 0,
        width: 1,
        height: 1,
        opacity: 0.01,
      }}
    >
      <WebView
        ref={webRef}
        originWhitelist={['*']}
        source={html ? { html } : { html: loadingHtml }}
        javaScriptEnabled
        domStorageEnabled
        onLoad={() => console.error('[WebViewSigner] ERROR-LEVEL: WebView onLoad fired')}
        onLoadEnd={(e) => console.error('[WebViewSigner] ERROR-LEVEL: WebView onLoadEnd, canGoBack:', e.nativeEvent.canGoBack, 'loading:', e.nativeEvent.loading, 'url:', e.nativeEvent.url, 'title:', e.nativeEvent.title)}
        onError={(e) => console.error('[WebViewSigner] ERROR-LEVEL: WebView onError:', e.nativeEvent)}
        onMessage={(event) => {
          let payload: any;
          try { payload = JSON.parse(event.nativeEvent.data); } catch { return; }
          if (payload.type === 'ready') {
            signerReady = true;
            signerError = '';
            notifyReady(true);
            console.error('[WebViewSigner] ERROR-LEVEL: Received ready message');
            return;
          }
          if (payload.type === 'error') {
            signerReady = false;
            signerError = payload.error || 'WebView 签名模块异常';
            console.error('[WebViewSigner] ERROR-LEVEL: Received error:', signerError);
            Object.values(pending.current).forEach((item) => {
              clearTimeout(item.timer);
              item.reject(new Error(signerError));
            });
            pending.current = {};
            notifyReady(false);
            return;
          }
          if (payload.type === 'pa' && payload.id) {
            const item = pending.current[payload.id];
            if (!item) return;
            clearTimeout(item.timer);
            delete pending.current[payload.id];
            if (payload.error) item.reject(new Error(payload.error));
            else item.resolve(payload.value || null);
          }
        }}
      />
    </View>
  );
}

// 启动加载页 HTML（仅显示空白，等待 wasm base64 注入）
const loadingHtml = `<!doctype html>
<html>
<head><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body><script>
window.onerror = function(message) {
  window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'error', error: String(message) }));
};
var module = (typeof module !== 'undefined') ? module : {};
module.require = function() { return undefined; };
</script></body>
</html>`;