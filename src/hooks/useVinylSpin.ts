import { useEffect, useState } from 'react';
import { Animated, AppState, Easing } from 'react-native';

// 模块级单例：跨组件卸载/重挂持久存在，使唱片旋转有「记忆」——
// 离开详情页再回来时从当前角度无缝续转，而非重头(0°)。
// 仅当 trackId 真正变化（切歌）时才归零；重进页面（trackId 不变）不重置。
export const vinylSpin = new Animated.Value(0);

const ROTATION_MS = 12000;
let spinAnim: Animated.CompositeAnimation | null = null;
let spinningTrackId: string | null = null;
let currentSpinValue = 0;
let spinListenerId: string | null = null;

function ensureSpinListener() {
  if (spinListenerId) return;
  spinListenerId = vinylSpin.addListener(({ value }) => {
    currentSpinValue = value;
  });
}

function startLoop() {
  if (spinAnim) return;
  ensureSpinListener();
  // 依据当前角度推算本圈剩余距离与时长，避免暂停/恢复多次导致角速度倍增。
  const frac = currentSpinValue - Math.floor(currentSpinValue);
  const remaining = frac > 0.001 && frac < 0.999 ? 1 - frac : 1;
  const target = currentSpinValue + remaining;
  const duration = Math.max(100, Math.round(remaining * ROTATION_MS));
  const tick = Animated.timing(vinylSpin, {
    toValue: target,
    duration,
    easing: Easing.linear,
    useNativeDriver: true,
  });
  spinAnim = tick;
  tick.start(({ finished }) => {
    spinAnim = null;
    if (finished) {
      currentSpinValue = target;
      startLoop();
    }
  });
}

function stopLoop() {
  if (spinAnim) {
    spinAnim.stop();
    spinAnim = null;
  }
}

export function useVinylSpin(trackId: string | undefined, isPlaying: boolean): Animated.Value {
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      setAppActive(next === 'active');
    });
    return () => sub.remove();
  }, []);

  // 切歌：归零并从顶部起转（保留语义；重进详情页时 trackId 不变故不归零）
  useEffect(() => {
    if (trackId && trackId !== spinningTrackId) {
      stopLoop();
      vinylSpin.setValue(0);
      currentSpinValue = 0;
      spinningTrackId = trackId;
    }
  }, [trackId]);

  // 播放且在前台：驱动旋转；暂停或切后台：冻结在当前角度（省电）。
  useEffect(() => {
    if (isPlaying && appActive) startLoop();
    else stopLoop();
  }, [isPlaying, appActive]);

  return vinylSpin;
}
