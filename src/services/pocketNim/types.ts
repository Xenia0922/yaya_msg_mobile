export const NIM_APP_KEY = '632feff1f4c838541ab75195d1ceb3fa';

export const NIM_CHATROOM_ADDRESSES = ['chatweblink01.netease.im:443'];

export const NimMsgType = {
  TEXT: 'TEXT',
  REPLY: 'REPLY',
  GIFTREPLY: 'GIFTREPLY',

  BARRAGE_NORMAL: 'BARRAGE_NORMAL',

  BARRAGE_MEMBER: 'BARRAGE_MEMBER',

  BARRAGE_SUPERMAN: 'BARRAGE_SUPERMAN',

  BARRAGE_PAY: 'BARRAGE_PAY',

  BARRAGE_STARWO: 'BARRAGE_STARTWO',

  PRESENT: 'PRESENT_NORMAL',
  PRESENT_TEXT: 'PRESENT_TEXT',
  PRESENT_GLOBAL: 'PRESENT_GLOBAL',
  EXPRESS: 'EXPRESSIMAGE',
  IMAGE: 'IMAGE',
  AUDIO: 'AUDIO',
  VIDEO: 'VIDEO',

  EVENT_HAVEHEAD_ENTER: 'EVENT_HAVEHEAD_ENTER',
  EVENT_NOHEAD_ENTER: 'EVENT_NOHEAD_ENTER',
  EVENT_VIP_ENTER: 'EVENT_VIP_ENTER',
  LIVE_ANNOUNCE: 'LIVE_ANNOUNCE',
  KTV_SONG_MSG: 'KTV_SONG_MSG',
  GENERAL_SEND_GIFT: 'GENERAL_SEND_GIFT',
  LIVEPUSH: 'LIVEPUSH',
  CLOSELIVE: 'CLOSELIVE',
} as const;

export const NimModule = {
  LIVE: 'live',
  PUBLIC: 'public',
  QCHAT: 'QCHAT',
  SESSION: 'session',
  NETFACE: 'NETFACE',
  WORLD_CHAT: 'WORLD_CHAT',
} as const;

export type BarrageKind =
  'text' | 'member' | 'superman' | 'pay' | 'starwo' | 'gift' | 'enter' | 'system' | 'other';

export interface BarrageItem {
  id: string;
  kind: BarrageKind;

  messageType: string;

  text: string;
  nick: string;
  avatar: string;
  userId: string;

  roleId: number;
  level: number;

  time: number;

  liveEvent?: {
    multiMicUserInfoList?: any[];
    pkStatus?: number;
    pkCreateSuccess?: number;
    pkFailStatus?: number;
    topUserInfo?: any;
    [key: string]: unknown;
  };

  gift?: {
    giftId: number;
    giftName: string;
    giftNum: number;
    tpNum: number;
    toName: string;
    picPath: string;

    zipPath?: string;

    zipMd5?: string;

    resourceType?: number;
  };
}

export interface NimCredentials {
  accid: string;

  token: string;

  userId: number | string;
  nickName: string;
  avatar: string;
  level: number;
  roleId: number;
}

export interface NimSelfProfile {
  userId: number | string;
  nickName: string;
  avatar: string;
  level?: number;
  roleId?: number;
  accid?: string;

  vip?: boolean;
  pfUrl?: string;
  teamLogo?: string | null;
  badge?: unknown[];

  sessionRole?: number;

  isStar?: boolean;
}
