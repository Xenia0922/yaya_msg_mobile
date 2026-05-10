import pocketApi from '../api/pocket48';
import { saveSettings } from './settings';
import { useSettingsStore } from '../store';

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function pickCurrentUserId(res: any, token: string) {
  return String(
    res?.content?.userInfo?.userId
    || res?.content?.baseUserInfo?.userId
    || res?.content?.user?.userId
    || res?.content?.userId
    || res?.data?.userInfo?.userId
    || res?.data?.userId
    || (token ? `token:${String(token).slice(-16)}` : ''),
  );
}

function isAlreadyCheckedError(error: any) {
  const message = error?.message || error?.msg || String(error || '');
  return /已签到|重复签到|已经签到|已领取|明天再来/.test(message);
}

function isCheckedToday(res: any) {
  const content = res?.content ?? res?.data ?? res;
  if (!content) return false;
  if (typeof content === 'boolean') return content;
  const flags = [
    content.checked,
    content.isChecked,
    content.isCheckin,
    content.isCheckIn,
    content.checkin,
    content.checkIn,
    content.today,
    content.todayChecked,
    content.hasCheckin,
    content.hasChecked,
  ];
  if (flags.some((item) => item === true || item === 1 || item === '1')) return true;
  return /已签到|已经签到|今日已签/.test(JSON.stringify(content));
}

export async function runAutoCheckinIfNeeded() {
  const { settings, setSettings } = useSettingsStore.getState();
  if (!settings.yaya_auto_checkin_enabled || !settings.p48Token) return;

  const today = todayKey();
  const profile = await pocketApi.getNimLoginInfo().catch(() => null);
  const user = pickCurrentUserId(profile, settings.p48Token);
  if (!user) return;
  if (settings.yaya_auto_checkin_last_date === today && settings.yaya_auto_checkin_last_user === user) return;

  const todayState = await pocketApi.getCheckinToday().catch(() => null);
  if (!isCheckedToday(todayState)) {
    try {
      await pocketApi.checkIn();
    } catch (error) {
      if (!isAlreadyCheckedError(error)) throw error;
    }
  }

  const patch = {
    yaya_auto_checkin_last_date: today,
    yaya_auto_checkin_last_user: user,
  };
  setSettings(patch);
  await saveSettings(patch);
}
