export type HomeModuleKey = 'live' | 'performances' | 'quick' | 'resume' | 'tools';

export interface HomeModuleDef {
  key: HomeModuleKey;

  titleKey: string;
  defaultEnabled: boolean;
}

export const HOME_MODULES: HomeModuleDef[] = [
  { key: 'live', titleKey: '成员直播', defaultEnabled: true },
  { key: 'performances', titleKey: '公演直播', defaultEnabled: true },
  { key: 'quick', titleKey: '快捷入口', defaultEnabled: true },
  { key: 'resume', titleKey: '最近播放', defaultEnabled: true },
  { key: 'tools', titleKey: '工具', defaultEnabled: true },
];

export const HOME_MODULE_KEYS: HomeModuleKey[] = HOME_MODULES.map((m) => m.key);

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

export function resolveHomeModules(order?: string[], hidden?: string[]): HomeModuleDef[] {
  const hiddenSet = new Set(hidden || []);
  return orderHomeModules(order).filter((m) => m.defaultEnabled && !hiddenSet.has(m.key));
}
