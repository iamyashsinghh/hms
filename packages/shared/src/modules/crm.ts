import { z } from 'zod';
import { defineModule } from '../manifest';
import { patchSchema } from '../patch';
import { paginationQuerySchema } from '../common';

/**
 * Referral & CRM: permissions and API contracts (Zod schemas + types).
 * Owned by the "crm" workstream. Money travels as numbers in rupees with 2 decimals.
 */
export const crmModule = defineModule({
  key: 'crm',
  name: 'Referral & CRM',
  permissions: [
    { key: 'crm.lead.read', description: 'View enquiries (leads) and their history' },
    { key: 'crm.lead.manage', description: 'Add enquiries, log calls, change status and convert them to patients' },
    { key: 'crm.referrer.read', description: 'View referring doctors and agents' },
    { key: 'crm.referrer.manage', description: 'Add and edit referrers and commission rules' },
    { key: 'crm.referral.create', description: 'Tag a patient with the doctor or agent who referred them' },
    { key: 'crm.commission.read', description: 'View referral commissions and statements' },
    { key: 'crm.commission.manage', description: 'Create, approve and cancel commission statements' },
    { key: 'crm.commission.pay', description: 'Mark commission statements as paid' },
    { key: 'crm.camp.read', description: 'View health camps' },
    { key: 'crm.camp.manage', description: 'Plan and update health camps' },
    { key: 'crm.campaign.manage', description: 'Create and send message campaigns to enquiries' },
    { key: 'crm.followup.read', description: 'View patient follow-up reminders' },
    { key: 'crm.followup.manage', description: 'Create, close and send follow-up reminders' },
  ],
  grants: {
    hospital_admin: [
      'crm.lead.read', 'crm.lead.manage', 'crm.referrer.read', 'crm.referrer.manage', 'crm.referral.create',
      'crm.commission.read', 'crm.commission.manage', 'crm.commission.pay', 'crm.camp.read', 'crm.camp.manage',
      'crm.campaign.manage', 'crm.followup.read', 'crm.followup.manage',
    ],
    owner: ['crm.lead.read', 'crm.referrer.read', 'crm.commission.read', 'crm.camp.read', 'crm.followup.read'],
    receptionist: [
      'crm.lead.read', 'crm.lead.manage', 'crm.referrer.read', 'crm.referral.create', 'crm.camp.read',
      'crm.followup.read', 'crm.followup.manage',
    ],
    accountant: ['crm.referrer.read', 'crm.commission.read', 'crm.commission.manage', 'crm.commission.pay'],
    doctor: ['crm.referrer.read', 'crm.followup.read'],
    nurse: ['crm.followup.read'],
  },
});

// ---------- shared bits ----------

const money = z.coerce
  .number()
  .min(0)
  .max(99_999_999_999.99)
  .refine((v) => Math.abs(Math.round(v * 100) - v * 100) < 1e-6, 'At most 2 decimal places');
const text = (max: number) => z.string().trim().min(1).max(max);
const optText = (max: number) => z.string().trim().max(max).nullish().transform((v) => (v ? v : null));
const mobile = z.string().trim().regex(/^[6-9]\d{9}$/, 'Enter a 10-digit Indian mobile number');
const date = z.iso.date();

export const REFERRER_TYPES = ['doctor', 'hospital', 'clinic', 'agent', 'corporate', 'staff', 'other'] as const;
export const RULE_SCOPES = ['all', 'frontoffice', 'emr', 'billing', 'pharmacy', 'lab', 'radiology', 'ipd'] as const;
export const RATE_TYPES = ['percent', 'flat'] as const;
export const LEAD_SOURCES = ['walk_in', 'phone', 'website', 'camp', 'referral', 'campaign', 'social', 'whatsapp', 'other'] as const;
export const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'converted', 'lost'] as const;
/** Statuses a lead can still be worked in. */
export const OPEN_LEAD_STATUSES = ['new', 'contacted', 'qualified'] as const;
export const ACTIVITY_TYPES = ['note', 'call', 'message', 'visit', 'status_change'] as const;
export const CAMP_TYPES = ['health_camp', 'screening', 'awareness', 'corporate', 'school', 'other'] as const;
export const CAMP_STATUSES = ['planned', 'ongoing', 'completed', 'cancelled'] as const;
export const CAMPAIGN_CHANNELS = ['sms', 'whatsapp', 'email'] as const;
export const CAMPAIGN_STATUSES = ['draft', 'sent', 'cancelled'] as const;
export const STATEMENT_STATUSES = ['draft', 'approved', 'paid', 'cancelled'] as const;
export const COMMISSION_PAYMENT_MODES = ['cash', 'upi', 'bank', 'cheque'] as const;
export const FOLLOW_UP_TYPES = ['revisit', 'call', 'feedback_recovery', 'test_review', 'other'] as const;
export const FOLLOW_UP_SOURCES = ['manual', 'emr', 'feedback'] as const;
export const FOLLOW_UP_STATUSES = ['pending', 'done', 'cancelled'] as const;
/** Portal ratings at or below this create a feedback-recovery follow-up. */
export const LOW_FEEDBACK_RATING = 2;
/** Default number of days a referral earns commission when no end date is given. */
export const DEFAULT_REFERRAL_DAYS = 90;

export type ReferrerType = (typeof REFERRER_TYPES)[number];
export type RuleScope = (typeof RULE_SCOPES)[number];
export type RateType = (typeof RATE_TYPES)[number];
export type LeadSource = (typeof LEAD_SOURCES)[number];
export type LeadStatus = (typeof LEAD_STATUSES)[number];
export type ActivityType = (typeof ACTIVITY_TYPES)[number];
export type CampType = (typeof CAMP_TYPES)[number];
export type CampStatus = (typeof CAMP_STATUSES)[number];
export type CampaignChannel = (typeof CAMPAIGN_CHANNELS)[number];
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];
export type StatementStatus = (typeof STATEMENT_STATUSES)[number];
export type CommissionPaymentMode = (typeof COMMISSION_PAYMENT_MODES)[number];
export type FollowUpType = (typeof FOLLOW_UP_TYPES)[number];
export type FollowUpSource = (typeof FOLLOW_UP_SOURCES)[number];
export type FollowUpStatus = (typeof FOLLOW_UP_STATUSES)[number];

// ---------- referrers ----------

export const referrerInputSchema = z.object({
  type: z.enum(REFERRER_TYPES).default('doctor'),
  name: text(200),
  mobile: mobile.nullish().transform((v) => v ?? null),
  email: z.email().nullish().transform((v) => v ?? null),
  organization: optText(200),
  city: optText(100),
  registrationNo: optText(50),
  pan: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, 'Enter a valid PAN')
    .nullish()
    .transform((v) => v ?? null),
  notes: optText(1000),
  isActive: z.boolean().default(true),
});
export type ReferrerInput = z.input<typeof referrerInputSchema>;
export const updateReferrerSchema = patchSchema(referrerInputSchema);
export type UpdateReferrer = z.input<typeof updateReferrerSchema>;

export const referrerQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().max(100).optional(),
  type: z.enum(REFERRER_TYPES).optional(),
  active: z.enum(['true', 'false']).optional(),
});
export type ReferrerQuery = z.input<typeof referrerQuerySchema>;

export interface Referrer {
  id: string;
  code: string;
  type: ReferrerType;
  name: string;
  mobile: string | null;
  email: string | null;
  organization: string | null;
  city: string | null;
  registrationNo: string | null;
  pan: string | null;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ReferrerSummary extends Referrer {
  referralCount: number;
  /** Commission accrued but not yet on a statement. */
  openCommission: number;
  /** Commission on approved statements not yet paid. */
  payableCommission: number;
  paidCommission: number;
}

// ---------- commission rules ----------

export const commissionRuleInputSchema = z
  .object({
    referrerId: z.uuid().nullish().transform((v) => v ?? null),
    appliesTo: z.enum(RULE_SCOPES).default('all'),
    serviceCode: z
      .string()
      .trim()
      .toUpperCase()
      .max(40)
      .nullish()
      .transform((v) => (v ? v : null)),
    rateType: z.enum(RATE_TYPES),
    rate: money,
    effectiveFrom: date.optional(),
    effectiveTo: date.nullish().transform((v) => v ?? null),
    isActive: z.boolean().default(true),
  })
  .refine((r) => r.rateType !== 'percent' || r.rate <= 100, { message: 'A percentage cannot be more than 100', path: ['rate'] })
  .refine((r) => !r.effectiveTo || !r.effectiveFrom || r.effectiveTo >= r.effectiveFrom, {
    message: 'End date is before the start date',
    path: ['effectiveTo'],
  });
export type CommissionRuleInput = z.input<typeof commissionRuleInputSchema>;

export interface CommissionRule {
  id: string;
  referrerId: string | null;
  referrerName: string | null;
  appliesTo: RuleScope;
  serviceCode: string | null;
  rateType: RateType;
  rate: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  isActive: boolean;
}

// ---------- referrals ----------

export const referralInputSchema = z.object({
  patientId: z.uuid(),
  referrerId: z.uuid(),
  referredOn: date.optional(),
  /** Last bill date that earns commission. Defaults to referredOn + DEFAULT_REFERRAL_DAYS. */
  validUntil: date.nullish(),
  leadId: z.uuid().optional(),
  notes: optText(1000),
});
export type ReferralInput = z.input<typeof referralInputSchema>;

export const referralQuerySchema = paginationQuerySchema.extend({
  referrerId: z.uuid().optional(),
  patientId: z.uuid().optional(),
  from: date.optional(),
  to: date.optional(),
});
export type ReferralQuery = z.input<typeof referralQuerySchema>;

export interface Referral {
  id: string;
  patientId: string;
  patientName: string;
  patientUhid: string;
  referrerId: string;
  referrerName: string;
  referredOn: string;
  validUntil: string | null;
  leadId: string | null;
  notes: string | null;
  status: 'active' | 'closed';
  createdAt: string;
}

// ---------- commissions and statements ----------

export const commissionQuerySchema = paginationQuerySchema.extend({
  referrerId: z.uuid().optional(),
  /** open = accrued, not yet on a statement. */
  state: z.enum(['open', 'billed', 'cancelled', 'all']).default('all'),
  from: date.optional(),
  to: date.optional(),
});
export type CommissionQuery = z.input<typeof commissionQuerySchema>;

export interface CommissionLine {
  description: string;
  serviceCode: string | null;
  amount: number;
  ruleId: string | null;
  rateType: RateType | null;
  rate: number;
  commission: number;
}

export interface Commission {
  id: string;
  kind: 'accrual' | 'reversal';
  referrerId: string;
  referrerName: string;
  referralId: string;
  patientId: string;
  patientName: string;
  invoiceId: string;
  invoiceNumber: string;
  invoiceDate: string;
  sourceModule: string;
  baseAmount: number;
  amount: number;
  breakdown: CommissionLine[];
  status: 'open' | 'cancelled';
  statementId: string | null;
  statementNumber: string | null;
  createdAt: string;
}

export const createStatementSchema = z
  .object({
    referrerId: z.uuid(),
    periodFrom: date,
    periodTo: date,
    notes: optText(1000),
  })
  .refine((s) => s.periodTo >= s.periodFrom, { message: 'End date is before the start date', path: ['periodTo'] });
export type CreateStatement = z.input<typeof createStatementSchema>;

export const payStatementSchema = z.object({
  mode: z.enum(COMMISSION_PAYMENT_MODES),
  reference: optText(100),
  notes: optText(1000),
});
export type PayStatement = z.input<typeof payStatementSchema>;

export const statementQuerySchema = paginationQuerySchema.extend({
  referrerId: z.uuid().optional(),
  status: z.enum(STATEMENT_STATUSES).optional(),
});
export type StatementQuery = z.input<typeof statementQuerySchema>;

export interface CommissionStatement {
  id: string;
  number: string;
  referrerId: string;
  referrerName: string;
  periodFrom: string;
  periodTo: string;
  total: number;
  status: StatementStatus;
  approvedAt: string | null;
  paidAt: string | null;
  paymentMode: CommissionPaymentMode | null;
  paymentRef: string | null;
  notes: string | null;
  createdAt: string;
}

export interface CommissionStatementDetail extends CommissionStatement {
  commissions: Commission[];
}

// ---------- leads ----------

export const leadInputSchema = z
  .object({
    name: text(200),
    mobile: mobile.nullish().transform((v) => v ?? null),
    email: z.email().nullish().transform((v) => v ?? null),
    gender: z.enum(['male', 'female', 'other']).nullish().transform((v) => v ?? null),
    ageYears: z.coerce.number().int().min(0).max(130).nullish().transform((v) => v ?? null),
    city: optText(100),
    source: z.enum(LEAD_SOURCES).default('walk_in'),
    interest: optText(200),
    notes: optText(2000),
    assignedTo: z.uuid().nullish().transform((v) => v ?? null),
    nextFollowUpAt: z.iso.datetime({ offset: true }).nullish().transform((v) => v ?? null),
    referrerId: z.uuid().nullish().transform((v) => v ?? null),
    campId: z.uuid().nullish().transform((v) => v ?? null),
  })
  .refine((l) => l.mobile || l.email, { message: 'Give a mobile number or an email', path: ['mobile'] });
export type LeadInput = z.input<typeof leadInputSchema>;

export const updateLeadSchema = z.object({
  name: text(200).optional(),
  mobile: mobile.nullish(),
  email: z.email().nullish(),
  gender: z.enum(['male', 'female', 'other']).nullish(),
  ageYears: z.coerce.number().int().min(0).max(130).nullish(),
  city: optText(100).optional(),
  source: z.enum(LEAD_SOURCES).optional(),
  interest: optText(200).optional(),
  notes: optText(2000).optional(),
  assignedTo: z.uuid().nullish(),
  nextFollowUpAt: z.iso.datetime({ offset: true }).nullish(),
  referrerId: z.uuid().nullish(),
  campId: z.uuid().nullish(),
});
export type UpdateLead = z.input<typeof updateLeadSchema>;

export const leadQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().max(100).optional(),
  status: z.enum([...LEAD_STATUSES, 'open']).optional(),
  source: z.enum(LEAD_SOURCES).optional(),
  campId: z.uuid().optional(),
  assignedTo: z.uuid().optional(),
  /** Only leads whose next follow-up is due by now. */
  due: z.enum(['true', 'false']).optional(),
});
export type LeadQuery = z.input<typeof leadQuerySchema>;

export const leadActivityInputSchema = z.object({
  type: z.enum(['note', 'call', 'message', 'visit']),
  note: text(2000),
  /** Optionally move the lead on (not to converted/lost; use those endpoints). */
  status: z.enum(['new', 'contacted', 'qualified']).optional(),
  nextFollowUpAt: z.iso.datetime({ offset: true }).nullish(),
});
export type LeadActivityInput = z.input<typeof leadActivityInputSchema>;

export const loseLeadSchema = z.object({ reason: text(500) });
export type LoseLead = z.input<typeof loseLeadSchema>;

/**
 * Convert a lead to a patient: link an existing patient, or register a new one from the lead's details
 * (gender is required for registration). If the lead has a referrer, a referral is created too.
 */
export const convertLeadSchema = z
  .object({
    patientId: z.uuid().optional(),
    register: z
      .object({
        firstName: text(100),
        lastName: optText(100).optional(),
        gender: z.enum(['male', 'female', 'other']),
        ageYears: z.coerce.number().int().min(0).max(130).optional(),
        mobile: mobile.optional(),
      })
      .optional(),
  })
  .refine((c) => !!c.patientId !== !!c.register, 'Give either an existing patient or details to register one');
export type ConvertLead = z.input<typeof convertLeadSchema>;

export interface LeadActivity {
  id: string;
  type: ActivityType;
  note: string | null;
  fromStatus: LeadStatus | null;
  toStatus: LeadStatus | null;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string;
}

export interface Lead {
  id: string;
  number: string;
  name: string;
  mobile: string | null;
  email: string | null;
  gender: 'male' | 'female' | 'other' | null;
  ageYears: number | null;
  city: string | null;
  source: LeadSource;
  interest: string | null;
  notes: string | null;
  status: LeadStatus;
  lostReason: string | null;
  assignedTo: string | null;
  assignedToName: string | null;
  nextFollowUpAt: string | null;
  referrerId: string | null;
  referrerName: string | null;
  campId: string | null;
  campName: string | null;
  campaignId: string | null;
  patientId: string | null;
  convertedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LeadDetail extends Lead {
  activities: LeadActivity[];
}

// ---------- camps ----------

export const campInputSchema = z
  .object({
    name: text(200),
    type: z.enum(CAMP_TYPES).default('health_camp'),
    facilityId: z.uuid().nullish().transform((v) => v ?? null),
    location: optText(300),
    startsOn: date,
    endsOn: date,
    targetCount: z.coerce.number().int().min(0).nullish().transform((v) => v ?? null),
    budget: money.nullish().transform((v) => v ?? null),
    spent: money.nullish().transform((v) => v ?? null),
    notes: optText(2000),
  })
  .refine((c) => c.endsOn >= c.startsOn, { message: 'End date is before the start date', path: ['endsOn'] });
export type CampInput = z.input<typeof campInputSchema>;

export const updateCampSchema = z.object({
  name: text(200).optional(),
  type: z.enum(CAMP_TYPES).optional(),
  location: optText(300).optional(),
  startsOn: date.optional(),
  endsOn: date.optional(),
  status: z.enum(CAMP_STATUSES).optional(),
  targetCount: z.coerce.number().int().min(0).nullish(),
  budget: money.nullish(),
  spent: money.nullish(),
  notes: optText(2000).optional(),
});
export type UpdateCamp = z.input<typeof updateCampSchema>;

export const campQuerySchema = paginationQuerySchema.extend({ status: z.enum(CAMP_STATUSES).optional() });
export type CampQuery = z.input<typeof campQuerySchema>;

export interface Camp {
  id: string;
  code: string;
  name: string;
  type: CampType;
  facilityId: string | null;
  location: string | null;
  startsOn: string;
  endsOn: string;
  status: CampStatus;
  targetCount: number | null;
  budget: number | null;
  spent: number | null;
  notes: string | null;
  /** Enquiries captured at the camp. */
  leadCount: number;
  convertedCount: number;
  createdAt: string;
}

// ---------- campaigns ----------

export const campaignAudienceSchema = z.object({
  statuses: z.array(z.enum(LEAD_STATUSES)).max(5).optional(),
  sources: z.array(z.enum(LEAD_SOURCES)).max(9).optional(),
  campId: z.uuid().optional(),
});
export type CampaignAudience = z.infer<typeof campaignAudienceSchema>;

export const campaignInputSchema = z.object({
  name: text(200),
  channel: z.enum(CAMPAIGN_CHANNELS),
  message: text(1000),
  audience: campaignAudienceSchema.default({}),
});
export type CampaignInput = z.input<typeof campaignInputSchema>;

export interface Campaign {
  id: string;
  name: string;
  channel: CampaignChannel;
  message: string;
  audience: CampaignAudience;
  status: CampaignStatus;
  recipientCount: number;
  queuedCount: number;
  skippedCount: number;
  /** Leads this audience matches right now (drafts) or matched when sent. */
  audienceSize: number;
  sentAt: string | null;
  createdAt: string;
}

// ---------- follow-ups ----------

export const followUpInputSchema = z
  .object({
    patientId: z.uuid().optional(),
    leadId: z.uuid().optional(),
    dueDate: date,
    type: z.enum(FOLLOW_UP_TYPES).default('revisit'),
    reason: optText(1000),
    assignedTo: z.uuid().nullish().transform((v) => v ?? null),
  })
  .refine((f) => f.patientId || f.leadId, { message: 'Pick a patient or an enquiry', path: ['patientId'] });
export type FollowUpInput = z.input<typeof followUpInputSchema>;

export const updateFollowUpSchema = z.object({
  dueDate: date.optional(),
  type: z.enum(FOLLOW_UP_TYPES).optional(),
  reason: optText(1000).optional(),
  assignedTo: z.uuid().nullish(),
});
export type UpdateFollowUp = z.input<typeof updateFollowUpSchema>;

export const closeFollowUpSchema = z.object({
  status: z.enum(['done', 'cancelled']),
  outcome: optText(1000),
});
export type CloseFollowUp = z.input<typeof closeFollowUpSchema>;

export const followUpQuerySchema = paginationQuerySchema.extend({
  status: z.enum(FOLLOW_UP_STATUSES).optional(),
  /** overdue = pending and due before today; today = due today; upcoming = due after today. */
  when: z.enum(['overdue', 'today', 'upcoming']).optional(),
  patientId: z.uuid().optional(),
  type: z.enum(FOLLOW_UP_TYPES).optional(),
  source: z.enum(FOLLOW_UP_SOURCES).optional(),
});
export type FollowUpQuery = z.input<typeof followUpQuerySchema>;

export const remindFollowUpSchema = z.object({
  channels: z.array(z.enum(CAMPAIGN_CHANNELS)).min(1).max(3).optional(),
  /** Overrides the standard reminder text. */
  message: optText(1000).optional(),
});
export type RemindFollowUp = z.input<typeof remindFollowUpSchema>;

export interface FollowUp {
  id: string;
  patientId: string | null;
  patientName: string | null;
  patientUhid: string | null;
  patientMobile: string | null;
  leadId: string | null;
  leadName: string | null;
  dueDate: string;
  type: FollowUpType;
  reason: string | null;
  source: FollowUpSource;
  sourceRef: string | null;
  status: FollowUpStatus;
  assignedTo: string | null;
  assignedToName: string | null;
  reminderCount: number;
  lastRemindedAt: string | null;
  outcome: string | null;
  completedAt: string | null;
  createdAt: string;
}

/** A staff user who can be assigned an enquiry or a follow-up (GET /crm/staff). */
export interface CrmStaff {
  id: string;
  name: string;
}

/** Result of POST /crm/follow-ups/remind-due. */
export interface RemindDueResult {
  date: string;
  reminded: number;
  skipped: number;
}

// ---------- dashboard ----------

export interface CrmDashboard {
  leads: { open: number; newToday: number; dueFollowUps: number; convertedThisMonth: number; lostThisMonth: number };
  bySource: { source: LeadSource; total: number; converted: number }[];
  followUps: { overdue: number; today: number; upcoming7d: number };
  referrals: { thisMonth: number; topReferrers: { referrerId: string; name: string; referrals: number; commission: number }[] };
  commission: { open: number; payable: number; paidThisMonth: number };
  camps: { upcoming: number; ongoing: number };
}

// ---------- events (published by crm) ----------

export interface LeadConvertedEvent {
  leadId: string;
  patientId: string;
  source: LeadSource;
  referrerId: string | null;
  campId: string | null;
}
export interface ReferralCreatedEvent {
  referralId: string;
  patientId: string;
  referrerId: string;
}
export interface StatementPaidEvent {
  statementId: string;
  number: string;
  referrerId: string;
  total: number;
  mode: CommissionPaymentMode;
}
