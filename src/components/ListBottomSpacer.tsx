import React from 'react';
import { View } from 'react-native';
import { useDockInset } from '../hooks/useDockInset';

/** 列表底部占位：防止最后一行被悬浮 Dock / 迷你播放条遮挡。Stack 页传 hasDock={false} */
export function ListBottomSpacer({
  base = 24,
  hasDock = true,
}: {
  base?: number;
  hasDock?: boolean;
}) {
  const height = useDockInset(base, hasDock);
  return <View style={{ height }} />;
}
