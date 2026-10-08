import { z } from 'zod';
import { defineModule } from '../manifest';
import {
  datesInOrder,
  dateOfBirth as dobDate,
  emailAddress,
  ifsc,
  indianMobile,
  isoDate as validDate,
  pan as panNumber,
  pastOrTodayDate,
  phoneNumber,
  todayIso,
} from '../validation';

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
  .number({ error: 'Enter an amount' })
  .refine(Number.isFinite, 'Enter an amount')
  .min(0, 'Amount cannot be negative')
  .max(99_999_999.99, 'Amount is too large')
  .refine((v) => Math.abs(Math.round(v * 100) - v * 100) < 1e-6, 'At most 2 decimal places');
const text = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) => text(max).optional();
const nullableText = (max: number) => text(max).nullable().optional();
const isoDate = validDate;
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

/** Youngest and oldest age (in whole years) allowed on the joining date. */
export const MIN_JOINING_AGE = 14;
export const MAX_JOINING_AGE = 100;

/** Joining dates from 1950 up to a year ahead (offer letters for staff who join later). */
const joiningDate = isoDate.refine((d) => d >= '1950-01-01', 'Joining date is too far in the past').refine((d) => d <= todayIso(366), 'Joining date cannot be more than a year ahead');

/** Whole years between a date of birth and another date. */
export function ageOn(dob: string, on: string): number {
  const years = Number(on.slice(0, 4)) - Number(dob.slice(0, 4));
  return on.slice(5) < dob.slice(5) ? years - 1 : years;
}

/** Problems between date of birth, joining and exit dates (any may be missing). Shared by the schemas and the API. */
export function employeeDateIssues(d: { dateOfBirth?: string | null; dateOfJoining?: string | null; dateOfExit?: string | null }): { path: string; message: string }[] {
  const out: { path: string; message: string }[] = [];
  if (d.dateOfBirth && d.dateOfJoining) {
    if (d.dateOfJoining <= d.dateOfBirth) out.push({ path: 'dateOfJoining', message: 'Joining date must be after the date of birth' });
    else {
      const age = ageOn(d.dateOfBirth, d.dateOfJoining);
      if (age < MIN_JOINING_AGE) out.push({ path: 'dateOfBirth', message: `Employee must be at least ${MIN_JOINING_AGE} years old on the joining date` });
      else if (age > MAX_JOINING_AGE) out.push({ path: 'dateOfBirth', message: `Employee cannot be older than ${MAX_JOINING_AGE} on the joining date; check the date of birth` });
    }
  }
  if (d.dateOfExit && d.dateOfJoining && d.dateOfExit < d.dateOfJoining) out.push({ path: 'dateOfExit', message: 'Exit date cannot be before the joining date' });
  return out;
}

const checkEmployeeDates = (v: { dateOfBirth?: string | null; dateOfJoining?: string | null; dateOfExit?: string | null }, ctx: z.RefinementCtx) => {
  for (const i of employeeDateIssues(v)) ctx.addIssue({ code: 'custom', path: [i.path], message: i.message });
};

const employeeFields = {
  userId: z.uuid().nullable().optional(),
  fullName: text(150)
    .min(1, 'Enter the full name')
    .min(2, 'Full name needs at least 2 characters')
    .regex(/^[\p{L}\p{M}][\p{L}\p{M} .'()-]*$/u, "Full name can only have letters, spaces and . ' -"),
  gender: blankToUndef(z.enum(['male', 'female', 'other']).nullable().optional()),
  dateOfBirth: blankToUndef(dobDate.nullable().optional()),
  mobile: blankToUndef(indianMobile.nullable().optional()),
  email: blankToUndef(emailAddress.nullable().optional()),
  category: z.enum(EMPLOYEE_CATEGORIES).default('other'),
  designation: nullableText(100),
  department: nullableText(100),
  facilityId: blankToUndef(z.uuid().nullable().optional()),
  employmentType: z.enum(EMPLOYMENT_TYPES).default('permanent'),
  dateOfJoining: joiningDate,
  address: nullableText(500),
  emergencyContactName: blankToUndef(
    text(100)
      .regex(/^[\p{L}\p{M}][\p{L}\p{M} .'()-]*$/u, "Emergency contact name can only have letters, spaces and . ' -")
      .nullable()
      .optional(),
  ),
  emergencyContactPhone: blankToUndef(phoneNumber.nullable().optional()),
  pan: blankToUndef(panNumber.nullable().optional()),
  uan: blankToUndef(z.string().trim().regex(/^\d{12}$/, 'UAN is 12 digits').nullable().optional()),
  esicNo: blankToUndef(z.string().trim().regex(/^\d{10}(\d{7})?$/, 'ESIC number is 10 or 17 digits').nullable().optional()),
  bankAccountNo: blankToUndef(z.string().trim().regex(/^\d{6,18}$/, 'Account number is 6 to 18 digits').nullable().optional()),
  bankIfsc: blankToUndef(ifsc.nullable().optional()),
  bankName: nullableText(100),
  basic: money.optional(),
  hra: money.optional(),
  otherAllowances: money.optional(),
  pfApplicable: z.boolean().optional(),
  esiApplicable: z.boolean().optional(),
  professionalTax: money.optional(),
  tdsMonthly: money.optional(),
};

export const createEmployeeSchema = z
  .object({
    ...employeeFields,
    /** Leave empty to get the next EMP number. */
    employeeCode: blankToUndef(z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9_/-]{0,29}$/, 'Employee code can have letters, digits, - _ / (up to 30)').optional()),
  })
  .superRefine(checkEmployeeDates);
export type CreateEmployee = z.input<typeof createEmployeeSchema>;

export const updateEmployeeSchema = z
  .object({
    ...employeeFields,
    status: z.enum(EMPLOYEE_STATUSES),
    dateOfExit: blankToUndef(
      isoDate
        .refine((d) => d <= todayIso(366), 'Exit date cannot be more than a year ahead')
        .nullable()
        .optional(),
    ),
  })
  .partial()
  .superRefine(checkEmployeeDates);
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
  number: text(60).min(1, 'Enter the licence number'),
  issuedBy: nullableText(150),
  validFrom: blankToUndef(pastOrTodayDate('Valid from date').nullable().optional()),
  validUntil: blankToUndef(isoDate.refine((d) => d >= '1950-01-01' && d <= '2100-12-31', 'Enter a valid expiry date').nullable().optional()),
  notes: nullableText(500),
}).refine((v) => datesInOrder(v.validFrom, v.validUntil), { message: 'Valid until date is before the valid from date', path: ['validUntil'] });
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

const shiftBaseSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9_-]{0,9}$/, 'Up to 10 letters or digits'),
  name: text(60).min(1, 'Enter the shift name'),
  startTime: hhmm,
  endTime: hhmm,
  breakMinutes: z.coerce.number().int('Break must be whole minutes').min(0, 'Break cannot be negative').max(240, 'Break can be at most 240 minutes').default(0),
  graceMinutes: z.coerce.number().int('Grace must be whole minutes').min(0, 'Grace cannot be negative').max(120, 'Grace can be at most 120 minutes').default(10),
  color: blankToUndef(z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Colour must look like #22aa88').nullable().optional()),
  isActive: z.boolean().default(true),
});

/** Shift length in minutes (overnight shifts wrap past midnight). */
export function shiftLengthMinutes(start: string, end: string): number {
  const m = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const d = m(end) - m(start);
  return d > 0 ? d : d + 24 * 60;
}
const checkShiftTimes = (v: { startTime?: string; endTime?: string; breakMinutes?: number }, ctx: z.RefinementCtx) => {
  if (!v.startTime || !v.endTime) return;
  if (v.startTime === v.endTime) {
    ctx.addIssue({ code: 'custom', path: ['endTime'], message: 'End time must be different from start time' });
    return;
  }
  if (v.breakMinutes !== undefined && v.breakMinutes >= shiftLengthMinutes(v.startTime, v.endTime)) {
    ctx.addIssue({ code: 'custom', path: ['breakMinutes'], message: 'Break must be shorter than the shift' });
  }
};
export const shiftInputSchema = shiftBaseSchema.superRefine(checkShiftTimes);
export type ShiftInput = z.input<typeof shiftInputSchema>;
export const updateShiftSchema = shiftBaseSchema.omit({ code: true }).partial().superRefine(checkShiftTimes);
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

export const rosterQuerySchema = z
  .object({
    from: isoDate,
    to: isoDate,
    department: optionalText(100),
    employeeId: z.uuid().optional(),
  })
  .refine((v) => datesInOrder(v.from, v.to), { message: 'To date is before from date', path: ['to'] });
export type RosterQuery = z.input<typeof rosterQuerySchema>;

export const rosterCellSchema = z.object({
  employeeId: z.uuid(),
  date: isoDate.refine((d) => d <= todayIso(366), 'Roster can be planned at most a year ahead'),
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
  toWeekStart: isoDate.refine((d) => d <= todayIso(366), 'Roster can be planned at most a year ahead'),
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
  date: pastOrTodayDate('Attendance date'),
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

export const monthQuerySchema = z.object({
  month: z
    .string({ error: 'Pick a month' })
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM')
    .refine((m) => m >= '2000-01', 'Pick a month from 2000 onwards'),
});
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
  name: text(60).min(1, 'Enter the leave type name'),
  annualQuota: z.coerce
    .number({ error: 'Enter the yearly quota' })
    .min(0, 'Quota cannot be negative')
    .max(365, 'Quota can be at most 365 days')
    .multipleOf(0.5, 'Quota must be in half days (e.g. 12 or 12.5)'),
  isPaid: z.boolean().default(true),
  isActive: z.boolean().default(true),
});
export type LeaveTypeInput = z.input<typeof leaveTypeInputSchema>;
export const updateLeaveTypeSchema = leaveTypeInputSchema.omit({ code: true }).partial();
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
    leaveTypeId: z.uuid({ error: 'Pick a leave type' }),
    fromDate: isoDate.refine((d) => d <= todayIso(366), 'Leave can be applied at most a year ahead'),
    toDate: isoDate,
    halfDay: z.boolean().default(false),
    reason: optionalText(500),
  })
  .refine((v) => datesInOrder(v.fromDate, v.toDate), { message: 'To date must be on or after from date', path: ['toDate'] })
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

export const leaveQuerySchema = z
  .object({
  status: z.enum([...LEAVE_STATUSES, 'all']).default('all'),
  employeeId: z.uuid().optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  })
  .refine((v) => datesInOrder(v.from, v.to), { message: 'To date is before from date', path: ['to'] });
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
