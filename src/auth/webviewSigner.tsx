import React, { useEffect, useRef, useState } from 'react';
import { AppState, View } from 'react-native';
import { WebView } from 'react-native-webview';
import wasmBase64 from './wasmBase64';
import wasmGlueSource from './wasmGlueSource';
import { wasmBase64MatchesPin } from './wasmHash';

// 调试日志：dev 输出，release 编译期消除（__DEV__ 折叠），杜绝 Hermes 环境下 console.debug 的兼容风险
const dbg = __DEV__ ? (console.debug || console.log).bind(console) : () => {};

const DEFAULT_TIMEOUT = 10000;
// 后台/息屏时系统会冻结 WebView 渲染进程（Android Freezer），签名请求在此期间不可能有回包。
// 这段空转不计入超时，改为等回到前台继续，避免「一批请求同时超时、日志刷屏、恢复后依旧不可用」。
const BACKGROUND_WAIT_MS = 60000;
// 判定签名容器失活后的重建等待上限（重建 WebView + 重新编译 wasm）
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
// 单飞：同一时刻只向 WebView 发一条 pa 请求，并发调用共享同一次签名结果。
// pa 由 wasm 在无参调用下生成（只可能依赖时间/设备信息，不可能依赖具体请求），复用安全。
let inflight: Promise<string | null> | null = null;
let pending: Record<string, PendingRequest> = {};
let seq = 1;
// WebView 重建触发器（由组件注册）
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
    let timer: ReturnType<typeof setTimeout>;
    const done = (active: boolean) => {
      clearTimeout(timer);
      activeWaiters = activeWaiters.filter((item) => item !== done);
      resolve(active);
    };
    timer = setTimeout(() => done(false), timeoutMs);
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
    let timer: ReturnType<typeof setTimeout>;
    const done = (ready: boolean) => {
      clearTimeout(timer);
      mountWaiters = mountWaiters.filter((item) => item !== done);
      dbg('[waitForMount] Resolved:', ready);
      resolve(ready);
    };
    timer = setTimeout(() => {
      mountWaiters = mountWaiters.filter((item) => item !== done);
      console.error('[waitForMount] Timeout');
      resolve(false);
    }, timeoutMs);
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
    let timer: ReturnType<typeof setTimeout>;
    const done = (ready: boolean) => {
      clearTimeout(timer);
      readyWaiters = readyWaiters.filter((item) => item !== done);
      dbg('[waitForReady] Resolved:', ready);
      resolve(ready);
    };
    timer = setTimeout(() => {
      readyWaiters = readyWaiters.filter((item) => item !== done);
      console.error('[waitForReady] Timeout');
      resolve(false);
    }, timeoutMs);
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

// 重建签名容器：清掉「已就绪」标记（否则后续调用会继续往已经死掉的 WebView 发消息，
// 每次都白等一个超时），并让组件换 key 重挂载 WebView。
let lastResetAt = 0;
export function resetWebViewSigner(reason: string) {
  dbg('[signer] reset:', reason);
  signerReady = false;
  signerError = '';
  rejectPending(reason || '签名容器重建中');
  // 渲染进程崩溃触发的 reject 会再走一遍重建，800ms 内合并成一次，避免连续重挂载
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
    const mounted = await waitForMount(timeoutMs);
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
    // 后台冻结期不发起：等回到前台再算，避免一次超时把签名器误判成失活
    if (!appActive) {
      const back = await waitForAppActive(BACKGROUND_WAIT_MS);
      dbg('[generatePaViaWebView] waited for app active:', back);
    }

    const reviveAndRetry = async (reason: string) => {
      // 永久性失败（wasm 完整性校验挂了 / 容器已卸载）重建也没用，直接放弃
      if (!remount || !signerRequest || reason.includes('完整性校验')) return null;
      resetWebViewSigner(reason);
      const revived = await waitForReady(REVIVE_TIMEOUT_MS);
      dbg('[generatePaViaWebView] revive result:', revived);
      if (!revived) return null;
      return await attemptPa(timeoutMs);
    };

    try {
      const pa = await attemptPa(timeoutMs);
      if (pa) return pa;
      // 初始化超时等可恢复失败也要重建一次：旧实现把 signerError 一直留着，
      // 之后每次 waitForReady 都立刻判失败，到杀进程为止都签不出名
      return signerError ? await reviveAndRetry(signerError) : null;
    } catch (e: any) {
      // 超时 / 渲染进程被回收：容器已不可用，重建后重试一次（旧实现只报错不恢复，
      // 一次超时之后整个会话的所有请求都会继续打到一个死掉的 WebView 上）
      dbg('[generatePaViaWebView] first attempt failed:', e?.message);
      return await reviveAndRetry(e?.message || '签名生成失败');
    }
  })();

  inflight = run;
  // 无论成功失败都要放开单飞锁，否则后续请求会一直挂在失败结果上
  run.finally(() => {
    if (inflight === run) inflight = null;
  }).catch(() => {});
  return run;
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
  const [html, setHtml] = useState<string>('');
  // 换 key 即重挂载 WebView：渲染进程被回收 / 签名请求超时后靠它把签名通道救回来
  const [generation, setGeneration] = useState(0);
  const htmlRef = useRef<string>('');

  useEffect(() => {
    let mounted = true;
    bindAppState();
    signerError = '';

    remount = () => {
      if (!mounted) return;
      signerReady = false;
      signerError = '';
      setGeneration((value) => value + 1);
    };

    dbg('[WebViewSigner] Effect mounted, starting wasm injection');

    // 使用构建期内联的 wasm base64，避免运行时 Asset.loadAsync 在 release 包中失效
    // wasmBase64.ts 由 scripts/gen-wasm-base64.mjs 从同一份 assets/2.wasm 生成，确保字节一致
    (async () => {
      try {
        dbg('[WebViewSigner] Verifying wasmBase64 hash...');
        // 完整性校验（与原生通道相同的哈希）
        if (!wasmBase64MatchesPin(wasmBase64)) {
          throw new Error('内联 wasmBase64 完整性校验失败');
        }
        dbg('[WebViewSigner] Hash verified, setting HTML...');
        const built = makeHtml(wasmBase64);
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

    signerRequest = async (timeoutMs = DEFAULT_TIMEOUT) => {
      dbg('[WebViewSigner] signerRequest called, html:', !!htmlRef.current, 'webRef:', !!webRef.current);
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
          timer: (null as unknown) as ReturnType<typeof setTimeout>,
        };
        // 后台冻结时不计时：重排一次，等回前台再算超时
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
    notifyMount(true);
    return () => {
      mounted = false;
      signerRequest = null;
      remount = null;
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
        onLoadEnd={(e) => dbg('[WebViewSigner] WebView onLoadEnd, canGoBack:', e.nativeEvent.canGoBack, 'loading:', e.nativeEvent.loading, 'url:', e.nativeEvent.url, 'title:', e.nativeEvent.title)}
        onError={(e) => console.error('[WebViewSigner] WebView onError:', e.nativeEvent)}
        onRenderProcessGone={() => {
          // 系统回收渲染进程后原 WebView 已不可用，重建才能继续签名
          console.error('[WebViewSigner] 渲染进程已被系统回收，重建签名容器');
          resetWebViewSigner('渲染进程已被系统回收');
        }}
        onMessage={(event) => {
          let payload: any;
          try { payload = JSON.parse(event.nativeEvent.data); } catch { return; }
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
