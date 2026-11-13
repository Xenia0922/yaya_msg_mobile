/**
 * AboutScreen · 关于软件（从设置页拆出的独立入口）
 * 低频信息全部收在这里，设置页只保留一个「关于软件」入口。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Image, Linking, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { showDialog } from '../components/AppDialog';
import ScreenHeader from '../components/ScreenHeader';
import { GlassSurface } from '../components/GlassSurface';
import { ListBottomSpacer } from '../components/ListBottomSpacer';
import { Button } from '../components/Button';
import UpdateInstaller from '../components/UpdateInstaller';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import Clipboard from '@react-native-clipboard/clipboard';
import { APP_VERSION } from '../constants';
import { BUILD_TAG } from '../constants/buildChannel';
import { DONATE_QR_URL, DONATE_QR_ASSET } from '../constants/donate';
import { useUpdateStore, useUiStore } from '../store';
import { isApkUpdaterAvailable } from '../native/ApkUpdater';
import { useI18n } from '../i18n';
import { usePalette, usePageBackground } from '../theme';

// 法律文本保持中文原文（官方中文声明为准；不做机器翻译）
const PRIVACY_BODY = `本应用是开源、本地优先的客户端。应用设置、账号凭证、缓存、下载文件和运行日志均保存在本机，不会上传到开发者服务器；不收集聊天内容、通讯录或精确位置，也不接入广告或第三方统计 SDK。

为展示内容，应用会直接访问口袋48/塞纳河48官方接口及必要的 GitHub 服务，相关请求由设备直接发起。相册、存储和通知权限仅用于保存图片、下载内容和本地播放提醒，可在系统设置中随时关闭。

客户端代码基于 GPL-3.0 协议开源，可自行查看、修改和审计；第三方组件遵循各自许可证。卸载应用或清除应用数据会删除本机保存的数据。`;


function Section({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  const palette = usePalette();
  return (
    <View>
      <View style={styles.sectionTitleRow}>
        <View style={[styles.sectionIcon, { backgroundColor: palette.tintSoft }]}>
          <MaterialCommunityIcons name={icon} size={11} color={palette.tint} />
        </View>
        <Text style={[styles.sectionTitle, { color: palette.label }]}>{title}</Text>
      </View>
      <GlassSurface radius={22} role="card" style={styles.section}>
        {children}
      </GlassSurface>
    </View>
  );
}

function Row({ icon, title, value, onPress }: { icon: string; title: string; value?: string; onPress?: () => void }) {
  const palette = usePalette();
  return (
    <TouchableOpacity style={styles.row} activeOpacity={0.9} onPress={onPress} disabled={!onPress}>
      <View style={[styles.rowIcon, { backgroundColor: palette.tintSoft }]}>
        <MaterialCommunityIcons name={icon} size={16} color={palette.tint} />
      </View>
      <Text style={[styles.rowTitle, { color: palette.label }]} numberOfLines={1}>{title}</Text>
      {value ? <Text style={[styles.rowValue, { color: palette.labelTertiary }]} numberOfLines={1}>{value}</Text> : null}
      {onPress ? <MaterialCommunityIcons name="chevron-right" size={20} color={palette.labelTertiary} /> : null}
    </TouchableOpacity>
  );
}

export default function AboutScreen() {
  const navigation = useNavigation<any>();
  const palette = usePalette();
  const { t } = useI18n();
  const hasUpdate = useUpdateStore((s) => s.hasUpdate);
  const latestVersion = useUpdateStore((s) => s.latestVersion);
  const [updateVisible, setUpdateVisible] = useState(false);
  const [feedbackVisible, setFeedbackVisible] = useState(false);
  const [feedbackText, setFeedbackText] = useState('');
  const [feedbackKind, setFeedbackKind] = useState<'bug' | 'idea'>('bug');
  const [donateVisible, setDonateVisible] = useState(false);
  const [privacyVisible, setPrivacyVisible] = useState(false);
  const showToast = useUiStore((s) => s.showToast);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const versionLabel = `v${APP_VERSION}${BUILD_TAG ? ` · ${BUILD_TAG}` : ''}`;
  const donateUri = DONATE_QR_URL;

  const checkVersion = useCallback(() => {
    const { hasUpdate: up, latestUrl } = useUpdateStore.getState();
    if (up && latestUrl) {
      if (isApkUpdaterAvailable) setUpdateVisible(true);
      else Linking.openURL(latestUrl).catch(() => {});
      return;
    }
    useUpdateStore.getState().checkUpdate(true).then((has) => {
      const next = useUpdateStore.getState();
      if (has && next.hasUpdate && next.latestUrl && mountedRef.current) {
        setUpdateVisible(true);
      } else if (mountedRef.current) {
        showToast(t('已是最新版本'));
      }
    }).catch(() => { if (mountedRef.current) showToast(t('检查更新失败，请稍后重试')); });
  }, []);

  const feedbackBody = () => {
    const head = feedbackKind === 'bug' ? '[问题]' : '[建议]';
    return `${head} ${feedbackText.trim()}\n\n---\n应用版本：${APP_VERSION}\n平台：android`;
  };

  const copyFeedback = () => {
    if (!feedbackText.trim()) { showToast(t('请先填写问题或建议')); return; }
    Clipboard.setString(feedbackBody());
    showToast(t('反馈内容已复制'));
  };

  const openFeedbackIssue = () => {
    if (!feedbackText.trim()) { showToast(t('请先填写问题或建议')); return; }
    const title = encodeURIComponent(`${feedbackKind === 'bug' ? '[Bug]' : '[Feature]'} ${feedbackText.trim().slice(0, 40)}`);
    const body = encodeURIComponent(feedbackBody());
    Linking.openURL(`https://github.com/Xenia0922/yaya_msg_mobile/issues/new?title=${title}&body=${body}`).catch(() => {});
  };

  return (
    <View style={[styles.container, { backgroundColor: usePageBackground() }]}>
      <ScreenHeader title={t('关于软件')} onBack={() => navigation.goBack()} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <View style={[styles.logoWrap, { backgroundColor: palette.fill3 }]}>
            <Image source={require('../../assets/logo.jpg')} style={styles.logo} />
          </View>
          <Text style={[styles.appName, { color: palette.label }]}>{t('牙牙消息')}</Text>
          <Text style={[styles.appSub, { color: palette.labelSecondary }]}>{t('Yaya Message · 口袋48 第三方客户端')}</Text>
          <Text style={[styles.versionText, { color: palette.tint }]}>{`v${APP_VERSION}`}</Text>
          <Button
            title={hasUpdate && BUILD_TAG ? t('有新版本') : t('检查更新')}
            variant="tinted"
            size="sm"
            onPress={checkVersion}
            style={styles.checkBtn}
          />
        </View>

        <Section title={t('支持与反馈')} icon="heart-outline">
          <Row icon="heart-outline" title={t('赞赏支持')} value={t('微信 / 支付宝')} onPress={() => setDonateVisible(true)} />
          <View style={[styles.divider, { backgroundColor: palette.innerStroke }]} />
          <Row icon="message-alert-outline" title={t('问题与建议')} value={t('反馈 / GitHub')} onPress={() => setFeedbackVisible(true)} />
        </Section>

        <Section title={t('开源信息')} icon="source-branch">
          <Row icon="source-repository" title={t('源码仓库')} value="GitHub" onPress={() => Linking.openURL('https://github.com/Xenia0922/yaya_msg_mobile').catch(() => {})} />
          <View style={[styles.divider, { backgroundColor: palette.innerStroke }]} />
          <Row icon="monitor" title={t('桌面端项目')} value="yk1z/yaya_msg" onPress={() => Linking.openURL('https://github.com/yk1z/yaya_msg').catch(() => {})} />
          <View style={[styles.divider, { backgroundColor: palette.innerStroke }]} />
          <Row icon="scale-balance" title={t('开源协议与隐私')} value="GPL-3.0" onPress={() => setPrivacyVisible(true)} />
        </Section>

        <Section title={t('下载与推送')} icon="download-circle">
          <Row icon="download-circle" title={t('下载页')} value="gnz48.tech/app" onPress={() => Linking.openURL('https://gnz48.tech/app/').catch(() => {})} />
          <View style={[styles.divider, { backgroundColor: palette.innerStroke }]} />
          <Row icon="bell-ring-outline" title={t('推送服务')} value="gnz48.tech" onPress={() => Linking.openURL('https://gnz48.tech/').catch(() => {})} />
        </Section>



        <ListBottomSpacer base={16} />
      </ScrollView>

      <Modal visible={feedbackVisible} transparent animationType="slide" onRequestClose={() => setFeedbackVisible(false)}>
        <TouchableOpacity style={styles.shade} activeOpacity={1} onPress={() => setFeedbackVisible(false)}>
          <TouchableOpacity activeOpacity={1} style={[styles.sheet, { backgroundColor: palette.surface }]} onPress={() => {}}>
            <View style={styles.sheetHead}>
              <Text style={[styles.sheetTitle, { color: palette.label }]}>{t('问题与建议')}</Text>
              <TouchableOpacity onPress={() => setFeedbackVisible(false)}><MaterialCommunityIcons name="close" size={20} color={palette.labelTertiary} /></TouchableOpacity>
            </View>
            <View style={styles.kindRow}>
              {([['bug', t('问题反馈')], ['idea', t('功能建议')]] as const).map(([k, label]) => (
                <TouchableOpacity key={k} onPress={() => setFeedbackKind(k)} style={[styles.kindChip, { backgroundColor: feedbackKind === k ? palette.tint : palette.fill2 }]}>
                  <Text style={{ color: feedbackKind === k ? palette.onTint : palette.labelSecondary, fontSize: 12, fontWeight: '700' }}>{label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TextInput
              value={feedbackText}
              onChangeText={setFeedbackText}
              multiline
              placeholder={t('请描述你遇到的问题或建议…')}
              placeholderTextColor={palette.labelTertiary}
              style={[styles.feedbackInput, { color: palette.label, backgroundColor: palette.fill2 }]}
              textAlignVertical="top"
              maxLength={1000}
            />
            <View style={styles.actions}>
              <Button title={t('复制反馈内容')} variant="tinted" size="md" onPress={copyFeedback} />
              <Button title={t('GitHub 提交')} variant="filled" size="md" onPress={openFeedbackIssue} />
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <Modal visible={donateVisible} transparent animationType="slide" onRequestClose={() => setDonateVisible(false)}>
        <TouchableOpacity style={styles.shade} activeOpacity={1} onPress={() => setDonateVisible(false)}>
          <TouchableOpacity activeOpacity={1} style={[styles.sheet, { backgroundColor: palette.surface }]} onPress={() => {}}>
            <View style={styles.sheetHead}>
              <Text style={[styles.sheetTitle, { color: palette.label }]}>{t('赞赏支持')}</Text>
              <TouchableOpacity onPress={() => setDonateVisible(false)}><MaterialCommunityIcons name="close" size={20} color={palette.labelTertiary} /></TouchableOpacity>
            </View>
            {donateUri ? (
              <Image source={{ uri: donateUri }} style={styles.qr} resizeMode="contain" />
            ) : DONATE_QR_ASSET ? (
              <Image source={DONATE_QR_ASSET} style={styles.qr} resizeMode="contain" />
            ) : (
              <View style={[styles.qrPlaceholder, { backgroundColor: palette.fill2 }]}>
                <MaterialCommunityIcons name="qrcode-scan" size={42} color={palette.tint} />
                <Text style={[styles.qrTitle, { color: palette.labelSecondary }]}>{t('赞赏码待配置')}</Text>
                <Text style={[styles.qrNote, { color: palette.labelTertiary }]}>{t('请开发者在 src/constants/donate.ts 配置赞赏码图片')}</Text>
              </View>
            )}
            <Text style={[styles.qrNote, { color: palette.labelTertiary }]}>{t('感谢支持，赞赏不提供任何特权。')}</Text>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* 开源协议与隐私：本地优先说明 */}
      <Modal visible={privacyVisible} transparent animationType="slide" onRequestClose={() => setPrivacyVisible(false)}>
        <TouchableOpacity style={styles.shade} activeOpacity={1} onPress={() => setPrivacyVisible(false)}>
          <TouchableOpacity activeOpacity={1} style={[styles.sheet, { backgroundColor: palette.surface }]} onPress={() => {}}>
            <View style={styles.sheetHead}>
              <Text style={[styles.sheetTitle, { color: palette.label }]}>{t('开源协议与隐私')}</Text>
              <TouchableOpacity onPress={() => setPrivacyVisible(false)}><MaterialCommunityIcons name="close" size={20} color={palette.labelTertiary} /></TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: 330 }} showsVerticalScrollIndicator={false}>
              <Text style={[styles.legalText, { color: palette.labelSecondary }]}>
                {PRIVACY_BODY}
              </Text>
            </ScrollView>
            <Button title={t('关闭')} variant="tinted" size="md" onPress={() => setPrivacyVisible(false)} style={{ marginTop: 14 }} />
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <UpdateInstaller visible={updateVisible} version={latestVersion} onClose={() => setUpdateVisible(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 16, paddingBottom: 20 },
  hero: { alignItems: 'center', paddingTop: 6, paddingBottom: 18 },
  logoWrap: { width: 72, height: 72, borderRadius: 24, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  logo: { width: 72, height: 72, borderRadius: 24 },
  appName: { fontSize: 22, fontWeight: '800', marginTop: 12 },
  appSub: { fontSize: 12, marginTop: 4 },
  versionText: { fontSize: 12, fontWeight: '700', marginTop: 8 },
  checkBtn: { marginTop: 10 },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 18, marginBottom: 8, paddingHorizontal: 4 },
  sectionIcon: { width: 20, height: 20, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  sectionTitle: { fontSize: 13, fontWeight: '700', letterSpacing: 0.3 },
  section: { overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 14, gap: 12 },
  rowIcon: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { flex: 1, minWidth: 0, fontSize: 15, fontWeight: '600' },
  rowValue: { fontSize: 12, flexShrink: 1, maxWidth: '45%', textAlign: 'right' },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: 54 },
  shade: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 30, borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  sheetTitle: { fontSize: 16, fontWeight: '800' },
  kindRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  kindChip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 14 },
  feedbackInput: { minHeight: 120, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10, fontSize: 13, lineHeight: 19 },
  actions: { flexDirection: 'row', justifyContent: 'center', gap: 10, marginTop: 16 },
  qr: { width: 220, height: 220, alignSelf: 'center', borderRadius: 16, backgroundColor: '#fff' },
  qrPlaceholder: { height: 220, borderRadius: 18, alignItems: 'center', justifyContent: 'center', gap: 8 },
  qrTitle: { fontSize: 14, fontWeight: '700' },
  qrNote: { fontSize: 11, lineHeight: 16, textAlign: 'center', marginTop: 10 },
  legalText: { fontSize: 12, lineHeight: 20 },
});
