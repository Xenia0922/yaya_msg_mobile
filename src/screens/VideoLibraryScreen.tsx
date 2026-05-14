import React, { useEffect, useRef, useState } from 'react';
import {
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Video from 'react-native-video';
import { useNavigation } from '@react-navigation/native';
import officialMediaApi from '../api/officialMedia';
import { useSettingsStore } from '../store';
import { FadeInView } from '../components/Motion';
import { errorMessage, normalizeUrl, unwrapList } from '../utils/data';
import { formatTimestamp } from '../utils/format';
import ScreenHeader from '../components/ScreenHeader';

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

export default function VideoLibraryScreen() {
  const navigation = useNavigation<any>();
  const isDark = useSettingsStore((state) => state.settings.theme === 'dark');
  const [videos, setVideos] = useState<any[]>([]);
  const [playing, setPlaying] = useState<any | null>(null);
  const [playUrl, setPlayUrl] = useState('');
  const [status, setStatus] = useState('加载中...');
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
    setStatus(refresh ? '加载中...官方视频...' : '加载中...更多视频...');
    try {
      const res = await officialMediaApi.getVideoList({ ctime: cursor, typeId: 0, groupId: 0, limit: 20 });
      const list = normalizeVideos(res);
      setVideos((prev) => (refresh ? mergeUniqueVideos([], list) : mergeUniqueVideos(prev, list)));
      setNextCtime(nextCtimeFrom(list));
      setHasMore(list.length >= 20 && nextCtimeFrom(list) > 0);
      const loadedCount = refresh ? list.length : mergeUniqueVideos(videos, list).length;
      setStatus(loadedCount ? `已加载 ${loadedCount} 条视频` : '官方接口暂无视频资源');
    } catch (error) {
      setStatus(`加载失败：${errorMessage(error)}`);
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
    setStatus('正在解析视频地址...');
    try {
      const res = await officialMediaApi.getVideo(String(item.videoId || item.id));
      const data = res?.content?.data || res?.content || res?.data || {};
      const url = mediaUrl(String(data.filePath || data.videoPath || data.url || ''));
      if (!url) throw new Error('未返回视频文件地址');
      setPlayUrl(url);
      setStatus(`正在播放：${item.title || data.title || '视频'}`);
    } catch (error) {
      setStatus(`播放失败：${errorMessage(error)}`);
    }
  };

  if (playUrl) {
    return (
      <View style={styles.playerPage}>
        <ScreenHeader title={playing?.title || '视频'} onBack={() => setPlayUrl('')} />
        <Video source={{ uri: playUrl }} style={styles.videoPlayer} controls paused={false} resizeMode="contain" ignoreSilentSwitch="ignore" />
      </View>
    );
  }

  return (
    <View style={[styles.container, isDark && styles.containerDark]}>
      <ScreenHeader title="视频" right={
        <TouchableOpacity onPress={() => load(true)} disabled={loading}>
          <Text style={[styles.backBtn, loading && styles.disabledText]}>刷新</Text>
        </TouchableOpacity>
      } />
      {status ? <Text style={[styles.status, isDark && styles.textSubDark]}>{loading ? '加载中...' : status}</Text> : null}
      <FadeInView delay={80} duration={300} style={{ flex: 1 }}>
        <FlatList
          data={videos}
          keyExtractor={(item, index) => String(item.videoId || item.id || index)}
          contentContainerStyle={styles.listContent}
          initialNumToRender={12}
          maxToRenderPerBatch={12}
          windowSize={7}
          removeClippedSubviews
          onEndReached={loadMore}
          onEndReachedThreshold={0.35}
          ListFooterComponent={loadingMore ? <Text style={[styles.status, isDark && styles.textSubDark]}>加载更多...</Text> : null}
          renderItem={({ item, index }) => (
            <FadeInView delay={80 + index * 30} duration={300}>
              <TouchableOpacity style={[styles.card, isDark && styles.cardDark]} onPress={() => play(item)}>
                <Text style={[styles.cardTitle, isDark && styles.textDark]} numberOfLines={2}>{item.title || '无标题'}</Text>
                <Text style={[styles.cardSub, isDark && styles.textSubDark]}>
                  {[item.typeName, item.subTitle, formatTimestamp(item.ctime).slice(0, 10)].filter(Boolean).join(' · ')}
                </Text>
                <Text style={[styles.desc, isDark && styles.textSubDark]}>{item.play ? `播放 ${item.play}` : '点击解析播放地址'}</Text>
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
  containerDark: { backgroundColor: 'transparent' },
  backBtn: { color: '#ff6f91', fontSize: 14, fontWeight: '700' },
  disabledText: { opacity: 0.45 },
  status: { margin: 16, color: '#444', fontSize: 13, textAlign: 'center' },
  listContent: { paddingBottom: 120 },
  card: { padding: 14, backgroundColor: 'rgba(255,255,255,0.72)', margin: 12, marginBottom: 0, borderRadius: 16 },
  cardDark: { backgroundColor: 'rgba(20,20,20,0.68)' },
  cardTitle: { fontSize: 14, fontWeight: '700', color: '#333' },
  cardSub: { fontSize: 11, color: '#333333', marginTop: 4 },
  desc: { fontSize: 12, color: '#555', marginTop: 6, lineHeight: 18 },
  playerPage: { flex: 1, backgroundColor: '#000' },
  videoPlayer: { flex: 1, backgroundColor: '#000' },
  textDark: { color: '#eee' },
  textSubDark: { color: '#eeeeee' },
});
