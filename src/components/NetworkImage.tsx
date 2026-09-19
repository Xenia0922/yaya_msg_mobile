import React, { useCallback, useState } from 'react';
import { Image, ImageProps, Platform, StyleSheet, View } from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { thumbUrl } from '../utils/imageThumb';

type NetworkImageProps = ImageProps & {
  /** 加载失败时是否显示回退占位（浅灰底 + 可选图标），默认开启（D4 修复：source.48.cn 偶发拒绝不再留白块） */
  fallback?: boolean;
  /** 回退占位图标（MaterialCommunityIcons 名）；不传则不显示图标只显示浅灰底 */
  fallbackIcon?: string;
  /**
   * 缩略图盒子的边长（px）。列表/头像类小图传它可显著省流量、加快加载。
   * 走 48 图床的 `source1.48.cn/resize_NxN/<path>`（等比 contain），
   * 实测封面 783KB → 13KB 量级；非 48 图床 / gif / 音视频自动原样返回。
   * 不传则用原图 URL（详情页/大图场景）。
   */
  thumbnail?: number;
};

/**
 * 网络图片封装。
 * - 统一淡入行为与安卓解码淡入时长；作为集中替换与未来升级到更优缓存组件的单一入口；
 * - D4：内置失败回退——`source.48.cn` 移动端偶发被拒时，显示浅灰底 + 可选图标，杜绝空白块/破图；
 *   外部 onError 仍会被调用（原有调用方逻辑不受影响）；
 * - 缩略图**两段式兜底**：先请求 resize 缩略图；若该路径在缩略图端点不可用，
 *   自动退回**原图**再试一次，只有原图也失败才走占位 —— 保证「省流量」绝不牺牲「能看图」。
 */
export function NetworkImage({ fadeDuration, fallback = true, fallbackIcon, onError, style, thumbnail, ...rest }: NetworkImageProps) {
  const [errored, setErrored] = useState(false);
  /** 缩略图失败过一次 → 本次改用原图 */
  const [useOriginal, setUseOriginal] = useState(false);
  // uri 变化时重置失败态（FlatList 复用实例时不串台）
  const uri = rest.source && typeof rest.source === 'object' && 'uri' in rest.source ? (rest.source as any).uri : undefined;
  // 缩略图：仅当显式传 thumbnail 且是 48 图床图片时改写 URL（失败/不支持时 thumbUrl 原样返回）
  const thumbUri = thumbnail && uri ? thumbUrl(uri, thumbnail) : '';
  /** 是否真的换成了另一条 URL（原样返回 / gif / 非 48 图床都为 false） */
  const thumbed = !!thumbUri && thumbUri !== uri;
  const source = uri ? { ...(rest.source as any), uri: thumbed && !useOriginal ? thumbUri : uri } : rest.source;

  const handleError = useCallback(
    (e: any) => {
      // 缩略图失败：先退回原图（不惊动调用方的失败逻辑 —— 这是可恢复的一步）
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
          <MaterialCommunityIcons name={fallbackIcon as any} size={20} color="rgba(128,128,128,0.4)" />
        ) : null}
      </View>
    );
  }
  return (
    <Image
      {...rest}
      source={source}
      style={style}
      fadeDuration={fadeDuration ?? (Platform.OS === 'android' ? 200 : 0)}
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
