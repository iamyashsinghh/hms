import { Injectable, Logger } from '@nestjs/common';
import { iso, type Tx } from '@hms/db';
import { ipd as contracts, type Paginated } from '@hms/shared';
import type { ipd as I } from '@hms/shared';
import type { z } from 'zod';
import { DbService } from '../../common/db/db.service';
import { AuditService } from '../../common/db/audit.service';
import { OutboxService } from '../../common/events/outbox.service';
import { currentContext } from '../../common/context/request-context';
import { badRequest, conflict, forbidden, notFound } from '../../common/errors/errors';
import { BillingService } from '../billing/billing.service';
import { PatientsService } from '../patients/patients.service';
import { SetupService } from '../setup/setup.service';
import { bedDays, istDate, lengthOfStay, lineAmountPaise, paise, rupees } from './ipd.calc';
import {
  IpdRepository,
  type AdmissionRow,
  type AdvanceRow,
  type BedRow,
  type ChargeRow,
  type DeviceRow,
  type MedAdminRow,
  type MedOrderRow,
  type StayRow,
  type SummaryRow,
  type WardRow,
} from './ipd.repository';
import { IpdCensusService } from './ipd.census';
import { IpdPlanLimits } from './ipd.limits';

const num = (v: string | number | null | undefined): number => (v == null ? 0 : Number(v));
const numOrNull = (v: string | number | null | undefined): number | null => (v == null ? null : Number(v));
const nowIso = () => new Date().toISOString();

/**
 * IPD rules: wards/beds, admission → transfers → discharge, nursing charts, rounds,
 * the running bill (bed days + posted charges + advances) and the discharge summary.
 * Money goes through BillingService: advances are billing deposits, the final bill is a billing invoice.
 */
@Injectable()
export class IpdService {
  private readonly log = new Logger('IpdService');

  constructor(
    private readonly db: DbService,
    private readonly repo: IpdRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly billing: BillingService,
    private readonly patients: PatientsService,
    private readonly setup: SetupService,
    private readonly limits: IpdPlanLimits,
    private readonly censusSvc: IpdCensusService,
  ) {}

  // =====================================================================
  // Wards and beds
  // =====================================================================

  listWards(includeInactive = false): Promise<I.Ward[]> {
    return this.db.tx(async (tx) => {
      const facilityId = currentContext()?.facilityId ?? null;
      const [wards, beds] = await Promise.all([this.repo.wards(tx, facilityId, includeInactive), this.repo.beds(tx, { facilityId })]);
      return wards.map((w) => wardDto(w, beds));
    });
  }

  createWard(input: I.WardInput): Promise<I.Ward> {
    const d = contracts.wardInputSchema.parse(input);
    return this.db.tx(async (tx) => {
      const facilityId = await this.facility(tx, d.facilityId);
      const { userId } = await this.repo.scope(tx);
      const row = await this.repo.insertWard(tx, {
        tenantId: (await this.repo.scope(tx)).tenantId,
        facilityId,
        code: d.code,
        name: d.name,
        wardType: d.wardType,
        floor: d.floor ?? null,
        defaultDailyRate: money(d.defaultDailyRate),
        isActive: d.isActive,
        createdBy: userId,
        updatedBy: userId,
      });
      return wardDto(row, []);
    });
  }

  updateWard(id: string, input: I.UpdateWard): Promise<I.Ward> {
    const d = contracts.updateWardSchema.parse(input);
    return this.db.tx(async (tx) => {
      const { userId } = await this.repo.scope(tx);
      if (d.isActive === false) {
        const beds = await this.repo.beds(tx, { wardId: id });
        if (beds.some((b) => b.status === 'occupied')) throw conflict('ward_occupied', 'Move patients out of this ward before closing it');
      }
      const row = await this.repo.updateWard(tx, id, {
        ...(d.name !== undefined && { name: d.name }),
        ...(d.wardType !== undefined && { wardType: d.wardType }),
        ...(d.floor !== undefined && { floor: d.floor || null }),
        ...(d.defaultDailyRate !== undefined && { defaultDailyRate: money(d.defaultDailyRate) }),
        ...(d.isActive !== undefined && { isActive: d.isActive }),
        updatedBy: userId,
      });
      if (!row) throw notFound('Ward');
      return wardDto(row, await this.repo.beds(tx, { wardId: id }));
    });
  }

  listBeds(query: unknown): Promise<I.Bed[]> {
    const q = contracts.bedQuerySchema.parse(query);
    return this.db.tx(async (tx) => {
      const beds = await this.repo.beds(tx, {
        facilityId: currentContext()?.facilityId ?? null,
        wardId: q.wardId,
        status: q.status,
        includeInactive: q.includeInactive === 'true',
      });
      return this.bedDtos(tx, beds);
    });
  }

  createBed(input: I.BedInput): Promise<I.Bed> {
    const d = contracts.bedInputSchema.parse(input);
    return this.addBeds(d.wardId, [{ code: d.code, roomNo: d.roomNo, dailyRate: d.dailyRate, chargeServiceCode: d.chargeServiceCode }]).then(
      (beds) => beds[0]!,
    );
  }

  createBeds(input: I.BulkBeds): Promise<I.Bed[]> {
    const d = contracts.bulkBedsSchema.parse(input);
    const specs = [];
    for (let n = d.from; n <= d.to; n++) specs.push({ code: `${d.prefix}${n}`, roomNo: d.roomNo, dailyRate: d.dailyRate, chargeServiceCode: d.chargeServiceCode });
    return this.addBeds(d.wardId, specs);
  }

  private async addBeds(wardId: string, specs: { code: string; roomNo?: string; dailyRate?: number; chargeServiceCode?: string }[]): Promise<I.Bed[]> {
    return this.db.tx(async (tx) => {
      const ward = await this.repo.wardById(tx, wardId);
      if (!ward || !ward.isActive) throw notFound('Ward');
      await this.limits.assertBeds(tx, specs.length, await this.repo.countBeds(tx));
      const { tenantId, userId } = await this.repo.scope(tx);
      const rows = await this.repo.insertBeds(
        tx,
        specs.map((s) => ({
          tenantId,
          facilityId: ward.facilityId,
          wardId: ward.id,
          code: s.code,
          roomNo: s.roomNo ?? null,
          dailyRate: s.dailyRate !== undefined ? money(s.dailyRate) : ward.defaultDailyRate,
          chargeServiceCode: s.chargeServiceCode ?? null,
          createdBy: userId,
          updatedBy: userId,
        })),
      );
      return rows.map((b) => bedDto(b, null));
    });
  }

  updateBed(id: string, input: I.UpdateBed): Promise<I.Bed> {
    const d = contracts.updateBedSchema.parse(input);
    return this.db.tx(async (tx) => {
      const bed = await this.repo.bedById(tx, id, true);
      if (!bed) throw notFound('Bed');
      if (d.isActive === false && bed.status === 'occupied') throw conflict('bed_occupied', 'This bed has a patient in it');
      if (d.isActive === true && !bed.isActive) await this.limits.assertBeds(tx, 1, await this.repo.countBeds(tx));
      const { userId } = await this.repo.scope(tx);
      const row = await this.repo.updateBed(tx, id, {
        ...(d.code !== undefined && { code: d.code }),
        ...(d.roomNo !== undefined && { roomNo: d.roomNo || null }),
        ...(d.dailyRate !== undefined && { dailyRate: money(d.dailyRate) }),
        ...(d.chargeServiceCode !== undefined && { chargeServiceCode: d.chargeServiceCode || null }),
        ...(d.isActive !== undefined && { isActive: d.isActive }),
        updatedBy: userId,
      });
      return (await this.bedDtos(tx, [row!]))[0]!;
    });
  }

  setBedStatus(id: string, input: I.BedStatusInput): Promise<I.Bed> {
    const d = contracts.bedStatusSchema.parse(input);
    return this.db.tx(async (tx) => {
      const bed = await this.repo.bedById(tx, id, true);
      if (!bed) throw notFound('Bed');
      if (bed.status === 'occupied') throw conflict('bed_occupied', 'This bed has a patient in it; transfer or discharge first');
      const { userId } = await this.repo.scope(tx);
      const row = await this.repo.updateBed(tx, id, { status: d.status, updatedBy: userId });
      return bedDto(row!, null);
    });
  }

  bedBoard(): Promise<I.BedBoard> {
    return this.db.tx(async (tx) => {
      const facilityId = currentContext()?.facilityId ?? null;
      const [wards, beds] = await Promise.all([this.repo.wards(tx, facilityId), this.repo.beds(tx, { facilityId })]);
      const dtos = await this.bedDtos(tx, beds);
      const totals = { total: 0, available: 0, occupied: 0, cleaning: 0, maintenance: 0, reserved: 0 } as I.BedBoard['totals'];
      for (const b of dtos) {
        totals.total++;
        totals[b.status]++;
      }
      return {
        totals,
        wards: wards.map((w) => ({ ...wardDto(w, beds), beds: dtos.filter((b) => b.wardId === w.id) })),
      };
    });
  }

  private async bedDtos(tx: Tx, beds: BedRow[]): Promise<I.Bed[]> {
    const ids = beds.map((b) => b.currentAdmissionId).filter((x): x is string => !!x);
    const admissions = new Map((await this.repo.admissionsByIds(tx, ids)).map((a) => [a.id, a]));
    return beds.map((b) => bedDto(b, b.currentAdmissionId ? (admissions.get(b.currentAdmissionId) ?? null) : null));
  }

  // =====================================================================
  // Admissions
  // =====================================================================

  async admit(input: I.AdmitInput): Promise<I.Admission> {
    const d = contracts.admitSchema.parse(input);
    // Own transaction (records the chart view); 404s before anything is written.
    const patient = await this.patients.get(d.patientId);
    const admission = await this.db.tx(async (tx) => {
      const bed = await this.repo.bedById(tx, d.bedId, true);
      if (!bed || !bed.isActive) throw notFound('Bed');
      if (bed.status !== 'available' && bed.status !== 'reserved') {
        throw conflict('bed_not_available', `Bed ${bed.code} is ${bed.status}`);
      }
      await this.assertFacility(bed.facilityId);
      const existing = await this.repo.activeAdmissionOf(tx, patient.id);
      if (existing) throw conflict('already_admitted', `${patient.firstName} is already admitted (${existing.ipdNo})`);
      const doctor = await this.doctor(tx, d.doctorId);
      const ward = (await this.repo.wardById(tx, bed.wardId))!;
      const { tenantId, userId } = await this.repo.scope(tx);
      const admittedAt = d.admittedAt ? new Date(d.admittedAt).toISOString() : nowIso();
      if (Date.parse(admittedAt) > Date.now() + 5 * 60_000) throw badRequest('admitted_in_future', 'Admission time cannot be in the future');
      assertExpectedDischarge(d.expectedDischargeDate, admittedAt);

      const row = await this.repo.insertAdmission(tx, {
        tenantId,
        facilityId: bed.facilityId,
        ipdNo: await this.setup.nextNumber(tx, 'ipd.admission', { prefix: 'IP' }),
        patientId: patient.id,
        patientName: [patient.firstName, patient.lastName].filter(Boolean).join(' '),
        patientUhid: patient.uhid,
        patientGender: patient.gender,
        patientDob: patient.dateOfBirth ?? null,
        patientMobile: patient.mobile ?? null,
        doctorId: d.doctorId,
        doctorName: doctor,
        admissionType: d.admissionType,
        reason: d.reason,
        provisionalDiagnosis: d.provisionalDiagnosis ?? null,
        isMlc: d.isMlc,
        mlcNo: d.mlcNo ?? null,
        attendantName: d.attendantName ?? null,
        attendantRelation: d.attendantRelation ?? null,
        attendantMobile: d.attendantMobile ?? null,
        expectedDischargeDate: d.expectedDischargeDate ?? null,
        currentBedId: bed.id,
        admittedAt,
        createdBy: userId,
        updatedBy: userId,
      });
      await this.repo.insertStay(tx, {
        tenantId,
        admissionId: row.id,
        bedId: bed.id,
        wardId: bed.wardId,
        dailyRate: bed.dailyRate,
        chargeServiceCode: bed.chargeServiceCode,
        bedLabel: `${ward.name} · ${bed.code}`,
        fromAt: admittedAt,
        reason: 'Admission',
        createdBy: userId,
      });
      await this.repo.updateBed(tx, bed.id, { status: 'occupied', currentAdmissionId: row.id, updatedBy: userId });
      const event: I.PatientAdmittedEvent = {
        admissionId: row.id,
        ipdNo: row.ipdNo,
        patientId: row.patientId,
        facilityId: row.facilityId,
        doctorId: row.doctorId,
        bedId: bed.id,
        wardId: bed.wardId,
        admittedAt: iso(row.admittedAt),
      };
      await this.outbox.publish(tx, 'ipd.patient.admitted', { ...event });
      return row;
    });
    if (d.advance) await this.collectAdvance(admission.id, d.advance);
    return this.get(admission.id);
  }

  listAdmissions(query: unknown): Promise<Paginated<I.AdmissionSummary>> {
    const q = contracts.admissionQuerySchema.parse(query);
    return this.db.tx(async (tx) => {
      const { items, total } = await this.repo.searchAdmissions(tx, currentContext()?.facilityId ?? null, q);
      const beds = await this.bedLabels(tx, items);
      return { items: items.map((a) => summaryDto(a, beds.get(a.currentBedId ?? ''))), page: q.page, pageSize: q.pageSize, total };
    });
  }

  get(id: string): Promise<I.Admission> {
    return this.db.tx(async (tx) => {
      const row = await this.repo.admissionById(tx, id);
      if (!row) throw notFound('Admission');
      await this.audit.recordView(tx, 'ipd_admission', id);
      return this.admissionDto(tx, row);
    });
  }

  update(id: string, input: I.UpdateAdmission): Promise<I.Admission> {
    const d = contracts.updateAdmissionSchema.parse(input);
    return this.db.tx(async (tx) => {
      const row = await this.activeAdmission(tx, id, true);
      const { userId } = await this.repo.scope(tx);
      if (d.expectedDischargeDate) assertExpectedDischarge(d.expectedDischargeDate, iso(row.admittedAt));
      const doctorName = d.doctorId && d.doctorId !== row.doctorId ? await this.doctor(tx, d.doctorId) : undefined;
      // Turning MLC off drops the MLC number with it.
      const mlcNo = d.isMlc === false ? null : d.mlcNo !== undefined ? d.mlcNo || null : undefined;
      const updated = await this.repo.updateAdmission(tx, id, {
        ...(d.doctorId !== undefined && { doctorId: d.doctorId }),
        ...(doctorName !== undefined && { doctorName }),
        ...(d.reason !== undefined && { reason: d.reason }),
        ...(d.provisionalDiagnosis !== undefined && { provisionalDiagnosis: d.provisionalDiagnosis || null }),
        ...(d.isMlc !== undefined && { isMlc: d.isMlc }),
        ...(mlcNo !== undefined && { mlcNo }),
        ...(d.attendantName !== undefined && { attendantName: d.attendantName || null }),
        ...(d.attendantRelation !== undefined && { attendantRelation: d.attendantRelation || null }),
        ...(d.attendantMobile !== undefined && { attendantMobile: d.attendantMobile || null }),
        ...(d.expectedDischargeDate !== undefined && { expectedDischargeDate: d.expectedDischargeDate || null }),
        updatedBy: userId,
      });
      return this.admissionDto(tx, updated);
    });
  }

  transfer(id: string, input: I.TransferInput): Promise<I.Admission> {
    const d = contracts.transferSchema.parse(input);
    return this.db.tx(async (tx) => {
      const row = await this.activeAdmission(tx, id, true);
      if (row.invoiceId) throw conflict('bill_final', 'The bill is already final; transfers are closed');
      if (row.currentBedId === d.bedId) throw badRequest('same_bed', 'The patient is already in this bed');
      const bed = await this.repo.bedById(tx, d.bedId, true);
      if (!bed || !bed.isActive) throw notFound('Bed');
      if (bed.facilityId !== row.facilityId) throw badRequest('other_facility', 'Transfers between facilities need a new admission');
      if (bed.status !== 'available' && bed.status !== 'reserved') throw conflict('bed_not_available', `Bed ${bed.code} is ${bed.status}`);
      const ward = (await this.repo.wardById(tx, bed.wardId))!;
      const { tenantId, userId } = await this.repo.scope(tx);
      const at = nowIso();
      const fromBedId = row.currentBedId!;
      await this.repo.closeOpenStay(tx, id, at);
      await this.repo.updateBed(tx, fromBedId, { status: d.vacatedBedStatus, currentAdmissionId: null, updatedBy: userId });
      await this.repo.insertStay(tx, {
        tenantId,
        admissionId: id,
        bedId: bed.id,
        wardId: bed.wardId,
        dailyRate: bed.dailyRate,
        chargeServiceCode: bed.chargeServiceCode,
        bedLabel: `${ward.name} · ${bed.code}`,
        fromAt: at,
        reason: d.reason,
        createdBy: userId,
      });
      await this.repo.updateBed(tx, bed.id, { status: 'occupied', currentAdmissionId: id, updatedBy: userId });
      const updated = await this.repo.updateAdmission(tx, id, { currentBedId: bed.id, updatedBy: userId });
      const event: I.PatientTransferredEvent = { admissionId: id, patientId: row.patientId, facilityId: row.facilityId, fromBedId, toBedId: bed.id, toWardId: bed.wardId };
      await this.outbox.publish(tx, 'ipd.patient.transferred', { ...event });
      return this.admissionDto(tx, updated);
    });
  }

  /** Admitted by mistake: frees the bed. Not allowed once money or a bill is attached. */
  cancel(id: string, input: I.CancelAdmission): Promise<I.Admission> {
    const d = contracts.cancelAdmissionSchema.parse(input);
    return this.db.tx(async (tx) => {
      const row = await this.activeAdmission(tx, id, true);
      if (row.invoiceId) throw conflict('bill_final', 'The bill is already final; discharge the patient instead');
      if ((await this.repo.advances(tx, id)).length) throw conflict('has_advance', 'An advance was taken; refund it in Billing, then discharge instead');
      const { userId } = await this.repo.scope(tx);
      const at = nowIso();
      await this.repo.closeOpenStay(tx, id, at);
      await this.repo.removeOpenDevices(tx, id, at, userId, 'Admission cancelled');
      await this.repo.updateBed(tx, row.currentBedId!, { status: 'available', currentAdmissionId: null, updatedBy: userId });
      const updated = await this.repo.updateAdmission(tx, id, { status: 'cancelled', currentBedId: null, cancelReason: d.reason, updatedBy: userId });
      await this.outbox.publish(tx, 'ipd.admission.cancelled', { admissionId: id, patientId: row.patientId, facilityId: row.facilityId, reason: d.reason });
      return this.admissionDto(tx, updated);
    });
  }

  async discharge(id: string, input: I.DischargeInput): Promise<I.Admission> {
    const d = contracts.dischargeSchema.parse(input);
    const pre = await this.db.tx((tx) => this.activeAdmission(tx, id));
    if (!pre.invoiceId) throw conflict('bill_not_final', 'Finalize the IPD bill before discharge');
    const invoice = await this.billing.getInvoice(pre.invoiceId);
    if (invoice.balance > 0 && !d.allowDue) {
      throw badRequest('balance_due', `₹${invoice.balance.toFixed(2)} is still due on bill ${invoice.number}`, { balance: invoice.balance, invoiceId: invoice.id });
    }
    if (invoice.balance > 0 && !d.notes) throw badRequest('notes_required', 'Add a note explaining why the patient leaves with money due');
    return this.db.tx(async (tx) => {
      const row = await this.activeAdmission(tx, id, true);
      const summary = await this.repo.summary(tx, id);
      if (d.dischargeType !== 'absconded' && summary?.status !== 'final') {
        throw conflict('summary_not_final', 'Sign off the discharge summary before discharge');
      }
      const { userId } = await this.repo.scope(tx);
      const at = nowIso();
      await this.repo.closeOpenStay(tx, id, at);
      await this.repo.removeOpenDevices(tx, id, at, userId, 'Discharged');
      await this.repo.updateBed(tx, row.currentBedId!, { status: 'cleaning', currentAdmissionId: null, updatedBy: userId });
      const updated = await this.repo.updateAdmission(tx, id, {
        status: 'discharged',
        currentBedId: null,
        dischargedAt: at,
        dischargeType: d.dischargeType,
        dischargeNotes: d.notes ?? null,
        updatedBy: userId,
      });
      const event: I.PatientDischargedEvent = {
        admissionId: id,
        ipdNo: row.ipdNo,
        patientId: row.patientId,
        facilityId: row.facilityId,
        doctorId: row.doctorId,
        dischargeType: d.dischargeType,
        dischargedAt: at,
        invoiceId: row.invoiceId,
      };
      await this.outbox.publish(tx, 'ipd.patient.discharged', { ...event });
      return this.admissionDto(tx, updated);
    });
  }

  private async admissionDto(tx: Tx, row: AdmissionRow): Promise<I.Admission> {
    const [stays, labels, summaries] = await Promise.all([this.repo.stays(tx, row.id), this.bedLabels(tx, [row]), this.repo.summaryStatuses(tx, [row.id])]);
    return {
      ...summaryDto(row, labels.get(row.currentBedId ?? '')),
      patientDob: row.patientDob,
      patientMobile: row.patientMobile,
      reason: row.reason,
      provisionalDiagnosis: row.provisionalDiagnosis,
      mlcNo: row.mlcNo,
      attendantName: row.attendantName,
      attendantRelation: row.attendantRelation,
      attendantMobile: row.attendantMobile,
      expectedDischargeDate: row.expectedDischargeDate,
      invoiceId: row.invoiceId,
      billedAt: row.billedAt ? iso(row.billedAt) : null,
      dischargeType: row.dischargeType as I.DischargeType | null,
      dischargeNotes: row.dischargeNotes,
      cancelReason: row.cancelReason,
      stays: stays.map(stayDto),
      summaryStatus: (summaries.get(row.id) as 'draft' | 'final' | undefined) ?? 'none',
    };
  }

  private async bedLabels(tx: Tx, rows: AdmissionRow[]): Promise<Map<string, { bed: string; ward: string }>> {
    const out = new Map<string, { bed: string; ward: string }>();
    const ids = new Set(rows.map((r) => r.currentBedId).filter((x): x is string => !!x));
    if (!ids.size) return out;
    const facilityIds = [...new Set(rows.map((r) => r.facilityId))];
    for (const f of facilityIds) {
      const [beds, wards] = await Promise.all([this.repo.beds(tx, { facilityId: f, includeInactive: true }), this.repo.wards(tx, f, true)]);
      const wardNames = new Map(wards.map((w) => [w.id, w.name]));
      for (const b of beds) if (ids.has(b.id)) out.set(b.id, { bed: b.code, ward: wardNames.get(b.wardId) ?? '' });
    }
    return out;
  }

  // =====================================================================
  // Nursing: vitals, notes, intake/output, MAR
  // =====================================================================

  listVitals(admissionId: string): Promise<I.Vitals[]> {
    return this.db.tx(async (tx) => {
      await this.admission(tx, admissionId);
      return (await this.repo.vitals(tx, admissionId)).map(vitalsDto);
    });
  }

  recordVitals(admissionId: string, input: I.VitalsInput): Promise<I.Vitals> {
    const d = contracts.vitalsInputSchema.parse(input);
    return this.db.tx(async (tx) => {
      await this.activeAdmission(tx, admissionId);
      const { tenantId, userId } = await this.repo.scope(tx);
      const row = await this.repo.insertVitals(tx, {
        tenantId,
        admissionId,
        recordedAt: this.pastOrNow(d.recordedAt),
        temperatureC: d.temperatureC?.toFixed(1) ?? null,
        pulse: d.pulse ?? null,
        respRate: d.respRate ?? null,
        bpSystolic: d.bpSystolic ?? null,
        bpDiastolic: d.bpDiastolic ?? null,
        spo2: d.spo2 ?? null,
        painScore: d.painScore ?? null,
        bloodSugar: d.bloodSugar?.toFixed(1) ?? null,
        notes: d.notes ?? null,
        recordedBy: userId,
      });
      return vitalsDto(row);
    });
  }

  listNotes(admissionId: string): Promise<I.NursingNote[]> {
    return this.db.tx(async (tx) => {
      await this.admission(tx, admissionId);
      return (await this.repo.notes(tx, admissionId)).map((n) => ({
        id: n.id,
        shift: n.shift as I.NursingShift | null,
        note: n.note,
        recordedBy: n.recordedBy,
        recordedByName: n.recordedByName,
        createdAt: iso(n.createdAt),
      }));
    });
  }

  addNote(admissionId: string, input: I.NursingNoteInput): Promise<I.NursingNote> {
    const d = contracts.nursingNoteInputSchema.parse(input);
    return this.db.tx(async (tx) => {
      await this.activeAdmission(tx, admissionId);
      const { tenantId, userId } = await this.repo.scope(tx);
      const n = await this.repo.insertNote(tx, { tenantId, admissionId, shift: d.shift ?? null, note: d.note, recordedBy: userId, recordedByName: await this.repo.userName(tx, userId) });
      return { id: n.id, shift: n.shift as I.NursingShift | null, note: n.note, recordedBy: n.recordedBy, recordedByName: n.recordedByName, createdAt: iso(n.createdAt) };
    });
  }

  intakeOutput(admissionId: string): Promise<I.IntakeOutputChart> {
    return this.db.tx(async (tx) => {
      await this.admission(tx, admissionId);
      const rows = await this.repo.intakeOutput(tx, admissionId);
      const days = new Map<string, { date: string; intakeMl: number; outputMl: number; balanceMl: number }>();
      for (const r of rows) {
        const date = istDate(r.recordedAt);
        const day = days.get(date) ?? { date, intakeMl: 0, outputMl: 0, balanceMl: 0 };
        if (r.direction === 'intake') day.intakeMl += r.volumeMl;
        else day.outputMl += r.volumeMl;
        day.balanceMl = day.intakeMl - day.outputMl;
        days.set(date, day);
      }
      return { entries: rows.map(ioDto), days: [...days.values()].sort((a, b) => b.date.localeCompare(a.date)) };
    });
  }

  recordIntakeOutput(admissionId: string, input: I.IntakeOutputInput): Promise<I.IntakeOutput> {
    const d = contracts.intakeOutputInputSchema.parse(input);
    return this.db.tx(async (tx) => {
      await this.activeAdmission(tx, admissionId);
      const { tenantId, userId } = await this.repo.scope(tx);
      const row = await this.repo.insertIntakeOutput(tx, {
        tenantId,
        admissionId,
        direction: d.direction,
        category: d.category,
        volumeMl: d.volumeMl,
        recordedAt: this.pastOrNow(d.recordedAt),
        notes: d.notes ?? null,
        recordedBy: userId,
      });
      return ioDto(row);
    });
  }

  listMedications(admissionId: string): Promise<I.MedicationOrder[]> {
    return this.db.tx(async (tx) => {
      await this.admission(tx, admissionId);
      const [orders, given] = await Promise.all([this.repo.medOrders(tx, admissionId), this.repo.administrations(tx, admissionId)]);
      return orders.map((o) => medOrderDto(o, given.filter((g) => g.orderId === o.id)));
    });
  }

  orderMedication(admissionId: string, input: I.MedicationOrderInput): Promise<I.MedicationOrder> {
    const d = contracts.medicationOrderInputSchema.parse(input);
    return this.db.tx(async (tx) => {
      await this.activeAdmission(tx, admissionId);
      const { tenantId, userId } = await this.repo.scope(tx);
      const row = await this.repo.insertMedOrder(tx, {
        tenantId,
        admissionId,
        drugName: d.drugName,
        dose: d.dose,
        route: d.route,
        frequency: d.frequency,
        instructions: d.instructions ?? null,
        isPrn: d.isPrn,
        startAt: d.startAt ? new Date(d.startAt).toISOString() : nowIso(),
        orderedBy: userId,
        orderedByName: await this.repo.userName(tx, userId),
      });
      return medOrderDto(row, []);
    });
  }

  stopMedication(admissionId: string, orderId: string, input: I.StopMedication): Promise<I.MedicationOrder> {
    const d = contracts.stopMedicationSchema.parse(input);
    return this.db.tx(async (tx) => {
      const order = await this.repo.medOrderById(tx, orderId, true);
      if (!order || order.admissionId !== admissionId) throw notFound('Medication order');
      if (order.status === 'stopped') throw conflict('already_stopped', 'This medication is already stopped');
      const row = await this.repo.updateMedOrder(tx, orderId, { status: 'stopped', stoppedAt: nowIso(), stopReason: d.reason });
      return medOrderDto(row, (await this.repo.administrations(tx, admissionId)).filter((g) => g.orderId === orderId));
    });
  }

  administer(admissionId: string, orderId: string, input: I.AdministerInput): Promise<I.MedicationOrder> {
    const d = contracts.administerSchema.parse(input);
    return this.db.tx(async (tx) => {
      await this.activeAdmission(tx, admissionId);
      const order = await this.repo.medOrderById(tx, orderId);
      if (!order || order.admissionId !== admissionId) throw notFound('Medication order');
      if (order.status !== 'active') throw conflict('medication_stopped', 'This medication was stopped');
      const { tenantId, userId } = await this.repo.scope(tx);
      await this.repo.insertAdministration(tx, {
        tenantId,
        orderId,
        admissionId,
        status: d.status,
        givenAt: this.pastOrNow(d.givenAt),
        notes: d.notes ?? null,
        givenBy: userId,
        givenByName: await this.repo.userName(tx, userId),
      });
      return medOrderDto(order, (await this.repo.administrations(tx, admissionId)).filter((g) => g.orderId === orderId));
    });
  }

  // =====================================================================
  // Lines and devices (HAI device-days)
  // =====================================================================

  listDevices(admissionId: string): Promise<I.Device[]> {
    return this.db.tx(async (tx) => {
      await this.admission(tx, admissionId);
      return (await this.repo.devices(tx, admissionId)).map(deviceDto);
    });
  }

  addDevice(admissionId: string, input: I.DeviceInput): Promise<I.Device> {
    const d = contracts.deviceInputSchema.parse(input);
    return this.db.tx(async (tx) => {
      const row = await this.activeAdmission(tx, admissionId);
      const insertedAt = this.pastOrNow(d.insertedAt);
      if (Date.parse(insertedAt) < Date.parse(row.admittedAt)) throw badRequest('before_admission', 'Insertion time is before the admission');
      const { tenantId, userId } = await this.repo.scope(tx);
      return deviceDto(
        await this.repo.insertDevice(tx, {
          tenantId,
          admissionId,
          deviceType: d.deviceType,
          site: d.site ?? null,
          notes: d.notes ?? null,
          insertedAt,
          insertedBy: userId,
        }),
      );
    });
  }

  removeDevice(admissionId: string, deviceId: string, input: I.RemoveDevice): Promise<I.Device> {
    const d = contracts.removeDeviceSchema.parse(input);
    return this.db.tx(async (tx) => {
      await this.admission(tx, admissionId);
      const dev = await this.repo.deviceById(tx, deviceId);
      if (!dev || dev.admissionId !== admissionId) throw notFound('Device');
      if (dev.removedAt) throw conflict('already_removed', 'This device was already removed');
      const removedAt = this.pastOrNow(d.removedAt);
      if (Date.parse(removedAt) < Date.parse(dev.insertedAt)) throw badRequest('before_insertion', 'Removal time is before insertion');
      const { userId } = await this.repo.scope(tx);
      return deviceDto(await this.repo.updateDevice(tx, deviceId, { removedAt, removedBy: userId, removalReason: d.reason ?? null }));
    });
  }

  // =====================================================================
  // Daily census
  // =====================================================================

  census(date: string): Promise<I.WardCensus[]> {
    return this.db.tx(async (tx) => {
      const facilityId = await this.facility(tx);
      return this.censusSvc.wards(tx, facilityId, date);
    });
  }

  // =====================================================================
  // Doctor rounds
  // =====================================================================

  listRounds(admissionId: string): Promise<I.Round[]> {
    return this.db.tx(async (tx) => {
      await this.admission(tx, admissionId);
      return (await this.repo.rounds(tx, admissionId)).map(roundDto);
    });
  }

  addRound(admissionId: string, input: I.RoundInput): Promise<I.Round> {
    const d = contracts.roundInputSchema.parse(input);
    return this.db.tx(async (tx) => {
      await this.activeAdmission(tx, admissionId);
      const { tenantId, userId } = await this.repo.scope(tx);
      const row = await this.repo.insertRound(tx, {
        tenantId,
        admissionId,
        doctorId: userId,
        doctorName: (await this.repo.userName(tx, userId)) ?? 'Doctor',
        roundAt: this.pastOrNow(d.roundAt),
        subjective: d.subjective ?? null,
        findings: d.findings ?? null,
        plan: d.plan,
      });
      return roundDto(row);
    });
  }

  // =====================================================================
  // Running bill, advances, final bill
  // =====================================================================

  async runningBill(admissionId: string): Promise<I.RunningBill> {
    const bill = await this.db.tx(async (tx) => this.computeBill(tx, await this.admission(tx, admissionId)));
    const account = await this.billing.patientAccount(bill.patientId);
    return { ...bill.dto, depositBalance: account.depositBalance };
  }

  private async computeBill(tx: Tx, row: AdmissionRow) {
    const [stays, charges, advances] = await Promise.all([this.repo.stays(tx, row.id), this.repo.charges(tx, row.id), this.repo.advances(tx, row.id)]);
    const until = row.dischargedAt ?? row.billedAt ?? nowIso();
    const days = row.status === 'cancelled' ? [] : bedDays(stays.map(stayForBilling), row.admittedAt, until);
    const bedCharges: I.BedChargeLine[] = days.map((b) => ({
      stayId: b.stayId,
      bedLabel: b.bedLabel,
      serviceCode: b.serviceCode,
      days: b.dates.length,
      dates: b.dates,
      dailyRate: b.dailyRate,
      amount: rupees(b.dates.length * paise(b.dailyRate)),
    }));
    const active = charges.filter((c) => c.status === 'active');
    const bedTotal = bedCharges.reduce((s, b) => s + paise(b.amount), 0);
    const chargesTotal = active.reduce((s, c) => s + chargeAmountPaise(c), 0);
    const advanceTotal = advances.reduce((s, a) => s + paise(a.amount), 0);
    const dto: Omit<I.RunningBill, 'depositBalance'> = {
      admissionId: row.id,
      status: row.invoiceId ? 'final' : 'running',
      invoiceId: row.invoiceId,
      bedCharges,
      charges: charges.map(chargeDto),
      bedTotal: rupees(bedTotal),
      chargesTotal: rupees(chargesTotal),
      grossTotal: rupees(bedTotal + chargesTotal),
      advances: advances.map(advanceDto),
      advanceTotal: rupees(advanceTotal),
      estimatedDue: rupees(bedTotal + chargesTotal - advanceTotal),
    };
    return { dto, patientId: row.patientId, active, days };
  }

  async addCharge(admissionId: string, input: I.ChargeInput): Promise<I.Charge> {
    const d = contracts.chargeInputSchema.parse(input);
    const price = d.serviceCode && (d.unitPrice === undefined || d.taxRate === undefined || !d.description) ? await this.billing.getServicePrice(d.serviceCode) : null;
    return this.db.tx(async (tx) => {
      const row = await this.activeAdmission(tx, admissionId);
      if (row.invoiceId) throw conflict('bill_final', 'The IPD bill is final; post further charges as a separate bill in Billing');
      const { tenantId, userId } = await this.repo.scope(tx);
      const unitPrice = d.unitPrice ?? price!.price;
      const discount = d.discount ?? 0;
      if (discount > d.qty * unitPrice) throw badRequest('discount_too_high', 'Discount is more than the charge');
      const c = await this.repo.insertCharge(tx, {
        tenantId,
        admissionId,
        chargeDate: d.chargeDate ?? istDate(new Date()),
        serviceCode: d.serviceCode ?? null,
        description: d.description ?? price!.name,
        qty: String(d.qty),
        unitPrice: money(unitPrice),
        taxRate: String(d.taxRate ?? price?.taxRate ?? 0),
        discount: money(discount),
        createdBy: userId,
        updatedBy: userId,
      });
      return chargeDto(c);
    });
  }

  cancelCharge(admissionId: string, chargeId: string, input: I.CancelCharge): Promise<I.Charge> {
    const d = contracts.cancelChargeSchema.parse(input);
    return this.db.tx(async (tx) => {
      const row = await this.admission(tx, admissionId, true);
      if (row.invoiceId) throw conflict('bill_final', 'The IPD bill is final; issue a credit note in Billing instead');
      const c = await this.repo.chargeById(tx, chargeId);
      if (!c || c.admissionId !== admissionId) throw notFound('Charge');
      if (c.status === 'cancelled') throw conflict('already_cancelled', 'This charge is already cancelled');
      const { userId } = await this.repo.scope(tx);
      return chargeDto(await this.repo.updateCharge(tx, chargeId, { status: 'cancelled', cancelReason: d.reason, updatedBy: userId }));
    });
  }

  /** Takes a billing deposit for the patient and links it to this admission. */
  async collectAdvance(admissionId: string, input: I.AdvanceInput): Promise<I.Advance> {
    const d = contracts.advanceInputSchema.parse(input);
    const row = await this.db.tx((tx) => this.activeAdmission(tx, admissionId));
    if (row.invoiceId) throw conflict('bill_final', 'The IPD bill is final; collect the balance on the invoice in Billing');
    const payment = await this.billing.collectDeposit({
      patientId: row.patientId,
      facilityId: row.facilityId,
      mode: d.mode,
      amount: d.amount,
      reference: d.reference,
      notes: `IPD advance ${row.ipdNo}`,
    });
    return this.db.tx(async (tx) => {
      const { tenantId, userId } = await this.repo.scope(tx);
      const a = await this.repo.insertAdvance(tx, {
        tenantId,
        admissionId,
        paymentId: payment.id,
        receiptNo: payment.number,
        mode: payment.mode,
        amount: money(payment.amount),
        receivedAt: payment.receivedAt,
        receivedBy: userId,
      });
      return advanceDto(a);
    });
  }

  /**
   * Turns the running bill into one final billing invoice (bed days + charges), locks the charges,
   * then adjusts the patient's advance against it. Discharge needs this first.
   */
  async finalizeBill(admissionId: string, input: I.FinalizeBill): Promise<I.FinalizedBill> {
    const d = contracts.finalizeBillSchema.parse(input);
    const created = await this.db.tx(async (tx) => {
      const row = await this.activeAdmission(tx, admissionId, true);
      if (row.invoiceId) throw conflict('bill_final', 'The IPD bill is already final');
      const billedAt = nowIso();
      const { active, days } = await this.computeBill(tx, { ...row, billedAt });
      const lines: { serviceCode?: string; description: string; qty: number; unitPrice: number; taxRate: number; discount?: number }[] = [
        ...days.map((b) => ({
          ...(b.serviceCode ? { serviceCode: b.serviceCode } : {}),
          description: `Bed charges: ${b.bedLabel} (${b.dates[0]}${b.dates.length > 1 ? ` to ${b.dates[b.dates.length - 1]}` : ''})`,
          qty: b.dates.length,
          unitPrice: b.dailyRate,
          taxRate: 0,
        })),
        ...active.map((c) => ({
          ...(c.serviceCode ? { serviceCode: c.serviceCode } : {}),
          description: c.description,
          qty: Number(c.qty),
          unitPrice: Number(c.unitPrice),
          taxRate: Number(c.taxRate),
          discount: num(c.discount) || undefined,
        })),
      ];
      if (d.discount) {
        // A bill-level discount is spread over the (GST-free) bed lines, largest first.
        const bedLines = lines.slice(0, days.length).sort((a, b) => b.qty * b.unitPrice - a.qty * a.unitPrice);
        let left = paise(d.discount);
        if (left > bedLines.reduce((s, l) => s + Math.round(l.qty * paise(l.unitPrice)), 0)) {
          throw badRequest('discount_too_high', 'A bill discount can be at most the bed charges');
        }
        for (const l of bedLines) {
          const take = Math.min(left, Math.round(l.qty * paise(l.unitPrice)));
          if (take) l.discount = rupees(take);
          left -= take;
        }
      }
      if (!lines.length) throw badRequest('nothing_to_bill', 'There is nothing to bill');
      const inv = await this.billing.createInvoice(tx, {
        patientId: row.patientId,
        facilityId: row.facilityId,
        source: { module: 'ipd', refId: row.id },
        doctorId: row.doctorId,
        notes: [`IPD ${row.ipdNo}`, d.notes].filter(Boolean).join(' · '),
        lines,
        finalize: true,
      });
      const { userId } = await this.repo.scope(tx);
      await this.repo.updateAdmission(tx, row.id, { invoiceId: inv.invoiceId, billedAt, updatedBy: userId });
      return { inv, patientId: row.patientId };
    });

    let adjusted = 0;
    if (d.adjustAdvance) {
      const account = await this.billing.patientAccount(created.patientId);
      const amount = Math.min(account.depositBalance, created.inv.total);
      if (amount > 0) {
        try {
          await this.billing.collectPayment(created.inv.invoiceId, { mode: 'deposit', amount });
          adjusted = amount;
        } catch (err) {
          // The invoice stands; staff can adjust the advance from the Billing screen.
          this.log.warn(`Advance adjustment failed for invoice ${created.inv.invoiceId}: ${(err as Error).message}`);
        }
      }
    }
    const inv = await this.billing.getInvoice(created.inv.invoiceId);
    return { invoiceId: inv.id, number: inv.number, total: inv.total, advanceAdjusted: adjusted, balanceDue: inv.balance };
  }

  // =====================================================================
  // Discharge summary
  // =====================================================================

  getSummary(admissionId: string): Promise<I.DischargeSummary | null> {
    return this.db.tx(async (tx) => {
      await this.admission(tx, admissionId);
      const row = await this.repo.summary(tx, admissionId);
      return row ? summaryDocDto(row) : null;
    });
  }

  /** Prefill for a new summary: diagnosis, rounds and active medications. */
  draftSummary(admissionId: string): Promise<I.DischargeSummaryInput> {
    return this.db.tx(async (tx) => {
      const row = await this.admission(tx, admissionId);
      const [rounds, meds] = await Promise.all([this.repo.rounds(tx, admissionId), this.repo.medOrders(tx, admissionId)]);
      return {
        finalDiagnosis: row.provisionalDiagnosis ?? '',
        presentingComplaints: row.reason,
        hospitalCourse: rounds
          .slice()
          .reverse()
          .map((r) => `${istDate(r.roundAt)}: ${r.plan}`)
          .join('\n'),
        medications: meds.filter((m) => m.status === 'active' && !m.isPrn).map((m) => ({ drugName: m.drugName, dose: m.dose, frequency: m.frequency })),
      };
    });
  }

  saveSummary(admissionId: string, input: I.DischargeSummaryInput): Promise<I.DischargeSummary> {
    const d = contracts.dischargeSummaryInputSchema.parse(input);
    return this.db.tx(async (tx) => {
      const row = await this.admission(tx, admissionId);
      if (row.status === 'cancelled') throw conflict('admission_cancelled', 'This admission was cancelled');
      const existing = await this.repo.summary(tx, admissionId);
      if (existing?.status === 'final') throw conflict('summary_final', 'The discharge summary is signed and cannot change');
      const { tenantId, userId } = await this.repo.scope(tx);
      const saved = await this.repo.upsertSummary(tx, {
        tenantId,
        admissionId,
        finalDiagnosis: d.finalDiagnosis,
        presentingComplaints: d.presentingComplaints ?? null,
        history: d.history ?? null,
        examination: d.examination ?? null,
        investigations: d.investigations ?? null,
        procedures: d.procedures ?? null,
        hospitalCourse: d.hospitalCourse ?? null,
        conditionAtDischarge: d.conditionAtDischarge ?? null,
        medications: d.medications,
        advice: d.advice ?? null,
        followUpDate: d.followUpDate ?? null,
        followUpNotes: d.followUpNotes ?? null,
        createdBy: userId,
        updatedBy: userId,
      });
      return summaryDocDto(saved);
    });
  }

  finalizeSummary(admissionId: string): Promise<I.DischargeSummary> {
    return this.db.tx(async (tx) => {
      const row = await this.admission(tx, admissionId);
      const existing = await this.repo.summary(tx, admissionId);
      if (!existing) throw notFound('Discharge summary');
      if (existing.status === 'final') throw conflict('summary_final', 'The discharge summary is already signed');
      const { userId } = await this.repo.scope(tx);
      const at = nowIso();
      const saved = await this.repo.updateSummary(tx, existing.id, {
        status: 'final',
        finalizedAt: at,
        finalizedBy: userId,
        finalizedByName: await this.repo.userName(tx, userId),
        updatedBy: userId,
      });
      const event: I.DischargeSummaryFinalizedEvent = { admissionId, summaryId: saved.id, patientId: row.patientId, finalizedAt: at };
      await this.outbox.publish(tx, 'ipd.discharge_summary.finalized', { ...event });
      return summaryDocDto(saved);
    });
  }

  // =====================================================================
  // helpers
  // =====================================================================

  private async admission(tx: Tx, id: string, lock = false): Promise<AdmissionRow> {
    const row = await this.repo.admissionById(tx, id, lock);
    if (!row) throw notFound('Admission');
    await this.assertFacility(row.facilityId);
    return row;
  }

  private async activeAdmission(tx: Tx, id: string, lock = false): Promise<AdmissionRow> {
    const row = await this.admission(tx, id, lock);
    if (row.status !== 'admitted') throw conflict('not_admitted', `This admission is ${row.status}`);
    return row;
  }

  /** Staff limited to some facilities cannot act on another facility's patients. */
  private async assertFacility(facilityId: string): Promise<void> {
    const ctx = currentContext();
    if (ctx?.facilityIds && ctx.facilityIds !== 'all' && ctx.userId && !ctx.facilityIds.includes(facilityId)) {
      throw forbidden('You do not have access to this facility');
    }
  }

  private async facility(tx: Tx, explicit?: string): Promise<string> {
    const id = explicit ?? currentContext()?.facilityId ?? (await this.repo.soleFacilityId(tx));
    if (!id) throw badRequest('facility_required', 'Choose a facility (X-Facility-Id header or facilityId)');
    await this.assertFacility(id);
    return id;
  }

  private async doctor(tx: Tx, userId: string): Promise<string> {
    try {
      return (await this.setup.getDoctorInTx(tx, userId)).name;
    } catch {
      throw badRequest('invalid_doctor', 'Pick an active doctor');
    }
  }

  private pastOrNow(at?: string): string {
    if (!at) return nowIso();
    const t = Date.parse(at);
    if (t > Date.now() + 5 * 60_000) throw badRequest('time_in_future', 'Time cannot be in the future');
    return new Date(t).toISOString();
  }
}

// ---------- mappers ----------

const money = (v: number) => (Math.round(v * 100) / 100).toFixed(2);

function chargeAmountPaise(c: ChargeRow): number {
  return lineAmountPaise(Number(c.qty), Number(c.unitPrice), Number(c.discount), Number(c.taxRate));
}

function stayForBilling(s: StayRow) {
  return { id: s.id, bedLabel: s.bedLabel, serviceCode: s.chargeServiceCode, dailyRate: Number(s.dailyRate), fromAt: s.fromAt, toAt: s.toAt };
}

function wardDto(w: WardRow, beds: BedRow[]): I.Ward {
  const mine = beds.filter((b) => b.wardId === w.id && b.isActive);
  return {
    id: w.id,
    facilityId: w.facilityId,
    code: w.code,
    name: w.name,
    wardType: w.wardType as I.WardType,
    floor: w.floor,
    defaultDailyRate: num(w.defaultDailyRate),
    isActive: w.isActive,
    bedCount: mine.length,
    occupiedCount: mine.filter((b) => b.status === 'occupied').length,
  };
}

function bedDto(b: BedRow, a: AdmissionRow | null): I.Bed {
  return {
    id: b.id,
    wardId: b.wardId,
    facilityId: b.facilityId,
    code: b.code,
    roomNo: b.roomNo,
    dailyRate: num(b.dailyRate),
    chargeServiceCode: b.chargeServiceCode,
    status: b.status as I.BedStatus,
    isActive: b.isActive,
    occupant: a
      ? {
          admissionId: a.id,
          ipdNo: a.ipdNo,
          patientId: a.patientId,
          patientName: a.patientName,
          patientUhid: a.patientUhid,
          patientGender: a.patientGender,
          doctorName: a.doctorName,
          admittedAt: iso(a.admittedAt),
          isMlc: a.isMlc,
        }
      : null,
  };
}

function summaryDto(a: AdmissionRow, bed: { bed: string; ward: string } | undefined): I.AdmissionSummary {
  return {
    id: a.id,
    ipdNo: a.ipdNo,
    facilityId: a.facilityId,
    patientId: a.patientId,
    patientName: a.patientName,
    patientUhid: a.patientUhid,
    patientGender: a.patientGender,
    doctorId: a.doctorId,
    doctorName: a.doctorName,
    admissionType: a.admissionType as I.AdmissionType,
    status: a.status as I.AdmissionStatus,
    bedId: a.currentBedId,
    bedLabel: bed?.bed ?? null,
    wardName: bed?.ward ?? null,
    admittedAt: iso(a.admittedAt),
    dischargedAt: a.dischargedAt ? iso(a.dischargedAt) : null,
    isMlc: a.isMlc,
    lengthOfStay: lengthOfStay(a.admittedAt, a.dischargedAt ?? nowIso()),
  };
}

function stayDto(s: StayRow): I.BedStay {
  return { id: s.id, bedId: s.bedId, wardId: s.wardId, bedLabel: s.bedLabel, dailyRate: num(s.dailyRate), fromAt: iso(s.fromAt), toAt: s.toAt ? iso(s.toAt) : null, reason: s.reason };
}

function vitalsDto(v: Awaited<ReturnType<IpdRepository['insertVitals']>>): I.Vitals {
  return {
    id: v.id,
    recordedAt: iso(v.recordedAt),
    temperatureC: numOrNull(v.temperatureC),
    pulse: v.pulse,
    respRate: v.respRate,
    bpSystolic: v.bpSystolic,
    bpDiastolic: v.bpDiastolic,
    spo2: v.spo2,
    painScore: v.painScore,
    bloodSugar: numOrNull(v.bloodSugar),
    notes: v.notes,
    recordedBy: v.recordedBy,
  };
}

function ioDto(r: Awaited<ReturnType<IpdRepository['insertIntakeOutput']>>): I.IntakeOutput {
  return { id: r.id, direction: r.direction as 'intake' | 'output', category: r.category, volumeMl: r.volumeMl, recordedAt: iso(r.recordedAt), notes: r.notes };
}

function medOrderDto(o: MedOrderRow, given: MedAdminRow[]): I.MedicationOrder {
  const administrations = given.map((g) => ({
    id: g.id,
    orderId: g.orderId,
    status: g.status as I.AdministrationStatus,
    givenAt: iso(g.givenAt),
    notes: g.notes,
    givenByName: g.givenByName,
  }));
  return {
    id: o.id,
    drugName: o.drugName,
    dose: o.dose,
    route: o.route as I.MedRoute,
    frequency: o.frequency,
    instructions: o.instructions,
    isPrn: o.isPrn,
    startAt: iso(o.startAt),
    status: o.status as 'active' | 'stopped',
    stoppedAt: o.stoppedAt ? iso(o.stoppedAt) : null,
    stopReason: o.stopReason,
    orderedByName: o.orderedByName,
    lastGivenAt: administrations.find((a) => a.status === 'given')?.givenAt ?? null,
    administrations,
  };
}

function deviceDto(d: DeviceRow): I.Device {
  return {
    id: d.id,
    deviceType: d.deviceType as I.DeviceType,
    site: d.site,
    notes: d.notes,
    insertedAt: iso(d.insertedAt),
    removedAt: d.removedAt ? iso(d.removedAt) : null,
    removalReason: d.removalReason,
    days: lengthOfStay(d.insertedAt, d.removedAt ?? nowIso()),
  };
}

function roundDto(r: Awaited<ReturnType<IpdRepository['insertRound']>>): I.Round {
  return { id: r.id, doctorId: r.doctorId, doctorName: r.doctorName, roundAt: iso(r.roundAt), subjective: r.subjective, findings: r.findings, plan: r.plan };
}

function chargeDto(c: ChargeRow): I.Charge {
  return {
    id: c.id,
    chargeDate: c.chargeDate,
    serviceCode: c.serviceCode,
    description: c.description,
    qty: Number(c.qty),
    unitPrice: num(c.unitPrice),
    taxRate: num(c.taxRate),
    discount: num(c.discount),
    amount: rupees(chargeAmountPaise(c)),
    status: c.status as 'active' | 'cancelled',
    cancelReason: c.cancelReason,
    createdAt: iso(c.createdAt),
  };
}

function advanceDto(a: AdvanceRow): I.Advance {
  return { id: a.id, paymentId: a.paymentId, receiptNo: a.receiptNo, mode: a.mode as I.AdvanceMode, amount: num(a.amount), receivedAt: iso(a.receivedAt) };
}

function summaryDocDto(s: SummaryRow): I.DischargeSummary {
  return {
    id: s.id,
    admissionId: s.admissionId,
    finalDiagnosis: s.finalDiagnosis,
    presentingComplaints: s.presentingComplaints,
    history: s.history,
    examination: s.examination,
    investigations: s.investigations,
    procedures: s.procedures,
    hospitalCourse: s.hospitalCourse,
    conditionAtDischarge: s.conditionAtDischarge,
    medications: (s.medications ?? []) as I.DischargeMedication[],
    advice: s.advice,
    followUpDate: s.followUpDate,
    followUpNotes: s.followUpNotes,
    status: s.status as 'draft' | 'final',
    finalizedByName: s.finalizedByName,
    finalizedAt: s.finalizedAt ? iso(s.finalizedAt) : null,
    updatedAt: iso(s.updatedAt),
  };
}

export type AdmissionQuery = z.output<typeof contracts.admissionQuerySchema>;

/** The expected discharge date cannot be before the day of admission (IST). */
function assertExpectedDischarge(expected: string | null | undefined, admittedAt: string): void {
  if (expected && expected < istDate(admittedAt)) {
    throw badRequest('invalid_expected_discharge', 'Expected discharge cannot be before the admission date');
  }
}
