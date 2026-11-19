export interface Member {
  ownerName: string;
  id: string;
  /** 口袋 userId（friends/id 返回值；部分历史数据只填 userId，不一定等于 id） */
  userId?: string;
  /** 成员库内部 memberId（历史数据可能缺省） */
  memberId?: string;
  serverId: string;
  channelId: string;
  yklzId: string;
  roomId?: string;
  liveRoomId?: string;
  /** 口袋账号（部分接口返回，用于直播/房间匹配） */
  account?: string;
  team: string;
  pinyin: string;
  isInGroup: boolean;
  avatar: string;
  groupName: string;
  teamId: string;
  /** 官方队伍 Logo（房间头部队伍标签用图；缺失时回退文字） */
  teamLogo?: string;
  /** 成员状态分类（官方源优先）：active 在团 / left 退团 / graduated 毕业 / paused 暂休 / unknown 未知 */
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

/**
 * 口袋 HTTP 接口通用响应包络。
 * 官方各端返回字段不统一：业务数据可能在 content / data，状态可能在 status / code，
 * 顶层还可能透传 alreadyChecked、_request 等扩展字段。
 */
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
  /** 旧接口/调试字段透传；取值处需按业务类型收窄 */
  [key: string]: any;
}

/** 网络边界上字段形态不固定的 JSON 对象；进入业务层后应转成具体类型 */
export type WireRecord = Record<string, any>;

/**
 * 房间消息的原始 wire 结构（口袋 HTTP / QChat 推送共用）。
 * 官方字段随版本漂移：常用字段显式列出，未列出的字段从索引签名透传。
 */
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
  /** 标记来自实时 QChat 推送（仅诊断用） */
  __live?: boolean;
  /** 官方消息字段随版本漂移，未列出的字段透传；取值时用 String/Number 归一 */
  [key: string]: any;
}

/** 私信会话列表的原始 wire 结构（message/api/v1/user/message/list） */
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

/** 私信消息的原始 wire 结构（message/api/v1/user/message/info） */
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

/** 成员库/关注列表的松散摘要（id 可能是 id / userId / memberId / account） */
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

/** B 站扫码登录后的用户信息（LoginScreen 写入；未登录为 null） */
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
  /** Token 签发时绑定的设备标识（空 = 使用本机持久化 deviceId；跨设备导入凭证时保留源设备 ID） */
  p48DeviceId?: string;
  /** 登录/请求身份：pocket48 = 口袋48 客户端身份，seine48 = 塞纳河48 客户端身份（appInfo/UA 不同） */
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
  /** 赞赏码图片（data URI；空 = 未设置，设置页可从相册选择） */
  donateQrImage?: string;
  yaya_trip_show_all: boolean;
  meet48Auth?: Meet48Auth | null;
  /** 画中画（系统小窗）：视频播放中切后台自动弹系统悬浮窗。默认关——不主动调用不弹 App 外小窗 */
  pip_auto: boolean;
  /** 弹幕/房间消息自定义昵称（留空用登录账号昵称） */
  yaya_send_nickname: string;
  /** 弹幕/房间消息自定义头像 URL（留空用登录账号头像） */
  yaya_send_avatar: string;
  /** 自定义等级（留空用登录账号） */
  yaya_send_level: string;
  /** 自定义账号身份 roleId（留空用登录账号；1=普通用户 2/3/4/5=成员 999=超管） */
  yaya_send_roleid: string;
  /** 自定义房间身份 sessionRole（留空=0 普通观众；1=房管 2=房主 3=成员本人 99=超管） */
  yaya_send_session_role: string;
  /** 自定义 VIP（''=跟随账号 'on'/'off'） */
  yaya_send_vip: string;
  /** 个性装扮：头像框 pfUrl（留空 = 不带；相对路径自动补 source1.48.cn） */
  yaya_send_pfurl: string;
  /** 个性装扮：队标 teamLogo（留空 = 不带） */
  yaya_send_teamlogo: string;
  /** 'on' = 自定义队标同时以成员身份（isStar）发送，官方客户端才会画队标；空 = 不伪装 */
  yaya_send_is_star: string;
  /** 个性装扮：勋章 badge（多个用逗号分隔；留空 = 不带） */
  yaya_send_badge: string;
  /** 口袋官方聊天气泡 id（0=默认）；发房间消息时随 bubbleId 发送 */
  yaya_send_bubble_id: string;
  /** 直播进场特效 id（选中即同步账号；空=不使用） */
  yaya_live_effect_id: string;
  /** 直播进场特效名称（仅展示用） */
  yaya_live_effect_name: string;
  /** 直播弹幕气泡 id（选中即同步账号；空=不使用） */
  yaya_live_bubble_id: string;
  /** 直播弹幕气泡名称（仅展示用） */
  yaya_live_bubble_name: string;
  /** 首页「私信」入口的未读红点角标。默认开 */
  yaya_pm_unread_badge: boolean;
  /** 首页模块顺序（C4）：空数组 = 使用默认顺序（live/performances/quick/resume/tools） */
  home_modules_order: string[];
  /** 首页模块隐藏列表（C4）：默认空 */
  home_modules_hidden: string[];
}
