import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Platform, Animated, Easing } from 'react-native';
import Video from 'react-native-video';
import { Member } from '../types';
import MemberPicker from '../components/MemberPicker';
import ScreenHeader from '../components/ScreenHeader';
import { useI18n } from '../i18n';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { RootStackParamList } from '../navigation/types';
import { useMiniPlayerStore } from '../store/miniPlayerStore';
import { ScalePressable } from '../components/Motion';
import { CenterSpinner } from '../components/Loaders';
import { EmptyState, ErrorState } from '../components/StateViews';
import { Pill } from '../components/Pill';
import { NetworkImage } from '../components/NetworkImage';
import { Skeleton } from '../components/Skeleton';
import { errorMessage } from '../utils/data';
import { fetchMemberRadioStream } from '../services/radio';
import {
  claimAudioFocus,
  registerAudioHandler,
  releaseAudioFocus,
  setRadioForegroundActive,
} from '../services/audioFocus';
import {
  LiveExoView,
  startRadioForeground,
  stopRadioForeground,
  onRadioStopRequested,
  onRadioControlRequested,
} from '../native/LivePlayer';
import { ensureNotificationPermission } from '../utils/notifications';
import { logWarn } from '../utils/runtimeLog';
import { usePalette, makeShadows, fontFamily } from '../theme';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { GlassSurface } from '../components/GlassSurface';
import { isRtmpUrl } from '../player/resolve/streamResolver';

export default function RoomRadioScreen() {
  const palette = usePalette();
  const shadows = makeShadows(palette.name === 'dark');
  const { t } = useI18n();
  const route = useRoute<RouteProp<RootStackParamList, 'RoomRadioScreen'>>();
  const navigation = useNavigation<any>();
  const [selectedMember, setSelectedMember] = useState<Member | null>(route.params?.member || null);
  const [radioUrl, setRadioUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [loadError, setLoadError] = useState('');
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [roomMode, setRoomMode] = useState<'big' | 'small'>(route.params?.initialMode || 'big');

  const [audioOnly, setAudioOnly] = useState(true);

  const selectedMemberRef = useRef<Member | null>(null);
  const radioUrlRef = useRef('');
  const roomModeRef = useRef<'big' | 'small'>(roomMode);
  const playingRef = useRef(false);
  const fetchingRef = useRef(false);
  const ownsForegroundRef = useRef(false);
  const handedOffToCapsuleRef = useRef(false);
  const autoRetryUsedRef = useRef(false);
  const lastParamKeyRef = useRef('');

  const startReqRef = useRef(0);
  const refreshTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  roomModeRef.current = roomMode;
  radioUrlRef.current = radioUrl;
  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);
  useEffect(() => {
    selectedMemberRef.current = selectedMember;
  }, [selectedMember]);

  const spinAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    let loop: Animated.CompositeAnimation | null = null;
    if (audioOnly && playing) {
      spinAnim.setValue(0);
      loop = Animated.loop(
        Animated.timing(spinAnim, {
          toValue: 1,
          duration: 8000,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
      );
      loop.start();
    } else {
      spinAnim.stopAnimation();
      spinAnim.setValue(0);
    }
    return () => {
      loop?.stop();
    };
  }, [audioOnly, playing, spinAnim]);
  const spinRotate = spinAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  const syncNotification = (member: Member, mode: 'big' | 'small', isPlaying: boolean) => {
    ensureNotificationPermission()
      .then(() => {
        if (handedOffToCapsuleRef.current) return;
        startRadioForeground(
          {
            title: member.ownerName || '',
            artist: mode === 'small' ? t('小房间') : t('大房间'),
            isPlaying,
            position: 0,
            duration: 0,
          },
          true,
        );
      })
      .catch(() => {});
  };

  const applyStreamUrl = (url: string, member: Member, mode: 'big' | 'small') => {
    if (__DEV__) logWarn(`[radio] ${member.ownerName} ${mode} (rtmp=${isRtmpUrl(url)})`);
    handedOffToCapsuleRef.current = false;
    ownsForegroundRef.current = true;
    autoRetryUsedRef.current = false;
    claimAudioFocus('radio');
    setRadioForegroundActive(true);
    setRadioUrl(url);
    radioUrlRef.current = url;
    setStatus(t('已连接，正在缓冲...'));
    setPlaying(true);
    syncNotification(member, mode, true);
  };

  const scheduleStreamRefresh = () => {
    if (refreshTimer.current) return;
    refreshTimer.current = setInterval(
      () => {
        const m = selectedMemberRef.current;
        if (!m || !playingRef.current || fetchingRef.current) return;
        fetchingRef.current = true;
        fetchMemberRadioStream(m, roomModeRef.current)
          .then((res) => {
            if (!playingRef.current) return;
            if (res.url) {
              setRadioUrl((cur) => (cur && cur === res.url ? cur : res.url!));
              logWarn(`[radio] ${m.ownerName} 自动换流`);
            } else {
              logWarn(`[radio] ${m.ownerName} 后台刷新未拿到新流（保留当前）`);
            }
          })
          .catch((e: any) => logWarn(`[radio] 后台换流失败：${e?.message || String(e)}`))
          .finally(() => {
            fetchingRef.current = false;
          });
      },
      5 * 60 * 1000,
    );
  };

  const startRadio = async (
    member: Member,
    opts: { instantUrl?: string; mode?: 'big' | 'small' } = {},
  ) => {
    const mode = opts.mode ?? roomModeRef.current;
    const reqId = startReqRef.current + 1;
    startReqRef.current = reqId;
    handedOffToCapsuleRef.current = false;
    setSelectedMember(member);
    selectedMemberRef.current = member;
    setRoomMode(mode);
    roomModeRef.current = mode;
    setLoading(true);
    setStatus(t('获取电台地址...'));
    setLoadError('');

    if (opts.instantUrl) {
      applyStreamUrl(opts.instantUrl, member, mode);
      scheduleStreamRefresh();
      setLoading(false);

      fetchingRef.current = true;
      fetchMemberRadioStream(member, mode)
        .then((res) => {
          if (reqId !== startReqRef.current || !playingRef.current) return;
          if (res.url) setRadioUrl((cur) => (cur && cur === res.url ? cur : res.url!));
          else logWarn(`[radio] ${member.ownerName} 校验未拿到新流（秒开继续播放）`);
        })
        .catch(() => {})
        .finally(() => {
          fetchingRef.current = false;
        });
      return;
    }

    setRadioUrl('');
    radioUrlRef.current = '';
    setPlaying(false);
    try {
      const res = await fetchMemberRadioStream(member, mode);
      if (reqId !== startReqRef.current) return;
      const current = selectedMemberRef.current;
      if (!current || String(current.id) !== String(member.id) || roomModeRef.current !== mode) {
        return;
      }
      if (res.url) {
        applyStreamUrl(res.url, member, res.mode);
        scheduleStreamRefresh();
      } else {
        logWarn(`[radio] ${member.ownerName} ${mode} 未开启电台`);
        setStatus(t('该房间当前没有开启语音电台'));
      }
    } catch (error: any) {
      if (reqId !== startReqRef.current) return;
      if (error?.code === 'NO_CHANNEL') {
        setLoadError(t('该成员缺少房间映射（channelId），已尝试自动解析仍未成功'));
        setStatus(t('获取失败：{error}', { error: t('缺少房间映射') }));
      } else {
        setLoadError(errorMessage(error));
        setStatus(t('获取失败：{error}', { error: errorMessage(error) }));
      }
    } finally {
      if (reqId === startReqRef.current) setLoading(false);
    }
  };

  const stopRadio = () => {
    startReqRef.current += 1;
    setLoading(false);
    if (refreshTimer.current) {
      clearInterval(refreshTimer.current);
      refreshTimer.current = null;
    }
    setPlaying(false);
    setRadioUrl('');
    radioUrlRef.current = '';
    setStatus(t('已停止'));
    if (ownsForegroundRef.current) {
      ownsForegroundRef.current = false;
      setRadioForegroundActive(false);
      stopRadioForeground();
    }
    releaseAudioFocus('radio');
  };

  const toggleRadioPlaying = () => {
    const m = selectedMemberRef.current || selectedMember;
    const next = !playingRef.current;
    if (next) {
      if (m && radioUrlRef.current) {
        ownsForegroundRef.current = true;
        claimAudioFocus('radio');
        setRadioForegroundActive(true);
        syncNotification(m, roomModeRef.current, true);
      }
      setPlaying(true);
    } else {
      setPlaying(false);
      setRadioForegroundActive(false);
      releaseAudioFocus('radio');
      if (m) syncNotification(m, roomModeRef.current, false);
    }
  };

  const handlePlaybackError = (rawMessage: string) => {
    const m = selectedMemberRef.current;
    if (m && !autoRetryUsedRef.current) {
      autoRetryUsedRef.current = true;
      setStatus(t('获取电台地址...'));
      void fetchMemberRadioStream(m, roomModeRef.current)
        .then((res) => {
          if (res.url && selectedMemberRef.current?.id === m.id) {
            applyStreamUrl(res.url, m, res.mode);
            return;
          }
          setStatus(t('播放失败：{error}', { error: rawMessage.slice(0, 120) }));
        })
        .catch(() => {
          setStatus(t('播放失败：{error}', { error: rawMessage.slice(0, 120) }));
        });
      return;
    }
    setStatus(t('播放失败：{error}', { error: rawMessage.slice(0, 120) }));
  };

  const toCapsule = () => {
    const m = selectedMemberRef.current || selectedMember;
    const url = radioUrlRef.current || radioUrl;
    if (!m || !url) return;
    const mode = roomModeRef.current;
    const title = `${m.ownerName || ''} · ${t('上麦')}`;
    handedOffToCapsuleRef.current = true;
    ownsForegroundRef.current = false;
    lastParamKeyRef.current = '';
    startReqRef.current += 1;
    if (refreshTimer.current) {
      clearInterval(refreshTimer.current);
      refreshTimer.current = null;
    }
    setLoading(false);
    setPlaying(false);
    setRadioUrl('');
    radioUrlRef.current = '';
    releaseAudioFocus('radio');
    useMiniPlayerStore.getState().open({
      url,
      title,
      cover: m.avatar,
      isLive: true,
      audioOnly: true,
      radioRefresh: { member: m, mode },
      backTo: {
        screen: 'RoomRadioScreen',
        mode: 'live',
        playUrl: url,
        playTitle: title,
        playCover: m.avatar,
        radioMember: m,
        radioMode: mode,
      },
    });
    navigation.goBack();
  };

  const subtitle =
    audioOnly && playing
      ? `${t('纯音频')} · ${t('正在播放')}`
      : muted
        ? t('已静音')
        : playing
          ? t('正在播放')
          : status || t('暂无电台地址');

  const routeMember = route.params?.member;
  const routeMode = route.params?.initialMode || 'big';
  const routeUrl = route.params?.streamUrl || '';
  const paramKey = routeMember ? `${String(routeMember.id || '')}|${routeMode}|${routeUrl}` : '';

  useEffect(() => {
    if (!routeMember || !paramKey || lastParamKeyRef.current === paramKey) return;
    lastParamKeyRef.current = paramKey;
    startRadio(routeMember, { instantUrl: routeUrl, mode: routeMode });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramKey]);

  useEffect(() => {
    const offFocusAudio = registerAudioHandler('radio', (reason) => {
      if (reason === 'reset') {
        lastParamKeyRef.current = '';
      }
      if (!handedOffToCapsuleRef.current) {
        stopRadio();
      }
    });
    const offStop = onRadioStopRequested(() => {
      if (handedOffToCapsuleRef.current) return;
      if (playingRef.current || radioUrlRef.current || ownsForegroundRef.current) {
        stopRadio();
      }
    });
    const offCtrl = onRadioControlRequested((action) => {
      if (handedOffToCapsuleRef.current) return;
      if (!playingRef.current && !radioUrlRef.current && !ownsForegroundRef.current) return;
      if (action === 'stop') stopRadio();
      else if (action === 'play_pause') toggleRadioPlaying();
      else if (action === 'play' && !playingRef.current) toggleRadioPlaying();
      else if (action === 'pause' && playingRef.current) toggleRadioPlaying();
    });
    return () => {
      offFocusAudio();
      offStop();
      offCtrl();
      if (refreshTimer.current) {
        clearInterval(refreshTimer.current);
        refreshTimer.current = null;
      }
      if (!handedOffToCapsuleRef.current && ownsForegroundRef.current) {
        ownsForegroundRef.current = false;
        setRadioForegroundActive(false);
        stopRadioForeground();
        releaseAudioFocus('radio');
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const lowerRadioUrl = radioUrl.toLowerCase();
  const useNativeLiveExo =
    (isRtmpUrl(lowerRadioUrl) || lowerRadioUrl.includes('.flv')) &&
    Platform.OS === 'android' &&
    !!LiveExoView;

  return (
    <View style={styles.container}>
      <ScreenHeader title={t('房间电台')} />

      <View style={{ flex: 1 }}>
        <View style={styles.pickerWrap}>
          <MemberPicker
            compact
            selectedMember={selectedMember}
            onSelect={(m) => startRadio(m)}
            activeOnly
            placeholder={t('选择成员获取上麦音频...')}
          />
          <View style={styles.modeRow}>
            <Pill
              label={t('大房间')}
              selected={roomMode === 'big'}
              onPress={() => {
                setRoomMode('big');
                if (selectedMember) startRadio(selectedMember, { mode: 'big' });
              }}
            />
            <Pill
              label={t('小房间')}
              selected={roomMode === 'small'}
              onPress={() => {
                setRoomMode('small');
                if (selectedMember) startRadio(selectedMember, { mode: 'small' });
              }}
            />
            <View style={styles.modeDivider} />
            <Pill
              label={t('纯音频')}
              selected={audioOnly}
              onPress={() => {
                const next = !audioOnly;
                setAudioOnly(next);
                logWarn(
                  `[radio] ${selectedMember?.ownerName || ''} 切换${next ? '纯音频模式(无画面)' : '视频模式(渲染画面)'}`,
                );
              }}
            />
          </View>
        </View>

        {status && !loading ? (
          <View style={styles.statusWrap}>
            <View
              style={[
                styles.statusCapsule,
                {
                  backgroundColor: loadError ? 'rgba(255,59,48,0.12)' : palette.tintSoft,
                },
              ]}
            >
              <MaterialCommunityIcons
                name={loadError ? 'alert-circle-outline' : 'radio'}
                size={13}
                color={loadError ? palette.danger : palette.tint}
                style={{ marginRight: 4 }}
              />
              <Text
                style={[styles.statusText, { color: loadError ? palette.danger : palette.tint }]}
              >
                {status}
              </Text>
            </View>
          </View>
        ) : null}

        <View style={styles.scroll}>
          <GlassSurface
            radius={22}
            role="card"
            style={[
              styles.playerCard,
              { backgroundColor: 'transparent', borderColor: palette.hairline },
              shadows.sm,
            ]}
          >
            {selectedMember ? (
              <View style={styles.coverWrap}>
                {audioOnly && playing ? (
                  <Animated.View
                    pointerEvents="none"
                    style={[
                      styles.spinRing,
                      { borderColor: palette.tint, transform: [{ rotate: spinRotate }] },
                    ]}
                  />
                ) : null}
                <NetworkImage
                  source={{ uri: selectedMember.avatar }}
                  style={[styles.cover, { backgroundColor: palette.fill3 }]}
                  resizeMode="cover"
                />
                {audioOnly && playing ? (
                  <View style={[styles.audioBadge, { backgroundColor: palette.tint }]}>
                    <MaterialCommunityIcons name="headphones" size={12} color={palette.onTint} />
                    <Text style={[styles.audioBadgeText, { color: palette.onTint }]}>
                      {t('纯音频')}
                    </Text>
                  </View>
                ) : null}
              </View>
            ) : (
              <View
                style={[
                  styles.cover,
                  styles.coverPlaceholder,
                  { backgroundColor: palette.tintSoft },
                ]}
              >
                <MaterialCommunityIcons name="radio" size={44} color={palette.tint} />
              </View>
            )}

            <Text style={[styles.playerTitle, { color: palette.label }]} numberOfLines={1}>
              {selectedMember?.ownerName || t('选择成员')}
            </Text>
            <Text style={[styles.subtitle, { color: palette.labelSecondary }]} numberOfLines={1}>
              {subtitle}
            </Text>

            {loading ? (
              <View style={styles.inlineLoading}>
                <CenterSpinner text={t('正在获取电台地址…')} />
              </View>
            ) : null}

            {!loading && loadError ? (
              <ErrorState
                title={t('获取失败')}
                hint={loadError}
                onAction={() => selectedMember && startRadio(selectedMember)}
                style={styles.inlineError}
              />
            ) : null}

            {!loading && !loadError && !selectedMember ? (
              <EmptyState
                icon="broadcast"
                title={t('搜索并选择成员')}
                hint={t('选择成员获取房间上麦音频')}
                style={styles.inlineEmpty}
              />
            ) : null}

            {!loading && !loadError && selectedMember && !radioUrl ? (
              <ScalePressable
                onPress={() => startRadio(selectedMember!)}
                pressedScale={0.96}
                style={[styles.fetchBtn, { backgroundColor: palette.tint }]}
                activeOpacity={0.85}
              >
                <MaterialCommunityIcons
                  name="play"
                  size={20}
                  color={palette.onTint}
                  style={{ marginRight: 6 }}
                />
                <Text style={[styles.fetchBtnText, { color: palette.onTint }]}>
                  {t('开始播放')}
                </Text>
              </ScalePressable>
            ) : null}

            {radioUrl ? (
              <>
                <View style={styles.controlsRow}>
                  <ScalePressable
                    onPress={toggleRadioPlaying}
                    pressedScale={0.9}
                    style={[styles.primaryCtrl, { backgroundColor: palette.tint, ...shadows.sm }]}
                    activeOpacity={0.8}
                    accessibilityRole="button"
                  >
                    <MaterialCommunityIcons
                      name={playing ? 'pause' : 'play'}
                      size={26}
                      color={palette.onTint}
                    />
                  </ScalePressable>
                  <ScalePressable
                    onPress={() => startRadio(selectedMember!)}
                    pressedScale={0.9}
                    style={[styles.secondaryCtrl, { backgroundColor: palette.fill2 }]}
                    activeOpacity={0.7}
                  >
                    <MaterialCommunityIcons name="replay" size={20} color={palette.label} />
                    <Text style={[styles.secondaryCtrlText, { color: palette.label }]}>
                      {t('重播')}
                    </Text>
                  </ScalePressable>
                  <ScalePressable
                    onPress={() => setMuted((v) => !v)}
                    pressedScale={0.9}
                    style={[styles.secondaryCtrl, { backgroundColor: palette.fill2 }]}
                    activeOpacity={0.7}
                  >
                    <MaterialCommunityIcons
                      name={muted ? 'volume-off' : 'volume-high'}
                      size={20}
                      color={palette.label}
                    />
                    <Text style={[styles.secondaryCtrlText, { color: palette.label }]}>
                      {muted ? t('已静音') : t('静音')}
                    </Text>
                  </ScalePressable>
                  <ScalePressable
                    onPress={stopRadio}
                    pressedScale={0.9}
                    style={[styles.secondaryCtrl, { backgroundColor: palette.fill2 }]}
                    activeOpacity={0.7}
                  >
                    <MaterialCommunityIcons name="stop" size={20} color={palette.label} />
                    <Text style={[styles.secondaryCtrlText, { color: palette.label }]}>
                      {t('停止')}
                    </Text>
                  </ScalePressable>

                  <ScalePressable
                    onPress={toCapsule}
                    pressedScale={0.9}
                    style={[styles.secondaryCtrl, { backgroundColor: palette.tintSoft }]}
                    activeOpacity={0.7}
                  >
                    <MaterialCommunityIcons name="microphone" size={20} color={palette.tint} />
                    <Text style={[styles.secondaryCtrlText, { color: palette.tint }]}>
                      {t('胶囊')}
                    </Text>
                  </ScalePressable>
                </View>
                {playing ? (
                  useNativeLiveExo && LiveExoView ? (
                    <LiveExoView
                      style={styles.hiddenPlayer}
                      url={radioUrl}
                      audioOnly={audioOnly}
                      paused={!playing || muted}
                      key={`${radioUrl}|${audioOnly ? 'a' : 'v'}`}
                      onSize={() => {
                        setStatus(t('正在播放'));
                      }}
                      onError={(e: any) =>
                        handlePlaybackError(String(e?.nativeEvent?.message || 'playback error'))
                      }
                    />
                  ) : (
                    <Video
                      source={{ uri: radioUrl }}
                      style={styles.hiddenPlayer}
                      paused={!playing}
                      muted={muted}
                      controls={false}
                      ignoreSilentSwitch="ignore"
                      playInBackground
                      playWhenInactive
                      onLoad={() => setStatus(t('正在播放'))}
                      onError={(e: any) => handlePlaybackError(JSON.stringify(e?.error || e))}
                      onEnd={() => {
                        setStatus(t('上麦已结束'));
                        setPlaying(false);
                        setRadioForegroundActive(false);
                        releaseAudioFocus('radio');
                      }}
                    />
                  )
                ) : null}
              </>
            ) : null}
          </GlassSurface>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  pickerWrap: { padding: 16, paddingBottom: 4 },
  modeRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
  },
  modeDivider: {
    width: StyleSheet.hairlineWidth,
    height: 20,
    backgroundColor: 'rgba(127,127,127,0.35)',
  },
  statusWrap: { alignItems: 'center', paddingVertical: 6 },
  statusCapsule: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  statusText: { fontSize: 12, fontFamily: fontFamily.system, fontWeight: '600' },
  scroll: { flex: 1, paddingHorizontal: 16, paddingTop: 8 },
  playerCard: {
    borderRadius: 22,
    borderCurve: 'continuous',
    padding: 24,
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  cover: { width: 120, height: 120, borderRadius: 14, borderCurve: 'continuous', marginTop: 8 },
  coverPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  coverWrap: { alignItems: 'center', justifyContent: 'center' },
  spinRing: {
    position: 'absolute',
    width: 132,
    height: 132,
    borderRadius: 18,
    borderCurve: 'continuous',
    borderWidth: 2,
    marginTop: 8,
  },
  audioBadge: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    left: 0,
    bottom: -6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  audioBadgeText: { fontSize: 10, fontFamily: fontFamily.system, fontWeight: '700' },
  playerTitle: { fontSize: 18, fontWeight: '700', marginTop: 16 },
  subtitle: { fontSize: 12, marginTop: 6, textAlign: 'center' },
  inlineLoading: { minHeight: 88 },
  inlineError: { paddingVertical: 20 },
  inlineEmpty: { paddingVertical: 20 },
  fetchBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 26,
    paddingVertical: 11,
    borderRadius: 999,
    marginTop: 18,
  },
  fetchBtnText: { fontSize: 15, fontFamily: fontFamily.system, fontWeight: '700' },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 22,
  },
  primaryCtrl: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryCtrl: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    width: 56,
    height: 40,
    borderRadius: 20,
  },
  secondaryCtrlText: { fontSize: 11, fontFamily: fontFamily.system, fontWeight: '600' },
  hiddenPlayer: { position: 'absolute', width: 1, height: 1, opacity: 0 },
});

export function RoomRadioSkeleton() {
  const palette = usePalette();
  return (
    <View style={{ padding: 16 }}>
      <Skeleton width="100%" height={40} radius={20} />
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 8, marginTop: 12 }}>
        <Skeleton width={80} height={32} radius={999} />
        <Skeleton width={80} height={32} radius={999} />
      </View>
      <View style={{ marginTop: 16, alignItems: 'center' }}>
        <GlassSurface
          radius={22}
          role="card"
          frostedOnly
          style={{
            backgroundColor: 'transparent',
            borderColor: palette.innerStroke,
            padding: 24,
            width: '100%',
            alignItems: 'center',
          }}
        >
          <Skeleton width={120} height={120} radius={20} />
          <Skeleton width="40%" height={18} style={{ marginTop: 16 }} />
          <Skeleton width="25%" height={12} style={{ marginTop: 8 }} />
        </GlassSurface>
      </View>
    </View>
  );
}
