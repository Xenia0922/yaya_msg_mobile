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

interface ToolGroup {
  title: string;
  subtitle: string;
  items: NavItem[];
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
  { title: 'B站', desc: '', route: 'BilibiliLiveScreen', icon: ICONS.Bilibili },
  { title: '音乐', desc: '', route: 'MusicLibraryScreen', icon: ICONS.MusicLibrary },
  { title: '私信', desc: '', route: 'PrivateMessagesScreen', icon: ICONS.PrivateMessages },
  { title: '翻牌', desc: '', route: 'FlipScreen', icon: ICONS.FlipSend },
];

const TOOL_GROUPS: ToolGroup[] = [
  {
    title: '直播',
    subtitle: '口袋、B站、回放、电台',
    items: [
      { title: '直播', desc: '查看当前直播列表', route: 'Media', icon: ICONS.LiveRoom },
      { title: '回放', desc: '录播与弹幕', route: 'Media', params: { mode: 'vod' }, icon: ICONS.Vod },
      { title: '上麦', desc: '房间电台', route: 'RoomRadioScreen', icon: ICONS.RoomRadio },
      { title: 'B站', desc: 'B站直播播放', route: 'BilibiliLiveScreen', icon: ICONS.Bilibili },
    ],
  },
  {
    title: '口袋',
    subtitle: '房间、私信、相册、公演',
    items: [
      { title: '房间', desc: '关注房间消息', route: 'Rooms', icon: ICONS.Rooms },
      { title: '私信', desc: '口袋私信会话', route: 'PrivateMessagesScreen', icon: ICONS.PrivateMessages },
      { title: '相册', desc: '按房间查看图片', route: 'RoomAlbumScreen', icon: ICONS.RoomAlbum },
      { title: '公演', desc: '成员公演记录', route: 'OpenLiveScreen', icon: ICONS.OpenLive },
    ],
  },
  {
    title: '翻牌',
    subtitle: '提问、历史、统计',
    items: [
      { title: '提问', desc: '发送翻牌', route: 'FlipScreen', params: { mode: 'send' }, icon: ICONS.FlipSend },
      { title: '历史', desc: '浏览翻牌内容', route: 'FlipScreen', icon: ICONS.FlipHistory },
      { title: '统计', desc: '翻牌数据分析', route: 'AnalysisScreen', icon: ICONS.Analysis },
    ],
  },
  {
    title: '成员',
    subtitle: '档案、动态、微博、行程',
    items: [
      { title: '档案', desc: '成员资料与编年史', route: 'ProfileScreen', icon: ICONS.Profile },
      { title: '动态', desc: '成员口袋动态', route: 'MemberDynamicScreen', icon: ICONS.MemberDynamic },
      { title: '微博', desc: '成员微博动态', route: 'MemberWeiboScreen', icon: ICONS.MemberWeibo },
      { title: '行程', desc: '行程与票务', route: 'TripScreen', icon: ICONS.Trip },
    ],
  },
  {
    title: '资源',
    subtitle: '视频、音乐、电台',
    items: [
      { title: '视频', desc: '查看视频资源', route: 'VideoLibraryScreen', icon: ICONS.VideoLibrary },
      { title: '音乐', desc: '进入音乐列表', route: 'MusicLibraryScreen', icon: ICONS.MusicLibrary },
      { title: '电台', desc: '播放音频节目', route: 'AudioProgramsScreen', icon: ICONS.AudioPrograms },
    ],
  },
  {
    title: '工具',
    subtitle: '统计、数据库、设置',
    items: [
      { title: '鸡腿榜', desc: '鸡腿乱斗排名', route: 'MeleeRankScreen', icon: ICONS.MeleeRank },
      { title: '数据库', desc: '成员附属数据', route: 'DatabaseScreen', icon: ICONS.Database },
      { title: '账号', desc: '登录与头像', route: 'LoginScreen', icon: ICONS.Login },
      { title: '下载', desc: '录播/图片/视频', route: 'DownloadScreen', icon: ICONS.Download },
      { title: '发票', desc: '鸡腿消费开票', route: 'InvoiceScreen', icon: ICONS.Invoice },
      { title: '设置', desc: '主题与签到', route: 'Settings', icon: ICONS.Settings },
    ],
  },
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

function LiveCard({ item, onPress }: { item: LiveCardItem; onPress: () => void }) {
  const palette = usePalette();
  const [broken, setBroken] = useState(false);
  return (
    <ScalePressable style={styles.liveCard} onPress={onPress} pressedScale={0.96}>
      <GlassCard padding={0} radius={20}>
        <View style={[styles.liveCoverWrap, { backgroundColor: palette.fill3 }]}>
          {!broken && item.cover ? (
            <NetworkImage
              source={{ uri: item.cover }}
              style={styles.liveCover}
              resizeMode="cover"
              onError={() => setBroken(true)}
            />
          ) : (
            <View style={styles.liveCoverFallback}>
              <MaterialCommunityIcons name="video" color={palette.labelTertiary} size={36} />
            </View>
          )}
          <View style={styles.liveBadge}>
            <View style={[styles.liveDot, { backgroundColor: '#FF3B30' }]} />
            <Text style={styles.liveBadgeText}>直播中</Text>
          </View>
        </View>
        <View style={{ padding: 10 }}>
          <Text style={[typography.footnote, { color: palette.label, fontWeight: '700' }]} numberOfLines={1}>
            {item.title}
          </Text>
          <Text style={[typography.caption2, { color: palette.labelSecondary, marginTop: 3 }]} numberOfLines={1}>
            {item.nickname}
          </Text>
        </View>
      </GlassCard>
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
  const [expanded, setExpanded] = useState<string>(TOOL_GROUPS[0]?.title || '');
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

  const currentTrack = useMusicPlayerStore((s) =>
    s.queue[s.currentIndex] ? { ...s.queue[s.currentIndex] } : null,
  );

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

  const groups = TOOL_GROUPS.map((g) => ({
    ...g,
    title: t(g.title),
    subtitle: t(g.subtitle),
    items: g.items.map((i) => ({ ...i, title: t(i.title), desc: t(i.desc) })),
  }));
  const quick = QUICK.map((i) => ({ ...i, title: t(i.title) }));

  const trackTitle = currentTrack?.title || '';
  const trackArtist = currentTrack?.joinMemberNames || currentTrack?.artist || '';

  return (
    <View style={[styles.outer, { backgroundColor: palette.background }]}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingTop: insets.top + 4,
          paddingBottom: 100 + insets.bottom,
          paddingHorizontal: spacing.md,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* 问候区 */}
        <Text style={[typography.largeTitle, { color: palette.label, marginBottom: 4 }]}>
          {t('牙牙消息')}
        </Text>
        <Text style={[typography.subhead, { color: palette.labelSecondary, marginBottom: 18 }]}>
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

        {/* 正在直播：真实数据横向轮播 */}
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
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingRight: 8, gap: 12 }}
              style={{ marginHorizontal: -spacing.md }}
              snapToInterval={200}
              decelerationRate="fast"
            >
              {lives.map((item) => (
                <View key={item.liveId} style={{ width: 188, marginLeft: spacing.md }}>
                  <LiveCard
                    item={item}
                    onPress={() => handleNav({ title: '', desc: '', route: 'Media', icon: '' })}
                  />
                </View>
              ))}
            </ScrollView>
          </View>
        ) : null}

        {/* 快捷入口：图标胶囊 */}
        <View style={{ marginBottom: 22 }}>
          <View style={styles.sectionHead}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View style={[styles.sectionDot, { backgroundColor: palette.tint }]} />
              <Text style={[typography.headline, { color: palette.label, marginLeft: 8 }]}>{t('快捷入口')}</Text>
            </View>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 10, paddingRight: 8 }}
            style={{ marginHorizontal: -spacing.md }}
          >
            {quick.map((item) => (
              <ScalePressable key={item.title} onPress={() => handleNav(item)} pressedScale={0.94}>
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
                  <Text style={[typography.footnote, { color: palette.label, fontWeight: '600' }]}>{item.title}</Text>
                </View>
              </ScalePressable>
            ))}
          </ScrollView>
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

        {/* 工具：手风琴分组 */}
        <View style={{ marginBottom: 8 }}>
          <View style={styles.sectionHead}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View style={[styles.sectionDot, { backgroundColor: palette.tint }]} />
              <Text style={[typography.headline, { color: palette.label, marginLeft: 8 }]}>{t('工具')}</Text>
            </View>
          </View>
          {groups.map((group) => {
            const open = expanded === group.title;
            return (
              <GlassCard key={group.title} padding={0} radius={20} style={{ marginBottom: 10 }}>
                <ScalePressable
                  onPress={() => setExpanded(open ? '' : group.title)}
                  pressedScale={0.99}
                  style={styles.accHead}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[typography.headline, { color: palette.label }]}>{group.title}</Text>
                    <Text style={[typography.caption2, { color: palette.labelTertiary, marginTop: 2 }]} numberOfLines={1}>
                      {group.subtitle}
                    </Text>
                  </View>
                  <View style={[styles.accChevron, { backgroundColor: palette.fill2 }]}>
                    <MaterialCommunityIcons
                      name="chevron-down"
                      color={palette.labelSecondary}
                      size={18}
                      style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }}
                    />
                  </View>
                </ScalePressable>
                {open ? (
                  <View style={styles.accGrid}>
                    {group.items.map((item) => (
                      <ScalePressable
                        key={item.title}
                        style={styles.accCell}
                        onPress={() => handleNav(item)}
                        pressedScale={0.95}
                      >
                        <View style={[styles.accCellIcon, { backgroundColor: palette.tintSoft }]}>
                          <MaterialCommunityIcons name={item.icon} color={palette.tint} size={20} />
                        </View>
                        <View style={{ flex: 1, marginLeft: 12 }}>
                          <Text style={[typography.footnote, { color: palette.label, fontWeight: '600' }]} numberOfLines={1}>
                            {item.title}
                          </Text>
                          <Text style={[typography.caption2, { color: palette.labelSecondary, marginTop: 2 }]} numberOfLines={1}>
                            {item.desc}
                          </Text>
                        </View>
                        <MaterialCommunityIcons name="chevron-right" color={palette.labelTertiary} size={18} />
                      </ScalePressable>
                    ))}
                  </View>
                ) : null}
              </GlassCard>
            );
          })}
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
  liveCard: { width: '100%' },
  liveCoverWrap: { height: 106, borderTopLeftRadius: 20, borderTopRightRadius: 20, overflow: 'hidden' },
  liveCover: { width: '100%', height: '100%' },
  liveCoverFallback: {
    flex: 1,
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
  liveDot: { width: 6, height: 6, borderRadius: 3 },
  liveBadgeText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    paddingRight: 14,
    paddingVertical: 6,
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
  accHead: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    paddingHorizontal: 16,
  },
  accChevron: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 10,
  },
  accGrid: {
    paddingHorizontal: 12,
    paddingBottom: 8,
  },
  accCell: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  accCellIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
