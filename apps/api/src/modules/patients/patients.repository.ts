import { Injectable } from '@nestjs/common';
import { and, count, desc, eq, patients, sql, type Tx } from '@hms/db';

export type PatientRow = typeof patients.$inferSelect;
export type NewPatientRow = typeof patients.$inferInsert;

/** Drizzle queries for clinical.patients. Always called inside DbService.tx(). */
@Injectable()
export class PatientsRepository {
  async search(tx: Tx, q: string | undefined, page: number, pageSize: number) {
    const term = q?.trim().toLowerCase();
    const where = term
      ? sql`(${patients.uhid} = upper(${term})
            or ${patients.mobile} like ${term + '%'}
            or ${patients.abhaNumber} = ${term}
            or lower(${patients.firstName} || ' ' || coalesce(${patients.lastName}, '')) like ${'%' + term + '%'}
            or lower(${patients.firstName} || ' ' || coalesce(${patients.lastName}, '')) % ${term})`
      : undefined;
    const filter = and(eq(patients.isActive, true), where);
    const [items, [{ total }]] = await Promise.all([
      tx.select().from(patients).where(filter).orderBy(desc(patients.createdAt)).limit(pageSize).offset((page - 1) * pageSize),
      tx.select({ total: count() }).from(patients).where(filter),
    ]);
    return { items, total };
  }

  async findById(tx: Tx, id: string): Promise<PatientRow | undefined> {
    const [row] = await tx.select().from(patients).where(eq(patients.id, id)).limit(1);
    return row;
  }

  /** Another active patient already holding this ABHA number, if any. */
  async findActiveByAbha(tx: Tx, abhaNumber: string, exceptId?: string): Promise<PatientRow | undefined> {
    const [row] = await tx
      .select()
      .from(patients)
      .where(and(eq(patients.abhaNumber, abhaNumber), eq(patients.isActive, true), exceptId ? sql`${patients.id} <> ${exceptId}` : undefined))
      .limit(1);
    return row;
  }

  async insert(tx: Tx, values: NewPatientRow): Promise<PatientRow> {
    const [row] = await tx.insert(patients).values(values).returning();
    return row!;
  }

  async update(tx: Tx, id: string, values: Partial<NewPatientRow>): Promise<PatientRow | undefined> {
    const [row] = await tx.update(patients).set(values).where(eq(patients.id, id)).returning();
    return row;
  }
}
