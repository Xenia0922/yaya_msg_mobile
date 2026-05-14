import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View, ViewStyle } from 'react-native';
import { useNavigation } from '@react-navigation/native';

interface Props {
  title: string;
  onBack?: () => void;
  right?: React.ReactNode;
  style?: ViewStyle;
}

export default function ScreenHeader({ title, onBack, right, style }: Props) {
  const navigation = useNavigation();
  const goBack = onBack || (() => navigation.goBack());

  return (
    <View style={[styles.header, style]}>
      <TouchableOpacity onPress={goBack} style={styles.backWrap}>
        <Text style={styles.backText}>返回</Text>
      </TouchableOpacity>
      <Text style={styles.title} numberOfLines={1}>{title}</Text>
      <View style={styles.rightSlot}>{right}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingTop: 54,
    paddingHorizontal: 20,
    paddingBottom: 14,
    marginBottom: 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backWrap: { minWidth: 54 },
  backText: { color: '#ff6f91', fontSize: 14, fontWeight: '800' },
  title: { flex: 1, textAlign: 'center', fontSize: 22, fontWeight: '800', color: '#ff6f91' },
  rightSlot: { minWidth: 54, alignItems: 'flex-end' },
});
