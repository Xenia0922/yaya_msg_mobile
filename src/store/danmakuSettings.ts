import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type DanmakuArea = 'top' | 'half' | 'full';

export interface DanmakuSettings {
  /** 弹幕总开关 */
  enabled: boolean;
  /** 不透明度 0.2 ~ 1 */
  opacity: number;
  /** 速度倍率：1=正常，2=2倍快，0.5=半速 */
  speed: number;
  /** 显示区域：顶部 / 半屏 / 全屏 */
  area: DanmakuArea;
  /** 字号 12 ~ 24 */
  fontSize: number;
  set: (p: Partial<DanmakuSettings>) => void;
  reset: () => void;
}

const DEFAULT: Omit<DanmakuSettings, 'set' | 'reset'> = {
  enabled: true,
  opacity: 0.9,
  speed: 1,
  area: 'full',
  fontSize: 15,
};

export const useDanmakuSettings = create<DanmakuSettings>()(
  persist(
    (set) => ({
      ...DEFAULT,
      set: (p) => set(p),
      reset: () => set(DEFAULT),
    }),
    {
      name: 'yaya_danmaku_settings_v1',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
