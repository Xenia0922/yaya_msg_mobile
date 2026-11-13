import { unwrapList } from './data';

/**
 * 礼物列表归一化。
 *
 * `gift/api/v1/gift/list` 的返回有多种形态：
 *  - 直接是礼物数组（content.gifts / content.giftList / data.list）
 *  - 是「分组」数组，每组内再挂 giftList（官方按业务分组下发的常见形态）
 * 这里统一摊平成一维礼物数组，并按 giftId 去重。
 *
 * MediaScreen 与 FollowedRoomsScreen 的礼物面板共用（房间直播的礼物列表曾因
 * 只用 liveId 维度、没做成员维度回退，导致面板空着没法送礼）。
 */
export function normalizeGiftList(res: any): any[] {
  const categories = unwrapList(res, ['content', 'content.list', 'data.content', 'data.list', 'list']);
  const gifts: any[] = [];
  for (const item of categories) {
    const nested = unwrapList(item, ['giftList', 'gifts', 'list']);
    if (nested.length) gifts.push(...nested);
    else if (item?.giftId || item?.id) gifts.push(item);
  }
  const seen = new Set<string>();
  return gifts.filter((gift) => {
    const id = String(gift.giftId || gift.id || '');
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}
