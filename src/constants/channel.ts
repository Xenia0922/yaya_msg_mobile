/**
 * 构建渠道标识（决定「应用内更新」是否可用）。
 *
 * - `plus`：**自用权限版**（本地 plus 分支）。不对外分发、也不允许应用内自动更新 ——
 *   更新源是公开仓库的 Release（public 包），装上去会把权限版直接覆盖成公版。
 * - `public`：公开发行版。应用内更新只下载公开 Release 里的
 *   `yaya-msg-mobile-<tag>-<abi>.apk`，永远不会匹配到 `yaya-msg-mobile-plus-*`。
 *
 * ⚠️ 把代码同步到自用分支时，这里必须改回 `'plus'`；公开分支保持 `'public'`。
 */
export type AppChannel = 'plus' | 'public';
export const APP_CHANNEL: AppChannel = 'public';

// TS5.9 会把 const 字面量收窄成初始值类型，直接 === 另一个成员会报 TS2367；
// 先放宽成 string 再比较，两个分支都能编译。
const channelName: string = APP_CHANNEL;

/** 自用权限版：禁用应用内更新 / 下载安装，避免被公版覆盖或对外流出 */
export const IS_PLUS_BUILD = channelName === 'plus';
