/**
 * PageBackdrop · 全局页面底衬
 *
 * 液态玻璃的前提是「玻璃后面有东西可透」——纯灰底上任何半透明材质都看不出来。
 * 这里用大半径低饱和色斑（tint 粉 / 紫 / 蜜桃）铺出柔和色彩变化，
 * 让全 app 的半透明玻璃卡真正"透"出底下的颜色（Apple 材质原则 §12）。
 * 自定义背景图模式下不渲染（让位给背景图）。
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { usePalette } from '../theme';

export function PageBackdrop() {
  const palette = usePalette();
  const dark = palette.name === 'dark';

  // 明显但柔和的斜向多彩渐变：玻璃叠上去才「透」得出颜色
  const gradient: [string, string, string] = dark
    ? ['#151322', '#101a2b', '#1c1220']
    : ['#F1E6FF', '#E6EFFF', '#FFF0E4'];

  // 液态玻璃折射需要「高频细节」——单纯大色斑折射不出来。
  // 这里叠 6 个中等尺寸色斑 + 一层细网格纹理（提供边缘密度）。
  const blobs = dark
    ? [
        { color: 'rgba(150,100,190,0.34)', size: 520, top: -160, left: -140 },
        { color: 'rgba(80,120,200,0.28)', size: 560, top: 200, right: -180 },
        { color: 'rgba(200,90,120,0.24)', size: 460, bottom: -180, left: 40 },
        { color: 'rgba(120,160,220,0.22)', size: 260, top: 120, left: 60 },
        { color: 'rgba(180,120,200,0.20)', size: 220, top: 520, right: 30 },
        { color: 'rgba(90,140,190,0.18)', size: 240, bottom: 120, right: 80 },
      ]
    : [
        { color: 'rgba(255,120,165,0.42)', size: 520, top: -160, left: -140 },
        { color: 'rgba(120,150,255,0.36)', size: 560, top: 200, right: -180 },
        { color: 'rgba(255,175,110,0.32)', size: 460, bottom: -180, left: 40 },
        { color: 'rgba(150,190,255,0.30)', size: 260, top: 120, left: 60 },
        { color: 'rgba(255,150,200,0.28)', size: 220, top: 520, right: 30 },
        { color: 'rgba(180,160,255,0.26)', size: 240, bottom: 120, right: 80 },
      ];

  // 高频纹理：细网格线（每个 cell 24px），为玻璃边缘折射提供密度
  const GRID = 24;

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <LinearGradient
        colors={gradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <View style={[StyleSheet.absoluteFill, { flexDirection: 'row', flexWrap: 'wrap', opacity: dark ? 0.5 : 0.55 }]}>
        {Array.from({ length: Math.ceil(2400 / GRID) }).map((_, i) => (
          <View
            key={i}
            style={{
              width: GRID,
              height: GRID,
              borderRightWidth: StyleSheet.hairlineWidth,
              borderBottomWidth: StyleSheet.hairlineWidth,
              borderColor: dark ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.35)',
            }}
          />
        ))}
      </View>
      {blobs.map((b, i) => (
        <View
          key={i}
          style={{
            position: 'absolute',
            borderRadius: 9999,
            backgroundColor: b.color,
            width: b.size,
            height: b.size,
            top: b.top,
            left: b.left,
            right: b.right,
            bottom: b.bottom,
          }}
        />
      ))}
    </View>
  );
}
