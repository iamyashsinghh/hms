import { describe, expect, it } from 'vitest';
import { computeLine, computeTotals, paise, rupees, upiLink } from './money';

describe('billing money', () => {
  it('converts between numeric strings and paise', () => {
    expect(paise('1234.56')).toBe(123456);
    expect(paise(0.1 + 0.2)).toBe(30);
    expect(rupees(123456)).toBe('1234.56');
  });

  it('computes tax-exclusive lines', () => {
    expect(computeLine({ qty: 2, unitPrice: 50000, discount: 10000, taxRate: 18 })).toEqual({
      gross: 100000,
      discount: 10000,
      taxable: 90000,
      tax: 16200,
      total: 106200,
    });
  });

  it('backs GST out of tax-inclusive prices (MRP)', () => {
    const l = computeLine({ qty: 1, unitPrice: 11200, discount: 0, taxRate: 12, priceIncludesTax: true });
    expect(l).toMatchObject({ taxable: 10000, tax: 1200, total: 11200 });
  });

  it('rejects a discount larger than the line', () => {
    expect(() => computeLine({ qty: 1, unitPrice: 100, discount: 200, taxRate: 0 })).toThrow();
  });

  it('splits CGST/SGST, uses IGST inter-state, and rounds to the rupee', () => {
    const lines = [computeLine({ qty: 1, unitPrice: 33333, discount: 0, taxRate: 5 }), computeLine({ qty: 3, unitPrice: 1050, discount: 0, taxRate: 0 })];
    const intra = computeTotals(lines, 'intra', true);
    expect(intra.taxTotal).toBe(1667);
    expect(intra.cgst + intra.sgst).toBe(1667);
    expect(intra.total % 100).toBe(0);
    expect(intra.total - intra.roundOff).toBe(intra.taxableTotal + intra.taxTotal);
    const inter = computeTotals(lines, 'inter', false);
    expect(inter).toMatchObject({ cgst: 0, sgst: 0, igst: 1667, roundOff: 0 });
  });

  it('builds a UPI link', () => {
    expect(upiLink('city@okhdfc', 'City Hospital', 50050, 'INV000001')).toBe(
      'upi://pay?pa=city%40okhdfc&pn=City%20Hospital&am=500.50&cu=INR&tn=INV000001',
    );
  });
});
