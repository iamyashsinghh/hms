// Mobile data layer over @hms/api-client's Http. Calls the agreed module endpoints (endpoints.ts),
// maps responses to view models (normalize.ts), and in development falls back to demo data when an
// owner module's route is not on the server yet. No React Native imports: unit tested under vitest.
import { ApiError, type Http } from '@hms/api-client';
import type { Patient } from '@hms/shared';
import { demoDoctors, demoOwnerSummary, demoPatient, demoPortal, demoQueue, demoTimeline } from './demo';
import { ENDPOINTS } from './endpoints';
import {
  normalizeDoctors,
  normalizeEncounterRx,
  normalizeFavourites,
  normalizeOwnerSummary,
  normalizePortalRecords,
  normalizeQueue,
  normalizeTimeline,
} from './normalize';
import type {
  CreatePrescription,
  DoctorRef,
  EncounterRx,
  PrescriptionSaved,
  RxFavourite,
  RxLine,
  Loaded,
  OwnerSummary,
  PortalKind,
  PortalRecord,
  QueueItem,
  TimelineEntry,
  VisitAction,
} from './types';

/** True when the server has no such route (module not merged yet), as opposed to a missing record. */
export function isMissingRoute(err: unknown): boolean {
  return err instanceof ApiError && err.status === 404 && /^Cannot (GET|POST|PUT|PATCH|DELETE) /.test(err.message);
}

export class FeatureUnavailableError extends Error {
  constructor(readonly feature: string) {
    super(`${feature} is not available on this server yet`);
    this.name = 'FeatureUnavailableError';
  }
}

export interface AllergyConflict {
  line: number;
  drugName: string;
  allergy: string;
}

/** The EMR rejected the prescription: a line matches a recorded allergy and has no override reason. */
export class AllergyConflictError extends Error {
  constructor(
    message: string,
    readonly conflicts: AllergyConflict[],
  ) {
    super(message);
    this.name = 'AllergyConflictError';
  }
}

export interface MobileDataOptions {
  /** Use demo data when a route is missing. On in dev builds; never in release builds unless opted in. */
  demoFallback: boolean;
}

export function createMobileData(http: Http, opts: MobileDataOptions) {
  async function withFallback<T>(feature: string, call: () => Promise<T>, demo: () => T): Promise<Loaded<T>> {
    try {
      return { data: await call(), demo: false };
    } catch (err) {
      if (!isMissingRoute(err)) throw err;
      if (opts.demoFallback) return { data: demo(), demo: true };
      throw new FeatureUnavailableError(feature);
    }
  }

  async function samplePatients() {
    try {
      const res = await http.get<{ items: Patient[] }>('/patients', { pageSize: 6 });
      return res.items.map((p) => ({
        id: p.id,
        uhid: p.uhid,
        name: [p.firstName, p.lastName].filter(Boolean).join(' '),
        gender: p.gender,
        ageYears: p.ageYears,
      }));
    } catch {
      return [];
    }
  }

  return {
    /**
     * Doctor's checked-in patients for a day. Uses the EMR queue; until EMR is on the server, the
     * front-office token queue filtered to this doctor gives the same list.
     */
    async doctorQueue(date: string, doctorUserId: string): Promise<Loaded<QueueItem[]>> {
      try {
        return { data: normalizeQueue(await http.get(ENDPOINTS.emr.queue, { date })), demo: false };
      } catch (err) {
        if (!isMissingRoute(err)) throw err;
      }
      try {
        return {
          data: normalizeQueue(await http.get(ENDPOINTS.frontoffice.queue, { doctorId: doctorUserId, date })),
          demo: false,
        };
      } catch (err) {
        if (!isMissingRoute(err)) throw err;
        if (!opts.demoFallback) throw new FeatureUnavailableError("Doctor's queue");
        // Demo queue uses real patients from this hospital so the timeline and Rx screens work end to end.
        return { data: normalizeQueue(demoQueue(date, await samplePatients())), demo: true };
      }
    },

    /** Front-office token queue for one doctor and day (staff app). */
    async frontofficeQueue(doctorId: string, date: string): Promise<Loaded<QueueItem[]>> {
      try {
        return { data: normalizeQueue(await http.get(ENDPOINTS.frontoffice.queue, { doctorId, date })), demo: false };
      } catch (err) {
        if (!isMissingRoute(err)) throw err;
        if (!opts.demoFallback) throw new FeatureUnavailableError('OPD queue');
        return { data: normalizeQueue(demoQueue(date, await samplePatients())), demo: true };
      }
    },

    /** Moves a front-office visit through the queue (call, start, complete, skip, requeue, cancel). */
    async visitAction(visitId: string, action: VisitAction, room?: string): Promise<void> {
      try {
        await http.post(ENDPOINTS.frontoffice.transition(visitId), { action, ...(room ? { room } : {}) });
      } catch (err) {
        if (isMissingRoute(err)) throw new FeatureUnavailableError('Queue actions');
        throw err;
      }
    },

    doctors(): Promise<Loaded<DoctorRef[]>> {
      return withFallback(
        'Doctor list',
        async () => normalizeDoctors(await http.get(ENDPOINTS.setup.doctors)),
        () => normalizeDoctors(demoDoctors()),
      );
    },

    async patient(id: string): Promise<Loaded<Patient>> {
      if (id.startsWith('demo-') && opts.demoFallback) return { data: demoPatient(id), demo: true };
      return { data: await http.get<Patient>(`/patients/${id}`), demo: false };
    },

    timeline(patientId: string): Promise<Loaded<TimelineEntry[]>> {
      return withFallback(
        'Patient timeline',
        async () => normalizeTimeline(await http.get(ENDPOINTS.emr.timeline(patientId))),
        () => normalizeTimeline(demoTimeline()),
      );
    },

    /**
     * Saves the prescription (EMR quick prescription: opens a consultation when there is none, and
     * replaces the consultation's prescription when there is). Never falls back to demo data.
     */
    async createPrescription(body: CreatePrescription): Promise<PrescriptionSaved> {
      try {
        const res = await http.post<Partial<PrescriptionSaved> & { id?: string }>(ENDPOINTS.emr.createPrescription, body);
        return {
          prescriptionId: res?.prescriptionId ?? res?.id ?? '',
          encounterId: res?.encounterId ?? body.encounterId ?? '',
          rxNo: res?.rxNo ?? '',
        };
      } catch (err) {
        if (isMissingRoute(err)) throw new FeatureUnavailableError('Writing prescriptions');
        if (err instanceof ApiError && err.code === 'allergy_conflict') {
          const conflicts = (err.details as { conflicts?: AllergyConflict[] } | undefined)?.conflicts ?? [];
          throw new AllergyConflictError(err.message, conflicts);
        }
        throw err;
      }
    },

    /** The consultation's current prescription, advice and follow-up, so the Rx screen edits instead of overwriting. */
    async encounterRx(encounterId: string): Promise<EncounterRx | null> {
      if (encounterId.startsWith('demo-')) return null;
      try {
        return normalizeEncounterRx(await http.get(ENDPOINTS.emr.encounter(encounterId)));
      } catch (err) {
        if (isMissingRoute(err)) return null;
        throw err;
      }
    },

    /** Marks the consultation started (best effort: the visit transition is what the queue shows). */
    async startEncounter(encounterId: string): Promise<void> {
      try {
        await http.post(ENDPOINTS.emr.startEncounter(encounterId), {});
      } catch (err) {
        if (isMissingRoute(err) || (err instanceof ApiError && err.status === 409)) return;
        throw err;
      }
    },

    /** Server favourites; null when the EMR module is not on this server (the app then keeps them on the phone). */
    async favourites(): Promise<RxFavourite[] | null> {
      try {
        return normalizeFavourites(await http.get(ENDPOINTS.emr.favourites));
      } catch (err) {
        if (isMissingRoute(err)) return null;
        throw err;
      }
    },

    async saveFavourite(name: string, lines: RxLine[]): Promise<RxFavourite> {
      const clean = lines.map(({ allergyOverrideReason: _drop, ...l }) => l);
      const res = await http.post(ENDPOINTS.emr.favourites, { name, lines: clean });
      return normalizeFavourites([res])[0] ?? { id: '', name, lines: clean };
    },

    deleteFavourite(id: string): Promise<void> {
      return http.delete<void>(ENDPOINTS.emr.favourite(id));
    },

    ownerSummary(date: string): Promise<Loaded<OwnerSummary>> {
      return withFallback(
        'Owner summary',
        async () => normalizeOwnerSummary(await http.get(ENDPOINTS.reports.ownerSummary, { date }), date),
        () => normalizeOwnerSummary(demoOwnerSummary(date), date),
      );
    },

    portalList(kind: PortalKind): Promise<Loaded<PortalRecord[]>> {
      const label = { appointments: 'Appointments', prescriptions: 'Prescriptions', bills: 'Bills', reports: 'Reports' }[kind];
      return withFallback(
        label,
        async () => normalizePortalRecords(await http.get(ENDPOINTS.portal[kind]), kind),
        () => normalizePortalRecords(demoPortal(kind), kind),
      );
    },
  };
}

export type MobileData = ReturnType<typeof createMobileData>;
