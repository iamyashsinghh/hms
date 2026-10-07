import { Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, iso, patients, qualityActivities, qualityCapas, sql, users, type Tx } from '@hms/db';
import type { quality as Q } from '@hms/shared';
import { currentContext } from '../../common/context/request-context';

export type CapaRow = typeof qualityCapas.$inferSelect;
export type EntityType = 'incident' | 'complaint' | 'capa' | 'hai' | 'audit' | 'document';

/** Lookups shared by the quality services. Always called inside DbService.tx(). */
@Injectable()
export class QualityRepository {
  /** Staff names by user id (iam.users is core; read-only here). */
  async people(tx: Tx, ids: (string | null | undefined)[]): Promise<Map<string, Q.Person>> {
    const unique = [...new Set(ids.filter((v): v is string => !!v))];
    if (!unique.length) return new Map();
    const rows = await tx.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, unique));
    return new Map(rows.map((r) => [r.id, r]));
  }

  /** Active staff, for owner / assignee pickers. */
  async staff(tx: Tx): Promise<Q.Person[]> {
    return tx.select({ id: users.id, name: users.name }).from(users).where(eq(users.status, 'active')).orderBy(asc(users.name));
  }

  async patientRefs(tx: Tx, ids: (string | null | undefined)[]): Promise<Map<string, Q.PatientRef>> {
    const unique = [...new Set(ids.filter((v): v is string => !!v))];
    if (!unique.length) return new Map();
    const rows = await tx
      .select({ id: patients.id, uhid: patients.uhid, firstName: patients.firstName, lastName: patients.lastName })
      .from(patients)
      .where(inArray(patients.id, unique));
    return new Map(rows.map((r) => [r.id, { id: r.id, uhid: r.uhid, name: [r.firstName, r.lastName].filter(Boolean).join(' ') }]));
  }

  async patientExists(tx: Tx, id: string): Promise<boolean> {
    const [row] = await tx.select({ id: patients.id }).from(patients).where(eq(patients.id, id)).limit(1);
    return !!row;
  }

  async userExists(tx: Tx, id: string): Promise<boolean> {
    const [row] = await tx.select({ id: users.id }).from(users).where(eq(users.id, id)).limit(1);
    return !!row;
  }

  async addActivity(
    tx: Tx,
    entityType: EntityType,
    entityId: string,
    action: string,
    opts: { from?: string | null; to?: string | null; note?: string | null; anonymous?: boolean } = {},
  ): Promise<void> {
    const ctx = opts.anonymous ? undefined : currentContext();
    await tx.insert(qualityActivities).values({
      tenantId: sql`app.current_tenant_id()` as unknown as string,
      entityType,
      entityId,
      action,
      fromStatus: opts.from ?? null,
      toStatus: opts.to ?? null,
      note: opts.note ?? null,
      actorId: ctx?.userId ?? null,
    });
  }

  async activities(tx: Tx, entityType: EntityType, entityId: string): Promise<Q.Activity[]> {
    const rows = await tx
      .select()
      .from(qualityActivities)
      .where(and(eq(qualityActivities.entityType, entityType), eq(qualityActivities.entityId, entityId)))
      .orderBy(asc(qualityActivities.createdAt), asc(qualityActivities.id));
    const people = await this.people(tx, rows.map((r) => r.actorId));
    return rows.map((r) => ({
      id: r.id,
      action: r.action,
      fromStatus: r.fromStatus,
      toStatus: r.toStatus,
      note: r.note,
      actor: r.actorId ? (people.get(r.actorId) ?? null) : null,
      createdAt: iso(r.createdAt),
    }));
  }

  async capasFor(tx: Tx, sourceType: Q.CapaSource, sourceIds: string[]): Promise<CapaRow[]> {
    if (!sourceIds.length) return [];
    return tx
      .select()
      .from(qualityCapas)
      .where(and(eq(qualityCapas.sourceType, sourceType), inArray(qualityCapas.sourceId, sourceIds)))
      .orderBy(asc(qualityCapas.createdAt));
  }
}
