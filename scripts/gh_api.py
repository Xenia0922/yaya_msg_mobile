#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""gh token 经 Clash 代理（127.0.0.1:7890）操作 GitHub API。
用法：
  python gh_api.py GET  /repos/{owner}/{repo}/...
  python gh_api.py POST /repos/{owner}/{repo}/...  <json-file|->   （body 从文件或 stdin 读）
token 来源：git credential fill（host=github.com）
"""
import sys, os, json, ssl, subprocess, urllib.request, base64, time

PROXY = os.environ.get('GH_PROXY', 'http://127.0.0.1:7890')
os.environ.pop('http_proxy', None); os.environ.pop('https_proxy', None)
os.environ.pop('HTTP_PROXY', None); os.environ.pop('HTTPS_PROXY', None)

def get_token():
    p = subprocess.run(
        ['git', 'credential', 'fill'],
        input='protocol=https\nhost=github.com\n\n', capture_output=True, text=True)
    for line in p.stdout.splitlines():
        if line.startswith('password='):
            return line.split('=', 1)[1].strip()
    raise SystemExit('no token from git credential fill')

TOKEN = get_token()
# ⚠️ 必须显式 HTTPSHandler(context=ssl.create_default_context())：
# Windows 自带的 OpenSSL 3.5 默认安全级别高，经 Clash(schannel) 隧道时，
# urllib 默认 context 会被对端 renegotiation 触发 SSLEOFError（curl/schannel 正常）。
OPENER = urllib.request.build_opener(
    urllib.request.ProxyHandler({'http': PROXY, 'https': PROXY}),
    urllib.request.HTTPSHandler(context=ssl.create_default_context()))

def api(method, path, payload=None, raw=False, headers=None):
    url = path if path.startswith('http') else f'https://api.github.com{path}'
    data = None
    if payload is not None:
        data = payload if isinstance(payload, (bytes, bytearray)) else json.dumps(payload).encode()
    h = {
        'Authorization': f'Bearer {TOKEN}',
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'yaya-gh-api',
    }
    if not raw:
        h['Content-Type'] = 'application/json'
    if headers:
        h.update(headers)
    last = None
    for attempt in range(6):
        try:
            req = urllib.request.Request(url, data=data, method=method, headers=h)
            with OPENER.open(req, timeout=120) as resp:
                body = resp.read()
                try:
                    return json.loads(body.decode())
                except Exception:
                    return body.decode(errors='replace')
        except urllib.error.HTTPError as e:
            body = e.read().decode(errors='replace')
            if e.code in (502, 503) and attempt < 5:
                last = f'HTTP {e.code}: {body[:300]}'
                time.sleep(1.2 * (attempt + 1))
                continue
            raise SystemExit(f'HTTP {e.code}: {body[:800]}')
        except Exception as e:
            last = repr(e)
            time.sleep(1.2 * (attempt + 1))
    raise SystemExit(f'failed after retries: {last}')

if __name__ == '__main__':
    method = sys.argv[1]
    path = sys.argv[2]
    payload = None
    if method in ('POST', 'PATCH', 'PUT'):
        src = sys.argv[3] if len(sys.argv) > 3 else '-'
        raw_body = sys.stdin.buffer.read() if src == '-' else open(src, 'rb').read()
        try:
            payload = json.loads(raw_body.decode())
        except Exception:
            payload = raw_body
    out = api(method, path, payload)
    print(json.dumps(out, ensure_ascii=False, indent=2) if isinstance(out, (dict, list)) else out)
