import React, { useCallback, useEffect, useRef } from 'react';
import { NavigationContainer, DefaultTheme, DarkTheme, useFocusEffect } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { createStackNavigator } from '@react-navigation/stack';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { useSettingsStore, useUiStore } from '../store';
import { Palettes } from '../theme/colors';
import { ensureMemberData } from '../services/memberData';
import { RootStackParamList, TabParamList } from './types';
import { AppTabBar, MCI } from '../components/AppTabBar';
import { usePalette } from '../theme';
import HomeScreen from '../screens/HomeScreen';
import MessagesScreen from '../screens/MessagesScreen';
import MediaScreen from '../screens/MediaScreen';
import FollowedRoomsScreen from '../screens/FollowedRoomsScreen';
import LoginScreen from '../screens/LoginScreen';
import RechargeScreen from '../screens/RechargeScreen';
import FlipScreen from '../screens/FlipScreen';
import ProfileScreen from '../screens/ProfileScreen';
import SettingsScreen from '../screens/SettingsScreen';
import FetchScreen from '../screens/FetchScreen';
import PhotosScreen from '../screens/PhotosScreen';
import RoomAlbumScreen from '../screens/RoomAlbumScreen';
import RoomRadioScreen from '../screens/RoomRadioScreen';
import OpenLiveScreen from '../screens/OpenLiveScreen';
import PrivateMessagesScreen from '../screens/PrivateMessagesScreen';
import BilibiliLiveScreen from '../screens/BilibiliLiveScreen';
import VideoLibraryScreen from '../screens/VideoLibraryScreen';
import MusicLibraryScreen from '../screens/MusicLibraryScreen';
import AudioProgramsScreen from '../screens/AudioProgramsScreen';
import AnalysisScreen from '../screens/AnalysisScreen';
import DownloadScreen from '../screens/DownloadScreen';
import DatabaseScreen from '../screens/DatabaseScreen';
import TripScreen from '../screens/TripScreen';
import MeleeRankScreen from '../screens/MeleeRankScreen';
import MemberDynamicScreen from '../screens/MemberDynamicScreen';
import MemberWeiboScreen from '../screens/MemberWeiboScreen';
import InvoiceScreen from '../screens/InvoiceScreen';
import CommunityScreen from '../screens/CommunityScreen';
import CommunityPostDetailScreen from '../screens/CommunityPostDetailScreen';
import AppToast from '../components/AppToast';
import ErrorBoundary from '../components/ErrorBoundary';
import { ui } from '../theme/ui';
import { useResolvedTheme } from '../hooks/useAppTheme';
import { useI18n } from '../i18n';

const Stack = createStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<TabParamList>();

const TAB_LABELS: Record<string, { icon: string; label: string }> = {
  Home: { icon: 'home', label: '主页' },
  Media: { icon: 'video', label: '直播' },
  Rooms: { icon: 'account-group', label: '房间' },
  Settings: { icon: 'cog', label: '设置' },
};

function withPageMotion<T extends object>(
  Screen: React.ComponentType<T>,
  duration = ui.motion.tabDuration,
  distance = 8,
) {
  return function PageMotionScreen(props: T) {
    const value = useRef(new Animated.Value(1)).current;

    useFocusEffect(
      useCallback(() => {
        value.setValue(0);
        Animated.timing(value, {
          toValue: 1,
          duration,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }).start();
      }, [value]),
    );

    return (
      <Animated.View
        style={{
          flex: 1,
          opacity: value,
          transform: [{
            translateY: value.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] }),
          }],
        }}
      >
        <Screen {...props} />
      </Animated.View>
    );
  };
}

const HomeTabScreen = withPageMotion(HomeScreen);
const MediaTabScreen = withPageMotion(MediaScreen);
const RoomsTabScreen = withPageMotion(FollowedRoomsScreen);
const SettingsTabScreen = withPageMotion(SettingsScreen);
const MessagesStackScreen = withPageMotion(MessagesScreen, ui.motion.stackDuration, 10);
const LoginStackScreen = withPageMotion(LoginScreen, ui.motion.stackDuration, 10);
const RechargeStackScreen = withPageMotion(RechargeScreen, ui.motion.stackDuration, 10);
const FetchStackScreen = withPageMotion(FetchScreen, ui.motion.stackDuration, 10);
const FlipStackScreen = withPageMotion(FlipScreen, ui.motion.stackDuration, 10);
const ProfileStackScreen = withPageMotion(ProfileScreen, ui.motion.stackDuration, 10);
const PhotosStackScreen = withPageMotion(PhotosScreen, ui.motion.stackDuration, 10);
const RoomAlbumStackScreen = withPageMotion(RoomAlbumScreen, ui.motion.stackDuration, 10);
const RoomRadioStackScreen = withPageMotion(RoomRadioScreen, ui.motion.stackDuration, 10);
const OpenLiveStackScreen = withPageMotion(OpenLiveScreen, ui.motion.stackDuration, 10);
const PrivateMessagesStackScreen = withPageMotion(PrivateMessagesScreen, ui.motion.stackDuration, 10);
const BilibiliLiveStackScreen = withPageMotion(BilibiliLiveScreen, ui.motion.stackDuration, 10);
const VideoLibraryStackScreen = withPageMotion(VideoLibraryScreen, ui.motion.stackDuration, 10);
const MusicLibraryStackScreen = withPageMotion(MusicLibraryScreen, ui.motion.stackDuration, 10);
const AudioProgramsStackScreen = withPageMotion(AudioProgramsScreen, ui.motion.stackDuration, 10);
const AnalysisStackScreen = withPageMotion(AnalysisScreen, ui.motion.stackDuration, 10);
const DownloadStackScreen = withPageMotion(DownloadScreen, ui.motion.stackDuration, 10);
const DatabaseStackScreen = withPageMotion(DatabaseScreen, ui.motion.stackDuration, 10);
const TripStackScreen = withPageMotion(TripScreen, ui.motion.stackDuration, 10);
const MeleeRankStackScreen = withPageMotion(MeleeRankScreen, ui.motion.stackDuration, 10);
const MemberDynamicStackScreen = withPageMotion(MemberDynamicScreen, ui.motion.stackDuration, 10);
const MemberWeiboStackScreen = withPageMotion(MemberWeiboScreen, ui.motion.stackDuration, 10);
const InvoiceStackScreen = withPageMotion(InvoiceScreen, ui.motion.stackDuration, 10);
const CommunityStackScreen = withPageMotion(CommunityScreen, ui.motion.stackDuration, 10);
const CommunityPostDetailStackScreen = withPageMotion(CommunityPostDetailScreen, ui.motion.stackDuration, 10);

function MainTabBar({
  state,
  descriptors,
  navigation,
  hidden,
}: BottomTabBarProps & { hidden: boolean }) {
  const { t } = useI18n();
  const palette = usePalette();
  if (hidden) return null;

  const items = state.routes.map((route, index) => {
    const tabMeta = TAB_LABELS[route.name];
    const fallback = tabMeta
      ? { icon: MCI(tabMeta.icon), label: t(tabMeta.label) }
      : {
          icon: MCI('circle'),
          label: typeof descriptors[route.key]?.options?.tabBarLabel === 'string'
            ? t(descriptors[route.key]?.options?.tabBarLabel as string)
            : route.name,
        };
    return {
      key: route.name,
      icon: fallback.icon,
      label: fallback.label,
      onPress: () => {
        const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
        if (state.index !== index && !event.defaultPrevented) navigation.navigate(route.name);
      },
    };
  });

  const activeKey = state.routes[state.index]?.name || 'Home';
  return (
    <AppTabBar
      items={items}
      activeKey={activeKey}
      onSelect={(key) => {
        const target = items.find((it) => it.key === key);
        target?.onPress();
      }}
    />
  );
}

function MainTabs() {
  const tabBarHidden = useUiStore((state) => state.tabBarHidden);

  return (
    <Tab.Navigator
      tabBar={(props) => <MainTabBar {...props} hidden={tabBarHidden} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: 'transparent' },
        animation: 'none',
      }}
    >
      <Tab.Screen name="Home" component={HomeTabScreen} options={{ tabBarLabel: '主页' }} />
      <Tab.Screen name="Media" component={MediaTabScreen} options={{ tabBarLabel: '直播' }} />
      <Tab.Screen name="Rooms" component={RoomsTabScreen} options={{ tabBarLabel: '房间' }} />
      <Tab.Screen name="Settings" component={SettingsTabScreen} options={{ tabBarLabel: '设置' }} />
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  tabBarWrap: {
    position: 'absolute', left: 0, right: 0, bottom: 0, height: 116,
  },
});

const AppTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: Palettes.light.tint,
    background: Palettes.light.background,
    card: Palettes.light.surface,
    text: Palettes.light.label,
    border: Palettes.light.hairline,
  },
};

const AppDarkTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: Palettes.dark.tint,
    background: Palettes.dark.background,
    card: Palettes.dark.surface,
    text: Palettes.dark.label,
    border: Palettes.dark.hairline,
  },
};

export default function AppNavigator() {
  const theme = useResolvedTheme();
  const hasBackground = !!useSettingsStore((state) => state.settings.customBackgroundFile?.trim());
  const navTheme = theme === 'dark' ? AppDarkTheme : AppTheme;
  const themed = hasBackground
    ? { ...navTheme, colors: { ...navTheme.colors, background: 'transparent', card: 'transparent' } }
    : navTheme;

  // 启动即自动同步成员数据库（进入软件自动更新；失败静默忽略，不阻塞启动）
  useEffect(() => {
    ensureMemberData().catch(() => {});
  }, []);

  return (
    <ErrorBoundary>
    <NavigationContainer theme={themed}>
      <>
        <Stack.Navigator
          screenOptions={{
            headerShown: false,
            animation: 'none',
            cardOverlayEnabled: false,
            detachPreviousScreen: true,
            cardStyle: hasBackground ? { backgroundColor: 'transparent' } : undefined,
          }}
        >
          <Stack.Screen name="Main" component={MainTabs} />
          <Stack.Screen name="MessagesScreen" component={MessagesStackScreen} />
          <Stack.Screen name="LoginScreen" component={LoginStackScreen} />
          <Stack.Screen name="RechargeScreen" component={RechargeStackScreen} />
          <Stack.Screen name="FetchScreen" component={FetchStackScreen} />
          <Stack.Screen name="FlipScreen" component={FlipStackScreen} />
          <Stack.Screen name="ProfileScreen" component={ProfileStackScreen} />
          <Stack.Screen name="PhotosScreen" component={PhotosStackScreen} />
          <Stack.Screen name="RoomAlbumScreen" component={RoomAlbumStackScreen} />
          <Stack.Screen name="RoomRadioScreen" component={RoomRadioStackScreen} />
          <Stack.Screen name="OpenLiveScreen" component={OpenLiveStackScreen} />
          <Stack.Screen name="PrivateMessagesScreen" component={PrivateMessagesStackScreen} />
          <Stack.Screen name="BilibiliLiveScreen" component={BilibiliLiveStackScreen} />
          <Stack.Screen name="VideoLibraryScreen" component={VideoLibraryStackScreen} />
          <Stack.Screen name="MusicLibraryScreen" component={MusicLibraryStackScreen} />
          <Stack.Screen name="AudioProgramsScreen" component={AudioProgramsStackScreen} />
          <Stack.Screen name="AnalysisScreen" component={AnalysisStackScreen} />
          <Stack.Screen name="DownloadScreen" component={DownloadStackScreen} />
          <Stack.Screen name="DatabaseScreen" component={DatabaseStackScreen} />
          <Stack.Screen name="TripScreen" component={TripStackScreen} />
          <Stack.Screen name="MeleeRankScreen" component={MeleeRankStackScreen} />
          <Stack.Screen name="MemberDynamicScreen" component={MemberDynamicStackScreen} />
          <Stack.Screen name="MemberWeiboScreen" component={MemberWeiboStackScreen} />
          <Stack.Screen name="InvoiceScreen" component={InvoiceStackScreen} />
          <Stack.Screen name="CommunityScreen" component={CommunityStackScreen} />
          <Stack.Screen name="CommunityPostDetailScreen" component={CommunityPostDetailStackScreen} />
        </Stack.Navigator>
        <AppToast />
      </>
    </NavigationContainer>
    </ErrorBoundary>
  );
}
