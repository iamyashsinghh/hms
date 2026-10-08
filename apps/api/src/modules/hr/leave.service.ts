import { Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, hrEmployees, hrLeaveRequests, hrLeaveTypes, iso, sql, type Tx } from '@hms/db';
import { hr as contracts, type Paginated } from '@hms/shared';
import { DbService } from '../../common/db/db.service';
import { OutboxService } from '../../common/events/outbox.service';
import { currentContext } from '../../common/context/request-context';
import { badRequest, conflict, forbidden, notFound } from '../../common/errors/errors';
import { EmployeesService, type EmployeeRow } from './employees.service';
import { RosterService } from './roster.service';
import { addDays, daysBetween, num, todayIST } from './hr.util';

type LeaveTypeRow = typeof hrLeaveTypes.$inferSelect;
type LeaveRow = typeof hrLeaveRequests.$inferSelect;

@Injectable()
export class LeaveService {
  constructor(
    private readonly db: DbService,
    private readonly outbox: OutboxService,
    private readonly employees: EmployeesService,
    private readonly roster: RosterService,
  ) {}

  // ---------- leave types ----------

  listTypes(): Promise<contracts.LeaveType[]> {
    return this.db.tx(async (tx) => (await this.types(tx)).map(toType));
  }

  createType(input: contracts.LeaveTypeInput): Promise<contracts.LeaveType> {
    const b = contracts.leaveTypeInputSchema.parse(input);
    return this.db.tx(async (tx) => {
      const [row] = await tx
        .insert(hrLeaveTypes)
        .values({ tenantId: currentContext()!.tenantId!, code: b.code, name: b.name, annualQuota: String(b.annualQuota), isPaid: b.isPaid, isActive: b.isActive })
        .returning();
      return toType(row!);
    });
  }

  updateType(id: string, input: contracts.UpdateLeaveType): Promise<contracts.LeaveType> {
    const b = contracts.updateLeaveTypeSchema.parse(input);
    return this.db.tx(async (tx) => {
      const { annualQuota, ...rest } = b;
      const [row] = await tx
        .update(hrLeaveTypes)
        .set({ ...rest, ...(annualQuota !== undefined ? { annualQuota: String(annualQuota) } : {}) })
        .where(eq(hrLeaveTypes.id, id))
        .returning();
      if (!row) throw notFound('Leave type');
      return toType(row);
    });
  }

  /** The first call creates CL/SL/EL/LOP for the hospital. */
  async types(tx: Tx): Promise<LeaveTypeRow[]> {
    let rows = await tx.select().from(hrLeaveTypes).orderBy(asc(hrLeaveTypes.code));
    if (!rows.length) {
      const tenantId = currentContext()!.tenantId!;
      await tx
        .insert(hrLeaveTypes)
        .values(contracts.DEFAULT_LEAVE_TYPES.map((t) => ({ ...t, annualQuota: String(t.annualQuota), tenantId })))
        .onConflictDoNothing();
      rows = await tx.select().from(hrLeaveTypes).orderBy(asc(hrLeaveTypes.code));
    }
    return rows;
  }

  // ---------- requests ----------

  list(q: contracts.LeaveQuery): Promise<Paginated<contracts.LeaveRequest>> {
    const query = contracts.leaveQuerySchema.parse(q);
    return this.db.tx(async (tx) => {
      const where = and(
        query.status === 'all' ? undefined : eq(hrLeaveRequests.status, query.status),
        query.employeeId ? eq(hrLeaveRequests.employeeId, query.employeeId) : undefined,
        query.from ? sql`${hrLeaveRequests.toDate} >= ${query.from}` : undefined,
        query.to ? sql`${hrLeaveRequests.fromDate} <= ${query.to}` : undefined,
      );
      const [items, [{ total }]] = await Promise.all([
        this.select(tx).where(where).orderBy(desc(hrLeaveRequests.createdAt)).limit(query.pageSize).offset((query.page - 1) * query.pageSize),
        tx.select({ total: count() }).from(hrLeaveRequests).where(where),
      ]);
      return { items: items.map(toRequest), page: query.page, pageSize: query.pageSize, total };
    });
  }

  /** HR records leave for someone, optionally approving it straight away. */
  create(input: contracts.CreateLeave): Promise<contracts.LeaveRequest> {
    const b = contracts.createLeaveSchema.parse(input);
    if (b.autoApprove && !currentContext()!.permissions.has('hr.leave.approve')) throw forbidden('You cannot approve leave');
    return this.db.tx(async (tx) => {
      const emp = await this.employees.requireEmployee(tx, b.employeeId);
      const id = await this.insert(tx, emp, b);
      if (b.autoApprove) await this.decideIn(tx, id, { decision: 'approved', note: 'Recorded by HR' });
      return this.fetch(tx, id);
    });
  }

  apply(input: contracts.ApplyLeave): Promise<contracts.LeaveRequest> {
    const b = contracts.applyLeaveSchema.parse(input);
    if (b.fromDate < addDays(todayIST(), -30)) {
      throw badRequest('leave_too_old', 'Leave that started more than 30 days ago must be recorded by HR');
    }
    return this.db.tx(async (tx) => {
      const me = await this.employees.requireSelf(tx);
      const id = await this.insert(tx, me, b);
      return this.fetch(tx, id);
    });
  }

  decide(id: string, input: contracts.DecideLeave): Promise<contracts.LeaveRequest> {
    const b = contracts.decideLeaveSchema.parse(input);
    return this.db.tx(async (tx) => {
      await this.decideIn(tx, id, b);
      return this.fetch(tx, id);
    });
  }

  /** HR cancels any request; staff cancel their own (self = true) before it starts. */
  cancel(id: string, self: boolean): Promise<contracts.LeaveRequest> {
    const ctx = currentContext()!;
    return this.db.tx(async (tx) => {
      const [row] = await tx.select().from(hrLeaveRequests).where(eq(hrLeaveRequests.id, id)).for('update').limit(1);
      if (!row) throw notFound('Leave request');
      const emp = await this.employees.requireEmployee(tx, row.employeeId);
      if (self) {
        if (emp.userId !== ctx.userId) throw notFound('Leave request');
        if (row.status === 'approved' && row.fromDate <= todayIST()) {
          throw conflict('leave_started', 'This leave has already started; ask HR to change it');
        }
      }
      if (row.status !== 'pending' && row.status !== 'approved') throw conflict('leave_closed', `This request is already ${row.status}`);
      await tx.update(hrLeaveRequests).set({ status: 'cancelled', decidedBy: ctx.userId, decidedAt: new Date().toISOString(), updatedBy: ctx.userId }).where(eq(hrLeaveRequests.id, id));
      await this.roster.clearLeave(tx, id);
      await this.outbox.publish(tx, 'hr.leave.cancelled', {
        leaveId: id, employeeId: emp.id, userId: emp.userId, status: 'cancelled', fromDate: row.fromDate, toDate: row.toDate,
      } satisfies contracts.LeaveDecidedEvent);
      return this.fetch(tx, id);
    });
  }

  mine(): Promise<contracts.LeaveRequest[]> {
    return this.db.tx(async (tx) => {
      const me = await this.employees.requireSelf(tx);
      const rows = await this.select(tx).where(eq(hrLeaveRequests.employeeId, me.id)).orderBy(desc(hrLeaveRequests.fromDate)).limit(100);
      return rows.map(toRequest);
    });
  }

  balances(employeeId: string, year?: number): Promise<contracts.LeaveBalance[]> {
    return this.db.tx(async (tx) => {
      await this.employees.requireEmployee(tx, employeeId);
      return this.balancesIn(tx, employeeId, year ?? Number(todayIST().slice(0, 4)));
    });
  }

  myBalances(year?: number): Promise<contracts.LeaveBalance[]> {
    return this.db.tx(async (tx) => {
      const me = await this.employees.requireSelf(tx);
      return this.balancesIn(tx, me.id, year ?? Number(todayIST().slice(0, 4)));
    });
  }

  // ---------- internals ----------

  /** Approved unpaid leave days per date, for payroll. */
  async unpaidLeaveDays(tx: Tx, from: string, to: string): Promise<Map<string, Map<string, number>>> {
    const rows = await tx
      .select({ employeeId: hrLeaveRequests.employeeId, fromDate: hrLeaveRequests.fromDate, toDate: hrLeaveRequests.toDate, halfDay: hrLeaveRequests.halfDay })
      .from(hrLeaveRequests)
      .innerJoin(hrLeaveTypes, and(eq(hrLeaveTypes.tenantId, hrLeaveRequests.tenantId), eq(hrLeaveTypes.id, hrLeaveRequests.leaveTypeId)))
      .where(and(eq(hrLeaveRequests.status, 'approved'), eq(hrLeaveTypes.isPaid, false), sql`${hrLeaveRequests.toDate} >= ${from}`, sql`${hrLeaveRequests.fromDate} <= ${to}`));
    const out = new Map<string, Map<string, number>>();
    for (const r of rows) {
      const m = out.get(r.employeeId) ?? new Map<string, number>();
      for (let d = r.fromDate > from ? r.fromDate : from; d <= (r.toDate < to ? r.toDate : to); d = addDays(d, 1)) m.set(d, r.halfDay ? 0.5 : 1);
      out.set(r.employeeId, m);
    }
    return out;
  }

  private async insert(tx: Tx, emp: EmployeeRow, b: contracts.ApplyLeave): Promise<string> {
    const ctx = currentContext()!;
    if (emp.status === 'exited') throw badRequest('employee_exited', `${emp.fullName} has left`);
    EmployeesService.assertEmployedOn(emp, b.fromDate);
    EmployeesService.assertEmployedOn(emp, b.toDate);
    if (b.fromDate.slice(0, 4) !== b.toDate.slice(0, 4)) throw badRequest('leave_spans_years', 'Split leave that crosses the new year into two requests');
    const types = await this.types(tx);
    const type = types.find((t) => t.id === b.leaveTypeId && t.isActive);
    if (!type) throw badRequest('unknown_leave_type', 'Pick an active leave type');
    const days = b.halfDay ? 0.5 : daysBetween(b.fromDate, b.toDate);

    // Lock the employee's requests so two overlapping applications cannot both pass.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'hr.leave:' + emp.id}))`);
    const [overlap] = await tx
      .select({ id: hrLeaveRequests.id })
      .from(hrLeaveRequests)
      .where(
        and(
          eq(hrLeaveRequests.employeeId, emp.id),
          sql`${hrLeaveRequests.status} in ('pending', 'approved')`,
          sql`${hrLeaveRequests.fromDate} <= ${b.toDate} and ${hrLeaveRequests.toDate} >= ${b.fromDate}`,
        ),
      )
      .limit(1);
    if (overlap) throw conflict('leave_overlap', 'There is already a leave request for these dates');

    if (type.isPaid) {
      const bal = (await this.balancesIn(tx, emp.id, Number(b.fromDate.slice(0, 4)))).find((x) => x.leaveTypeId === type.id)!;
      if (bal.available !== null && days > bal.available) {
        throw badRequest('insufficient_balance', `Only ${bal.available} day(s) of ${type.name} left`);
      }
    }
    const [row] = await tx
      .insert(hrLeaveRequests)
      .values({
        tenantId: ctx.tenantId!, employeeId: emp.id, leaveTypeId: type.id, fromDate: b.fromDate, toDate: b.toDate,
        halfDay: b.halfDay ?? false, days: String(days), reason: b.reason ?? null, createdBy: ctx.userId, updatedBy: ctx.userId,
      })
      .returning();
    await this.outbox.publish(tx, 'hr.leave.requested', {
      leaveId: row!.id, employeeId: emp.id, userId: emp.userId, fromDate: b.fromDate, toDate: b.toDate, days,
    } satisfies contracts.LeaveRequestedEvent);
    return row!.id;
  }

  private async decideIn(tx: Tx, id: string, b: contracts.DecideLeave) {
    const ctx = currentContext()!;
    const [row] = await tx.select().from(hrLeaveRequests).where(eq(hrLeaveRequests.id, id)).for('update').limit(1);
    if (!row) throw notFound('Leave request');
    if (row.status !== 'pending') throw conflict('leave_closed', `This request is already ${row.status}`);
    const emp = await this.employees.requireEmployee(tx, row.employeeId);
    if (emp.userId && emp.userId === ctx.userId) throw forbidden('You cannot approve your own leave');
    await tx
      .update(hrLeaveRequests)
      .set({ status: b.decision, decidedBy: ctx.userId, decidedAt: new Date().toISOString(), decisionNote: b.note ?? null, updatedBy: ctx.userId })
      .where(eq(hrLeaveRequests.id, id));
    if (b.decision === 'approved') {
      await this.roster.markLeave(tx, emp.id, id, row.fromDate, row.toDate, emp.facilityId ?? ctx.facilityId ?? null);
    }
    await this.outbox.publish(tx, 'hr.leave.decided', {
      leaveId: id, employeeId: emp.id, userId: emp.userId, status: b.decision, fromDate: row.fromDate, toDate: row.toDate,
    } satisfies contracts.LeaveDecidedEvent);
  }

  private async balancesIn(tx: Tx, employeeId: string, year: number): Promise<contracts.LeaveBalance[]> {
    const types = (await this.types(tx)).filter((t) => t.isActive);
    const used = (
      await tx.execute<{ leave_type_id: string; taken: string; pending: string }>(sql`
        select leave_type_id,
               coalesce(sum(days) filter (where status = 'approved'), 0) as taken,
               coalesce(sum(days) filter (where status = 'pending'), 0) as pending
          from hr.leave_requests
         where employee_id = ${employeeId} and extract(year from from_date) = ${year}
         group by leave_type_id`)
    ).rows;
    return types.map((t) => {
      const u = used.find((x) => x.leave_type_id === t.id);
      const quota = num(t.annualQuota);
      const taken = num(u?.taken);
      const pending = num(u?.pending);
      return {
        leaveTypeId: t.id,
        code: t.code,
        name: t.name,
        isPaid: t.isPaid,
        quota,
        taken,
        pending,
        available: t.isPaid ? Math.max(0, quota - taken - pending) : null,
      };
    });
  }

  private select(tx: Tx) {
    return tx
      .select({ r: hrLeaveRequests, name: hrEmployees.fullName, code: hrEmployees.employeeCode, typeCode: hrLeaveTypes.code, typeName: hrLeaveTypes.name, isPaid: hrLeaveTypes.isPaid })
      .from(hrLeaveRequests)
      .innerJoin(hrEmployees, and(eq(hrEmployees.tenantId, hrLeaveRequests.tenantId), eq(hrEmployees.id, hrLeaveRequests.employeeId)))
      .innerJoin(hrLeaveTypes, and(eq(hrLeaveTypes.tenantId, hrLeaveRequests.tenantId), eq(hrLeaveTypes.id, hrLeaveRequests.leaveTypeId)))
      .$dynamic();
  }

  private async fetch(tx: Tx, id: string): Promise<contracts.LeaveRequest> {
    const [row] = await this.select(tx).where(eq(hrLeaveRequests.id, id)).limit(1);
    if (!row) throw notFound('Leave request');
    return toRequest(row);
  }
}

function toType(r: LeaveTypeRow): contracts.LeaveType {
  return { id: r.id, code: r.code, name: r.name, annualQuota: num(r.annualQuota), isPaid: r.isPaid, isActive: r.isActive };
}

function toRequest(x: { r: LeaveRow; name: string; code: string; typeCode: string; typeName: string; isPaid: boolean }): contracts.LeaveRequest {
  const r = x.r;
  return {
    id: r.id,
    employeeId: r.employeeId,
    employeeName: x.name,
    employeeCode: x.code,
    leaveTypeId: r.leaveTypeId,
    leaveTypeCode: x.typeCode,
    leaveTypeName: x.typeName,
    isPaid: x.isPaid,
    fromDate: r.fromDate,
    toDate: r.toDate,
    halfDay: r.halfDay,
    days: num(r.days),
    reason: r.reason,
    status: r.status as contracts.LeaveStatus,
    decidedBy: r.decidedBy,
    decidedAt: r.decidedAt ? iso(r.decidedAt) : null,
    decisionNote: r.decisionNote,
    createdAt: iso(r.createdAt),
  };
}
