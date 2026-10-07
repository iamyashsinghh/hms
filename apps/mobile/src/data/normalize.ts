// Tolerant mappers from API JSON to the view models in types.ts. Pure: no React Native imports,
// so they run under vitest. Each accepts a bare array or a { items } page.
import type {
  DoctorRef,
  EncounterRx,
  RxFavourite,
  RxLine,
  OwnerSummary,
  PortalKind,
  PortalRecord,
  QueueItem,
  QueueStatus,
  TimelineEntry,
  TimelineType,
} from './types';

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function listOf(res: unknown): Obj[] {
  const arr = Array.isArray(res) ? res : isObj(res) && Array.isArray(res.items) ? res.items : [];
  return arr.filter(isObj);
}

function str(v: unknown): string | null {
  if (typeof v === 'string' && v.trim() !== '') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

/** First non-empty string among the given keys. */
function pick(o: Obj, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = str(o[k]);
    if (v !== null) return v;
  }
  return null;
}

function pickNum(o: Obj, ...keys: string[]): number | null {
  for (const k of keys) {
    const v = num(o[k]);
    if (v !== null) return v;
  }
  return null;
}

export function fullName(o: Obj): string | null {
  const direct = pick(o, 'patientName', 'name', 'fullName');
  if (direct) return direct;
  const joined = [str(o.firstName), str(o.lastName)].filter(Boolean).join(' ');
  return joined || null;
}

export function ageLabel(dateOfBirth: string | null, ageYears: number | null, now = new Date()): string | null {
  if (dateOfBirth) {
    const dob = new Date(dateOfBirth);
    if (!Number.isNaN(dob.getTime())) {
      let age = now.getFullYear() - dob.getFullYear();
      const m = now.getMonth() - dob.getMonth();
      if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--;
      return `${Math.max(age, 0)}y`;
    }
  }
  return ageYears !== null ? `${ageYears}y` : null;
}

const STATUS_ALIASES: Record<string, QueueStatus> = {
  waiting: 'waiting',
  checked_in: 'waiting',
  booked: 'waiting',
  scheduled: 'waiting',
  confirmed: 'waiting',
  arrived: 'waiting',
  called: 'called',
  calling: 'called',
  in_consultation: 'in_consultation',
  in_progress: 'in_consultation',
  in_consult: 'in_consultation',
  started: 'in_consultation',
  open: 'in_consultation',
  draft: 'in_consultation',
  completed: 'completed',
  done: 'completed',
  signed: 'completed',
  closed: 'completed',
  cancelled: 'cancelled',
  canceled: 'cancelled',
  no_show: 'no_show',
  noshow: 'no_show',
  skipped: 'skipped',
};

export function queueStatus(raw: unknown): QueueStatus {
  const key = (str(raw) ?? '').toLowerCase().replace(/[\s-]/g, '_');
  return STATUS_ALIASES[key] ?? 'waiting';
}

export function normalizeQueue(res: unknown, now = new Date()): QueueItem[] {
  const items = listOf(res).flatMap((o): QueueItem[] => {
    const patient = isObj(o.patient) ? o.patient : {};
    const doctor = isObj(o.doctor) ? o.doctor : {};
    const patientId = pick(o, 'patientId') ?? pick(patient, 'id');
    if (!patientId) return [];
    // Front-office visits are returned as { id, visitNo, … }; EMR queue rows carry visitId.
    const visitId = pick(o, 'visitId') ?? (pick(o, 'visitNo') ? pick(o, 'id') : null);
    const appointmentId = pick(o, 'appointmentId');
    const id = visitId ?? appointmentId ?? pick(o, 'id', 'encounterId') ?? patientId;
    return [
      {
        id,
        visitId,
        appointmentId,
        encounterId: pick(o, 'encounterId'),
        patientId,
        uhid: pick(o, 'uhid') ?? pick(patient, 'uhid') ?? '',
        patientName: fullName(o) ?? fullName(patient) ?? 'Unknown patient',
        gender: pick(o, 'gender') ?? pick(patient, 'gender'),
        age: ageLabel(
          pick(o, 'dateOfBirth') ?? pick(patient, 'dateOfBirth'),
          pickNum(o, 'ageYears', 'age') ?? pickNum(patient, 'ageYears'),
          now,
        ),
        tokenNo: pickNum(o, 'tokenNo', 'token', 'tokenNumber'),
        status: queueStatus(o.status ?? o.encounterStatus ?? o.visitStatus),
        at: pick(o, 'checkedInAt', 'arrivedAt', 'slotStart', 'start', 'createdAt'),
        doctorName: pick(o, 'doctorName') ?? fullName(doctor),
        room: pick(o, 'room'),
      },
    ];
  });
  return sortQueue(items);
}

const STATUS_ORDER: Record<QueueStatus, number> = {
  in_consultation: 0,
  called: 1,
  waiting: 2,
  skipped: 3,
  completed: 4,
  no_show: 5,
  cancelled: 6,
};

/** With the doctor first, then called, then waiting by token, then skipped and finished. */
export function sortQueue(items: QueueItem[]): QueueItem[] {
  return [...items].sort(
    (a, b) =>
      STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
      (a.tokenNo ?? Number.MAX_SAFE_INTEGER) - (b.tokenNo ?? Number.MAX_SAFE_INTEGER) ||
      (a.at ?? '').localeCompare(b.at ?? ''),
  );
}

const TIMELINE_TYPES: readonly TimelineType[] = ['encounter', 'prescription', 'vitals', 'lab', 'radiology', 'bill', 'note'];

function timelineType(raw: unknown): TimelineType {
  const v = (str(raw) ?? '').toLowerCase();
  const hit = TIMELINE_TYPES.find((t) => v === t || v.startsWith(t) || v.endsWith(`.${t}`));
  if (hit) return hit;
  if (v.includes('rx')) return 'prescription';
  if (v.includes('invoice') || v.includes('payment')) return 'bill';
  if (v.includes('visit') || v.includes('consult')) return 'encounter';
  return 'other';
}

const TYPE_TITLES: Record<TimelineType, string> = {
  encounter: 'OPD visit',
  prescription: 'Prescription',
  vitals: 'Vitals',
  lab: 'Lab report',
  radiology: 'Radiology report',
  bill: 'Bill',
  note: 'Note',
  other: 'Record',
};

function vitalsLine(v: Obj): string | null {
  const parts = [
    num(v.bpSystolic) !== null && num(v.bpDiastolic) !== null ? `BP ${num(v.bpSystolic)}/${num(v.bpDiastolic)}` : null,
    num(v.pulse) !== null ? `Pulse ${num(v.pulse)}` : null,
    num(v.temperatureC) !== null ? `Temp ${num(v.temperatureC)}°C` : null,
    num(v.spo2) !== null ? `SpO2 ${num(v.spo2)}%` : null,
    num(v.weightKg) !== null ? `Wt ${num(v.weightKg)} kg` : null,
    num(v.bloodSugar) !== null ? `Sugar ${num(v.bloodSugar)}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

/** One EMR consultation (GET /emr/patients/:id/timeline row) as a timeline card. */
function encounterEntry(o: Obj): TimelineEntry {
  const dx = listOf(o.diagnoses).map((d) => [pick(d, 'description'), pick(d, 'icd10Code') ? `(${pick(d, 'icd10Code')})` : null].filter(Boolean).join(' '));
  const meds = listOf(o.medicines).map((m) =>
    [pick(m, 'drugName'), pick(m, 'dose'), pick(m, 'frequency'), num(m.days) ? `× ${num(m.days)} days` : null].filter(Boolean).join(' '),
  );
  const orders = listOf(o.orders).map((x) => pick(x, 'name')).filter((x): x is string => !!x);
  const vitals = isObj(o.vitals) ? vitalsLine(o.vitals) : null;
  const followUp = pick(o, 'followUpDate');
  const status = pick(o, 'status');
  const details = [
    dx.length ? `Dx: ${dx.join('; ')}` : null,
    ...meds.map((m) => `Rx: ${m}`),
    orders.length ? `Orders: ${orders.join(', ')}` : null,
    vitals ? `Vitals: ${vitals}` : null,
    followUp ? `Follow-up: ${followUp}` : null,
  ].filter((x): x is string => !!x);
  return {
    id: pick(o, 'encounterId') ?? '',
    type: 'encounter',
    at: pick(o, 'encounterDate', 'signedAt', 'createdAt') ?? '',
    title: ['OPD visit', pick(o, 'encounterNo'), status && status !== 'completed' ? `(${status.replace(/_/g, ' ')})` : null]
      .filter(Boolean)
      .join(' · ')
      .replace(' · (', ' ('),
    summary: pick(o, 'chiefComplaints'),
    details,
    doctorName: pick(o, 'doctorName'),
  };
}

export function normalizeTimeline(res: unknown): TimelineEntry[] {
  return listOf(res)
    .map((o, i): TimelineEntry => {
      if (pick(o, 'encounterId') && !o.type) return encounterEntry(o);
      const type = timelineType(o.type ?? o.kind);
      return {
        id: pick(o, 'id', 'refId') ?? `row-${i}`,
        type,
        at: pick(o, 'at', 'date', 'occurredAt', 'createdAt') ?? '',
        title: pick(o, 'title', 'label') ?? TYPE_TITLES[type],
        summary: pick(o, 'summary', 'description', 'diagnosis', 'text'),
        details: [],
        doctorName: pick(o, 'doctorName', 'by'),
      };
    })
    .sort((a, b) => b.at.localeCompare(a.at));
}

export function normalizeDoctors(res: unknown): DoctorRef[] {
  return listOf(res).flatMap((o) => {
    const userId = pick(o, 'userId', 'id');
    if (!userId) return [];
    return [{ userId, name: fullName(o) ?? 'Doctor', specialization: pick(o, 'specialization', 'department') }];
  });
}

export function normalizeOwnerSummary(res: unknown, date: string): OwnerSummary {
  const o = isObj(res) ? res : {};
  const pending = isObj(o.pendingBills) ? o.pendingBills : {};
  const prev = isObj(o.previous) ? o.previous : null;
  return {
    date: pick(o, 'date') ?? date,
    opdVisits: pickNum(o, 'opdVisits', 'visits') ?? 0,
    newPatients: pickNum(o, 'newPatients') ?? 0,
    billed: pickNum(o, 'billed') ?? 0,
    collections: pickNum(o, 'collections', 'collected') ?? 0,
    collectionsByMode: listOf(o.collectionsByMode).map((m) => ({ mode: pick(m, 'mode') ?? 'other', amount: pickNum(m, 'amount') ?? 0 })),
    pendingBills: {
      count: pickNum(pending, 'count') ?? pickNum(o, 'pendingBills') ?? 0,
      amount: pickNum(pending, 'amount') ?? 0,
    },
    consultationsSigned: pickNum(o, 'consultationsSigned') ?? 0,
    topDoctors: listOf(o.topDoctors).map((d, i) => ({
      doctorId: pick(d, 'doctorId', 'userId', 'id') ?? `doc-${i}`,
      name: fullName(d) ?? pick(d, 'doctorName') ?? 'Doctor',
      visits: pickNum(d, 'visits', 'opdVisits', 'count') ?? 0,
      revenue: pickNum(d, 'revenue', 'collections', 'amount') ?? 0,
    })),
    topServices: listOf(o.topServices).map((x) => ({
      description: pick(x, 'description', 'name', 'code') ?? 'Service',
      qty: pickNum(x, 'qty', 'count') ?? 0,
      amount: pickNum(x, 'amount', 'revenue') ?? 0,
    })),
    previous: prev
      ? { opdVisits: pickNum(prev, 'opdVisits') ?? 0, newPatients: pickNum(prev, 'newPatients') ?? 0, collections: pickNum(prev, 'collections') ?? 0 }
      : null,
  };
}

const rxLineText = (l: Obj) =>
  [pick(l, 'drugName'), pick(l, 'dose'), pick(l, 'frequency'), num(l.days) ? `× ${num(l.days)} days` : null].filter(Boolean).join(' ');

/** Portal lists (GET /portal/appointments|prescriptions|bills|reports) as cards. */
export function normalizePortalRecords(res: unknown, kind?: PortalKind): PortalRecord[] {
  return listOf(res).map((o, i): PortalRecord => {
    const base: PortalRecord = {
      id: pick(o, 'id') ?? `row-${i}`,
      title: pick(o, 'title', 'doctorName', 'number', 'name') ?? 'Record',
      subtitle: pick(o, 'subtitle', 'hospitalName', 'facilityName', 'summary', 'department'),
      lines: [],
      at: pick(o, 'at', 'issuedAt', 'slotStart', 'date', 'start', 'createdAt'),
      amount: pickNum(o, 'amount', 'total'),
      due: null,
      status: pick(o, 'status'),
      url: pick(o, 'url'),
    };
    const who = pick(o, 'patientName');
    if (kind === 'appointments')
      return { ...base, title: pick(o, 'doctorName') ?? 'Appointment', subtitle: [who, pick(o, 'reason')].filter(Boolean).join(' · ') || null, amount: null };
    if (kind === 'prescriptions')
      return { ...base, title: pick(o, 'doctorName') ?? 'Prescription', subtitle: who, lines: listOf(o.lines).map(rxLineText), amount: null, status: null };
    if (kind === 'bills') {
      const due = pickNum(o, 'due');
      return { ...base, title: pick(o, 'number') ?? 'Bill', subtitle: who, due: due && due > 0 ? due : null };
    }
    if (kind === 'reports') return { ...base, title: pick(o, 'title') ?? 'Report', subtitle: [who, pick(o, 'kind')].filter(Boolean).join(' · ') || null, amount: null };
    return base;
  });
}

/** Prescription lines from an EMR consultation or favourite, as RxLine. */
export function normalizeRxLines(res: unknown): RxLine[] {
  return listOf(res).flatMap((l) => {
    const drugName = pick(l, 'drugName');
    if (!drugName) return [];
    const instructions = pick(l, 'instructions');
    const reason = pick(l, 'allergyOverrideReason');
    const itemCode = pick(l, 'itemCode');
    return [
      {
        drugName,
        dose: pick(l, 'dose') ?? '',
        frequency: pick(l, 'frequency') ?? '',
        days: pickNum(l, 'days') ?? 0,
        qty: pickNum(l, 'qty') ?? 0,
        ...(itemCode ? { itemCode } : {}),
        ...(instructions ? { instructions } : {}),
        ...(reason ? { allergyOverrideReason: reason } : {}),
      },
    ];
  });
}

export function normalizeEncounterRx(o: unknown): EncounterRx | null {
  if (!isObj(o)) return null;
  const encounterId = pick(o, 'id', 'encounterId');
  if (!encounterId) return null;
  const notes = isObj(o.notes) ? o.notes : {};
  const rx = isObj(o.prescription) ? o.prescription : {};
  return {
    encounterId,
    status: pick(o, 'status') ?? 'in_progress',
    signed: !!pick(o, 'signedAt'),
    lines: normalizeRxLines(rx.lines),
    advice: pick(notes, 'advice') ?? '',
    followUpDate: pick(o, 'followUpDate') ?? '',
  };
}

export function normalizeFavourites(res: unknown): RxFavourite[] {
  return listOf(res).flatMap((f) => {
    const id = pick(f, 'id');
    const name = pick(f, 'name');
    return id && name ? [{ id, name, lines: normalizeRxLines(f.lines) }] : [];
  });
}
