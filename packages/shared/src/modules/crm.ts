import { z } from 'zod';
import { defineModule } from '../manifest';
import { paginationQuerySchema } from '../common';
import { emailAddress, indianMobile, isoDate, pan as panNumber, pastOrTodayDate, todayIso } from '../validation';

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
  .number({ error: 'Enter an amount' })
  .refine(Number.isFinite, 'Enter an amount')
  .min(0, 'Amount cannot be negative')
  .max(99_999_999_999.99, 'Amount is too large')
  .refine((v) => Math.abs(Math.round(v * 100) - v * 100) < 1e-6, 'At most 2 decimal places');
const text = (max: number, label = 'this field') =>
  z
    .string({ error: `Enter ${label}` })
    .trim()
    .min(1, `Enter ${label}`)
    .max(max, `Enter at most ${max} characters`);
const optText = (max: number) => z.string().trim().max(max, `Enter at most ${max} characters`).nullish().transform((v) => (v ? v : null));
/** Accepts +91 / 0 prefixes and spaces; stores 10 digits. */
const mobile = indianMobile;
/** Empty form fields count as "not given". */
const blank = <T extends z.ZodType>(s: T) => z.union([z.literal('').transform(() => null), s]);
const email = emailAddress;
const date = isoDate;
const age = z.coerce
  .number({ error: 'Enter the age in years' })
  .int('Age must be whole years')
  .min(0, 'Age cannot be negative')
  .max(130, 'Age cannot be more than 130');
/** Today in India time, as the start of a date-time comparison. */
const startOfTodayMs = () => Date.parse(`${todayIso()}T00:00:00+05:30`);
/** A next-call time: today or later (earlier today is allowed, so "call back now" works). */
const followUpTime = z.iso
  .datetime({ offset: true, error: 'Enter a valid date and time' })
  .refine((v) => Date.parse(v) >= startOfTodayMs(), 'Next follow-up cannot be in the past')
  .refine((v) => Date.parse(v) <= Date.now() + 366 * 86_400_000, 'Next follow-up cannot be more than a year ahead');
const dueDate = date
  .refine((d) => d >= todayIso(), 'Due date cannot be in the past')
  .refine((d) => d <= todayIso(3 * 366), 'Due date cannot be more than 3 years ahead');

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
  name: text(200, 'the name'),
  mobile: blank(mobile.nullish()).transform((v) => v ?? null),
  email: blank(email.nullish()).transform((v) => v ?? null),
  organization: optText(200),
  city: optText(100),
  registrationNo: optText(50),
  pan: blank(panNumber.nullish()).transform((v) => v ?? null),
  notes: optText(1000),
  isActive: z.boolean().default(true),
});
export type ReferrerInput = z.input<typeof referrerInputSchema>;
export const updateReferrerSchema = referrerInputSchema.partial();
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
    rateType: z.enum(RATE_TYPES, { error: 'Pick % of bill or a flat amount' }),
    rate: money.refine((v) => v > 0, 'Rate must be more than 0'),
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
  patientId: z.uuid({ error: 'Pick a patient' }),
  referrerId: z.uuid({ error: 'Pick a referrer' }),
  referredOn: pastOrTodayDate('Referral date')
    .refine((d) => d >= todayIso(-366), 'Referral date cannot be more than a year ago')
    .optional(),
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
  .refine((s) => s.periodTo >= s.periodFrom, { message: 'End date is before the start date', path: ['periodTo'] })
  .refine((s) => s.periodTo <= todayIso(), { message: 'A statement cannot cover future dates', path: ['periodTo'] });
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
    name: text(200, 'the name'),
    mobile: blank(mobile.nullish()).transform((v) => v ?? null),
    email: blank(email.nullish()).transform((v) => v ?? null),
    gender: z.enum(['male', 'female', 'other']).nullish().transform((v) => v ?? null),
    ageYears: blank(age.nullish()).transform((v) => v ?? null),
    city: optText(100),
    source: z.enum(LEAD_SOURCES).default('walk_in'),
    interest: optText(200),
    notes: optText(2000),
    assignedTo: z.uuid().nullish().transform((v) => v ?? null),
    nextFollowUpAt: blank(followUpTime.nullish()).transform((v) => v ?? null),
    referrerId: z.uuid().nullish().transform((v) => v ?? null),
    campId: z.uuid().nullish().transform((v) => v ?? null),
  })
  .refine((l) => l.mobile || l.email, { message: 'Give a mobile number or an email', path: ['mobile'] });
export type LeadInput = z.input<typeof leadInputSchema>;

export const updateLeadSchema = z.object({
  name: text(200, 'the name').optional(),
  mobile: blank(mobile.nullish()),
  email: blank(email.nullish()),
  gender: z.enum(['male', 'female', 'other']).nullish(),
  ageYears: blank(age.nullish()),
  city: optText(100).optional(),
  source: z.enum(LEAD_SOURCES).optional(),
  interest: optText(200).optional(),
  notes: optText(2000).optional(),
  assignedTo: z.uuid().nullish(),
  nextFollowUpAt: blank(followUpTime.nullish()),
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
  note: text(2000, 'a note'),
  /** Optionally move the lead on (not to converted/lost; use those endpoints). */
  status: z.enum(['new', 'contacted', 'qualified']).optional(),
  /** Earlier today is allowed so a call can be logged as due now. */
  nextFollowUpAt: blank(
    z.iso
      .datetime({ offset: true, error: 'Enter a valid date and time' })
      .refine((v) => Date.parse(v) <= Date.now() + 366 * 86_400_000, 'Next follow-up cannot be more than a year ahead')
      .nullish(),
  ),
});
export type LeadActivityInput = z.input<typeof leadActivityInputSchema>;

export const loseLeadSchema = z.object({ reason: text(500, 'a reason') });
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
        firstName: text(100, 'the first name').regex(/^[\p{L}\p{M}][\p{L}\p{M} .'-]*$/u, "First name can only have letters, spaces and . ' -"),
        lastName: optText(100).optional(),
        gender: z.enum(['male', 'female', 'other'], { error: 'Pick a gender' }),
        ageYears: blank(age.optional().nullable()).transform((v) => v ?? undefined),
        mobile: blank(mobile.optional().nullable()).transform((v) => v ?? undefined),
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

/** Camps can be recorded up to a year after they happened and planned up to two years ahead. */
const campDate = date
  .refine((d) => d >= todayIso(-366), 'Camp date cannot be more than a year ago')
  .refine((d) => d <= todayIso(2 * 366), 'Camp date cannot be more than 2 years ahead');
const targetCount = z.coerce.number({ error: 'Enter a number' }).int('Target must be a whole number').min(0, 'Target cannot be negative').max(1_000_000, 'Target is too large');
/** Longest a single camp may run, in days. */
export const MAX_CAMP_DAYS = 90;

/** Problems with a camp's dates, status and money (fields may be missing on an update). */
export function campIssues(c: { startsOn?: string | null; endsOn?: string | null; status?: string | null; budget?: number | null; spent?: number | null }): { path: string; message: string }[] {
  const out: { path: string; message: string }[] = [];
  if (c.startsOn && c.endsOn) {
    if (c.endsOn < c.startsOn) out.push({ path: 'endsOn', message: 'End date is before the start date' });
    else if ((Date.parse(c.endsOn) - Date.parse(c.startsOn)) / 86_400_000 + 1 > MAX_CAMP_DAYS) out.push({ path: 'endsOn', message: `A camp can run at most ${MAX_CAMP_DAYS} days` });
  }
  const today = todayIso();
  if ((c.status === 'ongoing' || c.status === 'completed') && c.startsOn && c.startsOn > today) {
    out.push({ path: 'status', message: `A camp cannot be ${c.status} before its start date` });
  }
  return out;
}
const checkCamp = (c: Parameters<typeof campIssues>[0], ctx: z.RefinementCtx) => {
  for (const i of campIssues(c)) ctx.addIssue({ code: 'custom', path: [i.path], message: i.message });
};

export const campInputSchema = z
  .object({
    name: text(200, 'the camp name'),
    type: z.enum(CAMP_TYPES).default('health_camp'),
    facilityId: z.uuid().nullish().transform((v) => v ?? null),
    location: optText(300),
    startsOn: campDate,
    endsOn: campDate,
    targetCount: blank(targetCount.nullish()).transform((v) => v ?? null),
    budget: blank(money.nullish()).transform((v) => v ?? null),
    spent: blank(money.nullish()).transform((v) => v ?? null),
    notes: optText(2000),
  })
  .superRefine(checkCamp);
export type CampInput = z.input<typeof campInputSchema>;

export const updateCampSchema = z
  .object({
    name: text(200, 'the camp name').optional(),
    type: z.enum(CAMP_TYPES).optional(),
    location: optText(300).optional(),
    /** Old camps keep their dates on edit; only the order and length are checked here. */
    startsOn: date.optional(),
    endsOn: date.optional(),
    status: z.enum(CAMP_STATUSES).optional(),
    targetCount: blank(targetCount.nullish()),
    budget: blank(money.nullish()),
    spent: blank(money.nullish()),
    notes: optText(2000).optional(),
  })
  .superRefine(checkCamp);
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
  name: text(200, 'the campaign name'),
  channel: z.enum(CAMPAIGN_CHANNELS, { error: 'Pick a channel' }),
  message: text(1000, 'the message'),
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
    dueDate,
    type: z.enum(FOLLOW_UP_TYPES).default('revisit'),
    reason: optText(1000),
    assignedTo: z.uuid().nullish().transform((v) => v ?? null),
  })
  .refine((f) => f.patientId || f.leadId, { message: 'Pick a patient or an enquiry', path: ['patientId'] });
export type FollowUpInput = z.input<typeof followUpInputSchema>;

export const updateFollowUpSchema = z.object({
  dueDate: dueDate.optional(),
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
  reminderCount: number;
  lastRemindedAt: string | null;
  outcome: string | null;
  completedAt: string | null;
  createdAt: string;
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
