import { z } from 'zod';
import { defineModule } from '../manifest';
import { abhaNumber, blankToUndefined, dateOfBirth, emailAddress, indianMobile, personName, pincode } from '../validation';

/** Owned by the foundation: identity, tenants, facilities and the patient master. */
export const coreModule = defineModule({
  key: 'core',
  name: 'Core',
  permissions: [
    { key: 'core.user.read', description: 'View staff users' },
    { key: 'core.user.manage', description: 'Create, update and deactivate staff users' },
    { key: 'core.role.read', description: 'View roles and permissions' },
    { key: 'core.role.manage', description: 'Create and edit custom roles' },
    { key: 'core.facility.read', description: 'View facilities' },
    { key: 'core.facility.manage', description: 'Create and edit facilities' },
    { key: 'core.patient.read', description: 'View and search patients' },
    { key: 'core.patient.create', description: 'Register patients' },
    { key: 'core.patient.update', description: 'Edit patient demographics' },
    { key: 'core.audit.read', description: 'View the audit log' },
  ],
  grants: {
    hospital_admin: [
      'core.user.read', 'core.user.manage', 'core.role.read', 'core.role.manage',
      'core.facility.read', 'core.facility.manage', 'core.patient.read', 'core.patient.create',
      'core.patient.update', 'core.audit.read',
    ],
    owner: ['core.user.read', 'core.role.read', 'core.facility.read', 'core.patient.read', 'core.audit.read'],
    doctor: ['core.facility.read', 'core.patient.read', 'core.patient.update'],
    nurse: ['core.facility.read', 'core.patient.read'],
    receptionist: ['core.facility.read', 'core.patient.read', 'core.patient.create', 'core.patient.update'],
    pharmacist: ['core.facility.read', 'core.patient.read'],
    lab_technician: ['core.facility.read', 'core.patient.read'],
    radiologist: ['core.facility.read', 'core.patient.read'],
    billing_clerk: ['core.facility.read', 'core.patient.read'],
    accountant: ['core.facility.read', 'core.patient.read'],
  },
});

// ---------- Auth ----------

export const loginRequestSchema = z.object({
  /** Hospital code (also its subdomain), e.g. `demo`. */
  tenantCode: z
    .string({ error: 'Enter your hospital code' })
    .trim()
    .toLowerCase()
    .min(1, { message: 'Enter your hospital code', abort: true })
    .min(2, { message: 'Hospital code has at least 2 characters', abort: true })
    .max(63, 'Hospital code is too long')
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'Hospital code has only letters, digits and -'),
  /** Email or 10-digit mobile number. */
  identifier: z
    .string({ error: 'Enter your email or mobile number' })
    .trim()
    .min(1, { message: 'Enter your email or mobile number', abort: true })
    .min(3, 'Enter a valid email or mobile number')
    .max(254, 'Email or mobile is too long')
    // A mobile typed as +91 98100 00001 or 098100 00001 matches the stored 10 digits.
    .transform((v) => (/^\+?[\d\s-]+$/.test(v) ? v.replace(/[\s-]/g, '').replace(/^(\+91|91(?=\d{10}$)|0(?=\d{10}$))/, '') : v)),
  /** Only checked for presence here; the password rules apply when a password is set. */
  password: z.string({ error: 'Enter your password' }).min(1, 'Enter your password').max(200, 'Password is too long'),
  /** Web gets the refresh token as an httpOnly cookie; mobile gets it in the body. */
  client: z.enum(['web', 'mobile']).default('web'),
  deviceName: z.string().trim().max(100, 'Device name is too long').optional(),
});
export type LoginRequest = z.input<typeof loginRequestSchema>;

export const refreshRequestSchema = z.object({
  /** Mobile sends the refresh token here; web sends it via cookie. */
  refreshToken: z.string().optional(),
  client: z.enum(['web', 'mobile']).default('web'),
});
export type RefreshRequest = z.input<typeof refreshRequestSchema>;

export const facilitySchema = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
});
export type Facility = z.infer<typeof facilitySchema>;

export const meSchema = z.object({
  id: z.uuid(),
  tenantId: z.uuid(),
  tenantCode: z.string(),
  tenantName: z.string(),
  name: z.string(),
  email: z.string().nullable(),
  mobile: z.string().nullable(),
  roles: z.array(z.string()),
  permissions: z.array(z.string()),
  facilities: z.array(facilitySchema),
});
export type Me = z.infer<typeof meSchema>;

export interface AuthTokens {
  accessToken: string;
  /** Seconds until the access token expires. */
  expiresIn: number;
  /** Only returned to mobile clients. */
  refreshToken?: string;
}

export interface LoginResponse extends AuthTokens {
  user: Me;
}

/** Claims inside the access token. */
export interface AccessTokenClaims {
  sub: string;
  tid: string;
  /** Session (refresh-token family) id. */
  sid: string;
  typ: 'staff';
}

// ---------- Patients (master record; OPD/IPD modules hang off this) ----------

export const GENDERS = ['male', 'female', 'other', 'unknown'] as const;
export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const;

/** Optional text field: '' counts as not given. */
const optionalText = (label: string, max: number) => blankToUndefined(z.string().trim().max(max, `${label} can be at most ${max} characters`).optional());

/** Last names may carry a digit (e.g. "Singh 2nd"), but must start with a letter and have no other symbols. */
const lastName = z
  .string()
  .trim()
  .max(100, 'Last name can be at most 100 characters')
  .regex(/^[\p{L}\p{M}][\p{L}\p{M}\d .'-]*$/u, "Last name can only have letters, spaces and . ' -");

const addressFields = z.object({
  line1: optionalText('Address', 200),
  city: optionalText('City', 100),
  state: optionalText('State', 100),
  pincode: blankToUndefined(pincode.optional()),
});

const patientFields = z.object({
  firstName: personName('first name'),
  lastName: blankToUndefined(lastName.optional()),
  gender: z.enum(GENDERS, { error: 'Pick a gender' }),
  dateOfBirth: blankToUndefined(dateOfBirth.optional()),
  /** Used when date of birth is unknown. */
  ageYears: blankToUndefined(
    z.number({ error: 'Enter age in years' }).int('Age must be in whole years').min(0, 'Age cannot be negative').max(150, 'Age cannot be more than 150 years').optional(),
  ),
  mobile: blankToUndefined(indianMobile.optional()),
  email: blankToUndefined(emailAddress.optional()),
  bloodGroup: blankToUndefined(z.enum(BLOOD_GROUPS, { error: 'Pick a blood group from the list' }).optional()),
  abhaNumber: blankToUndefined(abhaNumber.optional()),
  address: addressFields.optional(),
  allergies: z
    .array(z.string().trim().min(1, 'Allergy cannot be empty').max(100, 'Each allergy can be at most 100 characters'))
    .max(50, 'At most 50 allergies')
    .optional(),
});

/**
 * The date of birth wins when both DOB and age are given (age is only for an unknown DOB),
 * so they are not compared; the web forms disable age once a DOB is entered.
 */
export const createPatientSchema = patientFields;
export type CreatePatient = z.infer<typeof createPatientSchema>;

/** For edits, '' or null clears an optional field. */
const clearable = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), schema.nullable().optional());

export const updatePatientSchema = patientFields
  .partial()
  .extend({
    lastName: clearable(lastName),
    dateOfBirth: clearable(dateOfBirth),
    mobile: clearable(indianMobile),
    email: clearable(emailAddress),
    bloodGroup: clearable(z.enum(BLOOD_GROUPS, { error: 'Pick a blood group from the list' })),
    abhaNumber: clearable(abhaNumber),
  });
export type UpdatePatient = z.infer<typeof updatePatientSchema>;

export const patientSchema = patientFields.extend({
  id: z.uuid(),
  uhid: z.string(),
  lastName: z.string().nullable(),
  dateOfBirth: z.string().nullable(),
  mobile: z.string().nullable(),
  email: z.string().nullable(),
  bloodGroup: z.string().nullable(),
  abhaNumber: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Patient = z.infer<typeof patientSchema>;

export const patientSearchQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
/** Query params as a client sends them. */
export type PatientSearchQuery = {
  q?: string;
  page?: number;
  pageSize?: number;
};
