import React, { useCallback } from 'react';
import { Platform, StatusBar, StyleSheet, Text, TouchableOpacity, View, ViewStyle } from 'react-native';
import { useNavigation } from '@react-navigation/native';

interface Props {
  title: string;
  onBack?: () => void;
  right?: React.ReactNode;
  style?: ViewStyle;
}

// 三栏内联布局：左栏(返回) | 中栏(标题, 占满剩余) | 右栏(右侧操作)。
// 关键点：三栏均为正常 flex 流，互不重叠 —— 返回按钮在独立左栏，永远可点，
// 不再用 absolute + pointerEvents 的脆弱 hack（absolute 满宽标题曾盖住返回/右侧，导致点击失效）。
export default function ScreenHeader({ title, onBack, right, style }: Props) {
  const navigation = useNavigation();
  const goBack = useCallback(onBack || (() => navigation.goBack()), [onBack, navigation]);
  const topPad = Platform.OS === 'ios' ? 54 : (StatusBar.currentHeight || 24) + 14;

  return (
    <View style={[styles.header, { paddingTop: topPad }, style]}>
      <View style={styles.sideLeft}>
        <TouchableOpacity
          onPress={goBack}
          style={styles.backBtn}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Text style={styles.backText}>返回</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.title} numberOfLines={1}>{title}</Text>
      <View style={styles.sideRight}>{right}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    position: 'relative',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 14,
    marginBottom: 4,
  },
  // 左右等宽，把标题顶到屏幕正中；两栏各自独占空间，绝不与标题重叠
  sideLeft: { width: 80, alignItems: 'flex-start', justifyContent: 'center' },
  sideRight: { width: 80, alignItems: 'flex-end', justifyContent: 'center' },
  backBtn: { paddingVertical: 2, paddingRight: 6 },
  backText: { color: '#ff6f91', fontSize: 14, fontWeight: '800', textShadowColor: 'rgba(0,0,0,0.28)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2 },
  title: {
    flex: 1,
    textAlign: 'center',
    fontSize: 22,
    fontWeight: '800',
    color: '#ff6f91',
    paddingHorizontal: 4,
    textShadowColor: 'rgba(0,0,0,0.28)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
});
