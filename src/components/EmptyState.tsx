/**
 * EmptyState：iOS 风格空态
 *   - 居中图标 + 标题 + 副标题
 *   - 可选 action button
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { usePalette } from '../theme';
import { typography } from '../theme/typography';
import { Button } from './Button';

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({ icon, title, description, actionLabel, onAction }: EmptyStateProps) {
  const palette = usePalette();
  return (
    <View style={styles.container}>
      {icon ? <View style={[styles.iconBox, { backgroundColor: palette.fill3 }]}>{icon}</View> : null}
      <Text style={[typography.title3, { color: palette.label, marginTop: 16, textAlign: 'center' }]}>
        {title}
      </Text>
      {description ? (
        <Text
          style={[
            typography.subhead,
            { color: palette.labelSecondary, marginTop: 6, textAlign: 'center', maxWidth: 280 },
          ]}
        >
          {description}
        </Text>
      ) : null}
      {actionLabel && onAction ? (
        <View style={{ marginTop: 20 }}>
          <Button title={actionLabel} onPress={onAction} variant="tinted" />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 24,
    paddingVertical: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBox: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
