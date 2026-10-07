import { Module } from '@nestjs/common';
import { AttendanceService } from './attendance.service';
import { EmployeesService } from './employees.service';
import { AttendanceController, EmployeesController, LeaveController, MeController, PayrollController, RosterController } from './hr.controller';
import { HrService } from './hr.service';
import { LeaveService } from './leave.service';
import { PayrollService } from './payroll.service';
import { RosterService } from './roster.service';

/**
 * HR & Roster. Owned by the "hr" workstream (see PARALLEL_PLAN.md).
 * Employees (with or without a staff login), licences, shifts and duty roster, attendance, leave, monthly payroll
 * and staff self-service under /hr/me. Other modules import HrModule and use HrService.
 * Permissions and Zod contracts live in packages/shared/src/modules/hr.ts.
 */
@Module({
  controllers: [EmployeesController, RosterController, AttendanceController, LeaveController, PayrollController, MeController],
  providers: [HrService, EmployeesService, RosterService, AttendanceService, LeaveService, PayrollService],
  exports: [HrService],
})
export class HrModule {}
