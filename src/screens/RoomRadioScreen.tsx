import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSettingsStore } from '../store';
import { Member } from '../types';
import MemberPicker from '../components/MemberPicker';
import { errorMessage, pickText } from '../utils/data';
import pocketApi from '../api/pocket48';

export default function RoomRadioScreen() {
  const navigation = useNavigation();
  const isDark = useSettingsStore((state) => state.settings.theme === 'dark');
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [radioUrl, setRadioUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');

  const startRadio = async (member: Member) => {
    setSelectedMember(member);
    setLoading(true);
    setStatus('获取电台地址...');
    try {
      const res = await pocketApi.operateRoomVoice({ channelId: member.channelId, serverId: member.serverId });
      const url = pickText(res, ['content.url', 'content.streamPath', 'content.playUrl', 'data.url', 'url']);
      setRadioUrl(url);
      setStatus(url ? '已获取电台地址' : '未获取到电台地址，可能房间当前没有上麦');
    } catch (error) {
      setStatus(`获取失败：${errorMessage(error)}`);
      setRadioUrl('');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={[styles.container, isDark && styles.containerDark]}>
      <View style={[styles.header, isDark && styles.headerDark]}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backBtn}>返回</Text>
        </TouchableOpacity>
        <Text style={[styles.title, isDark && styles.textDark]}>房间电台</Text>
      </View>
      <View style={styles.pickerWrap}>
        <MemberPicker selectedMember={selectedMember} onSelect={startRadio} />
      </View>
      <View style={[styles.playerCard, isDark && styles.playerCardDark]}>
        <Text style={[styles.playerTitle, isDark && styles.textDark]}>{selectedMember?.ownerName || '请选择成员'}</Text>
        <Text style={[styles.playerStatus, isDark && styles.textSubDark]}>{loading ? '加载中...' : status || '选择成员后获取房间电台地址'}</Text>
        {selectedMember ? (
          <TouchableOpacity style={styles.playBtn} onPress={() => startRadio(selectedMember)}>
            <Text style={styles.playBtnText}>重新获取</Text>
          </TouchableOpacity>
        ) : null}
        {radioUrl ? <Text style={[styles.url, isDark && styles.textSubDark]}>{radioUrl}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  containerDark: { backgroundColor: 'transparent' },
  header: { paddingTop: 54, paddingHorizontal: 20, paddingBottom: 14, marginBottom: 4 },
  headerDark: {},
  backBtn: { color: '#ff6f91', fontSize: 14, marginBottom: 6 },
  title: { fontSize: 20, fontWeight: 'bold', color: '#ff6f91' },
  pickerWrap: { padding: 16 },
  playerCard: { margin: 16, padding: 20, backgroundColor: 'rgba(255,255,255,0.46)', borderRadius: 18, alignItems: 'center' },
  playerCardDark: { backgroundColor: 'rgba(20,20,20,0.58)' },
  playerTitle: { fontSize: 18, fontWeight: '600', color: '#333', marginBottom: 8 },
  playerStatus: { fontSize: 13, color: '#333333', marginBottom: 16, textAlign: 'center' },
  playBtn: { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 24, backgroundColor: '#ff6f91' },
  playBtnText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  url: { fontSize: 11, color: '#4caf50', marginTop: 12, textAlign: 'center' },
  textDark: { color: '#eee' },
  textSubDark: { color: '#eeeeee' },
});
