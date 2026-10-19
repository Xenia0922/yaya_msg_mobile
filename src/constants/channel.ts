/**
 * 构建渠道标识（决定「应用内更新」是否可用）。
 *
 * - `plus`：**自用权限版**（本地 plus 分支）。不对外分发、也不允许应用内自动更新 ——
 *   更新源是公开仓库的 Release（public 包），装上去会把权限版直接覆盖成公版。
 * - `public`：公开发行版。应用内更新只下载公开 Release 里的
 *   `yaya-msg-mobile-<tag>-<abi>.apk`，永远不会匹配到 `yaya-msg-mobile-plus-*`。
 *
 * ⚠️ 把代码同步到公开分支时，这里必须改成 `'public'`，否则公版用户收不到更新。
 */
export const APP_CHANNEL: 'plus' | 'public' = 'plus';

/** 自用权限版：禁用应用内更新 / 下载安装，避免被公版覆盖或对外流出 */
export const IS_PLUS_BUILD = APP_CHANNEL === 'plus';
