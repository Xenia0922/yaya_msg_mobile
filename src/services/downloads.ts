import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { Linking } from 'react-native';

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
  error?: string;
  createdAt: number;
  totalBytes?: number;
  downloadedBytes?: number;
}

const STORAGE_KEY = 'yaya_download_items_v1';
const DOWNLOAD_DIR = `${FileSystem.documentDirectory || ''}downloads/`;

function sanitizeName(name: string) {
  return String(name || 'download')
    .replace(/[\\/:*?"<>|#%{}^~[\]`]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 96);
}

function extensionFromUrl(url: string, fallback: DownloadType) {
  const clean = String(url || '').split('?')[0].split('#')[0];
  const match = clean.match(/\.([a-z0-9]{2,5})$/i);
  if (match) return `.${match[1].toLowerCase()}`;
  if (fallback === 'image') return '.jpg';
  if (fallback === 'voice' || fallback === 'audio') return '.m4a';
  if (fallback === 'video' || fallback === 'replay') return '.mp4';
  return '.bin';
}

export function guessDownloadName(url: string, type: DownloadType, title?: string) {
  const fromUrl = String(url || '').split('?')[0].split('/').pop() || '';
  const base = sanitizeName(title || decodeURIComponent(fromUrl || `${type}-${Date.now()}`));
  const hasExt = /\.[a-z0-9]{2,5}$/i.test(base);
  return hasExt ? base : `${base}${extensionFromUrl(url, type)}`;
}

export async function loadDownloadItems(): Promise<DownloadItem[]> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveDownloadItems(items: DownloadItem[]) {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

async function updateItem(id: string, patch: Partial<DownloadItem>) {
  const items = await loadDownloadItems();
  const next = items.map((item) => (item.id === id ? { ...item, ...patch } : item));
  await saveDownloadItems(next);
  return next;
}

export async function enqueueDownload(params: {
  url: string;
  type?: DownloadType;
  name?: string;
  onProgress?: (item: DownloadItem) => void;
}) {
  const url = String(params.url || '').trim();
  if (!/^https?:\/\//i.test(url)) throw new Error('下载地址无效');

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

  const existing = await loadDownloadItems();
  await saveDownloadItems([item, ...existing.filter((old) => old.url !== url)]);

  const localUri = `${DOWNLOAD_DIR}${item.id}-${item.name}`;
  try {
    const task = FileSystem.createDownloadResumable(url, localUri, {}, async (progress) => {
      const total = progress.totalBytesExpectedToWrite || 0;
      const written = progress.totalBytesWritten || 0;
      const nextItem = {
        ...item,
        status: 'downloading' as const,
        progress: total ? Math.min(1, written / total) : 0,
        totalBytes: total,
        downloadedBytes: written,
      };
      params.onProgress?.(nextItem);
    });
    const result = await task.downloadAsync();
    const done = { status: 'done' as const, progress: 1, localUri: result?.uri || localUri };
    await updateItem(item.id, done);
    return { ...item, ...done };
  } catch (error: any) {
    const failed = { status: 'failed' as const, error: error?.message || String(error) };
    await updateItem(item.id, failed);
    throw error;
  }
}

export async function deleteDownloadItem(id: string) {
  const items = await loadDownloadItems();
  const target = items.find((item) => item.id === id);
  if (target?.localUri) {
    await FileSystem.deleteAsync(target.localUri, { idempotent: true }).catch(() => undefined);
  }
  await saveDownloadItems(items.filter((item) => item.id !== id));
}

export async function clearFinishedDownloads() {
  const items = await loadDownloadItems();
  const finished = items.filter((item) => item.status === 'done' || item.status === 'failed');
  await Promise.all(finished.map((item) =>
    item.localUri ? FileSystem.deleteAsync(item.localUri, { idempotent: true }).catch(() => undefined) : Promise.resolve(),
  ));
  await saveDownloadItems(items.filter((item) => item.status === 'downloading' || item.status === 'queued'));
}

export async function openDownloadItem(item: DownloadItem) {
  const target = item.localUri || item.url;
  if (!target) return;
  if (target.startsWith('file://')) {
    const getContentUriAsync = (FileSystem as any).getContentUriAsync;
    if (typeof getContentUriAsync === 'function') {
      const contentUri = await getContentUriAsync(target);
      await Linking.openURL(contentUri);
      return;
    }
  }
  await Linking.openURL(target);
}
