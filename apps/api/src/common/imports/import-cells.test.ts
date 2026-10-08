import { describe, expect, it } from 'vitest';
import { importBoolean, importDate, importEnum, importList, importNumber, matchImportColumn } from '@hms/shared';

describe('import cell coercion', () => {
  it('reads dates the way they are typed in India and stored by Excel', () => {
    expect(importDate('2027-03-31')).toBe('2027-03-31');
    expect(importDate('31/03/2027')).toBe('2027-03-31');
    expect(importDate('1-4-24')).toBe('2024-04-01');
    expect(importDate('31.12.2027')).toBe('2027-12-31');
    expect(importDate('03/2027')).toBe('2027-03-31');
    expect(importDate('2/28')).toBe('2028-02-29');
    expect(importDate(46477)).toBe('2027-03-31');
    expect(importDate('31/02/2027')).toBe('31/02/2027');
    expect(importDate('13/2027')).toBe('13/2027');
    expect(importDate('next week')).toBe('next week');
  });

  it('reads numbers, booleans, enums and lists', () => {
    expect(importNumber('₹1,250.50')).toBe(1250.5);
    expect(importNumber('18%')).toBe(18);
    expect(importNumber('ten')).toBe('ten');
    expect(importBoolean('Yes')).toBe(true);
    expect(importBoolean('inactive')).toBe(false);
    expect(importBoolean('maybe')).toBe('maybe');
    expect(importEnum('Clinical Pathology', ['haematology', 'clinical_pathology'])).toBe('clinical_pathology');
    expect(importEnum('h1', ['otc', 'H', 'H1'])).toBe('H1');
    expect(importEnum('12%', [0, 5, 12])).toBe(12);
    expect(importList('Positive | Negative; Trace')).toEqual(['Positive', 'Negative', 'Trace']);
  });

  it('matches headers loosely', () => {
    const cols = [{ key: 'gstRate', header: 'GST %', type: 'number' as const }, { key: 'durationMinutes', header: 'Duration (min)', type: 'integer' as const }];
    expect(matchImportColumn('gst', cols)?.key).toBe('gstRate');
    expect(matchImportColumn('GST %*', cols)?.key).toBe('gstRate');
    expect(matchImportColumn('duration', cols)?.key).toBe('durationMinutes');
    expect(matchImportColumn('gstrate', cols)?.key).toBe('gstRate');
    expect(matchImportColumn('Remarks', cols)).toBeUndefined();
  });
});
