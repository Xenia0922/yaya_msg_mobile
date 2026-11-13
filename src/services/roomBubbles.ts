import pocketApi from '../api/pocket48';

/**
 * 口袋官方房间消息气泡（QChat 发言气泡）。
 *
 * 真实接口：`/im/api/v1/room/bubbleList`（官方 7.x 客户端 `api/v1/room/bubbleList`）。
 * 返回 `content` 为数组，单条字段（反编译 `JUJUBubble` / 实测）：
 *   bubbleId / title / ename / previewPath / canUse / useStatus / adaptUser
 *   androidUrl / androidLeftPath / androidRightPath / qchatAndroidUrl …
 *
 * 三个易踩的点（2026-11-05 实测 46 条修正）：
 * 1. 官方**自带**一条默认气泡（`ename=default`、`title=默认气泡`、`canUse=1`、`useStatus=1`）。
 *    此前代码又 unshift 了一条 `id:'0'` 的默认项 → 列表里出现两个「默认气泡」。
 * 2. `canUse` 是**是否已拥有**（1=可用/已拥有，0=未拥有），不是 VIP 标记；
 *    46 条里 45 条 `canUse=0`，一律当 VIP 显示会造成「全都一样、像没抓到」的观感。
 * 3. `useStatus=1` 才是账号当前正在使用的气泡，此前被完全忽略。
 */

export type OfficialRoomBubble = {
  /** 本机设置与发送用的 id：默认气泡恒为 '0'，其余为官方 bubbleId */
  id: string;
  /** 官方 bubbleId（默认气泡调 chooseBubble 时用它，传 '0' 服务端不认） */
  serverId: string;
  name: string;
  previewPath: string;
  /** 账号是否已拥有（canUse）*/
  owned: boolean;
  /** 账号当前正在使用（useStatus / isInUse）*/
  inUse: boolean;
  /** 官方默认气泡 */
  isDefault: boolean;
};

let catalog: OfficialRoomBubble[] | null = null;
let catalogRequest: Promise<OfficialRoomBubble[]> | null = null;

const LIST_KEYS = ['bubbles', 'bubbleList', 'list', 'records', 'rows', 'items', 'data', 'result', 'content'];

/** 从任意响应形态里挖出数组：数组 / 具名列表 / 一层嵌套 / id→item 字典 / 分组展开 */
function pickArray(node: any, depth = 0): any[] {
  if (!node || depth > 3) return [];
  if (Array.isArray(node)) {
    // 分组形态：[{ bubbles: [...] }, ...]
    const flat = node.flatMap((item) => (item && typeof item === 'object' && !Array.isArray(item) && !item.bubbleId && !item.bubbleID && !item.id
      ? pickArray(item, depth + 1)
      : [item]));
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
  // 字典形态：{ '123': {...}, '456': {...} }
  const values = Object.values(node).filter((value) => value && typeof value === 'object');
  if (values.length && values.every((value: any) => value.bubbleId || value.bubbleID || value.bubbleName)) return values;
  return [];
}

function flag(value: any): boolean {
  return value === true || value === 1 || value === '1' || value === 'true';
}

function normalizeBubble(item: any): OfficialRoomBubble | null {
  const serverId = String(item?.bubbleId ?? item?.bubbleID ?? item?.id ?? '').trim();
  if (!serverId) return null;
  const name = String(item?.title || item?.bubbleName || item?.name || '').trim() || '官方气泡';
  const isDefault = String(item?.ename || '').trim().toLowerCase() === 'default' || /默认气泡/.test(name);
  // previewPath 为相对路径（/backstage/...）或个别绝对 URL；缺图时退回九宫格切片地址
  const previewPath = String(
    item?.previewPath || item?.preview || item?.androidUrl || item?.rightBubble || item?.androidRightPath || '',
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
  // 服务器通常自带默认气泡；个别账号/灰度下可能没有 → 补一条，保证「恢复默认」永远可达
  if (!bubbles.some((item) => item.isDefault)) {
    bubbles.unshift({ id: '0', serverId: '0', name: '默认气泡', previewPath: '', owned: true, inUse: false, isDefault: true });
  }
  // 默认气泡置顶（方便一键恢复），正在使用的排第二，其余保持服务端顺序（新→旧）
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
  catalogRequest = pocketApi.getRoomBubbles().then((response) => {
    const bubbles = buildCatalog(response);
    catalog = bubbles;
    return bubbles;
  }).catch((error) => {
    catalogRequest = null;
    throw error;
  });
  return catalogRequest;
}
