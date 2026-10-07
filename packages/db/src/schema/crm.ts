/**
 * Referral & CRM tables. Owned by the "crm" workstream (Postgres schema: crm).
 * Kept in sync with migrations/*_crm_*.sql (pnpm test checks it).
 * Money is numeric(14,2) and comes back from Drizzle as a string.
 */
import { sql } from 'drizzle-orm';
import { boolean, date, index, integer, jsonb, numeric, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { actorColumns, crm as pg, idColumn, tenantIdColumn, timestamps } from './_common';

const money = (name: string) => numeric(name, { precision: 14, scale: 2 });
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' });

export const crmReferrers = pg.table(
  'referrers',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    code: text('code').notNull(),
    type: text('type').notNull().default('doctor'),
    name: text('name').notNull(),
    mobile: text('mobile'),
    email: text('email'),
    organization: text('organization'),
    city: text('city'),
    registrationNo: text('registration_no'),
    pan: text('pan'),
    notes: text('notes'),
    isActive: boolean('is_active').notNull().default(true),
    ...actorColumns(),
    ...timestamps(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] }), uniqueIndex('crm_referrers_code_uq').on(t.tenantId, t.code)],
);

export const crmCommissionRules = pg.table(
  'commission_rules',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    referrerId: uuid('referrer_id'),
    appliesTo: text('applies_to').notNull().default('all'),
    serviceCode: text('service_code'),
    rateType: text('rate_type').notNull(),
    rate: money('rate').notNull(),
    effectiveFrom: date('effective_from').notNull().default(sql`current_date`),
    effectiveTo: date('effective_to'),
    isActive: boolean('is_active').notNull().default(true),
    ...actorColumns(),
    ...timestamps(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] }), index('crm_commission_rules_referrer_idx').on(t.tenantId, t.referrerId)],
);

export const crmCamps = pg.table(
  'camps',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    type: text('type').notNull().default('health_camp'),
    facilityId: uuid('facility_id'),
    location: text('location'),
    startsOn: date('starts_on').notNull(),
    endsOn: date('ends_on').notNull(),
    status: text('status').notNull().default('planned'),
    targetCount: integer('target_count'),
    budget: money('budget'),
    spent: money('spent'),
    notes: text('notes'),
    ...actorColumns(),
    ...timestamps(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] }), uniqueIndex('crm_camps_code_uq').on(t.tenantId, t.code)],
);

export interface CrmCampaignAudience {
  statuses?: string[];
  sources?: string[];
  campId?: string;
}

export const crmCampaigns = pg.table(
  'campaigns',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    name: text('name').notNull(),
    channel: text('channel').notNull(),
    message: text('message').notNull(),
    audience: jsonb('audience').$type<CrmCampaignAudience>().notNull().default({}),
    status: text('status').notNull().default('draft'),
    recipientCount: integer('recipient_count').notNull().default(0),
    sentAt: ts('sent_at'),
    sentBy: uuid('sent_by'),
    ...actorColumns(),
    ...timestamps(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] })],
);

export const crmLeads = pg.table(
  'leads',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    number: text('number').notNull(),
    facilityId: uuid('facility_id'),
    name: text('name').notNull(),
    mobile: text('mobile'),
    email: text('email'),
    gender: text('gender'),
    ageYears: integer('age_years'),
    city: text('city'),
    source: text('source').notNull().default('walk_in'),
    interest: text('interest'),
    notes: text('notes'),
    status: text('status').notNull().default('new'),
    lostReason: text('lost_reason'),
    assignedTo: uuid('assigned_to'),
    nextFollowUpAt: ts('next_follow_up_at'),
    referrerId: uuid('referrer_id'),
    campId: uuid('camp_id'),
    campaignId: uuid('campaign_id'),
    patientId: uuid('patient_id'),
    convertedAt: ts('converted_at'),
    ...actorColumns(),
    ...timestamps(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    uniqueIndex('crm_leads_number_uq').on(t.tenantId, t.number),
    index('crm_leads_status_idx').on(t.tenantId, t.status, t.createdAt),
  ],
);

export const crmLeadActivities = pg.table(
  'lead_activities',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    leadId: uuid('lead_id').notNull(),
    type: text('type').notNull(),
    note: text('note'),
    fromStatus: text('from_status'),
    toStatus: text('to_status'),
    createdBy: uuid('created_by'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] }), index('crm_lead_activities_lead_idx').on(t.tenantId, t.leadId, t.createdAt)],
);

export const crmCampaignRecipients = pg.table(
  'campaign_recipients',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    campaignId: uuid('campaign_id').notNull(),
    leadId: uuid('lead_id').notNull(),
    status: text('status').notNull(),
    reason: text('reason'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] }), uniqueIndex('crm_campaign_recipients_uq').on(t.tenantId, t.campaignId, t.leadId)],
);

export const crmReferrals = pg.table(
  'referrals',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    patientId: uuid('patient_id').notNull(),
    referrerId: uuid('referrer_id').notNull(),
    referredOn: date('referred_on').notNull().default(sql`current_date`),
    validUntil: date('valid_until'),
    leadId: uuid('lead_id'),
    notes: text('notes'),
    status: text('status').notNull().default('active'),
    ...actorColumns(),
    ...timestamps(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] }), index('crm_referrals_patient_idx').on(t.tenantId, t.patientId, t.referredOn)],
);

export const crmCommissionStatements = pg.table(
  'commission_statements',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    number: text('number').notNull(),
    referrerId: uuid('referrer_id').notNull(),
    periodFrom: date('period_from').notNull(),
    periodTo: date('period_to').notNull(),
    total: money('total').notNull().default('0'),
    status: text('status').notNull().default('draft'),
    approvedBy: uuid('approved_by'),
    approvedAt: ts('approved_at'),
    paidAt: ts('paid_at'),
    paidBy: uuid('paid_by'),
    paymentMode: text('payment_mode'),
    paymentRef: text('payment_ref'),
    notes: text('notes'),
    ...actorColumns(),
    ...timestamps(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] }), uniqueIndex('crm_commission_statements_number_uq').on(t.tenantId, t.number)],
);

export interface CrmCommissionLine {
  description: string;
  serviceCode: string | null;
  amount: number;
  ruleId: string | null;
  rateType: 'percent' | 'flat' | null;
  rate: number;
  commission: number;
}

export const crmCommissions = pg.table(
  'commissions',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    kind: text('kind').notNull(),
    referrerId: uuid('referrer_id').notNull(),
    referralId: uuid('referral_id').notNull(),
    patientId: uuid('patient_id').notNull(),
    invoiceId: uuid('invoice_id').notNull(),
    invoiceNumber: text('invoice_number').notNull(),
    invoiceDate: date('invoice_date').notNull(),
    sourceModule: text('source_module').notNull(),
    baseAmount: money('base_amount').notNull(),
    amount: money('amount').notNull(),
    breakdown: jsonb('breakdown').$type<CrmCommissionLine[]>().notNull().default([]),
    status: text('status').notNull().default('open'),
    statementId: uuid('statement_id'),
    reversesId: uuid('reverses_id'),
    ...timestamps(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] }), uniqueIndex('crm_commissions_invoice_kind_uq').on(t.tenantId, t.invoiceId, t.kind)],
);

export const crmFollowUps = pg.table(
  'follow_ups',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    facilityId: uuid('facility_id'),
    patientId: uuid('patient_id'),
    leadId: uuid('lead_id'),
    dueDate: date('due_date').notNull(),
    type: text('type').notNull().default('revisit'),
    reason: text('reason'),
    source: text('source').notNull().default('manual'),
    sourceRef: text('source_ref'),
    status: text('status').notNull().default('pending'),
    assignedTo: uuid('assigned_to'),
    reminderCount: integer('reminder_count').notNull().default(0),
    lastRemindedAt: ts('last_reminded_at'),
    outcome: text('outcome'),
    completedAt: ts('completed_at'),
    completedBy: uuid('completed_by'),
    ...actorColumns(),
    ...timestamps(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] }), index('crm_follow_ups_due_idx').on(t.tenantId, t.status, t.dueDate)],
);
