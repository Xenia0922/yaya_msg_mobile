/**
 * AppTabBar · iOS 26 Liquid Glass 底栏
 *  - 悬浮胶囊底栏，材质走 GlassSurface（floatingTabBar 预设：全厚度 + 活边）
 *  - 5 个 tab：图标 + label，label 常驻显示
 *  - active 项：中性玻璃灰胶囊 + accent 字 + 图标 spring 弹跳
 *  - Spring 按压反馈 / 安全留白底部 inset
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
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { GlassSurface } from './GlassSurface';
import { usePalette, motion } from '../theme';
import { typography } from '../theme/typography';

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
    pop.stopAnimation();
    if (active) {
      pop.setValue(0.92);
      const animation = Animated.spring(pop, { toValue: 1, ...motion.spring.bouncy, useNativeDriver: true });
      animation.start();
      return () => animation.stop();
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
        // iOS 26 选中态：中性玻璃灰底 + accent 文字图标（不再粉，克制）
        active && {
          backgroundColor:
            palette.name === 'dark' ? 'rgba(120,120,128,0.30)' : 'rgba(120,120,128,0.16)',
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
  return (
    <View pointerEvents="box-none" style={[styles.outer, { paddingBottom: 16 }]}>
      <View style={styles.bar}>
        {/* 玻璃底：单一材质出口（floatingTabBar 预设）。旧的「保底白膜 + 手绘高光 + AGSL」
            三层已被替换——那套叠加会产生硬边界与灰罩。 */}
        <GlassSurface role="bar" radius={28} asBackground />
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
    borderRadius: 28,
    paddingVertical: 6,
    paddingHorizontal: 8,
    minHeight: 64,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.10,
        shadowRadius: 16,
      },
      android: { elevation: 8 },
      default: null,
    }),
  },
  cell: {
    width: 76,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
    paddingHorizontal: 4,
    borderRadius: 28,
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
