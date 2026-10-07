import { describe, expect, it } from 'vitest';
import { computePayslip } from './payroll.calc';

const base = { daysInMonth: 30, employedDays: 30, lopDays: 0, basic: 0, hra: 0, otherAllowances: 0, pfApplicable: false, esiApplicable: false, professionalTax: 0, tds: 0 };

describe('computePayslip', () => {
  it('pays the full structure for a full month', () => {
    const s = computePayslip({ ...base, basic: 20000, hra: 8000, otherAllowances: 2000, pfApplicable: true, professionalTax: 200 });
    expect(s).toMatchObject({ payableDays: 30, gross: 30000, pfEmployee: 1800, pfEmployer: 1800, esiEmployee: 0, professionalTax: 200 });
    expect(s.netPay).toBe(30000 - 1800 - 200);
  });

  it('pro-rates for loss-of-pay days and caps PF at the wage ceiling', () => {
    const s = computePayslip({ ...base, basic: 30000, hra: 0, pfApplicable: true, lopDays: 3 });
    expect(s.payableDays).toBe(27);
    expect(s.basic).toBe(27000);
    expect(s.pfEmployee).toBe(1800);
  });

  it('applies ESI while gross is within the ceiling and rounds it up', () => {
    const s = computePayslip({ ...base, basic: 10000, hra: 4000, otherAllowances: 1001, esiApplicable: true });
    // 15001 * 0.75% = 112.51 -> 113, employer 3.25% = 487.53 -> 488
    expect(s.esiEmployee).toBe(113);
    expect(s.esiEmployer).toBe(488);
    const high = computePayslip({ ...base, basic: 15000, hra: 7000, esiApplicable: true });
    expect(high.esiEmployee).toBe(0);
  });

  it('handles half days, mid-month joiners and adjustments', () => {
    const s = computePayslip({ ...base, daysInMonth: 31, employedDays: 16, lopDays: 0.5, basic: 31000, otherEarnings: 500, otherDeductions: 250, tds: 100 });
    expect(s.payableDays).toBe(15.5);
    expect(s.basic).toBe(15500);
    expect(s.gross).toBe(16000);
    expect(s.totalDeductions).toBe(350);
    expect(s.netPay).toBe(15650);
  });

  it('skips professional tax when nothing is payable', () => {
    const s = computePayslip({ ...base, basic: 10000, lopDays: 30, professionalTax: 200 });
    expect(s).toMatchObject({ payableDays: 0, gross: 0, professionalTax: 0, netPay: 0 });
  });
});
