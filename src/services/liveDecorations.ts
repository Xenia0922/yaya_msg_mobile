import pocketApi from '../api/pocket48';

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
let effectGeneration = 0;
let bubbleCache: LiveDecoration[] | null = null;
let bubbleRequest: Promise<LiveDecoration[]> | null = null;
let bubbleGeneration = 0;

export function getLiveEffects(force = false): Promise<LiveDecoration[]> {
  if (force) {
    effectGeneration += 1;
    effectCache = null;
    effectRequest = null;
  }
  if (effectCache) return Promise.resolve(effectCache);
  if (effectRequest) return effectRequest;
  const generation = effectGeneration;
  const request = pocketApi
    .getLiveAllSpecialEffects()
    .then((response) => {
      const list = normalize(pickList(response), effectMap);
      if (generation === effectGeneration) {
        effectCache = list;
        effectRequest = null;
      }
      return list;
    })
    .catch((error) => {
      if (generation === effectGeneration && effectRequest === request) effectRequest = null;
      throw error;
    });
  effectRequest = request;
  return request;
}

export function getLiveBubbles(force = false): Promise<LiveDecoration[]> {
  if (force) {
    bubbleGeneration += 1;
    bubbleCache = null;
    bubbleRequest = null;
  }
  if (bubbleCache) return Promise.resolve(bubbleCache);
  if (bubbleRequest) return bubbleRequest;
  const generation = bubbleGeneration;
  const request = pocketApi
    .getLiveAllBubbles()
    .then((response) => {
      const list = normalize(pickList(response), liveBubbleMap);
      if (generation === bubbleGeneration) {
        bubbleCache = list;
        bubbleRequest = null;
      }
      return list;
    })
    .catch((error) => {
      if (generation === bubbleGeneration && bubbleRequest === request) bubbleRequest = null;
      throw error;
    });
  bubbleRequest = request;
  return request;
}
