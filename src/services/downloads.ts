import AsyncStorage from '@react-native-async-storage/async-storage';
import { USER_AGENT } from '../constants';
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import { logError } from '../utils/runtimeLog';
import { Linking, Platform, Alert, NativeModules } from 'react-native';

export type DownloadType = 'replay' | 'voice' | 'image' | 'video' | 'audio' | 'file';
export type DownloadStatus = 'queued' | 'downloading' | 'done' | 'failed';

export interface DownloadItem {
  id: string;
  url: string;
  name: string;
  type: DownloadType;
  status: DownloadStatus;
  progress: number;
  localUri?: string;
  publicUri?: string;
  exportError?: string;
  error?: string;
  createdAt: number;
  totalBytes?: number;
  downloadedBytes?: number;
}

const STORAGE_KEY = 'yaya_download_items_v1';
const DOWNLOAD_DIR = `${FileSystem.documentDirectory || ''}downloads/`;

// 缓存上限：4GB LRU。
// 超过后按「创建时间最早优先」淘汰已完成的下载文件，避免无限增长占满存储。
const MAX_CACHE_BYTES = 4 * 1024 * 1024 * 1024;

function sanitizeName(name: string) {
  return String(name || 'download')
    .replace(/[\\/:*?"<>|#%{}^~[\]`]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 96);
}

function extensionFromUrl(url: string, fallback: DownloadType) {
  const clean = String(url || '')
    .split('?')[0]
    .split('#')[0];
  const match = clean.match(/\.([a-z0-9]{2,5})$/i);
  if (match) return `.${match[1].toLowerCase()}`;
  if (fallback === 'image') return '.jpg';
  if (fallback === 'voice' || fallback === 'audio') return '.m4a';
  if (fallback === 'video' || fallback === 'replay') return '.mp4';
  return '.bin';
}

function mimeTypeForDownload(name: string): string {
  const extension = name.toLowerCase().split('.').pop();
  const types: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    mp3: 'audio/mpeg',
    m4a: 'audio/mp4',
    aac: 'audio/aac',
    amr: 'audio/amr',
    wav: 'audio/wav',
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    pdf: 'application/pdf',
    json: 'application/json',
  };
  return types[extension || ''] || 'application/octet-stream';
}

async function exportToPublicDownloads(localUri: string, name: string): Promise<string> {
  const native = NativeModules.PublicDownloads;
  if (!native?.saveToDownloads) throw new Error('系统下载目录保存功能不可用，请更新应用');
  return native.saveToDownloads(localUri, name, mimeTypeForDownload(name));
}

/**
 * 导出到系统下载目录是「锦上添花」：原生模块缺失（旧版 APK / 开发包）或写入失败时
 * 只记录 exportError，文件已经在应用目录里，下载本身仍算成功。
 * 此前直接 await，一次导出失败会把已完成的下载判成 failed。
 */
async function tryExportToPublicDownloads(
  localUri: string,
  name: string,
): Promise<{ publicUri?: string; exportError?: string }> {
  if (Platform.OS !== 'android') return {};
  try {
    return { publicUri: await exportToPublicDownloads(localUri, name) };
  } catch (error: any) {
    return { exportError: error?.message || String(error) };
  }
}

async function deletePublicCopy(uri?: string) {
  if (Platform.OS !== 'android' || !uri || !NativeModules.PublicDownloads?.deletePublicDownload)
    return;
  await NativeModules.PublicDownloads.deletePublicDownload(uri).catch(() => undefined);
}

export function guessDownloadName(url: string, type: DownloadType, title?: string) {
  const fromUrl =
    String(url || '')
      .split('?')[0]
      .split('/')
      .pop() || '';
  let decodedFromUrl = fromUrl;
  try {
    decodedFromUrl = decodeURIComponent(fromUrl);
  } catch {
    decodedFromUrl = fromUrl;
  }
  const base = sanitizeName(title || decodedFromUrl || `${type}-${Date.now()}`);
  const hasExt = /\.[a-z0-9]{2,5}$/i.test(base);
  return hasExt ? base : `${base}${extensionFromUrl(url, type)}`;
}

export async function loadDownloadItems(): Promise<DownloadItem[]> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    // 运行期读取必须原样返回：调用方包括进度刷新、配额清理和删除逻辑。
    // 中断恢复只在启动时由 recoverInterruptedDownloads 执行一次，否则会把
    // 其他仍在下载的任务改成 failed，随后被“清理完成”误删文件。
    return Array.isArray(parsed) ? (parsed as DownloadItem[]) : [];
  } catch {
    return [];
  }
}

/**
 * 写路径专用读取：记录损坏时必须显式失败，绝不能以 [] 作为写入基线。
 * 否则一次 JSON 损坏后的 updateItem/清理会把整张下载记录覆盖为空。
 */
async function loadDownloadItemsForWrite(): Promise<DownloadItem[]> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('下载记录损坏，已阻止覆盖');
  }
  if (!Array.isArray(parsed)) throw new Error('下载记录格式异常，已阻止覆盖');
  return parsed as DownloadItem[];
}

let recoveryPromise: Promise<void> | null = null;

/**
 * 启动时恢复：下载执行器只存在于当前进程，重启后没有任务会继续这些状态，
 * 统一恢复为可重试失败项。重复调用无副作用。
 */
export function recoverInterruptedDownloads(): Promise<void> {
  if (recoveryPromise) return recoveryPromise;
  recoveryPromise = withDownloadWrite(async () => {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    if (!Array.isArray(parsed)) return;
    let changed = false;
    const items = parsed.map((item: DownloadItem) => {
      if (item?.status !== 'downloading' && item?.status !== 'queued') return item;
      changed = true;
      return { ...item, status: 'failed' as const, error: '应用重启后下载中断，请重试' };
    });
    if (changed) await saveDownloadItems(items);
  });
  return recoveryPromise;
}

export async function saveDownloadItems(items: DownloadItem[]) {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

/**
 * 写盘串行链：updateItem / enqueue 都是「读整表 → 改 → 写整表」，
 * 两个下载同时进行时，各自的整表写会覆盖对方最新状态 → 进度丢失或回跳（修复）。
 */
let downloadWriteChain: Promise<unknown> = Promise.resolve();
function withDownloadWrite<T>(fn: () => Promise<T>): Promise<T> {
  const run = downloadWriteChain.then(fn);
  downloadWriteChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** 当前进程内真正在下载的任务；清理/配额/删除不得把它们当历史项。 */
const activeDownloadIds = new Set<string>();
const activeCancelHandlers = new Map<string, () => Promise<void> | void>();

function isActiveDownload(id: string) {
  return activeDownloadIds.has(id);
}

function updateItem(id: string, patch: Partial<DownloadItem>): Promise<DownloadItem[]> {
  return withDownloadWrite(async () => {
    const items = await loadDownloadItemsForWrite();
    const next = items.map((item) => (item.id === id ? { ...item, ...patch } : item));
    await saveDownloadItems(next);
    return next;
  });
}

export async function enqueueDownload(params: {
  url: string;
  type?: DownloadType;
  name?: string;
  onProgress?: (item: DownloadItem) => void;
}) {
  const url = String(params.url || '').trim();
  if (!/^https?:\/\//i.test(url)) throw new Error('下载地址无效');

  // HLS（m3u8）是分段索引，直接下载只会得到几 KB 的 playlist，
  // 无法得到完整录播。明确报错，避免用户误以为下载成功。
  if (/\.m3u8(\?|$)/i.test(url)) {
    throw new Error('HLS 录播流（m3u8）暂不支持直接下载，请使用桌面工具或浏览器插件下载');
  }

  await FileSystem.makeDirectoryAsync(DOWNLOAD_DIR, { intermediates: true }).catch(() => undefined);

  const type = params.type || 'file';
  const item: DownloadItem = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    url,
    name: guessDownloadName(url, type, params.name),
    type,
    status: 'downloading',
    progress: 0,
    createdAt: Date.now(),
  };

  let replaced: DownloadItem[] = [];
  await withDownloadWrite(async () => {
    const existing = await loadDownloadItemsForWrite();
    replaced = existing.filter((old) => old.url === url);
    // 同 URL 重新入队前先取消仍在跑的旧任务，避免两个写入器抢同一个 localUri。
    for (const old of replaced) {
      const cancelOld = activeCancelHandlers.get(old.id);
      if (cancelOld) await cancelOld();
    }
    await saveDownloadItems([item, ...existing.filter((old) => old.url !== url)]);
  });
  // 旧记录被替换后其 localUri/publicUri 不再被任何列表引用，必须同步删除，否则成为配额外的孤儿文件。
  await Promise.all(
    replaced.map(async (old) => {
      if (old.localUri)
        await FileSystem.deleteAsync(old.localUri, { idempotent: true }).catch(() => undefined);
      await deletePublicCopy(old.publicUri);
    }),
  );

  activeDownloadIds.add(item.id);
  let cancelled = false;
  let resumable: { pauseAsync?: () => Promise<unknown> } | null = null;
  const cancel = async () => {
    cancelled = true;
    try {
      await resumable?.pauseAsync?.();
    } catch {
      /* ignore */
    }
  };
  activeCancelHandlers.set(item.id, cancel);

  const localUri = `${DOWNLOAD_DIR}${item.id}-${item.name}`;
  let progressTimer: ReturnType<typeof setTimeout> | null = null;
  let latestPatch: Partial<DownloadItem> | null = null;
  let progressWrite: Promise<unknown> = Promise.resolve();
  let progressClosed = false;
  const stopProgress = async () => {
    progressClosed = true;
    if (progressTimer) clearTimeout(progressTimer);
    progressTimer = null;
    latestPatch = null;
    await progressWrite.catch(() => undefined);
  };
  try {
    const headers: Record<string, string> = {
      'User-Agent': USER_AGENT,
      Referer: 'https://h5.48.cn/',
    };

    const createDownloadResumable = (FileSystem as any).createDownloadResumable;
    if (typeof createDownloadResumable === 'function') {
      const flushProgress = async () => {
        if (progressClosed || !latestPatch) return;
        const patch = latestPatch;
        latestPatch = null;
        progressTimer = null;
        progressWrite = updateItem(item.id, patch);
        await progressWrite;
      };

      const updateProgress = (written: number, expected: number) => {
        if (progressClosed || cancelled) return;
        const total = Number(expected) || 0;
        const done = Number(written) || 0;
        const progress = total > 0 ? Math.max(0, Math.min(1, done / total)) : 0;
        latestPatch = { progress, downloadedBytes: done, totalBytes: total, status: 'downloading' };
        if (params.onProgress) params.onProgress({ ...item, ...latestPatch } as DownloadItem);
        if (!progressTimer)
          progressTimer = setTimeout(() => {
            flushProgress().catch(() => undefined);
          }, 350);
      };

      const dl = createDownloadResumable(url, localUri, { headers }, (p: any) => {
        updateProgress(p?.totalBytesWritten || 0, p?.totalBytesExpectedToWrite || 0);
      });
      resumable = dl;

      const result = await dl.downloadAsync();
      await stopProgress();
      if (cancelled) {
        await FileSystem.deleteAsync(result?.uri || localUri, { idempotent: true }).catch(
          () => undefined,
        );
        throw new Error('下载已取消');
      }
      const downloadedUri = result?.uri;
      const savedUri = downloadedUri || localUri;
      // 图片只进系统相册（MediaLibrary），不再额外导出到 Downloads，否则一次下载会存两份
      const exported =
        item.type === 'image' ? {} : await tryExportToPublicDownloads(savedUri, item.name);
      const done = {
        status: 'done' as const,
        progress: 1,
        localUri: savedUri,
        publicUri: exported.publicUri,
        exportError: exported.exportError,
      };
      await updateItem(item.id, done);
      // 下载完成后按额度淘汰最早的缓存（离线优先但不过度占存储）
      await enforceCacheQuota().catch(() => undefined);

      // Auto-save to gallery so user can find it (图片/视频/录播均进系统相册)
      if (item.type === 'image' || item.type === 'video' || item.type === 'replay') {
        try {
          const { status } = await MediaLibrary.requestPermissionsAsync();
          if (status === 'granted') {
            await MediaLibrary.createAssetAsync(done.localUri || localUri);
            // 不调用 createAlbumAsync：Android 会弹「允许修改此相片」，拒绝后资源已入库造成“拒绝仍保存”
          }
        } catch {}
      }

      return { ...item, ...done };
    }

    const { uri: downloadedUri } = await FileSystem.downloadAsync(url, localUri, { headers });
    if (cancelled) {
      await FileSystem.deleteAsync(downloadedUri || localUri, { idempotent: true }).catch(
        () => undefined,
      );
      throw new Error('下载已取消');
    }
    const exported =
      item.type === 'image'
        ? {}
        : await tryExportToPublicDownloads(downloadedUri || localUri, item.name);
    const done = {
      status: 'done' as const,
      progress: 1,
      localUri: downloadedUri || localUri,
      publicUri: exported.publicUri,
      exportError: exported.exportError,
    };
    await updateItem(item.id, done);
    await enforceCacheQuota().catch(() => undefined);

    // Auto-save to gallery so user can find it (图片/视频/录播均进系统相册)
    if (item.type === 'image' || item.type === 'video' || item.type === 'replay') {
      try {
        const { status } = await MediaLibrary.requestPermissionsAsync();
        if (status === 'granted') {
          await MediaLibrary.createAssetAsync(done.localUri || localUri);
          // 不调用 createAlbumAsync：避免 Android「修改此相片」权限弹窗
        }
      } catch (e) {
        logError(e, 'downloads.saveToGallery');
      }
    }

    return { ...item, ...done };
  } catch (error: any) {
    await stopProgress();
    const failed = { status: 'failed' as const, error: error?.message || String(error) };
    await updateItem(item.id, failed);
    throw error;
  } finally {
    activeDownloadIds.delete(item.id);
    activeCancelHandlers.delete(item.id);
  }
}

export async function deleteDownloadItem(id: string) {
  const cancel = activeCancelHandlers.get(id);
  if (cancel) await cancel();
  await withDownloadWrite(async () => {
    const items = await loadDownloadItemsForWrite();
    const target = items.find((item) => item.id === id);
    if (target?.localUri) {
      await FileSystem.deleteAsync(target.localUri, { idempotent: true }).catch(() => undefined);
    }
    await deletePublicCopy(target?.publicUri);
    await saveDownloadItems(items.filter((item) => item.id !== id));
  });
}

export async function clearFinishedDownloads() {
  await withDownloadWrite(async () => {
    const items = await loadDownloadItemsForWrite();
    const finished = items.filter(
      (item) => (item.status === 'done' || item.status === 'failed') && !isActiveDownload(item.id),
    );
    await Promise.all(
      finished.map((item) =>
        Promise.all([
          item.localUri
            ? FileSystem.deleteAsync(item.localUri, { idempotent: true }).catch(() => undefined)
            : Promise.resolve(),
          deletePublicCopy(item.publicUri),
        ]),
      ),
    );
    await saveDownloadItems(
      items.filter(
        (item) =>
          isActiveDownload(item.id) || item.status === 'downloading' || item.status === 'queued',
      ),
    );
  });
}

/**
 * 缓存额度淘汰（LRU by 创建时间）。
 * 在每次下载完成时调用：超出 MAX_CACHE_BYTES 后，从最早的「已完成」项开始删文件，直到回到额度内。
 */
export async function enforceCacheQuota(maxBytes: number = MAX_CACHE_BYTES): Promise<void> {
  return withDownloadWrite(async () => {
    let items = await loadDownloadItemsForWrite();
    const done = items.filter((i) => i.status === 'done' && i.localUri);
    // totalBytes 可能缺失（服务端无 Content-Length / fallback 路径下载），这类文件
    // 之前永不参与淘汰。这里用实际文件大小兜底，确保 4GB 额度对全部完成项生效。
    const entries = (
      await Promise.all(
        done.map(async (i) => {
          let bytes = i.totalBytes || 0;
          if (bytes <= 0) {
            const info = await FileSystem.getInfoAsync(i.localUri!).catch(() => null);
            bytes = info && info.exists ? info.size || 0 : 0;
          }
          return { item: i, bytes };
        }),
      )
    ).filter((e) => e.bytes > 0);
    let total = entries.reduce((sum, e) => sum + e.bytes, 0);
    if (total <= maxBytes) return;

    const oldestFirst = [...entries].sort((a, b) => a.item.createdAt - b.item.createdAt);
    for (const { item: target, bytes } of oldestFirst) {
      if (total <= maxBytes) break;
      await FileSystem.deleteAsync(target.localUri!, { idempotent: true }).catch(() => undefined);
      items = items
        .map((i) => (i.id === target.id && i.publicUri ? { ...i, localUri: undefined } : i))
        .filter((i) => i.id !== target.id || !!i.publicUri);
      total -= bytes;
    }
    await saveDownloadItems(items);
  });
}

/**
 * 离线优先解析播放地址 —— 被动观看缓存与主动下载共用同一缓存。
 * 若该 url 已有「已完成」的本地下载且文件仍在，直接返回本地路径，省流量、可离线。
 */
export async function resolvePlayableUri(url: string): Promise<string | null> {
  const target = String(url || '').trim();
  if (!/^https?:\/\//i.test(target)) return null;
  const items = await loadDownloadItems();
  const hit = items.find(
    (i) => i.status === 'done' && i.url === target && (i.localUri || i.publicUri),
  );
  if (!hit) return null;
  if (hit.localUri) {
    const info = await FileSystem.getInfoAsync(hit.localUri).catch(() => null);
    if (info?.exists) return hit.localUri;
  }
  return hit.publicUri || null;
}

export async function openDownloadItem(item: DownloadItem) {
  if (
    Platform.OS === 'android' &&
    item.publicUri &&
    NativeModules.PublicDownloads?.openPublicDownload
  ) {
    await NativeModules.PublicDownloads.openPublicDownload(
      item.publicUri,
      mimeTypeForDownload(item.name),
    );
    return;
  }
  let target: string | undefined = item.localUri || undefined;

  // 离线兜底：本地文件若已被系统清理/丢失，优雅降级而非崩溃
  if (target) {
    const info = await FileSystem.getInfoAsync(target).catch(() => null);
    if (!info || !info.exists) target = undefined;
  }
  if (!target && /^https?:\/\//i.test(item.url || '')) {
    // 缓存缺失时回退在线地址（忽略缓存错误，保证可播）
    target = item.url;
  }
  if (!target) {
    Alert.alert('无法打开', '本地文件已失效，且无法在线打开');
    return;
  }

  // For images/videos: save to device gallery then open
  if (item.type === 'image' || item.type === 'video') {
    try {
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== 'granted') {
        // Fall back to direct open
        if (Platform.OS === 'android' && target.startsWith('file://')) {
          try {
            const getContentUriAsync = (FileSystem as any).getContentUriAsync;
            if (typeof getContentUriAsync === 'function') {
              const contentUri = await getContentUriAsync(target);
              if (contentUri) {
                await Linking.openURL(contentUri);
                return;
              }
            }
          } catch (e) {
            logError(e, 'downloads.openFileViaContentUri');
          }
        }
        await Linking.openURL(target);
        return;
      }

      const cachedGalleryUri = (item as DownloadItem & { galleryUri?: string }).galleryUri;
      if (cachedGalleryUri) {
        let opened = false;
        await Linking.openURL(cachedGalleryUri)
          .then(() => {
            opened = true;
          })
          .catch(() => {});
        if (opened) return;
      }
      // Save to gallery (once; reuse galleryUri on subsequent opens to avoid duplicates)
      const asset = await MediaLibrary.createAssetAsync(target);
      if (asset) {
        const galleryUri = `content://media/external/file/${asset.id}`;
        void updateItem(item.id, { galleryUri } as Partial<DownloadItem>).catch(() => undefined);
        // 不建相册：避免 Android「修改此相片」权限弹窗
        await Linking.openURL(galleryUri).catch(async () => {
          await Linking.openURL(target);
        });
        return;
      }
    } catch {
      // fall through
    }
  }

  // Generic file open
  if (target.startsWith('file://') && Platform.OS === 'android') {
    try {
      const getContentUriAsync = (FileSystem as any).getContentUriAsync;
      if (typeof getContentUriAsync === 'function') {
        const contentUri = await getContentUriAsync(target);
        if (contentUri) {
          await Linking.openURL(contentUri);
          return;
        }
      }
    } catch {}
  }
  await Linking.openURL(target);
}

export async function exportExistingDownload(item: DownloadItem): Promise<DownloadItem> {
  if (Platform.OS !== 'android') return item;
  if (!item.localUri) throw new Error('应用内下载文件已不存在，请重新下载');
  const info = await FileSystem.getInfoAsync(item.localUri).catch(() => null);
  if (!info?.exists || (info.size || 0) <= 0) throw new Error('应用内下载文件不存在或为空');
  const publicUri = await exportToPublicDownloads(item.localUri, item.name);
  const next = { ...item, publicUri, exportError: undefined };
  await updateItem(item.id, { publicUri, exportError: undefined });
  return next;
}
