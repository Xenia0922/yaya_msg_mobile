import { xhrPost } from '../utils/network';

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

function responseMessage(res: any, fallback: string): string {
  return res?.message || res?.msg || res?.error || fallback;
}

function assertOk(res: any, fallback: string) {
  if (res?.status === 200 || res?.success) return res;
  throw new Error(responseMessage(res, fallback));
}

async function desktopPost(
  path: string,
  payload: Record<string, any>,
  fallback: string,
): Promise<any> {
  try {
    const res = await xhrPost(`${BASE}${path}`, payload, { 'app-info': DESKTOP_APP_INFO }, 15000);
    return assertOk(res, fallback);
  } catch (error: any) {
    throw new Error(responseMessage(error, error?.message || fallback));
  }
}

export const officialMediaApi = {
  getTalkList(params: { ctime?: number; groupId?: number; limit?: number } = {}) {
    return desktopPost(
      '/media/api/media/v1/talk/list',
      {
        ctime: params.ctime || 0,
        groupId: params.groupId ?? 0,
        limit: params.limit || 20,
      },
      '获取电台列表失败',
    );
  },

  getTalk(talkId: string) {
    return desktopPost(
      '/media/api/media/v1/talk',
      {
        resId: String(talkId),
      },
      '获取电台音频失败',
    );
  },

  getMusicList(params: { ctime?: number; limit?: number } = {}) {
    return desktopPost(
      '/media/api/media/v1/music/list',
      {
        ctime: params.ctime || 0,
        limit: params.limit || 20,
      },
      '获取音乐列表失败',
    );
  },

  getMusic(musicId: string) {
    return desktopPost(
      '/media/api/media/v1/music',
      {
        resId: String(musicId),
      },
      '获取音乐地址失败',
    );
  },

  getVideoList(params: { ctime?: number; typeId?: number; groupId?: number; limit?: number } = {}) {
    return desktopPost(
      '/media/api/media/v1/video/list',
      {
        ctime: params.ctime || 0,
        typeId: params.typeId ?? 0,
        groupId: params.groupId ?? 0,
        limit: params.limit || 20,
      },
      '获取视频列表失败',
    );
  },

  getVideo(videoId: string) {
    return desktopPost(
      '/media/api/media/v1/video',
      {
        resId: String(videoId),
      },
      '获取视频地址失败',
    );
  },
};

export default officialMediaApi;
