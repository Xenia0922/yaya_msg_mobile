/** 未知响应不覆盖已有红点；数值 0 表示服务端确认没有未读。 */
export function privateUnreadCount(response: any): number | null {
  const content = response?.content ?? response?.data;
  const value = content != null && typeof content === 'object'
    ? content.num ?? content.noreadNum ?? content.unreadNum ?? content.unread ?? content.count ?? content.total
    : content;
  if (value === null || value === undefined || value === '') return null;
  const count = Number(value);
  return Number.isFinite(count) && count >= 0 ? Math.floor(count) : null;
}
