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
import { errorMessage, pickText } from '../utils/data';
import pocketApi from '../api/pocket48';
import { resolveMemberRooms } from '../services/roomMapCache';
import { useMemberStore } from '../store';
import { useMusicPlayerStore } from '../store/musicPlayerStore';
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
  const roomModeRef = useRef<'big' | 'small'>(roomMode);
  const playingRef = useRef(false);
  const fetchingRef = useRef(false);

  const startReqRef = useRef(0);
  const refreshTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  roomModeRef.current = roomMode;
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

  const fetchRadioUrl = async (member: Member, mode: 'big' | 'small'): Promise<string | null> => {
    let channelId = mode === 'small' ? member.yklzId || member.channelId : member.channelId;
    let serverId = member.serverId;

    const needResolve =
      !channelId ||
      channelId === '0' ||
      channelId === 'undefined' ||
      (mode === 'small' &&
        (!member.yklzId || member.yklzId === '0' || member.yklzId === 'undefined'));
    if (needResolve) {
      const room = await resolveMemberRooms(String(member.id || ''), {
        name: member.ownerName,
        knownChannelId: member.channelId,
        knownYklzId: member.yklzId,
        knownServerId: member.serverId,
      });
      channelId = mode === 'small' ? room.yklzId || room.channelId : room.channelId;
      serverId = room.serverId || member.serverId;
      if (channelId) {
        useMemberStore.getState().patchMemberByUserId(String(member.id || ''), {
          channelId: room.channelId || member.channelId,
          yklzId: room.yklzId || member.yklzId,
          serverId,
        });
      }
    }
    if (!channelId || channelId === '0' || channelId === 'undefined') {
      const err: any = new Error('NO_CHANNEL');
      err.code = 'NO_CHANNEL';
      throw err;
    }
    const res = await pocketApi.operateRoomVoice({ channelId, serverId });
    if (res?.status && Number(res.status) !== 200) return null;
    const url = pickText(res, [
      'content.streamUrl',
      'content.url',
      'content.streamPath',
      'content.playUrl',
      'data.streamUrl',
      'data.url',
      'streamUrl',
      'url',
    ]);
    return url || null;
  };

  const applyStreamUrl = (url: string, member: Member, mode: 'big' | 'small') => {
    if (__DEV__) logWarn(`[radio] ${member.ownerName} ${mode} (rtmp=${isRtmpUrl(url)})`);

    try {
      const mst = useMusicPlayerStore.getState();
      if (
        mst.queue.length &&
        (mst.playbackState === 'playing' ||
          mst.playbackState === 'paused' ||
          mst.playbackState === 'loading')
      ) {
        mst.setPlaybackState(mst.playbackState === 'loading' ? 'idle' : 'paused');
      }
    } catch {}
    setRadioUrl(url);
    setStatus(t('已连接，正在缓冲...'));
    setPlaying(true);

    ensureNotificationPermission()
      .then(() => startRadioForeground(member.ownerName || '', true))
      .catch(() => {});
  };

  const scheduleStreamRefresh = () => {
    if (refreshTimer.current) return;
    refreshTimer.current = setInterval(
      () => {
        const m = selectedMemberRef.current;
        if (!m || !playingRef.current || fetchingRef.current) return;
        fetchingRef.current = true;
        fetchRadioUrl(m, roomModeRef.current)
          .then((fresh) => {
            if (!playingRef.current) return;
            if (fresh) {
              setRadioUrl((cur) => (cur && cur === fresh ? cur : fresh));
              logWarn(`[radio] ${m.ownerName} 自动换流${fresh ? '' : ''}`);
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
    try {
      useMiniPlayerStore.getState().close();
    } catch {}

    const mode = opts.mode ?? roomModeRef.current;
    const reqId = startReqRef.current + 1;
    startReqRef.current = reqId;
    setSelectedMember(member);

    selectedMemberRef.current = member;
    roomModeRef.current = mode;
    setLoading(true);
    setStatus(t('获取电台地址...'));
    setLoadError('');

    if (opts.instantUrl) {
      applyStreamUrl(opts.instantUrl, member, mode);
      scheduleStreamRefresh();
      setLoading(false);

      fetchingRef.current = true;
      fetchRadioUrl(member, mode)
        .then((fresh) => {
          if (reqId !== startReqRef.current || !playingRef.current) return;
          if (fresh) setRadioUrl((cur) => (cur && cur === fresh ? cur : fresh));
          else logWarn(`[radio] ${member.ownerName} 校验未拿到新流（秒开继续播放）`);
        })
        .catch(() => {})
        .finally(() => {
          fetchingRef.current = false;
        });
      return;
    }
    setRadioUrl('');
    setPlaying(false);
    try {
      const url = await fetchRadioUrl(member, mode);

      if (reqId !== startReqRef.current) return;
      const current = selectedMemberRef.current;
      if (!current || String(current.id) !== String(member.id) || roomModeRef.current !== mode)
        return;
      if (url) {
        applyStreamUrl(url, member, mode);
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
    setStatus(t('已停止'));
    stopRadioForeground();
  };

  const toCapsule = () => {
    const m = selectedMember;
    const url = radioUrl;
    if (!m || !url) return;
    const title = `${m.ownerName || ''} · ${t('上麦')}`;
    useMiniPlayerStore.getState().open({
      url,
      title,
      cover: m.avatar,
      isLive: true,
      audioOnly: true,
      backTo: { mode: 'live', playUrl: url, playTitle: title, playCover: m.avatar },
    });
    stopRadio();
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

  const autoStartedRef = useRef(false);
  useEffect(() => {
    const m = route.params?.member;
    if (m && !autoStartedRef.current) {
      autoStartedRef.current = true;
      startRadio(m, { instantUrl: route.params?.streamUrl || '' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const offStop = onRadioStopRequested(() => stopRadio());
    const offCtrl = onRadioControlRequested((action) => {
      if (action === 'stop') stopRadio();
      else if (action === 'play_pause') {
        setPlaying((p) => !p);
      }
    });
    return () => {
      offStop();
      offCtrl();

      if (refreshTimer.current) {
        clearInterval(refreshTimer.current);
        refreshTimer.current = null;
      }
      stopRadioForeground();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={styles.container}>
      <ScreenHeader title={t('房间电台')} />

      <View style={{ flex: 1 }}>
        <View style={styles.pickerWrap}>
          <MemberPicker
            compact
            selectedMember={selectedMember}
            onSelect={startRadio}
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
                    onPress={playing ? () => setPlaying(false) : () => setPlaying(true)}
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
                  isRtmpUrl(radioUrl) && Platform.OS === 'android' && LiveExoView ? (
                    <LiveExoView
                      style={styles.hiddenPlayer}
                      url={radioUrl}
                      audioOnly={audioOnly}
                      key={`${radioUrl}|${audioOnly ? 'a' : 'v'}`}
                      onSize={() => {}}
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
                      onError={(e: any) =>
                        setStatus(
                          t('播放失败：{error}', {
                            error: JSON.stringify(e?.error || e).slice(0, 120),
                          }),
                        )
                      }
                      onEnd={() => {
                        setStatus(t('上麦已结束'));
                        setPlaying(false);
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
