import React, { useCallback, useEffect, useState } from 'react';
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
  const bytes = Number(value) || 0;
  if (!bytes) return '--';
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

export default function DownloadScreen() {
  const navigation = useNavigation<Nav>();
  const isDark = useSettingsStore((s) => s.settings.theme === 'dark');
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
    try { await openDownloadItem(item); } catch (e: any) { showToast(`打开失败：${e?.message || e}`); }
  };

  const refresh = useCallback(async () => {
    setItems(await loadDownloadItems());
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

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
      showToast('下载完成');
    } catch (error: any) {
      showToast(`下载失败：${error?.message || error}`);
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

  return (
    <View style={[styles.container, isDark && styles.containerDark]}>
      <ScreenHeader title="下载管理" right={
        <TouchableOpacity onPress={clearDone}>
          <Text style={styles.clearBtn}>清理完成</Text>
        </TouchableOpacity>
      } />

      <FadeInView delay={80} duration={300} style={{ flex: 1 }}>
        <View style={[styles.manualCard, isDark && styles.cardDark]}>
          <TextInput
            style={[styles.urlInput, isDark && styles.urlInputDark]}
            placeholder="粘贴图片、语音、视频或录播地址"
            placeholderTextColor={isDark ? '#aaaaaa' : '#666666'}
            value={url}
            onChangeText={setUrl}
            autoCapitalize="none"
          />
          <TouchableOpacity style={[styles.addBtn, busy && styles.btnDisabled]} onPress={startManualDownload} disabled={busy}>
            <Text style={styles.addBtnText}>{busy ? '下载中' : '添加下载'}</Text>
          </TouchableOpacity>
        </View>

        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={<Text style={[styles.empty, isDark && styles.textSubLight]}>暂无下载项目</Text>}
          initialNumToRender={12}
          maxToRenderPerBatch={12}
          windowSize={7}
          removeClippedSubviews
          renderItem={({ item, index }) => (
            <FadeInView delay={index < 12 ? 80 + index * 30 : 0} duration={300}>
              <View style={[styles.task, isDark && styles.cardDark]}>
                <View style={styles.taskHead}>
                  <Text style={[styles.typeTag, isDark && styles.typeTagDark]}>{typeLabel(item.type)}</Text>
                  <Text style={[styles.taskName, isDark && styles.textLight]} numberOfLines={1}>{item.name}</Text>
                </View>
                <View style={styles.progressBar}>
                  <View style={[
                    styles.progressFill,
                    item.status === 'failed' && styles.progressFailed,
                    { width: `${Math.round((item.progress || 0) * 100)}%` },
                  ]} />
                </View>
                <View style={styles.taskMeta}>
                  <Text style={[styles.taskStatus, isDark && styles.textSubLight]}>
                    {item.status === 'done' ? '完成' : item.status === 'failed' ? `失败：${item.error || ''}` : `下载中 ${formatBytes(item.downloadedBytes)} / ${formatBytes(item.totalBytes)}`}
                  </Text>
                  <View style={styles.taskActions}>
                    <TouchableOpacity onPress={() => handleOpen(item).catch((error: any) => showToast(`打开失败：${error?.message || error}`))}>
                      <Text style={styles.actionText}>打开</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => remove(item.id)}>
                      <Text style={[styles.actionText, styles.deleteText]}>删除</Text>
                    </TouchableOpacity>
                  </View>
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
  containerDark: { backgroundColor: 'transparent' },
  clearBtn: { color: '#ff6f91', fontSize: 13, minWidth: 54, textAlign: 'right' },
  manualCard: { marginHorizontal: 14, marginBottom: 8, padding: 12, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.72)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.66)' },
  cardDark: { backgroundColor: 'rgba(20,20,20,0.68)', borderColor: 'rgba(255,255,255,0.14)' },
  urlInput: { minHeight: 44, paddingHorizontal: 12, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.78)', color: '#222222', fontSize: 13 },
  urlInputDark: { backgroundColor: 'rgba(255,255,255,0.10)', color: '#ffffff' },
  addBtn: { marginTop: 10, minHeight: 42, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: '#ff6f91' },
  btnDisabled: { opacity: 0.55 },
  addBtnText: { color: '#ffffff', fontWeight: '800', fontSize: 14 },
  list: { paddingHorizontal: 14, paddingBottom: 112 },
  task: { marginVertical: 5, padding: 12, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.72)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.66)' },
  taskHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  typeTag: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 12, backgroundColor: '#ff6f91', color: '#ffffff', fontSize: 11, fontWeight: '800', overflow: 'hidden' },
  typeTagDark: { backgroundColor: '#ff6f91' },
  taskName: { flex: 1, color: '#222222', fontWeight: '800', fontSize: 14 },
  progressBar: { height: 5, marginVertical: 10, backgroundColor: 'rgba(0,0,0,0.10)', borderRadius: 4, overflow: 'hidden' },
  progressFill: { height: 5, backgroundColor: '#ff6f91', borderRadius: 4 },
  progressFailed: { backgroundColor: '#ff4444' },
  taskMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  taskStatus: { flex: 1, color: '#555555', fontSize: 12 },
  taskActions: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  actionText: { color: '#ff6f91', fontSize: 12, fontWeight: '800' },
  deleteText: { color: '#ff4444' },
  empty: { textAlign: 'center', marginTop: 60, color: '#555555' },
  textLight: { color: '#ffffff' },
  textSubLight: { color: '#dddddd' },
  imgModal: { flex: 1, backgroundColor: 'rgba(0,0,0,0.94)', alignItems: 'center', justifyContent: 'center' },
  imgFull: { width: '96%', height: '80%' },
});
