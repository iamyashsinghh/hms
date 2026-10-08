import { z } from 'zod';
import { defineModule } from '../manifest';
import { patchSchema } from '../patch';
import type { ImportColumn } from '../imports';

/**
 * HR & Roster: permissions and API contracts (Zod schemas + types).
 * Owned by the "hr" workstream. Money travels as numbers in rupees with 2 decimals; dates as YYYY-MM-DD.
 */
const ALL_HR = [
  'hr.employee.read', 'hr.employee.manage', 'hr.roster.read', 'hr.roster.manage', 'hr.attendance.read',
  'hr.attendance.manage', 'hr.leave.read', 'hr.leave.approve', 'hr.leave.manage', 'hr.payroll.read',
  'hr.payroll.manage', 'hr.payroll.finalize', 'hr.self.use',
];

export const hrModule = defineModule({
  key: 'hr',
  name: 'HR & Roster',
  permissions: [
    { key: 'hr.employee.read', description: 'View employee records and licence expiry' },
    { key: 'hr.employee.manage', description: 'Add and edit employees and their licences' },
    { key: 'hr.roster.read', description: 'View shifts and the duty roster' },
    { key: 'hr.roster.manage', description: 'Create shifts and plan the duty roster' },
    { key: 'hr.attendance.read', description: "View everyone's attendance" },
    { key: 'hr.attendance.manage', description: 'Mark and correct attendance' },
    { key: 'hr.leave.read', description: "View everyone's leave requests and balances" },
    { key: 'hr.leave.approve', description: 'Approve or reject leave requests' },
    { key: 'hr.leave.manage', description: 'Set up leave types and quotas' },
    { key: 'hr.payroll.read', description: 'View salaries, bank details, payroll and payslips' },
    { key: 'hr.payroll.manage', description: 'Set salaries and prepare monthly payroll' },
    { key: 'hr.payroll.finalize', description: 'Finalize monthly payroll (locks payslips)' },
    { key: 'hr.self.use', description: 'Own HR self-service: duty roster, punch in/out, leave, payslips' },
  ],
  grants: {
    hospital_admin: ALL_HR,
    hr_manager: ALL_HR,
    owner: ['hr.employee.read', 'hr.roster.read', 'hr.attendance.read', 'hr.leave.read', 'hr.payroll.read', 'hr.payroll.finalize', 'hr.self.use'],
    accountant: ['hr.employee.read', 'hr.payroll.read', 'hr.payroll.manage', 'hr.self.use'],
    doctor: ['hr.roster.read', 'hr.self.use'],
    nurse: ['hr.roster.read', 'hr.self.use'],
    receptionist: ['hr.roster.read', 'hr.self.use'],
    pharmacist: ['hr.self.use'],
    lab_technician: ['hr.roster.read', 'hr.self.use'],
    radiologist: ['hr.roster.read', 'hr.self.use'],
    billing_clerk: ['hr.self.use'],
    store_keeper: ['hr.self.use'],
    quality_manager: ['hr.employee.read', 'hr.roster.read', 'hr.self.use'],
  },
});

// ---------- shared bits ----------

const money = z.coerce
  .number()
  .min(0)
  .max(99_999_999.99)
  .refine((v) => Math.abs(Math.round(v * 100) - v * 100) < 1e-6, 'At most 2 decimal places');
const text = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) => text(max).optional();
const nullableText = (max: number) => text(max).nullable().optional();
const isoDate = z.iso.date();
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24-hour)');
/** Empty strings from forms become undefined. */
const blankToUndef = <T extends z.ZodType>(s: T) => z.union([z.literal('').transform(() => undefined), s]);

export const EMPLOYEE_CATEGORIES = ['doctor', 'nurse', 'technician', 'pharmacist', 'admin', 'support', 'other'] as const;
export const EMPLOYMENT_TYPES = ['permanent', 'contract', 'consultant', 'trainee', 'intern'] as const;
export const EMPLOYEE_STATUSES = ['active', 'on_notice', 'exited'] as const;
export const LICENCE_KINDS = [
  'medical_registration', 'nursing_registration', 'pharmacy_registration', 'paramedical_registration',
  'bls', 'acls', 'radiation_safety', 'other',
] as const;
export const ROSTER_KINDS = ['shift', 'off', 'leave', 'holiday'] as const;
export const ATTENDANCE_STATUSES = ['present', 'absent', 'half_day', 'leave', 'off', 'holiday'] as const;
export const LEAVE_STATUSES = ['pending', 'approved', 'rejected', 'cancelled'] as const;
export const PAYROLL_STATUSES = ['draft', 'final'] as const;

export type EmployeeCategory = (typeof EMPLOYEE_CATEGORIES)[number];
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];
export type EmployeeStatus = (typeof EMPLOYEE_STATUSES)[number];
export type LicenceKind = (typeof LICENCE_KINDS)[number];
export type RosterKind = (typeof ROSTER_KINDS)[number];
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];
export type LeaveStatus = (typeof LEAVE_STATUSES)[number];
export type PayrollStatus = (typeof PAYROLL_STATUSES)[number];

/** Statutory rates used by payroll (India). */
export const PAYROLL_RULES = {
  /** Employee and employer PF: 12% of basic, on basic capped at the wage ceiling. */
  pfRate: 0.12,
  pfWageCeiling: 15000,
  /** ESI applies while monthly gross is at or below the ceiling. */
  esiEmployeeRate: 0.0075,
  esiEmployerRate: 0.0325,
  esiGrossCeiling: 21000,
} as const;

/** Leave types created for a hospital the first time HR is opened. */
export const DEFAULT_LEAVE_TYPES = [
  { code: 'CL', name: 'Casual leave', annualQuota: 12, isPaid: true },
  { code: 'SL', name: 'Sick leave', annualQuota: 12, isPaid: true },
  { code: 'EL', name: 'Earned leave', annualQuota: 15, isPaid: true },
  { code: 'LOP', name: 'Leave without pay', annualQuota: 0, isPaid: false },
] as const;

/** Shifts created for a hospital the first time HR is opened. */
export const DEFAULT_SHIFTS = [
  { code: 'M', name: 'Morning', startTime: '08:00', endTime: '14:00', color: '#0ea5e9' },
  { code: 'E', name: 'Evening', startTime: '14:00', endTime: '20:00', color: '#f59e0b' },
  { code: 'N', name: 'Night', startTime: '20:00', endTime: '08:00', color: '#6366f1' },
  { code: 'G', name: 'General', startTime: '09:00', endTime: '17:00', color: '#10b981' },
] as const;

// ---------- employees ----------

const employeeFields = {
  userId: z.uuid().nullable().optional(),
  fullName: text(150).min(1),
  gender: blankToUndef(z.enum(['male', 'female', 'other']).nullable().optional()),
  dateOfBirth: blankToUndef(isoDate.nullable().optional()),
  mobile: blankToUndef(z.string().regex(/^[6-9]\d{9}$/, 'Enter a 10-digit Indian mobile number').nullable().optional()),
  email: blankToUndef(z.email().nullable().optional()),
  category: z.enum(EMPLOYEE_CATEGORIES).default('other'),
  designation: nullableText(100),
  department: nullableText(100),
  facilityId: blankToUndef(z.uuid().nullable().optional()),
  employmentType: z.enum(EMPLOYMENT_TYPES).default('permanent'),
  dateOfJoining: isoDate,
  address: nullableText(500),
  emergencyContactName: nullableText(100),
  emergencyContactPhone: nullableText(20),
  pan: blankToUndef(z.string().trim().toUpperCase().regex(/^[A-Z]{5}\d{4}[A-Z]$/, 'Enter a valid PAN').nullable().optional()),
  uan: blankToUndef(z.string().regex(/^\d{12}$/, 'UAN is 12 digits').nullable().optional()),
  esicNo: nullableText(20),
  bankAccountNo: blankToUndef(z.string().regex(/^\d{6,18}$/, 'Account number is 6 to 18 digits').nullable().optional()),
  bankIfsc: blankToUndef(z.string().trim().toUpperCase().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Enter a valid IFSC').nullable().optional()),
  bankName: nullableText(100),
  basic: money.optional(),
  hra: money.optional(),
  otherAllowances: money.optional(),
  pfApplicable: z.boolean().optional(),
  esiApplicable: z.boolean().optional(),
  professionalTax: money.optional(),
  tdsMonthly: money.optional(),
};

export const createEmployeeSchema = z.object({
  ...employeeFields,
  /** Leave empty to get the next EMP number. */
  employeeCode: blankToUndef(z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9_/-]{0,29}$/, 'Letters, digits, - _ /').optional()),
});
export type CreateEmployee = z.input<typeof createEmployeeSchema>;

/** Columns of the staff import sheet. Format account numbers and UAN as text in Excel so leading zeros survive. */
export const EMPLOYEE_IMPORT_COLUMNS: readonly ImportColumn[] = [
  { key: 'employeeCode', header: 'Employee code', type: 'text', example: 'EMP00101', help: 'Leave blank for the next EMP number' },
  { key: 'fullName', header: 'Full name', type: 'text', required: true, example: 'Anita Sharma' },
  { key: 'gender', header: 'Gender', type: 'enum', options: ['male', 'female', 'other'], example: 'female' },
  { key: 'dateOfBirth', header: 'Date of birth', type: 'date', example: '15/08/1990' },
  { key: 'mobile', header: 'Mobile', type: 'text', example: '9876543210' },
  { key: 'email', header: 'Email', type: 'text', example: 'anita@example.com' },
  { key: 'category', header: 'Category', type: 'enum', options: EMPLOYEE_CATEGORIES, example: 'nurse' },
  { key: 'designation', header: 'Designation', type: 'text', example: 'Staff nurse' },
  { key: 'department', header: 'Department', type: 'text', example: 'Nursing' },
  { key: 'employmentType', header: 'Employment type', type: 'enum', options: EMPLOYMENT_TYPES, example: 'permanent' },
  { key: 'dateOfJoining', header: 'Date of joining', type: 'date', required: true, example: '01/04/2024' },
  { key: 'address', header: 'Address', type: 'text', example: '' },
  { key: 'emergencyContactName', header: 'Emergency contact', type: 'text', example: '' },
  { key: 'emergencyContactPhone', header: 'Emergency phone', type: 'text', example: '' },
  { key: 'pan', header: 'PAN', type: 'text', example: 'ABCDE1234F' },
  { key: 'uan', header: 'UAN', type: 'text', example: '' },
  { key: 'esicNo', header: 'ESIC no', type: 'text', example: '' },
  { key: 'bankAccountNo', header: 'Bank account no', type: 'text', example: '' },
  { key: 'bankIfsc', header: 'IFSC', type: 'text', example: '' },
  { key: 'bankName', header: 'Bank name', type: 'text', example: '' },
  { key: 'basic', header: 'Basic', type: 'number', example: 25000 },
  { key: 'hra', header: 'HRA', type: 'number', example: 10000 },
  { key: 'otherAllowances', header: 'Other allowances', type: 'number', example: 0 },
  { key: 'pfApplicable', header: 'PF', type: 'boolean', example: 'Yes' },
  { key: 'esiApplicable', header: 'ESI', type: 'boolean', example: 'No' },
  { key: 'professionalTax', header: 'Professional tax', type: 'number', example: 200 },
  { key: 'tdsMonthly', header: 'TDS monthly', type: 'number', example: 0 },
];
export const employeeImportRowSchema = createEmployeeSchema
  .omit({ userId: true, facilityId: true })
  .refine((r) => !r.dateOfBirth || r.dateOfBirth < r.dateOfJoining, { path: ['dateOfBirth'], message: 'Date of birth must be before joining' });
export type EmployeeImportRow = z.output<typeof employeeImportRowSchema>;

// patchSchema, not .partial(): Zod 4 keeps defaults inside .partial(), so a partial update would reset them.
export const updateEmployeeSchema = patchSchema(
  z.object({
    ...employeeFields,
    status: z.enum(EMPLOYEE_STATUSES),
    dateOfExit: blankToUndef(isoDate.nullable().optional()),
  }),
);
export type UpdateEmployee = z.input<typeof updateEmployeeSchema>;
export type EmployeeValues = z.output<typeof updateEmployeeSchema>;

export const employeeQuerySchema = z.object({
  q: optionalText(100),
  category: z.enum(EMPLOYEE_CATEGORIES).optional(),
  status: z.enum([...EMPLOYEE_STATUSES, 'current', 'all']).default('current'),
  department: optionalText(100),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(50),
});
export type EmployeeQuery = z.input<typeof employeeQuerySchema>;

export interface SalaryStructure {
  basic: number;
  hra: number;
  otherAllowances: number;
  monthlyGross: number;
  pfApplicable: boolean;
  esiApplicable: boolean;
  professionalTax: number;
  tdsMonthly: number;
}

export interface BankDetails {
  pan: string | null;
  uan: string | null;
  esicNo: string | null;
  bankAccountNo: string | null;
  bankIfsc: string | null;
  bankName: string | null;
}

export interface Employee {
  id: string;
  userId: string | null;
  employeeCode: string;
  fullName: string;
  gender: string | null;
  dateOfBirth: string | null;
  mobile: string | null;
  email: string | null;
  category: EmployeeCategory;
  designation: string | null;
  department: string | null;
  facilityId: string | null;
  employmentType: EmploymentType;
  dateOfJoining: string;
  dateOfExit: string | null;
  status: EmployeeStatus;
  address: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  /** Only returned to users with hr.payroll.read (and to the employee themself). */
  salary?: SalaryStructure;
  bank?: BankDetails;
  /** Earliest licence expiry date, if any licence is on file. */
  nextLicenceExpiry: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---------- licences ----------

export const licenceInputSchema = z.object({
  kind: z.enum(LICENCE_KINDS),
  number: text(60).min(1),
  issuedBy: nullableText(150),
  validFrom: blankToUndef(isoDate.nullable().optional()),
  validUntil: blankToUndef(isoDate.nullable().optional()),
  notes: nullableText(500),
});
export type LicenceInput = z.input<typeof licenceInputSchema>;
export type LicenceValues = z.output<typeof licenceInputSchema>;

export interface Licence {
  id: string;
  employeeId: string;
  kind: LicenceKind;
  number: string;
  issuedBy: string | null;
  validFrom: string | null;
  validUntil: string | null;
  notes: string | null;
  /** Days until expiry (negative once expired); null when there is no expiry date. */
  daysLeft: number | null;
}

export interface ExpiringLicence extends Licence {
  employeeName: string;
  employeeCode: string;
  designation: string | null;
}

export const expiringQuerySchema = z.object({ days: z.coerce.number().int().min(0).max(365).default(60) });

// ---------- shifts ----------

export const shiftInputSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9_-]{0,9}$/, 'Up to 10 letters or digits'),
  name: text(60).min(1),
  startTime: hhmm,
  endTime: hhmm,
  breakMinutes: z.coerce.number().int().min(0).max(240).default(0),
  graceMinutes: z.coerce.number().int().min(0).max(120).default(10),
  color: blankToUndef(z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional()),
  isActive: z.boolean().default(true),
});
export type ShiftInput = z.input<typeof shiftInputSchema>;
export const updateShiftSchema = patchSchema(shiftInputSchema.omit({ code: true }));
export type UpdateShift = z.input<typeof updateShiftSchema>;

export interface Shift {
  id: string;
  code: string;
  name: string;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  graceMinutes: number;
  color: string | null;
  isActive: boolean;
  /** True when the shift ends the next day. */
  overnight: boolean;
  /** Working minutes after the break. */
  durationMinutes: number;
}

// ---------- roster ----------

export const rosterQuerySchema = z.object({
  from: isoDate,
  to: isoDate,
  department: optionalText(100),
  employeeId: z.uuid().optional(),
});
export type RosterQuery = z.input<typeof rosterQuerySchema>;

export const rosterCellSchema = z.object({
  employeeId: z.uuid(),
  date: isoDate,
  /** null clears the cell. */
  kind: z.enum(ROSTER_KINDS).nullable(),
  shiftId: z.uuid().nullable().optional(),
  ward: nullableText(60),
});
export const saveRosterSchema = z.object({ cells: z.array(rosterCellSchema).min(1).max(2000) });
export type SaveRoster = z.input<typeof saveRosterSchema>;

export const copyRosterSchema = z.object({
  /** Monday (or any day) of the week to copy from; 7 days are copied. */
  fromWeekStart: isoDate,
  toWeekStart: isoDate,
  /** Overwrite cells that already have an entry in the target week. */
  overwrite: z.boolean().default(false),
});
export type CopyRoster = z.input<typeof copyRosterSchema>;

export interface RosterEntry {
  id: string;
  employeeId: string;
  date: string;
  kind: RosterKind;
  shiftId: string | null;
  shiftCode: string | null;
  ward: string | null;
  facilityId: string;
  leaveRequestId: string | null;
}

export interface RosterView {
  from: string;
  to: string;
  employees: Pick<Employee, 'id' | 'employeeCode' | 'fullName' | 'designation' | 'department' | 'category'>[];
  shifts: Shift[];
  entries: RosterEntry[];
}

/** Who is on which shift on a date (ward board / mobile staff app). */
export interface OnDutyRow {
  shift: Pick<Shift, 'id' | 'code' | 'name' | 'startTime' | 'endTime'>;
  staff: { employeeId: string; fullName: string; designation: string | null; department: string | null; ward: string | null }[];
}

// ---------- attendance ----------

export const attendanceQuerySchema = z.object({
  date: isoDate,
  department: optionalText(100),
});
export type AttendanceQuery = z.input<typeof attendanceQuerySchema>;

export const markAttendanceSchema = z.object({
  date: isoDate,
  rows: z
    .array(
      z.object({
        employeeId: z.uuid(),
        status: z.enum(ATTENDANCE_STATUSES),
        checkIn: blankToUndef(hhmm.nullable().optional()),
        checkOut: blankToUndef(hhmm.nullable().optional()),
        remarks: nullableText(200),
      }),
    )
    .min(1)
    .max(1000),
});
export type MarkAttendance = z.input<typeof markAttendanceSchema>;

export const monthQuerySchema = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM') });
export type MonthQuery = z.input<typeof monthQuerySchema>;

export interface AttendanceRecord {
  id: string;
  employeeId: string;
  date: string;
  status: AttendanceStatus;
  checkIn: string | null;
  checkOut: string | null;
  lateMinutes: number;
  workedMinutes: number | null;
  overtimeMinutes: number;
  source: 'punch' | 'manual' | 'biometric';
  remarks: string | null;
}

/** One row per active employee for a day: their roster cell and attendance (if marked). */
export interface AttendanceSheetRow {
  employee: Pick<Employee, 'id' | 'employeeCode' | 'fullName' | 'designation' | 'department'>;
  roster: Pick<RosterEntry, 'kind' | 'shiftCode' | 'ward'> | null;
  attendance: AttendanceRecord | null;
}

export interface AttendanceSummary {
  employeeId: string;
  employeeCode: string;
  fullName: string;
  present: number;
  halfDay: number;
  absent: number;
  leave: number;
  off: number;
  holiday: number;
  lateDays: number;
  overtimeMinutes: number;
}

// ---------- leave ----------

export const leaveTypeInputSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9_]{0,9}$/, 'Up to 10 capital letters'),
  name: text(60).min(1),
  annualQuota: z.coerce.number().min(0).max(365).multipleOf(0.5),
  isPaid: z.boolean().default(true),
  isActive: z.boolean().default(true),
});
export type LeaveTypeInput = z.input<typeof leaveTypeInputSchema>;
export const updateLeaveTypeSchema = patchSchema(leaveTypeInputSchema.omit({ code: true }));
export type UpdateLeaveType = z.input<typeof updateLeaveTypeSchema>;

export interface LeaveType {
  id: string;
  code: string;
  name: string;
  annualQuota: number;
  isPaid: boolean;
  isActive: boolean;
}

export const applyLeaveSchema = z
  .object({
    leaveTypeId: z.uuid(),
    fromDate: isoDate,
    toDate: isoDate,
    halfDay: z.boolean().default(false),
    reason: optionalText(500),
  })
  .refine((v) => v.toDate >= v.fromDate, { message: 'To date must be on or after from date', path: ['toDate'] })
  .refine((v) => !v.halfDay || v.fromDate === v.toDate, { message: 'A half day is a single date', path: ['halfDay'] });
export type ApplyLeave = z.input<typeof applyLeaveSchema>;

/** HR applying on someone's behalf. */
export const createLeaveSchema = z.intersection(applyLeaveSchema, z.object({ employeeId: z.uuid(), autoApprove: z.boolean().default(false) }));
export type CreateLeave = z.input<typeof createLeaveSchema>;

export const decideLeaveSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  note: optionalText(500),
});
export type DecideLeave = z.input<typeof decideLeaveSchema>;

export const leaveQuerySchema = z.object({
  status: z.enum([...LEAVE_STATUSES, 'all']).default('all'),
  employeeId: z.uuid().optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export type LeaveQuery = z.input<typeof leaveQuerySchema>;

export interface LeaveRequest {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  leaveTypeId: string;
  leaveTypeCode: string;
  leaveTypeName: string;
  isPaid: boolean;
  fromDate: string;
  toDate: string;
  halfDay: boolean;
  days: number;
  reason: string | null;
  status: LeaveStatus;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
}

export interface LeaveBalance {
  leaveTypeId: string;
  code: string;
  name: string;
  isPaid: boolean;
  quota: number;
  taken: number;
  pending: number;
  /** quota - taken - pending; null for unpaid leave (no limit). */
  available: number | null;
}

export const balanceQuerySchema = z.object({ year: z.coerce.number().int().min(2000).max(2100).optional() });

// ---------- payroll ----------

export const createPayrollRunSchema = monthQuerySchema;
export type CreatePayrollRun = z.input<typeof createPayrollRunSchema>;

export const adjustPayslipSchema = z.object({
  otherEarnings: money.optional(),
  otherDeductions: money.optional(),
  tds: money.optional(),
  remarks: nullableText(300),
});
export type AdjustPayslip = z.input<typeof adjustPayslipSchema>;

export interface PayrollRunSummary {
  id: string;
  /** YYYY-MM */
  month: string;
  status: PayrollStatus;
  employeeCount: number;
  grossTotal: number;
  deductionTotal: number;
  netTotal: number;
  employerCostTotal: number;
  finalizedAt: string | null;
  createdAt: string;
}

export interface Payslip {
  id: string;
  runId: string;
  month: string;
  runStatus: PayrollStatus;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  designation: string | null;
  department: string | null;
  pan: string | null;
  uan: string | null;
  bankAccountNo: string | null;
  bankIfsc: string | null;
  daysInMonth: number;
  payableDays: number;
  lopDays: number;
  basic: number;
  hra: number;
  otherAllowances: number;
  otherEarnings: number;
  gross: number;
  pfEmployee: number;
  esiEmployee: number;
  professionalTax: number;
  tds: number;
  otherDeductions: number;
  totalDeductions: number;
  netPay: number;
  pfEmployer: number;
  esiEmployer: number;
  remarks: string | null;
}

export interface PayrollRun extends PayrollRunSummary {
  payslips: Payslip[];
}

/** Bank-transfer / accounting export of a payroll run. */
export interface PayrollExport {
  filename: string;
  csv: string;
}

// ---------- dashboard and self-service ----------

export interface HrDashboard {
  date: string;
  headcount: number;
  byCategory: Record<EmployeeCategory, number>;
  rostered: number;
  present: number;
  absent: number;
  onLeave: number;
  notMarked: number;
  pendingLeaves: number;
  licencesExpiring: number;
  licencesExpired: number;
}

export interface MyHr {
  employee: Employee | null;
  today: { date: string; roster: Pick<RosterEntry, 'kind' | 'shiftCode' | 'ward'> | null; shift: Shift | null; attendance: AttendanceRecord | null };
}

// ---------- events ----------

export interface LeaveRequestedEvent {
  leaveId: string;
  employeeId: string;
  userId: string | null;
  fromDate: string;
  toDate: string;
  days: number;
}
export interface LeaveDecidedEvent {
  leaveId: string;
  employeeId: string;
  /** Staff user, so notifications can reach them. */
  userId: string | null;
  status: 'approved' | 'rejected' | 'cancelled';
  fromDate: string;
  toDate: string;
}
export interface PayrollFinalizedEvent {
  runId: string;
  month: string;
  employeeCount: number;
  netTotal: number;
}
export interface EmployeeChangedEvent {
  employeeId: string;
  userId: string | null;
  status: EmployeeStatus;
}
