import { Injectable } from '@nestjs/common';
import {
  and,
  asc,
  billingCharges,
  count,
  desc,
  emrEncounters,
  eq,
  inArray,
  labOrderItems,
  labOrders,
  labPanels,
  labPanelTests,
  labResults,
  labSamples,
  labTestRanges,
  labTests,
  or,
  sql,
  users,
  type Tx,
} from '@hms/db';
import type { lab } from '@hms/shared';

export type TestRow = typeof labTests.$inferSelect;
export type RangeRow = typeof labTestRanges.$inferSelect;
export type PanelRow = typeof labPanels.$inferSelect;
export type OrderRow = typeof labOrders.$inferSelect;
export type NewOrderRow = typeof labOrders.$inferInsert;
export type ItemRow = typeof labOrderItems.$inferSelect;
export type NewItemRow = typeof labOrderItems.$inferInsert;
export type SampleRow = typeof labSamples.$inferSelect;
export type NewSampleRow = typeof labSamples.$inferInsert;
export type ResultRow = typeof labResults.$inferSelect;
export type NewResultRow = typeof labResults.$inferInsert;

/** Drizzle queries for the lab schema. Always called inside DbService.tx(). */
@Injectable()
export class LabRepository {
  // ---------- tests ----------

  listTests(tx: Tx, q: { q?: string; active: 'true' | 'false' | 'all' }) {
    const term = q.q?.trim();
    return tx
      .select()
      .from(labTests)
      .where(
        and(
          q.active === 'all' ? undefined : eq(labTests.isActive, q.active === 'true'),
          term ? or(sql`${labTests.code} ilike ${term + '%'}`, sql`${labTests.name} ilike ${'%' + term + '%'}`) : undefined,
        ),
      )
      .orderBy(asc(labTests.section), asc(labTests.name));
  }

  async testById(tx: Tx, id: string): Promise<TestRow | undefined> {
    const [row] = await tx.select().from(labTests).where(eq(labTests.id, id)).limit(1);
    return row;
  }

  testsByIds(tx: Tx, ids: string[]) {
    return ids.length ? tx.select().from(labTests).where(inArray(labTests.id, ids)) : Promise.resolve([] as TestRow[]);
  }

  testsByCodes(tx: Tx, codes: string[]) {
    return codes.length ? tx.select().from(labTests).where(inArray(labTests.code, codes)) : Promise.resolve([] as TestRow[]);
  }

  async insertTest(tx: Tx, values: typeof labTests.$inferInsert): Promise<TestRow> {
    const [row] = await tx.insert(labTests).values(values).returning();
    return row!;
  }

  async updateTest(tx: Tx, id: string, values: Partial<typeof labTests.$inferInsert>): Promise<TestRow | undefined> {
    const [row] = await tx.update(labTests).set(values).where(eq(labTests.id, id)).returning();
    return row;
  }

  ranges(tx: Tx, testIds: string[]) {
    return testIds.length
      ? tx.select().from(labTestRanges).where(inArray(labTestRanges.testId, testIds)).orderBy(asc(labTestRanges.sort))
      : Promise.resolve([] as RangeRow[]);
  }

  async replaceRanges(tx: Tx, tenantId: string, testId: string, ranges: Omit<typeof labTestRanges.$inferInsert, 'tenantId' | 'testId'>[]) {
    await tx.delete(labTestRanges).where(eq(labTestRanges.testId, testId));
    if (ranges.length) await tx.insert(labTestRanges).values(ranges.map((r, i) => ({ ...r, tenantId, testId, sort: i })));
  }

  // ---------- panels ----------

  listPanels(tx: Tx, q: { q?: string; active: 'true' | 'false' | 'all' }) {
    const term = q.q?.trim();
    return tx
      .select()
      .from(labPanels)
      .where(
        and(
          q.active === 'all' ? undefined : eq(labPanels.isActive, q.active === 'true'),
          term ? or(sql`${labPanels.code} ilike ${term + '%'}`, sql`${labPanels.name} ilike ${'%' + term + '%'}`) : undefined,
        ),
      )
      .orderBy(asc(labPanels.name));
  }

  async panelById(tx: Tx, id: string): Promise<PanelRow | undefined> {
    const [row] = await tx.select().from(labPanels).where(eq(labPanels.id, id)).limit(1);
    return row;
  }

  panelsByIds(tx: Tx, ids: string[]) {
    return ids.length ? tx.select().from(labPanels).where(inArray(labPanels.id, ids)) : Promise.resolve([] as PanelRow[]);
  }

  panelsByCodes(tx: Tx, codes: string[]) {
    return codes.length ? tx.select().from(labPanels).where(inArray(labPanels.code, codes)) : Promise.resolve([] as PanelRow[]);
  }

  async insertPanel(tx: Tx, values: typeof labPanels.$inferInsert): Promise<PanelRow> {
    const [row] = await tx.insert(labPanels).values(values).returning();
    return row!;
  }

  async updatePanel(tx: Tx, id: string, values: Partial<typeof labPanels.$inferInsert>): Promise<PanelRow | undefined> {
    const [row] = await tx.update(labPanels).set(values).where(eq(labPanels.id, id)).returning();
    return row;
  }

  /** Tests of each panel in panel order. */
  async panelTests(tx: Tx, panelIds: string[]): Promise<Map<string, TestRow[]>> {
    if (!panelIds.length) return new Map();
    const rows = await tx
      .select({ panelId: labPanelTests.panelId, test: labTests })
      .from(labPanelTests)
      .innerJoin(labTests, and(eq(labTests.tenantId, labPanelTests.tenantId), eq(labTests.id, labPanelTests.testId)))
      .where(inArray(labPanelTests.panelId, panelIds))
      .orderBy(asc(labPanelTests.sort));
    const out = new Map<string, TestRow[]>();
    for (const r of rows) out.set(r.panelId, [...(out.get(r.panelId) ?? []), r.test]);
    return out;
  }

  async replacePanelTests(tx: Tx, tenantId: string, panelId: string, testIds: string[]) {
    await tx.delete(labPanelTests).where(eq(labPanelTests.panelId, panelId));
    if (testIds.length) await tx.insert(labPanelTests).values(testIds.map((testId, i) => ({ tenantId, panelId, testId, sort: i })));
  }

  // ---------- orders ----------

  async searchOrders(tx: Tx, q: ReturnType<typeof lab.orderQuerySchema.parse>) {
    const term = q.q?.trim();
    const where = and(
      q.status === 'open'
        ? inArray(labOrders.status, ['ordered', 'collected', 'in_progress'])
        : q.status
          ? eq(labOrders.status, q.status)
          : undefined,
      q.patientId ? eq(labOrders.patientId, q.patientId) : undefined,
      q.from ? sql`${labOrders.orderDate} >= ${q.from}` : undefined,
      q.to ? sql`${labOrders.orderDate} <= ${q.to}` : undefined,
      term
        ? or(
            eq(labOrders.orderNo, term.toUpperCase()),
            eq(labOrders.patientUhid, term.toUpperCase()),
            sql`${labOrders.patientMobile} like ${term + '%'}`,
            sql`${labOrders.patientName} ilike ${'%' + term + '%'}`,
            sql`exists (select 1 from lab.samples s where s.tenant_id = ${labOrders.tenantId} and s.order_id = ${labOrders.id} and s.barcode = ${term.toUpperCase()})`,
          )
        : undefined,
    );
    const [items, [{ total }]] = await Promise.all([
      tx
        .select()
        .from(labOrders)
        .where(where)
        .orderBy(desc(labOrders.createdAt))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      tx.select({ total: count() }).from(labOrders).where(where),
    ]);
    return { items, total };
  }

  async orderById(tx: Tx, id: string, forUpdate = false): Promise<OrderRow | undefined> {
    const query = tx.select().from(labOrders).where(eq(labOrders.id, id)).limit(1);
    const [row] = forUpdate ? await query.for('update') : await query;
    return row;
  }

  async orderByEncounter(tx: Tx, encounterId: string): Promise<OrderRow | undefined> {
    const [row] = await tx.select().from(labOrders).where(eq(labOrders.encounterId, encounterId)).limit(1);
    return row;
  }

  async insertOrder(tx: Tx, values: NewOrderRow): Promise<OrderRow> {
    const [row] = await tx.insert(labOrders).values(values).returning();
    return row!;
  }

  async updateOrder(tx: Tx, id: string, values: Partial<NewOrderRow>): Promise<OrderRow> {
    const [row] = await tx.update(labOrders).set(values).where(eq(labOrders.id, id)).returning();
    return row!;
  }

  items(tx: Tx, orderIds: string[]) {
    return orderIds.length
      ? tx.select().from(labOrderItems).where(inArray(labOrderItems.orderId, orderIds)).orderBy(asc(labOrderItems.sort))
      : Promise.resolve([] as ItemRow[]);
  }

  insertItems(tx: Tx, values: NewItemRow[]) {
    return tx.insert(labOrderItems).values(values).returning();
  }

  samples(tx: Tx, orderIds: string[]) {
    return orderIds.length
      ? tx.select().from(labSamples).where(inArray(labSamples.orderId, orderIds)).orderBy(asc(labSamples.barcode))
      : Promise.resolve([] as SampleRow[]);
  }

  async sampleById(tx: Tx, id: string): Promise<SampleRow | undefined> {
    const [row] = await tx.select().from(labSamples).where(eq(labSamples.id, id)).limit(1);
    return row;
  }

  async sampleByBarcode(tx: Tx, barcode: string): Promise<SampleRow | undefined> {
    const [row] = await tx.select().from(labSamples).where(eq(labSamples.barcode, barcode.toUpperCase())).limit(1);
    return row;
  }

  insertSamples(tx: Tx, values: NewSampleRow[]) {
    return tx.insert(labSamples).values(values).returning();
  }

  async updateSample(tx: Tx, id: string, values: Partial<NewSampleRow>): Promise<SampleRow> {
    const [row] = await tx.update(labSamples).set(values).where(eq(labSamples.id, id)).returning();
    return row!;
  }

  /** Samples with a status, oldest first, joined to their order for the worklist. */
  worklist(tx: Tx, status: lab.SampleStatus, facilityId: string | null | undefined) {
    return tx
      .select({ sample: labSamples, order: labOrders })
      .from(labSamples)
      .innerJoin(labOrders, and(eq(labOrders.tenantId, labSamples.tenantId), eq(labOrders.id, labSamples.orderId)))
      .where(and(eq(labSamples.status, status), sql`${labOrders.status} <> 'cancelled'`, facilityId ? eq(labOrders.facilityId, facilityId) : undefined))
      .orderBy(sql`case ${labOrders.priority} when 'stat' then 0 when 'urgent' then 1 else 2 end`, asc(labSamples.createdAt))
      .limit(500);
  }

  results(tx: Tx, orderIds: string[]) {
    return orderIds.length
      ? tx.select().from(labResults).where(inArray(labResults.orderId, orderIds)).orderBy(asc(labResults.sort))
      : Promise.resolve([] as ResultRow[]);
  }

  insertResults(tx: Tx, values: NewResultRow[]) {
    return values.length ? tx.insert(labResults).values(values).returning() : Promise.resolve([] as ResultRow[]);
  }

  async updateResult(tx: Tx, id: string, values: Partial<NewResultRow>): Promise<ResultRow> {
    const [row] = await tx.update(labResults).set(values).where(eq(labResults.id, id)).returning();
    return row!;
  }

  /** Staff display names (core user table, read-only). */
  /** Charges already on the patient's account for these orders (any status), read-only. */
  chargeLines(tx: Tx, orderIds: string[]) {
    return orderIds.length
      ? tx
          .select({ orderId: billingCharges.sourceRef, line: billingCharges.sourceLine, status: billingCharges.status, admissionId: billingCharges.admissionId })
          .from(billingCharges)
          .where(and(eq(billingCharges.sourceModule, 'lab'), inArray(billingCharges.sourceRef, orderIds)))
      : Promise.resolve([]);
  }

  /** OPD visit of the consultation an order came from. */
  async encounterVisit(tx: Tx, encounterId: string): Promise<string | null> {
    const [row] = await tx.select({ visitId: emrEncounters.visitId }).from(emrEncounters).where(eq(emrEncounters.id, encounterId)).limit(1);
    return row?.visitId ?? null;
  }

  /** Stores the bill number on orders whose charges were billed (first bill wins). Returns how many changed. */
  async setInvoice(tx: Tx, orderIds: string[], invoiceId: string, invoiceNo: string): Promise<number> {
    if (!orderIds.length) return 0;
    const rows = await tx
      .update(labOrders)
      .set({ invoiceId, invoiceNo })
      .where(and(inArray(labOrders.id, orderIds), sql`${labOrders.invoiceId} is null`))
      .returning({ id: labOrders.id });
    return rows.length;
  }

  async userNames(tx: Tx, ids: (string | null)[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((i): i is string => !!i))];
    if (!unique.length) return new Map();
    const rows = await tx.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, unique));
    return new Map(rows.map((r) => [r.id, r.name]));
  }
}
