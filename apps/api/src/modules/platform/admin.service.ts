import { Injectable } from '@nestjs/common';
import {
  and,
  count,
  desc,
  eq,
  hashPassword,
  iso,
  platformAdminAudit,
  platformAdmins,
  platformAnnouncements,
  platformEntitlementOverrides,
  platformHelpArticles,
  platformInvoices,
  platformLimitOverrides,
  platformPlans,
  sql,
  tenants,

} from '@hms/db';
import {
  TENANT_STATUSES,
  type AdminAuditEntry,
  type AdminCreateTenant,
  type AdminSetEntitlements,
  type AdminSetSubscription,
  type AdminSetTenantStatus,
  type Announcement,
  type BillingCycle,
  type CreatePlatformAdmin,
  type HelpArticle,
  type LimitKey,
  type MarkInvoicePaid,
  type Paginated,
  type Plan,
  type PlatformAdmin,
  type PlatformDashboard,
  type SignupResult,
  type SubscriptionInvoice,
  type SubscriptionStatus,
  type TenantDetail,
  type TenantStatus,
  type TenantSummary,
  type UpdatePlatformAdmin,
  type UpdatePlan,
  type UpsertAnnouncement,
  type UpsertHelpArticle,
  type UpsertPlan,
  type UpdateAnnouncement,
  type UpdateHelpArticle,
} from './contracts';
import { badRequest, conflict, notFound } from '../../common/errors/errors';
import { OutboxService } from '../../common/events/outbox.service';
import { AdminAuthService, toAdmin } from './admin-auth.service';
import { ContentService } from './content.service';
import { EntitlementsService } from './entitlements.service';
import { toAnnouncement, toHelpArticle, toInvoice, toPlan } from './mappers';
import type { PlatformPrincipal } from './platform-admin.guard';
import { PlatformDb } from './platform-db';
import { SignupService } from './signup.service';
import { SubscriptionsService } from './subscriptions.service';
import { TicketsService } from './tickets.service';

type Raw = Record<string, unknown>;
const isoOrNull = (v: unknown) => (v === null || v === undefined ? null : new Date(v as string).toISOString());

/** Super-admin console: hospitals, plans, overrides, invoices, announcements, help, platform users. */
@Injectable()
export class AdminService {
  constructor(
    private readonly db: PlatformDb,
    private readonly ent: EntitlementsService,
    private readonly subs: SubscriptionsService,
    private readonly signup: SignupService,
    private readonly tickets: TicketsService,
    private readonly content: ContentService,
    private readonly auth: AdminAuthService,
    private readonly outbox: OutboxService,
  ) {}

  private async audit(admin: PlatformPrincipal, action: string, targetTenantId: string | null, details: Record<string, unknown> = {}) {
    await this.db.global.insert(platformAdminAudit).values({ adminId: admin.id, targetTenantId, action, details });
  }

  // ---------- dashboard ----------

  async dashboard(): Promise<PlatformDashboard> {
    const data = await this.db.crossTenant(async (tx) => {
      const byStatus = await tx.execute<{ status: TenantStatus; n: number }>(sql`select status, count(*)::int as n from platform.tenants group by status`);
      const byPlan = await tx.execute<{ plan: string; n: number }>(sql`select plan, count(*)::int as n from platform.tenants where status <> 'closed' group by plan`);
      const misc = await tx.execute<{ trials: number; mrr: string; unpaid_n: number; unpaid_total: string; signups: number }>(sql`
        select (select count(*)::int from platform.subscriptions
                 where ended_at is null and status = 'trial' and trial_ends_at <= now() + interval '7 days') as trials,
               (select coalesce(sum(case s.billing_cycle when 'yearly' then coalesce(s.price, p.price_yearly) / 12
                                                          else coalesce(s.price, p.price_monthly) end), 0)::numeric(14,2)::text
                  from platform.subscriptions s join platform.plans p on p.code = s.plan_code
                 where s.ended_at is null and s.status = 'active') as mrr,
               (select count(*)::int from platform.invoices where status = 'issued') as unpaid_n,
               (select coalesce(sum(total), 0)::numeric(14,2)::text from platform.invoices where status = 'issued') as unpaid_total,
               (select count(*)::int from platform.tenants where created_at > now() - interval '30 days') as signups`);
      return { byStatus: byStatus.rows, byPlan: byPlan.rows, misc: misc.rows[0]! };
    });
    const tenantsByStatus = Object.fromEntries(TENANT_STATUSES.map((s) => [s, 0])) as Record<TenantStatus, number>;
    for (const r of data.byStatus) tenantsByStatus[r.status] = r.n;
    return {
      tenantsByStatus,
      tenantsByPlan: Object.fromEntries(data.byPlan.map((r) => [r.plan, r.n])),
      trialsEndingIn7Days: data.misc.trials,
      mrr: data.misc.mrr,
      openTickets: await this.tickets.countOpen(),
      unpaidInvoices: { count: data.misc.unpaid_n, total: data.misc.unpaid_total },
      signupsLast30Days: data.misc.signups,
    };
  }

  // ---------- hospitals ----------

  async listTenants(q: { q?: string; status?: TenantStatus; plan?: string; page: number; pageSize: number }): Promise<Paginated<TenantSummary>> {
    const term = q.q?.toLowerCase();
    return this.db.crossTenant(async (tx) => {
      const where = sql`true
        ${term ? sql`and (lower(t.name) like ${'%' + term + '%'} or t.code like ${'%' + term + '%'})` : sql``}
        ${q.status ? sql`and t.status = ${q.status}` : sql``}
        ${q.plan ? sql`and t.plan = ${q.plan}` : sql``}`;
      const rows = await tx.execute<Raw>(sql`
        select t.id, t.code, t.name, t.status, t.plan, t.created_at,
               s.status as sub_status, s.trial_ends_at, s.current_period_end
          from platform.tenants t
          left join platform.subscriptions s on s.tenant_id = t.id and s.ended_at is null
         where ${where}
         order by t.created_at desc
         limit ${q.pageSize} offset ${(q.page - 1) * q.pageSize}`);
      const total = await tx.execute<{ n: number }>(sql`select count(*)::int as n from platform.tenants t where ${where}`);
      return { items: rows.rows.map(toSummary), page: q.page, pageSize: q.pageSize, total: total.rows[0]!.n };
    });
  }

  async tenantDetail(tenantId: string): Promise<TenantDetail> {
    const summary = await this.db.crossTenant(async (tx) => {
      const rows = await tx.execute<Raw>(sql`
        select t.id, t.code, t.name, t.status, t.plan, t.created_at,
               s.status as sub_status, s.trial_ends_at, s.current_period_end
          from platform.tenants t
          left join platform.subscriptions s on s.tenant_id = t.id and s.ended_at is null
         where t.id = ${tenantId}::uuid`);
      return rows.rows[0];
    });
    if (!summary) throw notFound('Hospital');
    return this.db.tenant(tenantId, async (tx) => {
      const overview = await this.subs.overviewIn(tx, tenantId);
      const overrides = await tx.select().from(platformEntitlementOverrides).where(eq(platformEntitlementOverrides.tenantId, tenantId));
      const limits = await tx.select().from(platformLimitOverrides).where(eq(platformLimitOverrides.tenantId, tenantId));
      const patients = await tx.execute<{ n: number }>(sql`select count(*)::int as n from clinical.patients`);
      return {
        ...toSummary(summary),
        subscription: overview.subscription,
        entitlements: overview.entitlements,
        overrides: overrides.map((o) => ({ moduleKey: o.moduleKey, enabled: o.enabled, note: o.note, expiresAt: iso(o.expiresAt) })),
        limitOverrides: Object.fromEntries(limits.map((l) => [l.limitKey, l.value])),
        usage: { ...overview.usage, patients: patients.rows[0]!.n },
        invoices: overview.invoices,
        onboarding: await this.content.onboardingIn(tx, tenantId),
        tickets: await this.tickets.recentForTenant(tx, tenantId),
      };
    });
  }

  async createTenant(admin: PlatformPrincipal, input: AdminCreateTenant & { facilityType: 'hospital' | 'clinic' | 'diagnostic_centre' | 'pharmacy'; planCode: string; startActive: boolean }): Promise<SignupResult> {
    const { adminUserId: _ignored, ...result } = await this.signup.create({ ...input, source: 'console' });
    await this.audit(admin, 'tenant.created', result.tenantId, { code: result.code, plan: result.planCode, startActive: input.startActive });
    return result;
  }

  async updateTenant(admin: PlatformPrincipal, tenantId: string, patch: { name?: string }): Promise<TenantDetail> {
    if (patch.name) {
      const res = await this.db.global.update(tenants).set({ name: patch.name }).where(eq(tenants.id, tenantId)).returning({ id: tenants.id });
      if (!res.length) throw notFound('Hospital');
      await this.audit(admin, 'tenant.updated', tenantId, patch);
    }
    return this.tenantDetail(tenantId);
  }

  /** Manual suspend / reactivate / close. A manual suspension is not lifted by a payment. */
  async setTenantStatus(admin: PlatformPrincipal, tenantId: string, input: AdminSetTenantStatus & { status: 'active' | 'suspended' | 'closed' }): Promise<TenantDetail> {
    const suspension = input.status === 'active' ? null : { by: 'admin', adminId: admin.id, reason: input.reason, at: new Date().toISOString() };
    const res = await this.db.global.execute(sql`
      update platform.tenants
         set status = ${input.status},
             settings = case when ${suspension === null} then settings - 'suspension'
                             else settings || jsonb_build_object('suspension', ${JSON.stringify(suspension)}::jsonb) end
       where id = ${tenantId}::uuid returning id`);
    if (!res.rows.length) throw notFound('Hospital');
    if (input.status !== 'active') {
      // Sign everyone out of the hospital straight away.
      await this.db.tenant(tenantId, (tx) => tx.execute(sql`update iam.refresh_tokens set revoked_at = now() where revoked_at is null`));
    }
    this.ent.invalidate(tenantId);
    await this.audit(admin, `tenant.${input.status}`, tenantId, { reason: input.reason });
    return this.tenantDetail(tenantId);
  }

  /** Change plan, custom price, extend a trial, or activate under contract. */
  async setSubscription(admin: PlatformPrincipal, tenantId: string, input: AdminSetSubscription & { billingCycle: BillingCycle; activateNow: boolean }): Promise<TenantDetail> {
    await this.db.tenant(tenantId, async (tx) => {
      const plan = await this.subs.getPlanByCode(tx, input.planCode);
      if (!plan.isActive) throw badRequest('plan_unavailable', 'This plan is not active');
      const current = await this.ent.currentSubscription(tx, tenantId, true);
      if (current) await this.subs.endSubscription(tx, tenantId, current.id, 'cancelled');
      let status: SubscriptionStatus;
      let trialEndsAt: string | null = null;
      if (input.activateNow) status = 'active';
      else if (input.trialEndsAt) {
        if (new Date(input.trialEndsAt) <= new Date()) throw badRequest('invalid_trial_end', 'Trial end must be in the future');
        status = 'trial';
        trialEndsAt = input.trialEndsAt;
      } else if (current?.status === 'trial') {
        status = 'trial';
        trialEndsAt = current.trialEndsAt;
      } else status = 'active';
      const sub = await this.subs.insertSubscription(tx, tenantId, {
        planCode: input.planCode,
        billingCycle: input.billingCycle,
        price: input.price == null ? null : String(input.price),
        status,
        trialEndsAt,
        periodEnd: status === 'active' ? 'cycle' : null,
      });
      // Without activateNow, a paid period still needs an invoice.
      if (status === 'active' && !input.activateNow) await this.subs.issueInvoice(tx, tenantId, sub, { periodStart: sub.currentPeriodStart });
      await tx.update(tenants).set({ plan: input.planCode }).where(eq(tenants.id, tenantId));
      await this.subs.setBillingStatus(tx, tenantId, status === 'trial' ? 'trial' : 'active');
      await this.outbox.publish(tx, 'platform.subscription.changed', { subscriptionId: sub.id, planCode: sub.planCode, status }, tenantId);
    });
    this.ent.invalidate(tenantId);
    await this.audit(admin, 'subscription.set', tenantId, { ...input });
    return this.tenantDetail(tenantId);
  }

  async setEntitlements(admin: PlatformPrincipal, tenantId: string, input: AdminSetEntitlements & { modules: Partial<Record<string, boolean | null>>; limits: Partial<Record<LimitKey, number | null>> }): Promise<TenantDetail> {
    await this.db.tenant(tenantId, async (tx) => {
      for (const [moduleKey, enabled] of Object.entries(input.modules)) {
        if (enabled === null || enabled === undefined) {
          await tx.delete(platformEntitlementOverrides).where(and(eq(platformEntitlementOverrides.tenantId, tenantId), eq(platformEntitlementOverrides.moduleKey, moduleKey)));
        } else {
          await tx
            .insert(platformEntitlementOverrides)
            .values({ tenantId, moduleKey, enabled, note: input.note ?? null, createdByAdmin: admin.id })
            .onConflictDoUpdate({
              target: [platformEntitlementOverrides.tenantId, platformEntitlementOverrides.moduleKey],
              set: { enabled, note: input.note ?? null, createdByAdmin: admin.id },
            });
        }
      }
      for (const [limitKey, value] of Object.entries(input.limits)) {
        if (value === null || value === undefined) {
          await tx.delete(platformLimitOverrides).where(and(eq(platformLimitOverrides.tenantId, tenantId), eq(platformLimitOverrides.limitKey, limitKey)));
        } else {
          const v = value === -1 ? null : value;
          await tx
            .insert(platformLimitOverrides)
            .values({ tenantId, limitKey, value: v, createdByAdmin: admin.id })
            .onConflictDoUpdate({ target: [platformLimitOverrides.tenantId, platformLimitOverrides.limitKey], set: { value: v, createdByAdmin: admin.id } });
        }
      }
    });
    this.ent.invalidate(tenantId);
    await this.audit(admin, 'entitlements.set', tenantId, { ...input });
    return this.tenantDetail(tenantId);
  }

  // ---------- plans ----------

  async createPlan(admin: PlatformPrincipal, p: UpsertPlan & { code: string }): Promise<Plan> {
    const values = planColumns(p);
    const [row] = await this.db.global
      .insert(platformPlans)
      .values({ code: p.code, name: p.name, ...values })
      .onConflictDoNothing()
      .returning();
    if (!row) throw conflict('plan_exists', 'A plan with this code already exists');
    await this.audit(admin, 'plan.created', null, { code: p.code });
    return toPlan(row);
  }

  async updatePlan(admin: PlatformPrincipal, code: string, p: UpdatePlan): Promise<Plan> {
    if (p.modules && p.modules.length === 0) throw badRequest('modules_required', 'A plan must include at least one module');
    const [row] = await this.db.global.update(platformPlans).set(planColumns(p)).where(eq(platformPlans.code, code)).returning();
    if (!row) throw notFound('Plan');
    this.ent.invalidate();
    await this.audit(admin, 'plan.updated', null, { code, ...p });
    return toPlan(row);
  }

  // ---------- invoices ----------

  async listInvoices(q: { status?: SubscriptionInvoice['status']; tenantId?: string; page: number; pageSize: number }): Promise<Paginated<SubscriptionInvoice & { tenantName: string }>> {
    return this.db.crossTenant(async (tx) => {
      const where = and(q.status ? eq(platformInvoices.status, q.status) : undefined, q.tenantId ? eq(platformInvoices.tenantId, q.tenantId) : undefined);
      const rows = await tx
        .select({ inv: platformInvoices, tenantName: tenants.name })
        .from(platformInvoices)
        .innerJoin(tenants, eq(tenants.id, platformInvoices.tenantId))
        .where(where)
        .orderBy(desc(platformInvoices.createdAt))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize);
      const [{ total }] = await tx.select({ total: count() }).from(platformInvoices).where(where);
      return { items: rows.map((r) => ({ ...toInvoice(r.inv), tenantName: r.tenantName })), page: q.page, pageSize: q.pageSize, total };
    });
  }

  async markInvoicePaid(admin: PlatformPrincipal, invoiceId: string, input: MarkInvoicePaid & { mode: Exclude<SubscriptionInvoice['paymentMode'], null | 'sandbox'> }): Promise<SubscriptionInvoice> {
    const tenantId = await this.invoiceTenant(invoiceId);
    const row = await this.db.tenant(tenantId, (tx) => this.subs.markPaid(tx, tenantId, invoiceId, input.mode, input.ref ?? null));
    this.ent.invalidate(tenantId);
    await this.audit(admin, 'invoice.paid', tenantId, { invoiceId, mode: input.mode, ref: input.ref });
    return toInvoice(row);
  }

  async voidInvoice(admin: PlatformPrincipal, invoiceId: string): Promise<SubscriptionInvoice> {
    const tenantId = await this.invoiceTenant(invoiceId);
    const row = await this.db.tenant(tenantId, async (tx) => {
      const [r] = await tx
        .update(platformInvoices)
        .set({ status: 'void' })
        .where(and(eq(platformInvoices.tenantId, tenantId), eq(platformInvoices.id, invoiceId), eq(platformInvoices.status, 'issued')))
        .returning();
      if (!r) throw conflict('invoice_not_open', 'Only unpaid invoices can be voided');
      return r;
    });
    await this.audit(admin, 'invoice.voided', tenantId, { invoiceId });
    return toInvoice(row);
  }

  private async invoiceTenant(invoiceId: string): Promise<string> {
    const tenantId = await this.db.crossTenant(async (tx) => {
      const [r] = await tx.select({ t: platformInvoices.tenantId }).from(platformInvoices).where(eq(platformInvoices.id, invoiceId)).limit(1);
      return r?.t;
    });
    if (!tenantId) throw notFound('Invoice');
    return tenantId;
  }

  // ---------- announcements ----------

  async listAnnouncements(): Promise<Announcement[]> {
    const rows = await this.db.global.select().from(platformAnnouncements).orderBy(desc(platformAnnouncements.createdAt)).limit(200);
    return rows.map(toAnnouncement);
  }

  async createAnnouncement(admin: PlatformPrincipal, a: UpsertAnnouncement): Promise<Announcement> {
    await this.checkAnnouncement(a, new Date().toISOString());
    const [row] = await this.db.global
      .insert(platformAnnouncements)
      .values({ ...announcementColumns(a), title: a.title, body: a.body, createdBy: admin.id })
      .returning();
    await this.audit(admin, 'announcement.created', null, { id: row!.id, title: a.title });
    return toAnnouncement(row!);
  }

  async updateAnnouncement(admin: PlatformPrincipal, id: string, a: UpdateAnnouncement): Promise<Announcement> {
    const [current] = await this.db.global.select().from(platformAnnouncements).where(eq(platformAnnouncements.id, id)).limit(1);
    if (!current) throw notFound('Announcement');
    await this.checkAnnouncement(
      { ...a, endsAt: a.endsAt === undefined ? (current.endsAt ? iso(current.endsAt) : null) : a.endsAt },
      a.startsAt ?? iso(current.startsAt),
    );
    const [row] = await this.db.global.update(platformAnnouncements).set(announcementColumns(a)).where(eq(platformAnnouncements.id, id)).returning();
    if (!row) throw notFound('Announcement');
    await this.audit(admin, 'announcement.updated', null, { id });
    return toAnnouncement(row);
  }

  /** The end must come after the start, and targeted plans must exist. */
  private async checkAnnouncement(a: UpdateAnnouncement, startsAt: string) {
    const start = a.startsAt ?? startsAt;
    if (a.endsAt && new Date(a.endsAt).getTime() <= new Date(start).getTime()) {
      throw badRequest('invalid_dates', 'The end date must be after the start date');
    }
    if (a.planCodes?.length) {
      const known = new Set((await this.db.global.select({ code: platformPlans.code }).from(platformPlans)).map((r) => r.code));
      const unknown = a.planCodes.filter((c) => !known.has(c));
      if (unknown.length) throw badRequest('unknown_plan', `Unknown plan: ${unknown.join(', ')}`);
    }
  }

  // ---------- help ----------

  async listHelp(): Promise<HelpArticle[]> {
    const rows = await this.db.global.select().from(platformHelpArticles).orderBy(platformHelpArticles.sortOrder, platformHelpArticles.title);
    return rows.map(toHelpArticle);
  }

  async createHelp(admin: PlatformPrincipal, h: UpsertHelpArticle & { slug: string; title: string; body: string }): Promise<HelpArticle> {
    const [row] = await this.db.global.insert(platformHelpArticles).values(h).onConflictDoNothing().returning();
    if (!row) throw conflict('slug_taken', 'An article with this slug already exists');
    await this.audit(admin, 'help.created', null, { slug: h.slug });
    return toHelpArticle(row);
  }

  async updateHelp(admin: PlatformPrincipal, id: string, h: UpdateHelpArticle): Promise<HelpArticle> {
    if (h.slug) {
      const [taken] = await this.db.global
        .select({ id: platformHelpArticles.id })
        .from(platformHelpArticles)
        .where(and(eq(platformHelpArticles.slug, h.slug), sql`${platformHelpArticles.id} <> ${id}`))
        .limit(1);
      if (taken) throw conflict('slug_taken', 'An article with this slug already exists');
    }
    const [row] = await this.db.global.update(platformHelpArticles).set(h).where(eq(platformHelpArticles.id, id)).returning();
    if (!row) throw notFound('Help article');
    await this.audit(admin, 'help.updated', null, { id });
    return toHelpArticle(row);
  }

  // ---------- platform admins ----------

  async listAdmins(): Promise<PlatformAdmin[]> {
    const rows = await this.db.global.select().from(platformAdmins).orderBy(platformAdmins.name);
    return rows.map(toAdmin);
  }

  async createAdmin(admin: PlatformPrincipal, a: CreatePlatformAdmin & { email: string; role: PlatformAdmin['role'] }): Promise<PlatformAdmin> {
    const [row] = await this.db.global
      .insert(platformAdmins)
      .values({ email: a.email, name: a.name, role: a.role, passwordHash: await hashPassword(a.password) })
      .onConflictDoNothing()
      .returning();
    if (!row) throw conflict('email_taken', 'A platform user with this email already exists');
    await this.audit(admin, 'admin.created', null, { id: row.id, email: a.email, role: a.role });
    return toAdmin(row);
  }

  async updateAdmin(admin: PlatformPrincipal, id: string, a: UpdatePlatformAdmin): Promise<PlatformAdmin> {
    if (id === admin.id && (a.status === 'disabled' || (a.role && a.role !== 'super_admin'))) {
      throw badRequest('self_lockout', 'You cannot disable yourself or remove your own super admin role');
    }
    const [row] = await this.db.global
      .update(platformAdmins)
      .set({
        ...(a.name ? { name: a.name } : {}),
        ...(a.role ? { role: a.role } : {}),
        ...(a.status ? { status: a.status } : {}),
        ...(a.password ? { passwordHash: await hashPassword(a.password), failedLoginCount: 0, lockedUntil: null } : {}),
      })
      .where(eq(platformAdmins.id, id))
      .returning();
    if (!row) throw notFound('Platform user');
    if (a.status === 'disabled' || a.password || a.role) await this.auth.revokeAll(id);
    const { password: _pw, ...logged } = a;
    await this.audit(admin, 'admin.updated', null, { id, ...logged, passwordChanged: !!a.password });
    return toAdmin(row);
  }

  // ---------- audit and jobs ----------

  async auditLog(tenantId: string | undefined, page: number, pageSize: number): Promise<Paginated<AdminAuditEntry>> {
    const where = tenantId ? eq(platformAdminAudit.targetTenantId, tenantId) : undefined;
    const rows = await this.db.global
      .select({ a: platformAdminAudit, adminName: platformAdmins.name })
      .from(platformAdminAudit)
      .leftJoin(platformAdmins, eq(platformAdmins.id, platformAdminAudit.adminId))
      .where(where)
      .orderBy(desc(platformAdminAudit.at))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const [{ total }] = await this.db.global.select({ total: count() }).from(platformAdminAudit).where(where);
    return {
      items: rows.map((r) => ({
        id: r.a.id,
        adminId: r.a.adminId,
        adminName: r.adminName,
        targetTenantId: r.a.targetTenantId,
        action: r.a.action,
        details: r.a.details,
        at: iso(r.a.at),
      })),
      page,
      pageSize,
      total,
    };
  }

  async runLifecycle(admin: PlatformPrincipal) {
    const result = await this.subs.runLifecycle();
    await this.audit(admin, 'lifecycle.run', null, { ...result });
    return result;
  }
}

function toSummary(r: Raw): TenantSummary {
  return {
    id: r.id as string,
    code: r.code as string,
    name: r.name as string,
    status: r.status as TenantStatus,
    planCode: r.plan as string,
    subscriptionStatus: (r.sub_status as SubscriptionStatus | null) ?? null,
    trialEndsAt: isoOrNull(r.trial_ends_at),
    currentPeriodEnd: isoOrNull(r.current_period_end),
    createdAt: isoOrNull(r.created_at)!,
  };
}

function planColumns(p: UpdatePlan) {
  return {
    ...(p.name !== undefined ? { name: p.name } : {}),
    ...(p.description !== undefined ? { description: p.description } : {}),
    ...(p.priceMonthly !== undefined ? { priceMonthly: p.priceMonthly === null ? null : String(p.priceMonthly) } : {}),
    ...(p.priceYearly !== undefined ? { priceYearly: p.priceYearly === null ? null : String(p.priceYearly) } : {}),
    ...(p.trialDays !== undefined ? { trialDays: p.trialDays } : {}),
    ...(p.modules !== undefined ? { modules: p.modules } : {}),
    ...(p.limits?.facilities !== undefined ? { maxFacilities: p.limits.facilities } : {}),
    ...(p.limits?.users !== undefined ? { maxUsers: p.limits.users } : {}),
    ...(p.limits?.beds !== undefined ? { maxBeds: p.limits.beds } : {}),
    ...(p.isPublic !== undefined ? { isPublic: p.isPublic } : {}),
    ...(p.isActive !== undefined ? { isActive: p.isActive } : {}),
    ...(p.sortOrder !== undefined ? { sortOrder: p.sortOrder } : {}),
  };
}

function announcementColumns(a: UpdateAnnouncement) {
  return {
    ...(a.title !== undefined ? { title: a.title } : {}),
    ...(a.body !== undefined ? { body: a.body } : {}),
    ...(a.severity !== undefined ? { severity: a.severity } : {}),
    ...(a.planCodes !== undefined ? { planCodes: a.planCodes } : {}),
    ...(a.tenantIds !== undefined ? { tenantIds: a.tenantIds } : {}),
    ...(a.startsAt !== undefined ? { startsAt: a.startsAt } : {}),
    ...(a.endsAt !== undefined ? { endsAt: a.endsAt } : {}),
    ...(a.isPublished !== undefined ? { isPublished: a.isPublished } : {}),
  };
}

