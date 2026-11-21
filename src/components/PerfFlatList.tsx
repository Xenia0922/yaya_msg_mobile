import React, { forwardRef } from 'react';
import { FlatList, FlatListProps } from 'react-native';

const PERF_DEFAULTS = {
  initialNumToRender: 7,
  maxToRenderPerBatch: 6,
  updateCellsBatchingPeriod: 40,
  windowSize: 11,

  removeClippedSubviews: false,
  showsVerticalScrollIndicator: false,
};

function PerfFlatListInner<T>(props: FlatListProps<T>, ref: React.ForwardedRef<FlatList<T>>) {
  return <FlatList ref={ref} {...PERF_DEFAULTS} {...props} />;
}

export const PerfFlatList = forwardRef(PerfFlatListInner) as <T>(
  props: FlatListProps<T> & { ref?: React.Ref<FlatList<T>> },
) => React.ReactElement;

export default PerfFlatList;
