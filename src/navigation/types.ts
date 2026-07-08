import { NavigatorScreenParams } from '@react-navigation/native';

export type RootStackParamList = {
  Main: NavigatorScreenParams<TabParamList>;
  MessagesScreen: undefined;
  LoginScreen: undefined;
  RechargeScreen: undefined;
  FetchScreen: undefined;
  FlipScreen: { mode?: 'view' | 'send' } | undefined;
  ProfileScreen: undefined;
  PhotosScreen: undefined;
  RoomAlbumScreen: undefined;
  RoomRadioScreen: undefined;
  OpenLiveScreen: undefined;
  PrivateMessagesScreen: { targetUserId?: string; targetName?: string } | undefined;
  BilibiliLiveScreen: undefined;
  VideoLibraryScreen: undefined;
  MusicLibraryScreen: undefined;
  AudioProgramsScreen: undefined;
  AnalysisScreen: undefined;
  DownloadScreen: undefined;
  DatabaseScreen: undefined;
  ApiDiagnosticsScreen: undefined;
  TripScreen: undefined;
  MeleeRankScreen: undefined;
  MemberDynamicScreen: undefined;
  MemberWeiboScreen: undefined;
  InvoiceScreen: undefined;
  ConversationScreen: undefined;
  ScoreOfficialScreen: undefined;
};

export type TabParamList = {
  Home: undefined;
  Media: { mode?: 'live' | 'vod'; playLiveId?: string; playTitle?: string; playCover?: string } | undefined;
  Rooms: undefined;
  Settings: undefined;
};
