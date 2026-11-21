import { useEffect, useRef } from 'react';
import { AppState, BackHandler } from 'react-native';
import * as ScreenOrientation from 'expo-screen-orientation';
import { usePlayerStore } from '../store/playerStore';
import { setLiveImmersiveMode } from '../../native/LivePlayer';
import { setPipPlaying } from '../../utils/pip';

let nextPipSource = 0;

export function FullscreenManager() {
  const pipSourceRef = useRef('');
  if (!pipSourceRef.current) pipSourceRef.current = `fullscreen-${++nextPipSource}`;
  const pipSource = pipSourceRef.current;
  const fullscreen = usePlayerStore((s) => s.fullscreen);
  const state = usePlayerStore((s) => s.state);
  const source = usePlayerStore((s) => s.source);

  useEffect(() => {
    if (fullscreen) {
      setLiveImmersiveMode(true);
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => {});
    } else {
      setLiveImmersiveMode(false);
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    }
    return () => {
      setLiveImmersiveMode(false);
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    };
  }, [fullscreen]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active') return;
      const s = usePlayerStore.getState();
      if (!s.source) return;
      if (s.fullscreen) {
        setLiveImmersiveMode(true);
        ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => {});
      }
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    const vodActive = source?.kind === 'vod' && (state === 'loading' || state === 'paused');
    const on = !!source?.url && (state === 'playing' || vodActive);
    setPipPlaying(on, pipSource);
  }, [source, state, pipSource]);

  useEffect(() => () => setPipPlaying(false, pipSource), [pipSource]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      const s = usePlayerStore.getState();
      if (s.cleanScreen) {
        s.setCleanScreen(false);
        s.toggleControls(true);
        return true;
      }
      if (!s.source) return false;
      if (s.fullscreen) {
        s.setFullscreen(false);
        return true;
      }
      if (s.onClose) {
        s.onClose();
      } else {
        s.close();
      }
      return true;
    });
    return () => sub.remove();
  }, []);

  return null;
}

export function formatPlayTime(t: number): string {
  const sec = Math.max(0, Math.floor(t || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

export default FullscreenManager;
