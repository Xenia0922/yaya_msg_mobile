// 默认普通版；scripts/write-build-channel.js 在构建时写入所选渠道与出包标识。
export const BUILD_CHANNEL: 'plus' | 'public' = 'public';
/** 出包标识（渠道-MMDD-HHMM）。开发环境为空串，导出日志时省略。 */
export const BUILD_TAG = '';
