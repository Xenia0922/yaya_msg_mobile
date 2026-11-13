export interface Member {
  ownerName: string;
  id: string;
  serverId: string;
  channelId: string;
  yklzId: string;
  roomId?: string;
  liveRoomId?: string;
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
  /** 登录/请求身份：pocket48 = 口袋48 客户端身份，seine48 = 塞纳河48 客户端身份（appInfo/UA 不同） */
  p48ClientProfile: 'pocket48' | 'seine48';
  bilibiliCookie: string;
  bilibiliUserInfo: any;
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
  yaya_trip_show_all: boolean;
  meet48Auth?: Meet48Auth | null;
  /** 画中画（系统小窗）：视频播放中切后台自动弹系统悬浮窗。默认关——不主动调用不弹 App 外小窗 */
  pip_auto: boolean;
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
}
