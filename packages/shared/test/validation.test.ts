import { describe, expect, it } from 'vitest';
import {
  abhaNumber,
  dateOfBirth,
  datesInOrder,
  emailAddress,
  gstin,
  indianMobile,
  money,
  notFutureDateTime,
  pastOrTodayDate,
  personName,
  phoneNumber,
  pincode,
  quantity,
  todayIso,
  todayOrFutureDate,
} from '../src/validation';

const ok = (s: { safeParse: (v: unknown) => { success: boolean } }, v: unknown) => s.safeParse(v).success;

describe('shared validators', () => {
  it('todayIso uses India time', () => {
    // 20:00 UTC on 1 Jan is 01:30 on 2 Jan in India.
    expect(todayIso(0, new Date('2026-01-01T20:00:00Z'))).toBe('2026-01-02');
    expect(todayIso(-1, new Date('2026-01-01T20:00:00Z'))).toBe('2026-01-01');
  });

  it('mobile accepts Indian formats and normalises them', () => {
    expect(indianMobile.parse('+91 98765 43210')).toBe('9876543210');
    expect(indianMobile.parse('09876543210')).toBe('9876543210');
    expect(ok(indianMobile, '12345')).toBe(false);
    expect(ok(indianMobile, '5876543210')).toBe(false);
  });

  it('phone, email, pincode, ABHA, GSTIN', () => {
    expect(ok(phoneNumber, '022-2345 6789')).toBe(true);
    expect(ok(phoneNumber, 'call me')).toBe(false);
    expect(emailAddress.parse(' A@B.COM ')).toBe('a@b.com');
    expect(ok(emailAddress, 'abc@')).toBe(false);
    expect(ok(pincode, '560001')).toBe(true);
    expect(ok(pincode, '5600')).toBe(false);
    expect(ok(pincode, '060001')).toBe(false);
    expect(abhaNumber.parse('12-3456-7890-1234')).toBe('12345678901234');
    expect(ok(abhaNumber, '12-3456')).toBe(false);
    expect(gstin.parse('27aapfu0939f1zv')).toBe('27AAPFU0939F1ZV');
    expect(ok(gstin, '12345')).toBe(false);
  });

  it('names', () => {
    expect(ok(personName(), 'Aarav')).toBe(true);
    expect(ok(personName(), "D'Souza-Rao Jr.")).toBe(true);
    expect(ok(personName(), 'आरव')).toBe(true);
    expect(ok(personName(), '  ')).toBe(false);
    expect(ok(personName(), 'R2D2')).toBe(false);
  });

  it('money and quantity', () => {
    expect(ok(money(), '12.34')).toBe(true);
    expect(ok(money(), -1)).toBe(false);
    expect(ok(money(), 12.345)).toBe(false);
    expect(ok(money(), 'abc')).toBe(false);
    expect(ok(quantity(), 0)).toBe(false);
    expect(ok(quantity(), 1.5)).toBe(false);
    expect(ok(quantity(0), 0)).toBe(true);
  });

  it('dates', () => {
    const today = todayIso();
    const tomorrow = todayIso(1);
    const yesterday = todayIso(-1);
    expect(ok(dateOfBirth, today)).toBe(true);
    expect(ok(dateOfBirth, tomorrow)).toBe(false);
    expect(ok(dateOfBirth, '1800-01-01')).toBe(false);
    expect(ok(dateOfBirth, '2026-02-30')).toBe(false);
    expect(ok(pastOrTodayDate(), tomorrow)).toBe(false);
    expect(ok(todayOrFutureDate(), yesterday)).toBe(false);
    expect(ok(todayOrFutureDate(), today)).toBe(true);
    expect(datesInOrder('2026-01-02', '2026-01-01')).toBe(false);
    expect(datesInOrder('2026-01-01', null)).toBe(true);
    expect(ok(notFutureDateTime(), new Date(Date.now() + 3_600_000).toISOString())).toBe(false);
    expect(ok(notFutureDateTime(), new Date().toISOString())).toBe(true);
  });
});
