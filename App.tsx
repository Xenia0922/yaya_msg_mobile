import React, { useRef, useEffect, useState, useMemo } from 'react';
import {
  View,
  Text,
  Modal,
  Image,
  TouchableOpacity,
  Linking,
  StyleSheet,
  Animated,
  Easing,
  InteractionManager,
  AppState,
  Appearance,
  DeviceEventEmitter,
  ToastAndroid,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import AppNavigator from './src/navigation';
import { loadSettings } from './src/services/settings';
import { recoverInterruptedDownloads } from './src/services/downloads';
import { loadPlayerPrefs } from './src/player/store/playerStore';
import { useResolvedTheme } from './src/hooks/useAppTheme';
import {
  useSettingsStore,
  useMemberStore,
  useAnnouncementStore,
  useUpdateStore,
  localTodayKey,
} from './src/store';
import { loadMembers } from './src/utils/members';
import { fetchJson } from './src/utils/network';
import { loadCachedMemberData } from './src/services/memberData';
import { hydrateMusicCatalogFromCache } from './src/services/musicCatalog';
import { initRoomBgCache } from './src/services/roomBgCache';
import { loadRoomMetaCache } from './src/services/roomMetaCache';
import { initWasm, WebViewSignerHost } from './src/auth';
import {
  startRadioForeground,
  stopRadioForeground,
  updateRadioLyric,
  onRadioStopRequested,
  syncRadioPosition,
} from './src/native/LivePlayer';
import {
  subscribeExo,
  exoPlayQueue,
  ExoTrackItem,
  exoControl,
  exoSetSkipHints,
  exoUpdateArt,
  exoSetCacheLimitMb,
  exoConsumePendingOpenFullScreen,
  isNativeExoDisabled,
  setNativeExoActive,
  setNativeExoDisabled,
  isNativeExoActive,
  subscribeNativeExoDisabled,
} from './src/native/RadioExo';
import Video from 'react-native-video';
import {
  ensureGlobalQChatConnection,
  pauseQChatSession,
  subscribeRoomChannelsBatch,
} from './src/services/pocketNim/qchat';
import { onQChatMessage } from './src/native/PocketNimQChat';
import { parseVoiceEvent } from './src/services/pocketNim/voiceEvent';
import { useOnMicStore } from './src/store/onMicStore';
import { fetchFollowedIdsShared, subscribeFollowedIds } from './src/services/pocketSharedData';
import { ensureNotificationPermission } from './src/utils/notifications';
import {
  useMusicPlayerStore,
  flushMusicPlayerStorage,
  trackIdentityKey,
  PlayMode,
  Track,
} from './src/store/musicPlayerStore';
import {
  MusicEngine,
  applyNativeSnapshot,
  getTrackVolume,
  isExoRecentlyArmed,
  isPlayableHost,
  noteExoArmed,
  noteExoProgress,
  resetExoArm,
} from './src/services/musicPlayer';
import { FadeInView } from './src/components/Motion';
import { runAutoCheckinIfNeeded } from './src/services/autoCheckin';
import { startSignatureHealthCheck } from './src/services/signatureHealth';
import { startNativeModuleCheck } from './src/services/nativeHealth';
import { NOTICE_URL, USER_AGENT } from './src/constants';
import { initRuntimeLog, logCrash, logInfo, logWarn } from './src/utils/runtimeLog';
import { fetchCoverToFile, normalizeCoverUrl, peekCoverFile } from './src/utils/coverToFile';
import { lyricIndexAt } from './src/utils/lyrics';
import { Palettes, usePalette } from './src/theme/colors';
import ErrorBoundary from './src/components/ErrorBoundary';
import { SquircleView } from './src/components/SquircleView';
import { VoiceAudioHost } from './src/components/VoiceAudioHost';
import UpdateBanner from './src/components/UpdateBanner';
import UpdateInstaller from './src/components/UpdateInstaller';
import { isApkUpdaterAvailable } from './src/native/ApkUpdater';
import { translate } from './src/i18n';
import { useSafeAreaInsets } from './src/hooks/useSafeAreaInsets';

import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { KeyboardProvider } from 'react-native-keyboard-controller';

function SafeAreaBridge({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <SafeAreaInsetsContext.Provider
      value={{ top: insets.top, right: 0, bottom: insets.bottom, left: 0 }}
    >
      {children}
    </SafeAreaInsetsContext.Provider>
  );
}

function installGlobalErrorHandler() {
  const g = global as unknown as {
    ErrorUtils?: {
      setGlobalHandler?: (h: (e: unknown, isFatal?: boolean) => void) => void;
      getGlobalHandler?: () => ((e: unknown, isFatal?: boolean) => void) | undefined;
    };
  };
  const eu = g.ErrorUtils;
  if (!eu || typeof eu.setGlobalHandler !== 'function') return;
  const prev = eu.getGlobalHandler ? eu.getGlobalHandler() : undefined;
  eu.setGlobalHandler((error: unknown, isFatal?: boolean) => {
    try {
      const e = error as any;
      console.error('[yaya-crash] ' + String(e && (e.message || e)));
      if (e && e.stack) console.error('[yaya-crash] ' + String(e.stack).slice(0, 1200));
    } catch {}
    logCrash(error, isFatal ? 'global:fatal' : 'global');
    if (prev) {
      try {
        prev(error, isFatal);
      } catch {}
    }
  });
}

installGlobalErrorHandler();
initRuntimeLog().catch(() => {});

function currentLyricIndex(lines: Array<{ time: number; text: string }>, pos: number): number {
  return lyricIndexAt(lines, pos + 0.4);
}

const NATIVE_HEADERS = {
  'User-Agent': USER_AGENT,
  Referer: 'https://h5.48.cn/',
  Origin: 'https://h5.48.cn',
};

function buildNativeQueueWindow(
  queue: Track[],
  currentIndex: number,
  currentUrl: string,
  playMode: PlayMode,
): { items: ExoTrackItem[]; targetIndex: number } {
  if (!queue.length || currentIndex < 0 || currentIndex >= queue.length || !currentUrl) {
    return { items: [], targetIndex: -1 };
  }
  const indices: number[] = [];
  if (playMode === 'random') {
    for (let k = 2; k >= 1; k -= 1) {
      if (queue.length > k) indices.push((currentIndex - k + queue.length) % queue.length);
    }
    indices.push(currentIndex);
    const pool: number[] = [];
    for (let i = 0; i < queue.length; i += 1) {
      if (!indices.includes(i)) pool.push(i);
    }
    for (let i = pool.length - 1; i > 0 && indices.length < 15; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
      indices.push(pool[i]);
    }
  } else if (queue.length <= 36) {
    for (let i = 0; i < queue.length; i += 1) indices.push(i);
  } else {
    for (let b = 5; b >= 1; b -= 1) {
      indices.push((currentIndex - b + queue.length) % queue.length);
    }
    indices.push(currentIndex);
    for (let a = 1; a <= 19; a += 1) {
      indices.push((currentIndex + a) % queue.length);
    }
  }

  const curPos = indices.indexOf(currentIndex);
  const toItem = (t: Track, idx: number, u: string): ExoTrackItem => {
    const rawCover = String(t?.coverUrl || t?.cover || t?.thumbPath || '');
    const normCover = normalizeCoverUrl(rawCover);
    return {
      url: u,
      trackId: String(t?.musicId || t?.id || ''),
      title: String(t?.title || '音乐'),
      artist: String(t?.artist || t?.groupLabel || ''),
      album: String(t?.album || ''),
      art: peekCoverFile(normCover) || normCover,
      queueIndex: idx,
      volume: getTrackVolume(u),
    };
  };

  const beforeItems: ExoTrackItem[] = [];
  for (let i = curPos - 1; i >= 0; i -= 1) {
    const idx = indices[i];
    const t = queue[idx];
    const u = idx === currentIndex ? currentUrl : MusicEngine.getWarmUrl(t);
    if (!u || !isPlayableHost(u)) break;
    beforeItems.unshift(toItem(t, idx, u));
  }

  const items: ExoTrackItem[] = [...beforeItems];
  const targetIndex = items.length;
  items.push(toItem(queue[currentIndex], currentIndex, currentUrl));

  for (let i = curPos + 1; i < indices.length; i += 1) {
    const idx = indices[i];
    const t = queue[idx];
    const u = MusicEngine.getWarmUrl(t);
    if (!u || !isPlayableHost(u)) break;
    items.push(toItem(t, idx, u));
  }

  return { items, targetIndex };
}

function nativeRepeatModeFor(playMode: PlayMode, queueLen: number, windowLen: number): number {
  if (playMode === 'single') return 1;
  if (playMode === 'sequential' && queueLen > 0 && windowLen >= queueLen) return 2;
  return 0;
}

function warmAndPushTrackArt(track: Track | null | undefined) {
  if (!track) return;
  const coverRaw = String(
    (track as any).coverUrl || (track as any).cover || (track as any).thumbPath || '',
  );
  if (!coverRaw) return;
  const norm = normalizeCoverUrl(coverRaw);
  if (!norm) return;
  const tId = trackIdentityKey(track);
  const existing = peekCoverFile(norm);
  if (existing && existing.startsWith('file://')) {
    if (isNativeExoActive()) exoUpdateArt(tId, existing);
    return;
  }
  void fetchCoverToFile(norm)
    .then((local) => {
      if (!local || !local.startsWith('file://')) return;
      const cur = useMusicPlayerStore.getState();
      const curTrack = cur.queue[cur.currentIndex];
      if (isNativeExoActive() && trackIdentityKey(curTrack) === tId) {
        exoUpdateArt(tId, local);
      }
    })
    .catch(() => {});
}

async function pushExoAfterSwitch() {
  try {
    const st = useMusicPlayerStore.getState();
    const url = st.url;
    const track = st.queue[st.currentIndex];

    if (isNativeExoDisabled() || st.error || st.playbackState !== 'playing' || !url || !track)
      return;
    if (isExoRecentlyArmed(url)) return;
    const wasActive = isNativeExoActive();
    setNativeExoActive(true);

    let resumeAt = 0;
    if (st.seekPending && Number(st.seekTarget) > 0) {
      resumeAt = Number(st.seekTarget);
      useMusicPlayerStore.getState().consumeSeekTarget();
    } else if (!wasActive && Number(st.position) > 0) {
      resumeAt = Number(st.position);
    }
    const { items, targetIndex } = buildNativeQueueWindow(
      st.queue,
      st.currentIndex,
      url,
      st.playMode,
    );
    if (!items.length || targetIndex < 0) return;

    const vol = getTrackVolume(url);
    const rep = nativeRepeatModeFor(st.playMode, st.queue.length, items.length);
    noteExoArmed(url);

    if (__DEV__) {
      console.warn(
        `[push-global] queueLen=${items.length} target=${targetIndex} url=${String(url).slice(0, 50)} resumeAt=${resumeAt}`,
      );
    }

    exoPlayQueue(items, targetIndex, resumeAt, true, NATIVE_HEADERS, vol, rep, st.speed);

    warmAndPushTrackArt(track);
  } catch {}
}

function skipHintIndex(dir: 'next' | 'prev', cur: number, len: number, mode: PlayMode): number {
  if (len <= 0) return -1;
  if (dir === 'prev') return cur <= 0 ? len - 1 : cur - 1;
  if (mode === 'single') return cur;
  if (mode === 'random') {
    if (len <= 1) return cur;
    let n = Math.floor(Math.random() * (len - 1));
    if (n >= cur) n += 1;
    return n;
  }
  return (cur + 1) % len;
}

const skipHintArts: { next: string; prev: string } = { next: '', prev: '' };

async function pushSkipHints() {
  try {
    if (isNativeExoDisabled()) return;
    const st = useMusicPlayerStore.getState();
    if (st.playbackState !== 'playing' || !st.url || st.queue.length === 0) return;
    const q = st.queue;
    const ni = skipHintIndex('next', st.currentIndex, q.length, st.playMode);
    const pi = skipHintIndex('prev', st.currentIndex, q.length, st.playMode);
    if (ni < 0 && pi < 0) return;
    const snapUrl = st.url;
    const nTrack = ni >= 0 ? q[ni] : null;
    const pTrack = pi >= 0 ? q[pi] : null;
    const mk = (t: any, u: string | null, i: number, dir: 'next' | 'prev') =>
      t && u
        ? {
            url: u,
            trackId: String(t.musicId || t.id || ''),
            title: String(t.title || '音乐'),
            artist: String(t.artist || t.groupLabel || ''),
            album: String(t.album || ''),
            index: i,
            art:
              skipHintArts[dir] ||
              peekCoverFile(normalizeCoverUrl(String(t.coverUrl || t.cover || ''))),
          }
        : null;
    const [nUrl, pUrl] = await Promise.all([
      nTrack ? MusicEngine.resolvePlayUrl(nTrack) : Promise.resolve(null),
      pTrack ? MusicEngine.resolvePlayUrl(pTrack) : Promise.resolve(null),
    ]);

    const s2 = useMusicPlayerStore.getState();
    if (s2.playbackState !== 'playing' || s2.url !== snapUrl) return;

    exoSetSkipHints(mk(nTrack, nUrl, ni, 'next'), mk(pTrack, pUrl, pi, 'prev'));

    const coverRawOf = (t: any) =>
      String((t && (t.coverUrl || t.cover || t.thumbPath)) || '') || '';
    const refreshArt = async (t: any, dir: 'next' | 'prev') => {
      if (!t) return;
      const raw = coverRawOf(t);
      if (!raw) return;
      let art = '';
      try {
        art = await Promise.race([
          fetchCoverToFile(normalizeCoverUrl(raw)),
          new Promise<string>((res) => setTimeout(() => res(''), 2500)),
        ]);
      } catch {
        art = '';
      }
      if (art) skipHintArts[dir] = art;
      const s3 = useMusicPlayerStore.getState();
      if (s3.playbackState !== 'playing' || s3.url !== snapUrl) return;
      exoSetSkipHints(mk(nTrack, nUrl, ni, 'next'), mk(pTrack, pUrl, pi, 'prev'));
    };
    await Promise.all([
      nTrack ? refreshArt(nTrack, 'next') : Promise.resolve(),
      pTrack ? refreshArt(pTrack, 'prev') : Promise.resolve(),
    ]);
  } catch {}
}

function MusicForegroundBridge({ ready }: { ready: boolean }) {
  const cacheLimitMb = useSettingsStore((s) => s.settings.yaya_music_cache_limit_mb);
  const lastNativePlayingRef = useRef(false);
  const radioStoppedRef = useRef(false);
  const syncPauseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncResumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const trackRetryRef = useRef<{ key: string; count: number; consecutiveErrors: number }>({
    key: '',
    count: 0,
    consecutiveErrors: 0,
  });
  const consumedExoSeekRef = useRef(0);
  const clearSyncPause = () => {
    if (syncPauseTimer.current) {
      clearTimeout(syncPauseTimer.current);
      syncPauseTimer.current = null;
    }
  };
  const clearSyncResume = () => {
    if (syncResumeTimer.current) {
      clearTimeout(syncResumeTimer.current);
      syncResumeTimer.current = null;
    }
  };
  const clearRetryTimer = () => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  };
  const armSyncPause = () => {
    if (syncPauseTimer.current) return;
    syncPauseTimer.current = setTimeout(() => {
      syncPauseTimer.current = null;
      const s = useMusicPlayerStore.getState();
      if (s.playbackState === 'playing' && !lastNativePlayingRef.current)
        s.setPlaybackState('paused');
    }, 900);
  };
  const armSyncResume = () => {
    if (syncResumeTimer.current) return;
    syncResumeTimer.current = setTimeout(() => {
      syncResumeTimer.current = null;
      const s = useMusicPlayerStore.getState();
      if (s.playbackState === 'paused' && s.queue.length && lastNativePlayingRef.current)
        s.setPlaybackState('playing');
    }, 1200);
  };

  useEffect(() => {
    if (!ready) return;
    exoSetCacheLimitMb(cacheLimitMb || 300);
  }, [ready, cacheLimitMb]);

  useEffect(() => {
    if (!ready) return;
    const handleOpenFullScreen = () => {
      const st = useMusicPlayerStore.getState();
      if (st.queue.length > 0 && st.currentIndex >= 0) {
        st.openFullScreen('none');
      } else {
        DeviceEventEmitter.emit('OpenMusicLibrary');
      }
    };
    const sub = DeviceEventEmitter.addListener('OpenFullScreenMusic', handleOpenFullScreen);
    void exoConsumePendingOpenFullScreen().then((pending) => {
      if (pending) handleOpenFullScreen();
    });
    return () => sub.remove();
  }, [ready]);

  const lastPushKeyRef = useRef('');
  const pushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playbackStateG = useMusicPlayerStore((s) => s.playbackState);
  const playUrlG = useMusicPlayerStore((s) => s.url);
  const currentIndexG = useMusicPlayerStore((s) => s.currentIndex);
  const queueLenG = useMusicPlayerStore((s) => s.queue.length);
  const playModeG = useMusicPlayerStore((s) => s.playMode);
  const speedG = useMusicPlayerStore((s) => s.speed);
  const sleepTimerEndAtG = useMusicPlayerStore((s) => s.sleepTimerEndAt);
  const seekPendingG = useMusicPlayerStore((s) => s.seekPending);
  const seekTargetG = useMusicPlayerStore((s) => s.seekTarget);
  const seekNonceG = useMusicPlayerStore((s) => s.seekNonce);
  const nextQueueSigG = useMusicPlayerStore((s) => {
    if (!s.queue.length || s.currentIndex < 0) return '';
    const nextTrack = s.queue[(s.currentIndex + 1) % s.queue.length];
    const prevTrack = s.queue[(s.currentIndex - 1 + s.queue.length) % s.queue.length];
    return `${s.queue.length}|${s.playMode}|${trackIdentityKey(nextTrack)}|${trackIdentityKey(prevTrack)}`;
  });
  const lastNeighborKeyRef = useRef('');
  const [nativeDisabled, setNativeDisabled] = useState(() => isNativeExoDisabled());
  useEffect(() => subscribeNativeExoDisabled(setNativeDisabled), []);

  useEffect(() => {
    if (playbackStateG !== 'playing' || !playUrlG) return;
    const key = `${playUrlG}|${currentIndexG}`;
    if (key === lastPushKeyRef.current) return;
    lastPushKeyRef.current = key;
    lastNeighborKeyRef.current = `${key}|${nextQueueSigG}`;
    if (pushTimerRef.current) clearTimeout(pushTimerRef.current);

    pushTimerRef.current = setTimeout(() => {
      pushExoAfterSwitch().catch(() => {});
    }, 20);
  }, [playbackStateG, playUrlG, currentIndexG]);

  useEffect(() => {
    if (nativeDisabled || playbackStateG !== 'playing' || !playUrlG || !isNativeExoActive()) return;
    const composite = `${playUrlG}|${currentIndexG}|${nextQueueSigG}`;
    if (!lastNeighborKeyRef.current || composite === lastNeighborKeyRef.current) {
      lastNeighborKeyRef.current = composite;
      return;
    }
    lastNeighborKeyRef.current = composite;
    const timer = setTimeout(() => {
      const st = useMusicPlayerStore.getState();
      if (
        isNativeExoDisabled() ||
        st.playbackState !== 'playing' ||
        !st.url ||
        !isNativeExoActive()
      )
        return;
      const { items, targetIndex } = buildNativeQueueWindow(
        st.queue,
        st.currentIndex,
        st.url,
        st.playMode,
      );
      if (items.length > 0 && targetIndex >= 0) {
        exoPlayQueue(
          items,
          targetIndex,
          0,
          true,
          NATIVE_HEADERS,
          getTrackVolume(st.url),
          nativeRepeatModeFor(st.playMode, st.queue.length, items.length),
          st.speed,
        );
      }
    }, 80);
    return () => clearTimeout(timer);
  }, [nativeDisabled, playbackStateG, playUrlG, currentIndexG, nextQueueSigG]);

  useEffect(() => {
    if (nativeDisabled || !seekPendingG || !seekNonceG) return;
    if (seekNonceG === consumedExoSeekRef.current) return;
    if (!playUrlG || (playbackStateG !== 'playing' && playbackStateG !== 'paused')) return;
    if (!isNativeExoActive() && playbackStateG !== 'playing') return;
    if (!isNativeExoActive()) return;
    consumedExoSeekRef.current = seekNonceG;
    useMusicPlayerStore.getState().setPosition(seekTargetG);
    exoControl('seek', seekTargetG);
    useMusicPlayerStore.getState().consumeSeekTarget();
  }, [nativeDisabled, seekPendingG, seekTargetG, seekNonceG, playUrlG, playbackStateG]);

  useEffect(() => {
    if (nativeDisabled || !isNativeExoActive()) return;
    const windowFits = queueLenG > 0 && queueLenG <= 36;
    const rep = playModeG === 'single' ? 1 : playModeG === 'sequential' && windowFits ? 2 : 0;
    exoControl('repeat', rep);
  }, [nativeDisabled, playModeG, queueLenG]);

  useEffect(() => {
    if (nativeDisabled || !isNativeExoActive()) return;
    exoControl('speed', speedG);
  }, [nativeDisabled, speedG]);

  useEffect(() => {
    if (!sleepTimerEndAtG) return;
    const check = () => {
      const endAt = useMusicPlayerStore.getState().sleepTimerEndAt;
      if (!endAt) return;
      if (Date.now() >= endAt) {
        const st = useMusicPlayerStore.getState();
        st.clearSleepTimer();
        if (st.playbackState === 'playing') {
          MusicEngine.togglePause();
        }
        ToastAndroid.show(translate('定时关闭已触发，已暂停播放'), ToastAndroid.SHORT);
      }
    };
    const id = setInterval(check, 1000);
    return () => clearInterval(id);
  }, [sleepTimerEndAtG]);

  useEffect(() => {
    if (playbackStateG !== 'playing' || !playUrlG || isNativeExoDisabled()) return;
    const t = setTimeout(() => {
      if (!isNativeExoDisabled()) pushSkipHints().catch(() => {});
    }, 60);
    return () => clearTimeout(t);
  }, [playbackStateG, playUrlG, currentIndexG, queueLenG, playModeG]);

  useEffect(() => {
    if (playbackStateG === 'idle') {
      lastPushKeyRef.current = '';
      radioStoppedRef.current = false;
      clearRetryTimer();
      trackRetryRef.current = { key: '', count: 0, consecutiveErrors: 0 };
      resetExoArm();
      setNativeExoActive(false);
      setNativeExoDisabled(false);
      try {
        exoControl('stop');
      } catch {}
    } else if (playbackStateG !== 'playing') {
      lastPushKeyRef.current = '';
    }
  }, [playbackStateG]);

  useEffect(() => {
    if (isNativeExoDisabled()) return;
    if (playbackStateG === 'paused' && lastNativePlayingRef.current) {
      exoControl('pause');
    } else if (
      playbackStateG === 'playing' &&
      !lastNativePlayingRef.current &&
      isNativeExoActive()
    ) {
      exoControl('resume');
    }
  }, [playbackStateG]);

  useEffect(
    () =>
      subscribeExo((type, p: any) => {
        try {
          if (type === 'progress') {
            const playingN = !!p?.playing;
            lastNativePlayingRef.current = playingN;
            if (playingN) {
              if (!isNativeExoActive()) setNativeExoActive(true);
              if (!radioStoppedRef.current) {
                radioStoppedRef.current = true;
                try {
                  stopRadioForeground();
                } catch {}
              }
            }

            const st = useMusicPlayerStore.getState();
            if (!st.queue.length || st.playbackState === 'idle') return;
            if (!st.url) {
              applyNativeSnapshot({
                active: true,
                url: String(p?.url || ''),
                trackId: String(p?.trackId || ''),
                title: String(p?.title || ''),
                artist: String(p?.artist || ''),
                album: String(p?.album || ''),
                position: Math.max(0, Number(p?.position) || 0),
                buffered: Math.max(0, Number(p?.buffered) || 0),
                buffering: !!p?.buffering,
                duration: Math.max(0, Number(p?.duration) || 0),
                playing: playingN,
                speed: Number(p?.speed) > 0 ? Number(p.speed) : st.speed,
                queueIndex: typeof p?.index === 'number' ? p.index : -1,
              });
              return;
            }
            if (st.playbackState === 'loading') return;
            const current = st.queue[st.currentIndex];
            const currentId = current ? String(current.musicId || current.id || '') : '';
            const staleTrack = !!p?.trackId && !!currentId && String(p.trackId) !== currentId;
            const staleUrl = !!p?.url && !!st.url && String(p.url) !== String(st.url);
            if (!staleUrl && !staleTrack) {
              if (playingN) noteExoProgress();
              if (Number(p?.duration) > 0) st.setDuration(Number(p.duration));
              if (typeof p?.position === 'number') {
                st.setPosition(p.position);
                if (playingN && p.position > 1) {
                  trackRetryRef.current = { key: '', count: 0, consecutiveErrors: 0 };
                }
              }
              if (typeof p?.buffered === 'number') st.setBuffered(p.buffered);
              if (typeof p?.buffering === 'boolean') st.setBuffering(p.buffering);
            }
            if (playingN) {
              clearSyncPause();
              armSyncResume();
            } else {
              clearSyncResume();
              armSyncPause();
            }
          } else if (type === 'track_changed') {
            clearSyncPause();
            clearSyncResume();
            const st = useMusicPlayerStore.getState();
            if (!st.queue.length) return;
            const reason = Number(p?.reason ?? -1);
            if (st.sleepAfterTrack && (reason === 1 || reason === 0)) {
              st.clearSleepTimer();
              exoControl('pause');
              st.setPlaybackState('paused');
              ToastAndroid.show(translate('本首已播完，已暂停播放'), ToastAndroid.SHORT);
              return;
            }
            const urlN = String(p?.url || '');
            const idxN = typeof p?.index === 'number' ? p.index : -1;
            const synced = MusicEngine.syncFromNativeTrack({
              index: idxN,
              url: urlN,
              trackId: String(p?.trackId || ''),
              title: String(p?.title || ''),
              artist: String(p?.artist || ''),
              album: String(p?.album || ''),
              playing: st.playbackState === 'playing',
            });
            if (synced) {
              const after = useMusicPlayerStore.getState();
              lastPushKeyRef.current = `${after.url}|${after.currentIndex}`;
              warmAndPushTrackArt(after.queue[after.currentIndex]);
              if (after.queue.length > 36 && after.playbackState === 'playing') {
                const { items, targetIndex } = buildNativeQueueWindow(
                  after.queue,
                  after.currentIndex,
                  after.url,
                  after.playMode,
                );
                if (
                  items.length > 0 &&
                  targetIndex >= 0 &&
                  (items.length - 1 - targetIndex <= 3 || targetIndex <= 1)
                ) {
                  exoPlayQueue(
                    items,
                    targetIndex,
                    0,
                    true,
                    NATIVE_HEADERS,
                    getTrackVolume(after.url),
                    nativeRepeatModeFor(after.playMode, after.queue.length, items.length),
                    after.speed,
                  );
                }
              }
            }
          } else if (type === 'ended') {
            clearSyncPause();
            clearSyncResume();
            const st = useMusicPlayerStore.getState();
            if (st.sleepAfterTrack) {
              st.clearSleepTimer();
              st.setPlaybackState('paused');
              ToastAndroid.show(translate('本首已播完，已暂停播放'), ToastAndroid.SHORT);
              return;
            }
            if (st.queue.length && st.playbackState === 'playing' && st.playMode !== 'single') {
              MusicEngine.next().catch(() => {});
            }
          } else if (type === 'skipped') {
            const urlN = String(p?.url || '');
            clearSyncPause();
            clearSyncResume();
            if (!urlN) return;
            const st0 = useMusicPlayerStore.getState();
            if (st0.queue.length === 0) return;
            const rawIdx = Number(p?.index);
            const idx =
              Number.isFinite(rawIdx) &&
              Number.isInteger(rawIdx) &&
              rawIdx >= 0 &&
              rawIdx < st0.queue.length
                ? rawIdx
                : -1;
            const track = idx >= 0 ? st0.queue[idx] : null;
            if (idx >= 0 && track) {
              MusicEngine.syncFromNativeTrack({
                index: idx,
                url: urlN,
                trackId: String(p?.trackId || ''),
                title: String(p?.title || ''),
                artist: String(p?.artist || ''),
                album: String(p?.album || ''),
                playing: true,
              });
              warmAndPushTrackArt(track);
            } else {
              applyNativeSnapshot({
                active: true,
                url: urlN,
                trackId: String(p?.trackId || ''),
                title: String(p?.title || ''),
                artist: String(p?.artist || ''),
                album: String(p?.album || ''),
                position: 0,
                buffered: 0,
                buffering: true,
                duration: 0,
                playing: true,
                speed: st0.speed,
              });
              const sNow = useMusicPlayerStore.getState();
              warmAndPushTrackArt(sNow.queue[sNow.currentIndex]);
            }
          } else if (type === 'cmd') {
            const c = String(p?.cmd || '');
            const st = useMusicPlayerStore.getState();
            if (st.playbackState === 'idle') st.setPlaybackState('loading');
            if (c === 'next') MusicEngine.next().catch(() => {});
            else if (c === 'prev') MusicEngine.prev().catch(() => {});
          } else if (type === 'track_error') {
            clearSyncPause();
            clearSyncResume();
            const st = useMusicPlayerStore.getState();
            const cur = st.queue[st.currentIndex];
            const errKey = `${trackIdentityKey(cur)}|${String(p?.url || st.url)}`;
            const msg = String(p?.message || 'playback error');
            logWarn(`[exo] track_error ${errKey}: ${msg}`, 'music');
            if (!cur || st.playbackState === 'idle') return;

            const rec = trackRetryRef.current;
            if (rec.key === errKey && rec.count >= 1) {
              const nextConsec = rec.consecutiveErrors + 1;
              trackRetryRef.current = { key: '', count: 0, consecutiveErrors: nextConsec };
              if (nextConsec < 3 && st.queue.length > 1 && st.playMode !== 'single') {
                ToastAndroid.show(translate('当前歌曲加载失败，已自动跳过'), ToastAndroid.SHORT);
                void MusicEngine.next().catch(() => {});
              } else {
                trackRetryRef.current.consecutiveErrors = 0;
                st.setError(translate('播放失败，请检查网络连接'));
              }
            } else {
              trackRetryRef.current = {
                key: errKey,
                count: rec.key === errKey ? rec.count + 1 : 1,
                consecutiveErrors: rec.consecutiveErrors,
              };
              clearRetryTimer();
              retryTimerRef.current = setTimeout(() => {
                retryTimerRef.current = null;
                const sNow = useMusicPlayerStore.getState();
                const trNow = sNow.queue[sNow.currentIndex];
                if (trNow && sNow.playbackState !== 'idle') {
                  resetExoArm();
                  lastPushKeyRef.current = '';
                  void MusicEngine.playTrack(trNow, sNow.queue).catch(() => {});
                }
              }, 800);
            }
          } else if (type === 'error') {
            clearSyncPause();
            clearSyncResume();
            radioStoppedRef.current = false;
            setNativeExoDisabled(true);
          }
        } catch {}
      }),
    [],
  );
  useEffect(
    () => () => {
      if (pushTimerRef.current) clearTimeout(pushTimerRef.current);
      clearRetryTimer();
      clearSyncPause();
      clearSyncResume();
    },
    [],
  );

  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => {
      if (st !== 'active') flushMusicPlayerStorage();
    });
    return () => sub.remove();
  }, []);
  const playbackState = useMusicPlayerStore((s) => s.playbackState);
  const currentIndex = useMusicPlayerStore((s) => s.currentIndex);
  const position = useMusicPlayerStore((s) => s.position);

  const lastNotifySig = useRef('');

  useEffect(() => {
    if (playbackState !== 'playing') return;
    const id = setInterval(() => {
      if (!isNativeExoDisabled()) return;
      try {
        syncRadioPosition(useMusicPlayerStore.getState().position);
      } catch {}
    }, 500);
    return () => clearInterval(id);
  }, [playbackState]);
  useEffect(() => {
    if (playbackState === 'playing') {
      if (!isNativeExoDisabled()) return;
      const st = useMusicPlayerStore.getState();
      const track = st.queue[st.currentIndex];
      const sig = `${st.currentIndex}|${playbackState}|${st.url || ''}`;
      if (sig === lastNotifySig.current && track?.title) return;
      lastNotifySig.current = sig;
      const cover = normalizeCoverUrl(
        String(
          (track as any)?.coverUrl || (track as any)?.cover || (track as any)?.thumbPath || '',
        ),
      );
      const artistText = String((track as any)?.artist || (track as any)?.groupLabel || '');
      const albumText = String((track as any)?.album || '');
      const lyrIdx = currentLyricIndex(st.lyrics, st.position);
      const lyricText = lyrIdx >= 0 && st.lyrics[lyrIdx] ? st.lyrics[lyrIdx].text : '';
      ensureNotificationPermission()
        .then(async () => {
          const finalCover = await fetchCoverToFile(cover);
          startRadioForeground({
            title: track?.title || '音乐',
            cover: finalCover,
            artist: artistText,
            album: albumText,
            lyric: lyricText,
            isPlaying: true,
            position: st.position,
            duration: st.duration,
          });
          try {
            logInfo(
              `[media] notify start title=${String(track?.title || '').slice(0, 20)} dur=${st.duration} pos=${st.position} cover=${finalCover ? (finalCover.startsWith('data:') ? 'DATA' : finalCover.slice(0, 60)) : 'EMPTY'}`,
              'media',
            );
          } catch {}
        })
        .catch((err: any) => {
          try {
            logInfo(
              `[media] notify perm rejected: ${String((err && err.message) || err).slice(0, 120)}`,
              'media',
            );
          } catch {}
        });
    } else if (playbackState === 'paused') {
      if (!isNativeExoDisabled()) return;

      const st = useMusicPlayerStore.getState();
      const track = st.queue[st.currentIndex];
      const sigP = `paused|${st.currentIndex}`;
      if (sigP !== lastNotifySig.current && track?.title) {
        lastNotifySig.current = sigP;
        const st2 = useMusicPlayerStore.getState();
        const coverP = normalizeCoverUrl(
          String(
            (st2 as any).currentTrack?.coverUrl ||
              (track as any)?.coverUrl ||
              (track as any)?.cover ||
              (track as any)?.thumbPath ||
              '',
          ),
        );
        ensureNotificationPermission()
          .then(async () => {
            const finalCover = await fetchCoverToFile(coverP);
            startRadioForeground({
              title: track?.title || '音乐',
              cover: finalCover,
              artist: String((track as any)?.artist || (track as any)?.groupLabel || ''),
              album: String((track as any)?.album || ''),
              lyric: String(
                (st2.lyrics && st2.lyrics[currentLyricIndex(st2.lyrics, st2.position)]?.text) || '',
              ),
              isPlaying: false,
              position: st2.position,
              duration: st2.duration,
            });
          })
          .catch(() => {});
      }
    } else if (playbackState === 'idle') {
      stopRadioForeground();
    }
  }, [playbackState, currentIndex, position]);

  const lyrics = useMusicPlayerStore((s) => s.lyrics);
  const lastLyricIdx = useRef(-1);
  const playing = playbackState === 'playing';
  useEffect(() => {
    if (!playing) {
      lastLyricIdx.current = -1;
      return;
    }
    if (!isNativeExoDisabled()) {
      lastLyricIdx.current = -1;
      return;
    }
    const idx = currentLyricIndex(lyrics, position);
    if (idx !== lastLyricIdx.current) {
      lastLyricIdx.current = idx;
      const text = idx >= 0 && lyrics[idx] ? lyrics[idx].text : '';
      updateRadioLyric(text);
    }
  }, [playing, lyrics, position]);

  useEffect(
    () =>
      onRadioStopRequested(() => {
        stopRadioForeground();
        const st = useMusicPlayerStore.getState();
        if (st.playbackState === 'playing' || st.playbackState === 'paused') {
          st.setPlaybackState('paused');
        }
      }),
    [],
  );

  const playVolumeG = useMemo(() => getTrackVolume(playUrlG), [playUrlG]);
  const fallbackVideoRef = useRef<any>(null);
  const [fallbackReady, setFallbackReady] = useState(false);
  const consumedFallbackSeekRef = useRef(0);
  useEffect(() => {
    setFallbackReady(false);
  }, [playUrlG, nativeDisabled]);
  useEffect(() => {
    if (!nativeDisabled || !fallbackReady) return;
    if (!seekPendingG || !seekNonceG || seekNonceG === consumedFallbackSeekRef.current) return;
    const ref = fallbackVideoRef.current;
    if (!ref || typeof ref.seek !== 'function') return;
    try {
      useMusicPlayerStore.getState().setPosition(seekTargetG);
      ref.seek(seekTargetG);
      consumedFallbackSeekRef.current = seekNonceG;
      useMusicPlayerStore.getState().consumeSeekTarget();
    } catch {}
  }, [nativeDisabled, fallbackReady, seekPendingG, seekTargetG, seekNonceG]);

  if (!nativeDisabled || !playUrlG) return null;
  return (
    <Video
      ref={fallbackVideoRef}
      source={{
        uri: playUrlG,
        headers: {
          'User-Agent': USER_AGENT,
          Referer: 'https://h5.48.cn/',
        },
        bufferConfig: {
          minBufferMs: 15000,
          maxBufferMs: 60000,
          bufferForPlaybackMs: 5000,
          bufferForPlaybackAfterRebufferMs: 10000,
          backBufferDurationMs: 30000,
        },
      }}
      style={{ width: 0, height: 0, position: 'absolute', opacity: 0 }}
      volume={playVolumeG}
      rate={speedG}
      paused={playbackStateG !== 'playing'}
      repeat={playModeG === 'single'}
      ignoreSilentSwitch="ignore"
      playInBackground
      playWhenInactive
      onAudioBecomingNoisy={() => {
        try {
          if (useMusicPlayerStore.getState().playbackState === 'playing') {
            MusicEngine.togglePause();
          }
        } catch {}
      }}
      onLoad={(e) => {
        try {
          setFallbackReady(true);
          const durRaw = Number((e as any).duration);
          const dur =
            Number.isFinite(durRaw) && durRaw > 0
              ? durRaw
              : useMusicPlayerStore.getState().duration;
          useMusicPlayerStore.getState().setDuration(dur);
          const st = useMusicPlayerStore.getState();
          if (
            st.seekPending &&
            st.seekTarget > 0 &&
            fallbackVideoRef.current &&
            typeof fallbackVideoRef.current.seek === 'function'
          ) {
            try {
              fallbackVideoRef.current.seek(st.seekTarget);
            } catch {}
            consumedFallbackSeekRef.current = st.seekNonce;
            useMusicPlayerStore.getState().consumeSeekTarget();
          }
        } catch {}
      }}
      onProgress={(e) => {
        try {
          const st = useMusicPlayerStore.getState();
          st.setPosition(e.currentTime || 0);
          if (typeof (e as any).playableDuration === 'number') {
            st.setBuffered((e as any).playableDuration);
          }
        } catch {}
      }}
      onEnd={() => {
        try {
          if (playModeG !== 'single') MusicEngine.next();
        } catch {}
      }}
      onError={() => {
        try {
          const st = useMusicPlayerStore.getState();
          if (st.queue.length > 1 && st.playMode !== 'single') {
            MusicEngine.next();
          } else {
            const tr = st.queue[st.currentIndex];
            st.setError(`《${tr?.title || '该歌曲'}》无法播放`);
            st.setPlaybackState('error');
          }
        } catch {}
      }}
    />
  );
}

function QChatGlobalBridge({ ready }: { ready: boolean }) {
  const p48Token = useSettingsStore((s) => s.settings.p48Token);
  const membersLoaded = useMemberStore((s) => s.membersLoaded);
  const bgPauseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!ready || !p48Token) return;
    let disposed = false;

    const subscribeFollowedRooms = (ids: Set<string>) => {
      if (disposed || !ids.size) return;
      const curMembers = useMemberStore.getState().members;
      const serverIds = curMembers
        .filter((m) => ids.has(String(m.id || '')) || ids.has(String(m.userId || '')))
        .map((m) => String(m.serverId || '').trim())
        .filter((s) => /^\d+$/.test(s) && s !== '0');
      if (serverIds.length) void subscribeRoomChannelsBatch(serverIds);
    };

    const connectAndSubscribe = async () => {
      if (disposed || AppState.currentState !== 'active') return;
      const ok = await ensureGlobalQChatConnection();
      if (!ok || disposed) return;
      try {
        const list = await fetchFollowedIdsShared(p48Token);
        if (disposed || !list.length) return;
        subscribeFollowedRooms(new Set(list));
      } catch {}
    };

    const offFollowed = subscribeFollowedIds((ids, tk) => {
      if (!disposed && tk && tk === String(p48Token || '').trim()) {
        subscribeFollowedRooms(ids);
      }
    });

    const offMsg = onQChatMessage((message) => {
      try {
        let ext: Record<string, any> = {};
        try {
          ext = message.ext ? JSON.parse(message.ext) : {};
        } catch {}
        let attachment: Record<string, any> = {};
        try {
          attachment = message.attachment ? JSON.parse(message.attachment) : {};
        } catch {}
        const voiceEvent = parseVoiceEvent({
          uuid: message.msgIdClient || message.msgIdServer || `${message.time}`,
          serverId: Number(message.serverId) || 0,
          channelId: Number(message.channelId) || 0,
          fromAccount: message.fromAccount,
          fromNick: message.fromNick || String(ext?.user?.nickName || ''),
          time: message.time || Date.now(),
          text: message.body || String(ext?.text || ''),
          messageType: String(attachment.messageType || ext.messageType || 'TEXT'),
          attachment,
          ext,
        });
        if (voiceEvent) useOnMicStore.getState().applyVoiceEvent(voiceEvent);
      } catch {}
    });

    if (AppState.currentState === 'active') void connectAndSubscribe();

    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        if (bgPauseTimer.current) {
          clearTimeout(bgPauseTimer.current);
          bgPauseTimer.current = null;
        }
        void connectAndSubscribe();
      } else if (next === 'background') {
        if (bgPauseTimer.current) clearTimeout(bgPauseTimer.current);
        bgPauseTimer.current = setTimeout(() => {
          bgPauseTimer.current = null;
          pauseQChatSession('切到后台');
        }, 5000);
      }
    });

    return () => {
      disposed = true;
      offFollowed();
      offMsg();
      sub.remove();
      if (bgPauseTimer.current) {
        clearTimeout(bgPauseTimer.current);
        bgPauseTimer.current = null;
      }
    };
  }, [ready, p48Token, membersLoaded]);

  return null;
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [settingsReady, setSettingsReady] = useState(false);
  const [splashDismissed, setSplashDismissed] = useState(false);
  const appTheme = useResolvedTheme();
  const palette = usePalette();
  const systemScheme = Appearance.getColorScheme();
  const effectiveSplashTheme = settingsReady
    ? appTheme
    : systemScheme === 'dark'
      ? 'dark'
      : 'light';
  const splashPalette = effectiveSplashTheme === 'dark' ? Palettes.dark : Palettes.light;
  const splashOpacity = React.useRef(new Animated.Value(1)).current;
  const splashDismissStartedRef = useRef(false);

  const { seenIds, markSeen, lastFetched, hydrated } = useAnnouncementStore();
  const pendingDailyPrompt = useUpdateStore((s) => s.pendingDailyPrompt);
  const latestVersion = useUpdateStore((s) => s.latestVersion);
  const latestUrl = useUpdateStore((s) => s.latestUrl);
  const releaseNotes = useUpdateStore((s) => s.releaseNotes);
  const [dailyUpdateVisible, setDailyUpdateVisible] = useState(false);
  const [updateBannerVisible, setUpdateBannerVisible] = useState(false);
  const [announceModal, setAnnounceModal] = useState<{
    title: string;
    header: string;
    content: string;
    imageUrl: string;
    link: string;
  } | null>(null);

  const announceAnim = React.useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (announceModal) {
      announceAnim.setValue(0);
      Animated.spring(announceAnim, {
        toValue: 1,
        damping: 16,
        mass: 0.9,
        stiffness: 190,
        overshootClamping: false,
        useNativeDriver: true,
      }).start();
    }
  }, [announceModal, announceAnim]);

  useEffect(() => {
    if (!hydrated) return;
    let mounted = true;
    (async () => {
      try {
        const notice = await fetchJson<any>(`${NOTICE_URL}?t=${Date.now()}`);
        if (!mounted || !notice?.show) return;
        const id = String(notice.id || notice.noticeId || notice.version || '');
        if (!id || seenIds.includes(id)) return;
        markSeen(id);
        setAnnounceModal({
          title: notice.title || '',
          header: notice.header || '公告',
          content: (notice.fullContent || '').replace(/\\n/g, '\n'),
          imageUrl: notice.imageUrl || '',
          link: notice.link || '',
        });
      } catch {}
    })();
    return () => {
      mounted = false;
    };
  }, [hydrated]);

  useEffect(() => {
    let mounted = true;

    (async () => {
      const backup = require('./assets/members.json');
      const [settingsRes, , membersRes] = await Promise.allSettled([
        loadSettings(),
        loadPlayerPrefs(),
        loadMembers(backup),
      ]);

      recoverInterruptedDownloads().catch(() => {});
      initWasm().catch(() => {});

      if (settingsRes.status === 'fulfilled') {
        useSettingsStore.getState().setSettings(settingsRes.value);
      }
      if (mounted) setSettingsReady(true);

      let localLen = 0;
      if (membersRes.status === 'fulfilled') {
        localLen = membersRes.value.length;
        useMemberStore.getState().setMembers(membersRes.value);
      }

      if (mounted) setReady(true);

      initRoomBgCache().catch(() => {});
      loadRoomMetaCache().catch(() => {});

      loadCachedMemberData()
        .then((cached) => {
          if (cached && cached.length >= localLen) {
            useMemberStore.getState().setMembers(cached);
          }
        })
        .catch(() => {});
    })();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!ready || splashDismissStartedRef.current) return;
    splashDismissStartedRef.current = true;
    let alive = true;
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
    const rafId = requestAnimationFrame(() => {
      fallbackTimer = setTimeout(() => {
        if (alive) setSplashDismissed(true);
      }, 320);
      Animated.timing(splashOpacity, {
        toValue: 0,
        duration: 210,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start(() => {
        if (fallbackTimer) {
          clearTimeout(fallbackTimer);
          fallbackTimer = null;
        }
        if (alive) setSplashDismissed(true);
      });
    });
    return () => {
      alive = false;
      cancelAnimationFrame(rafId);
      if (fallbackTimer) clearTimeout(fallbackTimer);
    };
  }, [ready, splashOpacity]);

  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => {
      runAutoCheckinIfNeeded().catch(() => {});
    }, 1200);

    useUpdateStore
      .getState()
      .checkUpdate()
      .catch(() => {});

    let prefCancel: { cancel?: () => void } | null = null;
    const r2Timer = setTimeout(() => {
      prefCancel = InteractionManager.runAfterInteractions(() => {
        hydrateMusicCatalogFromCache().catch(() => {});
      });
    }, 2500);

    const activeSub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active' && useUpdateStore.getState().lastCheckedDate !== localTodayKey()) {
        useUpdateStore
          .getState()
          .checkUpdate()
          .catch(() => {});
      }
    });

    return () => {
      clearTimeout(timer);
      clearTimeout(r2Timer);
      prefCancel?.cancel?.();
      activeSub.remove();
    };
  }, [ready]);

  useEffect(() => {
    if (!ready || !splashDismissed || announceModal || !pendingDailyPrompt || !latestVersion) {
      return;
    }
    void useUpdateStore.getState().markDailyPromptShown();
    setUpdateBannerVisible(true);
  }, [ready, splashDismissed, announceModal, pendingDailyPrompt, latestVersion]);

  useEffect(() => {
    if (!ready) return;
    startSignatureHealthCheck();

    startNativeModuleCheck();
  }, [ready]);

  const content = (
    <KeyboardProvider>
      <View style={{ flex: 1, backgroundColor: palette.background }}>
        <SafeAreaBridge>
          <AppNavigator />
        </SafeAreaBridge>

        <Modal
          visible={!!announceModal}
          transparent
          animationType="fade"
          onRequestClose={() => setAnnounceModal(null)}
        >
          <View style={anStyles.overlay}>
            <Animated.View
              style={[
                anStyles.card,
                { backgroundColor: palette.surface },
                {
                  opacity: announceAnim,
                  transform: [
                    {
                      scale: announceAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0.92, 1],
                      }),
                    },
                    {
                      translateY: announceAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [16, 0],
                      }),
                    },
                  ],
                },
              ]}
            >
              {announceModal?.header ? (
                <Text style={[anStyles.header, { color: palette.tint }]}>
                  {announceModal.header}
                </Text>
              ) : null}
              {announceModal?.title ? (
                <Text style={[anStyles.title, { color: palette.label }]}>
                  {announceModal.title}
                </Text>
              ) : null}
              {announceModal?.imageUrl ? (
                <Image
                  source={{ uri: announceModal.imageUrl }}
                  style={anStyles.image}
                  resizeMode="contain"
                />
              ) : null}
              {announceModal?.content ? (
                <Text style={[anStyles.content, { color: palette.labelSecondary }]}>
                  {announceModal.content}
                </Text>
              ) : null}
              <View style={anStyles.btnRow}>
                {announceModal?.link ? (
                  <TouchableOpacity
                    style={[anStyles.btn, { backgroundColor: palette.tint }]}
                    onPress={() => {
                      if (announceModal?.link) Linking.openURL(announceModal.link);
                    }}
                  >
                    <Text style={anStyles.btnText}>查看详情</Text>
                  </TouchableOpacity>
                ) : null}
                <TouchableOpacity
                  style={[anStyles.btn, { backgroundColor: 'rgba(128,128,128,0.2)' }]}
                  onPress={() => setAnnounceModal(null)}
                >
                  <Text style={[anStyles.btnText, { color: palette.label }]}>关闭</Text>
                </TouchableOpacity>
              </View>
            </Animated.View>
          </View>
        </Modal>

        <UpdateBanner
          visible={updateBannerVisible && !dailyUpdateVisible && !announceModal}
          version={latestVersion}
          onDismiss={() => setUpdateBannerVisible(false)}
          onPress={() => {
            setUpdateBannerVisible(false);
            if (isApkUpdaterAvailable) {
              setDailyUpdateVisible(true);
            } else if (latestUrl) {
              Linking.openURL(latestUrl).catch(() => {});
            }
          }}
        />

        <UpdateInstaller
          visible={dailyUpdateVisible}
          version={latestVersion}
          notes={releaseNotes}
          onClose={() => setDailyUpdateVisible(false)}
        />
      </View>
    </KeyboardProvider>
  );

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: splashPalette.background }}>
      <StatusBar style={effectiveSplashTheme === 'dark' ? 'light' : 'dark'} />
      {ready ? <ErrorBoundary>{content}</ErrorBoundary> : null}

      {!splashDismissed ? (
        <Animated.View
          pointerEvents={ready ? 'none' : 'auto'}
          style={[
            StyleSheet.absoluteFill,
            anStyles.splashRoot,
            { backgroundColor: splashPalette.background, opacity: splashOpacity },
          ]}
        >
          <SquircleView
            radius={24}
            style={[
              anStyles.splashIconBox,
              {
                borderColor:
                  effectiveSplashTheme === 'dark'
                    ? 'rgba(255,255,255,0.18)'
                    : 'rgba(255,255,255,0.72)',
              },
            ]}
          >
            <Image
              source={require('./assets/logo.jpg')}
              style={anStyles.splashIconImg}
              resizeMode="cover"
            />
            {effectiveSplashTheme === 'dark' ? (
              <View pointerEvents="none" style={anStyles.splashDarkScrim} />
            ) : null}
          </SquircleView>
        </Animated.View>
      ) : null}

      <WebViewSignerHost />

      <MusicForegroundBridge ready={ready} />

      <VoiceAudioHost />

      <QChatGlobalBridge ready={ready} />
    </GestureHandlerRootView>
  );
}

const anStyles = StyleSheet.create({
  splashRoot: {
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 999,
  },
  splashIconBox: {
    width: 96,
    height: 96,
    borderRadius: 24,
    borderCurve: 'continuous',
    borderWidth: 1,
    overflow: 'hidden',
  },
  splashIconImg: {
    width: '100%',
    height: '100%',
  },
  splashDarkScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(11,11,15,0.14)',
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: { borderRadius: 16, padding: 20, maxWidth: 400, width: '100%', maxHeight: '80%' },
  header: { fontSize: 18, fontWeight: '700', marginBottom: 4 },
  title: { fontSize: 15, fontWeight: '600', marginBottom: 10 },
  image: { width: '100%', height: 160, borderRadius: 10, marginBottom: 10 },
  content: { fontSize: 14, lineHeight: 22, marginBottom: 16 },
  btnRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 },
  btn: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 8 },
  btnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
});
