import React, { Component, ErrorInfo, ReactNode } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSettingsStore } from '../store';
import { logCrash } from '../utils/runtimeLog';

interface Props { children: ReactNode; }
interface State { error: Error | null; }

function ErrorFallback({ error, onRetry }: { error: Error; onRetry: () => void }) {
  const isDark = useSettingsStore((s) => s.settings.theme === 'dark');
  return (
    <View style={[styles.container, isDark && styles.containerDark]}>
      <Text style={styles.title}>出现错误</Text>
      <Text style={[styles.message, isDark && styles.messageDark]}>{error.message}</Text>
      <TouchableOpacity style={styles.btn} onPress={onRetry}>
        <Text style={styles.btnText}>重试</Text>
      </TouchableOpacity>
    </View>
  );
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.warn('ErrorBoundary caught:', error.message, info.componentStack?.slice(0, 200));
    logCrash(error, `render:${info.componentStack?.split('\n')[1]?.trim().slice(0, 80) || 'unknown'}`);
  }
  render() {
    if (this.state.error) {
      return <ErrorFallback error={this.state.error} onRetry={() => this.setState({ error: null })} />;
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40, backgroundColor: '#f5f5f5' },
  containerDark: { backgroundColor: '#1a1a1a' },
  title: { fontSize: 20, fontWeight: '800', color: '#ff6f91', marginBottom: 12 },
  message: { fontSize: 13, color: '#555', textAlign: 'center', marginBottom: 24, lineHeight: 20 },
  messageDark: { color: '#aaa' },
  btn: { paddingHorizontal: 24, paddingVertical: 10, borderRadius: 18, backgroundColor: '#ff6f91' },
  btnText: { color: '#fff', fontSize: 14, fontWeight: '800' },
});
