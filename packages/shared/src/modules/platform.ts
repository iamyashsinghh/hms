import { z } from 'zod';
import { defineModule } from '../manifest';
import { END_BEFORE_START, datesInOrder, emailAddress, indianMobile, personName, requiredText } from '../validation';

/**
 * SaaS Platform: hospital signup, plans, subscriptions, entitlements, super-admin console,
 * announcements, in-app help, support tickets and the onboarding checklist.
 * Owned by the "platform" workstream.
 */
export const platformModule = defineModule({
  key: 'platform',
  name: 'SaaS Platform',
  permissions: [
    { key: 'platform.subscription.read', description: 'View the hospital plan, usage and subscription invoices' },
    { key: 'platform.subscription.manage', description: 'Change plan, pay subscription invoices, cancel the subscription' },
    { key: 'platform.ticket.create', description: 'Raise and reply to own support tickets' },
    { key: 'platform.ticket.read', description: "View all of the hospital's support tickets" },
    { key: 'platform.onboarding.manage', description: 'View and tick off the onboarding checklist' },
    { key: 'platform.help.read', description: 'Read help articles and announcements' },
  ],
  grants: {
    hospital_admin: [
      'platform.subscription.read', 'platform.subscription.manage', 'platform.ticket.create', 'platform.ticket.read',
      'platform.onboarding.manage', 'platform.help.read',
    ],
    owner: [
      'platform.subscription.read', 'platform.subscription.manage', 'platform.ticket.create', 'platform.ticket.read',
      'platform.onboarding.manage', 'platform.help.read',
    ],
    accountant: ['platform.subscription.read', 'platform.ticket.create', 'platform.help.read'],
    doctor: ['platform.ticket.create', 'platform.help.read'],
    nurse: ['platform.ticket.create', 'platform.help.read'],
    receptionist: ['platform.ticket.create', 'platform.help.read'],
    pharmacist: ['platform.ticket.create', 'platform.help.read'],
    lab_technician: ['platform.ticket.create', 'platform.help.read'],
    radiologist: ['platform.ticket.create', 'platform.help.read'],
    billing_clerk: ['platform.ticket.create', 'platform.help.read'],
    store_keeper: ['platform.ticket.create', 'platform.help.read'],
    hr_manager: ['platform.ticket.create', 'platform.help.read'],
    quality_manager: ['platform.ticket.create', 'platform.help.read'],
  },
});

// ---------- Plans and entitlements ----------

/** Module keys a plan can switch on. `core`, `platform` and `setup` are always on. */
export const ENTITLEMENT_MODULES = [
  'frontoffice', 'emr', 'billing', 'pharmacy', 'notifications', 'reports', 'portal', 'mobile',
  'lab', 'radiology', 'ipd', 'inventory', 'insurance', 'crm', 'hr', 'quality', 'ops', 'integrations',
] as const;
export type EntitlementModule = (typeof ENTITLEMENT_MODULES)[number];
export const ALWAYS_ENTITLED = ['core', 'platform', 'setup'] as const;

export const LIMIT_KEYS = ['facilities', 'users', 'beds'] as const;
export type LimitKey = (typeof LIMIT_KEYS)[number];
/** null = unlimited. */
export type Limits = Record<LimitKey, number | null>;

export const TENANT_STATUSES = ['trial', 'active', 'grace', 'suspended', 'closed'] as const;
export type TenantStatus = (typeof TENANT_STATUSES)[number];
export const SUBSCRIPTION_STATUSES = ['trial', 'active', 'past_due', 'cancelled', 'expired'] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];
export const BILLING_CYCLES = ['monthly', 'yearly'] as const;
export type BillingCycle = (typeof BILLING_CYCLES)[number];

export interface Plan {
  code: string;
  name: string;
  description: string;
  /** null = custom pricing (contact sales). */
  priceMonthly: string | null;
  priceYearly: string | null;
  currency: string;
  trialDays: number;
  modules: string[];
  limits: Limits;
  isPublic: boolean;
  isActive: boolean;
  sortOrder: number;
}

const limitValue = z.number({ error: 'Enter a number' }).int('Must be a whole number').min(0, 'Cannot be negative').max(100_000, 'Too large').nullable();
const money = z
  .union([z.number(), z.string()])
  .transform((v) => String(v))
  .refine((v) => !v.trim().startsWith('-'), 'Price cannot be negative')
  .refine((v) => /^\d{1,12}(\.\d{1,2})?$/.test(v.trim()), 'Enter an amount like 2499 or 2499.00');

export const planCodeSchema = z.string().trim().toLowerCase().regex(/^[a-z][a-z0-9_-]{1,30}$/, 'Use 2-31 lowercase letters, digits, - or _');

export const upsertPlanSchema = z.object({
  code: planCodeSchema,
  name: requiredText('the plan name', 60, 2),
  description: z.string().trim().max(500, 'Description can be at most 500 characters').default(''),
  priceMonthly: money.nullable().default(null),
  priceYearly: money.nullable().default(null),
  trialDays: z.number({ error: 'Enter trial days' }).int('Trial days must be a whole number').min(0, 'Trial days cannot be negative').max(90, 'Trial can be at most 90 days').default(14),
  modules: z.array(z.enum(ENTITLEMENT_MODULES)).default([]),
  limits: z.object({ facilities: limitValue, users: limitValue, beds: limitValue }).partial().default({}),
  isPublic: z.boolean().default(true),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int('Must be a whole number').min(-1000).max(1000).default(0),
});
export type UpsertPlan = z.input<typeof upsertPlanSchema>;
export const updatePlanSchema = upsertPlanSchema.omit({ code: true }).partial();
export type UpdatePlan = z.input<typeof updatePlanSchema>;

export interface Entitlements {
  tenantId: string;
  planCode: string;
  planName: string;
  tenantStatus: TenantStatus;
  modules: string[];
  limits: Limits;
}

export interface Usage {
  facilities: number;
  users: number;
}

// ---------- Signup ----------

export const RESERVED_TENANT_CODES = [
  'www', 'api', 'app', 'admin', 'platform', 'portal', 'help', 'support', 'status', 'mail', 'static', 'cdn',
  'demo', 'test', 'login', 'signup', 'hms', 'docs', 'billing', 'blog',
] as const;

export const tenantCodeSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]{2,30}$/, 'Use 3-31 lowercase letters, digits or -')
  .refine((v) => !v.endsWith('-') && !v.includes('--'), 'Hospital code cannot end with - or have two - in a row');

const mobileSchema = indianMobile;
const passwordSchema = z
  .string()
  .min(8, 'At least 8 characters')
  .max(200, 'Password is too long')
  .regex(/[a-z]/i, 'Include a letter')
  .regex(/\d/, 'Include a number');

export const signupSchema = z.object({
  hospitalName: requiredText('the hospital name', 120, 3),
  /** Hospital code, also the login code and subdomain. */
  code: tenantCodeSchema,
  facilityType: z.enum(['hospital', 'clinic', 'diagnostic_centre', 'pharmacy']).default('hospital'),
  city: z.string().trim().max(80, 'City can be at most 80 characters').regex(/^[\p{L}\p{M} .'-]*$/u, 'City can only have letters, spaces and . \' -').optional(),
  state: z.string().trim().max(80, 'State can be at most 80 characters').regex(/^[\p{L}\p{M} .'-]*$/u, 'State can only have letters, spaces and . \' -').optional(),
  adminName: personName('your name').refine((v) => v.length >= 2, 'Name needs at least 2 characters'),
  email: emailAddress,
  mobile: mobileSchema,
  password: passwordSchema,
  planCode: planCodeSchema.default('starter'),
  acceptTerms: z.literal(true, { error: 'Please accept the terms' }),
});
export type Signup = z.input<typeof signupSchema>;

export interface SignupResult {
  tenantId: string;
  code: string;
  planCode: string;
  trialEndsAt: string | null;
  /** Where the new admin signs in. */
  loginUrl: string;
}

export interface CodeAvailability {
  code: string;
  available: boolean;
  reason?: 'taken' | 'reserved' | 'invalid';
}

// ---------- Subscription and invoices ----------

export interface Subscription {
  id: string;
  planCode: string;
  status: SubscriptionStatus;
  billingCycle: BillingCycle;
  price: string | null;
  trialEndsAt: string | null;
  currentPeriodStart: string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  createdAt: string;
}

export const INVOICE_STATUSES = ['issued', 'paid', 'void'] as const;
export const PAYMENT_MODES = ['sandbox', 'manual', 'upi', 'bank_transfer', 'card', 'cheque'] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];

export interface SubscriptionInvoice {
  id: string;
  tenantId: string;
  number: string;
  planCode: string;
  billingCycle: BillingCycle;
  periodStart: string;
  periodEnd: string;
  amount: string;
  taxRate: string;
  taxAmount: string;
  total: string;
  status: (typeof INVOICE_STATUSES)[number];
  dueAt: string;
  paidAt: string | null;
  paymentMode: PaymentMode | null;
  paymentRef: string | null;
  createdAt: string;
}

export interface SubscriptionOverview {
  tenant: { id: string; code: string; name: string; status: TenantStatus };
  plan: Plan;
  subscription: Subscription | null;
  entitlements: Entitlements;
  usage: Usage;
  invoices: SubscriptionInvoice[];
  /** Days left in the trial, when on trial. */
  trialDaysLeft: number | null;
}

export const changePlanSchema = z.object({
  planCode: planCodeSchema,
  billingCycle: z.enum(BILLING_CYCLES).default('monthly'),
});
export type ChangePlan = z.input<typeof changePlanSchema>;

export const payInvoiceSchema = z.object({
  /** Only the sandbox gateway is wired; real gateways come later. */
  mode: z.literal('sandbox').default('sandbox'),
});
export type PayInvoice = z.input<typeof payInvoiceSchema>;

export const cancelSubscriptionSchema = z.object({
  /** false = undo a pending cancellation. */
  cancel: z.boolean().default(true),
  reason: z.string().trim().max(500, 'Reason can be at most 500 characters').optional(),
});
export type CancelSubscription = z.input<typeof cancelSubscriptionSchema>;

// ---------- Onboarding ----------

export const ONBOARDING_STEPS = [
  { key: 'hospital_profile', title: 'Complete the hospital profile', description: 'Address, GSTIN, letterhead and logo.', href: '/setup', auto: false },
  { key: 'add_staff', title: 'Add your staff', description: 'Invite doctors, reception and billing users.', href: '/setup', auto: true },
  { key: 'doctor_schedules', title: 'Set doctor schedules', description: 'OPD timings and consultation fees.', href: '/setup', auto: false },
  { key: 'services_prices', title: 'Set up services and prices', description: 'Consultation, procedures and tax rules.', href: '/billing', auto: false },
  { key: 'first_patient', title: 'Register your first patient', description: 'Try a registration end to end.', href: '/patients/new', auto: true },
  { key: 'choose_plan', title: 'Choose a plan', description: 'Pick a plan and pay to continue after the trial.', href: '/platform', auto: true },
] as const;
export type OnboardingStepKey = (typeof ONBOARDING_STEPS)[number]['key'];
export const onboardingStepKeySchema = z.enum(ONBOARDING_STEPS.map((s) => s.key) as [OnboardingStepKey, ...OnboardingStepKey[]]);

export interface OnboardingStep {
  key: OnboardingStepKey;
  title: string;
  description: string;
  href: string;
  done: boolean;
  completedAt: string | null;
  /** Ticked automatically from the hospital's data. */
  auto: boolean;
}

export interface OnboardingChecklist {
  steps: OnboardingStep[];
  done: number;
  total: number;
}

// ---------- Announcements and help ----------

export const ANNOUNCEMENT_SEVERITIES = ['info', 'warning', 'critical'] as const;

export interface Announcement {
  id: string;
  title: string;
  body: string;
  severity: (typeof ANNOUNCEMENT_SEVERITIES)[number];
  planCodes: string[];
  tenantIds: string[];
  startsAt: string;
  endsAt: string | null;
  isPublished: boolean;
  createdAt: string;
}

const announcementFields = z.object({
  title: requiredText('the title', 150, 3),
  body: requiredText('the message', 5000),
  severity: z.enum(ANNOUNCEMENT_SEVERITIES).default('info'),
  /** Empty = every plan. */
  planCodes: z.array(planCodeSchema).default([]),
  /** Empty = every hospital. */
  tenantIds: z.array(z.uuid()).default([]),
  startsAt: z.iso.datetime({ offset: true, error: 'Enter a valid start date and time' }).optional(),
  /** When it stops showing; must be after the start and not already in the past. */
  endsAt: z.iso
    .datetime({ offset: true, error: 'Enter a valid end date and time' })
    .refine((v) => Date.parse(v) > Date.now(), 'End time is already in the past')
    .nullable()
    .optional(),
  isPublished: z.boolean().default(true),
});
const announcementOrder = (a: { startsAt?: string; endsAt?: string | null }) =>
  !a.endsAt || Date.parse(a.endsAt) > (a.startsAt ? Date.parse(a.startsAt) : Date.now());
export const upsertAnnouncementSchema = announcementFields.refine(announcementOrder, { message: 'End time must be after the start time', path: ['endsAt'] });
export type UpsertAnnouncement = z.input<typeof upsertAnnouncementSchema>;
export const updateAnnouncementSchema = announcementFields
  .partial()
  .refine((a) => !a.startsAt || !a.endsAt || datesInOrder(a.startsAt, a.endsAt), { message: END_BEFORE_START, path: ['endsAt'] });
export type UpdateAnnouncement = z.input<typeof updateAnnouncementSchema>;

export interface HelpArticle {
  id: string;
  slug: string;
  title: string;
  moduleKey: string | null;
  summary: string;
  body: string;
  sortOrder: number;
  isPublished: boolean;
  updatedAt: string;
}

export const helpQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  module: z.string().trim().max(40).optional(),
});
export type HelpQuery = z.input<typeof helpQuerySchema>;

export const upsertHelpArticleSchema = z.object({
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{2,80}$/, 'Slug: 3-81 lowercase letters, digits or -'),
  title: requiredText('the title', 150, 3),
  moduleKey: z.string().trim().max(40).nullable().default(null),
  summary: z.string().trim().max(300).default(''),
  body: requiredText('the article text', 20000),
  sortOrder: z.number().int().default(0),
  isPublished: z.boolean().default(true),
});
export type UpsertHelpArticle = z.input<typeof upsertHelpArticleSchema>;
export const updateHelpArticleSchema = upsertHelpArticleSchema.partial();
export type UpdateHelpArticle = z.input<typeof updateHelpArticleSchema>;

// ---------- Support tickets ----------

export const TICKET_CATEGORIES = ['technical', 'billing', 'training', 'feature_request', 'data_correction', 'other'] as const;
export const TICKET_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export const TICKET_STATUSES = ['open', 'in_progress', 'waiting_on_customer', 'resolved', 'closed'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export interface TicketMessage {
  id: string;
  authorType: 'staff' | 'platform';
  authorName: string;
  body: string;
  /** Internal notes are only visible to the platform team. */
  isInternal: boolean;
  createdAt: string;
}

export interface Ticket {
  id: string;
  tenantId: string;
  tenantName?: string;
  number: string;
  subject: string;
  category: (typeof TICKET_CATEGORIES)[number];
  priority: (typeof TICKET_PRIORITIES)[number];
  status: TicketStatus;
  raisedByName: string;
  raisedByUserId: string;
  assignedAdminId: string | null;
  assignedAdminName?: string | null;
  lastActivityAt: string;
  createdAt: string;
}

export interface TicketDetail extends Ticket {
  messages: TicketMessage[];
}

export const createTicketSchema = z.object({
  subject: requiredText('the subject', 200, 5),
  category: z.enum(TICKET_CATEGORIES).default('technical'),
  priority: z.enum(TICKET_PRIORITIES).default('normal'),
  body: requiredText('a description of the problem', 10000, 5),
});
export type CreateTicket = z.input<typeof createTicketSchema>;

export const ticketReplySchema = z.object({
  body: requiredText('a reply', 10000),
  /** Platform team only. */
  isInternal: z.boolean().default(false),
});
export type TicketReply = z.input<typeof ticketReplySchema>;

export const ticketListQuerySchema = z.object({
  status: z.enum(TICKET_STATUSES).optional(),
  tenantId: z.uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});
export type TicketListQuery = z.input<typeof ticketListQuerySchema>;

export const updateTicketSchema = z.object({
  status: z.enum(TICKET_STATUSES).optional(),
  priority: z.enum(TICKET_PRIORITIES).optional(),
  assignedAdminId: z.uuid().nullable().optional(),
});
export type UpdateTicket = z.input<typeof updateTicketSchema>;

// ---------- Super-admin console ----------

export const PLATFORM_ADMIN_ROLES = ['super_admin', 'support'] as const;
export type PlatformAdminRole = (typeof PLATFORM_ADMIN_ROLES)[number];

/** Claims inside a platform-admin access token. Staff tokens use typ 'staff' and are rejected here. */
export interface PlatformAccessTokenClaims {
  sub: string;
  sid: string;
  typ: 'platform';
  role: PlatformAdminRole;
}

export const platformLoginSchema = z.object({
  email: emailAddress,
  password: z.string().min(1, 'Enter your password').max(200, 'Password is too long'),
});
export type PlatformLogin = z.input<typeof platformLoginSchema>;

export interface PlatformAdmin {
  id: string;
  email: string;
  name: string;
  role: PlatformAdminRole;
  status: 'active' | 'disabled';
  lastLoginAt: string | null;
  createdAt: string;
}

export interface PlatformLoginResponse {
  accessToken: string;
  expiresIn: number;
  admin: PlatformAdmin;
}

export const createPlatformAdminSchema = z.object({
  email: emailAddress,
  name: personName('the name').refine((v) => v.length >= 2, 'Name needs at least 2 characters'),
  role: z.enum(PLATFORM_ADMIN_ROLES).default('support'),
  password: passwordSchema,
});
export type CreatePlatformAdmin = z.input<typeof createPlatformAdminSchema>;

export const updatePlatformAdminSchema = z.object({
  name: personName('the name').refine((v) => v.length >= 2, 'Name needs at least 2 characters').optional(),
  role: z.enum(PLATFORM_ADMIN_ROLES).optional(),
  status: z.enum(['active', 'disabled']).optional(),
  password: passwordSchema.optional(),
});
export type UpdatePlatformAdmin = z.input<typeof updatePlatformAdminSchema>;

export interface PlatformDashboard {
  tenantsByStatus: Record<TenantStatus, number>;
  tenantsByPlan: Record<string, number>;
  trialsEndingIn7Days: number;
  /** Monthly recurring revenue from active subscriptions, INR. */
  mrr: string;
  openTickets: number;
  unpaidInvoices: { count: number; total: string };
  signupsLast30Days: number;
}

export const tenantListQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(TENANT_STATUSES).optional(),
  plan: z.string().trim().max(31).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});
export type TenantListQuery = z.input<typeof tenantListQuerySchema>;

export interface TenantSummary {
  id: string;
  code: string;
  name: string;
  status: TenantStatus;
  planCode: string;
  subscriptionStatus: SubscriptionStatus | null;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  createdAt: string;
}

export interface EntitlementOverride {
  moduleKey: string;
  enabled: boolean;
  note: string | null;
  expiresAt: string | null;
}

export interface TenantDetail extends TenantSummary {
  subscription: Subscription | null;
  entitlements: Entitlements;
  overrides: EntitlementOverride[];
  limitOverrides: Partial<Limits>;
  usage: Usage & { patients: number };
  invoices: SubscriptionInvoice[];
  onboarding: OnboardingChecklist;
  tickets: Ticket[];
}

export const adminCreateTenantSchema = signupSchema
  .omit({ acceptTerms: true })
  .extend({
    /** Skip the trial and start active (e.g. a signed contract). */
    startActive: z.boolean().default(false),
    trialDays: z.number({ error: 'Enter trial days' }).int('Trial days must be a whole number').min(0, 'Trial days cannot be negative').max(180, 'Trial can be at most 180 days').optional(),
  });
export type AdminCreateTenant = z.input<typeof adminCreateTenantSchema>;

export const adminUpdateTenantSchema = z.object({
  name: requiredText('the hospital name', 120, 3).optional(),
});
export type AdminUpdateTenant = z.input<typeof adminUpdateTenantSchema>;

export const adminSetTenantStatusSchema = z.object({
  status: z.enum(['active', 'suspended', 'closed']),
  reason: requiredText('the reason', 500, 3),
});
export type AdminSetTenantStatus = z.input<typeof adminSetTenantStatusSchema>;

export const adminSetSubscriptionSchema = z.object({
  planCode: planCodeSchema,
  billingCycle: z.enum(BILLING_CYCLES).default('monthly'),
  /** Custom price per cycle (enterprise deals); defaults to the plan price. */
  price: money.nullable().optional(),
  /** Put the hospital on (or extend) a trial ending at this time. */
  trialEndsAt: z.iso
    .datetime({ offset: true, error: 'Enter a valid trial end date' })
    .refine((v) => Date.parse(v) > Date.now(), 'Trial end must be in the future')
    .refine((v) => Date.parse(v) <= Date.now() + 366 * 86_400_000, 'Trial can end at most a year from today')
    .optional(),
  /** Activate now for one billing period without an invoice (e.g. paid offline under contract). */
  activateNow: z.boolean().default(false),
});
export type AdminSetSubscription = z.input<typeof adminSetSubscriptionSchema>;

export const adminSetEntitlementsSchema = z.object({
  /** module key → true (add), false (remove), null (back to plan default). */
  modules: z.partialRecord(z.enum(ENTITLEMENT_MODULES), z.boolean().nullable()).default({}),
  /** limit → number, or null to go back to the plan limit. Use -1 for unlimited. */
  limits: z.partialRecord(z.enum(LIMIT_KEYS), z.number().int('Must be a whole number').min(-1, 'Use -1 for unlimited, or 0 or more').max(100_000, 'Too large').nullable()).default({}),
  note: z.string().trim().max(300, 'Note can be at most 300 characters').optional(),
});
export type AdminSetEntitlements = z.input<typeof adminSetEntitlementsSchema>;

export const invoiceListQuerySchema = z.object({
  status: z.enum(INVOICE_STATUSES).optional(),
  tenantId: z.uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});
export type InvoiceListQuery = z.input<typeof invoiceListQuerySchema>;

export const markInvoicePaidSchema = z.object({
  mode: z.enum(PAYMENT_MODES).exclude(['sandbox']).default('manual'),
  ref: z.string().trim().max(100, 'Reference can be at most 100 characters').optional(),
});
export type MarkInvoicePaid = z.input<typeof markInvoicePaidSchema>;

export interface AdminAuditEntry {
  id: string;
  adminId: string | null;
  adminName: string | null;
  targetTenantId: string | null;
  action: string;
  details: Record<string, unknown>;
  at: string;
}

export interface LifecycleRunResult {
  trialsExpired: number;
  renewalsIssued: number;
  movedToGrace: number;
  suspended: number;
}

// ---------- Events (published by platform) ----------

export interface TenantSignedUpEvent {
  tenantId: string;
  code: string;
  name: string;
  planCode: string;
  adminUserId: string;
}

export interface SubscriptionChangedEvent {
  subscriptionId: string;
  planCode: string;
  status: SubscriptionStatus;
}

export interface InvoiceIssuedEvent {
  invoiceId: string;
  number: string;
  total: string;
  dueAt: string;
}
