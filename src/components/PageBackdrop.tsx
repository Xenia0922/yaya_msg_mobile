/**
 * PageBackdrop · 全局页面底衬（液态玻璃的「透光来源」）
 *
 * 设计约束（来自实机反馈）：
 *  - 背景必须是【均匀平滑的渐变】：离散色斑会让不同位置的玻璃卡底色深浅不一（斑驳）、
 *    让半透明底栏透色浑浊发灰、在色块交界处形成「隐形缝隙」断层
 *  - 保留柔和的多色过渡（玻璃折射仍需要色彩变化），但过渡必须平滑连续
 * 自定义背景图模式下不渲染（让位给背景图）。
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { usePalette } from '../theme';

export function PageBackdrop() {
  const palette = usePalette();
  const dark = palette.name === 'dark';

  // 单一对角渐变：粉 → 紫 → 蓝，平滑无突变
  const gradient: [string, string, string] = dark
    ? ['#1a1526', '#131a2b', '#231522']
    : ['#FFEDF4', '#F3EBFF', '#E8F0FF'];

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <LinearGradient
        colors={gradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}
