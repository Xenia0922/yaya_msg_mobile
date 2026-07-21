import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

// 口袋48官网源的音乐对象只有 mp3/artist/title，没有封面图。
// 这里用「歌名哈希 -> 固定调色板」生成确定性渐变封面（每首歌配色稳定），
// 叠加一个旋转半透明层模拟斜向渐变 + 装饰环 + 首字，避免空占位符的廉价感。
const PALETTE: [string, string][] = [
  ['#ff9a9e', '#fecfef'],
  ['#a18cd1', '#fbc2eb'],
  ['#84fab0', '#8fd3f4'],
  ['#ffecd2', '#fcb69f'],
  ['#f6d365', '#fda085'],
  ['#5ee7df', '#b490ca'],
  ['#d299c2', '#fef9d7'],
  ['#f093fb', '#f5576c'],
  ['#4facfe', '#00f2fe'],
  ['#43e97b', '#38f9d7'],
  ['#fa709a', '#fee140'],
  ['#30cfd0', '#330867'],
];

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

interface Props {
  uri?: string;
  title: string;
  /** 固定尺寸（黑胶/迷你栏用）；列表用 fill 撑满父容器 */
  size?: number;
  /** 撑满父容器（列表方格） */
  fill?: boolean;
  /** 圆形（黑胶/迷你栏） */
  round?: boolean;
  /** 当前播放中：右上角高亮点 */
  active?: boolean;
}

export default function CoverArt({ uri, title, size, fill, round, active }: Props) {
  const [c1, c2] = PALETTE[hashStr(title || '♪') % PALETTE.length];
  const boxStyle: any = fill
    ? { width: '100%', height: '100%', borderRadius: round ? 999 : 0 }
    : { width: size, height: size, borderRadius: round ? (size || 0) / 2 : 0 };
  const inner = (fill ? 0 : size || 0) * 0.42 || 64;
  const initial = (title || '♪').replace(/\s/g, '').charAt(0) || '♪';

  if (uri) {
    return <Image source={{ uri }} style={boxStyle} />;
  }

  return (
    <View style={[styles.box, boxStyle, { backgroundColor: c1 }]}>
      <View style={[styles.overlay, { backgroundColor: c2, opacity: 0.55, transform: [{ rotate: '35deg' }] }]} />
      {!fill ? (
        <View style={[styles.ring, { width: inner, height: inner, borderRadius: inner / 2, borderColor: 'rgba(255,255,255,0.85)' }]} />
      ) : null}
      <Text
        style={[
          styles.initial,
          {
            color: '#fff',
            fontSize: fill ? 0 : (size || 0) * 0.3,
            textShadowColor: 'rgba(0,0,0,0.18)',
            textShadowOffset: { width: 0, height: 1 },
            textShadowRadius: 2,
          },
        ]}
      >
        {initial}
      </Text>
      {active ? <View style={[styles.activeDot, { backgroundColor: '#fff' }]} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  overlay: { position: 'absolute', left: '-30%', top: '-30%', width: '160%', height: '160%' },
  ring: { position: 'absolute', borderWidth: 1.5 },
  initial: { fontWeight: '800' },
  activeDot: { position: 'absolute', right: 6, bottom: 6, width: 10, height: 10, borderRadius: 5 },
});
