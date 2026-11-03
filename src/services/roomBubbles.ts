import pocketApi from '../api/pocket48';

export type OfficialRoomBubble = {
  id: string;
  name: string;
  previewPath: string;
  vip: boolean;
};

let catalog: OfficialRoomBubble[] | null = null;
let catalogRequest: Promise<OfficialRoomBubble[]> | null = null;

function bubbleListFromResponse(response: any): any[] {
  const content = response?.content ?? response?.data ?? response;
  if (Array.isArray(content)) return content;
  if (Array.isArray(content?.bubbles)) return content.bubbles;
  if (Array.isArray(content?.list)) return content.list;
  return [];
}

export function getOfficialRoomBubbles(force = false): Promise<OfficialRoomBubble[]> {
  if (force) {
    catalog = null;
    catalogRequest = null;
  }
  if (catalog) return Promise.resolve(catalog);
  if (catalogRequest) return catalogRequest;
  catalogRequest = pocketApi.getRoomBubbles().then((response) => {
    const bubbles = bubbleListFromResponse(response).map((item: any) => ({
      id: String(item.bubbleId ?? ''),
      name: String(item.title || item.name || '官方气泡'),
      previewPath: String(item.previewPath || ''),
      vip: item.canUse === false || item.canUse === 0 || String(item.canUse) === '0' || item.isVip === true || item.forVip === true,
    })).filter((item: OfficialRoomBubble) => !!item.id);
    if (!bubbles.some((item: OfficialRoomBubble) => item.id === '0')) {
      bubbles.unshift({ id: '0', name: '默认气泡', previewPath: '', vip: false });
    }
    catalog = bubbles;
    return bubbles;
  }).catch((error) => {
    catalogRequest = null;
    throw error;
  });
  return catalogRequest;
}
