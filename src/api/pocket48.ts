import { useMemberStore, useSettingsStore } from '../store';
import { generatePa, generatePaAsync, getWasmError, initWasm, invalidatePaCache } from '../auth';
import { requestJson, xhrPost, fetchWithTimeout } from '../utils/network';
import { unwrapList, normalizeUrl, parseMaybeJson, pickText } from '../utils/data';
import { normalizePocketToken } from '../utils/pocketToken';
import type { ApiEnvelope, WireRecord } from '../types';
import {
  BASE,
  type HeadersMap,
  createArea48Headers,
  createCheckinHeaders,
  createHeaders,
  createInvoiceHeaders,
  createMeet48Headers,
  createPocketAndroidHeaders,
  createPocketLoginHeaders,
  createPocketProfileHeaders,
  createSeineHeaders,
  createSeineIosHeaders,
  createWeiboHeaders,
  ensureDeviceId,
} from './pocketHeaders';

function tokenFromStore(): string {
  return normalizePocketToken(useSettingsStore.getState().settings.p48Token);
}

function requireToken(): string {
  const token = tokenFromStore();
  if (!token) throw new Error('缺少 Token，请先登录口袋48或粘贴 Token');
  return token;
}

function responseOk(data: unknown): boolean {
  const d = (data ?? {}) as ApiEnvelope;
  if (!d) return false;
  if (d.success === false) return false;
  if (typeof d.status === 'number' && d.status !== 200) return false;
  if (typeof d.code === 'number' && d.code !== 0) return false;
  if (d.success === true) return true;
  if (d.status === 200) return true;
  if (d.code === 0) return true;

  if (d.content !== undefined || d.data !== undefined || d.list !== undefined) return true;
  return false;
}

function responseMessage(data: unknown, fallback: string): string {
  const d = (data ?? {}) as ApiEnvelope;
  return String(d.message || d.msg || d.error || d.statusDesc || fallback);
}

export function isPocketAuthError(value: unknown): boolean {
  const text = String(value || '');
  if (!text) return false;
  if (/token/i.test(text) && /(解析|parse|invalid|expired|失效|过期|无效)/i.test(text)) {
    return true;
  }
  return /登录.*(失效|过期|无效)|login.*(expired|invalid|required)/i.test(text);
}

function assertPocketOk<T = ApiEnvelope>(
  data: T | null | undefined,
  fallback = 'pocket api request failed',
  checkAuthError = true,
): T {
  const detail = responseMessage(data, fallback);
  if (checkAuthError && isPocketAuthError(detail)) {
    throw new Error(detail);
  }
  if (responseOk(data)) return data as T;
  if (/\bpa\b|签名|signature/i.test(detail)) {
    invalidatePaCache();
  }
  const status = (data as ApiEnvelope | null | undefined)?.status ?? (data as ApiEnvelope)?.code;
  throw new Error(status !== undefined ? `${detail} (${status})` : detail);
}

const emptyDeviceTokens = new Set<string>();

function isDeviceMismatchTokenError(data: ApiEnvelope | null | undefined): boolean {
  if (!data || responseOk(data)) return false;
  return /token.*(解析|parse)/i.test(responseMessage(data, ''));
}

async function createSignedHeaders(
  token?: string,
  modern = false,
  patch: HeadersMap = {},
  preservePatch = false,
  deviceIdOverride?: string,
) {
  await initWasm();
  const pa = await generatePaAsync();
  if (!pa) {
    const reason = getWasmError();
    throw new Error(reason ? `签名模块未就绪：${reason}` : '签名模块未就绪，无法请求口袋接口');
  }
  const deviceId = await ensureDeviceId();
  const base = {
    ...createHeaders(token, pa, modern, deviceId),
    ...patch,
  };

  if (token && !preservePatch && !patch['X-Custom-Device-Type']) {
    const resolvedDeviceOverride =
      deviceIdOverride !== undefined
        ? deviceIdOverride
        : emptyDeviceTokens.has(token)
          ? ''
          : undefined;
    const profileHeaders = await createPocketProfileHeaders(
      'pocket48',
      token,
      pa,
      resolvedDeviceOverride,
    );
    return {
      ...base,
      ...profileHeaders,
    };
  }
  return base;
}

async function rawPost(
  url: string,
  data: unknown,
  options: {
    token?: string;
    modern?: boolean;
    headers?: HeadersMap;
    preserveHeaders?: boolean;
    signed?: boolean;
    timeout?: number;
    deviceIdOverride?: string;
  } = {},
): Promise<ApiEnvelope> {
  const token = options.token ?? tokenFromStore();
  const headers =
    options.signed === false
      ? {
          ...createHeaders(token, null, !!options.modern, await ensureDeviceId()),
          ...(options.headers || {}),
        }
      : await createSignedHeaders(
          token,
          !!options.modern,
          options.headers || {},
          !!options.preserveHeaders,
          options.deviceIdOverride,
        );
  const res = await xhrPost(url, data, headers, options.timeout);
  if (
    token &&
    options.signed !== false &&
    !options.preserveHeaders &&
    options.deviceIdOverride !== '' &&
    isDeviceMismatchTokenError(res)
  ) {
    const retryHeaders = await createSignedHeaders(
      token,
      !!options.modern,
      options.headers || {},
      false,
      '',
    );
    const retryRes = await xhrPost(url, data, retryHeaders, options.timeout);
    if (responseOk(retryRes)) {
      if (emptyDeviceTokens.size > 32) emptyDeviceTokens.clear();
      emptyDeviceTokens.add(token);
      return retryRes;
    }
  }
  return res;
}

async function signedHeaders(token?: string, modern = false, patch: HeadersMap = {}) {
  return createSignedHeaders(token ?? tokenFromStore(), modern, patch);
}

async function pocketPost(
  url: string,
  data: unknown,
  options: {
    tokenRequired?: boolean;
    modern?: boolean;
    headers?: HeadersMap;
    preserveHeaders?: boolean;
    fallback?: string;
    signed?: boolean;
    timeout?: number;
  } = {},
): Promise<ApiEnvelope> {
  const token = options.tokenRequired === false ? '' : requireToken();
  const res = await rawPost(url, data, {
    token,
    modern: options.modern,
    headers: options.headers,
    preserveHeaders: options.preserveHeaders,
    signed: options.signed !== false,
    timeout: options.timeout,
  });
  return assertPocketOk(res, options.fallback, options.tokenRequired !== false);
}

async function pocketGet(url: string, options: { modern?: boolean; fallback?: string } = {}) {
  const token = requireToken();
  const headers = await createSignedHeaders(token, !!options.modern, {});
  const res = await requestJson<ApiEnvelope>(url, { method: 'GET', headers, timeout: 15000 });
  return assertPocketOk(res, options.fallback);
}

function pushUniqueId(target: string[], value: unknown) {
  const text = String(value || '');
  if (!text || text === '0' || target.includes(text)) return;
  target.push(text);
}

function collectServerIdsForChannel(
  node: unknown,
  channelId: string,
  target: string[],
  depth = 0,
): void {
  if (!node || depth > 6) return;
  if (Array.isArray(node)) {
    node.forEach((item) => collectServerIdsForChannel(item, channelId, target, depth + 1));
    return;
  }
  if (typeof node !== 'object') return;
  const record = node as WireRecord;

  const nodeChannel = String(
    record.channelId ||
      record.roomId ||
      record.teamInfo?.channelId ||
      record.teamInfo?.roomId ||
      '',
  );
  if (nodeChannel === String(channelId)) {
    pushUniqueId(
      target,
      record.serverId || record.serverID || record.teamInfo?.serverId || record.teamInfo?.serverID,
    );
  }

  Object.entries(record).forEach(([key, value]) => {
    if (String(key) === String(channelId)) pushUniqueId(target, value);
    collectServerIdsForChannel(value, channelId, target, depth + 1);
  });
}

async function resolveServerIds(channelId: string): Promise<string[]> {
  const ids: string[] = [];
  try {
    const res = await pocketPost(`${BASE}/im/api/v1/im/team/room/info`, {
      channelId: String(channelId),
    });
    pushUniqueId(
      ids,
      res?.content?.serverId ||
        res?.content?.teamInfo?.serverId ||
        res?.data?.serverId ||
        res?.serverId,
    );
  } catch {}
  try {
    const res = await pocketPost(
      `${BASE}/im/api/v1/team/star/server/map/get`,
      {},
      {
        modern: true,
        fallback: 'get room server map failed',
      },
    );
    collectServerIdsForChannel(res, channelId, ids);
  } catch {}
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
  attempts: Array<{
    url: string;
    payload: unknown;
    modern?: boolean;
    tokenRequired?: boolean;
    signed?: boolean;
    headers?: HeadersMap;
    label: string;
  }>,
  fallback: string,
  opts: { perAttemptTimeout?: number; deadlineMs?: number } = {},
) {
  const errors: string[] = [];
  const startedAt = Date.now();
  for (let i = 0; i < attempts.length; i += 1) {
    const attempt = attempts[i];
    const remaining = opts.deadlineMs ? opts.deadlineMs - (Date.now() - startedAt) : undefined;
    if (remaining !== undefined && remaining <= 0) {
      errors.push(
        `[deadline] 超过 ${opts.deadlineMs}ms 预算，已停止（已试 ${i}/${attempts.length}）`,
      );
      break;
    }
    const timeout =
      remaining !== undefined
        ? Math.min(opts.perAttemptTimeout ?? 15000, Math.max(1000, remaining))
        : opts.perAttemptTimeout;
    try {
      const res = await pocketPost(attempt.url, attempt.payload, {
        modern: attempt.modern,
        tokenRequired: attempt.tokenRequired,
        signed: attempt.signed,
        headers: attempt.headers,
        fallback: `${fallback}: ${attempt.label}`,
        timeout,
      });
      return {
        ...res,
        _request: {
          label: attempt.label,
          payload: attempt.payload,
        },
      };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      errors.push(`${attempt.label}: ${msg}`);
      if (attempt.tokenRequired !== false && isPocketAuthError(msg)) {
        break;
      }
    }
  }
  throw new Error(errors.join('\n') || fallback);
}

function safeNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

type GiftEntry = {
  giftId: string;
  giftName: string;
  money: number;
  isPocketGift: number;
  stock: number;
  picPath: string;
};

export const pocketApi = {
  initWasm,
  generatePa,
  generatePaAsync,

  async loginSendSms(mobile: string, area = '86', answer?: string) {
    const cleanArea = String(area || '').replace(/[^0-9]/g, '') || '86';
    const payload: WireRecord = { mobile, area: cleanArea };
    if (answer !== undefined && String(answer).trim() !== '') {
      payload.answer = String(answer).trim();
    } else {
      payload.businessCode = 1;
      payload.intelligenceToken = '';
    }
    const data = await rawPost(`${BASE}/user/api/v2/sms/send_sms`, payload, {
      token: '',
      signed: true,
      headers: await createPocketLoginHeaders(),
    });
    if (data.status === 200 || data.success) return { success: true };
    if (data.status === 2001) {
      try {
        const verificationData = JSON.parse(String(data.message || ''));
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

  async loginByCode(mobile: string, code: string, area = '86') {
    const cleanArea = String(area || '').replace(/[^0-9]/g, '') || '86';
    return rawPost(
      `${BASE}/user/api/v2/login/app/app_login`,
      {
        mobileCodeLogin: { mobile, code, area: cleanArea },
        loginType: 'MOBILE_SMS_CODE',
        deviceToken: '',
      },
      { token: '', signed: true, headers: await createPocketLoginHeaders() },
    );
  },

  async registerByCode(mobile: string, code: string, area: string, encryptedPassword: string) {
    return rawPost(
      `${BASE}/user/api/v1/register/mobile`,
      { mobile, code, area, mobilePwd: encryptedPassword },
      { token: '', signed: true, headers: await createPocketLoginHeaders() },
    );
  },

  async loginByPassword(mobile: string, encryptedPassword: string) {
    const result = await rawPost(
      `${BASE}/user/api/v1/login/app/mobile`,
      {
        loginMobile: { mobile, pwd: encryptedPassword },
        loginType: 'MOBILE_PWD',
        intelligenceToken: '',
        deviceToken: '',
      },
      { token: '', signed: true, headers: await createPocketLoginHeaders() },
    );
    return assertPocketOk(result, '登录失败');
  },

  async loginCheckToken(tokenOverride?: string, deviceIdOverride?: string) {
    const token = tokenOverride !== undefined ? normalizePocketToken(tokenOverride) : '';
    const activeToken = token || requireToken();
    const preferredDeviceId = emptyDeviceTokens.has(activeToken)
      ? ''
      : deviceIdOverride?.trim() || undefined;
    const candidates: Array<{
      url: string;
      payload: unknown;
      headers?: HeadersMap;
      emptyDevice?: boolean;
    }> = [
      {
        url: `${BASE}/user/api/v1/user/info/reload`,
        payload: { from: 'appstart' },
        headers: await createPocketProfileHeaders('pocket48', undefined, null, preferredDeviceId),
        emptyDevice: preferredDeviceId === '',
      },
      ...(preferredDeviceId !== ''
        ? [
            {
              url: `${BASE}/user/api/v1/user/info/reload`,
              payload: { from: 'appstart' },
              headers: await createPocketProfileHeaders('pocket48', undefined, null, ''),
              emptyDevice: true,
            },
          ]
        : []),
      {
        url: `${BASE}/user/api/v1/user/info/reload`,
        payload: { from: 'appstart' },
        headers: createCheckinHeaders(),
      },
      {
        url: `${BASE}/user/api/v1/user/info/reload`,
        payload: { from: 'appstart' },
      },
      {
        url: `${BASE}/user/api/v1/user/info/reload`,
        payload: { from: 'appstart' },
        headers: createPocketAndroidHeaders(),
      },
      {
        url: `${BASE}/user/api/v1/user/info/home`,
        payload: {},
        headers: createPocketAndroidHeaders(),
      },
      {
        url: `${BASE}/user/api/v1/user/info/home`,
        payload: {},
        headers: createCheckinHeaders(),
      },
      {
        url: `${BASE}/user/api/v1/user/info/reload`,
        payload: { from: 'appstart' },
        headers: await createPocketProfileHeaders('seine48', undefined, null, preferredDeviceId),
      },
    ];
    const deadlineMs = 18000;
    const startedAt = Date.now();
    let firstError: unknown = null;
    for (const attempt of candidates) {
      const remaining = deadlineMs - (Date.now() - startedAt);
      if (remaining <= 0) break;
      try {
        const res = await rawPost(attempt.url, attempt.payload, {
          token: activeToken,
          signed: true,
          preserveHeaders: true,
          headers: attempt.headers,
          timeout: Math.min(8000, Math.max(1000, remaining)),
        });
        const okRes = assertPocketOk(res, 'Token 无效', true);
        if (attempt.emptyDevice) {
          if (emptyDeviceTokens.size > 32) emptyDeviceTokens.clear();
          emptyDeviceTokens.add(activeToken);
        }
        return okRes;
      } catch (err) {
        if (!firstError) firstError = err;
      }
    }
    throw firstError instanceof Error ? firstError : new Error('Token 无效');
  },

  async deleteTeamMsg(params: {
    accId: string;
    msgIdClient: string;
    channelId: string;
    msgTime: number;
  }) {
    return pocketPost(
      `${BASE}/im/api/v1/team/msg/delete`,
      {
        accId: String(params.accId || ''),
        msgIdClient: String(params.msgIdClient || ''),
        channelId: String(params.channelId || ''),
        msgTime: Number(params.msgTime) || 0,
      },
      { fallback: '删除消息失败' },
    );
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
    try {
      return await pocketPost(
        `${BASE}/user/api/v1/user/rename/count`,
        {},
        {
          modern: true,
          fallback: '获取改名次数失败',
        },
      );
    } catch {
      return pocketPost(
        `${BASE}/user/api/v1/user/rename/count`,
        {},
        {
          modern: true,
          preserveHeaders: true,
          fallback: '获取改名次数失败',
        },
      );
    }
  },

  async uploadUserAvatar(params: { uri: string; fileName?: string; mimeType?: string }) {
    const token = requireToken();
    const headers = await signedHeaders(token, true);
    delete headers['Content-Type'];
    delete headers.Host;
    const mimeType = params.mimeType || 'image/jpeg';
    const fileName =
      params.fileName || `avatar-${Date.now()}.${mimeType.includes('png') ? 'png' : 'jpg'}`;
    const formData = new FormData();
    formData.append('fromType', 'avatar');
    formData.append('file', {
      uri: params.uri,
      name: fileName,
      type: mimeType,
    } as unknown as Blob);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    let response: Response;
    try {
      response = await fetch('https://pfile.48.cn/filesystem/upload/image', {
        method: 'POST',
        headers,
        body: formData,
        signal: controller.signal,
      });
    } catch (error: unknown) {
      throw new Error(
        error instanceof Error && error.name === 'AbortError' ? '上传头像超时' : '上传头像网络失败',
      );
    } finally {
      clearTimeout(timer);
    }
    const contentType = response.headers.get('content-type') || '';
    const data = contentType.includes('application/json')
      ? parseMaybeJson(await response.text())
      : null;
    if (response.ok && data && (data.status === 200 || data.success)) {
      const item = Array.isArray(data.content) ? data.content[0] : data.content;
      const path = item?.path || item?.url || item?.filePath || '';
      if (!path) throw new Error('上传头像成功但没有返回图片路径');
      return { success: true, content: item, path };
    }
    const source = (data || {}) as WireRecord;
    throw new Error(String(source.message || source.msg || `上传失败 HTTP ${response.status}`));
  },

  async checkIn() {
    const res = await rawPost(
      `${BASE}/user/api/v1/checkin`,
      {},
      {
        token: requireToken(),
        modern: true,
        headers: { 'P-Sign-Type': 'V0' },
        signed: true,
      },
    );
    if (responseOk(res)) return res;
    const message = responseMessage(res, '签到失败');
    if (
      /\u5df2\u7b7e\u5230|\u91cd\u590d\u7b7e\u5230|\u5df2\u7ecf\u7b7e\u5230|\u5df2\u9886\u53d6|\u660e\u5929\u518d\u6765/.test(
        message,
      )
    ) {
      return {
        success: true,
        status: res?.status ?? res?.code ?? 200,
        message,
        content: res?.content || null,
        alreadyChecked: true,
      };
    }
    throw new Error(
      res?.status !== undefined || res?.code !== undefined
        ? `${message} (${res?.status ?? res?.code})`
        : message,
    );
  },

  async getCheckinToday() {
    return pocketPost(
      `${BASE}/user/api/v1/checkin/check/today`,
      {},
      {
        modern: true,
        fallback: '获取今日签到状态失败',
      },
    );
  },

  async getNimLoginInfo() {
    try {
      const res = await pocketPost(
        `${BASE}/im/api/v1/im/userinfo`,
        {},
        {
          headers: createCheckinHeaders(),
          fallback: '获取云信凭证失败',
        },
      );
      if (res?.content) return res;
    } catch {}
    return tryPocketPost(
      [
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
      ],
      'get self user info failed',
    );
  },

  async getUserProfile(userId: string) {
    const id = Number(String(userId || '').trim());
    if (!Number.isFinite(id) || id <= 0) throw new Error('missing userId');

    return tryPocketPost(
      [
        {
          url: `${BASE}/user/api/v1/user/info/home`,
          payload: { userId: id },
          headers: createPocketAndroidHeaders(),
          label: 'user home',
        },
        {
          url: `${BASE}/user/api/v1/user/info/home`,
          payload: { userId: id },
          modern: true,
          label: 'user home(ios)',
        },
        {
          url: `${BASE}/user/api/v1/user/info`,
          payload: { userId: id },
          label: 'user info',
        },
      ],
      'get user profile failed',
    );
  },

  async switchBigSmall(targetUserId: string) {
    return pocketPost(
      `${BASE}/user/api/v1/bigsmall/switch/user`,
      { toUserId: String(targetUserId) },
      { fallback: '切换账号失败' },
    );
  },

  async getStarServerMap() {
    return pocketPost(
      `${BASE}/im/api/v1/team/star/server/map/get`,
      {},
      {
        modern: true,
        fallback: '获取成员房间映射失败',
      },
    );
  },

  async getUserMoney() {
    return pocketPost(`${BASE}/user/api/v1/user/money`, {}, { fallback: '获取余额失败' });
  },

  async getGroupTeamStar(payload: WireRecord = {}) {
    return pocketPost(`${BASE}/user/api/v1/client/update/group_team_star`, payload || {}, {
      modern: true,
      tokenRequired: false,
      fallback: '获取官方成员列表失败',
    });
  },

  async getFollowedIds() {
    try {
      return await pocketPost(
        `${BASE}/user/api/v1/friendships/friends/id`,
        {},
        { headers: createCheckinHeaders(), fallback: '获取关注房间失败' },
      );
    } catch {
      return pocketPost(
        `${BASE}/user/api/v1/friendships/friends/id`,
        {},
        { headers: createCheckinHeaders(), preserveHeaders: true, fallback: '获取关注房间失败' },
      );
    }
  },

  async followMember(memberId: string) {
    return pocketPost(
      `${BASE}/user/api/v2/friendships/friends/add`,
      { toSourceId: safeNumber(memberId), toType: 1 },
      { headers: createCheckinHeaders(), fallback: '关注失败' },
    );
  },

  async unfollowMember(memberId: string) {
    return pocketPost(
      `${BASE}/user/api/v2/friendships/friends/remove`,
      { toSourceId: safeNumber(memberId), toType: 1 },
      { headers: createCheckinHeaders(), fallback: '取消关注失败' },
    );
  },

  async getLastMessages(serverIdList: number[]) {
    return pocketPost(
      `${BASE}/im/api/v1/team/classic/last/message/get`,
      {
        serverIdList: serverIdList.map(Number).filter((item) => Number.isFinite(item) && item > 0),
      },
      { fallback: '获取最新消息失败' },
    );
  },

  async getEssenceMessages(params: { channelId: string }) {
    const channelId = String(params.channelId || '');
    if (!channelId) throw new Error('missing channelId');
    return pocketPost(
      `${BASE}/im/api/v1/team/essence/message/list`,
      { channelId: String(channelId) },
      { fallback: '获取精华消息失败' },
    );
  },

  async getRoomMessages(params: {
    channelId: string;
    serverId: string;
    nextTime?: number;
    fetchAll?: boolean;
    limit?: number;
    fallbackChannelId?: string;
  }) {
    const channelId = String(params.channelId || '');
    const fallbackCid = params.fallbackChannelId ? String(params.fallbackChannelId) : '';
    const originalServerId = String(params.serverId || '');
    if (!channelId) throw new Error('missing channelId');

    const resolvedServerId =
      originalServerId && originalServerId !== '0' ? '' : await resolveServerId(channelId);
    const serverIds = [originalServerId, resolvedServerId]
      .map((item) => String(item || ''))
      .filter((item, index, arr) => item && item !== '0' && arr.indexOf(item) === index);
    if (serverIds.length) rememberServerId(channelId, serverIds[0]);

    const urls = params.fetchAll
      ? [
          { url: `${BASE}/im/api/v1/team/message/list/all`, mode: 'all' },
          { url: `${BASE}/im/api/v1/team/message/list/homeowner`, mode: 'owner-fallback' },
        ]
      : [{ url: `${BASE}/im/api/v1/team/message/list/homeowner`, mode: 'owner' }];
    const attempts: Array<{
      url: string;
      payload: WireRecord;
      modern?: boolean;
      signed?: boolean;
      label: string;
    }> = [];
    const limit = params.limit || 100;
    const next = params.nextTime || 0;

    const cids = [channelId, ...(fallbackCid && fallbackCid !== channelId ? [fallbackCid] : [])];
    for (const cid of cids) {
      const svrs = serverIds;
      for (const serverId of svrs.length ? svrs : ['']) {
        const sid = String(serverId || '');
        if (!sid || sid === '0') continue;
        for (const entry of urls) {
          attempts.push({
            url: entry.url,
            payload: {
              channelId: safeNumber(cid),
              serverId: safeNumber(sid),
              nextTime: next,
              limit,
            },
            label: `${entry.mode} num ch=${cid} srv=${sid}`,
          });
          attempts.push({
            url: entry.url,
            payload: { channelId: String(cid), serverId: String(sid), nextTime: next, limit },
            label: `${entry.mode} str ch=${cid} srv=${sid}`,
          });
          attempts.push({
            url: entry.url,
            payload: {
              channelId: safeNumber(cid),
              serverId: safeNumber(sid),
              nextTime: next,
              limit,
            },
            modern: true,
            label: `${entry.mode} mod ch=${cid} srv=${sid}`,
          });
        }
      }
    }
    if (!attempts.length) throw new Error('missing serverId');

    return tryPocketPost(attempts, 'get room messages failed', {
      perAttemptTimeout: 8000,
      deadlineMs: 24000,
    });
  },

  async getLatestRoomMessage(params: {
    channelId: string;
    serverId: string;
    fetchAll?: boolean;
    timeout?: number;
  }) {
    const channelId = String(params.channelId || '').trim();
    if (!channelId || channelId === '0') return null;
    const originalServerId = String(params.serverId || '').trim();
    const resolvedServerId =
      originalServerId && originalServerId !== '0'
        ? originalServerId
        : await resolveServerId(channelId);
    if (!resolvedServerId || resolvedServerId === '0') return null;
    if (!originalServerId || originalServerId === '0') {
      rememberServerId(channelId, resolvedServerId);
    }
    const url = params.fetchAll
      ? `${BASE}/im/api/v1/team/message/list/all`
      : `${BASE}/im/api/v1/team/message/list/homeowner`;
    return pocketPost(
      url,
      {
        channelId: safeNumber(channelId),
        serverId: safeNumber(resolvedServerId),
        nextTime: 0,
        limit: 1,
      },
      {
        timeout: params.timeout ?? 4500,
        fallback: 'get latest room message failed',
      },
    );
  },

  async resolveRoomServerId(channelId: string | number): Promise<string> {
    const cid = String(channelId || '');
    if (!cid) return '';
    try {
      const sid = await resolveServerId(cid);
      if (sid && sid !== '0') {
        rememberServerId(cid, sid);
        return sid;
      }
    } catch {}
    return '';
  },

  async getRoomInfo(channelId: string) {
    return pocketPost(
      `${BASE}/im/api/v1/im/team/room/info`,
      { channelId: String(channelId) },
      { fallback: '获取房间信息失败' },
    );
  },

  async getRoomMeta(
    channelId: string | number,
    fallbackChannelId?: string | number,
    serverId?: string | number,
  ) {
    const cid = String(channelId);

    let resolvedSid = serverId;
    if (!resolvedSid || String(resolvedSid) === '0' || String(resolvedSid) === '') {
      try {
        const s = await resolveServerId(cid);
        if (s && s !== '0') {
          resolvedSid = s;
          rememberServerId(cid, s);
        }
      } catch {}
    }

    const pickBg = (o: WireRecord | null | undefined): string => {
      if (!o) return '';
      return String(
        o.bgImg ||
          o.bgImgUrl ||
          o.backgroundImg ||
          o.backgroundImgUrl ||
          o.backImg ||
          o.backImgUrl ||
          o.homeBgImg ||
          o.homeBgImgUrl ||
          o.bannerUrl ||
          o.serverBgWallImg ||
          '',
      );
    };
    const tryRoomInfo = async (target: string): Promise<{ name: string; bg: string }> => {
      const res = await this.getRoomInfo(target).catch(() => null);
      const content = (res?.content || res?.data || {}) as WireRecord;
      if (res?.status && Number(res.status) !== 200) return { name: '', bg: '' };
      const ci = content.channelInfo || {};
      let name = String(ci.channelName || '');
      let bg = pickBg(ci);
      if (!name && Array.isArray(content.channelInfoList)) {
        const hit = (content.channelInfoList as WireRecord[]).find(
          (c) => String(c?.channelId) === target,
        );
        if (hit) {
          name = String(hit.channelName || '');
          bg = pickBg(hit);
        }
      }
      if (!bg) bg = pickBg(content.userChatConfig as WireRecord);
      if (!bg && Array.isArray(content.channelInfoList)) {
        const anyHit = (content.channelInfoList as WireRecord[]).find(
          (c) => String(c?.channelId) === target,
        );
        if (anyHit) bg = pickBg(anyHit);
      }
      return { name, bg: bg ? normalizeUrl(bg) : '' };
    };
    let meta = await tryRoomInfo(cid);
    if (
      (!meta.bg || (!meta.name && !meta.bg)) &&
      resolvedSid !== undefined &&
      resolvedSid !== null &&
      String(resolvedSid) !== '' &&
      String(resolvedSid) !== '0'
    ) {
      try {
        const res = await this.getSeineServerDetail(Number(resolvedSid)).catch(() => null);
        const content = (res?.content || res?.data || {}) as WireRecord;
        const list: WireRecord[] = Array.isArray(content.channelInfoList)
          ? (content.channelInfoList as WireRecord[])
          : [];
        const hit =
          list.find((c) => String(c?.channelId) === cid) ||
          (fallbackChannelId !== undefined && fallbackChannelId !== null
            ? list.find((c) => String(c?.channelId) === String(fallbackChannelId))
            : undefined);
        const si = content.chatServerInfo || {};
        const bg = meta.bg || pickBg(hit) || pickBg(si);
        if (hit || bg) {
          meta = {
            name: meta.name || (hit ? String(hit.channelName || '') : ''),
            bg: bg ? normalizeUrl(String(bg)) : meta.bg || '',
          };
        }
      } catch {}
    }

    if (
      !meta.name &&
      !meta.bg &&
      fallbackChannelId !== undefined &&
      fallbackChannelId !== null &&
      String(fallbackChannelId) !== cid
    ) {
      const fb = await tryRoomInfo(String(fallbackChannelId)).catch(() => ({ name: '', bg: '' }));
      if (fb.bg) meta = { name: meta.name || fb.name, bg: fb.bg };
    }
    return meta;
  },

  async getRoomAlbum(params: { channelId: string; nextTime?: number }) {
    return pocketPost(
      `${BASE}/im/api/v1/team/msg/list/img`,
      {
        channelId: String(params.channelId),
        nextTime: params.nextTime || 0,
      },
      { fallback: '获取房间相册失败' },
    );
  },

  async getPrivateMessageList(lastTime?: number) {
    return pocketPost(
      `${BASE}/message/api/v1/user/message/list`,
      {
        lastTime: Number(lastTime) || Date.now(),
      },
      { modern: true, fallback: '获取私信列表失败' },
    );
  },

  async getRoomExpressionList(ownerId: string, serverType: number) {
    return pocketPost(
      `${BASE}/im/api/v2/auth/manager/getExpressionList`,
      {
        ownerId: String(ownerId),
        serverType: Number(serverType) || 0,
      },
      { modern: true, fallback: '获取房间表情包失败' },
    );
  },

  async getPrivateMessageDetail(targetUserId: string, lastTime = 0) {
    return pocketPost(
      `${BASE}/message/api/v1/user/message/info`,
      {
        lastTime: Number(lastTime) || 0,
        targetUserId: String(targetUserId),
      },
      { modern: true, fallback: '获取私信详情失败' },
    );
  },

  async sendPrivateMessageReply(targetUserId: string, text: string) {
    return pocketPost(
      `${BASE}/message/api/v1/user/message/reply`,
      {
        messageType: 'TEXT',
        text: String(text),
        targetUserId: String(targetUserId),
      },
      { modern: true, fallback: '发送私信失败' },
    );
  },

  async getFlipList(beginLimit = 0, limit = 20) {
    return pocketPost(
      `${BASE}/idolanswer/api/idolanswer/v1/user/question/list`,
      {
        status: 0,
        beginLimit,
        limit,
        memberId: '',
      },
      { fallback: '获取翻牌记录失败' },
    );
  },

  async getFlipPrices(memberId: string) {
    return pocketPost(
      `${BASE}/idolanswer/api/idolanswer/v2/custom/index`,
      {
        memberId: String(memberId),
      },
      { fallback: '获取翻牌类型失败' },
    );
  },

  async sendFlipQuestion(payload: WireRecord) {
    return pocketPost(`${BASE}/idolanswer/api/idolanswer/v1/user/question`, payload, {
      fallback: '发送翻牌失败',
    });
  },

  async operateFlipQuestion(questionId: string, operateType = 1) {
    return pocketPost(
      `${BASE}/idolanswer/api/idolanswer/v1/user/question/operate`,
      {
        questionId: String(questionId),
        operateType,
      },
      { fallback: '操作翻牌失败' },
    );
  },

  async getStarArchives(memberId: number): Promise<any> {
    return pocketPost(
      `${BASE}/user/api/v1/user/star/archives`,
      { memberId: Number(memberId) },
      { tokenRequired: false, fallback: '获取成员档案失败' },
    );
  },

  async getStarHistory(memberId: number) {
    return pocketPost(
      `${BASE}/user/api/v1/user/star/history`,
      {
        memberId: Number(memberId),
        limit: 100,
        lastTime: 0,
      },
      { tokenRequired: false, fallback: '获取成员历史失败' },
    );
  },

  async getOpenLive(params: { memberId: string; nextTime?: number }) {
    const memberId = String(params.memberId || '');
    if (!memberId) throw new Error('missing memberId');
    return tryPocketPost(
      [
        {
          url: `${BASE}/im/api/v1/chatroom/msg/list/aim/type`,
          payload: {
            extMsgType: 'OPEN_LIVE',
            roomId: '',
            ownerId: memberId,
            nextTime: Number(params.nextTime) || 0,
          },
          label: 'openlive',
        },
        {
          url: `${BASE}/im/api/v1/chatroom/msg/list/aim/type`,
          payload: {
            extMsgType: 'OPEN_LIVE',
            roomId: '',
            ownerId: memberId,
            nextTime: Number(params.nextTime) || 0,
          },
          signed: false,
          label: 'openlive unsigned',
        },
      ],
      '获取成员公演失败',
    );
  },

  async getOpenLiveOne(liveId: string) {
    const id = String(liveId);
    return tryPocketPost(
      [
        {
          url: `${BASE}/live/api/v1/live/getOpenLiveOne`,
          payload: { liveId: id },
          tokenRequired: false,
          label: 'open live one',
        },
        {
          url: `${BASE}/live/api/v1/live/getOpenLiveOne`,
          payload: { liveId: id, streamProtocol: 'FLV' },
          tokenRequired: false,
          label: 'open live one flv',
        },
        {
          url: `${BASE}/live/api/v1/live/getOpenLiveOne`,
          payload: { liveId: id, streamProtocol: 'HLS' },
          tokenRequired: false,
          label: 'open live one hls',
        },
      ],
      '获取公演详情失败',
    );
  },

  async getRoomFlipUser(questionId: string, answerId: string) {
    if (!/^[1-9]\d{0,31}$/.test(questionId) || !/^[1-9]\d{0,31}$/.test(answerId))
      throw new Error('翻牌编号无效');
    return pocketPost(
      `${BASE}/idolanswer/api/idolanswer/v1/question_answer/detail`,
      { questionId, answerId },
      { fallback: '获取翻牌提问者失败' },
    );
  },

  async getOpenLiveMemberRank(liveId: string) {
    if (!liveId) throw new Error('缺少公演 ID');
    return pocketPost(
      `${BASE}/live/api/v1/live/getOpenLiveMemberRank`,
      { liveId },
      { fallback: '获取公演成员失败' },
    );
  },

  async getLiveOne(liveId: string) {
    const id = String(liveId);
    return tryPocketPost(
      [
        {
          url: `${BASE}/live/api/v1/live/getLiveOne`,
          payload: { liveId: id },
          tokenRequired: false,
          label: 'live one',
        },
        {
          url: `${BASE}/live/api/v1/live/getLiveOne`,
          payload: { liveId: id, streamProtocol: 'FLV' },
          tokenRequired: false,
          label: 'live one flv',
        },
        {
          url: `${BASE}/live/api/v1/live/getLiveOne`,
          payload: { liveId: id, streamProtocol: 'HLS' },
          tokenRequired: false,
          label: 'live one hls',
        },
      ],
      '获取直播详情失败',
    );
  },

  async getLiveChatroom(liveId: string): Promise<{
    roomId: string;
    sourceId: string;
    title: string;
    audience?: string;
    rankAvatars?: string[];
    hostId?: string;
    hostName?: string;
    hostAvatar?: string;
    pkInfo?: { active: boolean; pkId?: string; users: any[] };
  } | null> {
    const id = String(liveId || '');
    if (!id) return null;
    try {
      const res = await pocketApi.getLiveOne(id);
      const content = ((res && (res.content || res.data)) || {}) as WireRecord;
      const roomId = String(content.roomId || content.chatroomId || content.chatRoomId || '');
      const rawPk =
        content.pkInfo && typeof content.pkInfo === 'object'
          ? (content.pkInfo as WireRecord)
          : null;
      const pkUsers = Array.isArray(rawPk?.pkUserInfoList) ? rawPk.pkUserInfoList : [];
      const pkIdRaw =
        rawPk?.pkId !== undefined && rawPk?.pkId !== null ? String(rawPk.pkId).trim() : '';
      const pkActive = Boolean(rawPk?.inMicrophonePkConnection) && pkUsers.length > 0;
      return {
        roomId,
        sourceId: id,
        title: String(content.title || content.liveTitle || ''),
        hostId:
          pickText(content, ['user.userId', 'user.id', 'userId', 'ownerId', 'starId']) || undefined,
        hostName:
          pickText(content, [
            'user.userName',
            'user.nickName',
            'user.nickname',
            'nickname',
            'ownerName',
          ]) || undefined,
        hostAvatar:
          pickText(content, ['user.userAvatar', 'user.avatar', 'avatar', 'headImg']) || undefined,
        audience:
          pickText(content, ['onlineNum', 'onlineCount', 'onlineUserCount', 'viewerCount']) ||
          undefined,
        rankAvatars: Array.isArray(content.topUser)
          ? (content.topUser as WireRecord[])
              .slice(0, 3)
              .map((row) =>
                normalizeUrl(
                  pickText(row, ['user.userAvatar', 'user.avatar', 'userInfo.avatar', 'avatar']),
                ),
              )
              .filter(Boolean)
          : undefined,
        ...(pkActive
          ? {
              pkInfo: {
                active: true,
                pkId: pkIdRaw && pkIdRaw !== '0' ? pkIdRaw : undefined,
                users: pkUsers,
              },
            }
          : {}),
      };
    } catch {
      return null;
    }
  },

  async getLiveBarrage(liveId: string): Promise<
    Array<{
      messageId: string;
      content: string;
      color: string;
      time: number;
      user: string;
      userId?: string;
      avatar?: string;
      level?: number;
    }>
  > {
    const id = String(liveId || '');
    if (!id) return [];
    try {
      const res = await tryPocketPost(
        [
          {
            url: `${BASE}/live/api/v1/live/barrage/list`,
            payload: { liveId: id, time: 0 },
            tokenRequired: false,
            label: 'barrage',
          },
          {
            url: `${BASE}/live/api/v1/live/barrage/list`,
            payload: { liveId: id, lastTime: 0 },
            tokenRequired: false,
            label: 'barrage lastTime',
          },
        ],
        '获取弹幕失败',
      );
      const infos = unwrapList(res, [
        'content.barrageInfos',
        'content.list',
        'content.data',
        'barrageInfos',
        'data.barrageInfos',
        'list',
      ]) as WireRecord[];
      return infos.map((b) => ({
        messageId: String(b.messageId || b.id || ''),
        content: String(b.content || b.msg || b.text || ''),
        color: String(b.color || ''),
        time: Number(b.time || b.t || 0) || 0,
        user:
          pickText(b, [
            'user.nickName',
            'user.nickname',
            'user.userName',
            'userInfo.nickName',
            'userInfo.nickname',
            'userInfo.userName',
            'nickName',
            'userName',
            'name',
          ]) || (typeof b.user === 'string' ? b.user : ''),
        userId:
          pickText(b, [
            'user.userId',
            'user.id',
            'userInfo.userId',
            'userInfo.id',
            'userId',
            'uid',
          ]) || undefined,
        avatar:
          pickText(b, [
            'user.avatar',
            'user.userAvatar',
            'user.avatarUrl',
            'user.headImg',
            'userInfo.avatar',
            'userInfo.userAvatar',
            'userInfo.avatarUrl',
            'userInfo.headImg',
            'avatar',
            'userAvatar',
            'avatarUrl',
            'headImg',
          ]) || undefined,
        level:
          Number(
            b.user?.level ??
              b.user?.userLevel ??
              b.userInfo?.level ??
              b.userInfo?.userLevel ??
              b.level ??
              b.userLevel,
          ) || undefined,
      }));
    } catch {
      return [];
    }
  },

  async getLiveLrc(liveId: string): Promise<string | null> {
    const id = String(liveId || '');
    if (!id) return null;
    try {
      const one: ApiEnvelope = await pocketApi.getLiveOne(id);
      const content = ((one && (one.content || one)) || {}) as WireRecord;
      const lrcUrl: string = String(content.msgFilePath || content.lrcUrl || '');
      if (!lrcUrl) return null;
      const url = /^https?:\/\//i.test(lrcUrl)
        ? lrcUrl
        : `${BASE}${lrcUrl.startsWith('/') ? '' : '/'}${lrcUrl}`;
      const res = await fetchWithTimeout(url, {}, 10000);
      if (!res.ok) return null;
      const text = await res.text();
      return text && text.trim() ? text : null;
    } catch {
      return null;
    }
  },

  async getOpenLivePublicList(params: { groupId?: number; next?: number; record?: boolean }) {
    return pocketPost(
      `${BASE}/live/api/v1/live/getOpenLiveList`,
      {
        groupId: params.groupId ?? 0,
        debug: false,
        next: params.next ?? 0,
        record: !!params.record,
      },
      { tokenRequired: false, fallback: '获取公演列表失败' },
    );
  },

  async getMemberPhotos(memberId: string, page = 0, size = 20) {
    return pocketPost(
      `${BASE}/idolanswer/api/idolanswer/v1/user/nft/user_nft_list`,
      {
        starId: safeNumber(memberId),
        size,
        page,
      },
      { tokenRequired: false, fallback: '获取个人相册失败' },
    );
  },

  async getLiveList(params: {
    groupId?: number;
    liveType?: number;
    page?: number;
    record?: boolean;
    debug?: boolean;
    next?: number;
    size?: number;
    userId?: number | string;
  }) {
    const payload: WireRecord = {
      groupId: params.groupId ?? 0,
      debug: params.debug ?? false,
      liveType: params.liveType ?? 0,
      next: params.next ?? 0,
      record: params.record ?? false,
    };

    if (params.userId !== undefined && params.userId !== null && params.userId !== '') {
      payload.userId = Number(params.userId) || String(params.userId);
    }
    if (params.page !== undefined) payload.page = params.page;
    if (params.size !== undefined) payload.size = params.size;
    return pocketPost(`${BASE}/live/api/v1/live/getLiveList`, payload, {
      tokenRequired: false,
      fallback: '获取直播列表失败',
    });
  },

  async serverSearch(searchContent: string) {
    return pocketPost(
      `${BASE}/im/api/v1/im/server/search`,
      { searchContent: String(searchContent || '').trim() },
      { fallback: '搜索失败' },
    );
  },

  async serverJump(starId: number | string) {
    return pocketPost(
      `${BASE}/im/api/v1/im/server/jump`,
      { starId: Number(starId), targetType: 1 },
      { fallback: '获取房间信息失败' },
    );
  },

  async operateRoomVoice(params: { channelId: string; serverId: string }) {
    const channelId = String(params.channelId || '');
    let serverId = String(params.serverId || '');
    if (!serverId || serverId === '0') serverId = await resolveServerId(channelId);
    rememberServerId(channelId, serverId);
    return pocketPost(
      `${BASE}/im/api/v1/team/voice/operate`,
      {
        channelId: safeNumber(channelId),
        serverId: safeNumber(serverId),
        operateCode: 2,
      },
      { fallback: '获取房间电台失败' },
    );
  },

  async sendGift(params: {
    giftId: string;
    liveId: string;
    acceptUserId: string;
    giftNum?: number;
    crm?: string;
    businessCode?: number;
  }) {
    return pocketPost(
      `${BASE}/gift/api/v1/gift/send`,
      {
        giftId: String(params.giftId),
        acceptUserId: String(params.acceptUserId),
        giftNum: Number(params.giftNum) || 1,
        businessCode: Number(params.businessCode ?? 0),
        businessId: String(params.liveId),
        isPocketGift: 0,
        ...(params.crm ? { crm: String(params.crm) } : {}),
      },
      { modern: true, fallback: '送礼失败' },
    );
  },

  async getGiftList(liveId: string) {
    return pocketPost(
      `${BASE}/gift/api/v1/gift/list`,
      {
        businessId: String(liveId),
        giftType: 1,
      },
      { fallback: '获取礼物列表失败' },
    );
  },

  async getLiveGiftList(liveId: string, memberId: string) {
    return pocketPost(
      `${BASE}/gift/api/v1/gift/list`,
      {
        memberId: String(memberId),
        businessCode: 1,
        liveId: Number(liveId) || String(liveId),
      },
      { fallback: '获取礼物列表失败' },
    );
  },

  async getScoreGiftListByMember(memberId: string) {
    return pocketPost(
      `${BASE}/gift/api/v1/gift/list`,
      {
        memberId: String(memberId),
        businessCode: 5,
        giftType: 2,
      },
      { fallback: '获取礼物列表失败' },
    );
  },

  async getGiftListByType(liveId: string, giftType = 1) {
    return pocketPost(
      `${BASE}/gift/api/v1/gift/list`,
      {
        businessId: String(liveId),
        giftType,
      },
      { fallback: '获取礼物列表失败' },
    );
  },

  async getGiftListByMember(memberId: string) {
    return pocketPost(
      `${BASE}/gift/api/v1/gift/list`,
      {
        memberId: String(memberId),
        businessCode: 5,
      },
      { fallback: '获取礼物列表失败' },
    );
  },

  async getMemberRoomGiftContext(params: {
    serverId: string;
    channelId: string;
    bigChannelId?: string;
    memberId?: string;
  }) {
    const serverId = String(params.serverId || '');
    const channelId = String(params.channelId || '');
    if (!/^\d+$/.test(serverId) || !/^\d+$/.test(channelId)) throw new Error('缺少有效的房间 ID');

    const infoChannelId = String(params.bigChannelId || '') || channelId;
    let info: WireRecord | null = null;
    let sendGiftOk = true;
    try {
      const room: ApiEnvelope = await pocketPost(
        `${BASE}/im/api/v1/im/team/room/info`,
        { channelId: infoChannelId },
        { fallback: '获取房间信息失败' },
      );
      info = (room?.content?.channelInfo || null) as WireRecord | null;
      if (info) {
        if (String(info.serverId) !== serverId) throw new Error('房间信息已变化，请重新打开房间');
        if (Number(info.serverType) === 0)
          throw new Error('队伍房间暂不支持选择收礼成员，请进入成员房间送礼');
        sendGiftOk = room?.content?.userFunction?.sendGift !== false;
      }
    } catch (e: unknown) {
      if (!params.memberId) throw e;
      info = null;
    }
    if (!sendGiftOk) throw new Error('当前账号在此房间暂不能送礼');
    const memberId = String(info?.ownerId || params.memberId || '');
    if (!/^\d+$/.test(memberId)) throw new Error('缺少有效的收礼成员 ID');
    const account: ApiEnvelope = await pocketPost(
      `${BASE}/user/api/v1/user/info/reload`,
      { from: 'appstart' },
      { fallback: '获取账号信息失败' },
    );
    const userRole = Number(
      account?.content?.userInfo?.userRole ?? account?.content?.userRole ?? 0,
    );
    const [giftRes, receiveRes, moneyRes] = await Promise.all([
      pocketPost(
        `${BASE}/gift/api/v1/gift/list`,
        { memberId, businessCode: 5 },
        { fallback: '获取礼物列表失败' },
      ),
      pocketPost(
        `${BASE}/gift/api/v1/gift/get_receive_gift_state`,
        {
          moduleType: 2,
          starIds: memberId,
          msgType: [2, 3, 4, 5].includes(userRole) ? 2 : 1,
        },
        { fallback: '获取收礼状态失败' },
      ),
      pocketPost(`${BASE}/user/api/v1/user/money`, {}, { fallback: '获取余额失败' }),
    ]);
    const receive = receiveRes?.content || {};
    if (Number(receive.receiveGiftStatus) !== 1) {
      throw new Error(String(receive.receiveGiftTips || '该成员暂不能接收礼物'));
    }
    const moneyTotal = Number(moneyRes?.content?.moneyTotal);
    const groups: WireRecord[] = Array.isArray(giftRes?.content)
      ? (giftRes.content as WireRecord[])
      : ([giftRes?.content || {}] as WireRecord[]);
    const gifts: GiftEntry[] = [];
    const seen = new Set<string>();
    for (const group of groups) {
      if (!group || Number(group.typeId) === 888) continue;
      const giftList: WireRecord[] = Array.isArray(group.giftList)
        ? (group.giftList as WireRecord[])
        : [];
      for (const g of giftList) {
        const giftId = String(g.giftId ?? '');
        const price = Number(g.money);
        const isPocketGift = Number(g.isPocketGift || 0);
        const stock = Number(g.giftTotal || 0);
        const key = `${giftId}:${isPocketGift}`;
        if (
          !/^\d+$/.test(giftId) ||
          seen.has(key) ||
          Number(g.typeId) === 888 ||
          g.isVote === true ||
          Number(g.isVote) === 1 ||
          !Number.isSafeInteger(price) ||
          price < 0 ||
          ![0, 1].includes(isPocketGift) ||
          (isPocketGift === 1 && !(stock > 0))
        )
          continue;
        seen.add(key);
        gifts.push({
          giftId,
          giftName: String(g.giftName || '礼物'),
          money: price,
          isPocketGift,
          stock,
          picPath: String(g.picPath || ''),
        });
      }
    }
    return {
      target: {
        serverId,
        channelId,
        memberId,
        memberName: String(info?.ownerName || params.memberId || ''),
      },
      gifts,
      balance: Number.isFinite(moneyTotal) && moneyTotal >= 0 ? moneyTotal : null,
    };
  },

  async sendMemberRoomGift(params: {
    serverId: string;
    channelId: string;
    giftId: string;
    giftNum: number;
    isPocketGift?: number;
    unitPrice?: number;
    acceptUserId?: string;
    bigChannelId?: string;
    memberId?: string;
  }) {
    const ctx = await this.getMemberRoomGiftContext({
      serverId: params.serverId,
      channelId: params.channelId,
      bigChannelId: String(params.bigChannelId || '') || params.channelId,
      memberId: String(params.memberId || '') || params.acceptUserId || '',
    });
    if (params.acceptUserId && String(params.acceptUserId) !== ctx.target.memberId) {
      throw new Error('收礼成员已变化，请重新选择礼物');
    }
    const gift = ctx.gifts.find(
      (g) =>
        String(g.giftId) === String(params.giftId) &&
        Number(g.isPocketGift) === Number(params.isPocketGift || 0),
    );
    if (!gift) throw new Error('该礼物已不可用，请重新打开礼物面板');
    if (gift.money !== Number(params.unitPrice)) throw new Error('礼物价格已变化，请重新选择');
    if (
      gift.isPocketGift === 1
        ? params.giftNum > gift.stock
        : gift.money * params.giftNum > (ctx.balance ?? Number.POSITIVE_INFINITY)
    ) {
      throw new Error(gift.isPocketGift === 1 ? '背包礼物数量不足' : '鸡腿余额不足');
    }
    const res: ApiEnvelope = await pocketPost(
      `${BASE}/gift/api/v1/gift/send`,
      {
        acceptUserId: ctx.target.memberId,
        giftId: gift.giftId,
        giftNum: Number(params.giftNum),
        businessCode: 5,
        businessId: ctx.target.serverId,
        sendToRoomId: ctx.target.channelId,
        isPocketGift: gift.isPocketGift,
      },
      { modern: true, fallback: '送礼未成功，请检查余额和房间记录' },
    );
    const content = res?.content || {};
    const explicitEmpty = content.giftNum != null && !(Number(content.giftNum) > 0);
    if (explicitEmpty) throw new Error('官方未确认有效赠送，请检查余额和房间记录');
    return {
      balance:
        content.money != null && Number.isFinite(Number(content.money))
          ? Number(content.money)
          : null,
      target: ctx.target,
    };
  },

  async getLiveRank(liveId: string) {
    return pocketPost(
      `${BASE}/live/api/v2/live/getLiveRank`,
      {
        type: 1,
        liveId: String(liveId),
      },
      { fallback: '获取直播榜单失败' },
    );
  },

  async getLiveResult(liveId: string) {
    return pocketPost(
      `${BASE}/live/api/v1/live/result`,
      {
        liveId: String(liveId),
      },
      { tokenRequired: false, fallback: '获取直播结果失败' },
    );
  },

  async getTripList(
    params: {
      groupId?: number;
      memberId?: string;
      userId?: string;
      lastTime?: string;
      isMore?: boolean;
    } = {},
  ) {
    const payload: WireRecord = {
      lastTime: String(params.lastTime || '0'),
      groupId: Number(params.groupId) || 0,
      isMore: !!params.isMore,
    };
    if (params.memberId) payload.memberId = String(params.memberId);
    if (params.userId) payload.userId = String(params.userId);
    return pocketPost(`${BASE}/trip/api/trip/v1/list`, payload, { fallback: '获取行程失败' });
  },

  async getMeleeWeekRank(rankId: number, nextId?: string) {
    const payload: WireRecord = { rankId: Number(rankId) || 0 };
    if (nextId) payload.nextId = nextId;
    return pocketPost(`${BASE}/gift/api/v1/melee/rank/getMeleeWeekRank`, payload, {
      fallback: '获取乱斗周榜失败',
    });
  },

  async getMeleeRankPage(rankId?: number, nextId?: string) {
    const payload: WireRecord = {};
    if (rankId !== undefined && rankId !== null) payload.rankid = Number(rankId) || 0;
    if (nextId) payload.nextId = nextId;
    return pocketPost(`${BASE}/gift/api/v1/melee/rank/getMeleeRankPage`, payload, {
      fallback: '获取乱斗榜单失败',
    });
  },

  async getPersonMeleeRankPage(resId: number) {
    return pocketPost(
      `${BASE}/gift/api/v1/melee/rank/getPersonMeleeRankPage`,
      {
        resId: Number(resId) || 0,
      },
      { fallback: '获取成员鸡腿贡献榜失败' },
    );
  },

  async getMemberDynamic(params: { ownerId: string; nextTime?: number; roomId?: string }) {
    return pocketPost(
      `${BASE}/im/api/v1/chatroom/msg/list/aim/type`,
      {
        extMsgType: 'POST_INFO',
        roomId: String(params.roomId || ''),
        ownerId: String(params.ownerId),
        nextTime: Number(params.nextTime) || 0,
      },
      { fallback: '获取成员动态失败', headers: createWeiboHeaders(requireToken()) },
    );
  },

  async getMemberWeibo(params: { ownerId: string; nextTime?: number; roomId?: string }) {
    return pocketPost(
      `${BASE}/im/api/v1/chatroom/msg/list/aim/type`,
      {
        extMsgType: 'WEI_BO',
        roomId: String(params.roomId || ''),
        ownerId: String(params.ownerId),
        nextTime: Number(params.nextTime) || 0,
      },
      { fallback: '获取成员微博失败', headers: createWeiboHeaders(requireToken()) },
    );
  },

  async getMemberPostImages(userId: string, nextTime = 0) {
    return pocketPost(
      `${BASE}/posts/api/v1/posts/img/list`,
      {
        userId: String(userId),
        nextTime: Number(nextTime) || 0,
      },
      { fallback: '获取成员图片动态失败' },
    );
  },

  async getConversationPage(nextTime = 0, limit = 20) {
    return pocketPost(
      `${BASE}/im/api/v1/conversation/page`,
      {
        nextTime: Number(nextTime) || 0,
        limit: Number(limit) || 20,
      },
      { modern: true, fallback: '获取会话列表失败' },
    );
  },

  async getUserHomeInfo(userId?: string | number) {
    const payload: WireRecord = {};
    if (userId !== undefined && userId !== null && userId !== '') payload.userId = String(userId);
    return pocketPost(`${BASE}/user/api/v1/user/info/home`, payload, {
      modern: true,
      fallback: '获取用户主页信息失败',
    });
  },

  async getUnreadMessageCount() {
    return pocketPost(
      `${BASE}/message/api/v1/unread/message/num`,
      {},
      {
        modern: true,
        fallback: '获取未读消息数失败',
      },
    );
  },

  async getUserPictureFrames() {
    return pocketPost(
      `${BASE}/user/api/v1/user/get/picture/frame`,
      {},
      {
        modern: true,
        fallback: '获取头像框失败',
      },
    );
  },

  async setUserPictureFrame(pfId: number) {
    return pocketPost(
      `${BASE}/user/api/v1/user/modify/picture/frame`,
      { pfId },
      {
        modern: true,
        fallback: '设置口袋账号头像框失败',
      },
    );
  },

  async getUserBadges() {
    return pocketPost(
      `${BASE}/user/api/v1/user/badge`,
      {},
      {
        modern: true,
        fallback: '获取勋章失败',
      },
    );
  },

  async getRoomBubbles() {
    return pocketPost(
      `${BASE}/im/api/v1/room/bubbleList`,
      {},
      {
        modern: true,
        fallback: '获取口袋官方消息气泡失败',
      },
    );
  },

  async setRoomBubble(bubbleId: string) {
    return pocketPost(
      `${BASE}/im/api/v1/room/chooseBubble`,
      { bubbleId: String(bubbleId) },
      {
        modern: true,
        fallback: '设置口袋官方消息气泡失败',
      },
    );
  },

  async getLiveAllSpecialEffects() {
    return pocketGet(`${BASE}/live/api/v1/live/get/all/specialeffects`, {
      fallback: '获取直播进场特效失败',
    });
  },

  async setLiveSpecialEffect(specialEffectsId: string, enabled = true) {
    return pocketPost(
      `${BASE}/live/api/v1/live/update/user/use/specialeffect`,
      {
        operation: enabled ? 1 : 0,
        specialEffectId: String(specialEffectsId),
      },
      { fallback: '设置直播进场特效失败' },
    );
  },

  async getLiveAllBubbles() {
    return pocketGet(`${BASE}/live/api/v1/live/get_live_all_bubble`, {
      fallback: '获取直播弹幕气泡失败',
    });
  },

  async setLiveBubble(bubbleId: string) {
    return pocketPost(
      `${BASE}/live/api/v1/live/edit_live_my_bubble`,
      { bubbleId: String(bubbleId) },
      {
        fallback: '设置直播弹幕气泡失败',
      },
    );
  },

  async getMediaCollectionTotalCount() {
    return pocketPost(
      `${BASE}/media/api/media/v1/getCollectionTotalCount`,
      {},
      {
        modern: true,
        fallback: '获取收藏统计失败',
      },
    );
  },

  async getFlipCustomIndexV1(memberId: string) {
    return pocketPost(
      `${BASE}/idolanswer/api/idolanswer/v1/custom/index`,
      {
        memberId: String(memberId),
      },
      { tokenRequired: false, fallback: '获取翻牌配置失败' },
    );
  },

  async getInvoiceTips() {
    const res = await requestJson<ApiEnvelope>(`${BASE}/invoice/api/v1/invoice/tips`, {
      method: 'GET',
      headers: createInvoiceHeaders(),
    });
    return assertPocketOk(res, '获取开票提示失败');
  },

  async getInvoiceConfig() {
    return pocketPost(
      `${BASE}/invoice/api/v1/invoice/config`,
      {},
      {
        headers: createInvoiceHeaders(requireToken(), { tokenHeader: true }),
        fallback: '获取开票配置失败',
      },
    );
  },

  async getInvoiceOrderList(nextTime = '', yearMonth = '') {
    const token = requireToken();
    return pocketPost(
      `${BASE}/invoice/api/v1/order/list`,
      {
        nextTime: String(nextTime || '0'),
        token,
        yearMonth: String(yearMonth || ''),
      },
      {
        headers: createInvoiceHeaders(),
        fallback: '获取可开票订单失败',
      },
    );
  },

  async applyElectronicInvoice(params: {
    buyerType?: number;
    buyerName?: string;
    buyerTaxNo?: string;
    buyerAddress?: string;
    buyerPhone?: string;
    buyerBankName?: string;
    buyerBankAccount?: string;
    notifyEmail?: string;
    notifyMobile?: string;
    orderDataId?: string[];
  }) {
    const token = requireToken();
    const ids = (params.orderDataId || []).map((item) => String(item || '').trim()).filter(Boolean);
    if (!ids.length) throw new Error('请选择要开票的订单');
    const payload: WireRecord = {
      buyerType: Number(params.buyerType) === 1 ? 1 : 0,
      buyerName: String(params.buyerName || '').trim(),
      notifyEmail: String(params.notifyEmail || '').trim(),
      notifyMobile: String(params.notifyMobile || '').trim(),
      orderDataId: ids,
      token,
    };
    if (payload.buyerType === 1) {
      Object.assign(payload, {
        buyerAddress: String(params.buyerAddress || '').trim(),
        buyerBankAccount: String(params.buyerBankAccount || '').trim(),
        buyerBankName: String(params.buyerBankName || '').trim(),
        buyerPhone: String(params.buyerPhone || '').trim(),
        buyerTaxNo: String(params.buyerTaxNo || '').trim(),
      });
    }
    return pocketPost(`${BASE}/invoice/api/v1/invoice/apply/electronic`, payload, {
      headers: createInvoiceHeaders(),
      fallback: '提交开票申请失败',
    });
  },

  async getMeet48LiveList(params: { next?: number; record?: boolean } = {}) {
    const res = await requestJson<ApiEnvelope>(
      'https://meetapi-v2.meet48.xyz/meet48-api/live/api/v1/live/getLiveList',
      {
        method: 'POST',
        body: { title: null, next: params.next || 0, record: !!params.record },
        headers: createMeet48Headers(),
      },
    );
    return assertPocketOk(res, 'Meet48 API 错误');
  },

  async getMeet48LiveOne(liveId: string) {
    const res = await requestJson<ApiEnvelope>(
      'https://meetapi-v2.meet48.xyz/meet48-api/live/api/v1/live/getLiveOne',
      {
        method: 'POST',
        body: { liveId: String(liveId), streamProtocol: 'RTMP' },
        headers: createMeet48Headers(),
      },
    );
    return assertPocketOk(res, 'Meet48 API 错误');
  },

  async deletePrivateMessage(msgId: string) {
    return pocketPost(
      `${BASE}/message/api/v1/user/message/delete/msg`,
      {
        msgId: String(msgId),
      },
      { fallback: '删除私信失败', headers: createPocketAndroidHeaders() },
    );
  },

  async sendPrivateImageMessage(
    targetUserId: string,
    image: {
      imgUrl: string;
      imgWidth?: number;
      imgHeight?: number;
      imgSize?: number;
      text?: string;
    },
  ) {
    return pocketPost(
      `${BASE}/message/api/v1/user/message/reply`,
      {
        messageType: 'IMAGE',
        imgUrl: String(image.imgUrl),
        imgWidth: Number(image.imgWidth || 0),
        imgHeight: Number(image.imgHeight || 0),
        imgSize: Number(image.imgSize || 0),
        targetUserId: String(targetUserId),
        text: String(image.text || ''),
      },
      { modern: true, fallback: '发送图片私信失败' },
    );
  },

  async uploadPocketImage(params: {
    uri: string;
    fileName?: string;
    mimeType?: string;
    fromType?: string;
  }) {
    const token = requireToken();
    const headers = await signedHeaders(token, true);
    delete headers['Content-Type'];
    delete headers.Host;
    const mimeType = params.mimeType || 'image/jpeg';
    const fileName =
      params.fileName || `image-${Date.now()}.${mimeType.includes('png') ? 'png' : 'jpg'}`;
    const formData = new FormData();
    if (params.fromType) formData.append('fromType', params.fromType);
    formData.append('file', {
      uri: params.uri,
      name: fileName,
      type: mimeType,
    } as unknown as Blob);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    let response: Response;
    try {
      response = await fetch('https://pfile.48.cn/filesystem/upload/image', {
        method: 'POST',
        headers,
        body: formData,
        signal: controller.signal,
      });
    } catch (error: unknown) {
      throw new Error(
        error instanceof Error && error.name === 'AbortError' ? '上传图片超时' : '上传图片网络失败',
      );
    } finally {
      clearTimeout(timer);
    }
    const contentType = response.headers.get('content-type') || '';
    const data = contentType.includes('application/json')
      ? await response.json().catch(() => null)
      : null;
    if (response.ok && data && (data.status === 200 || data.success)) {
      const item = Array.isArray(data.content) ? data.content[0] : data.content;
      const path = item?.path || item?.url || item?.filePath || '';
      if (!path) throw new Error('上传成功但没有返回图片路径');
      return { success: true, content: item, path };
    }
    const source = (data || {}) as WireRecord;
    throw new Error(String(source.message || source.msg || `上传失败 HTTP ${response.status}`));
  },

  async getPostImageList(userId: string, nextId = 0, limit = 20) {
    return pocketPost(
      `${BASE}/posts/api/v1/posts/img/list`,
      {
        nextId: Number(nextId || 0),
        limit: Number(limit) || 20,
        userId: Number(userId) || 0,
      },
      { fallback: '获取主页相册失败', headers: createPocketAndroidHeaders() },
    );
  },

  async getPostVideoList(userId: string, nextId = 0, limit = 20) {
    return pocketPost(
      `${BASE}/posts/api/v2/posts/video/list`,
      {
        nextId: Number(nextId) || 0,
        limit: Number(limit) || 20,
        userId: Number(userId) || 0,
      },
      { fallback: '获取主页视频失败', headers: createPocketAndroidHeaders() },
    );
  },

  async getPostTimelineHome(userId: string, nextId = 0, limit = 20) {
    return pocketPost(
      `${BASE}/posts/api/v1/posts/timeline/home`,
      {
        nextId: Number(nextId) || 0,
        limit: Number(limit) || 20,
        userId: Number(userId) || 0,
      },
      { fallback: '获取主页动态失败', headers: createPocketAndroidHeaders() },
    );
  },

  async getSeinePerformanceList(groupId = 0, next = 0) {
    return requestJson<ApiEnvelope>(
      'https://snhapi-v1.ckg48.cn/home/api/seine/home/interaction/list',
      {
        method: 'POST',
        body: {
          type: 2,
          groupId: String(groupId || 0),
          next: String(next || 0),
        },
        headers: createSeineIosHeaders(),
        timeout: 15000,
      },
    ).then((res) => assertPocketOk(res, '获取公演列表失败'));
  },

  async getSeineServerDetail(serverId: number) {
    return pocketPost(
      `${BASE}/im/api/seine/server/detail`,
      {
        serverId: Number(serverId),
      },
      { fallback: '获取频道详情失败', headers: createSeineHeaders() },
    );
  },

  async getLastMessageByServerId(serverId: number) {
    return pocketPost(
      `${BASE}/im/api/v1/team/last/message/get`,
      {
        serverId: Number(serverId),
      },
      { fallback: '获取最新消息失败' },
    );
  },

  async getArea48Newest(nextId = 0) {
    return pocketPost(
      `${BASE}/posts/api/v1/area48/data/newest/new`,
      {
        nextId: Number(nextId) || 0,
      },
      { fallback: '获取社区动态失败', headers: createArea48Headers() },
    );
  },

  async getArea48Recommend(nextId = 0) {
    return pocketPost(
      `${BASE}/posts/api/v1/area48/data/recommend/new`,
      {
        nextId: Number(nextId) || 0,
      },
      { fallback: '获取社区推荐失败', headers: createArea48Headers() },
    );
  },

  async getArea48PostDetails(postId: string) {
    return pocketPost(
      `${BASE}/posts/api/v1/posts/details`,
      {
        needViewer: true,
        needComment: true,
        postId: String(postId),
      },
      { fallback: '获取帖子详情失败', headers: createArea48Headers() },
    );
  },

  async getArea48Comments(resourceId: string, next = 0) {
    return pocketPost(
      `${BASE}/comment/api/v1/comment/level1/getCommentList`,
      {
        next: next ? String(next) : 0,
        resourceId: String(resourceId),
        resourceMd: 'md',
        resourceType: 1002,
      },
      { fallback: '获取评论失败', headers: createArea48Headers() },
    );
  },

  async addArea48Comment(resourceId: string, commentMsg: string, commentUrl = '') {
    return pocketPost(
      `${BASE}/comment/api/v1/comment/addComment`,
      {
        resourceId: String(resourceId),
        commentMsg: String(commentMsg).trim(),
        commentUrl: String(commentUrl || ''),
        resourceMd: 'md',
        resourceType: 1002,
      },
      { fallback: '发送评论失败', headers: createArea48Headers() },
    );
  },

  async createArea48Post(params: {
    title?: string;
    content: string;
    topicArray?: string;
    extInfo?: string;
  }) {
    return pocketPost(
      `${BASE}/posts/api/v1/posts/create`,
      {
        topicArray: String(params.topicArray || ''),
        postSource: '1',
        title: String(params.title || '').trim(),
        content: String(params.content).trim(),
        extInfo: String(params.extInfo || ''),
      },
      { fallback: '发布动态失败', headers: createArea48Headers() },
    );
  },

  async getPocketMaskWords(clientTime = 0) {
    try {
      const res = await requestJson<ApiEnvelope>(
        `${BASE}/home/api/check/maskword?clientTime=${Number(clientTime) || 0}`,
        {
          method: 'GET',
          headers: createArea48Headers(),
          timeout: 10000,
        },
      );
      if (res?.status === 200 || res?.success) return { success: true, content: res.content || {} };
      return { success: false, content: {} };
    } catch {
      return { success: false, content: {} };
    }
  },

  async getOpenLiveParticipants(liveId: string, _title = '', _dateHint = '') {
    const pageHeaders: HeadersMap = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
      Referer: 'https://live.48.cn/',
    };

    try {
      const livePageUrl = `https://live.48.cn/Index/inlive/id/${encodeURIComponent(liveId)}`;
      const html = await requestJson<string>(livePageUrl, {
        method: 'GET',
        headers: pageHeaders,
      });

      const extractInput = (inputId: string) => {
        const pattern = new RegExp(
          `<input[^>]+id=["']${inputId}["'][^>]+value=["']([^"']*)["']`,
          'i',
        );
        const match = String(html || '').match(pattern);
        return match ? String(match[1] || '').trim() : '';
      };

      const videoId = extractInput('vedio_id');
      const clubId = extractInput('club_id');
      const pageToken = extractInput('param');

      if (videoId && clubId && pageToken) {
        try {
          const payload = new URLSearchParams({
            act: 'default',
            video_id: videoId,
            token: pageToken,
            club_id: clubId,
          }).toString();

          const memberRes = await requestJson<ApiEnvelope>(
            'https://live.48.cn/Index/ajax_getmemberhot/',
            {
              method: 'POST',
              body: payload,
              bodyType: 'raw',
              headers: {
                ...pageHeaders,
                Origin: 'https://live.48.cn',
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'X-Requested-With': 'XMLHttpRequest',
              },
            },
          );

          const rows: WireRecord[] = Array.isArray(memberRes?.desc)
            ? (memberRes.desc as WireRecord[])
            : [];
          const participants = rows
            .map((item) => ({
              name: String(item?.memberName || '').trim(),
              memberId: String(item?.memberId || '').trim(),
              avatar: String(item?.avatar || '').trim(),
              hot: item?.hot ?? '',
            }))
            .filter((item) => item.name);

          if (participants.length) {
            return { success: true, content: { participants, source: 'memberhot' } };
          }
        } catch {}
      }

      const nameMatches = String(html || '').matchAll(
        /<p class="listname">\s*([^<\r\n]+?)\s*(?:<em|<\/p>)/gi,
      );
      const names: string[] = [];
      for (const match of nameMatches) {
        const name = String(match[1] || '')
          .replace(/\s+/g, ' ')
          .trim();
        if (name && !names.includes(name)) names.push(name);
      }
      const htmlParticipants = names.map((name) => ({ name, memberId: '', avatar: '', hot: '' }));
      if (htmlParticipants.length) {
        return { success: true, content: { participants: htmlParticipants, source: 'html' } };
      }
    } catch {}

    return { success: false, msg: '未找到参与成员' };
  },
};

export default pocketApi;
