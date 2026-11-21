import pocketApi from '../api/pocket48';

export type OfficialRoomBubble = {
  id: string;

  serverId: string;
  name: string;
  previewPath: string;

  owned: boolean;

  inUse: boolean;

  isDefault: boolean;
};

let catalog: OfficialRoomBubble[] | null = null;
let catalogRequest: Promise<OfficialRoomBubble[]> | null = null;

const LIST_KEYS = [
  'bubbles',
  'bubbleList',
  'list',
  'records',
  'rows',
  'items',
  'data',
  'result',
  'content',
];

function pickArray(node: any, depth = 0): any[] {
  if (!node || depth > 3) return [];
  if (Array.isArray(node)) {
    const flat = node.flatMap((item) =>
      item &&
      typeof item === 'object' &&
      !Array.isArray(item) &&
      !item.bubbleId &&
      !item.bubbleID &&
      !item.id
        ? pickArray(item, depth + 1)
        : [item],
    );
    return flat.filter((item) => item && typeof item === 'object');
  }
  if (typeof node !== 'object') return [];
  for (const key of LIST_KEYS) {
    if (Array.isArray(node[key])) return pickArray(node[key], depth + 1);
  }
  for (const key of LIST_KEYS) {
    const nested = pickArray(node[key], depth + 1);
    if (nested.length) return nested;
  }

  const values = Object.values(node).filter((value) => value && typeof value === 'object');
  if (
    values.length &&
    values.every((value: any) => value.bubbleId || value.bubbleID || value.bubbleName)
  )
    return values;
  return [];
}

function flag(value: any): boolean {
  return value === true || value === 1 || value === '1' || value === 'true';
}

function normalizeBubble(item: any): OfficialRoomBubble | null {
  const serverId = String(item?.bubbleId ?? item?.bubbleID ?? item?.id ?? '').trim();
  if (!serverId) return null;
  const name = String(item?.title || item?.bubbleName || item?.name || '').trim() || '官方气泡';
  const isDefault =
    String(item?.ename || '')
      .trim()
      .toLowerCase() === 'default' || /默认气泡/.test(name);

  const previewPath = String(
    item?.previewPath ||
      item?.preview ||
      item?.androidUrl ||
      item?.rightBubble ||
      item?.androidRightPath ||
      '',
  ).trim();
  return {
    id: isDefault ? '0' : serverId,
    serverId,
    name,
    previewPath,
    owned: item?.canUse === undefined ? true : flag(item.canUse),
    inUse: flag(item?.useStatus) || flag(item?.isInUse),
    isDefault,
  };
}

function buildCatalog(response: any): OfficialRoomBubble[] {
  const seen = new Set<string>();
  const bubbles: OfficialRoomBubble[] = [];
  for (const raw of pickArray(response)) {
    const item = normalizeBubble(raw);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    bubbles.push(item);
  }

  if (!bubbles.some((item) => item.isDefault)) {
    bubbles.unshift({
      id: '0',
      serverId: '0',
      name: '默认气泡',
      previewPath: '',
      owned: true,
      inUse: false,
      isDefault: true,
    });
  }

  return bubbles.sort((a, b) => {
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
    if (a.inUse !== b.inUse) return a.inUse ? -1 : 1;
    return 0;
  });
}

export function getOfficialRoomBubbles(force = false): Promise<OfficialRoomBubble[]> {
  if (force) {
    catalog = null;
    catalogRequest = null;
  }
  if (catalog) return Promise.resolve(catalog);
  if (catalogRequest) return catalogRequest;
  catalogRequest = pocketApi
    .getRoomBubbles()
    .then((response) => {
      const bubbles = buildCatalog(response);
      catalog = bubbles;
      return bubbles;
    })
    .catch((error) => {
      catalogRequest = null;
      throw error;
    });
  return catalogRequest;
}
