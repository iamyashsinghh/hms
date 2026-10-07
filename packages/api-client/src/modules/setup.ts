import type { Paginated, setup as S } from '@hms/shared';
import type { Http } from '../http';

/** Hospital Setup endpoints. Owned by the "setup" workstream. Types come from @hms/shared (setup.*). */
export const setupApi = (http: Http) => ({
  // Hospital profile, wizard
  getProfile: () => http.get<S.HospitalProfile>('/setup/profile'),
  saveProfile: (body: S.UpsertProfile) => http.put<S.HospitalProfile>('/setup/profile', body),
  wizard: () => http.get<S.WizardStatus>('/setup/wizard'),
  completeWizard: () => http.post<S.WizardStatus>('/setup/wizard/complete'),

  // Facilities
  listFacilities: (q: S.ListQuery = {}) => http.get<S.FacilityDetail[]>('/setup/facilities', q),
  getFacility: (id: string) => http.get<S.FacilityDetail>(`/setup/facilities/${id}`),
  createFacility: (body: S.CreateFacility) => http.post<S.FacilityDetail>('/setup/facilities', body),
  updateFacility: (id: string, body: S.UpdateFacility) => http.patch<S.FacilityDetail>(`/setup/facilities/${id}`, body),

  // Departments, specializations
  listDepartments: (q: S.ListQuery & { facilityId?: string } = {}) => http.get<S.Department[]>('/setup/departments', q),
  createDepartment: (body: S.CreateDepartment) => http.post<S.Department>('/setup/departments', body),
  updateDepartment: (id: string, body: S.UpdateDepartment) => http.patch<S.Department>(`/setup/departments/${id}`, body),
  listSpecializations: (q: S.ListQuery = {}) => http.get<S.Specialization[]>('/setup/specializations', q),
  createSpecialization: (body: S.CreateSpecialization) => http.post<S.Specialization>('/setup/specializations', body),
  updateSpecialization: (id: string, body: S.UpdateSpecialization) => http.patch<S.Specialization>(`/setup/specializations/${id}`, body),

  // Staff profiles
  listStaff: (q: S.StaffQuery = {}) => http.get<S.StaffMember[]>('/setup/staff', q),
  getStaff: (userId: string) => http.get<S.StaffMember>(`/setup/staff/${userId}`),
  saveStaffProfile: (userId: string, body: S.UpsertStaffProfile) => http.put<S.StaffMember>(`/setup/staff/${userId}/profile`, body),

  // Doctors (contract for frontoffice, emr, portal, mobile)
  listDoctors: (q: S.DoctorQuery = {}) => http.get<S.Doctor[]>('/setup/doctors', q),
  getSchedule: (userId: string) => http.get<S.ScheduleBlock[]>(`/setup/doctors/${userId}/schedule`),
  saveSchedule: (userId: string, body: S.ReplaceSchedule) => http.put<S.ScheduleBlock[]>(`/setup/doctors/${userId}/schedule`, body),
  slots: (userId: string, q: S.SlotsQuery) => http.get<S.DoctorSlot[]>(`/setup/doctors/${userId}/slots`, q),
  listLeaves: (userId: string) => http.get<S.DoctorLeave[]>(`/setup/doctors/${userId}/leaves`),
  addLeave: (userId: string, body: S.CreateLeave) => http.post<S.DoctorLeave>(`/setup/doctors/${userId}/leaves`, body),
  deleteLeave: (userId: string, leaveId: string) => http.delete<void>(`/setup/doctors/${userId}/leaves/${leaveId}`),

  // Users & roles
  listUsers: (q: S.UserQuery = {}) => http.get<Paginated<S.StaffUser>>('/setup/users', q),
  getUser: (id: string) => http.get<S.StaffUser>(`/setup/users/${id}`),
  createUser: (body: S.CreateUser) => http.post<S.UserWithTemporaryPassword>('/setup/users', body),
  updateUser: (id: string, body: S.UpdateUser) => http.patch<S.StaffUser>(`/setup/users/${id}`, body),
  setUserRoles: (id: string, body: S.SetUserRoles) => http.put<S.StaffUser>(`/setup/users/${id}/roles`, body),
  deactivateUser: (id: string) => http.post<S.StaffUser>(`/setup/users/${id}/deactivate`),
  activateUser: (id: string) => http.post<S.StaffUser>(`/setup/users/${id}/activate`),
  resetPassword: (id: string, body: S.ResetPassword = {}) => http.post<S.ResetPasswordResult>(`/setup/users/${id}/reset-password`, body),
  permissions: () => http.get<S.PermissionCatalogEntry[]>('/setup/permissions'),
  listRoles: () => http.get<S.Role[]>('/setup/roles'),
  createRole: (body: S.CreateRole) => http.post<S.Role>('/setup/roles', body),
  updateRole: (id: string, body: S.UpdateRole) => http.patch<S.Role>(`/setup/roles/${id}`, body),
  deleteRole: (id: string) => http.delete<void>(`/setup/roles/${id}`),

  // Number series, print templates
  listNumberSeries: () => http.get<S.NumberSeries[]>('/setup/number-series'),
  updateNumberSeries: (key: string, body: S.UpdateNumberSeries) => http.put<S.NumberSeries>(`/setup/number-series/${encodeURIComponent(key)}`, body),
  listPrintTemplates: (facilityId?: string) => http.get<S.PrintTemplate[]>('/setup/print-templates', { facilityId }),
  getPrintTemplate: (key: S.PrintTemplateKey, facilityId?: string) => http.get<S.PrintTemplate>(`/setup/print-templates/${key}`, { facilityId }),
  savePrintTemplate: (key: S.PrintTemplateKey, body: S.UpsertPrintTemplate) => http.put<S.PrintTemplate>(`/setup/print-templates/${key}`, body),
});
