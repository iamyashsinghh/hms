import { Injectable } from '@nestjs/common';
import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  radiologyModalities,
  radiologyOrders,
  radiologyReports,
  radiologyTemplates,
  radiologyTests,
  sql,
  type Tx,
} from '@hms/db';
import type { radiology } from '@hms/shared';

export type ModalityRow = typeof radiologyModalities.$inferSelect;
export type NewModalityRow = typeof radiologyModalities.$inferInsert;
export type TestRow = typeof radiologyTests.$inferSelect;
export type NewTestRow = typeof radiologyTests.$inferInsert;
export type TemplateRow = typeof radiologyTemplates.$inferSelect;
export type NewTemplateRow = typeof radiologyTemplates.$inferInsert;
export type OrderRow = typeof radiologyOrders.$inferSelect;
export type NewOrderRow = typeof radiologyOrders.$inferInsert;
export type ReportRow = typeof radiologyReports.$inferSelect;
export type NewReportRow = typeof radiologyReports.$inferInsert;

/** Statuses that hold a slot on a machine. */
const BOOKED = ['scheduled', 'in_progress'];
const IST = 'Asia/Kolkata';

/** Drizzle queries for the radiology schema. Always called inside DbService.tx(). */
@Injectable()
export class RadiologyRepository {
  // ---------- modalities ----------

  modalities(tx: Tx, includeInactive: boolean) {
    return tx
      .select()
      .from(radiologyModalities)
      .where(includeInactive ? undefined : eq(radiologyModalities.isActive, true))
      .orderBy(asc(radiologyModalities.code));
  }

  async modality(tx: Tx, id: string, lock = false): Promise<ModalityRow | undefined> {
    const q = tx.select().from(radiologyModalities).where(eq(radiologyModalities.id, id)).limit(1);
    const [row] = lock ? await q.for('update') : await q;
    return row;
  }

  async insertModality(tx: Tx, values: NewModalityRow): Promise<ModalityRow> {
    const [row] = await tx.insert(radiologyModalities).values(values).returning();
    return row!;
  }

  async updateModality(tx: Tx, id: string, values: Partial<NewModalityRow>): Promise<ModalityRow | undefined> {
    const [row] = await tx.update(radiologyModalities).set(values).where(eq(radiologyModalities.id, id)).returning();
    return row;
  }

  // ---------- tests ----------

  tests(tx: Tx, q: { q?: string; modalityId?: string; includeInactive: boolean }) {
    const term = q.q?.trim().toLowerCase();
    return tx
      .select({ test: radiologyTests, modalityCode: radiologyModalities.code, modalityName: radiologyModalities.name })
      .from(radiologyTests)
      .innerJoin(radiologyModalities, and(eq(radiologyModalities.tenantId, radiologyTests.tenantId), eq(radiologyModalities.id, radiologyTests.modalityId)))
      .where(
        and(
          q.includeInactive ? undefined : eq(radiologyTests.isActive, true),
          q.modalityId ? eq(radiologyTests.modalityId, q.modalityId) : undefined,
          term ? sql`(lower(${radiologyTests.name}) like ${'%' + term + '%'} or lower(${radiologyTests.code}) like ${'%' + term + '%'})` : undefined,
        ),
      )
      .orderBy(asc(radiologyModalities.code), asc(radiologyTests.name))
      .limit(500);
  }

  async test(tx: Tx, id: string) {
    const [row] = await tx
      .select({ test: radiologyTests, modalityCode: radiologyModalities.code, modalityName: radiologyModalities.name })
      .from(radiologyTests)
      .innerJoin(radiologyModalities, and(eq(radiologyModalities.tenantId, radiologyTests.tenantId), eq(radiologyModalities.id, radiologyTests.modalityId)))
      .where(eq(radiologyTests.id, id))
      .limit(1);
    return row;
  }

  /** Match an EMR order line to the master: exact code first, then exact name (case-insensitive). */
  async matchTest(tx: Tx, code: string | null, name: string): Promise<TestRow | undefined> {
    if (code) {
      const [byCode] = await tx
        .select()
        .from(radiologyTests)
        .where(and(eq(radiologyTests.isActive, true), eq(radiologyTests.code, code.trim().toUpperCase())))
        .limit(1);
      if (byCode) return byCode;
    }
    const [byName] = await tx
      .select()
      .from(radiologyTests)
      .where(and(eq(radiologyTests.isActive, true), sql`lower(${radiologyTests.name}) = ${name.trim().toLowerCase()}`))
      .limit(1);
    return byName;
  }

  async insertTest(tx: Tx, values: NewTestRow): Promise<TestRow> {
    const [row] = await tx.insert(radiologyTests).values(values).returning();
    return row!;
  }

  async updateTest(tx: Tx, id: string, values: Partial<NewTestRow>): Promise<TestRow | undefined> {
    const [row] = await tx.update(radiologyTests).set(values).where(eq(radiologyTests.id, id)).returning();
    return row;
  }

  // ---------- templates ----------

  templates(tx: Tx, q: { q?: string; modalityId?: string; includeInactive: boolean }) {
    const term = q.q?.trim().toLowerCase();
    return tx
      .select()
      .from(radiologyTemplates)
      .where(
        and(
          q.includeInactive ? undefined : eq(radiologyTemplates.isActive, true),
          // A template without a modality applies to every modality.
          q.modalityId ? sql`(${radiologyTemplates.modalityId} = ${q.modalityId} or ${radiologyTemplates.modalityId} is null)` : undefined,
          term ? sql`lower(${radiologyTemplates.name}) like ${'%' + term + '%'}` : undefined,
        ),
      )
      .orderBy(asc(radiologyTemplates.name))
      .limit(500);
  }

  async template(tx: Tx, id: string): Promise<TemplateRow | undefined> {
    const [row] = await tx.select().from(radiologyTemplates).where(eq(radiologyTemplates.id, id)).limit(1);
    return row;
  }

  async insertTemplate(tx: Tx, values: NewTemplateRow): Promise<TemplateRow> {
    const [row] = await tx.insert(radiologyTemplates).values(values).returning();
    return row!;
  }

  async updateTemplate(tx: Tx, id: string, values: Partial<NewTemplateRow>): Promise<TemplateRow | undefined> {
    const [row] = await tx.update(radiologyTemplates).set(values).where(eq(radiologyTemplates.id, id)).returning();
    return row;
  }

  // ---------- orders ----------

  async searchOrders(tx: Tx, q: Omit<radiology.OrderQuery, 'statuses'> & { statuses?: string[]; page: number; pageSize: number }) {
    const term = q.q?.trim().toLowerCase();
    const statuses = q.statuses?.length ? q.statuses : q.status ? [q.status] : undefined;
    const filter = and(
      statuses ? inArray(radiologyOrders.status, statuses) : undefined,
      q.modalityId ? eq(radiologyOrders.modalityId, q.modalityId) : undefined,
      q.patientId ? eq(radiologyOrders.patientId, q.patientId) : undefined,
      q.date
        ? sql`((${radiologyOrders.createdAt} at time zone ${IST})::date = ${q.date}::date
              or (${radiologyOrders.scheduledAt} at time zone ${IST})::date = ${q.date}::date)`
        : undefined,
      term
        ? sql`(lower(${radiologyOrders.orderNo}) = ${term}
              or lower(${radiologyOrders.patientUhid}) = ${term}
              or ${radiologyOrders.patientMobile} like ${term + '%'}
              or lower(${radiologyOrders.patientName}) like ${'%' + term + '%'}
              or lower(${radiologyOrders.studyName}) like ${'%' + term + '%'})`
        : undefined,
    );
    // Urgent work first, then oldest first so nothing waits forever.
    const priorityRank = sql`case ${radiologyOrders.priority} when 'stat' then 0 when 'urgent' then 1 else 2 end`;
    const [items, [{ total }]] = await Promise.all([
      tx
        .select()
        .from(radiologyOrders)
        .where(filter)
        .orderBy(priorityRank, desc(radiologyOrders.createdAt))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      tx.select({ total: count() }).from(radiologyOrders).where(filter),
    ]);
    return { items, total: Number(total) };
  }

  async order(tx: Tx, id: string, lock = false): Promise<OrderRow | undefined> {
    const q = tx.select().from(radiologyOrders).where(eq(radiologyOrders.id, id)).limit(1);
    const [row] = lock ? await q.for('update') : await q;
    return row;
  }

  async orderByEmrOrder(tx: Tx, emrOrderId: string): Promise<OrderRow | undefined> {
    const [row] = await tx.select().from(radiologyOrders).where(eq(radiologyOrders.emrOrderId, emrOrderId)).limit(1);
    return row;
  }

  async insertOrder(tx: Tx, values: NewOrderRow): Promise<OrderRow> {
    const [row] = await tx.insert(radiologyOrders).values(values).returning();
    return row!;
  }

  /** Insert unless this EMR order line was already imported. Returns undefined on a duplicate. */
  async insertOrderOnce(tx: Tx, values: NewOrderRow): Promise<OrderRow | undefined> {
    const [row] = await tx
      .insert(radiologyOrders)
      .values(values)
      .onConflictDoNothing({ target: [radiologyOrders.tenantId, radiologyOrders.emrOrderId], where: sql`emr_order_id IS NOT NULL` })
      .returning();
    return row;
  }

  async updateOrder(tx: Tx, id: string, values: Partial<NewOrderRow>): Promise<OrderRow> {
    const [row] = await tx.update(radiologyOrders).set(values).where(eq(radiologyOrders.id, id)).returning();
    return row!;
  }

  /** Bookings on a machine that overlap [start, end), ignoring one order (the one being rescheduled). */
  async overlapping(tx: Tx, modalityId: string, start: string, end: string, exceptId: string) {
    return tx
      .select({ id: radiologyOrders.id, orderNo: radiologyOrders.orderNo, scheduledAt: radiologyOrders.scheduledAt })
      .from(radiologyOrders)
      .where(
        and(
          eq(radiologyOrders.modalityId, modalityId),
          inArray(radiologyOrders.status, BOOKED),
          sql`${radiologyOrders.id} <> ${exceptId}`,
          sql`tstzrange(${radiologyOrders.scheduledAt}, ${radiologyOrders.scheduledEnd}) && tstzrange(${start}::timestamptz, ${end}::timestamptz)`,
        ),
      )
      .limit(1);
  }

  schedule(tx: Tx, date: string, modalityId?: string) {
    return tx
      .select()
      .from(radiologyOrders)
      .where(
        and(
          modalityId ? eq(radiologyOrders.modalityId, modalityId) : undefined,
          sql`${radiologyOrders.scheduledAt} is not null`,
          sql`${radiologyOrders.status} <> 'cancelled'`,
          sql`(${radiologyOrders.scheduledAt} at time zone ${IST})::date = ${date}::date`,
        ),
      )
      .orderBy(asc(radiologyOrders.scheduledAt));
  }

  // ---------- reports ----------

  reports(tx: Tx, orderId: string) {
    return tx.select().from(radiologyReports).where(eq(radiologyReports.orderId, orderId)).orderBy(desc(radiologyReports.version));
  }

  async report(tx: Tx, id: string): Promise<ReportRow | undefined> {
    const [row] = await tx.select().from(radiologyReports).where(eq(radiologyReports.id, id)).limit(1);
    return row;
  }

  async deleteDraft(tx: Tx, id: string): Promise<void> {
    await tx.delete(radiologyReports).where(and(eq(radiologyReports.id, id), eq(radiologyReports.status, 'draft')));
  }

  /** Final report id per order, for list views. */
  async finalReportIds(tx: Tx, orderIds: string[]): Promise<Map<string, string>> {
    if (!orderIds.length) return new Map();
    const rows = await tx
      .select({ orderId: radiologyReports.orderId, id: radiologyReports.id })
      .from(radiologyReports)
      .where(and(inArray(radiologyReports.orderId, orderIds), eq(radiologyReports.status, 'final')));
    return new Map(rows.map((r) => [r.orderId, r.id]));
  }

  async insertReport(tx: Tx, values: NewReportRow): Promise<ReportRow> {
    const [row] = await tx.insert(radiologyReports).values(values).returning();
    return row!;
  }

  async updateReport(tx: Tx, id: string, values: Partial<NewReportRow>): Promise<ReportRow> {
    const [row] = await tx.update(radiologyReports).set(values).where(eq(radiologyReports.id, id)).returning();
    return row!;
  }

  /** Staff display names. Reads iam.users (core) until a users service exists. */
  async userNames(tx: Tx, ids: (string | null | undefined)[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((i): i is string => !!i))];
    if (!unique.length) return new Map();
    const res = await tx.execute<{ id: string; name: string }>(
      sql`select id, name from iam.users where id in (${sql.join(unique.map((i) => sql`${i}::uuid`), sql`, `)})`,
    );
    return new Map(res.rows.map((r) => [r.id, r.name]));
  }
}
