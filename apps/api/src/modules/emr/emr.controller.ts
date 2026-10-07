import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { emr, type Paginated } from '@hms/shared';
import type { z } from 'zod';
import { RequirePermissions } from '../../common/auth/decorators';
import { RequireEntitlement } from '../platform';
import { ZodPipe } from '../../common/validation/zod.pipe';
import { EmrService } from './emr.service';
import { searchIcd10 } from './icd10.data';

type Out<T extends z.ZodType> = z.output<T>;
type Certificate = emr.Certificate;
type Encounter = emr.Encounter;
type Favourite = emr.Favourite;
type Icd10Code = emr.Icd10Code;
type Prescription = emr.Prescription;
type QueueItem = emr.QueueItem;
type QuickPrescriptionResult = emr.QuickPrescriptionResult;
type TimelineEntry = emr.TimelineEntry;

@Controller('emr')
@RequireEntitlement('emr')
export class EmrController {
  constructor(private readonly emr: EmrService) {}

  // ---------- queue & timeline (contracts in PARALLEL_PLAN.md section 4) ----------

  @Get('queue')
  @RequirePermissions('emr.encounter.read')
  queue(@Query(new ZodPipe(emr.queueQuerySchema)) q: Out<typeof emr.queueQuerySchema>): Promise<{ items: QueueItem[] }> {
    return this.emr.queue(q.date, q.doctorId);
  }

  @Get('patients/:id/timeline')
  @RequirePermissions('emr.encounter.read')
  timeline(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodPipe(emr.timelineQuerySchema)) q: Out<typeof emr.timelineQuerySchema>,
  ): Promise<Paginated<TimelineEntry>> {
    return this.emr.timeline(id, q.page, q.pageSize);
  }

  @Get('patients/:id/certificates')
  @RequirePermissions('emr.certificate.read')
  patientCertificates(@Param('id', ParseUUIDPipe) id: string): Promise<Certificate[]> {
    return this.emr.listCertificates(id);
  }

  @Get('icd10')
  @RequirePermissions('emr.encounter.read')
  icd10(@Query('q') q?: string): Icd10Code[] {
    return searchIcd10(String(q ?? '').slice(0, 100));
  }

  // ---------- encounters ----------

  @Post('encounters')
  @RequirePermissions('emr.encounter.write')
  open(@Body(new ZodPipe(emr.createEncounterSchema)) body: Out<typeof emr.createEncounterSchema>): Promise<Encounter> {
    return this.emr.open(body);
  }

  @Get('encounters/:id')
  @RequirePermissions('emr.encounter.read')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<Encounter> {
    return this.emr.get(id);
  }

  @Patch('encounters/:id')
  @RequirePermissions('emr.encounter.write')
  update(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(emr.updateEncounterSchema)) body: Out<typeof emr.updateEncounterSchema>): Promise<Encounter> {
    return this.emr.update(id, body);
  }

  @Post('encounters/:id/start')
  @HttpCode(200)
  @RequirePermissions('emr.encounter.write')
  start(@Param('id', ParseUUIDPipe) id: string): Promise<Encounter> {
    return this.emr.start(id);
  }

  @Post('encounters/:id/vitals')
  @RequirePermissions('emr.vitals.write')
  vitals(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(emr.vitalsInputSchema)) body: Out<typeof emr.vitalsInputSchema>): Promise<Encounter> {
    return this.emr.addVitals(id, body);
  }

  @Put('encounters/:id/diagnoses')
  @RequirePermissions('emr.encounter.write')
  diagnoses(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(emr.diagnosesInputSchema)) body: Out<typeof emr.diagnosesInputSchema>): Promise<Encounter> {
    return this.emr.setDiagnoses(id, body);
  }

  @Put('encounters/:id/orders')
  @RequirePermissions('emr.encounter.write')
  orders(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(emr.ordersInputSchema)) body: Out<typeof emr.ordersInputSchema>): Promise<Encounter> {
    return this.emr.setOrders(id, body);
  }

  @Put('encounters/:id/prescription')
  @RequirePermissions('emr.prescription.write')
  prescription(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(emr.prescriptionInputSchema)) body: Out<typeof emr.prescriptionInputSchema>): Promise<Encounter> {
    return this.emr.setPrescription(id, body);
  }

  @Post('encounters/:id/sign')
  @HttpCode(200)
  @RequirePermissions('emr.encounter.sign')
  sign(@Param('id', ParseUUIDPipe) id: string): Promise<Encounter> {
    return this.emr.sign(id);
  }

  @Post('encounters/:id/cancel')
  @HttpCode(200)
  @RequirePermissions('emr.encounter.write')
  cancel(@Param('id', ParseUUIDPipe) id: string): Promise<Encounter> {
    return this.emr.cancel(id);
  }

  @Post('encounters/:id/addenda')
  @RequirePermissions('emr.encounter.write')
  addendum(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(emr.addendumInputSchema)) body: Out<typeof emr.addendumInputSchema>): Promise<Encounter> {
    return this.emr.addAddendum(id, body.text);
  }

  // ---------- prescriptions ----------

  @Post('prescriptions')
  @RequirePermissions('emr.encounter.write', 'emr.prescription.write')
  quickPrescription(@Body(new ZodPipe(emr.quickPrescriptionSchema)) body: Out<typeof emr.quickPrescriptionSchema>): Promise<QuickPrescriptionResult> {
    return this.emr.quickPrescription(body);
  }

  @Get('prescriptions/:id')
  @RequirePermissions('emr.prescription.read')
  getPrescription(@Param('id', ParseUUIDPipe) id: string): Promise<Prescription> {
    return this.emr.getPrescription(id);
  }

  // ---------- favourites (per doctor) ----------

  @Get('favourites')
  @RequirePermissions('emr.prescription.write')
  favourites(): Promise<Favourite[]> {
    return this.emr.listFavourites();
  }

  @Post('favourites')
  @RequirePermissions('emr.prescription.write')
  createFavourite(@Body(new ZodPipe(emr.favouriteInputSchema)) body: Out<typeof emr.favouriteInputSchema>): Promise<Favourite> {
    return this.emr.createFavourite(body);
  }

  @Delete('favourites/:id')
  @HttpCode(204)
  @RequirePermissions('emr.prescription.write')
  deleteFavourite(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.emr.deleteFavourite(id);
  }

  // ---------- certificates ----------

  @Post('certificates')
  @RequirePermissions('emr.certificate.write')
  createCertificate(@Body(new ZodPipe(emr.createCertificateSchema)) body: Out<typeof emr.createCertificateSchema>): Promise<Certificate> {
    return this.emr.createCertificate(body);
  }

  @Get('certificates/:id')
  @RequirePermissions('emr.certificate.read')
  getCertificate(@Param('id', ParseUUIDPipe) id: string): Promise<Certificate> {
    return this.emr.getCertificate(id);
  }
}
