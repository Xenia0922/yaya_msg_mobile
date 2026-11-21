import { unwrapList } from './data';

export function normalizeGiftList(res: any): any[] {
  const categories = unwrapList(res, [
    'content',
    'content.list',
    'data.content',
    'data.list',
    'list',
  ]);
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
