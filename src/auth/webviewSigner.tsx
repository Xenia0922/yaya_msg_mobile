import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { WebView } from 'react-native-webview';
import wasmGlueSource from './wasmGlueSource';
import wasmBase64 from './wasmBase64';
import { wasmBase64MatchesPin } from './wasmHash';

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
  if (signerRequest) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      mountWaiters = mountWaiters.filter((item) => item !== done);
      resolve(false);
    }, timeoutMs);
    const done = (ready: boolean) => {
      clearTimeout(timer);
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
  if (!signerRequest) {
    const mounted = await waitForMount(timeoutMs);
    if (!mounted || !signerRequest) {
      signerError = signerError || 'WebView 签名容器尚未挂载';
      return null;
    }
  }
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
      resolve(false);
    }, timeoutMs);
    const done = (ready: boolean) => {
      clearTimeout(timer);
      resolve(ready);
    };
    readyWaiters.push(done);
  });
}

function makeHtml(wasmBase64: string) {
  // 不再对 glue 做字符串手术（import.meta / module.require 正则替换在 wasm-bindgen 升级时易失效）。
  // 改为在脚本顶部注入 module / import 垫片，让未修改的 glue 在 WebView（无模块系统）中直接运行。
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

  useEffect(() => {
    signerError = '';
    signerRequest = async (timeoutMs = 10000) => {
      const ready = await waitForReady(timeoutMs);
      if (!ready) {
        signerError = signerError || 'WebView 签名初始化超时';
        return null;
      }
      return new Promise((resolve, reject) => {
      if (!webRef.current) {
        resolve(null);
        return;
      }
      const id = String(seq.current++);
      const timer = setTimeout(() => {
        delete pending.current[id];
        reject(new Error('签名生成超时'));
      }, timeoutMs);
      pending.current[id] = { resolve, reject, timer };
      webRef.current.postMessage(JSON.stringify({ type: 'pa', id }));
      });
    };
    notifyMount(true);
    return () => {
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

  const html = useMemo(() => {
    // 双份 wasm 漂移检测：内联副本必须与 assets/2.wasm 哈希一致，否则 WebView 兜底会算出
    // 与原生通道不同的 pa，导致偶发签名失败。不一致仅告警（内联副本本身是 APK 签名产物，可信），
    // 由 scripts/gen-wasm-base64.mjs 重新生成即可对齐。
    if (!wasmBase64MatchesPin(wasmBase64)) {
      console.warn('[wasm] 内联 wasmBase64 与 assets/2.wasm 哈希不一致，疑似双份漂移；请运行 node scripts/gen-wasm-base64.mjs 重新生成');
    }
    return makeHtml(wasmBase64);
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
        source={{ html }}
        javaScriptEnabled
        mixedContentMode="always"
        domStorageEnabled
        onMessage={(event) => {
          let payload: any;
          try { payload = JSON.parse(event.nativeEvent.data); } catch { return; }
          if (payload.type === 'ready') {
            signerReady = true;
            signerError = '';
            notifyReady(true);
            return;
          }
          if (payload.type === 'error') {
            signerReady = false;
            signerError = payload.error || 'WebView 签名模块异常';
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
