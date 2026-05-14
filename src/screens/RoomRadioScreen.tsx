import React, { useState, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
} from 'react-native';
import Video from 'react-native-video';
import { useNavigation } from '@react-navigation/native';
import { useSettingsStore } from '../store';
import { Member } from '../types';
import MemberPicker from '../components/MemberPicker';
import ScreenHeader from '../components/ScreenHeader';
import { FadeInView } from '../components/Motion';
import { errorMessage, pickText } from '../utils/data';
import pocketApi from '../api/pocket48';

export default function RoomRadioScreen() {
  const navigation = useNavigation();
  const isDark = useSettingsStore((state) => state.settings.theme === 'dark');
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
    setStatus('获取电台地址...');
    setRadioUrl('');
    setPlaying(false);
    try {
      const channelId = roomMode === 'small' ? (member.yklzId || member.channelId) : member.channelId;
      const res = await pocketApi.operateRoomVoice({ channelId, serverId: member.serverId });
      const url = pickText(res, ['content.streamUrl', 'content.url', 'content.streamPath', 'content.playUrl', 'data.streamUrl', 'data.url', 'streamUrl', 'url']);
      if (url) {
        setRadioUrl(url);
        setStatus('已连接，正在缓冲...');
        setPlaying(true);
      } else {
        setStatus('该房间当前没有开启语音电台');
      }
    } catch (error) {
      setStatus(`获取失败：${errorMessage(error)}`);
    } finally {
      setLoading(false);
    }
  };

  const stopRadio = () => {
    setPlaying(false);
    setRadioUrl('');
    setStatus('已停止');
  };

  return (
    <View style={[styles.container, isDark && styles.containerDark]}>
      <ScreenHeader title="房间电台" />
      <FadeInView delay={80} duration={300}>
        <View style={styles.pickerWrap}>
          <MemberPicker selectedMember={selectedMember} onSelect={startRadio} placeholder="选择成员获取上麦音频..." />
          <View style={styles.modeRow}>
            <TouchableOpacity style={[styles.modePill, roomMode === 'big' && styles.modePillActive]} onPress={() => { setRoomMode('big'); if (selectedMember) startRadio(selectedMember); }}>
              <Text style={[styles.modePillText, roomMode === 'big' && styles.modePillTextActive]}>大房间</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.modePill, roomMode === 'small' && styles.modePillActive]} onPress={() => { setRoomMode('small'); if (selectedMember) startRadio(selectedMember); }}>
              <Text style={[styles.modePillText, roomMode === 'small' && styles.modePillTextActive]}>小房间</Text>
            </TouchableOpacity>
          </View>
        </View>
        <View style={[styles.playerCard, isDark && styles.playerCardDark]}>
          <Text style={[styles.playerTitle, isDark && styles.textDark]}>{selectedMember?.ownerName || '暂无数据'}</Text>
          <Text style={[styles.playerStatus, isDark && styles.textSubDark]}>{loading ? '加载中...' : status || '暂无电台地址'}</Text>

          {radioUrl ? (
            <>
              <View style={styles.controlsRow}>
                <TouchableOpacity style={styles.ctrlBtn} onPress={playing ? stopRadio : () => setPlaying(true)}>
                  <Text style={styles.ctrlBtnText}>{playing ? '停止' : '播放'}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.ctrlBtn, styles.ctrlBtnGhost]} onPress={() => setMuted(v => !v)}>
                  <Text style={[styles.ctrlBtnGhostText, isDark && { color: '#ddd' }]}>{muted ? '已静音' : '静音'}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.ctrlBtn, styles.ctrlBtnGhost]} onPress={() => startRadio(selectedMember!)}>
                  <Text style={[styles.ctrlBtnGhostText, isDark && { color: '#ddd' }]}>刷新</Text>
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
                  onLoad={() => setStatus('正在播放')}
                  onError={(e: any) => setStatus(`播放失败：${JSON.stringify(e?.error || e).slice(0, 120)}`)}
                  onEnd={() => { setStatus('上麦已结束'); setPlaying(false); }}
                />
              ) : null}
            </>
          ) : selectedMember ? (
            <TouchableOpacity style={styles.playBtn} onPress={() => startRadio(selectedMember)}>
              <Text style={styles.playBtnText}>刷新</Text>
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
  playerCard: { margin: 16, padding: 20, backgroundColor: 'rgba(255,255,255,0.46)', borderRadius: 18, alignItems: 'center' },
  playerCardDark: { backgroundColor: 'rgba(20,20,20,0.58)' },
  playerTitle: { fontSize: 18, fontWeight: '600', color: '#333', marginBottom: 8 },
  playerStatus: { fontSize: 13, color: '#333333', marginBottom: 16, textAlign: 'center' },
  controlsRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  ctrlBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 18, backgroundColor: '#ff6f91' },
  ctrlBtnGhost: { backgroundColor: 'rgba(0,0,0,0.06)' },
  ctrlBtnText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  ctrlBtnGhostText: { color: '#555', fontWeight: '700', fontSize: 13 },
  playBtn: { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 18, backgroundColor: '#ff6f91' },
  playBtnText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  fontStyle: { fontStyle: 'italic' },
  modeRow: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginTop: 12 },
  modePill: { paddingHorizontal: 16, paddingVertical: 6, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.06)' },
  modePillActive: { backgroundColor: '#ff6f91' },
  modePillText: { fontSize: 12, color: '#555', fontWeight: '700' },
  modePillTextActive: { color: '#fff' },
  hiddenPlayer: { position: 'absolute', width: 1, height: 1, opacity: 0 },
  textDark: { color: '#eee' },
  textSubDark: { color: '#eeeeee' },
});
