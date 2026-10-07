// Demo data used only in development builds (or with EXPO_PUBLIC_DEMO_DATA=1) while an owner module's
// endpoint is not on the server yet. Screens show a "demo data" banner whenever it is used.
import { addDays, isoDate } from './dates';

function at(date: string, hh: number, mm: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1, hh, mm).toISOString();
}

export function demoQueue(date: string, patients: { id: string; uhid: string; name: string; gender: string; ageYears?: number }[]) {
  const pool = patients.length
    ? patients
    : [
        { id: 'demo-p1', uhid: 'UH-000101', name: 'Ramesh Kumar', gender: 'male', ageYears: 54 },
        { id: 'demo-p2', uhid: 'UH-000102', name: 'Sunita Devi', gender: 'female', ageYears: 41 },
        { id: 'demo-p3', uhid: 'UH-000103', name: 'Arjun Mehta', gender: 'male', ageYears: 8 },
        { id: 'demo-p4', uhid: 'UH-000104', name: 'Fatima Shaikh', gender: 'female', ageYears: 29 },
        { id: 'demo-p5', uhid: 'UH-000105', name: 'Gurpreet Singh', gender: 'male', ageYears: 67 },
      ];
  const statuses = ['completed', 'in_consultation', 'waiting', 'waiting', 'waiting', 'waiting'];
  return pool.slice(0, 6).map((p, i) => ({
    visitId: `demo-v${i + 1}`,
    encounterId: i < 2 ? `demo-e${i + 1}` : null,
    patientId: p.id,
    uhid: p.uhid,
    patientName: p.name,
    gender: p.gender,
    ageYears: p.ageYears,
    tokenNo: i + 1,
    status: statuses[i] ?? 'waiting',
    checkedInAt: at(date, 9, 10 + i * 12),
  }));
}

export function demoTimeline() {
  const today = isoDate();
  return [
    { id: 't1', type: 'encounter', at: at(addDays(today, -14), 10, 30), title: 'OPD visit', summary: 'Fever 3 days, sore throat. Dx: Acute pharyngitis (J02.9)', doctorName: 'Dr. Demo' },
    { id: 't2', type: 'prescription', at: at(addDays(today, -14), 10, 45), title: 'Prescription', summary: 'Tab Paracetamol 650 mg 1-0-1 × 3 days; Tab Azithromycin 500 mg 1-0-0 × 3 days', doctorName: 'Dr. Demo' },
    { id: 't3', type: 'vitals', at: at(addDays(today, -14), 10, 20), title: 'Vitals', summary: 'BP 128/84, Pulse 92, Temp 100.4°F, SpO2 98%', doctorName: null },
    { id: 't4', type: 'bill', at: at(addDays(today, -14), 11, 0), title: 'OPD bill', summary: 'Consultation ₹500 · Paid (UPI)', doctorName: null },
  ];
}

export function demoOwnerSummary(date: string) {
  return {
    date,
    opdVisits: 142,
    newPatients: 37,
    collections: 186450,
    pendingBills: 6,
    topDoctors: [
      { doctorId: 'd1', name: 'Dr. Anjali Rao', visits: 38, revenue: 41800 },
      { doctorId: 'd2', name: 'Dr. Vikram Sethi', visits: 31, revenue: 37200 },
      { doctorId: 'd3', name: 'Dr. Meera Iyer', visits: 24, revenue: 26400 },
    ],
  };
}

export function demoDoctors() {
  return [
    { userId: 'demo-d1', name: 'Dr. Anjali Rao', specialization: 'General Medicine' },
    { userId: 'demo-d2', name: 'Dr. Vikram Sethi', specialization: 'Orthopaedics' },
  ];
}

export function demoPortal(kind: 'appointments' | 'prescriptions' | 'bills') {
  const today = isoDate();
  if (kind === 'appointments')
    return [
      { id: 'a1', title: 'Dr. Anjali Rao', subtitle: 'General Medicine · Demo Hospital', at: at(addDays(today, 2), 11, 0), status: 'booked' },
      { id: 'a2', title: 'Dr. Vikram Sethi', subtitle: 'Orthopaedics · Demo Hospital', at: at(addDays(today, -20), 17, 30), status: 'completed' },
    ];
  if (kind === 'prescriptions')
    return [{ id: 'r1', title: 'Dr. Anjali Rao', subtitle: 'Paracetamol 650 mg, Azithromycin 500 mg', at: at(addDays(today, -14), 10, 45), status: null }];
  return [{ id: 'b1', title: 'OPD-2026-000981', subtitle: 'Consultation', at: at(addDays(today, -14), 11, 0), amount: 500, status: 'paid' }];
}

const DEMO_NAMES: Record<string, [string, string, 'male' | 'female', number]> = {
  'demo-p1': ['Ramesh', 'Kumar', 'male', 54],
  'demo-p2': ['Sunita', 'Devi', 'female', 41],
  'demo-p3': ['Arjun', 'Mehta', 'male', 8],
  'demo-p4': ['Fatima', 'Shaikh', 'female', 29],
  'demo-p5': ['Gurpreet', 'Singh', 'male', 67],
};

export function demoPatient(id: string) {
  const [firstName, lastName, gender, ageYears] = DEMO_NAMES[id] ?? ['Demo', 'Patient', 'female', 35];
  const now = new Date().toISOString();
  return {
    id,
    uhid: `UH-${id.replace(/\D/g, '').padStart(6, '0')}`,
    firstName,
    lastName,
    gender,
    ageYears,
    dateOfBirth: null,
    mobile: '9800000000',
    email: null,
    bloodGroup: 'B+',
    abhaNumber: null,
    allergies: ['Penicillin'],
    createdAt: now,
    updatedAt: now,
  };
}
