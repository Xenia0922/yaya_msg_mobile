/**
 * v3.0 媒体列表 + 账号（2 屏）
 *
 * MediaV3：只做「分类 + 列表」。**播放交给已验证的统一播放器**（点击后带 liveId 进旧 Media 路由），
 *   这样 v3 不必重写流解析/内核路由，也不会因为播放器高度变化把列表顶来顶去。
 * LoginV3：Token 校验 / 手机号验证码登录 / 保存后重置云信会话（换号必须重置，否则旧身份串房）。
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { useNavigation } from '@react-navigation/native';

import pocketApi from '../../api/pocket48';
import { useSettingsStore } from '../../store';
import { saveSettings } from '../../services/settings';
import { resetNimSession } from '../../services/pocketNim/session';
import { useI18n } from '../../i18n';
import { usePalette } from '../../theme';
import { normalizeUrl, pickText, unwrapList, errorMessage } from '../../utils/data';

import { Screen } from '../layout/Screen';
import { DataListPage, type RowModel } from '../layout/DataListPage';
import { Divider, SectionHeader } from '../layout/primitives';
import { Segmented } from '../components/Segmented';
import { contentBottom, GUTTER, R, SPACE, TYPE } from '../tokens';

/* ───────────────────────── Media ───────────────────────── */

function liveRows(res: any): RowModel[] {
  return unwrapList(res, ['content.liveList', 'content.list', 'content.data', 'liveList', 'list', 'data'])
    .map((raw: any, i: number) => ({
      key: String(raw?.liveId || raw?.id || i),
      title: String(pickText(raw, ['nickname', 'userInfo.nickname', 'ownerName', 'title'], '')),
      subtitle: String(pickText(raw, ['title', 'liveTitle', 'roomName'], '')),
      cover: normalizeUrl(pickText(raw, ['liveCover', 'coverPath', 'cover', 'picPath', 'imageUrl', 'userInfo.avatar'], '')),
      raw,
    }))
    .filter((x: RowModel) => !!x.title);
}

function replayRows(res: any): RowModel[] {
  return unwrapList(res, ['content.list', 'content.data', 'content.records', 'list', 'data'])
    .map((raw: any, i: number) => ({
      key: String(raw?.liveId || raw?.id || i),
      title: String(pickText(raw, ['title', 'liveTitle', 'name'], '')),
      subtitle: String(pickText(raw, ['startTime', 'time', 'createTime', 'date'], '')),
      cover: normalizeUrl(pickText(raw, ['cover', 'coverPath', 'picPath', 'imageUrl'], '')),
      raw,
    }))
    .filter((x: RowModel) => !!x.title);
}

export function MediaV3() {
  const navigation = useNavigation<any>();
  const { t } = useI18n();
  const [mode, setMode] = useState<'live' | 'vod'>('live');

  const fetcher = useCallback(
    () => (mode === 'live'
      ? pocketApi.getLiveList({ groupId: 0, liveType: 0, next: 0, record: false })
      : pocketApi.getOpenLivePublicList({ groupId: 0, next: 0, record: true }).catch(() => null)),
    [mode],
  );

  return (
    <DataListPage
      title={t('媒体')}
      onBack={() => navigation.goBack()}
      toolbar={
        <>
          <Segmented
            options={[{ key: 'live' as const, label: t('正在直播') }, { key: 'vod' as const, label: t('回放') }]}
            value={mode}
            onChange={setMode}
          />
          <View style={{ flex: 1 }} />
        </>
      }
      fetcher={fetcher}
      toItems={(res) => (mode === 'live' ? liveRows(res) : replayRows(res))}
      emptyTitle={mode === 'live' ? t('暂无直播') : t('暂无回放')}
      emptyIcon="video-off-outline"
      onPressItem={(item) => {
        // 播放交给统一播放器（旧 Media 路由）：避免 v3 重写流解析
        navigation.navigate('MediaPlayer', {
          mode: mode === 'live' ? 'live' : 'vod',
          playLiveId: item.key,
          playTitle: item.title,
          playCover: item.cover,
          playNonce: Date.now(),
        });
      }}
    />
  );
}

/* ───────────────────────── 账号 ───────────────────────── */

function Field({ label, value, onChange, placeholder, keyboard, secure }: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; keyboard?: 'default' | 'number-pad'; secure?: boolean;
}) {
  const palette = usePalette();
  return (
    <View style={styles.field}>
      <Text style={[TYPE.caption, { color: palette.labelTertiary }]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={palette.labelTertiary}
        keyboardType={keyboard || 'default'}
        secureTextEntry={secure}
        autoCapitalize="none"
        autoCorrect={false}
        style={[TYPE.body, styles.input, { color: palette.label, borderBottomColor: palette.hairline }]}
      />
    </View>
  );
}

export function LoginV3() {
  const navigation = useNavigation<any>();
  const palette = usePalette();
  const { t } = useI18n();
  const settings = useSettingsStore((s) => s.settings);
  const setSettings = useSettingsStore((s) => s.setSettings);

  const [token, setToken] = useState(String(settings.p48Token || ''));
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState('');

  /** 保存 Token：写盘 → 重置云信会话（换号不重置会串房/串身份） */
  const saveToken = useCallback(async (value: string, note: string) => {
    const clean = value.trim();
    if (!clean) return;
    setBusy(true);
    try {
      setSettings({ p48Token: clean });
      await saveSettings({ p48Token: clean });
      resetNimSession('切换/保存口袋账号');
      setToken(clean);
      setHint(note);
    } catch (e) {
      Alert.alert(t('保存失败'), errorMessage(e));
    } finally {
      setBusy(false);
    }
  }, [setSettings, t]);

  const checkToken = useCallback(async () => {
    setBusy(true);
    try {
      await pocketApi.loginCheckToken();
      setHint(t('Token 有效'));
    } catch (e) {
      setHint(t('Token 无效：{msg}', { msg: errorMessage(e) }));
    } finally {
      setBusy(false);
    }
  }, [t]);

  const sendSms = useCallback(async () => {
    if (!phone.trim()) { setHint(t('请输入手机号')); return; }
    setBusy(true);
    try {
      await pocketApi.loginSendSms(phone.trim());
      setHint(t('验证码已发送'));
    } catch (e) {
      setHint(t('发送失败：{msg}', { msg: errorMessage(e) }));
    } finally {
      setBusy(false);
    }
  }, [phone, t]);

  const loginByCode = useCallback(async () => {
    if (!phone.trim() || !code.trim()) { setHint(t('请输入手机号和验证码')); return; }
    setBusy(true);
    try {
      const res: any = await pocketApi.loginByCode(phone.trim(), code.trim());
      const next = String(pickText(res, ['content.token', 'token', 'data.token'], ''));
      if (!next) throw new Error(t('登录成功但没有返回 token'));
      await saveToken(next, t('登录成功'));
    } catch (e) {
      setHint(t('登录失败：{msg}', { msg: errorMessage(e) }));
    } finally {
      setBusy(false);
    }
  }, [phone, code, saveToken, t]);

  return (
    <Screen title={t('账号管理')} onBack={() => navigation.goBack()}>
      <ScrollView contentContainerStyle={{ paddingBottom: contentBottom(false) }} keyboardShouldPersistTaps="handled">
        <SectionHeader title={t('口袋账号')} />
        <View style={styles.block}>
          <Field label={t('Token')} value={token} onChange={setToken} placeholder="粘贴口袋 token" />
          <View style={styles.btnRow}>
            <TouchableOpacity disabled={busy} onPress={() => saveToken(token, t('Token 已保存'))} style={[styles.btn, { backgroundColor: palette.tint, opacity: busy ? 0.5 : 1 }]}>
              <Text style={[TYPE.secondary, { color: palette.onTint, fontWeight: '700' }]}>{t('保存 Token')}</Text>
            </TouchableOpacity>
            <TouchableOpacity disabled={busy} onPress={checkToken} style={[styles.btnGhost, { borderColor: palette.hairline }]}>
              <Text style={[TYPE.secondary, { color: palette.label }]}>{t('检查有效性')}</Text>
            </TouchableOpacity>
          </View>
        </View>

        <Divider inset={GUTTER} />

        <SectionHeader title={t('验证码登录')} />
        <View style={styles.block}>
          <Field label={t('手机号')} value={phone} onChange={setPhone} keyboard="number-pad" placeholder="11 位手机号" />
          <Field label={t('验证码')} value={code} onChange={setCode} keyboard="number-pad" placeholder="短信验证码" />
          <View style={styles.btnRow}>
            <TouchableOpacity disabled={busy} onPress={sendSms} style={[styles.btnGhost, { borderColor: palette.hairline }]}>
              <Text style={[TYPE.secondary, { color: palette.label }]}>{t('获取验证码')}</Text>
            </TouchableOpacity>
            <TouchableOpacity disabled={busy} onPress={loginByCode} style={[styles.btn, { backgroundColor: palette.tint, opacity: busy ? 0.5 : 1 }]}>
              <Text style={[TYPE.secondary, { color: palette.onTint, fontWeight: '700' }]}>{t('登录')}</Text>
            </TouchableOpacity>
          </View>
        </View>

        {hint ? (
          <View style={styles.hintRow}>
            <MaterialCommunityIcons name="information-outline" size={14} color={palette.labelTertiary} />
            <Text style={[TYPE.caption, { color: palette.labelSecondary, flex: 1 }]}>{hint}</Text>
          </View>
        ) : null}

        <Text style={[TYPE.caption, { color: palette.labelTertiary, paddingHorizontal: GUTTER, paddingTop: SPACE.lg }]}>
          {t('资料（昵称 / 头像）仍请在旧版账号页编辑；3.0 只接管登录与 Token。')}
        </Text>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  field: { gap: SPACE.xs, paddingHorizontal: GUTTER, paddingTop: SPACE.md },
  input: { height: 40, padding: 0, borderBottomWidth: StyleSheet.hairlineWidth },
  block: { paddingBottom: SPACE.lg },
  btnRow: { flexDirection: 'row', gap: SPACE.md, paddingHorizontal: GUTTER, paddingTop: SPACE.lg },
  btn: { height: 40, paddingHorizontal: SPACE.lg, borderRadius: R.md, alignItems: 'center', justifyContent: 'center' },
  btnGhost: { height: 40, paddingHorizontal: SPACE.lg, borderRadius: R.md, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth },
  hintRow: { flexDirection: 'row', gap: SPACE.xs, alignItems: 'center', paddingHorizontal: GUTTER, paddingTop: SPACE.sm },
});
