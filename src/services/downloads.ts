import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { Linking, Platform } from 'react-native';

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

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chars: string[] = [];
  for (let i = 0; i < bytes.byteLength; i++) {
    chars.push(String.fromCharCode(bytes[i]));
  }
  return (global as any).btoa?.(chars.join('')) || base64Encode(bytes);
}

const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function base64Encode(bytes: Uint8Array): string {
  let result = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = bytes[i + 1] || 0;
    const c = bytes[i + 2] || 0;
    result += BASE64_CHARS[a >> 2];
    result += BASE64_CHARS[((a & 3) << 4) | (b >> 4)];
    result += i + 1 < bytes.length ? BASE64_CHARS[((b & 15) << 2) | (c >> 6)] : '=';
    result += i + 2 < bytes.length ? BASE64_CHARS[c & 63] : '=';
  }
  return result;
}

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
    const { uri: downloadedUri } = await FileSystem.downloadAsync(url, localUri, {
      headers: {
        'User-Agent': 'PocketFans201807/7.0.41 (iPhone; iOS 16.3.1; Scale/2.00)',
        Referer: 'https://h5.48.cn/',
      },
    });
    const done = { status: 'done' as const, progress: 1, localUri: downloadedUri || localUri };
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
  if (target.startsWith('file://') && Platform.OS === 'android') {
    try {
      const getContentUriAsync = (FileSystem as any).getContentUriAsync;
      if (typeof getContentUriAsync === 'function') {
        const contentUri = await getContentUriAsync(target);
        if (contentUri) { await Linking.openURL(contentUri); return; }
      }
    } catch { /* fall through */ }
  }
  await Linking.openURL(target);
}
