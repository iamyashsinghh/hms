import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, hrPayrollRuns, hrPayslips, iso, sql, type Tx } from '@hms/db';
import { hr as contracts } from '@hms/shared';
import { DbService } from '../../common/db/db.service';
import { OutboxService } from '../../common/events/outbox.service';
import { currentContext } from '../../common/context/request-context';
import { badRequest, conflict, notFound } from '../../common/errors/errors';
import { AttendanceService } from './attendance.service';
import { EmployeesService, type EmployeeRow } from './employees.service';
import { LeaveService } from './leave.service';
import { computePayslip } from './payroll.calc';
import { daysBetween, money, monthRange, num, round2, todayIST } from './hr.util';

type RunRow = typeof hrPayrollRuns.$inferSelect;
type SlipRow = typeof hrPayslips.$inferSelect;

@Injectable()
export class PayrollService {
  constructor(
    private readonly db: DbService,
    private readonly outbox: OutboxService,
    private readonly employees: EmployeesService,
    private readonly attendance: AttendanceService,
    private readonly leave: LeaveService,
  ) {}

  list(): Promise<contracts.PayrollRunSummary[]> {
    return this.db.tx(async (tx) => {
      const rows = await tx.select().from(hrPayrollRuns).orderBy(desc(hrPayrollRuns.month)).limit(60);
      return rows.map(toRun);
    });
  }

  get(id: string): Promise<contracts.PayrollRun> {
    return this.db.tx((tx) => this.fetch(tx, id));
  }

  /** Prepares a draft payroll for a month from salaries, attendance and unpaid leave. */
  create(input: contracts.CreatePayrollRun): Promise<contracts.PayrollRun> {
    const { month } = contracts.createPayrollRunSchema.parse(input);
    if (month > todayIST().slice(0, 7)) throw badRequest('future_month', 'Payroll can only be prepared for the current or a past month');
    const ctx = currentContext()!;
    return this.db.tx(async (tx) => {
      const [existing] = await tx.select({ id: hrPayrollRuns.id }).from(hrPayrollRuns).where(eq(hrPayrollRuns.month, `${month}-01`)).limit(1);
      if (existing) throw conflict('payroll_exists', `Payroll for ${month} already exists`);
      const [run] = await tx
        .insert(hrPayrollRuns)
        .values({ tenantId: ctx.tenantId!, month: `${month}-01`, createdBy: ctx.userId, updatedBy: ctx.userId })
        .returning();
      await this.calculate(tx, run!);
      return this.fetch(tx, run!.id);
    });
  }

  /** Re-reads salaries and attendance into a draft run, keeping manual adjustments. */
  recalculate(id: string): Promise<contracts.PayrollRun> {
    return this.db.tx(async (tx) => {
      const run = await this.draft(tx, id);
      await this.calculate(tx, run);
      return this.fetch(tx, id);
    });
  }

  adjust(slipId: string, input: contracts.AdjustPayslip): Promise<contracts.Payslip> {
    const b = contracts.adjustPayslipSchema.parse(input);
    return this.db.tx(async (tx) => {
      const [slip] = await tx.select().from(hrPayslips).where(eq(hrPayslips.id, slipId)).limit(1);
      if (!slip) throw notFound('Payslip');
      const run = await this.draft(tx, slip.runId);
      const emp = await this.employees.requireEmployee(tx, slip.employeeId);
      const { days } = monthRange(run.month.slice(0, 7));
      const amounts = computePayslip({
        daysInMonth: days,
        employedDays: num(slip.payableDays) + num(slip.lopDays),
        lopDays: num(slip.lopDays),
        ...structure(emp),
        tds: b.tds ?? num(slip.tds),
        otherEarnings: b.otherEarnings ?? num(slip.otherEarnings),
        otherDeductions: b.otherDeductions ?? num(slip.otherDeductions),
      });
      await tx
        .update(hrPayslips)
        .set({ ...toColumns(amounts), remarks: b.remarks === undefined ? slip.remarks : b.remarks })
        .where(eq(hrPayslips.id, slipId));
      await this.totals(tx, run.id);
      const [row] = await tx.select().from(hrPayslips).where(eq(hrPayslips.id, slipId));
      return toSlip(row!, run);
    });
  }

  finalize(id: string): Promise<contracts.PayrollRun> {
    const ctx = currentContext()!;
    return this.db.tx(async (tx) => {
      const run = await this.draft(tx, id);
      if (!run.employeeCount) throw badRequest('payroll_empty', 'There are no payslips in this payroll');
      const [row] = await tx
        .update(hrPayrollRuns)
        .set({ status: 'final', finalizedAt: new Date().toISOString(), finalizedBy: ctx.userId, updatedBy: ctx.userId })
        .where(eq(hrPayrollRuns.id, id))
        .returning();
      await this.outbox.publish(tx, 'hr.payroll.finalized', {
        runId: id, month: run.month.slice(0, 7), employeeCount: row!.employeeCount, netTotal: num(row!.netTotal),
      } satisfies contracts.PayrollFinalizedEvent);
      return this.fetch(tx, id);
    });
  }

  remove(id: string): Promise<void> {
    return this.db.tx(async (tx) => {
      await this.draft(tx, id);
      await tx.delete(hrPayrollRuns).where(eq(hrPayrollRuns.id, id));
    });
  }

  /** CSV for the bank transfer / accountant: one line per payslip. */
  export(id: string): Promise<contracts.PayrollExport> {
    return this.db.tx(async (tx) => {
      const run = await this.fetch(tx, id);
      const head = ['Employee code', 'Name', 'Designation', 'Department', 'PAN', 'UAN', 'Bank account', 'IFSC', 'Days in month', 'Payable days', 'LOP days',
        'Basic', 'HRA', 'Allowances', 'Other earnings', 'Gross', 'PF', 'ESI', 'Professional tax', 'TDS', 'Other deductions', 'Total deductions', 'Net pay', 'Employer PF', 'Employer ESI'];
      const lines = run.payslips.map((s) =>
        [s.employeeCode, s.employeeName, s.designation, s.department, s.pan, s.uan, s.bankAccountNo, s.bankIfsc, s.daysInMonth, s.payableDays, s.lopDays,
          s.basic, s.hra, s.otherAllowances, s.otherEarnings, s.gross, s.pfEmployee, s.esiEmployee, s.professionalTax, s.tds, s.otherDeductions, s.totalDeductions, s.netPay, s.pfEmployer, s.esiEmployer]
          .map(csvCell)
          .join(','),
      );
      return { filename: `payroll-${run.month}${run.status === 'draft' ? '-draft' : ''}.csv`, csv: [head.join(','), ...lines].join('\r\n') + '\r\n' };
    });
  }

  payslip(id: string): Promise<contracts.Payslip> {
    return this.db.tx(async (tx) => {
      const [row] = await tx
        .select({ s: hrPayslips, r: hrPayrollRuns })
        .from(hrPayslips)
        .innerJoin(hrPayrollRuns, and(eq(hrPayrollRuns.tenantId, hrPayslips.tenantId), eq(hrPayrollRuns.id, hrPayslips.runId)))
        .where(eq(hrPayslips.id, id))
        .limit(1);
      if (!row) throw notFound('Payslip');
      return toSlip(row.s, row.r);
    });
  }

  /** Own finalized payslips. */
  mine(): Promise<contracts.Payslip[]> {
    return this.db.tx(async (tx) => {
      const me = await this.employees.requireSelf(tx);
      const rows = await tx
        .select({ s: hrPayslips, r: hrPayrollRuns })
        .from(hrPayslips)
        .innerJoin(hrPayrollRuns, and(eq(hrPayrollRuns.tenantId, hrPayslips.tenantId), eq(hrPayrollRuns.id, hrPayslips.runId)))
        .where(and(eq(hrPayslips.employeeId, me.id), eq(hrPayrollRuns.status, 'final')))
        .orderBy(desc(hrPayrollRuns.month));
      return rows.map((x) => toSlip(x.s, x.r));
    });
  }

  myPayslip(id: string): Promise<contracts.Payslip> {
    return this.db.tx(async (tx) => {
      const me = await this.employees.requireSelf(tx);
      const [row] = await tx
        .select({ s: hrPayslips, r: hrPayrollRuns })
        .from(hrPayslips)
        .innerJoin(hrPayrollRuns, and(eq(hrPayrollRuns.tenantId, hrPayslips.tenantId), eq(hrPayrollRuns.id, hrPayslips.runId)))
        .where(and(eq(hrPayslips.id, id), eq(hrPayslips.employeeId, me.id), eq(hrPayrollRuns.status, 'final')))
        .limit(1);
      if (!row) throw notFound('Payslip');
      return toSlip(row.s, row.r);
    });
  }

  // ---------- internals ----------

  private async draft(tx: Tx, id: string): Promise<RunRow> {
    const [run] = await tx.select().from(hrPayrollRuns).where(eq(hrPayrollRuns.id, id)).for('update').limit(1);
    if (!run) throw notFound('Payroll');
    if (run.status !== 'draft') throw conflict('payroll_final', 'This payroll is final and cannot change');
    return run;
  }

  private async calculate(tx: Tx, run: RunRow) {
    const month = run.month.slice(0, 7);
    const { start, end, days } = monthRange(month);
    const staff = (await this.employees.onRolls(tx, start, end)).filter((e) => num(e.basic) + num(e.hra) + num(e.otherAllowances) > 0);
    const ids = staff.map((e) => e.id);
    const [absences, unpaid, existing] = await Promise.all([
      this.attendance.lopDays(tx, ids, start, end),
      this.leave.unpaidLeaveDays(tx, start, end),
      tx.select().from(hrPayslips).where(eq(hrPayslips.runId, run.id)),
    ]);
    const prior = new Map(existing.map((s) => [s.employeeId, s]));
    const keep = new Set(ids);
    const gone = existing.filter((s) => !keep.has(s.employeeId)).map((s) => s.id);
    for (const slipId of gone) await tx.delete(hrPayslips).where(eq(hrPayslips.id, slipId));

    for (const e of staff) {
      const from = e.dateOfJoining > start ? e.dateOfJoining : start;
      const to = e.dateOfExit && e.dateOfExit < end ? e.dateOfExit : end;
      const lopByDay = new Map<string, number>();
      for (const src of [absences.get(e.id), unpaid.get(e.id)]) {
        for (const [d, f] of src ?? []) if (d >= from && d <= to) lopByDay.set(d, Math.max(lopByDay.get(d) ?? 0, f));
      }
      const lop = [...lopByDay.values()].reduce((s, v) => s + v, 0);
      const before = prior.get(e.id);
      const amounts = computePayslip({
        daysInMonth: days,
        employedDays: daysBetween(from, to),
        lopDays: lop,
        ...structure(e),
        tds: before ? num(before.tds) : num(e.tdsMonthly),
        otherEarnings: before ? num(before.otherEarnings) : 0,
        otherDeductions: before ? num(before.otherDeductions) : 0,
      });
      const values = {
        employeeCode: e.employeeCode,
        employeeName: e.fullName,
        designation: e.designation,
        department: e.department,
        pan: e.pan,
        uan: e.uan,
        bankAccountNo: e.bankAccountNo,
        bankIfsc: e.bankIfsc,
        daysInMonth: days,
        ...toColumns(amounts),
      };
      await tx
        .insert(hrPayslips)
        .values({ ...values, tenantId: run.tenantId, runId: run.id, employeeId: e.id })
        .onConflictDoUpdate({ target: [hrPayslips.tenantId, hrPayslips.runId, hrPayslips.employeeId], set: values });
    }
    await this.totals(tx, run.id);
  }

  private async totals(tx: Tx, runId: string) {
    await tx.execute(sql`
      update hr.payroll_runs r set
        employee_count = t.n, gross_total = t.gross, deduction_total = t.ded, net_total = t.net, employer_cost_total = t.cost,
        updated_by = ${currentContext()?.userId ?? null}
      from (select count(*)::int as n, coalesce(sum(gross), 0) as gross, coalesce(sum(total_deductions), 0) as ded,
                   coalesce(sum(net_pay), 0) as net, coalesce(sum(gross + pf_employer + esi_employer), 0) as cost
              from hr.payslips where run_id = ${runId}) t
      where r.id = ${runId}`);
  }

  private async fetch(tx: Tx, id: string): Promise<contracts.PayrollRun> {
    const [run] = await tx.select().from(hrPayrollRuns).where(eq(hrPayrollRuns.id, id)).limit(1);
    if (!run) throw notFound('Payroll');
    const slips = await tx.select().from(hrPayslips).where(eq(hrPayslips.runId, id)).orderBy(asc(hrPayslips.employeeName));
    return { ...toRun(run), payslips: slips.map((s) => toSlip(s, run)) };
  }
}

function structure(e: EmployeeRow) {
  return {
    basic: num(e.basic),
    hra: num(e.hra),
    otherAllowances: num(e.otherAllowances),
    pfApplicable: e.pfApplicable,
    esiApplicable: e.esiApplicable,
    professionalTax: num(e.professionalTax),
  };
}

function toColumns(a: ReturnType<typeof computePayslip>) {
  return {
    payableDays: String(a.payableDays),
    lopDays: String(a.lopDays),
    basic: money(a.basic),
    hra: money(a.hra),
    otherAllowances: money(a.otherAllowances),
    otherEarnings: money(a.otherEarnings),
    gross: money(a.gross),
    pfEmployee: money(a.pfEmployee),
    esiEmployee: money(a.esiEmployee),
    professionalTax: money(a.professionalTax),
    tds: money(a.tds),
    otherDeductions: money(a.otherDeductions),
    totalDeductions: money(a.totalDeductions),
    netPay: money(a.netPay),
    pfEmployer: money(a.pfEmployer),
    esiEmployer: money(a.esiEmployer),
  };
}

function csvCell(v: string | number | null): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  // Quote when needed; prefix formulas so spreadsheets never execute them.
  const safe = /^[=+\-@]/.test(s) && typeof v === 'string' ? `'${s}` : s;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function toRun(r: RunRow): contracts.PayrollRunSummary {
  return {
    id: r.id,
    month: r.month.slice(0, 7),
    status: r.status as contracts.PayrollStatus,
    employeeCount: r.employeeCount,
    grossTotal: num(r.grossTotal),
    deductionTotal: num(r.deductionTotal),
    netTotal: num(r.netTotal),
    employerCostTotal: round2(num(r.employerCostTotal)),
    finalizedAt: r.finalizedAt ? iso(r.finalizedAt) : null,
    createdAt: iso(r.createdAt),
  };
}

function toSlip(s: SlipRow, r: RunRow): contracts.Payslip {
  return {
    id: s.id,
    runId: s.runId,
    month: r.month.slice(0, 7),
    runStatus: r.status as contracts.PayrollStatus,
    employeeId: s.employeeId,
    employeeCode: s.employeeCode,
    employeeName: s.employeeName,
    designation: s.designation,
    department: s.department,
    pan: s.pan,
    uan: s.uan,
    bankAccountNo: s.bankAccountNo,
    bankIfsc: s.bankIfsc,
    daysInMonth: s.daysInMonth,
    payableDays: num(s.payableDays),
    lopDays: num(s.lopDays),
    basic: num(s.basic),
    hra: num(s.hra),
    otherAllowances: num(s.otherAllowances),
    otherEarnings: num(s.otherEarnings),
    gross: num(s.gross),
    pfEmployee: num(s.pfEmployee),
    esiEmployee: num(s.esiEmployee),
    professionalTax: num(s.professionalTax),
    tds: num(s.tds),
    otherDeductions: num(s.otherDeductions),
    totalDeductions: num(s.totalDeductions),
    netPay: num(s.netPay),
    pfEmployer: num(s.pfEmployer),
    esiEmployer: num(s.esiEmployer),
    remarks: s.remarks,
  };
}
