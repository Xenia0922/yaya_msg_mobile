export type StreamKind = 'live' | 'vod' | 'audio' | 'image' | 'link';

export interface PlayerSource {
  kind: StreamKind;

  url: string;

  urls?: string[];

  headers?: Record<string, string>;
  liveId?: string;

  needsNativeExo?: boolean;

  audioOnly?: boolean;

  coverPortrait?: boolean;

  volume?: number;

  volumeBoost?: number;
}

export interface PlayerMeta {
  title: string;
  cover?: string;
}

export interface PocketPlayerInfo {
  name: string;
  avatar?: string;
  liveId?: string;
  audience?: string;
  rankAvatars?: string[];
  comments?: Array<PocketComment>;
  replayComments?: Array<{
    time: number;
    text: string;
    nick?: string;
    userId?: string;
    avatar?: string;
    level?: number;
  }>;
  onRankPress?: () => void;
  onHostPress?: () => void;
  onCommentPress?: (comment: PocketComment) => void;
}

export interface PocketComment {
  id: string;
  text: string;
  nick?: string;
  level?: number;
  kind?: string;
  userId?: number | string;
  avatar?: string;
}

export type DanmakuSource =
  | { type: 'none' }
  | { type: 'poll'; liveId: string }
  | { type: 'lrc'; lrcUrl: string; liveId?: string }
  | { type: 'ws'; roomId: string };

export interface PlayerFeatures {
  rate?: boolean;

  danmaku?: boolean;

  gift?: boolean;

  rank?: boolean;

  quality?: boolean;

  resume?: boolean;

  kernelSwitch?: boolean;
}

export interface PlayerScreenProps {
  source: PlayerSource;
  meta: PlayerMeta;
  pocket?: PocketPlayerInfo;
  danmaku?: DanmakuSource;
  features?: PlayerFeatures;

  extraActions?: Array<{
    key: string;
    icon: string;
    label: string;
    active?: boolean;
    onPress: () => void;
  }>;
  onClose?: () => void;

  chromeHidden?: boolean;
  liveTransitionKey?: number;
}
