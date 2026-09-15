/**
 * 口袋48 · 云信（NIM）通道常量与类型。
 *
 * 逆向自官方 口袋48 7.1.39（classes5.dex）：
 *   com.pocket.snh48.lib.yunxin.im.NIMStrategy#getOptions   → appKey
 *   com.pocket.snh48.lib.yunxin.model.MsgType                → messageType 常量表
 *   com.pocket.snh48.lib.yunxin.model.ModuleType             → module 常量表
 *   com.pocket.snh48.lib.yunxin.model.ChatMsgBuilder         → 各消息 remoteExtension 结构
 *   com.pocket.snh48.lib.yunxin.im.IMChatRoom                → 直播弹幕（聊天室）收发
 *
 * 结论：口袋48 的「发送」全部走云信，HTTP 侧没有任何发送接口（已用接口探测确认 404）。
 */

/** 官方 appKey（NIMStrategy.getOptions 明文） */
export const NIM_APP_KEY = '632feff1f4c838541ab75195d1ceb3fa';

/** 官方聊天室入口（48tools 同款；云信 chatroom 专用长连接域） */
export const NIM_CHATROOM_ADDRESSES = ['chatweblink01.netease.im:443'];

/** MsgType（com.pocket.snh48.lib.yunxin.model.MsgType） */
export const NimMsgType = {
  TEXT: 'TEXT',
  REPLY: 'REPLY',
  GIFTREPLY: 'GIFTREPLY',
  /** 直播弹幕：普通 */
  BARRAGE_NORMAL: 'BARRAGE_NORMAL',
  /** 直播弹幕：成员本人 */
  BARRAGE_MEMBER: 'BARRAGE_MEMBER',
  /** 直播弹幕：超管 */
  BARRAGE_SUPERMAN: 'BARRAGE_SUPERMAN',
  /** 直播弹幕：付费 */
  BARRAGE_PAY: 'BARRAGE_PAY',
  /** 星愿弹幕 */
  BARRAGE_STARWO: 'BARRAGE_STARTWO',
  /** 礼物（公屏） */
  PRESENT: 'PRESENT_NORMAL',
  PRESENT_TEXT: 'PRESENT_TEXT',
  PRESENT_GLOBAL: 'PRESENT_GLOBAL',
  EXPRESS: 'EXPRESSIMAGE',
  IMAGE: 'IMAGE',
  AUDIO: 'AUDIO',
  VIDEO: 'VIDEO',
  /** 进房（带头像特效 / 无头像 / VIP） */
  EVENT_HAVEHEAD_ENTER: 'EVENT_HAVEHEAD_ENTER',
  EVENT_NOHEAD_ENTER: 'EVENT_NOHEAD_ENTER',
  EVENT_VIP_ENTER: 'EVENT_VIP_ENTER',
  LIVE_ANNOUNCE: 'LIVE_ANNOUNCE',
  KTV_SONG_MSG: 'KTV_SONG_MSG',
  GENERAL_SEND_GIFT: 'GENERAL_SEND_GIFT',
  LIVEPUSH: 'LIVEPUSH',
  CLOSELIVE: 'CLOSELIVE',
} as const;

/** ModuleType（com.pocket.snh48.lib.yunxin.model.ModuleType） */
export const NimModule = {
  LIVE: 'live',
  PUBLIC: 'public',
  QCHAT: 'QCHAT',
  SESSION: 'session',
  NETFACE: 'NETFACE',
  WORLD_CHAT: 'WORLD_CHAT',
} as const;

/** 弹幕归一化后的类别（UI 按此决定样式） */
export type BarrageKind =
  | 'text' // 普通文本（聊天室 text 消息 / 成员弹幕）
  | 'member' // 成员本人弹幕
  | 'superman' // 超管弹幕
  | 'pay' // 付费弹幕
  | 'starwo' // 星愿弹幕
  | 'gift' // 礼物公屏
  | 'enter' // 进房
  | 'system' // 系统提示（公告 / 开播 / 关播 / KTV 等）
  | 'other';

/** 弹幕/公屏消息（UI 直接消费） */
export interface BarrageItem {
  /** 唯一 id（uuid / idClient） */
  id: string;
  kind: BarrageKind;
  /** 原始 messageType（排查用） */
  messageType: string;
  /** 正文（礼物类已拼成「A 送给 B 3 个礼物」） */
  text: string;
  nick: string;
  avatar: string;
  userId: number;
  /** 角色：0 普通 / 1 成员 / 2 超管（官方 roleId 语义） */
  roleId: number;
  level: number;
  /** 毫秒时间戳 */
  time: number;
  /** 礼物附带信息 */
  gift?: { giftId: number; giftName: string; giftNum: number; tpNum: number; toName: string; picPath: string };
}

/** 云信登录凭证（口袋48 HTTP im/api/v1/im/userinfo 下发） */
export interface NimCredentials {
  accid: string;
  /** 云信 token（官方字段名 pwd / token / imPwd） */
  token: string;
  userId: number;
  nickName: string;
  avatar: string;
  level: number;
  roleId: number;
}

/** 发送弹幕用的自身资料（塞进 remoteExtension.user） */
export interface NimSelfProfile {
  userId: number;
  nickName: string;
  avatar: string;
  level?: number;
  roleId?: number;
  accid?: string;
}
