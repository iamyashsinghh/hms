import type {
  AuthTokens,
  CreatePatient,
  LoginRequest,
  LoginResponse,
  Me,
  Paginated,
  Patient,
  PatientSearchQuery,
  RefreshRequest,
  UpdatePatient,
} from '@hms/shared';
import type { Http } from './http';

export const authApi = (http: Http) => ({
  login: (body: LoginRequest) => http.request<LoginResponse>('POST', '/auth/login', { body, auth: false }),
  refresh: (body: RefreshRequest = {}) => http.request<AuthTokens>('POST', '/auth/refresh', { body, auth: false }),
  logout: (body: { refreshToken?: string } = {}) => http.request<void>('POST', '/auth/logout', { body, auth: false }),
  me: () => http.get<Me>('/auth/me'),
});

export const patientsApi = (http: Http) => ({
  list: (q: PatientSearchQuery = {}) => http.get<Paginated<Patient>>('/patients', q),
  get: (id: string) => http.get<Patient>(`/patients/${id}`),
  create: (body: CreatePatient) => http.post<Patient>('/patients', body),
  update: (id: string, body: UpdatePatient) => http.patch<Patient>(`/patients/${id}`, body),
});
