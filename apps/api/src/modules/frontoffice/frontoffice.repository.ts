import { Injectable } from '@nestjs/common';
import {
  and,
  asc,
  count,
  desc,
  eq,
  facilities,
  frontofficeAppointmentHistory,
  frontofficeAppointments,
  frontofficePatientAbha,
  frontofficePatientMerges,
  frontofficeVisits,
  inArray,
  patients,
  roles,
  sql,
  userRoles,
  users,
  type Tx,
} from '@hms/db';

export type AppointmentRow = typeof frontofficeAppointments.$inferSelect;
export type NewAppointmentRow = typeof frontofficeAppointments.$inferInsert;
export type HistoryRow = typeof frontofficeAppointmentHistory.$inferSelect;
export type NewHistoryRow = typeof frontofficeAppointmentHistory.$inferInsert;
export type VisitRow = typeof frontofficeVisits.$inferSelect;
export type NewVisitRow = typeof frontofficeVisits.$inferInsert;
export type MergeRow = typeof frontofficePatientMerges.$inferSelect;

export interface PatientBriefRow {
  id: string;
  uhid: string;
  firstName: string;
  lastName: string | null;
  gender: string;
  dateOfBirth: string | null;
  mobile: string | null;
  abhaNumber: string | null;
  isActive: boolean;
  mergedIntoId: string | null;
}

const LIVE_APPOINTMENT = ['booked', 'checked_in', 'in_consultation'];
const ACTIVE_VISIT = ['waiting', 'called', 'in_consultation'];

const patientBrief = {
  id: patients.id,
  uhid: patients.uhid,
  firstName: patients.firstName,
  lastName: patients.lastName,
  gender: patients.gender,
  dateOfBirth: patients.dateOfBirth,
  mobile: patients.mobile,
  abhaNumber: patients.abhaNumber,
  isActive: patients.isActive,
  mergedIntoId: patients.mergedIntoId,
};

/**
 * Drizzle queries for the front office tables. Always called inside DbService.tx().
 *
 * Reads of clinical.patients, iam.users/roles and setup.facilities are joins for display names and
 * existence checks (PatientsService has no batch/brief API and SetupService has not landed yet).
 * The only write outside our own tables is markPatientMerged(); see the note there.
 */
@Injectable()
export class FrontofficeRepository {
  // ---------- lookups ----------

  async patientBriefs(tx: Tx, ids: string[]): Promise<Map<string, PatientBriefRow>> {
    if (!ids.length) return new Map();
    const rows = await tx.select(patientBrief).from(patients).where(inArray(patients.id, [...new Set(ids)]));
    return new Map(rows.map((r) => [r.id, r]));
  }

  async patient(tx: Tx, id: string): Promise<PatientBriefRow | undefined> {
    return (await this.patientBriefs(tx, [id])).get(id);
  }

  /** Staff users holding the system `doctor` role. Replaced by SetupService.listDoctors once setup lands. */
  async doctors(tx: Tx, ids?: string[]) {
    const where = and(eq(roles.key, 'doctor'), eq(users.status, 'active'), ids ? inArray(users.id, ids) : undefined);
    return tx
      .selectDistinct({ userId: users.id, name: users.name })
      .from(users)
      .innerJoin(userRoles, and(eq(userRoles.tenantId, users.tenantId), eq(userRoles.userId, users.id)))
      .innerJoin(roles, and(eq(roles.tenantId, userRoles.tenantId), eq(roles.id, userRoles.roleId)))
      .where(where)
      .orderBy(users.name);
  }

  async userNames(tx: Tx, ids: string[]): Promise<Map<string, string>> {
    if (!ids.length) return new Map();
    const rows = await tx.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, [...new Set(ids)]));
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  async activeFacilityIds(tx: Tx): Promise<string[]> {
    const rows = await tx.select({ id: facilities.id }).from(facilities).where(eq(facilities.isActive, true));
    return rows.map((r) => r.id);
  }

  // ---------- appointments ----------

  async insertAppointment(tx: Tx, values: NewAppointmentRow): Promise<AppointmentRow> {
    const [row] = await tx.insert(frontofficeAppointments).values(values).returning();
    return row!;
  }

  async findAppointment(tx: Tx, id: string, forUpdate = false): Promise<AppointmentRow | undefined> {
    const q = tx.select().from(frontofficeAppointments).where(eq(frontofficeAppointments.id, id)).limit(1);
    const [row] = forUpdate ? await q.for('update') : await q;
    return row;
  }

  async updateAppointment(tx: Tx, id: string, values: Partial<NewAppointmentRow>): Promise<AppointmentRow> {
    const [row] = await tx.update(frontofficeAppointments).set(values).where(eq(frontofficeAppointments.id, id)).returning();
    return row!;
  }

  /** A live appointment of this doctor that overlaps [start, end). */
  async overlapping(tx: Tx, doctorId: string, start: string, end: string, excludeId?: string): Promise<AppointmentRow | undefined> {
    const [row] = await tx
      .select()
      .from(frontofficeAppointments)
      .where(
        and(
          eq(frontofficeAppointments.doctorId, doctorId),
          inArray(frontofficeAppointments.status, LIVE_APPOINTMENT),
          sql`${frontofficeAppointments.slotStart} < ${end}::timestamptz`,
          sql`${frontofficeAppointments.slotEnd} > ${start}::timestamptz`,
          excludeId ? sql`${frontofficeAppointments.id} <> ${excludeId}` : undefined,
        ),
      )
      .limit(1);
    return row;
  }

  async listAppointments(
    tx: Tx,
    f: { from?: string; to?: string; doctorId?: string; patientId?: string; status?: string; facilityId?: string | null },
    page: number,
    pageSize: number,
  ) {
    const where = and(
      f.from ? sql`${frontofficeAppointments.slotStart} >= ${f.from}::timestamptz` : undefined,
      f.to ? sql`${frontofficeAppointments.slotStart} < ${f.to}::timestamptz` : undefined,
      f.doctorId ? eq(frontofficeAppointments.doctorId, f.doctorId) : undefined,
      f.patientId ? eq(frontofficeAppointments.patientId, f.patientId) : undefined,
      f.status ? eq(frontofficeAppointments.status, f.status) : undefined,
      f.facilityId ? eq(frontofficeAppointments.facilityId, f.facilityId) : undefined,
    );
    const [items, [{ total }]] = await Promise.all([
      tx
        .select()
        .from(frontofficeAppointments)
        .where(where)
        .orderBy(asc(frontofficeAppointments.slotStart))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      tx.select({ total: count() }).from(frontofficeAppointments).where(where),
    ]);
    return { items, total };
  }

  async insertHistory(tx: Tx, values: NewHistoryRow): Promise<void> {
    await tx.insert(frontofficeAppointmentHistory).values(values);
  }

  async history(tx: Tx, appointmentId: string): Promise<HistoryRow[]> {
    return tx
      .select()
      .from(frontofficeAppointmentHistory)
      .where(eq(frontofficeAppointmentHistory.appointmentId, appointmentId))
      .orderBy(asc(frontofficeAppointmentHistory.at), asc(frontofficeAppointmentHistory.id));
  }

  // ---------- visits ----------

  async insertVisit(tx: Tx, values: NewVisitRow): Promise<VisitRow> {
    const [row] = await tx.insert(frontofficeVisits).values(values).returning();
    return row!;
  }

  async findVisit(tx: Tx, id: string, forUpdate = false): Promise<VisitRow | undefined> {
    const q = tx.select().from(frontofficeVisits).where(eq(frontofficeVisits.id, id)).limit(1);
    const [row] = forUpdate ? await q.for('update') : await q;
    return row;
  }

  async updateVisit(tx: Tx, id: string, values: Partial<NewVisitRow>): Promise<VisitRow> {
    const [row] = await tx.update(frontofficeVisits).set(values).where(eq(frontofficeVisits.id, id)).returning();
    return row!;
  }

  async activeVisitFor(tx: Tx, patientId: string, doctorId: string, date: string): Promise<VisitRow | undefined> {
    const [row] = await tx
      .select()
      .from(frontofficeVisits)
      .where(
        and(
          eq(frontofficeVisits.patientId, patientId),
          eq(frontofficeVisits.doctorId, doctorId),
          eq(frontofficeVisits.visitDate, date),
          inArray(frontofficeVisits.status, ACTIVE_VISIT),
        ),
      )
      .limit(1);
    return row;
  }

  async queue(tx: Tx, f: { date: string; doctorId?: string; facilityId?: string | null; status?: string }): Promise<VisitRow[]> {
    return tx
      .select()
      .from(frontofficeVisits)
      .where(
        and(
          eq(frontofficeVisits.visitDate, f.date),
          f.doctorId ? eq(frontofficeVisits.doctorId, f.doctorId) : undefined,
          f.facilityId ? eq(frontofficeVisits.facilityId, f.facilityId) : undefined,
          f.status ? eq(frontofficeVisits.status, f.status) : undefined,
        ),
      )
      .orderBy(
        sql`case ${frontofficeVisits.status} when 'in_consultation' then 0 when 'called' then 1 when 'waiting' then 2
              when 'skipped' then 3 when 'completed' then 4 else 5 end`,
        sql`case ${frontofficeVisits.priority} when 'urgent' then 0 when 'senior' then 1 else 2 end`,
        asc(frontofficeVisits.tokenNo),
      );
  }

  // ---------- duplicates, merge, ABHA ----------

  /**
   * Scores likely duplicates: ABHA match 100, mobile 40, name similarity up to 40, date of birth 20.
   * Uses the pg_trgm index on patient names.
   */
  async duplicateCandidates(
    tx: Tx,
    q: { name?: string; mobile?: string; dateOfBirth?: string; abhaNumber?: string; excludeId?: string },
    limit = 10,
  ) {
    const name = q.name?.toLowerCase() ?? null;
    const fullName = sql`lower(${patients.firstName} || ' ' || coalesce(${patients.lastName}, ''))`;
    const nameSim = name ? sql`similarity(${fullName}, ${name})` : sql`0`;
    const score = sql<number>`least(100, round(
        (case when ${q.abhaNumber ?? null}::text is not null and ${patients.abhaNumber} = ${q.abhaNumber ?? null} then 100 else 0 end)
      + (case when ${q.mobile ?? null}::text is not null and ${patients.mobile} = ${q.mobile ?? null} then 40 else 0 end)
      + (${nameSim} * 40)
      + (case when ${q.dateOfBirth ?? null}::date is not null and ${patients.dateOfBirth} = ${q.dateOfBirth ?? null}::date then 20 else 0 end)
    ))::int`;
    const match = [
      q.abhaNumber ? eq(patients.abhaNumber, q.abhaNumber) : undefined,
      q.mobile ? eq(patients.mobile, q.mobile) : undefined,
      name ? sql`${fullName} % ${name}` : undefined,
    ].filter(Boolean);
    if (!match.length) return [];
    const rows = await tx
      .select({ ...patientBrief, score })
      .from(patients)
      .where(
        and(
          eq(patients.isActive, true),
          q.excludeId ? sql`${patients.id} <> ${q.excludeId}` : undefined,
          sql`(${sql.join(match as ReturnType<typeof sql>[], sql` or `)})`,
        ),
      )
      .orderBy(desc(score))
      .limit(limit);
    return rows;
  }

  async lockPatients(tx: Tx, ids: string[]) {
    return tx.select().from(patients).where(inArray(patients.id, ids)).orderBy(patients.id).for('update');
  }

  async movePatientRows(tx: Tx, sourceId: string, targetId: string) {
    const appts = await tx
      .update(frontofficeAppointments)
      .set({ patientId: targetId })
      .where(eq(frontofficeAppointments.patientId, sourceId))
      .returning({ id: frontofficeAppointments.id });
    const visits = await tx
      .update(frontofficeVisits)
      .set({ patientId: targetId })
      .where(eq(frontofficeVisits.patientId, sourceId))
      .returning({ id: frontofficeVisits.id });
    await tx.update(frontofficePatientAbha).set({ patientId: targetId }).where(eq(frontofficePatientAbha.patientId, sourceId));
    return { movedAppointments: appts.length, movedVisits: visits.length };
  }

  /**
   * Deactivates the duplicate and points it at the kept record, in the same transaction as the merge.
   * TODO(foundation): move into a PatientsService.markMerged(tx, sourceId, targetId) so the front office
   * stops writing clinical.patients directly. Columns is_active / merged_into_id already exist for this.
   */
  async markPatientMerged(tx: Tx, sourceId: string, targetId: string, actorId: string | undefined) {
    await tx
      .update(patients)
      .set({ isActive: false, mergedIntoId: targetId, updatedBy: actorId ?? null })
      .where(eq(patients.id, sourceId));
  }

  async insertMerge(tx: Tx, values: typeof frontofficePatientMerges.$inferInsert): Promise<MergeRow> {
    const [row] = await tx.insert(frontofficePatientMerges).values(values).returning();
    return row!;
  }

  async listMerges(tx: Tx, limit = 50): Promise<MergeRow[]> {
    return tx.select().from(frontofficePatientMerges).orderBy(desc(frontofficePatientMerges.mergedAt)).limit(limit);
  }

  async patientWithAbha(tx: Tx, abhaNumber: string, excludeId: string) {
    const [row] = await tx
      .select({ id: patients.id, uhid: patients.uhid })
      .from(patients)
      .where(and(eq(patients.abhaNumber, abhaNumber), eq(patients.isActive, true), sql`${patients.id} <> ${excludeId}`))
      .limit(1);
    return row;
  }

  async insertAbha(tx: Tx, values: typeof frontofficePatientAbha.$inferInsert) {
    const [row] = await tx.insert(frontofficePatientAbha).values(values).returning();
    return row!;
  }
}
