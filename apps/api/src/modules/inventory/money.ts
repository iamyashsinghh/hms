/** Money maths in paise (integers) so totals never drift. Purchase rates are before GST. */

export const toPaise = (rupees: number | string): number => Math.round(Number(rupees) * 100);
export const toRupees = (paise: number): string => (paise / 100).toFixed(2);
export const num = (v: string | number | null | undefined): number => (v == null ? 0 : Number(v));

/** qty x rate, plus GST on top. */
export function purchaseLine(ratePaise: number, qty: number, gstRate: number) {
  const base = ratePaise * qty;
  const tax = Math.round((base * gstRate) / 100);
  return { base, tax, amount: base + tax };
}
