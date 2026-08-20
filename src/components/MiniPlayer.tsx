/**
 * 应用内悬浮小窗播放器（In-App Mini Player）：
 *  - 右下角悬浮，可拖动（PanResponder，零依赖）
 *  - 独立 Video 实例续播（交棒时 seek 到原位置）
 *  - 交互：右上角「返回全屏」常显按钮（回放全屏播放器）；左上角「关闭」；
 *    点画面唤出/隐藏控件组（暂停、标题，3s 无操作自动隐藏）
 *  - 容器宽高按视频内容比例自适应（竖屏内容竖着小窗，不再裁剪变形）
 *  - 与系统 PiP 并存：App 前台用小窗，切后台由 MainActivity 自动进系统悬浮窗
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  AppState,
  PanResponder,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import Video from 'react-native-video';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { useMiniPlayerStore } from '../store/miniPlayerStore';
import { usePalette } from '../theme';
import { setPipPlaying, setPipAspect } from '../utils/pip';
import { useI18n } from '../i18n';

const W = 168;
/** 高度按内容比例计算，钳制在此区间（竖屏内容窄条 -> 近似方块；横屏内容 16:9） */
const H_MIN = 96;
const H_MAX = 230;
/** 拖动/点击判定阈值：位移小于该值视为点击 */
const TAP_SLOP = 10;
/** 控件自动隐藏时长（ms） */
const CONTROLS_HIDE_MS = 3000;

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
  // 小窗高度（按视频内容比例自适应）
  const [boxH, setBoxH] = useState(H_MIN);
  const boxHRef = useRef(H_MIN);
  const [controlsVisible, setControlsVisible] = useState(true);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 初始位置：右下角，避开底部 tab dock
  const pos = useRef(new Animated.ValueXY({ x: winW - W - 12, y: winH - H_MIN - 90 })).current;
  const basePos = useRef({ x: winW - W - 12, y: winH - H_MIN - 90 });

  const showControls = useCallback(() => {
    setControlsVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setControlsVisible(false), CONTROLS_HIDE_MS);
  }, []);

  useEffect(() => {
    showControls();
    return () => { if (hideTimer.current) clearTimeout(hideTimer.current); };
  }, [showControls, visible]);

  /** 回放全屏：关闭小窗并跳转播放器 */
  const backToFull = useCallback(() => {
    if (!info) return;
    close();
    (navigation as any).navigate('Media', {
      mode: info.backTo.mode,
      playUrl: info.backTo.playUrl,
      playTitle: info.backTo.playTitle,
      playCover: info.backTo.playCover,
      playNonce: Date.now(),
    });
  }, [info, close, navigation]);

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 4 || Math.abs(g.dy) > 4,
        onPanResponderMove: (_e, g) => {
          pos.setValue({ x: basePos.current.x + g.dx, y: basePos.current.y + g.dy });
        },
        onPanResponderRelease: (_e, g) => {
          // 几乎没动 → 视为点击：唤出/隐藏控件组（不再直接回放，避免误触）
          if (Math.abs(g.dx) < TAP_SLOP && Math.abs(g.dy) < TAP_SLOP) {
            setControlsVisible((v) => {
              const next = !v;
              if (next) showControls();
              return next;
            });
            return;
          }
          // 拖动：夹紧在屏幕内（用当前小窗高度）
          const h = boxHRef.current;
          const nx = Math.max(6, Math.min(winW - W - 6, basePos.current.x + g.dx));
          const ny = Math.max(6, Math.min(winH - h - 6, basePos.current.y + g.dy));
          basePos.current = { x: nx, y: ny };
          pos.setValue({ x: nx, y: ny });
          showControls();
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [info, winW, winH, navigation, showControls],
  );

  // 播放状态 → PiP 标志（小窗切后台自动进系统悬浮窗）
  useEffect(() => {
    setPipPlaying(visible && playing && !!info?.url);
  }, [visible, playing, info]);

  // 切后台兜底：强制置 PiP 标志（防主播放器关闭时把标志覆盖成 false，导致小窗切后台不进悬浮窗）
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') {
        setPipPlaying(visible && playing && !!info?.url);
      }
    });
    return () => sub.remove();
  }, [visible, playing, info]);

  if (!visible || !info) return null;

  return (
    <>
      {/* 容器（视觉层）：Video + 透明拖动层（elevation 盖过 SurfaceView 接收触摸） */}
      <Animated.View
        style={[
          styles.wrap,
          {
            left: pos.x,
            top: pos.y,
            width: W,
            height: boxH,
            backgroundColor: '#000',
            borderColor: palette.hairline,
          },
        ]}
      >
        <Video
          ref={videoRef}
          key={`${info.url}-${info.position || 0}`}
          source={{ uri: info.url }}
          style={StyleSheet.absoluteFill}
          resizeMode="contain"
          paused={!playing}
          playInBackground
          playWhenInactive
          ignoreSilentSwitch="ignore"
          onLoad={(e) => {
            // 按内容比例自适应小窗高度（竖屏内容竖着小窗，不裁剪）
            const ns = e?.naturalSize;
            if (ns && Number(ns.width) > 0 && Number(ns.height) > 0) {
              const h = Math.max(H_MIN, Math.min(H_MAX, Math.round((W * Number(ns.height)) / Number(ns.width))));
              boxHRef.current = h;
              setBoxH(h);
              // 同步 PiP 窗口比例（切后台的系统悬浮窗也跟随内容方向）
              setPipAspect(ns.width, ns.height);
            }
            // 续播到交棒位置（仅录播）
            const t = Number(info.position) || 0;
            if (t > 1 && !seekedRef.current && videoRef.current?.seek) {
              seekedRef.current = true;
              videoRef.current.seek(t);
            }
          }}
          onEnd={() => setPlaying(false)}
          onError={() => close()}
        />
        {/* 透明拖动/点击层：elevation 让此 JS 层盖过 Android SurfaceView 接收触摸（否则 Video 消费触摸无法拖动） */}
        <Animated.View
          {...pan.panHandlers}
          style={styles.dragLayer}
        />
        {/* 底部标题（随控件显隐） */}
        {controlsVisible ? (
          <View style={styles.titleBar} pointerEvents="none">
            <Text style={styles.title} numberOfLines={1}>{info.title}</Text>
          </View>
        ) : null}
        {/* 小窗标签（常显） */}
        <View style={styles.tag} pointerEvents="none">
          <MaterialCommunityIcons name="picture-in-picture-bottom-right-outline" size={10} color="#fff" />
          <Text style={styles.tagText}>{t('小窗')}</Text>
        </View>
      </Animated.View>

      {/* 按钮层：常显返回全屏 + 关闭；暂停按钮随控件显隐 */}
      <Animated.View
        pointerEvents="box-none"
        style={[StyleSheet.absoluteFill, { left: pos.x, top: pos.y, width: W, height: boxH, zIndex: 1000 }]}
      >
        {/* 返回全屏（常显，右上角） */}
        <TouchableOpacity
          style={styles.expandBtn}
          onPress={backToFull}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <MaterialCommunityIcons name="arrow-expand" size={15} color="#fff" />
        </TouchableOpacity>
        {/* 关闭（常显，左上角） */}
        <TouchableOpacity
          style={styles.closeBtn}
          onPress={close}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <MaterialCommunityIcons name="close" size={14} color="#fff" />
        </TouchableOpacity>
        {/* 暂停/继续（随控件显隐，右下角） */}
        {controlsVisible ? (
          <TouchableOpacity
            style={styles.playBtn}
            onPress={() => setPlaying(!playing)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <MaterialCommunityIcons name={playing ? 'pause' : 'play'} size={14} color="#fff" />
          </TouchableOpacity>
        ) : null}
      </Animated.View>
    </>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
    zIndex: 999,
  },
  // 透明拖动层：elevation 提升使其盖过 Android Video 的 SurfaceView，触摸才能到 PanResponder
  dragLayer: {
    position: 'absolute',
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    elevation: 6,
    zIndex: 5,
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
  title: { color: '#fff', fontSize: 10, fontWeight: '700' },
  expandBtn: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtn: {
    position: 'absolute',
    top: 4,
    left: 4,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  playBtn: {
    position: 'absolute',
    bottom: 18,
    right: 6,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tag: {
    position: 'absolute',
    top: 26,
    left: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  tagText: { color: '#fff', fontSize: 9, fontWeight: '700' },
});
