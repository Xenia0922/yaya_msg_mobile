/**
 * v3.0 成员相关页 + WebView 页（批量实现，共用 MemberSheet / DataListPage / Screen）
 *
 * 包含：PhotosV3（成员照片） / MemberDynamicV3（成员动态） / ProfileV3（成员档案）
 *       RechargeV3（充值） / DatabaseV3（数据库）
 *
 * 说明：这些页面的字段兜底顺序沿用旧页的 pickText 思路（多处候选键），
 * 真机上若发现字段缺失，只需改本文件顶部的映射函数，不动布局。
 */
import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { useNavigation } from '@react-navigation/native';

import pocketApi from '../../api/pocket48';
import { useI18n } from '../../i18n';
import { usePalette } from '../../theme';
import { normalizeUrl, pickText, unwrapList } from '../../utils/data';
import type { Member } from '../../types';

import { Screen } from '../layout/Screen';
import { DataListPage, type RowModel } from '../layout/DataListPage';
import { Divider, EmptyHint, ListRow } from '../layout/primitives';
import { MemberSheet, MemberTrigger } from '../components/MemberSheet';
import { contentBottom, GUTTER, SPACE, TYPE } from '../tokens';

/* ─────────────────────────── 成员照片 ─────────────────────────── */

function photoRows(res: any): RowModel[] {
  const list = unwrapList(res, [
    'content.list', 'content.photos', 'content.data', 'data.list', 'data.photos', 'photos', 'list', 'data',
  ]);
  return list
    .map((raw: any, i: number) => {
      const url = normalizeUrl(pickText(raw, ['url', 'picUrl', 'photoUrl', 'imageUrl', 'picPath', 'path', 'image', 'src'], ''));
      const time = pickText(raw, ['time', 'createTime', 'ctime', 'date'], '');
      return { key: String(raw?.id || raw?.photoId || i), title: time || '', cover: url, raw } as RowModel;
    })
    .filter((x: RowModel) => !!x.cover);
}

export function PhotosV3() {
  const navigation = useNavigation<any>();
  const { t } = useI18n();
  const [member, setMember] = useState<Member | null>(null);
  const [sheet, setSheet] = useState(false);

  const fetcher = useCallback(async () => {
    if (!member) return null;
    // 官方照片接口 + 档案（后者通常带图集）；任一失败不影响另一个
    const [photos, archive] = await Promise.all([
      pocketApi.getMemberPhotos(member.id).catch(() => null),
      pocketApi.getStarArchives(Number(member.id)).catch(() => null),
    ]);
    return { photos, archive };
  }, [member]);

  return (
    <>
      {member ? (
        <DataListPage
          title={t('成员照片')}
          onBack={() => navigation.goBack()}
          toolbar={<MemberTrigger member={member} onPress={() => setSheet(true)} />}
          fetcher={fetcher}
          toItems={(res) => [...photoRows(res?.photos), ...photoRows(res?.archive)]}
          columns={2}
          emptyTitle={t('暂无照片')}
          emptyIcon="image-off-outline"
        />
      ) : (
        <Screen title={t('成员照片')} onBack={() => navigation.goBack()} toolbar={<MemberTrigger member={null} onPress={() => setSheet(true)} />}>
          <EmptyHint icon="account-search-outline" title={t('先选一位成员')} hint={t('点左上角选择成员')} />
        </Screen>
      )}
      <MemberSheet visible={sheet} onClose={() => setSheet(false)} onPick={(m) => { setMember(m); setSheet(false); }} />
    </>
  );
}

/* ─────────────────────────── 成员动态 ─────────────────────────── */

function dynamicRows(res: any): RowModel[] {
  const list = unwrapList(res, ['content.list', 'content.dynamicList', 'content.data', 'data.list', 'dynamicList', 'list', 'data']);
  return list
    .map((raw: any, i: number) => {
      const text = pickText(raw, ['content', 'text', 'body', 'title', 'desc'], '');
      const time = pickText(raw, ['createTime', 'ctime', 'time', 'date'], '');
      return { key: String(raw?.id || raw?.dynamicId || i), title: text || t2('动态'), subtitle: time, raw };
    })
    .filter((x: RowModel) => !!x.title);
}

/** 模块级 t 不可用，动态页的兜底标题用闭包外的固定中文（其他语言回退到 key） */
function t2(s: string) { return s; }

export function MemberDynamicV3() {
  const navigation = useNavigation<any>();
  const { t } = useI18n();
  const [member, setMember] = useState<Member | null>(null);
  const [sheet, setSheet] = useState(false);

  const fetcher = useCallback(
    () => (member ? pocketApi.getMemberDynamic({ ownerId: member.id, nextTime: 0 }) : Promise.resolve(null)),
    [member],
  );

  return (
    <>
      {member ? (
        <DataListPage
          title={t('成员动态')}
          onBack={() => navigation.goBack()}
          toolbar={<MemberTrigger member={member} onPress={() => setSheet(true)} />}
          fetcher={fetcher}
          toItems={dynamicRows}
          emptyTitle={t('暂无动态')}
          emptyIcon="star-circle-outline"
        />
      ) : (
        <Screen title={t('成员动态')} onBack={() => navigation.goBack()} toolbar={<MemberTrigger member={null} onPress={() => setSheet(true)} />}>
          <EmptyHint icon="account-search-outline" title={t('先选一位成员')} hint={t('点左上角选择成员')} />
        </Screen>
      )}
      <MemberSheet visible={sheet} onClose={() => setSheet(false)} onPick={(m) => { setMember(m); setSheet(false); }} />
    </>
  );
}

/* ─────────────────────────── 成员档案 ─────────────────────────── */

const ARCHIVE_KEYS: { label: string; keys: string[] }[] = [
  { label: '队伍', keys: ['teamName', 'team', 'groupName'] },
  { label: '期数', keys: ['periodName', 'period', 'pname'] },
  { label: '生日', keys: ['birthday', 'birth', 'birthDay'] },
  { label: '身高', keys: ['height'] },
  { label: '出生地', keys: ['birthplace', 'hometown', 'birthCity'] },
  { label: '特长', keys: ['specialty', 'speciality', 'skill'] },
  { label: '爱好', keys: ['hobby', 'hobbies'] },
  { label: '加入时间', keys: ['joinDay', 'joinTime', 'joinDate'] },
];

export function ProfileV3() {
  const navigation = useNavigation<any>();
  const palette = usePalette();
  const { t } = useI18n();
  const [member, setMember] = useState<Member | null>(null);
  const [sheet, setSheet] = useState(false);
  const [archive, setArchive] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (m: Member) => {
    setLoading(true);
    try {
      const res = await pocketApi.getStarArchives(Number(m.id)).catch(() => null);
      setArchive(res);
    } finally {
      setLoading(false);
    }
  }, []);

  const rows = useMemo(() => {
    if (!archive) return [] as { label: string; value: string }[];
    const src = archive?.content || archive?.data || archive || {};
    return ARCHIVE_KEYS.map(({ label, keys }) => ({ label, value: String(pickText(src, keys, '') || '') })).filter((r) => r.value);
  }, [archive]);

  return (
    <Screen
      title={t('成员档案')}
      onBack={() => navigation.goBack()}
      toolbar={<MemberTrigger member={member} onPress={() => setSheet(true)} />}
    >
      {!member ? (
        <EmptyHint icon="account-search-outline" title={t('先选一位成员')} hint={t('点左上角选择成员')} />
      ) : loading ? (
        <EmptyHint icon="account-outline" title={t('加载中…')} />
      ) : rows.length === 0 ? (
        <EmptyHint icon="account-off-outline" title={t('暂无档案')} />
      ) : (
        <View style={{ paddingTop: SPACE.sm }}>
          <Text style={[TYPE.title, { color: palette.label, paddingHorizontal: GUTTER, paddingBottom: SPACE.sm }]}>
            {member.ownerName}
          </Text>
          {rows.map((r, i) => (
            <View key={r.label}>
              <ListRow title={r.label} value={r.value} />
              {i < rows.length - 1 ? <Divider inset={GUTTER} /> : null}
            </View>
          ))}
          <View style={{ height: contentBottom(false) }} />
        </View>
      )}
      <MemberSheet visible={sheet} onClose={() => setSheet(false)} onPick={(m) => { setMember(m); setSheet(false); load(m); }} />
    </Screen>
  );
}

/* ─────────────────────────── WebView 页（充值 / 数据库） ─────────────────────────── */

function WebPage({ title, uri }: { title: string; uri: string }) {
  const navigation = useNavigation<any>();
  const palette = usePalette();
  return (
    <Screen title={title} onBack={() => navigation.goBack()}>
      <View style={[styles.webWrap, { borderColor: palette.hairline }]}>
        <WebView source={{ uri }} style={{ flex: 1 }} startInLoadingState />
      </View>
    </Screen>
  );
}

export function RechargeV3() {
  const { t } = useI18n();
  return <WebPage title={t('充值')} uri="https://live.48.cn/Recharge/" />;
}

export function DatabaseV3() {
  const { t } = useI18n();
  return <WebPage title={t('数据库')} uri="https://h5.48.cn/" />;
}

const styles = StyleSheet.create({
  webWrap: { flex: 1, margin: GUTTER, marginTop: SPACE.sm, borderRadius: 12, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth },
});
