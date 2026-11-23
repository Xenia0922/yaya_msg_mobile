import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Image, ImageProps, StyleSheet, View } from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { USER_AGENT } from '../constants';
import { buildImageFallbackCandidates } from '../utils/imageThumb';

const POCKET_IMAGE_HEADERS = { 'User-Agent': USER_AGENT, Referer: 'https://h5.48.cn/' };
const DEFAULT_IMAGE_HEADERS = { 'User-Agent': USER_AGENT };

type NetworkImageProps = ImageProps & {
  fallback?: boolean;

  fallbackIcon?: string;

  thumbnail?: number;

  highResFallback?: number;
};

export function NetworkImage({
  fadeDuration,
  fallback = true,
  fallbackIcon,
  onError,
  style,
  thumbnail,
  highResFallback,
  ...rest
}: NetworkImageProps) {
  const [errored, setErrored] = useState(false);

  const [candidateIdx, setCandidateIdx] = useState(0);

  const rawUri =
    rest.source && typeof rest.source === 'object' && 'uri' in rest.source
      ? String((rest.source as any).uri || '').trim()
      : undefined;

  const candidates = useMemo(
    () =>
      rawUri
        ? buildImageFallbackCandidates(rawUri, {
            thumbnail,
            highResWidth: highResFallback,
          })
        : [],
    [rawUri, thumbnail, highResFallback],
  );

  const active = candidates[candidateIdx] || candidates[0];
  const existingHeaders =
    rest.source && typeof rest.source === 'object' && 'headers' in rest.source
      ? ((rest.source as any).headers as Record<string, string> | undefined)
      : undefined;

  const source = useMemo(() => {
    if (!active) return rest.source;
    const baseSource =
      rest.source && typeof rest.source === 'object' ? (rest.source as Record<string, any>) : {};
    const { headers: _unusedHeaders, ...otherFields } = baseSource;
    const baseHeaders =
      active.headerMode === 'pocket'
        ? POCKET_IMAGE_HEADERS
        : active.headerMode === 'ua'
          ? DEFAULT_IMAGE_HEADERS
          : undefined;
    const mergedHeaders =
      baseHeaders || existingHeaders ? { ...baseHeaders, ...existingHeaders } : undefined;
    return mergedHeaders
      ? { ...otherFields, uri: active.uri, headers: mergedHeaders }
      : { ...otherFields, uri: active.uri };
  }, [active, rest.source, existingHeaders]);

  const handleError = useCallback(
    (e: any) => {
      if (candidateIdx + 1 < candidates.length) {
        setCandidateIdx((idx) => idx + 1);
        return;
      }
      if (onError) onError(e);
      if (fallback) setErrored(true);
    },
    [candidateIdx, candidates.length, fallback, onError],
  );

  useEffect(() => {
    setErrored(false);
    setCandidateIdx(0);
  }, [rawUri, thumbnail, highResFallback]);

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
      key={active ? `${active.uri}#${candidateIdx}` : String((source as any)?.uri || '')}
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
