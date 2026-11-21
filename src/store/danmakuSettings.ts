import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type DanmakuArea = 'top' | 'half' | 'full';

export interface DanmakuSettings {
  enabled: boolean;

  opacity: number;

  speed: number;

  area: DanmakuArea;

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
      version: 3,
      storage: createJSONStorage(() => AsyncStorage),

      migrate: (persisted: any) => ({
        ...(persisted || {}),
        fontSize: Number(persisted?.fontSize) === 16 ? 15 : persisted?.fontSize,
      }),
    },
  ),
);
