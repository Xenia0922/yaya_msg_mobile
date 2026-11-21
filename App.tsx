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
  AppState,
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
} from './src/store';
import { loadMembers } from './src/utils/members';
import { fetchJson } from './src/utils/network';
import { loadCachedMemberData } from './src/services/memberData';
import { prefetchR2Music } from './src/api/r2Music';
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
  exoPlayTrack,
  exoControl,
  exoSetSkipHints,
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
import pocketApi from './src/api/pocket48';
import { unwrapList } from './src/utils/data';
import { ensureNotificationPermission } from './src/utils/notifications';
import {
  useMusicPlayerStore,
  flushMusicPlayerStorage,
  PlayMode,
} from './src/store/musicPlayerStore';
import {
  MusicEngine,
  applyNativeSnapshot,
  isExoRecentlyArmed,
  noteExoArmed,
  noteExoProgress,
  resetExoArm,
} from './src/services/musicPlayer';
import { FadeInView } from './src/components/Motion';
import { runAutoCheckinIfNeeded } from './src/services/autoCheckin';
import { startSignatureHealthCheck } from './src/services/signatureHealth';
import { startNativeModuleCheck } from './src/services/nativeHealth';
import { NOTICE_URL, USER_AGENT } from './src/constants';
import { initRuntimeLog, logCrash, logInfo } from './src/utils/runtimeLog';
import { fetchCoverToFile, normalizeCoverUrl } from './src/utils/coverToFile';
import { usePalette } from './src/theme/colors';
import ErrorBoundary from './src/components/ErrorBoundary';
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
  if (!lines || lines.length === 0) return -1;
  let idx = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].time <= pos + 0.4) idx = i;
    else break;
  }
  return idx;
}

async function pushExoAfterSwitch() {
  try {
    const st = useMusicPlayerStore.getState();
    const url = st.url;
    const track = st.queue[st.currentIndex];

    if (isNativeExoDisabled() || st.error || st.playbackState !== 'playing' || !url || !track)
      return;
    if (isExoRecentlyArmed(url)) return;
    setNativeExoActive(true);
    const headers = {
      'User-Agent': USER_AGENT,
      Referer: 'https://h5.48.cn/',
      Origin: 'https://h5.48.cn',
    };

    let resumeAt = 0;
    if (st.seekPending && Number(st.seekTarget) > 0) {
      resumeAt = Number(st.seekTarget);
      useMusicPlayerStore.getState().consumeSeekTarget();
    }
    const vol = /(gnz\.hk|gnz-music|music\.gnz)/i.test(url) ? 0.86 : 1;
    const rep = st.playMode === 'single' ? 1 : 0;
    const send = (art: string) => {
      noteExoArmed(url);

      if (__DEV__)
        console.warn(
          `[push-global] ${art ? 'art-refresh' : 'initial'} url=${String(url).slice(0, 50)} resumeAt=${resumeAt}`,
        );
      exoPlayTrack(
        {
          url,
          trackId: String((track as any).musicId || (track as any).id || ''),
          title: String(track.title || '音乐'),
          artist: String((track as any).artist || (track as any).groupLabel || ''),
          album: String((track as any).album || ''),
          art,
        },
        art ? 0 : resumeAt,
        true,
        headers,
        vol,
        rep,
      );
    };
    send('');
    const coverRaw =
      String((track as any).coverUrl || (track as any).cover || (track as any).thumbPath || '') ||
      '';
    if (coverRaw) {
      let art = '';
      try {
        art = await Promise.race([
          fetchCoverToFile(normalizeCoverUrl(coverRaw)),
          new Promise<string>((res) => setTimeout(() => res(''), 1500)),
        ]);
      } catch {
        art = '';
      }
      const st2 = useMusicPlayerStore.getState();
      if (st2.url === url && st2.playbackState === 'playing' && !isNativeExoDisabled()) {
        send(art || String((track as any).coverUrl || (track as any).cover || ''));
      }
    }
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
            title: String(t.title || '音乐'),
            artist: String(t.artist || t.groupLabel || ''),
            album: String(t.album || ''),
            index: i,
            art: skipHintArts[dir],
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

function MusicForegroundBridge() {
  const lastNativePlayingRef = useRef(false);
  const radioStoppedRef = useRef(false);
  const syncPauseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncResumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  const lastPushKeyRef = useRef('');
  const pushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playbackStateG = useMusicPlayerStore((s) => s.playbackState);
  const playUrlG = useMusicPlayerStore((s) => s.url);
  const currentIndexG = useMusicPlayerStore((s) => s.currentIndex);
  const queueLenG = useMusicPlayerStore((s) => s.queue.length);
  const playModeG = useMusicPlayerStore((s) => s.playMode);
  useEffect(() => {
    if (playbackStateG !== 'playing' || !playUrlG) return;
    const key = `${playUrlG}|${currentIndexG}`;
    if (key === lastPushKeyRef.current) return;
    lastPushKeyRef.current = key;
    if (pushTimerRef.current) clearTimeout(pushTimerRef.current);

    pushTimerRef.current = setTimeout(() => {
      pushExoAfterSwitch().catch(() => {});
    }, 20);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playbackStateG, playUrlG, currentIndexG]);

  useEffect(() => {
    if (playbackStateG !== 'playing' || !playUrlG || isNativeExoDisabled()) return;
    const t = setTimeout(() => {
      if (!isNativeExoDisabled()) pushSkipHints().catch(() => {});
    }, 40);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playbackStateG, playUrlG, currentIndexG, queueLenG, playModeG]);
  useEffect(() => {
    if (playbackStateG === 'idle') {
      lastPushKeyRef.current = '';
      radioStoppedRef.current = false;
      resetExoArm();

      setNativeExoActive(false);
      setNativeExoDisabled(false);

      try {
        exoControl('stop');
      } catch {}
    } else if (playbackStateG !== 'playing') {
      lastPushKeyRef.current = '';
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playbackStateG]);

  useEffect(() => {
    if (isNativeExoDisabled()) return;
    if (playbackStateG === 'paused' && lastNativePlayingRef.current) {
      exoControl('pause');
    } else if (playbackStateG === 'playing' && !lastNativePlayingRef.current) {
      exoControl('resume');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
                duration: Math.max(0, Number(p?.duration) || 0),
                playing: playingN,
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
              if (typeof p?.position === 'number') st.setPosition(p.position);
            }
            if (playingN) {
              clearSyncPause();
              armSyncResume();
            } else {
              clearSyncResume();
              armSyncPause();
            }
          } else if (type === 'ended') {
            clearSyncPause();
            clearSyncResume();
            const st = useMusicPlayerStore.getState();
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
              (MusicEngine as any)._playSeq += 1;
              useMusicPlayerStore.setState({
                currentIndex: idx,
                url: urlN,
                playbackState: 'playing',
                position: 0,
                duration: 0,
                seekTarget: 0,
                seekPending: false,
                seekTargetGuard: 0,
                error: null,
                lyrics: [],
              });

              MusicEngine._fetchLyrics(track);
              MusicEngine._prewarmNextTrack();
            } else {
              applyNativeSnapshot({
                active: true,
                url: urlN,
                trackId: String(p?.trackId || ''),
                title: String(p?.title || ''),
                artist: String(p?.artist || ''),
                album: String(p?.album || ''),
                position: 0,
                duration: 0,
                playing: true,
              });
            }
          } else if (type === 'cmd') {
            const c = String(p?.cmd || '');
            const st = useMusicPlayerStore.getState();
            if (st.playbackState === 'idle') st.setPlaybackState('loading');
            if (c === 'next') MusicEngine.next().catch(() => {});
            else if (c === 'prev') MusicEngine.prev().catch(() => {});
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
      clearSyncPause();
      clearSyncResume();
      // eslint-disable-next-line react-hooks/exhaustive-deps
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
  const duration = useMusicPlayerStore((s) => s.duration);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const [nativeDisabled, setNativeDisabled] = useState(() => isNativeExoDisabled());
  useEffect(() => subscribeNativeExoDisabled(setNativeDisabled), []);
  const playVolumeG = useMemo(() => {
    const u = String(playUrlG || '').toLowerCase();
    return /(gnz\.hk|gnz-music|music\.gnz)/.test(u) || /\.r2\.|r2-music/i.test(u) ? 0.86 : 1.0;
  }, [playUrlG]);
  const seekPendingG = useMusicPlayerStore((s) => s.seekPending);
  const seekTargetG = useMusicPlayerStore((s) => s.seekTarget);
  const seekNonceG = useMusicPlayerStore((s) => s.seekNonce);
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
          useMusicPlayerStore.getState().setPosition(e.currentTime || 0);
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

    const connectAndSubscribe = async () => {
      if (disposed || AppState.currentState !== 'active') return;
      const ok = await ensureGlobalQChatConnection();
      if (!ok || disposed) return;
      try {
        const res = await pocketApi.getFollowedIds();
        if (disposed) return;
        const ids = new Set(
          unwrapList(res, ['content.data', 'content', 'data', 'list']).map(String),
        );
        if (!ids.size) return;
        const curMembers = useMemberStore.getState().members;
        const serverIds = curMembers
          .filter((m) => ids.has(String(m.id || '')) || ids.has(String(m.userId || '')))
          .map((m) => String(m.serverId || '').trim())
          .filter((s) => /^\d+$/.test(s) && s !== '0');
        if (serverIds.length) void subscribeRoomChannelsBatch(serverIds);
      } catch {}
    };

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
  const [message, setMessage] = useState('正在初始化...');
  const appTheme = useResolvedTheme();
  const palette = usePalette();
  const splashBg = palette.background;

  const { seenIds, markSeen, lastFetched, hydrated } = useAnnouncementStore();
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
      try {
        const settings = await loadSettings();
        useSettingsStore.getState().setSettings(settings);

        recoverInterruptedDownloads().catch(() => {});

        await loadPlayerPrefs();
      } catch (error: any) {
        if (mounted) setMessage(`设置加载失败：${error?.message || String(error)}`);
      }

      initWasm().catch((error: any) => {
        if (!mounted) return;
        setMessage((prev) => `${prev}\n签名模块初始化失败：${error?.message || String(error)}`);
      });

      try {
        const backup = require('./assets/members.json');
        const localMembers = await loadMembers(backup);
        useMemberStore.getState().setMembers(localMembers);
        if (mounted) setMessage(`已加载随包成员库 ${localMembers.length} 位`);

        const cached = await loadCachedMemberData();
        if (cached && cached.length >= localMembers.length) {
          useMemberStore.getState().setMembers(cached);
        }
      } catch (error: any) {
        if (mounted) setMessage(`成员数据加载失败：${error?.message || String(error)}`);
      }

      if (mounted) setReady(true);
    })();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => {
      runAutoCheckinIfNeeded().catch(() => {});
    }, 1200);

    useUpdateStore
      .getState()
      .checkUpdate()
      .catch(() => {});

    const r2Timer = setTimeout(() => {
      prefetchR2Music().catch(() => {});
    }, 15000);
    return () => {
      clearTimeout(timer);
      clearTimeout(r2Timer);
    };
  }, [ready]);

  useEffect(() => {
    if (!ready) return;
    startSignatureHealthCheck();

    startNativeModuleCheck();
  }, [ready]);

  const content = (
    <KeyboardProvider>
      <View style={{ flex: 1, backgroundColor: palette.background }}>
        <StatusBar style={appTheme === 'dark' ? 'light' : 'dark'} />
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
      </View>
    </KeyboardProvider>
  );

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      {!ready ? (
        <View style={{ flex: 1, backgroundColor: splashBg }} />
      ) : (
        <ErrorBoundary>{content}</ErrorBoundary>
      )}

      <WebViewSignerHost />

      <MusicForegroundBridge />

      <QChatGlobalBridge ready={ready} />
    </GestureHandlerRootView>
  );
}

const anStyles = StyleSheet.create({
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
