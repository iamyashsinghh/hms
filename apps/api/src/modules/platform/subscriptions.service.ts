import { HttpStatus, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown, Inject } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import {
  and,
  desc,
  eq,
  platformInvoices,
  platformPlans,
  platformSubscriptions,
  sql,
  tenants,
  type Tx,
} from '@hms/db';
import type {
  BillingCycle,
  LifecycleRunResult,
  Plan,
  PaymentMode,
  Subscription,
  SubscriptionInvoice,
  SubscriptionOverview,
  SubscriptionStatus,
  TenantStatus,
} from './contracts';
import { APP_CONFIG, type AppConfig } from '../../config';
import { currentContext } from '../../common/context/request-context';
import { AppError, badRequest, conflict, notFound } from '../../common/errors/errors';
import { OutboxService } from '../../common/events/outbox.service';
import { EntitlementsService } from './entitlements.service';
import { fromPaise, toInvoice, toPaise, toPlan, toSubscription } from './mappers';
import { PlatformDb } from './platform-db';

export const GRACE_DAYS = 7;
const TAX_RATE = 18;
const LIFECYCLE_EVERY_MS = 60 * 60_000;

const cycleInterval = (c: BillingCycle) => (c === 'yearly' ? '1 year' : '1 month');
const contactSales = () =>
  new AppError(HttpStatus.UNPROCESSABLE_ENTITY, 'contact_sales', 'This plan has custom pricing. Our team will contact you to set it up.');

/**
 * Plans, subscriptions, subscription invoices (sandbox payments only) and the billing lifecycle:
 * trial → (pay) active → period ends → renewal invoice → past_due + hospital in grace → suspended after 7 days.
 */
@Injectable()
export class SubscriptionsService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('PlatformLifecycle');
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly db: PlatformDb,
    private readonly ent: EntitlementsService,
    private readonly outbox: OutboxService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onApplicationBootstrap() {
    if (this.config.NODE_ENV === 'test') return;
    const run = () => this.runLifecycle().catch((e) => this.logger.error(e, 'lifecycle run failed'));
    this.timer = setInterval(run, LIFECYCLE_EVERY_MS);
    this.timer.unref();
    setTimeout(run, 10_000).unref();
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  // ---------- plans ----------

  async listPlans(opts: { includeHidden?: boolean } = {}): Promise<Plan[]> {
    const rows = await this.db.global
      .select()
      .from(platformPlans)
      .where(opts.includeHidden ? undefined : and(eq(platformPlans.isPublic, true), eq(platformPlans.isActive, true)))
      .orderBy(platformPlans.sortOrder, platformPlans.code);
    return rows.map(toPlan);
  }

  async getPlanByCode(tx: Tx, code: string): Promise<Plan> {
    const [row] = await tx.select().from(platformPlans).where(eq(platformPlans.code, code)).limit(1);
    if (!row) throw notFound('Plan');
    return toPlan(row);
  }

  /** Contract: PlatformService.getPlan(tenantId). */
  async getPlan(tenantId: string): Promise<{ plan: Plan; subscription: Subscription | null; tenantStatus: TenantStatus }> {
    return this.db.tenant(tenantId, async (tx) => {
      const { tenant, plan } = await this.ent.tenantAndPlan(tx, tenantId);
      return { plan, subscription: await this.ent.currentSubscription(tx, tenantId), tenantStatus: tenant.status as TenantStatus };
    });
  }

  // ---------- hospital side ----------

  overview(): Promise<SubscriptionOverview> {
    const tenantId = currentContext()!.tenantId!;
    return this.db.tenant(tenantId, (tx) => this.overviewIn(tx, tenantId));
  }

  async overviewIn(tx: Tx, tenantId: string): Promise<SubscriptionOverview> {
    const { tenant, plan } = await this.ent.tenantAndPlan(tx, tenantId);
    const subscription = await this.ent.currentSubscription(tx, tenantId);
    const invoices = await tx
      .select()
      .from(platformInvoices)
      .where(eq(platformInvoices.tenantId, tenantId))
      .orderBy(desc(platformInvoices.createdAt))
      .limit(24);
    const trialDaysLeft =
      subscription?.status === 'trial' && subscription.trialEndsAt
        ? Math.max(0, Math.ceil((new Date(subscription.trialEndsAt).getTime() - Date.now()) / 86_400_000))
        : null;
    return {
      tenant: { id: tenant.id, code: tenant.code, name: tenant.name, status: tenant.status as TenantStatus },
      plan,
      subscription,
      entitlements: await this.ent.load(tx, tenantId),
      usage: await this.ent.usage(tx),
      invoices: invoices.map(toInvoice),
      trialDaysLeft,
    };
  }

  /** Hospital switches plan or billing cycle. Trials stay trials; paid plans get a fresh period and invoice. */
  async changePlan(planCode: string, billingCycle: BillingCycle): Promise<SubscriptionOverview> {
    const tenantId = currentContext()!.tenantId!;
    const result = await this.db.tenant(tenantId, async (tx) => {
      const plan = await this.getPlanByCode(tx, planCode);
      if (!plan.isActive || !plan.isPublic) throw badRequest('plan_unavailable', 'This plan is not available');
      if (priceFor(plan, billingCycle) === null) throw contactSales();
      const current = await this.ent.currentSubscription(tx, tenantId, true);
      if (current && current.planCode === planCode && current.billingCycle === billingCycle) {
        throw conflict('no_change', 'You are already on this plan');
      }
      const onTrial = !current || current.status === 'trial';
      if (current) await this.endSubscription(tx, tenantId, current.id, 'cancelled');
      const sub = await this.insertSubscription(tx, tenantId, {
        planCode,
        billingCycle,
        price: null,
        status: onTrial ? 'trial' : 'active',
        trialEndsAt: onTrial ? (current?.trialEndsAt ?? null) : null,
        periodEnd: onTrial ? null : 'cycle',
      });
      if (!onTrial) await this.issueInvoice(tx, tenantId, sub, { periodStart: sub.currentPeriodStart });
      await tx.update(tenants).set({ plan: planCode }).where(eq(tenants.id, tenantId));
      await this.outbox.publish(tx, 'platform.subscription.changed', { subscriptionId: sub.id, planCode, status: sub.status }, tenantId);
      return this.overviewIn(tx, tenantId);
    });
    this.ent.invalidate(tenantId);
    return result;
  }

  /** Returns the open invoice for the current plan, issuing one if needed (trial → first paid period starts at trial end). */
  checkout(): Promise<SubscriptionInvoice> {
    const tenantId = currentContext()!.tenantId!;
    return this.db.tenant(tenantId, async (tx) => {
      const sub = await this.ent.currentSubscription(tx, tenantId, true);
      if (!sub) throw badRequest('no_subscription', 'There is no subscription to pay for');
      const open = await this.openInvoices(tx, tenantId, sub.id);
      if (open[0]) return toInvoice(open[0]);
      const start =
        sub.status === 'trial'
          ? latest(new Date().toISOString(), sub.trialEndsAt)
          : sub.status === 'active' && sub.currentPeriodEnd
            ? sub.currentPeriodEnd
            : new Date().toISOString();
      return toInvoice(await this.issueInvoice(tx, tenantId, sub, { periodStart: start }));
    });
  }

  /** Sandbox gateway: marks the invoice paid immediately. Real gateways (Razorpay etc.) are not wired yet. */
  async payInvoice(invoiceId: string): Promise<SubscriptionOverview> {
    const tenantId = currentContext()!.tenantId!;
    const result = await this.db.tenant(tenantId, async (tx) => {
      const ref = `SBX-${randomBytes(6).toString('hex').toUpperCase()}`;
      await this.markPaid(tx, tenantId, invoiceId, 'sandbox', ref);
      return this.overviewIn(tx, tenantId);
    });
    this.ent.invalidate(tenantId);
    return result;
  }

  async setCancelAtPeriodEnd(cancel: boolean): Promise<SubscriptionOverview> {
    const tenantId = currentContext()!.tenantId!;
    return this.db.tenant(tenantId, async (tx) => {
      const sub = await this.ent.currentSubscription(tx, tenantId, true);
      if (!sub) throw badRequest('no_subscription', 'There is no subscription');
      await tx
        .update(platformSubscriptions)
        .set({ cancelAtPeriodEnd: cancel })
        .where(and(eq(platformSubscriptions.tenantId, tenantId), eq(platformSubscriptions.id, sub.id)));
      await this.outbox.publish(tx, 'platform.subscription.changed', { subscriptionId: sub.id, planCode: sub.planCode, status: sub.status, cancelAtPeriodEnd: cancel }, tenantId);
      return this.overviewIn(tx, tenantId);
    });
  }

  // ---------- building blocks (also used by signup and the console) ----------

  async insertSubscription(
    tx: Tx,
    tenantId: string,
    s: {
      planCode: string;
      billingCycle: BillingCycle;
      price: string | null;
      status: SubscriptionStatus;
      trialEndsAt: string | null;
      /** 'cycle' = one billing cycle from now. */
      periodEnd: 'cycle' | null;
    },
  ): Promise<Subscription> {
    const [row] = await tx
      .insert(platformSubscriptions)
      .values({
        tenantId,
        planCode: s.planCode,
        billingCycle: s.billingCycle,
        price: s.price,
        status: s.status,
        trialEndsAt: s.trialEndsAt,
        currentPeriodEnd: s.periodEnd === 'cycle' ? (sql`now() + ${cycleInterval(s.billingCycle)}::interval` as unknown as string) : null,
      })
      .returning();
    return toSubscription(row!);
  }

  async endSubscription(tx: Tx, tenantId: string, subscriptionId: string, status: SubscriptionStatus): Promise<void> {
    // Unpaid invoices of the old subscription no longer apply.
    await tx
      .update(platformInvoices)
      .set({ status: 'void' })
      .where(and(eq(platformInvoices.tenantId, tenantId), eq(platformInvoices.subscriptionId, subscriptionId), eq(platformInvoices.status, 'issued')));
    await tx
      .update(platformSubscriptions)
      .set({ status, endedAt: sql`now()` })
      .where(and(eq(platformSubscriptions.tenantId, tenantId), eq(platformSubscriptions.id, subscriptionId)));
  }

  openInvoices(tx: Tx, tenantId: string, subscriptionId: string) {
    return tx
      .select()
      .from(platformInvoices)
      .where(and(eq(platformInvoices.tenantId, tenantId), eq(platformInvoices.subscriptionId, subscriptionId), eq(platformInvoices.status, 'issued')))
      .orderBy(platformInvoices.dueAt);
  }

  async issueInvoice(tx: Tx, tenantId: string, sub: Subscription, opts: { periodStart: string }) {
    const plan = await this.getPlanByCode(tx, sub.planCode);
    const price = sub.price ?? priceFor(plan, sub.billingCycle);
    if (price === null) throw contactSales();
    const amount = toPaise(price);
    const tax = Math.round((amount * TAX_RATE) / 100);
    const seq = await tx.execute<{ n: string }>(sql`select nextval('platform.invoice_number_seq')::text as n`);
    const number = `HMS-${new Date().getUTCFullYear()}-${seq.rows[0]!.n.padStart(6, '0')}`;
    const [row] = await tx
      .insert(platformInvoices)
      .values({
        tenantId,
        subscriptionId: sub.id,
        number,
        planCode: sub.planCode,
        billingCycle: sub.billingCycle,
        periodStart: opts.periodStart,
        periodEnd: sql`${opts.periodStart}::timestamptz + ${cycleInterval(sub.billingCycle)}::interval` as unknown as string,
        amount: fromPaise(amount),
        taxRate: TAX_RATE.toFixed(2),
        taxAmount: fromPaise(tax),
        total: fromPaise(amount + tax),
        dueAt: sql`greatest(now(), ${opts.periodStart}::timestamptz)` as unknown as string,
      })
      .returning();
    await this.outbox.publish(tx, 'platform.invoice.issued', { invoiceId: row!.id, number, total: row!.total, dueAt: row!.dueAt }, tenantId);
    return row!;
  }

  /** Marks an invoice paid and brings the subscription and hospital back to active. */
  async markPaid(tx: Tx, tenantId: string, invoiceId: string, mode: PaymentMode, ref: string | null) {
    const [inv] = await tx
      .select()
      .from(platformInvoices)
      .where(and(eq(platformInvoices.tenantId, tenantId), eq(platformInvoices.id, invoiceId)))
      .for('update')
      .limit(1);
    if (!inv) throw notFound('Invoice');
    if (inv.status !== 'issued') throw conflict('invoice_not_open', `This invoice is already ${inv.status}`);
    const [paid] = await tx
      .update(platformInvoices)
      .set({ status: 'paid', paidAt: sql`now()`, paymentMode: mode, paymentRef: ref })
      .where(and(eq(platformInvoices.tenantId, tenantId), eq(platformInvoices.id, invoiceId)))
      .returning();

    const [sub] = await tx
      .select()
      .from(platformSubscriptions)
      .where(and(eq(platformSubscriptions.tenantId, tenantId), eq(platformSubscriptions.id, inv.subscriptionId)))
      .for('update')
      .limit(1);
    if (sub && !sub.endedAt) {
      await tx
        .update(platformSubscriptions)
        .set({
          status: 'active',
          currentPeriodStart: sub.status === 'active' ? sub.currentPeriodStart : inv.periodStart,
          currentPeriodEnd: sql`greatest(coalesce(${platformSubscriptions.currentPeriodEnd}, ${inv.periodEnd}::timestamptz), ${inv.periodEnd}::timestamptz)` as unknown as string,
        })
        .where(and(eq(platformSubscriptions.tenantId, tenantId), eq(platformSubscriptions.id, sub.id)));
      const stillOpen = await this.openInvoices(tx, tenantId, sub.id);
      if (!stillOpen.some((i) => new Date(i.dueAt) < new Date())) await this.setBillingStatus(tx, tenantId, 'active');
      await this.outbox.publish(tx, 'platform.subscription.changed', { subscriptionId: sub.id, planCode: sub.planCode, status: 'active' }, tenantId);
    }
    return paid!;
  }

  /**
   * Moves the hospital between trial/active/grace/suspended for billing reasons. Hospitals that a super
   * admin suspended or closed by hand are left alone.
   */
  async setBillingStatus(tx: Tx, tenantId: string, status: TenantStatus): Promise<void> {
    const suspension = status === 'suspended' ? { by: 'billing', at: new Date().toISOString() } : null;
    await tx.execute(sql`
      update platform.tenants
         set status = ${status},
             settings = case when ${suspension === null} then settings - 'suspension'
                             else settings || jsonb_build_object('suspension', ${JSON.stringify(suspension)}::jsonb) end
       where id = ${tenantId}
         and (status in ('trial', 'active', 'grace') or (status = 'suspended' and settings -> 'suspension' ->> 'by' = 'billing'))`);
  }

  // ---------- lifecycle ----------

  /** Idempotent sweep over all hospitals. Runs hourly in the API and on demand from the console. */
  async runLifecycle(): Promise<LifecycleRunResult> {
    const result: LifecycleRunResult = { trialsExpired: 0, renewalsIssued: 0, movedToGrace: 0, suspended: 0 };
    const candidates = await this.db.crossTenant(async (tx) => {
      const res = await tx.execute<{ tenant_id: string }>(sql`
        select distinct s.tenant_id
          from platform.subscriptions s
         where s.ended_at is null
           and (   (s.status = 'trial' and s.trial_ends_at <= now())
                or (s.status = 'active' and s.current_period_end <= now())
                or (s.status = 'active' and exists (select 1 from platform.invoices i where i.tenant_id = s.tenant_id
                          and i.subscription_id = s.id and i.status = 'issued' and i.due_at <= now()))
                or s.status = 'past_due')`);
      return res.rows.map((r) => r.tenant_id);
    });
    for (const tenantId of candidates) {
      try {
        const r = await this.db.tenant(tenantId, (tx) => this.lifecycleFor(tx, tenantId));
        result.trialsExpired += r.trialsExpired;
        result.renewalsIssued += r.renewalsIssued;
        result.movedToGrace += r.movedToGrace;
        result.suspended += r.suspended;
        this.ent.invalidate(tenantId);
      } catch (e) {
        this.logger.error({ err: e, tenantId }, 'lifecycle failed for hospital');
      }
    }
    return result;
  }

  private async lifecycleFor(tx: Tx, tenantId: string): Promise<LifecycleRunResult> {
    const r: LifecycleRunResult = { trialsExpired: 0, renewalsIssued: 0, movedToGrace: 0, suspended: 0 };
    const sub = await this.ent.currentSubscription(tx, tenantId, true);
    if (!sub) return r;
    const now = Date.now();
    const setSubStatus = (status: SubscriptionStatus) =>
      tx.update(platformSubscriptions).set({ status }).where(and(eq(platformSubscriptions.tenantId, tenantId), eq(platformSubscriptions.id, sub.id)));

    const periodOver =
      (sub.status === 'trial' && sub.trialEndsAt && new Date(sub.trialEndsAt).getTime() <= now) ||
      (sub.status === 'active' && sub.currentPeriodEnd && new Date(sub.currentPeriodEnd).getTime() <= now);

    if (periodOver) {
      if (sub.status === 'trial') r.trialsExpired++;
      if (sub.cancelAtPeriodEnd) {
        await this.endSubscription(tx, tenantId, sub.id, 'cancelled');
        await this.setBillingStatus(tx, tenantId, 'suspended');
        r.suspended++;
        return r;
      }
      const open = await this.openInvoices(tx, tenantId, sub.id);
      const plan = await this.getPlanByCode(tx, sub.planCode);
      if (!open.length && (sub.price ?? priceFor(plan, sub.billingCycle)) !== null) {
        const start = (sub.status === 'trial' ? sub.trialEndsAt : sub.currentPeriodEnd)!;
        await this.issueInvoice(tx, tenantId, sub, { periodStart: start });
        r.renewalsIssued++;
      }
      await setSubStatus('past_due');
      await this.setBillingStatus(tx, tenantId, 'grace');
      await this.outbox.publish(tx, 'platform.subscription.changed', { subscriptionId: sub.id, planCode: sub.planCode, status: 'past_due' }, tenantId);
      r.movedToGrace++;
      return r;
    }

    const open = await this.openInvoices(tx, tenantId, sub.id);
    const overdue = open.find((i) => new Date(i.dueAt).getTime() <= now);
    if (sub.status === 'active' && overdue) {
      await setSubStatus('past_due');
      await this.setBillingStatus(tx, tenantId, 'grace');
      r.movedToGrace++;
      return r;
    }

    if (sub.status === 'past_due') {
      const since = overdue?.dueAt ?? sub.currentPeriodEnd ?? sub.trialEndsAt;
      if (since && new Date(since).getTime() + GRACE_DAYS * 86_400_000 <= now) {
        const [t] = await tx.select({ status: tenants.status }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
        if (t?.status === 'grace') {
          await this.setBillingStatus(tx, tenantId, 'suspended');
          r.suspended++;
        }
      }
    }
    return r;
  }
}

export function priceFor(plan: Plan, cycle: BillingCycle): string | null {
  return cycle === 'yearly' ? plan.priceYearly : plan.priceMonthly;
}

function latest(a: string, b: string | null): string {
  return b && new Date(b) > new Date(a) ? b : a;
}
