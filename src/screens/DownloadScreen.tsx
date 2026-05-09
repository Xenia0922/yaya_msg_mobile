import React, { useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, FlatList, StyleSheet, Alert,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/types';
import { useSettingsStore } from '../store';
import * as FileSystem from 'expo-file-system';

type Nav = StackNavigationProp<RootStackParamList, 'DownloadScreen'>;

interface DownloadTask {
  id: string;
  name: string;
  progress: number;
  status: 'pending' | 'downloading' | 'paused' | 'done' | 'failed';
  totalSize: string;
  downloaded: string;
}

export default function DownloadScreen() {
  const navigation = useNavigation<Nav>();
  const isDark = useSettingsStore((s) => s.settings.theme === 'dark');
  const [tasks, setTasks] = useState<DownloadTask[]>([]);
  const [downloading, setDownloading] = useState(false);
  const [url, setUrl] = useState('');

  const addDownload = () => {
    if (!url.trim()) return;
    const task: DownloadTask = {
      id: Date.now().toString(),
      name: url.split('/').pop() || '下载文件',
      progress: 0,
      status: 'pending',
      totalSize: '--',
      downloaded: '0 MB',
    };
    setTasks((prev) => [task, ...prev]);
    startDownload(task);
  };

  const startDownload = async (task: DownloadTask) => {
    setTasks((prev) => prev.map((t) => t.id === task.id ? { ...t, status: 'downloading' } : t));
    try {
      const filename = task.id + '_' + task.name;
      const dest = ((FileSystem as any).documentDirectory || 'file:///data/user/0/com.anonymous.yaya_msgmobile/files/') + filename;
      const resumable = FileSystem.createDownloadResumable(
        task.name.startsWith('http') ? task.name : url,
        dest,
        {},
        (progress) => {
          const pct = progress.totalBytesExpectedToWrite
            ? progress.totalBytesWritten / progress.totalBytesExpectedToWrite
            : 0;
          setTasks((prev) => prev.map((t) =>
            t.id === task.id
              ? { ...t, progress: pct, downloaded: `${(progress.totalBytesWritten / 1e6).toFixed(1)} MB` }
              : t
          ));
        }
      );
      const result = await resumable.downloadAsync();
      if (result?.uri) {
        setTasks((prev) => prev.map((t) =>
          t.id === task.id ? { ...t, status: 'done', progress: 1 } : t
        ));
      }
    } catch (e: any) {
      setTasks((prev) => prev.map((t) =>
        t.id === task.id ? { ...t, status: 'failed' } : t
      ));
    }
  };

  const removeTask = (id: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
  };

  const clearDone = () => {
    setTasks((prev) => prev.filter((t) => t.status !== 'done'));
  };

  return (
    <View style={[styles.container, isDark && styles.containerDark]}>
      <View style={[styles.header, isDark && styles.headerDark]}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backBtn}>← 返回</Text>
        </TouchableOpacity>
        <Text style={[styles.title, isDark && styles.textLight]}>下载管理</Text>
        <TouchableOpacity onPress={clearDone}>
          <Text style={styles.clearBtn}>清除已完成</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={tasks}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={<Text style={styles.empty}>暂无下载任务</Text>}
        renderItem={({ item }) => (
          <View style={[styles.task, isDark && styles.taskDark]}>
            <Text style={[styles.taskName, isDark && styles.textLight]} numberOfLines={1}>{item.name}</Text>
            <View style={styles.progressBar}>
              <View style={[
                styles.progressFill,
                { width: `${Math.round(item.progress * 100)}%` },
                item.status === 'failed' && styles.progressFailed,
              ]} />
            </View>
            <View style={styles.taskMeta}>
              <Text style={styles.taskStatus}>
                {item.status === 'downloading' ? `下载中 ${item.downloaded}` :
                 item.status === 'done' ? '完成' :
                 item.status === 'failed' ? '失败' : '等待中'}
              </Text>
              <TouchableOpacity onPress={() => removeTask(item.id)}>
                <Text style={styles.deleteBtn}>删除</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      />

      <View style={[styles.addBar, isDark && styles.addBarDark]}>
        <TouchableOpacity style={styles.addBtn} onPress={addDownload}>
          <Text style={styles.addBtnText}>+ 添加下载</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  containerDark: { backgroundColor: 'transparent' },
  header: { paddingTop: 54, paddingHorizontal: 20, paddingBottom: 14, marginBottom: 4, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerDark: {},
  backBtn: { color: '#ff6f91', fontSize: 14 },
  title: { fontSize: 18, fontWeight: 'bold', color: '#ff6f91' },
  clearBtn: { fontSize: 12, color: '#ff6f91' },
  task: { backgroundColor: 'rgba(255,255,255,0.46)', marginHorizontal: 12, marginVertical: 4, padding: 12, borderRadius: 16 },
  taskDark: { backgroundColor: 'rgba(20,20,20,0.58)' },
  taskName: { fontSize: 13, fontWeight: '600', color: '#333', marginBottom: 6 },
  progressBar: { height: 4, backgroundColor: 'rgba(238,238,238,0.82)', borderRadius: 2, marginBottom: 6 },
  progressFill: { height: 4, backgroundColor: '#ff6f91', borderRadius: 2 },
  progressFailed: { backgroundColor: '#ff4444' },
  taskMeta: { flexDirection: 'row', justifyContent: 'space-between' },
  taskStatus: { fontSize: 11, color: '#333333' },
  deleteBtn: { fontSize: 11, color: '#ff4444' },
  addBar: { padding: 12, backgroundColor: 'rgba(255,255,255,0.46)', borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.42)' },
  addBarDark: { backgroundColor: 'rgba(20,20,20,0.58)', borderTopColor: 'rgba(255,255,255,0.12)' },
  addBtn: { padding: 12, borderRadius: 18, backgroundColor: '#ff6f91', alignItems: 'center' },
  addBtnText: { color: '#fff', fontWeight: '600' },
  empty: { textAlign: 'center', color: '#333333', marginTop: 60 },
  textLight: { color: '#eee' },
});
