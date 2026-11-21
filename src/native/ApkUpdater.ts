import { DeviceEventEmitter, NativeModules, Platform } from 'react-native';

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

export function canInstallApk(): Promise<boolean> {
  if (!native) return Promise.resolve(false);
  return native.canInstall().catch(() => false);
}

export function openInstallPermissionSettings(): void {
  try {
    native?.openInstallPermissionSettings();
  } catch {}
}

export function cancelApkDownload(): void {
  try {
    native?.cancelDownload();
  } catch {}
}

export function downloadApk(url: string, fallbackUrl: string, fileName: string): Promise<string> {
  if (!native)
    return Promise.reject(Object.assign(new Error('unsupported'), { code: 'EUNSUPPORTED' }));
  return native.download(url, fallbackUrl, fileName);
}

export function installDownloadedApk(path: string): Promise<boolean> {
  if (!native)
    return Promise.reject(Object.assign(new Error('unsupported'), { code: 'EUNSUPPORTED' }));
  return native.installFile(path);
}

export function onApkProgress(cb: (p: ApkProgress) => void): () => void {
  const sub = DeviceEventEmitter.addListener('ApkUpdaterProgress', cb);
  return () => sub.remove();
}
