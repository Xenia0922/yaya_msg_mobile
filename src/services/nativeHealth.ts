import { NativeModules, Platform } from 'react-native';
import { logInfo, logWarn } from '../utils/runtimeLog';

/**
 * 原生模块自检（覆盖 P1「原生模块靠手工注册，升级/改配置极易漏，且漏了只是静默失效」）。
 *
 * 背景：本工程有 9 个手写 Package、13 个原生模块，`MainApplication.kt` 手工 add、
 * `settings.gradle` 手工 include。一旦某次改动漏注册，表现不是崩溃，而是**某个功能静默不可用**
 * （例如加固后 SecureVault 漏了 → 凭据加密悄悄降级为明文；Pip 漏了 → 小窗唤不出）。
 *
 * 这里在启动后对照「JS 实际依赖的模块名」检查一遍，缺哪个就写一条 warn 到运行日志。
 * 不阻塞、不弹窗；只用于日志/排障。
 */

/** JS 侧实际使用的原生模块名（与各 Module.getName 对齐） */
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

/** 检查并写日志；返回报告 */
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

/** 启动后延迟执行一次（避免和启动高峰抢资源） */
export function startNativeModuleCheck(delayMs = 3000): void {
  if (ran) return;
  ran = true;
  setTimeout(() => {
    try {
      checkNativeModules();
    } catch {
      /* 绝不影响启动 */
    }
  }, delayMs);
}
