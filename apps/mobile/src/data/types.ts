// View models the mobile screens render. normalize.ts maps API responses onto these, so a field
// renamed by an owner module is fixed in one place instead of in every screen.

/** Front-office visit states (waiting → called → in_consultation → completed; skipped; cancelled) plus no_show. */
export type QueueStatus = 'waiting' | 'called' | 'in_consultation' | 'completed' | 'skipped' | 'cancelled' | 'no_show';

/** Front-office visit transitions (POST /frontoffice/visits/:id/transition). */
export type VisitAction = 'call' | 'start' | 'complete' | 'skip' | 'requeue' | 'cancel';

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
  room: string | null;
}

export type TimelineType = 'encounter' | 'prescription' | 'vitals' | 'lab' | 'radiology' | 'bill' | 'note' | 'other';

export interface TimelineEntry {
  id: string;
  type: TimelineType;
  at: string;
  title: string;
  summary: string | null;
  /** Extra lines (diagnoses, medicines, vitals…) shown under the summary. */
  details: string[];
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
  /** Value of invoices finalized that day. */
  billed: number;
  /** Money received that day. */
  collections: number;
  collectionsByMode: { mode: string; amount: number }[];
  pendingBills: { count: number; amount: number };
  consultationsSigned: number;
  topDoctors: { doctorId: string; name: string; visits: number; revenue: number }[];
  topServices: { description: string; qty: number; amount: number }[];
  /** The day before, for "vs yesterday"; null when the server does not send it. */
  previous: { opdVisits: number; newPatients: number; collections: number } | null;
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
  /** Required by the EMR API when the drug matches a recorded allergy. */
  allergyOverrideReason?: string;
}

export interface CreatePrescription {
  patientId: string;
  encounterId?: string;
  lines: RxLine[];
  advice?: string;
  followUpDate?: string;
  /** Sign and lock the consultation in the same call. */
  sign?: boolean;
}

export interface PrescriptionSaved {
  prescriptionId: string;
  encounterId: string;
  rxNo: string;
}

/** What the Rx screen needs from an open consultation, to edit (not overwrite) its prescription. */
export interface EncounterRx {
  encounterId: string;
  status: string;
  signed: boolean;
  lines: RxLine[];
  advice: string;
  followUpDate: string;
}

/** Doctor's saved medicine set (server favourites are shared with the web EMR). */
export interface RxFavourite {
  id: string;
  name: string;
  lines: RxLine[];
}

export type PortalKind = 'appointments' | 'prescriptions' | 'bills' | 'reports';

export interface PortalRecord {
  id: string;
  title: string;
  subtitle: string | null;
  /** Extra lines, e.g. the medicines on a prescription. */
  lines: string[];
  at: string | null;
  amount: number | null;
  /** Amount still to pay on a bill. */
  due: number | null;
  status: string | null;
  /** Report download link. */
  url: string | null;
}

/** A list or object plus whether it came from built-in demo data (endpoint not on this server yet). */
export interface Loaded<T> {
  data: T;
  demo: boolean;
}
