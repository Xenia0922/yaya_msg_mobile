import React, { forwardRef, useImperativeHandle, useMemo, useRef } from 'react';
import { StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';
import { getPlayerHtml } from '../../components/media/player';
import { setPipAspect } from '../../utils/pip';
import { usePlayerStore } from '../store/playerStore';
import { PlayerSource } from '../types';

interface Props {
  source: PlayerSource;
  resumeAt?: number;
  onProgress: (t: number) => void;
  onEnded: () => void;
  onError: (message: string) => void;

  onFirstFrame?: () => void;
  onVideoSize?: (w: number, h: number) => void;
}

export interface WebKernelHandle {
  seek: (t: number) => void;
  setRate: (r: number) => void;
  setPaused: (p: boolean) => void;
}

export const WebKernel = forwardRef<WebKernelHandle, Props>(function WebKernel(
  { source, resumeAt, onProgress, onEnded, onError, onFirstFrame, onVideoSize },
  ref,
) {
  const webRef = useRef<WebView>(null);

  useImperativeHandle(ref, () => ({
    seek: (t: number) => {
      webRef.current?.postMessage(JSON.stringify({ type: 'seek', time: Math.max(0, t) }));
    },
    setRate: (r: number) => {
      webRef.current?.postMessage(JSON.stringify({ type: 'rate', rate: r }));
    },
    setPaused: (p: boolean) => {
      webRef.current?.postMessage(JSON.stringify({ type: p ? 'pause' : 'play' }));
    },
  }));

  const resumeOnce = useRef<number>(resumeAt || 0);
  const html = useMemo(
    () =>
      getPlayerHtml(
        source.url,
        undefined,
        resumeOnce.current || 0,
        false,
        (source.headers || {}) as any,
        Number(source.volumeBoost) || 1,
        !!source.coverPortrait,
      ),

    [source.url, source.headers, source.coverPortrait, source.volumeBoost],
  );

  return (
    <WebView
      ref={webRef}
      source={{ html }}
      style={StyleSheet.absoluteFill}
      javaScriptEnabled
      domStorageEnabled
      allowsInlineMediaPlayback
      mediaPlaybackRequiresUserAction={false}
      originWhitelist={['*']}
      mixedContentMode="always"
      allowsFullscreenVideo
      onMessage={(e) => {
        try {
          const data = JSON.parse(e.nativeEvent.data);
          if (data.type === 'progress') {
            onProgress(Number(data.time) || 0);
          } else if (data.type === 'started') {
            onFirstFrame?.();
          } else if (data.type === 'ended') {
            onEnded();
          } else if (data.type === 'error') {
            onError(String(data.error || '').slice(0, 160) || '网页播放器错误');
          } else if (data.type === 'duration') {
            const dur = Number(data.duration) || 0;
            if (Number.isFinite(dur) && dur > 0) usePlayerStore.getState().setDuration(dur);
          } else if (data.type === 'videosize') {
            const w = Number(data.width) || 0;
            const h = Number(data.height) || 0;
            if (w > 0 && h > 0) {
              usePlayerStore.getState().setVideoMeta({ w, h }, w > h);
              onVideoSize?.(w, h);
              setPipAspect(w, h);
            }
          }
        } catch {}
      }}
      onError={(syntheticEvent) => {
        onError(
          String(syntheticEvent?.nativeEvent?.description || '').slice(0, 160) ||
            '网页播放器加载失败',
        );
      }}
    />
  );
});

export default WebKernel;
