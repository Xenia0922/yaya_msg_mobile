import React, { useCallback, useEffect, useRef, useState } from 'react';
import { usePlayerStore } from '../store/playerStore';
import { logWarn } from '../../utils/runtimeLog';
import { NativeKernel, NativeKernelHandle } from './NativeKernel';
import { ExoKernel } from './ExoKernel';
import { WebKernel, WebKernelHandle } from './WebKernel';
import { kernelForSource } from '../store/playerStore';
import { isRtmpUrl } from '../resolve/streamResolver';

export function PlayerCore({
  onVideoSize,
  resumeAt: externalResumeAt,
}: {
  onVideoSize?: (w: number, h: number) => void;
  resumeAt?: number;
}) {
  const source = usePlayerStore((s) => s.source);
  const state = usePlayerStore((s) => s.state);
  const activeKernel = usePlayerStore((s) => s.activeKernel);
  const useWebKernel = usePlayerStore((s) => s.useWebKernel);
  const position = usePlayerStore((s) => s.position);
  const nativeRef = useRef<NativeKernelHandle>(null);
  const webRef = useRef<WebKernelHandle>(null);

  const lastLogged = useRef('');

  const webFallbackDone = useRef(false);
  const sourceChangedRef = useRef('');

  const [retryNonce, setRetryNonce] = useState(0);
  const liveRetry = useRef<{ count: number; timer: ReturnType<typeof setTimeout> | null }>({
    count: 0,
    timer: null,
  });

  const setState = usePlayerStore((s) => s.setState);
  const setPosition = usePlayerStore((s) => s.setPosition);
  const setDuration = usePlayerStore((s) => s.setDuration);
  const setError = usePlayerStore((s) => s.setError);
  const setActiveKernel = usePlayerStore((s) => s.setActiveKernel);
  const setUseWebKernel = usePlayerStore((s) => s.setUseWebKernel);

  const seekNonce = usePlayerStore((s) => s.seekNonce);
  const rebuildNonce = usePlayerStore((s) => s.rebuildNonce);

  useEffect(() => {
    if (!rebuildNonce) return;
    usePlayerStore.getState().clearError();
    setRetryNonce((n) => n + 1);
  }, [rebuildNonce]);

  useEffect(() => {
    if (!seekNonce) return;
    const seekTarget = usePlayerStore.getState().seekTarget;
    const su = String(source?.url || '').toLowerCase();
    const liveShape = source?.kind === 'live' || isRtmpUrl(su) || su.includes('.flv');
    if (liveShape) {
      usePlayerStore.getState().clearSeekTarget();
      return;
    }

    const sd = usePlayerStore.getState().duration;
    if (!Number.isFinite(sd) || sd <= 0) {
      usePlayerStore.getState().clearSeekTarget();
      return;
    }

    const target = Math.max(0, Math.min(sd - 0.3, seekTarget));
    usePlayerStore.getState().markSeekIssued(target);
    if (!useWebKernel && activeKernel === 'native' && nativeRef.current) {
      try {
        nativeRef.current.seek(target);
      } catch (err) {
        logWarn(`[PlayerCore] native seek err ${String(err)}`, 'player.core');
      }
    } else if (useWebKernel && webRef.current) {
      try {
        webRef.current.seek(target);
      } catch (err) {
        logWarn(`[PlayerCore] web seek err ${String(err)}`, 'player.core');
      }
    }
  }, [seekNonce, useWebKernel, activeKernel, source?.kind, source?.url]);

  const rate = usePlayerStore((s) => s.rate);
  useEffect(() => {
    if (useWebKernel && webRef.current && rate > 0) {
      webRef.current.setRate(rate);
    }
  }, [rate, useWebKernel]);

  const kernelForState = useWebKernel ? 'web' : activeKernel;
  const webPauseRef = useRef<boolean | null>(null);

  useEffect(() => {
    webPauseRef.current = null;
  }, [kernelForState, source?.url]);
  useEffect(() => {
    if (kernelForState !== 'web' || !source?.url || !webRef.current) return;
    if (state !== 'playing' && state !== 'paused') return;
    const wantPaused = state === 'paused';
    if (webPauseRef.current === wantPaused) return;
    webPauseRef.current = wantPaused;
    try {
      webRef.current.setPaused(wantPaused);
    } catch (err) {
      logWarn(`[PlayerCore] web pause err ${String(err)}`, 'player.core');
    }
  }, [state, kernelForState, source?.url]);

  const handleLoad = useCallback(
    (duration: number, naturalSize?: { width: number; height: number }) => {
      setDuration(duration);
      setState('playing');
      if (naturalSize && naturalSize.width > 0 && naturalSize.height > 0) {
        usePlayerStore
          .getState()
          .setVideoMeta(
            { w: naturalSize.width, h: naturalSize.height },
            naturalSize.width > naturalSize.height,
          );
        onVideoSize?.(naturalSize.width, naturalSize.height);
      }
    },
    [setDuration, setState, onVideoSize],
  );

  const handleProgress = useCallback(
    (t: number) => {
      if (state !== 'paused') setPosition(t);
    },
    [state, setPosition],
  );

  const switchToWeb = useCallback(() => {
    setUseWebKernel(true);
    setError('');
    setState('playing');
  }, [setUseWebKernel, setError, setState]);

  const kernelError = useCallback(
    (msg: string) => {
      try {
        logWarn(`[player] kernel fail ${msg}`, 'player.kernelError');
      } catch {}

      if (source?.kind === 'audio' && !webFallbackDone.current && !useWebKernel) {
        webFallbackDone.current = true;
        try {
          logWarn('[player] audio native failed → fallback web kernel', 'player.kernelError');
        } catch {}
        setError('');
        setState('loading');
        setUseWebKernel(true);
        return;
      }

      const switched = usePlayerStore.getState().nextCandidate();
      if (switched) return;

      const uNow = String(source?.url || '').toLowerCase();
      const isLive = source?.kind === 'live' || isRtmpUrl(uNow) || uNow.includes('.flv');
      if (isLive && liveRetry.current.count < 3) {
        liveRetry.current.count += 1;
        const n = liveRetry.current.count;
        const delay = 1500 * Math.pow(2, n - 1);
        try {
          logWarn(`[player] live reconnect ${n}/3 in ${delay}ms`, 'player.reconnect');
        } catch {}
        setError('');
        setState('loading');
        if (liveRetry.current.timer) clearTimeout(liveRetry.current.timer);
        liveRetry.current.timer = setTimeout(() => {
          liveRetry.current.timer = null;
          setRetryNonce((v) => v + 1);
        }, delay);
        return;
      }
      setError(msg);
      setState('error');
    },
    [setError, setState, setUseWebKernel, source?.kind, source?.url, useWebKernel],
  );

  useEffect(() => {
    if (state === 'playing') liveRetry.current.count = 0;
  }, [state]);
  useEffect(() => {
    liveRetry.current.count = 0;
    if (liveRetry.current.timer) {
      clearTimeout(liveRetry.current.timer);
      liveRetry.current.timer = null;
    }
  }, [source?.url]);

  useEffect(() => {
    const url = source?.url || '';
    if (sourceChangedRef.current === url) return;
    sourceChangedRef.current = url;
    webFallbackDone.current = false;
  }, [source?.url]);
  useEffect(
    () => () => {
      if (liveRetry.current.timer) clearTimeout(liveRetry.current.timer);
    },
    [],
  );

  const kernel = useWebKernel ? 'web' : activeKernel;

  useEffect(() => {
    if (useWebKernel) {
      if (usePlayerStore.getState().activeKernel !== 'web') setActiveKernel('web');
    } else if (source && usePlayerStore.getState().activeKernel === 'web') {
      setActiveKernel(kernelForSource(source));
    }
  }, [useWebKernel, source, setActiveKernel]);

  if (!source || !source.url) return null;

  const paused = state !== 'playing';

  if (lastLogged.current !== `${kernel}|${source.url}`) {
    lastLogged.current = `${kernel}|${source.url}`;
    try {
      logWarn(
        `[player] open kernel=${kernel} state=${state} kind=${source.kind} url=${String(source.url).slice(0, 90)}`,
        'player.core',
      );
    } catch {}
  }

  if (kernel === 'web') {
    return (
      <WebKernel
        key={`web-${source.url}-${retryNonce}`}
        ref={webRef}
        source={source}
        resumeAt={position > 1 ? position : 0}
        onProgress={handleProgress}
        onEnded={() => setState('paused')}
        onFirstFrame={() => {
          if (usePlayerStore.getState().state === 'loading') setState('playing');
        }}
        onVideoSize={onVideoSize}
        onError={(msg) => {
          const st0 = usePlayerStore.getState();
          if (st0.forceWebOnce && !webFallbackDone.current) {
            webFallbackDone.current = true;
            st0.setForceWebOnce(false);
            st0.setUseWebKernel(false);
            return;
          }
          kernelError(msg);
        }}
      />
    );
  }
  if (kernel === 'exo') {
    return (
      <ExoKernel
        key={`exo-${source.url}-${retryNonce}`}
        source={source}
        onVideoSize={onVideoSize}
        onError={(msg) => {
          kernelError(msg);

          const uWeb = String(source.url || '').toLowerCase();
          const webable =
            !source.audioOnly &&
            /^https?:/i.test(uWeb) &&
            !isRtmpUrl(uWeb) &&
            !uWeb.includes('.flv');
          if (webable) switchToWeb();
        }}
      />
    );
  }
  return (
    <NativeKernel
      key={`native-${source.url}-${retryNonce}`}
      ref={nativeRef}
      source={source}
      paused={paused}
      rate={rate}
      volume={source.volume}
      resumeAt={
        externalResumeAt && externalResumeAt > 1 ? externalResumeAt : position > 1 ? position : 0
      }
      onLoad={handleLoad}
      onProgress={handleProgress}
      onEnd={() => setState('paused')}
      onFirstFrame={() => {
        if (usePlayerStore.getState().state === 'loading') setState('playing');
      }}
      onBufferChange={(buffering) => {
        try {
          logWarn(`[vod] buffer ${buffering ? 'start' : 'end'}`, 'player.native');
        } catch {}

        if (buffering) usePlayerStore.getState().toggleControls(true);
      }}
      onError={(detail) => kernelError(`原生播放器失败：${detail}`)}
    />
  );
}

export default PlayerCore;
