import { useSettingsStore } from '../store';
import { requestJson } from '../utils/network';

const BILIBILI_WEB_API = 'https://api.bilibili.com';
const BILIBILI_LIVE_API = 'https://api.live.bilibili.com';

function getCookie(): string {
  return useSettingsStore.getState().settings.bilibiliCookie || '';
}

function biliHeaders(cookie = getCookie(), referer = 'https://live.bilibili.com/'): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Cache-Control': 'no-cache',
    Pragma: 'no-cache',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
    Referer: referer,
  };
  if (referer.includes('live.bilibili.com')) headers.Origin = 'https://live.bilibili.com';
  if (cookie) headers.Cookie = cookie;
  return headers;
}

function assertBiliOk(res: any, fallback: string) {
  if (res?.code === 0) return res;
  if (res?.code === -412 || /request was banned/i.test(String(res?.message || ''))) {
    throw new Error('B站接口请求被拦截，请登录 B站账号或稍后再试');
  }
  throw new Error(res?.message || res?.msg || fallback);
}

function candidateScore(item: any): number {
  let score = 0;
  const format = String(item.formatName || '').toLowerCase();
  const protocol = String(item.protocolName || '').toLowerCase();
  const codec = String(item.codecName || '').toLowerCase();

  if (format === 'fmp4') score += 1200;
  if (format === 'ts') score += 900;
  if (format === 'flv') score += 300;
  if (protocol.includes('hls')) score += 300;
  if (protocol.includes('http')) score += 120;
  if (codec === 'avc') score += 200;
  if (codec === 'hevc') score -= 200;
  score += Number(item.currentQn || 0);
  return score;
}

function liveCandidates(playInfo: any): any[] {
  const playurl = playInfo?.data?.playurl_info?.playurl;
  const candidates: any[] = [];

  for (const stream of playurl?.stream || []) {
    for (const format of stream.format || []) {
      for (const codec of format.codec || []) {
        const baseUrl = String(codec.base_url || '').trim();
        if (!baseUrl) continue;
        for (const info of codec.url_info || []) {
          const host = String(info.host || '').trim();
          if (!host) continue;
          candidates.push({
            url: `${host}${baseUrl}${String(info.extra || '').trim()}`,
            host,
            protocolName: String(stream.protocol_name || '').trim(),
            formatName: String(format.format_name || '').trim(),
            codecName: String(codec.codec_name || '').trim(),
            currentQn: Number(codec.current_qn || 0),
          });
        }
      }
    }
  }

  const seen = new Set<string>();
  return candidates
    .filter((item) => item.url && !seen.has(item.url) && seen.add(item.url))
    .sort((a, b) => candidateScore(b) - candidateScore(a));
}

export const bilibiliApi = {
  headers(roomId?: string) {
    return biliHeaders(getCookie(), roomId ? `https://live.bilibili.com/${roomId}` : 'https://live.bilibili.com/');
  },

  async checkLoginStatus(cookie?: string) {
    const res = await requestJson<any>(`${BILIBILI_WEB_API}/x/web-interface/nav`, {
      headers: biliHeaders(cookie, 'https://www.bilibili.com/'),
    });
    return assertBiliOk(res, 'B站登录状态检查失败');
  },

  async generateQrCode() {
    const res = await requestJson<any>('https://passport.bilibili.com/x/passport-login/web/qrcode/generate', {
      headers: biliHeaders('', 'https://passport.bilibili.com/'),
    });
    return assertBiliOk(res, 'B站二维码获取失败');
  },

  async pollQrCode(qrcodeKey: string) {
    const res = await requestJson<any>(
      `https://passport.bilibili.com/x/passport-login/web/qrcode/poll?qrcode_key=${encodeURIComponent(qrcodeKey)}`,
      { headers: biliHeaders('', 'https://passport.bilibili.com/') },
    );
    return assertBiliOk(res, 'B站扫码状态获取失败');
  },

  async getRoomInit(roomId: string) {
    const res = await requestJson<any>(
      `${BILIBILI_LIVE_API}/room/v1/Room/room_init?id=${encodeURIComponent(roomId)}`,
      { headers: biliHeaders(getCookie(), `https://live.bilibili.com/${roomId}`) },
    );
    return assertBiliOk(res, 'B站房间信息获取失败');
  },

  async getRoomPlayInfo(roomId: string) {
    const query = new URLSearchParams({
      room_id: String(roomId),
      protocol: '0,1',
      format: '0,1,2',
      codec: '0,1',
      qn: '10000',
      platform: 'web',
      ptype: '8',
    });
    const res = await requestJson<any>(
      `${BILIBILI_LIVE_API}/xlive/web-room/v2/index/getRoomPlayInfo?${query.toString()}`,
      { headers: biliHeaders(getCookie(), `https://live.bilibili.com/${roomId}`) },
    );
    return assertBiliOk(res, 'B站直播流获取失败');
  },

  async resolveLive(roomId: string) {
    const init = await this.getRoomInit(roomId);
    const realRoomId = String(init.data?.room_id || roomId);
    if (Number(init.data?.live_status) !== 1) throw new Error('该直播间当前未开播');

    const playInfo = await this.getRoomPlayInfo(realRoomId);
    const candidates = liveCandidates(playInfo);
    if (!candidates.length) throw new Error('未找到可用的直播播放地址');

    return {
      realRoomId,
      streamUrl: candidates[0].url,
      streamCandidates: candidates,
      title: playInfo.data?.room_info?.title || `B站直播 ${realRoomId}`,
    };
  },

  async resolveLiveUrl(roomId: string): Promise<string | null> {
    const info = await this.resolveLive(roomId);
    return info.streamUrl || null;
  },
};

export default bilibiliApi;
