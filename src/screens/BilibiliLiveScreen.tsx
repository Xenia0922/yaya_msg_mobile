import React, { useCallback, useEffect, useRef, useState } from 'react';
import { PerfFlatList } from '../components/PerfFlatList';

import {
  ActivityIndicator,
  Animated,
  Dimensions,
  StyleSheet,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { WebView } from 'react-native-webview';
import Video from 'react-native-video';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useNavigation } from '@react-navigation/native';
import { useSettingsStore } from '../store';
import { FadeInView } from '../components/Motion';
import ScreenHeader from '../components/ScreenHeader';
import { BilibiliLiveRoom } from '../types';
import { externalApi } from '../api/external';
import bilibiliApi from '../api/bilibili';
import { errorMessage } from '../utils/data';
import { setLiveImmersiveMode } from '../native/LivePlayer';
import { getPlayerHtml } from '../components/media/player';
import { PlayerTopBar, PlayerBottomBar, PlayerMorePanel } from '../components/media/PlayerChrome';

export default function BilibiliLiveScreen() {
  const navigation = useNavigation<any>();
  const isDark = useSettingsStore((s) => s.settings.theme === 'dark');
  const [rooms, setRooms] = useState<BilibiliLiveRoom[]>([]);
  const [candidates, setCandidates] = useState<any[]>([]);
  const [candidateIndex, setCandidateIndex] = useState(0);
  const [streamTitle, setStreamTitle] = useState('B站直播');
  const [activeRoom, setActiveRoom] = useState<BilibiliLiveRoom | null>(null);
  const [liveStatuses, setLiveStatuses] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [playerError, setPlayerError] = useState('');
  const [useWebPlayer, setUseWebPlayer] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isLandscape, setIsLandscape] = useState(false);
  const [paused, setPaused] = useState(false);
  const [moreVisible, setMoreVisible] = useState(false);
  // 控制条沉浸显隐（B站式：点击画面切换，播放中 3 秒无操作自动隐藏）
  const [controlsVisible, setControlsVisible] = useState(true);
  const controlsOpacity = useRef(new Animated.Value(1)).current;
  const hideControlsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pausedRef = useRef(paused);
  useEffect(() => { pausedRef.current = paused; }, [paused]);
  const showControls = useCallback((autoHide = true) => {
    setControlsVisible(true);
    Animated.timing(controlsOpacity, { toValue: 1, duration: 180, useNativeDriver: true }).start();
    if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current);
    if (autoHide && !pausedRef.current) {
      hideControlsTimer.current = setTimeout(() => {
        setControlsVisible(false);
        Animated.timing(controlsOpacity, { toValue: 0, duration: 180, useNativeDriver: true }).start();
      }, 3000);
    }
  }, [controlsOpacity]);
  const toggleControls = useCallback(() => {
    if (controlsVisible) {
      setControlsVisible(false);
      Animated.timing(controlsOpacity, { toValue: 0, duration: 180, useNativeDriver: true }).start();
    } else {
      showControls();
    }
  }, [controlsVisible, showControls]);
  const videoRef = useRef<any>(null);
  // 画面旋转（翻转）：0/90/180/270，每按一次步进 90°
  const [videoRotate, setVideoRotate] = useState(0);
  const biliScreen = Dimensions.get('window');
  const biliRotated = videoRotate === 90 || videoRotate === 270;
  const videoBoxW = biliRotated ? biliScreen.height : biliScreen.width;
  const videoBoxH = biliRotated ? biliScreen.width : biliScreen.height;
  const videoRotateDeg = `${videoRotate}deg`;
  const currentCandidate = candidates[candidateIndex];
  const streamUrl = currentCandidate?.url || '';

  useEffect(() => {
    const parent = navigation.getParent?.();
    parent?.setOptions({ tabBarStyle: streamUrl ? { display: 'none' } : undefined });
    return () => parent?.setOptions({ tabBarStyle: undefined });
  }, [navigation, streamUrl]);

  useEffect(() => {
    (async () => {
      try {
        const data = await externalApi.fetchBilibiliConfig();
        setRooms(data || []);
        setStatus(data?.length ? `已加载 ${data.length} 个直播间` : '没有加载到直播间配置');
      } catch (error) {
        setStatus(`直播间列表加载失败：${errorMessage(error)}`);
      }
    })();
  }, []);

  useEffect(() => () => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
  }, []);

  // 横屏/全屏解耦：全屏=沉浸+横屏；横屏切换=仅旋转。两者任一为真即锁定横屏。
  useEffect(() => {
    const wantLandscape = isFullscreen || isLandscape;
    setLiveImmersiveMode(!!streamUrl && isFullscreen);
    ScreenOrientation.lockAsync(
      wantLandscape ? ScreenOrientation.OrientationLock.LANDSCAPE : ScreenOrientation.OrientationLock.PORTRAIT_UP,
    ).catch(() => {});
  }, [isFullscreen, isLandscape, streamUrl]);

  const closePlayer = () => {
    setCandidates([]);
    setActiveRoom(null);
    setPlayerError('');
    setIsFullscreen(false);
    setIsLandscape(false);
    setLiveImmersiveMode(false);
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
  };

  const checkStatuses = async () => {
    if (!rooms.length) return;
    setLoading(true);
    setStatus('正在刷新开播状态...');
    const next: Record<string, boolean> = {};
    for (const room of rooms) {
      try {
        const init = await bilibiliApi.getRoomInit(room.roomId);
        next[room.roomId] = Number(init.data?.live_status) === 1;
      } catch {
        next[room.roomId] = false;
      }
    }
    setLiveStatuses(next);
    setStatus('状态刷新完成');
    setLoading(false);
  };

  const startWatch = async (room: BilibiliLiveRoom) => {
    setLoading(true);
    setStatus(`正在获取直播流：${room.name || room.roomId}`);
    setPlayerError('');
    setUseWebPlayer(false);
    setCandidates([]);
    setCandidateIndex(0);
    setActiveRoom(room);
    try {
      const info = await bilibiliApi.resolveLive(room.roomId);
      const list = info.streamCandidates?.length ? info.streamCandidates : [{ url: info.streamUrl }];
      setStreamTitle(info.title || room.name || 'B站直播');
      setCandidates(list);
      setStatus('');
      showControls();
      setIsLandscape(true);
      setIsFullscreen(true); // 进入直播间即自动横屏+全屏沉浸（用户偏好：B站直播只看横屏）
    } catch (error) {
      setStatus(`获取直播流失败：${errorMessage(error)}`);
    } finally {
      setLoading(false);
    }
  };

  const switchToNextCandidate = useCallback((reason: string) => {
    setCandidateIndex((prev) => {
      if (prev + 1 < candidates.length) {
        setPlayerError(`${reason}，已切换下一条线路`);
        return prev + 1;
      }
      setPlayerError(`${reason}。所有线路都试过了，建议先确认该房间真的在播，或登录 B站账号后重试。`);
      return prev;
    });
  }, [candidates.length]);

  if (streamUrl) {
    return (
      <View style={styles.playerPage}>
        <View style={styles.player}>
          {useWebPlayer ? (
            <WebView
              source={{ html: getPlayerHtml(streamUrl) }}
              style={styles.nativeVideo}
              javaScriptEnabled
              domStorageEnabled
              allowsInlineMediaPlayback
              mediaPlaybackRequiresUserAction={false}
              mixedContentMode="always"
              allowsFullscreenVideo
            />
          ) : (
            <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
              <View style={{ width: videoBoxW, height: videoBoxH, transform: [{ rotate: videoRotateDeg }] }}>
                <Video
                  ref={videoRef}
                  key={streamUrl}
                  source={{
                    uri: streamUrl,
                    headers: bilibiliApi.headers(currentCandidate?.realRoomId),
                  }}
                  style={[styles.nativeVideo, { transform: [{ rotate: videoRotateDeg }] }]}
                  resizeMode="contain"
                  paused={paused}
                  ignoreSilentSwitch="ignore"
                  onLoad={() => { setPlayerError(''); videoRef.current?.resume?.(); }}
                  onError={(event) => {
                    const detail = JSON.stringify(event?.error || event).slice(0, 180);
                    switchToNextCandidate(`原生播放器失败：${detail}`);
                  }}
                />
              </View>
            </View>
          )}
          {playerError ? (
            <View style={styles.playerError}>
              <Text style={styles.playerErrorText}>{playerError}</Text>
              <View style={styles.playerActions}>
                <TouchableOpacity style={styles.webFallbackBtn} onPress={() => setUseWebPlayer(true)}>
                  <Text style={styles.webFallbackText}>网页播放器</Text>
                </TouchableOpacity>
                {candidateIndex + 1 < candidates.length ? (
                  <TouchableOpacity style={styles.webFallbackBtn} onPress={() => setCandidateIndex((prev) => prev + 1)}>
                    <Text style={styles.webFallbackText}>下一线路</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>
          ) : null}
        </View>

        {/* 全屏点击层：始终可点，用于切换控制栏显隐。
            zIndex 20 低于控制栏(30)、高于视频(0)；控制栏可见时按钮优先接收点击，
            隐藏时(pointerEvents none)点击穿透到本层 → 重新唤出。 */}
        <TouchableWithoutFeedback onPress={toggleControls}>
          <Animated.View style={[StyleSheet.absoluteFill, { zIndex: 20 }]} />
        </TouchableWithoutFeedback>

        {/* 哔哩哔哩风格顶栏：返回 / 标题 / 更多（仅右上角） */}
        <Animated.View style={[{ position: 'absolute', top: 0, left: 0, right: 0, opacity: controlsOpacity, pointerEvents: controlsVisible ? 'box-none' : 'none', zIndex: 30 }]}>
          <PlayerTopBar
            onBack={closePlayer}
            title={streamTitle || 'B站直播'}
            subtitle={`线路 ${candidateIndex + 1}/${candidates.length} · ${currentCandidate?.formatName || 'unknown'}`}
            onMore={() => setMoreVisible(true)}
            onRefresh={() => activeRoom && startWatch(activeRoom)}
          />
        </Animated.View>

        {/* 哔哩哔哩风格底部控制坞：播放 · 直播标识 · 刷新 · 横屏（一次点击横屏+全屏） */}
        <Animated.View style={[{ position: 'absolute', bottom: 0, left: 0, right: 0, opacity: controlsOpacity, pointerEvents: controlsVisible ? 'auto' : 'none', zIndex: 30 }]}>
          <PlayerBottomBar
            isLive
            paused={paused}
            currentTime={0}
            duration={0}
            showDanmaku={false}
            onTogglePlay={() => setPaused((p) => !p)}
            onSeek={() => {}}
            onRotate={() => setIsLandscape((v) => !v)}
          />
        </Animated.View>

        <PlayerMorePanel
          visible={moreVisible}
          onClose={() => setMoreVisible(false)}
          title="播放器功能"
          items={[
            { key: 'web', icon: useWebPlayer ? 'cellphone' : 'web', label: useWebPlayer ? '原生' : '网页', onPress: () => setUseWebPlayer((p) => !p), active: useWebPlayer },
            ...(candidateIndex + 1 < candidates.length ? [{ key: 'next', icon: 'playlist-check', label: '下一线路', onPress: () => setCandidateIndex((prev) => Math.min(prev + 1, candidates.length - 1)) }] : []),
          ]}
        />
      </View>
    );
  }

  // 首屏（列表为空且加载中）显示居中转圈；刷新时列表保持不变，仅头部显示加载指示，避免闪屏
  return (
    <View style={[styles.container, isDark && styles.containerDark]}>
      <ScreenHeader title="B站直播" right={
        loading ? (
          <ActivityIndicator color="#ff6f91" />
        ) : (
          <TouchableOpacity onPress={checkStatuses}>
            <Text style={styles.refresh}>刷新状态</Text>
          </TouchableOpacity>
        )
      } />
      {status ? <Text style={[styles.status, isDark && styles.statusDark]}>{status}</Text> : null}
      <PerfFlatList
        data={rooms}
        keyExtractor={(item, index) => item.roomId || String(index)}
        renderItem={({ item, index }) => (
          <FadeInView delay={index < 12 ? 80 + index * 30 : 0} duration={300}>
            <TouchableOpacity
              style={[styles.roomItem, isDark && styles.roomItemDark]}
              onPress={() => startWatch(item)}
            >
              <View style={styles.roomInfo}>
                <Text style={[styles.roomName, isDark && styles.textLight]}>{item.name || `房间号：${item.roomId}`}</Text>
                <Text style={[styles.roomId, isDark && styles.roomIdDark]}>房间号：{item.roomId}</Text>
              </View>
              <View style={[styles.statusDot, liveStatuses[item.roomId] ? styles.liveDot : styles.offlineDot]} />
            </TouchableOpacity>
          </FadeInView>
        )}
        ListEmptyComponent={
          loading ? (
            <View style={styles.emptyWrap}>
              <ActivityIndicator size="large" color={isDark ? '#5a5a5a' : '#ff6f91'} />
            </View>
          ) : (
            <Text style={[styles.empty, isDark && styles.emptyDark]}>暂无直播间</Text>
          )
        }
        initialNumToRender={12}
        maxToRenderPerBatch={12}
        windowSize={7}
        removeClippedSubviews
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  containerDark: { backgroundColor: 'transparent' },
  refresh: { fontSize: 12, color: '#ff6f91' },
  status: { margin: 12, padding: 10, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.72)', color: '#555', fontSize: 12, textAlign: 'center' },
  statusDark: { backgroundColor: 'rgba(30,30,30,0.78)', color: '#aaa' },
  playerPage: { flex: 1, backgroundColor: '#000' },
  player: { flex: 1, backgroundColor: '#000' },
  nativeVideo: { flex: 1, backgroundColor: '#000' },
  playerError: { position: 'absolute', left: 16, right: 16, bottom: 110, padding: 12, borderRadius: 16, backgroundColor: 'rgba(20,20,20,0.88)' },
  playerErrorText: { color: '#fff', fontSize: 12, lineHeight: 18 },
  playerActions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  webFallbackBtn: { backgroundColor: '#ff6f91', borderRadius: 18, paddingHorizontal: 12, paddingVertical: 8, alignSelf: 'flex-start' },
  webFallbackText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  roomItem: { flexDirection: 'row', alignItems: 'center', padding: 14, backgroundColor: 'rgba(255,255,255,0.46)', marginHorizontal: 16, marginVertical: 4, borderRadius: 16 },
  roomItemDark: { backgroundColor: 'rgba(20,20,20,0.58)' },
  roomInfo: { flex: 1 },
  roomName: { fontSize: 15, fontWeight: '700', color: '#333' },
  roomId: { fontSize: 11, color: '#333333', marginTop: 2 },
  roomIdDark: { color: '#aaa' },
  statusDot: { width: 12, height: 12, borderRadius: 6 },
  liveDot: { backgroundColor: '#4caf50' },
  offlineDot: { backgroundColor: '#5a5a5a' },
  textLight: { color: '#eee' },
  empty: { textAlign: 'center', color: '#333333', marginTop: 60, fontSize: 14 },
  emptyDark: { color: '#aaa' },
  emptyWrap: { alignItems: 'center', justifyContent: 'center', paddingVertical: 48 },
});
