import type { Paginated, Patient, frontoffice as fo } from '@hms/shared';
import type { Http } from '../http';

/** Front Office endpoints. Owned by the "frontoffice" workstream. Types come from @hms/shared (frontoffice.*). */
export const frontofficeApi = (http: Http) => ({
  doctors: () => http.get<fo.Doctor[]>('/frontoffice/doctors'),
  slots: (doctorId: string, q: fo.AvailableSlotsQuery) => http.get<fo.AvailableSlot[]>(`/frontoffice/doctors/${doctorId}/slots`, q),

  appointments: {
    list: (q: fo.AppointmentListQuery = {}) => http.get<Paginated<fo.Appointment>>('/frontoffice/appointments', q),
    get: (id: string) => http.get<fo.AppointmentDetail>(`/frontoffice/appointments/${id}`),
    book: (body: fo.BookAppointment) => http.post<fo.Appointment>('/frontoffice/appointments', body),
    reschedule: (id: string, body: fo.RescheduleAppointment) =>
      http.post<fo.Appointment>(`/frontoffice/appointments/${id}/reschedule`, body),
    cancel: (id: string, body: fo.CancelAppointment) => http.post<fo.Appointment>(`/frontoffice/appointments/${id}/cancel`, body),
    noShow: (id: string) => http.post<fo.Appointment>(`/frontoffice/appointments/${id}/no-show`, {}),
    checkIn: (id: string, body: fo.CheckIn = {}) => http.post<fo.Visit>(`/frontoffice/appointments/${id}/check-in`, body),
  },

  walkIn: (body: fo.WalkIn) => http.post<fo.Visit>('/frontoffice/walk-ins', body),
  queue: (q: fo.QueueQuery = {}) => http.get<fo.QueueResponse>('/frontoffice/queue', q),
  visit: (id: string) => http.get<fo.Visit>(`/frontoffice/visits/${id}`),
  transition: (id: string, body: fo.VisitTransition) => http.post<fo.Visit>(`/frontoffice/visits/${id}/transition`, body),
  display: (q: fo.DisplayQuery = {}) => http.get<fo.DisplayBoard>('/frontoffice/display', q),

  patients: {
    duplicates: (q: fo.DuplicateSearch) => http.get<fo.DuplicateCandidate[]>('/frontoffice/patients/duplicates', q),
    merge: (body: fo.MergePatients) => http.post<fo.PatientMerge>('/frontoffice/patients/merge', body),
    merges: () => http.get<fo.PatientMerge[]>('/frontoffice/patients/merges'),
    captureAbha: (id: string, body: fo.AbhaCapture) => http.post<Patient>(`/frontoffice/patients/${id}/abha`, body),
  },
});
