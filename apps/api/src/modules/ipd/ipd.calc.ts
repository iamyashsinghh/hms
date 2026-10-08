/**
 * Pure IPD money and day rules (unit-tested in ipd.calc.test.ts).
 *
 * Bed rent follows the hospital's billing rule `roomRentDay` (India time), always at least one day:
 *  - 'midnight' (default): every calendar date from the admission date up to, but not including, the
 *    discharge date.
 *  - 'admission_time': one day per started 24 hours from the admission time.
 *  - 'checkout_time': hotel style. The first day runs until the check-out time (e.g. 12:00) on the day
 *    after admission; each check-out time passed after that adds a day.
 * Each charged day goes to the bed the patient was in at the end of that day, so a transfer in the
 * afternoon bills the new bed. A running bill uses "now" as the discharge time, i.e. what the patient
 * would pay if discharged now.
 */

const IST_OFFSET_MS = 330 * 60 * 1000;

/** Calendar date (YYYY-MM-DD) in India for an instant. */
export function istDate(at: string | Date): string {
  const t = typeof at === 'string' ? Date.parse(at) : at.getTime();
  return new Date(t + IST_OFFSET_MS).toISOString().slice(0, 10);
}

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Last millisecond of an IST date, as epoch ms. */
function endOfIstDay(date: string): number {
  return Date.parse(`${date}T23:59:59.999+05:30`);
}

/** Dates charged for a stay from `from` to `to` (exclusive end date, minimum one day). */
export function chargeableDates(from: string, to: string): string[] {
  const start = istDate(from);
  const end = istDate(to);
  const out: string[] = [];
  for (let d = start; d < end; d = addDays(d, 1)) out.push(d);
  return out.length ? out : [start];
}

/** Calendar days in hospital so far, at least 1 (for display). */
export function lengthOfStay(admittedAt: string, until: string): number {
  return chargeableDates(admittedAt, until).length;
}

export interface StayForBilling {
  id: string;
  bedLabel: string;
  serviceCode: string | null;
  dailyRate: number;
  fromAt: string;
  toAt: string | null;
}

export interface BedDays {
  stayId: string;
  bedLabel: string;
  serviceCode: string | null;
  dailyRate: number;
  dates: string[];
}

export type RoomRentDay = 'midnight' | 'admission_time' | 'checkout_time';
export interface RoomRentRule {
  roomRentDay: RoomRentDay;
  /** HH:MM India time, for 'checkout_time'. */
  checkoutTime?: string;
}
const MIDNIGHT: RoomRentRule = { roomRentDay: 'midnight' };
const DAY_MS = 24 * 60 * 60 * 1000;

/** The charged days of a stay under a rule: a label date (IST) and the instant the day ends (epoch ms). */
export function rentDays(admittedAt: string, until: string, rule: RoomRentRule = MIDNIGHT): { date: string; endsAt: number }[] {
  const from = Date.parse(admittedAt);
  const to = Math.max(Date.parse(until), from);
  if (rule.roomRentDay === 'admission_time') {
    const n = Math.max(1, Math.ceil((to - from) / DAY_MS));
    return Array.from({ length: n }, (_, k) => ({ date: istDate(new Date(from + k * DAY_MS)), endsAt: from + (k + 1) * DAY_MS - 1 }));
  }
  if (rule.roomRentDay === 'checkout_time') {
    const time = rule.checkoutTime ?? '12:00';
    const checkout = (date: string) => Date.parse(`${date}T${time}:00+05:30`);
    const out: { date: string; endsAt: number }[] = [];
    // Day k is labelled admission date + k and ends at the check-out time of the next date.
    for (let date = istDate(admittedAt); ; date = addDays(date, 1)) {
      const endsAt = checkout(addDays(date, 1));
      out.push({ date, endsAt: endsAt - 1 });
      if (to <= endsAt) break;
    }
    return out;
  }
  return chargeableDates(admittedAt, until).map((date) => ({ date, endsAt: endOfIstDay(date) }));
}

/** Assign each charged day of the admission to one stay. Stays must be ordered by fromAt. */
export function bedDays(stays: StayForBilling[], admittedAt: string, until: string, rule: RoomRentRule = MIDNIGHT): BedDays[] {
  if (!stays.length) return [];
  const byStay = new Map<string, BedDays>();
  for (const { date, endsAt } of rentDays(admittedAt, until, rule)) {
    const eod = Math.min(endsAt, Date.parse(until));
    const active =
      stays.find((s) => Date.parse(s.fromAt) <= eod && (s.toAt === null || Date.parse(s.toAt) > eod)) ??
      [...stays].reverse().find((s) => Date.parse(s.fromAt) <= eod) ??
      stays[0]!;
    let entry = byStay.get(active.id);
    if (!entry) {
      entry = { stayId: active.id, bedLabel: active.bedLabel, serviceCode: active.serviceCode, dailyRate: active.dailyRate, dates: [] };
      byStay.set(active.id, entry);
    }
    entry.dates.push(date);
  }
  return stays.map((s) => byStay.get(s.id)).filter((e): e is BedDays => !!e);
}

/** Rupees → integer paise. */
export const paise = (v: number | string): number => Math.round(Number(v) * 100);
/** Integer paise → rupees number. */
export const rupees = (p: number): number => p / 100;

/** Line amount in paise: qty × price − discount, plus GST on the taxable amount unless the price includes it. */
export function lineAmountPaise(qty: number, unitPrice: number, discount = 0, taxRate = 0, priceIncludesTax = false): number {
  const taxable = Math.max(0, Math.round(qty * paise(unitPrice)) - paise(discount));
  return priceIncludesTax ? taxable : taxable + Math.round((taxable * taxRate) / 100);
}

/** Consecutive dates from `from` to `to`, both included. */
export function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}
