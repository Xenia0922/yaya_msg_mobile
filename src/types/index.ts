export interface Member {
  ownerName: string;
  id: string;

  userId?: string;

  memberId?: string;
  serverId: string;
  channelId: string;
  yklzId: string;
  roomId?: string;
  liveRoomId?: string;

  account?: string;
  team: string;
  pinyin: string;
  isInGroup: boolean;
  avatar: string;
  groupName: string;
  teamId: string;

  teamLogo?: string;

  state?: string;
}

export interface RoomMessage {
  id: string;
  msgId: string;
  messageId: string;
  clientMsgId: string;
  msgTime: number;
  msgType: string;
  senderUserId: string;
  senderId: string;
  uid: string;
  senderName: string;
  bodys: string;
  msgContent: string;
  extInfo: string | { user: UserInfo };
  channelId: string;
}

export interface UserInfo {
  nickName: string;
  avatar: string;
  userId: string;
  roleId: string;
}

export interface PrivateMessage {
  user: {
    userId: string;
    nickname: string;
    starName: string;
    realNickName: string;
    avatar: string;
    teamName: string;
    groupName: string;
    isStar: boolean;
    teamLogo: string;
  };
  newestMessage: string;
  newestMessagetime: number;
  noreadNum: number;
  targetUserId: string;
}

export interface FlipRecord {
  questionId: string;
  question: string;
  answer: string | { url: string; time?: number };
  answerType: number;
  status: number;
  type: number;
  cost: number;
  qtime: number;
  answerTime: number;
  memberId: string;
  memberName: string;
}

export interface VODItem {
  liveId: string;
  title: string;
  liveRoomTitle: string;
  screenDirection: number;
  liveType: number;
  startTime: number;
  endTime: number;
  playUrl: string;
  playPath: string;
  liveCover: string;
  coverPath: string;
  nickname: string;
  isRecording: boolean;
  clubId: string;
  groupId: number;
}

export interface GiftItem {
  id: string;
  name: string;
  cost: number;
  description?: string;
}

export interface FlipPrice {
  questionType: number;
  questionTypeDesc: string;
  price: number;
  maxLength: number;
}

export interface LiveGift {
  id: number;
  name: string;
  price: number;
  icon: string;
  type: number;
}

export interface BilibiliLiveRoom {
  roomId: string;
  name: string;
  isLive: boolean;
}

export interface ShowRecord {
  liveId: string;
  title: string;
  startTime: number;
  endTime: number;
  members: string[];
}

export interface NimLoginInfo {
  account: string;
  token: string;
}

export interface ApiEnvelope<T = any> {
  status?: number;
  code?: number;
  success?: boolean;
  message?: string;
  msg?: string;
  error?: string;
  statusDesc?: string;
  content?: T;
  data?: T;
  list?: unknown;

  [key: string]: any;
}

export type WireRecord = Record<string, any>;

export interface RoomMessageWire {
  id?: string | number;
  msgId?: string | number;
  messageId?: string | number;
  clientMsgId?: string;
  uuid?: string;
  msgUuid?: string;
  msgTime?: number | string;
  messageTime?: number | string;
  ctime?: number | string;
  time?: number | string;
  msgType?: string | number;
  extMsgType?: string | number;
  bodys?: unknown;
  body?: unknown;
  msgContent?: string;
  extInfo?: unknown;
  msgExtInfo?: unknown;
  senderUserId?: string | number;
  senderId?: string | number;
  fromUserId?: string | number;
  uid?: string | number;
  senderName?: string;
  nickName?: string;
  userAvatar?: string;
  avatar?: string;
  channelId?: string | number;
  serverId?: string | number;
  liveId?: string;
  giftInfo?: WireRecord;
  giftReplyInfo?: WireRecord;

  __live?: boolean;

  [key: string]: any;
}

export interface PrivateConversationWire {
  targetUserId?: string | number;
  userId?: string | number;
  userMessageId?: string | number;
  lastTime?: number;
  msgTime?: number;
  newestMessage?: string;
  newestMessagetime?: number;
  noreadNum?: number | string;
  user?: {
    userId?: string | number;
    nickname?: string;
    nickName?: string;
    starName?: string;
    realNickName?: string;
    avatar?: string;
    teamName?: string;
    groupName?: string;
    isStar?: boolean;
    teamLogo?: string;
    [key: string]: any;
  };
  [key: string]: any;
}

export interface PrivateMessageWire {
  id?: string | number;
  msgId?: string | number;
  messageId?: string | number;
  uuid?: string;
  msgTime?: number;
  messageTime?: number;
  ctime?: number;
  time?: number;
  fromUserId?: string | number;
  senderUserId?: string | number;
  toUserId?: string | number;
  targetUserId?: string | number;
  text?: string;
  message?: string;
  msgContent?: string;
  body?: unknown;
  bodys?: unknown;
  msgType?: string | number;
  messageType?: string | number;
  extInfo?: unknown;
  user?: Record<string, any>;
  [key: string]: any;
}

export interface MemberSummary {
  id?: string | number;
  userId?: string | number;
  memberId?: string | number;
  account?: string | number;
  ownerName?: string;
  nickName?: string;
  nickname?: string;
  avatar?: string;
  channelId?: string;
  serverId?: string;
  yklzId?: string;
  team?: string;
  groupName?: string;
  [key: string]: any;
}

export interface BilibiliUserInfo {
  mid: string;
  uname: string;
  face: string;
}

export interface MusicItem {
  id: string;
  title: string;
  artist: string;
  album: string;
  cover: string;
  url: string;
  lyricIndex?: string;
}

export interface AudioProgram {
  id: string;
  title: string;
  description: string;
  cover: string;
  url: string;
  date: string;
}

export interface VideoItem {
  id: string;
  title: string;
  description: string;
  cover: string;
  url: string;
  date: string;
  group: string;
}

export type MessageFilter = 'all' | 'text' | 'audio' | 'image' | 'video' | 'reply' | 'live-record';

export type Theme = 'light' | 'dark' | 'system';

export type LanguageSetting = 'system' | 'zh-Hans' | 'zh-Hant' | 'en' | 'ja' | 'ko';

export interface TripItem {
  id: string;
  title: string;
  subtitle: string;
  description: string;
  date: string;
  time: string;
  showDate: string;
  showTime: string;
  members: string[];
  location: string;
  liveText: string;
  ticketUrl: string;
  groupId: number;
  memberId: string;
  userId: string;
}

export interface MeleeWeek {
  weekRankId: number;
  weekRankName: string;
}

export interface MeleeRankItem {
  rankNum: number;
  baseUserInfo: {
    userName: string;
    userAvatar: string;
    userId: string;
  };
  topUserInfo: {
    userName: string;
    userAvatar: string;
    userId: string;
  };
  melee: string;
  resId?: number;
  charmInfo?: Array<{
    userName: string;
    userAvatar: string;
    userId: string;
    charm: string;
    isPrivacy: boolean;
  }>;
}

export interface DynamicItem {
  id: string;
  title: string;
  content: string;
  coverUrls: string[];
  time: number;
  ownerId: string;
  ownerName: string;
  ownerAvatar: string;
}

export interface WeiboItem {
  id: string;
  title: string;
  content: string;
  imageUrls: string[];
  jumpUrl: string;
  time: number;
  ownerId: string;
  ownerName: string;
  ownerAvatar: string;
}

export interface InvoiceOrder {
  dataId: string;
  goodsName: string;
  summary: string;
  invoiceStatus: number;
  invoiceNo: string;
  totalFee: string;
  tradeTime: string;
  tradeTimeLong: number;
  companyId: string;
}

export interface InvoiceConfig {
  companyId: string;
  saleName: string;
  maxFee: string;
  defaultFlag: boolean;
}

export interface ConversationItem {
  targetUserId: string;
  userId: string;
  nickname: string;
  avatar: string;
  lastMessage: string;
  lastTime: number;
  unreadNum: number;
  isStar: boolean;
}

export interface VoteStatus {
  voteId: string;
  voteName: string;
  startTime: number;
  endTime: number;
  status: number;
}

export interface PageantryItem {
  id: string;
  name: string;
  icon: string;
  description: string;
}

export interface AnnouncementData {
  id: string;
  header: string;
  title: string;
  fullContent: string;
  imageUrl: string;
  link: string;
  show: boolean;
  version?: string;
}

export interface Meet48Auth {
  token?: string;
  cookie?: string;
  deviceId?: string;
  disabled?: boolean;
}

export interface AppSettings {
  theme: Theme;
  language: LanguageSetting;
  p48Token: string;

  p48DeviceId?: string;

  p48ClientProfile: 'pocket48' | 'seine48';
  bilibiliCookie: string;
  bilibiliUserInfo: BilibiliUserInfo | null;
  msg_sort_order: 'asc' | 'desc';
  yaya_followed_custom_order: string[];
  yaya_music_play_mode: 'sequential' | 'random' | 'single';
  yaya_music_volume: number;
  yaya_audio_program_play_mode: 'sequential' | 'random' | 'single';
  yaya_auto_checkin_enabled: boolean;
  yaya_auto_checkin_last_date: string;
  yaya_auto_checkin_last_user: string;
  customBackgroundFile: string;
  customBackgroundUpdatedAt: number;

  donateQrImage?: string;
  yaya_trip_show_all: boolean;
  meet48Auth?: Meet48Auth | null;

  pip_auto: boolean;

  yaya_send_nickname: string;

  yaya_send_avatar: string;

  yaya_send_level: string;

  yaya_send_roleid: string;

  yaya_send_session_role: string;

  yaya_send_vip: string;

  yaya_send_pfurl: string;

  yaya_send_teamlogo: string;

  yaya_send_is_star: string;

  yaya_send_badge: string;

  yaya_send_bubble_id: string;

  yaya_live_effect_id: string;

  yaya_live_effect_name: string;

  yaya_live_bubble_id: string;

  yaya_live_bubble_name: string;

  yaya_pm_unread_badge: boolean;

  yaya_room_list_time?: boolean;

  home_modules_order: string[];

  home_modules_hidden: string[];
}
