import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { frontoffice as fo, type Paginated, type Patient } from '@hms/shared';
import type { z } from 'zod';
import { RequirePermissions } from '../../common/auth/decorators';
import { ZodPipe } from '../../common/validation/zod.pipe';
import { FrontofficeService } from './frontoffice.service';

type Out<S extends z.ZodType> = z.output<S>;

@Controller('frontoffice')
export class FrontofficeController {
  constructor(private readonly fo: FrontofficeService) {}

  // ---------- doctors ----------

  @Get('doctors')
  @RequirePermissions('frontoffice.appointment.read')
  doctors(): Promise<fo.Doctor[]> {
    return this.fo.listDoctors();
  }

  @Get('doctors/:id/slots')
  @RequirePermissions('frontoffice.appointment.read')
  slots(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodPipe(fo.availableSlotsQuerySchema)) q: Out<typeof fo.availableSlotsQuerySchema>,
  ): Promise<fo.AvailableSlot[]> {
    return this.fo.availableSlots(id, q);
  }

  // ---------- appointments ----------

  @Get('appointments')
  @RequirePermissions('frontoffice.appointment.read')
  list(@Query(new ZodPipe(fo.appointmentListQuerySchema)) q: Out<typeof fo.appointmentListQuerySchema>): Promise<Paginated<fo.Appointment>> {
    return this.fo.list(q);
  }

  @Get('appointments/:id')
  @RequirePermissions('frontoffice.appointment.read')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<fo.AppointmentDetail> {
    return this.fo.get(id);
  }

  @Post('appointments')
  @RequirePermissions('frontoffice.appointment.create')
  book(@Body(new ZodPipe(fo.bookAppointmentSchema)) body: Out<typeof fo.bookAppointmentSchema>): Promise<fo.Appointment> {
    return this.fo.book(body);
  }

  @Post('appointments/:id/reschedule')
  @RequirePermissions('frontoffice.appointment.update')
  reschedule(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(fo.rescheduleAppointmentSchema)) body: Out<typeof fo.rescheduleAppointmentSchema>,
  ): Promise<fo.Appointment> {
    return this.fo.reschedule(id, body);
  }

  @Post('appointments/:id/cancel')
  @RequirePermissions('frontoffice.appointment.update')
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(fo.cancelAppointmentSchema)) body: Out<typeof fo.cancelAppointmentSchema>,
  ): Promise<fo.Appointment> {
    return this.fo.cancel(id, body);
  }

  @Post('appointments/:id/no-show')
  @RequirePermissions('frontoffice.appointment.update')
  noShow(@Param('id', ParseUUIDPipe) id: string): Promise<fo.Appointment> {
    return this.fo.noShow(id);
  }

  @Post('appointments/:id/check-in')
  @RequirePermissions('frontoffice.queue.manage')
  checkIn(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(fo.checkInSchema)) body: Out<typeof fo.checkInSchema>,
  ): Promise<fo.Visit> {
    return this.fo.checkIn(id, body);
  }

  // ---------- walk-ins and the queue ----------

  @Post('walk-ins')
  @RequirePermissions('frontoffice.queue.manage')
  walkIn(@Body(new ZodPipe(fo.walkInSchema)) body: Out<typeof fo.walkInSchema>): Promise<fo.Visit> {
    return this.fo.walkIn(body);
  }

  @Get('queue')
  @RequirePermissions('frontoffice.queue.read')
  queue(@Query(new ZodPipe(fo.queueQuerySchema)) q: Out<typeof fo.queueQuerySchema>): Promise<fo.QueueResponse> {
    return this.fo.getQueue(q);
  }

  @Get('visits/:id')
  @RequirePermissions('frontoffice.queue.read')
  visit(@Param('id', ParseUUIDPipe) id: string): Promise<fo.Visit> {
    return this.fo.getVisit(id);
  }

  @Post('visits/:id/transition')
  @RequirePermissions('frontoffice.queue.manage')
  transition(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(fo.visitTransitionSchema)) body: Out<typeof fo.visitTransitionSchema>,
  ): Promise<fo.Visit> {
    return this.fo.transition(id, body.action, body.room);
  }

  @Get('display')
  @RequirePermissions('frontoffice.queue.display')
  display(@Query(new ZodPipe(fo.displayQuerySchema)) q: Out<typeof fo.displayQuerySchema>): Promise<fo.DisplayBoard> {
    return this.fo.display(q);
  }

  // ---------- duplicates, merge, ABHA ----------

  @Get('patients/duplicates')
  @RequirePermissions('frontoffice.patient.dedupe', 'core.patient.read')
  duplicates(@Query(new ZodPipe(fo.duplicateSearchSchema)) q: Out<typeof fo.duplicateSearchSchema>): Promise<fo.DuplicateCandidate[]> {
    return this.fo.findDuplicates(q);
  }

  @Get('patients/merges')
  @RequirePermissions('frontoffice.patient.merge')
  merges(): Promise<fo.PatientMerge[]> {
    return this.fo.listMerges();
  }

  @Post('patients/merge')
  @RequirePermissions('frontoffice.patient.merge')
  merge(@Body(new ZodPipe(fo.mergePatientsSchema)) body: Out<typeof fo.mergePatientsSchema>): Promise<fo.PatientMerge> {
    return this.fo.merge(body);
  }

  @Post('patients/:id/abha')
  @RequirePermissions('frontoffice.patient.dedupe', 'core.patient.update')
  abha(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(fo.abhaCaptureSchema)) body: Out<typeof fo.abhaCaptureSchema>,
  ): Promise<Patient> {
    return this.fo.captureAbha(id, body);
  }
}
