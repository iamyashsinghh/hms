/**
 * HR & Roster tables. Owned by the "hr" workstream (Postgres schema: hr).
 * Money is numeric(14,2) and comes back from Drizzle as a string.
 * Kept in sync with migrations/*_hr_*.sql (pnpm test checks it).
 */
import { boolean, date, foreignKey, index, integer, numeric, primaryKey, text, time, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { actorColumns, hr as pg, idColumn, tenantIdColumn, timestamps } from './_common';
import { facilities, users } from './core';

const money = (name: string) => numeric(name, { precision: 14, scale: 2 });
const dayCount = (name: string) => numeric(name, { precision: 5, scale: 1 });
const day = (name: string) => date(name, { mode: 'string' });
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' });

/** HR record for a staff member. Staff who log in link to iam.users; others (support staff) have no user. */
export const hrEmployees = pg.table(
  'employees',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    userId: uuid('user_id'),
    employeeCode: text('employee_code').notNull(),
    fullName: text('full_name').notNull(),
    gender: text('gender'),
    dateOfBirth: day('date_of_birth'),
    mobile: text('mobile'),
    email: text('email'),
    category: text('category').notNull().default('other'),
    designation: text('designation'),
    department: text('department'),
    facilityId: uuid('facility_id'),
    employmentType: text('employment_type').notNull().default('permanent'),
    dateOfJoining: day('date_of_joining').notNull(),
    dateOfExit: day('date_of_exit'),
    status: text('status').notNull().default('active'),
    address: text('address'),
    emergencyContactName: text('emergency_contact_name'),
    emergencyContactPhone: text('emergency_contact_phone'),
    pan: text('pan'),
    uan: text('uan'),
    esicNo: text('esic_no'),
    bankAccountNo: text('bank_account_no'),
    bankIfsc: text('bank_ifsc'),
    bankName: text('bank_name'),
    basic: money('basic').notNull().default('0'),
    hra: money('hra').notNull().default('0'),
    otherAllowances: money('other_allowances').notNull().default('0'),
    pfApplicable: boolean('pf_applicable').notNull().default(false),
    esiApplicable: boolean('esi_applicable').notNull().default(false),
    professionalTax: money('professional_tax').notNull().default('0'),
    tdsMonthly: money('tds_monthly').notNull().default('0'),
    ...actorColumns(),
    ...timestamps(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    uniqueIndex('hr_employees_code_uq').on(t.tenantId, t.employeeCode),
    foreignKey({ columns: [t.tenantId, t.userId], foreignColumns: [users.tenantId, users.id] }),
    foreignKey({ columns: [t.tenantId, t.facilityId], foreignColumns: [facilities.tenantId, facilities.id] }),
  ],
);

export const hrLicences = pg.table(
  'licences',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    employeeId: uuid('employee_id').notNull(),
    kind: text('kind').notNull(),
    number: text('number').notNull(),
    issuedBy: text('issued_by'),
    validFrom: day('valid_from'),
    validUntil: day('valid_until'),
    notes: text('notes'),
    ...actorColumns(),
    ...timestamps(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    index('hr_licences_employee_idx').on(t.tenantId, t.employeeId),
    index('hr_licences_expiry_idx').on(t.tenantId, t.validUntil),
    foreignKey({ columns: [t.tenantId, t.employeeId], foreignColumns: [hrEmployees.tenantId, hrEmployees.id] }).onDelete('cascade'),
  ],
);

export const hrShifts = pg.table(
  'shifts',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    startTime: time('start_time').notNull(),
    endTime: time('end_time').notNull(),
    breakMinutes: integer('break_minutes').notNull().default(0),
    graceMinutes: integer('grace_minutes').notNull().default(10),
    color: text('color'),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] }), uniqueIndex('hr_shifts_code_uq').on(t.tenantId, t.code)],
);

export const hrLeaveTypes = pg.table(
  'leave_types',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    annualQuota: dayCount('annual_quota').notNull().default('0'),
    isPaid: boolean('is_paid').notNull().default(true),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] }), uniqueIndex('hr_leave_types_code_uq').on(t.tenantId, t.code)],
);

export const hrLeaveRequests = pg.table(
  'leave_requests',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    employeeId: uuid('employee_id').notNull(),
    leaveTypeId: uuid('leave_type_id').notNull(),
    fromDate: day('from_date').notNull(),
    toDate: day('to_date').notNull(),
    halfDay: boolean('half_day').notNull().default(false),
    days: dayCount('days').notNull(),
    reason: text('reason'),
    status: text('status').notNull().default('pending'),
    decidedBy: uuid('decided_by'),
    decidedAt: ts('decided_at'),
    decisionNote: text('decision_note'),
    ...actorColumns(),
    ...timestamps(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    index('hr_leave_requests_employee_idx').on(t.tenantId, t.employeeId, t.fromDate),
    index('hr_leave_requests_status_idx').on(t.tenantId, t.status),
    foreignKey({ columns: [t.tenantId, t.employeeId], foreignColumns: [hrEmployees.tenantId, hrEmployees.id] }).onDelete('cascade'),
    foreignKey({ columns: [t.tenantId, t.leaveTypeId], foreignColumns: [hrLeaveTypes.tenantId, hrLeaveTypes.id] }),
  ],
);

/** One duty-roster cell per employee per day. */
export const hrRosterEntries = pg.table(
  'roster_entries',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    facilityId: uuid('facility_id').notNull(),
    employeeId: uuid('employee_id').notNull(),
    dutyDate: day('duty_date').notNull(),
    kind: text('kind').notNull().default('shift'),
    shiftId: uuid('shift_id'),
    ward: text('ward'),
    leaveRequestId: uuid('leave_request_id'),
    ...actorColumns(),
    ...timestamps(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    uniqueIndex('hr_roster_employee_day_uq').on(t.tenantId, t.employeeId, t.dutyDate),
    index('hr_roster_facility_day_idx').on(t.tenantId, t.facilityId, t.dutyDate),
    foreignKey({ columns: [t.tenantId, t.facilityId], foreignColumns: [facilities.tenantId, facilities.id] }),
    foreignKey({ columns: [t.tenantId, t.employeeId], foreignColumns: [hrEmployees.tenantId, hrEmployees.id] }).onDelete('cascade'),
    foreignKey({ columns: [t.tenantId, t.shiftId], foreignColumns: [hrShifts.tenantId, hrShifts.id] }),
  ],
);

export const hrAttendance = pg.table(
  'attendance',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    facilityId: uuid('facility_id').notNull(),
    employeeId: uuid('employee_id').notNull(),
    workDate: day('work_date').notNull(),
    status: text('status').notNull(),
    checkIn: ts('check_in'),
    checkOut: ts('check_out'),
    lateMinutes: integer('late_minutes').notNull().default(0),
    workedMinutes: integer('worked_minutes'),
    overtimeMinutes: integer('overtime_minutes').notNull().default(0),
    source: text('source').notNull().default('manual'),
    remarks: text('remarks'),
    ...actorColumns(),
    ...timestamps(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    uniqueIndex('hr_attendance_employee_day_uq').on(t.tenantId, t.employeeId, t.workDate),
    index('hr_attendance_facility_day_idx').on(t.tenantId, t.facilityId, t.workDate),
    foreignKey({ columns: [t.tenantId, t.facilityId], foreignColumns: [facilities.tenantId, facilities.id] }),
    foreignKey({ columns: [t.tenantId, t.employeeId], foreignColumns: [hrEmployees.tenantId, hrEmployees.id] }).onDelete('cascade'),
  ],
);

export const hrPayrollRuns = pg.table(
  'payroll_runs',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    month: day('month').notNull(),
    status: text('status').notNull().default('draft'),
    employeeCount: integer('employee_count').notNull().default(0),
    grossTotal: money('gross_total').notNull().default('0'),
    deductionTotal: money('deduction_total').notNull().default('0'),
    netTotal: money('net_total').notNull().default('0'),
    employerCostTotal: money('employer_cost_total').notNull().default('0'),
    finalizedAt: ts('finalized_at'),
    finalizedBy: uuid('finalized_by'),
    ...actorColumns(),
    ...timestamps(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] }), uniqueIndex('hr_payroll_runs_month_uq').on(t.tenantId, t.month)],
);

export const hrPayslips = pg.table(
  'payslips',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    runId: uuid('run_id').notNull(),
    employeeId: uuid('employee_id').notNull(),
    employeeCode: text('employee_code').notNull(),
    employeeName: text('employee_name').notNull(),
    designation: text('designation'),
    department: text('department'),
    pan: text('pan'),
    uan: text('uan'),
    bankAccountNo: text('bank_account_no'),
    bankIfsc: text('bank_ifsc'),
    daysInMonth: integer('days_in_month').notNull(),
    payableDays: dayCount('payable_days').notNull(),
    lopDays: dayCount('lop_days').notNull().default('0'),
    basic: money('basic').notNull().default('0'),
    hra: money('hra').notNull().default('0'),
    otherAllowances: money('other_allowances').notNull().default('0'),
    otherEarnings: money('other_earnings').notNull().default('0'),
    gross: money('gross').notNull().default('0'),
    pfEmployee: money('pf_employee').notNull().default('0'),
    esiEmployee: money('esi_employee').notNull().default('0'),
    professionalTax: money('professional_tax').notNull().default('0'),
    tds: money('tds').notNull().default('0'),
    otherDeductions: money('other_deductions').notNull().default('0'),
    totalDeductions: money('total_deductions').notNull().default('0'),
    netPay: money('net_pay').notNull().default('0'),
    pfEmployer: money('pf_employer').notNull().default('0'),
    esiEmployer: money('esi_employer').notNull().default('0'),
    remarks: text('remarks'),
    ...timestamps(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    uniqueIndex('hr_payslips_run_employee_uq').on(t.tenantId, t.runId, t.employeeId),
    index('hr_payslips_employee_idx').on(t.tenantId, t.employeeId),
    foreignKey({ columns: [t.tenantId, t.runId], foreignColumns: [hrPayrollRuns.tenantId, hrPayrollRuns.id] }).onDelete('cascade'),
    foreignKey({ columns: [t.tenantId, t.employeeId], foreignColumns: [hrEmployees.tenantId, hrEmployees.id] }),
  ],
);
