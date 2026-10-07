import { describe, expect, it } from 'vitest';
import { allergyHits, buildPrescription, dosesPerDay, emptyLine, suggestQty } from '@/data/rx';

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

describe('allergyHits', () => {
  it('matches case-insensitively in either direction', () => {
    expect(allergyHits('Tab Amoxicillin 500', ['amoxicillin'])).toEqual(['amoxicillin']);
    expect(allergyHits('Penicillin', ['Penicillin V'])).toEqual(['Penicillin V']);
    expect(allergyHits('Cap Amoxyclav', ['Sulfa'])).toEqual([]);
  });
  it('ignores tiny allergy strings and empty drugs', () => {
    expect(allergyHits('Tab Paracetamol', ['pa'])).toEqual([]);
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
