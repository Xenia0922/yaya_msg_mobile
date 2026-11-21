import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { USER_AGENT } from '../constants';

const HEADERS = {
  'User-Agent': USER_AGENT,
  Referer: 'https://h5.48.cn/',
  Origin: 'https://h5.48.cn',
};

export async function shareRemoteImage(url: string, name = 'image.jpg'): Promise<void> {
  const u = String(url || '').trim();
  if (!/^https?:\/\//i.test(u)) throw new Error('图片地址无效');
  const dir = `${FileSystem.cacheDirectory || ''}share/`;
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => undefined);
  const ext = (u.match(/\.(jpe?g|png|webp)(?:\?|$)/i)?.[1] || 'jpg').toLowerCase();
  const local = `${dir}${name.replace(/\.[^.]+$/, '')}.${ext}`;
  const res = await FileSystem.downloadAsync(u, local, { headers: HEADERS });
  if (!res?.uri) throw new Error('图片下载失败');
  if (!(await Sharing.isAvailableAsync())) throw new Error('系统分享不可用');
  await Sharing.shareAsync(res.uri, {
    mimeType: ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg',
    dialogTitle: '分享图片',
    UTI: 'public.jpeg',
  });
}
