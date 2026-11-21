export function sumPrivateConversationUnread(list: unknown): number | null {
  if (!Array.isArray(list)) return null;
  let total = 0;
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const conv = item as Record<string, unknown>;
    const raw = conv.noreadNum ?? conv.unreadNum ?? conv.unreadCount ?? conv.unread ?? 0;
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) total += Math.floor(n);
  }
  return total;
}

export function privateUnreadCount(response: any): number | null {
  const content = response?.content ?? response?.data;
  if (content != null && typeof content === 'object') {
    const convList =
      content.userMessageList ?? content.unreadList ?? (Array.isArray(content) ? content : null);
    if (Array.isArray(convList)) {
      if (Array.isArray(content.userMessageList)) {
        return sumPrivateConversationUnread(convList);
      }

      let arrSum = 0;
      let sawNum = false;
      for (const row of convList) {
        if (!row || typeof row !== 'object') continue;
        const r = row as Record<string, unknown>;
        const v = r.noreadNum ?? r.unreadNum ?? r.num ?? r.count ?? r.unread;
        if (v !== null && v !== undefined && v !== '') {
          const n = Number(v);
          if (Number.isFinite(n) && n >= 0) {
            sawNum = true;
            arrSum += Math.floor(n);
          }
        }
      }
      if (sawNum) return arrSum;
    }
  }
  const value =
    content != null && typeof content === 'object'
      ? (content.userMessageNum ??
        content.privateMessageNum ??
        content.privateMsgNum ??
        content.userMsgNum ??
        content.imUnreadNum ??
        content.num ??
        content.noreadNum ??
        content.unreadNum ??
        content.unreadMessageNum ??
        content.messageNum ??
        content.msgNum ??
        content.privateNum ??
        content.unread ??
        content.count ??
        content.total)
      : content;
  if (value === null || value === undefined || value === '') return null;
  const count = Number(value);
  return Number.isFinite(count) && count >= 0 ? Math.floor(count) : null;
}
