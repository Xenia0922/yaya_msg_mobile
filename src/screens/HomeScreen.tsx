/**
 * HomeScreen · 内容仪表盘 v2（2026-08-15 视觉升级）
 * - 统一 MaterialCommunityIcons 图标（弃用 emoji，安卓渲染一致性）
 * - 正在直播横向轮播（真实数据，封面 + 直播中徽标）
 * - 快捷入口：tint 圆底图标胶囊
 * - 最近播放续播卡
 * - 工具手风琴：tint 方底图标行 + 可折叠分组
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { CompositeNavigationProp } from '@react-navigation/native';
import { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { StackNavigationProp } from '@react-navigation/stack';
import { useSafeAreaInsets } from '../hooks/useSafeAreaInsets';
import { RootStackParamList, TabParamList } from '../navigation/types';
import { useMemberStore, useSettingsStore } from '../store';
import { useMusicPlayerStore } from '../store/musicPlayerStore';
import { usePalette, spacing } from '../theme';
import { typography } from '../theme/typography';
import { GlassCard } from '../components/GlassCard';
import { Pill } from '../components/Pill';
import { ScalePressable } from '../components/Motion';
import { NetworkImage } from '../components/NetworkImage';
import { useI18n } from '../i18n';
import { pocketApi } from '../api/pocket48';
import { normalizeUrl, pickText, unwrapList } from '../utils/data';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';

type HomeNavProp = CompositeNavigationProp<
  BottomTabNavigationProp<TabParamList, 'Home'>,
  StackNavigationProp<RootStackParamList>
>;

interface NavItem {
  title: string;
  desc: string;
  route: string;
  params?: any;
  icon: string;
}

/** MaterialCommunityIcons 图标（统一视觉语言，替代 emoji） */
const ICONS: Record<string, string> = {
  LiveRoom: 'video', Vod: 'play-box-multiple', RoomRadio: 'radio', Bilibili: 'broadcast',
  Rooms: 'message-text', PrivateMessages: 'email-outline', RoomAlbum: 'image-multiple', OpenLive: 'theater',
  FlipSend: 'comment-question-outline', FlipHistory: 'history', Analysis: 'chart-bar',
  Profile: 'account', MemberDynamic: 'star-circle', MemberWeibo: 'web', Trip: 'briefcase',
  VideoLibrary: 'play-box', MusicLibrary: 'music-note', AudioPrograms: 'podcast',
  MeleeRank: 'trophy', Database: 'database', Login: 'key-variant', Download: 'download', Invoice: 'file-document-outline', Settings: 'cog',
};

const QUICK: NavItem[] = [
  { title: '直播', desc: '', route: 'Media', icon: ICONS.LiveRoom },
  { title: '回放', desc: '', route: 'Media', params: { mode: 'vod' }, icon: ICONS.Vod },
  { title: '音乐', desc: '', route: 'MusicLibraryScreen', icon: ICONS.MusicLibrary },
  { title: '私信', desc: '', route: 'PrivateMessagesScreen', icon: ICONS.PrivateMessages },
];

/** 工具：单行横向 chips（翻牌/统计/下载/账号/设置…） */
const TOOL_CHIPS: NavItem[] = [
  { title: '翻牌', desc: '', route: 'FlipScreen', icon: ICONS.FlipSend },
  { title: '统计', desc: '', route: 'AnalysisScreen', icon: ICONS.Analysis },
  { title: '下载', desc: '', route: 'DownloadScreen', icon: ICONS.Download },
  { title: '账号', desc: '', route: 'LoginScreen', icon: ICONS.Login },
  { title: '设置', desc: '', route: 'Settings', icon: ICONS.Settings },
  { title: '相册', desc: '', route: 'RoomAlbumScreen', icon: ICONS.RoomAlbum },
  { title: '公演', desc: '', route: 'OpenLiveScreen', icon: ICONS.OpenLive },
  { title: 'B站', desc: '', route: 'BilibiliLiveScreen', icon: ICONS.Bilibili },
  { title: '微博', desc: '', route: 'MemberWeiboScreen', icon: ICONS.MemberWeibo },
  { title: '行程', desc: '', route: 'TripScreen', icon: ICONS.Trip },
  { title: '鸡腿榜', desc: '', route: 'MeleeRankScreen', icon: ICONS.MeleeRank },
  { title: '数据库', desc: '', route: 'DatabaseScreen', icon: ICONS.Database },
  { title: '发票', desc: '', route: 'InvoiceScreen', icon: ICONS.Invoice },
];

interface LiveCardItem {
  liveId: string;
  title: string;
  nickname: string;
  cover: string;
}

function normalizeLiveList(res: any): LiveCardItem[] {
  const source = unwrapList(res, [
    'content.liveList', 'content.list', 'content.data', 'content.records',
    'data.liveList', 'liveList', 'list', 'data',
  ]);
  return source
    .map((raw: any, index: number) => ({
      liveId: String(pickText(raw, ['liveId', 'id', 'live_id', 'roomId'], String(index))),
      title: pickText(raw, ['title', 'liveTitle', 'liveRoomTitle', 'roomName', 'subject'], ''),
      nickname: pickText(raw, ['nickname', 'nickName', 'userInfo.nickname', 'userInfo.nickName', 'ownerName'], ''),
      cover: normalizeUrl(pickText(raw, ['liveCover', 'coverPath', 'cover', 'coverUrl', 'picPath', 'picturePath', 'imageUrl', 'poster', 'thumb', 'userInfo.avatar'], '')),
    }))
    .filter((item: LiveCardItem) => item.title)
    .slice(0, 8);
}

/** 首页全宽沉浸直播 banner（16:9）：渐变 + 白字上浮 + 直播中红标 */
function LiveBanner({ item, onPress }: { item: LiveCardItem; onPress: () => void }) {
  const palette = usePalette();
  const [broken, setBroken] = useState(false);
  return (
    <ScalePressable style={styles.liveBanner} onPress={onPress} pressedScale={0.98}>
      <View style={[styles.liveBannerWrap, { backgroundColor: palette.fill3, borderColor: palette.hairline, borderWidth: StyleSheet.hairlineWidth }]}>
        {!broken && item.cover ? (
          <NetworkImage
            source={{ uri: item.cover }}
            style={styles.liveBannerCover}
            resizeMode="cover"
            onError={() => setBroken(true)}
          />
        ) : (
          <View style={styles.liveBannerFallback}>
            <MaterialCommunityIcons name="video" color={palette.labelTertiary} size={44} />
          </View>
        )}
        <View pointerEvents="none" style={styles.liveBannerShade1} />
        <View pointerEvents="none" style={styles.liveBannerShade2} />
        <View pointerEvents="none" style={styles.liveBannerShade3} />
        <View style={[styles.liveBadge, styles.liveBannerBadge]}>
          <Text style={styles.liveBadgeText}>直播中</Text>
        </View>
        <View style={styles.liveBannerInfo}>
          <Text style={styles.liveBannerTitle} numberOfLines={2}>{item.title}</Text>
          <Text style={styles.liveBannerNick} numberOfLines={1}>{item.nickname}</Text>
        </View>
      </View>
    </ScalePressable>
  );
}

export default function HomeScreen() {
  const navigation = useNavigation<HomeNavProp>();
  const settings = useSettingsStore((state) => state.settings);
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const membersCount = useMemberStore((s) => s.members.length);
  const token = settings.p48Token;

  const [lives, setLives] = useState<LiveCardItem[]>([]);
  const [livesOk, setLivesOk] = useState(false);
  const [bannerIndex, setBannerIndex] = useState(0);
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    pocketApi
      .getLiveList({ groupId: 0, liveType: 0, next: 0, record: false })
      .then((res: any) => {
        const list = normalizeLiveList(res);
        if (list.length > 0) {
          setLives(list);
          setLivesOk(true);
        }
      })
      .catch(() => {});
  }, []);

  // banner 轮播：2.5s 自动切换下一条（最多轮前 4 条）
  const bannerCount = Math.min(4, lives.length);
  useEffect(() => {
    if (bannerCount <= 1) return;
    const timer = setInterval(() => {
      setBannerIndex((i) => (i + 1) % bannerCount);
    }, 2500);
    return () => clearInterval(timer);
  }, [bannerCount]);

  // 原子化订阅：queue 引用仅在队列变化时更新，position 高频写入不触发首页重渲染
  const musicQueue = useMusicPlayerStore((s) => s.queue);
  const musicIndex = useMusicPlayerStore((s) => s.currentIndex);
  const currentTrack = musicQueue[musicIndex] || null;

  const handleNav = useCallback((item: NavItem) => {
    if (item.params) (navigation as any).navigate(item.route, item.params);
    else (navigation as any).navigate(item.route);
  }, [navigation]);

  const handleResumeMusic = useCallback(() => {
    const s = useMusicPlayerStore.getState();
    if (!s.queue[s.currentIndex]) return;
    s.play(s.queue[s.currentIndex], s.queue);
    handleNav({ title: '', desc: '', route: 'MusicLibraryScreen', icon: '' });
  }, [handleNav]);

  const hour = new Date().getHours();
  const greeting =
    hour < 5 ? t('夜深了') : hour < 11 ? t('早上好') : hour < 14 ? t('中午好') : hour < 18 ? t('下午好') : t('晚上好');

  const quick = QUICK.map((i) => ({ ...i, title: t(i.title) }));
  const toolChips = TOOL_CHIPS.map((i) => ({ ...i, title: t(i.title) }));

  const banner = lives[bannerIndex];
  const gridLives = bannerCount > 0 ? lives.slice(bannerCount) : [];

  const trackTitle = currentTrack?.title || '';
  const trackArtist = currentTrack?.joinMemberNames || currentTrack?.artist || '';

  const openLive = useCallback((item: LiveCardItem) => {
    (navigation as any).navigate('Media', {
      mode: 'live',
      playLiveId: item.liveId,
      playTitle: item.title,
      playCover: item.cover,
      playNonce: Date.now(),
    });
  }, [navigation]);

  return (
    <View style={[styles.outer, { backgroundColor: palette.background }]}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingTop: insets.top + 4,
          paddingBottom: 84 + insets.bottom,
          paddingHorizontal: spacing.md,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* 问候区：大标题 + 一行问候，去掉日期行 */}
        <Text style={[styles.homeTitle, { color: palette.label, marginBottom: 3 }]}>
          {t('牙牙消息')}
        </Text>
        <Text style={[typography.subhead, { color: palette.labelSecondary, marginBottom: 16 }]}>
          {t('{g} · 已收录 {n} 位成员', { g: greeting, n: membersCount || '—' })}
        </Text>

        {!token ? (
          <ScalePressable style={{ marginBottom: 18 }} onPress={() => handleNav({ title: '', desc: '', route: 'LoginScreen', icon: '' })}>
            <GlassCard strong padding={14} radius={20} style={{ borderColor: palette.danger }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <View style={[styles.loginBadge, { backgroundColor: palette.tintSoft }]}>
                  <MaterialCommunityIcons name="key-variant" color={palette.tint} size={20} />
                </View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={[typography.headline, { color: palette.label }]}>{t('未登录口袋账号')}</Text>
                  <Text style={[typography.footnote, { color: palette.labelSecondary, marginTop: 3, lineHeight: 18 }]}>
                    {t('消息、私信、翻牌需要登录；点此粘贴 token')}
                  </Text>
                </View>
                <MaterialCommunityIcons name="chevron-right" color={palette.labelTertiary} size={20} />
              </View>
            </GlassCard>
          </ScalePressable>
        ) : null}

        {/* 正在直播：首条全宽 banner 轮播 + 其余 2 列网格 */}
        {livesOk ? (
          <View style={{ marginBottom: 22 }}>
            <View style={styles.sectionHead}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <View style={[styles.sectionDot, { backgroundColor: palette.tint }]} />
                <Text style={[typography.headline, { color: palette.label, marginLeft: 8 }]}>{t('正在直播')}</Text>
              </View>
              <ScalePressable onPress={() => handleNav({ title: '', desc: '', route: 'Media', icon: '' })}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Text style={[typography.footnote, { color: palette.tint, fontWeight: '700' }]}>{t('全部')}</Text>
                  <MaterialCommunityIcons name="chevron-right" color={palette.tint} size={16} />
                </View>
              </ScalePressable>
            </View>

            {banner ? (
              <View style={{ marginBottom: 12 }}>
                <LiveBanner
                  key={banner.liveId}
                  item={banner}
                  onPress={() => openLive(banner)}
                />
                {bannerCount > 1 ? (
                  <View style={styles.bannerDots}>
                    {lives.slice(0, bannerCount).map((live, i) => (
                      <View
                        key={live.liveId}
                        style={[
                          styles.bannerDot,
                          {
                            backgroundColor: i === bannerIndex ? palette.tint : palette.fill3,
                            width: i === bannerIndex ? 16 : 6,
                          },
                        ]}
                      />
                    ))}
                  </View>
                ) : null}
              </View>
            ) : null}

            {gridLives.length > 0 ? (
              <View style={styles.liveList}>
                {gridLives.map((item) => (
                  <ScalePressable
                    key={item.liveId}
                    onPress={() => openLive(item)}
                    pressedScale={0.97}
                    style={[styles.liveRow, { backgroundColor: palette.surface, borderColor: palette.hairline, borderWidth: StyleSheet.hairlineWidth }]}
                  >
                    <View style={[styles.liveRowThumb, { backgroundColor: palette.fill3 }]}>
                      {item.cover ? (
                        <NetworkImage source={{ uri: item.cover }} style={styles.liveRowThumb} resizeMode="cover" />
                      ) : (
                        <View style={styles.liveRowThumbFallback}>
                          <MaterialCommunityIcons name="video" color={palette.labelTertiary} size={18} />
                        </View>
                      )}
                    </View>
                    <View style={{ flex: 1, marginLeft: 12, minWidth: 0 }}>
                      <Text style={[styles.liveRowTitle, { color: palette.label }]} numberOfLines={1}>{item.title}</Text>
                      <Text style={[styles.liveRowNick, { color: palette.labelSecondary }]} numberOfLines={1}>{item.nickname}</Text>
                    </View>
                    <MaterialCommunityIcons name="chevron-right" color={palette.labelTertiary} size={18} />
                  </ScalePressable>
                ))}
              </View>
            ) : null}
          </View>
        ) : null}

        {/* 快捷入口：单行 4 个 */}
        <View style={{ marginBottom: 22 }}>
          <View style={styles.sectionHead}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View style={[styles.sectionDot, { backgroundColor: palette.tint }]} />
              <Text style={[typography.headline, { color: palette.label, marginLeft: 8 }]}>{t('快捷入口')}</Text>
            </View>
          </View>
          <View style={styles.quickRow}>
            {quick.map((item) => (
              <ScalePressable
                key={item.title}
                onPress={() => handleNav(item)}
                pressedScale={0.94}
                style={styles.quickCell}
              >
                <View
                  style={[
                    styles.chip,
                    {
                      backgroundColor: palette.surfaceGlassStrong,
                      borderColor: palette.innerStroke,
                    },
                  ]}
                >
                  <View style={[styles.chipIcon, { backgroundColor: palette.tintSoft }]}>
                    <MaterialCommunityIcons name={item.icon} color={palette.tint} size={16} />
                  </View>
                  <Text style={[typography.footnote, { color: palette.label, fontWeight: '600' }]} numberOfLines={1}>{item.title}</Text>
                </View>
              </ScalePressable>
            ))}
          </View>
        </View>

        {/* 最近播放 */}
        {currentTrack && trackTitle ? (
          <View style={{ marginBottom: 22 }}>
            <View style={styles.sectionHead}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <View style={[styles.sectionDot, { backgroundColor: palette.tint }]} />
                <Text style={[typography.headline, { color: palette.label, marginLeft: 8 }]}>{t('最近播放')}</Text>
              </View>
            </View>
            <ScalePressable onPress={handleResumeMusic} pressedScale={0.97}>
              <GlassCard strong padding={12} radius={20}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <View style={[styles.musicCover, { backgroundColor: palette.tintSoft }]}>
                    {currentTrack?.coverUrl || currentTrack?.cover ? (
                      <NetworkImage
                        source={{ uri: (currentTrack.coverUrl || currentTrack.cover || '') as string }}
                        style={styles.musicCover}
                        resizeMode="cover"
                      />
                    ) : (
                      <MaterialCommunityIcons name="music-note" color={palette.tint} size={24} />
                    )}
                  </View>
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={[typography.headline, { color: palette.label }]} numberOfLines={1}>{trackTitle}</Text>
                    {trackArtist ? (
                      <Text style={[typography.footnote, { color: palette.labelSecondary, marginTop: 2 }]} numberOfLines={1}>
                        {trackArtist}
                      </Text>
                    ) : null}
                  </View>
                  <Pill label={t('继续播放')} accent />
                </View>
              </GlassCard>
            </ScalePressable>
          </View>
        ) : null}

        {/* 工具：单行横向 chips */}
        <View style={{ marginBottom: 8 }}>
          <View style={styles.sectionHead}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View style={[styles.sectionDot, { backgroundColor: palette.tint }]} />
              <Text style={[typography.headline, { color: palette.label, marginLeft: 8 }]}>{t('工具')}</Text>
            </View>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.toolChipsContent}
            style={{ marginHorizontal: -spacing.md }}
          >
            {toolChips.map((item) => (
              <ScalePressable
                key={item.title}
                onPress={() => handleNav(item)}
                pressedScale={0.94}
                style={[styles.toolChip, { backgroundColor: palette.surfaceGlassStrong, borderColor: palette.innerStroke }]}
              >
                <MaterialCommunityIcons name={item.icon} color={palette.tint} size={16} />
                <Text style={[typography.footnote, { color: palette.label, fontWeight: '600', marginLeft: 6 }]} numberOfLines={1}>{item.title}</Text>
              </ScalePressable>
            ))}
          </ScrollView>
        </View>

        <Text
          style={[
            typography.caption1,
            { color: palette.labelTertiary, textAlign: 'center', marginTop: 8, marginBottom: 24 },
          ]}
        >
          {t('Presented by Xenia')}
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: { flex: 1 },
  homeTitle: { fontSize: 24, lineHeight: 30, fontWeight: '800', letterSpacing: -0.3 },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  sectionDot: { width: 4, height: 18, borderRadius: 2 },
  loginBadge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  liveBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 3,
    gap: 4,
  },
  liveBadgeText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  // 首页全宽直播 banner（16:9 沉浸）
  liveBanner: { width: '100%' },
  liveBannerWrap: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.14,
    shadowRadius: 14,
    elevation: 4,
  },
  liveBannerCover: { width: '100%', height: '100%' },
  liveBannerFallback: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  liveBannerShade1: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '55%', backgroundColor: 'rgba(0,0,0,0.10)' },
  liveBannerShade2: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '38%', backgroundColor: 'rgba(0,0,0,0.22)' },
  liveBannerShade3: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '22%', backgroundColor: 'rgba(0,0,0,0.42)' },
  liveBannerBadge: { top: 12, left: 12 },
  liveBannerInfo: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 14, paddingBottom: 12 },
  liveBannerTitle: { color: '#FFFFFF', fontSize: 18, fontWeight: '800', lineHeight: 24, textShadowColor: 'rgba(0,0,0,0.65)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 },
  liveBannerNick: { color: 'rgba(255,255,255,0.88)', fontSize: 12, marginTop: 3, textShadowColor: 'rgba(0,0,0,0.55)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2 },
  bannerDots: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, marginTop: 8 },
  bannerDot: { height: 6, borderRadius: 3 },
  liveList: { gap: 8 },
  liveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 16,
  },
  liveRowThumb: {
    width: 52,
    height: 52,
    borderRadius: 12,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  liveRowThumbFallback: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  liveRowTitle: { fontSize: 13, fontWeight: '700' },
  liveRowNick: { fontSize: 11, marginTop: 3 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    paddingRight: 12,
    paddingVertical: 7,
  },
  quickRow: {
    flexDirection: 'row',
    gap: 8,
  },
  quickCell: {
    flexBasis: '24%',
    flexGrow: 1,
  },
  chipIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
    marginLeft: 6,
  },
  musicCover: { width: 52, height: 52, borderRadius: 12, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  toolChipsContent: { paddingRight: 8, gap: 8, paddingHorizontal: spacing.md },
  toolChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
