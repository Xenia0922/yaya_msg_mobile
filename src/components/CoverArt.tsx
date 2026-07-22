import React from 'react';
import { Image, StyleSheet, View } from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';

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
  const [errored, setErrored] = React.useState(false);
  // 关键修复：uri 变化（FlatList 回收单元格复用本组件实例去显示另一首歌）时，
  // 必须重置 errored。否则上一首封面加载失败的 errored=true 会被带到本该有封面的
  // 新歌上，导致它错误地显示成「无封面」。现象即「每首歌都白过 + 播过的歌返回后变白」。
  React.useEffect(() => { setErrored(false); }, [uri]);
  const boxStyle: any = fill
    ? { width: '100%', height: '100%', borderRadius: round ? 999 : 0 }
    : { width: size, height: size, borderRadius: round ? (size || 0) / 2 : 0 };
  const showImage = !!uri && !errored;
  const iconSize = fill ? 44 : Math.round((size || 0) * 0.34);

  // 有封面图 → 只显示图片，绝不叠加任何文字（修复「歌名首字压在封面上」的叠字问题）。
  // 无封面 / 加载失败 → 显示确定性渐变 + 居中音符图标兜底，干净、不空白、不叠字。
  return (
    <View style={[styles.box, boxStyle, { backgroundColor: c1 }]}>
      <View style={[styles.overlay, { backgroundColor: c2, opacity: 0.5, transform: [{ rotate: '35deg' }] }]} />
      {showImage ? (
        <Image
          source={{ uri }}
          style={[StyleSheet.absoluteFill, { borderRadius: round ? 999 : 0 }]}
          resizeMode="cover"
          // scale：保留原图分辨率由 GPU 缩放，比 resize 预解码缩放更锐利（修复封面发糊）
          resizeMethod="scale"
          fadeDuration={0}
          onError={() => setErrored(true)}
        />
      ) : (
        <MaterialCommunityIcons name="music" size={iconSize} color="rgba(255,255,255,0.92)" />
      )}
      {active ? <View style={[styles.activeDot, { backgroundColor: '#fff' }]} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  overlay: { position: 'absolute', left: '-30%', top: '-30%', width: '160%', height: '160%' },
  activeDot: { position: 'absolute', right: 6, bottom: 6, width: 10, height: 10, borderRadius: 5 },
});
