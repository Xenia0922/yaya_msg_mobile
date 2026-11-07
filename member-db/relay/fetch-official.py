#!/usr/bin/env python3
"""下载口袋48官方全量成员目录（境内中继用）。

与 GitHub Actions / 本机直连的区别：
  - 带完整客户端指纹头（pa 签名 + appInfo + P-Sign-Type），否则网关层直接 403 HTML；
  - 走 POCKET48_EGRESS_PROXY（服务器出口守卫维护），阿里云本机 IP 被拦。

只负责「下载 + 校验」，写出 members.json 仍交给仓库里的 fetch-official.mjs，
避免两份校验逻辑。
"""
import base64
import hashlib
import json
import os
import random
import sys
import time

import requests

ENDPOINT = "https://pocketapi.48.cn/user/api/v1/client/update/group_team_star"
SECRET = "40F1065D8E71F2A2A2BBE3F6F3D8B8C9"
UA = "PocketFans201807/7.1.37 (iPhone; iOS 26.2.1; Scale/3.00)"
APP_INFO = {
    "vendor": "apple",
    "deviceId": "7B93DFD0-472F-4736-A628-E85FAE086486",
    "appVersion": "7.1.37",
    "appBuild": "26020801",
    "osVersion": "26.2.1",
    "osType": "ios",
    "deviceName": "iPhone 14 Pro",
    "os": "ios",
}


def headers():
    ts = int(time.time() * 1000)
    rnd = random.randint(0, 9999)
    sign = hashlib.md5(f"{ts}{rnd}{SECRET}".encode()).hexdigest()
    pa = base64.b64encode(f"{ts},{rnd},{sign},".encode()).decode()
    return {
        "Accept": "*/*",
        "Accept-Language": "zh-Hans-CN;q=1",
        "Content-Type": "application/json;charset=utf-8",
        "Host": "pocketapi.48.cn",
        "P-Sign-Type": "V0",
        "User-Agent": UA,
        "appInfo": json.dumps(APP_INFO, separators=(",", ":")),
        "pa": pa,
    }


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else "/tmp/official_raw.json"
    proxy = os.environ.get("POCKET48_EGRESS_PROXY", "").strip()
    proxies = {"http": proxy, "https": proxy} if proxy else None
    resp = requests.post(ENDPOINT, headers=headers(), data="{}", proxies=proxies, timeout=30)
    if resp.status_code != 200:
        raise SystemExit(f"官方接口 HTTP {resp.status_code}")
    try:
        data = resp.json()
    except ValueError:
        raise SystemExit("官方接口返回的不是 JSON（网关层拦截）")
    stars = (data.get("content") or {}).get("starInfo") or []
    if data.get("status") != 200 or len(stars) < 500:
        raise SystemExit("官方接口返回失败或成员数量异常，保留原有数据")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(data, f)
    print(f"已下载官方成员 {len(stars)} 条")


if __name__ == "__main__":
    main()
