import React from 'react';
import { StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { usePalette } from '../theme';
import { typography } from '../theme/typography';
import { useI18n } from '../i18n';
import { Button } from './Button';

interface StateViewProps {
  icon?: string;
  title: string;
  hint?: string;
  actionLabel?: string;
  onAction?: () => void;
  style?: StyleProp<ViewStyle>;

  error?: boolean;
}

export function StateView({
  icon,
  title,
  hint,
  actionLabel,
  onAction,
  style,
  error,
}: StateViewProps) {
  const palette = usePalette();
  const { t } = useI18n();
  const glyph = icon || (error ? 'alert-circle-outline' : 'file-search-outline');
  return (
    <View style={[styles.wrap, style]}>
      <View
        style={[
          styles.iconWrap,
          { backgroundColor: error ? 'rgba(255,59,48,0.12)' : palette.tintSoft },
        ]}
      >
        <MaterialCommunityIcons
          name={glyph}
          size={34}
          color={error ? palette.danger : palette.tint}
        />
      </View>
      <Text style={[typography.headline, { color: palette.label, textAlign: 'center' }]}>
        {title}
      </Text>
      {hint ? (
        <Text style={[typography.footnote, styles.hint, { color: palette.labelSecondary }]}>
          {hint}
        </Text>
      ) : null}
      {actionLabel && onAction ? (
        <View style={styles.actionWrap}>
          <Button title={actionLabel || t('重试')} onPress={onAction} variant="filled" size="sm" />
        </View>
      ) : null}
    </View>
  );
}

export function EmptyState(props: Omit<StateViewProps, 'error'>) {
  return <StateView {...props} />;
}

export function ErrorState(props: Omit<StateViewProps, 'error'>) {
  const { t } = useI18n();
  return <StateView error {...props} actionLabel={props.actionLabel || t('重试')} />;
}

const styles = StyleSheet.create({
  wrap: {
    paddingVertical: 48,
    paddingHorizontal: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrap: {
    width: 64,
    height: 64,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  hint: { lineHeight: 18, textAlign: 'center', marginTop: 6, maxWidth: 280 },
  actionWrap: { marginTop: 20 },
});
