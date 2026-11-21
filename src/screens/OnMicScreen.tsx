import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NetworkImage } from '../components/NetworkImage';
import {
  AppState,
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { usePalette, fontFamily } from '../theme';
import { useI18n } from '../i18n';
import { useMemberStore } from '../store';
import { EmptyState } from '../components/StateViews';
import ScreenHeader from '../components/ScreenHeader';
import { HeaderAction } from '../components/HeaderAction';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { useOnMicStore, OnMicEntry } from '../store/onMicStore';
import { GlassSurface } from '../components/GlassSurface';

export default function OnMicScreen() {
  const palette = usePalette();
  const { t } = useI18n();
  const navigation = useNavigation<any>();
  const members = useMemberStore((state: any) => state.members);
  const onMic = useOnMicStore((state: any) => state.onMic);
  const scanning = useOnMicStore((state: any) => state.scanning);
  const scanTotal = useOnMicStore((state: any) => state.total);
  const scanMemberTotal = useOnMicStore((state: any) => state.memberTotal);
  const scanDone = useOnMicStore((state: any) => state.done);
  const [error, setError] = useState('');

  const buildInputs = useCallback(() => {
    return members
      .map((item: any) => {
        const st = String(item.state || '');

        const inGroup =
          item.isInGroup !== false && st !== 'left' && st !== 'graduated' && st !== 'paused';
        return {
          memberId: String(item.id || item.userId || ''),
          name: String(item.ownerName || item.realName || item.id || ''),
          channelId: String(item.channelId || ''),
          serverId: String(item.serverId || ''),
          smallChannelId: String(item.yklzId || ''),
          state: st,
          isInGroup: inGroup,
        };
      })
      .filter(
        (m: any) => m.memberId && m.isInGroup && (m.channelId || m.serverId || m.smallChannelId),
      );
  }, [members]);

  const scan = useCallback(
    (opts?: { force?: boolean }) => {
      const inputs = buildInputs();
      if (inputs.length) useOnMicStore.getState().scan(inputs, opts);
    },
    [buildInputs],
  );

  useEffect(() => {
    scan({ force: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scannedWithMembersRef = useRef(false);
  useEffect(() => {
    if (scannedWithMembersRef.current || !members.length) return;
    scannedWithMembersRef.current = true;
    if (!useOnMicStore.getState().lastScan) scan({ force: true });
  }, [members.length, scan]);

  useEffect(() => {
    setError('');
    if (!members.length) setError(t('暂无成员数据，请先刷新成员库'));
  }, [members, t]);

  useFocusEffect(
    useCallback(() => {
      if (AppState.currentState === 'active' && members.length) scan();
    }, [scan, members.length]),
  );

  const membersById = useMemo(() => {
    const map = new Map<string, any>();
    for (const m of members as any[]) {
      const id = String(m?.id || m?.userId || '');
      if (id) map.set(id, m);
    }
    return map;
  }, [members]);

  const entries: OnMicEntry[] = useMemo(
    () =>
      members
        .map((m: any) => onMic[String(m.id || m.userId || '')])
        .filter((e: OnMicEntry | undefined): e is OnMicEntry => !!e),
    [members, onMic],
  );

  const renderItem = ({ item, index }: { item: OnMicEntry; index: number }) => {
    const member = membersById.get(item.memberId);
    return (
      <View style={{ marginHorizontal: 16, marginTop: index === 0 ? 12 : 8 }}>
        <TouchableOpacity
          onPress={() =>
            member &&
            navigation.navigate('RoomRadioScreen', {
              member,
              initialMode: item.smallVoice ? 'small' : 'big',
              streamUrl: item.streamUrl || '',
            })
          }
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
              <Text style={[styles.name, { color: palette.label }]} numberOfLines={1}>
                {item.name}
              </Text>
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
  };

  return (
    <View style={[styles.container, { backgroundColor: 'transparent' }]}>
      <ScreenHeader
        title={t('上麦')}

        right={
          <HeaderAction
            label={t('刷新')}
            onPress={() => scan({ force: true })}
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
          onAction={() => scan({ force: true })}
        />
      ) : entries.length === 0 && scanning ? null : entries.length === 0 ? (
        <EmptyState
          icon="microphone-off"
          title={t('暂无成员上麦')}
          hint={t('当前没有成员在语音麦上，可点下方重新扫描')}
          onAction={() => scan({ force: true })}
          actionLabel={t('重新扫描')}
        />
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
  name: {
    fontSize: 15,
    fontFamily: fontFamily.system,
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
