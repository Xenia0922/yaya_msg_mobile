import React, { useCallback, useMemo, useRef, useState } from 'react';
import { PerfFlatList } from '../components/PerfFlatList';
import { NetworkImage } from '../components/NetworkImage';

import { View, Text, RefreshControl, StyleSheet } from 'react-native';
import { useUiStore } from '../store';
import { FadeInView, ScalePressable } from '../components/Motion';
import { Skeleton } from '../components/Skeleton';
import { EmptyState, ErrorState } from '../components/StateViews';
import ScreenHeader from '../components/ScreenHeader';
import { Member } from '../types';
import MemberPicker from '../components/MemberPicker';
import ZoomImageModal from '../components/ZoomImageModal';
import { HeaderAction } from '../components/HeaderAction';
import { errorMessage, normalizeUrl, pickText, unwrapList } from '../utils/data';
import pocketApi from '../api/pocket48';
import { enqueueDownload } from '../services/downloads';
import { usePalette, spacing, radii } from '../theme';
import { useI18n } from '../i18n';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';

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
  const palette = usePalette();
  const { t } = useI18n();
  const showToast = useUiStore((state) => state.showToast);
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [photos, setPhotos] = useState<any[]>([]);
  const [previewUrl, setPreviewUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [loadError, setLoadError] = useState('');
  const runIdRef = useRef(0);

  const loadPhotos = useCallback(async (member: Member) => {
    const runId = ++runIdRef.current;
    setSelectedMember(member);
    setLoading(true);
    setLoadError('');
    setStatus(t('加载个人相册...'));
    try {
      const [photoRes, archiveRes] = await Promise.all([
        pocketApi.getMemberPhotos(member.id).catch(() => null),
        pocketApi.getStarArchives(Number(member.id)).catch(() => null),
      ]);
      // 竞态防护：快速切换成员时丢弃过期响应
      if (runId !== runIdRef.current) return;
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
      if (runId !== runIdRef.current) return;
      setLoadError(errorMessage(error));
      setStatus(t('加载失败：{msg}', { msg: errorMessage(error) }));
      setPhotos([]);
    } finally {
      if (runId === runIdRef.current) setLoading(false);
    }
  }, [t]);

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
    const delay = index < 12 ? 60 + index * 25 : 0;
    return (
      <FadeInView delay={delay} distance={8} style={{ flex: 1 }}>
        <ScalePressable
          style={styles.photoCell}
          activeOpacity={0.9}
          pressedScale={0.96}
          onPress={() => setPreviewUrl(url)}
          onLongPress={() => downloadPhoto(url)}
        >
          {url ? (
            <NetworkImage source={{ uri: url }} style={[styles.photo, { backgroundColor: palette.fill3 }]} resizeMode="cover" />
          ) : (
            <View style={[styles.photo, styles.photoFallback, { backgroundColor: palette.fill3 }]}>
              <MaterialCommunityIcons name="image-off-outline" size={20} color={palette.labelTertiary} />
            </View>
          )}
        </ScalePressable>
      </FadeInView>
    );
  }, [downloadPhoto, palette, photoUrls]);

  /** 首屏网格骨架占位（与 3 列网格同构） */
  const renderSkeletonGrid = () => {
    const rows = [0, 1, 2];
    return (
      <View style={styles.skeletonWrap}>
        {rows.map((r) => (
          <View key={r} style={styles.skeletonRow}>
            {[0, 1, 2].map((c) => (
              <Skeleton key={`${r}-${c}`} height={100} radius={radii.sm} style={styles.skeletonCell} />
            ))}
          </View>
        ))}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <ScreenHeader
        title={t('个人相册')}
        right={
          <HeaderAction label={t('刷新')} onPress={() => selectedMember && loadPhotos(selectedMember)} disabled={!selectedMember || loading} loading={loading} />
        }
      />
      <FadeInView delay={60} duration={300} style={{ flex: 1 }}>
        <View style={styles.pickerCard}>
          <View style={[styles.pickerRow, { backgroundColor: palette.surface, borderColor: palette.hairline }]}>
            <View style={[styles.avatar, { backgroundColor: palette.tintSoft }]}>
              {selectedMember ? (
                <NetworkImage source={{ uri: selectedMember.avatar }} style={styles.avatarImg} resizeMode="cover" />
              ) : (
                <MaterialCommunityIcons name="account" size={22} color={palette.tint} />
              )}
            </View>
            <View style={styles.pickerInfo}>
              <Text style={[styles.pickerName, { color: palette.label }]} numberOfLines={1}>
                {selectedMember ? selectedMember.ownerName : t('选择成员查看相册')}
              </Text>
              <Text style={[styles.pickerSub, { color: palette.labelTertiary }]} numberOfLines={1}>
                {selectedMember ? t('点击刷新或长按图片下载') : t('搜索并选择成员，查看个人照片')}
              </Text>
            </View>
            <MaterialCommunityIcons name="chevron-down" size={20} color={palette.labelTertiary} />
          </View>
          <View style={styles.pickerBody}>
            <MemberPicker selectedMember={selectedMember} onSelect={loadPhotos} />
          </View>
          {status && !loading ? <Text style={[styles.status, { color: palette.labelSecondary }]}>{status}</Text> : null}
        </View>
        <ZoomImageModal url={previewUrl} onClose={() => setPreviewUrl('')} />
        {loading && photos.length === 0 ? (
          renderSkeletonGrid()
        ) : loadError ? (
          <View style={{ flex: 1 }}>
            <ErrorState title={t('加载失败')} hint={loadError} onAction={() => selectedMember && loadPhotos(selectedMember)} />
          </View>
        ) : photos.length === 0 ? (
          <View style={{ flex: 1 }}>
            <EmptyState
              icon="image-multiple-outline"
              title={selectedMember ? t('暂无图片') : t('选择成员查看相册')}
              hint={selectedMember ? t('该成员暂时没有公开照片') : t('搜索并选择成员，查看个人照片')}
            />
          </View>
        ) : (
        <PerfFlatList
          data={photos}
          numColumns={3}
          keyExtractor={(item, index) => String(item.id || item.nftId || index)}
          contentContainerStyle={styles.list}
          renderItem={renderPhotoItem}
          initialNumToRender={12}
          maxToRenderPerBatch={12}
          windowSize={7}
          removeClippedSubviews
          refreshControl={
            <RefreshControl
              refreshing={loading}
              onRefresh={() => selectedMember && loadPhotos(selectedMember)}
              tintColor={palette.tint}
              colors={[palette.tint]}
            />
          }
        />
        )}
      </FadeInView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  pickerCard: { paddingHorizontal: 16, paddingTop: 4 },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  avatar: { width: 48, height: 48, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarImg: { width: '100%', height: '100%' },
  pickerInfo: { flex: 1, minWidth: 0, marginLeft: 12, marginRight: 8 },
  pickerName: { fontSize: 15, fontWeight: '600', lineHeight: 20 },
  pickerSub: { fontSize: 12, marginTop: 2 },
  pickerBody: { marginTop: 6 },
  status: { marginTop: 10, fontSize: 12, textAlign: 'center' },
  list: { paddingHorizontal: 6, paddingTop: 6, paddingBottom: 96 },
  photoCell: { flex: 1, margin: 3, borderRadius: radii.sm, overflow: 'hidden', aspectRatio: 1 },
  photo: { width: '100%', height: '100%' },
  photoFallback: { alignItems: 'center', justifyContent: 'center' },
  skeletonWrap: { paddingHorizontal: 6, paddingTop: 6 },
  skeletonRow: { flexDirection: 'row', marginBottom: 6 },
  skeletonCell: { flex: 1, margin: 3 },
});
