import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
} from 'react-native';
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
      <ScreenHeader title="房间电台" />
      <FadeInView delay={80} duration={300}>
        <View style={styles.pickerWrap}>
          <MemberPicker selectedMember={selectedMember} onSelect={startRadio} />
        </View>
        <View style={[styles.playerCard, isDark && styles.playerCardDark]}>
          <Text style={[styles.playerTitle, isDark && styles.textDark]}>{selectedMember?.ownerName || '暂无数据'}</Text>
          <Text style={[styles.playerStatus, isDark && styles.textSubDark]}>{loading ? '加载中...' : status || '暂无电台地址'}</Text>
          {selectedMember ? (
            <TouchableOpacity style={styles.playBtn} onPress={() => startRadio(selectedMember)}>
              <Text style={styles.playBtnText}>刷新</Text>
            </TouchableOpacity>
          ) : null}
          {radioUrl ? <Text style={[styles.url, isDark && styles.textSubDark]}>{radioUrl}</Text> : null}
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
  playBtn: { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 18, backgroundColor: '#ff6f91' },
  playBtnText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  url: { fontSize: 11, color: '#4caf50', marginTop: 12, textAlign: 'center' },
  textDark: { color: '#eee' },
  textSubDark: { color: '#eeeeee' },
});
