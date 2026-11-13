/**
 * 官方「分享页」URL（老录播/已结束直播常见）：不是媒体流，需按 id 解析真实 m3u8。
 * 统一给 PlayerScreen 所有入口兜底，避免各页面各自遗漏。
 */
export function isSharePageUrl(u: string): boolean {
  return /\.html(\?|$)/i.test(u) || u.includes('h5.48.cn');
}

/** 用分享页里的 id 调公开接口取 playStreamPath；失败返回 null */
export async function resolveSharePageUrl(url: string): Promise<{ url: string; urls: string[] } | null> {
  const id = /[?&]id=(\d+)/.exec(url)?.[1] || '';
  if (!id) return null;
  try {
    const resp = await fetch('https://pocketapi.48.cn/live/api/v1/live/getLiveOne', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'PocketFans201807/7.0.41 (iPhone; iOS 16.3.1; Scale/2.00)' },
      body: JSON.stringify({ liveId: id }),
    });
    const json: any = await resp.json();
    const direct = json?.content?.playStreamPath || json?.content?.playUrl || json?.data?.playStreamPath || '';
    if (direct) return { url: String(direct), urls: [String(direct)] };
  } catch {}
  return null;
}
