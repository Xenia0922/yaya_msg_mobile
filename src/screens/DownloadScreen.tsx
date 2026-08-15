import React, { useCallback, useEffect, useState } from 'react';
import { PerfFlatList } from '../components/PerfFlatList';

import {
  FlatList,
  Image,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/types';
import { useSettingsStore, useUiStore } from '../store';
import { FadeInView } from '../components/Motion';
import ScreenHeader from '../components/ScreenHeader';
import { useAppTheme } from '../hooks/useAppTheme';
import { usePalette } from '../theme';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { useI18n } from '../i18n';
import {
  clearFinishedDownloads,
  deleteDownloadItem,
  DownloadItem,
  enqueueDownload,
  loadDownloadItems,
  openDownloadItem,
} from '../services/downloads';

type Nav = StackNavigationProp<RootStackParamList, 'DownloadScreen'>;

function formatBytes(value?: number) {
  if (value === undefined || value === null) return '--';
  const bytes = Number(value) || 0;
  if (bytes <= 0) return '0 B';
  if (bytes > 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes > 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function typeLabel(type: DownloadItem['type']) {
  if (type === 'replay') return '录播';
  if (type === 'voice') return '语音';
  if (type === 'image') return '图片';
  if (type === 'video') return '视频';
  if (type === 'audio') return '音频';
  return '文件';
}

function typeIcon(type: DownloadItem['type']): string {
  if (type === 'image') return 'image';
  if (type === 'video') return 'video';
  if (type === 'audio') return 'music';
  if (type === 'voice') return 'microphone';
  if (type === 'replay') return 'replay';
  return 'file';
}

export default function DownloadScreen() {
  const navigation = useNavigation<Nav>();
  const isDark = useAppTheme();
  const palette = usePalette();
  const { t } = useI18n();
  const showToast = useUiStore((s) => s.showToast);
  const [items, setItems] = useState<DownloadItem[]>([]);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [imgPreview, setImgPreview] = useState('');

  const handleOpen = async (item: DownloadItem) => {
    if (item.type === 'image' && item.localUri) {
      setImgPreview(item.localUri);
      return;
    }
    try { await openDownloadItem(item); } catch (e: any) { showToast(t('打开失败：{msg}', { msg: e?.message || e })); }
  };

  const refresh = useCallback(async () => {
    setItems(await loadDownloadItems());
  }, []);

  useFocusEffect(useCallback(() => {
    refresh();
  }, [refresh]));

  const startManualDownload = async () => {
    const target = url.trim();
    if (!target || busy) return;
    setBusy(true);
    try {
      await enqueueDownload({
        url: target,
        type: /\.(jpe?g|png|webp|gif)(\?|$)/i.test(target) ? 'image'
          : /\.(mp3|m4a|aac|amr|wav)(\?|$)/i.test(target) ? 'audio'
          : /\.(mp4|m3u8|flv|mov)(\?|$)/i.test(target) ? 'video'
          : 'file',
        onProgress: refresh,
      });
      setUrl('');
      showToast(t('下载完成'));
    } catch (error: any) {
      showToast(t('下载失败：{msg}', { msg: error?.message || error }));
    } finally {
      setBusy(false);
      refresh();
    }
  };

  const remove = async (id: string) => {
    await deleteDownloadItem(id);
    refresh();
  };

  const clearDone = async () => {
    await clearFinishedDownloads();
    refresh();
  };

  const doneCount = items.filter((item) => item.status === 'done').length;

  return (
    <View style={styles.container}>
      <ScreenHeader title={t('下载管理')} right={
        <TouchableOpacity onPress={clearDone} disabled={doneCount === 0}>
          <Text style={[styles.clearBtn, { color: doneCount === 0 ? palette.labelTertiary : palette.tint }]}>{t('清理完成')}</Text>
        </TouchableOpacity>
      } />

      <FadeInView delay={80} duration={300} style={{ flex: 1 }}>
        <View style={[styles.manualCard, { backgroundColor: palette.surface, borderColor: palette.hairline, borderWidth: StyleSheet.hairlineWidth }]}>
          <View style={styles.manualHead}>
            <MaterialCommunityIcons name="link-variant" size={18} color={palette.tint} />
            <Text style={[styles.manualTitle, { color: palette.label }]}>{t('手动添加下载')}</Text>
          </View>
          <TextInput
            style={[styles.urlInput, { backgroundColor: palette.fill2, color: palette.label, borderColor: palette.innerStroke, borderWidth: StyleSheet.hairlineWidth }]}
            placeholder={t('粘贴图片、语音、视频或录播地址')}
            placeholderTextColor={palette.labelTertiary}
            value={url}
            onChangeText={setUrl}
            autoCapitalize="none"
          />
          <TouchableOpacity style={[styles.addBtn, { backgroundColor: palette.tint }, busy && styles.btnDisabled]} onPress={startManualDownload} disabled={busy}>
            <Text style={styles.addBtnText}>{busy ? t('下载中') : t('添加下载')}</Text>
          </TouchableOpacity>
        </View>

        <PerfFlatList
          data={items}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={<Text style={[styles.empty, { color: palette.labelTertiary }]}>{t('暂无下载项目')}</Text>}
          initialNumToRender={12}
          maxToRenderPerBatch={12}
          windowSize={7}
          removeClippedSubviews
          renderItem={({ item, index }) => (
            <FadeInView delay={index < 12 ? 80 + index * 30 : 0} duration={300}>
              <View style={[styles.task, { backgroundColor: palette.surface, borderColor: palette.hairline, borderWidth: StyleSheet.hairlineWidth }]}>
                <View style={[styles.taskIconWrap, { backgroundColor: palette.tintSoft }]}>
                  <MaterialCommunityIcons name={typeIcon(item.type)} size={20} color={palette.tint} />
                </View>
                <View style={styles.taskBody}>
                  <Text style={[styles.taskName, { color: palette.label }]} numberOfLines={1}>{item.name}</Text>
                  <Text style={[styles.taskSub, { color: palette.labelTertiary }]} numberOfLines={1}>
                    {t(typeLabel(item.type))}
                  </Text>
                  <View style={[styles.progressTrack, { backgroundColor: palette.fill2 }]}>
                    <View style={[styles.progressFill, { backgroundColor: item.status === 'failed' ? palette.danger : palette.tint, width: `${Math.round((item.progress || 0) * 100)}%` }]} />
                  </View>
                  <Text style={[styles.taskStatus, { color: palette.labelSecondary }]} numberOfLines={1}>
                    {item.status === 'done' ? t('完成') : item.status === 'failed' ? t('失败：{msg}', { msg: item.error || '' }) : t('下载中 {downloaded} / {total}', { downloaded: formatBytes(item.downloadedBytes), total: formatBytes(item.totalBytes) })}
                  </Text>
                </View>
                <View style={styles.taskActions}>
                  <TouchableOpacity onPress={() => handleOpen(item).catch((error: any) => showToast(t('打开失败：{msg}', { msg: error?.message || error })))} style={styles.actionBtn}>
                    <MaterialCommunityIcons name="open-in-app" size={16} color={palette.tint} />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => remove(item.id)} style={styles.actionBtn}>
                    <MaterialCommunityIcons name="delete-outline" size={16} color={palette.danger} />
                  </TouchableOpacity>
                </View>
              </View>
            </FadeInView>
          )}
        />
      </FadeInView>
      {imgPreview ? (
        <Modal visible transparent animationType="fade" onRequestClose={() => setImgPreview('')}>
          <TouchableOpacity style={styles.imgModal} activeOpacity={1} onPress={() => setImgPreview('')}>
            <Image source={{ uri: imgPreview }} style={styles.imgFull} resizeMode="contain" />
          </TouchableOpacity>
        </Modal>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  clearBtn: { fontSize: 13, minWidth: 54, textAlign: 'right', fontWeight: '700' },
  manualCard: { marginHorizontal: 16, marginBottom: 8, padding: 14, borderRadius: 16 },
  manualHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  manualTitle: { fontSize: 15, fontWeight: '700', flex: 1 },
  urlInput: { minHeight: 44, paddingHorizontal: 14, borderRadius: 14, fontSize: 13 },
  addBtn: { marginTop: 10, minHeight: 42, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  btnDisabled: { opacity: 0.55 },
  addBtnText: { color: '#FFFFFF', fontWeight: '800', fontSize: 14 },
  list: { padding: 4, paddingBottom: 112 },
  task: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 12,
    marginVertical: 4,
    padding: 12,
    borderRadius: 16,
  },
  taskIconWrap: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  taskBody: { flex: 1, marginLeft: 12, minWidth: 0 },
  taskName: { fontSize: 15, fontWeight: '700' },
  taskSub: { fontSize: 11, marginTop: 2 },
  progressTrack: { height: 5, marginTop: 8, borderRadius: 4, overflow: 'hidden' },
  progressFill: { height: 5, borderRadius: 4 },
  taskStatus: { fontSize: 11, marginTop: 6 },
  taskActions: { flexDirection: 'row', alignItems: 'center', gap: 10, marginLeft: 10 },
  actionBtn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent' },
  empty: { textAlign: 'center', marginTop: 60, fontSize: 14 },
  imgModal: { flex: 1, backgroundColor: 'rgba(0,0,0,0.94)', alignItems: 'center', justifyContent: 'center' },
  imgFull: { width: '96%', height: '80%' },
});
