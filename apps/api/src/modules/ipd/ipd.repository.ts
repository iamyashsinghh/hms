import { Injectable } from '@nestjs/common';
import {
  and,
  asc,
  billingCharges,
  billingInvoices,
  count,
  desc,
  eq,
  inArray,
  ipdAdmissions,
  ipdAdvances,
  ipdBedStays,
  ipdBeds,
  ipdCensusRuns,
  ipdDevices,
  ipdDischargeSummaries,
  ipdIntakeOutput,
  ipdMedicationAdministrations,
  ipdMedicationOrders,
  ipdNursingNotes,
  ipdRounds,
  ipdVitals,
  ipdWards,
  isNull,
  sql,
  type Tx,
} from '@hms/db';
import type { ipd as I } from '@hms/shared';
import type { z } from 'zod';

export type WardRow = typeof ipdWards.$inferSelect;
export type BedRow = typeof ipdBeds.$inferSelect;
export type AdmissionRow = typeof ipdAdmissions.$inferSelect;
export type NewAdmissionRow = typeof ipdAdmissions.$inferInsert;
export type StayRow = typeof ipdBedStays.$inferSelect;
export type VitalsRow = typeof ipdVitals.$inferSelect;
export type NoteRow = typeof ipdNursingNotes.$inferSelect;
export type IoRow = typeof ipdIntakeOutput.$inferSelect;
export type MedOrderRow = typeof ipdMedicationOrders.$inferSelect;
export type MedAdminRow = typeof ipdMedicationAdministrations.$inferSelect;
export type RoundRow = typeof ipdRounds.$inferSelect;
/** A charge on the patient account (billing.charges), with the number of the bill it went on. */
export type ChargeRow = typeof billingCharges.$inferSelect & { invoiceNumber: string | null };
export type AdvanceRow = typeof ipdAdvances.$inferSelect;
export type SummaryRow = typeof ipdDischargeSummaries.$inferSelect;
export type DeviceRow = typeof ipdDevices.$inferSelect;

/** Drizzle queries for the inpatient schema. Always called inside DbService.tx(). */
@Injectable()
export class IpdRepository {
  // ---------- wards and beds ----------

  async wards(tx: Tx, facilityId: string | null, includeInactive = false) {
    const where = and(
      facilityId ? eq(ipdWards.facilityId, facilityId) : undefined,
      includeInactive ? undefined : eq(ipdWards.isActive, true),
    );
    return tx.select().from(ipdWards).where(where).orderBy(asc(ipdWards.name));
  }

  async wardById(tx: Tx, id: string): Promise<WardRow | undefined> {
    const [row] = await tx.select().from(ipdWards).where(eq(ipdWards.id, id)).limit(1);
    return row;
  }

  async insertWard(tx: Tx, values: typeof ipdWards.$inferInsert): Promise<WardRow> {
    const [row] = await tx.insert(ipdWards).values(values).returning();
    return row!;
  }

  async updateWard(tx: Tx, id: string, values: Partial<typeof ipdWards.$inferInsert>): Promise<WardRow | undefined> {
    const [row] = await tx.update(ipdWards).set(values).where(eq(ipdWards.id, id)).returning();
    return row;
  }

  async beds(tx: Tx, f: { facilityId?: string | null; wardId?: string; status?: string; includeInactive?: boolean }) {
    const where = and(
      f.facilityId ? eq(ipdBeds.facilityId, f.facilityId) : undefined,
      f.wardId ? eq(ipdBeds.wardId, f.wardId) : undefined,
      f.status ? eq(ipdBeds.status, f.status) : undefined,
      f.includeInactive ? undefined : eq(ipdBeds.isActive, true),
    );
    return tx.select().from(ipdBeds).where(where).orderBy(asc(ipdBeds.wardId), sql`length(${ipdBeds.code})`, asc(ipdBeds.code));
  }

  async countBeds(tx: Tx): Promise<number> {
    const [{ n }] = await tx.select({ n: count() }).from(ipdBeds).where(eq(ipdBeds.isActive, true));
    return n;
  }

  async bedById(tx: Tx, id: string, lock = false): Promise<BedRow | undefined> {
    const q = tx.select().from(ipdBeds).where(eq(ipdBeds.id, id)).limit(1);
    const [row] = lock ? await q.for('update') : await q;
    return row;
  }

  async insertBeds(tx: Tx, values: (typeof ipdBeds.$inferInsert)[]): Promise<BedRow[]> {
    return tx.insert(ipdBeds).values(values).returning();
  }

  async updateBed(tx: Tx, id: string, values: Partial<typeof ipdBeds.$inferInsert>): Promise<BedRow | undefined> {
    const [row] = await tx.update(ipdBeds).set(values).where(eq(ipdBeds.id, id)).returning();
    return row;
  }

  // ---------- admissions ----------

  async admissionById(tx: Tx, id: string, lock = false): Promise<AdmissionRow | undefined> {
    const q = tx.select().from(ipdAdmissions).where(eq(ipdAdmissions.id, id)).limit(1);
    const [row] = lock ? await q.for('update') : await q;
    return row;
  }

  async activeAdmissionOf(tx: Tx, patientId: string): Promise<AdmissionRow | undefined> {
    const [row] = await tx
      .select()
      .from(ipdAdmissions)
      .where(and(eq(ipdAdmissions.patientId, patientId), eq(ipdAdmissions.status, 'admitted')))
      .limit(1);
    return row;
  }

  async admissionsByIds(tx: Tx, ids: string[]): Promise<AdmissionRow[]> {
    if (!ids.length) return [];
    return tx.select().from(ipdAdmissions).where(inArray(ipdAdmissions.id, ids));
  }

  async searchAdmissions(tx: Tx, facilityId: string | null, q: z.output<typeof I.admissionQuerySchema>) {
    const term = q.q?.trim().toLowerCase();
    const where = and(
      facilityId ? eq(ipdAdmissions.facilityId, facilityId) : undefined,
      q.status ? eq(ipdAdmissions.status, q.status) : undefined,
      q.doctorId ? eq(ipdAdmissions.doctorId, q.doctorId) : undefined,
      q.patientId ? eq(ipdAdmissions.patientId, q.patientId) : undefined,
      q.wardId
        ? sql`${ipdAdmissions.currentBedId} in (select id from inpatient.beds where ward_id = ${q.wardId}::uuid)`
        : undefined,
      term
        ? sql`(lower(${ipdAdmissions.patientName}) like ${'%' + term + '%'} or lower(${ipdAdmissions.ipdNo}) = ${term}
               or lower(${ipdAdmissions.patientUhid}) = ${term} or ${ipdAdmissions.patientMobile} like ${term + '%'})`
        : undefined,
    );
    const [items, [{ total }]] = await Promise.all([
      tx.select().from(ipdAdmissions).where(where).orderBy(desc(ipdAdmissions.admittedAt)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
      tx.select({ total: count() }).from(ipdAdmissions).where(where),
    ]);
    return { items, total };
  }

  async insertAdmission(tx: Tx, values: NewAdmissionRow): Promise<AdmissionRow> {
    const [row] = await tx.insert(ipdAdmissions).values(values).returning();
    return row!;
  }

  async updateAdmission(tx: Tx, id: string, values: Partial<NewAdmissionRow>): Promise<AdmissionRow> {
    const [row] = await tx.update(ipdAdmissions).set(values).where(eq(ipdAdmissions.id, id)).returning();
    return row!;
  }

  // ---------- stays ----------

  async stays(tx: Tx, admissionId: string): Promise<StayRow[]> {
    return tx.select().from(ipdBedStays).where(eq(ipdBedStays.admissionId, admissionId)).orderBy(asc(ipdBedStays.fromAt), asc(ipdBedStays.createdAt));
  }

  async insertStay(tx: Tx, values: typeof ipdBedStays.$inferInsert): Promise<StayRow> {
    const [row] = await tx.insert(ipdBedStays).values(values).returning();
    return row!;
  }

  async closeOpenStay(tx: Tx, admissionId: string, at: string): Promise<void> {
    await tx
      .update(ipdBedStays)
      .set({ toAt: at })
      .where(and(eq(ipdBedStays.admissionId, admissionId), isNull(ipdBedStays.toAt)));
  }

  // ---------- nursing and rounds ----------

  vitals(tx: Tx, admissionId: string, limit = 200): Promise<VitalsRow[]> {
    return tx.select().from(ipdVitals).where(eq(ipdVitals.admissionId, admissionId)).orderBy(desc(ipdVitals.recordedAt)).limit(limit);
  }

  async insertVitals(tx: Tx, values: typeof ipdVitals.$inferInsert): Promise<VitalsRow> {
    const [row] = await tx.insert(ipdVitals).values(values).returning();
    return row!;
  }

  notes(tx: Tx, admissionId: string): Promise<NoteRow[]> {
    return tx.select().from(ipdNursingNotes).where(eq(ipdNursingNotes.admissionId, admissionId)).orderBy(desc(ipdNursingNotes.createdAt));
  }

  async insertNote(tx: Tx, values: typeof ipdNursingNotes.$inferInsert): Promise<NoteRow> {
    const [row] = await tx.insert(ipdNursingNotes).values(values).returning();
    return row!;
  }

  intakeOutput(tx: Tx, admissionId: string): Promise<IoRow[]> {
    return tx.select().from(ipdIntakeOutput).where(eq(ipdIntakeOutput.admissionId, admissionId)).orderBy(desc(ipdIntakeOutput.recordedAt));
  }

  async insertIntakeOutput(tx: Tx, values: typeof ipdIntakeOutput.$inferInsert): Promise<IoRow> {
    const [row] = await tx.insert(ipdIntakeOutput).values(values).returning();
    return row!;
  }

  medOrders(tx: Tx, admissionId: string): Promise<MedOrderRow[]> {
    return tx
      .select()
      .from(ipdMedicationOrders)
      .where(eq(ipdMedicationOrders.admissionId, admissionId))
      .orderBy(asc(ipdMedicationOrders.status), desc(ipdMedicationOrders.startAt));
  }

  async medOrderById(tx: Tx, id: string, lock = false): Promise<MedOrderRow | undefined> {
    const q = tx.select().from(ipdMedicationOrders).where(eq(ipdMedicationOrders.id, id)).limit(1);
    const [row] = lock ? await q.for('update') : await q;
    return row;
  }

  async insertMedOrder(tx: Tx, values: typeof ipdMedicationOrders.$inferInsert): Promise<MedOrderRow> {
    const [row] = await tx.insert(ipdMedicationOrders).values(values).returning();
    return row!;
  }

  async updateMedOrder(tx: Tx, id: string, values: Partial<typeof ipdMedicationOrders.$inferInsert>): Promise<MedOrderRow> {
    const [row] = await tx.update(ipdMedicationOrders).set(values).where(eq(ipdMedicationOrders.id, id)).returning();
    return row!;
  }

  administrations(tx: Tx, admissionId: string): Promise<MedAdminRow[]> {
    return tx
      .select()
      .from(ipdMedicationAdministrations)
      .where(eq(ipdMedicationAdministrations.admissionId, admissionId))
      .orderBy(desc(ipdMedicationAdministrations.givenAt));
  }

  async insertAdministration(tx: Tx, values: typeof ipdMedicationAdministrations.$inferInsert): Promise<MedAdminRow> {
    const [row] = await tx.insert(ipdMedicationAdministrations).values(values).returning();
    return row!;
  }

  rounds(tx: Tx, admissionId: string): Promise<RoundRow[]> {
    return tx.select().from(ipdRounds).where(eq(ipdRounds.admissionId, admissionId)).orderBy(desc(ipdRounds.roundAt));
  }

  async insertRound(tx: Tx, values: typeof ipdRounds.$inferInsert): Promise<RoundRow> {
    const [row] = await tx.insert(ipdRounds).values(values).returning();
    return row!;
  }

  // ---------- devices ----------

  devices(tx: Tx, admissionId: string): Promise<DeviceRow[]> {
    return tx.select().from(ipdDevices).where(eq(ipdDevices.admissionId, admissionId)).orderBy(desc(ipdDevices.insertedAt));
  }

  async deviceById(tx: Tx, id: string): Promise<DeviceRow | undefined> {
    const [row] = await tx.select().from(ipdDevices).where(eq(ipdDevices.id, id)).limit(1).for('update');
    return row;
  }

  async insertDevice(tx: Tx, values: typeof ipdDevices.$inferInsert): Promise<DeviceRow> {
    const [row] = await tx.insert(ipdDevices).values(values).returning();
    return row!;
  }

  async updateDevice(tx: Tx, id: string, values: Partial<typeof ipdDevices.$inferInsert>): Promise<DeviceRow> {
    const [row] = await tx.update(ipdDevices).set(values).where(eq(ipdDevices.id, id)).returning();
    return row!;
  }

  /** Close every device still in place (discharge / cancel). */
  async removeOpenDevices(tx: Tx, admissionId: string, at: string, userId: string | null, reason: string): Promise<void> {
    await tx
      .update(ipdDevices)
      .set({ removedAt: at, removedBy: userId, removalReason: reason })
      .where(and(eq(ipdDevices.admissionId, admissionId), isNull(ipdDevices.removedAt)));
  }

  // ---------- daily census ----------

  /**
   * Midnight census per active ward of a facility for an India date: who was in each ward at
   * `cut` (end of that day, or now for today), with their devices in place at that moment.
   */
  async census(tx: Tx, facilityId: string, date: string, cut: string) {
    const res = await tx.execute<{
      ward_id: string;
      ward_name: string;
      ward_type: string;
      patient_days: number;
      catheter_days: number;
      central_line_days: number;
      ventilator_days: number;
      admissions: number;
      discharges: number;
    }>(sql`
      with b as (select ${cut}::timestamptz as cut, (${date}::date)::timestamp at time zone 'Asia/Kolkata' as day_start)
      select w.id as ward_id, w.name as ward_name, w.ward_type,
             count(distinct s.admission_id)::int as patient_days,
             count(distinct s.admission_id) filter (where d.device_type = 'urinary_catheter')::int as catheter_days,
             count(distinct s.admission_id) filter (where d.device_type = 'central_line')::int as central_line_days,
             count(distinct s.admission_id) filter (where d.device_type = 'ventilator')::int as ventilator_days,
             (select count(*)::int from inpatient.admissions a
               where a.facility_id = w.facility_id and a.status <> 'cancelled'
                 and a.admitted_at >= b.day_start and a.admitted_at <= b.cut
                 and (select f.ward_id from inpatient.bed_stays f where f.admission_id = a.id order by f.from_at limit 1) = w.id) as admissions,
             (select count(*)::int from inpatient.admissions a
               where a.facility_id = w.facility_id and a.status = 'discharged'
                 and a.discharged_at >= b.day_start and a.discharged_at <= b.cut
                 and (select l.ward_id from inpatient.bed_stays l where l.admission_id = a.id order by l.from_at desc limit 1) = w.id) as discharges
        from inpatient.wards w
        cross join b
        left join inpatient.bed_stays s
          on s.ward_id = w.id and s.from_at <= b.cut and (s.to_at is null or s.to_at > b.cut)
        left join inpatient.devices d
          on d.admission_id = s.admission_id and d.inserted_at <= b.cut and (d.removed_at is null or d.removed_at > b.cut)
       where w.facility_id = ${facilityId}::uuid and w.is_active
       group by w.id, w.name, w.ward_type, w.facility_id, b.day_start, b.cut
       order by w.name`);
    return res.rows;
  }

  async facilitiesWithWards(tx: Tx): Promise<string[]> {
    const res = await tx.execute<{ facility_id: string }>(sql`select distinct facility_id from inpatient.wards where is_active`);
    return res.rows.map((r) => r.facility_id);
  }

  /** Claims the census for a facility and date; false when it was already published. */
  async claimCensus(tx: Tx, values: typeof ipdCensusRuns.$inferInsert): Promise<boolean> {
    const rows = await tx.insert(ipdCensusRuns).values(values).onConflictDoNothing().returning({ id: ipdCensusRuns.id });
    return rows.length > 0;
  }

  // ---------- running bill ----------

  /**
   * The admission's charges on the patient account (read-only; ChargesService posts and bills them).
   * Ordered by date, then as posted.
   */
  async charges(tx: Tx, admissionId: string): Promise<ChargeRow[]> {
    const rows = await tx
      .select({ c: billingCharges, invoiceNumber: billingInvoices.number })
      .from(billingCharges)
      .leftJoin(billingInvoices, and(eq(billingInvoices.tenantId, billingCharges.tenantId), eq(billingInvoices.id, billingCharges.invoiceId)))
      .where(eq(billingCharges.admissionId, admissionId))
      .orderBy(asc(billingCharges.chargeDate), asc(billingCharges.createdAt));
    return rows.map((r) => ({ ...r.c, invoiceNumber: r.invoiceNumber }));
  }

  advances(tx: Tx, admissionId: string): Promise<AdvanceRow[]> {
    return tx.select().from(ipdAdvances).where(eq(ipdAdvances.admissionId, admissionId)).orderBy(asc(ipdAdvances.receivedAt));
  }

  async insertAdvance(tx: Tx, values: typeof ipdAdvances.$inferInsert): Promise<AdvanceRow> {
    const [row] = await tx.insert(ipdAdvances).values(values).returning();
    return row!;
  }

  // ---------- discharge summary ----------

  async summary(tx: Tx, admissionId: string): Promise<SummaryRow | undefined> {
    const [row] = await tx.select().from(ipdDischargeSummaries).where(eq(ipdDischargeSummaries.admissionId, admissionId)).limit(1);
    return row;
  }

  async summaryStatuses(tx: Tx, admissionIds: string[]): Promise<Map<string, string>> {
    if (!admissionIds.length) return new Map();
    const rows = await tx
      .select({ admissionId: ipdDischargeSummaries.admissionId, status: ipdDischargeSummaries.status })
      .from(ipdDischargeSummaries)
      .where(inArray(ipdDischargeSummaries.admissionId, admissionIds));
    return new Map(rows.map((r) => [r.admissionId, r.status]));
  }

  async upsertSummary(tx: Tx, values: typeof ipdDischargeSummaries.$inferInsert): Promise<SummaryRow> {
    const { tenantId: _t, admissionId: _a, createdBy: _c, ...set } = values;
    const [row] = await tx
      .insert(ipdDischargeSummaries)
      .values(values)
      .onConflictDoUpdate({ target: [ipdDischargeSummaries.tenantId, ipdDischargeSummaries.admissionId], set })
      .returning();
    return row!;
  }

  async updateSummary(tx: Tx, id: string, values: Partial<typeof ipdDischargeSummaries.$inferInsert>): Promise<SummaryRow> {
    const [row] = await tx.update(ipdDischargeSummaries).set(values).where(eq(ipdDischargeSummaries.id, id)).returning();
    return row!;
  }

  // ---------- foundation lookups (read-only) ----------

  async scope(tx: Tx): Promise<{ tenantId: string; userId: string | null }> {
    const res = await tx.execute<{ tenant_id: string; user_id: string | null }>(
      sql`select app.current_tenant_id() as tenant_id, app.current_user_id() as user_id`,
    );
    return { tenantId: res.rows[0]!.tenant_id, userId: res.rows[0]!.user_id };
  }

  /** Active staff user's name. Reads iam.users until SetupService.listDoctors lands. */
  async activeUserName(tx: Tx, id: string): Promise<string | undefined> {
    const res = await tx.execute<{ name: string }>(sql`select name from iam.users where id = ${id}::uuid and status = 'active'`);
    return res.rows[0]?.name;
  }

  async userName(tx: Tx, id: string | null | undefined): Promise<string | null> {
    if (!id) return null;
    const res = await tx.execute<{ name: string }>(sql`select name from iam.users where id = ${id}::uuid`);
    return res.rows[0]?.name ?? null;
  }

  /** The hospital's only active facility, used when the caller has not picked one. */
  async soleFacilityId(tx: Tx): Promise<string | null> {
    const res = await tx.execute<{ id: string }>(sql`select id from setup.facilities where is_active limit 2`);
    return res.rows.length === 1 ? res.rows[0]!.id : null;
  }
}

