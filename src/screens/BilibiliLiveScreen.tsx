import React, { useCallback, useEffect, useRef, useState } from 'react';
import { PerfFlatList } from '../components/PerfFlatList';

import {
  ActivityIndicator,
  Animated,
  AppState,
  Easing,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useIsFocused, useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { useSettingsStore } from '../store';
import { useMiniPlayerStore } from '../store/miniPlayerStore';
import PlayerScreen from '../player';
import { usePlayerStore } from '../player/store/playerStore';
import { ScalePressable } from '../components/Motion';
import ScreenHeader from '../components/ScreenHeader';
import { HeaderAction } from '../components/HeaderAction';
import { EmptyState, ErrorState } from '../components/StateViews';
import { BilibiliLiveRoom } from '../types';
import { RootStackParamList } from '../navigation/types';
import { externalApi } from '../api/external';
import bilibiliApi from '../api/bilibili';
import { BilibiliDanmaku } from '../services/bilibiliDanmaku';
import { DanmakuOverlay } from '../components/DanmakuOverlay';
import DanmakuSettingsSheet from '../components/DanmakuSettingsSheet';
import { DanmakuItem } from '../utils/danmaku';
import { errorMessage, normalizeUrl } from '../utils/data';
import { NetworkImage } from '../components/NetworkImage';
import { setLiveImmersiveMode } from '../native/LivePlayer';
import { getPageBackground, usePalette, radii, fontFamily } from '../theme';
import type { Palette } from '../theme/colors';
import { GlassSurface } from '../components/GlassSurface';
import { useI18n } from '../i18n';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';

function StatusDot({
  live,
  active,
  palette,
  label,
}: {
  live: boolean;
  active: boolean;
  palette: Palette;
  label: string;
}) {
  const pulse = React.useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!live || !active) {
      pulse.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 0.35,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [live, active, pulse]);

  return (
    <View style={styles.statusWrap}>
      <Animated.View
        style={[
          styles.statusHalo,
          { backgroundColor: live ? palette.success : 'transparent', opacity: live ? pulse : 1 },
        ]}
      >
        <View
          style={[
            styles.statusDot,
            { backgroundColor: live ? palette.success : palette.labelTertiary },
          ]}
        />
      </Animated.View>
      <Text
        style={[styles.statusLabel, { color: live ? palette.success : palette.labelTertiary }]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </View>
  );
}

export default function BilibiliLiveScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<RootStackParamList, 'BilibiliLiveScreen'>>();
  const isFocused = useIsFocused();
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const palette = usePalette();
  const { t } = useI18n();
  const [rooms, setRooms] = useState<BilibiliLiveRoom[]>([]);
  const [candidates, setCandidates] = useState<any[]>([]);
  const [candidateIndex, setCandidateIndex] = useState(0);
  const [qualities, setQualities] = useState<{ qn: number; label: string }[]>([]);
  const [qualityQn, setQualityQn] = useState<number | null>(null);
  const [streamTitle, setStreamTitle] = useState('');
  const [activeRoom, setActiveRoom] = useState<BilibiliLiveRoom | null>(null);
  const [liveStatuses, setLiveStatuses] = useState<Record<string, boolean>>({});
  const [roomInfo, setRoomInfo] = useState<Record<string, { title: string; cover: string }>>({});
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [fetchError, setFetchError] = useState('');
  const [configError, setConfigError] = useState('');

  const [showDanmaku, setShowDanmaku] = useState(false);
  const playerDanmakuOn = usePlayerStore((s) => s.danmakuOn);
  const [dmItems, setDmItems] = useState<DanmakuItem[]>([]);
  const [dmTick, setDmTick] = useState(0);
  const danmakuRef = useRef<BilibiliDanmaku | null>(null);
  const dmSeq = useRef(0);
  const dmBuffer = useRef<string[]>([]);
  const dmFlushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const watchSeqRef = useRef(0);
  const [showDmSettings, setShowDmSettings] = useState(false);

  const qualityHintShown = useRef(false);
  const [qualityHint, setQualityHint] = useState('');
  const qualityHintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showQualityHint = useCallback((msg: string) => {
    setQualityHint(msg);
    if (qualityHintTimer.current) clearTimeout(qualityHintTimer.current);
    qualityHintTimer.current = setTimeout(() => setQualityHint(''), 5000);
  }, []);

  const visibleCandidates =
    qualityQn == null
      ? candidates
      : candidates.filter((c) => Number(c.currentQn) === qualityQn).length
        ? candidates.filter((c) => Number(c.currentQn) === qualityQn)
        : candidates;
  const safeIndex = Math.min(candidateIndex, Math.max(0, visibleCandidates.length - 1));
  const currentCandidate = visibleCandidates[safeIndex];
  const streamUrl = currentCandidate?.url || '';

  const webForcedRef = useRef(false);
  useEffect(() => {
    if ((currentCandidate?.url || '') && !webForcedRef.current) {
      webForcedRef.current = true;
      usePlayerStore.getState().setForceWebOnce(true);
      usePlayerStore.getState().setUseWebKernel(true);
    }
  }, [currentCandidate]);

  useEffect(() => {
    const parent = navigation.getParent?.();
    parent?.setOptions({ tabBarStyle: streamUrl ? { display: 'none' } : undefined });
    return () => parent?.setOptions({ tabBarStyle: undefined });
  }, [navigation, streamUrl]);

  const loadConfig = useCallback(async () => {
    try {
      const data = await externalApi.fetchBilibiliConfig();
      setRooms(data || []);
      setConfigError('');
      setStatus(
        data?.length
          ? t('已加载 {count} 个直播间', { count: data.length })
          : t('没有加载到直播间配置'),
      );
    } catch (error) {
      setConfigError(errorMessage(error));
      setStatus(t('直播间列表加载失败：{msg}', { msg: errorMessage(error) }));
    }
  }, [t]);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  useEffect(
    () => () => {
      try {
        danmakuRef.current?.disconnect();
      } catch {}
      danmakuRef.current = null;
      if (dmFlushTimer.current) clearTimeout(dmFlushTimer.current);
      if (qualityHintTimer.current) clearTimeout(qualityHintTimer.current);
      dmFlushTimer.current = null;
      qualityHintTimer.current = null;
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    },
    [],
  );

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      setAppActive(state === 'active');
      if (state !== 'active') {
        ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
      }
    });
    return () => sub.remove();
  }, []);

  const closePlayer = useCallback(() => {
    watchSeqRef.current += 1;
    webForcedRef.current = false;
    danmakuRef.current?.disconnect();
    danmakuRef.current = null;
    if (dmFlushTimer.current) clearTimeout(dmFlushTimer.current);
    dmFlushTimer.current = null;
    dmBuffer.current = [];
    setDmItems([]);
    setDmTick(0);
    setShowDanmaku(false);
    setCandidates([]);
    setQualities([]);
    setQualityQn(null);
    setActiveRoom(null);
    setLiveImmersiveMode(false);
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});

    if (route.params?.roomId) navigation.goBack();
  }, [navigation, route.params?.roomId]);

  const handleMiniPlayer = useCallback(() => {
    if (!streamUrl) return;
    useMiniPlayerStore.getState().open({
      url: streamUrl,
      title: streamTitle || t('B站直播'),
      cover: '',
      isLive: true,
      position: 0,

      web: {
        headers: bilibiliApi.headers(
          currentCandidate?.realRoomId || streamUrl.match(/\/(\d+)/)?.[1] || '',
        ),
        volumeBoost: 1.8,
      },
      backTo: { mode: 'live', playUrl: streamUrl, playTitle: streamTitle, playCover: '' },
    });
    closePlayer();
  }, [streamUrl, streamTitle, closePlayer, currentCandidate?.realRoomId, t]);

  const refreshingRef = useRef(false);
  const checkStatuses = useCallback(
    async (silent = false) => {
      if (!rooms.length || refreshingRef.current) return;
      refreshingRef.current = true;
      if (!silent) {
        setLoading(true);
        setStatus(t('正在刷新开播状态...'));
      }
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

      const liveIds = rooms.filter((room) => next[room.roomId]).map((room) => room.roomId);
      if (liveIds.length) {
        const infoResults = await Promise.allSettled(
          liveIds.map((id) => bilibiliApi.getRoomInfo(id)),
        );
        const infoMap: Record<string, { title: string; cover: string }> = {};
        infoResults.forEach((r, index) => {
          if (r.status === 'fulfilled' && r.value) {
            const d = r.value;
            infoMap[liveIds[index]] = {
              title: String(d.title || ''),
              cover: normalizeUrl(String(d.cover || d.user_cover || '')),
            };
          }
        });
        setRoomInfo(infoMap);
      }
      if (!silent) setStatus(t('状态刷新完成'));
      setLoading(false);
      refreshingRef.current = false;
    },
    [rooms, t],
  );

  const didAutoCheck = useRef(false);
  useEffect(() => {
    if (rooms.length && !didAutoCheck.current) {
      didAutoCheck.current = true;
      checkStatuses(true);
    }
  }, [rooms, checkStatuses]);

  useEffect(() => {
    if (!isFocused || streamUrl || !rooms.length) return;

    let id: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (!id)
        id = setInterval(() => {
          checkStatuses(true);
        }, 30000);
    };
    const stop = () => {
      if (id) {
        clearInterval(id);
        id = null;
      }
    };
    if (AppState.currentState === 'active') start();
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') start();
      else stop();
    });
    return () => {
      sub.remove();
      stop();
    };
  }, [rooms, streamUrl, checkStatuses, isFocused]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && isFocused && !streamUrl) checkStatuses(true);
    });
    return () => sub.remove();
  }, [checkStatuses, isFocused, streamUrl]);

  useEffect(() => {
    const roomId = route.params?.roomId;
    if (!roomId) return;
    startWatch({ roomId, name: route.params?.roomName || '', isLive: true });

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startWatch = async (room: BilibiliLiveRoom) => {
    const watchSeq = watchSeqRef.current + 1;
    watchSeqRef.current = watchSeq;
    webForcedRef.current = false;
    setLoading(true);
    setStatus(t('正在获取直播流：{name}', { name: room.name || room.roomId }));
    setCandidates([]);
    setCandidateIndex(0);
    setQualities([]);
    setQualityQn(null);
    setActiveRoom(room);
    setFetchError('');
    danmakuRef.current?.disconnect();
    danmakuRef.current = null;
    setDmItems([]);
    setDmTick(0);
    setShowDanmaku(false);
    try {
      const info = await bilibiliApi.resolveLive(room.roomId);

      if (watchSeq !== watchSeqRef.current) return;
      if (!info.streamUrl && !info.streamCandidates?.length) {
        throw new Error(t('没有解析到可播放的直播流'));
      }
      const list = info.streamCandidates?.length
        ? info.streamCandidates
        : [{ url: info.streamUrl }];
      setStreamTitle(info.title || room.name || t('B站直播'));
      setCandidates(list);

      const qs = info.qualities || [];
      setQualities(qs);
      setQualityQn(qs.length ? qs[0].qn : null);

      if (
        !qualityHintShown.current &&
        !useSettingsStore.getState().settings.bilibiliCookie &&
        qs.length &&
        qs[0].qn < 400
      ) {
        qualityHintShown.current = true;
        showQualityHint(
          t('未登录B站，当前最高{label}；登录后自动解锁原画/蓝光', { label: qs[0].label }),
        );
      }

      const dm = new BilibiliDanmaku();
      danmakuRef.current = dm;
      dm.connect(String(info.realRoomId || room.roomId), {
        onMessage: (text) => {
          dmBuffer.current.push(text);
          if (dmFlushTimer.current) return;
          dmFlushTimer.current = setTimeout(() => {
            dmFlushTimer.current = null;
            const batch = dmBuffer.current.splice(0, 24);
            if (!batch.length) return;
            dmSeq.current += batch.length;
            const tick = dmSeq.current * 0.12;
            setDmTick(tick);
            setDmItems((prev) => {
              const next = [...prev, ...batch.map((text) => ({ time: tick, text }))];
              return next.length > 300 ? next.slice(-300) : next;
            });
            setShowDanmaku(true);
          }, 300);
        },
      });
      setStatus('');
    } catch (error) {
      if (watchSeq !== watchSeqRef.current) return;
      setFetchError(errorMessage(error));
      setStatus(t('获取直播流失败：{msg}', { msg: errorMessage(error) }));
    } finally {
      if (watchSeq === watchSeqRef.current) setLoading(false);
    }
  };

  const pickQuality = (qn: number) => {
    if (qualityQn === qn) return;
    setQualityQn(qn);
    setCandidateIndex(0);
  };

  if (route.params?.roomId && !streamUrl && !fetchError) {
    return (
      <View style={styles.playerPage}>
        <View style={styles.startingWrap}>
          <ActivityIndicator color="#ffffff" size="large" />
          <Text style={styles.startingText}>{t('正在进入直播间…')}</Text>
        </View>
      </View>
    );
  }

  if (streamUrl) {
    return (
      <View style={styles.playerPage}>
        <PlayerScreen
          source={{
            kind: 'live',
            url: streamUrl,
            urls: visibleCandidates.map((c) => c.url),
            headers: bilibiliApi.headers(currentCandidate?.realRoomId),
            volume: 1,
            volumeBoost: 1.8,
          }}
          meta={{ title: streamTitle || t('B站直播') }}
          features={{ kernelSwitch: true, danmaku: true }}
          extraActions={[
            {
              key: 'pip',
              icon: 'picture-in-picture-bottom-right-outline',
              label: t('小窗'),
              onPress: handleMiniPlayer,
            },
            ...(qualities.length > 1
              ? qualities.map((q) => ({
                  key: `qn-${q.qn}`,
                  icon: 'high-definition-box',
                  label: q.label,
                  active: qualityQn === q.qn,
                  onPress: () => pickQuality(q.qn),
                }))
              : []),
            {
              key: 'dmsettings',
              icon: 'cog-outline',
              label: t('弹幕设置'),
              onPress: () => setShowDmSettings(true),
            },
            ...(safeIndex + 1 < visibleCandidates.length
              ? [
                  {
                    key: 'next',
                    icon: 'playlist-check',
                    label: t('下一线路'),
                    onPress: () =>
                      setCandidateIndex((prev) => Math.min(prev + 1, visibleCandidates.length - 1)),
                  },
                ]
              : []),
          ]}
          onClose={closePlayer}
          persistent
        >
          <DanmakuOverlay
            danmaku={dmItems}
            currentTime={dmTick}
            visible={playerDanmakuOn && showDanmaku && !!streamUrl}
            live
          />
        </PlayerScreen>

        {qualityHint ? (
          <Animated.View
            nativeID="yaya.pip.overlay"
            collapsable={false}
            style={styles.qualityHintWrap}
            pointerEvents="none"
          >
            <View style={styles.qualityHintPill}>
              <MaterialCommunityIcons name="account-key-outline" size={13} color="#ffd9e2" />
              <Text style={styles.qualityHintText} numberOfLines={2}>
                {qualityHint}
              </Text>
            </View>
          </Animated.View>
        ) : null}

        <DanmakuSettingsSheet visible={showDmSettings} onClose={() => setShowDmSettings(false)} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: getPageBackground() }]}>
      <ScreenHeader
        title={t('B站直播')}
        right={
          loading ? (
            <ActivityIndicator color={palette.tint} />
          ) : (
            <HeaderAction label={t('刷新状态')} onPress={() => checkStatuses(false)} />
          )
        }
      />
      {status ? (
        <Text
          style={[
            styles.status,
            {
              color: palette.labelSecondary,
              backgroundColor: palette.surfaceGlassStrong,
              borderColor: palette.innerStroke,
            },
          ]}
        >
          {status}
        </Text>
      ) : null}
      {fetchError ? (
        <TouchableOpacity
          activeOpacity={0.7}
          style={[styles.retryBtn, { backgroundColor: palette.tint }]}
          onPress={() => activeRoom && startWatch(activeRoom)}
          accessibilityRole="button"
          accessibilityLabel={t('重试获取直播流')}
        >
          <Text style={[styles.retryBtnText, { color: palette.onTint }]}>
            {t('重试获取直播流')}
          </Text>
        </TouchableOpacity>
      ) : null}
      <PerfFlatList
        data={rooms}
        keyExtractor={(item, index) => item.roomId || String(index)}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={() => checkStatuses(false)}
            tintColor={palette.tint}
            colors={[palette.tint]}
            progressBackgroundColor={palette.surface}
          />
        }
        renderItem={({ item }) => {
          const live = !!liveStatuses[item.roomId];
          const info = roomInfo[item.roomId];
          const roomLabel = info?.title || item.name || t('房间号：{id}', { id: item.roomId });
          return (
            <ScalePressable
              activeOpacity={0.85}
              pressedScale={0.97}
              onPress={() => startWatch(item)}
              accessibilityRole="button"
              accessibilityLabel={roomLabel}
            >
              <GlassSurface
                radius={radii.lg}
                role="card"
                frostedOnly
                style={[
                  styles.roomItem,
                  { backgroundColor: 'transparent', borderColor: palette.innerStroke },
                ]}
              >
                <View
                  style={[
                    styles.roomIcon,
                    { backgroundColor: live ? palette.tintSoft : palette.fill2 },
                  ]}
                >
                  {info?.cover ? (
                    <NetworkImage
                      source={{ uri: info.cover }}
                      style={styles.roomIcon}
                      resizeMode="cover"
                    />
                  ) : (
                    <MaterialCommunityIcons
                      name="television-classic"
                      size={22}
                      color={live ? palette.tint : palette.labelSecondary}
                    />
                  )}
                </View>
                <View style={styles.roomInfo}>
                  <Text style={[styles.roomName, { color: palette.label }]} numberOfLines={2}>
                    {info?.title || item.name || t('房间号：{id}', { id: item.roomId })}
                  </Text>
                  <Text
                    style={[styles.roomId, { color: palette.labelSecondary }]}
                    numberOfLines={1}
                  >
                    {item.name || ''}
                    {item.name ? ' · ' : ''}
                    {t('房间号：{id}', { id: item.roomId })}
                  </Text>
                </View>
                <StatusDot
                  live={live}
                  active={isFocused && appActive}
                  palette={palette}
                  label={live ? t('直播中') : t('未开播')}
                />
              </GlassSurface>
            </ScalePressable>
          );
        }}
        ListEmptyComponent={
          configError ? (
            <ErrorState title={t('加载失败')} hint={configError} onAction={loadConfig} />
          ) : (
            <EmptyState
              icon="broadcast"
              title={t('暂无直播间')}
              hint={t('下拉刷新或稍后再来看看')}
            />
          )
        }
        initialNumToRender={12}
        maxToRenderPerBatch={12}
        windowSize={7}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  status: {
    marginHorizontal: 14,
    marginTop: 4,
    marginBottom: 8,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 22,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    fontSize: 12,
    fontFamily: fontFamily.system,
    textAlign: 'center',
  },
  retryBtn: {
    alignSelf: 'center',
    marginTop: -4,
    marginBottom: 8,
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 999,
    borderCurve: 'continuous',
  },
  retryBtnText: { fontSize: 13, fontFamily: fontFamily.system, fontWeight: '800' },
  playerPage: { flex: 1, backgroundColor: '#000' },
  startingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 },
  startingText: { color: 'rgba(255,255,255,0.75)', fontSize: 13, fontWeight: '600' },
  qualityHintWrap: {
    position: 'absolute',
    top: 96,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 40,
    pointerEvents: 'none',
  },
  qualityHintPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 18,
    backgroundColor: 'rgba(20,20,22,0.88)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,143,168,0.35)',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
    maxWidth: '86%',
  },
  qualityHintText: {
    color: '#ffd9e2',
    fontSize: 12,
    fontFamily: fontFamily.system,
    fontWeight: '600',
    flexShrink: 1,
  },
  roomItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    marginHorizontal: 8,
    marginVertical: 4,
    borderRadius: 22,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
  },
  roomIcon: {
    width: 56,
    height: 56,
    borderRadius: 14,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    overflow: 'hidden',
  },
  roomInfo: { flex: 1, minWidth: 0 },
  roomName: { fontSize: 14, fontFamily: fontFamily.system, fontWeight: '700', lineHeight: 20 },
  roomId: { fontSize: 11, marginTop: 4 },
  statusWrap: { alignItems: 'flex-end', gap: 4, marginLeft: 8, minWidth: 44 },
  statusHalo: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusLabel: { fontSize: 10, fontFamily: fontFamily.system, fontWeight: '700' },
  list: { padding: 8, paddingBottom: 40 },
});
