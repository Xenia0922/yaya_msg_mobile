import React, { useCallback, useState } from 'react';
import { Image, ImageProps, StyleSheet, View } from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { normalizeImageHost, thumbUrl } from '../utils/imageThumb';

type NetworkImageProps = ImageProps & {
  fallback?: boolean;

  fallbackIcon?: string;

  thumbnail?: number;
};

export function NetworkImage({
  fadeDuration,
  fallback = true,
  fallbackIcon,
  onError,
  style,
  thumbnail,
  ...rest
}: NetworkImageProps) {
  const [errored, setErrored] = useState(false);

  const [useOriginal, setUseOriginal] = useState(false);

  const rawUri =
    rest.source && typeof rest.source === 'object' && 'uri' in rest.source
      ? (rest.source as any).uri
      : undefined;
  const uri = rawUri ? normalizeImageHost(rawUri) : undefined;

  const thumbUri = thumbnail && uri ? thumbUrl(uri, thumbnail) : '';

  const thumbed = !!thumbUri && thumbUri !== uri;
  const source = uri
    ? { ...(rest.source as any), uri: thumbed && !useOriginal ? thumbUri : uri }
    : rest.source;

  const handleError = useCallback(
    (e: any) => {
      if (thumbed && !useOriginal) {
        setUseOriginal(true);
        return;
      }
      if (onError) onError(e);
      if (fallback) setErrored(true);
    },
    [thumbed, useOriginal, fallback, onError],
  );

  React.useEffect(() => {
    setErrored(false);
    setUseOriginal(false);
  }, [uri]);

  if (errored) {
    return (
      <View style={[styles.fallbackBox, style as any]}>
        {fallbackIcon ? (
          <MaterialCommunityIcons
            name={fallbackIcon as any}
            size={20}
            color="rgba(128,128,128,0.4)"
          />
        ) : null}
      </View>
    );
  }
  return (
    <Image
      {...rest}

      key={String((source as any)?.uri || '')}
      source={source}
      style={style}
      fadeDuration={fadeDuration ?? 0}
      onError={handleError}
    />
  );
}

const styles = StyleSheet.create({
  fallbackBox: {
    backgroundColor: 'rgba(128,128,128,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default NetworkImage;
