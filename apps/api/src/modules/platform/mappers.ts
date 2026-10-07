import {
  iso,
  type platformAnnouncements,
  type platformHelpArticles,
  type platformInvoices,
  type platformPlans,
  type platformSubscriptions,
  type platformTickets,
} from '@hms/db';
import type {
  Announcement,
  BillingCycle,
  HelpArticle,
  PaymentMode,
  Plan,
  Subscription,
  SubscriptionInvoice,
  SubscriptionStatus,
  Ticket,
} from './contracts';

export type PlanRow = typeof platformPlans.$inferSelect;
export type SubscriptionRow = typeof platformSubscriptions.$inferSelect;
export type InvoiceRow = typeof platformInvoices.$inferSelect;
export type TicketRow = typeof platformTickets.$inferSelect;

export const toPlan = (r: PlanRow): Plan => ({
  code: r.code,
  name: r.name,
  description: r.description,
  priceMonthly: r.priceMonthly,
  priceYearly: r.priceYearly,
  currency: r.currency,
  trialDays: r.trialDays,
  modules: r.modules,
  limits: { facilities: r.maxFacilities, users: r.maxUsers, beds: r.maxBeds },
  isPublic: r.isPublic,
  isActive: r.isActive,
  sortOrder: r.sortOrder,
});

export const toSubscription = (r: SubscriptionRow): Subscription => ({
  id: r.id,
  planCode: r.planCode,
  status: r.status as SubscriptionStatus,
  billingCycle: r.billingCycle as BillingCycle,
  price: r.price,
  trialEndsAt: iso(r.trialEndsAt),
  currentPeriodStart: iso(r.currentPeriodStart),
  currentPeriodEnd: iso(r.currentPeriodEnd),
  cancelAtPeriodEnd: r.cancelAtPeriodEnd,
  createdAt: iso(r.createdAt),
});

export const toInvoice = (r: InvoiceRow): SubscriptionInvoice => ({
  id: r.id,
  tenantId: r.tenantId,
  number: r.number,
  planCode: r.planCode,
  billingCycle: r.billingCycle as BillingCycle,
  periodStart: iso(r.periodStart),
  periodEnd: iso(r.periodEnd),
  amount: r.amount,
  taxRate: r.taxRate,
  taxAmount: r.taxAmount,
  total: r.total,
  status: r.status as SubscriptionInvoice['status'],
  dueAt: iso(r.dueAt),
  paidAt: iso(r.paidAt),
  paymentMode: r.paymentMode as PaymentMode | null,
  paymentRef: r.paymentRef,
  createdAt: iso(r.createdAt),
});

export const toTicket = (r: TicketRow, extra: { tenantName?: string; assignedAdminName?: string | null } = {}): Ticket => ({
  id: r.id,
  tenantId: r.tenantId,
  number: r.number,
  subject: r.subject,
  category: r.category as Ticket['category'],
  priority: r.priority as Ticket['priority'],
  status: r.status as Ticket['status'],
  raisedByName: r.raisedByName,
  raisedByUserId: r.raisedByUserId,
  assignedAdminId: r.assignedAdminId,
  lastActivityAt: iso(r.lastActivityAt),
  createdAt: iso(r.createdAt),
  ...extra,
});

export const toAnnouncement = (r: typeof platformAnnouncements.$inferSelect): Announcement => ({
  id: r.id,
  title: r.title,
  body: r.body,
  severity: r.severity as Announcement['severity'],
  planCodes: r.planCodes,
  tenantIds: r.tenantIds,
  startsAt: iso(r.startsAt),
  endsAt: iso(r.endsAt),
  isPublished: r.isPublished,
  createdAt: iso(r.createdAt),
});

export const toHelpArticle = (r: typeof platformHelpArticles.$inferSelect): HelpArticle => ({
  id: r.id,
  slug: r.slug,
  title: r.title,
  moduleKey: r.moduleKey,
  summary: r.summary,
  body: r.body,
  sortOrder: r.sortOrder,
  isPublished: r.isPublished,
  updatedAt: iso(r.updatedAt),
});

/** Money as numeric(14,2) strings; math in paise to avoid float drift. */
export const toPaise = (v: string | number) => Math.round(Number(v) * 100);
export const fromPaise = (p: number) => (p / 100).toFixed(2);
