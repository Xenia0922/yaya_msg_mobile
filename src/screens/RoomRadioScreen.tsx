import React, { useState } from 'react';
import {
  View, Text, StyleSheet,
} from 'react-native';
import Video from 'react-native-video';
import { Member } from '../types';
import MemberPicker from '../components/MemberPicker';
import ScreenHeader from '../components/ScreenHeader';
import { useI18n } from '../i18n';
import { FadeInView, ScalePressable } from '../components/Motion';
import { CenterSpinner } from '../components/Loaders';
import { EmptyState, ErrorState } from '../components/StateViews';
import { Pill } from '../components/Pill';
import { NetworkImage } from '../components/NetworkImage';
import { Skeleton } from '../components/Skeleton';
import { errorMessage, pickText } from '../utils/data';
import pocketApi from '../api/pocket48';
import { usePalette, makeShadows } from '../theme';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';

export default function RoomRadioScreen() {
  const palette = usePalette();
  const shadows = makeShadows(palette.name === 'dark');
  const { t } = useI18n();
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [radioUrl, setRadioUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [loadError, setLoadError] = useState('');
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [roomMode, setRoomMode] = useState<'big' | 'small'>('big');
  const startRadio = async (member: Member) => {
    setSelectedMember(member);
    setLoading(true);
    setStatus(t('获取电台地址...'));
    setLoadError('');
    setRadioUrl('');
    setPlaying(false);
    try {
      const channelId = roomMode === 'small' ? (member.yklzId || member.channelId) : member.channelId;
      const res = await pocketApi.operateRoomVoice({ channelId, serverId: member.serverId });
      const url = pickText(res, ['content.streamUrl', 'content.url', 'content.streamPath', 'content.playUrl', 'data.streamUrl', 'data.url', 'streamUrl', 'url']);
      if (url) {
        setRadioUrl(url);
        setStatus(t('已连接，正在缓冲...'));
        setPlaying(true);
      } else {
        setStatus(t('该房间当前没有开启语音电台'));
      }
    } catch (error) {
      setLoadError(errorMessage(error));
      setStatus(t('获取失败：{error}', { error: errorMessage(error) }));
    } finally {
      setLoading(false);
    }
  };

  const stopRadio = () => {
    setPlaying(false);
    setRadioUrl('');
    setStatus(t('已停止'));
  };

  const subtitle = muted ? t('已静音') : (playing ? t('正在播放') : (status || t('暂无电台地址')));

  return (
    <View style={styles.container}>
      <ScreenHeader title={t('房间电台')} />

      <FadeInView delay={60} duration={360} style={{ flex: 1 }}>
        <View style={styles.pickerWrap}>
          <MemberPicker selectedMember={selectedMember} onSelect={startRadio} placeholder={t('选择成员获取上麦音频...')} />
          <View style={styles.modeRow}>
            <Pill
              label={t('大房间')}
              selected={roomMode === 'big'}
              onPress={() => { setRoomMode('big'); if (selectedMember) startRadio(selectedMember); }}
            />
            <Pill
              label={t('小房间')}
              selected={roomMode === 'small'}
              onPress={() => { setRoomMode('small'); if (selectedMember) startRadio(selectedMember); }}
            />
          </View>
        </View>

        {/* 状态胶囊条：加载中 / 失败 */}
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
              <Text style={[styles.statusText, { color: loadError ? palette.danger : palette.tint }]}>{status}</Text>
            </View>
          </View>
        ) : null}

        <View style={styles.scroll}>
          {/* 播放器大卡 */}
          <View style={[styles.playerCard, { backgroundColor: palette.surface, borderColor: palette.hairline }, shadows.sm]}>
            {/* 封面 120 圆角 20 居中 */}
            {selectedMember ? (
              <NetworkImage
                source={{ uri: selectedMember.avatar }}
                style={[styles.cover, { backgroundColor: palette.fill3 }]}
                resizeMode="cover"
              />
            ) : (
              <View style={[styles.cover, styles.coverPlaceholder, { backgroundColor: palette.tintSoft }]}>
                <MaterialCommunityIcons name="radio" size={44} color={palette.tint} />
              </View>
            )}

            <Text style={[styles.playerTitle, { color: palette.label }]} numberOfLines={1}>
              {selectedMember?.ownerName || t('选择成员')}
            </Text>
            <Text style={[styles.subtitle, { color: palette.labelSecondary }]} numberOfLines={1}>{subtitle}</Text>

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
              <EmptyState icon="broadcast" title={t('搜索并选择成员')} hint={t('选择成员获取房间上麦音频')} style={styles.inlineEmpty} />
            ) : null}

            {!loading && !loadError && selectedMember && !radioUrl ? (
              <ScalePressable
                onPress={() => startRadio(selectedMember!)}
                pressedScale={0.96}
                style={[styles.fetchBtn, { backgroundColor: palette.tint }]}
                activeOpacity={0.85}
              >
                <MaterialCommunityIcons name="play" size={20} color={palette.onTint} style={{ marginRight: 6 }} />
                <Text style={[styles.fetchBtnText, { color: palette.onTint }]}>{t('开始播放')}</Text>
              </ScalePressable>
            ) : null}

            {radioUrl ? (
              <>
                {/* 控制行：播放/暂停 56 tint 底白字 + 停止/重播 36 fill2 底 */}
                <View style={styles.controlsRow}>
                  <ScalePressable
                    onPress={playing ? stopRadio : () => setPlaying(true)}
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
                    <Text style={[styles.secondaryCtrlText, { color: palette.label }]}>{t('重播')}</Text>
                  </ScalePressable>
                  <ScalePressable
                    onPress={() => setMuted(v => !v)}
                    pressedScale={0.9}
                    style={[styles.secondaryCtrl, { backgroundColor: palette.fill2 }]}
                    activeOpacity={0.7}
                  >
                    <MaterialCommunityIcons name={muted ? 'volume-off' : 'volume-high'} size={20} color={palette.label} />
                    <Text style={[styles.secondaryCtrlText, { color: palette.label }]}>{muted ? t('已静音') : t('静音')}</Text>
                  </ScalePressable>
                  <ScalePressable
                    onPress={stopRadio}
                    pressedScale={0.9}
                    style={[styles.secondaryCtrl, { backgroundColor: palette.fill2 }]}
                    activeOpacity={0.7}
                  >
                    <MaterialCommunityIcons name="stop" size={20} color={palette.label} />
                    <Text style={[styles.secondaryCtrlText, { color: palette.label }]}>{t('停止')}</Text>
                  </ScalePressable>
                </View>
                {playing ? (
                  <Video
                    source={{ uri: radioUrl }}
                    style={styles.hiddenPlayer}
                    paused={!playing}
                    muted={muted}
                    controls={false}
                    ignoreSilentSwitch="ignore"
                    onLoad={() => setStatus(t('正在播放'))}
                    onError={(e: any) => setStatus(t('播放失败：{error}', { error: JSON.stringify(e?.error || e).slice(0, 120) }))}
                    onEnd={() => { setStatus(t('上麦已结束')); setPlaying(false); }}
                  />
                ) : null}
              </>
            ) : null}
          </View>
        </View>
      </FadeInView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  pickerWrap: { padding: 16, paddingBottom: 4 },
  modeRow: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginTop: 12 },
  statusWrap: { alignItems: 'center', paddingVertical: 6 },
  statusCapsule: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  statusText: { fontSize: 12, fontWeight: '600' },
  scroll: { flex: 1, paddingHorizontal: 16, paddingTop: 8 },
  playerCard: {
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  cover: { width: 120, height: 120, borderRadius: 20, marginTop: 8 },
  coverPlaceholder: { alignItems: 'center', justifyContent: 'center' },
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
  fetchBtnText: { fontSize: 15, fontWeight: '700' },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
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
    width: 60,
    height: 40,
    borderRadius: 20,
  },
  secondaryCtrlText: { fontSize: 11, fontWeight: '600' },
  hiddenPlayer: { position: 'absolute', width: 1, height: 1, opacity: 0 },
});

export function RoomRadioSkeleton() {
  const palette = usePalette();
  return (
    <View style={{ padding: 16 }}>
      <Skeleton width="100%" height={40} radius={14} />
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 8, marginTop: 12 }}>
        <Skeleton width={80} height={32} radius={999} />
        <Skeleton width={80} height={32} radius={999} />
      </View>
      <View style={{ marginTop: 16, alignItems: 'center' }}>
        <View style={{ backgroundColor: palette.surface, borderRadius: 20, padding: 24, width: '100%', alignItems: 'center' }}>
          <Skeleton width={120} height={120} radius={20} />
          <Skeleton width="40%" height={18} style={{ marginTop: 16 }} />
          <Skeleton width="25%" height={12} style={{ marginTop: 8 }} />
        </View>
      </View>
    </View>
  );
}
