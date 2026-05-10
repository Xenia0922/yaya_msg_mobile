import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, FlatList, Image, StyleSheet,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSettingsStore } from '../store';
import { Member } from '../types';
import MemberPicker from '../components/MemberPicker';
import { errorMessage, normalizeUrl, pickText, unwrapList } from '../utils/data';
import pocketApi from '../api/pocket48';

function normalizeImageUrl(value: any): string {
  const direct = normalizeUrl(value);
  if (!direct) return '';
  if (/^https?:\/\//i.test(direct)) return direct.replace(/^http:\/\//i, 'https://');
  if (/^(backstage|mediasource|202\d|20\d{6})\//i.test(direct)) return `https://source.48.cn/${direct}`;
  return direct;
}

function deepFindImageUrl(value: any, depth = 0): string {
  if (!value || depth > 6) return '';
  if (typeof value === 'string') {
    const direct = normalizeImageUrl(value);
    if (/\.(jpe?g|png|webp|gif)(\?|$)/i.test(direct) || direct.includes('source.48.cn') || direct.includes('/image') || direct.includes('backstage')) {
      return direct;
    }
    return '';
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = deepFindImageUrl(item, depth + 1);
      if (found) return found;
    }
    return '';
  }
  if (typeof value === 'object') {
    const direct = normalizeImageUrl(pickText(value, [
      'url',
      'imageUrl',
      'imgUrl',
      'image',
      'cover',
      'coverUrl',
      'picUrl',
      'picPath',
      'photoUrl',
      'resourceUrl',
      'filePath',
      'path',
      'sourcePath',
      'originUrl',
      'thumbnail',
      'thumb',
      'smallUrl',
      'bigUrl',
      'nftImg',
      'nftImage',
      'nftPic',
      'cardImg',
      'cardImage',
      'coverImage',
      'imagePath',
      'picturePath',
      'fullPhoto1',
      'fullPhoto2',
      'fullPhoto3',
      'fullPhoto4',
      'starInfo.fullPhoto1',
      'starInfo.fullPhoto2',
      'starInfo.fullPhoto3',
      'starInfo.fullPhoto4',
    ]));
    if (direct) return direct;
    for (const item of Object.values(value)) {
      const found = deepFindImageUrl(item, depth + 1);
      if (found) return found;
    }
  }
  return '';
}

export default function PhotosScreen() {
  const navigation = useNavigation();
  const isDark = useSettingsStore((state) => state.settings.theme === 'dark');
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [photos, setPhotos] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');

  const loadPhotos = async (member: Member) => {
    setSelectedMember(member);
    setLoading(true);
    setStatus('加载个人相册...');
    try {
      const [photoRes, archiveRes] = await Promise.all([
        pocketApi.getMemberPhotos(member.id).catch(() => null),
        pocketApi.getStarArchives(Number(member.id)).catch(() => null),
      ]);
      const list = unwrapList(photoRes, [
        'content.nftList',
        'content.photoList',
        'content.imageList',
        'content.list',
        'content.data.nftList',
        'content.data.photoList',
        'content.data.imageList',
        'content.data.list',
        'data.nftList',
        'data.photoList',
        'data.imageList',
        'data.list',
        'nftList',
        'photoList',
        'imageList',
        'list',
      ]);
      const starInfo = archiveRes?.content?.starInfo || archiveRes?.content || archiveRes?.data?.starInfo || archiveRes?.data || {};
      const archivePhotos = ['fullPhoto1', 'fullPhoto2', 'fullPhoto3', 'fullPhoto4', 'avatar', 'starAvatar']
        .map((key) => starInfo?.[key])
        .filter(Boolean)
        .map((url, index) => ({ id: `archive-${index}`, url, title: '成员照片' }));
      const merged = [...list, ...archivePhotos].filter((item, index, arr) => {
        const url = deepFindImageUrl(item);
        return url && arr.findIndex((other) => deepFindImageUrl(other) === url) === index;
      });
      setPhotos(merged);
      setStatus(`加载完成：${merged.length} 张图片`);
    } catch (error) {
      setStatus(`加载失败：${errorMessage(error)}`);
      setPhotos([]);
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
        <Text style={[styles.title, isDark && styles.textDark]}>个人相册</Text>
      </View>
      <View style={styles.pickerWrap}>
        <MemberPicker selectedMember={selectedMember} onSelect={loadPhotos} />
        {status ? <Text style={styles.status}>{status}</Text> : null}
      </View>
      <FlatList
        data={photos}
        numColumns={2}
        keyExtractor={(item, index) => String(item.id || item.nftId || index)}
        contentContainerStyle={{ padding: 8 }}
        renderItem={({ item }) => {
          const url = deepFindImageUrl(item);
          return (
            <View style={[styles.photoCard, isDark && styles.photoCardDark]}>
              {url ? <Image source={{ uri: url }} style={styles.photo} resizeMode="cover" /> : <View style={styles.photo} />}
              <Text style={styles.photoTitle} numberOfLines={1}>{item.name || item.title || ''}</Text>
            </View>
          );
        }}
        ListEmptyComponent={<Text style={styles.empty}>{loading ? '加载中...' : '选择成员查看相册'}</Text>}
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
  photoTitle: { fontSize: 11, padding: 4, color: '#444', textAlign: 'center' },
  textDark: { color: '#eee' },
  empty: { textAlign: 'center', color: '#333333', marginTop: 60, fontSize: 14 },
});
