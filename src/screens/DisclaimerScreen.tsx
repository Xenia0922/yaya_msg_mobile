/**
 * DisclaimerScreen · 免责声明（独立页，不放在设置/关于里）
 */
import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import ScreenHeader from '../components/ScreenHeader';
import { useI18n } from '../i18n';
import { usePalette, getPageBackground } from '../theme';

const DISCLAIMER = `1. 本应用为第三方非官方客户端，与上海丝芭文化传媒集团有限公司及其关联公司（含 SNH48、GNZ48、BEJ48、CKG48、CGT48 等）不存在任何隶属、授权、合作或关联关系。

2. 应用名称、商标、成员姓名、肖像、音频、视频、图片及其他内容的知识产权归丝芭文化及相关权利人所有；本应用仅提供公开信息的聚合与播放工具，不存储、不拥有、不传播上述内容。

3. 所有数据来源于公开接口及公开页面，仅供个人学习、研究和交流使用，不得用于任何商业用途、批量抓取、二次分发、恶意传播或其他侵犯他人合法权益的行为。

4. 使用者应遵守当地法律法规及官方平台服务条款；因使用本应用产生的任何直接或间接损失、法律责任由使用者自行承担，开发者不承担任何责任。

5. 本应用按 GPL-3.0 协议“按现状”提供，不提供任何明示或暗示的担保；如权利人认为内容侵权，请联系开发者删除或下架。

6. 请通过官方渠道（口袋48等）支持成员与官方内容。`;

export default function DisclaimerScreen() {
  const navigation = useNavigation<any>();
  const palette = usePalette();
  const { t } = useI18n();
  return (
    <View style={[styles.container, { backgroundColor: getPageBackground() }]}>
      <ScreenHeader title={t('免责声明')} onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={[styles.title, { color: palette.label }]}>{t('免责声明')}</Text>
        <Text style={[styles.body, { color: palette.labelSecondary }]}>{DISCLAIMER}</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 20, paddingBottom: 40 },
  title: { fontSize: 18, fontWeight: '800', marginBottom: 14 },
  body: { fontSize: 13, lineHeight: 22 },
});
