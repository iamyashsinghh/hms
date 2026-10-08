import { z } from 'zod';

/**
 * Reusable field validators. Every module should build its forms from these so that the
 * web form (zodResolver) and the API (ZodPipe) give the same, clear error messages.
 */

/** Dates are compared in hospital time (India), as YYYY-MM-DD strings. */
export const HOSPITAL_TIMEZONE = 'Asia/Kolkata';

/** Today's date in India time, as YYYY-MM-DD. `offsetDays` shifts it (e.g. -1 = yesterday). */
export function todayIso(offsetDays = 0, now: Date = new Date()): string {
  const d = new Date(now.getTime() + offsetDays * 86_400_000);
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone: HOSPITAL_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** Adds whole years to a YYYY-MM-DD date. */
function shiftYears(iso: string, years: number): string {
  const [y, rest] = [Number(iso.slice(0, 4)), iso.slice(4)];
  return `${String(y + years).padStart(4, '0')}${rest}`;
}

// ---------- text ----------

/** Required trimmed text with readable messages. */
export const requiredText = (label: string, max = 200, min = 1) =>
  z
    .string({ error: `Enter ${label}` })
    .trim()
    .min(min, { message: min <= 1 ? `Enter ${label}` : `${capitalise(label)} needs at least ${min} characters`, abort: true })
    .max(max, `${capitalise(label)} can be at most ${max} characters`);

/** A person's name: letters (any script), spaces and . ' - only. */
export const personName = (label = 'the name', max = 100) =>
  requiredText(label, max).regex(/^[\p{L}\p{M}][\p{L}\p{M} .'-]*$/u, `${capitalise(label)} can only have letters, spaces and . ' -`);

function capitalise(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------- identifiers and contact ----------

export const MOBILE_REGEX = /^[6-9]\d{9}$/;
export const PINCODE_REGEX = /^[1-9]\d{5}$/;
export const ABHA_NUMBER_REGEX = /^\d{14}$/;
export const GSTIN_REGEX = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const PAN_REGEX = /^[A-Z]{5}\d{4}[A-Z]$/;
export const HSN_REGEX = /^\d{4,8}$/;
export const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;

/** Indian mobile: 10 digits starting 6-9. Accepts +91 / 0 prefixes and spaces or dashes, stores 10 digits. */
export const indianMobile = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s-]/g, '').replace(/^(\+91|91(?=\d{10}$)|0(?=\d{10}$))/, ''))
  .pipe(z.string().regex(MOBILE_REGEX, 'Enter a 10-digit Indian mobile number'));

/** A landline or mobile: digits with optional +, spaces, dashes and brackets; 6 to 15 digits. */
export const phoneNumber = z
  .string()
  .trim()
  .max(20, 'Phone number is too long')
  .refine((v) => /^\+?[\d\s()-]+$/.test(v) && (v.match(/\d/g)?.length ?? 0) >= 6 && (v.match(/\d/g)?.length ?? 0) <= 15, 'Enter a valid phone number');

export const emailAddress = z.string().trim().toLowerCase().max(254, 'Email is too long').pipe(z.email('Enter a valid email address'));
export const pincode = z.string().trim().regex(PINCODE_REGEX, 'Enter a 6-digit PIN code');
export const abhaNumber = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s-]/g, ''))
  .pipe(z.string().regex(ABHA_NUMBER_REGEX, 'ABHA number has 14 digits'));
export const gstin = z.string().trim().toUpperCase().regex(GSTIN_REGEX, 'Enter a valid 15-character GSTIN');
export const pan = z.string().trim().toUpperCase().regex(PAN_REGEX, 'Enter a valid PAN (5 letters, 4 digits, 1 letter)');
export const hsnCode = z.string().trim().regex(HSN_REGEX, 'HSN is 4 to 8 digits');
export const ifsc = z.string().trim().toUpperCase().regex(IFSC_REGEX, 'Enter a valid 11-character IFSC');

/** Turns '' (empty HTML input) into undefined so optional fields stay optional. */
export const blankToUndefined = <T extends z.ZodType>(schema: T) => z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), schema);

// ---------- numbers ----------

const twoDecimals = (v: number) => Math.abs(Math.round(v * 100) - v * 100) < 1e-6;

/** Money in rupees: 0 or more, at most 2 decimals. */
export const money = (max = 99_999_999_999.99) =>
  z.coerce
    .number({ error: 'Enter an amount' })
    .refine(Number.isFinite, 'Enter an amount')
    .min(0, 'Amount cannot be negative')
    .max(max, `Amount cannot be more than ${max.toLocaleString('en-IN')}`)
    .refine(twoDecimals, 'At most 2 decimal places');
export const positiveMoney = (max?: number) => money(max).refine((v) => v > 0, 'Must be more than 0');

/** A count of units: a whole number from `min` (default 1). */
export const quantity = (min = 1, max = 1_000_000) =>
  z.coerce
    .number({ error: 'Enter a quantity' })
    .int('Quantity must be a whole number')
    .min(min, min === 1 ? 'Quantity must be at least 1' : `Quantity must be at least ${min}`)
    .max(max, `Quantity cannot be more than ${max.toLocaleString('en-IN')}`);

export const percent = z.coerce.number().min(0, 'Cannot be less than 0%').max(100, 'Cannot be more than 100%').refine(twoDecimals, 'At most 2 decimal places');

// ---------- dates ----------

/** A YYYY-MM-DD date that is a real calendar date. */
export const isoDate = z.iso.date({ error: 'Enter a valid date' });
/** An ISO date-time with an offset. */
export const isoDateTime = z.iso.datetime({ offset: true, error: 'Enter a valid date and time' });

/** Today or earlier (India time). */
export const pastOrTodayDate = (label = 'Date') => isoDate.refine((d) => d <= todayIso(), `${label} cannot be in the future`);
/** Today or later (India time). */
export const todayOrFutureDate = (label = 'Date') => isoDate.refine((d) => d >= todayIso(), `${label} cannot be in the past`);

/** Date of birth: not in the future and not more than 150 years ago. */
export const dateOfBirth = isoDate
  .refine((d) => d <= todayIso(), 'Date of birth cannot be in the future')
  .refine((d) => d >= shiftYears(todayIso(), -150), 'Date of birth cannot be more than 150 years ago');

/** A batch expiry date. Past dates are allowed only where the caller says so (e.g. recording old stock). */
export const expiryDate = isoDate.refine((d) => d >= '2000-01-01' && d <= '2100-12-31', 'Enter a valid expiry date');

/** A date-time no more than `graceMinutes` in the future (for "when did this happen" fields). */
export const notFutureDateTime = (label = 'Time', graceMinutes = 5) =>
  isoDateTime.refine((v) => Date.parse(v) <= Date.now() + graceMinutes * 60_000, `${label} cannot be in the future`);

/**
 * For `.refine` / `.superRefine` on objects: true when either end is missing or `to >= from`.
 * Works for YYYY-MM-DD strings and ISO date-times.
 */
export const datesInOrder = (from?: string | null, to?: string | null) => !from || !to || to >= from;
export const END_BEFORE_START = 'End date is before start date';

// ---------- friendlier default messages ----------

/**
 * Zod's built-in messages ("Too small: expected string to have >=1 characters") read badly on a form.
 * This replaces the common ones everywhere @hms/shared is loaded (web, API, mobile).
 * Messages given in a schema always win over these.
 */
z.config({
  customError: (iss) => {
    switch (iss.code) {
      case 'invalid_type':
        if (iss.input === undefined || iss.input === null || iss.input === '') return 'This field is required';
        if (iss.expected === 'number') return 'Enter a number';
        if (iss.expected === 'int') return 'Must be a whole number';
        if (iss.expected === 'date') return 'Enter a valid date';
        return undefined;
      case 'too_small':
        if (iss.origin === 'string') return Number(iss.minimum) <= 1 ? 'This field is required' : `Enter at least ${iss.minimum} characters`;
        if (iss.origin === 'number') return iss.inclusive === false ? `Must be more than ${iss.minimum}` : `Must be at least ${iss.minimum}`;
        if (iss.origin === 'array') return Number(iss.minimum) <= 1 ? 'Add at least one' : `Add at least ${iss.minimum}`;
        return undefined;
      case 'too_big':
        if (iss.origin === 'string') return `Enter at most ${iss.maximum} characters`;
        if (iss.origin === 'number') return iss.inclusive === false ? `Must be less than ${iss.maximum}` : `Cannot be more than ${iss.maximum}`;
        if (iss.origin === 'array') return `Add at most ${iss.maximum}`;
        return undefined;
      case 'invalid_format':
        if (iss.format === 'email') return 'Enter a valid email address';
        if (iss.format === 'date') return 'Enter a valid date (YYYY-MM-DD)';
        if (iss.format === 'datetime') return 'Enter a valid date and time';
        if (iss.format === 'url') return 'Enter a valid URL';
        if (iss.format === 'uuid') return 'Pick a valid record';
        if (iss.format === 'regex') return 'Not in the right format';
        return undefined;
      case 'invalid_value':
        return 'Pick one of the listed options';
      case 'not_multiple_of':
        return iss.divisor === 1 ? 'Must be a whole number' : undefined;
      default:
        return undefined;
    }
  },
});
