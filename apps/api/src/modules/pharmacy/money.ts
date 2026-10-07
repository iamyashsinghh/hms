/** Money maths in paise (integers) so totals never drift. Prices include GST, as MRP does in India. */

export const toPaise = (rupees: number | string): number => Math.round(Number(rupees) * 100);
export const toRupees = (paise: number): string => (paise / 100).toFixed(2);
export const num = (v: string | number | null | undefined): number => (v == null ? 0 : Number(v));

export interface LineAmounts {
  gross: number;
  discount: number;
  amount: number;
  taxable: number;
  tax: number;
}

/** One sale line: unit price (incl. GST) x qty, less a % discount, split into taxable value and GST. */
export function lineAmounts(unitPricePaise: number, qty: number, discountPct: number, gstRate: number): LineAmounts {
  const gross = unitPricePaise * qty;
  const discount = Math.round((gross * discountPct) / 100);
  const amount = gross - discount;
  const taxable = Math.round((amount * 100) / (100 + gstRate));
  return { gross, discount, amount, taxable, tax: amount - taxable };
}

/** Refund for returning `qty` more units of a line, so partial returns add up exactly to the line amount. */
export function refundFor(lineAmountPaise: number, lineQty: number, alreadyReturned: number, qty: number): number {
  const upTo = (n: number) => Math.round((lineAmountPaise * n) / lineQty);
  return upTo(alreadyReturned + qty) - upTo(alreadyReturned);
}
