/**
 * HomeScreen · iOS 26 Liquid Glass
 *  - 顶部 largeTitle + 副标题（welcome）
 *  - 未登录提示（玻璃卡片 + 警示色）
 *  - 分组卡片（玻璃风），组内 2 列网格（flexWrap 实现，避开 FlatList numColumns 雷）
 *  - 滚动渐入动画（spring 重做，路线统一）
 */
import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { CompositeNavigationProp } from '@react-navigation/native';
import { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { StackNavigationProp } from '@react-navigation/stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RootStackParamList, TabParamList } from '../navigation/types';
import { useMemberStore, useSettingsStore } from '../store';
import { usePalette, spacing, motion } from '../theme';
import { typography } from '../theme/typography';
import { GlassCard } from '../components/GlassCard';
import { Pill } from '../components/Pill';
import { useI18n } from '../i18n';
import { ScalePressable } from '../components/Motion';

type HomeNavProp = CompositeNavigationProp<
  BottomTabNavigationProp<TabParamList, 'Home'>,
  StackNavigationProp<RootStackParamList>
>;

interface NavItem {
  title: string;
  desc: string;
  route: string;
  params?: any;
  icon?: string;
}

interface CardSection {
  title: string;
  subtitle: string;
  items: NavItem[];
}

// iOS 风格 emoji 当 leading 视觉锚（不依赖 vector icons 全套映射；后续可换图）
const EMOJI: Record<string, string> = {
  LiveRoom: '🎙️',
  Vod: '📺',
  RoomRadio: '🎧',
  Bilibili: '📡',
  Rooms: '💌',
  PrivateMessages: '✉️',
  RoomAlbum: '🖼️',
  OpenLive: '🎭',
  FlipSend: '🃏',
  FlipHistory: '🗂️',
  Analysis: '📊',
  Profile: '👤',
  MemberDynamic: '✨',
  MemberWeibo: '🧣',
  Trip: '🧳',
  VideoLibrary: '🎬',
  MusicLibrary: '🎵',
  AudioPrograms: '📻',
  MeleeRank: '🍗',
  Database: '🗃️',
  Login: '🔑',
  Download: '⏬',
  Invoice: '🧾',
  Settings: '⚙️',
};

const CARDS: CardSection[] = [
  {
    title: '直播',
    subtitle: '口袋、B站、回放、电台',
    items: [
      { title: '直播', desc: '查看当前直播列表', route: 'Media', icon: EMOJI.LiveRoom },
      { title: '回放', desc: '录播与弹幕', route: 'Media', params: { mode: 'vod' }, icon: EMOJI.Vod },
      { title: '上麦', desc: '房间电台', route: 'RoomRadioScreen', icon: EMOJI.RoomRadio },
      { title: 'B站', desc: 'B站直播播放', route: 'BilibiliLiveScreen', icon: EMOJI.Bilibili },
    ],
  },
  {
    title: '口袋',
    subtitle: '房间、私信、相册、公演',
    items: [
      { title: '房间', desc: '关注房间消息', route: 'Rooms', icon: EMOJI.Rooms },
      { title: '私信', desc: '口袋私信会话', route: 'PrivateMessagesScreen', icon: EMOJI.PrivateMessages },
      { title: '相册', desc: '按房间查看图片', route: 'RoomAlbumScreen', icon: EMOJI.RoomAlbum },
      { title: '公演', desc: '成员公演记录', route: 'OpenLiveScreen', icon: EMOJI.OpenLive },
    ],
  },
  {
    title: '翻牌',
    subtitle: '提问、历史、统计',
    items: [
      { title: '提问', desc: '发送翻牌', route: 'FlipScreen', params: { mode: 'send' }, icon: EMOJI.FlipSend },
      { title: '历史', desc: '浏览翻牌内容', route: 'FlipScreen', icon: EMOJI.FlipHistory },
      { title: '统计', desc: '翻牌数据分析', route: 'AnalysisScreen', icon: EMOJI.Analysis },
    ],
  },
  {
    title: '成员',
    subtitle: '档案、动态、微博、行程',
    items: [
      { title: '档案', desc: '成员资料与编年史', route: 'ProfileScreen', icon: EMOJI.Profile },
      { title: '动态', desc: '成员口袋动态', route: 'MemberDynamicScreen', icon: EMOJI.MemberDynamic },
      { title: '微博', desc: '成员微博动态', route: 'MemberWeiboScreen', icon: EMOJI.MemberWeibo },
      { title: '行程', desc: '行程与票务', route: 'TripScreen', icon: EMOJI.Trip },
    ],
  },
  {
    title: '资源',
    subtitle: '视频、音乐、电台',
    items: [
      { title: '视频', desc: '查看视频资源', route: 'VideoLibraryScreen', icon: EMOJI.VideoLibrary },
      { title: '音乐', desc: '进入音乐列表', route: 'MusicLibraryScreen', icon: EMOJI.MusicLibrary },
      { title: '电台', desc: '播放音频节目', route: 'AudioProgramsScreen', icon: EMOJI.AudioPrograms },
    ],
  },
  {
    title: '工具',
    subtitle: '统计、数据库、设置',
    items: [
      { title: '鸡腿榜', desc: '鸡腿乱斗排名', route: 'MeleeRankScreen', icon: EMOJI.MeleeRank },
      { title: '数据库', desc: '成员附属数据', route: 'DatabaseScreen', icon: EMOJI.Database },
      { title: '账号', desc: '登录与头像', route: 'LoginScreen', icon: EMOJI.Login },
      { title: '下载', desc: '录播/图片/视频', route: 'DownloadScreen', icon: EMOJI.Download },
      { title: '发票', desc: '鸡腿消费开票', route: 'InvoiceScreen', icon: EMOJI.Invoice },
      { title: '设置', desc: '主题与签到', route: 'Settings', icon: EMOJI.Settings },
    ],
  },
];

export default function HomeScreen() {
  const navigation = useNavigation<HomeNavProp>();
  const settings = useSettingsStore((state) => state.settings);
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const token = settings.p48Token;
  const membersCount = useMemberStore((s) => s.members.length);
  const [showTip, setShowTip] = useState(true);

  useEffect(() => {
    setShowTip(true);
    const timer = setTimeout(() => setShowTip(false), 4000);
    return () => clearTimeout(timer);
  }, [token]);

  const handleNav = (item: NavItem) => {
    if (item.params) (navigation as any).navigate(item.route, item.params);
    else (navigation as any).navigate(item.route);
  };

  const cards = CARDS.map((g) => ({
    ...g,
    title: t(g.title),
    subtitle: t(g.subtitle),
    items: g.items.map((i) => ({ ...i, title: t(i.title), desc: t(i.desc) })),
  }));

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
        <Text style={[typography.largeTitle, { color: palette.label, marginBottom: 4 }]}>
          {t('牙牙消息')}
        </Text>
        <Text style={[typography.subhead, { color: palette.labelSecondary, marginBottom: 22 }]}>
          {t('欢迎回来 · 已收录 {n} 位成员', { n: membersCount || '—' })}
        </Text>

        {showTip && !token ? (
          <GlassCard
            strong
            padding={16}
            radius={20}
            style={{ marginBottom: 18, borderColor: palette.danger }}
            tint={palette.name === 'dark' ? 'plain' : 'pink'}
          >
            <Text style={[typography.headline, { color: palette.danger }]}>{t('未登录口袋账号')}</Text>
            <Text
              style={[
                typography.subhead,
                { color: palette.labelSecondary, marginTop: 6, lineHeight: 20 },
              ]}
            >
              {t('成员库、资源和公开数据可直接查看；消息、私信、翻牌等需要登录或粘贴 token。')}
            </Text>
          </GlassCard>
        ) : null}

        {cards.map((card) => (
          <View key={card.title} style={{ marginBottom: 18 }}>
            <Text style={[typography.headline, { color: palette.label, marginBottom: 4 }]}>
              {card.title}
            </Text>
            <Text style={[typography.footnote, { color: palette.labelTertiary, marginBottom: 10 }]}>
              {card.subtitle}
            </Text>
            <View style={styles.grid}>
              {card.items.map((item) => (
                <ScalePressable
                  key={`${card.title}-${item.title}`}
                  style={styles.gridCell}
                  onPress={() => handleNav(item)}
                  pressedScale={0.97}
                >
                  <GlassCard padding={14} radius={20} strong={false}>
                    <View style={styles.cellTop}>
                      <Text style={{ fontSize: 28 }}>{item.icon || '•'}</Text>
                      <Pill label={item.title} accent />
                    </View>
                    <Text
                      style={[
                        typography.footnote,
                        { color: palette.labelSecondary, marginTop: 8, lineHeight: 18 },
                      ]}
                      numberOfLines={2}
                    >
                      {item.desc}
                    </Text>
                  </GlassCard>
                </ScalePressable>
              ))}
            </View>
          </View>
        ))}

        <Text
          style={[
            typography.caption1,
            {
              color: palette.labelTertiary,
              textAlign: 'center',
              marginTop: 12,
              marginBottom: 24,
            },
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
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  gridCell: {
    flexBasis: '48%',
    flexGrow: 1,
  },
  cellTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
});

// re-export for callers using motion spring in entry transitions (entry screen)
export { motion };
