import type { ImportRequest, ImportResult, Paginated, billing as B, ipd as I } from '@hms/shared';
import type { Http } from '../http';

/** IPD & Nursing endpoints. Owned by the "ipd" workstream. Types come from @hms/shared (ipd.*). */
export const ipdApi = (http: Http) => {
  const adm = (id: string) => `/ipd/admissions/${id}`;
  return {
    wards: {
      list: (includeInactive = false) => http.get<I.Ward[]>('/ipd/wards', includeInactive ? { includeInactive: 'true' } : {}),
      create: (body: I.WardInput) => http.post<I.Ward>('/ipd/wards', body),
      update: (id: string, body: I.UpdateWard) => http.patch<I.Ward>(`/ipd/wards/${id}`, body),
    },
    beds: {
      list: (q: I.BedQuery = {}) => http.get<I.Bed[]>('/ipd/beds', q),
      create: (body: I.BedInput) => http.post<I.Bed>('/ipd/beds', body),
      createMany: (body: I.BulkBeds) => http.post<I.Bed[]>('/ipd/beds/bulk', body),
      import: (body: ImportRequest) => http.post<ImportResult>('/ipd/beds/import', body),
      update: (id: string, body: I.UpdateBed) => http.patch<I.Bed>(`/ipd/beds/${id}`, body),
      setStatus: (id: string, body: I.BedStatusInput) => http.post<I.Bed>(`/ipd/beds/${id}/status`, body),
    },
    bedBoard: () => http.get<I.BedBoard>('/ipd/bed-board'),
    admissions: {
      list: (q: I.AdmissionQuery = {}) => http.get<Paginated<I.AdmissionSummary>>('/ipd/admissions', q),
      get: (id: string) => http.get<I.Admission>(adm(id)),
      admit: (body: I.AdmitInput) => http.post<I.Admission>('/ipd/admissions', body),
      update: (id: string, body: I.UpdateAdmission) => http.patch<I.Admission>(adm(id), body),
      transfer: (id: string, body: I.TransferInput) => http.post<I.Admission>(`${adm(id)}/transfer`, body),
      cancel: (id: string, body: I.CancelAdmission) => http.post<I.Admission>(`${adm(id)}/cancel`, body),
      discharge: (id: string, body: I.DischargeInput) => http.post<I.Admission>(`${adm(id)}/discharge`, body),
    },
    vitals: {
      list: (id: string) => http.get<I.Vitals[]>(`${adm(id)}/vitals`),
      record: (id: string, body: I.VitalsInput) => http.post<I.Vitals>(`${adm(id)}/vitals`, body),
    },
    notes: {
      list: (id: string) => http.get<I.NursingNote[]>(`${adm(id)}/nursing-notes`),
      add: (id: string, body: I.NursingNoteInput) => http.post<I.NursingNote>(`${adm(id)}/nursing-notes`, body),
    },
    intakeOutput: {
      get: (id: string) => http.get<I.IntakeOutputChart>(`${adm(id)}/intake-output`),
      record: (id: string, body: I.IntakeOutputInput) => http.post<I.IntakeOutput>(`${adm(id)}/intake-output`, body),
    },
    medications: {
      list: (id: string) => http.get<I.MedicationOrder[]>(`${adm(id)}/medications`),
      order: (id: string, body: I.MedicationOrderInput) => http.post<I.MedicationOrder>(`${adm(id)}/medications`, body),
      stop: (id: string, orderId: string, body: I.StopMedication) => http.post<I.MedicationOrder>(`${adm(id)}/medications/${orderId}/stop`, body),
      administer: (id: string, orderId: string, body: I.AdministerInput) =>
        http.post<I.MedicationOrder>(`${adm(id)}/medications/${orderId}/administrations`, body),
    },
    devices: {
      list: (id: string) => http.get<I.Device[]>(`${adm(id)}/devices`),
      add: (id: string, body: I.DeviceInput) => http.post<I.Device>(`${adm(id)}/devices`, body),
      remove: (id: string, deviceId: string, body: I.RemoveDevice = {}) => http.post<I.Device>(`${adm(id)}/devices/${deviceId}/remove`, body),
    },
    census: (date: string) => http.get<I.WardCensus[]>('/ipd/census', { date }),
    rounds: {
      list: (id: string) => http.get<I.Round[]>(`${adm(id)}/rounds`),
      add: (id: string, body: I.RoundInput) => http.post<I.Round>(`${adm(id)}/rounds`, body),
    },
    bill: {
      get: (id: string) => http.get<I.RunningBill>(`${adm(id)}/bill`),
      /** Billing services for "Post a charge", searched by name or code. */
      services: (q?: string) => http.get<Paginated<B.Service>>('/ipd/services', q ? { q } : {}),
      addCharge: (id: string, body: I.ChargeInput) => http.post<I.Charge>(`${adm(id)}/charges`, body),
      cancelCharge: (id: string, chargeId: string, body: I.CancelCharge) => http.post<I.Charge>(`${adm(id)}/charges/${chargeId}/cancel`, body),
      advance: (id: string, body: I.AdvanceInput) => http.post<I.Advance>(`${adm(id)}/advances`, body),
      finalize: (id: string, body: I.FinalizeBill = {}) => http.post<I.FinalizedBill>(`${adm(id)}/bill/finalize`, body),
    },
    summary: {
      get: (id: string) => http.get<{ summary: I.DischargeSummary | null }>(`${adm(id)}/discharge-summary`),
      draft: (id: string) => http.get<I.DischargeSummaryInput>(`${adm(id)}/discharge-summary/draft`),
      save: (id: string, body: I.DischargeSummaryInput) => http.put<I.DischargeSummary>(`${adm(id)}/discharge-summary`, body),
      finalize: (id: string) => http.post<I.DischargeSummary>(`${adm(id)}/discharge-summary/finalize`),
    },
  };
};
