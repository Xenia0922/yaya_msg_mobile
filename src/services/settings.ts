import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppSettings } from '../types';
import { logError } from '../utils/runtimeLog';
import { getSecret, setSecret, deleteSecret } from './secretStore';

const SETTINGS_KEY = 'yaya_settings';
let settingsCache: AppSettings | null = null;
let settingsLoadPromise: Promise<AppSettings> | null = null;
let settingsWriteChain: Promise<void> = Promise.resolve();
let settingsLoadFailed = false;
/** 启动迁移时因加密仓暂不可用而尚未迁移的字段，saveSettings 时需保留其明文或重试迁移，避免丢失凭据。 */
const unmigratedSecretFields = new Set<SecretField>();

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
  p48DeviceId: '',
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
      // 读失败时继续用默认值启动，但禁止随后的保存把损坏/不可读的整份设置覆盖掉。
      settingsLoadFailed = true;
      logError(e, 'settings.loadSettings');
    }

    // ① 一次性迁移：历史明文敏感字段 → 加密仓；仅删除本轮成功迁移的字段，避免部分失败抹除其他凭据
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
            // 加密仓暂时不可用时保留原值继续启动（不删除明文、不假装迁移成功）；
            // 下次启动或下次保存会重试，避免一个凭据迁移失败拖垮全部设置。
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

    // ② 从加密仓读回，填进内存 settings（全应用同步读取照旧）。
    // 若某字段迁移失败且加密仓尚无值，保留 rawObj 中的明文在内存里，防止静默清空登录态。
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
      // 敏感字段：只加密落盘（不进 settings 明文 JSON）；对历史未迁移字段顺带重试迁移
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
      // 全部写入成功后再更新缓存：否则 setSecret/setItem 失败时内存显示已保存，
      // 重启后又回退，用户会误以为设置生效。
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
      // 同时清掉加密仓里的敏感字段（退出登录/清数据时不该留 token 密文）
      for (const f of SECRET_FIELDS) {
        await deleteSecret(f);
      }
      unmigratedSecretFields.clear();
      // 清理全部成功后再重置内存，避免删除失败时界面已显示清空、磁盘仍有旧值。
      settingsCache = { ...DEFAULT_SETTINGS };
      settingsLoadFailed = false;
    });
  settingsWriteChain = operation;
  await operation;
}
