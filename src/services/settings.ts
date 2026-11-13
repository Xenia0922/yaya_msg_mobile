import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppSettings } from '../types';
import { logError } from '../utils/runtimeLog';
import { getSecret, setSecret, deleteSecret } from './secretStore';

const SETTINGS_KEY = 'yaya_settings';
let settingsCache: AppSettings | null = null;
let settingsLoadPromise: Promise<AppSettings> | null = null;
let settingsWriteChain: Promise<void> = Promise.resolve();

/**
 * 敏感字段：绝不写进 AsyncStorage 的 settings JSON，只进加密仓（secretStore）。
 * 内存中的 settings 对象仍带着它们的明文，因此全应用所有同步读取（发请求、复制 Token、
 * NIM 凭证等）完全不用改 —— 加密只作用于「落盘那一份」。
 */
type SecretField = 'p48Token' | 'bilibiliCookie' | 'meet48Auth';
const SECRET_FIELDS: SecretField[] = ['p48Token', 'bilibiliCookie', 'meet48Auth'];

/** 敏感值序列化：字符串原样，对象（meet48Auth）转 JSON */
function encodeSecret(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v);
  } catch {
    return '';
  }
}

/** 反序列化：字符串字段原样，对象字段还原 JSON */
function decodeSecret(raw: string, isStringField: boolean): unknown {
  if (!raw) return isStringField ? '' : null;
  if (isStringField) return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// 默认设置唯一权威源：store/index.ts 的 useSettingsStore 也从这里取初始值，
// 新增字段只改这一处（此前双源曾漏掉 meet48Auth，导致该字段在 store 有值、持久化默认丢失）。
export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'light',
  language: 'system',
  p48Token: '',
  p48ClientProfile: 'pocket48',
  bilibiliCookie: '',
  bilibiliUserInfo: null,
  msg_sort_order: 'desc',
  yaya_followed_custom_order: [],
  yaya_music_play_mode: 'sequential',
  yaya_music_volume: 0.7,
  yaya_audio_program_play_mode: 'sequential',
  yaya_auto_checkin_enabled: false,
  yaya_auto_checkin_last_date: '',
  yaya_auto_checkin_last_user: '',
  yaya_trip_show_all: false,
  customBackgroundFile: '',
  customBackgroundUpdatedAt: 0,
  donateQrImage: '',
  meet48Auth: null,
  pip_auto: false,
  // 自定义发言身份（弹幕/房间消息的昵称与头像），留空 = 用登录账号资料
  yaya_send_nickname: '',
  yaya_send_avatar: '',
  // 以下留空 = 用登录账号资料；语义见设置页说明（官方 UserInfo 常量）
  yaya_send_level: '',
  yaya_send_roleid: '',
  yaya_send_session_role: '',
  yaya_send_vip: '',
  // 个性装扮（消息 ext.user.pfUrl / teamLogo / badge），留空 = 不带
  yaya_send_pfurl: '',
  yaya_send_teamlogo: '',
  yaya_send_is_star: '',
  yaya_send_badge: '',
  yaya_send_bubble_id: '0',
  // 直播装扮：进场特效 / 弹幕气泡（账号级，选中即同步到口袋）
  yaya_live_effect_id: '',
  yaya_live_effect_name: '',
  yaya_live_bubble_id: '',
  yaya_live_bubble_name: '',
  yaya_pm_unread_badge: true,
  // 首页模块（C4-S1）
  home_modules_order: [],
  home_modules_hidden: [],
};

export async function loadSettings(): Promise<AppSettings> {
  if (settingsCache) return { ...settingsCache };
  if (settingsLoadPromise) return settingsLoadPromise.then((settings) => ({ ...settings }));

  settingsLoadPromise = (async () => {
    let settings: AppSettings = { ...DEFAULT_SETTINGS };
    let rawObj: Record<string, unknown> | null = null;
    try {
      const raw = await AsyncStorage.getItem(SETTINGS_KEY);
      if (raw) {
        rawObj = JSON.parse(raw) as Record<string, unknown>;
        settings = { ...DEFAULT_SETTINGS, ...rawObj } as AppSettings;
      }
    } catch (e) {
      logError(e, 'settings.loadSettings');
    }

    // ① 一次性迁移：历史明文敏感字段 → 加密仓；并从持久化 JSON 里删除明文
    if (rawObj) {
      let migrated = false;
      for (const f of SECRET_FIELDS) {
        const enc = encodeSecret(rawObj[f]);
        if (enc) {
          await setSecret(f, enc);
          delete rawObj[f];
          migrated = true;
        }
      }
      if (migrated) {
        try {
          const persisted: Record<string, unknown> = { ...rawObj };
          for (const f of SECRET_FIELDS) delete persisted[f];
          await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(persisted));
        } catch (e) {
          logError(e, 'settings.migrateSecrets');
        }
      }
    }

    // ② 从加密仓读回，填进内存 settings（全应用同步读取照旧）
    for (const f of SECRET_FIELDS) {
      const stored = await getSecret(f);
      (settings as unknown as Record<string, unknown>)[f] = decodeSecret(stored, f !== 'meet48Auth');
    }

    settingsCache = settings;
    return { ...settings };
  })();

  try {
    return await settingsLoadPromise;
  } finally {
    settingsLoadPromise = null;
  }
}

export async function saveSettings(settings: Partial<AppSettings>): Promise<void> {
  const operation = settingsWriteChain
    .catch(() => undefined)
    .then(async () => {
      const current = await loadSettings();
      const merged = { ...current, ...settings };
      settingsCache = merged;
      // 敏感字段：只加密落盘（不进 settings 明文 JSON）
      for (const f of SECRET_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(settings, f)) {
          await setSecret(f, encodeSecret((merged as unknown as Record<string, unknown>)[f]));
        }
      }
      const persisted: Record<string, unknown> = { ...merged };
      for (const f of SECRET_FIELDS) delete persisted[f];
      await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(persisted));
    });
  settingsWriteChain = operation;
  await operation;
}

export async function getSetting<K extends keyof AppSettings>(key: K): Promise<AppSettings[K]> {
  const settings = await loadSettings();
  return settings[key];
}

export async function setSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]): Promise<void> {
  await saveSettings({ [key]: value });
}

export async function clearSettings(): Promise<void> {
  const operation = settingsWriteChain
    .catch(() => undefined)
    .then(async () => {
      settingsCache = { ...DEFAULT_SETTINGS };
      await AsyncStorage.removeItem(SETTINGS_KEY);
      // 同时清掉加密仓里的敏感字段（退出登录/清数据时不该留 token 密文）
      for (const f of SECRET_FIELDS) {
        await deleteSecret(f);
      }
    });
  settingsWriteChain = operation;
  await operation;
}
