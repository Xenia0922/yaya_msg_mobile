import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, FlatList, Image, StyleSheet,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSettingsStore, useUiStore } from '../store';
import { Member } from '../types';
import MemberPicker from '../components/MemberPicker';
import ZoomImageModal from '../components/ZoomImageModal';
import { errorMessage, messageImageUrl, unwrapList } from '../utils/data';
import pocketApi from '../api/pocket48';
import { enqueueDownload } from '../services/downloads';

export default function RoomAlbumScreen() {
  const navigation = useNavigation();
  const isDark = useSettingsStore((state) => state.settings.theme === 'dark');
  const showToast = useUiStore((state) => state.showToast);
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [images, setImages] = useState<any[]>([]);
  const [previewUrl, setPreviewUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');

  const loadAlbum = async (member: Member) => {
    setSelectedMember(member);
    setLoading(true);
    setStatus('加载房间相册...');
    try {
      const res = await pocketApi.getRoomAlbum({ channelId: member.channelId });
      const list = unwrapList(res, ['content.messageList', 'content.list', 'messageList', 'list']);
      const imageList = list.filter((item) => item.msgType === 'IMAGE' || messageImageUrl(item));
      setImages(imageList);
      setStatus(`加载完成：${imageList.length} 张图片`);
    } catch (error) {
      setStatus(`加载失败：${errorMessage(error)}`);
      setImages([]);
    } finally {
      setLoading(false);
    }
  };

  const downloadImage = async (url: string) => {
    try {
      await enqueueDownload({ url, type: 'image', name: selectedMember ? `${selectedMember.ownerName}-room-image` : 'room-image' });
      showToast('已加入下载管理');
    } catch (error) {
      showToast(`下载失败：${errorMessage(error)}`);
    }
  };

  return (
    <View style={[styles.container, isDark && styles.containerDark]}>
      <View style={[styles.header, isDark && styles.headerDark]}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backBtn}>返回</Text>
        </TouchableOpacity>
        <Text style={[styles.title, isDark && styles.textDark]}>房间相册</Text>
      </View>
      <View style={styles.pickerWrap}>
        <MemberPicker selectedMember={selectedMember} onSelect={loadAlbum} />
        {status ? <Text style={styles.status}>{status}</Text> : null}
      </View>
      <ZoomImageModal url={previewUrl} onClose={() => setPreviewUrl('')} />
      <FlatList
        data={images}
        numColumns={2}
        keyExtractor={(item, index) => String(item.id || item.msgId || index)}
        contentContainerStyle={{ padding: 8 }}
        renderItem={({ item }) => {
          const url = messageImageUrl(item);
          return (
            <View style={[styles.photoCard, isDark && styles.photoCardDark]}>
              {url ? (
                <>
                  <TouchableOpacity activeOpacity={0.9} onPress={() => setPreviewUrl(url)} onLongPress={() => downloadImage(url)}>
                    <Image source={{ uri: url }} style={styles.photo} />
                  </TouchableOpacity>
                </>
              ) : (
                <View style={styles.photoPlaceholder}>
                  <Text style={styles.photoPlaceholderText}>图片</Text>
                </View>
              )}
            </View>
          );
        }}
        ListEmptyComponent={<Text style={styles.empty}>{loading ? '加载中...' : '选择成员查看房间相册'}</Text>}
      />
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
  status: { marginTop: 8, color: '#444', fontSize: 12 },
  photoCard: { flex: 1, margin: 4, backgroundColor: 'rgba(255,255,255,0.46)', borderRadius: 18, overflow: 'hidden' },
  photoCardDark: { backgroundColor: 'rgba(20,20,20,0.58)' },
  photo: { width: '100%', aspectRatio: 1, backgroundColor: 'rgba(221,221,221,0.82)' },
  photoPlaceholder: { width: '100%', aspectRatio: 1, backgroundColor: 'rgba(238,238,238,0.82)', alignItems: 'center', justifyContent: 'center' },
  photoPlaceholderText: { color: '#333333', fontSize: 12 },
  textDark: { color: '#eee' },
  empty: { textAlign: 'center', color: '#333333', marginTop: 60, fontSize: 14 },
});
