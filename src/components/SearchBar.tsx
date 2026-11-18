import React, { type ReactNode } from 'react';
import { StyleSheet, TextInput, type StyleProp, type ViewStyle } from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { GlassSurface } from './GlassSurface';
import { ScalePressable } from './Motion';
import { usePalette } from '../theme';
import { useI18n } from '../i18n';

/**
 * 玻璃搜索框（C2 公共件）。
 * 统一「音乐库 / 房间 / 私信」等处的搜索输入样式；内容必须是 GlassSurface 的 children（玻璃铁律）。
 */
export function SearchBar({
  value,
  onChangeText,
  placeholder,
  right,
  style,
  autoFocus,
}: {
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
  right?: ReactNode;
  style?: StyleProp<ViewStyle>;
  autoFocus?: boolean;
}) {
  const palette = usePalette();
  const { t } = useI18n();
  return (
    <GlassSurface radius={14} role="chip" style={[styles.bar, style]}>
      <MaterialCommunityIcons name="magnify" size={18} color={palette.labelTertiary} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={palette.labelTertiary}
        style={[styles.input, { color: palette.label }]}
        autoFocus={autoFocus}
        accessibilityLabel={placeholder}
      />
      {value ? (
        <ScalePressable
          onPress={() => onChangeText('')}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          pressedScale={0.9}
          activeOpacity={0.6}
          accessibilityRole="button"
          accessibilityLabel={t('清除')}
        >
          <MaterialCommunityIcons name="close-circle" size={16} color={palette.labelTertiary} />
        </ScalePressable>
      ) : null}
      {right ?? null}
    </GlassSurface>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 40 },
  input: { flex: 1, fontSize: 15, padding: 0, minHeight: 40 },
});
