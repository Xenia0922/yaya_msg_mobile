import React from 'react';
import { ActivityIndicator, StyleSheet, Text } from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { useI18n } from '../i18n';
import { usePalette } from '../theme';
import { fontFamily, typography } from '../theme/typography';
import { ScalePressable } from './Motion';

export interface HeaderActionProps {
  label: string;
  onPress?: () => void;
  disabled?: boolean;
  loading?: boolean;
  icon?: string;
}

export function HeaderAction({ label, onPress, disabled, loading, icon }: HeaderActionProps) {
  const palette = usePalette();
  const { t } = useI18n();
  const inactive = disabled || loading;

  const resolvedIcon =
    icon ||
    (label === t('刷新') || label === t('刷新状态')
      ? 'refresh'
      : label === t('清理')
        ? 'trash-can-outline'
        : label === t('发送翻牌')
          ? 'send-outline'
          : undefined);

  if (resolvedIcon) {
    return (
      <ScalePressable
        onPress={onPress}
        disabled={inactive}
        pressedScale={0.9}
        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        style={[
          styles.iconBtn,
          { backgroundColor: palette.fill2, opacity: inactive && !loading ? 0.4 : 1 },
        ]}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: inactive, busy: !!loading }}
      >
        {loading ? (
          <ActivityIndicator size="small" color={palette.tint} />
        ) : (
          <MaterialCommunityIcons
            name={resolvedIcon}
            size={19}
            color={resolvedIcon === 'send-outline' ? palette.tint : palette.label}
          />
        )}
      </ScalePressable>
    );
  }

  return (
    <ScalePressable
      onPress={onPress}
      disabled={inactive}
      pressedScale={0.92}
      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
      style={[
        styles.pillBtn,
        { backgroundColor: palette.fill2, opacity: inactive && !loading ? 0.45 : 1 },
      ]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: inactive, busy: !!loading }}
    >
      {loading ? (
        <ActivityIndicator size="small" color={palette.tint} />
      ) : (
        <Text
          style={[
            typography.footnote,
            {
              color: palette.tint,
              fontWeight: '700',
              fontFamily: fontFamily.system,
              includeFontPadding: false,
            },
          ]}
        >
          {label}
        </Text>
      )}
    </ScalePressable>
  );
}

const styles = StyleSheet.create({
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillBtn: {
    minWidth: 48,
    height: 36,
    paddingHorizontal: 12,
    borderRadius: 18,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
