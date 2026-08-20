/**
 * 应用内悬浮小窗播放器（In-App Mini Player）：
 *  - 右下角悬浮，可拖动（PanResponder，零依赖）
 *  - 独立 Video 实例续播（交棒时 seek 到原位置）
 *  - 点按 → 回放全屏（导航回 MediaScreen 并带播放参数）；X 关闭；右下角暂停/继续
 *  - 与系统 PiP 并存：App 前台用小窗，切后台由 MainActivity 自动进系统悬浮窗
 */
import React, { useMemo, useRef } from 'react';
import {
  Animated,
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
import { setPipPlaying } from '../utils/pip';
import { useI18n } from '../i18n';

const W = 168;
const H = 96;
/** 拖动/点击判定阈值：位移小于该值视为点击 */
const TAP_SLOP = 10;

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

  // 初始位置：右下角，避开底部 tab dock
  const pos = useRef(new Animated.ValueXY({ x: winW - W - 12, y: winH - H - 90 })).current;
  const basePos = useRef({ x: winW - W - 12, y: winH - H - 90 });

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 4 || Math.abs(g.dy) > 4,
        onPanResponderMove: (_e, g) => {
          pos.setValue({ x: basePos.current.x + g.dx, y: basePos.current.y + g.dy });
        },
        onPanResponderRelease: (_e, g) => {
          // 几乎没动 → 视为点击：回放全屏
          if (Math.abs(g.dx) < TAP_SLOP && Math.abs(g.dy) < TAP_SLOP) {
            if (info) {
              close();
              (navigation as any).navigate('Media', {
                mode: info.backTo.mode,
                playUrl: info.backTo.playUrl,
                playTitle: info.backTo.playTitle,
                playCover: info.backTo.playCover,
                playNonce: Date.now(),
              });
            }
            return;
          }
          // 拖动：夹紧在屏幕内
          const nx = Math.max(6, Math.min(winW - W - 6, basePos.current.x + g.dx));
          const ny = Math.max(6, Math.min(winH - H - 6, basePos.current.y + g.dy));
          basePos.current = { x: nx, y: ny };
          pos.setValue({ x: nx, y: ny });
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [info, winW, winH, navigation],
  );

  // 播放状态 → PiP 标志（小窗切后台自动进系统悬浮窗）
  React.useEffect(() => {
    setPipPlaying(visible && playing && !!info?.url);
  }, [visible, playing, info]);

  if (!visible || !info) return null;

  return (
    <>
      {/* 拖动/点击层：PanResponder 独占此层触摸；子按钮放在下方独立层（触摸优先） */}
      <Animated.View
        {...pan.panHandlers}
        style={[
          styles.wrap,
          {
            left: pos.x,
            top: pos.y,
            width: W,
            height: H,
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
          resizeMode="cover"
          paused={!playing}
          playInBackground
          playWhenInactive
          ignoreSilentSwitch="ignore"
          onLoad={() => {
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
        {/* 底部渐变遮罩 + 标题 */}
        <View style={styles.titleBar} pointerEvents="none">
          <Text style={styles.title} numberOfLines={1}>{info.title}</Text>
        </View>
        {/* 小窗标签 */}
        <View style={styles.tag} pointerEvents="none">
          <MaterialCommunityIcons name="picture-in-picture-bottom-right-outline" size={10} color="#fff" />
          <Text style={styles.tagText}>{t('小窗')}</Text>
        </View>
      </Animated.View>
      {/* 按钮层：与拖动层同位置（同步 pos），渲染在上层 → 按钮触摸优先于 PanResponder */}
      <Animated.View
        pointerEvents="box-none"
        style={[StyleSheet.absoluteFill, { left: pos.x, top: pos.y, width: W, height: H, zIndex: 1000 }]}
      >
        <TouchableOpacity
          style={styles.closeBtn}
          onPress={close}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <MaterialCommunityIcons name="close" size={14} color="#fff" />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.playBtn}
          onPress={() => setPlaying(!playing)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <MaterialCommunityIcons name={playing ? 'pause' : 'play'} size={14} color="#fff" />
        </TouchableOpacity>
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
  closeBtn: {
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
  playBtn: {
    position: 'absolute',
    bottom: 16,
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
    top: 4,
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
