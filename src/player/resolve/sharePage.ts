import { fetchWithTimeout } from '../../utils/network';
import { USER_AGENT } from '../../constants';

export function isSharePageUrl(u: string): boolean {
  return /\.html(\?|$)/i.test(u) || u.includes('h5.48.cn');
}

const SHARE_PAGE_API = 'https://pocketapi.48.cn/live/api/v1/live/getLiveOne';

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
