export function parseInvoiceFeeCents(raw: string | number | null | undefined): number {
  const cleaned = String(raw ?? '')
    .replace(/[¥￥,\s]/g, '')
    .trim();
  if (!cleaned) return 0;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value * 100);
}

export function sumSelectedInvoiceCents(
  orders: ReadonlyArray<{ selected?: boolean; totalFee?: string | number | null }>,
): number {
  let totalCents = 0;
  for (const order of orders) {
    if (!order?.selected) continue;
    totalCents += parseInvoiceFeeCents(order.totalFee);
  }
  return totalCents;
}

export function formatInvoiceCents(cents: number): string {
  if (!Number.isFinite(cents) || cents <= 0) return '0.00';
  return (Math.round(cents) / 100).toFixed(2);
}
