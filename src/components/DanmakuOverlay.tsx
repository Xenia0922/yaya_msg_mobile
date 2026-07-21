/**
 * 弹幕 overlay —— 在回放 WebView / 原生播放器之上叠加滚动弹幕。
 * 哔哩哔哩风格：
 *   - 多泳道 + 每条「占位到上一条完全离屏 + 安全间隔」才复用泳道，彻底杜绝重叠
 *   - 同屏同刻多条时按泳道最早空闲者排队，未轮到的延迟入场（不会挤在一起）
 *   - 颜色统一白色（弹幕更干净，也避免花花绿绿看不清）
 *   - 设置（不透明度 / 速度 / 显示区域 / 字号 / 总开关）来自 useDanmakuSettings，记忆持久化
 *   - 纯 RN Animated 实现，零额外依赖
 */
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Dimensions, StyleSheet, Text } from 'react-native';
import { DanmakuItem } from '../utils/danmaku';
import { useDanmakuSettings } from '../store/danmakuSettings';

const BASE_DURATION = 7000; // 基础横穿时长（ms），speed 越大越快
const SAFE_GAP = 600; // 同泳道两条之间的安全间隔（ms），杜绝重叠
// 向前跳转超过此阈值（ms）即视为「拖动/快进」，清空当前屏而不补发历史弹幕，
// 避免「拖一下蹦出一大片之前的弹幕」影响观感。
const SEEK_FORWARD_MS = 1500;

interface ActiveDanmaku {
  key: string;
  text: string;
  lane: number;
  anim: Animated.Value;
}

export interface DanmakuOverlayProps {
  danmaku: DanmakuItem[];
  currentTime: number;
  visible: boolean;
  /** 直播模式：实时弹幕立即上屏，不做子秒级错峰（录播才按发送时刻错峰） */
  live?: boolean;
  opacity?: number;
}

export function DanmakuOverlay({ danmaku, currentTime, visible, live = false, opacity: opacityProp }: DanmakuOverlayProps) {
  const { enabled, opacity: sOpacity, speed, area, fontSize } = useDanmakuSettings();
  const [active, setActive] = useState<ActiveDanmaku[]>([]);
  const lastTime = useRef(0);
  const laneFreeAt = useRef<number[]>([]);
  const counter = useRef(0);
  const width = Dimensions.get('window').width;
  const screenH = Dimensions.get('window').height;

  // 显示区域 → 泳道数（顶部少、全屏多）
  const rowH = fontSize + 10;
  let laneCount = Math.max(8, Math.floor((screenH * 0.92) / rowH));
  if (area === 'top') laneCount = Math.max(4, Math.min(6, Math.floor((screenH * 0.4) / rowH)));
  else if (area === 'half') laneCount = Math.max(6, Math.floor((screenH * 0.55) / rowH));
  // 区域 / 字号变化时同步泳道数组长度
  useEffect(() => {
    if (laneFreeAt.current.length !== laneCount) laneFreeAt.current = new Array(laneCount).fill(0);
  }, [laneCount]);

  useEffect(() => {
    if (!visible || !enabled || !danmaku.length) {
      lastTime.current = currentTime;
      return;
    }
    const from = lastTime.current;
    const to = currentTime;
    lastTime.current = to;
    // 拖拽回退：不补发
    if (to <= from) return;
    const deltaMs = (to - from) * 1000;
    // 大步快进 / 拖动：清空当前屏弹幕，不补发历史，避免「拖一下蹦出一大片之前的弹幕」
    if (deltaMs > SEEK_FORWARD_MS) {
      setActive([]);
      return;
    }

    const spawned = danmaku.filter((d) => d.time > from && d.time <= to);
    if (!spawned.length) return;

    const duration = BASE_DURATION / (speed > 0 ? speed : 1);

    const newOnes: ActiveDanmaku[] = spawned.map((d) => {
      // 选「最早空闲」的泳道（min freeAt），保证不重叠
      let lane = 0;
      for (let i = 1; i < laneCount; i++) {
        if (laneFreeAt.current[i] < laneFreeAt.current[lane]) lane = i;
      }
      // 1) 泳道空闲延迟：上一条还没离屏则延后入场
      const laneDelay = Math.max(0, (laneFreeAt.current[lane] - to) * 1000);
      // 2) 子秒级错峰（仅录播）：按「本条真实发送时刻 - 窗口起点」错峰入场，
      //    解决「同一秒左右发的弹幕被强制同时飘屏」——让它们按真实时刻依次出现。
      const entryDelay = live ? 0 : Math.max(0, (d.time - from) * 1000);
      const startDelay = Math.max(laneDelay, entryDelay);
      // 预留：本条完全离屏 + 安全间隔 后才释放泳道
      laneFreeAt.current[lane] = to + (startDelay + duration + SAFE_GAP) / 1000;

      const anim = new Animated.Value(0);
      Animated.sequence([
        Animated.delay(startDelay),
        Animated.timing(anim, { toValue: 1, duration, easing: (t) => t, useNativeDriver: true }),
      ]).start(() => {
        setActive((prev) => prev.filter((a) => a.anim !== anim));
      });
      return {
        key: `d${counter.current++}`,
        text: d.text,
        lane,
        anim,
      };
    });
    setActive((prev) => [...prev, ...newOnes].slice(-80));
  }, [currentTime, visible, enabled, danmaku, laneCount, speed, live]);

  if (!visible || !enabled) return null;
  const opacity = opacityProp ?? sOpacity;

  return (
    <Animated.View style={[StyleSheet.absoluteFill, { opacity, zIndex: 30, pointerEvents: 'none' }]} pointerEvents="none">
      {active.map((a) => {
        const translateX = a.anim.interpolate({ inputRange: [0, 1], outputRange: [width, -width * 0.72] });
        const top = 8 + a.lane * (fontSize + 10);
        return (
          <Animated.Text
            key={a.key}
            style={[
              styles.bullet,
              { top, fontSize, transform: [{ translateX }], color: '#ffffff' },
            ]}
          >
            {a.text}
          </Animated.Text>
        );
      })}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  bullet: {
    position: 'absolute',
    left: 0,
    fontWeight: '700',
    color: '#ffffff',
    textShadowColor: 'rgba(0,0,0,0.95)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 3,
    paddingHorizontal: 6,
  },
});
