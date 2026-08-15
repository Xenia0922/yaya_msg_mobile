import React, { useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
} from 'react-native';
import Video from 'react-native-video';
import { useNavigation } from '@react-navigation/native';
import { useSettingsStore } from '../store';
import { Member } from '../types';
import MemberPicker from '../components/MemberPicker';
import ScreenHeader from '../components/ScreenHeader';
import { useI18n } from '../i18n';
import { FadeInView } from '../components/Motion';
import { errorMessage, pickText } from '../utils/data';
import pocketApi from '../api/pocket48';
import { useAppTheme } from '../hooks/useAppTheme';
import { usePalette } from '../theme';

export default function RoomRadioScreen() {
  const navigation = useNavigation();
  const isDark = useAppTheme();
  const palette = usePalette();
  const { t } = useI18n();
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [radioUrl, setRadioUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [roomMode, setRoomMode] = useState<'big' | 'small'>('big');
  const playerRef = useRef<any>(null);
  const startRadio = async (member: Member) => {
    setSelectedMember(member);
    setLoading(true);
    setStatus(t('获取电台地址...'));
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

  return (
    <View style={[styles.container, isDark && styles.containerDark]}>
      <ScreenHeader title={t('房间电台')} />
      <FadeInView delay={80} duration={300}>
        <View style={styles.pickerWrap}>
          <MemberPicker selectedMember={selectedMember} onSelect={startRadio} placeholder={t('选择成员获取上麦音频...')} />
          <View style={styles.modeRow}>
            <TouchableOpacity style={[styles.modePill, { backgroundColor: roomMode === 'big' ? palette.tint : palette.fill2 }]} onPress={() => { setRoomMode('big'); if (selectedMember) startRadio(selectedMember); }}>
              <Text style={[styles.modePillText, { color: roomMode === 'big' ? '#FFFFFF' : palette.labelSecondary }]}>{t('大房间')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.modePill, { backgroundColor: roomMode === 'small' ? palette.tint : palette.fill2 }]} onPress={() => { setRoomMode('small'); if (selectedMember) startRadio(selectedMember); }}>
              <Text style={[styles.modePillText, { color: roomMode === 'small' ? '#FFFFFF' : palette.labelSecondary }]}>{t('小房间')}</Text>
            </TouchableOpacity>
          </View>
        </View>
        <View style={[styles.playerCard, { backgroundColor: palette.surface, borderColor: palette.hairline }]}>
          <Text style={[styles.playerTitle, { color: palette.label }]}>{selectedMember?.ownerName || t('暂无数据')}</Text>
          <Text style={[styles.playerStatus, { color: palette.labelSecondary }]}>{loading ? '' : status || t('暂无电台地址')}</Text>

          {radioUrl ? (
            <>
              <View style={styles.controlsRow}>
                <TouchableOpacity style={[styles.ctrlBtn, { backgroundColor: palette.tint }]} onPress={playing ? stopRadio : () => setPlaying(true)}>
                  <Text style={styles.ctrlBtnText}>{playing ? t('停止') : t('播放')}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.ctrlBtn, styles.ctrlBtnGhost, { backgroundColor: palette.fill2 }]} onPress={() => setMuted(v => !v)}>
                  <Text style={[styles.ctrlBtnGhostText, { color: palette.label }]}>{muted ? t('已静音') : t('静音')}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.ctrlBtn, styles.ctrlBtnGhost, { backgroundColor: palette.fill2 }]} onPress={() => startRadio(selectedMember!)}>
                  <Text style={[styles.ctrlBtnGhostText, { color: palette.label }]}>{t('刷新')}</Text>
                </TouchableOpacity>
              </View>
              {playing ? (
                <Video
                  ref={playerRef}
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
          ) : selectedMember ? (
            <TouchableOpacity style={[styles.playBtn, { backgroundColor: palette.tint }]} onPress={() => startRadio(selectedMember)}>
              <Text style={styles.playBtnText}>{t('刷新')}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </FadeInView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  containerDark: { backgroundColor: 'transparent' },
  pickerWrap: { padding: 16 },
  playerCard: { margin: 16, padding: 20, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center' },
  playerTitle: { fontSize: 18, fontWeight: '700', marginBottom: 8 },
  playerStatus: { fontSize: 13, marginBottom: 16, textAlign: 'center' },
  controlsRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  ctrlBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 18 },
  ctrlBtnGhost: {},
  ctrlBtnText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  ctrlBtnGhostText: { fontWeight: '700', fontSize: 13 },
  playBtn: { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 18 },
  playBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  modeRow: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginTop: 12 },
  modePill: { paddingHorizontal: 16, paddingVertical: 6, borderRadius: 14 },
  modePillText: { fontSize: 12, fontWeight: '700' },
  hiddenPlayer: { position: 'absolute', width: 1, height: 1, opacity: 0 },
});
