const BASE = 'https://pocketapi.48.cn';

const DESKTOP_APP_INFO = JSON.stringify({
  vendor: 'google',
  deviceId: '123',
  appVersion: '6.0.0',
  appBuild: '123',
  osType: 'android',
  osVersion: '10.0.0',
  deviceName: 'pixel',
});

function parseJson(text: string): any {
  if (!text) return null;
  const fixed = text.replace(/:\s*([0-9]{15,})/g, ':"$1"');
  try {
    return JSON.parse(fixed);
  } catch {
    return { status: 500, success: false, message: text.slice(0, 200) };
  }
}

function responseMessage(res: any, fallback: string): string {
  return res?.message || res?.msg || res?.error || fallback;
}

function assertOk(res: any, fallback: string) {
  if (res?.status === 200 || res?.success) return res;
  throw new Error(responseMessage(res, fallback));
}

function desktopPost(path: string, payload: Record<string, any>, fallback: string): Promise<any> {
  const body = JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${BASE}${path}`, true);
    xhr.timeout = 15000;
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.setRequestHeader('app-info', DESKTOP_APP_INFO);
    xhr.onload = () => {
      const res = parseJson(xhr.responseText);
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(assertOk(res, fallback));
        } catch (error) {
          reject(error);
        }
        return;
      }
      reject(new Error(responseMessage(res, `HTTP ${xhr.status}`)));
    };
    xhr.onerror = () => reject(new Error('网络请求失败'));
    xhr.ontimeout = () => reject(new Error('网络请求超时'));
    try {
      xhr.send(body);
    } catch (error: any) {
      reject(new Error(error?.message || String(error)));
    }
  });
}

export const officialMediaApi = {
  getTalkList(params: { ctime?: number; groupId?: number; limit?: number } = {}) {
    return desktopPost('/media/api/media/v1/talk/list', {
      ctime: params.ctime || 0,
      groupId: params.groupId ?? 0,
      limit: params.limit || 20,
    }, '获取电台列表失败');
  },

  getTalk(talkId: string) {
    return desktopPost('/media/api/media/v1/talk', {
      resId: String(talkId),
    }, '获取电台音频失败');
  },

  getMusicList(params: { ctime?: number; limit?: number } = {}) {
    return desktopPost('/media/api/media/v1/music/list', {
      ctime: params.ctime || 0,
      limit: params.limit || 20,
    }, '获取音乐列表失败');
  },

  getMusic(musicId: string) {
    return desktopPost('/media/api/media/v1/music', {
      resId: String(musicId),
    }, '获取音乐地址失败');
  },

  getVideoList(params: { ctime?: number; typeId?: number; groupId?: number; limit?: number } = {}) {
    return desktopPost('/media/api/media/v1/video/list', {
      ctime: params.ctime || 0,
      typeId: params.typeId ?? 0,
      groupId: params.groupId ?? 0,
      limit: params.limit || 20,
    }, '获取视频列表失败');
  },

  getVideo(videoId: string) {
    return desktopPost('/media/api/media/v1/video', {
      resId: String(videoId),
    }, '获取视频地址失败');
  },
};

export default officialMediaApi;
