import React from 'react';
import { Image, ImageProps, Platform } from 'react-native';

/**
 * 网络图片封装。
 * 统一淡入行为与安卓解码淡入时长；在不引入 expo-image 的前提下，
 * 为集中替换与未来升级到更优缓存组件提供单一入口。
 */
export function NetworkImage(props: ImageProps) {
  const { fadeDuration, ...rest } = props;
  return (
    <Image
      {...rest}
      fadeDuration={fadeDuration ?? (Platform.OS === 'android' ? 200 : 0)}
    />
  );
}

export default NetworkImage;
