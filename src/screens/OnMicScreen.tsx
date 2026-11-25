import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { NetworkImage } from '../components/NetworkImage';
import {
  ActivityIndicator,
  AppState,
  InteractionManager,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { PerfFlatList } from '../components/PerfFlatList';
import { usePalette, fontFamily } from '../theme';
import { useI18n } from '../i18n';
import { useMemberStore, useSettingsStore } from '../store';
import { EmptyState } from '../components/StateViews';
import ScreenHeader from '../components/ScreenHeader';
import { HeaderAction } from '../components/HeaderAction';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { isOnMicStreamFresh, useOnMicStore, type OnMicEntry } from '../store/onMicStore';
import {
  fetchFollowedIdsShared,
  hydrateFollowedIdsShared,
  peekFollowedIdsShared,
  subscribeFollowedIds,
} from '../services/pocketSharedData';
import { GlassSurface } from '../components/GlassSurface';
import type { Palette } from '../theme/colors';
import type { Member } from '../types';

interface OnMicRowProps {
  item: OnMicEntry;
  index: number;
  member?: Member;
  isFollowed: boolean;
  palette: Palette;
  t: (key: string, params?: Record<string, string | number>) => string;
  onPress: (item: OnMicEntry, member?: Member) => void;
}

const OnMicRow = memo(function OnMicRow({
  item,
  index,
  member,
  isFollowed,
  palette,
  t,
  onPress,
}: OnMicRowProps) {
  const roomLabel =
    item.smallVoice && item.bigVoice
      ? `${t('大房间')} / ${t('小房间')}`
      : item.smallVoice
        ? t('小房间')
        : t('大房间');

  return (
    <View style={{ marginHorizontal: 16, marginTop: index === 0 ? 12 : 8 }}>
      <TouchableOpacity
        onPress={() => onPress(item, member)}
        activeOpacity={0.9}
        accessibilityRole="button"
        accessibilityLabel={item.name}
      >
        <GlassSurface
          radius={22}
          role="card"
          frostedOnly
          style={[
            styles.row,
            {
              backgroundColor: 'transparent',
              borderColor: palette.innerStroke,
              borderWidth: StyleSheet.hairlineWidth,
            },
          ]}
        >
          {member?.avatar ? (
            <NetworkImage source={{ uri: member.avatar }} style={styles.avatar} thumbnail={96} />
          ) : (
            <View style={[styles.avatar, { backgroundColor: palette.tintSoft }]} />
          )}
          <View style={styles.info}>
            <View style={styles.nameRow}>
              <Text style={[styles.name, { color: palette.label }]} numberOfLines={1}>
                {item.name}
              </Text>
              {isFollowed ? (
                <View style={[styles.followBadge, { backgroundColor: palette.tintSoft }]}>
                  <Text style={[styles.followBadgeText, { color: palette.tint }]}>
                    {t('已关注')}
                  </Text>
                </View>
              ) : null}
            </View>
            <View style={styles.tagRow}>
              <View style={[styles.tag, { backgroundColor: palette.tint }]}>
                <MaterialCommunityIcons name="microphone" size={11} color={palette.onTint} />
                <Text style={styles.tagText}>{t('上麦中')}</Text>
              </View>
              <View style={[styles.tag, { backgroundColor: palette.fill2 }]}>
                <Text style={[styles.tagText, { color: palette.labelSecondary }]}>{roomLabel}</Text>
              </View>
              {item.hasRadio ? (
                <View style={[styles.tag, { backgroundColor: palette.tintSoft }]}>
                  <MaterialCommunityIcons name="radio" size={11} color={palette.tint} />
                  <Text style={[styles.tagText, { color: palette.tint }]}>{t('电台')}</Text>
                </View>
              ) : null}
              {item.onMicCount > 1 ? (
                <Text style={[styles.count, { color: palette.labelSecondary }]}>
                  {t('{n} 人在麦', { n: item.onMicCount })}
                </Text>
              ) : null}
            </View>
          </View>
          <MaterialCommunityIcons name="chevron-right" size={20} color={palette.labelTertiary} />
        </GlassSurface>
      </TouchableOpacity>
    </View>
  );
});

export default function OnMicScreen() {
  const palette = usePalette();
  const { t } = useI18n();
  const navigation = useNavigation<any>();
  const members = useMemberStore((state) => state.members);
  const token = useSettingsStore((state) => state.settings.p48Token);
  const onMic = useOnMicStore((state) => state.onMic);
  const scanning = useOnMicStore((state) => state.scanning);
  const scanTotal = useOnMicStore((state) => state.total);
  const scanMemberTotal = useOnMicStore((state) => state.memberTotal);
  const scanDone = useOnMicStore((state) => state.done);
  const [error, setError] = useState('');
  const [followedIds, setFollowedIds] = useState<Set<string>>(() => peekFollowedIdsShared(token));

  const hasMembers = members.length > 0;

  const buildInputs = useCallback(() => {
    return useMemberStore
      .getState()
      .members.map((item) => {
        const st = String(item.state || '');
        const inGroup =
          item.isInGroup !== false && st !== 'left' && st !== 'graduated' && st !== 'paused';
        return {
          memberId: String(item.id || item.userId || ''),
          name: String(
            item.ownerName || (item as Member & { realName?: string }).realName || item.id || '',
          ),
          channelId: String(item.channelId || ''),
          serverId: String(item.serverId || ''),
          smallChannelId: String(item.yklzId || ''),
          state: st,
          isInGroup: inGroup,
        };
      })
      .filter((m) => m.memberId && m.isInGroup && (m.channelId || m.serverId || m.smallChannelId));
  }, []);

  const startScan = useCallback(
    (opts?: { force?: boolean; priorityIds?: Set<string> }) => {
      const inputs = buildInputs();
      if (!inputs.length) return;
      void useOnMicStore.getState().scan(inputs, {
        source: 'onMic',
        force: opts?.force,
        priorityIds: opts?.priorityIds ?? followedIds,
      });
    },
    [buildInputs, followedIds],
  );

  useEffect(() => {
    setError('');
    if (!hasMembers) setError(t('暂无成员数据，请先刷新成员库'));
  }, [hasMembers, t]);

  useEffect(() => {
    setFollowedIds(peekFollowedIdsShared(token));
    const trimmed = String(token || '').trim();
    const offSub = subscribeFollowedIds((ids, tk) => {
      if (tk === trimmed) setFollowedIds(ids);
    });
    if (trimmed) {
      void hydrateFollowedIdsShared(trimmed).then((cached) => {
        if (cached.cached) setFollowedIds(new Set(cached.ids));
      });
    }
    return offSub;
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      if (!hasMembers) return undefined;
      let active = true;
      const task = InteractionManager.runAfterInteractions(() => {
        if (!active || AppState.currentState !== 'active') return;
        const runWithPriority = async () => {
          let priorityIds = peekFollowedIdsShared(token);
          if (token && !priorityIds.size) {
            const cached = await hydrateFollowedIdsShared(token).catch(() => ({
              ids: [] as string[],
              cached: false,
            }));
            if (cached.ids.length) priorityIds = new Set(cached.ids);
          }
          if (!active) return;
          if (token) {
            void fetchFollowedIdsShared(token).catch(() => {});
          }
          const st = useOnMicStore.getState();
          const hasScannedOnMic = (st.lastScanBySource?.onMic || 0) > 0;
          const inputs = buildInputs();
          if (inputs.length) {
            void st.scan(inputs, {
              source: 'onMic',
              force: !hasScannedOnMic && !st.scanning,
              priorityIds,
            });
          }
        };
        void runWithPriority();
      });

      return () => {
        active = false;
        task.cancel();
      };
    }, [buildInputs, hasMembers, token]),
  );

  const membersById = useMemo(() => {
    const map = new Map<string, Member>();
    for (const m of members) {
      const id = String(m?.id || m?.userId || '');
      if (id) map.set(id, m);
    }
    return map;
  }, [members]);

  const entries: OnMicEntry[] = useMemo(() => {
    const list: OnMicEntry[] = [];
    for (const entry of Object.values(onMic)) {
      if (entry && entry.memberId) list.push(entry);
    }
    list.sort((a, b) => {
      const fa = followedIds.has(a.memberId) ? 1 : 0;
      const fb = followedIds.has(b.memberId) ? 1 : 0;
      if (fa !== fb) return fb - fa;
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });
    return list;
  }, [onMic, followedIds]);

  const handleOpenRadio = useCallback(
    (item: OnMicEntry, member?: Member) => {
      if (!member) return;
      navigation.navigate('RoomRadioScreen', {
        member,
        initialMode: item.smallVoice && !item.bigVoice ? 'small' : 'big',
        streamUrl: isOnMicStreamFresh(item) ? item.streamUrl || '' : '',
      });
    },
    [navigation],
  );

  const renderItem = useCallback(
    ({ item, index }: { item: OnMicEntry; index: number }) => (
      <OnMicRow
        item={item}
        index={index}
        member={membersById.get(item.memberId)}
        isFollowed={followedIds.has(item.memberId)}
        palette={palette}
        t={t}
        onPress={handleOpenRadio}
      />
    ),
    [followedIds, handleOpenRadio, membersById, palette, t],
  );

  return (
    <View style={[styles.container, { backgroundColor: 'transparent' }]}>
      <ScreenHeader
        title={t('上麦')}
        right={
          <HeaderAction
            label={t('刷新')}
            onPress={() => startScan({ force: true })}
            loading={scanning}
            disabled={scanning}
          />
        }
      />
      {scanning ? (
        <GlassSurface
          radius={22}
          role="card"
          style={[
            styles.scanBar,
            { backgroundColor: 'transparent', borderColor: palette.hairline },
          ]}
        >
          <ActivityIndicator size="small" color={palette.tint} style={{ marginRight: 8 }} />
          <Text style={[styles.scanBarText, { color: palette.labelSecondary }]}>
            {t('正在扫描全部成员上麦状态 {done}/{total}...', {
              done: Math.min(scanDone, scanTotal),
              total: scanTotal || scanMemberTotal,
            })}
          </Text>
        </GlassSurface>
      ) : null}
      {error && entries.length === 0 ? (
        <EmptyState
          icon="alert-circle-outline"
          title={t('加载失败')}
          hint={error}
          onAction={() => startScan({ force: true })}
        />
      ) : entries.length === 0 && scanning ? null : entries.length === 0 ? (
        <EmptyState
          icon="microphone-off"
          title={t('暂无成员上麦')}
          hint={t('当前没有成员在语音麦上，可点下方重新扫描')}
          onAction={() => startScan({ force: true })}
          actionLabel={t('重新扫描')}
        />
      ) : (
        <PerfFlatList
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
  scanBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginTop: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  scanBarText: { fontSize: 12, fontFamily: fontFamily.system, fontWeight: '600' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 22,
    borderCurve: 'continuous',
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
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  name: {
    fontSize: 15,
    fontFamily: fontFamily.system,
    fontWeight: '700',
    flexShrink: 1,
  },
  followBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
  },
  followBadgeText: {
    fontSize: 10,
    fontFamily: fontFamily.system,
    fontWeight: '700',
  },
  tagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
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
    fontFamily: fontFamily.system,
    fontWeight: '700',
    color: '#fff',
  },
  count: {
    fontSize: 11,
    fontFamily: fontFamily.system,
    marginLeft: 2,
  },
});
