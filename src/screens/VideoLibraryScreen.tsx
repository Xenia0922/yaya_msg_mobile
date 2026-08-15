import React, { useEffect, useRef, useState } from 'react';
import { PerfFlatList } from '../components/PerfFlatList';

import {
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Video from 'react-native-video';
import { useNavigation } from '@react-navigation/native';
import officialMediaApi from '../api/officialMedia';
import { useI18n } from '../i18n';
import { useSettingsStore } from '../store';
import { FadeInView } from '../components/Motion';
import { errorMessage, normalizeUrl, unwrapList } from '../utils/data';
import { formatTimestamp, formatDuration } from '../utils/format';
import ScreenHeader from '../components/ScreenHeader';
import { usePalette } from '../theme';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';

function normalizeVideos(res: any): any[] {
  return unwrapList(res, ['content.data', 'content.list', 'data.data', 'data.list', 'list']);
}

function mergeUniqueVideos(current: any[], next: any[]): any[] {
  const seen = new Set(current.map((item) => String(item.videoId || item.id)).filter(Boolean));
  const merged = [...current];
  next.forEach((item) => {
    const key = String(item.videoId || item.id || '');
    if (!key || seen.has(key)) return;
    seen.add(key);
    merged.push(item);
  });
  return merged;
}

function nextCtimeFrom(list: any[]): number {
  const times = list.map((item) => Number(item.ctime)).filter((item) => Number.isFinite(item) && item > 0);
  return times.length ? Math.min(...times) : 0;
}

function mediaUrl(path: string): string {
  if (!path) return '';
  if (path.startsWith('http')) return path;
  return path.startsWith('/') ? `https://mp4.48.cn${path}` : normalizeUrl(path);
}

/** 从视频条目里提取可展示的时长（秒），无则返回空串（只展示，不参与业务判断） */
function videoDuration(item: any): string {
  const n = Number(
    item.duration || item.videoDuration || item.videoTime || item.videoLength
    || item.playTime || item.mediaDuration || item.length,
  );
  return Number.isFinite(n) && n > 0 ? formatDuration(n) : '';
}

function videoMeta(item: any): string {
  return [item.typeName, formatTimestamp(item.ctime).slice(0, 10)].filter(Boolean).join(' · ');
}

function videoCoverUrl(item: any): string {
  return mediaUrl(item.cover || item.coverUrl || item.videoCover || item.picPath || '');
}

export default function VideoLibraryScreen() {
  const navigation = useNavigation<any>();
  const palette = usePalette();
  const { t } = useI18n();
  const [videos, setVideos] = useState<any[]>([]);
  const [playing, setPlaying] = useState<any | null>(null);
  const [playUrl, setPlayUrl] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [nextCtime, setNextCtime] = useState(0);
  const loadingRef = useRef(false);

  const load = async (refresh = true) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    const cursor = refresh ? 0 : nextCtime;
    if (refresh) setLoading(true);
    else setLoadingMore(true);
    setStatus(refresh ? '' : '');
    try {
      const res = await officialMediaApi.getVideoList({ ctime: cursor, typeId: 0, groupId: 0, limit: 20 });
      const list = normalizeVideos(res);
      setVideos((prev) => (refresh ? mergeUniqueVideos([], list) : mergeUniqueVideos(prev, list)));
      setNextCtime(nextCtimeFrom(list));
      setHasMore(list.length >= 20 && nextCtimeFrom(list) > 0);
      const loadedCount = refresh ? list.length : mergeUniqueVideos(videos, list).length;
      setStatus(loadedCount ? t('已加载 {count} 条视频', { count: loadedCount }) : t('官方接口暂无视频资源'));
    } catch (error) {
      setStatus(t('加载失败：{error}', { error: errorMessage(error) }));
    } finally {
      loadingRef.current = false;
      setLoading(false);
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    load(true);
  }, []);

  const loadMore = () => {
    if (loading || loadingMore || loadingRef.current || !hasMore) return;
    load(false);
  };

  const play = async (item: any) => {
    setPlaying(item);
    setPlayUrl('');
    setStatus(t('正在解析视频地址...'));
    try {
      const res = await officialMediaApi.getVideo(String(item.videoId || item.id));
      const data = res?.content?.data || res?.content || res?.data || {};
      const url = mediaUrl(String(data.filePath || data.videoPath || data.url || ''));
      if (!url) throw new Error(t('未返回视频文件地址'));
      setPlayUrl(url);
      setStatus(t('正在播放：{title}', { title: item.title || data.title || t('视频') }));
    } catch (error) {
      setStatus(t('播放失败：{error}', { error: errorMessage(error) }));
    }
  };

  if (playUrl) {
    return (
      <View style={styles.playerPage}>
        <ScreenHeader title={playing?.title || t('视频')} onBack={() => setPlayUrl('')} />
        <Video source={{ uri: playUrl }} style={styles.videoPlayer} controls paused={false} resizeMode="contain" ignoreSilentSwitch="ignore" onError={() => setPlayUrl('')} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScreenHeader title={t('视频')} right={
        <TouchableOpacity onPress={() => load(true)} disabled={loading}>
          <Text style={[styles.backBtn, { color: palette.tint }, loading && styles.disabledText]}>{t('刷新')}</Text>
        </TouchableOpacity>
      } />
      {status ? <Text style={[styles.status, { color: palette.labelSecondary }]}>{loading ? '' : status}</Text> : null}
      <FadeInView delay={80} duration={300} style={{ flex: 1 }}>
        <PerfFlatList
          data={videos.length > 1 ? videos.slice(1) : []}
          keyExtractor={(item, index) => String(item.videoId || item.id || `g${index}`)}
          numColumns={2}
          columnWrapperStyle={styles.gridRow}
          contentContainerStyle={styles.listContent}
          initialNumToRender={12}
          maxToRenderPerBatch={12}
          windowSize={7}
          removeClippedSubviews
          onEndReached={loadMore}
          onEndReachedThreshold={0.35}
          ListHeaderComponent={
            videos.length > 0 ? (
              <TouchableOpacity
                style={[
                  styles.bannerCard,
                  {
                    backgroundColor: palette.surface,
                    borderColor: palette.hairline,
                  },
                ]}
                onPress={() => play(videos[0])}
                activeOpacity={0.9}
              >
                <View style={[styles.bannerCover, { backgroundColor: palette.fill3 }]}>
                  {videoCoverUrl(videos[0]) ? (
                    <Image source={{ uri: videoCoverUrl(videos[0]) }} style={styles.bannerCoverImg} resizeMode="cover" />
                  ) : (
                    <View style={styles.bannerCoverFallback}>
                      <MaterialCommunityIcons name="video" size={40} color={palette.labelTertiary} />
                    </View>
                  )}
                  {videoDuration(videos[0]) ? (
                    <View style={[styles.bannerDuration, { backgroundColor: 'rgba(0,0,0,0.6)' }]}>
                      <Text style={styles.bannerDurationText}>{videoDuration(videos[0])}</Text>
                    </View>
                  ) : null}
                </View>
                <View style={styles.bannerInfo}>
                  <Text style={[styles.bannerTitle, { color: palette.label }]} numberOfLines={2}>
                    {videos[0].title || t('无标题')}
                  </Text>
                  <Text style={[styles.bannerMeta, { color: palette.labelSecondary }]} numberOfLines={1}>
                    {videoMeta(videos[0])}
                  </Text>
                </View>
              </TouchableOpacity>
            ) : null
          }
          ListFooterComponent={loadingMore ? <Text style={[styles.status, { color: palette.labelSecondary }]}>{t('加载更多...')}</Text> : null}
          renderItem={({ item, index }) => (
            <FadeInView delay={80 + index * 30} duration={300} style={styles.gridItem}>
              <TouchableOpacity
                style={[
                  styles.gridCard,
                  {
                    backgroundColor: palette.surface,
                    borderColor: palette.hairline,
                  },
                ]}
                onPress={() => play(item)}
                activeOpacity={0.9}
              >
                <View style={[styles.gridCover, { backgroundColor: palette.fill3 }]}>
                  {videoCoverUrl(item) ? (
                    <Image source={{ uri: videoCoverUrl(item) }} style={styles.gridCoverImg} resizeMode="cover" />
                  ) : (
                    <View style={styles.gridCoverFallback}>
                      <MaterialCommunityIcons name="video" size={28} color={palette.labelTertiary} />
                    </View>
                  )}
                </View>
                <View style={styles.gridInfo}>
                  <Text style={[styles.gridTitle, { color: palette.label }]} numberOfLines={2}>
                    {item.title || t('无标题')}
                  </Text>
                  <Text style={[styles.gridDate, { color: palette.labelTertiary }]} numberOfLines={1}>
                    {formatTimestamp(item.ctime).slice(0, 10)}
                  </Text>
                </View>
              </TouchableOpacity>
            </FadeInView>
          )}
        />
      </FadeInView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  backBtn: { color: '#ff6f91', fontSize: 14, fontWeight: '700' },
  disabledText: { opacity: 0.45 },
  status: { marginHorizontal: 16, marginTop: 8, fontSize: 12, textAlign: 'center' },
  listContent: { paddingTop: 8, paddingHorizontal: 12, paddingBottom: 120 },
  // 大 banner 卡（第一个视频）
  bannerCard: {
    marginHorizontal: 4,
    marginBottom: 12,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
  },
  bannerCover: { width: '100%', height: 180, overflow: 'hidden' },
  bannerCoverImg: { width: '100%', height: '100%' },
  bannerCoverFallback: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  bannerDuration: {
    position: 'absolute',
    left: 10,
    bottom: 10,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  bannerDurationText: { color: '#FFFFFF', fontSize: 11, fontWeight: '700' },
  bannerInfo: { padding: 12 },
  bannerTitle: { fontSize: 15, fontWeight: '700', lineHeight: 21 },
  bannerMeta: { fontSize: 12, marginTop: 5 },
  // 2 列网格卡
  gridRow: { marginHorizontal: 4 },
  gridItem: { flex: 1, margin: 4 },
  gridCard: {
    flex: 1,
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
  },
  gridCover: { width: '100%', aspectRatio: 1, overflow: 'hidden' },
  gridCoverImg: { width: '100%', height: '100%' },
  gridCoverFallback: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  gridInfo: { padding: 10 },
  gridTitle: { fontSize: 13, fontWeight: '700', lineHeight: 18 },
  gridDate: { fontSize: 11, marginTop: 4 },
  playerPage: { flex: 1, backgroundColor: '#000' },
  videoPlayer: { flex: 1, backgroundColor: '#000' },
});
