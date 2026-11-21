import React, { ReactNode, useEffect, useRef, useState } from 'react';
import { DeviceEventEmitter, Modal, StyleSheet, View, useWindowDimensions } from 'react-native';
import { usePlayerStore } from './store/playerStore';
import { useMiniPlayerStore } from '../store/miniPlayerStore';
import { PlayerCore } from './core/PlayerCore';
import { PlayerChrome } from './chrome/PlayerChrome';
import { FullscreenManager } from './chrome/FullscreenManager';
import { PlayerScreenProps } from './types';
import { logInfo } from '../utils/runtimeLog';
import { setPipAspect, setPipAspectLive, setPipPlaying } from '../utils/pip';
import { isSharePageUrl, resolveSharePageUrl } from './resolve/sharePage';

interface Props extends PlayerScreenProps {
  children?: ReactNode;

  persistent?: boolean;

  inline?: boolean;

  onVideoSize?: (_w: number, _h: number) => void;

  resumeAt?: number;

  onRetry?: () => void;

  barrageInput?: ReactNode;
}

export function PlayerScreen({
  source,
  meta,
  pocket,
  danmaku = { type: 'none' },
  features = {},
  extraActions = [],
  onClose,
  children,
  persistent: _persistent = false,
  inline = false,
  onVideoSize,
  resumeAt,
  onRetry,
  barrageInput,
  chromeHidden = false,
  liveTransitionKey = 0,
}: Props) {
  const dbgState = usePlayerStore((s) => s.state);
  const autoRetryLeft = useRef(2);

  const onRetryRef = useRef(onRetry);
  onRetryRef.current = onRetry;
  const lastTransition = useRef(liveTransitionKey);
  useEffect(() => {
    if (lastTransition.current === liveTransitionKey) return;
    lastTransition.current = liveTransitionKey;
    if (source.kind !== 'live') return;

    const timer = setTimeout(() => {
      if (usePlayerStore.getState().state === 'paused') return;
      if (onRetryRef.current) onRetryRef.current();
      else usePlayerStore.getState().requestKernelRebuild();
    }, 900);
    return () => clearTimeout(timer);
  }, [liveTransitionKey, source.kind]);
  useEffect(() => {
    autoRetryLeft.current = 2;
  }, [source.url]);
  useEffect(() => {
    if (dbgState !== 'error' || !onRetryRef.current) return;

    if (usePlayerStore.getState().activeKernel === 'web') return;
    if (autoRetryLeft.current <= 0) return;
    autoRetryLeft.current -= 1;
    try {
      logInfo(
        `[player] error → auto re-resolve (fresh url), left=${autoRetryLeft.current}`,
        'player.screen',
      );
    } catch {}
    const t = setTimeout(() => {
      try {
        onRetryRef.current?.();
      } catch {}
    }, 900);
    return () => clearTimeout(t);
  }, [dbgState]);

  useEffect(() => {
    if (!onClose) return;
    const prev = usePlayerStore.getState().onClose;
    usePlayerStore.getState().setOnClose(onClose);
    return () => {
      if (usePlayerStore.getState().onClose === onClose) {
        usePlayerStore.getState().setOnClose(prev);
      }
    };
  }, [onClose]);
  const openedFor = useRef('');

  const openTokenAtOpen = useRef(0);
  const openingPending = useRef(false);
  const sourceUrl = source.url || '';
  const fullscreen = usePlayerStore((s) => s.fullscreen);
  const cleanScreen = usePlayerStore((s) => s.cleanScreen);
  const detectedLandscape = usePlayerStore((s) => s.detectedLandscape);
  const detectedAspect = usePlayerStore((s) => s.detectedAspect);
  const [inPip, setInPip] = useState(false);
  const autoLandscapeRef = useRef('');
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('PipEnteredChanged', (entered: boolean) => {
      setInPip(!!entered);
    });
    return () => sub.remove();
  }, []);

  const win = useWindowDimensions();
  useEffect(() => {
    if (detectedAspect && detectedAspect.w > 0 && detectedAspect.h > 0) {
      if (source.kind === 'live') {
        if (detectedLandscape) setPipAspectLive(true);
        else setPipAspect(detectedAspect.w, detectedAspect.h);
      } else {
        setPipAspect(detectedAspect.w, detectedAspect.h);
      }
      return;
    }
    if (win.width > 0 && win.height > 0) setPipAspectLive(win.width > win.height);
  }, [detectedAspect, detectedLandscape, source.kind, win.width, win.height]);

  useEffect(() => {
    if (!sourceUrl || !detectedLandscape) return;
    if (inline || source.kind === 'audio' || source.audioOnly || inPip) return;
    if (autoLandscapeRef.current === sourceUrl) return;
    autoLandscapeRef.current = sourceUrl;
    const st = usePlayerStore.getState();
    if (!st.fullscreen) st.setFullscreen(true);
  }, [sourceUrl, detectedLandscape, inline, source.kind, source.audioOnly, inPip]);

  useEffect(() => {
    if (source.kind !== 'vod' || !sourceUrl || dbgState === 'idle' || dbgState === 'error') return;
    setPipPlaying(true, 'player-screen-vod');
    return () => setPipPlaying(false, 'player-screen-vod');
  }, [source.kind, sourceUrl, dbgState]);

  const rotateDeg = usePlayerStore((s) => s.rotateDeg);
  const mirrorMode = usePlayerStore((s) => s.mirrorMode);
  const mediaTransform: any = [];
  if (mirrorMode === 'horizontal') mediaTransform.push({ scaleX: -1 });
  if (mirrorMode === 'vertical') mediaTransform.push({ scaleY: -1 });
  if (rotateDeg) mediaTransform.push({ rotate: `${rotateDeg}deg` });

  useEffect(() => {
    if (openedFor.current === sourceUrl) return;
    openedFor.current = sourceUrl;
    openingPending.current = true;
    let cancelled = false;
    (async () => {
      let openSource: typeof source = source;
      if (sourceUrl && isSharePageUrl(sourceUrl)) {
        const resolved = await resolveSharePageUrl(sourceUrl).catch(() => null);
        if (cancelled) return;
        if (resolved) {
          openSource = { ...source, url: resolved.url, urls: resolved.urls };
          try {
            logInfo(
              `[player] share page resolved before open: ${resolved.url.slice(0, 120)}`,
              'player.screen',
            );
          } catch {}
        } else {
          try {
            logInfo('[player] share page resolve failed', 'player.screen');
          } catch {}
        }
      }
      if (cancelled) return;

      const mp = useMiniPlayerStore.getState();
      if (mp && mp.visible) mp.close();
      usePlayerStore.getState().open(openSource, meta, danmaku);
      openTokenAtOpen.current = usePlayerStore.getState().openToken;
      openingPending.current = false;
      try {
        logInfo(`[player] PlayerScreen open kind=${openSource.kind}`, 'player.screen');
      } catch {}
    })();
    return () => {
      cancelled = true;
      openingPending.current = false;

      const st = usePlayerStore.getState();

      if (openTokenAtOpen.current > 0 && st.openToken === openTokenAtOpen.current) st.close();
      openedFor.current = '';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceUrl]);

  const storeOpenToken = usePlayerStore((s) => s.openToken);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!sourceUrl || openedFor.current !== sourceUrl) return;
    if (openingPending.current || openTokenAtOpen.current <= 0) return;
    if (usePlayerStore.getState().openToken !== openTokenAtOpen.current && onCloseRef.current) {
      openedFor.current = '';
      onCloseRef.current();
    }
  }, [storeOpenToken, sourceUrl]);

  const content = (
    <View style={[styles.container, inline && !fullscreen ? styles.inline : null]}>
      <View style={StyleSheet.absoluteFill}>
        <View style={[StyleSheet.absoluteFill, { transform: mediaTransform }]}>
          <PlayerCore onVideoSize={onVideoSize} resumeAt={resumeAt} />
        </View>
      </View>
      <View
        nativeID="yaya.pip.overlay"
        collapsable={false}
        pointerEvents="box-none"
        style={StyleSheet.absoluteFill}
      >
        {!cleanScreen && children}
        {!chromeHidden && (
          <PlayerChrome
            pocket={pocket}
            features={features}
            extraActions={extraActions}
            onClose={onClose}
            inline={inline}
            onRetry={onRetry}
            barrageInput={barrageInput}
          />
        )}
      </View>
      <FullscreenManager />
    </View>
  );

  if (inline && fullscreen && !inPip) {
    return (
      <Modal
        visible
        animationType="fade"
        onRequestClose={() => usePlayerStore.getState().setFullscreen(false)}
      >
        <View style={styles.container}>{content}</View>
      </Modal>
    );
  }
  return content;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  inline: { backgroundColor: 'transparent' },
});

export default PlayerScreen;
