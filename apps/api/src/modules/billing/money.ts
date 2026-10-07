/**
 * Invoice arithmetic in integer paise, so totals never drift. Postgres numeric(14,2) values come
 * back from Drizzle as strings; `paise()` reads them and `rupees()` writes them back.
 */

export const paise = (v: string | number | null | undefined): number => Math.round(Number(v ?? 0) * 100);
export const rupees = (p: number): string => (p / 100).toFixed(2);
export const toNumber = (v: string | number | null | undefined): number => Number(v ?? 0);

export interface LineIn {
  qty: number;
  /** paise */
  unitPrice: number;
  /** paise, for the whole line */
  discount: number;
  /** percent, e.g. 18 */
  taxRate: number;
  priceIncludesTax?: boolean;
}

export interface LineOut {
  gross: number;
  discount: number;
  taxable: number;
  tax: number;
  total: number;
}

export function computeLine(l: LineIn): LineOut {
  const gross = Math.round(l.qty * l.unitPrice);
  if (l.discount > gross) throw new RangeError('Discount is more than the line amount');
  const net = gross - l.discount;
  let taxable: number;
  let tax: number;
  if (l.priceIncludesTax) {
    taxable = Math.round((net * 100) / (100 + l.taxRate));
    tax = net - taxable;
  } else {
    taxable = net;
    tax = Math.round((taxable * l.taxRate) / 100);
  }
  return { gross, discount: l.discount, taxable, tax, total: taxable + tax };
}

export interface Totals {
  subtotal: number;
  discountTotal: number;
  taxableTotal: number;
  taxTotal: number;
  cgst: number;
  sgst: number;
  igst: number;
  roundOff: number;
  total: number;
}

/** Intra-state supply splits GST into equal CGST + SGST; inter-state is IGST. Rounds to the rupee when asked. */
export function computeTotals(lines: LineOut[], supplyType: 'intra' | 'inter', roundToRupee: boolean): Totals {
  const sum = (f: (l: LineOut) => number) => lines.reduce((a, l) => a + f(l), 0);
  const subtotal = sum((l) => l.gross);
  const discountTotal = sum((l) => l.discount);
  const taxableTotal = sum((l) => l.taxable);
  const taxTotal = sum((l) => l.tax);
  const cgst = supplyType === 'intra' ? Math.floor(taxTotal / 2) : 0;
  const sgst = supplyType === 'intra' ? taxTotal - cgst : 0;
  const igst = supplyType === 'inter' ? taxTotal : 0;
  const exact = taxableTotal + taxTotal;
  const total = roundToRupee ? Math.round(exact / 100) * 100 : exact;
  return { subtotal, discountTotal, taxableTotal, taxTotal, cgst, sgst, igst, roundOff: total - exact, total };
}

/** NPCI UPI deep link; the web renders it as a QR code on the bill. */
export function upiLink(vpa: string, payee: string, amountPaise: number, note: string): string {
  const q = new URLSearchParams({ pa: vpa, pn: payee, am: rupees(amountPaise), cu: 'INR', tn: note });
  return `upi://pay?${q.toString().replace(/\+/g, '%20')}`;
}
