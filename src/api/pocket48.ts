import { useMemberStore, useSettingsStore } from '../store';
import { generatePa, generatePaAsync, getWasmError, initWasm } from '../auth';
import { requestJson, xhrPost } from '../utils/network';

const BASE = 'https://pocketapi.48.cn';
const APP_VERSION = '7.0.41';
const APP_BUILD = '24011601';

type HeadersMap = Record<string, string>;

function createDeviceId(): string {
  const chars = 'QWERTYUIOPASDFGHJKLZXCVBNM1234567890';
  const rand = (length: number) => {
    let result = '';
    for (let i = 0; i < length; i += 1) result += chars[Math.floor(Math.random() * chars.length)];
    return result;
  };
  return `${rand(8)}-${rand(4)}-${rand(4)}-${rand(4)}-${rand(12)}`;
}

const DEVICE_ID = createDeviceId();

function appInfo(modern = false) {
  if (modern) {
    return {
      vendor: 'apple',
      deviceId: '7B93DFD0-472F-4736-A628-E85FAE086486',
      appVersion: '7.1.35',
      appBuild: '25101021',
      osVersion: '16.3.0',
      osType: 'ios',
      deviceName: 'iPhone 14 Pro',
      os: 'ios',
    };
  }
  return {
    vendor: 'apple',
    deviceId: DEVICE_ID,
    appVersion: APP_VERSION,
    appBuild: APP_BUILD,
    osVersion: '16.3.1',
    osType: 'ios',
    deviceName: 'iPhone XR',
    os: 'ios',
  };
}

function createHeaders(token?: string, pa?: string | null, modern = false): HeadersMap {
  const headers: HeadersMap = {
    'Content-Type': 'application/json;charset=utf-8',
    'User-Agent': modern
      ? 'PocketFans201807/7.1.35 (iPhone; iOS 16.3; Scale/3.00)'
      : `PocketFans201807/${APP_VERSION} (iPhone; iOS 16.3.1; Scale/2.00)`,
    Host: 'pocketapi.48.cn',
    'Accept-Language': 'zh-Hans-CN;q=1',
    Accept: '*/*',
    appInfo: JSON.stringify(appInfo(modern)),
  };
  if (token) headers.token = token;
  if (pa) headers.pa = pa;
  return headers;
}

function tokenFromStore(): string {
  return useSettingsStore.getState().settings.p48Token || '';
}

function requireToken(): string {
  const token = tokenFromStore();
  if (!token) throw new Error('缺少 Token，请先登录口袋48或粘贴 Token');
  return token;
}

function responseOk(data: any): boolean {
  if (!data) return false;
  if (data.success === false) return false;
  if (typeof data.status === 'number' && data.status !== 200) return false;
  if (typeof data.code === 'number' && data.code !== 0) return false;
  if (data.success === true) return true;
  if (data.status === 200) return true;
  if (data.code === 0) return true;
  if (data.content !== undefined || data.data !== undefined || data.list !== undefined) return true;
  return false;
}

function responseMessage(data: any, fallback: string): string {
  return data?.message || data?.msg || data?.error || data?.statusDesc || fallback;
}

function assertPocketOk(data: any, fallback = 'pocket api request failed') {
  if (responseOk(data)) return data;
  const detail = responseMessage(data, fallback);
  const status = data?.status ?? data?.code;
  throw new Error(status !== undefined ? `${detail} (${status})` : detail);
}

async function createSignedHeaders(token?: string, modern = false, patch: HeadersMap = {}) {
  await initWasm();
  const pa = await generatePaAsync();
  if (!pa) {
    const reason = getWasmError();
    throw new Error(reason ? `签名模块未就绪：${reason}` : '签名模块未就绪，无法请求口袋接口');
  }
  return {
    ...createHeaders(token, pa, modern),
    ...patch,
  };
}

async function rawPost(url: string, data: any, options: { token?: string; modern?: boolean; headers?: HeadersMap; signed?: boolean } = {}) {
  const token = options.token ?? tokenFromStore();
  const headers = options.signed === false
    ? { ...createHeaders(token, null, !!options.modern), ...(options.headers || {}) }
    : await createSignedHeaders(token, !!options.modern, options.headers || {});
  return xhrPost(url, data, headers);
}

function parsePocketJson(text: string): any {
  if (!text) return null;
  const fixed = text.replace(/:\s*([0-9]{15,})/g, ':"$1"');
  try {
    return JSON.parse(fixed);
  } catch {
    return { status: 500, success: false, message: fixed.replace(/\s+/g, ' ').slice(0, 180) };
  }
}

async function signedHeaders(token?: string, modern = false, patch: HeadersMap = {}) {
  return createSignedHeaders(token ?? tokenFromStore(), modern, patch);
}

async function pocketPost(url: string, data: any, options: { tokenRequired?: boolean; modern?: boolean; headers?: HeadersMap; fallback?: string; signed?: boolean } = {}) {
  const token = options.tokenRequired === false ? tokenFromStore() : requireToken();
  const res = await rawPost(url, data, {
    token,
    modern: options.modern,
    headers: options.headers,
    signed: options.signed !== false,
  });
  return assertPocketOk(res, options.fallback);
}

async function publicMediaPost(url: string, data: any, fallback: string) {
  const res = await requestJson<any>(url, {
    method: 'POST',
    body: data,
    timeout: 15000,
    headers: {
      'app-info': JSON.stringify({
        vendor: 'google',
        deviceId: '123',
        appVersion: '6.0.0',
        appBuild: '123',
        osType: 'android',
        osVersion: '10.0.0',
        deviceName: 'pixel',
      }),
    },
  });
  return assertPocketOk(res, fallback);
}

function pushUniqueId(target: string[], value: any) {
  const text = String(value || '');
  if (!text || text === '0' || target.includes(text)) return;
  target.push(text);
}

function collectServerIdsForChannel(node: any, channelId: string, target: string[], depth = 0) {
  if (!node || depth > 6) return;
  if (Array.isArray(node)) {
    node.forEach((item) => collectServerIdsForChannel(item, channelId, target, depth + 1));
    return;
  }
  if (typeof node !== 'object') return;

  const nodeChannel = String(
    node.channelId
      || node.roomId
      || node.teamInfo?.channelId
      || node.teamInfo?.roomId
      || '',
  );
  if (nodeChannel === String(channelId)) {
    pushUniqueId(target, node.serverId || node.serverID || node.teamInfo?.serverId || node.teamInfo?.serverID);
  }

  Object.entries(node).forEach(([key, value]) => {
    if (String(key) === String(channelId)) pushUniqueId(target, value);
    collectServerIdsForChannel(value, channelId, target, depth + 1);
  });
}

async function resolveServerIds(channelId: string): Promise<string[]> {
  const ids: string[] = [];
  try {
    const res = await pocketPost(`${BASE}/im/api/v1/im/team/room/info`, { channelId: String(channelId) });
    pushUniqueId(ids, res?.content?.serverId || res?.content?.teamInfo?.serverId || res?.data?.serverId || res?.serverId);
  } catch {
    // Fall through to the server map; some large rooms have stale local serverId values.
  }
  try {
    const res = await pocketPost(`${BASE}/im/api/v1/team/star/server/map/get`, {}, {
      modern: true,
      fallback: 'get room server map failed',
    });
    collectServerIdsForChannel(res, channelId, ids);
  } catch {
    // The map is a fallback only.
  }
  return ids;
}

async function resolveServerId(channelId: string): Promise<string> {
  const ids = await resolveServerIds(channelId);
  return ids[0] || '';
}

function rememberServerId(channelId: string, serverId: string) {
  if (!channelId || !serverId || serverId === '0') return;
  useMemberStore.getState().updateMemberRoomIds(channelId, { serverId });
}

async function tryPocketPost(
  attempts: Array<{ url: string; payload: any; modern?: boolean; tokenRequired?: boolean; signed?: boolean; label: string }>,
  fallback: string,
) {
  const errors: string[] = [];
  for (const attempt of attempts) {
    try {
      const res = await pocketPost(attempt.url, attempt.payload, {
        modern: attempt.modern,
        tokenRequired: attempt.tokenRequired,
        signed: attempt.signed,
        fallback: `${fallback}: ${attempt.label}`,
      });
      return {
        ...res,
        _request: {
          label: attempt.label,
          payload: attempt.payload,
        },
      };
    } catch (error: any) {
      errors.push(`${attempt.label}: ${error?.message || String(error)}`);
    }
  }
  throw new Error(errors.join('\n') || fallback);
}

function safeNumber(value: any): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export const pocketApi = {
  initWasm,
  generatePa,
  generatePaAsync,

  async loginSendSms(mobile: string, area = '86', answer?: string) {
    const payload: any = { mobile, area };
    if (answer) payload.answer = answer;
    const data = await rawPost(`${BASE}/user/api/v1/sms/send2`, payload, { signed: false });
    if (data.status === 200 || data.success) return { success: true };
    if (data.status === 2001) {
      try {
        const verificationData = JSON.parse(data.message);
        return {
          success: false,
          needVerification: true,
          question: verificationData.question,
          options: verificationData.answer,
        };
      } catch {
        return { success: false, msg: data.message || '需要安全验证' };
      }
    }
    return { success: false, msg: responseMessage(data, '验证码发送失败') };
  },

  async loginByCode(mobile: string, code: string) {
    const res = await rawPost(`${BASE}/user/api/v1/login/app/mobile/code`, { mobile, code }, { token: '', signed: true });
    return assertPocketOk(res, '登录失败');
  },

  async loginCheckToken() {
    return pocketPost(`${BASE}/user/api/v1/user/info/reload`, { from: 'appstart' }, { fallback: 'Token 无效' });
  },

  async editUserInfo(params: { key?: string; value?: string; nickName?: string; avatar?: string }) {
    const changes: Array<{ key: string; value: string }> = [];
    if (params.key) {
      changes.push({ key: String(params.key), value: String(params.value ?? '') });
    } else {
      if (params.nickName?.trim()) changes.push({ key: 'nickname', value: params.nickName.trim() });
      if (params.avatar?.trim()) changes.push({ key: 'avatar', value: params.avatar.trim() });
    }
    if (!changes.length) throw new Error('缺少修改字段');

    const results = [];
    for (const change of changes) {
      const res = await pocketPost(`${BASE}/user/api/v1/user/info/edit`, change, {
        modern: true,
        fallback: '修改资料失败',
      });
      results.push(res);
    }
    return results[results.length - 1];
  },

  async getUserRenameCount() {
    return pocketPost(`${BASE}/user/api/v1/user/rename/count`, {}, {
      modern: true,
      fallback: '获取改名次数失败',
    });
  },

  async uploadUserAvatar(params: { uri: string; fileName?: string; mimeType?: string }) {
    const token = requireToken();
    const headers = await signedHeaders(token, true);
    delete headers['Content-Type'];
    delete headers.Host;
    const mimeType = params.mimeType || 'image/jpeg';
    const fileName = params.fileName || `avatar-${Date.now()}.${mimeType.includes('png') ? 'png' : 'jpg'}`;
    const formData = new FormData();
    formData.append('fromType', 'avatar');
    formData.append('file', {
      uri: params.uri,
      name: fileName,
      type: mimeType,
    } as any);
    const response = await fetch('https://pfile.48.cn/filesystem/upload/image', {
      method: 'POST',
      headers,
      body: formData,
    });
    const data = await response.json().catch(() => null);
    if (response.ok && data && (data.status === 200 || data.success)) {
      const item = Array.isArray(data.content) ? data.content[0] : data.content;
      const path = item?.path || item?.url || item?.filePath || '';
      if (!path) throw new Error('上传头像成功但没有返回图片路径');
      return { success: true, content: item, path };
    }
    throw new Error(responseMessage(data, '上传头像失败'));
  },

  async checkIn() {
    const res = await rawPost(`${BASE}/user/api/v1/checkin`, {}, {
      token: requireToken(),
      modern: true,
      headers: { 'P-Sign-Type': 'V0' },
      signed: true,
    });
    if (responseOk(res)) return res;
    const message = responseMessage(res, '签到失败');
    if (/\u5df2\u7b7e\u5230|\u91cd\u590d\u7b7e\u5230|\u5df2\u7ecf\u7b7e\u5230|\u5df2\u9886\u53d6|\u660e\u5929\u518d\u6765/.test(message)) {
      return { success: true, status: res?.status ?? res?.code ?? 200, message, content: res?.content || null, alreadyChecked: true };
    }
    throw new Error(res?.status !== undefined || res?.code !== undefined ? `${message} (${res?.status ?? res?.code})` : message);
  },

  async getCheckinToday() {
    return pocketPost(`${BASE}/user/api/v1/checkin/check/today`, {}, {
      modern: true,
      fallback: '获取今日签到状态失败',
    });
  },

  async getNimLoginInfo() {
    return tryPocketPost([
      {
        url: `${BASE}/user/api/v1/user/info/reload`,
        payload: { from: 'appstart' },
        modern: true,
        label: 'reload modern',
      },
      {
        url: `${BASE}/user/api/v1/user/info/reload`,
        payload: { from: 'appstart' },
        label: 'reload legacy',
      },
      {
        url: `${BASE}/user/api/v1/user/info/home`,
        payload: {},
        modern: true,
        label: 'info home modern',
      },
      {
        url: `${BASE}/user/api/v1/user/info/home`,
        payload: {},
        label: 'info home legacy',
      },
    ], 'get self user info failed');
  },

  async getUserProfile(userId: string) {
    const id = String(userId || '');
    if (!id) throw new Error('missing userId');
    return tryPocketPost([
      {
        url: `${BASE}/user/api/v1/user/info`,
        payload: { userId: id },
        modern: true,
        label: 'user info userId',
      },
      {
        url: `${BASE}/user/api/v1/user/info`,
        payload: { id },
        label: 'user info id',
      },
      {
        url: `${BASE}/user/api/v1/user/detail`,
        payload: { userId: id },
        modern: true,
        label: 'user detail userId',
      },
      {
        url: `${BASE}/user/api/v1/user/home`,
        payload: { userId: id },
        modern: true,
        label: 'user home userId',
      },
    ], 'get user profile failed');
  },

  async switchBigSmall(targetUserId: string) {
    return pocketPost(`${BASE}/user/api/v1/bigsmall/switch/user`, { toUserId: String(targetUserId) }, { fallback: '切换账号失败' });
  },

  async getStarServerMap() {
    return pocketPost(`${BASE}/im/api/v1/team/star/server/map/get`, {}, {
      modern: true,
      fallback: '获取成员房间映射失败',
    });
  },

  async getUserMoney() {
    return pocketPost(`${BASE}/user/api/v1/user/money`, {}, { fallback: '获取余额失败' });
  },

  async getFollowedIds() {
    return pocketPost(`${BASE}/user/api/v1/friendships/friends/id`, {}, { fallback: '获取关注房间失败' });
  },

  async followMember(memberId: string) {
    return pocketPost(`${BASE}/user/api/v2/friendships/friends/add`, { toSourceId: safeNumber(memberId), toType: 1 }, { fallback: '关注失败' });
  },

  async unfollowMember(memberId: string) {
    return pocketPost(`${BASE}/user/api/v2/friendships/friends/remove`, { toSourceId: safeNumber(memberId), toType: 1 }, { fallback: '取消关注失败' });
  },

  async getLastMessages(serverIdList: number[]) {
    return pocketPost(`${BASE}/im/api/v1/team/classic/last/message/get`, {
      serverIdList: serverIdList.map(Number).filter((item) => Number.isFinite(item) && item > 0),
    }, { fallback: '获取最新消息失败' });
  },

  async getRoomMessages(params: { channelId: string; serverId: string; nextTime?: number; fetchAll?: boolean; limit?: number }) {
    const channelId = String(params.channelId || '');
    const originalServerId = String(params.serverId || '');
    if (!channelId) throw new Error('missing channelId');
    const resolvedServerIds = await resolveServerIds(channelId);
    const url = params.fetchAll
      ? `${BASE}/im/api/v1/team/message/list/all`
      : `${BASE}/im/api/v1/team/message/list/homeowner`;
    const limit = params.limit || 50;
    const next = params.nextTime || 0;
    const attempts: Array<{ url: string; payload: any; signed?: boolean; label: string }> = [];
    for (const serverId of [originalServerId, ...resolvedServerIds]) {
      const sid = String(serverId || '');
      if (!sid || sid === '0') continue;
      const payload = { channelId: safeNumber(channelId), serverId: safeNumber(sid), nextTime: next, limit };
      attempts.push({ url, payload, label: `room srv=${sid}` });
      attempts.push({ url, payload, signed: false, label: `room unsigned srv=${sid}` });
    }
    if (!attempts.length) throw new Error('missing serverId');
    return tryPocketPost(attempts, 'get room messages failed');
  },

  async sendRoomText(params: { channelId: string; serverId: string; text: string }) {
    const channelId = String(params.channelId || '');
    let serverId = String(params.serverId || '');
    const text = String(params.text || '').trim();
    if (!channelId) throw new Error('missing channelId');
    if (!text) throw new Error('empty message');
    if (!serverId || serverId === '0') serverId = await resolveServerId(channelId);
    if (!serverId || serverId === '0') throw new Error('missing serverId');
    rememberServerId(channelId, serverId);
    const body = JSON.stringify({ text });
    const extInfo = JSON.stringify({ text, msgType: 'TEXT' });
    return tryPocketPost([
      {
        url: `${BASE}/im/api/v1/team/message/send`,
        payload: { channelId: safeNumber(channelId), serverId: safeNumber(serverId), msgType: 'TEXT', text, body, bodys: body },
        label: 'team message send number',
      },
      {
        url: `${BASE}/im/api/v1/team/message/send`,
        payload: { channelId: String(channelId), serverId: String(serverId), msgType: 'TEXT', text, body, bodys: body },
        label: 'team message send string',
      },
      {
        url: `${BASE}/im/api/v1/team/message/send`,
        payload: { channelId: safeNumber(channelId), serverId: safeNumber(serverId), type: 'TEXT', msgContent: body, extInfo },
        modern: true,
        label: 'team message send modern msgContent',
      },
      {
        url: `${BASE}/im/api/v1/team/message/send`,
        payload: { channelId: String(channelId), serverId: String(serverId), type: 'TEXT', msgContent: body, extInfo },
        modern: true,
        label: 'team message send modern string msgContent',
      },
      {
        url: `${BASE}/im/api/v1/team/message/send/text`,
        payload: { channelId: safeNumber(channelId), serverId: safeNumber(serverId), text },
        modern: true,
        label: 'team message send text',
      },
      {
        url: `${BASE}/im/api/v1/team/message/send/text`,
        payload: { channelId: String(channelId), serverId: String(serverId), text },
        modern: true,
        label: 'team message send text string',
      },
      {
        url: `${BASE}/im/api/v1/team/message/create`,
        payload: { channelId: safeNumber(channelId), serverId: safeNumber(serverId), msgType: 'TEXT', bodys: body },
        modern: true,
        label: 'team message create',
      },
    ], 'send room text failed');
  },

  async getRoomAlbum(params: { channelId: string; nextTime?: number }) {
    return pocketPost(`${BASE}/im/api/v1/team/msg/list/img`, {
      channelId: String(params.channelId),
      nextTime: params.nextTime || 0,
    }, { fallback: '获取房间相册失败' });
  },

  async getOfficialTalkList(params: { ctime?: number; groupId?: number; limit?: number } = {}) {
    return publicMediaPost(`${BASE}/media/api/media/v1/talk/list`, {
      ctime: params.ctime || 0,
      groupId: params.groupId ?? 0,
      limit: params.limit || 20,
    }, 'get talk list failed');
  },

  async getOfficialTalk(talkId: string) {
    return publicMediaPost(`${BASE}/media/api/media/v1/talk`, {
      resId: String(talkId),
    }, 'get talk audio failed');
  },

  async getOfficialMusicList(params: { ctime?: number; limit?: number } = {}) {
    return publicMediaPost(`${BASE}/media/api/media/v1/music/list`, {
      ctime: params.ctime || 0,
      limit: params.limit || 20,
    }, 'get music list failed');
  },

  async getOfficialMusic(musicId: string) {
    return publicMediaPost(`${BASE}/media/api/media/v1/music`, {
      resId: String(musicId),
    }, 'get music url failed');
  },

  async getOfficialVideoList(params: { ctime?: number; typeId?: number; groupId?: number; limit?: number } = {}) {
    return publicMediaPost(`${BASE}/media/api/media/v1/video/list`, {
      ctime: params.ctime || 0,
      typeId: params.typeId ?? 0,
      groupId: params.groupId ?? 0,
      limit: params.limit || 20,
    }, 'get video list failed');
  },

  async getOfficialVideo(videoId: string) {
    return publicMediaPost(`${BASE}/media/api/media/v1/video`, {
      resId: String(videoId),
    }, 'get video url failed');
  },

  async getPrivateMessageList(lastTime?: number) {
    return pocketPost(`${BASE}/message/api/v1/user/message/list`, {
      lastTime: Number(lastTime) || Date.now(),
    }, { modern: true, fallback: '获取私信列表失败' });
  },

  async getPrivateMessageDetail(targetUserId: string, lastTime = 0) {
    return pocketPost(`${BASE}/message/api/v1/user/message/info`, {
      lastTime: Number(lastTime) || 0,
      targetUserId: String(targetUserId),
    }, { modern: true, fallback: '获取私信详情失败' });
  },

  async sendPrivateMessageReply(targetUserId: string, text: string) {
    return pocketPost(`${BASE}/message/api/v1/user/message/reply`, {
      messageType: 'TEXT',
      text: String(text),
      targetUserId: String(targetUserId),
    }, { modern: true, fallback: '发送私信失败' });
  },

  async getFlipList(beginLimit = 0, limit = 20) {
    return pocketPost(`${BASE}/idolanswer/api/idolanswer/v1/user/question/list`, {
      status: 0,
      beginLimit,
      limit,
      memberId: '',
    }, { fallback: '获取翻牌记录失败' });
  },

  async getFlipPrices(memberId: string) {
    return pocketPost(`${BASE}/idolanswer/api/idolanswer/v2/custom/index`, {
      memberId: String(memberId),
    }, { fallback: '获取翻牌类型失败' });
  },

  async sendFlipQuestion(payload: any) {
    return pocketPost(`${BASE}/idolanswer/api/idolanswer/v1/user/question`, payload, { fallback: '发送翻牌失败' });
  },

  async operateFlipQuestion(questionId: string, operateType = 1) {
    return pocketPost(`${BASE}/idolanswer/api/idolanswer/v1/user/question/operate`, {
      questionId: String(questionId),
      operateType,
    }, { fallback: '操作翻牌失败' });
  },

  async getStarArchives(memberId: number) {
    return pocketPost(`${BASE}/user/api/v1/user/star/archives`, { memberId: Number(memberId) }, { tokenRequired: false, fallback: '获取成员档案失败' });
  },

  async getStarHistory(memberId: number) {
    return pocketPost(`${BASE}/user/api/v1/user/star/history`, {
      memberId: Number(memberId),
      limit: 100,
      lastTime: 0,
    }, { tokenRequired: false, fallback: '获取成员历史失败' });
  },

  async getOpenLive(params: { memberId: string; nextTime?: number }) {
    const memberId = String(params.memberId || '');
    if (!memberId) throw new Error('missing memberId');
    return tryPocketPost([
      { url: `${BASE}/im/api/v1/chatroom/msg/list/aim/type`, payload: { extMsgType: 'OPEN_LIVE', roomId: '', ownerId: memberId, nextTime: Number(params.nextTime) || 0 }, label: 'openlive' },
      { url: `${BASE}/im/api/v1/chatroom/msg/list/aim/type`, payload: { extMsgType: 'OPEN_LIVE', roomId: '', ownerId: memberId, nextTime: Number(params.nextTime) || 0 }, signed: false, label: 'openlive unsigned' },
    ], '获取成员公演失败');
  },

  async getOpenLiveOne(liveId: string) {
    const id = String(liveId);
    return tryPocketPost([
      {
        url: `${BASE}/live/api/v1/live/getOpenLiveOne`,
        payload: { liveId: id },
        tokenRequired: false,
        label: 'open live one',
      },
      {
        url: `${BASE}/live/api/v1/live/getOpenLiveOne`,
        payload: { liveId: id, streamProtocol: 'RTMP' },
        tokenRequired: false,
        label: 'open live one rtmp',
      },
    ], '获取公演详情失败');
  },

  async getLiveOne(liveId: string) {
    const id = String(liveId);
    return tryPocketPost([
      {
        url: `${BASE}/live/api/v1/live/getLiveOne`,
        payload: { liveId: id },
        tokenRequired: false,
        label: 'live one',
      },
      {
        url: `${BASE}/live/api/v1/live/getLiveOne`,
        payload: { liveId: id, streamProtocol: 'RTMP' },
        tokenRequired: false,
        label: 'live one rtmp',
      },
    ], '获取直播详情失败');
  },

  async getOpenLivePublicList(params: { groupId?: number; next?: number; record?: boolean }) {
    return pocketPost(`${BASE}/live/api/v1/live/getOpenLiveList`, {
      groupId: params.groupId ?? 0,
      debug: false,
      next: params.next ?? 0,
      record: !!params.record,
    }, { tokenRequired: false, fallback: '获取公演列表失败' });
  },

  async getMemberPhotos(memberId: string, page = 0, size = 20) {
    return pocketPost(`${BASE}/idolanswer/api/idolanswer/v1/user/nft/user_nft_list`, {
      starId: safeNumber(memberId),
      size,
      page,
    }, { tokenRequired: false, fallback: '获取个人相册失败' });
  },

  async getLiveList(params: { groupId?: number; liveType?: number; page?: number; record?: boolean; debug?: boolean; next?: number }) {
    const payload: any = {
      groupId: params.groupId ?? 0,
      debug: params.debug ?? false,
      liveType: params.liveType ?? 0,
      next: params.next ?? 0,
      record: params.record ?? false,
    };
    if (params.page !== undefined) payload.page = params.page;
    return pocketPost(`${BASE}/live/api/v1/live/getLiveList`, payload, { tokenRequired: false, fallback: '获取直播列表失败' });
  },

  async operateRoomVoice(params: { channelId: string; serverId: string }) {
    const channelId = String(params.channelId || '');
    let serverId = String(params.serverId || '');
    if (!serverId || serverId === '0') serverId = await resolveServerId(channelId);
    rememberServerId(channelId, serverId);
    return pocketPost(`${BASE}/im/api/v1/team/voice/operate`, {
      channelId: safeNumber(channelId),
      serverId: safeNumber(serverId),
      operateCode: 2,
    }, { fallback: '获取房间电台失败' });
  },

  async sendGift(params: { giftId: string; liveId: string; acceptUserId: string; giftNum?: number }) {
    return pocketPost(`${BASE}/gift/api/v1/gift/send`, {
      giftId: String(params.giftId),
      businessId: String(params.liveId),
      acceptUserId: String(params.acceptUserId),
      giftNum: Number(params.giftNum) || 1,
      isPocketGift: 0,
      businessCode: 0,
      zip: 0,
      isCombo: 0,
      ruleId: 0,
      giftType: 1,
      crm: `${Date.now()}${Math.random().toString().slice(2)}`,
    }, { modern: true, fallback: '送礼失败' });
  },

  async getGiftList(liveId: string) {
    return pocketPost(`${BASE}/gift/api/v1/gift/list`, {
      businessId: String(liveId),
      giftType: 1,
    }, { fallback: '获取礼物列表失败' });
  },

  async getLiveRank(liveId: string) {
    return pocketPost(`${BASE}/live/api/v2/live/getLiveRank`, {
      type: 1,
      liveId: String(liveId),
    }, { fallback: '获取直播榜单失败' });
  },
};

export default pocketApi;
