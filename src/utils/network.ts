type JsonValue = any;

interface RequestOptions {
  method?: 'GET' | 'POST';
  body?: any;
  headers?: Record<string, string>;
  timeout?: number;
}

function parseResponse(text: string): JsonValue {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const fixed = text.replace(/:\s*([0-9]{15,})/g, ':"$1"');
    try {
      return JSON.parse(fixed);
    } catch {
      return text;
    }
  }
}

function requestJson<T>(url: string, options: RequestOptions = {}): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const method = options.method || 'GET';
    xhr.open(method, url, true);
    xhr.timeout = options.timeout ?? 15000;

    const headers = {
      Accept: 'application/json, text/plain, */*',
      ...(method === 'POST' ? { 'Content-Type': 'application/json;charset=utf-8' } : {}),
      ...(options.headers || {}),
    };

    Object.entries(headers).forEach(([key, value]) => {
      if (value === undefined || value === null) return;
      try {
        xhr.setRequestHeader(key, String(value));
      } catch {}
    });

    xhr.onload = () => {
      const body = parseResponse(xhr.responseText);
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(body as T);
        return;
      }
      const message = (
        (body && typeof body === 'object' && (body.message || body.msg || body.error))
        || (typeof body === 'string' && body.trim() ? body.trim().slice(0, 180) : '')
        || `HTTP ${xhr.status}`
      );
      reject(new Error(message));
    };
    xhr.onerror = () => reject(new Error('网络请求失败'));
    xhr.ontimeout = () => reject(new Error('网络请求超时'));

    try {
      xhr.send(method === 'POST' ? JSON.stringify(options.body ?? {}) : undefined);
    } catch (error: any) {
      reject(new Error(error?.message || String(error)));
    }
  });
}

function fetchJson<T>(url: string): Promise<T> {
  return requestJson<T>(url, { method: 'GET', timeout: 10000 });
}

async function fetchJsonStrict<T>(url: string): Promise<T> {
  const res = await fetchJson<any>(url);
  if (!res || typeof res === 'string') throw new Error('响应不是有效 JSON');
  return res as T;
}

function xhrPost(url: string, data: any, headers: Record<string, string>): Promise<any> {
  return requestJson(url, {
    method: 'POST',
    body: data,
    headers,
    timeout: 15000,
  });
}

function probeUrl(url: string, timeout = 8000): Promise<{ ok: boolean; status: number; message: string }> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.timeout = timeout;
    xhr.onload = () => {
      const ok = xhr.status >= 200 && xhr.status < 500;
      resolve({ ok, status: xhr.status, message: `HTTP ${xhr.status}` });
    };
    xhr.onerror = () => resolve({ ok: false, status: 0, message: '请求失败' });
    xhr.ontimeout = () => resolve({ ok: false, status: 0, message: '请求超时' });
    try {
      xhr.send();
    } catch (error: any) {
      resolve({ ok: false, status: 0, message: error?.message || String(error) });
    }
  });
}

async function checkNetworkStatus() {
  const targets = [
    { name: '成员数据', url: 'https://yaya-data.pages.dev/members.json' },
    { name: '口袋接口', url: 'https://pocketapi.48.cn/' },
    { name: '资源域名', url: 'https://source.48.cn/' },
    { name: 'B站接口', url: 'https://api.bilibili.com/x/web-interface/nav' },
  ];

  const results = await Promise.all(
    targets.map(async (target) => ({
      ...target,
      ...(await probeUrl(target.url)),
    })),
  );

  return {
    ok: results.some((item) => item.ok),
    results,
  };
}

export { requestJson, fetchJson, fetchJsonStrict, xhrPost, probeUrl, checkNetworkStatus };
