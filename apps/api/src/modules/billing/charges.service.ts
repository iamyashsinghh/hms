import { HttpStatus, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Tx } from '@hms/db';
import { billing as contracts, type Paginated } from '@hms/shared';
import type { billing as B } from '@hms/shared';
import { DbService } from '../../common/db/db.service';
import { currentContext } from '../../common/context/request-context';
import { AppError, badRequest, conflict, notFound } from '../../common/errors/errors';
import { BillingRepository } from './billing.repository';
import { BillingService } from './billing.service';
import { ChargesRepository, type ChargeRow } from './charges.repository';
import { computeLine, paise, rupees, toNumber } from './money';

/** Business date in India (the server runs in UTC). */
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

/**
 * The patient account. Departments post what a patient owes as charges (postCharge, inside their own
 * transaction, idempotent on the source); the billing desk or a "Collect now" button turns pending
 * charges into one invoice (billCharges). Each hospital's billing rules live here too.
 *
 * Cross-module contract: postCharge / postCharges / cancelBySource / billCharges / paymentStates / rules.
 */
@Injectable()
export class ChargesService {
  constructor(
    private readonly db: DbService,
    private readonly repo: ChargesRepository,
    private readonly billingRepo: BillingRepository,
    private readonly billing: BillingService,
  ) {}

  // =====================================================================
  // Rules
  // =====================================================================

  /** Effective rules for a facility (defaults ← hospital ← branch). Works in the worker (pass facilityId). */
  async rules(tx: Tx, facilityId?: string | null): Promise<B.BillingRules> {
    const fid = facilityId ?? currentContext()?.facilityId ?? null;
    const hospital = await this.repo.ruleSet(tx, null);
    const branch = fid ? await this.repo.ruleSet(tx, fid) : undefined;
    return mergeRules(contracts.DEFAULT_BILLING_RULES, hospital?.rules, branch?.rules);
  }

  getRules(facilityId?: string): Promise<B.BillingRulesView> {
    return this.db.tx(async (tx) => {
      const hospital = await this.repo.ruleSet(tx, null);
      const branch = facilityId ? await this.repo.ruleSet(tx, facilityId) : undefined;
      const latest = [hospital, branch].filter(Boolean).sort((a, b) => String(b!.updatedAt).localeCompare(String(a!.updatedAt)))[0];
      return {
        facilityId: facilityId ?? null,
        effective: mergeRules(contracts.DEFAULT_BILLING_RULES, hospital?.rules, branch?.rules),
        hospital: cleanRules(hospital?.rules),
        branch: facilityId ? cleanRules(branch?.rules) : null,
        updatedAt: latest ? new Date(latest.updatedAt).toISOString() : null,
        updatedBy: latest?.updatedBy ?? null,
      };
    });
  }

  /**
   * Saves the hospital's rules (no facilityId) or a branch's overrides. A preset replaces the level's rules
   * with the preset first; `rules` then sets individual keys. Charges already posted are not touched.
   */
  saveRules(input: B.BillingRulesInput): Promise<B.BillingRulesView> {
    const d = contracts.billingRulesInputSchema.parse(input);
    if (d.facilityId) this.billing.facilityFor(d.facilityId);
    return this.db
      .tx(async (tx) => {
        const { userId } = await this.billingRepo.scope(tx);
        const current = await this.repo.ruleSet(tx, d.facilityId ?? null);
        const base = d.preset ? { ...contracts.BILLING_RULE_PRESETS[d.preset] } : d.replace ? {} : cleanRules(current?.rules);
        const next = { ...base, ...d.rules } as Record<string, unknown>;
        // The whole level must still be valid when merged over the defaults.
        const merged = contracts.billingRulesSchema.safeParse(mergeRules(contracts.DEFAULT_BILLING_RULES, next));
        if (!merged.success) throw badRequest('invalid_rules', merged.error.issues[0]?.message ?? 'Check the billing rules');
        await this.repo.saveRuleSet(tx, d.facilityId ?? null, next, userId);
      })
      .then(() => this.getRules(d.facilityId));
  }

  // =====================================================================
  // Posting
  // =====================================================================

  /**
   * Posts a charge to the patient's account inside the caller's transaction. Idempotent on
   * (source.module, source.refId, source.line): a repeat returns the first charge; a cancelled one is
   * posted again. Priced from the service master / price lists when unitPrice or taxRate is omitted.
   */
  async postCharge(tx: Tx, input: B.PostChargeInput): Promise<B.Charge> {
    const d = contracts.postChargeSchema.parse(input);
    const ctx = currentContext();
    const line = d.source.line ?? '';
    const [existing] = await this.repo.bySource(tx, d.source.module, d.source.refId, line, true);
    if (existing && existing.status !== 'cancelled') return this.dto(tx, existing);

    const facilityId = d.facilityId ?? this.billing.facilityFor(undefined);
    if (!(await this.billingRepo.patientSnapshot(tx, d.patientId))) throw notFound('Patient');
    // An admitted patient's charges go on the IPD bill unless the caller says otherwise.
    const admissionId = d.admissionId ?? (d.visitId || d.standalone ? null : await this.repo.activeAdmission(tx, d.patientId));
    const payerId = await this.repo.activePayer(tx, d.patientId, d.chargeDate ?? today());
    let serviceId: string | null = null;
    let unitPrice = d.unitPrice;
    let taxRate = d.taxRate;
    let description = d.description;
    let hsnSac = d.hsnSac ?? null;
    if (d.serviceCode) {
      const [svc] = await this.billingRepo.servicesByCode(tx, [d.serviceCode]);
      if (!svc || !svc.isActive) throw badRequest('unknown_service', `Unknown or inactive service: ${d.serviceCode}`, { missing: [d.serviceCode] });
      serviceId = svc.id;
      if (unitPrice === undefined) {
        const listed = (await this.billingRepo.listPrices(tx, [svc.id], payerId, d.chargeDate ?? today())).get(svc.id);
        unitPrice = toNumber(listed?.price ?? svc.basePrice);
      }
      taxRate ??= toNumber(svc.taxRate);
      description ??= svc.name;
      hsnSac ??= svc.hsnSac;
    }
    const discount = d.discount ?? 0;
    try {
      computeLine({ qty: d.qty, unitPrice: paise(unitPrice!), discount: paise(discount), taxRate: taxRate ?? 0, priceIncludesTax: d.priceIncludesTax });
    } catch (e) {
      throw badRequest('invalid_discount', (e as Error).message);
    }
    const { userId } = await this.billingRepo.scope(tx);
    const values = {
      facilityId,
      patientId: d.patientId,
      account: admissionId ? 'ipd' : d.visitId ? 'opd' : 'other',
      visitId: d.visitId ?? null,
      admissionId,
      sourceModule: d.source.module,
      sourceRef: d.source.refId,
      sourceLine: line,
      serviceId,
      serviceCode: d.serviceCode ?? null,
      itemId: d.itemId ?? null,
      description: description!,
      hsnSac,
      qty: String(d.qty),
      unitPrice: rupees(paise(unitPrice!)),
      priceIncludesTax: d.priceIncludesTax ?? false,
      taxRate: String(taxRate ?? 0),
      discount: rupees(paise(discount)),
      doctorId: d.doctorId ?? null,
      chargeDate: d.chargeDate ?? today(),
      notes: d.notes ?? null,
      updatedBy: userId ?? ctx?.userId ?? null,
    };
    const row = existing
      ? await this.repo.update(tx, existing.id, { ...values, status: 'pending', cancelReason: null, cancelledAt: null, cancelledBy: null })
      : await this.repo.insert(tx, { ...values, createdBy: userId ?? ctx?.userId ?? null });
    return this.dto(tx, row);
  }

  async postCharges(tx: Tx, inputs: B.PostChargeInput[]): Promise<B.Charge[]> {
    const out: B.Charge[] = [];
    for (const i of inputs) out.push(await this.postCharge(tx, i));
    return out;
  }

  /**
   * The source was cancelled (order cancelled, issue returned...). Pending charges are cancelled; billed
   * ones are flagged so the billing desk can issue a credit note. `line` limits it to one charge.
   */
  async cancelBySource(tx: Tx, source: { module: string; refId: string; line?: string }, reason: string): Promise<{ cancelled: number; reversals: B.Charge[] }> {
    const rows = await this.repo.bySource(tx, source.module, source.refId, source.line, true);
    const { userId } = await this.billingRepo.scope(tx);
    let cancelled = 0;
    const reversals: ChargeRow[] = [];
    for (const r of rows) {
      if (r.status === 'pending') {
        await this.repo.update(tx, r.id, { status: 'cancelled', cancelReason: reason, cancelledAt: new Date().toISOString(), cancelledBy: userId, updatedBy: userId });
        cancelled++;
      } else if (r.status === 'billed' && !r.reversalRequestedAt) {
        reversals.push(await this.repo.update(tx, r.id, { reversalRequestedAt: new Date().toISOString(), reversalReason: reason, updatedBy: userId }));
      }
    }
    if (reversals.length) {
      const first = reversals[0]!;
      await this.billing.publishEvent(tx, 'billing.charge.reversal_requested', {
        patientId: first.patientId,
        chargeIds: reversals.map((r) => r.id),
        invoiceIds: [...new Set(reversals.map((r) => r.invoiceId))],
        reason,
      });
    }
    return { cancelled, reversals: await this.dtos(tx, reversals) };
  }

  /** Payment state for "unpaid" flags on queues and worklists, keyed by source ref, visit or admission id. */
  async paymentStates(
    tx: Tx,
    by: { module: string; refIds: string[] } | { visitIds: string[] } | { admissionIds: string[] },
  ): Promise<Map<string, B.SourcePaymentState>> {
    const rows = await this.repo.paymentStates(tx, by);
    const out = new Map<string, B.SourcePaymentState>();
    for (const r of rows) {
      out.set(r.key, Number(r.pending) > 0 ? 'pending' : Number(r.unpaid_bills) > 0 ? 'unpaid' : Number(r.billed) > 0 ? 'paid' : 'none');
    }
    return out;
  }

  // =====================================================================
  // Billing pending charges
  // =====================================================================

  /**
   * Turns pending charges (plus any extra desk lines) into one final invoice, inside the caller's
   * transaction: optional bill discount, advance adjustment and payment. Charges become `billed`.
   */
  async billCharges(tx: Tx, input: B.BillChargesInput, opts: { checkLimits?: boolean } = {}): Promise<B.Invoice> {
    const d = contracts.billChargesSchema.parse(input);
    const ctx = currentContext();
    await this.billingRepo.lockPatient(tx, d.patientId);
    const ids = [...new Set(d.chargeIds)];
    const rows = await this.repo.byIds(tx, ids, true);
    if (rows.length !== ids.length) throw notFound('Charge');
    const wrong = rows.find((r) => r.patientId !== d.patientId);
    if (wrong) throw badRequest('charge_other_patient', 'A charge belongs to another patient');
    const notPending = rows.find((r) => r.status !== 'pending');
    if (notPending) throw conflict('charge_not_pending', `"${notPending.description}" is already ${notPending.status}`);

    const facilityId = d.facilityId ?? rows[0]?.facilityId ?? this.billing.facilityFor(undefined);
    // Desk lines become charges first, so every invoice line has a charge behind it.
    if (d.extraLines.length) {
      const deskRef = randomUUID();
      for (const [i, l] of d.extraLines.entries()) {
        if (opts.checkLimits && l.serviceCode && l.unitPrice !== undefined) await this.requirePriceOverride(tx, l.serviceCode, l.unitPrice, d.payerId);
        const c = await this.postCharge(tx, {
          patientId: d.patientId,
          facilityId,
          source: { module: 'billing', refId: deskRef, line: String(i + 1) },
          serviceCode: l.serviceCode,
          itemId: l.itemId,
          description: l.description,
          hsnSac: l.hsnSac,
          qty: l.qty,
          unitPrice: l.unitPrice,
          taxRate: l.taxRate,
          discount: l.discount,
          priceIncludesTax: l.priceIncludesTax,
          doctorId: d.doctorId ?? undefined,
          standalone: true,
        });
        rows.push((await this.repo.byId(tx, c.id, true))!);
      }
    }

    // Lines in a stable order: by date, then as posted.
    rows.sort((a, b) => a.chargeDate.localeCompare(b.chargeDate) || String(a.createdAt).localeCompare(String(b.createdAt)));
    const lines = rows.map((r) => ({
      ...(r.serviceCode ? { serviceCode: r.serviceCode } : {}),
      ...(r.itemId ? { itemId: r.itemId } : {}),
      description: r.description,
      ...(r.hsnSac ? { hsnSac: r.hsnSac } : {}),
      qty: toNumber(r.qty),
      unitPrice: toNumber(r.unitPrice),
      taxRate: toNumber(r.taxRate),
      discount: paise(r.discount),
      priceIncludesTax: r.priceIncludesTax,
    }));

    if (d.discount) {
      const gross = lines.reduce((s, l) => s + Math.round(l.qty * paise(l.unitPrice)), 0);
      if (opts.checkLimits && ctx && !ctx.permissions.has('billing.discount.override')) {
        const rules = await this.rules(tx, facilityId);
        const already = lines.reduce((s, l) => s + l.discount, 0);
        if (paise(d.discount) + already > Math.floor((gross * rules.maxDiscountPct) / 100)) {
          throw new AppError(HttpStatus.FORBIDDEN, 'discount_limit', `You can give at most ${rules.maxDiscountPct}% discount on a bill`, {
            maxDiscountPct: rules.maxDiscountPct,
            missing: ['billing.discount.override'],
          });
        }
      }
      spreadDiscount(lines, paise(d.discount));
    }

    const doctors = [...new Set(rows.map((r) => r.doctorId).filter(Boolean))] as string[];
    // The patient's insurer / corporate is the bill's payer unless the desk chose self-pay (null).
    const payerId = d.payerId === undefined ? await this.repo.activePayer(tx, d.patientId, today()) : d.payerId;
    const created = await this.billing.createInvoice(tx, {
      patientId: d.patientId,
      facilityId,
      source: d.source ?? { module: 'billing' },
      payerId: payerId ?? undefined,
      doctorId: d.doctorId ?? (doctors.length === 1 ? doctors[0] : undefined),
      supplyType: d.supplyType,
      buyerGstin: d.buyerGstin,
      notes: d.notes,
      lines: lines.map((l) => ({ ...l, discount: l.discount ? toNumber(rupees(l.discount)) : undefined })),
      finalize: true,
    });

    const { userId } = await this.billingRepo.scope(tx);
    for (const [i, r] of rows.entries()) {
      await this.repo.update(tx, r.id, {
        status: 'billed',
        invoiceId: created.invoiceId,
        invoiceLineNo: i + 1,
        discount: rupees(lines[i]!.discount),
        updatedBy: userId,
      });
    }

    // Advance first, then money taken now.
    let due = paise(created.total);
    if (d.useDeposit && due > 0) {
      const available = paise(await this.billingRepo.depositBalance(tx, d.patientId));
      const take = Math.min(available, due);
      if (take > 0) {
        await this.billing.collectPaymentTx(tx, created.invoiceId, { mode: 'deposit', amount: take / 100 });
        due -= take;
      }
    }
    if (d.payNow) {
      const amount = Math.min(paise(d.payNow.amount), due);
      if (amount > 0) await this.billing.collectPaymentTx(tx, created.invoiceId, { mode: d.payNow.mode, amount: amount / 100, reference: d.payNow.ref });
    }

    const event: B.ChargesBilledEvent = {
      invoiceId: created.invoiceId,
      number: created.number!,
      patientId: d.patientId,
      charges: rows.map((r) => ({ chargeId: r.id, module: r.sourceModule, refId: r.sourceRef, line: r.sourceLine })),
    };
    await this.billing.publishEvent(tx, 'billing.charges.billed', { ...event });
    return this.billing.invoiceInTx(tx, created.invoiceId);
  }

  /** Bills every pending charge of one source (a "Collect now" button on a module's screen). */
  async billSource(tx: Tx, source: { module: string; refId: string }, extra: Omit<B.BillChargesInput, 'patientId' | 'chargeIds'> = {}): Promise<B.Invoice> {
    const rows = (await this.repo.bySource(tx, source.module, source.refId)).filter((r) => r.status === 'pending');
    if (!rows.length) throw badRequest('nothing_to_bill', 'There is nothing pending to bill for this');
    return this.billCharges(tx, { ...extra, patientId: rows[0]!.patientId, chargeIds: rows.map((r) => r.id) });
  }

  // =====================================================================
  // API (billing desk)
  // =====================================================================

  list(query: unknown): Promise<Paginated<B.Charge>> {
    const q = contracts.chargeQuerySchema.parse(query);
    return this.db.tx(async (tx) => {
      const { items, total } = await this.repo.search(tx, q);
      return { items: await this.dtos(tx, items), page: q.page, pageSize: q.pageSize, total };
    });
  }

  /** Everything the billing desk shows for one patient: pending charges grouped by visit / admission. */
  patientCharges(patientId: string): Promise<B.PatientCharges> {
    return this.db.tx(async (tx) => {
      const patient = await this.billingRepo.patientSnapshot(tx, patientId);
      if (!patient) throw notFound('Patient');
      const rows = await this.repo.forDesk(tx, patientId);
      const pending = rows.filter((r) => r.status === 'pending');
      const reversals = rows.filter((r) => r.status === 'billed');
      const charges = await this.dtos(tx, pending);
      const visits = await this.repo.visitLabels(tx, [...new Set(pending.flatMap((r) => (r.visitId ? [r.visitId] : [])))]);
      const admissions = await this.repo.admissionLabels(tx, [...new Set(pending.flatMap((r) => (r.admissionId ? [r.admissionId] : [])))]);
      const groups = new Map<string, B.ChargeGroup>();
      for (const c of charges) {
        const key = c.admissionId ? `ipd:${c.admissionId}` : c.visitId ? `opd:${c.visitId}` : 'other';
        let g = groups.get(key);
        if (!g) {
          const v = c.visitId ? visits.get(c.visitId) : undefined;
          const a = c.admissionId ? admissions.get(c.admissionId) : undefined;
          const label = a
            ? `IPD ${a.ipdNo}`
            : v
              ? ['OPD visit', v.doctorName ? `Dr. ${v.doctorName.replace(/^Dr\.?\s*/i, '')}` : null, formatDate(v.visitDate)].filter(Boolean).join(' · ')
              : 'Other charges';
          g = { account: c.account, visitId: c.visitId, admissionId: c.admissionId, label, charges: [], total: 0 };
          groups.set(key, g);
        }
        g.charges.push(c);
        g.total = toNumber(rupees(paise(g.total) + paise(c.amount)));
      }
      const [deposit, outstanding] = await Promise.all([this.billingRepo.depositBalance(tx, patientId), this.billingRepo.outstanding(tx, patientId)]);
      return {
        patientId,
        patientName: [patient.firstName, patient.lastName].filter(Boolean).join(' '),
        uhid: patient.uhid,
        mobile: patient.mobile,
        groups: [...groups.values()],
        pendingTotal: toNumber(rupees(charges.reduce((s, c) => s + paise(c.amount), 0))),
        depositBalance: toNumber(deposit),
        outstanding: toNumber(outstanding),
        payerId: await this.repo.activePayer(tx, patientId, today()),
        reversals: await this.dtos(tx, reversals),
      };
    });
  }

  unbilled(query: unknown): Promise<Paginated<B.UnbilledPatient>> {
    const q = contracts.unbilledQuerySchema.parse(query);
    return this.db.tx(async (tx) => {
      const { rows, total } = await this.repo.unbilled(tx, q);
      const pending = await this.repo.pendingFor(tx, rows.map((r) => r.patient_id));
      const totals = new Map<string, number>();
      for (const c of pending) totals.set(c.patientId, (totals.get(c.patientId) ?? 0) + amountPaise(c));
      return {
        items: rows.map((r) => ({
          patientId: r.patient_id,
          patientName: [r.first_name, r.last_name].filter(Boolean).join(' '),
          uhid: r.uhid,
          mobile: r.mobile,
          pendingCount: Number(r.pending_count),
          pendingTotal: toNumber(rupees(totals.get(r.patient_id) ?? 0)),
          oldestChargeAt: new Date(r.oldest).toISOString(),
          accounts: r.accounts as B.ChargeAccount[],
        })),
        page: q.page,
        pageSize: q.pageSize,
        total,
      };
    });
  }

  /** POST /billing/charges: a charge added by hand (billing desk, IPD "Post a charge"). */
  addManual(input: B.ManualChargeInput, module = 'billing'): Promise<B.Charge> {
    const d = contracts.manualChargeSchema.parse(input);
    return this.db.tx(async (tx) => {
      if (d.serviceCode && d.unitPrice !== undefined) await this.requirePriceOverride(tx, d.serviceCode, d.unitPrice, null);
      return this.postCharge(tx, { ...d, source: { module, refId: randomUUID() } });
    });
  }

  /** Cancels one pending charge (billed charges need a credit note instead). */
  cancel(id: string, input: B.CancelChargeInput): Promise<B.Charge> {
    const d = contracts.cancelChargeSchema.parse(input);
    return this.db.tx(async (tx) => {
      const row = await this.repo.byId(tx, id, true);
      if (!row) throw notFound('Charge');
      if (row.status === 'billed') throw conflict('charge_billed', 'This charge is already billed; issue a credit note on the bill instead');
      if (row.status === 'cancelled') throw conflict('charge_cancelled', 'This charge is already cancelled');
      const { userId } = await this.billingRepo.scope(tx);
      return this.dto(
        tx,
        await this.repo.update(tx, id, { status: 'cancelled', cancelReason: d.reason, cancelledAt: new Date().toISOString(), cancelledBy: userId, updatedBy: userId }),
      );
    });
  }

  /** POST /billing/charges/bill */
  billFromApi(input: B.BillChargesInput): Promise<B.Invoice> {
    const d = contracts.billChargesSchema.parse(input);
    requirePermission('billing.invoice.finalize');
    if (d.payNow || d.useDeposit) requirePermission('billing.payment.collect');
    return this.db.tx((tx) => this.billCharges(tx, d, { checkLimits: true }));
  }

  /** Credits the line of a billed charge whose source was cancelled; refunds when the bill was paid. */
  credit(id: string, input: B.CreditChargeInput): Promise<B.Invoice> {
    const d = contracts.creditChargeSchema.parse(input);
    return this.db.tx(async (tx) => {
      const row = await this.repo.byId(tx, id, true);
      if (!row) throw notFound('Charge');
      if (row.status !== 'billed' || !row.invoiceId) throw conflict('charge_not_billed', 'Only billed charges can be credited; cancel a pending charge instead');
      if (row.reversalDoneAt) throw conflict('charge_credited', 'This charge was already credited');
      const inv = await this.billing.invoiceInTx(tx, row.invoiceId);
      const line = inv.lines.find((l) => l.lineNo === row.invoiceLineNo);
      if (!line) throw notFound('Bill line');
      const reason = d.reason ?? row.reversalReason ?? `Cancelled: ${row.description}`;
      await this.billing.returnOnInvoice(tx, row.invoiceId, { amount: line.total, reason, refundMode: d.refundMode, reference: `charge:${row.id}` });
      const { userId } = await this.billingRepo.scope(tx);
      await this.repo.update(tx, id, { reversalDoneAt: new Date().toISOString(), reversalRequestedAt: row.reversalRequestedAt ?? new Date().toISOString(), reversalReason: reason, updatedBy: userId });
      return this.billing.invoiceInTx(tx, row.invoiceId);
    });
  }

  // ---------- helpers ----------

  /** Typing a price different from the list price for a master service needs billing.price.override. */
  private async requirePriceOverride(tx: Tx, serviceCode: string, unitPrice: number, payerId: string | null | undefined) {
    const ctx = currentContext();
    if (!ctx || ctx.permissions.has('billing.price.override')) return;
    const [svc] = await this.billingRepo.servicesByCode(tx, [serviceCode.toUpperCase()]);
    if (!svc) return;
    const listed = (await this.billingRepo.listPrices(tx, [svc.id], payerId, today())).get(svc.id);
    if (paise(listed?.price ?? svc.basePrice) !== paise(unitPrice)) {
      throw new AppError(HttpStatus.FORBIDDEN, 'price_override', `You cannot change the price of ${svc.name}`, { missing: ['billing.price.override'] });
    }
  }

  private async dto(tx: Tx, r: ChargeRow): Promise<B.Charge> {
    return (await this.dtos(tx, [r]))[0]!;
  }

  private async dtos(tx: Tx, rows: ChargeRow[]): Promise<B.Charge[]> {
    const numbers = await this.repo.invoiceNumbers(tx, [...new Set(rows.flatMap((r) => (r.invoiceId ? [r.invoiceId] : [])))]);
    return rows.map((r) => chargeDto(r, r.invoiceId ? (numbers.get(r.invoiceId) ?? null) : null));
  }
}

function requirePermission(key: string) {
  const ctx = currentContext();
  if (ctx && !ctx.permissions.has(key)) {
    throw new AppError(HttpStatus.FORBIDDEN, 'forbidden', 'You do not have permission to do this', { missing: [key] });
  }
}

/** Only the keys a level sets, dropping anything unknown. */
function cleanRules(raw: unknown): Partial<B.BillingRules> {
  if (!raw || typeof raw !== 'object') return {};
  const keys = Object.keys(contracts.DEFAULT_BILLING_RULES);
  return Object.fromEntries(Object.entries(raw as Record<string, unknown>).filter(([k]) => keys.includes(k))) as Partial<B.BillingRules>;
}

/** defaults ← hospital ← branch; a stored value that no longer validates falls back to the level below. */
export function mergeRules(defaults: B.BillingRules, ...levels: unknown[]): B.BillingRules {
  let out: B.BillingRules = { ...defaults };
  for (const level of levels) {
    for (const [k, v] of Object.entries(cleanRules(level))) {
      const candidate = { ...out, [k]: v };
      if (contracts.billingRulesSchema.safeParse(candidate).success) out = candidate as B.BillingRules;
    }
  }
  return out;
}

/** Spreads a bill discount (paise) over the lines, largest net amount first, never past a line's amount. */
function spreadDiscount(lines: { qty: number; unitPrice: number; discount: number }[], amount: number) {
  const order = [...lines].sort((a, b) => b.qty * b.unitPrice - b.discount - (a.qty * a.unitPrice - a.discount));
  const room = order.reduce((s, l) => s + Math.round(l.qty * paise(l.unitPrice)) - l.discount, 0);
  if (amount > room) throw badRequest('discount_too_high', 'The discount is more than the bill');
  let left = amount;
  for (const l of order) {
    const take = Math.min(left, Math.round(l.qty * paise(l.unitPrice)) - l.discount);
    l.discount += take;
    left -= take;
    if (!left) break;
  }
}

function amountPaise(r: ChargeRow): number {
  return computeLine({ qty: toNumber(r.qty), unitPrice: paise(r.unitPrice), discount: paise(r.discount), taxRate: toNumber(r.taxRate), priceIncludesTax: r.priceIncludesTax }).total;
}

function formatDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function chargeDto(r: ChargeRow, invoiceNumber: string | null): B.Charge {
  return {
    id: r.id,
    patientId: r.patientId,
    facilityId: r.facilityId,
    account: r.account as B.ChargeAccount,
    visitId: r.visitId,
    admissionId: r.admissionId,
    sourceModule: r.sourceModule,
    sourceRef: r.sourceRef,
    sourceLine: r.sourceLine,
    serviceId: r.serviceId,
    serviceCode: r.serviceCode,
    itemId: r.itemId,
    description: r.description,
    hsnSac: r.hsnSac,
    qty: toNumber(r.qty),
    unitPrice: toNumber(r.unitPrice),
    priceIncludesTax: r.priceIncludesTax,
    taxRate: toNumber(r.taxRate),
    discount: toNumber(r.discount),
    amount: toNumber(rupees(amountPaise(r))),
    doctorId: r.doctorId,
    chargeDate: r.chargeDate,
    status: r.status as B.ChargeStatus,
    invoiceId: r.invoiceId,
    invoiceNumber,
    reversalRequestedAt: r.reversalRequestedAt ? new Date(r.reversalRequestedAt).toISOString() : null,
    reversalReason: r.reversalReason,
    cancelReason: r.cancelReason,
    notes: r.notes,
    createdAt: new Date(r.createdAt).toISOString(),
  };
}
