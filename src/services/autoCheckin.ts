import pocketApi from '../api/pocket48';
import { saveSettings } from './settings';
import { useSettingsStore } from '../store';

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function userKey(token: string) {
  return token ? String(token).slice(-16) : '';
}

export async function runAutoCheckinIfNeeded() {
  const { settings, setSettings } = useSettingsStore.getState();
  if (!settings.yaya_auto_checkin_enabled || !settings.p48Token) return;

  const today = todayKey();
  const user = userKey(settings.p48Token);
  if (settings.yaya_auto_checkin_last_date === today && settings.yaya_auto_checkin_last_user === user) return;

  await pocketApi.checkIn();
  const patch = {
    yaya_auto_checkin_last_date: today,
    yaya_auto_checkin_last_user: user,
  };
  setSettings(patch);
  await saveSettings(patch);
}
