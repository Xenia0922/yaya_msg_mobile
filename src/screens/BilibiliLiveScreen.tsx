import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { WebView } from 'react-native-webview';
import Video from 'react-native-video';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useNavigation } from '@react-navigation/native';
import { useSettingsStore } from '../store';
import { FadeInView } from '../components/Motion';
import { BilibiliLiveRoom } from '../types';
import { externalApi } from '../api/external';
import bilibiliApi from '../api/bilibili';
import { errorMessage } from '../utils/data';
import { getPlayerHtml } from '../components/media/player';

export default function BilibiliLiveScreen() {
  const navigation = useNavigation<any>();
  const isDark = useSettingsStore((s) => s.settings.theme === 'dark');
  const [rooms, setRooms] = useState<BilibiliLiveRoom[]>([]);
  const [candidates, setCandidates] = useState<any[]>([]);
  const [candidateIndex, setCandidateIndex] = useState(0);
  const [streamTitle, setStreamTitle] = useState('B站直播');
  const [liveStatuses, setLiveStatuses] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('加载中...直播间列表...');
  const [playerError, setPlayerError] = useState('');
  const [useWebPlayer, setUseWebPlayer] = useState(false);
  const [isLandscape, setIsLandscape] = useState(false);
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

  const closePlayer = () => {
    setCandidates([]);
    setIsLandscape(false);
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
  };

  const toggleOrientation = () => {
    const next = !isLandscape;
    setIsLandscape(next);
    ScreenOrientation.lockAsync(
      next ? ScreenOrientation.OrientationLock.LANDSCAPE : ScreenOrientation.OrientationLock.PORTRAIT_UP,
    ).catch(() => {});
  };

  const checkStatuses = async () => {
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
    try {
      const info = await bilibiliApi.resolveLive(room.roomId);
      const list = info.streamCandidates?.length ? info.streamCandidates : [{ url: info.streamUrl }];
      setStreamTitle(info.title || room.name || 'B站直播');
      setCandidates(list);
      setStatus('');
    } catch (error) {
      setStatus(`获取直播流失败：${errorMessage(error)}`);
    } finally {
      setLoading(false);
    }
  };

  const switchToNextCandidate = (reason: string) => {
    if (candidateIndex + 1 < candidates.length) {
      setPlayerError(`${reason}，已切换下一条线路`);
      setCandidateIndex((prev) => prev + 1);
      return;
    }
    setPlayerError(`${reason}。所有线路都试过了，建议先确认该房间真的在播，或登录 B站账号后重试。`);
  };

  if (streamUrl) {
    return (
      <View style={styles.playerPage}>
        <View style={styles.playHeader}>
          <TouchableOpacity onPress={closePlayer}>
            <Text style={styles.backBtn}>返回</Text>
          </TouchableOpacity>
          <Text style={styles.playTitle} numberOfLines={1}>{streamTitle}</Text>
          <TouchableOpacity onPress={() => setUseWebPlayer((prev) => !prev)} style={styles.switchPlayerBtn}>
            <Text style={styles.switchPlayerText}>{useWebPlayer ? '原生' : '网页'}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={toggleOrientation} style={styles.switchPlayerBtn}>
            <Text style={styles.switchPlayerText}>{isLandscape ? '竖屏' : '横屏'}</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.lineInfo}>
          线路 {candidateIndex + 1}/{candidates.length} · {currentCandidate?.formatName || 'unknown'} · {currentCandidate?.codecName || 'codec'}
        </Text>
        {useWebPlayer ? (
          <WebView
            source={{ html: getPlayerHtml(streamUrl) }}
            style={styles.player}
            javaScriptEnabled
            domStorageEnabled
            allowsInlineMediaPlayback
            mediaPlaybackRequiresUserAction={false}
            mixedContentMode="always"
            allowsFullscreenVideo
          />
        ) : (
          <View style={styles.player}>
            <Video
              key={streamUrl}
              source={{
                uri: streamUrl,
                headers: bilibiliApi.headers(currentCandidate?.realRoomId),
              }}
              style={styles.nativeVideo}
              controls
              resizeMode="contain"
              paused={false}
              ignoreSilentSwitch="ignore"
              onLoad={() => setPlayerError('')}
              onError={(event) => {
                const detail = JSON.stringify(event?.error || event).slice(0, 180);
                switchToNextCandidate(`原生播放器失败：${detail}`);
              }}
            />
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
        )}
      </View>
    );
  }

  return (
    <View style={[styles.container, isDark && styles.containerDark]}>
      <View style={[styles.header, isDark && styles.headerDark]}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backBtn}>返回</Text>
        </TouchableOpacity>
        <Text style={styles.title}>B站直播</Text>
        <TouchableOpacity onPress={checkStatuses}>
          <Text style={styles.refresh}>刷新状态</Text>
        </TouchableOpacity>
      </View>
      {status ? <Text style={[styles.status, isDark && styles.statusDark]}>{status}</Text> : null}
      {loading ? <ActivityIndicator color="#ff6f91" style={{ padding: 12 }} /> : null}
      <FadeInView delay={80} duration={300} style={{ flex: 1 }}>
        <FlatList
          data={rooms}
          keyExtractor={(item, index) => item.roomId || String(index)}
          renderItem={({ item, index }) => (
            <FadeInView delay={80 + index * 30} duration={300}>
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
          ListEmptyComponent={<Text style={[styles.empty, isDark && styles.emptyDark]}>暂无直播间</Text>}
        />
      </FadeInView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  containerDark: { backgroundColor: 'transparent' },
  header: { paddingTop: 54, paddingHorizontal: 20, paddingBottom: 14, marginBottom: 4, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerDark: {},
  title: { fontSize: 18, fontWeight: '800', color: '#ff6f91' },
  backBtn: { color: '#ff6f91', fontSize: 14 },
  refresh: { fontSize: 12, color: '#ff6f91' },
  status: { margin: 12, padding: 10, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.72)', color: '#555', fontSize: 12, textAlign: 'center' },
  statusDark: { backgroundColor: 'rgba(30,30,30,0.78)', color: '#aaa' },
  playerPage: { flex: 1, backgroundColor: '#000' },
  playHeader: { flexDirection: 'row', alignItems: 'center', padding: 12, paddingTop: 50, backgroundColor: 'rgba(20,20,20,0.72)', gap: 12 },
  playTitle: { color: '#fff', fontSize: 16, fontWeight: '700', flex: 1 },
  switchPlayerBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 18, backgroundColor: '#222' },
  switchPlayerText: { color: '#ff6f91', fontSize: 12, fontWeight: '800' },
  lineInfo: { color: '#eeeeee', backgroundColor: '#111', fontSize: 11, paddingHorizontal: 12, paddingVertical: 6 },
  player: { flex: 1, backgroundColor: '#000' },
  nativeVideo: { flex: 1, backgroundColor: '#000' },
  playerError: { position: 'absolute', left: 16, right: 16, bottom: 24, padding: 12, borderRadius: 16, backgroundColor: 'rgba(20,20,20,0.88)' },
  playerErrorText: { color: '#fff', fontSize: 12, lineHeight: 18 },
  playerActions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  webFallbackBtn: { backgroundColor: '#ff6f91', borderRadius: 18, paddingHorizontal: 12, paddingVertical: 8 },
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
});
