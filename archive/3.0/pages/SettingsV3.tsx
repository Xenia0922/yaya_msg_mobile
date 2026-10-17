/**
 * 设置 v3.0（完整重写，功能对齐当前版本）
 *
 * 布局决策：**系统设置式**——`SectionHeader` + 行（label 左 / 控件右）+ `Divider`，全程无卡片。
 * 旧版每项一张卡（圆角 + 描边 + 玻璃），一屏 5 卡 = 5 个浮岛；v3 只有一条左基线。
 */
import React, { useCallback } from 'react';
import {
  Alert,
  Image,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { useNavigation } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';

import { useSettingsStore } from '../../store';
import { saveSettings } from '../../services/settings';
import { useI18n } from '../../i18n';
import { usePalette } from '../../theme';
import { APP_VERSION } from '../../constants';

import { Screen } from '../layout/Screen';
import { Divider, SectionHeader } from '../layout/primitives';
import { contentBottom, GUTTER, R, SPACE, TYPE } from '../tokens';

const THEME = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
] as const;

const LANGS = [
  { value: 'system', label: '跟随系统' },
  { value: 'zh-Hans', label: '简体中文' },
  { value: 'zh-Hant', label: '繁體中文' },
  { value: 'en', label: 'English' },
  { value: 'ja', label: '日本語' },
  { value: 'ko', label: '한국어' },
] as const;

/** 一行设置项：label 左、控件右，行高 52，无卡片 */
function Row({
  label,
  hint,
  right,
  onPress,
  last,
}: {
  label: string;
  hint?: string;
  right?: React.ReactNode;
  onPress?: () => void;
  last?: boolean;
}) {
  const palette = usePalette();
  const body = (
    <View style={styles.row}>
      <View style={{ flex: 1 }}>
        <Text style={[TYPE.body, { color: palette.label }]}>{label}</Text>
        {hint ? <Text style={[TYPE.caption, { color: palette.labelTertiary, marginTop: 2 }]}>{hint}</Text> : null}
      </View>
      {right ?? null}
    </View>
  );
  return (
    <View>
      {onPress ? <TouchableOpacity onPress={onPress} activeOpacity={0.6}>{body}</TouchableOpacity> : body}
      {last ? null : <Divider inset={GUTTER} />}
    </View>
  );
}

export default function SettingsV3() {
  const navigation = useNavigation<any>();
  const palette = usePalette();
  const { t } = useI18n();
  const settings = useSettingsStore((s) => s.settings);
  const setSettings = useSettingsStore((s) => s.setSettings);

  const update = useCallback(async (key: string, value: any, extra: Record<string, any> = {}) => {
    const patch = { [key]: value, ...extra } as any;
    setSettings(patch);
    try { await saveSettings(patch); } catch { /* 落盘失败不阻塞 UI */ }
  }, [setSettings]);

  /** 背景图：选图 → base64 data URI（与旧版同一条写入路径） */
  const pickBackground = useCallback(async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert(t('没有相册权限')); return; }
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.9, base64: true });
    if (res.canceled) return;
    const asset = res.assets?.[0];
    if (!asset?.base64) { Alert.alert(t('读取图片失败')); return; }
    const mime = asset.mimeType || 'image/jpeg';
    await update('customBackgroundFile', `data:${mime};base64,${asset.base64}`, { customBackgroundUpdatedAt: Date.now() });
  }, [t, update]);

  const bg = String(settings.customBackgroundFile || '').trim();

  return (
    <Screen title={t('设置')} onBack={() => navigation.goBack()}>
      <ScrollView contentContainerStyle={{ paddingBottom: contentBottom(false) }} showsVerticalScrollIndicator={false}>
        {/* 账号 */}
        <SectionHeader title={t('账号')} />
        <Row
          label={t('账号管理')}
          hint={t('登录 / 切换账号 / 编辑资料')}
          right={<MaterialCommunityIcons name="chevron-right" size={20} color={palette.labelTertiary} />}
          onPress={() => navigation.navigate('LoginScreen')}
          last
        />

        {/* 外观 */}
        <SectionHeader title={t('外观')} />
        <Row
          label={t('主题')}
          right={
            <View style={styles.choiceRow}>
              {THEME.map((o) => {
                const active = (settings.theme || 'system') === o.value;
                return (
                  <TouchableOpacity key={o.value} onPress={() => update('theme', o.value)} hitSlop={6}>
                    <Text style={[TYPE.secondary, { color: active ? palette.tint : palette.labelTertiary, fontWeight: active ? '700' : '500' }]}>
                      {t(o.label)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          }
        />
        <Row
          label={t('背景图')}
          hint={bg ? t('已自定义') : t('默认')}
          right={
            <View style={styles.choiceRow}>
              {bg ? (
                <Image source={{ uri: bg }} style={styles.bgThumb} />
              ) : null}
              <TouchableOpacity onPress={pickBackground} hitSlop={6}>
                <Text style={[TYPE.secondary, { color: palette.tint }]}>{t('选择')}</Text>
              </TouchableOpacity>
              {bg ? (
                <TouchableOpacity onPress={() => update('customBackgroundFile', '', { customBackgroundUpdatedAt: Date.now() })} hitSlop={6}>
                  <Text style={[TYPE.secondary, { color: palette.labelTertiary }]}>{t('恢复默认')}</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          }
          last
        />

        {/* 语言 */}
        <SectionHeader title={t('语言')} />
        {/* 语言有 6 项，横排必然折行 → 改为竖排单选（系统设置的标准写法） */}
        {LANGS.map((o, i) => {
          const active = (settings.language || 'system') === o.value;
          return (
            <Row
              key={o.value}
              label={o.value === 'system' ? t(o.label) : o.label}
              right={active ? <MaterialCommunityIcons name="check" size={18} color={palette.tint} /> : null}
              onPress={() => update('language', o.value)}
              last={i === LANGS.length - 1}
            />
          );
        }, 
        )}

        {/* 播放 */}
        <SectionHeader title={t('播放')} />
        <Row
          label={t('切后台自动进小窗')}
          hint={t('关闭后按 Home 不会弹系统悬浮窗')}
          right={<Switch value={!!settings.pip_auto} onValueChange={(v) => update('pip_auto', v)} trackColor={{ true: palette.tint }} />}
          last
        />

        {/* 签到 */}
        <SectionHeader title={t('签到')} />
        <Row
          label={t('自动签到')}
          hint={settings.yaya_auto_checkin_enabled ? t('上次签到：{date}', { date: settings.yaya_auto_checkin_last_date || t('尚未执行') }) : undefined}
          right={<Switch value={!!settings.yaya_auto_checkin_enabled} onValueChange={(v) => update('yaya_auto_checkin_enabled', v)} trackColor={{ true: palette.tint }} />}
          last
        />

        {/* 工具 */}
        <SectionHeader title={t('工具')} />
        <Row
          label={t('下载管理')}
          right={<MaterialCommunityIcons name="chevron-right" size={20} color={palette.labelTertiary} />}
          onPress={() => navigation.navigate('DownloadScreen')}
          last
        />

        {/* 关于 */}
        <SectionHeader title={t('关于')} />
        <Row label={t('版本')} right={<Text style={[TYPE.secondary, { color: palette.labelTertiary }]}>v{APP_VERSION}</Text>} />
        <Row
          label={t('开源仓库')}
          right={<MaterialCommunityIcons name="open-in-new" size={16} color={palette.labelTertiary} />}
          onPress={() => Linking.openURL('https://github.com/Xenia0922/yaya_msg_mobile')}
          last
        />
        <View style={{ height: SPACE.xl }} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 52,
    paddingHorizontal: GUTTER,
    paddingVertical: SPACE.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.md,
  },
  choiceRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE.md, flexShrink: 1, flexWrap: 'wrap', justifyContent: 'flex-end' },
  bgThumb: { width: 24, height: 24, borderRadius: R.sm, opacity: 0.9 },
});
