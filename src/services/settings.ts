import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppSettings } from '../types';
import { logError } from '../utils/runtimeLog';
import { getSecret, setSecret, deleteSecret } from './secretStore';

const SETTINGS_KEY = 'yaya_settings';
let settingsCache: AppSettings | null = null;
let settingsLoadPromise: Promise<AppSettings> | null = null;
let settingsWriteChain: Promise<void> = Promise.resolve();
let settingsLoadFailed = false;

const unmigratedSecretFields = new Set<SecretField>();

type SecretField = 'p48Token' | 'bilibiliCookie' | 'meet48Auth';
const SECRET_FIELDS: SecretField[] = ['p48Token', 'bilibiliCookie', 'meet48Auth'];

function encodeSecret(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v);
  } catch {
    return '';
  }
}

function decodeSecret(raw: string, isStringField: boolean): unknown {
  if (!raw) return isStringField ? '' : null;
  if (isStringField) return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'light',
  language: 'system',
  p48Token: '',
  p48DeviceId: '',
  p48ClientProfile: 'pocket48',
  bilibiliCookie: '',
  bilibiliUserInfo: null,
  msg_sort_order: 'desc',
  yaya_followed_custom_order: [],
  yaya_music_play_mode: 'sequential',
  yaya_music_volume: 0.7,
  yaya_music_cache_limit_mb: 300,
  yaya_music_minibar_enabled: true,
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

  yaya_send_nickname: '',
  yaya_send_avatar: '',

  yaya_send_level: '',
  yaya_send_roleid: '',
  yaya_send_session_role: '',
  yaya_send_vip: '',

  yaya_send_pfurl: '',
  yaya_send_teamlogo: '',
  yaya_send_is_star: '',
  yaya_send_badge: '',
  yaya_send_bubble_id: '0',

  yaya_live_effect_id: '',
  yaya_live_effect_name: '',
  yaya_live_bubble_id: '',
  yaya_live_bubble_name: '',
  yaya_pm_unread_badge: true,
  yaya_room_list_time: true,

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
      settingsLoadFailed = true;
      logError(e, 'settings.loadSettings');
    }

    const migratedFields = new Set<SecretField>();
    if (rawObj) {
      for (const f of SECRET_FIELDS) {
        const enc = encodeSecret(rawObj[f]);
        if (enc) {
          try {
            await setSecret(f, enc);
            delete rawObj[f];
            migratedFields.add(f);
            unmigratedSecretFields.delete(f);
          } catch (e) {
            unmigratedSecretFields.add(f);
            logError(e, `settings.migrateSecret.${f}`);
          }
        }
      }
      if (migratedFields.size > 0) {
        try {
          const persisted: Record<string, unknown> = { ...rawObj };
          for (const f of migratedFields) delete persisted[f];
          await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(persisted));
        } catch (e) {
          logError(e, 'settings.migrateSecrets');
        }
      }
    }

    const storedSecrets = await Promise.all(SECRET_FIELDS.map((f) => getSecret(f)));
    SECRET_FIELDS.forEach((f, index) => {
      const fromVault = decodeSecret(storedSecrets[index], f !== 'meet48Auth');
      const hasVaultVal = Boolean(storedSecrets[index]);
      const rawPlain = rawObj ? encodeSecret(rawObj[f]) : '';
      if (!hasVaultVal && rawPlain && !migratedFields.has(f)) {
        (settings as unknown as Record<string, unknown>)[f] = decodeSecret(
          rawPlain,
          f !== 'meet48Auth',
        );
        unmigratedSecretFields.add(f);
      } else {
        (settings as unknown as Record<string, unknown>)[f] = fromVault;
        if (hasVaultVal) unmigratedSecretFields.delete(f);
      }
    });

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
  if (settingsLoadFailed) {
    throw new Error('设置读取失败，为防止覆盖原数据已拒绝保存；请重启应用后重试');
  }
  const operation = settingsWriteChain
    .catch(() => undefined)
    .then(async () => {
      const current = await loadSettings();
      const merged = { ...current, ...settings };

      for (const f of SECRET_FIELDS) {
        const touched = Object.prototype.hasOwnProperty.call(settings, f);
        if (touched || unmigratedSecretFields.has(f)) {
          const enc = encodeSecret((merged as unknown as Record<string, unknown>)[f]);
          if (touched) {
            await setSecret(f, enc);
            unmigratedSecretFields.delete(f);
          } else if (enc) {
            try {
              await setSecret(f, enc);
              unmigratedSecretFields.delete(f);
            } catch (e) {
              logError(e, `settings.retryMigrateSecret.${f}`);
            }
          }
        }
      }
      const persisted: Record<string, unknown> = { ...merged };
      for (const f of SECRET_FIELDS) {
        if (!unmigratedSecretFields.has(f)) delete persisted[f];
      }
      await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(persisted));

      settingsCache = merged;
    });
  settingsWriteChain = operation;
  await operation;
}

export async function getSetting<K extends keyof AppSettings>(key: K): Promise<AppSettings[K]> {
  const settings = await loadSettings();
  return settings[key];
}

export async function setSetting<K extends keyof AppSettings>(
  key: K,
  value: AppSettings[K],
): Promise<void> {
  await saveSettings({ [key]: value });
}

export async function clearSettings(): Promise<void> {
  const operation = settingsWriteChain
    .catch(() => undefined)
    .then(async () => {
      await AsyncStorage.removeItem(SETTINGS_KEY);

      for (const f of SECRET_FIELDS) {
        await deleteSecret(f);
      }
      unmigratedSecretFields.clear();

      settingsCache = { ...DEFAULT_SETTINGS };
      settingsLoadFailed = false;
    });
  settingsWriteChain = operation;
  await operation;
}
