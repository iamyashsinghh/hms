// Mobile data layer over @hms/api-client's Http. Calls the agreed module endpoints (endpoints.ts),
// maps responses to view models (normalize.ts), and in development falls back to demo data when an
// owner module's route is not on the server yet. No React Native imports: unit tested under vitest.
import { ApiError, type Http } from '@hms/api-client';
import type { Patient } from '@hms/shared';
import { demoDoctors, demoOwnerSummary, demoPatient, demoPortal, demoQueue, demoTimeline } from './demo';
import { ENDPOINTS } from './endpoints';
import {
  normalizeDoctors,
  normalizeOwnerSummary,
  normalizePortalRecords,
  normalizeQueue,
  normalizeTimeline,
} from './normalize';
import type { CreatePrescription, DoctorRef, Loaded, OwnerSummary, PortalRecord, QueueItem, TimelineEntry } from './types';

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
    /** Doctor's checked-in patients for a day (EMR). */
    async doctorQueue(date: string): Promise<Loaded<QueueItem[]>> {
      try {
        return { data: normalizeQueue(await http.get(ENDPOINTS.emr.queue, { date })), demo: false };
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

    /** Returns the new prescription id. Never falls back to demo data: a clinical write must reach the server. */
    async createPrescription(body: CreatePrescription): Promise<string> {
      try {
        const res = await http.post<{ prescriptionId?: string; id?: string }>(ENDPOINTS.emr.createPrescription, body);
        return res?.prescriptionId ?? res?.id ?? '';
      } catch (err) {
        if (isMissingRoute(err)) throw new FeatureUnavailableError('Writing prescriptions');
        throw err;
      }
    },

    ownerSummary(date: string): Promise<Loaded<OwnerSummary>> {
      return withFallback(
        'Owner summary',
        async () => normalizeOwnerSummary(await http.get(ENDPOINTS.reports.ownerSummary, { date }), date),
        () => normalizeOwnerSummary(demoOwnerSummary(date), date),
      );
    },

    portalList(kind: 'appointments' | 'prescriptions' | 'bills'): Promise<Loaded<PortalRecord[]>> {
      return withFallback(
        kind === 'appointments' ? 'Appointments' : kind === 'prescriptions' ? 'Prescriptions' : 'Bills',
        async () => normalizePortalRecords(await http.get(ENDPOINTS.portal[kind])),
        () => normalizePortalRecords(demoPortal(kind)),
      );
    },
  };
}

export type MobileData = ReturnType<typeof createMobileData>;
