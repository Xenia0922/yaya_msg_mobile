import { NativeModules, Platform } from 'react-native';
import { logInfo, logWarn } from '../utils/runtimeLog';

const REQUIRED_MODULES: Array<{ name: string; purpose: string; optional?: boolean }> = [
  { name: 'RadioServiceModule', purpose: '电台前台服务/通知' },
  { name: 'RadioExoModule', purpose: '音乐 ExoPlayer 桥' },
  { name: 'LivePlayerModule', purpose: '全屏沉浸 + 直播首帧事件' },
  { name: 'PipController', purpose: '系统画中画' },
  { name: 'BiliLoginModule', purpose: 'B站扫码登录' },
  { name: 'PocketIm', purpose: '云信 QChat（官方 SDK 桥）' },
  { name: 'PocketNimChatroom', purpose: '直播弹幕聊天室（commonlink）' },
  { name: 'PocketNimQChat', purpose: '房间消息圈组（commonlink）' },
  { name: 'ApkUpdater', purpose: '应用内更新下载/安装' },
  { name: 'MediaProbe', purpose: '音视频时长探测' },
  { name: 'PublicDownloads', purpose: '导出到系统下载目录', optional: true },
  { name: 'PocketGiftEffect', purpose: '礼物全屏特效（libpag）', optional: true },
  { name: 'SecureVault', purpose: '凭据加密仓（缺失=凭据退回明文）' },
];

export type NativeModuleReport = {
  missing: string[];
  missingRequired: string[];
};

let lastReport: NativeModuleReport | null = null;
let ran = false;

export function getNativeModuleReport(): NativeModuleReport | null {
  return lastReport;
}

export function checkNativeModules(): NativeModuleReport {
  if (Platform.OS !== 'android') {
    lastReport = { missing: [], missingRequired: [] };
    return lastReport;
  }
  const missing: string[] = [];
  const missingRequired: string[] = [];
  for (const m of REQUIRED_MODULES) {
    const present = !!(NativeModules as any)?.[m.name];
    if (!present) {
      missing.push(`${m.name}(${m.purpose})`);
      if (!m.optional) missingRequired.push(m.name);
    }
  }
  lastReport = { missing, missingRequired };
  if (missing.length === 0) {
    logInfo(`[native.check] 原生模块齐全（${REQUIRED_MODULES.length} 个）`, 'native');
  } else if (missingRequired.length) {
    logWarn(
      `[native.check] 缺失必需原生模块 ${missingRequired.length} 个：${missing.join(' / ')}（功能会静默失效）`,
      'native',
    );
  } else {
    logWarn(`[native.check] 缺失可选原生模块：${missing.join(' / ')}`, 'native');
  }
  return lastReport;
}

export function startNativeModuleCheck(delayMs = 3000): void {
  if (ran) return;
  ran = true;
  setTimeout(() => {
    try {
      checkNativeModules();
    } catch {}
  }, delayMs);
}
