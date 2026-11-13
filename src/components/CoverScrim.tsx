import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

/**
 * 封面底部渐变蒙层（提升封面文字可读性）。
 *
 * 问题：直播/公演卡片在浅色封面上直接叠白字，几乎不可读（用户截图「音乐电台」猫图）。
 * 做法：在封面底部叠一层 40% 高度的黑色渐变（透明 → 0.72），文字始终压在这层上。
 * 注意：这是**纯视觉层**，不改变封面比例（用户要求保持原始比例）。
 */
export function CoverScrim({ style, heightRatio = 0.42 }: { style?: StyleProp<ViewStyle>; heightRatio?: number }) {
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, style]}>
      <LinearGradient
        colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.28)', 'rgba(0,0,0,0.72)']}
        locations={[0, 0.55, 1]}
        style={[styles.gradient, { height: `${Math.round(heightRatio * 100)}%` }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  gradient: { position: 'absolute', left: 0, right: 0, bottom: 0 },
});
