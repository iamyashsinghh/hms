import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { hr as contracts, type Paginated } from '@hms/shared';
import { z } from 'zod';
import { RequirePermissions } from '../../common/auth/decorators';
import { RequireEntitlement } from '../platform/entitlement.guard';
import { ZodPipe } from '../../common/validation/zod.pipe';
import { AttendanceService } from './attendance.service';
import { EmployeesService } from './employees.service';
import { LeaveService } from './leave.service';
import { PayrollService } from './payroll.service';
import { RosterService } from './roster.service';

const uuid = new ParseUUIDPipe();
const dateQuery = z.object({ date: z.iso.date().optional() });
const rangeQuery = z.object({ from: z.iso.date(), to: z.iso.date() });

@RequireEntitlement('hr')
@Controller('hr')
export class EmployeesController {
  constructor(
    private readonly employees: EmployeesService,
    private readonly leave: LeaveService,
  ) {}

  @Get('dashboard')
  @RequirePermissions('hr.employee.read')
  dashboard(@Query(new ZodPipe(dateQuery)) q: z.infer<typeof dateQuery>): Promise<contracts.HrDashboard> {
    return this.employees.dashboard(q.date);
  }

  @Get('employees')
  @RequirePermissions('hr.employee.read')
  list(@Query(new ZodPipe(contracts.employeeQuerySchema)) q: contracts.EmployeeQuery): Promise<Paginated<contracts.Employee>> {
    return this.employees.list(q);
  }

  @Get('departments')
  @RequirePermissions('hr.employee.read')
  departments(): Promise<string[]> {
    return this.employees.departments();
  }

  @Post('employees')
  @RequirePermissions('hr.employee.manage')
  create(@Body(new ZodPipe(contracts.createEmployeeSchema)) body: contracts.CreateEmployee): Promise<contracts.Employee> {
    return this.employees.create(body);
  }

  @Get('employees/:id')
  @RequirePermissions('hr.employee.read')
  get(@Param('id', uuid) id: string): Promise<contracts.Employee> {
    return this.employees.get(id);
  }

  @Patch('employees/:id')
  @RequirePermissions('hr.employee.manage')
  update(@Param('id', uuid) id: string, @Body(new ZodPipe(contracts.updateEmployeeSchema)) body: contracts.UpdateEmployee): Promise<contracts.Employee> {
    return this.employees.update(id, body);
  }

  @Get('employees/:id/leave-balances')
  @RequirePermissions('hr.leave.read')
  balances(@Param('id', uuid) id: string, @Query(new ZodPipe(contracts.balanceQuerySchema)) q: { year?: number }): Promise<contracts.LeaveBalance[]> {
    return this.leave.balances(id, q.year);
  }

  @Get('employees/:id/licences')
  @RequirePermissions('hr.employee.read')
  licences(@Param('id', uuid) id: string): Promise<contracts.Licence[]> {
    return this.employees.listLicences(id);
  }

  @Post('employees/:id/licences')
  @RequirePermissions('hr.employee.manage')
  addLicence(@Param('id', uuid) id: string, @Body(new ZodPipe(contracts.licenceInputSchema)) body: contracts.LicenceInput): Promise<contracts.Licence> {
    return this.employees.addLicence(id, body);
  }

  @Get('licences/expiring')
  @RequirePermissions('hr.employee.read')
  expiring(@Query(new ZodPipe(contracts.expiringQuerySchema)) q: { days: number }): Promise<contracts.ExpiringLicence[]> {
    return this.employees.expiring(q.days);
  }

  @Patch('licences/:id')
  @RequirePermissions('hr.employee.manage')
  updateLicence(@Param('id', uuid) id: string, @Body(new ZodPipe(contracts.licenceInputSchema)) body: contracts.LicenceInput): Promise<contracts.Licence> {
    return this.employees.updateLicence(id, body);
  }

  @Delete('licences/:id')
  @HttpCode(204)
  @RequirePermissions('hr.employee.manage')
  deleteLicence(@Param('id', uuid) id: string): Promise<void> {
    return this.employees.deleteLicence(id);
  }
}

@RequireEntitlement('hr')
@Controller('hr')
export class RosterController {
  constructor(private readonly roster: RosterService) {}

  @Get('shifts')
  @RequirePermissions('hr.roster.read')
  shifts(): Promise<contracts.Shift[]> {
    return this.roster.listShifts(true);
  }

  @Post('shifts')
  @RequirePermissions('hr.roster.manage')
  createShift(@Body(new ZodPipe(contracts.shiftInputSchema)) body: contracts.ShiftInput): Promise<contracts.Shift> {
    return this.roster.createShift(body);
  }

  @Patch('shifts/:id')
  @RequirePermissions('hr.roster.manage')
  updateShift(@Param('id', uuid) id: string, @Body(new ZodPipe(contracts.updateShiftSchema)) body: contracts.UpdateShift): Promise<contracts.Shift> {
    return this.roster.updateShift(id, body);
  }

  @Get('roster')
  @RequirePermissions('hr.roster.read')
  view(@Query(new ZodPipe(contracts.rosterQuerySchema)) q: contracts.RosterQuery): Promise<contracts.RosterView> {
    return this.roster.view(q);
  }

  @Put('roster')
  @RequirePermissions('hr.roster.manage')
  save(@Body(new ZodPipe(contracts.saveRosterSchema)) body: contracts.SaveRoster): Promise<{ saved: number; cleared: number }> {
    return this.roster.save(body);
  }

  @Post('roster/copy-week')
  @HttpCode(200)
  @RequirePermissions('hr.roster.manage')
  copy(@Body(new ZodPipe(contracts.copyRosterSchema)) body: contracts.CopyRoster): Promise<{ copied: number; skipped: number }> {
    return this.roster.copyWeek(body);
  }

  @Get('on-duty')
  @RequirePermissions('hr.roster.read')
  onDuty(@Query(new ZodPipe(dateQuery)) q: z.infer<typeof dateQuery>): Promise<contracts.OnDutyRow[]> {
    return this.roster.onDuty(q.date ?? new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }));
  }
}

@RequireEntitlement('hr')
@Controller('hr/attendance')
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  @Get()
  @RequirePermissions('hr.attendance.read')
  sheet(@Query(new ZodPipe(contracts.attendanceQuerySchema)) q: contracts.AttendanceQuery): Promise<contracts.AttendanceSheetRow[]> {
    return this.attendance.sheet(q);
  }

  @Put()
  @RequirePermissions('hr.attendance.manage')
  mark(@Body(new ZodPipe(contracts.markAttendanceSchema)) body: contracts.MarkAttendance): Promise<contracts.AttendanceRecord[]> {
    return this.attendance.mark(body);
  }

  @Get('summary')
  @RequirePermissions('hr.attendance.read')
  summary(@Query(new ZodPipe(contracts.monthQuerySchema)) q: contracts.MonthQuery): Promise<contracts.AttendanceSummary[]> {
    return this.attendance.monthSummary(q);
  }
}

@RequireEntitlement('hr')
@Controller('hr')
export class LeaveController {
  constructor(private readonly leave: LeaveService) {}

  @Get('leave-types')
  @RequirePermissions('hr.self.use')
  types(): Promise<contracts.LeaveType[]> {
    return this.leave.listTypes();
  }

  @Post('leave-types')
  @RequirePermissions('hr.leave.manage')
  createType(@Body(new ZodPipe(contracts.leaveTypeInputSchema)) body: contracts.LeaveTypeInput): Promise<contracts.LeaveType> {
    return this.leave.createType(body);
  }

  @Patch('leave-types/:id')
  @RequirePermissions('hr.leave.manage')
  updateType(@Param('id', uuid) id: string, @Body(new ZodPipe(contracts.updateLeaveTypeSchema)) body: contracts.UpdateLeaveType): Promise<contracts.LeaveType> {
    return this.leave.updateType(id, body);
  }

  @Get('leaves')
  @RequirePermissions('hr.leave.read')
  list(@Query(new ZodPipe(contracts.leaveQuerySchema)) q: contracts.LeaveQuery): Promise<Paginated<contracts.LeaveRequest>> {
    return this.leave.list(q);
  }

  @Post('leaves')
  @RequirePermissions('hr.leave.read', 'hr.leave.approve')
  create(@Body(new ZodPipe(contracts.createLeaveSchema)) body: contracts.CreateLeave): Promise<contracts.LeaveRequest> {
    return this.leave.create(body);
  }

  @Post('leaves/:id/decide')
  @HttpCode(200)
  @RequirePermissions('hr.leave.approve')
  decide(@Param('id', uuid) id: string, @Body(new ZodPipe(contracts.decideLeaveSchema)) body: contracts.DecideLeave): Promise<contracts.LeaveRequest> {
    return this.leave.decide(id, body);
  }

  @Post('leaves/:id/cancel')
  @HttpCode(200)
  @RequirePermissions('hr.leave.approve')
  cancel(@Param('id', uuid) id: string): Promise<contracts.LeaveRequest> {
    return this.leave.cancel(id, false);
  }
}

@RequireEntitlement('hr')
@Controller('hr')
export class PayrollController {
  constructor(private readonly payroll: PayrollService) {}

  @Get('payroll')
  @RequirePermissions('hr.payroll.read')
  list(): Promise<contracts.PayrollRunSummary[]> {
    return this.payroll.list();
  }

  @Post('payroll')
  @RequirePermissions('hr.payroll.manage')
  create(@Body(new ZodPipe(contracts.createPayrollRunSchema)) body: contracts.CreatePayrollRun): Promise<contracts.PayrollRun> {
    return this.payroll.create(body);
  }

  @Get('payroll/:id')
  @RequirePermissions('hr.payroll.read')
  get(@Param('id', uuid) id: string): Promise<contracts.PayrollRun> {
    return this.payroll.get(id);
  }

  @Post('payroll/:id/recalculate')
  @HttpCode(200)
  @RequirePermissions('hr.payroll.manage')
  recalculate(@Param('id', uuid) id: string): Promise<contracts.PayrollRun> {
    return this.payroll.recalculate(id);
  }

  @Post('payroll/:id/finalize')
  @HttpCode(200)
  @RequirePermissions('hr.payroll.finalize')
  finalize(@Param('id', uuid) id: string): Promise<contracts.PayrollRun> {
    return this.payroll.finalize(id);
  }

  @Delete('payroll/:id')
  @HttpCode(204)
  @RequirePermissions('hr.payroll.manage')
  remove(@Param('id', uuid) id: string): Promise<void> {
    return this.payroll.remove(id);
  }

  @Get('payroll/:id/export')
  @RequirePermissions('hr.payroll.read')
  export(@Param('id', uuid) id: string): Promise<contracts.PayrollExport> {
    return this.payroll.export(id);
  }

  @Get('payslips/:id')
  @RequirePermissions('hr.payroll.read')
  payslip(@Param('id', uuid) id: string): Promise<contracts.Payslip> {
    return this.payroll.payslip(id);
  }

  @Patch('payslips/:id')
  @RequirePermissions('hr.payroll.manage')
  adjust(@Param('id', uuid) id: string, @Body(new ZodPipe(contracts.adjustPayslipSchema)) body: contracts.AdjustPayslip): Promise<contracts.Payslip> {
    return this.payroll.adjust(id, body);
  }
}

/** Self-service for every staff member: own duty, punch in/out, leave and payslips. */
@RequireEntitlement('hr')
@Controller('hr/me')
export class MeController {
  constructor(
    private readonly attendance: AttendanceService,
    private readonly roster: RosterService,
    private readonly leave: LeaveService,
    private readonly payroll: PayrollService,
  ) {}

  @Get()
  @RequirePermissions('hr.self.use')
  me(): Promise<contracts.MyHr> {
    return this.attendance.me();
  }

  @Post('punch')
  @HttpCode(200)
  @RequirePermissions('hr.self.use')
  punch(): Promise<contracts.AttendanceRecord> {
    return this.attendance.punch();
  }

  @Get('attendance')
  @RequirePermissions('hr.self.use')
  attendanceMonth(@Query(new ZodPipe(contracts.monthQuerySchema)) q: contracts.MonthQuery): Promise<contracts.AttendanceRecord[]> {
    return this.attendance.myMonth(q);
  }

  @Get('roster')
  @RequirePermissions('hr.self.use')
  myRoster(@Query(new ZodPipe(rangeQuery)) q: z.infer<typeof rangeQuery>): Promise<{ shifts: contracts.Shift[]; entries: contracts.RosterEntry[] }> {
    return this.roster.mine(q.from, q.to);
  }

  @Get('leaves')
  @RequirePermissions('hr.self.use')
  leaves(): Promise<contracts.LeaveRequest[]> {
    return this.leave.mine();
  }

  @Post('leaves')
  @RequirePermissions('hr.self.use')
  apply(@Body(new ZodPipe(contracts.applyLeaveSchema)) body: contracts.ApplyLeave): Promise<contracts.LeaveRequest> {
    return this.leave.apply(body);
  }

  @Post('leaves/:id/cancel')
  @HttpCode(200)
  @RequirePermissions('hr.self.use')
  cancel(@Param('id', uuid) id: string): Promise<contracts.LeaveRequest> {
    return this.leave.cancel(id, true);
  }

  @Get('leave-balances')
  @RequirePermissions('hr.self.use')
  balances(@Query(new ZodPipe(contracts.balanceQuerySchema)) q: { year?: number }): Promise<contracts.LeaveBalance[]> {
    return this.leave.myBalances(q.year);
  }

  @Get('payslips')
  @RequirePermissions('hr.self.use')
  payslips(): Promise<contracts.Payslip[]> {
    return this.payroll.mine();
  }

  @Get('payslips/:id')
  @RequirePermissions('hr.self.use')
  payslip(@Param('id', uuid) id: string): Promise<contracts.Payslip> {
    return this.payroll.myPayslip(id);
  }
}
