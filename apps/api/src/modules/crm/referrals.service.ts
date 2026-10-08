import { Injectable } from '@nestjs/common';
import {
  and,
  count,
  crmCommissionRules,
  crmCommissions,
  crmCommissionStatements,
  crmReferrals,
  crmReferrers,
  desc,
  eq,
  formatSeries,
  inArray,
  iso,
  isNull,
  nextCounter,
  or,
  patients,
  sql,
  type CrmCommissionLine,
  type Tx,
} from '@hms/db';
import { crm, type Paginated, type billing } from '@hms/shared';
import type { z } from 'zod';
import { DbService } from '../../common/db/db.service';
import { OutboxService } from '../../common/events/outbox.service';
import { badRequest, conflict, notFound } from '../../common/errors/errors';
import { actor, addDays, moneyString, paise, personName, rupees, tenantId, todayIST, toNumber } from './crm.util';

type ReferrerRow = typeof crmReferrers.$inferSelect;
type RuleRow = typeof crmCommissionRules.$inferSelect;
type CommissionRow = typeof crmCommissions.$inferSelect;
type StatementRow = typeof crmCommissionStatements.$inferSelect;

/**
 * Referrers (referring doctors, clinics, agents), commission rules, referrals, the commission ledger
 * and commission statements. Commissions accrue from `billing.invoice.finalized` (see CrmEventsService).
 */
@Injectable()
export class ReferralsService {
  constructor(
    private readonly db: DbService,
    private readonly outbox: OutboxService,
  ) {}

  // =====================================================================
  // Referrers
  // =====================================================================

  listReferrers(q: crm.ReferrerQuery): Promise<Paginated<crm.ReferrerSummary>> {
    const { page, pageSize, q: term, type, active } = crm.referrerQuerySchema.parse(q);
    return this.db.tx(async (tx) => {
      const t = term?.toLowerCase();
      const where = and(
        type ? eq(crmReferrers.type, type) : undefined,
        active ? eq(crmReferrers.isActive, active === 'true') : undefined,
        t
          ? or(
              sql`lower(${crmReferrers.name}) like ${'%' + t + '%'}`,
              sql`lower(${crmReferrers.code}) = ${t}`,
              sql`${crmReferrers.mobile} like ${t + '%'}`,
              sql`lower(coalesce(${crmReferrers.organization}, '')) like ${'%' + t + '%'}`,
            )
          : undefined,
      );
      const [rows, [{ total }]] = await Promise.all([
        tx.select().from(crmReferrers).where(where).orderBy(crmReferrers.name).limit(pageSize).offset((page - 1) * pageSize),
        tx.select({ total: count() }).from(crmReferrers).where(where),
      ]);
      const stats = await this.referrerStats(tx, rows.map((r) => r.id));
      return { items: rows.map((r) => ({ ...referrerDto(r), ...(stats.get(r.id) ?? emptyStats()) })), page, pageSize, total };
    });
  }

  getReferrer(id: string): Promise<crm.ReferrerSummary> {
    return this.db.tx(async (tx) => {
      const row = await this.referrerRow(tx, id);
      const stats = await this.referrerStats(tx, [id]);
      return { ...referrerDto(row), ...(stats.get(id) ?? emptyStats()) };
    });
  }

  createReferrer(input: crm.ReferrerInput): Promise<crm.Referrer> {
    const d = crm.referrerInputSchema.parse(input);
    return this.db.tx(async (tx) => {
      const code = formatSeries('RF', await nextCounter(tx, 'crm.referrer'), 5);
      const [row] = await tx
        .insert(crmReferrers)
        .values({ ...d, tenantId: tenantId(), code, createdBy: actor(), updatedBy: actor() })
        .returning();
      return referrerDto(row!);
    });
  }

  updateReferrer(id: string, input: crm.UpdateReferrer): Promise<crm.Referrer> {
    const d = crm.updateReferrerSchema.parse(input);
    return this.db.tx(async (tx) => {
      const [row] = await tx
        .update(crmReferrers)
        .set({ ...d, updatedBy: actor() })
        .where(eq(crmReferrers.id, id))
        .returning();
      if (!row) throw notFound('Referrer');
      return referrerDto(row);
    });
  }

  private async referrerRow(tx: Tx, id: string): Promise<ReferrerRow> {
    const [row] = await tx.select().from(crmReferrers).where(eq(crmReferrers.id, id)).limit(1);
    if (!row) throw notFound('Referrer');
    return row;
  }

  private async referrerStats(tx: Tx, ids: string[]) {
    const out = new Map<string, Omit<crm.ReferrerSummary, keyof crm.Referrer>>();
    if (!ids.length) return out;
    const [refs, open, statements] = await Promise.all([
      tx
        .select({ id: crmReferrals.referrerId, n: count() })
        .from(crmReferrals)
        .where(inArray(crmReferrals.referrerId, ids))
        .groupBy(crmReferrals.referrerId),
      tx
        .select({ id: crmCommissions.referrerId, sum: sql<string>`coalesce(sum(${crmCommissions.amount}), 0)` })
        .from(crmCommissions)
        .where(and(inArray(crmCommissions.referrerId, ids), eq(crmCommissions.status, 'open'), isNull(crmCommissions.statementId)))
        .groupBy(crmCommissions.referrerId),
      tx
        .select({
          id: crmCommissionStatements.referrerId,
          status: crmCommissionStatements.status,
          sum: sql<string>`coalesce(sum(${crmCommissionStatements.total}), 0)`,
        })
        .from(crmCommissionStatements)
        .where(and(inArray(crmCommissionStatements.referrerId, ids), inArray(crmCommissionStatements.status, ['approved', 'paid'])))
        .groupBy(crmCommissionStatements.referrerId, crmCommissionStatements.status),
    ]);
    for (const id of ids) out.set(id, emptyStats());
    for (const r of refs) out.get(r.id)!.referralCount = Number(r.n);
    for (const r of open) out.get(r.id)!.openCommission = toNumber(r.sum);
    for (const r of statements) {
      if (r.status === 'approved') out.get(r.id)!.payableCommission = toNumber(r.sum);
      else out.get(r.id)!.paidCommission = toNumber(r.sum);
    }
    return out;
  }

  // =====================================================================
  // Commission rules
  // =====================================================================

  listRules(referrerId?: string): Promise<crm.CommissionRule[]> {
    return this.db.tx(async (tx) => {
      const rows = await tx
        .select({ r: crmCommissionRules, name: crmReferrers.name })
        .from(crmCommissionRules)
        .leftJoin(crmReferrers, and(eq(crmReferrers.tenantId, crmCommissionRules.tenantId), eq(crmReferrers.id, crmCommissionRules.referrerId)))
        .where(referrerId ? or(eq(crmCommissionRules.referrerId, referrerId), isNull(crmCommissionRules.referrerId)) : undefined)
        .orderBy(sql`${crmCommissionRules.referrerId} nulls first`, crmCommissionRules.appliesTo, desc(crmCommissionRules.effectiveFrom));
      return rows.map((x) => ruleDto(x.r, x.name));
    });
  }

  createRule(input: crm.CommissionRuleInput): Promise<crm.CommissionRule> {
    const d = crm.commissionRuleInputSchema.parse(input);
    return this.db.tx(async (tx) => {
      const name = d.referrerId ? (await this.referrerRow(tx, d.referrerId)).name : null;
      const [row] = await tx
        .insert(crmCommissionRules)
        .values({
          tenantId: tenantId(),
          referrerId: d.referrerId,
          appliesTo: d.appliesTo,
          serviceCode: d.serviceCode,
          rateType: d.rateType,
          rate: moneyString(d.rate),
          effectiveFrom: d.effectiveFrom ?? todayIST(),
          effectiveTo: d.effectiveTo,
          isActive: d.isActive,
          createdBy: actor(),
          updatedBy: actor(),
        })
        .returning();
      return ruleDto(row!, name);
    });
  }

  updateRule(id: string, input: crm.CommissionRuleInput): Promise<crm.CommissionRule> {
    const d = crm.commissionRuleInputSchema.parse(input);
    return this.db.tx(async (tx) => {
      const name = d.referrerId ? (await this.referrerRow(tx, d.referrerId)).name : null;
      const [current] = await tx.select({ effectiveFrom: crmCommissionRules.effectiveFrom }).from(crmCommissionRules).where(eq(crmCommissionRules.id, id)).limit(1);
      if (!current) throw notFound('Commission rule');
      const from = d.effectiveFrom ?? current.effectiveFrom;
      if (d.effectiveTo && d.effectiveTo < from) throw badRequest('invalid_dates', 'End date is before the start date');
      const [row] = await tx
        .update(crmCommissionRules)
        .set({
          referrerId: d.referrerId,
          appliesTo: d.appliesTo,
          serviceCode: d.serviceCode,
          rateType: d.rateType,
          rate: moneyString(d.rate),
          ...(d.effectiveFrom ? { effectiveFrom: d.effectiveFrom } : {}),
          effectiveTo: d.effectiveTo,
          isActive: d.isActive,
          updatedBy: actor(),
        })
        .where(eq(crmCommissionRules.id, id))
        .returning();
      if (!row) throw notFound('Commission rule');
      return ruleDto(row, name);
    });
  }

  // =====================================================================
  // Referrals
  // =====================================================================

  listReferrals(q: crm.ReferralQuery): Promise<Paginated<crm.Referral>> {
    const { page, pageSize, referrerId, patientId, from, to } = crm.referralQuerySchema.parse(q);
    return this.db.tx(async (tx) => {
      const where = and(
        referrerId ? eq(crmReferrals.referrerId, referrerId) : undefined,
        patientId ? eq(crmReferrals.patientId, patientId) : undefined,
        from ? sql`${crmReferrals.referredOn} >= ${from}` : undefined,
        to ? sql`${crmReferrals.referredOn} <= ${to}` : undefined,
      );
      const [rows, [{ total }]] = await Promise.all([
        this.referralQuery(tx).where(where).orderBy(desc(crmReferrals.referredOn), desc(crmReferrals.createdAt)).limit(pageSize).offset((page - 1) * pageSize),
        tx.select({ total: count() }).from(crmReferrals).where(where),
      ]);
      return { items: rows.map(referralDto), page, pageSize, total };
    });
  }

  createReferral(input: crm.ReferralInput): Promise<crm.Referral> {
    const d = crm.referralInputSchema.parse(input);
    return this.db.tx((tx) => this.createReferralIn(tx, d));
  }

  /** Inside a caller's transaction (lead conversion uses it too). */
  async createReferralIn(tx: Tx, d: z.output<typeof crm.referralInputSchema>): Promise<crm.Referral> {
    const referrer = await this.referrerRow(tx, d.referrerId);
    if (!referrer.isActive) throw conflict('referrer_inactive', `${referrer.name} is marked inactive`);
    const [patient] = await tx.select({ id: patients.id, isActive: patients.isActive }).from(patients).where(eq(patients.id, d.patientId)).limit(1);
    if (!patient) throw notFound('Patient');
    if (!patient.isActive) throw conflict('patient_inactive', 'This patient record has been merged or deactivated');
    const referredOn = d.referredOn ?? todayIST();
    const validUntil = d.validUntil === undefined ? addDays(referredOn, crm.DEFAULT_REFERRAL_DAYS) : d.validUntil;
    if (validUntil && validUntil < referredOn) throw badRequest('invalid_dates', 'Valid-until is before the referral date');
    const [row] = await tx
      .insert(crmReferrals)
      .values({
        tenantId: tenantId(),
        patientId: d.patientId,
        referrerId: d.referrerId,
        referredOn,
        validUntil,
        leadId: d.leadId ?? null,
        notes: d.notes,
        createdBy: actor(),
        updatedBy: actor(),
      })
      .returning({ id: crmReferrals.id });
    const event: crm.ReferralCreatedEvent = { referralId: row!.id, patientId: d.patientId, referrerId: d.referrerId };
    await this.outbox.publish(tx, 'crm.referral.created', { ...event });
    const [full] = await this.referralQuery(tx).where(eq(crmReferrals.id, row!.id));
    return referralDto(full!);
  }

  closeReferral(id: string): Promise<crm.Referral> {
    return this.db.tx(async (tx) => {
      const [row] = await tx.update(crmReferrals).set({ status: 'closed', updatedBy: actor() }).where(eq(crmReferrals.id, id)).returning({ id: crmReferrals.id });
      if (!row) throw notFound('Referral');
      const [full] = await this.referralQuery(tx).where(eq(crmReferrals.id, id));
      return referralDto(full!);
    });
  }

  private referralQuery(tx: Tx) {
    return tx
      .select({
        r: crmReferrals,
        referrerName: crmReferrers.name,
        firstName: patients.firstName,
        lastName: patients.lastName,
        uhid: patients.uhid,
      })
      .from(crmReferrals)
      .innerJoin(crmReferrers, and(eq(crmReferrers.tenantId, crmReferrals.tenantId), eq(crmReferrers.id, crmReferrals.referrerId)))
      .innerJoin(patients, and(eq(patients.tenantId, crmReferrals.tenantId), eq(patients.id, crmReferrals.patientId)));
  }

  // =====================================================================
  // Commission engine (runs in the worker on billing events)
  // =====================================================================

  /** Accrue commission for a finalized invoice if the patient has a live referral. Idempotent. */
  async accrueForInvoice(tx: Tx, tenant: string, e: billing.InvoiceFinalizedEvent): Promise<CommissionRow | null> {
    const [existing] = await tx
      .select()
      .from(crmCommissions)
      .where(and(eq(crmCommissions.invoiceId, e.invoiceId), eq(crmCommissions.kind, 'accrual')))
      .limit(1);
    if (existing) return existing;
    // Other modules' tests (and older publishers) may send a partial payload; without lines there is nothing to pay on.
    if (!e.lines?.length || !e.patientId || !e.number) return null;

    const day = (e.invoiceDate ?? todayIST()).slice(0, 10);
    const [referral] = await tx
      .select({ r: crmReferrals, active: crmReferrers.isActive })
      .from(crmReferrals)
      .innerJoin(crmReferrers, and(eq(crmReferrers.tenantId, crmReferrals.tenantId), eq(crmReferrers.id, crmReferrals.referrerId)))
      .where(
        and(
          eq(crmReferrals.patientId, e.patientId),
          eq(crmReferrals.status, 'active'),
          sql`${crmReferrals.referredOn} <= ${day}`,
          sql`(${crmReferrals.validUntil} is null or ${crmReferrals.validUntil} >= ${day})`,
        ),
      )
      .orderBy(desc(crmReferrals.referredOn), desc(crmReferrals.createdAt))
      .limit(1);
    if (!referral || !referral.active) return null;

    const rules = await tx
      .select()
      .from(crmCommissionRules)
      .where(
        and(
          eq(crmCommissionRules.isActive, true),
          or(eq(crmCommissionRules.referrerId, referral.r.referrerId), isNull(crmCommissionRules.referrerId)),
          sql`${crmCommissionRules.effectiveFrom} <= ${day}`,
          sql`(${crmCommissionRules.effectiveTo} is null or ${crmCommissionRules.effectiveTo} >= ${day})`,
        ),
      );
    const module = e.source?.module ?? 'billing';
    const breakdown: CrmCommissionLine[] = e.lines.map((line) => {
      const rule = pickRule(rules, line.serviceCode ?? null, module);
      const base = paise(line.amount ?? 0);
      const commission = !rule ? 0 : rule.rateType === 'percent' ? Math.round((base * Number(rule.rate)) / 100) : paise(rule.rate) * Math.max(1, Math.round(line.qty || 1));
      return {
        description: line.description,
        serviceCode: line.serviceCode ?? null,
        amount: rupees(base),
        ruleId: rule?.id ?? null,
        rateType: (rule?.rateType as crm.RateType | undefined) ?? null,
        rate: rule ? Number(rule.rate) : 0,
        commission: rupees(Math.min(commission, Math.max(base, 0))),
      };
    });
    const total = breakdown.reduce((s, l) => s + paise(l.commission), 0);
    if (total <= 0) return null;
    const baseTotal = breakdown.reduce((s, l) => s + paise(l.amount), 0);

    const [row] = await tx
      .insert(crmCommissions)
      .values({
        tenantId: tenant,
        kind: 'accrual',
        referrerId: referral.r.referrerId,
        referralId: referral.r.id,
        patientId: e.patientId,
        invoiceId: e.invoiceId,
        invoiceNumber: e.number,
        invoiceDate: day,
        sourceModule: module,
        baseAmount: moneyString(rupees(baseTotal)),
        amount: moneyString(rupees(total)),
        breakdown,
      })
      .onConflictDoNothing()
      .returning();
    return row ?? null;
  }

  /**
   * An invoice was cancelled: drop its commission if it is not on a statement yet,
   * otherwise book a reversal that the next statement deducts. Idempotent.
   */
  async reverseForInvoice(tx: Tx, tenant: string, invoiceId: string): Promise<void> {
    const rows = await tx.select().from(crmCommissions).where(eq(crmCommissions.invoiceId, invoiceId));
    const accrual = rows.find((r) => r.kind === 'accrual');
    if (!accrual || accrual.status === 'cancelled' || rows.some((r) => r.kind === 'reversal')) return;
    if (!accrual.statementId) {
      await tx.update(crmCommissions).set({ status: 'cancelled' }).where(eq(crmCommissions.id, accrual.id));
      return;
    }
    await tx
      .insert(crmCommissions)
      .values({
        tenantId: tenant,
        kind: 'reversal',
        referrerId: accrual.referrerId,
        referralId: accrual.referralId,
        patientId: accrual.patientId,
        invoiceId: accrual.invoiceId,
        invoiceNumber: accrual.invoiceNumber,
        invoiceDate: todayIST(),
        sourceModule: accrual.sourceModule,
        baseAmount: moneyString(-toNumber(accrual.baseAmount)),
        amount: moneyString(-toNumber(accrual.amount)),
        breakdown: accrual.breakdown.map((l) => ({ ...l, amount: -l.amount, commission: -l.commission })),
        reversesId: accrual.id,
      })
      .onConflictDoNothing();
  }

  // =====================================================================
  // Commissions and statements
  // =====================================================================

  listCommissions(q: crm.CommissionQuery): Promise<Paginated<crm.Commission>> {
    const { page, pageSize, referrerId, state, from, to } = crm.commissionQuerySchema.parse(q);
    return this.db.tx(async (tx) => {
      const where = and(
        referrerId ? eq(crmCommissions.referrerId, referrerId) : undefined,
        state === 'open' ? and(eq(crmCommissions.status, 'open'), isNull(crmCommissions.statementId)) : undefined,
        state === 'billed' ? sql`${crmCommissions.statementId} is not null` : undefined,
        state === 'cancelled' ? eq(crmCommissions.status, 'cancelled') : undefined,
        from ? sql`${crmCommissions.invoiceDate} >= ${from}` : undefined,
        to ? sql`${crmCommissions.invoiceDate} <= ${to}` : undefined,
      );
      const [rows, [{ total }]] = await Promise.all([
        this.commissionQuery(tx).where(where).orderBy(desc(crmCommissions.invoiceDate), desc(crmCommissions.createdAt)).limit(pageSize).offset((page - 1) * pageSize),
        tx.select({ total: count() }).from(crmCommissions).where(where),
      ]);
      return { items: rows.map(commissionDto), page, pageSize, total };
    });
  }

  private commissionQuery(tx: Tx) {
    return tx
      .select({
        c: crmCommissions,
        referrerName: crmReferrers.name,
        firstName: patients.firstName,
        lastName: patients.lastName,
        statementNumber: crmCommissionStatements.number,
      })
      .from(crmCommissions)
      .innerJoin(crmReferrers, and(eq(crmReferrers.tenantId, crmCommissions.tenantId), eq(crmReferrers.id, crmCommissions.referrerId)))
      .innerJoin(patients, and(eq(patients.tenantId, crmCommissions.tenantId), eq(patients.id, crmCommissions.patientId)))
      .leftJoin(
        crmCommissionStatements,
        and(eq(crmCommissionStatements.tenantId, crmCommissions.tenantId), eq(crmCommissionStatements.id, crmCommissions.statementId)),
      );
  }

  listStatements(q: crm.StatementQuery): Promise<Paginated<crm.CommissionStatement>> {
    const { page, pageSize, referrerId, status } = crm.statementQuerySchema.parse(q);
    return this.db.tx(async (tx) => {
      const where = and(
        referrerId ? eq(crmCommissionStatements.referrerId, referrerId) : undefined,
        status ? eq(crmCommissionStatements.status, status) : undefined,
      );
      const [rows, [{ total }]] = await Promise.all([
        this.statementQuery(tx).where(where).orderBy(desc(crmCommissionStatements.createdAt)).limit(pageSize).offset((page - 1) * pageSize),
        tx.select({ total: count() }).from(crmCommissionStatements).where(where),
      ]);
      return { items: rows.map((r) => statementDto(r.s, r.referrerName)), page, pageSize, total };
    });
  }

  getStatement(id: string): Promise<crm.CommissionStatementDetail> {
    return this.db.tx((tx) => this.statementDetail(tx, id));
  }

  createStatement(input: crm.CreateStatement): Promise<crm.CommissionStatementDetail> {
    const d = crm.createStatementSchema.parse(input);
    return this.db.tx(async (tx) => {
      await this.referrerRow(tx, d.referrerId);
      const open = await tx
        .select({ id: crmCommissions.id, amount: crmCommissions.amount })
        .from(crmCommissions)
        .where(
          and(
            eq(crmCommissions.referrerId, d.referrerId),
            eq(crmCommissions.status, 'open'),
            isNull(crmCommissions.statementId),
            sql`${crmCommissions.invoiceDate} between ${d.periodFrom} and ${d.periodTo}`,
          ),
        )
        .for('update');
      if (!open.length) throw conflict('nothing_to_bill', 'No unbilled commission for this referrer in that period');
      const total = open.reduce((s, c) => s + paise(c.amount), 0);
      if (total <= 0) throw conflict('nothing_to_pay', 'Commission for this period is zero or less after reversals; it carries over to the next statement');
      const number = formatSeries('CS', await nextCounter(tx, 'crm.statement'));
      const [row] = await tx
        .insert(crmCommissionStatements)
        .values({
          tenantId: tenantId(),
          number,
          referrerId: d.referrerId,
          periodFrom: d.periodFrom,
          periodTo: d.periodTo,
          total: moneyString(rupees(total)),
          notes: d.notes,
          createdBy: actor(),
          updatedBy: actor(),
        })
        .returning();
      await tx.update(crmCommissions).set({ statementId: row!.id }).where(inArray(crmCommissions.id, open.map((c) => c.id)));
      return this.statementDetail(tx, row!.id);
    });
  }

  approveStatement(id: string): Promise<crm.CommissionStatementDetail> {
    return this.db.tx(async (tx) => {
      const s = await this.statementRow(tx, id);
      if (s.status !== 'draft') throw conflict('statement_not_draft', `Statement ${s.number} is ${s.status}`);
      await tx
        .update(crmCommissionStatements)
        .set({ status: 'approved', approvedAt: new Date().toISOString(), approvedBy: actor(), updatedBy: actor() })
        .where(eq(crmCommissionStatements.id, id));
      return this.statementDetail(tx, id);
    });
  }

  payStatement(id: string, input: crm.PayStatement): Promise<crm.CommissionStatementDetail> {
    const d = crm.payStatementSchema.parse(input);
    return this.db.tx(async (tx) => {
      const s = await this.statementRow(tx, id);
      if (s.status !== 'approved') throw conflict('statement_not_approved', 'Approve the statement before paying it');
      if (d.mode !== 'cash' && !d.reference) {
        throw badRequest('payment_reference_required', `Enter the ${d.mode === 'cheque' ? 'cheque number' : 'UTR / transaction reference'} for a ${d.mode.toUpperCase()} payment`);
      }
      await tx
        .update(crmCommissionStatements)
        .set({
          status: 'paid',
          paidAt: new Date().toISOString(),
          paidBy: actor(),
          paymentMode: d.mode,
          paymentRef: d.reference,
          notes: d.notes ?? s.notes,
          updatedBy: actor(),
        })
        .where(eq(crmCommissionStatements.id, id));
      const event: crm.StatementPaidEvent = { statementId: id, number: s.number, referrerId: s.referrerId, total: toNumber(s.total), mode: d.mode };
      await this.outbox.publish(tx, 'crm.statement.paid', { ...event });
      return this.statementDetail(tx, id);
    });
  }

  cancelStatement(id: string): Promise<crm.CommissionStatementDetail> {
    return this.db.tx(async (tx) => {
      const s = await this.statementRow(tx, id);
      if (s.status === 'paid') throw conflict('statement_paid', 'A paid statement cannot be cancelled');
      if (s.status === 'cancelled') throw conflict('statement_cancelled', 'Statement is already cancelled');
      await tx.update(crmCommissions).set({ statementId: null }).where(eq(crmCommissions.statementId, id));
      await tx.update(crmCommissionStatements).set({ status: 'cancelled', updatedBy: actor() }).where(eq(crmCommissionStatements.id, id));
      return this.statementDetail(tx, id);
    });
  }

  private async statementRow(tx: Tx, id: string): Promise<StatementRow> {
    const [row] = await tx.select().from(crmCommissionStatements).where(eq(crmCommissionStatements.id, id)).for('update').limit(1);
    if (!row) throw notFound('Commission statement');
    return row;
  }

  private statementQuery(tx: Tx) {
    return tx
      .select({ s: crmCommissionStatements, referrerName: crmReferrers.name })
      .from(crmCommissionStatements)
      .innerJoin(crmReferrers, and(eq(crmReferrers.tenantId, crmCommissionStatements.tenantId), eq(crmReferrers.id, crmCommissionStatements.referrerId)));
  }

  private async statementDetail(tx: Tx, id: string): Promise<crm.CommissionStatementDetail> {
    const [row] = await this.statementQuery(tx).where(eq(crmCommissionStatements.id, id)).limit(1);
    if (!row) throw notFound('Commission statement');
    // A cancelled statement has released its commissions; show nothing on it.
    const lines = await this.commissionQuery(tx).where(eq(crmCommissions.statementId, id)).orderBy(crmCommissions.invoiceDate);
    return { ...statementDto(row.s, row.referrerName), commissions: lines.map(commissionDto) };
  }
}

// ---------- helpers ----------

/** Most specific rule for a line: referrer-specific beats default; service code beats module beats 'all'. */
export function pickRule(rules: RuleRow[], serviceCode: string | null, module: string): RuleRow | undefined {
  let best: RuleRow | undefined;
  let bestScore = -1;
  for (const r of rules) {
    if (r.serviceCode && r.serviceCode !== serviceCode) continue;
    if (r.appliesTo !== 'all' && r.appliesTo !== module) continue;
    const score = (r.referrerId ? 8 : 0) + (r.serviceCode ? 4 : 0) + (r.appliesTo !== 'all' ? 2 : 0);
    if (score > bestScore || (score === bestScore && best && r.effectiveFrom > best.effectiveFrom)) {
      best = r;
      bestScore = score;
    }
  }
  return best;
}

const emptyStats = () => ({ referralCount: 0, openCommission: 0, payableCommission: 0, paidCommission: 0 });

function referrerDto(r: ReferrerRow): crm.Referrer {
  return {
    id: r.id,
    code: r.code,
    type: r.type as crm.ReferrerType,
    name: r.name,
    mobile: r.mobile,
    email: r.email,
    organization: r.organization,
    city: r.city,
    registrationNo: r.registrationNo,
    pan: r.pan,
    notes: r.notes,
    isActive: r.isActive,
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
  };
}

function ruleDto(r: RuleRow, referrerName: string | null): crm.CommissionRule {
  return {
    id: r.id,
    referrerId: r.referrerId,
    referrerName,
    appliesTo: r.appliesTo as crm.RuleScope,
    serviceCode: r.serviceCode,
    rateType: r.rateType as crm.RateType,
    rate: toNumber(r.rate),
    effectiveFrom: r.effectiveFrom,
    effectiveTo: r.effectiveTo,
    isActive: r.isActive,
  };
}

function referralDto(x: {
  r: typeof crmReferrals.$inferSelect;
  referrerName: string;
  firstName: string;
  lastName: string | null;
  uhid: string;
}): crm.Referral {
  return {
    id: x.r.id,
    patientId: x.r.patientId,
    patientName: personName(x.firstName, x.lastName),
    patientUhid: x.uhid,
    referrerId: x.r.referrerId,
    referrerName: x.referrerName,
    referredOn: x.r.referredOn,
    validUntil: x.r.validUntil,
    leadId: x.r.leadId,
    notes: x.r.notes,
    status: x.r.status as 'active' | 'closed',
    createdAt: iso(x.r.createdAt),
  };
}

function commissionDto(x: { c: CommissionRow; referrerName: string; firstName: string; lastName: string | null; statementNumber: string | null }): crm.Commission {
  const c = x.c;
  return {
    id: c.id,
    kind: c.kind as 'accrual' | 'reversal',
    referrerId: c.referrerId,
    referrerName: x.referrerName,
    referralId: c.referralId,
    patientId: c.patientId,
    patientName: personName(x.firstName, x.lastName),
    invoiceId: c.invoiceId,
    invoiceNumber: c.invoiceNumber,
    invoiceDate: c.invoiceDate,
    sourceModule: c.sourceModule,
    baseAmount: toNumber(c.baseAmount),
    amount: toNumber(c.amount),
    breakdown: c.breakdown as crm.CommissionLine[],
    status: c.status as 'open' | 'cancelled',
    statementId: c.statementId,
    statementNumber: x.statementNumber,
    createdAt: iso(c.createdAt),
  };
}

function statementDto(s: StatementRow, referrerName: string): crm.CommissionStatement {
  return {
    id: s.id,
    number: s.number,
    referrerId: s.referrerId,
    referrerName,
    periodFrom: s.periodFrom,
    periodTo: s.periodTo,
    total: toNumber(s.total),
    status: s.status as crm.StatementStatus,
    approvedAt: s.approvedAt ? iso(s.approvedAt) : null,
    paidAt: s.paidAt ? iso(s.paidAt) : null,
    paymentMode: s.paymentMode as crm.CommissionPaymentMode | null,
    paymentRef: s.paymentRef,
    notes: s.notes,
    createdAt: iso(s.createdAt),
  };
}
