import React, { useEffect, useRef, useState } from 'react';
import { AppState, View } from 'react-native';
import { WebView } from 'react-native-webview';
import wasmBase64 from './wasmBase64';
import wasmGlueSource from './wasmGlueSource';
import { wasmBase64MatchesPin } from './wasmHash';

const dbg = __DEV__ ? (console.debug || console.log).bind(console) : () => {};

const DEFAULT_TIMEOUT = 10000;

const BACKGROUND_WAIT_MS = 60000;

const REVIVE_TIMEOUT_MS = 8000;

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

let inflight: Promise<string | null> | null = null;
let pending: Record<string, PendingRequest> = {};
let seq = 1;

let remount: (() => void) | null = null;

let appActive = AppState.currentState !== 'background' && AppState.currentState !== 'inactive';
let activeWaiters: Array<(active: boolean) => void> = [];
let appStateBound = false;

function bindAppState() {
  if (appStateBound) return;
  appStateBound = true;
  AppState.addEventListener('change', (state) => {
    const next = state === 'active';
    if (next === appActive) return;
    appActive = next;
    dbg('[signer] AppState ->', state, 'active:', appActive);
    if (next) {
      const waiters = activeWaiters;
      activeWaiters = [];
      waiters.forEach((resolve) => resolve(true));
    }
  });
}

function waitForAppActive(timeoutMs: number): Promise<boolean> {
  if (appActive) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => done(false), timeoutMs);
    const done = (active: boolean) => {
      clearTimeout(timer);
      activeWaiters = activeWaiters.filter((item) => item !== done);
      resolve(active);
    };
    activeWaiters.push(done);
  });
}

function notifyMount(ready: boolean) {
  const waiters = mountWaiters;
  mountWaiters = [];
  waiters.forEach((resolve) => resolve(ready));
}
function waitForMount(timeoutMs: number): Promise<boolean> {
  dbg('[waitForMount] Called, signerRequest:', !!signerRequest);
  if (signerRequest) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      mountWaiters = mountWaiters.filter((item) => item !== done);
      console.error('[waitForMount] Timeout');
      resolve(false);
    }, timeoutMs);
    const done = (ready: boolean) => {
      clearTimeout(timer);
      mountWaiters = mountWaiters.filter((item) => item !== done);
      dbg('[waitForMount] Resolved:', ready);
      resolve(ready);
    };
    mountWaiters.push(done);
  });
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
      readyWaiters = readyWaiters.filter((item) => item !== done);
      dbg('[waitForReady] Resolved:', ready);
      resolve(ready);
    };
    readyWaiters.push(done);
  });
}

function rejectPending(reason: string) {
  const items = pending;
  pending = {};
  Object.values(items).forEach((item) => {
    clearTimeout(item.timer);
    item.reject(new Error(reason));
  });
}

let lastResetAt = 0;
let hostRemount: (() => void) | null = null;
let lastHostRemountAt = 0;
export function registerSignerHost(fn: (() => void) | null) {
  hostRemount = fn;
  if (fn) lastHostRemountAt = 0;
}

function requestHostRemount(): boolean {
  if (!hostRemount) return false;
  const now = Date.now();
  if (now - lastHostRemountAt < 3000) return false;
  lastHostRemountAt = now;
  hostRemount();
  return true;
}
export function resetWebViewSigner(reason: string) {
  dbg('[signer] reset:', reason);
  signerReady = false;
  signerError = '';
  rejectPending(reason || '签名容器重建中');

  const now = Date.now();
  if (now - lastResetAt < 800) return;
  lastResetAt = now;
  if (remount) remount();
}

export function isWebViewSignerReady(): boolean {
  return signerReady;
}

export function getWebViewSignerError(): string {
  return signerError;
}

async function attemptPa(timeoutMs: number): Promise<string | null> {
  if (!signerRequest) {
    const requested = requestHostRemount();
    const mounted = await waitForMount(requested ? Math.min(timeoutMs, 3000) : timeoutMs);
    dbg('[generatePaViaWebView] waitForMount result:', mounted);
    if (!mounted || !signerRequest) {
      signerError = signerError || 'WebView 签名容器尚未挂载';
      console.error('[generatePaViaWebView] WebView not mounted, error:', signerError);
      return null;
    }
  }
  return signerRequest(timeoutMs);
}

export async function generatePaViaWebView(timeoutMs = DEFAULT_TIMEOUT): Promise<string | null> {
  if (inflight) return inflight;
  bindAppState();

  const run = (async () => {
    if (!appActive) {
      const back = await waitForAppActive(BACKGROUND_WAIT_MS);
      dbg('[generatePaViaWebView] waited for app active:', back);
    }

    const reviveAndRetry = async (reason: string) => {
      if (reason.includes('完整性校验')) return null;
      if (!signerRequest) {
        if (!requestHostRemount()) return null;
        const mounted = await waitForMount(3000);
        if (!mounted || !signerRequest) return null;
      }
      if (!remount) return null;
      resetWebViewSigner(reason);
      const revived = await waitForReady(REVIVE_TIMEOUT_MS);
      dbg('[generatePaViaWebView] revive result:', revived);
      if (!revived) return null;
      return await attemptPa(timeoutMs);
    };

    try {
      const pa = await attemptPa(timeoutMs);
      if (pa) return pa;

      return signerError ? await reviveAndRetry(signerError) : null;
    } catch (e: any) {
      dbg('[generatePaViaWebView] first attempt failed:', e?.message);
      return await reviveAndRetry(e?.message || '签名生成失败');
    }
  })();

  inflight = run;

  run
    .finally(() => {
      if (inflight === run) inflight = null;
    })
    .catch(() => {});
  return run;
}

function makeHtml(wasmBase64: string, instanceId: string | number) {
  const shim = `var module = (typeof module !== 'undefined') ? module : {};
module.require = function() { return undefined; };`;

  return `<!doctype html>
<html>
<head><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body>
<script>
var INSTANCE_ID = ${JSON.stringify(String(instanceId))};
window.onerror = function(message) {
  window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'error', instance: INSTANCE_ID, error: String(message) }));
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
  payload.instance = INSTANCE_ID;
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

let signerInstanceCounter = 0;

export function WebViewSigner() {
  const webRef = useRef<WebView>(null);
  const [html, setHtml] = useState<string>('');

  const [generation, setGeneration] = useState(0);
  const htmlRef = useRef<string>('');

  const verifiedRef = useRef(false);

  const [instanceId, setInstanceId] = useState(() => `signer-${++signerInstanceCounter}`);
  const instanceIdRef = useRef(instanceId);

  useEffect(() => {
    let mounted = true;
    bindAppState();
    signerError = '';

    const myRemount = () => {
      if (!mounted) return;
      signerReady = false;
      signerError = '';

      const nextInstanceId = `signer-${++signerInstanceCounter}`;
      setInstanceId(nextInstanceId);
      if (verifiedRef.current) {
        const built = makeHtml(wasmBase64, nextInstanceId);
        htmlRef.current = built;
        setHtml(built);
      }
      setGeneration((value) => value + 1);
    };
    remount = myRemount;

    dbg('[WebViewSigner] Effect mounted, starting wasm injection');

    (async () => {
      try {
        dbg('[WebViewSigner] Verifying wasmBase64 hash...');

        if (!wasmBase64MatchesPin(wasmBase64)) {
          throw new Error('内联 wasmBase64 完整性校验失败');
        }
        dbg('[WebViewSigner] Hash verified, setting HTML...');
        verifiedRef.current = true;
        const built = makeHtml(wasmBase64, instanceIdRef.current);
        htmlRef.current = built;
        if (mounted) {
          setHtml(built);
          dbg('[WebViewSigner] HTML set, waiting for WebView ready...');
        }
      } catch (e: any) {
        if (mounted) {
          signerError = e?.message || String(e);
          console.error('[WebViewSigner] wasm base64 校验失败:', signerError);
        }
      }
    })();

    const myRequest = async (timeoutMs = DEFAULT_TIMEOUT) => {
      dbg(
        '[WebViewSigner] signerRequest called, html:',
        !!htmlRef.current,
        'webRef:',
        !!webRef.current,
      );
      if (!htmlRef.current) {
        let waited = 0;
        while (!htmlRef.current && waited < timeoutMs) {
          await new Promise((r) => setTimeout(r, 50));
          waited += 50;
        }
        if (!htmlRef.current) {
          signerError = signerError || 'WebView wasm 注入超时';
          console.error('[WebViewSigner] wasm注入超时');
          return null;
        }
      }
      if (!appActive) await waitForAppActive(BACKGROUND_WAIT_MS);
      dbg('[WebViewSigner] Waiting for WebView ready...');
      const ready = await waitForReady(timeoutMs);
      if (!ready) {
        signerError = signerError || 'WebView 签名初始化超时';
        console.error('[WebViewSigner] WebView初始化超时');
        return null;
      }
      dbg('[WebViewSigner] WebView ready, requesting PA...');
      return new Promise<string | null>((resolve, reject) => {
        if (!webRef.current) {
          console.error('[WebViewSigner] webRef.current is null!');
          resolve(null);
          return;
        }
        const id = String(seq++);
        const item: PendingRequest = {
          resolve,
          reject,
          timer: null as unknown as ReturnType<typeof setTimeout>,
        };

        const arm = (ms: number) => {
          item.timer = setTimeout(() => {
            if (!appActive) {
              arm(ms);
              return;
            }
            if (pending[id] === item) delete pending[id];
            reject(new Error('签名生成超时'));
          }, ms);
        };
        pending[id] = item;
        arm(timeoutMs);
        dbg('[WebViewSigner] Sending PA request to WebView, id:', id);
        try {
          webRef.current.postMessage(JSON.stringify({ type: 'pa', id }));
        } catch (e: any) {
          if (pending[id] === item) delete pending[id];
          clearTimeout(item.timer);
          reject(new Error(e?.message || '向签名容器发送请求失败'));
        }
      });
    };
    signerRequest = myRequest;
    notifyMount(true);
    return () => {
      mounted = false;

      if (remount === myRemount) remount = null;
      if (signerRequest !== myRequest) return;
      signerRequest = null;
      signerReady = false;
      signerError = 'WebView 签名容器已卸载';
      notifyReady(false);
      notifyMount(false);
      Object.values(pending).forEach((item) => {
        clearTimeout(item.timer);
        item.resolve(null);
      });
      pending = {};
    };
  }, []);

  return (
    <View
      pointerEvents="none"
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
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
        key={generation}
        ref={webRef}
        originWhitelist={['*']}
        source={html ? { html } : { html: loadingHtml }}
        javaScriptEnabled
        domStorageEnabled
        onLoad={() => dbg('[WebViewSigner] WebView onLoad fired')}
        onLoadEnd={(e) =>
          dbg(
            '[WebViewSigner] WebView onLoadEnd, canGoBack:',
            e.nativeEvent.canGoBack,
            'loading:',
            e.nativeEvent.loading,
            'url:',
            e.nativeEvent.url,
            'title:',
            e.nativeEvent.title,
          )
        }
        onError={(e) => console.error('[WebViewSigner] WebView onError:', e.nativeEvent)}
        onRenderProcessGone={() => {
          console.error('[WebViewSigner] 渲染进程已被系统回收，重建签名容器');
          resetWebViewSigner('渲染进程已被系统回收');
        }}
        onMessage={(event) => {
          let payload: any;
          try {
            payload = JSON.parse(event.nativeEvent.data);
          } catch {
            return;
          }

          if (String(payload.instance || '') !== String(instanceId)) return;
          if (payload.type === 'ready') {
            signerReady = true;
            signerError = '';
            notifyReady(true);
            dbg('[WebViewSigner] Received ready message');
            return;
          }
          if (payload.type === 'error') {
            signerReady = false;
            signerError = payload.error || 'WebView 签名模块异常';
            console.error('[WebViewSigner] Received error:', signerError);
            Object.values(pending).forEach((item) => {
              clearTimeout(item.timer);
              item.reject(new Error(signerError));
            });
            pending = {};
            notifyReady(false);
            return;
          }
          if (payload.type === 'pa' && payload.id) {
            const item = pending[payload.id];
            if (!item) return;
            clearTimeout(item.timer);
            delete pending[payload.id];
            if (payload.error) item.reject(new Error(payload.error));
            else item.resolve(payload.value || null);
          }
        }}
      />
    </View>
  );
}

export function WebViewSignerHost() {
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    registerSignerHost(() => setGeneration((value) => value + 1));
    return () => registerSignerHost(null);
  }, []);
  return <WebViewSigner key={generation} />;
}

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
