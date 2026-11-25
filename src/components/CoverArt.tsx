import React from 'react';
import { StyleSheet, View } from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import NetworkImage from './NetworkImage';
import { radii } from '../theme';

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
  size?: number;
  fill?: boolean;
  round?: boolean;
  borderRadius?: number;
  thumbnail?: number;
  active?: boolean;
}

export default React.memo(function CoverArt({
  uri,
  title,
  size,
  fill,
  round,
  borderRadius,
  thumbnail,
  active,
}: Props) {
  const [c1, c2] = PALETTE[hashStr(title || '♪') % PALETTE.length];
  const [errored, setErrored] = React.useState(false);
  const retried = React.useRef(false);
  const mounted = React.useRef(true);
  const retryTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    };
  }, []);

  React.useEffect(() => {
    setErrored(false);
    retried.current = false;
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, [uri]);

  const handleImageError = React.useCallback(() => {
    if (!retried.current) {
      retried.current = true;
      if (mounted.current) setErrored(true);
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      retryTimerRef.current = setTimeout(() => {
        retryTimerRef.current = null;
        if (mounted.current) setErrored(false);
      }, 2500);
    } else {
      if (mounted.current) setErrored(true);
    }
  }, []);

  const computedRadius = fill
    ? round
      ? radii.pill
      : (borderRadius ?? 0)
    : round
      ? (size || 0) / 2
      : (borderRadius ?? 0);

  const boxStyle: any = fill
    ? { ...StyleSheet.absoluteFillObject, borderRadius: computedRadius }
    : { width: size, height: size, borderRadius: computedRadius };
  const showImage = !!uri && !errored;
  const imageSource = React.useMemo(() => (uri ? { uri } : undefined), [uri]);
  const iconSize = fill ? 44 : Math.round((size || 0) * 0.34);
  const resolvedThumb =
    thumbnail ?? (!fill && size ? Math.min(360, Math.max(120, Math.round(size * 2))) : undefined);

  return (
    <View style={[styles.box, boxStyle, { backgroundColor: c1 }]}>
      <View
        style={[
          styles.overlay,
          { backgroundColor: c2, opacity: 0.5, transform: [{ rotate: '35deg' }] },
        ]}
      />
      <MaterialCommunityIcons
        name="music"
        size={iconSize}
        color="rgba(255,255,255,0.95)"
        style={{
          textShadowColor: 'rgba(0,0,0,0.38)',
          textShadowOffset: { width: 0, height: 1 },
          textShadowRadius: 3,
        }}
      />
      {showImage && imageSource ? (
        <NetworkImage
          source={imageSource}
          style={[StyleSheet.absoluteFill, { borderRadius: computedRadius }]}
          resizeMode="cover"
          thumbnail={resolvedThumb}
          fadeDuration={0}
          fallback={false}
          onError={handleImageError}
        />
      ) : null}
      {active ? <View style={[styles.activeDot, { backgroundColor: '#fff' }]} /> : null}
    </View>
  );
});

const styles = StyleSheet.create({
  box: { overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  overlay: { position: 'absolute', left: '-30%', top: '-30%', width: '160%', height: '160%' },
  activeDot: { position: 'absolute', right: 6, bottom: 6, width: 10, height: 10, borderRadius: 5 },
});
