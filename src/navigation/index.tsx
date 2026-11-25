import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { BlurTargetProvider, BlurTargetSurface } from '../components/BlurTarget';
import {
  BottomDockHost,
  TopDockHost,
  setBottomDockState,
  useBottomDockVisible,
} from '../components/DockPortal';
import {
  NavigationContainer,
  DefaultTheme,
  DarkTheme,
  useIsFocused,
  useNavigationContainerRef,
} from '@react-navigation/native';
import { createMaterialTopTabNavigator } from '@react-navigation/material-top-tabs';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { createStackNavigator, type StackCardInterpolationProps } from '@react-navigation/stack';
import {
  Animated,
  BackHandler,
  DeviceEventEmitter,
  Easing,
  ImageBackground,
  Keyboard,
  Platform,
  StyleSheet,
  ToastAndroid,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSettingsStore, useUiStore, useUpdateStore } from '../store';
import { IS_PLUS_BUILD } from '../constants/channel';
import { setPipEnabled, listenPipToggle, listenPipDenied } from '../utils/pip';
import { Palettes } from '../theme/colors';
import { fixDataUriMime } from '../utils/dataUri';
import { ensureMemberData } from '../services/memberData';
import { refreshActiveRoomMappings } from '../services/roomMapCache';

import '../services/musicPlayer';
import { RootStackParamList, TabParamList } from './types';
import { MCI } from '../components/AppTabBar';
import { AppDialogHost } from '../components/AppDialog';
import { MiniPlayer } from '../components/MiniPlayer';
import MiniPlayerBar from '../components/MiniPlayerBar';
import FullScreenPlayer from '../components/FullScreenPlayer';
import { useMiniPlayerStore } from '../store/miniPlayerStore';
import { useMusicPlayerStore } from '../store/musicPlayerStore';
import { usePlayerStore } from '../player/store/playerStore';
import { useSafeAreaInsets } from '../hooks/useSafeAreaInsets';
import HomeScreen from '../screens/HomeScreen';
import MediaScreen from '../screens/MediaScreen';
import FollowedRoomsScreen from '../screens/FollowedRoomsScreen';
import LoginScreen from '../screens/LoginScreen';
import RechargeScreen from '../screens/RechargeScreen';
import FlipScreen from '../screens/FlipScreen';
import ProfileScreen from '../screens/ProfileScreen';
import SettingsScreen from '../screens/SettingsScreen';
import PhotosScreen from '../screens/PhotosScreen';
import RoomRadioScreen from '../screens/RoomRadioScreen';
import OpenLiveScreen from '../screens/OpenLiveScreen';
import OnMicScreen from '../screens/OnMicScreen';
import PrivateMessagesScreen from '../screens/PrivateMessagesScreen';
import BilibiliLiveScreen from '../screens/BilibiliLiveScreen';
import MusicLibraryScreen from '../screens/MusicLibraryScreen';
import DownloadScreen from '../screens/DownloadScreen';
import UsagePreferencesScreen from '../screens/UsagePreferencesScreen';
import AboutScreen from '../screens/AboutScreen';
import DisclaimerScreen from '../screens/DisclaimerScreen';
import DatabaseScreen from '../screens/DatabaseScreen';
import MeleeRankScreen from '../screens/MeleeRankScreen';
import RoomAlbumScreen from '../screens/RoomAlbumScreen';
import InvoiceScreen from '../screens/InvoiceScreen';
import AppToast from '../components/AppToast';
import ErrorBoundary from '../components/ErrorBoundary';
import { NetworkImage } from '../components/NetworkImage';
import { ui } from '../theme/ui';
import { useResolvedTheme } from '../hooks/useAppTheme';
import { useI18n } from '../i18n';
import { shouldHideTabBar } from './tabBarVisibility';
import { useKeyboardHeight } from '../hooks/useKeyboardHeight';
import {
  getActiveRouteName,
  notifyTransitionStart,
  setActiveRouteName,
  useActiveRouteName,
} from '../services/perfScheduler';

const STACK_OPEN_SPEC = {
  animation: 'timing' as const,
  config: {
    duration: 220,
    easing: Easing.bezier(0.22, 1, 0.36, 1),
  },
};

const STACK_CLOSE_SPEC = {
  animation: 'timing' as const,
  config: {
    duration: 190,
    easing: Easing.out(Easing.cubic),
  },
};

function stackCardInterpolator({ current, next, layouts }: StackCardInterpolationProps) {
  const incomingOpacity = current.progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });
  const outgoingOpacity = next
    ? next.progress.interpolate({
        inputRange: [0, 0.55, 1],
        outputRange: [1, 0, 0],
        extrapolate: 'clamp',
      })
    : 1;
  const translateXFocused = current.progress.interpolate({
    inputRange: [0, 1],
    outputRange: [Math.min(24, layouts.screen.width * 0.06), 0],
    extrapolate: 'clamp',
  });
  const translateXUnfocused = next
    ? next.progress.interpolate({
        inputRange: [0, 1],
        outputRange: [0, -18],
        extrapolate: 'clamp',
      })
    : 0;
  return {
    containerStyle: {
      opacity: Animated.multiply(incomingOpacity, outgoingOpacity),
      transform: [{ translateX: Animated.add(translateXFocused, translateXUnfocused) }],
    },
    cardStyle: {
      backgroundColor: 'transparent',
    },
  };
}

const STACK_SCREEN_OPTIONS = {
  headerShown: false,
  cardOverlayEnabled: false,
  detachPreviousScreen: false,
  freezeOnBlur: true,
  cardStyle: { backgroundColor: 'transparent' },
  cardStyleInterpolator: stackCardInterpolator,
  transitionSpec: {
    open: STACK_OPEN_SPEC,
    close: STACK_CLOSE_SPEC,
  },
} as const;

const MAIN_TAB_SCREEN_OPTIONS = {
  lazy: false,
  swipeEnabled: false,
  animationEnabled: true,
} as const;

const styles = StyleSheet.create({
  screenFill: { flex: 1 },
});

const Stack = createStackNavigator<RootStackParamList>();
const Tab = createMaterialTopTabNavigator<TabParamList>();

const TAB_LABELS: Record<string, { icon: string; label: string }> = {
  Home: { icon: 'home', label: '主页' },
  Media: { icon: 'video', label: '直播' },
  Rooms: { icon: 'account-group', label: '房间' },
  Settings: { icon: 'cog', label: '设置' },
};

function withPageMotion<T extends object>(
  Screen: React.ComponentType<T>,
  _duration = ui.motion.tabDuration,
  _distance = 8,
  _hideTabBar = false,
) {
  const MemoizedScreen = React.memo(Screen) as React.ComponentType<T>;
  const autoKeyboard =
    Platform.OS === 'android' &&
    _hideTabBar &&
    Screen !== PrivateMessagesScreen &&
    Screen !== OpenLiveScreen &&
    Screen !== BilibiliLiveScreen;
  if (!autoKeyboard) {
    return function StaticMotionScreen(props: T) {
      return (
        <ErrorBoundary>
          <View style={styles.screenFill}>
            <MemoizedScreen {...props} />
          </View>
        </ErrorBoundary>
      );
    };
  }
  return function PageMotionScreen(props: T) {
    const focused = useIsFocused();
    const keyboardHeight = useKeyboardHeight(focused);
    return (
      <ErrorBoundary>
        <View
          style={[styles.screenFill, keyboardHeight > 0 ? { paddingBottom: keyboardHeight } : null]}
        >
          <MemoizedScreen {...props} />
        </View>
      </ErrorBoundary>
    );
  };
}

const HomeTabScreen = withPageMotion(HomeScreen);
const MediaTabScreen = withPageMotion(MediaScreen);
const RoomsTabScreen = withPageMotion(FollowedRoomsScreen);
const SettingsTabScreen = withPageMotion(SettingsScreen);
const PrivateMessagesStackScreen = withPageMotion(
  PrivateMessagesScreen,
  ui.motion.stackDuration,
  10,
  true,
);
const LoginStackScreen = withPageMotion(LoginScreen, ui.motion.stackDuration, 10, true);
const RechargeStackScreen = withPageMotion(RechargeScreen, ui.motion.stackDuration, 10, true);
const FlipStackScreen = withPageMotion(FlipScreen, ui.motion.stackDuration, 10, true);
const ProfileStackScreen = withPageMotion(ProfileScreen, ui.motion.stackDuration, 10, true);
const PhotosStackScreen = withPageMotion(PhotosScreen, ui.motion.stackDuration, 10, true);
const RoomRadioStackScreen = withPageMotion(RoomRadioScreen, ui.motion.stackDuration, 10, true);
const OpenLiveStackScreen = withPageMotion(OpenLiveScreen, ui.motion.stackDuration, 10, true);
const OnMicStackScreen = withPageMotion(OnMicScreen, ui.motion.stackDuration, 10, true);
const BilibiliLiveStackScreen = withPageMotion(
  BilibiliLiveScreen,
  ui.motion.stackDuration,
  10,
  true,
);
const MusicLibraryStackScreen = withPageMotion(
  MusicLibraryScreen,
  ui.motion.stackDuration,
  10,
  true,
);
const DownloadStackScreen = withPageMotion(DownloadScreen, ui.motion.stackDuration, 10, true);
const UsagePreferencesStackScreen = withPageMotion(
  UsagePreferencesScreen,
  ui.motion.stackDuration,
  10,
  true,
);
const AboutStackScreen = withPageMotion(AboutScreen, ui.motion.stackDuration, 10, true);
const DisclaimerStackScreen = withPageMotion(DisclaimerScreen, ui.motion.stackDuration, 10, true);
const DatabaseStackScreen = withPageMotion(DatabaseScreen, ui.motion.stackDuration, 10, true);
const MeleeRankStackScreen = withPageMotion(MeleeRankScreen, ui.motion.stackDuration, 10, true);
const RoomAlbumStackScreen = withPageMotion(RoomAlbumScreen, ui.motion.stackDuration, 10, true);
const InvoiceStackScreen = withPageMotion(InvoiceScreen, ui.motion.stackDuration, 10, true);

function MainTabBar({
  state,
  descriptors,
  navigation,
  hidden,
  jumpTo,
}: BottomTabBarProps & { hidden: boolean; jumpTo?: (key: string) => void }) {
  const { t } = useI18n();
  const hasUpdate = useUpdateStore((s) => s.hasUpdate);
  const stateRef = useRef(state);
  stateRef.current = state;
  const descriptorsRef = useRef(descriptors);
  descriptorsRef.current = descriptors;
  const jumpToRef = useRef(jumpTo);
  jumpToRef.current = jumpTo;

  const items = useMemo(
    () =>
      state.routes.map((route) => {
        const tabMeta = TAB_LABELS[route.name];
        const descLabel = descriptorsRef.current[route.key]?.options?.tabBarLabel;
        const fallback = tabMeta
          ? { icon: MCI(tabMeta.icon), label: t(tabMeta.label) }
          : {
              icon: MCI('circle'),
              label: typeof descLabel === 'string' ? t(descLabel) : route.name,
            };
        return {
          key: route.name,
          icon: fallback.icon,
          label: fallback.label,
          badgeDot: route.name === 'Settings' && hasUpdate && !IS_PLUS_BUILD,
        };
      }),
    [hasUpdate, state.routes, t],
  );

  const handleSelect = useCallback(
    (key: string) => {
      const curState = stateRef.current;
      const index = curState.routes.findIndex((r) => r.name === key);
      if (index < 0) return;
      const route = curState.routes[index];
      const event = navigation.emit({
        type: 'tabPress',
        target: route.key,
        canPreventDefault: true,
      });
      if (curState.index !== index && !event.defaultPrevented) {
        notifyTransitionStart('tab', 340);
        if (jumpToRef.current) jumpToRef.current(route.key);
        else navigation.navigate(route.name);
      }
    },
    [navigation],
  );

  const activeKey = state.routes[state.index]?.name || 'Home';

  useLayoutEffect(() => {
    setBottomDockState({ items, activeKey, onSelect: handleSelect, hidden });
  }, [items, activeKey, handleSelect, hidden]);

  useLayoutEffect(() => () => setBottomDockState(null), []);

  return null;
}

function MainTabs() {
  const hiddenByRoute = useUiStore((state) => state.tabBarHiddenByRoute);
  const mainFocused = useIsFocused();
  const { width: windowWidth } = useWindowDimensions();
  const renderTabBar = useCallback(
    (props: any) => (
      <MainTabBar
        {...props}
        hidden={shouldHideTabBar(
          props.state.routes[props.state.index]?.name,
          mainFocused,
          hiddenByRoute,
        )}
      />
    ),
    [mainFocused, hiddenByRoute],
  );
  return (
    <Tab.Navigator
      tabBarPosition="bottom"
      initialLayout={{ width: windowWidth }}
      keyboardDismissMode="none"
      tabBar={renderTabBar}
      screenOptions={MAIN_TAB_SCREEN_OPTIONS}
    >
      <Tab.Screen name="Home" component={HomeTabScreen} options={{ tabBarLabel: '主页' }} />
      <Tab.Screen name="Media" component={MediaTabScreen} options={{ tabBarLabel: '直播' }} />
      <Tab.Screen name="Rooms" component={RoomsTabScreen} options={{ tabBarLabel: '房间' }} />
      <Tab.Screen name="Settings" component={SettingsTabScreen} options={{ tabBarLabel: '设置' }} />
    </Tab.Navigator>
  );
}

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

function KeyboardBackBridge() {
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (Keyboard.isVisible()) {
        Keyboard.dismiss();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, []);
  return null;
}

function PipToggleBridge() {
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

  useEffect(() => {
    return listenPipDenied((reason) => {
      const msg =
        reason === 'appops'
          ? '系统未允许画中画：请到 系统设置 → 应用 → 牙牙消息 → 画中画 中开启'
          : '系统未能进入小窗，请稍后重试';
      ToastAndroid.show(msg, ToastAndroid.LONG);
    });
  }, []);
  return null;
}

const HIDDEN_MINI_ROUTES = new Set([
  'RoomRadioScreen',
  'OpenLiveScreen',
  'OnMicScreen',
  'BilibiliLiveScreen',
  'PrivateMessagesScreen',
  'LoginScreen',
  'RechargeScreen',
]);

const GlobalMusicOverlay = React.memo(function GlobalMusicOverlay() {
  const activeRouteName = useActiveRouteName();
  const bottomDockVisible = useBottomDockVisible();
  const insets = useSafeAreaInsets();
  const hasTrack = useMusicPlayerStore((s) => s.queue.length > 0 && s.currentIndex >= 0);
  const isActive = useMusicPlayerStore((s) => s.playbackState !== 'idle');
  const miniBarDismissed = useMusicPlayerStore((s) => s.miniBarDismissed);
  const sessionActivated = useMusicPlayerStore((s) => s.sessionActivated);
  const fullScreenOpen = useMusicPlayerStore((s) => s.fullScreenOpen);
  const fullScreenInitialSheet = useMusicPlayerStore((s) => s.fullScreenInitialSheet);
  const openFullScreen = useMusicPlayerStore((s) => s.openFullScreen);
  const closeFullScreen = useMusicPlayerStore((s) => s.closeFullScreen);

  const homeModulesHidden = useSettingsStore((s) => s.settings.home_modules_hidden);
  const miniBarEnabled = useSettingsStore((s) => s.settings.yaya_music_minibar_enabled !== false);
  const homeShowsResume = !(homeModulesHidden || []).includes('resume');
  const onHome = activeRouteName === 'Home';
  const onMusicScreen = activeRouteName === 'MusicLibraryScreen';

  const hiddenByRoute = useUiStore((s) => s.tabBarHiddenByRoute);
  const videoMiniVisible = useMiniPlayerStore((s) => s.visible);
  const videoBusy = usePlayerStore((s) =>
    Boolean(
      s.source &&
      s.state !== 'idle' &&
      (s.fullscreen || s.state === 'playing' || s.state === 'loading'),
    ),
  );
  const [kbVisible, setKbVisible] = useState(false);

  useEffect(() => {
    const s1 = Keyboard.addListener('keyboardDidShow', () => setKbVisible(true));
    const s2 = Keyboard.addListener('keyboardDidHide', () => setKbVisible(false));
    return () => {
      s1.remove();
      s2.remove();
    };
  }, []);

  const hideMini =
    !miniBarEnabled ||
    !hasTrack ||
    !isActive ||
    miniBarDismissed ||
    fullScreenOpen ||
    videoMiniVisible ||
    videoBusy ||
    kbVisible ||
    HIDDEN_MINI_ROUTES.has(activeRouteName) ||
    (onHome && homeShowsResume) ||
    (!onMusicScreen && !sessionActivated) ||
    (activeRouteName === 'Rooms' && !!hiddenByRoute.Rooms) ||
    (activeRouteName === 'Media' && !!hiddenByRoute.Media);

  const bottomOffset = bottomDockVisible
    ? 88
    : Math.max(12, insets.bottom > 0 ? Math.min(insets.bottom, 28) + 6 : 12);

  return (
    <>
      {!hideMini ? (
        <MiniPlayerBar
          bottomOffset={bottomOffset}
          onOpenFullScreen={() => openFullScreen('none')}
        />
      ) : null}
      <FullScreenPlayer
        visible={fullScreenOpen}
        initialSheet={fullScreenInitialSheet}
        onClose={closeFullScreen}
      />
    </>
  );
});

export default function AppNavigator() {
  const navRef = useNavigationContainerRef();

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('OpenMusicLibrary', () => {
      try {
        if (navRef.isReady()) (navRef as any).navigate('MusicLibraryScreen');
      } catch {}
    });
    return () => sub.remove();
  }, [navRef]);

  const theme = useResolvedTheme();
  const screenBackdrop = useUiStore((state) => state.screenBackdrop);
  const customBgRaw = useSettingsStore(
    (state) => state.settings.customBackgroundFile?.trim() || '',
  );
  const pocketToken = useSettingsStore((state) => state.settings.p48Token);
  const memberBootRef = useRef<Promise<void> | null>(null);

  const customBg = useMemo(() => fixDataUriMime(customBgRaw), [customBgRaw]);
  const hasBackground = !!customBg;
  const navTheme = theme === 'dark' ? AppDarkTheme : AppTheme;

  const defaultBg =
    theme === 'dark'
      ? require('../../assets/defaults/bg-dark.jpg')
      : require('../../assets/defaults/bg-light.jpg');
  const bgSource = useMemo(
    () => (hasBackground ? { uri: customBg } : defaultBg),
    [hasBackground, customBg, defaultBg],
  );
  const themed = useMemo(
    () => ({
      ...navTheme,
      colors: { ...navTheme.colors, background: 'transparent', card: 'transparent' },
    }),
    [navTheme],
  );

  const bgScrim = theme === 'dark' ? 'rgba(0,0,0,0.34)' : 'rgba(255,255,255,0.34)';

  useEffect(() => {
    memberBootRef.current = ensureMemberData().catch(() => {});
  }, []);

  useEffect(() => {
    let active = true;
    if (pocketToken)
      void (memberBootRef.current || Promise.resolve())
        .then(() => {
          if (active) return refreshActiveRoomMappings();
        })
        .catch(() => {});
    return () => {
      active = false;
    };
  }, [pocketToken]);

  return (
    <ErrorBoundary>
      <BlurTargetProvider>
        <NavigationContainer
          ref={navRef}
          theme={themed}
          onReady={() => {
            try {
              const name = navRef.getCurrentRoute()?.name;
              if (name) setActiveRouteName(name);
            } catch {}
          }}
          onStateChange={() => {
            if (Keyboard.isVisible()) Keyboard.dismiss();
            try {
              const name = navRef.getCurrentRoute()?.name;
              if (name && name !== getActiveRouteName()) {
                notifyTransitionStart('route', 300);
                setActiveRouteName(name);
              }
            } catch {}
          }}
        >
          <>
            <BlurTargetSurface>
              {screenBackdrop?.uri ? (
                <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                  <NetworkImage
                    source={{ uri: screenBackdrop.uri }}
                    resizeMode="cover"
                    style={StyleSheet.absoluteFill}
                    fallback={false}
                    fadeDuration={0}
                  />
                  <View
                    pointerEvents="none"
                    style={[StyleSheet.absoluteFill, { backgroundColor: screenBackdrop.scrim }]}
                  />
                </View>
              ) : (
                <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                  <ImageBackground
                    source={bgSource as any}
                    resizeMode="cover"
                    style={StyleSheet.absoluteFill}
                  />
                  <View
                    pointerEvents="none"
                    style={[
                      StyleSheet.absoluteFill,
                      {
                        backgroundColor: hasBackground
                          ? bgScrim
                          : theme === 'dark'
                            ? 'rgba(0,0,0,0.18)'
                            : 'rgba(255,255,255,0.10)',
                      },
                    ]}
                  />
                </View>
              )}

              <Stack.Navigator screenOptions={STACK_SCREEN_OPTIONS}>
                <Stack.Screen name="Main" component={MainTabs} />
                <Stack.Screen name="LoginScreen" component={LoginStackScreen} />
                <Stack.Screen name="RechargeScreen" component={RechargeStackScreen} />
                <Stack.Screen name="FlipScreen" component={FlipStackScreen} />
                <Stack.Screen name="ProfileScreen" component={ProfileStackScreen} />
                <Stack.Screen name="PhotosScreen" component={PhotosStackScreen} />
                <Stack.Screen name="RoomRadioScreen" component={RoomRadioStackScreen} />
                <Stack.Screen name="OpenLiveScreen" component={OpenLiveStackScreen} />
                <Stack.Screen name="OnMicScreen" component={OnMicStackScreen} />
                <Stack.Screen name="PrivateMessagesScreen" component={PrivateMessagesStackScreen} />
                <Stack.Screen name="BilibiliLiveScreen" component={BilibiliLiveStackScreen} />
                <Stack.Screen name="MusicLibraryScreen" component={MusicLibraryStackScreen} />
                <Stack.Screen name="DownloadScreen" component={DownloadStackScreen} />
                <Stack.Screen name="UsagePreferences" component={UsagePreferencesStackScreen} />
                <Stack.Screen name="AboutScreen" component={AboutStackScreen} />
                <Stack.Screen name="DisclaimerScreen" component={DisclaimerStackScreen} />
                <Stack.Screen name="DatabaseScreen" component={DatabaseStackScreen} />
                <Stack.Screen name="MeleeRankScreen" component={MeleeRankStackScreen} />
                <Stack.Screen name="RoomAlbumScreen" component={RoomAlbumStackScreen} />
                <Stack.Screen name="InvoiceScreen" component={InvoiceStackScreen} />
              </Stack.Navigator>
            </BlurTargetSurface>
            <TopDockHost />
            <BottomDockHost />
            <GlobalMusicOverlay />
            <AppToast />
            <MiniPlayer />
            <PipToggleBridge />
            <KeyboardBackBridge />
          </>
        </NavigationContainer>
        <AppDialogHost />
      </BlurTargetProvider>
    </ErrorBoundary>
  );
}
