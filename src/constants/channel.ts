/**
 * 构建渠道标识（决定「应用内更新」是否可用）。
 *
 * - `plus`：**自用权限版**。不对外分发、也不允许应用内自动更新。
 * - `public`：公开发行版，应用内更新启用。
 *
 * scripts/build-apk.js 根据 YAYA_FLAVOR 写入构建渠道，不能只修改 APK 文件名。
 */
import { BUILD_CHANNEL } from './buildChannel';

export const APP_CHANNEL: 'plus' | 'public' = BUILD_CHANNEL;

// TS5.9 会把 const 收窄成初始值字面量类型，直接 === 另一成员会报 TS2367；
// 先放宽成 string 再比较。
const channelName: string = APP_CHANNEL;

/** 自用权限版构建：禁用应用内更新，避免被公版覆盖或对外流出 */
export const IS_PLUS_BUILD = channelName === 'plus';
