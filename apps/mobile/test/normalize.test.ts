import { describe, expect, it } from 'vitest';
import {
  ageLabel,
  normalizeOwnerSummary,
  normalizePortalRecords,
  normalizeQueue,
  normalizeTimeline,
  queueStatus,
} from '@/data/normalize';

const NOW = new Date(2026, 9, 7);

describe('normalizeQueue', () => {
  it('maps the agreed EMR queue shape and sorts: with doctor, waiting by token, done', () => {
    const items = normalizeQueue(
      [
        { visitId: 'v3', patientId: 'p3', uhid: 'U3', patientName: 'C', tokenNo: 3, status: 'completed', checkedInAt: '2026-10-07T04:00:00Z' },
        { visitId: 'v2', patientId: 'p2', uhid: 'U2', patientName: 'B', tokenNo: 5, status: 'waiting' },
        { visitId: 'v1', patientId: 'p1', uhid: 'U1', patientName: 'A', tokenNo: 4, status: 'waiting', ageYears: 30, gender: 'female' },
        { visitId: 'v4', encounterId: 'e4', patientId: 'p4', uhid: 'U4', patientName: 'D', tokenNo: 6, status: 'in_consultation' },
      ],
      NOW,
    );
    expect(items.map((i) => i.id)).toEqual(['v4', 'v1', 'v2', 'v3']);
    expect(items[0]?.encounterId).toBe('e4');
    expect(items[1]).toMatchObject({ patientName: 'A', age: '30y', gender: 'female', tokenNo: 4, status: 'waiting' });
  });

  it('accepts a page with a nested patient and alternative field names', () => {
    const [item] = normalizeQueue(
      {
        items: [
          {
            appointmentId: 'a1',
            token: '7',
            status: 'Checked-In',
            slotStart: '2026-10-07T05:00:00Z',
            patient: { id: 'p9', uhid: 'U9', firstName: 'Ravi', lastName: 'Shah', dateOfBirth: '2000-10-08' },
            doctor: { name: 'Dr. Rao' },
          },
        ],
      },
      NOW,
    );
    expect(item).toMatchObject({
      id: 'a1',
      patientId: 'p9',
      uhid: 'U9',
      patientName: 'Ravi Shah',
      age: '25y',
      tokenNo: 7,
      status: 'waiting',
      at: '2026-10-07T05:00:00Z',
      doctorName: 'Dr. Rao',
    });
  });

  it('drops rows without a patient and tolerates junk', () => {
    expect(normalizeQueue([{ tokenNo: 1 }, null, 'x'])).toEqual([]);
    expect(normalizeQueue(undefined)).toEqual([]);
  });
});

describe('queueStatus', () => {
  it('maps aliases and defaults to waiting', () => {
    expect(queueStatus('IN_PROGRESS')).toBe('in_consultation');
    expect(queueStatus('signed')).toBe('completed');
    expect(queueStatus('canceled')).toBe('cancelled');
    expect(queueStatus('no-show')).toBe('no_show');
    expect(queueStatus(undefined)).toBe('waiting');
  });
});

describe('ageLabel', () => {
  it('prefers date of birth, falls back to age in years', () => {
    expect(ageLabel('1990-10-08', 99, NOW)).toBe('35y');
    expect(ageLabel('1990-10-07', null, NOW)).toBe('36y');
    expect(ageLabel(null, 12, NOW)).toBe('12y');
    expect(ageLabel('not a date', null, NOW)).toBeNull();
  });
});

describe('normalizeTimeline', () => {
  it('maps types, fills titles and sorts newest first', () => {
    const rows = normalizeTimeline([
      { id: 'a', type: 'emr.encounter', at: '2026-01-01T00:00:00Z', diagnosis: 'J02.9' },
      { id: 'b', kind: 'rx', at: '2026-02-01T00:00:00Z' },
      { id: 'c', type: 'invoice', date: '2026-03-01' },
      { type: 'weird' },
    ]);
    expect(rows.map((r) => [r.id, r.type, r.title])).toEqual([
      ['c', 'bill', 'Bill'],
      ['b', 'prescription', 'Prescription'],
      ['a', 'encounter', 'OPD visit'],
      ['row-3', 'other', 'Record'],
    ]);
    expect(rows[2]?.summary).toBe('J02.9');
  });
});

describe('normalizeOwnerSummary', () => {
  it('reads numbers (also numeric strings from numeric(14,2)) and defaults the rest', () => {
    expect(
      normalizeOwnerSummary(
        { opdVisits: 10, collections: '12500.50', topDoctors: [{ userId: 'd1', name: 'Dr. A', visits: 4, revenue: '2000.00' }] },
        '2026-10-07',
      ),
    ).toEqual({
      date: '2026-10-07',
      opdVisits: 10,
      newPatients: 0,
      collections: 12500.5,
      pendingBills: 0,
      topDoctors: [{ doctorId: 'd1', name: 'Dr. A', visits: 4, revenue: 2000 }],
    });
  });
});

describe('normalizePortalRecords', () => {
  it('maps appointments and bills', () => {
    expect(
      normalizePortalRecords([
        { id: 'a', doctorName: 'Dr. A', facilityName: 'Main', slotStart: 'x', status: 'booked' },
        { id: 'b', number: 'INV-1', total: '500.00', status: 'paid' },
      ]),
    ).toEqual([
      { id: 'a', title: 'Dr. A', subtitle: 'Main', at: 'x', amount: null, status: 'booked' },
      { id: 'b', title: 'INV-1', subtitle: null, at: null, amount: 500, status: 'paid' },
    ]);
  });
});
