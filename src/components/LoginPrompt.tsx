import React from 'react';
import { useNavigation } from '@react-navigation/native';
import { EmptyState } from './StateViews';
import { useI18n } from '../i18n';

interface LoginPromptProps {
  hint?: string;

  title?: string;
}

export function LoginPrompt({ hint, title }: LoginPromptProps) {
  const navigation = useNavigation<any>();
  const { t } = useI18n();
  return (
    <EmptyState
      icon="key-variant"
      title={title || t('需要登录口袋48')}
      hint={hint || t('登录后才能查看此内容')}
      actionLabel={t('去登录 / 粘贴 Token')}
      onAction={() => {
        try {
          navigation.navigate('LoginScreen');
        } catch {}
      }}
    />
  );
}
