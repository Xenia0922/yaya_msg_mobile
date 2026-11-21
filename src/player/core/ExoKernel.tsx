import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet } from 'react-native';
import { LiveExoView, onLiveFirstFrame, onLiveNativeError } from '../../native/LivePlayer';
import { usePlayerStore } from '../store/playerStore';
import { PlayerSource } from '../types';
import { logInfo } from '../../utils/runtimeLog';
import { setPipAspect, setPipAspectLive } from '../../utils/pip';

interface Props {
  source: PlayerSource;
  onError: (_message: string) => void;
  onVideoSize?: (_w: number, _h: number) => void;
}

export function ExoKernel({ source, onError, onVideoSize }: Props) {
  const MAX_RECONNECT = 0;
  const attemptsRef = useRef(0);
  const [nonce, setNonce] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onVideoSizeRef = useRef(onVideoSize);
  onVideoSizeRef.current = onVideoSize;

  const applyDetectedSize = useCallback(
    (payload: {
      width?: number;
      height?: number;
      visualWidth?: number;
      visualHeight?: number;
      isLandscape?: boolean;
    }) => {
      const rawW = Number(payload.width) || 0;
      const rawH = Number(payload.height) || 0;
      const visW = Number(payload.visualWidth) || rawW;
      const visH = Number(payload.visualHeight) || rawH;
      if (rawW <= 0 || rawH <= 0) return;
      const isLand = typeof payload.isLandscape === 'boolean' ? payload.isLandscape : visW > visH;
      const cur = usePlayerStore.getState();
      if (cur.state === 'loading' || cur.state === 'idle') cur.setState('playing');
      cur.setVideoMeta(visW > 0 && visH > 0 ? { w: visW, h: visH } : null, isLand);
      onVideoSizeRef.current?.(visW, visH);
      if (cur.source?.kind === 'live') {
        setPipAspectLive(isLand);
      } else {
        setPipAspect(visW, visH);
      }
    },
    [],
  );

  const handleFailure = useCallback(
    (msg: string) => {
      if (attemptsRef.current >= MAX_RECONNECT) {
        try {
          logInfo(`[live] 自动重连已达上限(${MAX_RECONNECT})，报错终止 msg=${msg}`, 'player.exo');
        } catch {}
        onError(msg);
        return;
      }
      const n = attemptsRef.current++;
      const delay = Math.min(8000, 1000 * Math.pow(2, n));
      try {
        logInfo(
          `[live] 断流，自动重连第 ${n + 1}/${MAX_RECONNECT} 次（${delay}ms 后）msg=${msg}`,
          'player.exo',
        );
      } catch {}
      const st = usePlayerStore.getState();
      if (st.state !== 'idle') st.setState('loading');
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setNonce((v) => v + 1), delay);
    },
    [onError],
  );

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  useEffect(() => {
    try {
      logInfo(
        `[live] ExoKernel open url=${String(source.url).slice(0, 90)} audioOnly=${!!source.audioOnly}`,
        'player.exo',
      );
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source.url]);

  useEffect(() => {
    const url = String(source.url || '');
    if (!url) return () => {};
    const offSize = onLiveFirstFrame((p) => {
      if (p.url && p.url !== url) return;
      if (p.width <= 0 || p.height <= 0) return;
      try {
        logInfo('[live] ExoKernel first frame (native event) → playing', 'player.exo');
      } catch {}

      attemptsRef.current = 0;
      applyDetectedSize(p);
    });
    const offError = onLiveNativeError((p) => {
      if (p.url && p.url !== url) return;
      if (!p.message) return;
      handleFailure(String(p.message).slice(0, 160));
    });
    return () => {
      offSize();
      offError();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source.url]);

  const paused = usePlayerStore((s) => s.state === 'paused');
  if (Platform.OS !== 'android' || !LiveExoView) {
    return null;
  }
  return (
    <LiveExoView
      key={`exo-${nonce}`}
      style={StyleSheet.absoluteFill}
      url={source.url}
      audioOnly={source.audioOnly}
      coverPortrait={source.coverPortrait}
      paused={paused}
      onSize={(e) => {
        try {
          logInfo('[live] ExoKernel first frame (onSize) → playing', 'player.exo');
        } catch {}

        attemptsRef.current = 0;
        applyDetectedSize(e?.nativeEvent || {});
      }}
      onError={(e) => {
        handleFailure(String(e?.nativeEvent?.message || '').slice(0, 160) || '无法连接直播源');
      }}
    />
  );
}

export default ExoKernel;
