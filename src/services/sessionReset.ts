import { useUiStore } from '../store';
import { useMusicPlayerStore } from '../store/musicPlayerStore';
import { useOnMicStore } from '../store/onMicStore';
import { clearPocketAccountSummaryCache } from '../hooks/usePocketAccountSummary';
import { stopAllAudio } from './audioFocus';
import { MusicEngine } from './musicPlayer';
import { resetNimSession } from './pocketNim/session';
import { resetSharedPocketData } from './pocketSharedData';

export function resetAccountSession(reason: string, opts?: { stopMusic?: boolean }): void {
  if (opts?.stopMusic) {
    try {
      MusicEngine.stop();
      const music = useMusicPlayerStore.getState();
      if (music.playbackState !== 'idle') music.setPlaybackState('idle');
    } catch {}
  }
  try {
    stopAllAudio(reason);
  } catch {}
  try {
    useUiStore.getState().setPmUnread(0);
  } catch {}
  try {
    useOnMicStore.getState().clear();
  } catch {}
  try {
    resetSharedPocketData();
  } catch {}
  try {
    clearPocketAccountSummaryCache();
  } catch {}
  try {
    resetNimSession(reason);
  } catch {}
}
