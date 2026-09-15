/**
 * Android 上 expo-blur 的模糊必须绑定一个 BlurTargetView（真背板模糊的来源）。
 * 没配的话 BlurView 会静默回退到 "none"（等于没有模糊，只剩白纱 —— 就是之前"又白又平"的原因）。
 *
 * 用法：根节点包一层 <BlurTargetProvider>，玻璃组件从 context 取 ref 传给 BlurView。
 */
import React, { createContext, useContext, useRef } from 'react';
import { type View } from 'react-native';
import { BlurTargetView } from 'expo-blur';

const BlurTargetContext = createContext<React.RefObject<View | null> | null>(null);

/** 取模糊背板的 ref（未包 Provider 时返回 null → BlurView 走 iOS/降级路径） */
export function useBlurTarget(): React.RefObject<View | null> | null {
  return useContext(BlurTargetContext);
}

export function BlurTargetProvider({ children }: { children: React.ReactNode }) {
  const ref = useRef<View | null>(null);
  return (
    <BlurTargetContext.Provider value={ref}>
      <BlurTargetView ref={ref} style={{ flex: 1 }}>
        {children}
      </BlurTargetView>
    </BlurTargetContext.Provider>
  );
}
