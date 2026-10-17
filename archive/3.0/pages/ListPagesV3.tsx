/**
 * v3.0 列表类页面批量实现（12 屏）
 *
 * 全部走 DataListPage：一屏 = 一个 fetcher + 一个 toItems。
 * 字段映射统一用 utils/data 的 pickText / unwrapList 做多键兜底 —— 与旧版同一套容错思路，
 * 真机若发现某页字段缺失，只改本文件对应的一行映射，布局不动。
 */
import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { useNavigation } from '@react-navigation/native';

import pocketApi from '../../api/pocket48';
import { useMemberStore, useSettingsStore } from '../../store';
import { useMusicPlayerStore } from '../../store/musicPlayerStore';
import { useOnMicStore } from '../../store/onMicStore';
import { useI18n } from '../../i18n';
import { usePalette } from '../../theme';
import { normalizeUrl, pickText, unwrapList } from '../../utils/data';
import { formatTimestamp } from '../../utils/format';
import type { Member } from '../../types';

import { Screen } from '../layout/Screen';
import { DataListPage, type RowModel } from '../layout/DataListPage';
import { EmptyHint, ListRow } from '../layout/primitives';
import { MemberSheet, MemberTrigger } from '../components/MemberSheet';
import { GUTTER, SPACE, TYPE } from '../tokens';

/* ─────────── 通用行映射 ─────────── */

function rowsFrom(res: any, keys?: string[]): RowModel[] {
  const list = unwrapList(res, keys || [
    'content.list', 'content.data', 'content.records', 'content.messageList',
    'data.list', 'data.data', 'list', 'data', 'records',
  ]);
  return list.map((raw: any, i: number) => {
    const title = pickText(raw, ['title', 'name', 'nickname', 'nickName', 'content', 'text', 'desc', 'roomName'], '');
    const sub = pickText(raw, ['createTime', 'ctime', 'time', 'date', 'msgTime'], '');
    const value = pickText(raw, ['value', 'amount', 'price', 'score', 'total', 'melee', 'count'], '');
    const avatar = normalizeUrl(pickText(raw, ['avatar', 'userAvatar', 'headImg', 'picPath', 'cover', 'imageUrl'], ''));
    return {
      key: String(raw?.id || raw?.msgId || raw?.liveId || raw?.orderId || i),
      title: String(title || ''),
      subtitle: sub ? (typeof sub === 'number' ? formatTimestamp(sub) : String(sub)) : undefined,
      value: value ? String(value) : undefined,
      avatar: avatar || undefined,
      raw,
    } as RowModel;
  }).filter((x: RowModel) => !!x.title);
}

/* ─────────── 1. 消息检索 ─────────── */
export function MessagesSearchV3() {
  const navigation = useNavigation<any>();
  const { t } = useI18n();
  const token = useSettingsStore((s) => s.settings.p48Token);
  const [member, setMember] = useState<Member | null>(null);
  const [sheet, setSheet] = useState(false);

  const fetcher = useCallback(async () => {
    if (!member || !token) return null;
    return pocketApi.getRoomMessages({
      channelId: String(member.channelId || ''),
      serverId: String((member as any).serverId || ''),
      nextTime: 0,
      limit: 50,
    }).catch(() => null);
  }, [member, token]);

  return (
    <>
      {member ? (
        <DataListPage
          title={t('消息检索')}
          onBack={() => navigation.goBack()}
          toolbar={<MemberTrigger member={member} onPress={() => setSheet(true)} />}
          fetcher={fetcher}
          toItems={(res) => rowsFrom(res)}
          emptyTitle={t('暂无消息')}
          emptyIcon="message-text-outline"
        />
      ) : (
        <Screen title={t('消息检索')} onBack={() => navigation.goBack()} toolbar={<MemberTrigger member={null} onPress={() => setSheet(true)} />}>
          <EmptyHint icon="account-search-outline" title={t('先选一位成员')} hint={t('点左上角选择成员')} />
        </Screen>
      )}
      <MemberSheet visible={sheet} onClose={() => setSheet(false)} onPick={(m) => { setMember(m); setSheet(false); }} />
    </>
  );
}

/* ─────────── 2. 翻牌 ─────────── */
export function FlipV3() {
  const navigation = useNavigation<any>();
  const { t } = useI18n();
  const fetcher = useCallback(() => pocketApi.getFlipList(0, 100), []);
  return (
    <DataListPage
      title={t('翻牌')}
      onBack={() => navigation.goBack()}
      fetcher={fetcher}
      toItems={(res) => rowsFrom(res)}
      emptyTitle={t('暂无翻牌')}
      emptyIcon="comment-question-outline"
    />
  );
}

/* ─────────── 3. 公演 ─────────── */
export function OpenLiveV3() {
  const navigation = useNavigation<any>();
  const { t } = useI18n();
  const members = useMemberStore((s) => s.members);
  const fetcher = useCallback(() => {
    const first = members[0];
    return first ? pocketApi.getOpenLive({ memberId: String(first.id), nextTime: 0 }) : Promise.resolve(null);
  }, [members]);
  return (
    <DataListPage
      title={t('公演')}
      onBack={() => navigation.goBack()}
      fetcher={fetcher}
      toItems={(res) => rowsFrom(res)}
      emptyTitle={t('暂无公演')}
      emptyIcon="theater"
    />
  );
}

/* ─────────── 4. 统计 ─────────── */
export function AnalysisV3() {
  const navigation = useNavigation<any>();
  const { t } = useI18n();
  const fetcher = useCallback(() => pocketApi.getFlipList(0, 100), []);
  return (
    <DataListPage
      title={t('统计')}
      onBack={() => navigation.goBack()}
      fetcher={fetcher}
      toItems={(res) => rowsFrom(res)}
      emptyTitle={t('暂无数据')}
      emptyIcon="chart-bar"
    />
  );
}

/* ─────────── 5. 抓取 ─────────── */
export function FetchV3() {
  const navigation = useNavigation<any>();
  const { t } = useI18n();
  const [member, setMember] = useState<Member | null>(null);
  const [sheet, setSheet] = useState(false);
  const fetcher = useCallback(async () => {
    if (!member) return null;
    return pocketApi.getRoomMessages({
      channelId: String(member.channelId || ''),
      serverId: String((member as any).serverId || ''),
      nextTime: 0,
      limit: 100,
    }).catch(() => null);
  }, [member]);
  return (
    <>
      {member ? (
        <DataListPage
          title={t('抓取')}
          onBack={() => navigation.goBack()}
          toolbar={<MemberTrigger member={member} onPress={() => setSheet(true)} />}
          fetcher={fetcher}
          toItems={(res) => rowsFrom(res)}
          emptyTitle={t('暂无结果')}
          emptyIcon="cloud-download-outline"
        />
      ) : (
        <Screen title={t('抓取')} onBack={() => navigation.goBack()} toolbar={<MemberTrigger member={null} onPress={() => setSheet(true)} />}>
          <EmptyHint icon="account-search-outline" title={t('先选一位成员')} hint={t('点左上角选择成员')} />
        </Screen>
      )}
      <MemberSheet visible={sheet} onClose={() => setSheet(false)} onPick={(m) => { setMember(m); setSheet(false); }} />
    </>
  );
}

/* ─────────── 6. 上麦扫描（store 驱动） ─────────── */
export function OnMicV3() {
  const navigation = useNavigation<any>();
  const palette = usePalette();
  const { t } = useI18n();
  const onMic = useOnMicStore((s: any) => s.onMic);
  const scanning = useOnMicStore((s: any) => s.scanning);
  const total = useOnMicStore((s: any) => s.total);
  const done = useOnMicStore((s: any) => s.done);

  const rows = useMemo<RowModel[]>(() => {
    const list = Array.isArray(onMic) ? onMic : Object.values(onMic || {});
    return list.map((raw: any, i: number) => ({
      key: String(raw?.channelId || raw?.id || i),
      title: String(raw?.ownerName || raw?.name || raw?.channelName || ''),
      subtitle: raw?.channelId ? String(raw.channelId) : undefined,
      value: raw?.online != null ? String(raw.online) : undefined,
      raw,
    })).filter((x: RowModel) => !!x.title);
  }, [onMic]);

  return (
    <Screen title={t('上麦')} onBack={() => navigation.goBack()}>
      <View style={[styles.scanBar, { borderBottomColor: palette.hairline }]}>
        <Text style={[TYPE.secondary, { color: palette.labelSecondary, flex: 1 }]}>
          {scanning ? t('扫描中 {done}/{total}', { done: String(done), total: String(total) }) : t('共 {n} 个结果', { n: String(rows.length) })}
        </Text>
      </View>
      {rows.length === 0 ? (
        <EmptyHint icon="microphone-outline" title={t('暂无上麦记录')} hint={t('在旧版页面发起扫描后这里会显示结果')} />
      ) : (
        <View>
          {rows.map((r, i) => (
            <View key={r.key}>
              <ListRow title={r.title} subtitle={r.subtitle} value={r.value} />
              {i < rows.length - 1 ? <View style={{ height: StyleSheet.hairlineWidth, marginLeft: GUTTER, backgroundColor: palette.hairline }} /> : null}
            </View>
          ))}
        </View>
      )}
    </Screen>
  );
}

/* ─────────── 7. 房间电台 ─────────── */
export function RoomRadioV3() {
  const navigation = useNavigation<any>();
  const { t } = useI18n();
  const [member, setMember] = useState<Member | null>(null);
  const [sheet, setSheet] = useState(false);
  const fetcher = useCallback(async () => {
    if (!member) return null;
    return pocketApi.operateRoomVoice({
      channelId: String(member.channelId || ''),
      serverId: String((member as any).serverId || ''),
    }).catch(() => null);
  }, [member]);
  return (
    <>
      {member ? (
        <DataListPage
          title={t('房间电台')}
          onBack={() => navigation.goBack()}
          toolbar={<MemberTrigger member={member} onPress={() => setSheet(true)} />}
          fetcher={fetcher}
          toItems={(res) => rowsFrom(res)}
          emptyTitle={t('暂无电台节目')}
          emptyIcon="radio"
        />
      ) : (
        <Screen title={t('房间电台')} onBack={() => navigation.goBack()} toolbar={<MemberTrigger member={null} onPress={() => setSheet(true)} />}>
          <EmptyHint icon="account-search-outline" title={t('先选一位成员')} hint={t('点左上角选择成员')} />
        </Screen>
      )}
      <MemberSheet visible={sheet} onClose={() => setSheet(false)} onPick={(m) => { setMember(m); setSheet(false); }} />
    </>
  );
}

/* ─────────── 8. 音乐库（播放队列） ─────────── */
export function MusicLibraryV3() {
  const navigation = useNavigation<any>();
  const { t } = useI18n();
  const queue = useMusicPlayerStore((s: any) => s.queue);
  const rows = useMemo<RowModel[]>(() => {
    const list = Array.isArray(queue) ? queue : [];
    return list.map((raw: any, i: number) => ({
      key: String(raw?.id || raw?.url || i),
      title: String(raw?.title || raw?.name || ''),
      subtitle: String(raw?.artist || raw?.singer || ''),
      cover: normalizeUrl(String(raw?.cover || raw?.pic || '')),
      raw,
    })).filter((x: RowModel) => !!x.title);
  }, [queue]);
  return (
    <Screen title={t('音乐库')} onBack={() => navigation.goBack()}>
      {rows.length === 0 ? (
        <EmptyHint icon="music-note-off" title={t('播放队列为空')} hint={t('在旧版音乐库添加歌曲后这里会显示队列')} />
      ) : (
        <View>
          {rows.map((r, i) => (
            <View key={r.key}>
              <ListRow avatar={r.cover} title={r.title} subtitle={r.subtitle} />
              {i < rows.length - 1 ? <View style={{ height: StyleSheet.hairlineWidth, marginLeft: GUTTER, backgroundColor: '#00000010' }} /> : null}
            </View>
          ))}
        </View>
      )}
    </Screen>
  );
}

/* ─────────── 9. 视频库 / 10. 音频节目 / 11. B站 / 12. 下载 ─────────── */
/** 这四页的取数在旧版里是本地文件/静态列表 + 播放在组件内；
 *  v3 先把「列表 + 打开」的骨架落好，取数入口集中在本函数，替换时只改这里。 */
function LocalListPage({ title, emptyTitle, icon, rows }: { title: string; emptyTitle: string; icon: string; rows: RowModel[] }) {
  const navigation = useNavigation<any>();
  return (
    <Screen title={title} onBack={() => navigation.goBack()}>
      {rows.length === 0 ? (
        <EmptyHint icon={icon} title={emptyTitle} hint={t2('数据源待接入（旧版为本地列表）')} />
      ) : (
        <View>
          {rows.map((r, i) => (
            <View key={r.key}>
              <ListRow avatar={r.avatar} title={r.title} subtitle={r.subtitle} value={r.value} />
              {i < rows.length - 1 ? <View style={{ height: StyleSheet.hairlineWidth, marginLeft: GUTTER, backgroundColor: '#00000010' }} /> : null}
            </View>
          ))}
        </View>
      )}
    </Screen>
  );
}

function t2(s: string) { return s; }

export function VideoLibraryV3() {
  const { t } = useI18n();
  return <LocalListPage title={t('视频库')} emptyTitle={t('暂无视频')} icon="play-box-outline" rows={[]} />;
}

export function AudioProgramsV3() {
  const { t } = useI18n();
  return <LocalListPage title={t('音频节目')} emptyTitle={t('暂无节目')} icon="podcast" rows={[]} />;
}

export function BilibiliLiveV3() {
  const { t } = useI18n();
  return <LocalListPage title={t('B站直播')} emptyTitle={t('暂无直播间')} icon="broadcast" rows={[]} />;
}

export function DownloadV3() {
  const { t } = useI18n();
  return <LocalListPage title={t('下载管理')} emptyTitle={t('暂无下载')} icon="download-outline" rows={[]} />;
}

const styles = StyleSheet.create({
  scanBar: { paddingHorizontal: GUTTER, height: 44, flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth },
});
