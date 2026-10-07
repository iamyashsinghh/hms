import { HttpStatus, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { iso, nextCounter, sql, type Tx } from '@hms/db';
import { frontoffice as fo, type Paginated } from '@hms/shared';
import type { z } from 'zod';
import { DbService } from '../../common/db/db.service';
import { AuditService } from '../../common/db/audit.service';
import { OutboxService } from '../../common/events/outbox.service';
import { EventBus } from '../../common/events/event-bus';
import { currentContext } from '../../common/context/request-context';
import { AppError, badRequest, conflict, forbidden, notFound } from '../../common/errors/errors';
import { PatientsService } from '../patients/patients.service';
import { SetupService } from '../setup/setup.service';
import {
  FrontofficeRepository,
  type AppointmentRow,
  type HistoryRow,
  type MergeRow,
  type PatientBriefRow,
  type VisitRow,
} from './frontoffice.repository';
import { addMinutes, istDate, istDayRange } from './frontoffice.time';

type BookInput = z.output<typeof fo.bookAppointmentSchema>;
type RescheduleInput = z.output<typeof fo.rescheduleAppointmentSchema>;
type CheckInInput = z.output<typeof fo.checkInSchema>;
type WalkInInput = z.output<typeof fo.walkInSchema>;
type ListInput = z.output<typeof fo.appointmentListQuerySchema>;
type QueueInput = z.output<typeof fo.queueQuerySchema>;
type DuplicateInput = z.output<typeof fo.duplicateSearchSchema>;
type MergeInput = z.output<typeof fo.mergePatientsSchema>;
type AbhaInput = z.output<typeof fo.abhaCaptureSchema>;

/** Roles that may move any doctor's tokens; a user who is only a doctor moves their own. */
const DESK_ROLES = ['hospital_admin', 'receptionist', 'nurse'];
const EV = fo.FRONTOFFICE_EVENTS;

/**
 * Front office rules: booking, the appointment status machine, check-in and the per-doctor token queue,
 * TV display, duplicate search, patient merge and ABHA capture.
 *
 * Other modules import FrontofficeModule and call book() / getQueue() (see PARALLEL_PLAN.md section 4).
 */
@Injectable()
export class FrontofficeService implements OnModuleInit {
  private readonly logger = new Logger(FrontofficeService.name);

  constructor(
    private readonly db: DbService,
    private readonly repo: FrontofficeRepository,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    private readonly bus: EventBus,
    private readonly patients: PatientsService,
    private readonly setup: SetupService,
  ) {}

  onModuleInit() {
    // When the doctor signs the encounter, close the token if it is still open. Idempotent.
    this.bus.on<{ encounterId: string; patientId: string; doctorId: string }>('emr.encounter.signed', (e) =>
      this.db.asTenant({ tenantId: e.tenantId }, async (tx) => {
        const visit = await this.repo.activeVisitFor(tx, e.payload.patientId, e.payload.doctorId, istDate(e.createdAt));
        if (!visit) return;
        await this.applyVisitAction(tx, visit, 'complete', undefined, undefined, e.tenantId);
      }),
    );
  }

  // ---------- doctors ----------

  /** Doctors working in the caller's facility (from the setup module). */
  listDoctors(): Promise<fo.Doctor[]> {
    return this.setup.listDoctors({ facilityId: currentContext()?.facilityId ?? undefined });
  }

  /** The doctor's schedule slots on a date with how many are already booked. Empty when not working that day. */
  availableSlots(doctorId: string, q: { date: string; facilityId?: string }): Promise<fo.AvailableSlot[]> {
    return this.db.tx(async (tx) => {
      await this.requireDoctor(tx, doctorId);
      const facilityId = await this.resolveFacility(tx, q.facilityId);
      const slots = await this.setup.getDoctorScheduleInTx(tx, doctorId, q.date, facilityId);
      const range = istDayRange(q.date);
      const counts = await this.repo.liveCountsByStart(tx, doctorId, range.from, range.to);
      const now = Date.now();
      return slots.map((sl) => {
        const capacity = sl.maxPatients ?? 1;
        const booked = counts.get(new Date(sl.start).toISOString()) ?? 0;
        return {
          start: sl.start,
          end: sl.end,
          facilityId: sl.facilityId,
          capacity,
          booked,
          available: booked < capacity && new Date(sl.start).getTime() > now - 5 * 60_000,
        };
      });
    });
  }

  // ---------- appointments ----------

  /** Contract: FrontofficeService.book({patientId, doctorId, facilityId, slotStart, type}). */
  book(input: fo.BookAppointment): Promise<fo.Appointment> {
    const data = fo.bookAppointmentSchema.parse(input);
    return this.db.tx((tx) => this.bookIn(tx, data));
  }

  private async bookIn(tx: Tx, input: BookInput): Promise<fo.Appointment> {
    const ctx = currentContext();
    const facilityId = await this.resolveFacility(tx, input.facilityId);
    const patient = await this.requireActivePatient(tx, input.patientId);
    await this.requireDoctor(tx, input.doctorId);

    const { start, end } = await this.resolveSlot(tx, input.doctorId, facilityId, input.slotStart, input.durationMinutes);

    const appointmentNo = await this.setup.nextNumber(tx, 'frontoffice.appointment', { prefix: 'AP', width: 6 });
    const row = await this.repo.insertAppointment(tx, {
        tenantId: this.tenantId(),
        appointmentNo,
        facilityId,
        patientId: patient.id,
        doctorId: input.doctorId,
        slotStart: start,
        slotEnd: end,
        type: input.type,
        source: input.source,
        reason: input.reason ?? null,
        createdBy: ctx?.userId ?? null,
        updatedBy: ctx?.userId ?? null,
      });
    await this.history(tx, row, null, 'booked', 'booked', null, { slotStart: start });
    await this.outbox.publish(tx, EV.appointmentBooked, await this.apptEvent(tx, row));
    return this.toAppointment(tx, row, patient);
  }

  list(q: ListInput): Promise<Paginated<fo.Appointment>> {
    const range = q.date ? istDayRange(q.date) : q.from || q.to ? istDayRange(q.from ?? q.to!, q.to ?? q.from!) : undefined;
    return this.db.tx(async (tx) => {
      const { items, total } = await this.repo.listAppointments(
        tx,
        { ...range, doctorId: q.doctorId, patientId: q.patientId, status: q.status, facilityId: currentContext()?.facilityId },
        q.page,
        q.pageSize,
      );
      return { items: await this.toAppointments(tx, items), page: q.page, pageSize: q.pageSize, total };
    });
  }

  get(id: string): Promise<fo.AppointmentDetail> {
    return this.db.tx(async (tx) => {
      const row = await this.repo.findAppointment(tx, id);
      if (!row) throw notFound('Appointment');
      const [appt] = await this.toAppointments(tx, [row]);
      await this.audit.recordView(tx, 'appointment', id);
      const history = await this.repo.history(tx, id);
      return { ...appt!, history: history.map(toHistory) };
    });
  }

  reschedule(id: string, input: RescheduleInput): Promise<fo.Appointment> {
    return this.db.tx(async (tx) => {
      const row = await this.lockAppointment(tx, id);
      if (row.status !== 'booked') throw this.badState(`Only booked appointments can be rescheduled (this one is ${row.status})`);
      const doctorId = input.doctorId ?? row.doctorId;
      if (doctorId !== row.doctorId) await this.requireDoctor(tx, doctorId);
      const minutes = input.durationMinutes ?? (new Date(row.slotEnd).getTime() - new Date(row.slotStart).getTime()) / 60_000;
      const { start, end } = await this.resolveSlot(tx, doctorId, row.facilityId, input.slotStart, minutes, row.id);
      const updated = await this.repo.updateAppointment(tx, id, {
        doctorId,
        slotStart: start,
        slotEnd: end,
        rescheduleCount: row.rescheduleCount + 1,
        updatedBy: currentContext()?.userId ?? null,
      });
      await this.history(tx, updated, 'booked', 'booked', 'rescheduled', input.reason ?? null, {
        fromStart: iso(row.slotStart),
        toStart: start,
        fromDoctorId: row.doctorId,
        toDoctorId: doctorId,
      });
      await this.outbox.publish(tx, EV.appointmentRescheduled, { ...(await this.apptEvent(tx, updated)), previousStart: iso(row.slotStart) });
      return (await this.toAppointments(tx, [updated]))[0]!;
    });
  }

  /** Contract (used by portal for online cancellation): FrontofficeService.cancel(appointmentId, {reason}). */
  cancel(id: string, input: fo.CancelAppointment): Promise<fo.Appointment> {
    const { reason } = fo.cancelAppointmentSchema.parse(input);
    return this.db.tx(async (tx) => {
      const row = await this.lockAppointment(tx, id);
      if (row.status === 'checked_in' && row.visitId) {
        // Cancelling after check-in also takes the token out of the queue.
        const visit = await this.repo.findVisit(tx, row.visitId, true);
        if (visit && fo.VISIT_TRANSITIONS.cancel.from.includes(visit.status as fo.VisitStatus)) {
          await this.repo.updateVisit(tx, visit.id, { status: 'cancelled', updatedBy: currentContext()?.userId ?? null });
        }
      }
      const updated = await this.moveAppointment(tx, row, 'cancelled', 'cancelled', reason, { cancelReason: reason });
      await this.outbox.publish(tx, EV.appointmentCancelled, { ...(await this.apptEvent(tx, updated)), reason });
      return (await this.toAppointments(tx, [updated]))[0]!;
    });
  }

  noShow(id: string): Promise<fo.Appointment> {
    return this.db.tx(async (tx) => {
      const row = await this.lockAppointment(tx, id);
      const updated = await this.moveAppointment(tx, row, 'no_show', 'no_show', null);
      return (await this.toAppointments(tx, [updated]))[0]!;
    });
  }

  /** Arrival at the desk: creates the visit with the next token for that doctor today. */
  checkIn(id: string, input: CheckInInput): Promise<fo.Visit> {
    return this.db.tx(async (tx) => {
      const row = await this.lockAppointment(tx, id);
      const today = istDate();
      if (istDate(row.slotStart) !== today) {
        throw badRequest('not_today', `This appointment is for ${istDate(row.slotStart)}; reschedule it to today first`);
      }
      if (row.status !== 'booked') throw this.badState(`This appointment is already ${row.status.replace('_', ' ')}`);
      const patient = await this.requireActivePatient(tx, row.patientId);
      const visit = await this.createVisit(tx, {
        facilityId: row.facilityId,
        patientId: row.patientId,
        doctorId: row.doctorId,
        appointmentId: row.id,
        kind: 'appointment',
        priority: input.priority,
        notes: input.notes ?? null,
      });
      await this.moveAppointment(tx, row, 'checked_in', 'checked_in', null, { visitId: visit.id }, { tokenNo: visit.tokenNo });
      return this.toVisit(tx, visit, patient);
    });
  }

  // ---------- walk-ins and the queue ----------

  walkIn(input: WalkInInput): Promise<fo.Visit> {
    return this.db.tx(async (tx) => {
      const facilityId = await this.resolveFacility(tx, input.facilityId);
      const patient = await this.requireActivePatient(tx, input.patientId);
      await this.requireDoctor(tx, input.doctorId);
      const visit = await this.createVisit(tx, {
        facilityId,
        patientId: patient.id,
        doctorId: input.doctorId,
        appointmentId: null,
        kind: 'walk_in',
        priority: input.priority,
        notes: input.notes ?? null,
      });
      return this.toVisit(tx, visit, patient);
    });
  }

  /** Contract: GET /frontoffice/queue?doctorId&date. */
  getQueue(q: QueueInput): Promise<fo.QueueResponse> {
    const date = q.date ?? istDate();
    return this.db.tx(async (tx) => {
      const facilityId = q.facilityId ?? currentContext()?.facilityId ?? null;
      const rows = await this.repo.queue(tx, { date, doctorId: q.doctorId, facilityId, status: q.status });
      const items = await this.toVisits(tx, rows);
      const summary: fo.QueueSummary = { waiting: 0, called: 0, inConsultation: 0, completed: 0, skipped: 0, cancelled: 0 };
      for (const v of rows) {
        const key = v.status === 'in_consultation' ? 'inConsultation' : (v.status as keyof fo.QueueSummary);
        summary[key]++;
      }
      return { date, items, summary };
    });
  }

  getVisit(id: string): Promise<fo.Visit> {
    return this.db.tx(async (tx) => {
      const row = await this.repo.findVisit(tx, id);
      if (!row) throw notFound('Visit');
      return (await this.toVisits(tx, [row]))[0]!;
    });
  }

  transition(id: string, action: fo.VisitAction, room?: string): Promise<fo.Visit> {
    const ctx = currentContext()!;
    return this.db.tx(async (tx) => {
      const visit = await this.repo.findVisit(tx, id, true);
      if (!visit) throw notFound('Visit');
      const onlyDoctor = ctx.roles.includes('doctor') && !ctx.roles.some((r) => DESK_ROLES.includes(r));
      if (onlyDoctor && visit.doctorId !== ctx.userId) throw forbidden("You can only move your own patients' tokens");
      const updated = await this.applyVisitAction(tx, visit, action, room, ctx.userId);
      return (await this.toVisits(tx, [updated]))[0]!;
    });
  }

  private async applyVisitAction(
    tx: Tx,
    visit: VisitRow,
    action: fo.VisitAction,
    room: string | undefined,
    actorId: string | undefined,
    tenantId?: string,
  ): Promise<VisitRow> {
    const rule = fo.VISIT_TRANSITIONS[action];
    if (!rule.from.includes(visit.status as fo.VisitStatus)) {
      throw this.badState(`Cannot ${action} a token that is ${visit.status.replace('_', ' ')}`);
    }
    const now = new Date().toISOString();
    const patch: Partial<VisitRow> = { status: rule.to, updatedBy: actorId ?? null };
    if (room !== undefined) patch.room = room || null;
    if (action === 'call') patch.calledAt = now;
    if (action === 'start') {
      patch.startedAt = now;
      patch.calledAt = visit.calledAt ?? now;
    }
    if (action === 'complete') {
      patch.completedAt = now;
      patch.startedAt = visit.startedAt ?? now;
    }
    const updated = await this.repo.updateVisit(tx, visit.id, patch);

    if (visit.appointmentId) {
      const appt = await this.repo.findAppointment(tx, visit.appointmentId, true);
      const next: Partial<Record<fo.VisitAction, [fo.AppointmentStatus, string]>> = {
        start: ['in_consultation', 'started'],
        complete: ['completed', 'completed'],
        cancel: ['cancelled', 'cancelled'],
      };
      const step = next[action];
      if (appt && step && fo.APPOINTMENT_TRANSITIONS[appt.status as fo.AppointmentStatus].includes(step[0])) {
        const note = action === 'cancel' ? 'Left before consultation' : null;
        await this.moveAppointment(tx, appt, step[0], step[1], note, action === 'cancel' ? { cancelReason: note } : {}, undefined, actorId);
      }
    }

    const payload: fo.VisitStatusChangedEvent = {
      visitId: updated.id,
      patientId: updated.patientId,
      doctorId: updated.doctorId,
      facilityId: updated.facilityId,
      tokenNo: updated.tokenNo,
      status: updated.status as fo.VisitStatus,
      room: updated.room,
    };
    await this.outbox.publish(tx, EV.visitStatusChanged, { ...payload }, tenantId);
    return updated;
  }

  /** TV board: who is being seen and who is next, per doctor, with masked names. */
  display(q: { facilityId?: string; doctorId?: string }): Promise<fo.DisplayBoard> {
    const date = istDate();
    return this.db.tx(async (tx) => {
      const facilityId = q.facilityId ?? currentContext()?.facilityId ?? null;
      const rows = await this.repo.queue(tx, { date, doctorId: q.doctorId, facilityId });
      const [patients, names] = await Promise.all([
        this.repo.patientBriefs(tx, rows.map((r) => r.patientId)),
        this.repo.userNames(tx, rows.map((r) => r.doctorId)),
      ]);
      const byDoctor = new Map<string, VisitRow[]>();
      for (const r of rows) byDoctor.set(r.doctorId, [...(byDoctor.get(r.doctorId) ?? []), r]);
      const mask = (id: string) => {
        const p = patients.get(id);
        return p ? [p.firstName, p.lastName ? `${p.lastName[0]}.` : ''].filter(Boolean).join(' ') : '—';
      };
      const doctors = [...byDoctor.entries()].map(([doctorId, list]) => {
        const serving =
          list.find((v) => v.status === 'in_consultation') ??
          list.filter((v) => v.status === 'called').sort((a, b) => (b.calledAt ?? '').localeCompare(a.calledAt ?? ''))[0];
        const waiting = list.filter((v) => v.status === 'waiting');
        return {
          doctorId,
          doctorName: names.get(doctorId) ?? 'Doctor',
          nowServing: serving
            ? { tokenNo: serving.tokenNo, patientName: mask(serving.patientId), room: serving.room, status: serving.status as fo.VisitStatus }
            : null,
          next: waiting.slice(0, 5).map((v) => ({ tokenNo: v.tokenNo, patientName: mask(v.patientId) })),
          waitingCount: waiting.length,
        };
      });
      doctors.sort((a, b) => a.doctorName.localeCompare(b.doctorName));
      return { date, generatedAt: new Date().toISOString(), doctors };
    });
  }

  // ---------- duplicates, merge, ABHA ----------

  findDuplicates(q: DuplicateInput): Promise<fo.DuplicateCandidate[]> {
    return this.db.tx(async (tx) => {
      const name = [q.firstName, q.lastName].filter(Boolean).join(' ').trim() || undefined;
      const mobile = q.mobile?.replace(/\D/g, '').slice(-10) || undefined;
      const rows = await this.repo.duplicateCandidates(tx, {
        name,
        mobile,
        dateOfBirth: q.dateOfBirth,
        abhaNumber: q.abhaNumber?.replace(/[-\s]/g, '') || undefined,
        excludeId: q.excludeId,
      });
      return rows.map((r) => {
        const reasons: string[] = [];
        if (q.abhaNumber && r.abhaNumber === q.abhaNumber.replace(/[-\s]/g, '')) reasons.push('Same ABHA number');
        if (mobile && r.mobile === mobile) reasons.push('Same mobile');
        if (q.dateOfBirth && r.dateOfBirth === q.dateOfBirth) reasons.push('Same date of birth');
        if (name && fullName(r).toLowerCase().includes(name.toLowerCase().split(' ')[0]!)) reasons.push('Similar name');
        return { patient: { ...brief(r), abhaNumber: r.abhaNumber }, score: Number(r.score), reasons };
      });
    });
  }

  merge(input: MergeInput): Promise<fo.PatientMerge> {
    const ctx = currentContext()!;
    return this.db.tx(async (tx) => {
      // Lock both rows in id order so two concurrent merges cannot deadlock or double-merge.
      const locked = await this.repo.lockPatients(tx, [input.sourcePatientId, input.targetPatientId]);
      const source = locked.find((r) => r.id === input.sourcePatientId);
      if (!source) throw notFound('Patient');
      // Validates both records, retires the source and publishes core.patient.merged.
      await this.patients.markMerged(tx, input.sourcePatientId, input.targetPatientId);
      const target = { id: input.targetPatientId };
      const moved = await this.repo.movePatientRows(tx, source.id, target.id);
      const row = await this.repo.insertMerge(tx, {
        tenantId: ctx.tenantId!,
        sourcePatientId: source.id,
        targetPatientId: target.id,
        reason: input.reason,
        ...moved,
        sourceSnapshot: source as unknown as Record<string, unknown>,
        mergedBy: ctx.userId ?? null,
      });
      const event: fo.PatientMergedEvent = { mergeId: row.id, sourcePatientId: source.id, targetPatientId: target.id };
      await this.outbox.publish(tx, EV.patientMerged, { ...event });
      return toMerge(row);
    });
  }

  listMerges(): Promise<fo.PatientMerge[]> {
    return this.db.tx(async (tx) => (await this.repo.listMerges(tx)).map(toMerge));
  }

  /** Saves the ABHA number on the patient (through PatientsService) and keeps a capture log row. */
  async captureAbha(patientId: string, input: AbhaInput) {
    const ctx = currentContext()!;
    await this.db.tx(async (tx) => {
      await this.requireActivePatient(tx, patientId);
      const clash = await this.repo.patientWithAbha(tx, input.abhaNumber, patientId);
      if (clash) throw conflict('abha_in_use', `This ABHA number is already linked to ${clash.uhid}; merge the records instead`);
    });
    const patient = await this.patients.update(patientId, { abhaNumber: input.abhaNumber });
    await this.db.tx((tx) =>
      this.repo.insertAbha(tx, {
        tenantId: ctx.tenantId!,
        patientId,
        abhaNumber: input.abhaNumber,
        abhaAddress: input.abhaAddress ?? null,
        capturedBy: ctx.userId ?? null,
      }),
    );
    return patient;
  }

  // ---------- helpers ----------

  private tenantId(): string {
    const t = currentContext()?.tenantId;
    if (!t) throw new Error('Front office call without a tenant');
    return t;
  }

  private async resolveFacility(tx: Tx, requested?: string): Promise<string> {
    const ctx = currentContext();
    const allowed = ctx?.facilityIds ?? 'all';
    const facilityId = requested ?? ctx?.facilityId ?? undefined;
    if (facilityId) {
      if (allowed !== 'all' && !allowed.includes(facilityId)) throw forbidden('You do not have access to this facility');
      const active = await this.repo.activeFacilityIds(tx);
      if (!active.includes(facilityId)) throw notFound('Facility');
      return facilityId;
    }
    const active = await this.repo.activeFacilityIds(tx);
    const usable = allowed === 'all' ? active : active.filter((f) => allowed.includes(f));
    if (usable.length === 1) return usable[0]!;
    throw badRequest('facility_required', 'Choose the facility (branch) for this booking');
  }

  private async requireActivePatient(tx: Tx, id: string): Promise<PatientBriefRow> {
    const p = await this.repo.patient(tx, id);
    if (!p) throw notFound('Patient');
    if (!p.isActive) {
      throw badRequest('patient_merged', 'This patient record was merged into another record', { mergedIntoId: p.mergedIntoId });
    }
    return p;
  }

  private async requireDoctor(tx: Tx, id: string): Promise<void> {
    try {
      await this.setup.getDoctorInTx(tx, id);
    } catch (e) {
      if (e instanceof AppError && e.getStatus() === HttpStatus.NOT_FOUND) throw badRequest('not_a_doctor', 'Pick an active doctor');
      throw e;
    }
  }

  private async lockAppointment(tx: Tx, id: string): Promise<AppointmentRow> {
    const row = await this.repo.findAppointment(tx, id, true);
    if (!row) throw notFound('Appointment');
    return row;
  }

  private badState(message: string) {
    return new AppError(HttpStatus.CONFLICT, 'invalid_status', message);
  }

  /**
   * Checks a requested start time against the doctor's setup schedule and returns the slot to store.
   * - Doctor has slots that day: the start must be one of them, and the slot must have room (max patients, default 1).
   * - Doctor has a schedule but no slots that day (day off, leave, other branch): refused.
   * - Doctor has no schedule at all yet: free-form booking of `minutes`, no overlaps.
   * Bookings for one doctor are serialised with a transaction-scoped advisory lock.
   */
  private async resolveSlot(
    tx: Tx,
    doctorId: string,
    facilityId: string,
    requestedStart: string,
    minutes = fo.DEFAULT_SLOT_MINUTES,
    excludeId?: string,
  ): Promise<{ start: string; end: string }> {
    const start = new Date(requestedStart).toISOString();
    if (new Date(start).getTime() < Date.now() - 5 * 60_000) throw badRequest('slot_in_past', 'That time has already passed');
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'frontoffice.doctor.' + doctorId}))`);

    const date = istDate(start);
    const slots = await this.setup.getDoctorScheduleInTx(tx, doctorId, date, facilityId);
    if (slots.length) {
      const slot = slots.find((sl) => new Date(sl.start).toISOString() === start);
      if (!slot) throw badRequest('not_a_slot', "Pick one of the doctor's slots for that day");
      const booked = await this.repo.liveCountAt(tx, doctorId, start, excludeId);
      if (booked >= (slot.maxPatients ?? 1)) throw conflict('slot_taken', 'This slot is already full');
      return { start, end: new Date(slot.end).toISOString() };
    }
    if (await this.hasSchedule(tx, doctorId, date)) {
      throw badRequest('doctor_unavailable', 'The doctor is not available at this facility on that day');
    }
    const end = addMinutes(start, minutes);
    if (await this.repo.overlapping(tx, doctorId, start, end, excludeId)) {
      throw conflict('slot_taken', 'The doctor already has an appointment at this time');
    }
    return { start, end };
  }

  /**
   * Whether the doctor has any weekly schedule, probed as "any slot in the 7 days from `date`, any facility".
   * TODO(setup): replace with a SetupService.hasScheduleInTx() so a leave longer than a week is not read as "no schedule".
   */
  private async hasSchedule(tx: Tx, doctorId: string, date: string): Promise<boolean> {
    for (let i = 0; i < 7; i++) {
      const d = new Date(`${date}T12:00:00Z`);
      d.setUTCDate(d.getUTCDate() + i);
      if ((await this.setup.getDoctorScheduleInTx(tx, doctorId, d.toISOString().slice(0, 10))).length) return true;
    }
    return false;
  }

  private async moveAppointment(
    tx: Tx,
    row: AppointmentRow,
    to: fo.AppointmentStatus,
    event: string,
    note: string | null,
    extra: Partial<AppointmentRow> = {},
    data?: Record<string, unknown>,
    actorId = currentContext()?.userId,
  ): Promise<AppointmentRow> {
    const from = row.status as fo.AppointmentStatus;
    if (!fo.APPOINTMENT_TRANSITIONS[from].includes(to)) {
      throw this.badState(`Cannot move an appointment from ${from.replace('_', ' ')} to ${to.replace('_', ' ')}`);
    }
    const updated = await this.repo.updateAppointment(tx, row.id, { ...extra, status: to, updatedBy: actorId ?? null });
    await this.history(tx, updated, from, to, event, note, data ?? null, actorId);
    return updated;
  }

  private history(
    tx: Tx,
    row: AppointmentRow,
    from: string | null,
    to: string,
    event: string,
    note: string | null,
    data: Record<string, unknown> | null,
    actorId = currentContext()?.userId,
  ) {
    return this.repo.insertHistory(tx, {
      tenantId: row.tenantId,
      appointmentId: row.id,
      fromStatus: from,
      toStatus: to,
      event,
      note,
      data,
      actorId: actorId ?? null,
    });
  }

  private async createVisit(
    tx: Tx,
    v: {
      facilityId: string;
      patientId: string;
      doctorId: string;
      appointmentId: string | null;
      kind: fo.VisitKind;
      priority: fo.VisitPriority;
      notes: string | null;
    },
  ): Promise<VisitRow> {
    const ctx = currentContext();
    const date = istDate();
    const existing = await this.repo.activeVisitFor(tx, v.patientId, v.doctorId, date);
    if (existing) throw conflict('already_in_queue', `This patient is already in the queue with token ${existing.tokenNo}`);
    const tokenNo = await nextCounter(tx, `frontoffice.token.${v.facilityId}.${v.doctorId}.${date}`);
    const visitNo = await this.setup.nextNumber(tx, 'frontoffice.visit', { prefix: 'OP', width: 6 });
    const row = await this.repo.insertVisit(tx, {
      tenantId: this.tenantId(),
      visitNo,
      ...v,
      visitDate: date,
      tokenNo,
      createdBy: ctx?.userId ?? null,
      updatedBy: ctx?.userId ?? null,
    });
    const event: fo.VisitCheckedInEvent = {
      visitId: row.id,
      appointmentId: row.appointmentId,
      patientId: row.patientId,
      doctorId: row.doctorId,
      facilityId: row.facilityId,
      tokenNo: row.tokenNo,
      visitNo: row.visitNo,
      kind: v.kind,
    };
    await this.outbox.publish(tx, EV.visitCheckedIn, { ...event });
    return row;
  }

  private async apptEvent(tx: Tx, row: AppointmentRow): Promise<Record<string, unknown>> {
    const names = await this.repo.userNames(tx, [row.doctorId]);
    const e: fo.AppointmentBookedEvent = {
      appointmentId: row.id,
      patientId: row.patientId,
      doctorId: row.doctorId,
      facilityId: row.facilityId,
      doctorName: names.get(row.doctorId) ?? null,
      start: iso(row.slotStart),
      appointmentNo: row.appointmentNo,
    };
    return { ...e };
  }

  private async toAppointment(tx: Tx, row: AppointmentRow, patient: PatientBriefRow): Promise<fo.Appointment> {
    const names = await this.repo.userNames(tx, [row.doctorId]);
    return toAppointment(row, patient, names.get(row.doctorId) ?? null);
  }

  private async toAppointments(tx: Tx, rows: AppointmentRow[]): Promise<fo.Appointment[]> {
    const [patients, names] = await Promise.all([
      this.repo.patientBriefs(tx, rows.map((r) => r.patientId)),
      this.repo.userNames(tx, rows.map((r) => r.doctorId)),
    ]);
    return rows.map((r) => toAppointment(r, patients.get(r.patientId), names.get(r.doctorId) ?? null));
  }

  private async toVisit(tx: Tx, row: VisitRow, patient: PatientBriefRow): Promise<fo.Visit> {
    const names = await this.repo.userNames(tx, [row.doctorId]);
    return toVisit(row, patient, names.get(row.doctorId) ?? null);
  }

  private async toVisits(tx: Tx, rows: VisitRow[]): Promise<fo.Visit[]> {
    const [patients, names] = await Promise.all([
      this.repo.patientBriefs(tx, rows.map((r) => r.patientId)),
      this.repo.userNames(tx, rows.map((r) => r.doctorId)),
    ]);
    return rows.map((r) => toVisit(r, patients.get(r.patientId), names.get(r.doctorId) ?? null));
  }
}

const fullName = (p: { firstName: string; lastName: string | null }) => [p.firstName, p.lastName].filter(Boolean).join(' ');

function brief(p: PatientBriefRow): fo.PatientBrief {
  return { id: p.id, uhid: p.uhid, name: fullName(p), gender: p.gender, dateOfBirth: p.dateOfBirth, mobile: p.mobile };
}

function toAppointment(r: AppointmentRow, p: PatientBriefRow | undefined, doctorName: string | null): fo.Appointment {
  return {
    id: r.id,
    appointmentNo: r.appointmentNo,
    facilityId: r.facilityId,
    patientId: r.patientId,
    patient: p ? brief(p) : undefined,
    doctorId: r.doctorId,
    doctorName,
    slotStart: iso(r.slotStart),
    slotEnd: iso(r.slotEnd),
    type: r.type as fo.AppointmentType,
    source: r.source as fo.AppointmentSource,
    status: r.status as fo.AppointmentStatus,
    reason: r.reason,
    cancelReason: r.cancelReason,
    rescheduleCount: r.rescheduleCount,
    visitId: r.visitId,
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
  };
}

function toVisit(r: VisitRow, p: PatientBriefRow | undefined, doctorName: string | null): fo.Visit {
  return {
    id: r.id,
    visitNo: r.visitNo,
    facilityId: r.facilityId,
    patientId: r.patientId,
    patient: p ? brief(p) : undefined,
    doctorId: r.doctorId,
    doctorName,
    appointmentId: r.appointmentId,
    visitDate: r.visitDate,
    tokenNo: r.tokenNo,
    kind: r.kind as fo.VisitKind,
    priority: r.priority as fo.VisitPriority,
    status: r.status as fo.VisitStatus,
    room: r.room,
    notes: r.notes,
    checkedInAt: iso(r.checkedInAt),
    calledAt: iso(r.calledAt),
    startedAt: iso(r.startedAt),
    completedAt: iso(r.completedAt),
  };
}

function toHistory(h: HistoryRow): fo.AppointmentHistory {
  return {
    id: h.id,
    fromStatus: h.fromStatus as fo.AppointmentStatus | null,
    toStatus: h.toStatus as fo.AppointmentStatus,
    event: h.event,
    note: h.note,
    data: h.data,
    actorId: h.actorId,
    at: iso(h.at),
  };
}

function toMerge(m: MergeRow): fo.PatientMerge {
  return {
    id: m.id,
    sourcePatientId: m.sourcePatientId,
    targetPatientId: m.targetPatientId,
    reason: m.reason,
    movedAppointments: m.movedAppointments,
    movedVisits: m.movedVisits,
    mergedBy: m.mergedBy,
    mergedAt: iso(m.mergedAt),
  };
}
