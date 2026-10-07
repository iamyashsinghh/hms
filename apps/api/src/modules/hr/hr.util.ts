/** Small helpers shared by the HR services. Dates are YYYY-MM-DD strings in hospital time (IST). */

export const TZ_OFFSET = '+05:30';

export const num = (v: string | number | null | undefined): number => Number(v ?? 0);
export const money = (v: number): string => v.toFixed(2);
export const round2 = (v: number): number => Math.round(v * 100) / 100;

/** Today's date in India. */
export const todayIST = (now = new Date()): string => now.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

/** A wall-clock time on a hospital date, as an absolute instant. */
export const istInstant = (date: string, hhmm: string): Date => new Date(`${date}T${hhmm.slice(0, 5)}:00${TZ_OFFSET}`);

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Inclusive number of days between two dates. */
export const daysBetween = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;

export function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** '2026-10' -> { start: '2026-10-01', end: '2026-10-31', days: 31 } */
export function monthRange(month: string): { start: string; end: string; days: number } {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start: `${month}-01`, end: `${month}-${String(days).padStart(2, '0')}`, days };
}

/** 'HH:MM:SS' or 'HH:MM' -> minutes after midnight */
export const minutesOf = (t: string): number => {
  const [h, m] = t.split(':').map(Number) as [number, number];
  return h * 60 + m;
};

/** Length of a shift in minutes (handles overnight shifts), minus its break. */
export function shiftMinutes(start: string, end: string, breakMinutes = 0): number {
  let span = minutesOf(end) - minutesOf(start);
  if (span <= 0) span += 24 * 60;
  return Math.max(0, span - breakMinutes);
}

export const hhmmOf = (t: string): string => t.slice(0, 5);

/** The instant as HH:MM in India. */
export const istClock = (iso: string | Date): string =>
  new Date(iso).toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false });
