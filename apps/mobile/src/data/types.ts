// View models the mobile screens render. normalize.ts maps API responses onto these, so a field
// renamed by an owner module is fixed in one place instead of in every screen.

export type QueueStatus = 'waiting' | 'in_consultation' | 'completed' | 'cancelled' | 'no_show';

export interface QueueItem {
  /** Stable key: visit id, else appointment id. */
  id: string;
  visitId: string | null;
  appointmentId: string | null;
  encounterId: string | null;
  patientId: string;
  uhid: string;
  patientName: string;
  gender: string | null;
  age: string | null;
  tokenNo: number | null;
  status: QueueStatus;
  /** ISO time the patient checked in (or the appointment slot when not checked in yet). */
  at: string | null;
  doctorName: string | null;
}

export type TimelineType = 'encounter' | 'prescription' | 'vitals' | 'lab' | 'radiology' | 'bill' | 'note' | 'other';

export interface TimelineEntry {
  id: string;
  type: TimelineType;
  at: string;
  title: string;
  summary: string | null;
  doctorName: string | null;
}

export interface DoctorRef {
  userId: string;
  name: string;
  specialization: string | null;
}

export interface OwnerSummary {
  date: string;
  opdVisits: number;
  newPatients: number;
  collections: number;
  pendingBills: number;
  topDoctors: { doctorId: string; name: string; visits: number; revenue: number }[];
}

export interface RxLine {
  drugName: string;
  itemCode?: string;
  dose: string;
  /** Indian shorthand, e.g. "1-0-1" (morning-noon-night), or SOS / STAT / OD / BD / TDS / QID / HS. */
  frequency: string;
  days: number;
  qty: number;
  route?: string;
  instructions?: string;
}

export interface CreatePrescription {
  patientId: string;
  encounterId?: string;
  lines: RxLine[];
  advice?: string;
  followUpDate?: string;
}

export interface PortalRecord {
  id: string;
  title: string;
  subtitle: string | null;
  at: string | null;
  amount: number | null;
  status: string | null;
}

/** A list or object plus whether it came from built-in demo data (endpoint not on this server yet). */
export interface Loaded<T> {
  data: T;
  demo: boolean;
}
