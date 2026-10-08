import { Injectable } from '@nestjs/common';
import { formatSeries, iso, nextCounter, type Tx } from '@hms/db';
import { insurance as contracts, todayIso, type Paginated } from '@hms/shared';
import type { insurance as I } from '@hms/shared';
import type { z } from 'zod';
import { DbService } from '../../common/db/db.service';
import { OutboxService } from '../../common/events/outbox.service';
import { currentContext } from '../../common/context/request-context';
import { badRequest, conflict, forbidden, notFound } from '../../common/errors/errors';
import { BillingService } from '../billing/billing.service';
import { PatientsService } from '../patients/patients.service';
import {
  InsuranceRepository,
  type CaseEventRow,
  type ClaimInvoiceRow,
  type ClaimRow,
  type DocumentRow,
  type NewPayerRow,
  type NewPolicyRow,
  type PackageRow,
  type PayerRow,
  type PolicyRow,
  type PostingRow,
  type PreauthRow,
  type SettlementRow,
} from './insurance.repository';

/** Business date in India (the server runs in UTC). */
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const daysBetween = (from: string, to: string) => Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** Money: paise as integers internally, rupee strings for numeric(14,2) columns. */
const paise = (v: string | number | null | undefined) => Math.round(Number(v ?? 0) * 100);
const rupees = (p: number) => (p / 100).toFixed(2);
const num = (v: string | number | null | undefined) => (v == null ? null : Number(v));
const amt = (v: string | number | null | undefined) => Number(v ?? 0);
const blank = <T>(v: T | '' | undefined): T | null | undefined => (v === '' ? null : v);

const OPEN: readonly string[] = contracts.OPEN_CLAIM_STATUSES;

/** Documents a new claim starts with; `required` ones must be received before submitting. */
function defaultDocuments(c: { preauthId: string | null; admissionDate: string | null; claimType: string }) {
  const docs: { docType: I.DocumentType; title: string; required: boolean }[] = [];
  if (c.preauthId) docs.push({ docType: 'preauth_form', title: 'Approved pre-authorisation letter', required: true });
  docs.push(
    { docType: 'policy_card', title: 'Policy / e-card / scheme card copy', required: true },
    { docType: 'id_proof', title: 'Patient photo ID (Aadhaar / PAN)', required: true },
    { docType: 'final_bill', title: 'Final bill with break-up', required: true },
  );
  if (c.admissionDate) docs.push({ docType: 'discharge_summary', title: 'Discharge summary', required: true });
  docs.push(
    { docType: 'investigation_reports', title: 'Investigation reports', required: false },
    { docType: 'pharmacy_bills', title: 'Pharmacy bills', required: false },
  );
  if (c.claimType === 'cashless') docs.push({ docType: 'claim_form', title: 'Claim form signed by patient and hospital', required: true });
  return docs;
}

/**
 * Insurance rules: payers and scheme packages, patient policies, pre-auths, claims, settlements.
 * Settlements post to billing through BillingService (receipts for money and TDS, credit notes for
 * write-offs). `getInvoiceSplit()` is the contract other modules use to show what the patient owes.
 */
@Injectable()
export class InsuranceService {
  constructor(
    private readonly db: DbService,
    private readonly repo: InsuranceRepository,
    private readonly outbox: OutboxService,
    private readonly billing: BillingService,
    private readonly patients: PatientsService,
  ) {}

  // =====================================================================
  // Payers and packages
  // =====================================================================

  listPayers(query: unknown): Promise<Paginated<I.Payer>> {
    const f = contracts.payerQuerySchema.parse(query);
    return this.db.tx(async (tx) => {
      const { items, total } = await this.repo.listPayers(tx, f);
      return { items: items.map(payerDto), page: f.page, pageSize: f.pageSize, total };
    });
  }

  getPayer(id: string): Promise<I.Payer> {
    return this.db.tx(async (tx) => payerDto(await this.mustPayer(tx, id)));
  }

  createPayer(input: I.PayerInput): Promise<I.Payer> {
    const d = contracts.payerInputSchema.parse(input);
    const userId = currentContext()?.userId ?? null;
    return this.db.tx(async (tx) => {
      if (await this.repo.payerByCode(tx, d.code)) throw conflict('payer_code_taken', `Payer code ${d.code} is already used`);
      const row = await this.repo.insertPayer(tx, { ...payerColumns(d), code: d.code, name: d.name, type: d.type, createdBy: userId, updatedBy: userId } as NewPayerRow);
      return payerDto(row);
    });
  }

  updatePayer(id: string, input: I.UpdatePayer): Promise<I.Payer> {
    const d = contracts.updatePayerSchema.parse(input);
    return this.db.tx(async (tx) => {
      const cur = await this.mustPayer(tx, id);
      const type = d.type ?? cur.type;
      const scheme = d.scheme !== undefined ? d.scheme : cur.scheme;
      if (type === 'government' && !scheme) throw badRequest('scheme_required', 'Pick the scheme for a government payer');
      const row = await this.repo.updatePayer(tx, id, { ...payerColumns(d), updatedBy: currentContext()?.userId ?? null });
      return payerDto(row!);
    });
  }

  listPackages(payerId: string, all: boolean): Promise<I.SchemePackage[]> {
    return this.db.tx(async (tx) => {
      await this.mustPayer(tx, payerId);
      return (await this.repo.packages(tx, payerId, !all)).map(packageDto);
    });
  }

  createPackage(payerId: string, input: I.PackageInput): Promise<I.SchemePackage> {
    const d = contracts.packageInputSchema.parse(input);
    const userId = currentContext()?.userId ?? null;
    return this.db.tx(async (tx) => {
      await this.mustPayer(tx, payerId);
      if ((await this.repo.packages(tx, payerId, false)).some((p) => p.code === d.code)) {
        throw conflict('package_code_taken', `Package ${d.code} already exists for this payer`);
      }
      const row = await this.repo.insertPackage(tx, {
        payerId,
        code: d.code,
        name: d.name,
        specialty: d.specialty ?? null,
        rate: rupees(paise(d.rate)),
        losDays: d.losDays ?? null,
        preauthRequired: d.preauthRequired,
        inclusions: d.inclusions ?? null,
        isActive: d.isActive,
        createdBy: userId,
        updatedBy: userId,
      });
      return packageDto(row);
    });
  }

  updatePackage(payerId: string, id: string, input: I.UpdatePackage): Promise<I.SchemePackage> {
    const d = contracts.updatePackageSchema.parse(input);
    return this.db.tx(async (tx) => {
      const cur = await this.repo.packageById(tx, id);
      if (!cur || cur.payerId !== payerId) throw notFound('Package');
      const row = await this.repo.updatePackage(tx, id, {
        ...(d.name !== undefined && { name: d.name }),
        ...(d.specialty !== undefined && { specialty: d.specialty }),
        ...(d.rate !== undefined && { rate: rupees(paise(d.rate)) }),
        ...(d.losDays !== undefined && { losDays: d.losDays }),
        ...(d.preauthRequired !== undefined && { preauthRequired: d.preauthRequired }),
        ...(d.inclusions !== undefined && { inclusions: d.inclusions }),
        ...(d.isActive !== undefined && { isActive: d.isActive }),
        updatedBy: currentContext()?.userId ?? null,
      });
      return packageDto(row!);
    });
  }

  private async mustPayer(tx: Tx, id: string): Promise<PayerRow> {
    const row = await this.repo.payerById(tx, id);
    if (!row) throw notFound('Payer');
    return row;
  }

  // =====================================================================
  // Policies
  // =====================================================================

  listPolicies(query: unknown): Promise<Paginated<I.Policy>> {
    const f = contracts.policyQuerySchema.parse(query);
    return this.db.tx(async (tx) => {
      const { items, total } = await this.repo.listPolicies(tx, f);
      return { items: await this.policyDtos(tx, items), page: f.page, pageSize: f.pageSize, total };
    });
  }

  getPolicy(id: string): Promise<I.Policy> {
    return this.db.tx(async (tx) => this.policyTx(tx, id));
  }

  async createPolicy(input: I.PolicyInput): Promise<I.Policy> {
    const d = contracts.policyInputSchema.parse(input);
    const patient = await this.patients.get(d.patientId);
    const userId = currentContext()?.userId ?? null;
    return this.db.tx(async (tx) => {
      await this.checkPolicyPayers(tx, d.payerId, d.tpaId ?? null);
      const row = await this.repo.insertPolicy(tx, {
        ...policyColumns(d),
        patientId: patient.id,
        patientName: [patient.firstName, patient.lastName].filter(Boolean).join(' '),
        patientUhid: patient.uhid,
        payerId: d.payerId,
        policyNumber: d.policyNumber,
        createdBy: userId,
        updatedBy: userId,
      } as Omit<NewPolicyRow, 'tenantId'>).catch((e: unknown) => {
        throw isUnique(e) ? conflict('policy_exists', 'This patient already has this policy number with this payer') : e;
      });
      return (await this.policyDtos(tx, [row]))[0]!;
    });
  }

  updatePolicy(id: string, input: I.UpdatePolicy): Promise<I.Policy> {
    const d = contracts.updatePolicySchema.parse(input);
    return this.db.tx(async (tx) => {
      const cur = await this.repo.policyById(tx, id, true);
      if (!cur) throw notFound('Policy');
      if (d.payerId !== undefined || d.tpaId !== undefined) {
        await this.checkPolicyPayers(tx, d.payerId ?? cur.payerId, d.tpaId !== undefined ? (d.tpaId ?? null) : cur.tpaId);
      }
      const from = d.validFrom !== undefined ? d.validFrom : cur.validFrom;
      const to = d.validTo !== undefined ? d.validTo : cur.validTo;
      if (from && to && to < from) throw badRequest('invalid_dates', 'End date is before start date');
      await this.repo.updatePolicy(tx, id, { ...policyColumns(d), verifiedAt: null, updatedBy: currentContext()?.userId ?? null });
      return this.policyTx(tx, id);
    });
  }

  /** Eligibility check against what is on file. Mock: no call to the insurer, TPA or NHA is made. */
  verifyPolicy(id: string): Promise<I.EligibilityResult> {
    return this.db.tx(async (tx) => {
      const policy = await this.repo.policyById(tx, id, true);
      if (!policy) throw notFound('Policy');
      const payers = await this.repo.payersByIds(tx, [policy.payerId, ...(policy.tpaId ? [policy.tpaId] : [])]);
      const used = (await this.repo.usedByPolicy(tx, [id])).get(id) ?? 0;
      const reasons: string[] = [];
      const t = today();
      if (!policy.isActive) reasons.push('Policy is marked inactive');
      if (!payers.get(policy.payerId)?.isActive) reasons.push('Payer is inactive');
      if (policy.tpaId && !payers.get(policy.tpaId)?.isActive) reasons.push('TPA is inactive');
      if (policy.validFrom && policy.validFrom > t) reasons.push(`Cover starts on ${policy.validFrom}`);
      if (policy.validTo && policy.validTo < t) reasons.push(`Cover ended on ${policy.validTo}`);
      if (policy.sumInsured != null && paise(policy.sumInsured) - Math.round(used * 100) <= 0) reasons.push('Sum insured is used up');
      const eligible = reasons.length === 0;
      const checkedAt = new Date().toISOString();
      if (eligible) await this.repo.updatePolicy(tx, id, { verifiedAt: checkedAt, verifiedBy: currentContext()?.userId ?? null });
      return { policyId: id, eligible, reasons, checkedAt };
    });
  }

  private async checkPolicyPayers(tx: Tx, payerId: string, tpaId: string | null) {
    const payers = await this.repo.payersByIds(tx, [payerId, ...(tpaId ? [tpaId] : [])]);
    const payer = payers.get(payerId);
    if (!payer) throw notFound('Payer');
    if (payer.type === 'tpa') throw badRequest('payer_is_tpa', 'Pick the insurer as the payer and the TPA separately');
    if (tpaId) {
      const tpa = payers.get(tpaId);
      if (!tpa) throw notFound('TPA');
      if (tpa.type !== 'tpa') throw badRequest('not_a_tpa', `${tpa.name} is not a TPA`);
    }
  }

  private async policyTx(tx: Tx, id: string): Promise<I.Policy> {
    const row = await this.repo.policyById(tx, id);
    if (!row) throw notFound('Policy');
    return (await this.policyDtos(tx, [row]))[0]!;
  }

  private async policyDtos(tx: Tx, rows: PolicyRow[]): Promise<I.Policy[]> {
    const payers = await this.repo.payersByIds(tx, rows.flatMap((r) => [r.payerId, ...(r.tpaId ? [r.tpaId] : [])]));
    const used = await this.repo.usedByPolicy(tx, rows.filter((r) => r.sumInsured != null).map((r) => r.id));
    return rows.map((r) => policyDto(r, payers, used.get(r.id) ?? 0));
  }

  // =====================================================================
  // Pre-authorisation
  // =====================================================================

  listPreauths(query: unknown): Promise<Paginated<I.PreauthSummary>> {
    const f = contracts.preauthQuerySchema.parse(query);
    return this.db.tx(async (tx) => {
      const { items, total } = await this.repo.listPreauths(tx, f);
      const payers = await this.repo.payersByIds(tx, items.map((i) => i.payerId));
      return { items: items.map((r) => preauthSummaryDto(r, payers)), page: f.page, pageSize: f.pageSize, total };
    });
  }

  /**
   * The approved pre-auth for an IPD stay (cross-module, inside the caller's transaction), for the
   * "estimate vs actual" line on the running bill. A pre-auth whose admission reference is the admission
   * id or IPD number wins; otherwise an approved pre-auth with no reference, raised from 30 days before
   * the admission on. Null when there is none.
   */
  async approvedPreauthForAdmission(
    tx: Tx,
    a: { patientId: string; admissionId: string; ipdNo: string; admittedOn: string },
  ): Promise<{ preauthId: string; number: string; payerName: string; approvedAmount: number } | null> {
    const rows = await this.repo.approvedPreauths(tx, a.patientId);
    const ref = (r: PreauthRow) => (r.admissionRef ?? '').trim().toUpperCase();
    const match =
      rows.find((r) => ref(r) === a.admissionId.toUpperCase() || ref(r) === a.ipdNo.toUpperCase()) ??
      rows.find((r) => !ref(r) && iso(r.createdAt).slice(0, 10) >= addDays(a.admittedOn, -30));
    if (!match || match.approvedAmount == null) return null;
    const payer = await this.repo.payerById(tx, match.payerId);
    return { preauthId: match.id, number: match.number, payerName: payer?.name ?? '', approvedAmount: amt(match.approvedAmount) };
  }

  getPreauth(id: string): Promise<I.Preauth> {
    return this.db.tx((tx) => this.preauthTx(tx, id));
  }

  createPreauth(input: I.PreauthInput): Promise<I.Preauth> {
    const d = contracts.preauthInputSchema.parse(input);
    const facilityId = resolveFacility(d.facilityId);
    const userId = currentContext()?.userId ?? null;
    return this.db.tx(async (tx) => {
      const policy = await this.livePolicy(tx, d.policyId);
      if (d.packageId) await this.checkPackage(tx, d.packageId, policy);
      const requested = d.requestedAmount ?? d.estimatedAmount;
      const row = await this.repo.insertPreauth(tx, {
        number: formatSeries('PA', await nextCounter(tx, 'insurance.preauth')),
        facilityId,
        patientId: policy.patientId,
        patientName: policy.patientName,
        patientUhid: policy.patientUhid,
        policyId: policy.id,
        payerId: policy.tpaId ?? policy.payerId,
        doctorId: d.doctorId ?? null,
        packageId: d.packageId ?? null,
        admissionRef: d.admissionRef ?? null,
        diagnosis: d.diagnosis,
        icdCodes: d.icdCodes,
        procedure: d.procedure ?? null,
        expectedAdmission: d.expectedAdmission ?? null,
        expectedLosDays: d.expectedLosDays ?? null,
        estimatedAmount: rupees(paise(d.estimatedAmount)),
        requestedAmount: rupees(paise(requested)),
        notes: d.notes ?? null,
        createdBy: userId,
        updatedBy: userId,
      });
      await this.repo.addEvent(tx, { entity: 'preauth', entityId: row.id, action: 'created', toStatus: 'draft', amount: row.requestedAmount, createdBy: userId });
      return this.preauthTx(tx, row.id);
    });
  }

  updatePreauth(id: string, input: I.UpdatePreauth): Promise<I.Preauth> {
    const d = contracts.updatePreauthSchema.parse(input);
    return this.db.tx(async (tx) => {
      const cur = await this.mustPreauth(tx, id);
      if (!['draft', 'query'].includes(cur.status)) throw conflict('preauth_locked', 'Only a draft or a pre-auth under query can be edited');
      if (d.packageId) await this.checkPackage(tx, d.packageId, (await this.repo.policyById(tx, cur.policyId))!);
      await this.repo.updatePreauth(tx, id, {
        ...(d.doctorId !== undefined && { doctorId: d.doctorId }),
        ...(d.packageId !== undefined && { packageId: d.packageId }),
        ...(d.admissionRef !== undefined && { admissionRef: d.admissionRef }),
        ...(d.diagnosis !== undefined && { diagnosis: d.diagnosis }),
        ...(d.icdCodes !== undefined && { icdCodes: d.icdCodes }),
        ...(d.procedure !== undefined && { procedure: d.procedure }),
        ...(d.expectedAdmission !== undefined && { expectedAdmission: d.expectedAdmission }),
        ...(d.expectedLosDays !== undefined && { expectedLosDays: d.expectedLosDays }),
        ...(d.estimatedAmount !== undefined && { estimatedAmount: rupees(paise(d.estimatedAmount)) }),
        ...(d.requestedAmount !== undefined && { requestedAmount: rupees(paise(d.requestedAmount)) }),
        ...(d.notes !== undefined && { notes: d.notes }),
        updatedBy: currentContext()?.userId ?? null,
      });
      return this.preauthTx(tx, id);
    });
  }

  submitPreauth(id: string, input: I.SubmitInput): Promise<I.Preauth> {
    const d = contracts.submitSchema.parse(input);
    return this.preauthTransition(id, ['draft', 'query'], 'submitted', async (tx, cur) => {
      await this.livePolicy(tx, cur.policyId);
      return {
        action: cur.status === 'draft' ? 'submitted' : 'query_answered',
        note: d.note,
        set: { submittedAt: cur.submittedAt ?? new Date().toISOString(), ...(d.payerRef && { payerRef: d.payerRef }) },
      };
    });
  }

  queryPreauth(id: string, input: I.ReasonInput): Promise<I.Preauth> {
    const d = contracts.reasonSchema.parse(input);
    return this.preauthTransition(id, ['submitted'], 'query', async () => ({ action: 'query_raised', note: d.note }));
  }

  approvePreauth(id: string, input: I.PreauthApprove): Promise<I.Preauth> {
    const d = contracts.preauthApproveSchema.parse(input);
    return this.preauthTransition(id, ['submitted', 'query'], 'approved', async (tx, cur) => {
      if (paise(d.approvedAmount) > paise(cur.requestedAmount)) {
        throw badRequest('approval_exceeds_request', `Approved amount is more than the ₹${amt(cur.requestedAmount)} requested`);
      }
      const event: I.PreauthApprovedEvent = { preauthId: cur.id, number: cur.number, patientId: cur.patientId, payerId: cur.payerId, approvedAmount: d.approvedAmount };
      await this.outbox.publish(tx, 'insurance.preauth.approved', { ...event });
      return {
        action: 'approved',
        note: d.note,
        amount: rupees(paise(d.approvedAmount)),
        set: {
          approvedAmount: rupees(paise(d.approvedAmount)),
          decidedAt: new Date().toISOString(),
          ...(d.payerRef && { payerRef: d.payerRef }),
          ...(d.validUntil && { validUntil: d.validUntil }),
        },
      };
    });
  }

  rejectPreauth(id: string, input: I.ReasonInput): Promise<I.Preauth> {
    const d = contracts.reasonSchema.parse(input);
    return this.preauthTransition(id, ['submitted', 'query'], 'rejected', async () => ({ action: 'rejected', note: d.note, set: { decidedAt: new Date().toISOString() } }));
  }

  cancelPreauth(id: string, input: I.ReasonInput): Promise<I.Preauth> {
    const d = contracts.reasonSchema.parse(input);
    return this.preauthTransition(id, ['draft', 'submitted', 'query', 'approved'], 'cancelled', async (tx, cur) => {
      if ((await this.repo.preauthUsed(tx, cur.id)) > 0) throw conflict('preauth_in_use', 'A claim uses this pre-auth; cancel the claim first');
      return { action: 'cancelled', note: d.note };
    });
  }

  /** Ask the payer for more (enhancement): an approved pre-auth goes back to submitted with a higher request. */
  enhancePreauth(id: string, input: I.PreauthEnhance): Promise<I.Preauth> {
    const d = contracts.preauthEnhanceSchema.parse(input);
    return this.preauthTransition(id, ['approved'], 'submitted', async (_tx, cur) => {
      if (paise(d.requestedAmount) <= paise(cur.approvedAmount)) {
        throw badRequest('enhancement_too_small', `Ask for more than the ₹${amt(cur.approvedAmount)} already approved`);
      }
      return { action: 'enhancement_requested', note: d.note, amount: rupees(paise(d.requestedAmount)), set: { requestedAmount: rupees(paise(d.requestedAmount)) } };
    });
  }

  private preauthTransition(
    id: string,
    from: I.PreauthStatus[],
    to: I.PreauthStatus,
    fn: (tx: Tx, cur: PreauthRow) => Promise<{ action: string; note?: string; amount?: string; set?: Partial<PreauthRow> }>,
  ): Promise<I.Preauth> {
    return this.db.tx(async (tx) => {
      const cur = await this.mustPreauth(tx, id, true);
      if (!from.includes(cur.status as I.PreauthStatus)) {
        throw conflict('invalid_status', `A pre-auth that is ${cur.status} cannot be moved to ${to}`);
      }
      const r = await fn(tx, cur);
      const userId = currentContext()?.userId ?? null;
      await this.repo.updatePreauth(tx, id, { ...r.set, status: to, updatedBy: userId });
      await this.repo.addEvent(tx, { entity: 'preauth', entityId: id, action: r.action, fromStatus: cur.status, toStatus: to, amount: r.amount ?? null, note: r.note ?? null, createdBy: userId });
      return this.preauthTx(tx, id);
    });
  }

  private async mustPreauth(tx: Tx, id: string, lock = false): Promise<PreauthRow> {
    const row = await this.repo.preauthById(tx, id, lock);
    if (!row) throw notFound('Pre-auth');
    return row;
  }

  private async preauthTx(tx: Tx, id: string): Promise<I.Preauth> {
    const r = await this.mustPreauth(tx, id);
    const [policy, pkg, history] = await Promise.all([
      this.policyTx(tx, r.policyId),
      r.packageId ? this.repo.packageById(tx, r.packageId) : Promise.resolve(undefined),
      this.repo.events(tx, 'preauth', id),
    ]);
    const payers = await this.repo.payersByIds(tx, [r.payerId]);
    return {
      ...preauthSummaryDto(r, payers),
      doctorId: r.doctorId,
      packageId: r.packageId,
      packageCode: pkg?.code ?? null,
      packageName: pkg?.name ?? null,
      admissionRef: r.admissionRef,
      icdCodes: r.icdCodes,
      procedure: r.procedure,
      expectedAdmission: r.expectedAdmission,
      expectedLosDays: r.expectedLosDays,
      estimatedAmount: amt(r.estimatedAmount),
      payerRef: r.payerRef,
      validUntil: r.validUntil,
      notes: r.notes,
      policy,
      history: history.map(eventDto),
    };
  }

  private async livePolicy(tx: Tx, id: string): Promise<PolicyRow> {
    const policy = await this.repo.policyById(tx, id);
    if (!policy) throw notFound('Policy');
    if (!policy.isActive) throw conflict('policy_inactive', 'This policy is inactive');
    if (policy.validTo && policy.validTo < today()) throw conflict('policy_expired', `This policy ended on ${policy.validTo}`);
    return policy;
  }

  private async checkPackage(tx: Tx, packageId: string, policy: PolicyRow): Promise<PackageRow> {
    const pkg = await this.repo.packageById(tx, packageId);
    if (!pkg || (pkg.payerId !== policy.payerId && pkg.payerId !== policy.tpaId)) throw badRequest('package_not_for_payer', 'That package belongs to another payer');
    if (!pkg.isActive) throw badRequest('package_inactive', 'That package is inactive');
    return pkg;
  }

  // =====================================================================
  // Claims
  // =====================================================================

  listClaims(query: unknown): Promise<Paginated<I.ClaimSummary>> {
    const f = contracts.claimQuerySchema.parse(query);
    return this.db.tx(async (tx) => {
      const { items, total } = await this.repo.listClaims(tx, f);
      const payers = await this.repo.payersByIds(tx, items.map((i) => i.payerId));
      return { items: items.map((r) => claimSummaryDto(r, payers)), page: f.page, pageSize: f.pageSize, total };
    });
  }

  getClaim(id: string): Promise<I.Claim> {
    return this.db.tx((tx) => this.claimTx(tx, id));
  }

  /** Prepare a claim from final bills. Shares default to the unpaid balance less co-pay, within the pre-auth and sum insured. */
  async createClaim(input: I.ClaimInput): Promise<I.Claim> {
    const d = contracts.claimInputSchema.parse(input);
    const facilityId = resolveFacility(d.facilityId);
    const userId = currentContext()?.userId ?? null;
    // Bills are read through billing's service (its own transaction); the unique index on live links guards races.
    const bills = await Promise.all(d.invoices.map((i) => this.billing.getInvoice(i.invoiceId)));
    return this.db.tx(async (tx) => {
      const policy = await this.livePolicy(tx, d.policyId);
      const payers = await this.repo.payersByIds(tx, [policy.payerId, ...(policy.tpaId ? [policy.tpaId] : [])]);
      const copay = policy.copayPercent != null ? Number(policy.copayPercent) : Number(payers.get(policy.payerId)?.copayPercent ?? 0);

      let cap = Number.POSITIVE_INFINITY;
      let preauth: PreauthRow | undefined;
      if (d.preauthId) {
        preauth = await this.mustPreauth(tx, d.preauthId);
        if (preauth.policyId !== policy.id) throw badRequest('preauth_other_policy', 'That pre-auth is for another policy');
        if (preauth.status !== 'approved') throw conflict('preauth_not_approved', `Pre-auth ${preauth.number} is ${preauth.status}, not approved`);
        cap = Math.min(cap, paise(preauth.approvedAmount) - paise(await this.repo.preauthUsed(tx, preauth.id)));
      }
      if (policy.sumInsured != null) {
        const used = (await this.repo.usedByPolicy(tx, [policy.id])).get(policy.id) ?? 0;
        cap = Math.min(cap, paise(policy.sumInsured) - Math.round(used * 100));
      }
      if (cap <= 0) throw conflict('no_cover_left', 'Nothing is left to claim on this pre-auth / sum insured');

      const taken = await this.repo.liveLinks(tx, bills.map((b) => b.id));
      if (taken.length) throw conflict('invoice_already_claimed', `Bill ${taken[0]!.link.invoiceNumber} is already on claim ${taken[0]!.claim.number}`);

      let remaining = cap;
      const links = d.invoices.map((wanted, i) => {
        const bill = bills[i]!;
        if (bill.status !== 'final') throw badRequest('invoice_not_final', `Bill ${bill.number ?? '(draft)'} is not final`);
        if (bill.patientId !== policy.patientId) throw badRequest('invoice_other_patient', `Bill ${bill.number} is for another patient`);
        const balance = paise(bill.balance);
        let share: number;
        if (wanted.payerAmount !== undefined) {
          share = paise(wanted.payerAmount);
          if (share > balance) throw badRequest('share_exceeds_balance', `Payer share on ${bill.number} is more than its unpaid ₹${rupees(balance)}`);
        } else {
          share = Math.min(Math.round((balance * (100 - copay)) / 100), Math.max(remaining, 0));
        }
        remaining -= share;
        return { bill, share };
      });
      const claimed = links.reduce((a, l) => a + l.share, 0);
      if (claimed <= 0) throw badRequest('nothing_to_claim', 'The payer share comes to ₹0 on these bills');
      if (claimed > cap) throw badRequest('exceeds_cover', `Claim of ₹${rupees(claimed)} is more than the ₹${rupees(cap)} cover left`);

      const row = await this.repo.insertClaim(tx, {
        number: formatSeries('CLM', await nextCounter(tx, 'insurance.claim')),
        facilityId,
        patientId: policy.patientId,
        patientName: policy.patientName,
        patientUhid: policy.patientUhid,
        policyId: policy.id,
        payerId: policy.tpaId ?? policy.payerId,
        preauthId: preauth?.id ?? null,
        claimType: d.claimType,
        admissionDate: d.admissionDate ?? null,
        dischargeDate: d.dischargeDate ?? null,
        diagnosis: d.diagnosis ?? preauth?.diagnosis ?? null,
        notes: d.notes ?? null,
        claimedAmount: rupees(claimed),
        createdBy: userId,
        updatedBy: userId,
      });
      await this.repo
        .insertClaimInvoices(
          tx,
          links.map((l) => ({
            claimId: row.id,
            invoiceId: l.bill.id,
            invoiceNumber: l.bill.number!,
            invoiceDate: l.bill.invoiceDate,
            invoiceTotal: rupees(paise(l.bill.total)),
            payerAmount: rupees(l.share),
            patientAmount: rupees(paise(l.bill.total) - l.share),
          })),
        )
        .catch((e: unknown) => {
          throw isUnique(e) ? conflict('invoice_already_claimed', 'One of these bills was just put on another claim') : e;
        });
      await this.repo.insertDocuments(
        tx,
        defaultDocuments(row).map((doc) => ({ ...doc, claimId: row.id, createdBy: userId, updatedBy: userId })),
      );
      await this.repo.addEvent(tx, { entity: 'claim', entityId: row.id, action: 'created', toStatus: 'draft', amount: row.claimedAmount, createdBy: userId });
      return this.claimTx(tx, row.id);
    });
  }

  async updateClaim(id: string, input: I.UpdateClaim): Promise<I.Claim> {
    const d = contracts.updateClaimSchema.parse(input);
    const bills = d.invoices ? await Promise.all(d.invoices.map((i) => this.billing.getInvoice(i.invoiceId))) : [];
    return this.db.tx(async (tx) => {
      const cur = await this.mustClaim(tx, id, true);
      if (['settled', 'rejected', 'cancelled'].includes(cur.status)) throw conflict('claim_closed', `This claim is ${cur.status}`);
      const userId = currentContext()?.userId ?? null;
      const set: Partial<ClaimRow> = { updatedBy: userId };
      if (d.admissionDate !== undefined) set.admissionDate = d.admissionDate;
      if (d.dischargeDate !== undefined) set.dischargeDate = d.dischargeDate;
      if (d.diagnosis !== undefined) set.diagnosis = d.diagnosis;
      if (d.notes !== undefined) set.notes = d.notes;
      const adm = set.admissionDate !== undefined ? set.admissionDate : cur.admissionDate;
      const dis = set.dischargeDate !== undefined ? set.dischargeDate : cur.dischargeDate;
      if (adm && dis && dis < adm) throw badRequest('invalid_dates', 'Discharge is before admission');

      if (d.invoices?.length) {
        if (cur.status !== 'draft') throw conflict('claim_submitted', 'Shares can only be changed while the claim is a draft');
        const links = new Map((await this.repo.claimInvoices(tx, id)).map((l) => [l.invoiceId, l]));
        for (const [i, w] of d.invoices.entries()) {
          const link = links.get(w.invoiceId);
          if (!link) throw badRequest('invoice_not_on_claim', 'That bill is not on this claim');
          const share = paise(w.payerAmount);
          if (share > paise(bills[i]!.balance)) throw badRequest('share_exceeds_balance', `Payer share on ${link.invoiceNumber} is more than its unpaid ₹${bills[i]!.balance}`);
          await this.repo.updateClaimInvoice(tx, id, w.invoiceId, { payerAmount: rupees(share), patientAmount: rupees(paise(link.invoiceTotal) - share) });
          links.set(w.invoiceId, { ...link, payerAmount: rupees(share) });
        }
        const claimed = [...links.values()].reduce((a, l) => a + paise(l.payerAmount), 0);
        if (claimed <= 0) throw badRequest('nothing_to_claim', 'The payer share comes to ₹0');
        const cap = await this.coverLeft(tx, cur);
        if (claimed > cap) throw badRequest('exceeds_cover', `Claim of ₹${rupees(claimed)} is more than the ₹${rupees(cap)} cover left`);
        set.claimedAmount = rupees(claimed);
      }
      await this.repo.updateClaim(tx, id, set);
      return this.claimTx(tx, id);
    });
  }

  private async coverLeft(tx: Tx, claim: ClaimRow): Promise<number> {
    let cap = Number.POSITIVE_INFINITY;
    if (claim.preauthId) {
      const pa = await this.mustPreauth(tx, claim.preauthId);
      cap = Math.min(cap, paise(pa.approvedAmount) - paise(await this.repo.preauthUsed(tx, pa.id, claim.id)));
    }
    const policy = (await this.repo.policyById(tx, claim.policyId))!;
    if (policy.sumInsured != null) {
      const used = (await this.repo.usedByPolicy(tx, [policy.id], claim.id)).get(policy.id) ?? 0;
      cap = Math.min(cap, paise(policy.sumInsured) - Math.round(used * 100));
    }
    return cap;
  }

  submitClaim(id: string, input: I.SubmitInput): Promise<I.Claim> {
    const d = contracts.submitSchema.parse(input);
    return this.claimTransition(id, ['draft', 'query'], 'submitted', async (tx, cur) => {
      const missing = (await this.repo.documents(tx, id)).filter((doc) => doc.required && !doc.receivedAt);
      if (missing.length) {
        throw badRequest('documents_missing', `Collect these documents first: ${missing.map((m) => m.title).join(', ')}`, { missing: missing.map((m) => m.id) });
      }
      const first = cur.status === 'draft';
      const set: Partial<ClaimRow> = { ...(d.payerRef && { payerClaimNo: d.payerRef }) };
      if (first) {
        const payer = (await this.repo.payerById(tx, cur.payerId))!;
        set.submittedAt = new Date().toISOString();
        set.dueDate = addDays(today(), payer.creditDays);
        const invoiceIds = (await this.repo.claimInvoices(tx, id)).map((l) => l.invoiceId);
        const event: I.ClaimSubmittedEvent = { claimId: id, number: cur.number, patientId: cur.patientId, payerId: cur.payerId, claimedAmount: amt(cur.claimedAmount), invoiceIds };
        await this.outbox.publish(tx, 'insurance.claim.submitted', { ...event });
      }
      return { action: first ? 'submitted' : 'query_answered', note: d.note, amount: first ? cur.claimedAmount : undefined, set };
    });
  }

  queryClaim(id: string, input: I.ReasonInput): Promise<I.Claim> {
    const d = contracts.reasonSchema.parse(input);
    return this.claimTransition(id, ['submitted', 'approved'], 'query', async () => ({ action: 'query_raised', note: d.note }));
  }

  approveClaim(id: string, input: I.ClaimApprove): Promise<I.Claim> {
    const d = contracts.claimApproveSchema.parse(input);
    return this.claimTransition(id, ['submitted', 'query'], 'approved', async (_tx, cur) => {
      if (paise(d.approvedAmount) > paise(cur.claimedAmount)) throw badRequest('approval_exceeds_claim', `Approved amount is more than the ₹${amt(cur.claimedAmount)} claimed`);
      return {
        action: 'approved',
        note: d.note,
        amount: rupees(paise(d.approvedAmount)),
        set: { approvedAmount: rupees(paise(d.approvedAmount)), ...(d.payerClaimNo && { payerClaimNo: d.payerClaimNo }) },
      };
    });
  }

  rejectClaim(id: string, input: I.ReasonInput): Promise<I.Claim> {
    const d = contracts.reasonSchema.parse(input);
    return this.claimTransition(id, ['submitted', 'query', 'approved'], 'rejected', async (tx) => {
      // The patient owes the whole bill again.
      await this.repo.releaseClaimInvoices(tx, id);
      return { action: 'rejected', note: d.note, set: { closedAt: new Date().toISOString() } };
    });
  }

  cancelClaim(id: string, input: I.ReasonInput): Promise<I.Claim> {
    const d = contracts.reasonSchema.parse(input);
    return this.claimTransition(id, ['draft', 'submitted', 'query'], 'cancelled', async (tx) => {
      await this.repo.releaseClaimInvoices(tx, id);
      return { action: 'cancelled', note: d.note, set: { closedAt: new Date().toISOString() } };
    });
  }

  private claimTransition(
    id: string,
    from: I.ClaimStatus[],
    to: I.ClaimStatus,
    fn: (tx: Tx, cur: ClaimRow) => Promise<{ action: string; note?: string; amount?: string; set?: Partial<ClaimRow> }>,
  ): Promise<I.Claim> {
    return this.db.tx(async (tx) => {
      const cur = await this.mustClaim(tx, id, true);
      if (!from.includes(cur.status as I.ClaimStatus)) throw conflict('invalid_status', `A claim that is ${cur.status} cannot be moved to ${to}`);
      if ((to === 'rejected' || to === 'cancelled') && paise(cur.settledAmount) + paise(cur.tdsAmount) + paise(cur.deductionAmount) > 0) {
        throw conflict('claim_has_settlements', 'Money has already been settled on this claim');
      }
      const r = await fn(tx, cur);
      const userId = currentContext()?.userId ?? null;
      await this.repo.updateClaim(tx, id, { ...r.set, status: to, updatedBy: userId });
      await this.repo.addEvent(tx, { entity: 'claim', entityId: id, action: r.action, fromStatus: cur.status, toStatus: to, amount: r.amount ?? null, note: r.note ?? null, createdBy: userId });
      return this.claimTx(tx, id);
    });
  }

  // ---------- documents ----------

  addDocument(claimId: string, input: I.DocumentInput): Promise<I.Claim> {
    const d = contracts.documentInputSchema.parse(input);
    const userId = currentContext()?.userId ?? null;
    return this.db.tx(async (tx) => {
      await this.openClaimForDocs(tx, claimId);
      await this.repo.insertDocuments(tx, [
        {
          claimId,
          docType: d.docType,
          title: d.title,
          required: d.required,
          url: blank(d.url) ?? null,
          note: d.note ?? null,
          receivedAt: d.received ? new Date().toISOString() : null,
          createdBy: userId,
          updatedBy: userId,
        },
      ]);
      return this.claimTx(tx, claimId);
    });
  }

  updateDocument(claimId: string, docId: string, input: I.UpdateDocument): Promise<I.Claim> {
    const d = contracts.updateDocumentSchema.parse(input);
    return this.db.tx(async (tx) => {
      await this.openClaimForDocs(tx, claimId);
      const row = await this.repo.updateDocument(tx, claimId, docId, {
        ...(d.docType !== undefined && { docType: d.docType }),
        ...(d.title !== undefined && { title: d.title }),
        ...(d.required !== undefined && { required: d.required }),
        ...(d.url !== undefined && { url: blank(d.url) ?? null }),
        ...(d.note !== undefined && { note: d.note }),
        ...(d.received !== undefined && { receivedAt: d.received ? new Date().toISOString() : null }),
        updatedBy: currentContext()?.userId ?? null,
      });
      if (!row) throw notFound('Document');
      return this.claimTx(tx, claimId);
    });
  }

  removeDocument(claimId: string, docId: string): Promise<I.Claim> {
    return this.db.tx(async (tx) => {
      await this.openClaimForDocs(tx, claimId);
      if (!(await this.repo.deleteDocument(tx, claimId, docId))) throw notFound('Document');
      return this.claimTx(tx, claimId);
    });
  }

  private async openClaimForDocs(tx: Tx, claimId: string) {
    const claim = await this.mustClaim(tx, claimId);
    if (['settled', 'rejected', 'cancelled'].includes(claim.status)) throw conflict('claim_closed', `This claim is ${claim.status}`);
  }

  // ---------- settlements ----------

  /**
   * Record what the payer paid (plus TDS and deductions) and post it to billing in the same transaction:
   * 'insurance' receipts for the money and TDS, credit notes for written-off deductions; deductions the
   * patient pays stay due on the bill.
   */
  async recordSettlement(claimId: string, input: I.SettlementInput): Promise<I.Claim> {
    const d = contracts.settlementInputSchema.parse(input);
    const userId = currentContext()?.userId ?? null;
    const links = await this.db.tx((tx) => this.repo.claimInvoices(tx, claimId));
    const balances = new Map(await Promise.all(links.map(async (l) => [l.invoiceId, paise((await this.billing.getInvoice(l.invoiceId)).balance)] as const)));

    await this.db.tx(async (tx) => {
      const claim = await this.mustClaim(tx, claimId, true);
      if (!OPEN.includes(claim.status)) throw conflict('invalid_status', `A claim that is ${claim.status} cannot take a settlement`);
      if (claim.submittedAt) {
        const submittedOn = todayIso(0, new Date(iso(claim.submittedAt)));
        if (d.settledOn < submittedOn) {
          throw badRequest('settled_before_submit', `Settlement date cannot be before the claim was submitted (${submittedOn})`);
        }
      }
      const paid = paise(d.amountPaid);
      const tds = paise(d.tdsAmount);
      const writeOff = d.deductions.filter((x) => !x.recoverFromPatient).reduce((a, x) => a + paise(x.amount), 0);
      const recovery = d.deductions.filter((x) => x.recoverFromPatient).reduce((a, x) => a + paise(x.amount), 0);
      const total = paid + tds + writeOff + recovery;
      const outstanding = claimOutstanding(claim);
      if (total > outstanding) {
        throw badRequest('over_settlement', `Paid + TDS + deductions (₹${rupees(total)}) is more than the ₹${rupees(outstanding)} the payer owes`);
      }

      // Spread over the bills by what the payer still owes on each, money first.
      const prior = await this.repo.postingsForInvoices(tx, links.map((l) => l.invoiceId));
      const owed = links.map((l) => {
        const done = prior.filter((p) => p.invoiceId === l.invoiceId).reduce((a, p) => a + paise(p.amount), 0);
        return { link: l, left: paise(l.payerAmount) - done, billLeft: balances.get(l.invoiceId) ?? 0 };
      });
      const postings: { invoiceId: string; invoiceNumber: string; kind: I.SettlementPosting['kind']; amount: string }[] = [];
      const pieces: [I.SettlementPosting['kind'], number][] = [['payment', paid], ['tds', tds], ['write_off', writeOff], ['recovery', recovery]];
      for (const [kind, amount] of pieces) {
        let rest = amount;
        for (const o of owed) {
          if (rest <= 0) break;
          // Money and credit notes cannot exceed what is unpaid on the bill in billing.
          const room = kind === 'recovery' ? o.left : Math.min(o.left, o.billLeft);
          const take = Math.min(rest, room);
          if (take <= 0) continue;
          o.left -= take;
          if (kind !== 'recovery') o.billLeft -= take;
          rest -= take;
          postings.push({ invoiceId: o.link.invoiceId, invoiceNumber: o.link.invoiceNumber, kind, amount: rupees(take) });
        }
        if (rest > 0) throw badRequest('over_settlement', `₹${rupees(rest)} of the ${kind.replace('_', ' ')} does not fit on the claim's bills`);
      }
      const merged = mergePostings(postings);

      const s = await this.repo.insertSettlement(tx, {
        claimId,
        settledOn: d.settledOn,
        reference: d.reference,
        amountPaid: rupees(paid),
        tdsAmount: rupees(tds),
        deductions: d.deductions,
        deductionAmount: rupees(writeOff + recovery),
        writeOffAmount: rupees(writeOff),
        patientRecoveryAmount: rupees(recovery),
        note: d.note ?? null,
        createdBy: userId,
      });
      await this.repo.insertPostings(
        tx,
        merged.map((p) => ({ ...p, settlementId: s.id, ...(p.kind === 'recovery' && { postedAt: new Date().toISOString() }) })),
      );
      const after = outstanding - total;
      const status: I.ClaimStatus = after === 0 ? 'settled' : 'partially_settled';
      await this.repo.updateClaim(tx, claimId, {
        status,
        settledAmount: rupees(paise(claim.settledAmount) + paid),
        tdsAmount: rupees(paise(claim.tdsAmount) + tds),
        deductionAmount: rupees(paise(claim.deductionAmount) + writeOff + recovery),
        writeOffAmount: rupees(paise(claim.writeOffAmount) + writeOff),
        patientRecoveryAmount: rupees(paise(claim.patientRecoveryAmount) + recovery),
        ...(status === 'settled' && { closedAt: new Date().toISOString() }),
        updatedBy: userId,
      });
      await this.repo.addEvent(tx, {
        entity: 'claim',
        entityId: claimId,
        action: 'settlement_recorded',
        fromStatus: claim.status,
        toStatus: status,
        amount: rupees(paid),
        note: [`Ref ${d.reference}`, tds ? `TDS ₹${rupees(tds)}` : '', writeOff + recovery ? `deductions ₹${rupees(writeOff + recovery)}` : '', d.note ?? '']
          .filter(Boolean)
          .join(' · '),
        createdBy: userId,
      });
      const event: I.ClaimSettledEvent = {
        claimId,
        number: claim.number,
        patientId: claim.patientId,
        payerId: claim.payerId,
        settlementId: s.id,
        amountPaid: Number(rupees(paid)),
        tdsAmount: Number(rupees(tds)),
        deductionAmount: Number(rupees(writeOff + recovery)),
        patientRecoveryAmount: Number(rupees(recovery)),
        status,
        settledOn: d.settledOn,
      };
      await this.outbox.publish(tx, 'insurance.claim.settled', { ...event });
      await this.postSettlementToBilling(tx, s.id);
    });
    return this.getClaim(claimId);
  }

  /** Post any entries of a settlement that are not in billing yet (settlements recorded before atomic posting). */
  async retryPosting(settlementId: string): Promise<I.Claim> {
    const claimId = await this.db.tx(async (tx) => {
      const s = await this.repo.settlementById(tx, settlementId);
      if (!s) throw notFound('Settlement');
      await this.postSettlementToBilling(tx, settlementId);
      return s.claimId;
    });
    return this.getClaim(claimId);
  }

  /**
   * Post a settlement's receipts and credit notes to billing inside the caller's transaction, so the
   * settlement and the bills change together. Billing is idempotent on `reference`, so a retry never posts twice.
   */
  private async postSettlementToBilling(tx: Tx, settlementId: string): Promise<void> {
    const settlement = (await this.repo.settlementById(tx, settlementId, true))!;
    const claim = (await this.repo.claimById(tx, settlement.claimId))!;
    for (const p of (await this.repo.postings(tx, [settlementId])).filter((x) => !x.postedAt)) {
      const reference = `INS:${p.id}`;
      let ref: string;
      if (p.kind === 'write_off') {
        const cn = await this.billing.creditNoteTx(tx, p.invoiceId, {
          amount: amt(p.amount),
          reason: `Insurance deduction written off on claim ${claim.number} (${settlement.reference})`.slice(0, 500),
          reference,
        });
        ref = cn.number;
      } else {
        const payment = await this.billing.collectPaymentTx(tx, p.invoiceId, {
          mode: 'insurance',
          amount: amt(p.amount),
          reference,
          notes: (p.kind === 'tds' ? `TDS deducted by payer on claim ${claim.number}` : `Settlement of claim ${claim.number}, UTR ${settlement.reference}`).slice(0, 500),
        });
        ref = payment.number;
      }
      await this.repo.markPosted(tx, p.id, ref);
    }
    await this.repo.updateSettlement(tx, settlementId, { postingStatus: 'posted', postingError: null });
  }

  private async mustClaim(tx: Tx, id: string, lock = false): Promise<ClaimRow> {
    const row = await this.repo.claimById(tx, id, lock);
    if (!row) throw notFound('Claim');
    return row;
  }

  private async claimTx(tx: Tx, id: string): Promise<I.Claim> {
    const r = await this.mustClaim(tx, id);
    const [policy, links, docs, settlements, history, preauth] = await Promise.all([
      this.policyTx(tx, r.policyId),
      this.repo.claimInvoices(tx, id),
      this.repo.documents(tx, id),
      this.repo.settlements(tx, id),
      this.repo.events(tx, 'claim', id),
      r.preauthId ? this.repo.preauthById(tx, r.preauthId) : Promise.resolve(undefined),
    ]);
    const postings = await this.repo.postings(tx, settlements.map((s) => s.id));
    const payers = await this.repo.payersByIds(tx, [r.payerId]);
    return {
      ...claimSummaryDto(r, payers),
      policyId: r.policyId,
      preauthId: r.preauthId,
      preauthNumber: preauth?.number ?? null,
      payerClaimNo: r.payerClaimNo,
      admissionDate: r.admissionDate,
      dischargeDate: r.dischargeDate,
      diagnosis: r.diagnosis,
      notes: r.notes,
      writeOffAmount: amt(r.writeOffAmount),
      patientRecoveryAmount: amt(r.patientRecoveryAmount),
      policy,
      invoices: links.map(claimInvoiceDto),
      documents: docs.map(documentDto),
      settlements: settlements.map((s) => settlementDto(s, postings.filter((p) => p.settlementId === s.id))),
      history: history.map(eventDto),
    };
  }

  // =====================================================================
  // Payer split (cross-module contract) and reports
  // =====================================================================

  /** How a bill splits between payer and patient right now. Bills not on a live claim are all the patient's. */
  async getInvoiceSplit(invoiceId: string): Promise<I.InvoiceSplit> {
    const bill = await this.billing.getInvoice(invoiceId);
    return this.db.tx(async (tx) => {
      const [live] = await this.repo.liveLinks(tx, [invoiceId]);
      const balance = paise(bill.balance);
      if (!live) {
        return {
          invoiceId,
          claimId: null,
          claimNumber: null,
          claimStatus: null,
          payerId: null,
          payerName: null,
          total: bill.total,
          payerAmount: 0,
          patientAmount: bill.total,
          payerOutstanding: 0,
          patientDue: Number(rupees(balance)),
        };
      }
      const { link, claim } = live;
      // Only what has reached billing (or is the patient's to pay) counts; pending receipts still sit on the payer.
      const done = (await this.repo.postingsForInvoices(tx, [invoiceId])).filter((p) => p.postedAt).reduce((a, p) => a + paise(p.amount), 0);
      // Once a claim is settled the payer owes nothing more; any gap (e.g. approved less than claimed) is the patient's.
      const payerOutstanding = claim.status === 'settled' ? 0 : Math.max(0, paise(link.payerAmount) - done);
      const payer = await this.repo.payerById(tx, claim.payerId);
      return {
        invoiceId,
        claimId: claim.id,
        claimNumber: claim.number,
        claimStatus: claim.status as I.ClaimStatus,
        payerId: claim.payerId,
        payerName: payer?.name ?? null,
        total: bill.total,
        payerAmount: amt(link.payerAmount),
        patientAmount: amt(link.patientAmount),
        payerOutstanding: Number(rupees(payerOutstanding)),
        patientDue: Number(rupees(Math.max(0, balance - payerOutstanding))),
      };
    });
  }

  summary(): Promise<I.InsuranceSummary> {
    return this.db.tx(async (tx) => {
      const [preauthCounts, claimCounts, open] = await Promise.all([this.repo.statusCounts(tx, 'preauth'), this.repo.statusCounts(tx, 'claim'), this.repo.openClaims(tx)]);
      const payers = await this.repo.payersByIds(tx, open.map((c) => c.payerId));
      const t = today();
      const byPayer = new Map<string, I.InsuranceSummary['byPayer'][number]>();
      let outstanding = 0;
      let overdue = 0;
      for (const c of open) {
        const owe = claimOutstanding(c);
        const p = payers.get(c.payerId)!;
        let row = byPayer.get(c.payerId);
        if (!row) {
          row = {
            payerId: c.payerId,
            payerName: p.name,
            payerType: p.type as I.PayerType,
            openClaims: 0,
            outstanding: 0,
            overdue: 0,
            creditLimit: num(p.creditLimit),
            ageing: { d0_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 },
          };
          byPayer.set(c.payerId, row);
        }
        row.openClaims++;
        row.outstanding += owe;
        outstanding += owe;
        if (c.dueDate && c.dueDate < t) {
          row.overdue += owe;
          overdue += owe;
        }
        const age = daysBetween((c.submittedAt ?? c.createdAt).slice(0, 10), t);
        const bucket = age <= 30 ? 'd0_30' : age <= 60 ? 'd31_60' : age <= 90 ? 'd61_90' : 'd90_plus';
        row.ageing[bucket] += owe;
      }
      const monthStart = `${t.slice(0, 8)}01`;
      const month = await this.repo.settledBetween(tx, monthStart, t);
      const toRupees = (p: number) => Number(rupees(p));
      return {
        preauths: Object.fromEntries(contracts.PREAUTH_STATUSES.map((s) => [s, preauthCounts.get(s) ?? 0])) as Record<I.PreauthStatus, number>,
        claims: Object.fromEntries(contracts.CLAIM_STATUSES.map((s) => [s, claimCounts.get(s) ?? 0])) as Record<I.ClaimStatus, number>,
        outstanding: toRupees(outstanding),
        overdue: toRupees(overdue),
        byPayer: [...byPayer.values()]
          .map((r) => ({
            ...r,
            outstanding: toRupees(r.outstanding),
            overdue: toRupees(r.overdue),
            ageing: { d0_30: toRupees(r.ageing.d0_30), d31_60: toRupees(r.ageing.d31_60), d61_90: toRupees(r.ageing.d61_90), d90_plus: toRupees(r.ageing.d90_plus) },
          }))
          .sort((a, b) => b.outstanding - a.outstanding),
        settledThisMonth: month.paid,
        deductionsThisMonth: month.deductions,
      };
    });
  }
}

// ---------- helpers ----------

function resolveFacility(explicit?: string): string {
  const ctx = currentContext();
  const id = explicit ?? ctx?.facilityId ?? undefined;
  if (!id) throw badRequest('facility_required', 'Choose a facility (X-Facility-Id header or facilityId)');
  if (explicit && ctx?.facilityIds && ctx.facilityIds !== 'all' && ctx.userId && !ctx.facilityIds.includes(explicit)) {
    throw forbidden('You do not have access to this facility');
  }
  return id;
}

/** What the payer still owes on a claim, in paise. */
function claimOutstanding(c: ClaimRow): number {
  if (!OPEN.includes(c.status)) return 0;
  const base = paise(c.approvedAmount ?? c.claimedAmount);
  return Math.max(0, base - paise(c.settledAmount) - paise(c.tdsAmount) - paise(c.deductionAmount));
}

function mergePostings<T extends { invoiceId: string; kind: string; amount: string }>(rows: T[]): T[] {
  const out = new Map<string, T>();
  for (const r of rows) {
    const key = `${r.invoiceId}:${r.kind}`;
    const prev = out.get(key);
    out.set(key, prev ? { ...prev, amount: rupees(paise(prev.amount) + paise(r.amount)) } : r);
  }
  return [...out.values()];
}

function isUnique(e: unknown): boolean {
  const err = e as { code?: string; cause?: { code?: string } };
  return err?.code === '23505' || err?.cause?.code === '23505';
}

function payerColumns(d: z.output<typeof contracts.updatePayerSchema>): Partial<NewPayerRow> {
  const out: Partial<NewPayerRow> = {};
  if (d.name !== undefined) out.name = d.name;
  if (d.type !== undefined) out.type = d.type;
  if (d.scheme !== undefined) out.scheme = d.scheme;
  if (d.contactName !== undefined) out.contactName = d.contactName;
  if (d.phone !== undefined) out.phone = d.phone;
  if (d.email !== undefined) out.email = blank(d.email) ?? null;
  if (d.address !== undefined) out.address = d.address;
  if (d.gstin !== undefined) out.gstin = blank(d.gstin) ?? null;
  if (d.portalUrl !== undefined) out.portalUrl = blank(d.portalUrl) ?? null;
  if (d.creditDays !== undefined) out.creditDays = Number(d.creditDays);
  if (d.tdsPercent !== undefined) out.tdsPercent = String(d.tdsPercent);
  if (d.copayPercent !== undefined) out.copayPercent = String(d.copayPercent);
  if (d.creditLimit !== undefined) out.creditLimit = d.creditLimit == null ? null : rupees(paise(d.creditLimit));
  if (d.preauthRequired !== undefined) out.preauthRequired = d.preauthRequired;
  if (d.notes !== undefined) out.notes = d.notes;
  if (d.isActive !== undefined) out.isActive = d.isActive;
  return out;
}

function policyColumns(d: z.output<typeof contracts.updatePolicySchema>): Partial<NewPolicyRow> {
  const out: Partial<NewPolicyRow> = {};
  if (d.payerId !== undefined) out.payerId = d.payerId;
  if (d.tpaId !== undefined) out.tpaId = d.tpaId;
  if (d.policyNumber !== undefined) out.policyNumber = d.policyNumber;
  if (d.memberId !== undefined) out.memberId = d.memberId;
  if (d.holderName !== undefined) out.holderName = d.holderName;
  if (d.relation !== undefined) out.relation = d.relation;
  if (d.employeeId !== undefined) out.employeeId = d.employeeId;
  if (d.validFrom !== undefined) out.validFrom = d.validFrom;
  if (d.validTo !== undefined) out.validTo = d.validTo;
  if (d.sumInsured !== undefined) out.sumInsured = d.sumInsured == null ? null : rupees(paise(d.sumInsured));
  if (d.copayPercent !== undefined) out.copayPercent = d.copayPercent == null ? null : String(d.copayPercent);
  if (d.roomRentLimit !== undefined) out.roomRentLimit = d.roomRentLimit == null ? null : rupees(paise(d.roomRentLimit));
  if (d.notes !== undefined) out.notes = d.notes;
  if (d.isActive !== undefined) out.isActive = d.isActive;
  return out;
}

function payerDto(r: PayerRow): I.Payer {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    type: r.type as I.PayerType,
    scheme: r.scheme as I.Scheme | null,
    contactName: r.contactName,
    phone: r.phone,
    email: r.email,
    address: r.address,
    gstin: r.gstin,
    portalUrl: r.portalUrl,
    creditDays: r.creditDays,
    tdsPercent: amt(r.tdsPercent),
    copayPercent: amt(r.copayPercent),
    creditLimit: num(r.creditLimit),
    preauthRequired: r.preauthRequired,
    notes: r.notes,
    isActive: r.isActive,
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
  };
}

function packageDto(r: PackageRow): I.SchemePackage {
  return {
    id: r.id,
    payerId: r.payerId,
    code: r.code,
    name: r.name,
    specialty: r.specialty,
    rate: amt(r.rate),
    losDays: r.losDays,
    preauthRequired: r.preauthRequired,
    inclusions: r.inclusions,
    isActive: r.isActive,
  };
}

function policyDto(r: PolicyRow, payers: Map<string, PayerRow>, used: number): I.Policy {
  const payer = payers.get(r.payerId);
  const tpa = r.tpaId ? payers.get(r.tpaId) : undefined;
  return {
    id: r.id,
    patientId: r.patientId,
    patientName: r.patientName,
    patientUhid: r.patientUhid,
    payerId: r.payerId,
    payerName: payer?.name ?? '',
    payerType: (payer?.type ?? 'insurer') as I.PayerType,
    tpaId: r.tpaId,
    tpaName: tpa?.name ?? null,
    claimPayerId: r.tpaId ?? r.payerId,
    policyNumber: r.policyNumber,
    memberId: r.memberId,
    holderName: r.holderName,
    relation: r.relation as I.Relation,
    employeeId: r.employeeId,
    validFrom: r.validFrom,
    validTo: r.validTo,
    sumInsured: num(r.sumInsured),
    copayPercent: num(r.copayPercent),
    roomRentLimit: num(r.roomRentLimit),
    notes: r.notes,
    isActive: r.isActive,
    verifiedAt: r.verifiedAt ? iso(r.verifiedAt) : null,
    balanceSumInsured: r.sumInsured == null ? null : Number(rupees(Math.max(0, paise(r.sumInsured) - Math.round(used * 100)))),
    createdAt: iso(r.createdAt),
  };
}

function preauthSummaryDto(r: PreauthRow, payers: Map<string, PayerRow>): I.PreauthSummary {
  return {
    id: r.id,
    number: r.number,
    status: r.status as I.PreauthStatus,
    facilityId: r.facilityId,
    patientId: r.patientId,
    patientName: r.patientName,
    patientUhid: r.patientUhid,
    policyId: r.policyId,
    payerId: r.payerId,
    payerName: payers.get(r.payerId)?.name ?? '',
    diagnosis: r.diagnosis,
    requestedAmount: amt(r.requestedAmount),
    approvedAmount: num(r.approvedAmount),
    submittedAt: r.submittedAt ? iso(r.submittedAt) : null,
    createdAt: iso(r.createdAt),
  };
}

function claimSummaryDto(r: ClaimRow, payers: Map<string, PayerRow>): I.ClaimSummary {
  return {
    id: r.id,
    number: r.number,
    status: r.status as I.ClaimStatus,
    claimType: r.claimType as I.ClaimType,
    facilityId: r.facilityId,
    patientId: r.patientId,
    patientName: r.patientName,
    patientUhid: r.patientUhid,
    payerId: r.payerId,
    payerName: payers.get(r.payerId)?.name ?? '',
    claimedAmount: amt(r.claimedAmount),
    approvedAmount: num(r.approvedAmount),
    settledAmount: amt(r.settledAmount),
    tdsAmount: amt(r.tdsAmount),
    deductionAmount: amt(r.deductionAmount),
    outstanding: Number(rupees(claimOutstanding(r))),
    submittedAt: r.submittedAt ? iso(r.submittedAt) : null,
    dueDate: r.dueDate,
    createdAt: iso(r.createdAt),
  };
}

function claimInvoiceDto(r: ClaimInvoiceRow): I.ClaimInvoice {
  return {
    invoiceId: r.invoiceId,
    invoiceNumber: r.invoiceNumber,
    invoiceDate: r.invoiceDate,
    invoiceTotal: amt(r.invoiceTotal),
    payerAmount: amt(r.payerAmount),
    patientAmount: amt(r.patientAmount),
  };
}

function documentDto(r: DocumentRow): I.ClaimDocument {
  return {
    id: r.id,
    docType: r.docType as I.DocumentType,
    title: r.title,
    required: r.required,
    url: r.url,
    note: r.note,
    receivedAt: r.receivedAt ? iso(r.receivedAt) : null,
  };
}

function settlementDto(r: SettlementRow, postings: PostingRow[]): I.Settlement {
  return {
    id: r.id,
    settledOn: r.settledOn,
    reference: r.reference,
    amountPaid: amt(r.amountPaid),
    tdsAmount: amt(r.tdsAmount),
    deductions: r.deductions.map((x) => ({ ...x, category: x.category as I.DeductionCategory, amount: Number(x.amount) })),
    deductionAmount: amt(r.deductionAmount),
    writeOffAmount: amt(r.writeOffAmount),
    patientRecoveryAmount: amt(r.patientRecoveryAmount),
    postingStatus: r.postingStatus as I.Settlement['postingStatus'],
    postingError: r.postingError,
    postings: postings.map((p) => ({
      invoiceId: p.invoiceId,
      invoiceNumber: p.invoiceNumber,
      kind: p.kind as I.SettlementPosting['kind'],
      amount: amt(p.amount),
      billingRef: p.billingRef,
      postedAt: p.postedAt ? iso(p.postedAt) : null,
    })),
    note: r.note,
    createdAt: iso(r.createdAt),
  };
}

function eventDto(r: CaseEventRow): I.CaseEvent {
  return {
    id: r.id,
    action: r.action,
    fromStatus: r.fromStatus,
    toStatus: r.toStatus,
    amount: num(r.amount),
    note: r.note,
    by: r.createdBy,
    byName: r.byName,
    at: iso(r.createdAt),
  };
}

