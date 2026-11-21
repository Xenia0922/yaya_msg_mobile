import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  DeviceEventEmitter,
  PanResponder,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import Video, { ViewType } from 'react-native-video';
import { WebView } from 'react-native-webview';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { useMiniPlayerStore } from '../store/miniPlayerStore';
import { USER_AGENT } from '../constants';
import { usePalette, fontFamily } from '../theme';
import { setPipPlaying, setPipAspect } from '../utils/pip';
import { useI18n } from '../i18n';
import { LiveExoView, onLiveFirstFrame } from '../native/LivePlayer';
import { isRtmpUrl } from '../player/resolve/streamResolver';
import { getPlayerHtml } from './media/player';

const W = 180;

const H_MIN = 104;

const CAPSULE_W = 180;
const CAPSULE_H = 44;

const SCALE_SMALL = 0.74;
const SCALE_LARGE = 1.18;

const TAP_SLOP = 10;

const CONTROLS_HIDE_MS = 3000;

const DOUBLE_TAP_MS = 260;

export function MiniPlayer() {
  const { t } = useI18n();
  const navigation = useNavigation<any>();
  const palette = usePalette();
  const { width: winW, height: winH } = useWindowDimensions();
  const info = useMiniPlayerStore((s) => s.info);
  const visible = useMiniPlayerStore((s) => s.visible);
  const playing = useMiniPlayerStore((s) => s.playing);
  const setPlaying = useMiniPlayerStore((s) => s.setPlaying);
  const close = useMiniPlayerStore((s) => s.close);
  const videoRef = useRef<any>(null);
  const seekedRef = useRef(false);

  const [boxH, setBoxH] = useState(H_MIN);
  const boxHRef = useRef(H_MIN);

  const [scale, setScale] = useState(1);

  const [hasNatural, setHasNatural] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);

  const [errorMsg, setErrorMsg] = useState('');
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const lastTapAt = useRef(0);

  const boxW = Math.round(W * scale);
  const boxHNow = Math.max(H_MIN, Math.round(boxH * scale));
  const boxHNowRef = useRef(boxHNow);
  boxHNowRef.current = boxHNow;

  const pos = useRef(new Animated.ValueXY({ x: winW - W - 12, y: winH - H_MIN - 90 })).current;
  const basePos = useRef({ x: winW - W - 12, y: winH - H_MIN - 90 });

  const showControls = useCallback(() => {
    setControlsVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setControlsVisible(false), CONTROLS_HIDE_MS);
  }, []);

  useEffect(() => {
    if (visible) {
      setErrorMsg('');
      seekedRef.current = false;
    }
    showControls();
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      lastTapAt.current = 0;
    };
  }, [showControls, visible]);

  const navNonceRef = useRef(Date.now());

  const backToFull = useCallback(() => {
    if (!info) return;
    const playPosition = useMiniPlayerStore.getState().currentPos;
    close();
    (navigation as any).navigate('Media', {
      mode: info.backTo.mode,
      playUrl: info.backTo.playUrl,
      playLiveId: info.backTo.playLiveId,
      playTitle: info.backTo.playTitle,
      playCover: info.backTo.playCover,
      playNonce: ++navNonceRef.current,

      ...(info.backTo.mode !== 'live' ? { playPosition } : {}),
    });
  }, [info, close, navigation]);

  const cycleScale = useCallback(
    () => setScale((sv) => (sv >= 1.1 ? SCALE_SMALL : sv < 0.9 ? 1 : SCALE_LARGE)),
    [],
  );

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 4 || Math.abs(g.dy) > 4,
        onPanResponderMove: (_e, g) => {
          if (info?.audioOnly) {
            const cx = Math.max(6, Math.min(winW - CAPSULE_W - 6, basePos.current.x + g.dx));
            const cy = Math.max(0, Math.min(winH - CAPSULE_H - 6, basePos.current.y + g.dy));
            pos.setValue({ x: cx, y: cy });
            return;
          }
          pos.setValue({ x: basePos.current.x + g.dx, y: basePos.current.y + g.dy });
        },
        onPanResponderRelease: (_e, g) => {
          if (Math.abs(g.dx) < TAP_SLOP && Math.abs(g.dy) < TAP_SLOP) {
            const now = Date.now();

            if (now - lastTapAt.current < DOUBLE_TAP_MS) {
              lastTapAt.current = 0;
              if (!info?.audioOnly) cycleScale();
              showControls();
              return;
            }
            lastTapAt.current = now;

            setControlsVisible((v) => {
              const next = !v;
              if (next) showControls();
              return next;
            });
            return;
          }

          if (info?.audioOnly) {
            const cx = Math.max(6, Math.min(winW - CAPSULE_W - 6, basePos.current.x + g.dx));
            const cy = Math.max(0, Math.min(winH - CAPSULE_H - 6, basePos.current.y + g.dy));
            basePos.current = { x: cx, y: cy };
            Animated.spring(pos, {
              toValue: { x: cx, y: cy },
              useNativeDriver: false,
              friction: 8,
              tension: 110,
            }).start();
            showControls();
            return;
          }

          const w = boxW;
          const h = boxHNowRef.current;
          const nx = Math.max(6, Math.min(winW - w - 6, basePos.current.x + g.dx));
          const ny = Math.max(6, Math.min(winH - h - 6, basePos.current.y + g.dy));

          const targetX = nx + w / 2 < winW / 2 ? 6 : Math.max(6, winW - w - 6);
          basePos.current = { x: targetX, y: ny };
          Animated.spring(pos, {
            toValue: { x: targetX, y: ny },
            useNativeDriver: false,
            friction: 7,
            tension: 90,
          }).start();
          showControls();
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [info, winW, winH, navigation, showControls, boxW, cycleScale],
  );

  const [pipCover, setPipCover] = useState(false);

  const applyContentSize = useCallback(
    (w: number, h: number, confirmedLandscape?: boolean) => {
      if (info?.audioOnly) return;
      if (info?.isLive) {
        if (typeof confirmedLandscape !== 'boolean' && !info?.web) return;
        const isLand = typeof confirmedLandscape === 'boolean' ? confirmedLandscape : w > h;
        const targetH = isLand ? Math.round((W * 9) / 16) : Math.round((W * 16) / 9);
        boxHRef.current = targetH;
        setBoxH(targetH);
        setHasNatural(true);
        setPipAspect(isLand ? 16 : 9, isLand ? 9 : 16);
        return;
      }
      if (!(w > 0 && h > 0)) return;
      const rawH = Math.round((W * h) / w);
      if (rawH > 420) {
        boxHRef.current = H_MIN;
        setBoxH(H_MIN);
        setHasNatural(false);
      } else {
        const hh = Math.max(H_MIN, rawH);
        boxHRef.current = hh;
        setBoxH(hh);
        setHasNatural(true);
      }
      setPipAspect(w, h);
    },
    [info?.isLive, info?.audioOnly, info?.web],
  );

  useEffect(() => {
    setPipPlaying(visible && playing && !!info?.url && !info?.audioOnly, 'miniplayer');
  }, [visible, playing, info]);
  useEffect(() => () => setPipPlaying(false, 'miniplayer'), []);

  useEffect(() => {
    const u = String(info?.url || '');
    if (!visible || !u || info?.audioOnly || !info?.isLive) return () => {};
    return onLiveFirstFrame((p) => {
      if (p.url && p.url !== u) return;
      const vw = Number(p.visualWidth) || Number(p.width) || 0;
      const vh = Number(p.visualHeight) || Number(p.height) || 0;
      if (vw > 0 && vh > 0) {
        applyContentSize(vw, vh, p.isLandscape);
      }
    });
  }, [visible, info?.url, info?.audioOnly, info?.isLive, applyContentSize]);

  useEffect(() => {
    const active = visible && !!info?.url;
    const sub = DeviceEventEmitter.addListener('PipEnteredChanged', (entered: boolean) => {
      if (entered && active && playing) setPipPlaying(true, 'miniplayer');

      setPipCover(entered && active);
    });
    return () => sub.remove();
  }, [visible, playing, info]);

  const sysToggleSeq = useMiniPlayerStore((s) => s.sysToggleSeq);
  useEffect(() => {
    if (sysToggleSeq === 0) return;
    const cur = useMiniPlayerStore.getState();
    if (!cur.visible || !cur.info?.url) return;
    const next = !cur.playing;
    cur.setPlaying(next);
    if (useWebMini) {
      try {
        webMiniRef.current?.postMessage(JSON.stringify({ type: next ? 'play' : 'pause' }));
      } catch {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sysToggleSeq]);

  const lowerUrl = String(info?.url || '').toLowerCase();
  const isNativeLive =
    !!info?.isLive &&
    !!info?.url &&
    (isRtmpUrl(lowerUrl) || lowerUrl.includes('.flv')) &&
    !!LiveExoView;
  const NativeLiveView = (LiveExoView || null) as React.ComponentType<{
    style?: any;
    url: string;
    onSize?: (e: any) => void;
    audioOnly?: boolean;
    paused?: boolean;
  }> | null;

  const useWebMini = !!info?.web && !!info?.isLive && /^https?:\/\//i.test(lowerUrl);
  const webMiniRef = useRef<WebView>(null);
  const webHeaders = info?.web?.headers;
  const webVolumeBoost = Number(info?.web?.volumeBoost) || 1;
  const webMiniHtml = useMemo(
    () =>
      useWebMini
        ? getPlayerHtml(info.url, undefined, 0, false, (webHeaders || {}) as any, webVolumeBoost)
        : '',
    [useWebMini, info?.url, webHeaders, webVolumeBoost],
  );
  const handlePlayToggle = () => {
    const cur = useMiniPlayerStore.getState().playing;
    const next = !cur;
    useMiniPlayerStore.getState().setPlaying(next);
    if (useWebMini) {
      try {
        webMiniRef.current?.postMessage(JSON.stringify({ type: next ? 'play' : 'pause' }));
      } catch {}
    }
  };

  useEffect(() => {
    const maxX = Math.max(6, winW - boxW - 6);
    const maxY = Math.max(6, winH - boxHNow - 6);
    const bx = Math.min(Math.max(6, basePos.current.x), maxX);
    const by = Math.min(Math.max(6, basePos.current.y), maxY);
    basePos.current = { x: bx, y: by };
    pos.setValue({ x: bx, y: by });
  }, [scale, boxW, boxHNow, winW, winH, pos]);

  useEffect(() => {
    const liveFixed = !!info?.isLive && !info?.audioOnly;
    if (liveFixed) {
      const w0 = Number(info?.aspectW || 0);
      const h0 = Number(info?.aspectH || 0);
      const landscapeLive =
        typeof info?.isLandscape === 'boolean'
          ? info.isLandscape
          : !!info?.web || (w0 > 0 && h0 > 0 && w0 > h0);
      const ph = landscapeLive ? Math.round((W * 9) / 16) : Math.round((W * 16) / 9);
      boxHRef.current = ph;
      setBoxH(ph);
      setHasNatural(typeof info?.isLandscape === 'boolean' || !!info?.web);
      if (landscapeLive) setPipAspect(16, 9);
      else setPipAspect(9, 16);
      return;
    }
    const w = Number(info?.aspectW || 0);
    const h = Number(info?.aspectH || 0);
    if (!(w > 0 && h > 0)) {
      setHasNatural(false);
      return;
    }
    const rawH = Math.round((W * h) / w);
    if (rawH > 420) {
      boxHRef.current = H_MIN;
      setBoxH(H_MIN);
      setHasNatural(false);
    } else {
      const hh = Math.max(H_MIN, rawH);
      boxHRef.current = hh;
      setBoxH(hh);
      setHasNatural(true);
    }
    setPipAspect(w, h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info?.url, info?.aspectW, info?.aspectH, info?.isLandscape]);

  if (!visible || !info) return null;

  return (
    <>
      <Animated.View
        style={[
          styles.wrap,
          pipCover && styles.wrapPiPFull,
          {
            left: 0,
            top: 0,
            ...(pipCover
              ? { right: 0, bottom: 0 }
              : {
                  width: info.audioOnly ? CAPSULE_W : boxW,
                  height: info.audioOnly ? CAPSULE_H : boxHNow,
                }),
            borderRadius: info.audioOnly ? CAPSULE_H / 2 : undefined,
            backgroundColor: info.audioOnly ? palette.surfaceGlassStrong : '#000',
            borderColor: palette.hairline,
            transform: pipCover
              ? [{ translateX: 0 }, { translateY: 0 }]
              : pos.getTranslateTransform(),
          },
        ]}
      >
        <View
          pointerEvents="none"
          style={
            info.audioOnly ? [StyleSheet.absoluteFill, { opacity: 0 }] : StyleSheet.absoluteFill
          }
        >
          {useWebMini ? (
            <WebView
              ref={webMiniRef}
              key={info.url}
              source={{ html: webMiniHtml }}
              style={StyleSheet.absoluteFill}
              javaScriptEnabled
              domStorageEnabled
              allowsInlineMediaPlayback
              mediaPlaybackRequiresUserAction={false}
              originWhitelist={['*']}
              mixedContentMode="always"
              onMessage={(e) => {
                try {
                  const d = JSON.parse(e.nativeEvent.data);
                  if (d.type === 'videosize') {
                    applyContentSize(Number(d.width) || 0, Number(d.height) || 0);
                  } else if (d.type === 'progress') {
                    const t = Number(d.time) || 0;
                    if (Number.isFinite(t) && t > 0) useMiniPlayerStore.getState().setCurrentPos(t);
                  }
                } catch {}
              }}
            />
          ) : isNativeLive && NativeLiveView ? (
            <NativeLiveView
              key={info.url}
              style={StyleSheet.absoluteFill}
              url={info.url}
              paused={!playing}

              audioOnly={!!info.audioOnly}
              onSize={(e) => {
                const ne = e?.nativeEvent || {};
                const w = Number(ne.visualWidth) || Number(ne.width) || 0;
                const h = Number(ne.visualHeight) || Number(ne.height) || 0;
                applyContentSize(
                  w,
                  h,
                  typeof ne.isLandscape === 'boolean' ? ne.isLandscape : undefined,
                );
              }}
            />
          ) : (
            <Video
              ref={videoRef}
              key={`${info.url}-${info.position || 0}`}
              source={{
                uri: info.url,

                headers: {
                  'User-Agent': USER_AGENT,
                  Referer: 'https://h5.48.cn/',
                  Origin: 'https://h5.48.cn',
                },
              }}
              style={StyleSheet.absoluteFill}

              viewType={ViewType.TEXTURE}

              resizeMode={pipCover || hasNatural || scale !== 1 ? 'contain' : 'cover'}
              paused={!playing}
              playInBackground
              playWhenInactive
              ignoreSilentSwitch="ignore"
              onLoad={(e) => {
                const ns = e?.naturalSize;
                if (ns && Number(ns.width) > 0 && Number(ns.height) > 0) {
                  applyContentSize(Number(ns.width), Number(ns.height));
                } else {
                  setHasNatural(false);
                }

                const t = Number(info.position) || 0;

                if (t > 1 && !seekedRef.current && !info.isLive && videoRef.current?.seek) {
                  seekedRef.current = true;
                  videoRef.current.seek(t);
                }
              }}

              onProgress={(e: any) => {
                const t = Number(e?.currentTime) || 0;
                if (!info.isLive && t > 0) useMiniPlayerStore.getState().setCurrentPos(t);
              }}
              onEnd={() => setPlaying(false)}
              onError={(event) => {
                setErrorMsg(
                  t('小窗播放失败：{detail}', {
                    detail: JSON.stringify(event?.error || event).slice(0, 160),
                  }),
                );
              }}
            />
          )}
        </View>
        {errorMsg ? (
          <View
            style={[
              StyleSheet.absoluteFill,
              {
                backgroundColor: 'rgba(0,0,0,0.7)',
                justifyContent: 'center',
                alignItems: 'center',
                padding: 8,
              },
            ]}
            pointerEvents="none"
          >
            <MaterialCommunityIcons name="alert-circle-outline" size={20} color="#ff6b6b" />
            <Text
              style={{
                color: '#fff',
                fontSize: 10,
                fontFamily: fontFamily.system,
                marginTop: 4,
                textAlign: 'center',
              }}
            >
              {errorMsg}
            </Text>
          </View>
        ) : null}

        <Animated.View
          {...(!info.audioOnly ? pan.panHandlers : {})}
          pointerEvents={info.audioOnly ? 'none' : 'auto'}
          style={styles.dragLayer}
        />

        {!info.audioOnly ? (
          <View
            nativeID="yaya.pip.overlay"
            collapsable={false}
            style={[styles.titleBar, controlsVisible && !pipCover ? null : styles.hiddenLayer]}
            pointerEvents="none"
          >
            <Text style={styles.title} numberOfLines={1}>
              {info.title}
            </Text>
          </View>
        ) : null}
      </Animated.View>

      <Animated.View
        nativeID="yaya.pip.overlay"
        collapsable={false}
        pointerEvents={pipCover ? 'none' : info.audioOnly ? 'auto' : 'box-none'}

        {...(!pipCover && info.audioOnly ? pan.panHandlers : {})}
        style={[
          StyleSheet.absoluteFill,
          pipCover
            ? { left: 0, top: 0, right: 0, bottom: 0, zIndex: 9999, elevation: 9999 }
            : {
                left: 0,
                top: 0,
                width: info.audioOnly ? CAPSULE_W : boxW,
                height: info.audioOnly ? CAPSULE_H : boxHNow,
                zIndex: 1002,
                elevation: 24,
                transform: pos.getTranslateTransform(),
              },
        ]}
      >
        {info.audioOnly ? (
          <View
            style={[styles.capsuleRow, pipCover ? styles.hiddenLayer : null]}
            pointerEvents={pipCover ? 'none' : 'box-none'}
          >
            <MaterialCommunityIcons name="microphone" size={12} color={palette.tint} />
            <Text style={[styles.capsuleTitle, { color: palette.label }]} numberOfLines={1}>
              {info.title}
            </Text>
            <TouchableOpacity
              onPress={handlePlayToggle}
              hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
            >
              <MaterialCommunityIcons
                name={playing ? 'pause' : 'play'}
                size={14}
                color={palette.label}
              />
            </TouchableOpacity>

            <TouchableOpacity onPress={close} hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}>
              <MaterialCommunityIcons name="close" size={12} color={palette.labelSecondary} />
            </TouchableOpacity>
          </View>
        ) : null}

        {!info.audioOnly ? (
          <>
            <TouchableOpacity
              style={[styles.closeBtn, pipCover ? styles.hiddenLayer : null]}
              disabled={pipCover}
              onPress={close}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <MaterialCommunityIcons name="close" size={14} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.expandBtn, pipCover ? styles.hiddenLayer : null]}
              disabled={pipCover}
              onPress={backToFull}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <MaterialCommunityIcons name="crop-free" size={13} color="#fff" />
            </TouchableOpacity>
          </>
        ) : null}

        {!info.audioOnly ? (
          <View
            style={[styles.centerRow, controlsVisible && !pipCover ? null : styles.hiddenLayer]}
            pointerEvents={controlsVisible && !pipCover ? 'box-none' : 'none'}
          >
            <TouchableOpacity
              style={styles.playBtn}
              onPress={handlePlayToggle}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <MaterialCommunityIcons name={playing ? 'pause' : 'play'} size={16} color="#fff" />
            </TouchableOpacity>
          </View>
        ) : null}
      </Animated.View>
    </>
  );
}

const styles = StyleSheet.create({
  capsuleRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
  },
  capsuleTitle: { flex: 1, fontSize: 11, fontFamily: fontFamily.system, fontWeight: '600' },

  hiddenLayer: { opacity: 0 },
  wrap: {
    position: 'absolute',
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
    zIndex: 999,
  },

  wrapPiPFull: {
    borderRadius: 0,
    borderWidth: 0,
    elevation: 9999,
    zIndex: 9999,
  },

  dragLayer: {
    position: 'absolute',
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    elevation: 16,
    zIndex: 6,
    backgroundColor: 'transparent',
  },
  titleBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 8,
    paddingTop: 14,
    paddingBottom: 4,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  title: { color: '#fff', fontSize: 10, fontFamily: fontFamily.system, fontWeight: '700' },

  closeBtn: {
    position: 'absolute',
    top: 4,
    left: 4,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.42)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  expandBtn: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.42)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  centerRow: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(0,0,0,0.44)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
