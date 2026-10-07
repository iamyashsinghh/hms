import { Injectable } from '@nestjs/common';
import {
  and,
  asc,
  count,
  desc,
  emrAddenda,
  emrCertificates,
  emrDiagnoses,
  emrEncounters,
  emrFavourites,
  emrOrders,
  emrPrescriptionLines,
  emrPrescriptions,
  emrVitals,
  eq,
  inArray,
  sql,
  type Tx,
} from '@hms/db';

export type EncounterRow = typeof emrEncounters.$inferSelect;
export type NewEncounterRow = typeof emrEncounters.$inferInsert;
export type VitalsRow = typeof emrVitals.$inferSelect;
export type DiagnosisRow = typeof emrDiagnoses.$inferSelect;
export type PrescriptionRow = typeof emrPrescriptions.$inferSelect;
export type PrescriptionLineRow = typeof emrPrescriptionLines.$inferSelect;
export type OrderRow = typeof emrOrders.$inferSelect;
export type AddendumRow = typeof emrAddenda.$inferSelect;
export type FavouriteRow = typeof emrFavourites.$inferSelect;
export type CertificateRow = typeof emrCertificates.$inferSelect;

type Insert<T extends { $inferInsert: unknown }> = T['$inferInsert'];

/** Drizzle queries for the EMR tables. Always called inside DbService.tx(). */
@Injectable()
export class EmrRepository {
  // ---------- encounters ----------

  async insertEncounter(tx: Tx, values: NewEncounterRow): Promise<EncounterRow> {
    const [row] = await tx.insert(emrEncounters).values(values).returning();
    return row!;
  }

  async findEncounter(tx: Tx, id: string, forUpdate = false): Promise<EncounterRow | undefined> {
    const q = tx.select().from(emrEncounters).where(eq(emrEncounters.id, id)).limit(1);
    const [row] = forUpdate ? await q.for('update') : await q;
    return row;
  }

  async findByVisit(tx: Tx, visitId: string): Promise<EncounterRow | undefined> {
    const [row] = await tx.select().from(emrEncounters).where(eq(emrEncounters.visitId, visitId)).limit(1);
    return row;
  }

  async updateEncounter(tx: Tx, id: string, values: Partial<NewEncounterRow>): Promise<EncounterRow> {
    const [row] = await tx.update(emrEncounters).set(values).where(eq(emrEncounters.id, id)).returning();
    return row!;
  }

  queue(tx: Tx, doctorId: string, date: string): Promise<EncounterRow[]> {
    return tx
      .select()
      .from(emrEncounters)
      .where(and(eq(emrEncounters.doctorId, doctorId), eq(emrEncounters.encounterDate, date)))
      .orderBy(sql`case ${emrEncounters.status} when 'in_progress' then 0 when 'waiting' then 1 when 'completed' then 2 else 3 end`,
        sql`${emrEncounters.tokenNo} nulls last`, asc(emrEncounters.createdAt));
  }

  async byPatient(tx: Tx, patientId: string, page: number, pageSize: number) {
    const filter = and(eq(emrEncounters.patientId, patientId), sql`${emrEncounters.status} <> 'cancelled'`);
    const [items, [{ total }]] = await Promise.all([
      tx.select().from(emrEncounters).where(filter)
        .orderBy(desc(emrEncounters.encounterDate), desc(emrEncounters.createdAt))
        .limit(pageSize).offset((page - 1) * pageSize),
      tx.select({ total: count() }).from(emrEncounters).where(filter),
    ]);
    return { items, total };
  }

  // ---------- children ----------

  vitals(tx: Tx, encounterIds: string[]): Promise<VitalsRow[]> {
    if (!encounterIds.length) return Promise.resolve([]);
    return tx.select().from(emrVitals).where(inArray(emrVitals.encounterId, encounterIds)).orderBy(asc(emrVitals.recordedAt));
  }

  async insertVitals(tx: Tx, values: Insert<typeof emrVitals>): Promise<VitalsRow> {
    const [row] = await tx.insert(emrVitals).values(values).returning();
    return row!;
  }

  diagnoses(tx: Tx, encounterIds: string[]): Promise<DiagnosisRow[]> {
    if (!encounterIds.length) return Promise.resolve([]);
    return tx.select().from(emrDiagnoses).where(inArray(emrDiagnoses.encounterId, encounterIds)).orderBy(asc(emrDiagnoses.sort));
  }

  async replaceDiagnoses(tx: Tx, encounterId: string, rows: Insert<typeof emrDiagnoses>[]): Promise<void> {
    await tx.delete(emrDiagnoses).where(eq(emrDiagnoses.encounterId, encounterId));
    if (rows.length) await tx.insert(emrDiagnoses).values(rows);
  }

  orders(tx: Tx, encounterIds: string[]): Promise<OrderRow[]> {
    if (!encounterIds.length) return Promise.resolve([]);
    return tx.select().from(emrOrders).where(inArray(emrOrders.encounterId, encounterIds)).orderBy(asc(emrOrders.sort));
  }

  async replaceOrders(tx: Tx, encounterId: string, rows: Insert<typeof emrOrders>[]): Promise<void> {
    await tx.delete(emrOrders).where(eq(emrOrders.encounterId, encounterId));
    if (rows.length) await tx.insert(emrOrders).values(rows);
  }

  async findOrder(tx: Tx, id: string): Promise<OrderRow | undefined> {
    const [row] = await tx.select().from(emrOrders).where(eq(emrOrders.id, id)).limit(1);
    return row;
  }

  async setOrderStatus(tx: Tx, id: string, status: string): Promise<void> {
    await tx.update(emrOrders).set({ status }).where(eq(emrOrders.id, id));
  }

  addenda(tx: Tx, encounterId: string): Promise<AddendumRow[]> {
    return tx.select().from(emrAddenda).where(eq(emrAddenda.encounterId, encounterId)).orderBy(asc(emrAddenda.createdAt));
  }

  async insertAddendum(tx: Tx, values: Insert<typeof emrAddenda>): Promise<AddendumRow> {
    const [row] = await tx.insert(emrAddenda).values(values).returning();
    return row!;
  }

  // ---------- prescriptions ----------

  prescriptionsFor(tx: Tx, encounterIds: string[]): Promise<PrescriptionRow[]> {
    if (!encounterIds.length) return Promise.resolve([]);
    return tx.select().from(emrPrescriptions).where(inArray(emrPrescriptions.encounterId, encounterIds));
  }

  async findPrescription(tx: Tx, id: string): Promise<PrescriptionRow | undefined> {
    const [row] = await tx.select().from(emrPrescriptions).where(eq(emrPrescriptions.id, id)).limit(1);
    return row;
  }

  async insertPrescription(tx: Tx, values: Insert<typeof emrPrescriptions>): Promise<PrescriptionRow> {
    const [row] = await tx.insert(emrPrescriptions).values(values).returning();
    return row!;
  }

  async updatePrescription(tx: Tx, id: string, values: Partial<Insert<typeof emrPrescriptions>>): Promise<PrescriptionRow> {
    const [row] = await tx.update(emrPrescriptions).set(values).where(eq(emrPrescriptions.id, id)).returning();
    return row!;
  }

  async deletePrescription(tx: Tx, id: string): Promise<void> {
    await tx.delete(emrPrescriptions).where(eq(emrPrescriptions.id, id));
  }

  lines(tx: Tx, prescriptionIds: string[]): Promise<PrescriptionLineRow[]> {
    if (!prescriptionIds.length) return Promise.resolve([]);
    return tx.select().from(emrPrescriptionLines).where(inArray(emrPrescriptionLines.prescriptionId, prescriptionIds)).orderBy(asc(emrPrescriptionLines.sort));
  }

  async replaceLines(tx: Tx, prescriptionId: string, rows: Insert<typeof emrPrescriptionLines>[]): Promise<void> {
    await tx.delete(emrPrescriptionLines).where(eq(emrPrescriptionLines.prescriptionId, prescriptionId));
    if (rows.length) await tx.insert(emrPrescriptionLines).values(rows);
  }

  // ---------- favourites ----------

  favourites(tx: Tx, doctorId: string): Promise<FavouriteRow[]> {
    return tx.select().from(emrFavourites).where(eq(emrFavourites.doctorId, doctorId)).orderBy(asc(emrFavourites.name));
  }

  async insertFavourite(tx: Tx, values: Insert<typeof emrFavourites>): Promise<FavouriteRow> {
    const [row] = await tx.insert(emrFavourites).values(values).returning();
    return row!;
  }

  async deleteFavourite(tx: Tx, id: string, doctorId: string): Promise<boolean> {
    const rows = await tx.delete(emrFavourites).where(and(eq(emrFavourites.id, id), eq(emrFavourites.doctorId, doctorId))).returning({ id: emrFavourites.id });
    return rows.length > 0;
  }

  // ---------- certificates ----------

  async insertCertificate(tx: Tx, values: Insert<typeof emrCertificates>): Promise<CertificateRow> {
    const [row] = await tx.insert(emrCertificates).values(values).returning();
    return row!;
  }

  async findCertificate(tx: Tx, id: string): Promise<CertificateRow | undefined> {
    const [row] = await tx.select().from(emrCertificates).where(eq(emrCertificates.id, id)).limit(1);
    return row;
  }

  certificatesFor(tx: Tx, patientId: string): Promise<CertificateRow[]> {
    return tx.select().from(emrCertificates).where(eq(emrCertificates.patientId, patientId)).orderBy(desc(emrCertificates.issuedAt));
  }

  // ---------- foundation lookups (read-only) ----------

  /** Staff display names. Reads iam.users until SetupService.listDoctors lands. */
  async userNames(tx: Tx, ids: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter(Boolean))];
    if (!unique.length) return new Map();
    const res = await tx.execute<{ id: string; name: string }>(
      sql`select id, name from iam.users where id in (${sql.join(unique.map((i) => sql`${i}::uuid`), sql`, `)})`,
    );
    return new Map(res.rows.map((r) => [r.id, r.name]));
  }

  /** The hospital's only active facility, used when the caller has not picked one. */
  async soleFacilityId(tx: Tx): Promise<string | null> {
    const res = await tx.execute<{ id: string }>(sql`select id from setup.facilities where is_active limit 2`);
    return res.rows.length === 1 ? res.rows[0]!.id : null;
  }
}
