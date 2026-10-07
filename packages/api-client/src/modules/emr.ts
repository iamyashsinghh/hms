import type { emr, Paginated } from '@hms/shared';
import type { Http } from '../http';

/** OPD / EMR endpoints. Owned by the "emr" workstream. Types come from @hms/shared (emr.*). */
export const emrApi = (http: Http) => ({
  queue: (q: { date?: string; doctorId?: string } = {}) => http.get<{ items: emr.QueueItem[] }>('/emr/queue', q),
  timeline: (patientId: string, q: emr.TimelineQuery = {}) => http.get<Paginated<emr.TimelineEntry>>(`/emr/patients/${patientId}/timeline`, q),
  icd10: (q: string) => http.get<emr.Icd10Code[]>('/emr/icd10', { q }),

  open: (body: emr.CreateEncounter) => http.post<emr.Encounter>('/emr/encounters', body),
  get: (id: string) => http.get<emr.Encounter>(`/emr/encounters/${id}`),
  printEncounter: (id: string) => http.get<emr.PrintEncounter>(`/emr/encounters/${id}/print`),
  update: (id: string, body: emr.UpdateEncounter) => http.patch<emr.Encounter>(`/emr/encounters/${id}`, body),
  start: (id: string) => http.post<emr.Encounter>(`/emr/encounters/${id}/start`),
  addVitals: (id: string, body: emr.VitalsInput) => http.post<emr.Encounter>(`/emr/encounters/${id}/vitals`, body),
  setDiagnoses: (id: string, body: emr.DiagnosesInput) => http.put<emr.Encounter>(`/emr/encounters/${id}/diagnoses`, body),
  setOrders: (id: string, body: emr.OrdersInput) => http.put<emr.Encounter>(`/emr/encounters/${id}/orders`, body),
  setPrescription: (id: string, body: emr.PrescriptionInput) => http.put<emr.Encounter>(`/emr/encounters/${id}/prescription`, body),
  sign: (id: string) => http.post<emr.Encounter>(`/emr/encounters/${id}/sign`),
  cancel: (id: string) => http.post<emr.Encounter>(`/emr/encounters/${id}/cancel`),
  addAddendum: (id: string, body: emr.AddendumInput) => http.post<emr.Encounter>(`/emr/encounters/${id}/addenda`, body),

  quickPrescription: (body: emr.QuickPrescription) => http.post<emr.QuickPrescriptionResult>('/emr/prescriptions', body),
  getPrescription: (id: string) => http.get<emr.Prescription>(`/emr/prescriptions/${id}`),

  favourites: () => http.get<emr.Favourite[]>('/emr/favourites'),
  createFavourite: (body: emr.FavouriteInput) => http.post<emr.Favourite>('/emr/favourites', body),
  deleteFavourite: (id: string) => http.delete<void>(`/emr/favourites/${id}`),

  createCertificate: (body: emr.CreateCertificate) => http.post<emr.Certificate>('/emr/certificates', body),
  getCertificate: (id: string) => http.get<emr.Certificate>(`/emr/certificates/${id}`),
  printCertificate: (id: string) => http.get<emr.PrintCertificate>(`/emr/certificates/${id}/print`),
  patientCertificates: (patientId: string) => http.get<emr.Certificate[]>(`/emr/patients/${patientId}/certificates`),
});
