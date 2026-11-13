/**
 * 首页模块注册表（C4-S1）。
 *
 * 目的：把首页从「固定顺序硬编码」改为「按注册表渲染」，为后续「模块开关/排序」打底。
 * 本阶段（S1）只提供注册表与设置字段，**不改渲染**（保证首页零变化）。
 */
export type HomeModuleKey = 'live' | 'performances' | 'quick' | 'resume' | 'tools';

export interface HomeModuleDef {
  key: HomeModuleKey;
  /** i18n key（中文原文即 key） */
  titleKey: string;
  defaultEnabled: boolean;
}

/** 默认顺序 = 现有首页观感顺序 */
export const HOME_MODULES: HomeModuleDef[] = [
  { key: 'live', titleKey: '成员直播', defaultEnabled: true },
  { key: 'performances', titleKey: '公演直播', defaultEnabled: true },
  { key: 'quick', titleKey: '快捷入口', defaultEnabled: true },
  { key: 'resume', titleKey: '最近播放', defaultEnabled: true },
  { key: 'tools', titleKey: '工具', defaultEnabled: true },
];

export const HOME_MODULE_KEYS: HomeModuleKey[] = HOME_MODULES.map((m) => m.key);

/**
 * 按用户顺序去重 + 补齐缺失项，返回「所有」模块（不剔除隐藏项）。
 * 设置页排序用：即使某模块被关闭，也要能调整其在 home_modules_order 中的位置。
 */
export function orderHomeModules(order?: string[]): HomeModuleDef[] {
  const byKey = new Map(HOME_MODULES.map((m) => [m.key as string, m] as const));
  const seen = new Set<string>();
  const out: HomeModuleDef[] = [];
  for (const k of order || []) {
    const def = byKey.get(k);
    if (def && !seen.has(k)) {
      seen.add(k);
      out.push(def);
    }
  }
  for (const def of HOME_MODULES) {
    if (!seen.has(def.key)) out.push(def);
  }
  return out;
}

/** 计算最终渲染顺序：用户自定义顺序去重 + 补齐缺失项；再剔除隐藏项 */
export function resolveHomeModules(order?: string[], hidden?: string[]): HomeModuleDef[] {
  const hiddenSet = new Set(hidden || []);
  return orderHomeModules(order).filter((m) => m.defaultEnabled && !hiddenSet.has(m.key));
}
