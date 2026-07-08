import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSettingsStore } from '../store';
import ScreenHeader from '../components/ScreenHeader';
import { FadeInView } from '../components/Motion';
import pocketApi from '../api/pocket48';
import { errorMessage, unwrapList } from '../utils/data';
import { formatTimestamp } from '../utils/format';

interface ConvItem {
  key: string;
  targetUserId: string;
  name: string;
  avatar: string;
  lastMsg: string;
  lastTime: number;
  unread: number;
}

function normalizeConvItem(raw: any, index: number): ConvItem | null {
  const targetUserId = String(raw.targetUserId || raw.userId || raw.id || '');
  if (!targetUserId) return null;
  return {
    key: targetUserId || `conv-${index}`,
    targetUserId,
    name: String(raw.nickname || raw.userName || raw.name || '').trim(),
    avatar: String(raw.avatar || raw.userAvatar || '').trim(),
    lastMsg: String(raw.lastMessage || raw.lastMsg || raw.message || '').trim(),
    lastTime: Number(raw.lastTime || raw.time || 0),
    unread: Number(raw.unreadNum || raw.unread || raw.noread || 0),
  };
}

export default function ConversationScreen() {
  const navigation = useNavigation<any>();
  const isDark = useSettingsStore((state) => state.settings.theme === 'dark');
  const [items, setItems] = useState<ConvItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await pocketApi.getConversationPage();
      const data = res?.content || res?.data || {};
      const list = unwrapList(data?.conversationList || data?.list || data);
      setItems((Array.isArray(list) ? list : [])
        .map((item: any, idx: number) => normalizeConvItem(item, idx))
        .filter(Boolean) as ConvItem[]);
    } catch (e: any) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, []);

  const renderItem = ({ item, index }: { item: ConvItem; index: number }) => (
    <FadeInView delay={index < 12 ? 80 + index * 30 : 0} duration={300}>
      <TouchableOpacity
        style={[styles.card, isDark && styles.cardDark]}
        onPress={() => navigation.navigate('PrivateMessagesScreen', { targetUserId: item.targetUserId, targetName: item.name })}
        activeOpacity={0.85}
      >
        {item.avatar ? (
          <Image source={{ uri: item.avatar }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, styles.avatarPlaceholder]} />
        )}
        <View style={styles.info}>
          <View style={styles.nameRow}>
            <Text style={[styles.name, isDark && styles.textLight]} numberOfLines={1}>{item.name || '未知用户'}</Text>
            {item.lastTime > 0 ? <Text style={[styles.time, isDark && styles.textSubLight]}>{formatTimestamp(item.lastTime)}</Text> : null}
          </View>
          <Text style={[styles.msg, isDark && styles.textSubLight]} numberOfLines={1}>{item.lastMsg || '暂无消息'}</Text>
        </View>
        {item.unread > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{item.unread > 99 ? '99+' : item.unread}</Text>
          </View>
        )}
      </TouchableOpacity>
    </FadeInView>
  );

  return (
    <View style={[styles.container, isDark && styles.containerDark]}>
      <ScreenHeader title="会话列表" onBack={() => navigation.goBack()} right={
        <TouchableOpacity onPress={fetchData}>
          <Text style={styles.headerAction}>刷新</Text>
        </TouchableOpacity>
      } />
      {error ? (
        <View style={styles.errorWrap}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={fetchData}>
            <Text style={styles.retryText}>重试</Text>
          </TouchableOpacity>
        </View>
      ) : null}
      <FadeInView delay={80} duration={300} style={{ flex: 1 }}>
        <FlatList
          data={items}
          keyExtractor={(item) => item.key}
          contentContainerStyle={styles.list}
          initialNumToRender={12}
          maxToRenderPerBatch={12}
          windowSize={7}
          removeClippedSubviews
          refreshing={loading}
          onRefresh={fetchData}
          renderItem={renderItem}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              {loading ? <ActivityIndicator color="#ff6f91" /> : null}
              <Text style={[styles.empty, isDark && styles.textSubLight]}>
                {loading ? '加载中...' : '暂无会话'}
              </Text>
            </View>
          }
        />
      </FadeInView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  containerDark: { backgroundColor: 'transparent' },
  headerAction: { color: '#ff6f91', fontSize: 14, fontWeight: '800' },
  errorWrap: { padding: 16, alignItems: 'center' },
  errorText: { color: '#ff6f91', fontSize: 13, marginBottom: 8 },
  retryBtn: { backgroundColor: '#ff6f91', paddingHorizontal: 18, paddingVertical: 8, borderRadius: 18 },
  retryText: { color: '#fff', fontSize: 13, fontWeight: '800' },
  list: { padding: 12, paddingBottom: 40 },
  card: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.72)',
    borderRadius: 16, padding: 12, marginBottom: 8,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.68)',
  },
  cardDark: { backgroundColor: 'rgba(20,20,20,0.68)', borderColor: 'rgba(255,255,255,0.10)' },
  avatar: { width: 48, height: 48, borderRadius: 24, marginRight: 12, backgroundColor: 'rgba(128,128,128,0.15)' },
  avatarPlaceholder: {},
  info: { flex: 1 },
  nameRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  name: { fontSize: 15, fontWeight: '700', color: '#333333', flex: 1, marginRight: 8 },
  time: { fontSize: 11, color: '#555555' },
  msg: { fontSize: 13, color: '#555555' },
  badge: { backgroundColor: '#ff6f91', borderRadius: 11, minWidth: 22, height: 22, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  emptyWrap: { alignItems: 'center', paddingVertical: 60 },
  empty: { color: '#555555', fontSize: 14, marginTop: 8 },
  textLight: { color: '#ffffff' },
  textSubLight: { color: '#dddddd' },
});
