import React, { useEffect, useMemo, useRef } from 'react';
import { StyleSheet } from 'react-native';
import Video from 'react-native-video';
import { USER_AGENT } from '../constants';
import { useVoicePlayerStore } from '../store/voicePlayerStore';
import { trackIdentityKey, useMusicPlayerStore } from '../store/musicPlayerStore';
import { MusicEngine } from '../services/musicPlayer';
import { claimAudioFocus, registerAudioHandler, releaseAudioFocus } from '../services/audioFocus';

export function VoiceAudioHost() {
  const url = useVoicePlayerStore((s) => s.url);
  const playing = useVoicePlayerStore((s) => s.playing);
  const ended = useVoicePlayerStore((s) => s.ended);
  const rate = useVoicePlayerStore((s) => s.rate);
  const seekSeq = useVoicePlayerStore((s) => s.seekSeq);
  const seekTarget = useVoicePlayerStore((s) => s.seekTarget);
  const retrySeq = useVoicePlayerStore((s) => s.retrySeq);

  const videoRef = useRef<any>(null);
  const handledSeekRef = useRef(0);
  const loadedKeyRef = useRef('');
  const pausedMusicKeyRef = useRef<string | null>(null);
  const mountKey = url ? `${url}#${retrySeq}` : '';

  useEffect(() => {
    return registerAudioHandler('voice', () => {
      pausedMusicKeyRef.current = null;
      useVoicePlayerStore.getState().stop();
    });
  }, []);

  useEffect(() => {
    if (!playing || !url) {
      releaseAudioFocus('voice');
      return;
    }
    try {
      const mst = useMusicPlayerStore.getState();
      if (mst.playbackState === 'playing') {
        const cur = mst.queue[mst.currentIndex];
        pausedMusicKeyRef.current = trackIdentityKey(cur) || '__playing__';
      }
    } catch {}
    claimAudioFocus('voice');
  }, [playing, url]);

  useEffect(() => {
    if (!ended) return;
    releaseAudioFocus('voice');
    if (!pausedMusicKeyRef.current) return;
    const savedKey = pausedMusicKeyRef.current;
    pausedMusicKeyRef.current = null;
    try {
      const mst = useMusicPlayerStore.getState();
      const curKey = trackIdentityKey(mst.queue[mst.currentIndex]) || '__playing__';
      if (mst.playbackState === 'paused' && curKey === savedKey) {
        MusicEngine.togglePause();
      }
    } catch {}
  }, [ended]);

  useEffect(() => {
    if (!url && pausedMusicKeyRef.current) {
      pausedMusicKeyRef.current = null;
    }
  }, [url]);

  useEffect(() => {
    if (!url || !seekSeq || seekSeq === handledSeekRef.current) return;
    if (loadedKeyRef.current !== mountKey) return;
    handledSeekRef.current = seekSeq;
    try {
      videoRef.current?.seek?.(seekTarget);
    } catch {}
  }, [url, mountKey, seekSeq, seekTarget]);

  const source = useMemo(
    () =>
      url
        ? {
            uri: url,
            headers: {
              'User-Agent': USER_AGENT,
              Referer: 'https://h5.48.cn/',
              Origin: 'https://h5.48.cn',
            },
          }
        : undefined,
    [url],
  );

  if (!url || !source) return null;

  return (
    <Video
      ref={videoRef}
      key={mountKey}
      source={source}
      style={styles.hidden}
      paused={!playing}
      rate={rate}
      playInBackground
      playWhenInactive
      ignoreSilentSwitch="ignore"
      progressUpdateInterval={120}
      onAudioBecomingNoisy={() => {
        pausedMusicKeyRef.current = null;
        useVoicePlayerStore.getState().stop();
      }}
      onLoad={(data: any) => {
        loadedKeyRef.current = mountKey;
        const dur = Number(data?.duration || 0);
        const st = useVoicePlayerStore.getState();
        st.onLoaded(url, dur);
        if (st.url === url && st.seekSeq > handledSeekRef.current) {
          handledSeekRef.current = st.seekSeq;
          if (st.seekTarget > 0.1) {
            try {
              videoRef.current?.seek?.(st.seekTarget);
            } catch {}
          }
        }
      }}
      onProgress={(data: any) => {
        useVoicePlayerStore.getState().onProgress(url, Number(data?.currentTime || 0));
      }}
      onBuffer={(data: any) => {
        useVoicePlayerStore.getState().onBuffering(url, !!data?.isBuffering);
      }}
      onEnd={() => {
        useVoicePlayerStore.getState().onEnded(url);
      }}
      onError={(err: any) => {
        pausedMusicKeyRef.current = null;
        const msg = String(err?.error?.errorString || err?.error?.message || 'playback error');
        useVoicePlayerStore.getState().onError(url, msg);
      }}
    />
  );
}

const styles = StyleSheet.create({
  hidden: {
    position: 'absolute',
    width: 0,
    height: 0,
    opacity: 0,
  },
});
