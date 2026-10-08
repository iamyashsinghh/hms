import { Injectable } from '@nestjs/common';
import {
  and,
  asc,
  billingCashShifts,
  billingCreditNotes,
  billingInvoiceLines,
  billingInvoices,
  billingPackageItems,
  billingPayments,
  billingPriceListItems,
  billingPriceLists,
  billingServices,
  billingSettings,
  count,
  desc,
  eq,
  inArray,
  patients,
  sql,
  users,
  type Tx,
} from '@hms/db';

type SQL = ReturnType<typeof sql>;

export type ServiceRow = typeof billingServices.$inferSelect;
export type NewServiceRow = typeof billingServices.$inferInsert;
export type PriceListRow = typeof billingPriceLists.$inferSelect;
export type SettingsRow = typeof billingSettings.$inferSelect;
export type InvoiceRow = typeof billingInvoices.$inferSelect;
export type NewInvoiceRow = typeof billingInvoices.$inferInsert;
export type InvoiceLineRow = typeof billingInvoiceLines.$inferSelect;
export type NewInvoiceLineRow = typeof billingInvoiceLines.$inferInsert;
export type PaymentRow = typeof billingPayments.$inferSelect;
export type NewPaymentRow = typeof billingPayments.$inferInsert;
export type CreditNoteRow = typeof billingCreditNotes.$inferSelect;
export type ShiftRow = typeof billingCashShifts.$inferSelect;

/** tenant_id for inserts: taken from the transaction, so it also works in the worker (no request context). */
export const CURRENT_TENANT = sql<string>`app.current_tenant_id()`;

/** Drizzle queries for the billing schema. Always called inside DbService.tx() (or a caller's tx). */
@Injectable()
export class BillingRepository {
  // ---------- context ----------

  async scope(tx: Tx): Promise<{ tenantId: string; userId: string | null }> {
    const res = await tx.execute<{ tenant_id: string; user_id: string | null }>(
      sql`select app.current_tenant_id() as tenant_id, app.current_user_id() as user_id`,
    );
    return { tenantId: res.rows[0]!.tenant_id, userId: res.rows[0]!.user_id };
  }

  /**
   * Billing snapshots the patient's name/UHID/mobile onto the invoice (a bill must show who it was
   * billed to even if the record changes later). Read from the core patient master in the same
   * transaction so it also works for patients registered in that transaction and in the worker.
   */
  async patientSnapshot(tx: Tx, patientId: string) {
    const [row] = await tx
      .select({ id: patients.id, uhid: patients.uhid, firstName: patients.firstName, lastName: patients.lastName, mobile: patients.mobile })
      .from(patients)
      .where(eq(patients.id, patientId))
      .limit(1);
    return row;
  }

  /** Serialise money movements per patient (deposit balance checks). */
  async lockPatient(tx: Tx, patientId: string) {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('billing.patient:' || ${patientId}))`);
  }

  // ---------- settings ----------

  async settings(tx: Tx): Promise<SettingsRow | undefined> {
    const [row] = await tx.select().from(billingSettings).limit(1);
    return row;
  }

  async upsertSettings(tx: Tx, values: Partial<typeof billingSettings.$inferInsert>): Promise<SettingsRow> {
    const [row] = await tx
      .insert(billingSettings)
      .values({ ...values, tenantId: CURRENT_TENANT })
      .onConflictDoUpdate({ target: billingSettings.tenantId, set: values })
      .returning();
    return row!;
  }

  // ---------- services ----------

  async searchServices(tx: Tx, f: { q?: string; category?: string; active: string; page: number; pageSize: number }) {
    const conds: (SQL | undefined)[] = [];
    if (f.q) {
      // Every typed word must appear in the name or code, punctuation ignored ("xray ch" finds "X-ray chest PA").
      const flat = (col: typeof billingServices.name | typeof billingServices.code) => sql`regexp_replace(lower(${col}), '[^a-z0-9]+', '', 'g')`;
      const words = f.q.toLowerCase().split(/\s+/).map((w) => w.replace(/[^a-z0-9]+/g, '')).filter(Boolean);
      const term = f.q.toLowerCase();
      const wordConds = words.map((w) => sql`(${flat(billingServices.name)} like ${'%' + w + '%'} or ${flat(billingServices.code)} like ${'%' + w + '%'})`);
      conds.push(
        wordConds.length
          ? sql`(${billingServices.code} = upper(${term}) or (${sql.join(wordConds, sql` and `)}))`
          : sql`(${billingServices.code} = upper(${term}) or lower(${billingServices.name}) like ${'%' + term + '%'})`,
      );
    }
    if (f.category) conds.push(eq(billingServices.category, f.category));
    if (f.active !== 'all') conds.push(eq(billingServices.isActive, f.active === 'true'));
    const where = and(...conds);
    const [items, [{ total }]] = await Promise.all([
      tx.select().from(billingServices).where(where).orderBy(asc(billingServices.name)).limit(f.pageSize).offset((f.page - 1) * f.pageSize),
      tx.select({ total: count() }).from(billingServices).where(where),
    ]);
    return { items, total };
  }

  async serviceById(tx: Tx, id: string): Promise<ServiceRow | undefined> {
    const [row] = await tx.select().from(billingServices).where(eq(billingServices.id, id)).limit(1);
    return row;
  }

  async servicesByCode(tx: Tx, codes: string[]): Promise<ServiceRow[]> {
    if (!codes.length) return [];
    return tx.select().from(billingServices).where(inArray(billingServices.code, codes));
  }

  async servicesByIds(tx: Tx, ids: string[]): Promise<ServiceRow[]> {
    if (!ids.length) return [];
    return tx.select().from(billingServices).where(inArray(billingServices.id, ids));
  }

  async insertService(tx: Tx, values: Omit<NewServiceRow, 'tenantId'>): Promise<ServiceRow> {
    const [row] = await tx.insert(billingServices).values({ ...values, tenantId: CURRENT_TENANT }).returning();
    return row!;
  }

  async updateService(tx: Tx, id: string, values: Partial<NewServiceRow>): Promise<ServiceRow | undefined> {
    const [row] = await tx.update(billingServices).set(values).where(eq(billingServices.id, id)).returning();
    return row;
  }

  async packageItems(tx: Tx, packageId: string) {
    return tx
      .select({ serviceId: billingPackageItems.serviceId, qty: billingPackageItems.qty, code: billingServices.code, name: billingServices.name })
      .from(billingPackageItems)
      .innerJoin(billingServices, and(eq(billingServices.tenantId, billingPackageItems.tenantId), eq(billingServices.id, billingPackageItems.serviceId)))
      .where(eq(billingPackageItems.packageId, packageId))
      .orderBy(asc(billingServices.name));
  }

  async replacePackageItems(tx: Tx, packageId: string, items: { serviceId: string; qty: number }[]) {
    await tx.delete(billingPackageItems).where(eq(billingPackageItems.packageId, packageId));
    if (items.length) {
      await tx
        .insert(billingPackageItems)
        .values(items.map((i) => ({ tenantId: CURRENT_TENANT, packageId, serviceId: i.serviceId, qty: String(i.qty) })));
    }
  }

  // ---------- price lists ----------

  async priceLists(tx: Tx): Promise<PriceListRow[]> {
    return tx.select().from(billingPriceLists).orderBy(desc(billingPriceLists.effectiveFrom), asc(billingPriceLists.name));
  }

  async priceListById(tx: Tx, id: string): Promise<PriceListRow | undefined> {
    const [row] = await tx.select().from(billingPriceLists).where(eq(billingPriceLists.id, id)).limit(1);
    return row;
  }

  async priceListItems(tx: Tx, priceListIds: string[]) {
    if (!priceListIds.length) return [];
    return tx
      .select({
        priceListId: billingPriceListItems.priceListId,
        serviceId: billingPriceListItems.serviceId,
        price: billingPriceListItems.price,
        code: billingServices.code,
        name: billingServices.name,
      })
      .from(billingPriceListItems)
      .innerJoin(billingServices, and(eq(billingServices.tenantId, billingPriceListItems.tenantId), eq(billingServices.id, billingPriceListItems.serviceId)))
      .where(inArray(billingPriceListItems.priceListId, priceListIds))
      .orderBy(asc(billingServices.name));
  }

  async insertPriceList(tx: Tx, values: Omit<typeof billingPriceLists.$inferInsert, 'tenantId'>): Promise<PriceListRow> {
    const [row] = await tx.insert(billingPriceLists).values({ ...values, tenantId: CURRENT_TENANT }).returning();
    return row!;
  }

  async updatePriceList(tx: Tx, id: string, values: Partial<typeof billingPriceLists.$inferInsert>) {
    const [row] = await tx.update(billingPriceLists).set(values).where(eq(billingPriceLists.id, id)).returning();
    return row;
  }

  async replacePriceListItems(tx: Tx, priceListId: string, items: { serviceId: string; price: string }[]) {
    await tx.delete(billingPriceListItems).where(eq(billingPriceListItems.priceListId, priceListId));
    if (items.length) {
      await tx.insert(billingPriceListItems).values(items.map((i) => ({ tenantId: CURRENT_TENANT, priceListId, ...i })));
    }
  }

  /**
   * Price of each service on `date`: the payer's active price list first, then the cash (payer-less) list.
   * Returns serviceId -> { price, priceListId }. Services with no list price are absent (use base price).
   */
  async listPrices(tx: Tx, serviceIds: string[], payerId: string | null | undefined, date: string) {
    if (!serviceIds.length) return new Map<string, { price: string; priceListId: string }>();
    const payerCond = payerId ? sql`(pl.payer_id = ${payerId} or pl.payer_id is null)` : sql`pl.payer_id is null`;
    const res = await tx.execute<{ service_id: string; price: string; price_list_id: string }>(sql`
      select distinct on (i.service_id) i.service_id, i.price::text as price, pl.id as price_list_id
        from billing.price_list_items i
        join billing.price_lists pl on pl.tenant_id = i.tenant_id and pl.id = i.price_list_id
       where i.service_id in (${sql.join(serviceIds.map((id) => sql`${id}::uuid`), sql`, `)})
         and pl.is_active and ${payerCond}
         and pl.effective_from <= ${date}::date and (pl.effective_to is null or pl.effective_to >= ${date}::date)
       order by i.service_id, (pl.payer_id is null), pl.effective_from desc`);
    return new Map(res.rows.map((r) => [r.service_id, { price: r.price, priceListId: r.price_list_id }]));
  }

  // ---------- invoices ----------

  async insertInvoice(tx: Tx, values: Omit<NewInvoiceRow, 'tenantId'>): Promise<InvoiceRow> {
    const [row] = await tx.insert(billingInvoices).values({ ...values, tenantId: CURRENT_TENANT }).returning();
    return row!;
  }

  async invoiceById(tx: Tx, id: string, forUpdate = false): Promise<InvoiceRow | undefined> {
    const q = tx.select().from(billingInvoices).where(eq(billingInvoices.id, id)).limit(1);
    const [row] = forUpdate ? await q.for('update') : await q;
    return row;
  }

  async updateInvoice(tx: Tx, id: string, values: Partial<NewInvoiceRow>): Promise<InvoiceRow> {
    const [row] = await tx.update(billingInvoices).set(values).where(eq(billingInvoices.id, id)).returning();
    return row!;
  }

  async deleteInvoice(tx: Tx, id: string) {
    await tx.delete(billingInvoices).where(eq(billingInvoices.id, id));
  }

  async lines(tx: Tx, invoiceId: string): Promise<InvoiceLineRow[]> {
    return tx.select().from(billingInvoiceLines).where(eq(billingInvoiceLines.invoiceId, invoiceId)).orderBy(asc(billingInvoiceLines.lineNo));
  }

  async replaceLines(tx: Tx, invoiceId: string, lines: Omit<NewInvoiceLineRow, 'tenantId' | 'invoiceId'>[]) {
    await tx.delete(billingInvoiceLines).where(eq(billingInvoiceLines.invoiceId, invoiceId));
    await tx.insert(billingInvoiceLines).values(lines.map((l) => ({ ...l, invoiceId, tenantId: CURRENT_TENANT })));
  }

  async searchInvoices(
    tx: Tx,
    f: { q?: string; patientId?: string; status?: string; paymentStatus?: string; from?: string; to?: string; page: number; pageSize: number },
  ) {
    const i = billingInvoices;
    const settled = sql`(${i.paidAmount} + ${i.creditedAmount})`;
    const conds: (SQL | undefined)[] = [];
    if (f.q) {
      const term = f.q.toLowerCase();
      conds.push(
        sql`(upper(${i.number}) = upper(${term}) or ${i.patientUhid} = upper(${term}) or ${i.patientMobile} like ${term + '%'} or lower(${i.patientName}) like ${'%' + term + '%'})`,
      );
    }
    if (f.patientId) conds.push(eq(i.patientId, f.patientId));
    if (f.status) conds.push(eq(i.status, f.status));
    if (f.paymentStatus) {
      conds.push(eq(i.status, 'final'));
      if (f.paymentStatus === 'unpaid') conds.push(sql`${settled} = 0 and ${i.total} > 0`);
      if (f.paymentStatus === 'partial') conds.push(sql`${settled} > 0 and ${settled} < ${i.total}`);
      if (f.paymentStatus === 'paid') conds.push(sql`${settled} >= ${i.total}`);
    }
    if (f.from) conds.push(sql`${i.invoiceDate} >= ${f.from}::date`);
    if (f.to) conds.push(sql`${i.invoiceDate} <= ${f.to}::date`);
    const where = and(...conds);
    const [items, [{ total }]] = await Promise.all([
      tx.select().from(i).where(where).orderBy(desc(i.createdAt)).limit(f.pageSize).offset((f.page - 1) * f.pageSize),
      tx.select({ total: count() }).from(i).where(where),
    ]);
    return { items, total };
  }

  async outstanding(tx: Tx, patientId: string): Promise<string> {
    const i = billingInvoices;
    const [row] = await tx
      .select({ v: sql<string>`coalesce(sum(${i.total} - ${i.paidAmount} - ${i.creditedAmount}), 0)::text` })
      .from(i)
      .where(and(eq(i.patientId, patientId), eq(i.status, 'final')));
    return row!.v;
  }

  // ---------- payments ----------

  async insertPayment(tx: Tx, values: Omit<NewPaymentRow, 'tenantId'>): Promise<PaymentRow> {
    const [row] = await tx.insert(billingPayments).values({ ...values, tenantId: CURRENT_TENANT }).returning();
    return row!;
  }

  async paymentsForInvoice(tx: Tx, invoiceId: string): Promise<PaymentRow[]> {
    return tx.select().from(billingPayments).where(eq(billingPayments.invoiceId, invoiceId)).orderBy(asc(billingPayments.receivedAt));
  }

  async paymentByReference(tx: Tx, patientId: string, reference: string): Promise<PaymentRow | undefined> {
    const [row] = await tx
      .select()
      .from(billingPayments)
      .where(and(eq(billingPayments.patientId, patientId), eq(billingPayments.reference, reference), eq(billingPayments.mode, 'online')))
      .limit(1);
    return row;
  }

  async paymentById(tx: Tx, id: string): Promise<PaymentRow | undefined> {
    const [row] = await tx.select().from(billingPayments).where(eq(billingPayments.id, id)).limit(1);
    return row;
  }

  async searchPayments(tx: Tx, f: { patientId?: string; kind?: string; from?: string; to?: string; page: number; pageSize: number }) {
    const p = billingPayments;
    const conds: (SQL | undefined)[] = [];
    if (f.patientId) conds.push(eq(p.patientId, f.patientId));
    if (f.kind) conds.push(eq(p.kind, f.kind));
    if (f.from) conds.push(sql`${p.receivedAt} >= ${f.from}::date`);
    if (f.to) conds.push(sql`${p.receivedAt} < ${f.to}::date + 1`);
    const where = and(...conds);
    const [items, [{ total }]] = await Promise.all([
      tx.select().from(p).where(where).orderBy(desc(p.receivedAt)).limit(f.pageSize).offset((f.page - 1) * f.pageSize),
      tx.select({ total: count() }).from(p).where(where),
    ]);
    return { items, total };
  }

  async deposits(tx: Tx, patientId: string): Promise<PaymentRow[]> {
    return tx
      .select()
      .from(billingPayments)
      .where(and(eq(billingPayments.patientId, patientId), sql`(${billingPayments.kind} = 'deposit' or ${billingPayments.mode} = 'deposit' or (${billingPayments.kind} = 'refund' and ${billingPayments.invoiceId} is null))`))
      .orderBy(desc(billingPayments.receivedAt));
  }

  /** Advance received minus advance used on invoices minus advance refunded. */
  async depositBalance(tx: Tx, patientId: string): Promise<string> {
    const p = billingPayments;
    const [row] = await tx
      .select({
        v: sql<string>`coalesce(sum(case
              when ${p.kind} = 'deposit' then ${p.amount}
              when ${p.kind} = 'payment' and ${p.mode} = 'deposit' then -${p.amount}
              when ${p.kind} = 'refund' and ${p.invoiceId} is null then -${p.amount}
              else 0 end), 0)::text`,
      })
      .from(p)
      .where(eq(p.patientId, patientId));
    return row!.v;
  }

  // ---------- credit notes ----------

  async insertCreditNote(tx: Tx, values: Omit<typeof billingCreditNotes.$inferInsert, 'tenantId'>): Promise<CreditNoteRow> {
    const [row] = await tx.insert(billingCreditNotes).values({ ...values, tenantId: CURRENT_TENANT }).returning();
    return row!;
  }

  async invoicePaymentByReference(tx: Tx, invoiceId: string, reference: string): Promise<PaymentRow | undefined> {
    const [row] = await tx
      .select()
      .from(billingPayments)
      .where(and(eq(billingPayments.invoiceId, invoiceId), eq(billingPayments.kind, 'payment'), eq(billingPayments.reference, reference)))
      .limit(1);
    return row;
  }

  async creditNoteByReference(tx: Tx, reference: string): Promise<CreditNoteRow | undefined> {
    const [row] = await tx.select().from(billingCreditNotes).where(eq(billingCreditNotes.reference, reference)).limit(1);
    return row;
  }

  async refundByReference(tx: Tx, invoiceId: string, reference: string): Promise<PaymentRow | undefined> {
    const [row] = await tx
      .select()
      .from(billingPayments)
      .where(and(eq(billingPayments.invoiceId, invoiceId), eq(billingPayments.kind, 'refund'), eq(billingPayments.reference, reference)))
      .limit(1);
    return row;
  }

  async creditNotesForInvoice(tx: Tx, invoiceId: string): Promise<CreditNoteRow[]> {
    return tx.select().from(billingCreditNotes).where(eq(billingCreditNotes.invoiceId, invoiceId)).orderBy(asc(billingCreditNotes.createdAt));
  }

  // ---------- cash shifts ----------

  async openShiftOf(tx: Tx, userId: string, forUpdate = false): Promise<ShiftRow | undefined> {
    const q = tx
      .select()
      .from(billingCashShifts)
      .where(and(eq(billingCashShifts.userId, userId), eq(billingCashShifts.status, 'open')))
      .limit(1);
    const [row] = forUpdate ? await q.for('update') : await q;
    return row;
  }

  async shiftById(tx: Tx, id: string): Promise<ShiftRow | undefined> {
    const [row] = await tx.select().from(billingCashShifts).where(eq(billingCashShifts.id, id)).limit(1);
    return row;
  }

  async insertShift(tx: Tx, values: Omit<typeof billingCashShifts.$inferInsert, 'tenantId'>): Promise<ShiftRow> {
    const [row] = await tx.insert(billingCashShifts).values({ ...values, tenantId: CURRENT_TENANT }).returning();
    return row!;
  }

  async updateShift(tx: Tx, id: string, values: Partial<typeof billingCashShifts.$inferInsert>): Promise<ShiftRow> {
    const [row] = await tx.update(billingCashShifts).set(values).where(eq(billingCashShifts.id, id)).returning();
    return row!;
  }

  /** Net collections by mode in a shift: receipts minus refunds. Deposit adjustments move no money and are skipped. */
  async shiftTotals(tx: Tx, shiftId: string): Promise<Record<string, string>> {
    const p = billingPayments;
    const rows = await tx
      .select({ mode: p.mode, v: sql<string>`sum(case when ${p.kind} = 'refund' then -${p.amount} else ${p.amount} end)::text` })
      .from(p)
      .where(and(eq(p.shiftId, shiftId), sql`${p.mode} <> 'deposit'`))
      .groupBy(p.mode);
    return Object.fromEntries(rows.map((r) => [r.mode, r.v]));
  }

  async shifts(tx: Tx, f: { userId?: string; from?: string; to?: string; page: number; pageSize: number }) {
    const s = billingCashShifts;
    const conds: (SQL | undefined)[] = [];
    if (f.userId) conds.push(eq(s.userId, f.userId));
    if (f.from) conds.push(sql`${s.openedAt} >= ${f.from}::date`);
    if (f.to) conds.push(sql`${s.openedAt} < ${f.to}::date + 1`);
    const where = and(...conds);
    const [items, [{ total }]] = await Promise.all([
      tx
        .select({ shift: s, userName: users.name })
        .from(s)
        .leftJoin(users, and(eq(users.tenantId, s.tenantId), eq(users.id, s.userId)))
        .where(where)
        .orderBy(desc(s.openedAt))
        .limit(f.pageSize)
        .offset((f.page - 1) * f.pageSize),
      tx.select({ total: count() }).from(s).where(where),
    ]);
    return { items, total };
  }

  async userName(tx: Tx, userId: string): Promise<string | null> {
    const [row] = await tx.select({ name: users.name }).from(users).where(eq(users.id, userId)).limit(1);
    return row?.name ?? null;
  }
}
