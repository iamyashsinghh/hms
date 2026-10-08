import { Injectable } from '@nestjs/common';
import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  insuranceCaseEvents,
  insuranceClaimDocuments,
  insuranceClaimInvoices,
  insuranceClaims,
  insurancePackages,
  insurancePayers,
  insurancePolicies,
  insurancePreauths,
  insuranceSettlementPostings,
  insuranceSettlements,
  isNull,
  or,
  sql,
  users,
  type Tx,
} from '@hms/db';

type SQL = ReturnType<typeof sql>;

export type PayerRow = typeof insurancePayers.$inferSelect;
export type NewPayerRow = typeof insurancePayers.$inferInsert;
export type PackageRow = typeof insurancePackages.$inferSelect;
export type NewPackageRow = typeof insurancePackages.$inferInsert;
export type PolicyRow = typeof insurancePolicies.$inferSelect;
export type NewPolicyRow = typeof insurancePolicies.$inferInsert;
export type PreauthRow = typeof insurancePreauths.$inferSelect;
export type NewPreauthRow = typeof insurancePreauths.$inferInsert;
export type ClaimRow = typeof insuranceClaims.$inferSelect;
export type NewClaimRow = typeof insuranceClaims.$inferInsert;
export type ClaimInvoiceRow = typeof insuranceClaimInvoices.$inferSelect;
export type NewClaimInvoiceRow = typeof insuranceClaimInvoices.$inferInsert;
export type DocumentRow = typeof insuranceClaimDocuments.$inferSelect;
export type NewDocumentRow = typeof insuranceClaimDocuments.$inferInsert;
export type SettlementRow = typeof insuranceSettlements.$inferSelect;
export type NewSettlementRow = typeof insuranceSettlements.$inferInsert;
export type PostingRow = typeof insuranceSettlementPostings.$inferSelect;
export type NewPostingRow = typeof insuranceSettlementPostings.$inferInsert;
export type CaseEventRow = typeof insuranceCaseEvents.$inferSelect & { byName: string | null };

/** tenant_id for inserts: taken from the transaction, so it also works without a request context. */
export const CURRENT_TENANT = sql<string>`app.current_tenant_id()`;

const like = (term: string) => `%${term.replace(/[%_\\]/g, (c) => '\\' + c)}%`;

/** Drizzle queries for the insurance schema. Always called inside DbService.tx(). */
@Injectable()
export class InsuranceRepository {
  // ---------- payers ----------

  async listPayers(tx: Tx, f: { q?: string; type?: string; active: string; page: number; pageSize: number }) {
    const conds: (SQL | undefined)[] = [];
    if (f.q) conds.push(or(ilike(insurancePayers.name, like(f.q)), ilike(insurancePayers.code, like(f.q))));
    if (f.type) conds.push(eq(insurancePayers.type, f.type));
    if (f.active !== 'all') conds.push(eq(insurancePayers.isActive, f.active === 'true'));
    const where = and(...conds);
    const [items, [{ total }]] = await Promise.all([
      tx.select().from(insurancePayers).where(where).orderBy(asc(insurancePayers.name)).limit(f.pageSize).offset((f.page - 1) * f.pageSize),
      tx.select({ total: count() }).from(insurancePayers).where(where),
    ]);
    return { items, total };
  }

  async payerById(tx: Tx, id: string): Promise<PayerRow | undefined> {
    const [row] = await tx.select().from(insurancePayers).where(eq(insurancePayers.id, id)).limit(1);
    return row;
  }

  async payersByIds(tx: Tx, ids: string[]): Promise<Map<string, PayerRow>> {
    if (!ids.length) return new Map();
    const rows = await tx.select().from(insurancePayers).where(inArray(insurancePayers.id, [...new Set(ids)]));
    return new Map(rows.map((r) => [r.id, r]));
  }

  async payerByCode(tx: Tx, code: string): Promise<PayerRow | undefined> {
    const [row] = await tx.select().from(insurancePayers).where(eq(insurancePayers.code, code)).limit(1);
    return row;
  }

  async insertPayer(tx: Tx, v: Omit<NewPayerRow, 'tenantId'>): Promise<PayerRow> {
    const [row] = await tx.insert(insurancePayers).values({ ...v, tenantId: CURRENT_TENANT }).returning();
    return row!;
  }

  async updatePayer(tx: Tx, id: string, v: Partial<NewPayerRow>): Promise<PayerRow | undefined> {
    const [row] = await tx.update(insurancePayers).set(v).where(eq(insurancePayers.id, id)).returning();
    return row;
  }

  // ---------- packages ----------

  packages(tx: Tx, payerId: string, activeOnly: boolean) {
    return tx
      .select()
      .from(insurancePackages)
      .where(and(eq(insurancePackages.payerId, payerId), activeOnly ? eq(insurancePackages.isActive, true) : undefined))
      .orderBy(asc(insurancePackages.code));
  }

  async packageById(tx: Tx, id: string): Promise<PackageRow | undefined> {
    const [row] = await tx.select().from(insurancePackages).where(eq(insurancePackages.id, id)).limit(1);
    return row;
  }

  async insertPackage(tx: Tx, v: Omit<NewPackageRow, 'tenantId'>): Promise<PackageRow> {
    const [row] = await tx.insert(insurancePackages).values({ ...v, tenantId: CURRENT_TENANT }).returning();
    return row!;
  }

  async updatePackage(tx: Tx, id: string, v: Partial<NewPackageRow>): Promise<PackageRow | undefined> {
    const [row] = await tx.update(insurancePackages).set(v).where(eq(insurancePackages.id, id)).returning();
    return row;
  }

  // ---------- policies ----------

  async listPolicies(tx: Tx, f: { q?: string; patientId?: string; payerId?: string; active: string; page: number; pageSize: number }) {
    const conds: (SQL | undefined)[] = [];
    if (f.q) {
      conds.push(
        or(
          ilike(insurancePolicies.patientName, like(f.q)),
          eq(insurancePolicies.patientUhid, f.q.toUpperCase()),
          ilike(insurancePolicies.policyNumber, like(f.q)),
          ilike(insurancePolicies.memberId, like(f.q)),
        ),
      );
    }
    if (f.patientId) conds.push(eq(insurancePolicies.patientId, f.patientId));
    if (f.payerId) conds.push(or(eq(insurancePolicies.payerId, f.payerId), eq(insurancePolicies.tpaId, f.payerId)));
    if (f.active !== 'all') conds.push(eq(insurancePolicies.isActive, f.active === 'true'));
    const where = and(...conds);
    const [items, [{ total }]] = await Promise.all([
      tx.select().from(insurancePolicies).where(where).orderBy(desc(insurancePolicies.createdAt)).limit(f.pageSize).offset((f.page - 1) * f.pageSize),
      tx.select({ total: count() }).from(insurancePolicies).where(where),
    ]);
    return { items, total };
  }

  async policyById(tx: Tx, id: string, lock = false): Promise<PolicyRow | undefined> {
    const q = tx.select().from(insurancePolicies).where(eq(insurancePolicies.id, id)).limit(1);
    const [row] = lock ? await q.for('update') : await q;
    return row;
  }

  async insertPolicy(tx: Tx, v: Omit<NewPolicyRow, 'tenantId'>): Promise<PolicyRow> {
    const [row] = await tx.insert(insurancePolicies).values({ ...v, tenantId: CURRENT_TENANT }).returning();
    return row!;
  }

  async updatePolicy(tx: Tx, id: string, v: Partial<NewPolicyRow>): Promise<PolicyRow | undefined> {
    const [row] = await tx.update(insurancePolicies).set(v).where(eq(insurancePolicies.id, id)).returning();
    return row;
  }

  /** Sum insured used per policy: claimed (or approved) amounts on live claims. */
  async usedByPolicy(tx: Tx, policyIds: string[], excludeClaimId?: string): Promise<Map<string, number>> {
    if (!policyIds.length) return new Map();
    const rows = await tx
      .select({
        policyId: insuranceClaims.policyId,
        used: sql<string>`coalesce(sum(case when ${insuranceClaims.status} in ('settled', 'partially_settled')
                then ${insuranceClaims.settledAmount} + ${insuranceClaims.tdsAmount}
                else coalesce(${insuranceClaims.approvedAmount}, ${insuranceClaims.claimedAmount}) end), 0)`,
      })
      .from(insuranceClaims)
      .where(
        and(
          inArray(insuranceClaims.policyId, policyIds),
          sql`${insuranceClaims.status} not in ('rejected', 'cancelled')`,
          excludeClaimId ? sql`${insuranceClaims.id} <> ${excludeClaimId}` : undefined,
        ),
      )
      .groupBy(insuranceClaims.policyId);
    return new Map(rows.map((r) => [r.policyId, Number(r.used)]));
  }

  // ---------- pre-auths ----------

  async listPreauths(tx: Tx, f: { q?: string; status?: string; payerId?: string; patientId?: string; page: number; pageSize: number }) {
    const conds: (SQL | undefined)[] = [];
    if (f.q) {
      conds.push(
        or(
          eq(insurancePreauths.number, f.q.toUpperCase()),
          ilike(insurancePreauths.patientName, like(f.q)),
          eq(insurancePreauths.patientUhid, f.q.toUpperCase()),
          ilike(insurancePreauths.payerRef, like(f.q)),
        ),
      );
    }
    if (f.status) conds.push(eq(insurancePreauths.status, f.status));
    if (f.payerId) conds.push(eq(insurancePreauths.payerId, f.payerId));
    if (f.patientId) conds.push(eq(insurancePreauths.patientId, f.patientId));
    const where = and(...conds);
    const [items, [{ total }]] = await Promise.all([
      tx.select().from(insurancePreauths).where(where).orderBy(desc(insurancePreauths.createdAt)).limit(f.pageSize).offset((f.page - 1) * f.pageSize),
      tx.select({ total: count() }).from(insurancePreauths).where(where),
    ]);
    return { items, total };
  }

  async preauthById(tx: Tx, id: string, lock = false): Promise<PreauthRow | undefined> {
    const q = tx.select().from(insurancePreauths).where(eq(insurancePreauths.id, id)).limit(1);
    const [row] = lock ? await q.for('update') : await q;
    return row;
  }

  /** A patient's approved pre-auths, newest decision first. */
  approvedPreauths(tx: Tx, patientId: string): Promise<PreauthRow[]> {
    return tx
      .select()
      .from(insurancePreauths)
      .where(and(eq(insurancePreauths.patientId, patientId), eq(insurancePreauths.status, 'approved')))
      .orderBy(desc(insurancePreauths.decidedAt), desc(insurancePreauths.createdAt));
  }

  async insertPreauth(tx: Tx, v: Omit<NewPreauthRow, 'tenantId'>): Promise<PreauthRow> {
    const [row] = await tx.insert(insurancePreauths).values({ ...v, tenantId: CURRENT_TENANT }).returning();
    return row!;
  }

  async updatePreauth(tx: Tx, id: string, v: Partial<NewPreauthRow>): Promise<PreauthRow> {
    const [row] = await tx.update(insurancePreauths).set(v).where(eq(insurancePreauths.id, id)).returning();
    return row!;
  }

  /** Approved amount of a pre-auth already used by other live claims. */
  async preauthUsed(tx: Tx, preauthId: string, excludeClaimId?: string): Promise<number> {
    const [row] = await tx
      .select({ used: sql<string>`coalesce(sum(${insuranceClaims.claimedAmount}), 0)` })
      .from(insuranceClaims)
      .where(
        and(
          eq(insuranceClaims.preauthId, preauthId),
          sql`${insuranceClaims.status} not in ('rejected', 'cancelled')`,
          excludeClaimId ? sql`${insuranceClaims.id} <> ${excludeClaimId}` : undefined,
        ),
      );
    return Number(row?.used ?? 0);
  }

  // ---------- claims ----------

  async listClaims(tx: Tx, f: { q?: string; status?: string; open?: string; payerId?: string; patientId?: string; page: number; pageSize: number }) {
    const conds: (SQL | undefined)[] = [];
    if (f.q) {
      conds.push(
        or(
          eq(insuranceClaims.number, f.q.toUpperCase()),
          ilike(insuranceClaims.patientName, like(f.q)),
          eq(insuranceClaims.patientUhid, f.q.toUpperCase()),
          ilike(insuranceClaims.payerClaimNo, like(f.q)),
        ),
      );
    }
    if (f.status) conds.push(eq(insuranceClaims.status, f.status));
    if (f.open === 'true') conds.push(inArray(insuranceClaims.status, ['submitted', 'query', 'approved', 'partially_settled']));
    if (f.open === 'false') conds.push(sql`${insuranceClaims.status} not in ('submitted', 'query', 'approved', 'partially_settled')`);
    if (f.payerId) conds.push(eq(insuranceClaims.payerId, f.payerId));
    if (f.patientId) conds.push(eq(insuranceClaims.patientId, f.patientId));
    const where = and(...conds);
    const [items, [{ total }]] = await Promise.all([
      tx.select().from(insuranceClaims).where(where).orderBy(desc(insuranceClaims.createdAt)).limit(f.pageSize).offset((f.page - 1) * f.pageSize),
      tx.select({ total: count() }).from(insuranceClaims).where(where),
    ]);
    return { items, total };
  }

  async claimById(tx: Tx, id: string, lock = false): Promise<ClaimRow | undefined> {
    const q = tx.select().from(insuranceClaims).where(eq(insuranceClaims.id, id)).limit(1);
    const [row] = lock ? await q.for('update') : await q;
    return row;
  }

  async insertClaim(tx: Tx, v: Omit<NewClaimRow, 'tenantId'>): Promise<ClaimRow> {
    const [row] = await tx.insert(insuranceClaims).values({ ...v, tenantId: CURRENT_TENANT }).returning();
    return row!;
  }

  async updateClaim(tx: Tx, id: string, v: Partial<NewClaimRow>): Promise<ClaimRow> {
    const [row] = await tx.update(insuranceClaims).set(v).where(eq(insuranceClaims.id, id)).returning();
    return row!;
  }

  /** Open claims for the receivables report. */
  openClaims(tx: Tx) {
    return tx.select().from(insuranceClaims).where(inArray(insuranceClaims.status, ['submitted', 'query', 'approved', 'partially_settled']));
  }

  async statusCounts(tx: Tx, entity: 'preauth' | 'claim'): Promise<Map<string, number>> {
    const t = entity === 'preauth' ? insurancePreauths : insuranceClaims;
    const rows = await tx.select({ status: t.status, n: count() }).from(t).groupBy(t.status);
    return new Map(rows.map((r) => [r.status, r.n]));
  }

  // ---------- claim invoices ----------

  claimInvoices(tx: Tx, claimId: string) {
    return tx
      .select()
      .from(insuranceClaimInvoices)
      .where(and(eq(insuranceClaimInvoices.claimId, claimId), isNull(insuranceClaimInvoices.releasedAt)))
      .orderBy(asc(insuranceClaimInvoices.invoiceDate), asc(insuranceClaimInvoices.createdAt));
  }

  /** Live claim links of these bills (a bill sits on at most one live claim). */
  async liveLinks(tx: Tx, invoiceIds: string[]) {
    if (!invoiceIds.length) return [];
    return tx
      .select({ link: insuranceClaimInvoices, claim: insuranceClaims })
      .from(insuranceClaimInvoices)
      .innerJoin(insuranceClaims, and(eq(insuranceClaims.tenantId, insuranceClaimInvoices.tenantId), eq(insuranceClaims.id, insuranceClaimInvoices.claimId)))
      .where(and(inArray(insuranceClaimInvoices.invoiceId, invoiceIds), isNull(insuranceClaimInvoices.releasedAt)));
  }

  async insertClaimInvoices(tx: Tx, rows: Omit<NewClaimInvoiceRow, 'tenantId'>[]) {
    if (!rows.length) return;
    await tx.insert(insuranceClaimInvoices).values(rows.map((r) => ({ ...r, tenantId: CURRENT_TENANT })));
  }

  async updateClaimInvoice(tx: Tx, claimId: string, invoiceId: string, v: Partial<NewClaimInvoiceRow>) {
    await tx
      .update(insuranceClaimInvoices)
      .set(v)
      .where(and(eq(insuranceClaimInvoices.claimId, claimId), eq(insuranceClaimInvoices.invoiceId, invoiceId), isNull(insuranceClaimInvoices.releasedAt)));
  }

  async releaseClaimInvoices(tx: Tx, claimId: string) {
    await tx
      .update(insuranceClaimInvoices)
      .set({ releasedAt: sql`now()` })
      .where(and(eq(insuranceClaimInvoices.claimId, claimId), isNull(insuranceClaimInvoices.releasedAt)));
  }

  // ---------- documents ----------

  documents(tx: Tx, claimId: string) {
    return tx.select().from(insuranceClaimDocuments).where(eq(insuranceClaimDocuments.claimId, claimId)).orderBy(asc(insuranceClaimDocuments.createdAt));
  }

  async insertDocuments(tx: Tx, rows: Omit<NewDocumentRow, 'tenantId'>[]): Promise<DocumentRow[]> {
    if (!rows.length) return [];
    return tx.insert(insuranceClaimDocuments).values(rows.map((r) => ({ ...r, tenantId: CURRENT_TENANT }))).returning();
  }

  async updateDocument(tx: Tx, claimId: string, id: string, v: Partial<NewDocumentRow>): Promise<DocumentRow | undefined> {
    const [row] = await tx
      .update(insuranceClaimDocuments)
      .set(v)
      .where(and(eq(insuranceClaimDocuments.claimId, claimId), eq(insuranceClaimDocuments.id, id)))
      .returning();
    return row;
  }

  async deleteDocument(tx: Tx, claimId: string, id: string): Promise<boolean> {
    const rows = await tx
      .delete(insuranceClaimDocuments)
      .where(and(eq(insuranceClaimDocuments.claimId, claimId), eq(insuranceClaimDocuments.id, id)))
      .returning({ id: insuranceClaimDocuments.id });
    return rows.length > 0;
  }

  // ---------- settlements ----------

  settlements(tx: Tx, claimId: string) {
    return tx.select().from(insuranceSettlements).where(eq(insuranceSettlements.claimId, claimId)).orderBy(asc(insuranceSettlements.createdAt));
  }

  async settlementById(tx: Tx, id: string, lock = false): Promise<SettlementRow | undefined> {
    const q = tx.select().from(insuranceSettlements).where(eq(insuranceSettlements.id, id)).limit(1);
    const [row] = lock ? await q.for('update') : await q;
    return row;
  }

  async insertSettlement(tx: Tx, v: Omit<NewSettlementRow, 'tenantId'>): Promise<SettlementRow> {
    const [row] = await tx.insert(insuranceSettlements).values({ ...v, tenantId: CURRENT_TENANT }).returning();
    return row!;
  }

  async updateSettlement(tx: Tx, id: string, v: Partial<NewSettlementRow>) {
    await tx.update(insuranceSettlements).set(v).where(eq(insuranceSettlements.id, id));
  }

  postings(tx: Tx, settlementIds: string[]) {
    if (!settlementIds.length) return Promise.resolve([] as PostingRow[]);
    return tx
      .select()
      .from(insuranceSettlementPostings)
      .where(inArray(insuranceSettlementPostings.settlementId, settlementIds))
      .orderBy(asc(insuranceSettlementPostings.createdAt));
  }

  /** Postings of bills, for the payer/patient split. */
  postingsForInvoices(tx: Tx, invoiceIds: string[]) {
    if (!invoiceIds.length) return Promise.resolve([] as PostingRow[]);
    return tx.select().from(insuranceSettlementPostings).where(inArray(insuranceSettlementPostings.invoiceId, invoiceIds));
  }

  async insertPostings(tx: Tx, rows: Omit<NewPostingRow, 'tenantId'>[]) {
    if (!rows.length) return;
    await tx.insert(insuranceSettlementPostings).values(rows.map((r) => ({ ...r, tenantId: CURRENT_TENANT })));
  }

  async markPosted(tx: Tx, id: string, billingRef: string) {
    await tx.update(insuranceSettlementPostings).set({ billingRef, postedAt: sql`now()` }).where(eq(insuranceSettlementPostings.id, id));
  }

  async settledBetween(tx: Tx, from: string, to: string) {
    const [row] = await tx
      .select({
        paid: sql<string>`coalesce(sum(${insuranceSettlements.amountPaid} + ${insuranceSettlements.tdsAmount}), 0)`,
        deductions: sql<string>`coalesce(sum(${insuranceSettlements.deductionAmount}), 0)`,
      })
      .from(insuranceSettlements)
      .where(and(sql`${insuranceSettlements.settledOn} >= ${from}`, sql`${insuranceSettlements.settledOn} <= ${to}`));
    return { paid: Number(row?.paid ?? 0), deductions: Number(row?.deductions ?? 0) };
  }

  // ---------- history ----------

  async addEvent(
    tx: Tx,
    v: { entity: 'preauth' | 'claim'; entityId: string; action: string; fromStatus?: string | null; toStatus?: string | null; amount?: string | null; note?: string | null; createdBy?: string | null },
  ) {
    await tx.insert(insuranceCaseEvents).values({ ...v, tenantId: CURRENT_TENANT });
  }

  events(tx: Tx, entity: 'preauth' | 'claim', entityId: string): Promise<CaseEventRow[]> {
    return tx
      .select({
        tenantId: insuranceCaseEvents.tenantId,
        id: insuranceCaseEvents.id,
        entity: insuranceCaseEvents.entity,
        entityId: insuranceCaseEvents.entityId,
        action: insuranceCaseEvents.action,
        fromStatus: insuranceCaseEvents.fromStatus,
        toStatus: insuranceCaseEvents.toStatus,
        amount: insuranceCaseEvents.amount,
        note: insuranceCaseEvents.note,
        createdBy: insuranceCaseEvents.createdBy,
        createdAt: insuranceCaseEvents.createdAt,
        byName: users.name,
      })
      .from(insuranceCaseEvents)
      .leftJoin(users, and(eq(users.tenantId, insuranceCaseEvents.tenantId), eq(users.id, insuranceCaseEvents.createdBy)))
      .where(and(eq(insuranceCaseEvents.entity, entity), eq(insuranceCaseEvents.entityId, entityId)))
      .orderBy(asc(insuranceCaseEvents.createdAt), asc(insuranceCaseEvents.id));
  }
}
