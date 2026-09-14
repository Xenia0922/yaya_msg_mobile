import React, { useCallback, useEffect, useRef } from 'react';
import { PageBackdrop } from '../components/PageBackdrop';
import { NavigationContainer, DefaultTheme, DarkTheme, useFocusEffect } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { createStackNavigator } from '@react-navigation/stack';
import { Animated, Easing, ImageBackground, StyleSheet, View } from 'react-native';
import { useSettingsStore, useUiStore, useUpdateStore } from '../store';
import { setPipEnabled, listenPipToggle } from '../utils/pip';
import { Palettes } from '../theme/colors';
import { ensureMemberData } from '../services/memberData';
import { RootStackParamList, TabParamList } from './types';
import { AppTabBar, MCI } from '../components/AppTabBar';
import { MiniPlayer } from '../components/MiniPlayer';
import { useMiniPlayerStore } from '../store/miniPlayerStore';
import { usePlayerStore } from '../player/store/playerStore';
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
import RoomRadioScreen from '../screens/RoomRadioScreen';
import OpenLiveScreen from '../screens/OpenLiveScreen';
import OnMicScreen from '../screens/OnMicScreen';
import PrivateMessagesScreen from '../screens/PrivateMessagesScreen';
import BilibiliLiveScreen from '../screens/BilibiliLiveScreen';
import VideoLibraryScreen from '../screens/VideoLibraryScreen';
import MusicLibraryScreen from '../screens/MusicLibraryScreen';
import AudioProgramsScreen from '../screens/AudioProgramsScreen';
import AnalysisScreen from '../screens/AnalysisScreen';
import DownloadScreen from '../screens/DownloadScreen';
import DatabaseScreen from '../screens/DatabaseScreen';
import MeleeRankScreen from '../screens/MeleeRankScreen';
import MemberDynamicScreen from '../screens/MemberDynamicScreen';
import InvoiceScreen from '../screens/InvoiceScreen';
import AppToast from '../components/AppToast';
import ErrorBoundary from '../components/ErrorBoundary';
import { ReactnativelyProvider, BottomNavigation } from 'reactnatively';
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

/**
 * 页面包装：直接渲染，不做入场动画。
 * 规范依据（emilkowalski/animate-expo）：tab 切换属「100+ 次/天」频次 → 不该有动画；
 * 且入场淡入依赖 native driver，在 New Architecture 下若 native 动画不生效会把
 * opacity 卡在 0（表现：页面内容闪一下就消失 / 整屏空白，只有 tab bar）。
 */
function withPageMotion<T extends object>(
  Screen: React.ComponentType<T>,
  _duration = ui.motion.tabDuration,
  _distance = 8,
) {
  return function PageMotionScreen(props: T) {
    return (
      <ErrorBoundary>
        <Screen {...props} />
      </ErrorBoundary>
    );
  };
}

// 注：4 个 tab 的入场淡入（opacity+translateY）自项目基线(ed271c0)起就由 withPageMotion 提供，
// 是用户预期的转场观感，非性能负优化。保留 withPageMotion，不做无动画替换。
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
const MeleeRankStackScreen = withPageMotion(MeleeRankScreen, ui.motion.stackDuration, 10);
const MemberDynamicStackScreen = withPageMotion(MemberDynamicScreen, ui.motion.stackDuration, 10);
const InvoiceStackScreen = withPageMotion(InvoiceScreen, ui.motion.stackDuration, 10);

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
  // 自制玻璃底栏（LiquidGlassView 真折射），透光可调
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
        // iPhone 26 底部 tab 切换无水平滑动（瞬切）；靠 TabCell spring pop 主导
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

/**
 * 系统 PiP（小窗）⏯ 点击 → 切换"当前正在小窗里播的媒体"的播放/暂停。
 * 优先级：应用内小窗接管中 → 切小窗；否则统一播放器 source 在播 → 切它（store.state
 * 变化驱动 native/exo paused prop 与 web postMessage，PlayerCore 已接 web 指令）。
 * 全局只挂一次（导航根），PiP 期间 JS 存活即可达。
 */
function PipToggleBridge() {
  // 画中画开关 → 原生（默认关：不主动调用不弹 App 外系统小窗；设置页开启后切后台才自动 PiP）
  const pipAuto = useSettingsStore((s) => s.settings.pip_auto);
  useEffect(() => {
    setPipEnabled(!!pipAuto);
  }, [pipAuto]);

  useEffect(() => {
    return listenPipToggle(() => {
      try {
        const mini = useMiniPlayerStore.getState();
        if (mini.visible && mini.info?.url) {
          useMiniPlayerStore.getState().requestSysToggle();
          return;
        }
        const ps = usePlayerStore.getState();
        if (ps.source?.url && (ps.state === 'playing' || ps.state === 'paused')) {
          ps.setState(ps.state === 'playing' ? 'paused' : 'playing');
        }
      } catch {}
    });
  }, []);
  return null;
}

export default function AppNavigator() {
  const theme = useResolvedTheme();
  const palette = usePalette();
  const customBg = useSettingsStore((state) => state.settings.customBackgroundFile?.trim() || '');
  const hasBackground = !!customBg;
  const navTheme = theme === 'dark' ? AppDarkTheme : AppTheme;
  // 导航层永远透明：液态玻璃的透光来源是根层 PageBackdrop/背景图，
  // card 不透明会把底衬完全盖住 → 玻璃无从谈起
  const themed = { ...navTheme, colors: { ...navTheme.colors, background: 'transparent', card: 'transparent' } };
  // 自定义背景暗化遮罩：浅色主题压一层白雾保证深色文字可读，深色主题压一层黑幕保证浅色文字可读。
  // 取值克制（<=0.35），既保证可读性又不至于「看不清背景图」。
  const bgScrim = theme === 'dark' ? 'rgba(0,0,0,0.34)' : 'rgba(255,255,255,0.34)';

  // 启动即自动同步成员数据库（进入软件自动更新；失败静默忽略，不阻塞启动）
  useEffect(() => {
    ensureMemberData().catch(() => {});
  }, []);

  // 启动静默检查版本更新（24h 限流；失败静默，有更新时设置页显示红点）
  useEffect(() => {
    useUpdateStore.getState().checkUpdate().catch(() => {});
  }, []);

  return (
    <ErrorBoundary>
    <ReactnativelyProvider>
    <>
      {hasBackground ? (
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <ImageBackground
            source={{ uri: customBg }}
            resizeMode="cover"
            style={StyleSheet.absoluteFill}
          />
          <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: bgScrim }]} />
        </View>
      ) : (
        <PageBackdrop />
      )}
      <NavigationContainer theme={themed}>
      <>
        <Stack.Navigator
          screenOptions={{
            headerShown: false,
            animation: 'none',
            cardOverlayEnabled: false,
            detachPreviousScreen: true,
            cardStyle: { backgroundColor: 'transparent' },
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
          <Stack.Screen name="RoomRadioScreen" component={RoomRadioStackScreen} />
          <Stack.Screen name="OpenLiveScreen" component={OpenLiveStackScreen} />
          <Stack.Screen name="OnMicScreen" component={withPageMotion(OnMicScreen, ui.motion.stackDuration, 10)} />
          <Stack.Screen name="PrivateMessagesScreen" component={PrivateMessagesStackScreen} />
          <Stack.Screen name="BilibiliLiveScreen" component={BilibiliLiveStackScreen} />
          <Stack.Screen name="VideoLibraryScreen" component={VideoLibraryStackScreen} />
          <Stack.Screen name="MusicLibraryScreen" component={MusicLibraryStackScreen} />
          <Stack.Screen name="AudioProgramsScreen" component={AudioProgramsStackScreen} />
          <Stack.Screen name="AnalysisScreen" component={AnalysisStackScreen} />
          <Stack.Screen name="DownloadScreen" component={DownloadStackScreen} />
          <Stack.Screen name="DatabaseScreen" component={DatabaseStackScreen} />
          <Stack.Screen name="MeleeRankScreen" component={MeleeRankStackScreen} />
          <Stack.Screen name="MemberDynamicScreen" component={MemberDynamicStackScreen} />
          <Stack.Screen name="InvoiceScreen" component={InvoiceStackScreen} />
        </Stack.Navigator>
        <AppToast />
        {/* 应用内悬浮小窗播放器（全局挂载，导航上下文内可用） */}
        <MiniPlayer />
        {/* 系统 PiP ⏯ → 当前媒体切换（全局单次监听） */}
        <PipToggleBridge />
      </>
      </NavigationContainer>
    </>
</ReactnativelyProvider>
    </ErrorBoundary>
  );
}
