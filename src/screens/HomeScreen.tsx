import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { CompositeNavigationProp, useNavigation } from '@react-navigation/native';
import { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList, TabParamList } from '../navigation/types';
import { useMemberStore, useSettingsStore } from '../store';
import { FadeInView, ScalePressable } from '../components/Motion';

type HomeNavProp = CompositeNavigationProp<
  BottomTabNavigationProp<TabParamList, 'Home'>,
  StackNavigationProp<RootStackParamList>
>;

interface NavItem {
  title: string;
  desc: string;
  route: string;
  params?: any;
}

interface CardSection {
  title: string;
  subtitle: string;
  items: NavItem[];
}

const CARDS: CardSection[] = [
  {
    title: '直播',
    subtitle: '口袋直播、回放、B站源',
    items: [
      { title: '直播', desc: '查看当前直播列表', route: 'Media' },
      { title: '回放', desc: '进入录播与弹幕页', route: 'Media', params: { mode: 'vod' } },
      { title: '上麦', desc: '进入房间电台', route: 'RoomRadioScreen' },
      { title: 'B站', desc: '进入B站直播播放', route: 'BilibiliLiveScreen' },
    ],
  },
  {
    title: '口袋',
    subtitle: '关注房间、私信、相册、公演',
    items: [
      { title: '房间', desc: '关注房间和历史消息', route: 'Rooms' },
      { title: '私信', desc: '口袋私信会话', route: 'PrivateMessagesScreen' },
      { title: '相册', desc: '按房间查看图片', route: 'RoomAlbumScreen' },
      { title: '公演记录', desc: '成员公演与活动记录', route: 'OpenLiveScreen' },
    ],
  },
  {
    title: '翻牌',
    subtitle: '翻牌、个人相册',
    items: [
      { title: '提问', desc: '进入翻牌发送入口', route: 'FlipScreen', params: { mode: 'send' } },
      { title: '历史', desc: '浏览历史翻牌内容', route: 'FlipScreen' },
      { title: '房间相册', desc: '按大小房间获取图片和视频', route: 'RoomAlbumScreen' },
    ],
  },
  {
    title: '资源',
    subtitle: '官方视频、音乐、电台资源',
    items: [
      { title: '视频', desc: '查看视频资源', route: 'VideoLibraryScreen' },
      { title: '音乐', desc: '进入音乐列表', route: 'MusicLibraryScreen' },
      { title: '电台', desc: '播放音频节目', route: 'AudioProgramsScreen' },
    ],
  },
  {
    title: '数据',
    subtitle: '成员档案、分析统计',
    items: [
      { title: '成员档案', desc: '成员资料与细节', route: 'ProfileScreen' },
      { title: '数据分析', desc: '房间/翻牌/礼物统计', route: 'AnalysisScreen' },
      { title: '数据库', desc: '查看附属数据', route: 'DatabaseScreen' },
    ],
  },
  {
    title: '通用',
    subtitle: '账号、下载、小号和软件设置',
    items: [
      { title: '账号资料', desc: '口袋/B站/头像/昵称', route: 'LoginScreen' },
      { title: '下载管理', desc: '录播/语音/图片/视频', route: 'DownloadScreen' },
      { title: '小号切换', desc: '按口袋大小号列表切换', route: 'LoginScreen' },
      { title: '软件设置', desc: '主题、签到和接口工具', route: 'Settings' },
    ],
  },
];

export default function HomeScreen() {
  const navigation = useNavigation<HomeNavProp>();
  const settings = useSettingsStore((state) => state.settings);
  const isDark = settings.theme === 'dark';
  const hasBackground = !!settings.customBackgroundFile?.trim();
  const token = settings.p48Token;
  const membersLoaded = useMemberStore((state) => state.membersLoaded);
  const members = useMemberStore((state) => state.members);
  const [showTip, setShowTip] = useState(true);

  useEffect(() => {
    setShowTip(true);
    const timer = setTimeout(() => setShowTip(false), 3000);
    return () => clearTimeout(timer);
  }, [token]);

  const handleNav = (item: NavItem) => {
    if (item.params) (navigation as any).navigate(item.route, item.params);
    else (navigation as any).navigate(item.route);
  };

  return (
    <View style={[styles.container, isDark && styles.containerDark]}>
      <FadeInView style={styles.header} distance={8}>
        <Text style={styles.headerTitle}>牙牙消息</Text>
        <Text style={[styles.headerSub, isDark && styles.headerSubDark]}>成员 {membersLoaded ? members.length : 0} 位</Text>
      </FadeInView>

      {showTip && !token ? (
        <FadeInView style={[styles.warnBanner, isDark && styles.warnBannerDark]} delay={80} distance={8}>
          <Text style={styles.warnTitle}>未登录口袋账号</Text>
          <Text style={[styles.warnText, isDark && styles.warnTextDark]}>成员库、资源和公开数据可直接查看；消息、私信、翻牌等需要登录或粘贴 token。</Text>
        </FadeInView>
      ) : null}

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {CARDS.map((card, index) => (
          <FadeInView
            key={card.title}
            style={[styles.card, hasBackground && styles.cardOnImage, isDark && styles.cardDark]}
            delay={60 + index * 35}
            distance={12}
          >
            <Text style={styles.cardTitle}>{card.title}</Text>
            <Text style={[styles.cardSub, isDark && styles.cardSubDark]}>{card.subtitle}</Text>
            <View style={styles.cardGrid}>
              {card.items.map((item) => (
                <ScalePressable
                  key={`${card.title}-${item.title}`}
                  style={[styles.cardItem, hasBackground && styles.cardItemOnImage, isDark && styles.cardItemDark]}
                  onPress={() => handleNav(item)}
                  pressedScale={0.97}
                >
                  <Text style={[styles.cardItemTitle, isDark && styles.cardItemTitleDark]}>{item.title}</Text>
                  <Text style={[styles.cardItemDesc, isDark && styles.cardItemDescDark]}>{item.desc}</Text>
                </ScalePressable>
              ))}
            </View>
          </FadeInView>
        ))}
        <Text style={[styles.footer, isDark && styles.footerDark]}>presented by Xenia</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  containerDark: { backgroundColor: 'transparent' },
  header: { paddingTop: 40, paddingHorizontal: 18, paddingBottom: 8 },
  headerTitle: { fontSize: 20, fontWeight: 'bold', color: '#ff6f91' },
  headerSub: { fontSize: 11, color: '#555555', marginTop: 2 },
  headerSubDark: { color: '#d7d7d7' },
  warnBanner: { marginHorizontal: 12, marginBottom: 8, padding: 12, backgroundColor: '#fff3cd', borderRadius: 16, borderLeftWidth: 3, borderLeftColor: '#ff9800' },
  warnBannerDark: { backgroundColor: 'rgba(58,44,18,0.62)', borderLeftColor: '#ffb74d' },
  warnTitle: { fontSize: 13, fontWeight: '700', color: '#e65100', marginBottom: 4 },
  warnText: { fontSize: 12, color: '#444', lineHeight: 18 },
  warnTextDark: { color: '#f3dca2' },
  scroll: { flex: 1 },
  scrollContent: { padding: 12, paddingBottom: 112 },
  card: { backgroundColor: '#ffffff', borderRadius: 18, padding: 14, marginBottom: 10, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.84)', shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 2 },
  cardOnImage: { backgroundColor: 'rgba(255,255,255,0.62)', borderColor: 'rgba(255,255,255,0.68)' },
  cardDark: { backgroundColor: 'rgba(20,20,20,0.62)', borderColor: 'rgba(255,255,255,0.10)' },
  cardTitle: { fontSize: 16, fontWeight: '700', color: '#ff6f91', marginBottom: 2 },
  cardSub: { fontSize: 11, color: '#555555', marginBottom: 10 },
  cardSubDark: { color: '#eeeeee' },
  cardGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  cardItem: { flex: 1, minWidth: '45%', backgroundColor: 'rgba(248,248,248,0.80)', borderRadius: 16, padding: 10, borderWidth: 1, borderColor: 'rgba(248,248,248,0.80)' },
  cardItemOnImage: { backgroundColor: 'rgba(255,255,255,0.34)', borderColor: 'rgba(255,255,255,0.34)' },
  cardItemDark: { backgroundColor: 'rgba(35,35,35,0.64)', borderColor: 'rgba(42,42,42,0.32)' },
  cardItemTitle: { fontSize: 13, fontWeight: '700', color: '#333' },
  cardItemTitleDark: { color: '#f4f4f4' },
  cardItemDesc: { fontSize: 10, color: '#555555', marginTop: 2 },
  cardItemDescDark: { color: '#d0d0d0' },
  footer: { textAlign: 'center', color: '#555', fontSize: 10, marginTop: 8 },
  footerDark: { color: '#c8c8c8' },
});
