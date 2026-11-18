import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { DeviceEventEmitter, StyleSheet, useWindowDimensions } from 'react-native';
import Video, { ViewType } from 'react-native-video';
import { PlayerSource } from '../types';
import { logInfo } from '../../utils/runtimeLog';

export interface NativeKernelHandle {
  seek: (t: number) => void;
}

interface Props {
  source: PlayerSource;
  paused: boolean;
  rate: number;
  /** 音量（B站流响度补偿用，默认 1） */
  volume?: number;
  /** 续播起点（onLoad 后 seek） */
  resumeAt?: number;
  onLoad: (duration: number, naturalSize?: { width: number; height: number }) => void;
  onProgress: (t: number) => void;
  onEnd: () => void;
  onError: (detail: string) => void;
  /** 首帧上屏（诊断 + 结束 loading） */
  onFirstFrame?: () => void;
  /** 缓冲开始/结束（诊断卡顿） */
  onBufferChange?: (buffering: boolean) => void;
}

/** RNV 内核：HLS/mp4/mp3/flac 等 ExoPlayer 支持的流 */
export const NativeKernel = forwardRef<NativeKernelHandle, Props>(function NativeKernel(
  {
    source,
    paused,
    rate,
    volume = 1,
    resumeAt,
    onLoad,
    onProgress,
    onEnd,
    onError,
    onFirstFrame,
    onBufferChange,
  },
  ref,
) {
  const videoRef = useRef<any>(null);
  const window = useWindowDimensions();
  const [videoSize, setVideoSize] = useState<{ url: string; width: number; height: number } | null>(
    null,
  );
  const [inPip, setInPip] = useState(false);
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('PipEnteredChanged', (entered: boolean) =>
      setInPip(!!entered),
    );
    return () => sub.remove();
  }, []);
  const cover =
    !!source.coverPortrait &&
    window.width < window.height &&
    videoSize?.url === source.url &&
    videoSize.width < videoSize.height;
  useImperativeHandle(ref, () => ({
    seek: (t: number) => {
      try {
        videoRef.current?.seek?.(t);
      } catch {}
    },
  }));
  return (
    <Video
      ref={videoRef}
      key={source.url}
      source={{
        uri: source.url,
        ...(source.headers ? { headers: source.headers } : {}),
      }}
      // AWS/CDN 流播放中偶发缓冲耗尽卡顿：加大 Exo 缓冲池 + 30s 回看缓冲。
      // ⚠️ react-native-video v6 要求 bufferConfig 是顶层 prop，放进 source 内不会生效。
      bufferConfig={{
        minBufferMs: 15000,
        maxBufferMs: 60000,
        bufferForPlaybackMs: 5000,
        bufferForPlaybackAfterRebufferMs: 10000,
        backBufferDurationMs: 30000,
      }}
      style={StyleSheet.absoluteFill}
      // 系统 PiP 从 SurfaceView 切 TextureView：避免进入/双击缩放小窗时长时间黑屏。
      viewType={ViewType.TEXTURE}
      // 系统小窗内始终 contain：Android 双击放大/缩小时不能被 cover 裁掉画面边缘。
      resizeMode={inPip ? 'contain' : cover ? 'cover' : 'contain'}
      paused={paused}
      rate={rate}
      volume={volume}
      progressUpdateInterval={250}
      ignoreSilentSwitch="ignore"
      playInBackground
      playWhenInactive
      onLoad={(e) => {
        try {
          logInfo(`[vod] NativeKernel onLoad dur=${Math.round(e.duration || 0)}`, 'player.native');
        } catch {}
        const ns = e?.naturalSize;
        if (ns && Number(ns.width) > 0 && Number(ns.height) > 0) {
          setVideoSize({ url: source.url, width: Number(ns.width), height: Number(ns.height) });
        }
        onLoad(
          e.duration || 0,
          ns && Number(ns.width) > 0 && Number(ns.height) > 0
            ? { width: Number(ns.width), height: Number(ns.height) }
            : undefined,
        );
        if (resumeAt && resumeAt > 1) {
          try {
            videoRef.current?.seek?.(resumeAt);
          } catch {}
        }
      }}
      onProgress={(e) => onProgress(e.currentTime || 0)}
      onEnd={onEnd}
      onReadyForDisplay={() => {
        try {
          logInfo('[vod] first frame onReadyForDisplay', 'player.native');
        } catch {}
        onFirstFrame?.();
      }}
      onBuffer={(e) => {
        onBufferChange?.(!!e?.isBuffering);
      }}
      onError={(event: any) => {
        try {
          const raw = event?.error || event;
          const msg = String(
            raw?.message || raw?.errorType || raw?.type || raw?.code || raw?.cause?.message || '',
          );
          const full = JSON.stringify(raw || {}).slice(0, 1400);
          logInfo(
            `[vod] onError msg=${msg.slice(0, 260)} full=${full.slice(0, 1000)}`,
            'player.native',
          );
        } catch {}
        onError(JSON.stringify(event?.error || event).slice(0, 220));
      }}
    />
  );
});

export default NativeKernel;
