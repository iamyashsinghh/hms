import { z } from 'zod';
import { defineModule } from '../manifest';

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
  tenantCode: z.string().trim().toLowerCase().min(2).max(63),
  /** Email or 10-digit mobile number. */
  identifier: z.string().trim().min(3).max(254),
  password: z.string().min(8).max(200),
  /** Web gets the refresh token as an httpOnly cookie; mobile gets it in the body. */
  client: z.enum(['web', 'mobile']).default('web'),
  deviceName: z.string().max(100).optional(),
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

/** Latest calendar date anywhere on Earth (UTC+14), so a birth "today" in any time zone is accepted. */
const latestToday = () => new Date(Date.now() + 14 * 3_600_000).toISOString().slice(0, 10);

export const createPatientSchema = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().max(100).optional(),
  gender: z.enum(GENDERS),
  dateOfBirth: z.iso
    .date()
    .refine((d) => d <= latestToday(), 'Date of birth cannot be in the future')
    .refine((d) => d >= '1870-01-01', 'Enter a real date of birth')
    .optional(),
  /** Used when date of birth is unknown. */
  ageYears: z.number().int().min(0).max(150).optional(),
  mobile: z.string().regex(/^[6-9]\d{9}$/, 'Enter a 10-digit Indian mobile number').optional(),
  email: z.email().optional(),
  bloodGroup: z.enum(BLOOD_GROUPS).optional(),
  abhaNumber: z.string().regex(/^\d{14}$/).optional(),
  address: z
    .object({
      line1: z.string().max(200).optional(),
      city: z.string().max(100).optional(),
      state: z.string().max(100).optional(),
      pincode: z.string().regex(/^\d{6}$/).optional(),
    })
    .optional(),
  allergies: z.array(z.string().max(100)).max(50).optional(),
});
export type CreatePatient = z.infer<typeof createPatientSchema>;

export const updatePatientSchema = createPatientSchema.partial();
export type UpdatePatient = z.infer<typeof updatePatientSchema>;

export const patientSchema = createPatientSchema.extend({
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
