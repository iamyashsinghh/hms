import { describe, expect, it } from 'vitest';
import {
  ageLabel,
  normalizeOwnerSummary,
  normalizePortalRecords,
  normalizeQueue,
  normalizeTimeline,
  queueStatus,
} from '@/data/normalize';
import { vsYesterday } from '@/data/dates';

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

describe('normalizeTimeline (EMR consultations)', () => {
  it('turns a consultation into a card with diagnoses, medicines, orders, vitals and follow-up', () => {
    const [row] = normalizeTimeline({
      items: [
        {
          encounterId: 'e1',
          encounterNo: 'OP000007',
          encounterDate: '2026-10-01T05:00:00Z',
          status: 'completed',
          doctorName: 'Dr. Rao',
          chiefComplaints: 'Fever 3 days',
          diagnoses: [{ icd10Code: 'J02.9', description: 'Acute pharyngitis', kind: 'final', isPrimary: true }],
          medicines: [{ drugName: 'Tab Dolo 650', dose: '1 tab', frequency: 'TDS', days: 3 }],
          orders: [{ kind: 'lab', name: 'CBC' }],
          vitals: { bpSystolic: 120, bpDiastolic: 80, pulse: 88, temperatureC: 38.2, spo2: 98 },
          followUpDate: '2026-10-08',
        },
      ],
    });
    expect(row).toEqual({
      id: 'e1',
      type: 'encounter',
      at: '2026-10-01T05:00:00Z',
      title: 'OPD visit · OP000007',
      summary: 'Fever 3 days',
      doctorName: 'Dr. Rao',
      details: [
        'Dx: Acute pharyngitis (J02.9)',
        'Rx: Tab Dolo 650 1 tab TDS × 3 days',
        'Orders: CBC',
        'Vitals: BP 120/80, Pulse 88, Temp 38.2°C, SpO2 98%',
        'Follow-up: 2026-10-08',
      ],
    });
  });

  it('shows an unfinished consultation status in the title', () => {
    expect(normalizeTimeline([{ encounterId: 'e2', encounterNo: 'OP2', encounterDate: 'x', status: 'in_progress' }])[0]?.title).toBe(
      'OPD visit · OP2 (in progress)',
    );
  });
});

describe('normalizeOwnerSummary', () => {
  it('maps the reports module response', () => {
    expect(
      normalizeOwnerSummary(
        {
          date: '2026-10-07',
          timezone: 'Asia/Kolkata',
          opdVisits: 10,
          newPatients: 3,
          billed: 15000,
          collections: '12500.50',
          collectionsByMode: [{ mode: 'upi', count: 4, amount: 9000 }],
          pendingBills: { count: 2, amount: 2500 },
          consultationsSigned: 9,
          topDoctors: [{ doctorId: 'd1', name: 'Dr. A', visits: 4, revenue: '2000.00' }],
          topServices: [{ code: 'CONS', description: 'Consultation', qty: 10, amount: 5000 }],
          previous: { date: '2026-10-06', opdVisits: 8, newPatients: 1, billed: 1, collections: 10000 },
        },
        '2026-10-07',
      ),
    ).toEqual({
      date: '2026-10-07',
      opdVisits: 10,
      newPatients: 3,
      billed: 15000,
      collections: 12500.5,
      collectionsByMode: [{ mode: 'upi', amount: 9000 }],
      pendingBills: { count: 2, amount: 2500 },
      consultationsSigned: 9,
      topDoctors: [{ doctorId: 'd1', name: 'Dr. A', visits: 4, revenue: 2000 }],
      topServices: [{ description: 'Consultation', qty: 10, amount: 5000 }],
      previous: { opdVisits: 8, newPatients: 1, collections: 10000 },
    });
  });

  it('defaults missing fields', () => {
    const s = normalizeOwnerSummary({ pendingBills: 4 }, '2026-10-07');
    expect(s).toMatchObject({ opdVisits: 0, pendingBills: { count: 4, amount: 0 }, previous: null, topDoctors: [] });
  });
});

describe('vsYesterday', () => {
  it('formats counts and money', () => {
    expect(vsYesterday(10, 8)).toBe('+2 vs yesterday');
    expect(vsYesterday(5, 5)).toBe('Same as yesterday');
    expect(vsYesterday(9000, 10000, true)).toBe('−₹1,000 (−10%) vs yesterday');
    expect(vsYesterday(1, undefined)).toBeUndefined();
  });
});

describe('normalizePortalRecords (portal module shapes)', () => {
  it('appointments', () => {
    expect(
      normalizePortalRecords([{ id: 'a', doctorName: 'Dr. A', patientName: 'Asha', reason: 'Fever', slotStart: 'x', status: 'requested' }], 'appointments')[0],
    ).toMatchObject({ title: 'Dr. A', subtitle: 'Asha · Fever', at: 'x', status: 'requested', amount: null });
  });
  it('prescriptions list their medicines', () => {
    expect(
      normalizePortalRecords(
        [{ id: 'p', doctorName: null, patientName: 'Asha', issuedAt: 'y', lines: [{ drugName: 'Tab X', dose: '1 tab', frequency: 'BD', days: 3 }] }],
        'prescriptions',
      )[0],
    ).toMatchObject({ title: 'Prescription', subtitle: 'Asha', at: 'y', lines: ['Tab X 1 tab BD × 3 days'] });
  });
  it('bills read numeric strings and show what is due', () => {
    const [paid, unpaid] = normalizePortalRecords(
      [
        { id: 'b1', number: 'INV-1', patientName: 'Asha', total: '500.00', due: '0.00', status: 'paid', issuedAt: 'z' },
        { id: 'b2', number: null, total: '800.00', due: '300.00', status: 'partially_paid' },
      ],
      'bills',
    );
    expect(paid).toMatchObject({ title: 'INV-1', amount: 500, due: null, status: 'paid', at: 'z' });
    expect(unpaid).toMatchObject({ title: 'Bill', amount: 800, due: 300 });
  });
  it('reports carry their link', () => {
    expect(normalizePortalRecords([{ id: 'r', title: 'CBC', kind: 'lab', patientName: 'Asha', url: 'https://x/r.pdf', issuedAt: 'w' }], 'reports')[0]).toMatchObject({
      title: 'CBC',
      subtitle: 'Asha · lab',
      url: 'https://x/r.pdf',
    });
  });
});
