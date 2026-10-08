import { Injectable } from '@nestjs/common';
import { and, asc, eq, hrAttendance, hrEmployees, hrRosterEntries, hrShifts, inArray, iso, sql, type Tx } from '@hms/db';
import { hr as contracts } from '@hms/shared';
import { DbService } from '../../common/db/db.service';
import { currentContext } from '../../common/context/request-context';
import { badRequest, conflict, notFound } from '../../common/errors/errors';
import { EmployeesService } from './employees.service';
import { requireFacility, RosterService, toShift } from './roster.service';
import { addDays, istInstant, monthRange, shiftMinutes, todayIST } from './hr.util';

type AttendanceRow = typeof hrAttendance.$inferSelect;
type ShiftRow = typeof hrShifts.$inferSelect;

/** Night duty can be punched out up to this long after punching in. */
const MAX_SHIFT_HOURS = 20;

@Injectable()
export class AttendanceService {
  constructor(
    private readonly db: DbService,
    private readonly employees: EmployeesService,
    private readonly roster: RosterService,
  ) {}

  /** Everyone on the rolls for a day with their roster cell and attendance. */
  sheet(q: contracts.AttendanceQuery): Promise<contracts.AttendanceSheetRow[]> {
    const { date, department } = contracts.attendanceQuerySchema.parse(q);
    return this.db.tx(async (tx) => {
      const staff = await this.employees.onRolls(tx, date, date, department);
      if (!staff.length) return [];
      const ids = staff.map((e) => e.id);
      const [entries, marks] = await Promise.all([
        tx
          .select({ r: hrRosterEntries, code: hrShifts.code })
          .from(hrRosterEntries)
          .leftJoin(hrShifts, and(eq(hrShifts.tenantId, hrRosterEntries.tenantId), eq(hrShifts.id, hrRosterEntries.shiftId)))
          .where(and(eq(hrRosterEntries.dutyDate, date), inArray(hrRosterEntries.employeeId, ids))),
        tx.select().from(hrAttendance).where(and(eq(hrAttendance.workDate, date), inArray(hrAttendance.employeeId, ids))),
      ]);
      const rosterBy = new Map(entries.map((x) => [x.r.employeeId, x]));
      const markBy = new Map(marks.map((m) => [m.employeeId, m]));
      return staff.map((e) => {
        const r = rosterBy.get(e.id);
        const m = markBy.get(e.id);
        return {
          employee: { id: e.id, employeeCode: e.employeeCode, fullName: e.fullName, designation: e.designation, department: e.department },
          roster: r ? { kind: r.r.kind as contracts.RosterKind, shiftCode: r.code, ward: r.r.ward } : null,
          attendance: m ? toRecord(m) : null,
        };
      });
    });
  }

  mark(input: contracts.MarkAttendance): Promise<contracts.AttendanceRecord[]> {
    const { date, rows } = contracts.markAttendanceSchema.parse(input);
    const facilityId = requireFacility();
    const ctx = currentContext()!;
    return this.db.tx(async (tx) => {
      const ids = [...new Set(rows.map((r) => r.employeeId))];
      const staff = new Map((await tx.select().from(hrEmployees).where(inArray(hrEmployees.id, ids))).map((e) => [e.id, e]));
      const out: contracts.AttendanceRecord[] = [];
      for (const r of rows) {
        const emp = staff.get(r.employeeId);
        if (!emp) throw notFound('Employee');
        EmployeesService.assertEmployedOn(emp, date);
        const working = r.status === 'present' || r.status === 'half_day';
        const checkIn = working && r.checkIn ? istInstant(date, r.checkIn) : null;
        let checkOut = working && r.checkOut ? istInstant(date, r.checkOut) : null;
        if (checkIn && checkOut && checkOut <= checkIn) checkOut = new Date(checkOut.getTime() + 86_400_000);
        const soon = Date.now() + 5 * 60_000;
        if (checkIn && checkIn.getTime() > soon) throw badRequest('future_time', `${emp.fullName}: in time cannot be in the future`);
        if (checkOut && checkOut.getTime() > soon) throw badRequest('future_time', `${emp.fullName}: out time cannot be in the future`);
        const shift = (await this.roster.entryFor(tx, emp.id, date))?.shift ?? null;
        const times = computeTimes(date, shift, checkIn, checkOut);
        const values = {
          facilityId,
          status: r.status,
          checkIn: checkIn?.toISOString() ?? null,
          checkOut: checkOut?.toISOString() ?? null,
          ...times,
          source: 'manual' as const,
          remarks: r.remarks ?? null,
          updatedBy: ctx.userId,
        };
        const [row] = await tx
          .insert(hrAttendance)
          .values({ ...values, tenantId: ctx.tenantId!, employeeId: emp.id, workDate: date, createdBy: ctx.userId })
          .onConflictDoUpdate({ target: [hrAttendance.tenantId, hrAttendance.employeeId, hrAttendance.workDate], set: values })
          .returning();
        out.push(toRecord(row!));
      }
      return out;
    });
  }

  /** Month totals per employee (for payroll checks and the muster roll). */
  monthSummary(q: contracts.MonthQuery): Promise<contracts.AttendanceSummary[]> {
    const { month } = contracts.monthQuerySchema.parse(q);
    const { start, end } = monthRange(month);
    return this.db.tx(async (tx) => {
      const staff = await this.employees.onRolls(tx, start, end);
      const rows = (
        await tx.execute<{ employee_id: string; status: string; n: number; late: number; ot: number }>(sql`
          select employee_id, status, count(*)::int as n, count(*) filter (where late_minutes > 0)::int as late,
                 coalesce(sum(overtime_minutes), 0)::int as ot
            from hr.attendance where work_date between ${start} and ${end}
           group by employee_id, status`)
      ).rows;
      return staff.map((e) => {
        const mine = rows.filter((r) => r.employee_id === e.id);
        const c = (s: string) => mine.find((r) => r.status === s)?.n ?? 0;
        return {
          employeeId: e.id,
          employeeCode: e.employeeCode,
          fullName: e.fullName,
          present: c('present'),
          halfDay: c('half_day'),
          absent: c('absent'),
          leave: c('leave'),
          off: c('off'),
          holiday: c('holiday'),
          lateDays: mine.reduce((s, r) => s + r.late, 0),
          overtimeMinutes: mine.reduce((s, r) => s + r.ot, 0),
        };
      });
    });
  }

  // ---------- self-service ----------

  /** Punch in, or punch out of the open punch (night duty may end the next day). */
  punch(): Promise<contracts.AttendanceRecord> {
    const facilityId = requireFacility();
    const ctx = currentContext()!;
    return this.db.tx(async (tx) => {
      const me = await this.employees.requireSelf(tx);
      const now = new Date();
      const today = todayIST(now);
      const [open] = await tx
        .select()
        .from(hrAttendance)
        .where(
          and(
            eq(hrAttendance.employeeId, me.id),
            sql`${hrAttendance.workDate} between ${addDays(today, -1)} and ${today}`,
            sql`${hrAttendance.checkIn} is not null and ${hrAttendance.checkOut} is null`,
            sql`${hrAttendance.checkIn} > ${new Date(now.getTime() - MAX_SHIFT_HOURS * 3_600_000).toISOString()}`,
          ),
        )
        .orderBy(asc(hrAttendance.checkIn))
        .limit(1);
      if (open) {
        const shift = (await this.roster.entryFor(tx, me.id, open.workDate))?.shift ?? null;
        const times = computeTimes(open.workDate, shift, new Date(open.checkIn!), now);
        const [row] = await tx
          .update(hrAttendance)
          .set({ checkOut: now.toISOString(), ...times, updatedBy: ctx.userId })
          .where(eq(hrAttendance.id, open.id))
          .returning();
        return toRecord(row!);
      }
      EmployeesService.assertEmployedOn(me, today);
      const [done] = await tx
        .select()
        .from(hrAttendance)
        .where(and(eq(hrAttendance.employeeId, me.id), eq(hrAttendance.workDate, today)))
        .limit(1);
      if (done?.checkOut) throw conflict('already_punched_out', 'You have already punched out today');
      const shift = (await this.roster.entryFor(tx, me.id, today))?.shift ?? null;
      const times = computeTimes(today, shift, now, null);
      const values = { facilityId, status: 'present', checkIn: now.toISOString(), checkOut: null, ...times, source: 'punch' as const, updatedBy: ctx.userId };
      const [row] = await tx
        .insert(hrAttendance)
        .values({ ...values, tenantId: ctx.tenantId!, employeeId: me.id, workDate: today, createdBy: ctx.userId })
        .onConflictDoUpdate({ target: [hrAttendance.tenantId, hrAttendance.employeeId, hrAttendance.workDate], set: values })
        .returning();
      return toRecord(row!);
    });
  }

  myMonth(q: contracts.MonthQuery): Promise<contracts.AttendanceRecord[]> {
    const { month } = contracts.monthQuerySchema.parse(q);
    const { start, end } = monthRange(month);
    return this.db.tx(async (tx) => {
      const me = await this.employees.requireSelf(tx);
      const rows = await tx
        .select()
        .from(hrAttendance)
        .where(and(eq(hrAttendance.employeeId, me.id), sql`${hrAttendance.workDate} between ${start} and ${end}`))
        .orderBy(asc(hrAttendance.workDate));
      return rows.map(toRecord);
    });
  }

  /** Self-service home: profile, today's duty and punch state. */
  me(): Promise<contracts.MyHr> {
    return this.db.tx(async (tx) => {
      const today = todayIST();
      const row = await this.employees.findByUser(tx, currentContext()!.userId!);
      if (!row) return { employee: null, today: { date: today, roster: null, shift: null, attendance: null } };
      const entry = await this.roster.entryFor(tx, row.id, today);
      const [att] = await tx
        .select()
        .from(hrAttendance)
        .where(and(eq(hrAttendance.employeeId, row.id), sql`${hrAttendance.workDate} between ${addDays(today, -1)} and ${today}`))
        .orderBy(sql`${hrAttendance.workDate} desc`);
      // Show yesterday's record only while its night-duty punch is still open.
      const attendance = att && (att.workDate === today || (att.checkIn && !att.checkOut)) ? toRecord(att) : null;
      return {
        employee: await this.employees.selfView(tx, row),
        today: {
          date: today,
          roster: entry ? { kind: entry.entry.kind as contracts.RosterKind, shiftCode: entry.shift?.code ?? null, ward: entry.entry.ward } : null,
          shift: entry?.shift ? toShift(entry.shift) : null,
          attendance,
        },
      };
    });
  }

  /** Attendance rows for payroll: loss-of-pay fraction per day. */
  async lopDays(tx: Tx, employeeIds: string[], from: string, to: string): Promise<Map<string, Map<string, number>>> {
    const out = new Map<string, Map<string, number>>();
    if (!employeeIds.length) return out;
    const rows = await tx
      .select({ employeeId: hrAttendance.employeeId, date: hrAttendance.workDate, status: hrAttendance.status })
      .from(hrAttendance)
      .where(and(inArray(hrAttendance.employeeId, employeeIds), sql`${hrAttendance.workDate} between ${from} and ${to}`, sql`${hrAttendance.status} in ('absent', 'half_day')`));
    for (const r of rows) {
      const m = out.get(r.employeeId) ?? new Map<string, number>();
      m.set(r.date, r.status === 'absent' ? 1 : 0.5);
      out.set(r.employeeId, m);
    }
    return out;
  }
}

/** Late, worked and overtime minutes against the rostered shift. */
export function computeTimes(date: string, shift: Pick<ShiftRow, 'startTime' | 'endTime' | 'breakMinutes' | 'graceMinutes'> | null, checkIn: Date | null, checkOut: Date | null) {
  let lateMinutes = 0;
  if (shift && checkIn) {
    const late = Math.floor((checkIn.getTime() - istInstant(date, shift.startTime).getTime()) / 60_000);
    // A punch long before the shift (e.g. night staff arriving early) is not late.
    if (late > shift.graceMinutes && late < 12 * 60) lateMinutes = late;
  }
  let workedMinutes: number | null = null;
  let overtimeMinutes = 0;
  if (checkIn && checkOut) {
    workedMinutes = Math.max(0, Math.floor((checkOut.getTime() - checkIn.getTime()) / 60_000) - (shift?.breakMinutes ?? 0));
    if (shift) overtimeMinutes = Math.max(0, workedMinutes - shiftMinutes(shift.startTime, shift.endTime, shift.breakMinutes));
  }
  return { lateMinutes, workedMinutes, overtimeMinutes };
}

export function toRecord(r: AttendanceRow): contracts.AttendanceRecord {
  return {
    id: r.id,
    employeeId: r.employeeId,
    date: r.workDate,
    status: r.status as contracts.AttendanceStatus,
    checkIn: r.checkIn ? iso(r.checkIn) : null,
    checkOut: r.checkOut ? iso(r.checkOut) : null,
    lateMinutes: r.lateMinutes,
    workedMinutes: r.workedMinutes,
    overtimeMinutes: r.overtimeMinutes,
    source: r.source as contracts.AttendanceRecord['source'],
    remarks: r.remarks,
  };
}
