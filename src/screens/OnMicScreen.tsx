import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Image,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { usePalette } from '../theme';
import { useI18n } from '../i18n';
import { useMemberStore } from '../store';
import { FadeInView } from '../components/Motion';
import { CenterSpinner } from '../components/Loaders';
import { EmptyState } from '../components/StateViews';
import ScreenHeader from '../components/ScreenHeader';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import pocketApi from '../api/pocket48';
import { useOnMicStore, OnMicEntry } from '../store/onMicStore';
import { Member } from '../types';
import { unwrapList, errorMessage } from '../utils/data';

export default function OnMicScreen() {
  const palette = usePalette();
  const { t } = useI18n();
  const navigation = useNavigation<any>();
  const members = useMemberStore((state: any) => state.members);
  const onMic = useOnMicStore((state: any) => state.onMic);
  const [followed, setFollowed] = useState<{ memberId: string; member?: Member }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const buildInputs = useCallback(() => {
    return followed
      .map((item) => ({
        memberId: item.memberId,
        name: String(item.member?.ownerName || item.memberId),
        channelId: String(item.member?.channelId || ''),
        serverId: String(item.member?.serverId || ''),
        smallChannelId: String(item.member?.yklzId || ''),
      }))
      .filter((m: any) => m.channelId);
  }, [followed]);

  const loadFollowed = useCallback(async () => {
    setLoading(true);
    try {
      const idsRes = await pocketApi.getFollowedIds();
      const idsArr = unwrapList(idsRes, ['content.data', 'content', 'data', 'list']).map(String);
      const followedMembers = idsArr
        .map((id: string) => {
          const member = members.find((item: any) => String(item.id || item.userId) === id);
          return { memberId: id, member };
        })
        .filter((item: any) => item.member?.channelId);
      setFollowed(followedMembers);
      setError('');
    } catch (e: any) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [members]);

  const scan = useCallback(() => {
    const inputs = buildInputs();
    if (inputs.length) useOnMicStore.getState().scan(inputs);
  }, [buildInputs]);

  // 进入页面拉取关注列表并扫描上麦状态；tab 可见时每 45s 静默刷新
  useEffect(() => {
    let active = true;
    loadFollowed().then(() => { if (active) scan(); });
    return () => { active = false; };
  }, [loadFollowed, scan]);

  useFocusEffect(
    useCallback(() => {
      scan();
      const id = setInterval(scan, 45000);
      return () => clearInterval(id);
    }, [scan]),
  );

  const entries: OnMicEntry[] = followed
    .map((item) => onMic[item.memberId])
    .filter((e: OnMicEntry | undefined): e is OnMicEntry => !!e);

  const renderItem = ({ item, index }: { item: OnMicEntry; index: number }) => {
    const member = followed.find((f) => f.memberId === item.memberId)?.member;
    return (
      <FadeInView delay={index < 12 ? 60 + index * 25 : 0} duration={300} style={{ marginHorizontal: 16, marginTop: index === 0 ? 12 : 8 }}>
        <TouchableOpacity
          style={[styles.row, { backgroundColor: palette.surface, borderColor: palette.hairline, borderWidth: StyleSheet.hairlineWidth }]}
          onPress={() => member && navigation.navigate('RoomRadioScreen', { member })}
          activeOpacity={0.9}
        >
          {member?.avatar ? (
            <Image source={{ uri: member.avatar }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, { backgroundColor: palette.tintSoft }]} />
          )}
          <View style={styles.info}>
            <Text style={[styles.name, { color: palette.label }]} numberOfLines={1}>{item.name}</Text>
            <View style={styles.tagRow}>
              <View style={[styles.tag, { backgroundColor: palette.tint }]}>
                <MaterialCommunityIcons name="microphone" size={11} color={palette.onTint} />
                <Text style={styles.tagText}>{t('上麦中')}</Text>
              </View>
              {item.hasRadio ? (
                <View style={[styles.tag, { backgroundColor: palette.tintSoft }]}>
                  <MaterialCommunityIcons name="radio" size={11} color={palette.tint} />
                  <Text style={[styles.tagText, { color: palette.tint }]}>{t('电台')}</Text>
                </View>
              ) : null}
              {item.onMicCount > 1 ? (
                <Text style={[styles.count, { color: palette.labelSecondary }]}>{t('{n} 人在麦', { n: item.onMicCount })}</Text>
              ) : null}
            </View>
          </View>
          <MaterialCommunityIcons name="chevron-right" size={20} color={palette.labelTertiary} />
        </TouchableOpacity>
      </FadeInView>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: palette.background }]}>
      <ScreenHeader title={t('上麦')} />
      {error && entries.length === 0 ? (
        <EmptyState icon="alert-circle-outline" title={t('加载失败')} hint={error} onAction={() => { loadFollowed().then(scan); }} />
      ) : entries.length === 0 ? (
        <EmptyState icon="microphone-off" title={t('暂无成员上麦')} hint={t('关注成员没有正在上麦的房间')} />
      ) : (
        <FlatList
          data={entries}
          keyExtractor={(item) => item.memberId}
          renderItem={renderItem}
          contentContainerStyle={{ paddingBottom: 24 }}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    padding: 12,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#ccc',
  },
  info: {
    flex: 1,
    marginLeft: 12,
  },
  name: {
    fontSize: 15,
    fontWeight: '700',
  },
  tagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    gap: 6,
  },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    gap: 3,
  },
  tagText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#fff',
  },
  count: {
    fontSize: 11,
    marginLeft: 2,
  },
});
