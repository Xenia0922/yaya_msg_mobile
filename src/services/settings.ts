import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppSettings } from '../types';

const SETTINGS_KEY = 'yaya_settings';

const DEFAULT_SETTINGS: AppSettings = {
  theme: 'light',
  p48Token: '',
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
  customBackgroundFile: '',
  customBackgroundUpdatedAt: 0,
};

export async function loadSettings(): Promise<AppSettings> {
  try {
    const raw = await AsyncStorage.getItem(SETTINGS_KEY);
    if (raw) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    }
  } catch {}
  return { ...DEFAULT_SETTINGS };
}

export async function saveSettings(settings: Partial<AppSettings>): Promise<void> {
  const current = await loadSettings();
  const merged = { ...current, ...settings };
  await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(merged));
}

export async function getSetting<K extends keyof AppSettings>(key: K): Promise<AppSettings[K]> {
  const settings = await loadSettings();
  return settings[key];
}

export async function setSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]): Promise<void> {
  await saveSettings({ [key]: value });
}

export async function clearSettings(): Promise<void> {
  await AsyncStorage.removeItem(SETTINGS_KEY);
}
