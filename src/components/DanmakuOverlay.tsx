import React, { memo, useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, useWindowDimensions } from 'react-native';
import { DanmakuItem } from '../utils/danmaku';
import { useDanmakuSettings } from '../store/danmakuSettings';
import { useSafeAreaInsets } from '../hooks/useSafeAreaInsets';

const BASE_DURATION = 7000;
const SAFE_GAP = 600;

const SEEK_FORWARD_MS = 1500;

const MAX_ACTIVE = 40;

interface ActiveDanmaku {
  key: string;
  text: string;
  lane: number;
  anim: Animated.Value;
}

const Bullet = memo(function Bullet({
  text,
  top,
  fontSize: fs,
  anim,
  width: w,
}: {
  text: string;
  top: number;
  fontSize: number;
  anim: Animated.Value;
  width: number;
}) {
  const translateX = anim.interpolate({ inputRange: [0, 1], outputRange: [w, -w * 0.72] });
  return (
    <Animated.Text
      style={[styles.bullet, { top, fontSize: fs, transform: [{ translateX }], color: '#ffffff' }]}
    >
      {text}
    </Animated.Text>
  );
});

export interface DanmakuOverlayProps {
  danmaku: DanmakuItem[];
  currentTime: number;
  visible: boolean;

  live?: boolean;
  opacity?: number;

  liveItems?: Array<{ key: string; text: string }>;
}

export function DanmakuOverlay({
  danmaku,
  currentTime,
  visible,
  live = false,
  opacity: opacityProp,
  liveItems,
}: DanmakuOverlayProps) {
  const { enabled, opacity: sOpacity, speed, area, fontSize } = useDanmakuSettings();
  const [active, setActive] = useState<ActiveDanmaku[]>([]);
  const lastTime = useRef(0);
  const laneFreeAt = useRef<number[]>([]);
  const counter = useRef(0);
  const { width, height: screenH } = useWindowDimensions();

  const insets = useSafeAreaInsets();
  const topOffset = (insets?.top || 0) + 8;

  const rowH = fontSize + 10;
  let laneCount = Math.max(8, Math.floor(((screenH - topOffset) * 0.92) / rowH));
  if (area === 'top')
    laneCount = Math.max(4, Math.min(6, Math.floor(((screenH - topOffset) * 0.4) / rowH)));
  else if (area === 'half')
    laneCount = Math.max(6, Math.floor(((screenH - topOffset) * 0.55) / rowH));

  useEffect(() => {
    if (laneFreeAt.current.length !== laneCount) laneFreeAt.current = new Array(laneCount).fill(0);
  }, [laneCount]);

  useEffect(() => {
    if (!visible || !enabled || !danmaku.length) {
      lastTime.current = currentTime;

      setActive((prev) => {
        if (prev.length)
          prev.forEach((a) => {
            try {
              a.anim.stopAnimation();
            } catch {}
          });
        return [];
      });
      laneFreeAt.current = laneFreeAt.current.map(() => 0);
      return;
    }
    const from = lastTime.current;
    const to = currentTime;
    lastTime.current = to;

    if (to <= from) return;
    const deltaMs = (to - from) * 1000;

    if (deltaMs > SEEK_FORWARD_MS) {
      setActive((prev) => {
        if (prev.length)
          prev.forEach((a) => {
            try {
              a.anim.stopAnimation();
            } catch {}
          });
        return [];
      });
      laneFreeAt.current = laneFreeAt.current.map(() => 0);
      return;
    }

    const spawned = danmaku.filter((d) => d.time > from && d.time <= to);
    if (!spawned.length) return;

    const duration = BASE_DURATION / (speed > 0 ? speed : 1);

    const newOnes: ActiveDanmaku[] = spawned.map((d) => {
      let lane = 0;
      for (let i = 1; i < laneCount; i++) {
        if (laneFreeAt.current[i] < laneFreeAt.current[lane]) lane = i;
      }

      const laneDelay = Math.max(0, (laneFreeAt.current[lane] - to) * 1000);

      const entryDelay = live ? 0 : Math.max(0, (d.time - from) * 1000);
      const startDelay = Math.max(laneDelay, entryDelay);

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
    setActive((prev) => [...prev, ...newOnes].slice(-MAX_ACTIVE));
  }, [currentTime, visible, enabled, danmaku, laneCount, speed, live]);

  const seenLive = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!visible || !enabled || !liveItems || !liveItems.length) return;
    const fresh = liveItems.filter((i) => i.key && !seenLive.current.has(i.key));
    if (!fresh.length) return;
    fresh.forEach((i) => seenLive.current.add(i.key));

    if (seenLive.current.size > 600) {
      seenLive.current = new Set(liveItems.map((i) => i.key));
    }

    const duration = BASE_DURATION / (speed > 0 ? speed : 1);
    const now = Date.now() / 1000;
    const newOnes: ActiveDanmaku[] = fresh.map((d) => {
      let lane = 0;
      for (let i = 1; i < laneCount; i++) {
        if (laneFreeAt.current[i] < laneFreeAt.current[lane]) lane = i;
      }
      const laneDelay = Math.max(0, (laneFreeAt.current[lane] - now) * 1000);
      laneFreeAt.current[lane] = now + (laneDelay + duration + SAFE_GAP) / 1000;

      const anim = new Animated.Value(0);
      Animated.sequence([
        Animated.delay(laneDelay),
        Animated.timing(anim, { toValue: 1, duration, easing: (t) => t, useNativeDriver: true }),
      ]).start(() => {
        setActive((prev) => prev.filter((a) => a.anim !== anim));
      });
      return { key: `L${counter.current++}`, text: d.text, lane, anim };
    });
    setActive((prev) => [...prev, ...newOnes].slice(-MAX_ACTIVE));
  }, [liveItems, visible, enabled, laneCount, speed]);

  if (!visible || !enabled) return null;
  const opacity = opacityProp ?? sOpacity;

  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, { opacity, zIndex: 30, pointerEvents: 'none' }]}
      pointerEvents="none"
    >
      {active.map((a) => (
        <Bullet
          key={a.key}
          text={a.text}
          top={topOffset + a.lane * (fontSize + 10)}
          fontSize={fontSize}
          anim={a.anim}
          width={width}
        />
      ))}
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
