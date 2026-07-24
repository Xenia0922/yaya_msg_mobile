import React, { useCallback } from 'react';
import { Platform, StatusBar, StyleSheet, Text, TouchableOpacity, View, ViewStyle } from 'react-native';
import { useNavigation } from '@react-navigation/native';

interface Props {
  title: string;
  onBack?: () => void;
  right?: React.ReactNode;
  style?: ViewStyle;
}

export default function ScreenHeader({ title, onBack, right, style }: Props) {
  const navigation = useNavigation();
  const goBack = useCallback(onBack || (() => navigation.goBack()), [onBack, navigation]);
  const topPad = Platform.OS === 'ios' ? 54 : (StatusBar.currentHeight || 24) + 14;

  return (
    <View style={[styles.header, { paddingTop: topPad }, style]}>
      {/* 返回/右侧贴边绝对定位，仅占用自身宽度，不挤占标题空间 */}
      <TouchableOpacity onPress={goBack} style={[styles.backWrap, { top: topPad, bottom: 14 }]}>
        <Text style={styles.backText}>返回</Text>
      </TouchableOpacity>
      {/* 标题回到正常 flex 流：flex:1 独占整行宽度，textAlign:center 即在整屏水平居中，
          垂直方向随 header 的 alignItems:'center' 与左右按钮自动对齐，避免绝对定位导致的偏移/遮挡。
          pointerEvents:none 让触摸穿透到被它（满宽）覆盖的返回/右侧按钮，修复返回键失效回归。 */}
      <Text style={styles.title} numberOfLines={1} pointerEvents="none">{title}</Text>
      <View style={[styles.rightSlot, { top: topPad, bottom: 14 }]}>{right}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    position: 'relative',
    paddingHorizontal: 20,
    paddingBottom: 14,
    marginBottom: 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backWrap: {
    position: 'absolute',
    left: 20,
    justifyContent: 'center',
  },
  backText: { color: '#ff6f91', fontSize: 14, fontWeight: '800', textShadowColor: 'rgba(0,0,0,0.28)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2 },
  title: {
    flex: 1,
    textAlign: 'center',
    fontSize: 22,
    fontWeight: '800',
    color: '#ff6f91',
    paddingHorizontal: 70,
    textShadowColor: 'rgba(0,0,0,0.28)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  rightSlot: {
    position: 'absolute',
    right: 20,
    justifyContent: 'center',
    alignItems: 'flex-end',
  },
});
