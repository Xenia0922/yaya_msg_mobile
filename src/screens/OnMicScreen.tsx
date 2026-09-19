import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Image,
  ActivityIndicator,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { usePalette } from '../theme';
import { useI18n } from '../i18n';
import { useMemberStore } from '../store';
import { FadeInView } from '../components/Motion';
import { EmptyState } from '../components/StateViews';
import { CenterSpinner } from '../components/Loaders';
import ScreenHeader from '../components/ScreenHeader';
import { HeaderAction } from '../components/HeaderAction';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { useOnMicStore, OnMicEntry } from '../store/onMicStore';
import { Member } from '../types';
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

  // v2.7.5：全部在团成员上麦扫描（对齐桌面端 room-radio-feature.js 的 isInGroup !== false）
  //  - 过滤条件含 yklzId：只有小房间的成员此前被 (channelId || serverId) 漏掉
  //  - isInGroup 透传下去由 buildScanTasks 排除退团/毕业成员（桌面语义）
  const buildInputs = useCallback(() => {
    return members
      .map((item: any) => {
        const st = String(item.state || '');
        // 「在团」判定（用户要求：上麦只扫在团成员）：
        // 库里 isInGroup 未标 false，且状态不是 退团(left)/毕业(graduated)/暂休(paused)。
        // state 由 memberData 用官方+库重算（官方优先），未知(unknown)仍保留，避免漏扫。
        const inGroup = item.isInGroup !== false && st !== 'left' && st !== 'graduated' && st !== 'paused';
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
      .filter((m: any) => m.memberId && m.isInGroup && (m.channelId || m.serverId || m.smallChannelId));
  }, [members]);

  const scan = useCallback((opts?: { force?: boolean }) => {
    const inputs = buildInputs();
    if (inputs.length) useOnMicStore.getState().scan(inputs, opts);
  }, [buildInputs]);

  // 进入页面强制扫描一次全部成员（force 绕过 60s 节流）
  useEffect(() => {
    scan({ force: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // 成员库是异步加载的：挂载时若还没就绪，buildInputs 为空 → 扫不出任何东西且页面一片空。
  // 首次拿到成员后补扫一次（仅当此前从未扫描过），避免「进页面就是暂无成员上麦」的假空态。
  const scannedWithMembersRef = useRef(false);
  useEffect(() => {
    if (scannedWithMembersRef.current || !members.length) return;
    scannedWithMembersRef.current = true;
    if (!useOnMicStore.getState().lastScan) scan({ force: true });
  }, [members.length, scan]);
  // Y17: members 异步加载完成后重算错误态（此前仅挂载算一次 → 长期误显示「暂无成员数据」）
  useEffect(() => {
    setError('');
    if (!members.length) setError(t('暂无成员数据，请先刷新成员库'));
  }, [members, t]);

  // tab 可见时每 60s 静默刷新（store 内部节流 60s + 预算制增量：每轮 1/3 成员，约 3 轮全覆盖）
  useFocusEffect(
    useCallback(() => {
      const id = setInterval(() => scan(), 60000);
      return () => clearInterval(id);
    }, [scan]),
  );

  const entries: OnMicEntry[] = members
    .map((m: any) => onMic[String(m.id || m.userId || '')])
    .filter((e: OnMicEntry | undefined): e is OnMicEntry => !!e);

  const renderItem = ({ item, index }: { item: OnMicEntry; index: number }) => {
    const member = members.find((m: any) => String(m.id || m.userId) === item.memberId);
    return (
      <FadeInView delay={index < 12 ? 60 + index * 25 : 0} duration={300} style={{ marginHorizontal: 16, marginTop: index === 0 ? 12 : 8 }}>
        <TouchableOpacity
          onPress={() => member && navigation.navigate('RoomRadioScreen', {
            member,
            initialMode: item.smallVoice ? 'small' : 'big',
            streamUrl: item.streamUrl || '',
          })}
          activeOpacity={0.9}
        >
          <GlassSurface
            radius={20}
            role="card"
            style={[styles.row, { backgroundColor: 'transparent', borderColor: palette.hairline, borderWidth: StyleSheet.hairlineWidth }]}
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
          </GlassSurface>
        </TouchableOpacity>
      </FadeInView>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: palette.background }]}>
      <ScreenHeader
        title={t('上麦')}
        // 手动强制重扫（绕过 store 的 60s 节流 + 预算制增量）：解决「有概率扫不出来」
        right={<HeaderAction label={t('刷新')} onPress={() => scan({ force: true })} loading={scanning} disabled={scanning} />}
      />
      {scanning ? (
        <GlassSurface radius={20} role="card" style={[styles.scanBar, { backgroundColor: 'transparent', borderColor: palette.hairline }]}>
          <ActivityIndicator size="small" color={palette.tint} style={{ marginRight: 8 }} />
          <Text style={[styles.scanBarText, { color: palette.labelSecondary }]}>
            {/* ⚠️ 分子分母必须同一口径：done 是「探测任务数」（大/小房间各一个任务），
                以前分母用成员数（memberTotal）→ 数字会涨到 2 倍成员数，看起来像出错 */}
            {t('正在扫描全部成员上麦状态 {done}/{total}...', { done: Math.min(scanDone, scanTotal), total: scanTotal || scanMemberTotal })}
          </Text>
        </GlassSurface>
      ) : null}
      {error && entries.length === 0 ? (
        <EmptyState icon="alert-circle-outline" title={t('加载失败')} hint={error} onAction={() => scan({ force: true })} />
      ) : entries.length === 0 && scanning ? (
        /* 扫描中且尚无结果：显示加载态 —— 以前这里直接落进「暂无成员上麦」空态，
           看起来像扫完了没结果（用户反馈的「加载显示有问题」） */
        <CenterSpinner text={t('正在扫描上麦状态…')} />
      ) : entries.length === 0 ? (
        <EmptyState icon="microphone-off" title={t('暂无成员上麦')} hint={t('当前没有成员在语音麦上，可点下方重新扫描')} onAction={() => scan({ force: true })} actionLabel={t('重新扫描')} />
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
  scanBarText: { fontSize: 12, fontWeight: '600' },
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