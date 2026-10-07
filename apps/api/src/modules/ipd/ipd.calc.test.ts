import { describe, expect, it } from 'vitest';
import { bedDays, chargeableDates, istDate, lengthOfStay, lineAmountPaise } from './ipd.calc';

// Times are written in IST (+05:30) for readability.
describe('IPD day rules', () => {
  it('uses the India calendar date', () => {
    expect(istDate('2026-10-06T20:00:00Z')).toBe('2026-10-07'); // 01:30 IST next day
    expect(istDate('2026-10-07T10:00:00+05:30')).toBe('2026-10-07');
  });

  it('charges at least one day, and does not charge the discharge date', () => {
    expect(chargeableDates('2026-10-07T09:00:00+05:30', '2026-10-07T18:00:00+05:30')).toEqual(['2026-10-07']);
    expect(chargeableDates('2026-10-07T23:30:00+05:30', '2026-10-08T00:30:00+05:30')).toEqual(['2026-10-07']);
    expect(chargeableDates('2026-10-07T09:00:00+05:30', '2026-10-10T11:00:00+05:30')).toEqual(['2026-10-07', '2026-10-08', '2026-10-09']);
    expect(lengthOfStay('2026-10-07T09:00:00+05:30', '2026-10-10T11:00:00+05:30')).toBe(3);
  });

  it('bills each day to the bed occupied at midnight', () => {
    const stays = [
      { id: 'icu', bedLabel: 'ICU-1', serviceCode: null, dailyRate: 5000, fromAt: '2026-10-07T09:00:00+05:30', toAt: '2026-10-08T15:00:00+05:30' },
      { id: 'gw', bedLabel: 'GW-4', serviceCode: null, dailyRate: 1000, fromAt: '2026-10-08T15:00:00+05:30', toAt: null },
    ];
    const res = bedDays(stays, '2026-10-07T09:00:00+05:30', '2026-10-11T10:00:00+05:30');
    expect(res).toEqual([
      { stayId: 'icu', bedLabel: 'ICU-1', serviceCode: null, dailyRate: 5000, dates: ['2026-10-07'] },
      { stayId: 'gw', bedLabel: 'GW-4', serviceCode: null, dailyRate: 1000, dates: ['2026-10-08', '2026-10-09', '2026-10-10'] },
    ]);
  });

  it('same-day transfer and discharge bills the last bed once', () => {
    const stays = [
      { id: 'a', bedLabel: 'A', serviceCode: null, dailyRate: 100, fromAt: '2026-10-07T09:00:00+05:30', toAt: '2026-10-07T11:00:00+05:30' },
      { id: 'b', bedLabel: 'B', serviceCode: null, dailyRate: 200, fromAt: '2026-10-07T11:00:00+05:30', toAt: '2026-10-07T17:00:00+05:30' },
    ];
    expect(bedDays(stays, stays[0]!.fromAt, '2026-10-07T17:00:00+05:30')).toEqual([
      { stayId: 'b', bedLabel: 'B', serviceCode: null, dailyRate: 200, dates: ['2026-10-07'] },
    ]);
  });

  it('computes line amounts in paise with discount and GST', () => {
    expect(lineAmountPaise(2, 150.5)).toBe(30100);
    expect(lineAmountPaise(1, 1000, 100, 18)).toBe(106200);
    expect(lineAmountPaise(1, 50, 80)).toBe(0);
  });
});
