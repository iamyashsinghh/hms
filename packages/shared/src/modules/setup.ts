import { z } from 'zod';
import { defineModule } from '../manifest';
import {
  blankToUndefined,
  datesInOrder,
  emailAddress,
  gstin as gstinField,
  indianMobile,
  isoDate,
  pan as panField,
  phoneNumber,
  pincode,
  requiredText,
  todayIso,
} from '../validation';
import { patchSchema } from '../patch';

/**
 * Hospital Setup: permissions and API contracts (Zod schemas + types).
 * Owned by the "setup" workstream. Users, roles and facilities reuse the core permissions
 * (core.user.*, core.role.*, core.facility.*); everything else is setup.<resource>.<action>.
 */
export const setupModule = defineModule({
  key: 'setup',
  name: 'Hospital Setup',
  permissions: [
    { key: 'setup.profile.read', description: 'View the hospital profile and letterhead' },
    { key: 'setup.profile.manage', description: 'Edit the hospital profile, letterhead and setup wizard' },
    { key: 'setup.department.read', description: 'View departments and specializations' },
    { key: 'setup.department.manage', description: 'Create and edit departments and specializations' },
    { key: 'setup.staff.read', description: 'View staff profiles' },
    { key: 'setup.staff.manage', description: 'Edit staff profiles (designation, department, fees)' },
    { key: 'setup.doctor.read', description: 'View the doctor list, schedules and available slots' },
    { key: 'setup.schedule.manage', description: 'Edit doctor schedules and leaves' },
    { key: 'setup.series.manage', description: 'Edit number series (UHID, bill no...)' },
    { key: 'setup.template.read', description: 'View print templates' },
    { key: 'setup.template.manage', description: 'Edit print templates' },
  ],
  grants: {
    hospital_admin: [
      'setup.profile.read', 'setup.profile.manage', 'setup.department.read', 'setup.department.manage',
      'setup.staff.read', 'setup.staff.manage', 'setup.doctor.read', 'setup.schedule.manage',
      'setup.series.manage', 'setup.template.read', 'setup.template.manage',
    ],
    owner: ['setup.profile.read', 'setup.department.read', 'setup.staff.read', 'setup.doctor.read', 'setup.template.read'],
    doctor: ['setup.profile.read', 'setup.department.read', 'setup.doctor.read', 'setup.template.read'],
    nurse: ['setup.profile.read', 'setup.department.read', 'setup.doctor.read', 'setup.template.read'],
    receptionist: ['setup.profile.read', 'setup.department.read', 'setup.doctor.read', 'setup.template.read'],
    pharmacist: ['setup.profile.read', 'setup.department.read', 'setup.doctor.read', 'setup.template.read'],
    lab_technician: ['setup.profile.read', 'setup.department.read', 'setup.doctor.read', 'setup.template.read'],
    radiologist: ['setup.profile.read', 'setup.department.read', 'setup.doctor.read', 'setup.template.read'],
    billing_clerk: ['setup.profile.read', 'setup.department.read', 'setup.doctor.read', 'setup.template.read'],
    accountant: ['setup.profile.read', 'setup.department.read', 'setup.doctor.read', 'setup.template.read'],
    hr_manager: ['setup.profile.read', 'setup.department.read', 'setup.staff.read', 'setup.staff.manage', 'setup.doctor.read'],
  },
});

/** '' counts as not given. Typed as the inner schema so the request types stay `string | undefined`. */
const blank = <T extends z.ZodType>(schema: T): T => blankToUndefined(schema) as unknown as T;

const mobile = indianMobile;
const code = z
  .string({ error: 'Enter a code' })
  .trim()
  .toUpperCase()
  .min(1, { message: 'Enter a code', abort: true })
  .regex(/^[A-Z0-9][A-Z0-9_-]{0,19}$/, 'Use letters, digits, - or _ (max 20)');
const gstin = gstinField;
const hhmm = z.string({ error: 'Enter a time' }).regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24 hour)');
const twoDecimals = (v: number) => Math.abs(Math.round(v * 100) - v * 100) < 1e-6;
/** A fee in rupees (numbers only; the forms send numbers). */
const money = z
  .number({ error: 'Enter an amount' })
  .min(0, 'Fee cannot be negative')
  .max(10_000_000, 'Fee cannot be more than 1,00,00,000')
  .refine(twoDecimals, 'Fee can have at most 2 decimal places');
/** Optional text where '' means not given. */
const optText = (label: string, max: number) => blank(z.string().trim().max(max, `${label} can be at most ${max} characters`).optional());
/** An http(s) link. */
const webUrl = (label: string) =>
  z
    .string()
    .trim()
    .pipe(z.url({ protocol: /^https?$/, hostname: /\./, error: `${label} must be a full web address starting with https://` }));
/** Image link or an inline data:image (uploaded logo / signature). */
const imageUrl = (label: string) =>
  z
    .string()
    .trim()
    .refine(
      (v) => /^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,/i.test(v) || /^https?:\/\/[^\s/]+\.[^\s]+$/i.test(v) || v.startsWith('/'),
      `${label} must be a web address (https://...) or an uploaded image`,
    );
const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
/** YYYY-MM-DD plus `days`. */
const shiftDays = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

export const addressSchema = z.object({
  line1: optText('Address line 1', 200),
  line2: optText('Address line 2', 200),
  city: optText('City', 100),
  district: optText('District', 100),
  state: optText('State', 100),
  pincode: blank(pincode.optional()),
});
export type Address = z.infer<typeof addressSchema>;

export const listQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  includeInactive: z.enum(['true', 'false']).optional().transform((v) => v === 'true'),
});
export type ListQuery = { q?: string; includeInactive?: boolean };

// ---------- Hospital profile & letterhead ----------

export const upsertProfileSchema = z.object({
  legalName: requiredText('the legal name', 200, 2),
  displayName: requiredText('the display name', 200, 2),
  gstin: blank(gstin.optional()),
  pan: blank(panField.optional()),
  registrationNo: optText('Registration number', 100),
  /** ROHINI / NABH / clinical establishment ids etc. */
  accreditation: optText('Accreditation', 200),
  phone: blank(phoneNumber.optional()),
  email: blank(emailAddress.optional()),
  website: blank(webUrl('Website').optional()),
  address: addressSchema.optional(),
  logoUrl: blank(imageUrl('Logo').optional()),
  letterhead: z
    .object({
      tagline: optText('Tagline', 200),
      headerNote: optText('Header note', 500),
      footerNote: optText('Footer note', 500),
      accentColor: blank(z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, 'Accent colour must be a hex colour like #0F766E').optional()),
    })
    .optional(),
  timezone: z.string().trim().min(1, 'Pick a timezone').max(64, 'Unknown timezone').default('Asia/Kolkata'),
});
export type UpsertProfile = z.input<typeof upsertProfileSchema>;

export interface HospitalProfile {
  legalName: string;
  displayName: string;
  gstin: string | null;
  pan: string | null;
  registrationNo: string | null;
  accreditation: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  address: Address | null;
  logoUrl: string | null;
  letterhead: { tagline?: string; headerNote?: string; footerNote?: string; accentColor?: string } | null;
  timezone: string;
  setupCompletedAt: string | null;
  updatedAt: string | null;
}

// ---------- Setup wizard ----------

export const WIZARD_STEPS = ['profile', 'facilities', 'departments', 'staff', 'doctors', 'schedules'] as const;
export type WizardStepKey = (typeof WIZARD_STEPS)[number];
export interface WizardStatus {
  steps: { key: WizardStepKey; label: string; done: boolean; count: number; href: string }[];
  completed: boolean;
  completedAt: string | null;
}

// ---------- Facilities (branches) ----------

export const FACILITY_TYPES = ['hospital', 'clinic', 'diagnostic_centre', 'pharmacy'] as const;
export const createFacilitySchema = z.object({
  code,
  name: requiredText('the facility name', 200, 2),
  type: z.enum(FACILITY_TYPES, { error: 'Pick a facility type' }).default('hospital'),
  phone: blank(phoneNumber.optional()),
  gstin: blank(gstin.optional()),
  address: addressSchema.optional(),
});
export type CreateFacility = z.input<typeof createFacilitySchema>;
export const updateFacilitySchema = patchSchema(createFacilitySchema).extend({ isActive: z.boolean().optional() });
export type UpdateFacility = z.input<typeof updateFacilitySchema>;
export interface FacilityDetail {
  id: string;
  code: string;
  name: string;
  type: (typeof FACILITY_TYPES)[number];
  phone: string | null;
  gstin: string | null;
  address: Address | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// ---------- Departments & specializations ----------

export const DEPARTMENT_TYPES = ['clinical', 'diagnostic', 'support', 'administrative'] as const;
export const createDepartmentSchema = z.object({
  code,
  name: requiredText('the department name', 120, 2),
  type: z.enum(DEPARTMENT_TYPES, { error: 'Pick a department type' }).default('clinical'),
  /** Empty = department exists in every facility. */
  facilityId: blank(z.uuid({ error: 'Pick a valid facility' }).optional()),
  description: optText('Description', 500),
});
export type CreateDepartment = z.input<typeof createDepartmentSchema>;
export const updateDepartmentSchema = patchSchema(createDepartmentSchema).extend({ facilityId: z.uuid().nullable().optional(), isActive: z.boolean().optional() });
export type UpdateDepartment = z.input<typeof updateDepartmentSchema>;
export interface Department {
  id: string;
  code: string;
  name: string;
  type: (typeof DEPARTMENT_TYPES)[number];
  facilityId: string | null;
  description: string | null;
  isActive: boolean;
  staffCount: number;
  createdAt: string;
  updatedAt: string;
}

export const createSpecializationSchema = z.object({
  code,
  name: requiredText('the specialization name', 120, 2),
});
export type CreateSpecialization = z.input<typeof createSpecializationSchema>;
export const updateSpecializationSchema = patchSchema(createSpecializationSchema).extend({ isActive: z.boolean().optional() });
export type UpdateSpecialization = z.input<typeof updateSpecializationSchema>;
export interface Specialization {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
}

// ---------- Staff profiles ----------

export const STAFF_TYPES = ['doctor', 'nurse', 'technician', 'pharmacist', 'admin', 'support', 'other'] as const;
/** Joining date: a real date, not before 1950 and at most a year ahead (for staff joining soon). */
const dateOfJoining = isoDate
  .refine((d) => d >= '1950-01-01', 'Date of joining looks too old')
  .refine((d) => d <= todayIso(366), 'Date of joining can be at most a year from today');

export const upsertStaffProfileSchema = z
  .object({
    staffType: z.enum(STAFF_TYPES, { error: 'Pick a staff type' }),
    employeeCode: blank(
      z
        .string()
        .trim()
        .max(30, 'Employee code can be at most 30 characters')
        .regex(/^[A-Za-z0-9][A-Za-z0-9/_-]*$/, 'Employee code can only have letters, digits, / - _')
        .optional(),
    ),
    designation: optText('Designation', 100),
    departmentId: z.uuid({ error: 'Pick a valid department' }).nullable().optional(),
    specializationId: z.uuid({ error: 'Pick a valid specialization' }).nullable().optional(),
    qualification: optText('Qualification', 200),
    /** Medical/nursing council registration number. */
    registrationNo: optText('Registration number', 60),
    registrationCouncil: optText('Registration council', 100),
    gender: blank(z.enum(['male', 'female', 'other'], { error: 'Pick a gender' }).optional()),
    dateOfJoining: blank(dateOfJoining.optional()),
    consultationFee: money.optional(),
    followUpFee: money.optional(),
    /** A revisit within this many days is charged the follow-up fee. */
    followUpDays: z
      .number({ error: 'Enter the number of days' })
      .int('Follow-up days must be a whole number')
      .min(0, 'Follow-up days cannot be negative')
      .max(365, 'Follow-up days can be at most 365')
      .optional(),
    signatureUrl: blank(imageUrl('Signature').optional()),
  })
  .refine((p) => p.followUpFee === undefined || p.consultationFee === undefined || p.followUpFee <= p.consultationFee, {
    message: 'Follow-up fee cannot be more than the consultation fee',
    path: ['followUpFee'],
  });
export type UpsertStaffProfile = z.input<typeof upsertStaffProfileSchema>;

export interface StaffMember {
  userId: string;
  name: string;
  email: string | null;
  mobile: string | null;
  status: UserStatus;
  roles: string[];
  profile: {
    staffType: (typeof STAFF_TYPES)[number];
    employeeCode: string | null;
    designation: string | null;
    departmentId: string | null;
    departmentName: string | null;
    specializationId: string | null;
    specializationName: string | null;
    qualification: string | null;
    registrationNo: string | null;
    registrationCouncil: string | null;
    gender: string | null;
    dateOfJoining: string | null;
    consultationFee: number | null;
    followUpFee: number | null;
    followUpDays: number | null;
    signatureUrl: string | null;
  } | null;
}

export const staffQuerySchema = listQuerySchema.extend({
  departmentId: z.uuid().optional(),
  staffType: z.enum(STAFF_TYPES).optional(),
});
export type StaffQuery = ListQuery & { departmentId?: string; staffType?: (typeof STAFF_TYPES)[number] };

// ---------- Doctors (contract used by frontoffice, emr, portal, reports, mobile) ----------

export const doctorQuerySchema = z.object({
  facilityId: z.uuid().optional(),
  departmentId: z.uuid().optional(),
});
export type DoctorQuery = z.infer<typeof doctorQuerySchema>;

export interface Doctor {
  userId: string;
  name: string;
  departmentId: string | null;
  departmentName: string | null;
  specialization: string | null;
  qualification: string | null;
  registrationNo: string | null;
  registrationCouncil: string | null;
  /** Image URL for printed prescriptions. */
  signatureUrl: string | null;
  consultationFee?: number;
  followUpFee?: number;
  followUpDays?: number;
}

/**
 * Billing service codes Setup keeps in sync with a doctor's fees (category 'consultation'), so payer price
 * lists can price them: CONS-<code> for the consultation fee and FUP-<code> for the follow-up fee.
 * <code> is the last 8 hex digits of the doctor's user id (stable when the name or employee code changes).
 */
export function doctorFeeServiceCodes(userId: string): { consultation: string; followUp: string } {
  const code = userId.replace(/-/g, '').slice(-8).toUpperCase();
  return { consultation: `CONS-${code}`, followUp: `FUP-${code}` };
}

export const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

export const scheduleBlockSchema = z
  .object({
    facilityId: z.uuid(),
    /** 0 = Sunday ... 6 = Saturday. */
    weekday: z.number().int().min(0).max(6),
    startTime: hhmm,
    endTime: hhmm,
    slotMinutes: z
      .number({ error: 'Enter the slot length in minutes' })
      .int('Slot length must be whole minutes')
      .min(5, 'Slot length must be at least 5 minutes')
      .max(240, 'Slot length can be at most 240 minutes')
      .default(15),
    /** Cap on bookings for this block; empty = one per slot. */
    maxPatients: z
      .number({ error: 'Enter the most patients for this timing' })
      .int('Max patients must be a whole number')
      .min(1, 'Max patients must be at least 1')
      .max(500, 'Max patients can be at most 500')
      .optional(),
  })
  .refine((b) => b.startTime < b.endTime, { message: 'End time must be after start time', path: ['endTime'] })
  .refine((b) => b.startTime >= b.endTime || minutesOf(b.endTime) - minutesOf(b.startTime) >= b.slotMinutes, {
    message: 'The timing is shorter than one slot',
    path: ['endTime'],
  });
export const replaceScheduleSchema = z.object({ blocks: z.array(scheduleBlockSchema).max(100) });
export type ScheduleBlockInput = z.input<typeof scheduleBlockSchema>;
export type ReplaceSchedule = z.input<typeof replaceScheduleSchema>;
export interface ScheduleBlock {
  id: string;
  facilityId: string;
  weekday: number;
  startTime: string;
  endTime: string;
  slotMinutes: number;
  maxPatients: number | null;
}

export const createLeaveSchema = z
  .object({
    fromDate: isoDate,
    toDate: isoDate,
    reason: optText('Reason', 200),
  })
  .refine((l) => datesInOrder(l.fromDate, l.toDate), { message: 'To date must be on or after from date', path: ['toDate'] })
  // Leave blocks future bookings; a leave that is already over changes nothing.
  .refine((l) => l.toDate >= todayIso(), { message: 'Leave cannot end in the past', path: ['toDate'] })
  .refine((l) => l.toDate <= shiftDays(l.fromDate, 365), { message: 'A leave can be at most one year long', path: ['toDate'] });
export type CreateLeave = z.input<typeof createLeaveSchema>;
export interface DoctorLeave {
  id: string;
  fromDate: string;
  toDate: string;
  reason: string | null;
  createdAt: string;
}

export const slotsQuerySchema = z.object({ date: z.iso.date(), facilityId: z.uuid().optional() });
export type SlotsQuery = z.infer<typeof slotsQuerySchema>;
/** One bookable slot. Times are ISO 8601 UTC; the hospital timezone was applied. */
export interface DoctorSlot {
  start: string;
  end: string;
  facilityId: string;
  scheduleId: string;
  maxPatients: number | null;
}

// ---------- Users & roles admin ----------

export const USER_STATUSES = ['invited', 'active', 'disabled'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const roleAssignmentSchema = z.object({
  roleId: z.uuid({ error: 'Pick a role' }),
  /** Empty = the role applies in every facility. */
  facilityId: z.uuid({ error: 'Pick a valid facility' }).nullable().optional(),
});
export type RoleAssignmentInput = z.input<typeof roleAssignmentSchema>;

const passwordSchema = z
  .string()
  .min(8, 'Password needs at least 8 characters')
  .max(200, 'Password is too long')
  .regex(/[A-Za-z]/, 'Password must include a letter')
  .regex(/\d/, 'Password must include a digit')
  .refine((v) => v.trim() === v, 'Password cannot start or end with a space');

/** Staff names: start with a letter; letters, digits, spaces and . ' ( ) - (e.g. "Dr. A. Rao", "Nurse 2"). */
const staffName = requiredText('the name', 120, 2).regex(/^[\p{L}\p{M}][\p{L}\p{M}\d .'()-]*$/u, "Name can only have letters, digits, spaces and . ' ( ) -");

export const createUserSchema = z
  .object({
    name: staffName,
    email: blank(emailAddress.optional()),
    mobile: blank(mobile.optional()),
    /** Leave empty to have a temporary password generated and returned once. */
    password: blank(passwordSchema.optional()),
    roles: z.array(roleAssignmentSchema).min(1, 'Give the user at least one role').max(20, 'At most 20 role assignments'),
    staffProfile: upsertStaffProfileSchema.optional(),
  })
  .refine((u) => u.email || u.mobile, { message: 'Enter an email or a mobile number', path: ['email'] });
export type CreateUser = z.input<typeof createUserSchema>;

/** For edits: '' or null clears the field. */
const clearable = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), schema.nullable().optional()) as unknown as z.ZodOptional<z.ZodNullable<T>>;

export const updateUserSchema = z.object({
  name: staffName.optional(),
  email: clearable(emailAddress),
  mobile: clearable(mobile),
});
export type UpdateUser = z.input<typeof updateUserSchema>;

export const setUserRolesSchema = z.object({
  roles: z.array(roleAssignmentSchema).min(1, 'Give the user at least one role').max(20, 'At most 20 role assignments'),
});
export type SetUserRoles = z.input<typeof setUserRolesSchema>;

export const resetPasswordSchema = z.object({ password: blank(passwordSchema.optional()) });
export type ResetPassword = z.input<typeof resetPasswordSchema>;

export const userQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(USER_STATUSES).optional(),
  roleId: z.uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export type UserQuery = { q?: string; status?: UserStatus; roleId?: string; page?: number; pageSize?: number };

export interface UserRoleAssignment {
  roleId: string;
  roleKey: string;
  roleName: string;
  facilityId: string | null;
  facilityName: string | null;
}

export interface StaffUser {
  id: string;
  name: string;
  email: string | null;
  mobile: string | null;
  status: UserStatus;
  roles: UserRoleAssignment[];
  lastLoginAt: string | null;
  lockedUntil: string | null;
  createdAt: string;
}

/** Returned once when a password was generated; show it to the admin to hand over. */
/** What happened to the login-details SMS/email, per channel (status sent/queued/skipped/failed). */
export interface CredentialDelivery {
  channel: string;
  status: string;
  reason: string | null;
}

export interface UserWithTemporaryPassword extends StaffUser {
  temporaryPassword?: string;
  /** Present when a temporary password was generated and sent through Notifications. */
  delivery?: CredentialDelivery[];
}

export interface ResetPasswordResult {
  temporaryPassword?: string;
  delivery?: CredentialDelivery[];
}

const roleName = requiredText('the role name', 80, 2).regex(/^[\p{L}\p{M}\d][\p{L}\p{M}\d .'()&/-]*$/u, "Role name can only have letters, digits, spaces and . ' ( ) & / -");
const permissionList = z
  .array(z.string().regex(/^[a-z]+\.[a-z_]+\.[a-z_]+$/, 'Unknown permission'), { error: 'Pick the permissions for this role' })
  .max(500, 'Too many permissions')
  // A permission picked twice (e.g. merging two role templates) is kept once.
  .transform((p) => [...new Set(p)]);

export const createRoleSchema = z.object({
  name: roleName,
  /** Generated from the name when empty. */
  key: blank(z.string().trim().regex(/^[a-z][a-z0-9_]{1,49}$/, 'Role key: lowercase letters, digits and _ (2 to 50, starting with a letter)').optional()),
  permissions: permissionList,
});
export type CreateRole = z.input<typeof createRoleSchema>;
export const updateRoleSchema = z.object({
  name: roleName.optional(),
  permissions: permissionList.optional(),
});
export type UpdateRole = z.input<typeof updateRoleSchema>;

export interface Role {
  id: string;
  key: string;
  name: string;
  isSystem: boolean;
  permissions: string[];
  userCount: number;
}

export interface PermissionCatalogEntry {
  key: string;
  module: string;
  description: string;
}

// ---------- Number series ----------

export const updateNumberSeriesSchema = z.object({
  prefix: z.string({ error: 'Enter a prefix (it can be empty)' }).trim().max(20, 'Prefix can be at most 20 characters').regex(/^[A-Za-z0-9/_-]*$/, 'Letters, digits, / - _ only'),
  width: z.number({ error: 'Enter the number of digits' }).int('Digits must be a whole number').min(1, 'Use at least 1 digit').max(12, 'Use at most 12 digits'),
  /** Only moves forward, so numbers never repeat. */
  nextValue: z
    .number({ error: 'Enter the next number' })
    .int('Next number must be a whole number')
    .min(1, 'Next number must be at least 1')
    .max(999_999_999_999, 'Next number is too large')
    .optional(),
});
export type UpdateNumberSeries = z.input<typeof updateNumberSeriesSchema>;

/** Series every hospital sees; modules can add more keys by calling nextNumber with their own key. */
export const DEFAULT_NUMBER_SERIES: Record<string, { label: string; prefix: string; width: number }> = {
  uhid: { label: 'Patient UHID', prefix: 'UH', width: 6 },
  'billing.invoice': { label: 'Bill / invoice no', prefix: 'INV', width: 6 },
  'billing.receipt': { label: 'Receipt no', prefix: 'RCT', width: 6 },
  'frontoffice.token': { label: 'OPD token', prefix: '', width: 3 },
  'emr.prescription': { label: 'Prescription no', prefix: 'RX', width: 6 },
  'pharmacy.sale': { label: 'Pharmacy bill no', prefix: 'PH', width: 6 },
};

export interface NumberSeries {
  key: string;
  label: string;
  prefix: string;
  width: number;
  nextValue: number;
  preview: string;
}

// ---------- Print templates ----------

export const PRINT_TEMPLATE_KEYS = ['letterhead', 'invoice', 'receipt', 'prescription', 'lab_report', 'discharge_summary'] as const;
export type PrintTemplateKey = (typeof PRINT_TEMPLATE_KEYS)[number];
export const PAPER_SIZES = ['A4', 'A5', 'thermal_80mm'] as const;

export const upsertPrintTemplateSchema = z.object({
  facilityId: z.uuid().nullable().optional(),
  paperSize: z.enum(PAPER_SIZES).default('A4'),
  showLogo: z.boolean().default(true),
  showLetterhead: z.boolean().default(true),
  headerText: z.string().max(2000, 'Header text can be at most 2000 characters').optional(),
  footerText: z.string().max(2000, 'Footer text can be at most 2000 characters').optional(),
  marginTopMm: z.number({ error: 'Enter the top margin in mm' }).int('Margin must be whole mm').min(0, 'Margin cannot be negative').max(100, 'Margin can be at most 100 mm').default(10),
  marginBottomMm: z.number({ error: 'Enter the bottom margin in mm' }).int('Margin must be whole mm').min(0, 'Margin cannot be negative').max(100, 'Margin can be at most 100 mm').default(10),
});
export type UpsertPrintTemplate = z.input<typeof upsertPrintTemplateSchema>;

export interface PrintTemplate {
  key: PrintTemplateKey;
  facilityId: string | null;
  paperSize: (typeof PAPER_SIZES)[number];
  showLogo: boolean;
  showLetterhead: boolean;
  headerText: string | null;
  footerText: string | null;
  marginTopMm: number;
  marginBottomMm: number;
  /** False when nothing is saved yet and these are the defaults. */
  saved: boolean;
}

// ---------- Events published by setup ----------

export interface SetupUserCreatedEvent { userId: string; roleKeys: string[] }
export interface SetupUserDeactivatedEvent { userId: string }
export interface SetupDoctorScheduleChangedEvent { userId: string }
export interface SetupDoctorLeaveAddedEvent { userId: string; leaveId: string; fromDate: string; toDate: string }
