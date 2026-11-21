type JsonValue = any;

export function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs = 10000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const ext = options.signal;
  const onExtAbort = () => controller.abort();
  if (ext) {
    if (ext.aborted) controller.abort();
    else ext.addEventListener('abort', onExtAbort, { once: true });
  }
  const cleanup = () => {
    clearTimeout(timer);
    if (ext) ext.removeEventListener('abort', onExtAbort);
  };
  return fetch(url, { ...options, signal: controller.signal })
    .then((res) => {
      const bodyMethods = new Set(['text', 'json', 'arrayBuffer', 'blob', 'formData']);
      return new Proxy(res, {
        get(target, prop) {
          const value = Reflect.get(target, prop, target);
          if (typeof prop === 'string' && bodyMethods.has(prop)) {
            return async (...args: unknown[]) => {
              try {
                return await (value as (...a: unknown[]) => Promise<unknown>).apply(target, args);
              } finally {
                cleanup();
              }
            };
          }

          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    })
    .catch((error) => {
      cleanup();
      throw error;
    });
}

interface RequestOptions {
  method?: 'GET' | 'POST';
  body?: any;

  bodyType?: 'json' | 'raw';
  headers?: Record<string, string>;

  timeout?: number;

  cacheTtl?: number;

  signal?: AbortSignal;
}

function parseResponse(text: string): JsonValue {
  if (!text) return null;
  const fixed = text.replace(/:\s*([0-9]{15,})\s*([,}\]])/g, ':"$1"$2');
  try {
    return JSON.parse(fixed);
  } catch {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
}

const inflight = new Map<string, Promise<any>>();
const responseCache = new Map<string, { ts: number; data: JsonValue }>();

const CACHE_MAX = 200;
function trimCache(map: Map<string, any>) {
  while (map.size > CACHE_MAX) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}

function requestJson<T>(url: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method || 'GET';
  const cacheTtl = options.cacheTtl ?? 0;

  const shareable = method === 'GET' && !options.headers;
  const key = shareable ? `GET ${url}` : '';

  if (shareable && cacheTtl > 0) {
    const hit = responseCache.get(key);
    if (hit && Date.now() - hit.ts < cacheTtl) {
      return Promise.resolve(hit.data as T);
    }
  }

  if (shareable && !options.signal && inflight.has(key)) {
    return inflight.get(key) as Promise<T>;
  }

  const promise = (async (): Promise<T> => {
    const controller = new AbortController();
    const timeout = options.timeout ?? (method === 'GET' ? 10000 : 15000);
    const timer = setTimeout(() => controller.abort(), timeout);

    let extAbort: (() => void) | null = null;
    if (options.signal) {
      if (options.signal.aborted) controller.abort();
      else {
        extAbort = () => controller.abort();
        options.signal.addEventListener('abort', extAbort, { once: true });
      }
    }

    try {
      const headers: Record<string, string> = {
        Accept: 'application/json, text/plain, */*',
        ...(method === 'POST' ? { 'Content-Type': 'application/json;charset=utf-8' } : {}),
        ...(options.headers || {}),
      };

      const res = await fetch(url, {
        method,
        headers,
        body:
          method === 'POST'
            ? options.bodyType === 'raw'
              ? String(options.body ?? '')
              : JSON.stringify(options.body ?? {})
            : undefined,

        signal: controller.signal,
      });

      const text = await res.text();
      const body = parseResponse(text);

      if (res.status >= 200 && res.status < 300) {
        if (shareable && cacheTtl > 0) {
          responseCache.set(key, { ts: Date.now(), data: body });
          trimCache(responseCache);
        }
        return body as T;
      }

      const message =
        (body && typeof body === 'object' && (body.message || body.msg || body.error)) ||
        (typeof body === 'string' && body.trim() ? body.trim().slice(0, 180) : '') ||
        `HTTP ${res.status}`;
      throw new Error(message);
    } catch (error: any) {
      clearTimeout(timer);
      if (error?.name === 'AbortError') {
        if (options.signal?.aborted) throw new Error('请求已取消');
        throw new Error('网络请求超时');
      }

      if (error instanceof TypeError) {
        throw new Error('网络请求失败');
      }
      throw error;
    } finally {
      clearTimeout(timer);
      if (extAbort && options.signal) options.signal.removeEventListener('abort', extAbort);
      if (shareable) inflight.delete(key);
    }
  })();

  if (shareable && !options.signal) {
    inflight.set(key, promise);
    trimCache(inflight);
  }
  return promise;
}

function fetchJson<T>(url: string, cacheTtl = 0): Promise<T> {
  return requestJson<T>(url, { method: 'GET', timeout: 10000, cacheTtl });
}

function xhrPost(
  url: string,
  data: any,
  headers: Record<string, string>,
  timeout = 15000,
): Promise<any> {
  return requestJson(url, {
    method: 'POST',
    body: data,
    headers,
    timeout,
  });
}

export { requestJson, fetchJson, xhrPost };
