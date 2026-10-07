import type { Paginated, portal } from '@hms/shared';
import type { Http } from '../http';

/**
 * Patient Portal endpoints. Owned by the "portal" workstream. Types come from @hms/shared (portal.*).
 * Patient routes need a client whose getAccessToken returns the patient token (typ 'patient');
 * `staff.*` routes use the normal staff token.
 */
export const portalApi = (http: Http) => ({
  hospital: (code: string) => http.request<portal.PortalHospital>('GET', '/portal/hospital', { query: { code }, auth: false }),

  auth: {
    requestOtp: (body: portal.OtpRequest) =>
      http.request<portal.OtpRequestResponse>('POST', '/portal/auth/otp/request', { body, auth: false }),
    verifyOtp: (body: portal.OtpVerify) =>
      http.request<portal.PatientLoginResponse>('POST', '/portal/auth/otp/verify', { body, auth: false }),
    refresh: (body: portal.PatientRefresh = {}) =>
      http.request<portal.PatientTokens>('POST', '/portal/auth/refresh', { body, auth: false }),
    logout: (body: { refreshToken?: string } = {}) => http.request<void>('POST', '/portal/auth/logout', { body, auth: false }),
  },

  me: () => http.get<portal.PortalMe>('/portal/me'),
  updateMe: (body: portal.UpdateAccount) => http.patch<portal.PortalMe>('/portal/me', body),
  addFamilyMember: (body: portal.AddFamilyMember) => http.post<portal.PortalPatient>('/portal/family', body),

  doctors: (q: portal.DoctorQuery = {}) => http.get<portal.PortalDoctor[]>('/portal/doctors', q),
  slots: (doctorId: string, date: string, facilityId?: string) =>
    http.get<portal.PortalSlot[]>(`/portal/doctors/${doctorId}/slots`, { date, facilityId }),

  appointments: (q: portal.AppointmentListQuery = {}) => http.get<portal.PortalAppointment[]>('/portal/appointments', q),
  book: (body: portal.BookAppointment) => http.post<portal.PortalAppointment>('/portal/appointments', body),
  cancelAppointment: (id: string) => http.post<portal.PortalAppointment>(`/portal/appointments/${id}/cancel`),

  prescriptions: (q: portal.RecordQuery = {}) => http.get<portal.PortalPrescription[]>('/portal/prescriptions', q),
  bills: (q: portal.RecordQuery = {}) => http.get<portal.PortalInvoice[]>('/portal/bills', q),
  reports: (q: portal.RecordQuery = {}) => http.get<portal.PortalReport[]>('/portal/reports', q),

  createPaymentIntent: (body: portal.CreatePaymentIntent) => http.post<portal.PortalPaymentIntent>('/portal/payments/intents', body),
  confirmPayment: (id: string, body: portal.ConfirmPayment) =>
    http.post<portal.PortalPaymentIntent>(`/portal/payments/intents/${id}/confirm`, body),

  feedback: (body: portal.CreateFeedback) => http.post<portal.PortalFeedback>('/portal/feedback', body),

  staff: {
    bookings: (q: portal.StaffBookingQuery = {}) => http.get<Paginated<portal.PortalAppointment>>('/portal/staff/bookings', q),
    decide: (id: string, body: portal.DecideBooking) => http.post<portal.PortalAppointment>(`/portal/staff/bookings/${id}/decision`, body),
    feedback: (q: { page?: number; pageSize?: number } = {}) =>
      http.get<Paginated<portal.PortalFeedback> & portal.FeedbackSummary>('/portal/staff/feedback', q),
  },
});
