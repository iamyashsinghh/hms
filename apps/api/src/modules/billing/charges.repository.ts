import { Injectable } from '@nestjs/common';
import { and, asc, billingCharges, billingRuleSets, count, desc, eq, inArray, isNull, sql, type Tx } from '@hms/db';
import { CURRENT_TENANT } from './billing.repository';

type SQL = ReturnType<typeof sql>;

export type ChargeRow = typeof billingCharges.$inferSelect;
export type NewChargeRow = typeof billingCharges.$inferInsert;
export type RuleSetRow = typeof billingRuleSets.$inferSelect;

/** Drizzle queries for patient charges and billing rules. Always inside a transaction. */
@Injectable()
export class ChargesRepository {
  // ---------- charges ----------

  async insert(tx: Tx, values: Omit<NewChargeRow, 'tenantId'>): Promise<ChargeRow> {
    const [row] = await tx.insert(billingCharges).values({ ...values, tenantId: CURRENT_TENANT }).returning();
    return row!;
  }

  async update(tx: Tx, id: string, values: Partial<NewChargeRow>): Promise<ChargeRow> {
    const [row] = await tx.update(billingCharges).set(values).where(eq(billingCharges.id, id)).returning();
    return row!;
  }

  async byId(tx: Tx, id: string, forUpdate = false): Promise<ChargeRow | undefined> {
    const q = tx.select().from(billingCharges).where(eq(billingCharges.id, id)).limit(1);
    const [row] = forUpdate ? await q.for('update') : await q;
    return row;
  }

  async byIds(tx: Tx, ids: string[], forUpdate = false): Promise<ChargeRow[]> {
    if (!ids.length) return [];
    const q = tx.select().from(billingCharges).where(inArray(billingCharges.id, ids)).orderBy(asc(billingCharges.createdAt));
    return forUpdate ? q.for('update') : q;
  }

  async bySource(tx: Tx, module: string, refId: string, line?: string, forUpdate = false): Promise<ChargeRow[]> {
    const c = billingCharges;
    const conds = [eq(c.sourceModule, module), eq(c.sourceRef, refId), ...(line !== undefined ? [eq(c.sourceLine, line)] : [])];
    const q = tx.select().from(c).where(and(...conds)).orderBy(asc(c.createdAt));
    return forUpdate ? q.for('update') : q;
  }

  async search(
    tx: Tx,
    f: { patientId?: string; visitId?: string; admissionId?: string; status?: string; sourceModule?: string; invoiceId?: string; reversal?: string; page: number; pageSize: number },
  ) {
    const c = billingCharges;
    const conds: (SQL | undefined)[] = [];
    if (f.patientId) conds.push(eq(c.patientId, f.patientId));
    if (f.visitId) conds.push(eq(c.visitId, f.visitId));
    if (f.admissionId) conds.push(eq(c.admissionId, f.admissionId));
    if (f.status) conds.push(eq(c.status, f.status));
    if (f.sourceModule) conds.push(eq(c.sourceModule, f.sourceModule));
    if (f.invoiceId) conds.push(eq(c.invoiceId, f.invoiceId));
    if (f.reversal === 'true') conds.push(sql`${c.reversalRequestedAt} is not null and ${c.reversalDoneAt} is null`);
    const where = and(...conds);
    const [items, [{ total }]] = await Promise.all([
      tx.select().from(c).where(where).orderBy(asc(c.chargeDate), asc(c.createdAt)).limit(f.pageSize).offset((f.page - 1) * f.pageSize),
      tx.select({ total: count() }).from(c).where(where),
    ]);
    return { items, total: Number(total) };
  }

  /** Pending charges plus billed ones awaiting a credit note, for one patient. */
  async forDesk(tx: Tx, patientId: string): Promise<ChargeRow[]> {
    const c = billingCharges;
    return tx
      .select()
      .from(c)
      .where(and(eq(c.patientId, patientId), sql`(${c.status} = 'pending' or (${c.reversalRequestedAt} is not null and ${c.reversalDoneAt} is null))`))
      .orderBy(asc(c.chargeDate), asc(c.createdAt));
  }

  /** Invoice numbers for charges, keyed by invoice id. */
  async invoiceNumbers(tx: Tx, invoiceIds: string[]): Promise<Map<string, string | null>> {
    if (!invoiceIds.length) return new Map();
    const res = await tx.execute<{ id: string; number: string | null }>(
      sql`select id, number from billing.invoices where id in (${sql.join(invoiceIds.map((id) => sql`${id}::uuid`), sql`, `)})`,
    );
    return new Map(res.rows.map((r) => [r.id, r.number]));
  }

  /** Labels for the desk's groups: OPD visits (date, doctor) and admissions (IPD number). */
  async visitLabels(tx: Tx, visitIds: string[]) {
    if (!visitIds.length) return new Map<string, { visitNo: string; visitDate: string; doctorName: string | null }>();
    const res = await tx.execute<{ id: string; visit_no: string; visit_date: string; doctor_name: string | null }>(sql`
      select v.id, v.visit_no, v.visit_date::text as visit_date, u.name as doctor_name
        from clinical.opd_visits v left join iam.users u on u.tenant_id = v.tenant_id and u.id = v.doctor_id
       where v.id in (${sql.join(visitIds.map((id) => sql`${id}::uuid`), sql`, `)})`);
    return new Map(res.rows.map((r) => [r.id, { visitNo: r.visit_no, visitDate: r.visit_date, doctorName: r.doctor_name }]));
  }

  async admissionLabels(tx: Tx, admissionIds: string[]) {
    if (!admissionIds.length) return new Map<string, { ipdNo: string; status: string }>();
    const res = await tx.execute<{ id: string; ipd_no: string; status: string }>(sql`
      select id, ipd_no, status from inpatient.admissions
       where id in (${sql.join(admissionIds.map((id) => sql`${id}::uuid`), sql`, `)})`);
    return new Map(res.rows.map((r) => [r.id, { ipdNo: r.ipd_no, status: r.status }]));
  }

  /** Patients with pending charges, oldest first. */
  async unbilled(tx: Tx, f: { q?: string; account?: string; page: number; pageSize: number }) {
    const conds: SQL[] = [sql`c.status = 'pending'`];
    if (f.account) conds.push(sql`c.account = ${f.account}`);
    if (f.q) {
      const term = f.q.toLowerCase();
      conds.push(
        sql`(p.uhid = upper(${term}) or p.mobile like ${term + '%'} or lower(p.first_name || ' ' || coalesce(p.last_name, '')) like ${'%' + term + '%'})`,
      );
    }
    const where = sql.join(conds, sql` and `);
    const res = await tx.execute<{
      patient_id: string;
      first_name: string;
      last_name: string | null;
      uhid: string;
      mobile: string | null;
      pending_count: string;
      oldest: string;
      accounts: string[];
      total: string;
    }>(sql`
      select c.patient_id, p.first_name, p.last_name, p.uhid, p.mobile,
             count(*)::text as pending_count, min(c.created_at)::text as oldest,
             array_agg(distinct c.account) as accounts, count(*) over ()::text as total
        from billing.charges c
        join clinical.patients p on p.tenant_id = c.tenant_id and p.id = c.patient_id
       where ${where}
       group by c.patient_id, p.first_name, p.last_name, p.uhid, p.mobile
       order by min(c.created_at)
       limit ${f.pageSize} offset ${(f.page - 1) * f.pageSize}`);
    return { rows: res.rows, total: Number(res.rows[0]?.total ?? 0) };
  }

  /** Every non-cancelled charge for a patient set, for computing pending totals. */
  async pendingFor(tx: Tx, patientIds: string[]): Promise<ChargeRow[]> {
    if (!patientIds.length) return [];
    const c = billingCharges;
    return tx.select().from(c).where(and(inArray(c.patientId, patientIds), eq(c.status, 'pending')));
  }

  /**
   * Payment state per key for "unpaid" flags. key = source_ref (with module), visit_id or admission_id.
   * Returns key → { pending, billedDue } counts in paise: pending charges and unpaid balance on their bills.
   */
  async paymentStates(tx: Tx, by: { module: string; refIds: string[] } | { visitIds: string[] } | { admissionIds: string[] }) {
    let keyCol: SQL;
    let cond: SQL;
    if ('module' in by) {
      if (!by.refIds.length) return [];
      keyCol = sql`c.source_ref`;
      cond = sql`c.source_module = ${by.module} and c.source_ref in (${sql.join(by.refIds.map((r) => sql`${r}`), sql`, `)})`;
    } else if ('visitIds' in by) {
      if (!by.visitIds.length) return [];
      keyCol = sql`c.visit_id::text`;
      cond = sql`c.visit_id in (${sql.join(by.visitIds.map((r) => sql`${r}::uuid`), sql`, `)})`;
    } else {
      if (!by.admissionIds.length) return [];
      keyCol = sql`c.admission_id::text`;
      cond = sql`c.admission_id in (${sql.join(by.admissionIds.map((r) => sql`${r}::uuid`), sql`, `)})`;
    }
    const res = await tx.execute<{ key: string; pending: string; unpaid_bills: string; billed: string }>(sql`
      select ${keyCol} as key,
             count(*) filter (where c.status = 'pending')::text as pending,
             count(*) filter (where c.status = 'billed')::text as billed,
             count(distinct c.invoice_id) filter (
               where c.status = 'billed' and i.status = 'final' and i.paid_amount + i.credited_amount < i.total
             )::text as unpaid_bills
        from billing.charges c
        left join billing.invoices i on i.tenant_id = c.tenant_id and i.id = c.invoice_id
       where ${cond} and c.status <> 'cancelled'
       group by 1`);
    return res.rows;
  }

  /** The patient's current admission, so charges posted for an admitted patient land on the IPD bill. */
  async activeAdmission(tx: Tx, patientId: string): Promise<string | null> {
    const res = await tx.execute<{ id: string }>(sql`
      select id from inpatient.admissions
       where patient_id = ${patientId}::uuid and status = 'admitted' and invoice_id is null
       order by admitted_at desc limit 1`);
    return res.rows[0]?.id ?? null;
  }

  /** Payer (insurer / corporate) of the patient's active, in-date policy, for payer price lists. */
  async activePayer(tx: Tx, patientId: string, date: string): Promise<string | null> {
    const res = await tx.execute<{ payer_id: string }>(sql`
      select payer_id from insurance.policies
       where patient_id = ${patientId}::uuid and is_active
         and (valid_from is null or valid_from <= ${date}::date) and (valid_to is null or valid_to >= ${date}::date)
       order by updated_at desc limit 1`);
    return res.rows[0]?.payer_id ?? null;
  }

  // ---------- rules ----------

  async ruleSet(tx: Tx, facilityId: string | null): Promise<RuleSetRow | undefined> {
    const r = billingRuleSets;
    const [row] = await tx
      .select()
      .from(r)
      .where(facilityId ? eq(r.facilityId, facilityId) : isNull(r.facilityId))
      .limit(1);
    return row;
  }

  async saveRuleSet(tx: Tx, facilityId: string | null, rules: Record<string, unknown>, userId: string | null): Promise<RuleSetRow> {
    const existing = await this.ruleSet(tx, facilityId);
    if (existing) {
      const [row] = await tx.update(billingRuleSets).set({ rules, updatedBy: userId }).where(eq(billingRuleSets.id, existing.id)).returning();
      return row!;
    }
    const [row] = await tx
      .insert(billingRuleSets)
      .values({ tenantId: CURRENT_TENANT, facilityId, rules, createdBy: userId, updatedBy: userId })
      .returning();
    return row!;
  }

  /** Latest charges first, for the patient's billing history (not used by the desk). */
  async recent(tx: Tx, patientId: string, limit: number): Promise<ChargeRow[]> {
    return tx.select().from(billingCharges).where(eq(billingCharges.patientId, patientId)).orderBy(desc(billingCharges.createdAt)).limit(limit);
  }
}
