import { DeviceEventEmitter, NativeModules, Platform } from 'react-native';

/**
 * 应用内更新桥（Android 原生 ApkUpdaterModule）：
 * 下载对应 ABI 的 APK → 校验包名 → 拉起系统安装器。
 * iOS 上不存在该模块，所有调用都安全降级（调用方据此隐藏入口）。
 */
export interface ApkProgress {
  received: number;
  total: number;
}

type NativeApkUpdater = {
  getDeviceAbi(): Promise<string>;
  canInstall(): Promise<boolean>;
  openInstallPermissionSettings(): void;
  cancelDownload(): void;
  download(url: string, fallbackUrl: string, fileName: string): Promise<string>;
  installFile(path: string): Promise<boolean>;
};

const native: NativeApkUpdater | undefined =
  Platform.OS === 'android' ? (NativeModules as any).ApkUpdater : undefined;

export const isApkUpdaterAvailable = !!native;

export function getDeviceAbi(): Promise<string> {
  if (!native) return Promise.resolve('');
  return native.getDeviceAbi().catch(() => '');
}

/** Android 8+ 是否已允许「安装未知应用」 */
export function canInstallApk(): Promise<boolean> {
  if (!native) return Promise.resolve(false);
  return native.canInstall().catch(() => false);
}

export function openInstallPermissionSettings(): void {
  try {
    native?.openInstallPermissionSettings();
  } catch {
    /* ignore */
  }
}

export function cancelApkDownload(): void {
  try {
    native?.cancelDownload();
  } catch {
    /* ignore */
  }
}

/** 下载 APK 到缓存目录，resolve 本地绝对路径（不自动安装）。失败 code：EBADAPK / EDOWNLOAD / ECANCEL */
export function downloadApk(url: string, fallbackUrl: string, fileName: string): Promise<string> {
  if (!native) return Promise.reject(Object.assign(new Error('unsupported'), { code: 'EUNSUPPORTED' }));
  return native.download(url, fallbackUrl, fileName);
}

/** 拉起系统安装器；未授权「安装未知应用」时 reject(code=NEED_PERMISSION) */
export function installDownloadedApk(path: string): Promise<boolean> {
  if (!native) return Promise.reject(Object.assign(new Error('unsupported'), { code: 'EUNSUPPORTED' }));
  return native.installFile(path);
}

export function onApkProgress(cb: (p: ApkProgress) => void): () => void {
  const sub = DeviceEventEmitter.addListener('ApkUpdaterProgress', cb);
  return () => sub.remove();
}
