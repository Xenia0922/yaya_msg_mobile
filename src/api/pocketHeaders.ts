import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSettingsStore } from '../store';
import { normalizePocketDeviceId } from '../utils/pocketToken';

export type HeadersMap = Record<string, string>;

export const BASE = 'https://pocketapi.48.cn';
export const APP_VERSION = '7.0.41';
export const APP_BUILD = '24011601';

export const UA_IOS_7135 = 'PocketFans201807/7.1.35 (iPhone; iOS 16.3; Scale/3.00)';
export const UA_IOS_7138 = 'PocketFans201807/7.1.38 (iPhone; iOS 26.5; Scale/3.00)';
export const UA_ANDROID_7143 =
  'PocketFans201807/7.1.43_26070701 (SM-G9730:Android 12;Samsung V417IR release-keys)';
export const UA_ANDROID_7145 =
  'PocketFans201807/7.1.45_26102701 (SM-G9730:Android 12;Samsung V417IR release-keys)';
export const UA_SEINE_100 =
  'PocketFans201807/1.0.0_26061101 (SM-G9730:Android 12;Samsung V417IR release-keys)';
export const UA_AREA48_6022 =
  'PocketFans201807/6.0.22_201128 (SM-G9730:Android 12;Samsung V417IR release-keys)';

export const DEVICE_ID_IOS_UUID = '7B93DFD0-472F-4736-A628-E85FAE086486';
export const DEVICE_ID_IOS_UUID_ALT = '7B93DFD0-472F-4736-A628-E85FAE086487';
export const DEVICE_ID_IOS_HEX = '7b93dfd0472f4736a628e85fae086486';

export function createDeviceId(): string {
  const chars = 'QWERTYUIOPASDFGHJKLZXCVBNM1234567890';
  const rand = (length: number) => {
    let result = '';
    for (let i = 0; i < length; i += 1) result += chars[Math.floor(Math.random() * chars.length)];
    return result;
  };
  return `${rand(8)}-${rand(4)}-${rand(4)}-${rand(4)}-${rand(12)}`;
}

export const DEVICE_ID_KEY = 'yaya_device_id_v1';
export let DEVICE_ID = createDeviceId();
export let deviceIdLoaded = false;
AsyncStorage.getItem(DEVICE_ID_KEY)
  .then((saved) => {
    if (saved) {
      DEVICE_ID = saved;
    } else {
      AsyncStorage.setItem(DEVICE_ID_KEY, DEVICE_ID).catch(() => {});
    }
    deviceIdLoaded = true;
  })
  .catch(() => {
    deviceIdLoaded = true;
  });

export async function ensureDeviceId(): Promise<string> {
  if (deviceIdLoaded) return DEVICE_ID;
  const deadline = Date.now() + 800;
  while (!deviceIdLoaded && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 40));
  }
  if (deviceIdLoaded) return DEVICE_ID;

  AsyncStorage.setItem(DEVICE_ID_KEY, DEVICE_ID).catch(() => {});
  return DEVICE_ID;
}

export function appInfo(modern = false, deviceId = DEVICE_ID) {
  if (modern) {
    return {
      vendor: 'apple',
      deviceId: DEVICE_ID_IOS_UUID,
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
    deviceId,
    appVersion: APP_VERSION,
    appBuild: APP_BUILD,
    osVersion: '16.3.1',
    osType: 'ios',
    deviceName: 'iPhone XR',
    os: 'ios',
  };
}

export function createHeaders(
  token?: string,
  pa?: string | null,
  modern = false,
  deviceId = DEVICE_ID,
): HeadersMap {
  const headers: HeadersMap = {
    'Content-Type': 'application/json;charset=utf-8',
    'User-Agent': modern
      ? UA_IOS_7135
      : `PocketFans201807/${APP_VERSION} (iPhone; iOS 16.3.1; Scale/2.00)`,
    Host: 'pocketapi.48.cn',
    'Accept-Language': 'zh-Hans-CN;q=1',
    Accept: '*/*',
    appInfo: JSON.stringify(appInfo(modern, deviceId)),
  };
  if (token) headers.token = token;
  if (pa) headers.pa = pa;
  return headers;
}

export function createModernHeaders(token?: string, pa?: string | null): HeadersMap {
  const headers = createHeaders(token, pa, true);
  headers.appInfo = JSON.stringify({
    vendor: 'apple',
    deviceId: DEVICE_ID_IOS_UUID,
    appVersion: '7.1.35',
    appBuild: '25101021',
    osVersion: '16.3.0',
    osType: 'ios',
    deviceName: 'iPhone 14 Pro',
    os: 'ios',
  });
  headers['User-Agent'] = UA_IOS_7135;
  headers['Content-Type'] = 'application/json;charset=utf-8';
  delete headers.Origin;
  delete headers.Referer;
  return headers;
}

export function createCheckinHeaders(token?: string, pa?: string | null): HeadersMap {
  const headers = createModernHeaders(token, pa);
  headers['P-Sign-Type'] = 'V0';
  return headers;
}

export function createPocketAndroidHeaders(token?: string, pa?: string | null): HeadersMap {
  const headers: HeadersMap = {
    'Content-Type': 'application/json; charset=UTF-8',
    'User-Agent': UA_ANDROID_7143,
    'Accept-Language': 'zh-Hans-CN;q=1',
    Accept: '*/*',
    Host: 'pocketapi.48.cn',
    appInfo: JSON.stringify({
      IMEI: DEVICE_ID_IOS_HEX,
      appBuild: '26070701',
      appName: 'pocket48',
      appVersion: '7.1.43',
      deviceId: DEVICE_ID_IOS_HEX,
      deviceName: 'SM-G9730',
      osType: 'android',
      osVersion: '12',
      phoneName: 'SM-G9730',
      phoneSystemVersion: '12',
      vendor: 'Samsung',
    }),
  };
  if (token) headers.token = token;
  if (pa) headers.pa = pa;
  return headers;
}

export function derivePocketHexDeviceId(rawId: string): string {
  return Array.from(
    String(rawId || '')
      .replace(/[^a-z0-9]/gi, '')
      .slice(0, 16),
    (c) => (c.charCodeAt(0) % 16).toString(16),
  )
    .join('')
    .padEnd(16, '0');
}

export async function getLocalPocketDeviceId(): Promise<string> {
  return derivePocketHexDeviceId(await ensureDeviceId());
}

export async function resolveBoundPocketDeviceId(): Promise<string> {
  const stored = normalizePocketDeviceId(useSettingsStore.getState().settings.p48DeviceId);
  if (stored) return stored;
  return getLocalPocketDeviceId();
}

export async function createPocketProfileHeaders(
  profile: 'pocket48' | 'seine48' = 'pocket48',
  token?: string,
  pa?: string | null,
  explicitDeviceId?: string,
): Promise<HeadersMap> {
  const deviceId =
    explicitDeviceId === ''
      ? ''
      : normalizePocketDeviceId(explicitDeviceId) || (await resolveBoundPocketDeviceId());
  const appName = profile === 'seine48' ? 'seine48' : 'pocket48';
  const appVersion = appName === 'seine48' ? '1.3.5' : '7.1.45';
  const appBuild = appName === 'seine48' ? 26102601 : '26102701';
  const headers: HeadersMap = {
    'Content-Type': 'application/json; charset=UTF-8',
    'User-Agent': `PocketFans201807/${appVersion}_${appBuild} (SM-G9730:Android 12;Samsung V417IR release-keys)`,
    'Accept-Language': 'zh-Hans-CN;q=1',
    appInfo: JSON.stringify({
      IMEI: deviceId,
      deviceId,
      appName,
      appVersion,
      appBuild,
      deviceName: 'SM-G9730',
      osType: 'android',
      osVersion: '12',
      phoneName: 'SM-G9730',
      phoneSystemVersion: '12',
      vendor: 'Samsung',
    }),
  };
  if (appName === 'seine48') headers['X-Custom-Device-Type'] = 'ANDROID';
  if (token) headers.token = token;
  if (pa) headers.pa = pa;
  return headers;
}

export async function createPocketLoginHeaders(): Promise<HeadersMap> {
  return createPocketProfileHeaders('pocket48', undefined, null, await getLocalPocketDeviceId());
}

export function createSeineHeaders(token?: string, pa?: string | null): HeadersMap {
  const headers = createPocketAndroidHeaders(token, pa);
  headers.appInfo = JSON.stringify({
    appVersion: '1.0.0',
    appBuild: 26061101,
    osType: 'android',
    appName: 'seine48',
    deviceId: DEVICE_ID_IOS_HEX,
    deviceName: 'SM-G9730',
    osVersion: '12',
    vendor: 'Samsung',
    IMEI: DEVICE_ID_IOS_HEX,
    phoneName: 'SM-G9730',
    phoneSystemVersion: '12',
  });
  headers['X-Custom-Device-Type'] = 'ANDROID';
  headers['User-Agent'] = UA_SEINE_100;
  return headers;
}

export function createSeineIosHeaders(): HeadersMap {
  return {
    'Content-Type': 'application/json; charset=UTF-8',
    Accept: '*/*',
    'Accept-Language': 'zh-Hans-CN;q=1',
    'User-Agent': 'Seina/1.2.0 (com.seine48.app; build:26072902; iOS 27.0.0) Alamofire/5.8.0',
    appInfo: JSON.stringify({
      deviceId: DEVICE_ID_IOS_UUID,
      appVersion: '1.2.0',
      deviceName: 'iPhone 16 Pro',
      osType: 'ios',
      appBuild: '26072902',
      osVersion: '27.0',
      appName: 'seine48',
      vendor: 'apple',
    }),
  };
}

export function createArea48Headers(token?: string, pa?: string | null): HeadersMap {
  const headers: HeadersMap = {
    'Content-Type': 'application/json; charset=UTF-8',
    Accept: '*/*',
    'Accept-Language': 'zh-Hans-CN;q=1',
    'User-Agent': UA_AREA48_6022,
    Host: 'pocketapi.48.cn',
    appInfo: JSON.stringify({
      IMEI: '6172656134383a303030303030',
      appBuild: '201128',
      appVersion: '6.0.22',
      deviceId: '6172656134383a303030303030',
      deviceName: 'SM-G9730',
      osType: 'android',
      osVersion: '12',
      phoneName: 'SM-G9730',
      phoneSystemVersion: '12',
      vendor: 'Samsung',
    }),
  };
  if (token) headers.token = token;
  if (pa) headers.pa = pa;
  return headers;
}

export function createWeiboHeaders(token?: string, pa?: string | null): HeadersMap {
  const headers = createModernHeaders(token, pa);
  headers.appInfo = JSON.stringify({
    vendor: 'apple',
    deviceId: DEVICE_ID_IOS_UUID_ALT,
    appVersion: '7.1.38',
    appBuild: '26042402',
    osVersion: '26.5.0',
    osType: 'ios',
    deviceName: 'iPhone17,1',
    os: 'ios',
  });
  headers['User-Agent'] = UA_IOS_7138;
  headers['P-Sign-Type'] = 'V0';
  return headers;
}

export function createInvoiceHeaders(
  token?: string,
  options?: { tokenHeader?: boolean },
): HeadersMap {
  const headers: HeadersMap = {
    'Content-Type': 'application/json; charset=utf-8',
    Accept: 'application/json, text/plain, */*',
    Host: 'pocketapi.48.cn',
    'User-Agent':
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  };
  if (options?.tokenHeader && token) headers.token = token;
  return headers;
}

export function createMeet48Headers(): HeadersMap {
  const settings = useSettingsStore.getState().settings;
  const storedAuth = settings.meet48Auth;
  const authDisabled = storedAuth?.disabled === true;
  const deviceId = (!authDisabled && storedAuth?.deviceId) || createDeviceId();
  const headers: HeadersMap = {
    'content-type': 'application/json',
    accept: '*/*',
    'accept-language': 'zh_TW',
    'user-agent': 'Meet48/2.0.3 (com.dapp.meet48; build:2602062; iOS 26.4.2) Alamofire/5.8.0',
    'x-versioncode': '2.0.3',
    'x-app-id': '2e63a31eac9d056755b0f83b89ef6674',
    'x-device-info': JSON.stringify({
      appVersion: '2.0.3',
      deviceId,
      osType: 'ios',
      appName: 'Meet48',
      vendor: 'apple',
      osVersion: '26.4.2',
      appBuildId: '2602062',
      osLoginType: 'common',
      bundleId: 'com.dapp.meet48',
      deviceName: 'iPhone17,1',
    }),
    'x-web-type': '1',
    'x-deviceid': deviceId,
    'x-custom-device-type': 'IOS',
  };
  const token = authDisabled ? '' : storedAuth?.token || '';
  const cookie = authDisabled ? '' : storedAuth?.cookie || '';
  if (token) headers.token = token;
  if (cookie) headers.cookie = cookie;
  return headers;
}
