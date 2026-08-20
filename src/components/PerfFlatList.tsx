import React, { forwardRef } from 'react';
import { FlatList, FlatListProps, Platform } from 'react-native';

/**
 * 性能化虚拟列表封装。
 * 内建 RN 长列表推荐的性能默认值，避免每个屏幕重复配置，
 * 同时允许调用方通过 props 覆盖任意默认值。
 *
 * 适用：渲染来自网络/本地数组的较长列表（房间、消息、相册、翻牌、排名等）。
 * 提示：若列表项等高，建议在调用处补充 getItemLayout 以获得最佳滚动性能。
 */
const PERF_DEFAULTS = {
  initialNumToRender: 8,
  maxToRenderPerBatch: 8,
  updateCellsBatchingPeriod: 50,
  windowSize: 16,
  removeClippedSubviews: Platform.OS === 'android',
  showsVerticalScrollIndicator: false,
};

function PerfFlatListInner<T>(props: FlatListProps<T>, ref: React.ForwardedRef<FlatList<T>>) {
  return <FlatList ref={ref} {...PERF_DEFAULTS} {...props} />;
}

// forwardRef + 泛型转发，使 <PerfFlatList ref={...} /> 像原生 FlatList 一样可用。
export const PerfFlatList = forwardRef(PerfFlatListInner) as <T>(
  props: FlatListProps<T> & { ref?: React.Ref<FlatList<T>> },
) => React.ReactElement;

export default PerfFlatList;
