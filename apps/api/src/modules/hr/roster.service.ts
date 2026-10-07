import { Injectable } from '@nestjs/common';
import { and, asc, eq, hrEmployees, hrRosterEntries, hrShifts, inArray, sql, type Tx } from '@hms/db';
import { hr as contracts } from '@hms/shared';
import { DbService } from '../../common/db/db.service';
import { currentContext } from '../../common/context/request-context';
import { badRequest, notFound } from '../../common/errors/errors';
import { EmployeesService } from './employees.service';
import { addDays, daysBetween, eachDay, hhmmOf, shiftMinutes } from './hr.util';

type ShiftRow = typeof hrShifts.$inferSelect;
type RosterRow = typeof hrRosterEntries.$inferSelect;

export function requireFacility(): string {
  const id = currentContext()?.facilityId;
  if (!id) throw badRequest('facility_required', 'Choose a facility (X-Facility-Id) first');
  return id;
}

@Injectable()
export class RosterService {
  constructor(
    private readonly db: DbService,
    private readonly employees: EmployeesService,
  ) {}

  // ---------- shifts ----------

  listShifts(includeInactive = false): Promise<contracts.Shift[]> {
    return this.db.tx(async (tx) => (await this.shifts(tx, includeInactive)).map(toShift));
  }

  createShift(input: contracts.ShiftInput): Promise<contracts.Shift> {
    const b = contracts.shiftInputSchema.parse(input);
    return this.db.tx(async (tx) => {
      const [row] = await tx
        .insert(hrShifts)
        .values({ tenantId: currentContext()!.tenantId!, code: b.code, name: b.name, startTime: b.startTime, endTime: b.endTime, breakMinutes: b.breakMinutes, graceMinutes: b.graceMinutes, color: b.color ?? null, isActive: b.isActive })
        .returning();
      return toShift(row!);
    });
  }

  updateShift(id: string, input: contracts.UpdateShift): Promise<contracts.Shift> {
    const b = contracts.updateShiftSchema.parse(input);
    return this.db.tx(async (tx) => {
      const [row] = await tx.update(hrShifts).set(b).where(eq(hrShifts.id, id)).returning();
      if (!row) throw notFound('Shift');
      return toShift(row);
    });
  }

  /** Shifts of the hospital; the first call creates Morning/Evening/Night/General. */
  async shifts(tx: Tx, includeInactive = true): Promise<ShiftRow[]> {
    let rows = await tx.select().from(hrShifts).orderBy(asc(hrShifts.startTime));
    if (!rows.length) {
      const tenantId = currentContext()!.tenantId!;
      await tx
        .insert(hrShifts)
        .values(contracts.DEFAULT_SHIFTS.map((s) => ({ ...s, tenantId })))
        .onConflictDoNothing();
      rows = await tx.select().from(hrShifts).orderBy(asc(hrShifts.startTime));
    }
    return includeInactive ? rows : rows.filter((r) => r.isActive);
  }

  // ---------- roster ----------

  view(q: contracts.RosterQuery): Promise<contracts.RosterView> {
    const query = contracts.rosterQuerySchema.parse(q);
    if (query.to < query.from) throw badRequest('bad_range', 'To date is before from date');
    if (daysBetween(query.from, query.to) > 62) throw badRequest('range_too_long', 'Show at most 62 days at a time');
    return this.db.tx(async (tx) => {
      const shifts = await this.shifts(tx);
      let staff = await this.employees.onRolls(tx, query.from, query.to, query.department);
      if (query.employeeId) staff = staff.filter((e) => e.id === query.employeeId);
      const entries = staff.length
        ? await tx
            .select()
            .from(hrRosterEntries)
            .where(
              and(
                inArray(hrRosterEntries.employeeId, staff.map((e) => e.id)),
                sql`${hrRosterEntries.dutyDate} between ${query.from} and ${query.to}`,
              ),
            )
        : [];
      const codes = new Map(shifts.map((s) => [s.id, s.code]));
      return {
        from: query.from,
        to: query.to,
        employees: staff.map((e) => ({
          id: e.id,
          employeeCode: e.employeeCode,
          fullName: e.fullName,
          designation: e.designation,
          department: e.department,
          category: e.category as contracts.EmployeeCategory,
        })),
        shifts: shifts.map(toShift),
        entries: entries.map((r) => toEntry(r, codes)),
      };
    });
  }

  save(input: contracts.SaveRoster): Promise<{ saved: number; cleared: number }> {
    const { cells } = contracts.saveRosterSchema.parse(input);
    const facilityId = requireFacility();
    const ctx = currentContext()!;
    return this.db.tx(async (tx) => {
      const shifts = new Map((await this.shifts(tx)).map((s) => [s.id, s]));
      const ids = [...new Set(cells.map((c) => c.employeeId))];
      const staff = new Map((await tx.select().from(hrEmployees).where(inArray(hrEmployees.id, ids))).map((e) => [e.id, e]));
      let saved = 0;
      let cleared = 0;
      for (const c of cells) {
        const emp = staff.get(c.employeeId);
        if (!emp) throw notFound('Employee');
        if (c.kind === null) {
          const del = await tx
            .delete(hrRosterEntries)
            .where(and(eq(hrRosterEntries.employeeId, c.employeeId), eq(hrRosterEntries.dutyDate, c.date)))
            .returning({ id: hrRosterEntries.id });
          cleared += del.length;
          continue;
        }
        EmployeesService.assertEmployedOn(emp, c.date);
        let shiftId: string | null = null;
        if (c.kind === 'shift') {
          const s = c.shiftId ? shifts.get(c.shiftId) : undefined;
          if (!s) throw badRequest('shift_required', 'Pick a shift for a duty cell');
          shiftId = s.id;
        }
        await tx
          .insert(hrRosterEntries)
          .values({ tenantId: ctx.tenantId!, facilityId, employeeId: c.employeeId, dutyDate: c.date, kind: c.kind, shiftId, ward: c.ward ?? null, createdBy: ctx.userId, updatedBy: ctx.userId })
          .onConflictDoUpdate({
            target: [hrRosterEntries.tenantId, hrRosterEntries.employeeId, hrRosterEntries.dutyDate],
            set: { facilityId, kind: c.kind, shiftId, ward: c.ward ?? null, leaveRequestId: null, updatedBy: ctx.userId },
          });
        saved++;
      }
      return { saved, cleared };
    });
  }

  /** Copies 7 days of roster (this facility) to another week. Approved leave in the target week is never overwritten. */
  copyWeek(input: contracts.CopyRoster): Promise<{ copied: number; skipped: number }> {
    const b = contracts.copyRosterSchema.parse(input);
    const facilityId = requireFacility();
    const ctx = currentContext()!;
    return this.db.tx(async (tx) => {
      const offset = daysBetween(b.fromWeekStart, b.toWeekStart) - 1;
      if (offset === 0) throw badRequest('same_week', 'Pick a different week to copy to');
      const toEnd = addDays(b.toWeekStart, 6);
      const source = await tx
        .select()
        .from(hrRosterEntries)
        .where(
          and(
            eq(hrRosterEntries.facilityId, facilityId),
            sql`${hrRosterEntries.dutyDate} between ${b.fromWeekStart} and ${addDays(b.fromWeekStart, 6)}`,
            sql`${hrRosterEntries.kind} in ('shift', 'off')`,
          ),
        );
      const staff = new Map((await this.employees.onRolls(tx, b.toWeekStart, toEnd)).map((e) => [e.id, e]));
      const existing = new Map(
        (
          await tx
            .select({ employeeId: hrRosterEntries.employeeId, date: hrRosterEntries.dutyDate, kind: hrRosterEntries.kind })
            .from(hrRosterEntries)
            .where(sql`${hrRosterEntries.dutyDate} between ${b.toWeekStart} and ${toEnd}`)
        ).map((r) => [`${r.employeeId}|${r.date}`, r.kind]),
      );
      let copied = 0;
      let skipped = 0;
      for (const s of source) {
        const date = addDays(s.dutyDate, offset);
        const emp = staff.get(s.employeeId);
        const prior = existing.get(`${s.employeeId}|${date}`);
        if (!emp || emp.dateOfJoining > date || (emp.dateOfExit && emp.dateOfExit < date) || prior === 'leave' || (prior && !b.overwrite)) {
          skipped++;
          continue;
        }
        await tx
          .insert(hrRosterEntries)
          .values({ tenantId: ctx.tenantId!, facilityId, employeeId: s.employeeId, dutyDate: date, kind: s.kind, shiftId: s.shiftId, ward: s.ward, createdBy: ctx.userId, updatedBy: ctx.userId })
          .onConflictDoUpdate({
            target: [hrRosterEntries.tenantId, hrRosterEntries.employeeId, hrRosterEntries.dutyDate],
            set: { facilityId, kind: s.kind, shiftId: s.shiftId, ward: s.ward, leaveRequestId: null, updatedBy: ctx.userId },
          });
        copied++;
      }
      return { copied, skipped };
    });
  }

  /** Staff on duty on a date, grouped by shift (this facility when one is chosen). */
  onDuty(date: string): Promise<contracts.OnDutyRow[]> {
    const facilityId = currentContext()?.facilityId;
    return this.db.tx(async (tx) => {
      const rows = await tx
        .select({ r: hrRosterEntries, s: hrShifts, e: hrEmployees })
        .from(hrRosterEntries)
        .innerJoin(hrShifts, and(eq(hrShifts.tenantId, hrRosterEntries.tenantId), eq(hrShifts.id, hrRosterEntries.shiftId)))
        .innerJoin(hrEmployees, and(eq(hrEmployees.tenantId, hrRosterEntries.tenantId), eq(hrEmployees.id, hrRosterEntries.employeeId)))
        .where(and(eq(hrRosterEntries.dutyDate, date), eq(hrRosterEntries.kind, 'shift'), facilityId ? eq(hrRosterEntries.facilityId, facilityId) : undefined))
        .orderBy(asc(hrShifts.startTime), asc(hrEmployees.fullName));
      const out = new Map<string, contracts.OnDutyRow>();
      for (const { r, s, e } of rows) {
        const row = out.get(s.id) ?? { shift: { id: s.id, code: s.code, name: s.name, startTime: hhmmOf(s.startTime), endTime: hhmmOf(s.endTime) }, staff: [] };
        row.staff.push({ employeeId: e.id, fullName: e.fullName, designation: e.designation, department: e.department, ward: r.ward });
        out.set(s.id, row);
      }
      return [...out.values()];
    });
  }

  /** Own roster for self-service. */
  mine(from: string, to: string): Promise<{ shifts: contracts.Shift[]; entries: contracts.RosterEntry[] }> {
    if (daysBetween(from, to) > 62 || to < from) throw badRequest('bad_range', 'Pick up to 62 days');
    return this.db.tx(async (tx) => {
      const me = await this.employees.requireSelf(tx);
      const shifts = await this.shifts(tx);
      const codes = new Map(shifts.map((s) => [s.id, s.code]));
      const rows = await tx
        .select()
        .from(hrRosterEntries)
        .where(and(eq(hrRosterEntries.employeeId, me.id), sql`${hrRosterEntries.dutyDate} between ${from} and ${to}`))
        .orderBy(asc(hrRosterEntries.dutyDate));
      return { shifts: shifts.map(toShift), entries: rows.map((r) => toEntry(r, codes)) };
    });
  }

  // ---------- used by leave and attendance ----------

  /** Marks the dates of an approved leave on the roster (keeps the facility of any existing cell). */
  async markLeave(tx: Tx, employeeId: string, leaveRequestId: string, from: string, to: string, fallbackFacilityId: string | null) {
    const ctx = currentContext()!;
    const existing = new Map(
      (
        await tx
          .select({ date: hrRosterEntries.dutyDate, facilityId: hrRosterEntries.facilityId })
          .from(hrRosterEntries)
          .where(and(eq(hrRosterEntries.employeeId, employeeId), sql`${hrRosterEntries.dutyDate} between ${from} and ${to}`))
      ).map((r) => [r.date, r.facilityId]),
    );
    for (const date of eachDay(from, to)) {
      const facilityId = existing.get(date) ?? fallbackFacilityId;
      if (!facilityId) continue;
      await tx
        .insert(hrRosterEntries)
        .values({ tenantId: ctx.tenantId!, facilityId, employeeId, dutyDate: date, kind: 'leave', shiftId: null, leaveRequestId, createdBy: ctx.userId, updatedBy: ctx.userId })
        .onConflictDoUpdate({
          target: [hrRosterEntries.tenantId, hrRosterEntries.employeeId, hrRosterEntries.dutyDate],
          set: { kind: 'leave', shiftId: null, leaveRequestId, updatedBy: ctx.userId },
        });
    }
  }

  async clearLeave(tx: Tx, leaveRequestId: string) {
    await tx.delete(hrRosterEntries).where(eq(hrRosterEntries.leaveRequestId, leaveRequestId));
  }

  async entryFor(tx: Tx, employeeId: string, date: string): Promise<{ entry: RosterRow; shift: ShiftRow | null } | null> {
    const [row] = await tx
      .select({ entry: hrRosterEntries, shift: hrShifts })
      .from(hrRosterEntries)
      .leftJoin(hrShifts, and(eq(hrShifts.tenantId, hrRosterEntries.tenantId), eq(hrShifts.id, hrRosterEntries.shiftId)))
      .where(and(eq(hrRosterEntries.employeeId, employeeId), eq(hrRosterEntries.dutyDate, date)))
      .limit(1);
    return row ?? null;
  }
}

export function toShift(r: ShiftRow): contracts.Shift {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    startTime: hhmmOf(r.startTime),
    endTime: hhmmOf(r.endTime),
    breakMinutes: r.breakMinutes,
    graceMinutes: r.graceMinutes,
    color: r.color,
    isActive: r.isActive,
    overnight: r.endTime <= r.startTime,
    durationMinutes: shiftMinutes(r.startTime, r.endTime, r.breakMinutes),
  };
}

export function toEntry(r: RosterRow, codes: Map<string, string>): contracts.RosterEntry {
  return {
    id: r.id,
    employeeId: r.employeeId,
    date: r.dutyDate,
    kind: r.kind as contracts.RosterKind,
    shiftId: r.shiftId,
    shiftCode: r.shiftId ? (codes.get(r.shiftId) ?? null) : null,
    ward: r.ward,
    facilityId: r.facilityId,
    leaveRequestId: r.leaveRequestId,
  };
}
