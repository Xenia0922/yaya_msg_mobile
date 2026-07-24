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
      <TouchableOpacity onPress={goBack} style={styles.backWrap}>
        <Text style={styles.backText}>返回</Text>
      </TouchableOpacity>
      <View style={[styles.titleWrap, { top: topPad, bottom: 14 }]} pointerEvents="none">
        <Text style={styles.title} numberOfLines={1}>{title}</Text>
      </View>
      <View style={styles.rightSlot}>{right}</View>
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
  backWrap: { minWidth: 54 },
  backText: { color: '#ff6f91', fontSize: 14, fontWeight: '800', textShadowColor: 'rgba(0,0,0,0.28)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2 },
  titleWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 70,
  },
  title: {
    textAlign: 'center',
    fontSize: 22,
    fontWeight: '800',
    color: '#ff6f91',
    textShadowColor: 'rgba(0,0,0,0.28)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  rightSlot: { minWidth: 54, alignItems: 'flex-end' },
});
