import React, { Component, ErrorInfo, ReactNode } from 'react';
import { View } from 'react-native';
import { logCrash } from '../utils/runtimeLog';
import { useI18n } from '../i18n';
import { ErrorState } from './StateViews';
import { usePalette } from '../theme';

interface Props { children: ReactNode; }
interface State { error: Error | null; }

function ErrorFallback({ error, onRetry }: { error: Error; onRetry: () => void }) {
  const palette = usePalette();
  const { t } = useI18n();
  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: palette.background, padding: 40 }}>
      <ErrorState
        icon="alert-circle-outline"
        title={t('出现错误')}
        hint={error.message}
        actionLabel={t('重试')}
        onAction={onRetry}
      />
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
