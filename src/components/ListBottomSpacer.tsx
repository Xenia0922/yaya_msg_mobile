import React from 'react';
import { View } from 'react-native';
import { useDockInset } from '../hooks/useDockInset';

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
