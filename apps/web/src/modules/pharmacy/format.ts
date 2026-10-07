const inrFormat = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 });

/** ₹1,234.50 */
export const inr = (n: number | null | undefined) => (n == null ? '—' : inrFormat.format(n));

export const expiryLabel = (date: string) =>
  new Date(date).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });

export function daysUntil(date: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((new Date(date).getTime() - today.getTime()) / 86_400_000);
}

export const SCHEDULE_LABEL: Record<string, string> = { otc: 'OTC', G: 'Sch G', H: 'Sch H', H1: 'Sch H1', X: 'Sch X', narcotic: 'Narcotic' };

/** Sum per line of price x qty less discount, as the server computes it (GST-inclusive prices). */
export function estimateLine(unitPrice: number, qty: number, discountPct: number): number {
  const gross = Math.round(unitPrice * 100) * qty;
  return (gross - Math.round((gross * discountPct) / 100)) / 100;
}
