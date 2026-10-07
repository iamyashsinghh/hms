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

// Mirrors the EMR server check (apps/api/src/modules/emr/allergy.ts) so the doctor sees the warning while
// typing; the server stays the authority and rejects unmatched lines with 409 allergy_conflict.
const CLASSES: Record<string, string[]> = {
  penicillin: ['penicillin', 'amoxicillin', 'amoxycillin', 'ampicillin', 'cloxacillin', 'piperacillin', 'augmentin', 'amoxiclav', 'clavam', 'mox'],
  cephalosporin: ['cef', 'ceph'],
  sulfa: ['sulfa', 'sulpha', 'sulfamethoxazole', 'cotrimoxazole', 'co-trimoxazole', 'septran', 'bactrim'],
  nsaid: ['ibuprofen', 'diclofenac', 'aspirin', 'naproxen', 'aceclofenac', 'ketorolac', 'mefenamic', 'piroxicam', 'etoricoxib', 'nimesulide', 'brufen', 'combiflam', 'voveran'],
  aspirin: ['aspirin', 'ecosprin', 'disprin'],
  quinolone: ['floxacin', 'ciplox'],
  macrolide: ['azithromycin', 'clarithromycin', 'erythromycin', 'azithral'],
  tetracycline: ['tetracycline', 'doxycycline', 'minocycline'],
  opioid: ['morphine', 'codeine', 'tramadol', 'fentanyl', 'pethidine', 'tapentadol'],
  paracetamol: ['paracetamol', 'acetaminophen', 'crocin', 'dolo', 'calpol'],
};
const IGNORE = new Set(['nkda', 'nka', 'none', 'nil', 'no known allergies', 'na', '-']);
const norm = (v: string) => v.toLowerCase().replace(/[^a-z0-9 -]/g, ' ').trim();

/** Recorded allergies a drug matches, by name or drug class ("penicillin" flags amoxicillin). */
export function allergyHits(drugName: string, allergies: readonly string[] | undefined): string[] {
  const d = norm(drugName);
  if (!d || !allergies?.length) return [];
  return allergies.filter((raw) => {
    const a = norm(raw);
    if (!a || IGNORE.has(a)) return false;
    const key = Object.keys(CLASSES).find((k) => a.includes(k) || k.includes(a.replace(/s$/, '')));
    const needles = key ? [a, ...(CLASSES[key] ?? [])] : [a];
    return needles.some((n) => n.length >= 3 && (d.includes(n) || (d.length >= 4 && n.includes(d))));
  });
}

export interface RxDraftLine {
  drugName: string;
  dose: string;
  frequency: string;
  days: string;
  qty: string;
  instructions: string;
  /** Why the doctor prescribes despite a matching allergy (the EMR API requires ≥ 3 characters). */
  overrideReason: string;
}

export const emptyLine = (): RxDraftLine => ({
  drugName: '',
  dose: '',
  frequency: '1-0-1',
  days: '5',
  qty: '',
  instructions: '',
  overrideReason: '',
});

/** Form rows from saved lines (an open consultation's prescription or a favourite). */
export function draftFromLines(lines: readonly RxLine[]): RxDraftLine[] {
  return lines.map((l) => ({
    drugName: l.drugName,
    dose: l.dose,
    frequency: l.frequency,
    days: l.days ? String(l.days) : '',
    qty: l.qty ? String(l.qty) : '',
    instructions: l.instructions ?? '',
    overrideReason: l.allergyOverrideReason ?? '',
  }));
}

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
  /** Recorded allergies; a matching line needs an override reason. */
  allergies?: readonly string[];
  sign?: boolean;
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
    else if (allergyHits(l.drugName, input.allergies).length > 0 && l.overrideReason.trim().length < 3)
      errors[i] = 'Allergy: give a reason to prescribe anyway';
    else {
      lines.push({
        drugName: l.drugName.trim(),
        dose: l.dose.trim() || '1 unit',
        frequency: l.frequency.trim(),
        days,
        qty,
        ...(l.instructions.trim() ? { instructions: l.instructions.trim() } : {}),
        ...(l.overrideReason.trim() ? { allergyOverrideReason: l.overrideReason.trim() } : {}),
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
      ...(input.sign ? { sign: true } : {}),
    },
  };
}
