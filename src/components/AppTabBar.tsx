/**
 * AppTabBar · iOS 26 Liquid Glass 底栏
 *  - 玻璃感悬浮胶囊（半透明 + 1px 内描边）
 *  - 5 个 tab：图标 + label，label 常驻显示
 *  - active 项：玻璃 tint 胶囊 + accent 字 + 图标 spring 弹跳
 *  - Spring 按压反馈
 *  - 安全留白底部 inset
 *
 * 注：受 React Navigation 限制，render tabBar 由 Tab.Navigator 的 `tabBar` prop 调用此组件。
 *     此组件自管事件 onTabPress(index)、当前 activeIndex。
 */
import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { usePalette, motion } from '../theme';
import { typography } from '../theme/typography';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';

export interface TabBarItem {
  key: string;
  label: string;
  icon: (props: { color: string; size: number }) => React.ReactNode;
}

export interface AppTabBarProps {
  items: TabBarItem[];
  activeKey: string;
  onSelect: (key: string) => void;
}

function TabCell({
  item,
  active,
  onSelect,
}: {
  item: TabBarItem;
  active: boolean;
  onSelect: () => void;
}) {
  const palette = usePalette();
  const pop = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (active) {
      pop.setValue(0.92);
      Animated.spring(pop, { toValue: 1, ...motion.spring.bouncy, useNativeDriver: true }).start();
    } else {
      pop.setValue(1);
    }
  }, [active, pop]);

  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      hitSlop={6}
      onPress={onSelect}
      style={({ pressed }) => [
        styles.cell,
        active && {
          backgroundColor:
            palette.name === 'dark' ? 'rgba(255,255,255,0.18)' : 'rgba(255,111,145,0.18)',
        },
        active && pressed && { transform: [{ scale: 0.96 }] },
        pressed && !active && { transform: [{ scale: 0.97 }] },
      ]}
    >
      <Animated.View style={[styles.cellIcon, { transform: [{ scale: pop }] }]}>
        {item.icon({ color: active ? palette.tint : palette.labelSecondary, size: 23 })}
      </Animated.View>
      <Text
        style={[
          typography.caption2,
          {
            color: active ? palette.tint : palette.labelSecondary,
            fontWeight: active ? '700' : '600',
            marginTop: 3,
          },
        ]}
      >
        {item.label}
      </Text>
    </Pressable>
  );
}

export function AppTabBar({ items, activeKey, onSelect }: AppTabBarProps) {
  const palette = usePalette();

  return (
    <View
      pointerEvents="box-none"
      style={[styles.outer, { paddingBottom: 10 }]}
    >
      <View
        style={[
          styles.bar,
          {
            backgroundColor: palette.surfaceGlassStrong,
            borderColor: palette.innerStroke,
          },
        ]}
      >
        {items.map((item) => {
          const active = item.key === activeKey;
          return (
            <TabCell
              key={item.key}
              item={item}
              active={active}
              onSelect={() => onSelect(item.key)}
            />
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  bar: {
    flexDirection: 'row',
    borderRadius: 24,
    paddingVertical: 6,
    paddingHorizontal: 8,
    minHeight: 62,
    // 不设边框/高 elevation：任何 hairline 描边或 Android elevation 阴影
    // 都会在胶囊四周形成「一圈边框」观感（iOS 保留柔和投影）
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.08,
        shadowRadius: 12,
      },
      android: { elevation: 0 },
      default: null,
    }),
  },
  cell: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    paddingHorizontal: 4,
    borderRadius: 20,
  },
  cellIcon: { alignItems: 'center', justifyContent: 'center' },
});

// 辅助：复用项目里的 MaterialCommunityIcons
export function MCI(name: string) {
  return ({ color, size }: { color: string; size: number }) => (
    <MaterialCommunityIcons name={name} color={color} size={size} />
  );
}

export { motion };
