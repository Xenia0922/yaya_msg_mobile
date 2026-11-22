import React, { useRef, type ReactNode } from 'react';
import {
  Keyboard,
  StyleSheet,
  TextInput,
  type ReturnKeyTypeOptions,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { GlassSurface } from './GlassSurface';
import { ScalePressable } from './Motion';
import { fontFamily, usePalette } from '../theme';
import { useI18n } from '../i18n';

export function SearchBar({
  value,
  onChangeText,
  placeholder,
  right,
  style,
  autoFocus,
  autoCorrect = false,
  returnKeyType = 'search',
  onSubmitEditing,
  onClear,
}: {
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
  right?: ReactNode;
  style?: StyleProp<ViewStyle>;
  autoFocus?: boolean;
  autoCorrect?: boolean;
  returnKeyType?: ReturnKeyTypeOptions;
  onSubmitEditing?: () => void;
  onClear?: () => void;
}) {
  const palette = usePalette();
  const { t } = useI18n();
  const inputRef = useRef<TextInput>(null);
  return (
    <GlassSurface radius={20} role="chip" frostedOnly style={[styles.bar, style]}>
      <MaterialCommunityIcons name="magnify" size={18} color={palette.labelTertiary} />
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={palette.labelTertiary}
        style={[styles.input, { color: palette.label }]}
        autoFocus={autoFocus}
        autoCorrect={autoCorrect}
        returnKeyType={returnKeyType}
        onSubmitEditing={onSubmitEditing}
        accessibilityLabel={placeholder}
      />
      {value ? (
        <ScalePressable
          onPress={() => {
            onChangeText('');
            inputRef.current?.blur();
            Keyboard.dismiss();
            onClear?.();
          }}
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
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 40,
    paddingHorizontal: 14,
    borderCurve: 'continuous',
  },
  input: { flex: 1, fontSize: 15, fontFamily: fontFamily.system, padding: 0, minHeight: 40 },
});
