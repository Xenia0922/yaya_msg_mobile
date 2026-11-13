/**
 * PageBackdrop · 全局页面底衬（液态玻璃的「透光来源」）
 *
 * ⚠️ 为什么不用 LinearGradient（实机踩坑）：
 * 液态玻璃的原生实现要把「玻璃背后的内容」抓成位图当 backdrop（逐帧软件重绘）。
 * `expo-linear-gradient` 是硬件绘制的原生视图，**拒绝软件绘制** → 抓取失败 →
 * 玻璃采样到透明/黑，浅色主题下整块玻璃就读成中性灰（库文档里的 BACKDROP_CAPTURE_FAILED）。
 *
 * 所以底衬改用**纯 View + 实心 backgroundColor 叠成的平滑多段渐变**：
 *  - 普通 View 可以被正常软件重绘 → 玻璃能采到真实颜色，浅色下不再发灰
 *  - 段数足够多（48 段）+ 相邻色差 <1 个色阶 → 肉眼无banding，折射也不会在接缝处露馅
 *  - 整体旋转 -20°，保留原来「对角渐变」的观感
 *
 * 设计约束（来自更早的实机反馈）：背景必须均匀平滑，离散色斑会让玻璃卡斑驳、
 * 底栏透色浑浊、色块交界出现「隐形缝隙」。
 * 自定义背景图模式下不渲染（让位给背景图）。
 */
import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { usePalette } from '../theme';

const DARK_STOPS: [string, string, string] = ['#1a1526', '#131a2b', '#231522'];
const LIGHT_STOPS: [string, string, string] = ['#FFEDF4', '#F3EBFF', '#E8F0FF'];

/** 段数：够密才不会看出 banding（相邻色差 < 1 个色阶） */
const BANDS = 48;

function mixHex(a: string, b: string, t: number): string {
  const ca = [1, 3, 5].map((i) => parseInt(a.substr(i, 2), 16));
  const cb = [1, 3, 5].map((i) => parseInt(b.substr(i, 2), 16));
  const out = ca.map((v, i) => Math.round(v + (cb[i] - v) * t));
  return '#' + out.map((v) => v.toString(16).padStart(2, '0')).join('');
}

export function PageBackdrop() {
  const palette = usePalette();
  const dark = palette.name === 'dark';
  const stops = dark ? DARK_STOPS : LIGHT_STOPS;

  const bands = useMemo(() => {
    const list: string[] = [];
    for (let i = 0; i < BANDS; i++) {
      const t = i / (BANDS - 1); // 0..1
      const seg = t < 0.5 ? 0 : 1;
      const lt = t < 0.5 ? t * 2 : (t - 0.5) * 2;
      list.push(mixHex(stops[seg], stops[seg + 1], lt));
    }
    return list;
  }, [dark]);

  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: stops[0] }]}>
      <View style={styles.canvas}>
        {bands.map((c, i) => (
          <View key={i} style={{ flex: 1, backgroundColor: c }} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // 放大到屏幕外 + 旋转，让条带呈对角走向（避免旋转后露边）
  canvas: {
    position: 'absolute',
    left: '-40%',
    right: '-40%',
    top: '-40%',
    bottom: '-40%',
    transform: [{ rotate: '-20deg' }],
  },
});
