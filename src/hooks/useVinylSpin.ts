import { useEffect } from 'react';
import { Animated, Easing } from 'react-native';

// 模块级单例：跨组件卸载/重挂持久存在，使唱片旋转有「记忆」——
// 离开详情页再回来时从当前角度无缝续转，而非重头(0°)。
// 仅当 trackId 真正变化（切歌）时才归零；重进页面（trackId 不变）不重置。
export const vinylSpin = new Animated.Value(0);

let spinLoop: Animated.CompositeAnimation | null = null;
let spinningTrackId: string | null = null;

function startLoop() {
  if (spinLoop) return;
  // 从当前角度继续，不跳变（暂停/重进后接着转）
  vinylSpin.stopAnimation();
  spinLoop = Animated.loop(
    Animated.timing(vinylSpin, {
      toValue: 1,
      duration: 12000,
      easing: Easing.linear,
      useNativeDriver: true,
    })
  );
  spinLoop.start();
}

function stopLoop() {
  if (spinLoop) {
    spinLoop.stop();
    spinLoop = null;
  }
}

export function useVinylSpin(trackId: string | undefined, isPlaying: boolean): Animated.Value {
  // 切歌：归零并从顶部起转（保留语义；重进详情页时 trackId 不变故不归零）
  useEffect(() => {
    if (trackId && trackId !== spinningTrackId) {
      vinylSpin.setValue(0);
      spinningTrackId = trackId;
    }
  }, [trackId]);

  // 播放：驱动旋转；暂停：冻结在当前角度。
  // 注意：不在此卸载 loop——否则切到详情页/返回时 loop 被停掉，记忆就断了。
  // loop 由全局唯一的单例持有，只要任一订阅者(isPlaying)在，它就转。
  useEffect(() => {
    if (isPlaying) startLoop();
    else stopLoop();
  }, [isPlaying]);

  return vinylSpin;
}
