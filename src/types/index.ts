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

export type Theme = 'light' | 'dark';

export interface AppSettings {
  theme: Theme;
  p48Token: string;
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
}
