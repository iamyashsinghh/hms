import { z } from 'zod';
import { defineModule } from '../manifest';

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

const mobile = z.string().regex(/^[6-9]\d{9}$/, 'Enter a 10-digit Indian mobile number');
const code = z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9_-]{0,19}$/, 'Use letters, digits, - or _ (max 20)');
const gstin = z.string().trim().toUpperCase().regex(/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, 'Enter a valid 15-character GSTIN');
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24 hour)');
const money = z.number().min(0).max(10_000_000).multipleOf(0.01);

export const addressSchema = z.object({
  line1: z.string().max(200).optional(),
  line2: z.string().max(200).optional(),
  city: z.string().max(100).optional(),
  district: z.string().max(100).optional(),
  state: z.string().max(100).optional(),
  pincode: z.string().regex(/^\d{6}$/, 'Enter a 6-digit PIN code').optional(),
});
export type Address = z.infer<typeof addressSchema>;

export const listQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  includeInactive: z.enum(['true', 'false']).optional().transform((v) => v === 'true'),
});
export type ListQuery = { q?: string; includeInactive?: boolean };

// ---------- Hospital profile & letterhead ----------

export const upsertProfileSchema = z.object({
  legalName: z.string().trim().min(2).max(200),
  displayName: z.string().trim().min(2).max(200),
  gstin: gstin.optional(),
  pan: z.string().trim().toUpperCase().regex(/^[A-Z]{5}\d{4}[A-Z]$/, 'Enter a valid PAN').optional(),
  registrationNo: z.string().trim().max(100).optional(),
  /** ROHINI / NABH / clinical establishment ids etc. */
  accreditation: z.string().trim().max(200).optional(),
  phone: z.string().trim().max(30).optional(),
  email: z.email().optional(),
  website: z.url().optional(),
  address: addressSchema.optional(),
  logoUrl: z.url().optional(),
  letterhead: z
    .object({
      tagline: z.string().max(200).optional(),
      headerNote: z.string().max(500).optional(),
      footerNote: z.string().max(500).optional(),
      accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    })
    .optional(),
  timezone: z.string().max(64).default('Asia/Kolkata'),
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
  name: z.string().trim().min(2).max(200),
  type: z.enum(FACILITY_TYPES).default('hospital'),
  phone: z.string().trim().max(30).optional(),
  gstin: gstin.optional(),
  address: addressSchema.optional(),
});
export type CreateFacility = z.input<typeof createFacilitySchema>;
export const updateFacilitySchema = createFacilitySchema.partial().extend({ isActive: z.boolean().optional() });
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
  name: z.string().trim().min(2).max(120),
  type: z.enum(DEPARTMENT_TYPES).default('clinical'),
  /** Empty = department exists in every facility. */
  facilityId: z.uuid().optional(),
  description: z.string().max(500).optional(),
});
export type CreateDepartment = z.input<typeof createDepartmentSchema>;
export const updateDepartmentSchema = createDepartmentSchema
  .partial()
  .extend({ facilityId: z.uuid().nullable().optional(), isActive: z.boolean().optional() });
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
  name: z.string().trim().min(2).max(120),
});
export type CreateSpecialization = z.input<typeof createSpecializationSchema>;
export const updateSpecializationSchema = createSpecializationSchema.partial().extend({ isActive: z.boolean().optional() });
export type UpdateSpecialization = z.input<typeof updateSpecializationSchema>;
export interface Specialization {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
}

// ---------- Staff profiles ----------

export const STAFF_TYPES = ['doctor', 'nurse', 'technician', 'pharmacist', 'admin', 'support', 'other'] as const;
export const upsertStaffProfileSchema = z.object({
  staffType: z.enum(STAFF_TYPES),
  employeeCode: z.string().trim().max(30).optional(),
  designation: z.string().trim().max(100).optional(),
  departmentId: z.uuid().nullable().optional(),
  specializationId: z.uuid().nullable().optional(),
  qualification: z.string().trim().max(200).optional(),
  /** Medical/nursing council registration number. */
  registrationNo: z.string().trim().max(60).optional(),
  registrationCouncil: z.string().trim().max(100).optional(),
  gender: z.enum(['male', 'female', 'other']).optional(),
  dateOfJoining: z.iso.date().optional(),
  consultationFee: money.optional(),
  followUpFee: money.optional(),
  /** A revisit within this many days is charged the follow-up fee. */
  followUpDays: z.number().int().min(0).max(365).optional(),
  signatureUrl: z.url().optional(),
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
  consultationFee?: number;
  followUpFee?: number;
  followUpDays?: number;
}

export const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

export const scheduleBlockSchema = z
  .object({
    facilityId: z.uuid(),
    /** 0 = Sunday ... 6 = Saturday. */
    weekday: z.number().int().min(0).max(6),
    startTime: hhmm,
    endTime: hhmm,
    slotMinutes: z.number().int().min(5).max(240).default(15),
    /** Cap on bookings for this block; empty = one per slot. */
    maxPatients: z.number().int().min(1).max(500).optional(),
  })
  .refine((b) => b.startTime < b.endTime, { message: 'End time must be after start time', path: ['endTime'] });
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
    fromDate: z.iso.date(),
    toDate: z.iso.date(),
    reason: z.string().trim().max(200).optional(),
  })
  .refine((l) => l.fromDate <= l.toDate, { message: 'To date must be on or after from date', path: ['toDate'] });
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
  roleId: z.uuid(),
  /** Empty = the role applies in every facility. */
  facilityId: z.uuid().nullable().optional(),
});
export type RoleAssignmentInput = z.input<typeof roleAssignmentSchema>;

const passwordSchema = z
  .string()
  .min(8, 'At least 8 characters')
  .max(200)
  .regex(/[A-Za-z]/, 'Include a letter')
  .regex(/\d/, 'Include a digit');

export const createUserSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    email: z.email().trim().toLowerCase().optional(),
    mobile: mobile.optional(),
    /** Leave empty to have a temporary password generated and returned once. */
    password: passwordSchema.optional(),
    roles: z.array(roleAssignmentSchema).min(1, 'Give the user at least one role').max(20),
    staffProfile: upsertStaffProfileSchema.optional(),
  })
  .refine((u) => u.email || u.mobile, { message: 'Enter an email or a mobile number', path: ['email'] });
export type CreateUser = z.input<typeof createUserSchema>;

export const updateUserSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  email: z.email().trim().toLowerCase().nullable().optional(),
  mobile: mobile.nullable().optional(),
});
export type UpdateUser = z.input<typeof updateUserSchema>;

export const setUserRolesSchema = z.object({ roles: z.array(roleAssignmentSchema).min(1).max(20) });
export type SetUserRoles = z.input<typeof setUserRolesSchema>;

export const resetPasswordSchema = z.object({ password: passwordSchema.optional() });
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
export interface UserWithTemporaryPassword extends StaffUser {
  temporaryPassword?: string;
}

export const createRoleSchema = z.object({
  name: z.string().trim().min(2).max(80),
  /** Generated from the name when empty. */
  key: z.string().trim().regex(/^[a-z][a-z0-9_]{1,49}$/, 'Lowercase letters, digits and _').optional(),
  permissions: z.array(z.string().regex(/^[a-z]+\.[a-z_]+\.[a-z_]+$/)).max(500),
});
export type CreateRole = z.input<typeof createRoleSchema>;
export const updateRoleSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  permissions: z.array(z.string().regex(/^[a-z]+\.[a-z_]+\.[a-z_]+$/)).max(500).optional(),
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
  prefix: z.string().trim().max(20).regex(/^[A-Za-z0-9/_-]*$/, 'Letters, digits, / - _ only'),
  width: z.number().int().min(1).max(12),
  /** Only moves forward, so numbers never repeat. */
  nextValue: z.number().int().min(1).optional(),
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
  headerText: z.string().max(2000).optional(),
  footerText: z.string().max(2000).optional(),
  marginTopMm: z.number().int().min(0).max(100).default(10),
  marginBottomMm: z.number().int().min(0).max(100).default(10),
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
