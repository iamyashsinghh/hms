import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { portal } from '@hms/shared';
import type { z } from 'zod';
import { Public } from '../../common/auth/decorators';
import { RequireEntitlement } from '../platform';
import { ZodPipe } from '../../common/validation/zod.pipe';
import { Patient, PatientAuthGuard, type PatientPrincipal } from './portal-auth.guard';
import { PortalPatientsService } from './portal-patients.service';
import { PortalService } from './portal.service';

/**
 * Patient-facing routes. @Public() skips the staff guard; PatientAuthGuard accepts only patient tokens,
 * and every query is limited to the patients linked to the signed-in account.
 */
@Public()
@RequireEntitlement('portal')
// Listed after (so it runs before) the entitlement guard: it puts the hospital in the request context.
@UseGuards(PatientAuthGuard)
@Controller('portal')
export class PortalController {
  constructor(
    private readonly portal: PortalService,
    private readonly patients: PortalPatientsService,
  ) {}

  @Get('me')
  me(@Patient() p: PatientPrincipal): Promise<portal.PortalMe> {
    return this.patients.me(p.tenantId, p.accountId);
  }

  @Patch('me')
  async updateMe(
    @Patient() p: PatientPrincipal,
    @Body(new ZodPipe(portal.updateAccountSchema)) body: portal.UpdateAccount,
  ): Promise<portal.PortalMe> {
    await this.patients.updateAccount(p.accountId, body.name);
    return this.patients.me(p.tenantId, p.accountId);
  }

  @Post('family')
  addFamily(
    @Patient() p: PatientPrincipal,
    @Body(new ZodPipe(portal.addFamilyMemberSchema)) body: portal.AddFamilyMember,
  ): Promise<portal.PortalPatient> {
    return this.patients.addFamilyMember(p.tenantId, p.accountId, body);
  }

  @Get('doctors')
  doctors(@Query(new ZodPipe(portal.doctorQuerySchema)) q: portal.DoctorQuery): Promise<portal.PortalDoctor[]> {
    return this.portal.listDoctors(q);
  }

  @Get('doctors/:id/slots')
  slots(
    @Patient() p: PatientPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodPipe(portal.slotQuerySchema)) q: z.output<typeof portal.slotQuerySchema>,
  ): Promise<portal.PortalSlot[]> {
    return this.portal.slots(p.tenantId, id, q.date, q.facilityId);
  }

  @Get('appointments')
  appointments(
    @Patient() p: PatientPrincipal,
    @Query(new ZodPipe(portal.appointmentListQuerySchema)) q: z.output<typeof portal.appointmentListQuerySchema>,
  ): Promise<portal.PortalAppointment[]> {
    return this.portal.listAppointments(p, q);
  }

  @Post('appointments')
  book(@Patient() p: PatientPrincipal, @Body(new ZodPipe(portal.bookAppointmentSchema)) body: portal.BookAppointment) {
    return this.portal.book(p, body);
  }

  @Post('appointments/:id/cancel')
  @HttpCode(200)
  cancel(@Patient() p: PatientPrincipal, @Param('id', ParseUUIDPipe) id: string): Promise<portal.PortalAppointment> {
    return this.portal.cancel(p, id);
  }

  @Get('prescriptions')
  prescriptions(@Patient() p: PatientPrincipal, @Query(new ZodPipe(portal.recordQuerySchema)) q: portal.RecordQuery) {
    return this.portal.prescriptions(p, q.patientId);
  }

  @Get('bills')
  bills(@Patient() p: PatientPrincipal, @Query(new ZodPipe(portal.recordQuerySchema)) q: portal.RecordQuery) {
    return this.portal.bills(p, q.patientId);
  }

  @Get('reports')
  reports(@Patient() p: PatientPrincipal, @Query(new ZodPipe(portal.recordQuerySchema)) q: portal.RecordQuery) {
    return this.portal.reports(p, q.patientId);
  }

  @Post('payments/intents')
  createIntent(@Patient() p: PatientPrincipal, @Body(new ZodPipe(portal.createPaymentIntentSchema)) body: portal.CreatePaymentIntent) {
    return this.portal.createPaymentIntent(p, body.invoiceId);
  }

  @Post('payments/intents/:id/confirm')
  @HttpCode(200)
  confirmIntent(
    @Patient() p: PatientPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(portal.confirmPaymentSchema)) body: portal.ConfirmPayment,
  ) {
    return this.portal.confirmPayment(p, id, body);
  }

  @Post('feedback')
  feedback(@Patient() p: PatientPrincipal, @Body(new ZodPipe(portal.createFeedbackSchema)) body: portal.CreateFeedback) {
    return this.portal.feedback(p, body);
  }
}
