import React, { createContext, useContext, useRef } from 'react';
import { StyleSheet, type View, type StyleProp, type ViewStyle } from 'react-native';
import { BlurTargetView } from 'expo-blur';

export const GLASS_BACKDROP_ID = 'glass-backdrop-surface';

interface Ctx {
  ref: React.RefObject<View | null>;
}
const BlurTargetContext = createContext<Ctx | null>(null);

export function useBlurTarget(): React.RefObject<View | null> | null {
  return useContext(BlurTargetContext)?.ref ?? null;
}

export function BlurTargetProvider({ children }: { children: React.ReactNode }) {
  const ref = useRef<View | null>(null);
  return <BlurTargetContext.Provider value={{ ref }}>{children}</BlurTargetContext.Provider>;
}

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

      nativeID={GLASS_BACKDROP_ID}
      style={[StyleSheet.absoluteFill, style]}
      pointerEvents="none"
    >
      {children}
    </BlurTargetView>
  );
}
