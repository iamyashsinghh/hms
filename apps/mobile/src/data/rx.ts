// Prescription helpers: dose-per-day from Indian frequency shorthand, quantity, allergy check and
// validation. Pure so they are unit tested.
import type { CreatePrescription, RxLine } from './types';

export const FREQUENCIES = ['1-0-1', '1-1-1', '1-0-0', '0-0-1', '0-1-0', '1-1-1-1', 'SOS', 'STAT', 'HS'] as const;

const NAMED: Record<string, number> = { OD: 1, HS: 1, BD: 2, BID: 2, TDS: 3, TID: 3, QID: 4, STAT: 1, SOS: 0 };

/** Doses per day for "1-0-1", "½-0-½", "OD", "TDS"…; null when it cannot be worked out. */
export function dosesPerDay(frequency: string): number | null {
  const f = frequency.trim().toUpperCase();
  if (f in NAMED) return NAMED[f] ?? null;
  if (/^[\d½.]+(-[\d½.]+){1,3}$/.test(f)) {
    const total = f.split('-').reduce((sum, part) => sum + (part === '½' ? 0.5 : Number(part)), 0);
    return Number.isFinite(total) ? total : null;
  }
  return null;
}

/** Tablets/units to dispense: doses per day × days, rounded up; STAT is one dose; SOS needs a manual qty. */
export function suggestQty(frequency: string, days: number): number | null {
  const f = frequency.trim().toUpperCase();
  if (f === 'STAT') return 1;
  const perDay = dosesPerDay(frequency);
  if (perDay === null || perDay === 0 || !Number.isFinite(days) || days <= 0) return null;
  return Math.ceil(perDay * days);
}

/** Allergies (from the patient record) that a drug name matches, case-insensitive, either way round. */
export function allergyHits(drugName: string, allergies: readonly string[] | undefined): string[] {
  const drug = drugName.trim().toLowerCase();
  if (!drug || !allergies?.length) return [];
  return allergies.filter((a) => {
    const allergy = a.trim().toLowerCase();
    if (allergy.length < 3) return false;
    return drug.includes(allergy) || allergy.includes(drug.split(/\s+/)[0] ?? drug);
  });
}

export interface RxDraftLine {
  drugName: string;
  dose: string;
  frequency: string;
  days: string;
  qty: string;
  instructions: string;
}

export const emptyLine = (): RxDraftLine => ({ drugName: '', dose: '', frequency: '1-0-1', days: '5', qty: '', instructions: '' });

export interface RxBuildResult {
  ok: boolean;
  /** Error per line index, plus "form" for whole-form errors. */
  errors: Record<string, string>;
  body?: CreatePrescription;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Validates the form and builds the request body. Blank rows are ignored. */
export function buildPrescription(input: {
  patientId: string;
  encounterId?: string | null;
  lines: RxDraftLine[];
  advice: string;
  followUpDate: string;
}): RxBuildResult {
  const errors: Record<string, string> = {};
  const lines: RxLine[] = [];
  input.lines.forEach((l, i) => {
    const blank = !l.drugName.trim() && !l.dose.trim() && !l.qty.trim();
    if (blank) return;
    const days = Number(l.days);
    const qty = l.qty.trim() ? Number(l.qty) : suggestQty(l.frequency, days);
    if (!l.drugName.trim()) errors[i] = 'Enter the medicine name';
    else if (!l.frequency.trim()) errors[i] = 'Choose how often';
    else if (!Number.isInteger(days) || days < 1 || days > 365) errors[i] = 'Days must be 1 to 365';
    else if (qty === null || !Number.isFinite(qty) || qty <= 0) errors[i] = 'Enter the quantity';
    else {
      lines.push({
        drugName: l.drugName.trim(),
        dose: l.dose.trim() || '1 unit',
        frequency: l.frequency.trim(),
        days,
        qty,
        ...(l.instructions.trim() ? { instructions: l.instructions.trim() } : {}),
      });
    }
  });
  if (lines.length === 0 && Object.keys(errors).length === 0) errors.form = 'Add at least one medicine';
  const followUp = input.followUpDate.trim();
  if (followUp && !ISO_DATE.test(followUp)) errors.followUpDate = 'Use YYYY-MM-DD';
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    errors,
    body: {
      patientId: input.patientId,
      ...(input.encounterId ? { encounterId: input.encounterId } : {}),
      lines,
      ...(input.advice.trim() ? { advice: input.advice.trim() } : {}),
      ...(followUp ? { followUpDate: followUp } : {}),
    },
  };
}
