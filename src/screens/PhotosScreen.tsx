import React, { useCallback, useMemo, useState } from 'react';
import { PerfFlatList } from '../components/PerfFlatList';
import { NetworkImage } from '../components/NetworkImage';

import {
  View, Text, TouchableOpacity, FlatList, Image, StyleSheet,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSettingsStore, useUiStore } from '../store';
import { FadeInView } from '../components/Motion';
import ScreenHeader from '../components/ScreenHeader';
import { Member } from '../types';
import MemberPicker from '../components/MemberPicker';
import ZoomImageModal from '../components/ZoomImageModal';
import { errorMessage, normalizeUrl, pickText, unwrapList } from '../utils/data';
import pocketApi from '../api/pocket48';
import { enqueueDownload } from '../services/downloads';
import { useAppTheme } from '../hooks/useAppTheme';
import { usePalette } from '../theme';
import { useI18n } from '../i18n';

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
  const isDark = useAppTheme();
  const palette = usePalette();
  const { t } = useI18n();
  const showToast = useUiStore((state) => state.showToast);
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [photos, setPhotos] = useState<any[]>([]);
  const [previewUrl, setPreviewUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');

  const loadPhotos = async (member: Member) => {
    setSelectedMember(member);
    setLoading(true);
    setStatus(t('加载个人相册...'));
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
        .map((url, index) => ({ id: `archive-${index}`, url, title: t('成员照片') }));
      const combined = [...list, ...archivePhotos];
      const seen = new Set<string>();
      const merged: any[] = [];
      for (const item of combined) {
        const url = deepFindImageUrl(item);
        if (!url || seen.has(url)) continue;
        seen.add(url);
        merged.push(item);
      }
      setPhotos(merged);
      setStatus(t('加载完成：{count} 张图片', { count: merged.length }));
    } catch (error) {
      setStatus(t('加载失败：{msg}', { msg: errorMessage(error) }));
      setPhotos([]);
    } finally {
      setLoading(false);
    }
  };

  const downloadPhoto = useCallback(async (url: string) => {
    try {
      await enqueueDownload({ url, type: 'image', name: selectedMember ? `${selectedMember.ownerName}-photo` : 'member-photo' });
      showToast(t('已加入下载管理'));
    } catch (error) {
      showToast(t('下载失败：{msg}', { msg: errorMessage(error) }));
    }
  }, [selectedMember, showToast, t]);

  const photoUrls = useMemo(() => photos.map((p) => deepFindImageUrl(p)), [photos]);

  const renderPhotoItem = useCallback(({ item, index }: { item: any; index: number }) => {
    const url = photoUrls[index] || deepFindImageUrl(item);
    const delay = index < 12 ? 80 + index * 30 : 0;
    const title = item?.name || item?.title || '';
    return (
      <FadeInView delay={delay} duration={300} style={{ flex: 1 }}>
        <View style={[styles.photoCard, { backgroundColor: palette.surface, borderColor: palette.hairline, borderWidth: StyleSheet.hairlineWidth }]}>
          {url ? (
            <TouchableOpacity activeOpacity={0.9} onPress={() => setPreviewUrl(url)} onLongPress={() => downloadPhoto(url)}>
              <NetworkImage source={{ uri: url }} style={[styles.photo, { backgroundColor: palette.fill3 }]} resizeMode="cover" />
            </TouchableOpacity>
          ) : <View style={[styles.photo, { backgroundColor: palette.fill3 }]} />}
          {title ? (
            <>
              <View pointerEvents="none" style={styles.photoShade} />
              <View style={styles.photoTitleOverlay}>
                <Text style={styles.photoTitleText} numberOfLines={1}>{title}</Text>
              </View>
            </>
          ) : null}
        </View>
      </FadeInView>
    );
  }, [downloadPhoto, palette, photoUrls]);

  return (
    <View style={styles.container}>
      <ScreenHeader title={t('个人相册')} />
      <FadeInView delay={80} duration={300} style={{ flex: 1 }}>
        <View style={styles.pickerWrap}>
          <MemberPicker selectedMember={selectedMember} onSelect={loadPhotos} />
          {status ? <Text style={[styles.status, { color: palette.labelSecondary }]}>{status}</Text> : null}
        </View>
        <ZoomImageModal url={previewUrl} onClose={() => setPreviewUrl('')} />
        <PerfFlatList
          data={photos}
          numColumns={2}
          keyExtractor={(item, index) => String(item.id || item.nftId || index)}
          contentContainerStyle={styles.list}
          renderItem={renderPhotoItem}
          ListEmptyComponent={<Text style={[styles.empty, { color: palette.labelTertiary }]}>{loading ? '' : t('暂无图片')}</Text>}
          initialNumToRender={12}
          maxToRenderPerBatch={12}
          windowSize={7}
          removeClippedSubviews
        />
      </FadeInView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  pickerWrap: { padding: 16 },
  status: { marginTop: 8, fontSize: 12 },
  list: { padding: 10, paddingBottom: 40 },
  photoCard: { flex: 1, margin: 4, borderRadius: 16, overflow: 'hidden' },
  photo: { width: '100%', aspectRatio: 1 },
  photoShade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 44, backgroundColor: 'rgba(0,0,0,0.42)' },
  photoTitleOverlay: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 8, paddingBottom: 6 },
  photoTitleText: { color: '#FFFFFF', fontSize: 11, fontWeight: '700', textAlign: 'center', textShadowColor: 'rgba(0,0,0,0.6)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2 },
  empty: { textAlign: 'center', marginTop: 60, fontSize: 14 },
});
