import { useCallback } from 'react';
import { useSettingsStore } from '../store';
import type { LanguageSetting } from '../types';
import { zhHant } from './zh-Hant';
import { en } from './en';
import { ja } from './ja';
import { ko } from './ko';

export type { LanguageSetting };

export type LanguageCode = 'zh-Hans' | 'zh-Hant' | 'en' | 'ja' | 'ko';

export const LANGUAGE_OPTIONS: { label: string; value: LanguageSetting }[] = [
  { label: '跟随系统', value: 'system' },
  { label: '简体中文', value: 'zh-Hans' },
  { label: '繁體中文', value: 'zh-Hant' },
  { label: 'English', value: 'en' },
  { label: '日本語', value: 'ja' },
  { label: '한국어', value: 'ko' },
];

const DICTS: Record<LanguageCode, Record<string, string>> = {
  'zh-Hans': {},
  'zh-Hant': zhHant,
  en,
  ja,
  ko,
};

/** 跟随系统时的语言检测（Intl 纯 JS 实现，无需原生依赖） */
export function detectSystemLanguage(): LanguageCode {
  try {
    const locale = (Intl.DateTimeFormat().resolvedOptions().locale || '').toLowerCase();
    if (locale.startsWith('zh')) return /tw|hk|mo|hant/i.test(locale) ? 'zh-Hant' : 'zh-Hans';
    if (locale.startsWith('ja')) return 'ja';
    if (locale.startsWith('ko')) return 'ko';
    return 'en';
  } catch {
    return 'zh-Hans';
  }
}

export function resolveLanguage(setting: LanguageSetting): LanguageCode {
  return setting === 'system' ? detectSystemLanguage() : setting;
}

function render(text: string, vars?: Record<string, string | number>): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (match, key) => {
    const v = vars[key];
    return v === undefined || v === null ? match : String(v);
  });
}

/**
 * 组件外/一次性翻译：key 为中文原文，缺翻译回退原文。
 * 不做响应式（仅读取当前设置值），组件内请用 useI18n。
 */
export function translate(key: string, vars?: Record<string, string | number>): string {
  const setting = useSettingsStore.getState().settings.language ?? 'system';
  const text = DICTS[resolveLanguage(setting)][key] || key;
  return render(text, vars);
}

export const t = translate;

/** 组件内响应式翻译：语言设置变化时自动重渲染 */
export function useI18n() {
  const language = useSettingsStore((s) => s.settings.language ?? 'system');
  const lang = resolveLanguage(language);
  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => render(DICTS[lang][key] || key, vars),
    [lang],
  );
  return { t, lang };
}
