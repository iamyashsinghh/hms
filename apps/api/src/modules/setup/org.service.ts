import { Injectable } from '@nestjs/common';
import { and, asc, eq, facilities, iso, setupDepartments, setupSpecializations, sql, type Tx } from '@hms/db';
import { setup as S } from '@hms/shared';
import { DbService } from '../../common/db/db.service';
import { badRequest, conflict, notFound } from '../../common/errors/errors';
import { ctx } from './setup.util';

type FacilityRow = typeof facilities.$inferSelect;
type DepartmentRow = typeof setupDepartments.$inferSelect;
type SpecializationRow = typeof setupSpecializations.$inferSelect;

const search = (col: unknown, q?: string) => (q ? sql`(lower(${col}) like ${'%' + q.toLowerCase() + '%'})` : undefined);

/** Facilities (branches), departments and specializations. */
@Injectable()
export class OrgService {
  constructor(private readonly db: DbService) {}

  // ---------- facilities ----------

  listFacilities(q: S.ListQuery): Promise<S.FacilityDetail[]> {
    return this.db.tx(async (tx) => {
      const rows = await tx
        .select()
        .from(facilities)
        .where(and(q.includeInactive ? undefined : eq(facilities.isActive, true), search(facilities.name, q.q)))
        .orderBy(asc(facilities.name));
      return rows.map(facilityDto);
    });
  }

  getFacility(id: string): Promise<S.FacilityDetail> {
    return this.db.tx(async (tx) => facilityDto(await this.findFacility(tx, id)));
  }

  createFacility(input: S.CreateFacility): Promise<S.FacilityDetail> {
    const c = ctx();
    return this.db.tx(async (tx) => {
      await this.assertFacilityCodeFree(tx, input.code);
      const [row] = await tx
        .insert(facilities)
        .values({
          tenantId: c.tenantId,
          code: input.code,
          name: input.name,
          type: input.type ?? 'hospital',
          phone: input.phone ?? null,
          gstin: input.gstin ?? null,
          address: (input.address as Record<string, string> | undefined) ?? null,
          createdBy: c.userId,
          updatedBy: c.userId,
        })
        .returning();
      return facilityDto(row!);
    });
  }

  updateFacility(id: string, input: S.UpdateFacility): Promise<S.FacilityDetail> {
    const c = ctx();
    return this.db.tx(async (tx) => {
      const cur = await this.findFacility(tx, id);
      if (input.code && input.code !== cur.code) await this.assertFacilityCodeFree(tx, input.code);
      if (input.isActive === false && cur.isActive) {
        const [{ n }] = (await tx.execute<{ n: number }>(sql`select count(*)::int as n from setup.facilities where is_active and id <> ${id}`)).rows as [{ n: number }];
        if (n === 0) throw conflict('last_facility', 'A hospital needs at least one active facility');
      }
      const [row] = await tx
        .update(facilities)
        .set({
          ...(input.code !== undefined && { code: input.code }),
          ...(input.name !== undefined && { name: input.name }),
          ...(input.type !== undefined && { type: input.type }),
          ...(input.phone !== undefined && { phone: input.phone || null }),
          ...(input.gstin !== undefined && { gstin: input.gstin || null }),
          ...(input.address !== undefined && { address: input.address as Record<string, string> }),
          ...(input.isActive !== undefined && { isActive: input.isActive }),
          updatedBy: c.userId,
        })
        .where(eq(facilities.id, id))
        .returning();
      return facilityDto(row!);
    });
  }

  private async findFacility(tx: Tx, id: string): Promise<FacilityRow> {
    const [row] = await tx.select().from(facilities).where(eq(facilities.id, id)).limit(1);
    if (!row) throw notFound('Facility');
    return row;
  }

  private async assertFacilityCodeFree(tx: Tx, code: string) {
    const [dup] = await tx.select({ id: facilities.id }).from(facilities).where(eq(facilities.code, code)).limit(1);
    if (dup) throw conflict('duplicate_code', `Facility code ${code} is already used`);
  }

  // ---------- departments ----------

  listDepartments(q: S.ListQuery & { facilityId?: string }): Promise<S.Department[]> {
    return this.db.tx(async (tx) => {
      const rows = await tx
        .select({
          d: setupDepartments,
          staffCount: sql<number>`(select count(*)::int from setup.staff_profiles sp where sp.tenant_id = ${setupDepartments.tenantId} and sp.department_id = ${setupDepartments.id})`,
        })
        .from(setupDepartments)
        .where(
          and(
            q.includeInactive ? undefined : eq(setupDepartments.isActive, true),
            search(setupDepartments.name, q.q),
            q.facilityId ? sql`(${setupDepartments.facilityId} is null or ${setupDepartments.facilityId} = ${q.facilityId})` : undefined,
          ),
        )
        .orderBy(asc(setupDepartments.name));
      return rows.map((r) => departmentDto(r.d, r.staffCount));
    });
  }

  createDepartment(input: S.CreateDepartment): Promise<S.Department> {
    const c = ctx();
    return this.db.tx(async (tx) => {
      const [dup] = await tx.select({ id: setupDepartments.id }).from(setupDepartments).where(eq(setupDepartments.code, input.code)).limit(1);
      if (dup) throw conflict('duplicate_code', `S.Department code ${input.code} is already used`);
      if (input.facilityId) await this.findFacility(tx, input.facilityId).catch(() => {
        throw badRequest('invalid_facility', 'Facility not found');
      });
      const [row] = await tx
        .insert(setupDepartments)
        .values({
          tenantId: c.tenantId,
          code: input.code,
          name: input.name,
          type: input.type ?? 'clinical',
          facilityId: input.facilityId ?? null,
          description: input.description || null,
          createdBy: c.userId,
          updatedBy: c.userId,
        })
        .returning();
      return departmentDto(row!, 0);
    });
  }

  updateDepartment(id: string, input: S.UpdateDepartment): Promise<S.Department> {
    const c = ctx();
    return this.db.tx(async (tx) => {
      const [cur] = await tx.select().from(setupDepartments).where(eq(setupDepartments.id, id)).limit(1);
      if (!cur) throw notFound('S.Department');
      if (input.code && input.code !== cur.code) {
        const [dup] = await tx.select({ id: setupDepartments.id }).from(setupDepartments).where(eq(setupDepartments.code, input.code)).limit(1);
        if (dup) throw conflict('duplicate_code', `S.Department code ${input.code} is already used`);
      }
      if (input.facilityId) await this.findFacility(tx, input.facilityId).catch(() => {
        throw badRequest('invalid_facility', 'Facility not found');
      });
      const [row] = await tx
        .update(setupDepartments)
        .set({
          ...(input.code !== undefined && { code: input.code }),
          ...(input.name !== undefined && { name: input.name }),
          ...(input.type !== undefined && { type: input.type }),
          ...(input.facilityId !== undefined && { facilityId: input.facilityId }),
          ...(input.description !== undefined && { description: input.description || null }),
          ...(input.isActive !== undefined && { isActive: input.isActive }),
          updatedBy: c.userId,
        })
        .where(eq(setupDepartments.id, id))
        .returning();
      const count = await tx.execute<{ n: number }>(sql`select count(*)::int as n from setup.staff_profiles where department_id = ${id}`);
      return departmentDto(row!, count.rows[0]?.n ?? 0);
    });
  }

  // ---------- specializations ----------

  listSpecializations(q: S.ListQuery): Promise<S.Specialization[]> {
    return this.db.tx(async (tx) => {
      const rows = await tx
        .select()
        .from(setupSpecializations)
        .where(and(q.includeInactive ? undefined : eq(setupSpecializations.isActive, true), search(setupSpecializations.name, q.q)))
        .orderBy(asc(setupSpecializations.name));
      return rows.map(specializationDto);
    });
  }

  createSpecialization(input: S.CreateSpecialization): Promise<S.Specialization> {
    const c = ctx();
    return this.db.tx(async (tx) => {
      const [dup] = await tx.select({ id: setupSpecializations.id }).from(setupSpecializations).where(eq(setupSpecializations.code, input.code)).limit(1);
      if (dup) throw conflict('duplicate_code', `S.Specialization code ${input.code} is already used`);
      const [row] = await tx.insert(setupSpecializations).values({ tenantId: c.tenantId, code: input.code, name: input.name }).returning();
      return specializationDto(row!);
    });
  }

  updateSpecialization(id: string, input: S.UpdateSpecialization): Promise<S.Specialization> {
    return this.db.tx(async (tx) => {
      const [row] = await tx
        .update(setupSpecializations)
        .set({
          ...(input.code !== undefined && { code: input.code }),
          ...(input.name !== undefined && { name: input.name }),
          ...(input.isActive !== undefined && { isActive: input.isActive }),
        })
        .where(eq(setupSpecializations.id, id))
        .returning();
      if (!row) throw notFound('S.Specialization');
      return specializationDto(row);
    });
  }
}

function facilityDto(r: FacilityRow): S.FacilityDetail {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    type: r.type as S.FacilityDetail['type'],
    phone: r.phone,
    gstin: r.gstin,
    address: r.address ?? null,
    isActive: r.isActive,
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
  };
}

function departmentDto(r: DepartmentRow, staffCount: number): S.Department {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    type: r.type as S.Department['type'],
    facilityId: r.facilityId,
    description: r.description,
    isActive: r.isActive,
    staffCount,
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
  };
}

function specializationDto(r: SpecializationRow): S.Specialization {
  return { id: r.id, code: r.code, name: r.name, isActive: r.isActive };
}
