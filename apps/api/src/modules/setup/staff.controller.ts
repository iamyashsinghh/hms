import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { setup as S } from '@hms/shared';
import type { z } from 'zod';
import { RequirePermissions } from '../../common/auth/decorators';
import { ZodPipe } from '../../common/validation/zod.pipe';
import { StaffService } from './staff.service';

@Controller('setup')
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @Get('staff')
  @RequirePermissions('setup.staff.read')
  list(@Query(new ZodPipe(S.staffQuerySchema)) q: z.output<typeof S.staffQuerySchema>): Promise<S.StaffMember[]> {
    return this.staff.listStaff(q);
  }

  @Get('staff/:userId')
  @RequirePermissions('setup.staff.read')
  get(@Param('userId', ParseUUIDPipe) userId: string): Promise<S.StaffMember> {
    return this.staff.getStaff(userId);
  }

  @Put('staff/:userId/profile')
  @RequirePermissions('setup.staff.manage')
  upsertProfile(@Param('userId', ParseUUIDPipe) userId: string, @Body(new ZodPipe(S.upsertStaffProfileSchema)) body: S.UpsertStaffProfile): Promise<S.StaffMember> {
    return this.staff.upsertProfile(userId, body);
  }

  @Get('doctors')
  @RequirePermissions('setup.doctor.read')
  doctors(@Query(new ZodPipe(S.doctorQuerySchema)) q: S.DoctorQuery): Promise<S.Doctor[]> {
    return this.staff.listDoctors(q);
  }

  @Get('doctors/:userId/schedule')
  @RequirePermissions('setup.doctor.read')
  schedule(@Param('userId', ParseUUIDPipe) userId: string): Promise<S.ScheduleBlock[]> {
    return this.staff.getSchedule(userId);
  }

  @Put('doctors/:userId/schedule')
  @RequirePermissions('setup.schedule.manage')
  replaceSchedule(@Param('userId', ParseUUIDPipe) userId: string, @Body(new ZodPipe(S.replaceScheduleSchema)) body: S.ReplaceSchedule): Promise<S.ScheduleBlock[]> {
    return this.staff.replaceSchedule(userId, body);
  }

  @Get('doctors/:userId/slots')
  @RequirePermissions('setup.doctor.read')
  slots(@Param('userId', ParseUUIDPipe) userId: string, @Query(new ZodPipe(S.slotsQuerySchema)) q: S.SlotsQuery): Promise<S.DoctorSlot[]> {
    return this.staff.getDoctorSchedule(userId, q.date, q.facilityId);
  }

  @Get('doctors/:userId/leaves')
  @RequirePermissions('setup.doctor.read')
  leaves(@Param('userId', ParseUUIDPipe) userId: string): Promise<S.DoctorLeave[]> {
    return this.staff.listLeaves(userId);
  }

  @Post('doctors/:userId/leaves')
  @RequirePermissions('setup.schedule.manage')
  addLeave(@Param('userId', ParseUUIDPipe) userId: string, @Body(new ZodPipe(S.createLeaveSchema)) body: S.CreateLeave): Promise<S.DoctorLeave> {
    return this.staff.addLeave(userId, body);
  }

  @Delete('doctors/:userId/leaves/:leaveId')
  @HttpCode(204)
  @RequirePermissions('setup.schedule.manage')
  deleteLeave(@Param('userId', ParseUUIDPipe) userId: string, @Param('leaveId', ParseUUIDPipe) leaveId: string): Promise<void> {
    return this.staff.deleteLeave(userId, leaveId);
  }
}
