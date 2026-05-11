import pocketApi from '../api/pocket48';
import { saveSettings } from './settings';
import { useSettingsStore, useUiStore } from '../store';

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
  return /\u5df2\u7b7e\u5230|\u91cd\u590d\u7b7e\u5230|\u5df2\u7ecf\u7b7e\u5230|\u5df2\u9886\u53d6|\u660e\u5929\u518d\u6765/.test(message);
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
  return /\u5df2\u7b7e\u5230|\u5df2\u7ecf\u7b7e\u5230|\u4eca\u65e5\u5df2\u7b7e/.test(JSON.stringify(content));
}

export async function runAutoCheckinIfNeeded() {
  const { settings, setSettings } = useSettingsStore.getState();
  const showToast = useUiStore.getState().showToast;
  if (!settings.yaya_auto_checkin_enabled || !settings.p48Token) return { skipped: true, message: '自动签到未开启或未登录' };

  const today = todayKey();
  const profile = await pocketApi.getNimLoginInfo().catch(() => null);
  const user = pickCurrentUserId(profile, settings.p48Token);
  if (!user) return { skipped: true, message: '自动签到未获取到账号信息' };
  if (settings.yaya_auto_checkin_last_date === today && settings.yaya_auto_checkin_last_user === user) {
    showToast('今日已自动签到过');
    return { skipped: true, alreadyChecked: true, message: '今日已自动签到过' };
  }

  const todayState = await pocketApi.getCheckinToday().catch(() => null);
  let message = '自动签到成功';
  if (!isCheckedToday(todayState)) {
    try {
      const res: any = await pocketApi.checkIn();
      message = res?.alreadyChecked ? '今日已经签到过了' : (res?.message || res?.msg || '自动签到成功');
    } catch (error: any) {
      if (!isAlreadyCheckedError(error)) {
        const errorMessage = error?.message || String(error);
        showToast(`自动签到失败：${errorMessage}`);
        throw error;
      }
      message = '今日已经签到过了';
    }
  } else {
    message = '今日已经签到过了';
  }

  const patch = {
    yaya_auto_checkin_last_date: today,
    yaya_auto_checkin_last_user: user,
  };
  setSettings(patch);
  await saveSettings(patch);
  showToast(message);
  return { success: true, message };
}
