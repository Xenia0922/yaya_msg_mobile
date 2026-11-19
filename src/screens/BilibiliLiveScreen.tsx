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
import { usePalette } from '../theme';
import type { Palette } from '../theme/colors';
import { useI18n } from '../i18n';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { GlassSurface } from '../components/GlassSurface';

/** 直播状态点：直播中 success 呼吸动画（原生驱动）+ 文字；未开播 labelTertiary */
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
  }, [live, pulse]);

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
  // B站直播弹幕：WebSocket 实时接收 → DanmakuOverlay（live 模式立即上屏）
  const [showDanmaku, setShowDanmaku] = useState(false);
  const playerDanmakuOn = usePlayerStore((s) => s.danmakuOn);
  const [dmItems, setDmItems] = useState<DanmakuItem[]>([]);
  const [dmTick, setDmTick] = useState(0);
  const danmakuRef = useRef<BilibiliDanmaku | null>(null);
  const dmSeq = useRef(0);
  const dmBuffer = useRef<string[]>([]);
  const dmFlushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 请求序号：切换房间时作废旧 resolveLive 响应，避免旧流覆盖新房间
  const watchSeqRef = useRef(0);
  const [showDmSettings, setShowDmSettings] = useState(false);
  // 登录画质提示（一次）：未登录 B站时接口最高只给 720P，告知用户登录解锁
  const qualityHintShown = useRef(false);
  const [qualityHint, setQualityHint] = useState('');
  const qualityHintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showQualityHint = useCallback((msg: string) => {
    setQualityHint(msg);
    if (qualityHintTimer.current) clearTimeout(qualityHintTimer.current);
    qualityHintTimer.current = setTimeout(() => setQualityHint(''), 5000);
  }, []);
  // 按所选画质过滤线路；无匹配（画质切换瞬时空集）时回退全量
  const visibleCandidates =
    qualityQn == null
      ? candidates
      : candidates.filter((c) => Number(c.currentQn) === qualityQn).length
        ? candidates.filter((c) => Number(c.currentQn) === qualityQn)
        : candidates;
  const safeIndex = Math.min(candidateIndex, Math.max(0, visibleCandidates.length - 1));
  const currentCandidate = visibleCandidates[safeIndex];
  const streamUrl = currentCandidate?.url || '';
  // B站直播默认走网页内核（flv.js/HLS）：用户反馈原生内核画面左上角带官方 LIVE 红标且兼容性问题多，
  // 网页内核无该角标。每次进直播间仅强制一次；用户仍可经「更多→切回原生播放器」手动换回。
  // 公演/48 的 B站直播默认走网页内核：原生内核画面带官方 "LIVE" 红标（用户确认为播放器层问题，网页无标）。
  // 网页内核现已带防盗链 headers（mpegts.js/hls.js xhrSetup）可正常拉流；每次进直播间仅强制一次，
  // 仍可经 更多→切回原生播放器 手动换回。
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
      // R5: 卸载时断开弹幕 WS + 清全部定时器（此前仅 closePlayer 清理 → 泄漏/卸载后 setState）
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
    // 使在途 resolveLive 响应失效，避免关闭后旧响应重新拉起播放器
    watchSeqRef.current += 1;
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
    // 从主页公演栏直达进来的：退出播放器直接回主页（不再落到 B站列表二级菜单）
    if (route.params?.roomId) navigation.goBack();
  }, [navigation, route.params?.roomId]);

  // 应用内小窗：直播流交棒给悬浮小窗
  const handleMiniPlayer = useCallback(() => {
    if (!streamUrl) return;
    useMiniPlayerStore.getState().open({
      url: streamUrl,
      title: streamTitle || t('B站直播'),
      cover: '',
      isLive: true,
      position: 0,
      // 公演/B站：小窗也用网页内核（无 LIVE 标；带增益+防盗链 headers，音量与大屏一致）
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
      // 在播房间并行抓取封面 + 场次标题（列表行展示真实封面与标题）
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

  // 直播状态实时自动刷新：进入即静默查一次，之后每 30s 轮询；切回前台也立即刷新。
  // 播放中不轮询（播放器本身在播即代表开播），避免无谓请求。
  const didAutoCheck = useRef(false);
  useEffect(() => {
    if (rooms.length && !didAutoCheck.current) {
      didAutoCheck.current = true;
      checkStatuses(true);
    }
  }, [rooms, checkStatuses]);

  useEffect(() => {
    if (!isFocused || streamUrl || !rooms.length) return;
    // 功耗：失焦或后台暂停开播状态轮询；回到页面/前台再补拉
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

  // 切回前台时立即刷新开播状态（原 effect 只处理横屏锁复位）
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && isFocused && !streamUrl) checkStatuses(true);
    });
    return () => sub.remove();
  }, [checkStatuses, isFocused, streamUrl]);

  // 从主页公演栏带 roomId 进入：直接开播该房间，跳过列表
  useEffect(() => {
    const roomId = route.params?.roomId;
    if (!roomId) return;
    startWatch({ roomId, name: route.params?.roomName || '', isLive: true });
    // 只在进入时触发一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startWatch = async (room: BilibiliLiveRoom) => {
    const watchSeq = watchSeqRef.current + 1;
    watchSeqRef.current = watchSeq;
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
      // 旧房间的响应晚到：直接丢弃，不能覆盖当前房间的流/弹幕状态
      if (watchSeq !== watchSeqRef.current) return;
      if (!info.streamUrl && !info.streamCandidates?.length) {
        throw new Error(t('没有解析到可播放的直播流'));
      }
      const list = info.streamCandidates?.length
        ? info.streamCandidates
        : [{ url: info.streamUrl }];
      setStreamTitle(info.title || room.name || t('B站直播'));
      setCandidates(list);
      // 默认最高可用画质（resolveLive 已按画质降序排列候选）
      const qs = info.qualities || [];
      setQualities(qs);
      setQualityQn(qs.length ? qs[0].qn : null);
      // 未登录 B站时接口最高只给 720P：一次性轻提示告知登录解锁原画/蓝光
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
      // 连接弹幕服务（失败静默，不影响播放）；消息节流：300ms 批量上屏，避免高频 setState 卡顿
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

  /** 切换画质：按 qn 过滤线路并回到第一条，Video 随 key 变化重新加载 */
  const pickQuality = (qn: number) => {
    if (qualityQn === qn) return;
    setQualityQn(qn);
    setCandidateIndex(0);
  };

  // 从主页公演栏直达：解析直播流期间显示全屏加载（避免闪一下列表页/长时间黑屏无反馈）
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
    /* 统一播放器（重写）：B站直播 → PlayerScreen
       - 候选线路：urls 传全部线路，失败自动切下一线路（PlayerCore 内置）
       - 画质/弹幕设置/下一线路：extraActions（更多面板）
       - B站弹幕：children 插槽挂 DanmakuOverlay（WebSocket 数据源保留在页面）
       - 音量补偿 volume 1.5（B站流响度低） */
    return (
      <View style={styles.playerPage}>
        <PlayerScreen
          source={{
            kind: 'live',
            url: streamUrl,
            urls: visibleCandidates.map((c) => c.url),
            headers: bilibiliApi.headers(currentCandidate?.realRoomId),
            volume: 1,
            volumeBoost: 1.8, // B站源弱响度：网页内核经 WebAudio 预放大（Exo 原生音量 clamp ≤1 提不了）
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
          {/* B站直播弹幕：实时滚动（live 模式立即上屏） */}
          <DanmakuOverlay
            danmaku={dmItems}
            currentTime={dmTick}
            visible={playerDanmakuOn && showDanmaku && !!streamUrl}
            live
          />
        </PlayerScreen>

        {/* 登录画质提示：未登录时一次性告知（区别于换流提示，仅画质相关） */}
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

  // 首屏（列表为空且加载中）显示居中转圈；刷新时列表保持不变，仅头部显示加载指示，避免闪屏
  return (
    <GlassSurface radius={22} role="card" style={styles.container}>
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
              backgroundColor: 'transparent',
              borderColor: palette.hairline,
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
              style={[
                styles.roomItem,
                { backgroundColor: 'transparent', borderColor: palette.hairline },
              ]}
              onPress={() => startWatch(item)}
              accessibilityRole="button"
              accessibilityLabel={roomLabel}
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
                <Text style={[styles.roomId, { color: palette.labelSecondary }]} numberOfLines={1}>
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
    </GlassSurface>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  status: {
    margin: 12,
    padding: 10,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    fontSize: 12,
    textAlign: 'center',
  },
  retryBtn: {
    alignSelf: 'center',
    marginTop: -4,
    marginBottom: 8,
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 20,
  },
  retryBtnText: { fontSize: 13, fontWeight: '800' },
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
  qualityHintText: { color: '#ffd9e2', fontSize: 12, fontWeight: '600', flexShrink: 1 },
  roomItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    marginHorizontal: 4,
    marginVertical: 4,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
  },
  roomIcon: {
    width: 56,
    height: 56,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    overflow: 'hidden',
  },
  roomInfo: { flex: 1, minWidth: 0 },
  roomName: { fontSize: 14, fontWeight: '700', lineHeight: 20 },
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
  statusLabel: { fontSize: 10, fontWeight: '700' },
  list: { padding: 8, paddingBottom: 40 },
});
