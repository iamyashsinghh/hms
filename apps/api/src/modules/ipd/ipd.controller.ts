import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ipd as contracts, type Paginated } from '@hms/shared';
import { RequirePermissions } from '../../common/auth/decorators';
import { ZodPipe } from '../../common/validation/zod.pipe';
import { IpdService } from './ipd.service';

const uuid = new ParseUUIDPipe();

@Controller('ipd')
export class IpdController {
  constructor(private readonly ipd: IpdService) {}

  // ---------- wards and beds ----------

  @Get('wards')
  @RequirePermissions('ipd.ward.read')
  listWards(@Query('includeInactive') includeInactive?: string): Promise<contracts.Ward[]> {
    return this.ipd.listWards(includeInactive === 'true');
  }

  @Post('wards')
  @RequirePermissions('ipd.ward.manage')
  createWard(@Body(new ZodPipe(contracts.wardInputSchema)) body: contracts.WardInput): Promise<contracts.Ward> {
    return this.ipd.createWard(body);
  }

  @Patch('wards/:id')
  @RequirePermissions('ipd.ward.manage')
  updateWard(@Param('id', uuid) id: string, @Body(new ZodPipe(contracts.updateWardSchema)) body: contracts.UpdateWard): Promise<contracts.Ward> {
    return this.ipd.updateWard(id, body);
  }

  @Get('beds')
  @RequirePermissions('ipd.ward.read')
  listBeds(@Query() query: unknown): Promise<contracts.Bed[]> {
    return this.ipd.listBeds(query);
  }

  @Post('beds')
  @RequirePermissions('ipd.ward.manage')
  createBed(@Body(new ZodPipe(contracts.bedInputSchema)) body: contracts.BedInput): Promise<contracts.Bed> {
    return this.ipd.createBed(body);
  }

  @Post('beds/bulk')
  @RequirePermissions('ipd.ward.manage')
  createBeds(@Body(new ZodPipe(contracts.bulkBedsSchema)) body: contracts.BulkBeds): Promise<contracts.Bed[]> {
    return this.ipd.createBeds(body);
  }

  @Patch('beds/:id')
  @RequirePermissions('ipd.ward.manage')
  updateBed(@Param('id', uuid) id: string, @Body(new ZodPipe(contracts.updateBedSchema)) body: contracts.UpdateBed): Promise<contracts.Bed> {
    return this.ipd.updateBed(id, body);
  }

  /** Housekeeping: cleaning → available, maintenance, reserved. Nurses and admin. */
  @Post('beds/:id/status')
  @RequirePermissions('ipd.ward.read', 'ipd.admission.transfer')
  setBedStatus(@Param('id', uuid) id: string, @Body(new ZodPipe(contracts.bedStatusSchema)) body: contracts.BedStatusInput): Promise<contracts.Bed> {
    return this.ipd.setBedStatus(id, body);
  }

  @Get('bed-board')
  @RequirePermissions('ipd.ward.read')
  bedBoard(): Promise<contracts.BedBoard> {
    return this.ipd.bedBoard();
  }

  // ---------- admissions ----------

  @Get('admissions')
  @RequirePermissions('ipd.admission.read')
  list(@Query() query: unknown): Promise<Paginated<contracts.AdmissionSummary>> {
    return this.ipd.listAdmissions(query);
  }

  @Post('admissions')
  @RequirePermissions('ipd.admission.create')
  admit(@Body(new ZodPipe(contracts.admitSchema)) body: contracts.AdmitInput): Promise<contracts.Admission> {
    return this.ipd.admit(body);
  }

  @Get('admissions/:id')
  @RequirePermissions('ipd.admission.read')
  get(@Param('id', uuid) id: string): Promise<contracts.Admission> {
    return this.ipd.get(id);
  }

  @Patch('admissions/:id')
  @RequirePermissions('ipd.admission.create')
  update(@Param('id', uuid) id: string, @Body(new ZodPipe(contracts.updateAdmissionSchema)) body: contracts.UpdateAdmission): Promise<contracts.Admission> {
    return this.ipd.update(id, body);
  }

  @Post('admissions/:id/transfer')
  @RequirePermissions('ipd.admission.transfer')
  transfer(@Param('id', uuid) id: string, @Body(new ZodPipe(contracts.transferSchema)) body: contracts.TransferInput): Promise<contracts.Admission> {
    return this.ipd.transfer(id, body);
  }

  @Post('admissions/:id/cancel')
  @RequirePermissions('ipd.admission.cancel')
  cancel(@Param('id', uuid) id: string, @Body(new ZodPipe(contracts.cancelAdmissionSchema)) body: contracts.CancelAdmission): Promise<contracts.Admission> {
    return this.ipd.cancel(id, body);
  }

  @Post('admissions/:id/discharge')
  @RequirePermissions('ipd.admission.discharge')
  discharge(@Param('id', uuid) id: string, @Body(new ZodPipe(contracts.dischargeSchema)) body: contracts.DischargeInput): Promise<contracts.Admission> {
    return this.ipd.discharge(id, body);
  }

  // ---------- nursing ----------

  @Get('admissions/:id/vitals')
  @RequirePermissions('ipd.admission.read')
  vitals(@Param('id', uuid) id: string): Promise<contracts.Vitals[]> {
    return this.ipd.listVitals(id);
  }

  @Post('admissions/:id/vitals')
  @RequirePermissions('ipd.nursing.write')
  recordVitals(@Param('id', uuid) id: string, @Body(new ZodPipe(contracts.vitalsInputSchema)) body: contracts.VitalsInput): Promise<contracts.Vitals> {
    return this.ipd.recordVitals(id, body);
  }

  @Get('admissions/:id/nursing-notes')
  @RequirePermissions('ipd.admission.read')
  notes(@Param('id', uuid) id: string): Promise<contracts.NursingNote[]> {
    return this.ipd.listNotes(id);
  }

  @Post('admissions/:id/nursing-notes')
  @RequirePermissions('ipd.nursing.write')
  addNote(@Param('id', uuid) id: string, @Body(new ZodPipe(contracts.nursingNoteInputSchema)) body: contracts.NursingNoteInput): Promise<contracts.NursingNote> {
    return this.ipd.addNote(id, body);
  }

  @Get('admissions/:id/intake-output')
  @RequirePermissions('ipd.admission.read')
  intakeOutput(@Param('id', uuid) id: string): Promise<contracts.IntakeOutputChart> {
    return this.ipd.intakeOutput(id);
  }

  @Post('admissions/:id/intake-output')
  @RequirePermissions('ipd.nursing.write')
  recordIntakeOutput(
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(contracts.intakeOutputInputSchema)) body: contracts.IntakeOutputInput,
  ): Promise<contracts.IntakeOutput> {
    return this.ipd.recordIntakeOutput(id, body);
  }

  @Get('admissions/:id/medications')
  @RequirePermissions('ipd.admission.read')
  medications(@Param('id', uuid) id: string): Promise<contracts.MedicationOrder[]> {
    return this.ipd.listMedications(id);
  }

  @Post('admissions/:id/medications')
  @RequirePermissions('ipd.medication.order')
  orderMedication(
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(contracts.medicationOrderInputSchema)) body: contracts.MedicationOrderInput,
  ): Promise<contracts.MedicationOrder> {
    return this.ipd.orderMedication(id, body);
  }

  @Post('admissions/:id/medications/:orderId/stop')
  @RequirePermissions('ipd.medication.order')
  stopMedication(
    @Param('id', uuid) id: string,
    @Param('orderId', uuid) orderId: string,
    @Body(new ZodPipe(contracts.stopMedicationSchema)) body: contracts.StopMedication,
  ): Promise<contracts.MedicationOrder> {
    return this.ipd.stopMedication(id, orderId, body);
  }

  @Post('admissions/:id/medications/:orderId/administrations')
  @RequirePermissions('ipd.nursing.write')
  administer(
    @Param('id', uuid) id: string,
    @Param('orderId', uuid) orderId: string,
    @Body(new ZodPipe(contracts.administerSchema)) body: contracts.AdministerInput,
  ): Promise<contracts.MedicationOrder> {
    return this.ipd.administer(id, orderId, body);
  }

  // ---------- lines and devices ----------

  @Get('admissions/:id/devices')
  @RequirePermissions('ipd.admission.read')
  devices(@Param('id', uuid) id: string): Promise<contracts.Device[]> {
    return this.ipd.listDevices(id);
  }

  @Post('admissions/:id/devices')
  @RequirePermissions('ipd.nursing.write')
  addDevice(@Param('id', uuid) id: string, @Body(new ZodPipe(contracts.deviceInputSchema)) body: contracts.DeviceInput): Promise<contracts.Device> {
    return this.ipd.addDevice(id, body);
  }

  @Post('admissions/:id/devices/:deviceId/remove')
  @RequirePermissions('ipd.nursing.write')
  removeDevice(
    @Param('id', uuid) id: string,
    @Param('deviceId', uuid) deviceId: string,
    @Body(new ZodPipe(contracts.removeDeviceSchema)) body: contracts.RemoveDevice,
  ): Promise<contracts.Device> {
    return this.ipd.removeDevice(id, deviceId, body);
  }

  // ---------- census ----------

  /** Midnight census per ward for a date (today counts up to now). */
  @Get('census')
  @RequirePermissions('ipd.ward.read')
  census(@Query(new ZodPipe(contracts.censusQuerySchema)) q: { date: string }): Promise<contracts.WardCensus[]> {
    return this.ipd.census(q.date);
  }

  // ---------- rounds ----------

  @Get('admissions/:id/rounds')
  @RequirePermissions('ipd.admission.read')
  rounds(@Param('id', uuid) id: string): Promise<contracts.Round[]> {
    return this.ipd.listRounds(id);
  }

  @Post('admissions/:id/rounds')
  @RequirePermissions('ipd.round.write')
  addRound(@Param('id', uuid) id: string, @Body(new ZodPipe(contracts.roundInputSchema)) body: contracts.RoundInput): Promise<contracts.Round> {
    return this.ipd.addRound(id, body);
  }

  // ---------- running bill ----------

  @Get('admissions/:id/bill')
  @RequirePermissions('ipd.charge.read')
  bill(@Param('id', uuid) id: string): Promise<contracts.RunningBill> {
    return this.ipd.runningBill(id);
  }

  @Post('admissions/:id/charges')
  @RequirePermissions('ipd.charge.write')
  addCharge(@Param('id', uuid) id: string, @Body(new ZodPipe(contracts.chargeInputSchema)) body: contracts.ChargeInput): Promise<contracts.Charge> {
    return this.ipd.addCharge(id, body);
  }

  @Post('admissions/:id/charges/:chargeId/cancel')
  @RequirePermissions('ipd.charge.write')
  cancelCharge(
    @Param('id', uuid) id: string,
    @Param('chargeId', uuid) chargeId: string,
    @Body(new ZodPipe(contracts.cancelChargeSchema)) body: contracts.CancelCharge,
  ): Promise<contracts.Charge> {
    return this.ipd.cancelCharge(id, chargeId, body);
  }

  @Post('admissions/:id/advances')
  @RequirePermissions('ipd.advance.collect')
  advance(@Param('id', uuid) id: string, @Body(new ZodPipe(contracts.advanceInputSchema)) body: contracts.AdvanceInput): Promise<contracts.Advance> {
    return this.ipd.collectAdvance(id, body);
  }

  @Post('admissions/:id/bill/finalize')
  @RequirePermissions('ipd.bill.finalize')
  finalizeBill(@Param('id', uuid) id: string, @Body(new ZodPipe(contracts.finalizeBillSchema)) body: contracts.FinalizeBill): Promise<contracts.FinalizedBill> {
    return this.ipd.finalizeBill(id, body);
  }

  // ---------- discharge summary ----------

  @Get('admissions/:id/discharge-summary')
  @RequirePermissions('ipd.admission.read')
  async summary(@Param('id', uuid) id: string): Promise<{ summary: contracts.DischargeSummary | null }> {
    return { summary: await this.ipd.getSummary(id) };
  }

  @Get('admissions/:id/discharge-summary/draft')
  @RequirePermissions('ipd.summary.write')
  draftSummary(@Param('id', uuid) id: string): Promise<contracts.DischargeSummaryInput> {
    return this.ipd.draftSummary(id);
  }

  @Put('admissions/:id/discharge-summary')
  @RequirePermissions('ipd.summary.write')
  saveSummary(
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(contracts.dischargeSummaryInputSchema)) body: contracts.DischargeSummaryInput,
  ): Promise<contracts.DischargeSummary> {
    return this.ipd.saveSummary(id, body);
  }

  @Post('admissions/:id/discharge-summary/finalize')
  @RequirePermissions('ipd.summary.finalize')
  finalizeSummary(@Param('id', uuid) id: string): Promise<contracts.DischargeSummary> {
    return this.ipd.finalizeSummary(id);
  }
}
