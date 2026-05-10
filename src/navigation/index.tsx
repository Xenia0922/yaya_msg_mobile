import React, { useCallback, useEffect, useRef } from 'react';
import { NavigationContainer, DefaultTheme, DarkTheme, useFocusEffect } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { createStackNavigator } from '@react-navigation/stack';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { useSettingsStore, useUiStore } from '../store';
import { RootStackParamList, TabParamList } from './types';
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
import ApiDiagnosticsScreen from '../screens/ApiDiagnosticsScreen';
import AppToast from '../components/AppToast';
import { mainTabBarStyle } from './tabBarStyle';
import { FadeInView, ScalePressable } from '../components/Motion';
import { ui } from '../theme/ui';

const Stack = createStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<TabParamList>();

const TAB_LABELS: Record<string, { icon: string; label: string }> = {
  Home: { icon: '主', label: '主页' },
  Media: { icon: '直', label: '直播' },
  Rooms: { icon: '房', label: '房间' },
  Settings: { icon: '设', label: '设置' },
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
const ApiDiagnosticsStackScreen = withPageMotion(ApiDiagnosticsScreen, ui.motion.stackDuration, 10);

function TabButton({
  focused,
  color,
  icon,
  label,
  onPress,
}: {
  focused: boolean;
  color: string;
  icon: string;
  label: string;
  onPress: () => void;
}) {
  const active = useRef(new Animated.Value(focused ? 1 : 0)).current;

  useEffect(() => {
    Animated.spring(active, {
      toValue: focused ? 1 : 0,
      speed: 22,
      bounciness: 8,
      useNativeDriver: true,
    }).start();
  }, [active, focused]);

  const scale = active.interpolate({ inputRange: [0, 1], outputRange: [1, 1.04] });
  const translateY = active.interpolate({ inputRange: [0, 1], outputRange: [0, -2] });

  return (
    <ScalePressable
      accessibilityRole="button"
      accessibilityState={focused ? { selected: true } : {}}
      accessibilityLabel={label}
      style={styles.tabItem}
      onPress={onPress}
      pressedScale={0.92}
    >
      <Animated.View style={[styles.tabInner, { transform: [{ scale }, { translateY }] }]}>
        <Text style={[styles.tabIcon, { color }]}>{icon}</Text>
        <Text style={[styles.tabLabel, { color }]}>{label}</Text>
      </Animated.View>
    </ScalePressable>
  );
}

function MainTabBar({
  state,
  descriptors,
  navigation,
  hasBackground,
  hidden,
}: BottomTabBarProps & { hasBackground: boolean; hidden: boolean }) {
  const isDark = useSettingsStore((state) => state.settings.theme === 'dark');
  if (hidden) return null;

  return (
    <FadeInView style={styles.tabBarWrap} pointerEvents="box-none" delay={80} distance={16}>
      <View style={[styles.tabBar, mainTabBarStyle(hasBackground, isDark)]}>
        {state.routes.map((route, index) => {
          const focused = state.index === index;
          const optionLabel = descriptors[route.key]?.options.tabBarLabel;
          const fallback = TAB_LABELS[route.name] || {
            icon: route.name.slice(0, 1),
            label: typeof optionLabel === 'string' ? optionLabel : route.name,
          };
          const color = focused ? '#ff6f91' : (isDark ? '#eeeeee' : '#555555');

          return (
            <TabButton
              key={route.key}
              focused={focused}
              color={color}
              icon={fallback.icon}
              label={fallback.label}
              onPress={() => {
                const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
                if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
              }}
            />
          );
        })}
      </View>
    </FadeInView>
  );
}

function MainTabs() {
  const hasBackground = !!useSettingsStore((state) => state.settings.customBackgroundFile?.trim());
  const isDark = useSettingsStore((state) => state.settings.theme === 'dark');
  const tabBarHidden = useUiStore((state) => state.tabBarHidden);

  return (
    <Tab.Navigator
      tabBar={(props) => <MainTabBar {...props} hasBackground={hasBackground} hidden={tabBarHidden} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: hasBackground ? 'transparent' : (isDark ? '#111111' : ui.colors.pageBg) },
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
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 116,
  },
  tabBar: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  tabItem: {
    flex: 1,
    height: ui.tabBar.itemHeight,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabInner: {
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabIcon: {
    fontSize: ui.text.tabIconSize,
    fontWeight: '800',
    lineHeight: ui.text.tabIconLineHeight,
    marginBottom: 1,
    textAlign: 'center',
  },
  tabLabel: {
    fontSize: ui.text.tabLabelSize,
    lineHeight: ui.text.tabLabelLineHeight,
    fontWeight: '700',
    textAlign: 'center',
    includeFontPadding: false,
  },
});

const AppTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: ui.colors.primary,
    background: ui.colors.pageBg,
    card: '#ffffff',
    text: '#333333',
    border: '#eeeeee',
  },
};

const AppDarkTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: '#ff6f91',
    background: '#121212',
    card: '#1e1e1e',
    text: '#eeeeee',
    border: '#333333',
  },
};

export default function AppNavigator() {
  const theme = useSettingsStore((state) => state.settings.theme);
  const hasBackground = !!useSettingsStore((state) => state.settings.customBackgroundFile?.trim());
  const navTheme = theme === 'dark' ? AppDarkTheme : AppTheme;
  const themed = hasBackground
    ? { ...navTheme, colors: { ...navTheme.colors, background: 'transparent', card: 'transparent' } }
    : navTheme;

  return (
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
          <Stack.Screen name="ApiDiagnosticsScreen" component={ApiDiagnosticsStackScreen} />
        </Stack.Navigator>
        <AppToast />
      </>
    </NavigationContainer>
  );
}
