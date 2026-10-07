/**
 * SaaS Platform tables. Owned by the "platform" workstream (Postgres schema: platform).
 * Global tables (plans, admins, announcements, help) have no tenant_id. Per-hospital tables
 * have tenant RLS plus a `platform_admin` policy for the super-admin console.
 */
import { sql } from 'drizzle-orm';
import { boolean, foreignKey, integer, jsonb, numeric, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { idColumn, platform as pg, tenantIdColumn, timestamps } from './_common';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' });
const uuidPk = () => uuid('id').primaryKey().default(sql`app.uuid_v7()`);

export const platformPlans = pg.table('plans', {
  code: text('code').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  priceMonthly: numeric('price_monthly', { precision: 14, scale: 2 }),
  priceYearly: numeric('price_yearly', { precision: 14, scale: 2 }),
  currency: text('currency').notNull().default('INR'),
  trialDays: integer('trial_days').notNull().default(14),
  modules: text('modules').array().notNull().default(sql`'{}'`),
  maxFacilities: integer('max_facilities'),
  maxUsers: integer('max_users'),
  maxBeds: integer('max_beds'),
  isPublic: boolean('is_public').notNull().default(true),
  isActive: boolean('is_active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  ...timestamps(),
});

export const platformAdmins = pg.table('admins', {
  id: uuidPk(),
  email: text('email').notNull(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  role: text('role').notNull().default('support'),
  status: text('status').notNull().default('active'),
  failedLoginCount: integer('failed_login_count').notNull().default(0),
  lockedUntil: ts('locked_until'),
  lastLoginAt: ts('last_login_at'),
  ...timestamps(),
});

export const platformAdminSessions = pg.table('admin_sessions', {
  id: uuidPk(),
  adminId: uuid('admin_id').notNull().references(() => platformAdmins.id, { onDelete: 'cascade' }),
  expiresAt: ts('expires_at').notNull(),
  revokedAt: ts('revoked_at'),
  createdIp: text('created_ip'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const platformAdminAudit = pg.table('admin_audit', {
  id: uuidPk(),
  adminId: uuid('admin_id'),
  targetTenantId: uuid('target_tenant_id'),
  action: text('action').notNull(),
  details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
  at: ts('at').notNull().defaultNow(),
});

export const platformSubscriptions = pg.table(
  'subscriptions',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    planCode: text('plan_code').notNull(),
    status: text('status').notNull(),
    billingCycle: text('billing_cycle').notNull().default('monthly'),
    price: numeric('price', { precision: 14, scale: 2 }),
    trialEndsAt: ts('trial_ends_at'),
    currentPeriodStart: ts('current_period_start').notNull().defaultNow(),
    currentPeriodEnd: ts('current_period_end'),
    cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
    endedAt: ts('ended_at'),
    ...timestamps(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] }), uniqueIndex('subscriptions_current_uq').on(t.tenantId).where(sql`ended_at is null`)],
);

export const platformInvoices = pg.table(
  'invoices',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    subscriptionId: uuid('subscription_id').notNull(),
    number: text('number').notNull(),
    planCode: text('plan_code').notNull(),
    billingCycle: text('billing_cycle').notNull(),
    periodStart: ts('period_start').notNull(),
    periodEnd: ts('period_end').notNull(),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    taxRate: numeric('tax_rate', { precision: 5, scale: 2 }).notNull().default('18.00'),
    taxAmount: numeric('tax_amount', { precision: 14, scale: 2 }).notNull(),
    total: numeric('total', { precision: 14, scale: 2 }).notNull(),
    status: text('status').notNull().default('issued'),
    dueAt: ts('due_at').notNull(),
    paidAt: ts('paid_at'),
    paymentMode: text('payment_mode'),
    paymentRef: text('payment_ref'),
    ...timestamps(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId, t.subscriptionId], foreignColumns: [platformSubscriptions.tenantId, platformSubscriptions.id] }),
    uniqueIndex('invoices_number_uq').on(t.number),
  ],
);

export const platformEntitlementOverrides = pg.table(
  'entitlement_overrides',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    moduleKey: text('module_key').notNull(),
    enabled: boolean('enabled').notNull(),
    note: text('note'),
    expiresAt: ts('expires_at'),
    createdByAdmin: uuid('created_by_admin'),
    ...timestamps(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] }), uniqueIndex('entitlement_overrides_module_uq').on(t.tenantId, t.moduleKey)],
);

export const platformLimitOverrides = pg.table(
  'limit_overrides',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    limitKey: text('limit_key').notNull(),
    value: integer('value'),
    createdByAdmin: uuid('created_by_admin'),
    ...timestamps(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] }), uniqueIndex('limit_overrides_key_uq').on(t.tenantId, t.limitKey)],
);

export const platformAnnouncements = pg.table('announcements', {
  id: uuidPk(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  severity: text('severity').notNull().default('info'),
  planCodes: text('plan_codes').array().notNull().default(sql`'{}'`),
  tenantIds: uuid('tenant_ids').array().notNull().default(sql`'{}'`),
  startsAt: ts('starts_at').notNull().defaultNow(),
  endsAt: ts('ends_at'),
  isPublished: boolean('is_published').notNull().default(true),
  createdBy: uuid('created_by'),
  ...timestamps(),
});

export const platformAnnouncementDismissals = pg.table(
  'announcement_dismissals',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    announcementId: uuid('announcement_id').notNull(),
    userId: uuid('user_id').notNull(),
    dismissedAt: ts('dismissed_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] }), uniqueIndex('announcement_dismissals_uq').on(t.tenantId, t.announcementId, t.userId)],
);

export const platformHelpArticles = pg.table('help_articles', {
  id: uuidPk(),
  slug: text('slug').notNull(),
  title: text('title').notNull(),
  moduleKey: text('module_key'),
  summary: text('summary').notNull().default(''),
  body: text('body').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  isPublished: boolean('is_published').notNull().default(true),
  ...timestamps(),
});

export const platformTickets = pg.table(
  'tickets',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    number: text('number').notNull(),
    subject: text('subject').notNull(),
    category: text('category').notNull().default('technical'),
    priority: text('priority').notNull().default('normal'),
    status: text('status').notNull().default('open'),
    raisedByUserId: uuid('raised_by_user_id').notNull(),
    raisedByName: text('raised_by_name').notNull(),
    assignedAdminId: uuid('assigned_admin_id'),
    lastActivityAt: ts('last_activity_at').notNull().defaultNow(),
    resolvedAt: ts('resolved_at'),
    ...timestamps(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] }), uniqueIndex('tickets_number_uq').on(t.number)],
);

export const platformTicketMessages = pg.table(
  'ticket_messages',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    ticketId: uuid('ticket_id').notNull(),
    authorType: text('author_type').notNull(),
    authorId: uuid('author_id').notNull(),
    authorName: text('author_name').notNull(),
    body: text('body').notNull(),
    isInternal: boolean('is_internal').notNull().default(false),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId, t.ticketId], foreignColumns: [platformTickets.tenantId, platformTickets.id] }).onDelete('cascade'),
  ],
);

export const platformOnboardingSteps = pg.table(
  'onboarding_steps',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    stepKey: text('step_key').notNull(),
    completedAt: ts('completed_at').notNull().defaultNow(),
    completedBy: uuid('completed_by'),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] }), uniqueIndex('onboarding_steps_uq').on(t.tenantId, t.stepKey)],
);
