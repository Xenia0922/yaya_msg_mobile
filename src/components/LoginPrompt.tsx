/**
 * LoginPrompt · 未登录态统一引导卡
 *
 * 用途：所有需要口袋48 token 的页面，在 !token 时渲染本组件，替代漂浮的错误文字或全 0 数据卡片。
 * 用户可一键跳转登录/粘贴 Token 页面（LoginScreen 兼容两种入口）。
 *
 * 设计原则：
 *  - 文案 i18n 化，调用方可覆盖 hint
 *  - 用 EmptyState 复用图标/排版（StateViews）
 *  - 不接管页面渲染，只是一个 View，可放 ScrollView 内或独立
 */
import React from 'react';
import { useNavigation } from '@react-navigation/native';
import { EmptyState } from './StateViews';
import { useI18n } from '../i18n';

interface LoginPromptProps {
  /** 自定义提示语（默认"登录后才能查看此内容"） */
  hint?: string;
  /** 自定义标题（默认"需要登录口袋48"） */
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
      onAction={() => { try { navigation.navigate('LoginScreen'); } catch { /* noop */ } }}
    />
  );
}