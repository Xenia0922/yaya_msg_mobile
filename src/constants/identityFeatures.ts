import { IS_PLUS_BUILD } from './channel';

/** 普通版使用账号真实发言资料；Plus 可自定义发言资料和身份权限。 */
export const ALLOW_CUSTOM_SENDER_PROFILE = IS_PLUS_BUILD;
export const ALLOW_CUSTOM_TEAM_LOGO = IS_PLUS_BUILD;
export const ALLOW_CUSTOM_IDENTITY_ROLES = IS_PLUS_BUILD;
export const ALLOW_VIP_STICKERS = true;

export const VIP_FEATURE_NOTICE = 'VIP 装扮和表情以口袋账号权限及平台规则为准；使用可能导致账号受限，风险自担。';
