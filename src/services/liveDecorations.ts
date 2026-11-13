import pocketApi from '../api/pocket48';

/**
 * 直播装扮目录（进场特效 / 弹幕气泡）。
 *
 * 官方接口（反编译 `live/get/all/specialeffects`、`live/get_live_all_bubble`，均为 GET）：
 *  - 进场特效：`{ list: [{ specialEffectsId, specialEffectsName, specialEffectsImgUrl, describeText, androidUrl }] }`
 *  - 弹幕气泡：`{ list: [{ bubbleId, liveBubbleName, liveBubbleUrl, description, androidUrl, bubbleType }] }`
 * 两者都带预览图，可直接进选择器；zip/pag 资源用于客户端播放动画（我们只做选择与同步）。
 */

export type LiveDecoration = {
  id: string;
  name: string;
  preview: string;
  desc: string;
};

function pickList(source: any): any[] {
  if (!source) return [];
  if (Array.isArray(source)) return source;
  const content = source.content ?? source.data ?? source;
  if (Array.isArray(content)) return content;
  if (content && typeof content === 'object') {
    for (const key of ['list', 'records', 'items', 'data']) {
      if (Array.isArray((content as any)[key])) return (content as any)[key];
    }
  }
  return [];
}

function normalize(list: any[], map: (item: any) => LiveDecoration | null): LiveDecoration[] {
  const seen = new Set<string>();
  const result: LiveDecoration[] = [];
  for (const raw of list) {
    const item = map(raw);
    if (!item || !item.id || seen.has(item.id)) continue;
    seen.add(item.id);
    result.push(item);
  }
  return result;
}

const effectMap = (item: any): LiveDecoration | null => {
  const id = String(item?.specialEffectsId ?? item?.id ?? '').trim();
  if (!id) return null;
  return {
    id,
    name: String(item?.specialEffectsName || item?.name || '进场特效').trim(),
    preview: String(item?.specialEffectsImgUrl || item?.imgUrl || item?.preview || '').trim(),
    desc: String(item?.describeText || item?.description || '').trim(),
  };
};

const liveBubbleMap = (item: any): LiveDecoration | null => {
  const id = String(item?.bubbleId ?? item?.id ?? '').trim();
  if (!id) return null;
  return {
    id,
    name: String(item?.liveBubbleName || item?.bubbleName || item?.name || '直播气泡').trim(),
    preview: String(item?.liveBubbleUrl || item?.previewPath || item?.imgUrl || '').trim(),
    desc: String(item?.description || '').trim(),
  };
};

let effectCache: LiveDecoration[] | null = null;
let effectRequest: Promise<LiveDecoration[]> | null = null;
let bubbleCache: LiveDecoration[] | null = null;
let bubbleRequest: Promise<LiveDecoration[]> | null = null;

/** 直播进场特效全量目录 */
export function getLiveEffects(force = false): Promise<LiveDecoration[]> {
  if (force) { effectCache = null; effectRequest = null; }
  if (effectCache) return Promise.resolve(effectCache);
  if (effectRequest) return effectRequest;
  effectRequest = pocketApi.getLiveAllSpecialEffects().then((response) => {
    const list = normalize(pickList(response), effectMap);
    effectCache = list;
    return list;
  }).catch((error) => { effectRequest = null; throw error; });
  return effectRequest;
}

/** 直播弹幕气泡全量目录 */
export function getLiveBubbles(force = false): Promise<LiveDecoration[]> {
  if (force) { bubbleCache = null; bubbleRequest = null; }
  if (bubbleCache) return Promise.resolve(bubbleCache);
  if (bubbleRequest) return bubbleRequest;
  bubbleRequest = pocketApi.getLiveAllBubbles().then((response) => {
    const list = normalize(pickList(response), liveBubbleMap);
    bubbleCache = list;
    return list;
  }).catch((error) => { bubbleRequest = null; throw error; });
  return bubbleRequest;
}
