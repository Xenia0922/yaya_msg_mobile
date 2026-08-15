import React, { useEffect, useRef, useState } from 'react';
import { PerfFlatList } from '../components/PerfFlatList';

import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Video from 'react-native-video';
import officialMediaApi from '../api/officialMedia';
import { useI18n } from '../i18n';
import { FadeInView } from '../components/Motion';
import { errorMessage, normalizeUrl, unwrapList } from '../utils/data';
import { formatTimestamp } from '../utils/format';
import ScreenHeader from '../components/ScreenHeader';
import { usePalette } from '../theme';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';

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

/** 提取节目封面缩略图地址（只展示用） */
function programCover(item: any): string {
  return normalizeUrl(item.cover || item.coverUrl || item.picPath || item.imageUrl || item.thumb || '');
}

function programDate(item: any): string {
  return formatTimestamp(item.ctime).slice(0, 10);
}

export default function AudioProgramsScreen() {
  const palette = usePalette();
  const { t } = useI18n();
  const [programs, setPrograms] = useState<any[]>([]);
  const [playing, setPlaying] = useState<any | null>(null);
  const [playUrls, setPlayUrls] = useState<string[]>([]);
  const [urlIndex, setUrlIndex] = useState(0);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [nextCtime, setNextCtime] = useState(0);
  const loadingRef = useRef(false);
  const nextCtimeRef = useRef(0);

  const load = async (refresh = true) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    const cursor = refresh ? 0 : nextCtimeRef.current;
    if (refresh) setLoading(true); else setLoadingMore(true);
    setStatus(refresh ? '' : '');
    try {
      const res = await officialMediaApi.getTalkList({ ctime: cursor, groupId: 0, limit: 20 });
      const list = normalizeTalks(res);
      setPrograms((prev) => (refresh ? mergeUniqueTalks([], list) : mergeUniqueTalks(prev, list)));
      const nct = nextCtimeFrom(list);
      nextCtimeRef.current = nct;
      setNextCtime(nct);
      setHasMore(list.length >= 20 && nct > 0);
      const loadedCount = refresh ? list.length : mergeUniqueTalks(programs, list).length;
      setStatus(loadedCount ? t('已加载 {count} 个节目', { count: loadedCount }) : t('官方接口暂无电台资源'));
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
    setPlayUrls([]);
    setUrlIndex(0);
    setStatus(t('正在解析音频地址...'));
    try {
      const res = await officialMediaApi.getTalk(String(item.talkId || item.id));
      const data = res?.content?.data || res?.content || res?.data || {};
      const urls = audioUrls(String(data.filePath || data.talkPath || data.url || ''));
      if (!urls.length) throw new Error(t('未返回音频文件地址'));
      setPlayUrls(urls);
      setStatus(t('正在播放：{title}', { title: item.title || data.title || t('电台节目') }));
    } catch (error) {
      setStatus(t('播放失败：{error}', { error: errorMessage(error) }));
    }
  };

  const active = playing?.talkId;

  return (
    <View style={styles.container}>
      <ScreenHeader title={t('电台')} right={
        <TouchableOpacity onPress={() => load(true) } disabled={loading}>
          <Text style={[styles.backBtn, { color: palette.tint }, loading && styles.disabledText]}>{t('刷新')}</Text>
        </TouchableOpacity>
      } />

      {playUrls[urlIndex] ? (
        <View style={[styles.playerBar, { backgroundColor: palette.surface, borderColor: palette.hairline }]}>
          <Text style={[styles.playerTitle, { color: palette.label }]} numberOfLines={1}>
            {playing?.title || t('正在播放')}
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
              else setStatus(t('音频播放失败：所有备用线路都不可用'));
            }}
          />
        </View>
      ) : null}

      {status ? <Text style={[styles.status, { color: palette.labelSecondary }]}>{loading ? '' : status}</Text> : null}
      <FadeInView delay={80} duration={300} style={{ flex: 1 }}>
        <PerfFlatList
          data={programs.length > 1 ? programs.slice(1) : []}
          keyExtractor={(item, index) => String(item.talkId || item.id || index)}
          contentContainerStyle={styles.listContent}
          initialNumToRender={12}
          maxToRenderPerBatch={12}
          windowSize={7}
          removeClippedSubviews
          onEndReached={loadMore}
          onEndReachedThreshold={0.35}
          ListHeaderComponent={
            programs.length > 0 ? (
              <TouchableOpacity
                style={[styles.heroCard, { backgroundColor: palette.surface, borderColor: palette.hairline }]}
                onPress={() => play(programs[0])}
                activeOpacity={0.9}
              >
                <View style={[styles.heroCover, { backgroundColor: palette.tintSoft }]}>
                  <MaterialCommunityIcons name="radio" size={44} color={palette.tint} />
                </View>
                <View style={styles.heroInfo}>
                  <Text style={[styles.heroTitle, { color: palette.label }]} numberOfLines={2}>
                    {programs[0].title || t('无标题')}
                  </Text>
                  <Text style={[styles.heroMeta, { color: palette.labelSecondary }]} numberOfLines={1}>
                    {[programs[0].subTitle, programs[0].guest].filter(Boolean).join(' · ') || t('口袋电台')}
                  </Text>
                  <Text style={[styles.heroDate, { color: palette.labelTertiary }]}>
                    {formatTimestamp(programs[0].ctime).slice(0, 10)}
                  </Text>
                </View>
                <View style={[styles.heroPlayBtn, { backgroundColor: palette.tint }]}>
                  <MaterialCommunityIcons
                    name={String(active || '') === String(programs[0].talkId || programs[0].id) ? 'pause' : 'play'}
                    size={20}
                    color="#FFFFFF"
                  />
                </View>
              </TouchableOpacity>
            ) : null
          }
          ListFooterComponent={loadingMore ? <Text style={[styles.status, { color: palette.labelSecondary }]}>{t('加载更多...')}</Text> : null}
          renderItem={({ item, index }) => {
            const isActive = String(active || '') === String(item.talkId || item.id);
            return (
              <FadeInView delay={80 + index * 30} duration={300}>
                <TouchableOpacity
                  style={[
                    styles.progItem,
                    {
                      backgroundColor: palette.surface,
                      borderColor: isActive ? palette.tint : palette.hairline,
                    },
                  ]}
                  onPress={() => play(item)}
                  activeOpacity={0.88}
                >
                  <View style={[styles.iconWrap, { backgroundColor: palette.tintSoft }]}>
                    <MaterialCommunityIcons name="audio" size={20} color={palette.tint} />
                  </View>
                  <View style={styles.infoWrap}>
                    <Text style={[styles.progTitle, { color: palette.label }]} numberOfLines={1}>{item.title || t('无标题')}</Text>
                    <Text style={[styles.progDesc, { color: palette.labelSecondary }]} numberOfLines={1}>
                      {[item.subTitle, item.guest].filter(Boolean).join(' · ') || t('口袋电台')}
                    </Text>
                    <Text style={[styles.progDate, { color: palette.labelTertiary }]}>{formatTimestamp(item.ctime).slice(0, 10)}</Text>
                  </View>
                  <MaterialCommunityIcons
                    name={isActive ? 'equalizer' : 'play-circle-outline'}
                    size={20}
                    color={isActive ? palette.tint : palette.labelTertiary}
                  />
                </TouchableOpacity>
              </FadeInView>
            );
          }}
        />
      </FadeInView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  backBtn: { color: '#ff6f91', fontSize: 14, fontWeight: '700' },
  disabledText: { opacity: 0.45 },
  playerBar: { marginHorizontal: 16, marginTop: 8, padding: 12, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth },
  playerTitle: { fontSize: 14, fontWeight: '800', marginBottom: 8 },
  audioPlayer: { height: 48, width: '100%' },
  status: { marginHorizontal: 16, marginTop: 8, fontSize: 12, textAlign: 'center' },
  listContent: { paddingTop: 8, paddingHorizontal: 12, paddingBottom: 120 },
  // 第一个节目大卡
  heroCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 4,
    marginBottom: 10,
    padding: 14,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
  },
  heroCover: {
    width: 72,
    height: 72,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  heroInfo: { flex: 1, marginLeft: 14, marginRight: 10, minWidth: 0 },
  heroTitle: { fontSize: 16, fontWeight: '700', lineHeight: 21 },
  heroMeta: { fontSize: 12, marginTop: 4 },
  heroDate: { fontSize: 11, marginTop: 3 },
  heroPlayBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  progItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginVertical: 4,
    padding: 12,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoWrap: { flex: 1, marginLeft: 12, marginRight: 8, minWidth: 0 },
  progTitle: { fontSize: 15, fontWeight: '700', lineHeight: 20 },
  progDesc: { fontSize: 12, marginTop: 3 },
  progDate: { fontSize: 11, marginTop: 3 },
});
