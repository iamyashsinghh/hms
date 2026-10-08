import { Injectable } from '@nestjs/common';
import { and, count, desc, eq, formatSeries, ilike, inArray, iso, isNull, nextCounter, opsCssdCycles, opsCssdCycleSets, opsCssdIssues, opsCssdSets, or, sql, type Tx } from '@hms/db';
import type { Paginated, ops as O } from '@hms/shared';
import type { z } from 'zod';
import { DbService } from '../../common/db/db.service';
import { OutboxService } from '../../common/events/outbox.service';
import { currentContext } from '../../common/context/request-context';
import { badRequest, conflict, notFound } from '../../common/errors/errors';
import { PatientsService } from '../patients/patients.service';
import { actorId, defined, facilityCond, num, requireFacility } from './ops.common';

type SetRow = typeof opsCssdSets.$inferSelect;
type CycleRow = typeof opsCssdCycles.$inferSelect;
type SQL = ReturnType<typeof sql>;
type SetIn = z.output<typeof O.cssdSetInputSchema>;

/** CSSD: instrument sets, sterilization loads (cycles) and issue/return with patient traceability. */
@Injectable()
export class CssdService {
  constructor(
    private readonly db: DbService,
    private readonly outbox: OutboxService,
    private readonly patients: PatientsService,
  ) {}

  listSets(q: { status?: O.CssdSetStatus; q?: string }): Promise<O.CssdSet[]> {
    return this.db.tx(async (tx) => {
      const conds: (SQL | undefined)[] = [facilityCond(opsCssdSets.facilityId)];
      if (q.status) conds.push(eq(opsCssdSets.status, q.status));
      if (q.q) conds.push(or(ilike(opsCssdSets.name, `%${q.q}%`), ilike(opsCssdSets.code, `%${q.q}%`)));
      const rows = await tx.select().from(opsCssdSets).where(and(...conds)).orderBy(opsCssdSets.name).limit(500);
      return rows.map(setDto);
    });
  }

  createSet(input: SetIn): Promise<O.CssdSet> {
    const facilityId = requireFacility();
    return this.db.tx(async (tx) => {
      const code = formatSeries('CS', await nextCounter(tx, 'ops.cssd_set'), 5);
      const [row] = await tx
        .insert(opsCssdSets)
        .values({
          tenantId: currentContext()!.tenantId!,
          facilityId,
          code,
          name: input.name,
          department: input.department || null,
          contents: input.contents,
          shelfLifeDays: input.shelfLifeDays,
          isActive: input.isActive ?? true,
          createdBy: actorId(),
          updatedBy: actorId(),
        })
        .returning();
      return setDto(row!);
    });
  }

  updateSet(id: string, input: z.output<typeof O.updateCssdSetSchema>): Promise<O.CssdSet> {
    return this.db.tx(async (tx) => {
      const [row] = await tx
        .update(opsCssdSets)
        .set({
          ...defined({
            name: input.name,
            department: input.department === undefined ? undefined : input.department || null,
            contents: input.contents,
            shelfLifeDays: input.shelfLifeDays,
            isActive: input.isActive,
          }),
          updatedBy: actorId(),
        })
        .where(eq(opsCssdSets.id, id))
        .returning();
      if (!row) throw notFound('Instrument set');
      return setDto(row);
    });
  }

  listCycles(page: number, pageSize: number): Promise<Paginated<O.CssdCycle>> {
    return this.db.tx(async (tx) => {
      const where = facilityCond(opsCssdCycles.facilityId);
      const [rows, [{ total }]] = await Promise.all([
        tx.select().from(opsCssdCycles).where(where).orderBy(desc(opsCssdCycles.startedAt)).limit(pageSize).offset((page - 1) * pageSize),
        tx.select({ total: count() }).from(opsCssdCycles).where(where),
      ]);
      const sets = await this.cycleSets(
        tx,
        rows.map((r) => r.id),
      );
      return { items: rows.map((r) => cycleDto(r, sets.get(r.id) ?? [])), page, pageSize, total };
    });
  }

  startCycle(input: z.output<typeof O.startCycleSchema>): Promise<O.CssdCycle> {
    const facilityId = requireFacility();
    return this.db.tx(async (tx) => {
      const ids = [...new Set(input.setIds)];
      const sets = await tx.select().from(opsCssdSets).where(inArray(opsCssdSets.id, ids)).for('update');
      if (sets.length !== ids.length) throw notFound('Instrument set');
      for (const s of sets) {
        if (s.facilityId !== facilityId) throw badRequest('wrong_facility', `${s.code} belongs to another facility`);
        if (!s.isActive) throw conflict('set_inactive', `${s.code} is inactive`);
        if (s.status === 'issued' || s.status === 'sterilizing') throw conflict('set_not_ready', `${s.code} is ${s.status}; it must be returned first`);
        if (s.status === 'sterile' && !isExpired(s)) throw conflict('set_already_sterile', `${s.code} is already sterile`);
      }
      const number = formatSeries('CY', await nextCounter(tx, 'ops.cssd_cycle'));
      const tenantId = currentContext()!.tenantId!;
      const [cycle] = await tx
        .insert(opsCssdCycles)
        .values({
          tenantId,
          number,
          facilityId,
          sterilizer: input.sterilizer,
          method: input.method,
          temperatureC: input.temperatureC === undefined ? null : input.temperatureC.toFixed(1),
          pressure: input.pressure || null,
          startedBy: actorId(),
        })
        .returning();
      await tx.insert(opsCssdCycleSets).values(ids.map((setId) => ({ tenantId, cycleId: cycle!.id, setId })));
      await tx
        .update(opsCssdSets)
        .set({ status: 'sterilizing', sterileUntil: null, lastCycleId: cycle!.id, updatedBy: actorId() })
        .where(inArray(opsCssdSets.id, ids));
      return cycleDto(cycle!, sets.map(setRef));
    });
  }

  completeCycle(id: string, input: z.output<typeof O.completeCycleSchema>): Promise<O.CssdCycle> {
    return this.db.tx(async (tx) => {
      const [cycle] = await tx.select().from(opsCssdCycles).where(eq(opsCssdCycles.id, id)).for('update');
      if (!cycle) throw notFound('Sterilization cycle');
      if (cycle.status !== 'running') throw conflict('cycle_closed', `Cycle ${cycle.number} is already ${cycle.status}`);
      const passed = input.chemicalIndicatorPassed && input.biologicalIndicatorPassed !== false;
      const [row] = await tx
        .update(opsCssdCycles)
        .set({
          status: passed ? 'passed' : 'failed',
          chemicalIndicatorPassed: input.chemicalIndicatorPassed,
          biologicalIndicatorPassed: input.biologicalIndicatorPassed ?? null,
          notes: input.notes || null,
          completedBy: actorId(),
          completedAt: sql`now()`,
        })
        .where(eq(opsCssdCycles.id, id))
        .returning();
      const setIds = (await tx.select({ setId: opsCssdCycleSets.setId }).from(opsCssdCycleSets).where(eq(opsCssdCycleSets.cycleId, id))).map((r) => r.setId);
      // Only sets still waiting on this load (a set re-run elsewhere has moved on).
      const mine = and(inArray(opsCssdSets.id, setIds), eq(opsCssdSets.lastCycleId, id), eq(opsCssdSets.status, 'sterilizing'));
      if (passed) {
        await tx
          .update(opsCssdSets)
          .set({ status: 'sterile', sterileUntil: sql`now() + make_interval(days => ${opsCssdSets.shelfLifeDays})`, updatedBy: actorId() })
          .where(mine);
      } else {
        await tx.update(opsCssdSets).set({ status: 'dirty', sterileUntil: null, updatedBy: actorId() }).where(mine);
        const event: O.CssdCycleFailedEvent = { cycleId: id, number: cycle.number, facilityId: cycle.facilityId, setIds };
        await this.outbox.publish(tx, 'ops.cssd.cycle_failed', event);
      }
      const sets = await this.cycleSets(tx, [id]);
      return cycleDto(row!, sets.get(id) ?? []);
    });
  }

  listIssues(q: { setId?: string; cycleId?: string; open?: 'true' | 'false' }): Promise<O.CssdIssue[]> {
    return this.db.tx(async (tx) => {
      const conds: (SQL | undefined)[] = [facilityCond(opsCssdSets.facilityId)];
      if (q.setId) conds.push(eq(opsCssdIssues.setId, q.setId));
      if (q.cycleId) conds.push(eq(opsCssdIssues.cycleId, q.cycleId));
      if (q.open === 'true') conds.push(isNull(opsCssdIssues.returnedAt));
      if (q.open === 'false') conds.push(sql`${opsCssdIssues.returnedAt} is not null`);
      const rows = await this.issueQuery(tx).where(and(...conds)).orderBy(desc(opsCssdIssues.issuedAt)).limit(200);
      return rows.map(issueDto);
    });
  }

  async issue(input: z.output<typeof O.issueSetSchema>): Promise<O.CssdIssue> {
    if (input.patientId) await this.patients.get(input.patientId);
    return this.db.tx(async (tx) => {
      const [set] = await tx.select().from(opsCssdSets).where(eq(opsCssdSets.id, input.setId)).for('update');
      if (!set) throw notFound('Instrument set');
      if (set.status !== 'sterile') throw conflict('set_not_sterile', `${set.code} is not sterile (${set.status})`);
      if (isExpired(set)) throw conflict('set_expired', `${set.code} passed its sterile shelf life; re-process it`);
      const [row] = await tx
        .insert(opsCssdIssues)
        .values({
          tenantId: set.tenantId,
          setId: set.id,
          cycleId: set.lastCycleId,
          issuedTo: input.issuedTo,
          patientId: input.patientId ?? null,
          issuedBy: actorId(),
        })
        .returning({ id: opsCssdIssues.id });
      await tx.update(opsCssdSets).set({ status: 'issued', issuedTo: input.issuedTo, updatedBy: actorId() }).where(eq(opsCssdSets.id, set.id));
      const [full] = await this.issueQuery(tx).where(eq(opsCssdIssues.id, row!.id));
      return issueDto(full!);
    });
  }

  returnSet(issueId: string, notes?: string): Promise<O.CssdIssue> {
    return this.db.tx(async (tx) => {
      const [iss] = await tx.select().from(opsCssdIssues).where(eq(opsCssdIssues.id, issueId)).for('update');
      if (!iss) throw notFound('Issue');
      if (iss.returnedAt) throw conflict('already_returned', 'This set was already returned');
      await tx
        .update(opsCssdIssues)
        .set({ returnedAt: sql`now()`, receivedBy: actorId(), notes: notes || iss.notes })
        .where(eq(opsCssdIssues.id, issueId));
      await tx
        .update(opsCssdSets)
        .set({ status: 'dirty', issuedTo: null, sterileUntil: null, updatedBy: actorId() })
        .where(eq(opsCssdSets.id, iss.setId));
      const [full] = await this.issueQuery(tx).where(eq(opsCssdIssues.id, issueId));
      return issueDto(full!);
    });
  }

  private issueQuery(tx: Tx) {
    return tx
      .select({ i: opsCssdIssues, code: opsCssdSets.code, name: opsCssdSets.name, cycleNumber: opsCssdCycles.number })
      .from(opsCssdIssues)
      .innerJoin(opsCssdSets, and(eq(opsCssdSets.tenantId, opsCssdIssues.tenantId), eq(opsCssdSets.id, opsCssdIssues.setId)))
      .leftJoin(opsCssdCycles, and(eq(opsCssdCycles.tenantId, opsCssdIssues.tenantId), eq(opsCssdCycles.id, opsCssdIssues.cycleId)))
      .$dynamic();
  }

  private async cycleSets(tx: Tx, cycleIds: string[]) {
    const out = new Map<string, O.CssdCycle['sets']>();
    if (!cycleIds.length) return out;
    const rows = await tx
      .select({ cycleId: opsCssdCycleSets.cycleId, setId: opsCssdSets.id, code: opsCssdSets.code, name: opsCssdSets.name })
      .from(opsCssdCycleSets)
      .innerJoin(opsCssdSets, and(eq(opsCssdSets.tenantId, opsCssdCycleSets.tenantId), eq(opsCssdSets.id, opsCssdCycleSets.setId)))
      .where(inArray(opsCssdCycleSets.cycleId, cycleIds));
    for (const r of rows) out.set(r.cycleId, [...(out.get(r.cycleId) ?? []), { setId: r.setId, code: r.code, name: r.name }]);
    return out;
  }
}

const isExpired = (s: SetRow) => s.status === 'sterile' && !!s.sterileUntil && new Date(s.sterileUntil).getTime() < Date.now();
const setRef = (s: SetRow) => ({ setId: s.id, code: s.code, name: s.name });

function setDto(r: SetRow): O.CssdSet {
  return {
    id: r.id,
    code: r.code,
    facilityId: r.facilityId,
    name: r.name,
    department: r.department,
    contents: r.contents,
    shelfLifeDays: r.shelfLifeDays,
    status: r.status as O.CssdSetStatus,
    sterileUntil: iso(r.sterileUntil),
    expired: isExpired(r),
    lastCycleId: r.lastCycleId,
    issuedTo: r.issuedTo,
    isActive: r.isActive,
    updatedAt: iso(r.updatedAt),
  };
}

function cycleDto(r: CycleRow, sets: O.CssdCycle['sets']): O.CssdCycle {
  return {
    id: r.id,
    number: r.number,
    facilityId: r.facilityId,
    sterilizer: r.sterilizer,
    method: r.method as O.CssdMethod,
    status: r.status as O.CssdCycleStatus,
    temperatureC: num(r.temperatureC),
    pressure: r.pressure,
    chemicalIndicatorPassed: r.chemicalIndicatorPassed,
    biologicalIndicatorPassed: r.biologicalIndicatorPassed,
    notes: r.notes,
    startedAt: iso(r.startedAt),
    completedAt: iso(r.completedAt),
    sets,
  };
}

function issueDto(r: { i: typeof opsCssdIssues.$inferSelect; code: string; name: string; cycleNumber: string | null }): O.CssdIssue {
  return {
    id: r.i.id,
    setId: r.i.setId,
    setCode: r.code,
    setName: r.name,
    cycleId: r.i.cycleId,
    cycleNumber: r.cycleNumber,
    issuedTo: r.i.issuedTo,
    patientId: r.i.patientId,
    issuedAt: iso(r.i.issuedAt),
    returnedAt: iso(r.i.returnedAt),
    notes: r.i.notes,
  };
}
