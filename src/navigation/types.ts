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
  PrivateMessagesScreen: undefined;
  BilibiliLiveScreen: undefined;
  VideoLibraryScreen: undefined;
  MusicLibraryScreen: undefined;
  AudioProgramsScreen: undefined;
  AnalysisScreen: undefined;
  DownloadScreen: undefined;
  DatabaseScreen: undefined;
  ApiDiagnosticsScreen: undefined;
};

export type TabParamList = {
  Home: undefined;
  Media: { mode?: 'live' | 'vod' } | undefined;
  Rooms: undefined;
  Settings: undefined;
};
