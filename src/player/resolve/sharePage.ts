import { fetchWithTimeout } from '../../utils/network';
import { USER_AGENT } from '../../constants';

/**
 * 官方「分享页」URL（老录播/已结束直播常见）：不是媒体流，需按 id 解析真实 m3u8。
 * 统一给 PlayerScreen 所有入口兜底，避免各页面各自遗漏。
 */
export function isSharePageUrl(u: string): boolean {
  return /\.html(\?|$)/i.test(u) || u.includes('h5.48.cn');
}

const SHARE_PAGE_API = 'https://pocketapi.48.cn/live/api/v1/live/getLiveOne';

/**
 * 用分享页里的 id 调公开接口取 playStreamPath。
 *
 * 超时与错误语义统一交给 fetchWithTimeout：8s 覆盖响应头 + 响应体读取；
 * HTTP 非 2xx、网络异常、超时一律向上抛（调用方 PlayerScreen 已有 .catch 回退），
 * 不再静默吞掉导致播放器无反馈地永久等待。
 */
export async function resolveSharePageUrl(
  url: string,
): Promise<{ url: string; urls: string[] } | null> {
  const id = /[?&]id=(\d+)/.exec(url)?.[1] || '';
  if (!id) return null;
  const resp = await fetchWithTimeout(
    SHARE_PAGE_API,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': USER_AGENT,
      },
      body: JSON.stringify({ liveId: id }),
    },
    8000,
  );
  if (!resp.ok) throw new Error(`分享页解析失败：HTTP ${resp.status}`);
  const json: any = await resp.json();
  const direct =
    json?.content?.playStreamPath || json?.content?.playUrl || json?.data?.playStreamPath || '';
  if (direct) return { url: String(direct), urls: [String(direct)] };
  return null;
}
