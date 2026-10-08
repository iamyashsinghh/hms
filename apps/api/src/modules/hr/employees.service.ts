import { Injectable } from '@nestjs/common';
import { and, asc, count, eq, formatSeries, hrEmployees, hrLeaveRequests, hrLicences, iso, nextCounter, sql, type Tx } from '@hms/db';
import { hr as contracts, type ImportRequest, type ImportResult, type Paginated } from '@hms/shared';
import { runImport } from '../../common/imports/bulk-import';
import { DbService } from '../../common/db/db.service';
import { AuditService } from '../../common/db/audit.service';
import { OutboxService } from '../../common/events/outbox.service';
import { currentContext } from '../../common/context/request-context';
import { badRequest, forbidden, notFound } from '../../common/errors/errors';
import { daysBetween, money, num, todayIST } from './hr.util';

export type EmployeeRow = typeof hrEmployees.$inferSelect;
type NewEmployeeRow = typeof hrEmployees.$inferInsert;
type LicenceRow = typeof hrLicences.$inferSelect;

const SALARY_KEYS = ['basic', 'hra', 'otherAllowances', 'pfApplicable', 'esiApplicable', 'professionalTax', 'tdsMonthly'] as const;
const BANK_KEYS = ['pan', 'uan', 'esicNo', 'bankAccountNo', 'bankIfsc', 'bankName'] as const;

// Fully qualified: Drizzle renders bare column names in single-table selects, which the subquery would capture.
const nextExpiry = sql<string | null>`(select min(l.valid_until)::text from hr.licences l
  where l.tenant_id = "hr"."employees"."tenant_id" and l.employee_id = "hr"."employees"."id")`;

@Injectable()
export class EmployeesService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  list(q: contracts.EmployeeQuery): Promise<Paginated<contracts.Employee>> {
    const query = contracts.employeeQuerySchema.parse(q);
    return this.db.tx(async (tx) => {
      const term = query.q?.toLowerCase();
      const where = and(
        term
          ? sql`(lower(${hrEmployees.fullName}) like ${'%' + term + '%'} or lower(${hrEmployees.employeeCode}) like ${term + '%'}
                 or ${hrEmployees.mobile} like ${term + '%'} or lower(coalesce(${hrEmployees.designation}, '')) like ${'%' + term + '%'})`
          : undefined,
        query.category ? eq(hrEmployees.category, query.category) : undefined,
        query.department ? eq(hrEmployees.department, query.department) : undefined,
        query.status === 'all'
          ? undefined
          : query.status === 'current'
            ? sql`${hrEmployees.status} <> 'exited'`
            : eq(hrEmployees.status, query.status),
      );
      const [rows, [{ total }]] = await Promise.all([
        tx
          .select({ e: hrEmployees, nextExpiry })
          .from(hrEmployees)
          .where(where)
          .orderBy(asc(hrEmployees.fullName))
          .limit(query.pageSize)
          .offset((query.page - 1) * query.pageSize),
        tx.select({ total: count() }).from(hrEmployees).where(where),
      ]);
      return { items: rows.map((r) => toEmployee(r.e, r.nextExpiry)), page: query.page, pageSize: query.pageSize, total };
    });
  }

  get(id: string): Promise<contracts.Employee> {
    return this.db.tx(async (tx) => {
      const [r] = await tx.select({ e: hrEmployees, nextExpiry }).from(hrEmployees).where(eq(hrEmployees.id, id)).limit(1);
      if (!r) throw notFound('Employee');
      await this.audit.recordView(tx, 'hr.employee', id);
      return toEmployee(r.e, r.nextExpiry);
    });
  }

  /** Departments in use, for filters and pickers. */
  departments(): Promise<string[]> {
    return this.db.tx(async (tx) => {
      const rows = await tx
        .selectDistinct({ d: hrEmployees.department })
        .from(hrEmployees)
        .where(sql`${hrEmployees.department} is not null`)
        .orderBy(asc(hrEmployees.department));
      return rows.map((r) => r.d!);
    });
  }

  create(input: contracts.CreateEmployee): Promise<contracts.Employee> {
    const body = contracts.createEmployeeSchema.parse(input);
    assertMayEditPay(body);
    const ctx = currentContext()!;
    return this.db.tx(async (tx) => {
      const employeeCode = body.employeeCode ?? formatSeries('EMP', await nextCounter(tx, 'hr.employee'), 5);
      const [row] = await tx
        .insert(hrEmployees)
        .values({ ...toColumns(body), tenantId: ctx.tenantId!, employeeCode, fullName: body.fullName, dateOfJoining: body.dateOfJoining, createdBy: ctx.userId, updatedBy: ctx.userId })
        .returning();
      await this.outbox.publish(tx, 'hr.employee.created', { employeeId: row!.id, userId: row!.userId, status: row!.status as contracts.EmployeeStatus } satisfies contracts.EmployeeChangedEvent);
      return toEmployee(row!, null);
    });
  }

  /** Bulk import of staff from Excel / CSV; rows without a code get the next EMP number. */
  import(input: ImportRequest & { dryRun: boolean; updateExisting: boolean }): Promise<ImportResult> {
    return runImport<contracts.EmployeeImportRow>(
      {
        columns: contracts.EMPLOYEE_IMPORT_COLUMNS,
        schema: contracts.employeeImportRowSchema,
        key: (r) => r.employeeCode ?? null,
        label: (r) => r.fullName,
        existing: (codes) =>
          this.db.tx(async (tx) => {
            const rows = await tx
              .select({ id: hrEmployees.id, code: hrEmployees.employeeCode })
              .from(hrEmployees)
              .where(sql`upper(${hrEmployees.employeeCode}) in (${sql.join(codes.map((c) => sql`${c.toUpperCase()}`), sql`, `)})`);
            return new Map(rows.map((r) => [r.code.toUpperCase(), r.id]));
          }),
        create: (r) => this.create(r),
        update: (id, { employeeCode: _code, ...given }) => this.update(id, given),
      },
      input,
    );
  }

  update(id: string, input: contracts.UpdateEmployee): Promise<contracts.Employee> {
    const body = contracts.updateEmployeeSchema.parse(input);
    assertMayEditPay(body);
    const ctx = currentContext()!;
    return this.db.tx(async (tx) => {
      const values: Partial<NewEmployeeRow> = { ...toColumns(body), updatedBy: ctx.userId };
      if (body.status !== undefined) values.status = body.status;
      if (body.dateOfExit !== undefined) values.dateOfExit = body.dateOfExit;
      if (body.status === 'exited' && !body.dateOfExit) values.dateOfExit = todayIST();
      if (body.status && body.status !== 'exited' && body.dateOfExit === undefined) values.dateOfExit = null;
      const [row] = await tx.update(hrEmployees).set(values).where(eq(hrEmployees.id, id)).returning();
      if (!row) throw notFound('Employee');
      if (body.status !== undefined) {
        await this.outbox.publish(tx, 'hr.employee.status_changed', { employeeId: row.id, userId: row.userId, status: row.status as contracts.EmployeeStatus } satisfies contracts.EmployeeChangedEvent);
      }
      const [r] = await tx.select({ nextExpiry }).from(hrEmployees).where(eq(hrEmployees.id, id));
      return toEmployee(row, r?.nextExpiry ?? null);
    });
  }

  // ---------- licences ----------

  listLicences(employeeId: string): Promise<contracts.Licence[]> {
    return this.db.tx(async (tx) => {
      await this.requireEmployee(tx, employeeId);
      const rows = await tx.select().from(hrLicences).where(eq(hrLicences.employeeId, employeeId)).orderBy(asc(hrLicences.validUntil));
      return rows.map(toLicence);
    });
  }

  addLicence(employeeId: string, input: contracts.LicenceInput): Promise<contracts.Licence> {
    const body = contracts.licenceInputSchema.parse(input);
    const ctx = currentContext()!;
    return this.db.tx(async (tx) => {
      await this.requireEmployee(tx, employeeId);
      const [row] = await tx
        .insert(hrLicences)
        .values({ ...licenceColumns(body), tenantId: ctx.tenantId!, employeeId, kind: body.kind, number: body.number, createdBy: ctx.userId, updatedBy: ctx.userId })
        .returning();
      return toLicence(row!);
    });
  }

  updateLicence(id: string, input: contracts.LicenceInput): Promise<contracts.Licence> {
    const body = contracts.licenceInputSchema.parse(input);
    const ctx = currentContext()!;
    return this.db.tx(async (tx) => {
      const [row] = await tx
        .update(hrLicences)
        .set({ ...licenceColumns(body), kind: body.kind, number: body.number, updatedBy: ctx.userId })
        .where(eq(hrLicences.id, id))
        .returning();
      if (!row) throw notFound('Licence');
      return toLicence(row);
    });
  }

  deleteLicence(id: string): Promise<void> {
    return this.db.tx(async (tx) => {
      const rows = await tx.delete(hrLicences).where(eq(hrLicences.id, id)).returning({ id: hrLicences.id });
      if (!rows.length) throw notFound('Licence');
    });
  }

  /** Licences of current staff that expire within `days` (and those already expired). */
  expiring(days: number): Promise<contracts.ExpiringLicence[]> {
    return this.db.tx(async (tx) => {
      const until = new Date(Date.parse(`${todayIST()}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
      const rows = await tx
        .select({ l: hrLicences, name: hrEmployees.fullName, code: hrEmployees.employeeCode, designation: hrEmployees.designation })
        .from(hrLicences)
        .innerJoin(hrEmployees, and(eq(hrEmployees.tenantId, hrLicences.tenantId), eq(hrEmployees.id, hrLicences.employeeId)))
        .where(and(sql`${hrLicences.validUntil} <= ${until}`, sql`${hrEmployees.status} <> 'exited'`))
        .orderBy(asc(hrLicences.validUntil));
      return rows.map((r) => ({ ...toLicence(r.l), employeeName: r.name, employeeCode: r.code, designation: r.designation }));
    });
  }

  // ---------- dashboard ----------

  dashboard(date?: string): Promise<contracts.HrDashboard> {
    const day = date ?? todayIST();
    const ctx = currentContext()!;
    return this.db.tx(async (tx) => {
      const byCat = await tx
        .select({ category: hrEmployees.category, n: count() })
        .from(hrEmployees)
        .where(sql`${hrEmployees.status} <> 'exited'`)
        .groupBy(hrEmployees.category);
      const byCategory = Object.fromEntries(contracts.EMPLOYEE_CATEGORIES.map((c) => [c, 0])) as Record<contracts.EmployeeCategory, number>;
      for (const r of byCat) byCategory[r.category as contracts.EmployeeCategory] = r.n;
      const headcount = byCat.reduce((s, r) => s + r.n, 0);

      const facility = ctx.facilityId ? sql`and facility_id = ${ctx.facilityId}` : sql``;
      const [roster] = (
        await tx.execute<{ rostered: number }>(sql`select count(*)::int as rostered from hr.roster_entries
          where duty_date = ${day} and kind = 'shift' ${facility}`)
      ).rows;
      const att = (
        await tx.execute<{ status: string; n: number }>(sql`select status, count(*)::int as n from hr.attendance
          where work_date = ${day} ${facility} group by status`)
      ).rows;
      const a = (s: string) => att.find((r) => r.status === s)?.n ?? 0;
      const [{ pending }] = await tx.select({ pending: count() }).from(hrLeaveRequests).where(eq(hrLeaveRequests.status, 'pending'));
      const until = new Date(Date.parse(`${day}T00:00:00Z`) + 30 * 86_400_000).toISOString().slice(0, 10);
      const [lic] = (
        await tx.execute<{ expiring: number; expired: number }>(sql`select
            count(*) filter (where l.valid_until >= ${day} and l.valid_until <= ${until})::int as expiring,
            count(*) filter (where l.valid_until < ${day})::int as expired
          from hr.licences l join hr.employees e on e.tenant_id = l.tenant_id and e.id = l.employee_id
          where e.status <> 'exited'`)
      ).rows;
      const present = a('present') + a('half_day');
      const marked = att.reduce((s, r) => s + r.n, 0);
      return {
        date: day,
        headcount,
        byCategory,
        rostered: roster?.rostered ?? 0,
        present,
        absent: a('absent'),
        onLeave: a('leave'),
        notMarked: Math.max(0, (roster?.rostered ?? 0) - marked),
        pendingLeaves: pending,
        licencesExpiring: lic?.expiring ?? 0,
        licencesExpired: lic?.expired ?? 0,
      };
    });
  }

  // ---------- helpers for the other HR services ----------

  async requireEmployee(tx: Tx, id: string): Promise<EmployeeRow> {
    const [row] = await tx.select().from(hrEmployees).where(eq(hrEmployees.id, id)).limit(1);
    if (!row) throw notFound('Employee');
    return row;
  }

  /** The caller's own HR record (self-service). */
  async requireSelf(tx: Tx): Promise<EmployeeRow> {
    const row = await this.findByUser(tx, currentContext()!.userId!);
    if (!row) throw notFound('No HR record is linked to your login. Ask HR to add you as an employee.');
    return row;
  }

  async findByUser(tx: Tx, userId: string): Promise<EmployeeRow | undefined> {
    const [row] = await tx.select().from(hrEmployees).where(eq(hrEmployees.userId, userId)).limit(1);
    return row;
  }

  async selfView(tx: Tx, row: EmployeeRow): Promise<contracts.Employee> {
    const [r] = await tx.select({ nextExpiry }).from(hrEmployees).where(eq(hrEmployees.id, row.id));
    return toEmployee(row, r?.nextExpiry ?? null, true);
  }

  /** Used by attendance and payroll to know who is on the rolls on a date range. */
  async onRolls(tx: Tx, from: string, to: string, department?: string): Promise<EmployeeRow[]> {
    return tx
      .select()
      .from(hrEmployees)
      .where(
        and(
          sql`${hrEmployees.dateOfJoining} <= ${to}`,
          sql`(${hrEmployees.dateOfExit} is null or ${hrEmployees.dateOfExit} >= ${from})`,
          department ? eq(hrEmployees.department, department) : undefined,
        ),
      )
      .orderBy(asc(hrEmployees.fullName));
  }

  /** Refuses dates before joining or after exit. */
  static assertEmployedOn(e: EmployeeRow, date: string) {
    if (e.dateOfJoining > date) throw badRequest('not_joined', `${e.fullName} joins on ${e.dateOfJoining}`);
    if (e.dateOfExit && e.dateOfExit < date) throw badRequest('employee_exited', `${e.fullName} left on ${e.dateOfExit}`);
  }
}

function assertMayEditPay(body: Record<string, unknown>) {
  const touches = [...SALARY_KEYS, ...BANK_KEYS].some((k) => body[k] !== undefined);
  if (touches && !currentContext()?.permissions.has('hr.payroll.manage')) {
    throw forbidden('Only payroll managers can set salary, statutory or bank details');
  }
}

function toColumns(b: contracts.EmployeeValues): Partial<NewEmployeeRow> {
  const out: Partial<NewEmployeeRow> = {};
  const set = <K extends keyof NewEmployeeRow>(k: K, v: NewEmployeeRow[K] | undefined) => {
    if (v !== undefined) out[k] = v;
  };
  set('userId', b.userId);
  set('fullName', b.fullName);
  set('gender', b.gender);
  set('dateOfBirth', b.dateOfBirth);
  set('mobile', b.mobile);
  set('email', b.email);
  set('category', b.category);
  set('designation', b.designation || (b.designation === undefined ? undefined : null));
  set('department', b.department || (b.department === undefined ? undefined : null));
  set('facilityId', b.facilityId);
  set('employmentType', b.employmentType);
  set('dateOfJoining', b.dateOfJoining);
  set('address', b.address);
  set('emergencyContactName', b.emergencyContactName);
  set('emergencyContactPhone', b.emergencyContactPhone);
  set('pan', b.pan);
  set('uan', b.uan);
  set('esicNo', b.esicNo);
  set('bankAccountNo', b.bankAccountNo);
  set('bankIfsc', b.bankIfsc);
  set('bankName', b.bankName);
  for (const k of ['basic', 'hra', 'otherAllowances', 'professionalTax', 'tdsMonthly'] as const) {
    const v = b[k];
    if (v !== undefined) out[k] = money(Number(v));
  }
  set('pfApplicable', b.pfApplicable);
  set('esiApplicable', b.esiApplicable);
  return out;
}

function licenceColumns(b: contracts.LicenceValues) {
  return { issuedBy: b.issuedBy ?? null, validFrom: b.validFrom ?? null, validUntil: b.validUntil ?? null, notes: b.notes ?? null };
}

export function toEmployee(r: EmployeeRow, nextLicenceExpiry: string | null, self = false): contracts.Employee {
  const out: contracts.Employee = {
    id: r.id,
    userId: r.userId,
    employeeCode: r.employeeCode,
    fullName: r.fullName,
    gender: r.gender,
    dateOfBirth: r.dateOfBirth,
    mobile: r.mobile,
    email: r.email,
    category: r.category as contracts.EmployeeCategory,
    designation: r.designation,
    department: r.department,
    facilityId: r.facilityId,
    employmentType: r.employmentType as contracts.EmploymentType,
    dateOfJoining: r.dateOfJoining,
    dateOfExit: r.dateOfExit,
    status: r.status as contracts.EmployeeStatus,
    address: r.address,
    emergencyContactName: r.emergencyContactName,
    emergencyContactPhone: r.emergencyContactPhone,
    nextLicenceExpiry,
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
  };
  if (self || currentContext()?.permissions.has('hr.payroll.read')) {
    out.salary = {
      basic: num(r.basic),
      hra: num(r.hra),
      otherAllowances: num(r.otherAllowances),
      monthlyGross: num(r.basic) + num(r.hra) + num(r.otherAllowances),
      pfApplicable: r.pfApplicable,
      esiApplicable: r.esiApplicable,
      professionalTax: num(r.professionalTax),
      tdsMonthly: num(r.tdsMonthly),
    };
    out.bank = { pan: r.pan, uan: r.uan, esicNo: r.esicNo, bankAccountNo: r.bankAccountNo, bankIfsc: r.bankIfsc, bankName: r.bankName };
  }
  return out;
}

export function toLicence(r: LicenceRow): contracts.Licence {
  return {
    id: r.id,
    employeeId: r.employeeId,
    kind: r.kind as contracts.LicenceKind,
    number: r.number,
    issuedBy: r.issuedBy,
    validFrom: r.validFrom,
    validUntil: r.validUntil,
    notes: r.notes,
    daysLeft: r.validUntil ? daysBetween(todayIST(), r.validUntil) - 1 : null,
  };
}
