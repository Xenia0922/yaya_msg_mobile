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

function normalizeTalks(res: any): any[] {
  return unwrapList(res, ['content.data', 'content.list', 'data.data', 'data.list', 'list']);
}

function mergeUniqueTalks(current: any[], next: any[]): any[] {
  const seen = new Set(current.map((item) => String(item.talkId || item.id)).filter(Boolean));
  const merged = [...current];
  next.forEach((item) => {
    const key = String(item.talkId || item.id || '');
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

function audioUrls(path: string): string[] {
  if (!path) return [];
  if (path.startsWith('http')) return [path];
  const clean = path.replace(/^\/+/, '');
  const urls = [
    `https://mp4.48.cn/nightwords/${clean}`,
    `https://mp4.48.cn/${clean}`,
    `https://source.48.cn/audio/${clean}`,
    `https://source.48.cn/${clean}`,
    normalizeUrl(path),
  ];
  return Array.from(new Set(urls));
}

export default function AudioProgramsScreen() {
  const navigation = useNavigation<any>();
  const isDark = useSettingsStore((state) => state.settings.theme === 'dark');
  const [programs, setPrograms] = useState<any[]>([]);
  const [playing, setPlaying] = useState<any | null>(null);
  const [playUrls, setPlayUrls] = useState<string[]>([]);
  const [urlIndex, setUrlIndex] = useState(0);
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
    setStatus(refresh ? '加载中...官方电台...' : '加载中...更多电台...');
    try {
      const res = await officialMediaApi.getTalkList({ ctime: cursor, groupId: 0, limit: 20 });
      const list = normalizeTalks(res);
      setPrograms((prev) => (refresh ? mergeUniqueTalks([], list) : mergeUniqueTalks(prev, list)));
      setNextCtime(nextCtimeFrom(list));
      setHasMore(list.length >= 20 && nextCtimeFrom(list) > 0);
      const loadedCount = refresh ? list.length : mergeUniqueTalks(programs, list).length;
      setStatus(loadedCount ? `已加载 ${loadedCount} 个节目` : '官方接口暂无电台资源');
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
    setPlayUrls([]);
    setUrlIndex(0);
    setStatus('正在解析音频地址...');
    try {
      const res = await officialMediaApi.getTalk(String(item.talkId || item.id));
      const data = res?.content?.data || res?.content || res?.data || {};
      const urls = audioUrls(String(data.filePath || data.talkPath || data.url || ''));
      if (!urls.length) throw new Error('未返回音频文件地址');
      setPlayUrls(urls);
      setStatus(`正在播放：${item.title || data.title || '电台节目'}`);
    } catch (error) {
      setStatus(`播放失败：${errorMessage(error)}`);
    }
  };

  return (
    <View style={[styles.container, isDark && styles.containerDark]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backBtn}>返回</Text>
        </TouchableOpacity>
        <Text style={[styles.title, isDark && styles.textDark]}>电台</Text>
        <TouchableOpacity onPress={() => load(true)} disabled={loading}>
          <Text style={[styles.backBtn, loading && styles.disabledText]}>刷新</Text>
        </TouchableOpacity>
      </View>

      {playUrls[urlIndex] ? (
        <View style={[styles.playerBar, isDark && styles.cardDark]}>
          <Text style={[styles.playerTitle, isDark && styles.textDark]} numberOfLines={1}>
            {playing?.title || '正在播放'}
          </Text>
          <Video
            key={playUrls[urlIndex]}
            source={{ uri: playUrls[urlIndex] }}
            style={styles.audioPlayer}
            controls
            paused={false}
            ignoreSilentSwitch="ignore"
            onError={() => {
              if (urlIndex + 1 < playUrls.length) setUrlIndex((prev) => prev + 1);
              else setStatus('音频播放失败：所有备用线路都不可用');
            }}
          />
        </View>
      ) : null}

      {status ? <Text style={[styles.status, isDark && styles.textSubDark]}>{loading ? '加载中...' : status}</Text> : null}
      <FadeInView delay={80} duration={300} style={{ flex: 1 }}>
        <FlatList
          data={programs}
          keyExtractor={(item, index) => String(item.talkId || item.id || index)}
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
              <TouchableOpacity
                style={[styles.progItem, isDark && styles.cardDark, playing?.talkId === item.talkId && styles.progItemActive]}
                onPress={() => play(item)}
              >
                <Text style={[styles.progTitle, isDark && styles.textDark]} numberOfLines={2}>{item.title || '无标题'}</Text>
                <Text style={[styles.progDesc, isDark && styles.textSubDark]} numberOfLines={2}>
                  {[item.subTitle, item.guest].filter(Boolean).join(' · ') || '口袋电台'}
                </Text>
                <Text style={[styles.progDate, isDark && styles.textSubDark]}>{formatTimestamp(item.ctime).slice(0, 10)}</Text>
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
  header: { paddingTop: 54, paddingHorizontal: 20, paddingBottom: 14, marginBottom: 4, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  backBtn: { color: '#ff6f91', fontSize: 14, fontWeight: '700' },
  disabledText: { opacity: 0.45 },
  title: { fontSize: 20, fontWeight: '800', color: '#ff6f91' },
  playerBar: { margin: 12, padding: 12, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.72)' },
  playerTitle: { fontSize: 14, fontWeight: '800', color: '#333', marginBottom: 8 },
  audioPlayer: { height: 48, width: '100%' },
  status: { margin: 12, color: '#444', fontSize: 13, textAlign: 'center' },
  listContent: { paddingBottom: 120 },
  progItem: { padding: 14, backgroundColor: 'rgba(255,255,255,0.72)', marginHorizontal: 16, marginVertical: 4, borderRadius: 16 },
  cardDark: { backgroundColor: 'rgba(20,20,20,0.68)' },
  progItemActive: { borderLeftWidth: 3, borderLeftColor: '#ff6f91' },
  progTitle: { fontSize: 15, fontWeight: '700', color: '#333' },
  progDesc: { fontSize: 13, color: '#444', marginTop: 4, lineHeight: 18 },
  progDate: { fontSize: 11, color: '#333333', marginTop: 4 },
  textDark: { color: '#eee' },
  textSubDark: { color: '#eeeeee' },
});
