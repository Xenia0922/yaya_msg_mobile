/**
 * v3.0 通用列表页引擎
 *
 * 22 个剩余页面里，80% 是「拉一次数据 + 渲染列表」。与其每页重复
 * loading / error / refresh / 分页 / 空态 / 底部避让，不如把它们统一到这一个组件。
 * 页面只提供：fetcher（怎么取数）+ toItems（怎么解成行）。
 *
 * 行模型固定五段：title / subtitle / value / avatar / cover。
 * 这样「左边缘、右数值、行高」全站天然一致 —— 这就是旧版最缺的东西。
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { PerfFlatList } from '../../components/PerfFlatList';
import { NetworkImage } from '../../components/NetworkImage';
import { usePalette } from '../../theme';

import { Screen, type AppBarAction } from './Screen';
import { EmptyHint, ListRow, gridCellWidth, GRID_GAP, GRID_RADIUS } from './primitives';
import { contentBottom, GUTTER, SPACE, TYPE } from '../tokens';

export type RowModel = {
  key: string;
  title: string;
  subtitle?: string;
  value?: string;
  valueHint?: string;
  avatar?: string;
  /** 网格模式下的封面 */
  cover?: string;
  highlight?: boolean;
  raw?: any;
};

type Props = {
  title: string;
  onBack?: () => void;
  actions?: AppBarAction[];
  toolbar?: React.ReactNode;
  /** 取数。返回原始响应，交给 toItems 解析 */
  fetcher: () => Promise<any>;
  toItems: (res: any) => RowModel[];
  /** 点行；网格模式点封面 */
  onPressItem?: (item: RowModel) => void;
  emptyTitle: string;
  emptyHint?: string;
  emptyIcon?: string;
  /** 网格列数（不传 = 列表） */
  columns?: number;
  /** 额外头部（如图例、说明），渲染在列表之上 */
  header?: React.ReactNode;
  /** 刷新按钮是否显示 */
  showRefresh?: boolean;
};

export function DataListPage({
  title, onBack, actions, toolbar, fetcher, toItems, onPressItem,
  emptyTitle, emptyHint, emptyIcon, columns, header, showRefresh = true,
}: Props) {
  const palette = usePalette();
  const [data, setData] = useState<RowModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    fetcher()
      .then((res) => { if (alive) setData(toItems(res)); })
      .catch((e: any) => { if (alive) setError(String(e?.message || e)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // fetcher/toItems 由页面保证稳定（用 useCallback / 模块级函数）
  }, [tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);

  const barActions: AppBarAction[] = useMemo(
    () => (showRefresh ? [{ icon: 'refresh', onPress: reload }, ...(actions || [])] : (actions || [])),
    [showRefresh, reload, actions],
  );

  const grid = !!columns;

  return (
    <Screen title={title} onBack={onBack} actions={barActions} toolbar={toolbar}>
      {header}
      {loading && data.length === 0 ? (
        <View style={styles.center}><ActivityIndicator color={palette.tint} /></View>
      ) : error ? (
        <EmptyHint icon="alert-circle-outline" title={emptyTitle} hint={error} />
      ) : data.length === 0 ? (
        <EmptyHint icon={emptyIcon || 'inbox-outline'} title={emptyTitle} hint={emptyHint} />
      ) : (
        <PerfFlatList
          data={data}
          numColumns={columns || 1}
          keyExtractor={(item: RowModel) => item.key}
          contentContainerStyle={grid ? styles.grid : { paddingBottom: contentBottom(false) }}
          columnWrapperStyle={grid ? { paddingHorizontal: GUTTER - GRID_GAP / 2 } : undefined}
          ItemSeparatorComponent={grid ? undefined : () => <View style={{ height: 0 }} />}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} tintColor={palette.tint} colors={[palette.tint]} />}
          renderItem={({ item }: { item: RowModel }) =>
            grid ? (
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={() => onPressItem?.(item)}
                style={[styles.cell, { width: gridCellWidth(columns!) }]}
              >
                <View style={[styles.cover, { backgroundColor: palette.fill2, borderRadius: GRID_RADIUS }]}>
                  {item.cover ? <NetworkImage source={{ uri: item.cover }} style={StyleSheet.absoluteFill} resizeMode="cover" thumbnail={360} /> : null}
                </View>
                <Text style={[TYPE.caption, { color: palette.labelSecondary, marginTop: SPACE.xs }]} numberOfLines={1}>
                  {item.title}
                </Text>
                {item.subtitle ? (
                  <Text style={[TYPE.caption, { color: palette.labelTertiary }]} numberOfLines={1}>{item.subtitle}</Text>
                ) : null}
              </TouchableOpacity>
            ) : (
              <TouchableOpacity activeOpacity={onPressItem ? 0.6 : 1} onPress={() => onPressItem?.(item)} disabled={!onPressItem}>
                <ListRow
                  avatar={item.avatar}
                  title={item.title}
                  subtitle={item.subtitle}
                  value={item.value}
                  valueHint={item.valueHint}
                  highlightValue={item.highlight}
                />
              </TouchableOpacity>
            )
          }
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  grid: { paddingTop: SPACE.md, paddingBottom: contentBottom(false) },
  cell: { paddingHorizontal: GRID_GAP / 2, paddingBottom: SPACE.md },
  cover: { width: '100%', aspectRatio: 3 / 4, overflow: 'hidden' },
});
