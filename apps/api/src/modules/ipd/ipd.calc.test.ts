import { describe, expect, it } from 'vitest';
import { bedDays, chargeableDates, istDate, lengthOfStay, lineAmountPaise, rentDays, type RoomRentRule } from './ipd.calc';

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
    expect(lineAmountPaise(2, 59, 0, 18, true)).toBe(11800); // MRP: GST already inside
  });
});

describe('room rent day rule', () => {
  const dates = (from: string, to: string, rule: RoomRentRule) => rentDays(from, to, rule).map((d) => d.date);
  const midnight: RoomRentRule = { roomRentDay: 'midnight' };
  const hours24: RoomRentRule = { roomRentDay: 'admission_time' };
  const noon: RoomRentRule = { roomRentDay: 'checkout_time', checkoutTime: '12:00' };

  it('midnight: calendar dates, discharge date not charged (the default)', () => {
    expect(dates('2026-10-07T09:00:00+05:30', '2026-10-10T11:00:00+05:30', midnight)).toEqual(['2026-10-07', '2026-10-08', '2026-10-09']);
    expect(rentDays('2026-10-07T09:00:00+05:30', '2026-10-10T11:00:00+05:30')).toEqual(rentDays('2026-10-07T09:00:00+05:30', '2026-10-10T11:00:00+05:30', midnight));
    expect(dates('2026-10-07T23:00:00+05:30', '2026-10-07T23:30:00+05:30', midnight)).toEqual(['2026-10-07']);
  });

  it('admission time: one day per started 24 hours', () => {
    expect(dates('2026-10-07T09:00:00+05:30', '2026-10-07T20:00:00+05:30', hours24)).toEqual(['2026-10-07']);
    expect(dates('2026-10-07T09:00:00+05:30', '2026-10-08T09:00:00+05:30', hours24)).toEqual(['2026-10-07']);
    expect(dates('2026-10-07T09:00:00+05:30', '2026-10-08T09:01:00+05:30', hours24)).toEqual(['2026-10-07', '2026-10-08']);
    // 23:00 admission, out at 10:00 two days later: 35 hours = 2 days (midnight would also say 2).
    expect(dates('2026-10-07T23:00:00+05:30', '2026-10-09T10:00:00+05:30', hours24)).toEqual(['2026-10-07', '2026-10-08']);
    // Late-night admission, discharged next morning: midnight counts 1, 24-hour blocks count 1 too.
    expect(dates('2026-10-07T23:00:00+05:30', '2026-10-08T08:00:00+05:30', hours24)).toHaveLength(1);
  });

  it('check-out time: staying past the check-out time adds a day', () => {
    expect(dates('2026-10-07T09:00:00+05:30', '2026-10-07T18:00:00+05:30', noon)).toEqual(['2026-10-07']);
    expect(dates('2026-10-07T09:00:00+05:30', '2026-10-08T11:59:00+05:30', noon)).toEqual(['2026-10-07']);
    expect(dates('2026-10-07T09:00:00+05:30', '2026-10-08T12:00:00+05:30', noon)).toEqual(['2026-10-07']);
    expect(dates('2026-10-07T09:00:00+05:30', '2026-10-08T12:30:00+05:30', noon)).toEqual(['2026-10-07', '2026-10-08']);
    expect(dates('2026-10-07T14:00:00+05:30', '2026-10-10T10:00:00+05:30', noon)).toEqual(['2026-10-07', '2026-10-08', '2026-10-09']);
    // Another hospital's check-out time.
    expect(dates('2026-10-07T14:00:00+05:30', '2026-10-10T10:00:00+05:30', { roomRentDay: 'checkout_time', checkoutTime: '09:00' })).toHaveLength(4);
  });

  it('bills each rule-day to the bed held when that day ends', () => {
    const stays = [
      { id: 'icu', bedLabel: 'ICU-1', serviceCode: null, dailyRate: 5000, fromAt: '2026-10-07T09:00:00+05:30', toAt: '2026-10-08T10:00:00+05:30' },
      { id: 'gw', bedLabel: 'GW-4', serviceCode: null, dailyRate: 1000, fromAt: '2026-10-08T10:00:00+05:30', toAt: null },
    ];
    // Noon rule: day 1 ends 08 Oct 12:00, by then the patient is in GW-4.
    expect(bedDays(stays, stays[0]!.fromAt, '2026-10-09T13:00:00+05:30', noon).map((b) => [b.stayId, b.dates])).toEqual([['gw', ['2026-10-07', '2026-10-08', '2026-10-09']]]);
    // 24-hour blocks: the first block ends 08 Oct 09:00, still in the ICU.
    expect(bedDays(stays, stays[0]!.fromAt, '2026-10-09T13:00:00+05:30', hours24).map((b) => [b.stayId, b.dates])).toEqual([
      ['icu', ['2026-10-07']],
      ['gw', ['2026-10-08', '2026-10-09']],
    ]);
  });
});
