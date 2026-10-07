import type { Paginated, hr as H } from '@hms/shared';
import type { Http } from '../http';

/** HR & Roster endpoints. Owned by the "hr" workstream. Types come from @hms/shared (hr.*). */
export const hrApi = (http: Http) => ({
  dashboard: (date?: string) => http.get<H.HrDashboard>('/hr/dashboard', { date }),
  departments: () => http.get<string[]>('/hr/departments'),
  employees: {
    list: (q: H.EmployeeQuery = {}) => http.get<Paginated<H.Employee>>('/hr/employees', q),
    get: (id: string) => http.get<H.Employee>(`/hr/employees/${id}`),
    create: (body: H.CreateEmployee) => http.post<H.Employee>('/hr/employees', body),
    update: (id: string, body: H.UpdateEmployee) => http.patch<H.Employee>(`/hr/employees/${id}`, body),
    leaveBalances: (id: string, year?: number) => http.get<H.LeaveBalance[]>(`/hr/employees/${id}/leave-balances`, { year }),
  },
  licences: {
    list: (employeeId: string) => http.get<H.Licence[]>(`/hr/employees/${employeeId}/licences`),
    add: (employeeId: string, body: H.LicenceInput) => http.post<H.Licence>(`/hr/employees/${employeeId}/licences`, body),
    update: (id: string, body: H.LicenceInput) => http.patch<H.Licence>(`/hr/licences/${id}`, body),
    remove: (id: string) => http.delete<void>(`/hr/licences/${id}`),
    expiring: (days = 60) => http.get<H.ExpiringLicence[]>('/hr/licences/expiring', { days }),
  },
  shifts: {
    list: () => http.get<H.Shift[]>('/hr/shifts'),
    create: (body: H.ShiftInput) => http.post<H.Shift>('/hr/shifts', body),
    update: (id: string, body: H.UpdateShift) => http.patch<H.Shift>(`/hr/shifts/${id}`, body),
  },
  roster: {
    get: (q: H.RosterQuery) => http.get<H.RosterView>('/hr/roster', q),
    save: (body: H.SaveRoster) => http.put<{ saved: number; cleared: number }>('/hr/roster', body),
    copyWeek: (body: H.CopyRoster) => http.post<{ copied: number; skipped: number }>('/hr/roster/copy-week', body),
    onDuty: (date?: string) => http.get<H.OnDutyRow[]>('/hr/on-duty', { date }),
  },
  attendance: {
    sheet: (q: H.AttendanceQuery) => http.get<H.AttendanceSheetRow[]>('/hr/attendance', q),
    mark: (body: H.MarkAttendance) => http.put<H.AttendanceRecord[]>('/hr/attendance', body),
    summary: (month: string) => http.get<H.AttendanceSummary[]>('/hr/attendance/summary', { month }),
  },
  leaveTypes: {
    list: () => http.get<H.LeaveType[]>('/hr/leave-types'),
    create: (body: H.LeaveTypeInput) => http.post<H.LeaveType>('/hr/leave-types', body),
    update: (id: string, body: H.UpdateLeaveType) => http.patch<H.LeaveType>(`/hr/leave-types/${id}`, body),
  },
  leaves: {
    list: (q: H.LeaveQuery = {}) => http.get<Paginated<H.LeaveRequest>>('/hr/leaves', q),
    create: (body: H.CreateLeave) => http.post<H.LeaveRequest>('/hr/leaves', body),
    decide: (id: string, body: H.DecideLeave) => http.post<H.LeaveRequest>(`/hr/leaves/${id}/decide`, body),
    cancel: (id: string) => http.post<H.LeaveRequest>(`/hr/leaves/${id}/cancel`),
  },
  payroll: {
    list: () => http.get<H.PayrollRunSummary[]>('/hr/payroll'),
    get: (id: string) => http.get<H.PayrollRun>(`/hr/payroll/${id}`),
    create: (body: H.CreatePayrollRun) => http.post<H.PayrollRun>('/hr/payroll', body),
    recalculate: (id: string) => http.post<H.PayrollRun>(`/hr/payroll/${id}/recalculate`),
    finalize: (id: string) => http.post<H.PayrollRun>(`/hr/payroll/${id}/finalize`),
    remove: (id: string) => http.delete<void>(`/hr/payroll/${id}`),
    export: (id: string) => http.get<H.PayrollExport>(`/hr/payroll/${id}/export`),
    payslip: (id: string) => http.get<H.Payslip>(`/hr/payslips/${id}`),
    adjust: (id: string, body: H.AdjustPayslip) => http.patch<H.Payslip>(`/hr/payslips/${id}`, body),
  },
  /** Self-service for any staff member with hr.self.use. */
  me: {
    get: () => http.get<H.MyHr>('/hr/me'),
    punch: () => http.post<H.AttendanceRecord>('/hr/me/punch'),
    attendance: (month: string) => http.get<H.AttendanceRecord[]>('/hr/me/attendance', { month }),
    roster: (from: string, to: string) => http.get<{ shifts: H.Shift[]; entries: H.RosterEntry[] }>('/hr/me/roster', { from, to }),
    leaves: () => http.get<H.LeaveRequest[]>('/hr/me/leaves'),
    applyLeave: (body: H.ApplyLeave) => http.post<H.LeaveRequest>('/hr/me/leaves', body),
    cancelLeave: (id: string) => http.post<H.LeaveRequest>(`/hr/me/leaves/${id}/cancel`),
    leaveBalances: (year?: number) => http.get<H.LeaveBalance[]>('/hr/me/leave-balances', { year }),
    payslips: () => http.get<H.Payslip[]>('/hr/me/payslips'),
    payslip: (id: string) => http.get<H.Payslip>(`/hr/me/payslips/${id}`),
  },
});
