// Tolerant mappers from API JSON to the view models in types.ts. Pure: no React Native imports,
// so they run under vitest. Each accepts a bare array or a { items } page.
import type {
  DoctorRef,
  OwnerSummary,
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
  called: 'in_consultation',
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
    const visitId = pick(o, 'visitId');
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
      },
    ];
  });
  return sortQueue(items);
}

const STATUS_ORDER: Record<QueueStatus, number> = {
  in_consultation: 0,
  waiting: 1,
  completed: 2,
  no_show: 3,
  cancelled: 4,
};

/** In consultation first, then waiting by token, then finished. */
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

export function normalizeTimeline(res: unknown): TimelineEntry[] {
  return listOf(res)
    .map((o, i): TimelineEntry => {
      const type = timelineType(o.type ?? o.kind);
      return {
        id: pick(o, 'id', 'refId') ?? `row-${i}`,
        type,
        at: pick(o, 'at', 'date', 'occurredAt', 'createdAt') ?? '',
        title: pick(o, 'title', 'label') ?? TYPE_TITLES[type],
        summary: pick(o, 'summary', 'description', 'diagnosis', 'text'),
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
  return {
    date: pick(o, 'date') ?? date,
    opdVisits: pickNum(o, 'opdVisits', 'visits') ?? 0,
    newPatients: pickNum(o, 'newPatients') ?? 0,
    collections: pickNum(o, 'collections', 'collected') ?? 0,
    pendingBills: pickNum(o, 'pendingBills', 'pending') ?? 0,
    topDoctors: listOf(o.topDoctors).map((d, i) => ({
      doctorId: pick(d, 'doctorId', 'userId', 'id') ?? `doc-${i}`,
      name: fullName(d) ?? pick(d, 'doctorName') ?? 'Doctor',
      visits: pickNum(d, 'visits', 'opdVisits', 'count') ?? 0,
      revenue: pickNum(d, 'revenue', 'collections', 'amount') ?? 0,
    })),
  };
}

export function normalizePortalRecords(res: unknown): PortalRecord[] {
  return listOf(res).map((o, i) => ({
    id: pick(o, 'id') ?? `row-${i}`,
    title: pick(o, 'title', 'doctorName', 'number', 'name') ?? 'Record',
    subtitle: pick(o, 'subtitle', 'hospitalName', 'facilityName', 'summary', 'department'),
    at: pick(o, 'at', 'date', 'slotStart', 'start', 'createdAt'),
    amount: pickNum(o, 'amount', 'total'),
    status: pick(o, 'status'),
  }));
}
