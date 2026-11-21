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

  volume?: number;

  resumeAt?: number;
  onLoad: (duration: number, naturalSize?: { width: number; height: number }) => void;
  onProgress: (t: number) => void;
  onEnd: () => void;
  onError: (detail: string) => void;

  onFirstFrame?: () => void;

  onBufferChange?: (buffering: boolean) => void;
}

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

      bufferConfig={{
        minBufferMs: 15000,
        maxBufferMs: 60000,
        bufferForPlaybackMs: 5000,
        bufferForPlaybackAfterRebufferMs: 10000,
        backBufferDurationMs: 30000,
      }}
      style={StyleSheet.absoluteFill}

      viewType={ViewType.TEXTURE}

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
