import { describe, expect, it } from 'vitest';
import { allergyHits, buildPrescription, dosesPerDay, draftFromLines, emptyLine, suggestQty } from '@/data/rx';

describe('dosesPerDay', () => {
  it('reads Indian shorthand', () => {
    expect(dosesPerDay('1-0-1')).toBe(2);
    expect(dosesPerDay('1-1-1')).toBe(3);
    expect(dosesPerDay('1-1-1-1')).toBe(4);
    expect(dosesPerDay('½-0-½')).toBe(1);
    expect(dosesPerDay('0-0-1')).toBe(1);
  });
  it('reads Latin abbreviations', () => {
    expect(dosesPerDay('od')).toBe(1);
    expect(dosesPerDay('BD')).toBe(2);
    expect(dosesPerDay('TDS')).toBe(3);
    expect(dosesPerDay('SOS')).toBe(0);
  });
  it('returns null for free text', () => {
    expect(dosesPerDay('as directed')).toBeNull();
  });
});

describe('suggestQty', () => {
  it('multiplies doses by days and rounds up', () => {
    expect(suggestQty('1-0-1', 5)).toBe(10);
    expect(suggestQty('½-0-½', 3)).toBe(3);
    expect(suggestQty('½-0-0', 3)).toBe(2);
  });
  it('STAT is one dose; SOS needs a manual quantity', () => {
    expect(suggestQty('STAT', 5)).toBe(1);
    expect(suggestQty('SOS', 5)).toBeNull();
  });
  it('rejects bad days', () => {
    expect(suggestQty('1-0-1', 0)).toBeNull();
    expect(suggestQty('1-0-1', Number.NaN)).toBeNull();
  });
});

describe('allergyHits (same rules as the EMR server)', () => {
  it('matches by name, case-insensitively', () => {
    expect(allergyHits('Tab Amoxicillin 500', ['amoxicillin'])).toEqual(['amoxicillin']);
    expect(allergyHits('Cap Amoxyclav', ['Sulfa'])).toEqual([]);
  });
  it('matches by drug class and Indian brand names', () => {
    expect(allergyHits('Tab Augmentin 625', ['Penicillin'])).toEqual(['Penicillin']);
    expect(allergyHits('Tab Combiflam', ['NSAIDs'])).toEqual(['NSAIDs']);
    expect(allergyHits('Tab Dolo 650', ['Paracetamol'])).toEqual(['Paracetamol']);
    expect(allergyHits('Tab Ciplox 500', ['Quinolones'])).toEqual(['Quinolones']);
  });
  it('ignores NKDA-style entries, tiny strings and empty drugs', () => {
    expect(allergyHits('Tab Paracetamol', ['NKDA', 'none', 'xy'])).toEqual([]);
    expect(allergyHits('', ['penicillin'])).toEqual([]);
    expect(allergyHits('Tab X', undefined)).toEqual([]);
  });
});

describe('buildPrescription', () => {
  const base = { patientId: 'p1', advice: '', followUpDate: '' };

  it('builds the body, auto-filling quantity and skipping blank rows', () => {
    const r = buildPrescription({
      ...base,
      encounterId: 'e1',
      advice: '  Rest  ',
      followUpDate: '2026-10-14',
      lines: [{ ...emptyLine(), drugName: ' Tab Paracetamol 650 ', dose: '1 tab', frequency: '1-0-1', days: '5' }, emptyLine()],
    });
    expect(r.ok).toBe(true);
    expect(r.body).toEqual({
      patientId: 'p1',
      encounterId: 'e1',
      advice: 'Rest',
      followUpDate: '2026-10-14',
      lines: [{ drugName: 'Tab Paracetamol 650', dose: '1 tab', frequency: '1-0-1', days: 5, qty: 10 }],
    });
  });

  it('keeps a manual quantity', () => {
    const r = buildPrescription({ ...base, lines: [{ ...emptyLine(), drugName: 'Syp Cough', frequency: 'SOS', days: '3', qty: '1' }] });
    expect(r.body?.lines[0]?.qty).toBe(1);
  });

  it('requires an override reason for a line that matches an allergy', () => {
    const line = { ...emptyLine(), drugName: 'Tab Augmentin 625', dose: '1 tab' };
    expect(buildPrescription({ ...base, allergies: ['Penicillin'], lines: [line] }).errors[0]).toBe(
      'Allergy: give a reason to prescribe anyway',
    );
    const ok = buildPrescription({ ...base, allergies: ['Penicillin'], sign: true, lines: [{ ...line, overrideReason: 'Tolerated before' }] });
    expect(ok.body?.lines[0]?.allergyOverrideReason).toBe('Tolerated before');
    expect(ok.body?.sign).toBe(true);
  });

  it('round-trips saved lines into form rows', () => {
    const rows = draftFromLines([{ drugName: 'X', dose: '1 tab', frequency: 'BD', days: 3, qty: 6, instructions: 'after food' }]);
    expect(rows[0]).toEqual({ drugName: 'X', dose: '1 tab', frequency: 'BD', days: '3', qty: '6', instructions: 'after food', overrideReason: '' });
  });

  it('reports per-line and form errors', () => {
    expect(buildPrescription({ ...base, lines: [emptyLine()] }).errors).toEqual({ form: 'Add at least one medicine' });
    expect(buildPrescription({ ...base, lines: [{ ...emptyLine(), dose: '1 tab' }] }).errors[0]).toBe('Enter the medicine name');
    expect(buildPrescription({ ...base, lines: [{ ...emptyLine(), drugName: 'X', days: '0' }] }).errors[0]).toBe('Days must be 1 to 365');
    expect(buildPrescription({ ...base, lines: [{ ...emptyLine(), drugName: 'X', frequency: 'SOS' }] }).errors[0]).toBe('Enter the quantity');
    expect(
      buildPrescription({ ...base, followUpDate: '14/10/2026', lines: [{ ...emptyLine(), drugName: 'X' }] }).errors.followUpDate,
    ).toBe('Use YYYY-MM-DD');
  });
});
