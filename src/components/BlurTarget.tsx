/**
 * Android 上 expo-blur 的真模糊必须绑定一个 BlurTargetView（背板来源）。
 * 没配的话 BlurView 会静默回退 "none"（等于没有模糊，只剩白纱 —— 就是"又白又平"的原因）。
 *
 * 关键约束：**BlurTargetView 里不能包含任何 BlurView**（否则 RenderNode 互相嵌套，
 * RenderThread 里 prepareTreeImpl 递归爆栈 → SIGSEGV，实测）。
 * 而 React context 只能向下传、屏幕里的玻璃又必须读到 ref，所以拆成两个：
 *   <BlurTargetProvider>  只提供 ref（包整个应用，屏幕能读到）
 *     <BlurTargetSurface> 真正挂 BlurTargetView（只包背景层）
 *     其余内容（屏幕/玻璃都在这里，但在 Surface 之外）
 *   </BlurTargetProvider>
 */
import React, { createContext, useContext, useRef } from 'react';
import { StyleSheet, type View, type StyleProp, type ViewStyle } from 'react-native';
import { BlurTargetView } from 'expo-blur';

/** 背景层 id：原生 AGSL 只录这一层（避免录到页面里的 BlurView → RenderNode 嵌套爆栈） */
export const GLASS_BACKDROP_ID = 'glass-backdrop-surface';

interface Ctx {
  ref: React.RefObject<View | null>;
}
const BlurTargetContext = createContext<Ctx | null>(null);

/** 取背景背板 ref（未包 Provider 时返回 null → BlurView 走降级路径） */
export function useBlurTarget(): React.RefObject<View | null> | null {
  return useContext(BlurTargetContext)?.ref ?? null;
}

export function BlurTargetProvider({ children }: { children: React.ReactNode }) {
  const ref = useRef<View | null>(null);
  return <BlurTargetContext.Provider value={{ ref }}>{children}</BlurTargetContext.Provider>;
}

/** 只包背景层；内部不要放任何 BlurView */
export function BlurTargetSurface({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const ctx = useContext(BlurTargetContext);
  if (!ctx) return <>{children}</>;
  return (
    <BlurTargetView
      ref={ctx.ref}
      // nativeID → Android View tag：原生 AGSL 视图用它找到「只该录制的那一层背景」
      nativeID={GLASS_BACKDROP_ID}
      style={[StyleSheet.absoluteFill, style]}
      pointerEvents="none"
    >
      {children}
    </BlurTargetView>
  );
}
