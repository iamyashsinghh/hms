import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { iso, sql, type Tx } from '@hms/db';
import { portal, type Paginated } from '@hms/shared';
import { DbService } from '../../common/db/db.service';
import { currentContext } from '../../common/context/request-context';
import { OutboxService } from '../../common/events/outbox.service';
import { badRequest, conflict, notFound } from '../../common/errors/errors';
import type { PatientPrincipal } from './portal-auth.guard';
import { PortalGateway } from './portal.gateway';
import { PortalPatientsService } from './portal-patients.service';
import {
  PortalRepository,
  type AppointmentRow,
  type FeedbackRow,
  type InvoiceRow,
  type PaymentIntentRow,
  type PrescriptionRow,
  type ReportRow,
} from './portal.repository';

const MAX_DAYS_AHEAD = portal.PORTAL_MAX_BOOKING_DAYS;
const LIVE = ['requested', 'booked', 'confirmed'];

@Injectable()
export class PortalService {
  constructor(
    private readonly db: DbService,
    private readonly repo: PortalRepository,
    private readonly gateway: PortalGateway,
    private readonly patients: PortalPatientsService,
    private readonly outbox: OutboxService,
  ) {}

  // ---------- doctors & slots ----------

  listDoctors(q: portal.DoctorQuery): Promise<portal.PortalDoctor[]> {
    return this.gateway.listDoctors(q);
  }

  /** Front office's bookable slots, minus online bookings still in flight here. */
  async slots(tenantId: string, doctorId: string, date: string, facilityId?: string): Promise<Array<portal.PortalSlot & { facilityId: string }>> {
    await this.doctor(doctorId);
    const facilityIds = facilityId ? [facilityId] : (await this.patients.facilities(tenantId)).map((f) => f.id);
    const slots = await this.gateway.slots(doctorId, date, facilityIds);
    if (!slots.length) return [];
    const from = slots[0]!.start;
    const to = new Date(new Date(slots[slots.length - 1]!.start).getTime() + 1).toISOString();
    const online = await this.db.tx((tx) => this.repo.takenSlots(tx, doctorId, from, to));
    const now = Date.now();
    return slots.map((s) => {
      const t = new Date(s.start).getTime();
      return {
        start: new Date(t).toISOString(),
        end: new Date(s.end).toISOString(),
        facilityId: s.facilityId,
        available: s.available && t > now && !online.has(t),
      };
    });
  }

  // ---------- appointments ----------

  /** Books straight into front office's diary (it rejects clashes), then keeps the portal's own copy. */
  async book(p: PatientPrincipal, input: portal.BookAppointment): Promise<portal.PortalAppointment> {
    const scope = await this.patients.scope(p.accountId, input.patientId);
    const doctor = await this.doctor(input.doctorId);
    const start = new Date(input.slotStart);
    if (start.getTime() <= Date.now()) throw badRequest('slot_in_past', 'This time has already passed');
    if (start.getTime() > Date.now() + MAX_DAYS_AHEAD * 86_400_000) {
      throw badRequest('slot_too_far', `You can book up to ${MAX_DAYS_AHEAD} days ahead`);
    }
    const date = new Date(start.getTime() + 330 * 60_000).toISOString().slice(0, 10); // IST date
    const slot = (await this.slots(p.tenantId, input.doctorId, date, input.facilityId)).find((s) => new Date(s.start).getTime() === start.getTime());
    if (!slot) throw badRequest('slot_unavailable', 'This slot is not available');
    if (!slot.available) throw conflict('slot_taken', 'Someone just booked this slot. Please pick another time.');
    const facilityId = slot.facilityId;

    const { appointmentId } = await this.gateway.book({
      patientId: input.patientId,
      doctorId: input.doctorId,
      facilityId,
      slotStart: slot.start,
      slotEnd: slot.end,
      reason: input.reason || null,
    });
    const row = await this.db.tx(async (tx) => {
      const values = {
        accountId: p.accountId,
        doctorName: doctor.name,
        facilityId,
        status: 'booked',
        source: 'portal',
        reason: input.reason || null,
      };
      // The front office event may already have created the row (worker raced us): adopt it.
      const existing = await this.repo.findAppointmentBySource(tx, appointmentId);
      const saved = existing
        ? (await this.repo.updateAppointment(tx, existing.id, values))!
        : await this.repo.insertAppointment(tx, {
            ...values,
            tenantId: p.tenantId,
            patientId: input.patientId,
            doctorId: input.doctorId,
            slotStart: slot.start,
            appointmentId,
          });
      await this.publishAppointment(tx, 'confirmed', saved);
      return saved;
    });
    return toAppointment(row, scope);
  }

  async listAppointments(p: PatientPrincipal, q: { patientId?: string; scope: 'upcoming' | 'past' | 'all' }): Promise<portal.PortalAppointment[]> {
    const scope = await this.patients.scope(p.accountId, q.patientId);
    if (!scope.size) return [];
    const rows = await this.db.tx((tx) => this.repo.listAppointments(tx, [...scope.keys()], q.scope));
    return rows.map((r) => toAppointment(r, scope));
  }

  async cancel(p: PatientPrincipal, id: string): Promise<portal.PortalAppointment> {
    const scope = await this.patients.scope(p.accountId);
    const row = await this.db.tx((tx) => this.repo.findAppointment(tx, id));
    if (!row || !scope.has(row.patientId)) throw notFound('Appointment');
    if (!LIVE.includes(row.status)) throw conflict('not_cancellable', 'This appointment can no longer be cancelled');
    if (new Date(row.slotStart).getTime() <= Date.now()) throw conflict('not_cancellable', 'This appointment has already started');
    if (row.appointmentId) await this.gateway.cancel(row.appointmentId, 'Cancelled by patient (portal)');
    const updated = await this.db.tx(async (tx) => {
      const u = await this.repo.updateAppointment(tx, id, { status: 'cancelled' });
      await this.publishAppointment(tx, 'cancelled', u!, 'Cancelled by patient (portal)');
      return u!;
    });
    return toAppointment(updated, scope);
  }

  // ---------- records ----------

  async prescriptions(p: PatientPrincipal, patientId?: string): Promise<portal.PortalPrescription[]> {
    const scope = await this.patients.scope(p.accountId, patientId);
    if (!scope.size) return [];
    const rows = await this.db.tx((tx) => this.repo.listPrescriptions(tx, [...scope.keys()]));
    return rows.map((r) => toPrescription(r, scope));
  }

  async bills(p: PatientPrincipal, patientId?: string): Promise<portal.PortalInvoice[]> {
    const scope = await this.patients.scope(p.accountId, patientId);
    if (!scope.size) return [];
    return this.db.tx(async (tx) => {
      const rows = await this.repo.listInvoices(tx, [...scope.keys()]);
      const pending = await this.repo.unsettledPaid(tx, rows.map((r) => r.invoiceId));
      return rows.map((r) => toInvoice(r, scope, pending.get(r.invoiceId) ?? 0));
    });
  }

  /** What the hospital has charged but not billed yet (read-only; paid once the desk makes the bill). */
  async pendingCharges(p: PatientPrincipal, patientId?: string): Promise<portal.PortalPendingCharges[]> {
    const scope = await this.patients.scope(p.accountId, patientId);
    if (!scope.size) return [];
    const pending = await this.gateway.pendingCharges([...scope.keys()]);
    return [...pending.entries()].map(([id, c]) => ({
      patientId: id,
      patientName: scope.get(id) ?? '',
      count: c.count,
      total: (c.paise / 100).toFixed(2),
      oldestDate: c.oldestDate,
    }));
  }

  async reports(p: PatientPrincipal, patientId?: string): Promise<portal.PortalReport[]> {
    const scope = await this.patients.scope(p.accountId, patientId);
    if (!scope.size) return [];
    const rows = await this.db.tx((tx) => this.repo.listReports(tx, [...scope.keys()]));
    return rows.map((r) => toReport(r, scope));
  }

  // ---------- online payment (Razorpay stub) ----------

  async createPaymentIntent(p: PatientPrincipal, invoiceId: string): Promise<portal.PortalPaymentIntent> {
    const scope = await this.patients.scope(p.accountId);
    return this.db.tx(async (tx) => {
      const inv = await this.repo.findInvoiceBySource(tx, invoiceId);
      if (!inv || !scope.has(inv.patientId)) throw notFound('Bill');
      const pending = (await this.repo.unsettledPaid(tx, [inv.invoiceId])).get(inv.invoiceId) ?? 0;
      const due = round2(Number(inv.total) - Number(inv.paid) - pending);
      if (inv.status === 'cancelled' || due <= 0) throw conflict('nothing_due', 'Nothing is due on this bill');
      const row = await this.repo.insertIntent(tx, {
        tenantId: p.tenantId,
        accountId: p.accountId,
        patientId: inv.patientId,
        invoiceId: inv.invoiceId,
        amount: due.toFixed(2),
        provider: 'razorpay_stub',
        providerOrderId: `order_stub_${randomBytes(9).toString('base64url')}`,
        status: 'created',
      });
      return toIntent(row);
    });
  }

  /** With the stub provider the checkout "signature" is the literal 'stub'; real Razorpay verification goes here later. */
  async confirmPayment(p: PatientPrincipal, intentId: string, input: portal.ConfirmPayment): Promise<portal.PortalPaymentIntent> {
    return this.db.tx(async (tx) => {
      const intent = await this.repo.findIntent(tx, intentId);
      if (!intent || intent.accountId !== p.accountId) throw notFound('Payment');
      if (intent.status === 'paid') return toIntent(intent);
      if (intent.status !== 'created') throw conflict('payment_closed', 'This payment can no longer be completed');
      if (input.signature !== 'stub') {
        await this.repo.updateIntent(tx, intent.id, { status: 'failed', providerPaymentId: input.providerPaymentId });
        throw badRequest('payment_verification_failed', 'Payment could not be verified');
      }
      const row = (await this.repo.updateIntent(tx, intent.id, {
        status: 'paid',
        providerPaymentId: input.providerPaymentId,
        paidAt: sql`now()` as unknown as string,
      }))!;
      const event: portal.PaymentCapturedEvent = {
        intentId: row.id,
        invoiceId: row.invoiceId,
        patientId: row.patientId,
        amount: row.amount,
        mode: 'online',
        provider: 'razorpay_stub',
        providerPaymentId: input.providerPaymentId,
      };
      await this.outbox.publish(tx, 'portal.payment.captured', { ...event });
      return toIntent(row);
    });
  }

  // ---------- feedback ----------

  async feedback(p: PatientPrincipal, input: portal.CreateFeedback): Promise<portal.PortalFeedback> {
    const scope = await this.patients.scope(p.accountId, input.patientId);
    return this.db.tx(async (tx) => {
      if (input.appointmentRequestId) {
        const appt = await this.repo.findAppointment(tx, input.appointmentRequestId);
        if (!appt || appt.patientId !== input.patientId) throw notFound('Appointment');
        if (['cancelled', 'rejected'].includes(appt.status)) throw conflict('appointment_not_held', 'This appointment was cancelled, so it cannot be rated');
        if (new Date(appt.slotStart).getTime() > Date.now()) throw badRequest('visit_not_done', 'You can give feedback after your visit');
      }
      const row = await this.repo.insertFeedback(tx, {
        tenantId: p.tenantId,
        accountId: p.accountId,
        patientId: input.patientId,
        rating: input.rating,
        comment: input.comment || null,
        appointmentRequestId: input.appointmentRequestId ?? null,
      });
      const event: portal.FeedbackSubmittedEvent = { feedbackId: row.id, patientId: row.patientId, rating: row.rating };
      await this.outbox.publish(tx, 'portal.feedback.submitted', { ...event });
      return toFeedback(row, scope);
    });
  }

  // ---------- staff side ----------

  async staffBookings(q: { status?: string; date?: string; page: number; pageSize: number }): Promise<Paginated<portal.PortalAppointment>> {
    return this.db.tx(async (tx) => {
      const { items, total } = await this.repo.staffListAppointments(tx, q, q.page, q.pageSize);
      const names = await this.patientNames(tx, items.map((i) => i.patientId));
      return { items: items.map((r) => toAppointment(r, names)), page: q.page, pageSize: q.pageSize, total };
    });
  }

  async decide(id: string, input: portal.DecideBooking): Promise<portal.PortalAppointment> {
    const ctx = currentContext()!;
    return this.db.tx(async (tx) => {
      const row = await this.repo.findAppointment(tx, id);
      if (!row || row.source !== 'portal') throw notFound('Booking request');
      if (row.status !== 'requested') throw conflict('already_decided', 'This request was already handled');
      const updated = (await this.repo.updateAppointment(tx, id, {
        status: input.decision === 'confirm' ? 'confirmed' : 'rejected',
        staffNote: input.note || null,
        decidedBy: ctx.userId,
        decidedAt: sql`now()` as unknown as string,
      }))!;
      await this.publishAppointment(tx, input.decision === 'confirm' ? 'confirmed' : 'rejected', updated, input.note || null);
      const names = await this.patientNames(tx, [row.patientId]);
      return toAppointment(updated, names);
    });
  }

  /** portal.appointment.confirmed / rejected / cancelled, in the same transaction as the status change. */
  private async publishAppointment(
    tx: Tx,
    kind: 'confirmed' | 'rejected' | 'cancelled',
    row: AppointmentRow,
    note: string | null = null,
  ): Promise<void> {
    const event: portal.PortalAppointmentEvent = {
      requestId: row.id,
      appointmentId: row.appointmentId ?? null,
      patientId: row.patientId,
      doctorId: row.doctorId,
      doctorName: row.doctorName ?? '',
      facilityId: row.facilityId ?? null,
      slotStart: iso(row.slotStart),
      note,
    };
    await this.outbox.publish(tx, `portal.appointment.${kind}`, { ...event });
  }

  async staffFeedback(q: { page: number; pageSize: number }): Promise<Paginated<portal.PortalFeedback> & portal.FeedbackSummary> {
    return this.db.tx(async (tx) => {
      const { items, total, average } = await this.repo.listFeedback(tx, q.page, q.pageSize);
      const names = await this.patientNames(tx, items.map((i) => i.patientId));
      return { items: items.map((r) => toFeedback(r, names)), page: q.page, pageSize: q.pageSize, total, count: total, average };
    });
  }

  // ---------- helpers ----------

  private async doctor(doctorId: string): Promise<portal.PortalDoctor> {
    const doctors = await this.listDoctors({});
    const d = doctors.find((x) => x.userId === doctorId);
    if (!d) throw notFound('Doctor');
    return d;
  }

  /**
   * Display names for a page of staff-side rows: one read-only query instead of PatientsService.get per row,
   * which would also log a chart view for every name shown in a list.
   */
  private async patientNames(tx: Tx, ids: string[]): Promise<Map<string, string>> {
    if (!ids.length) return new Map();
    const res = await tx.execute<{ id: string; name: string }>(sql`
      select id, first_name || coalesce(' ' || last_name, '') as name from clinical.patients
       where id in (${sql.join([...new Set(ids)].map((i) => sql`${i}::uuid`), sql`, `)})`);
    return new Map(res.rows.map((r) => [r.id, r.name]));
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function toAppointment(r: AppointmentRow, names: Map<string, string>): portal.PortalAppointment {
  return {
    id: r.id,
    patientId: r.patientId,
    patientName: names.get(r.patientId) ?? '',
    doctorId: r.doctorId,
    doctorName: r.doctorName,
    facilityId: r.facilityId,
    slotStart: iso(r.slotStart),
    status: r.status as portal.AppointmentStatus,
    source: r.source as 'portal' | 'desk',
    appointmentId: r.appointmentId,
    reason: r.reason,
    staffNote: r.staffNote,
    createdAt: iso(r.createdAt),
  };
}

function toPrescription(r: PrescriptionRow, names: Map<string, string>): portal.PortalPrescription {
  return {
    id: r.id,
    prescriptionId: r.prescriptionId,
    patientId: r.patientId,
    patientName: names.get(r.patientId) ?? '',
    doctorId: r.doctorId,
    doctorName: r.doctorName,
    lines: r.lines as portal.PortalPrescriptionLine[],
    issuedAt: iso(r.issuedAt),
  };
}

function toInvoice(r: InvoiceRow, names: Map<string, string>, pendingOnline: number): portal.PortalInvoice {
  const paid = round2(Number(r.paid) + pendingOnline);
  const due = Math.max(0, round2(Number(r.total) - paid));
  const status: portal.PortalInvoiceStatus =
    r.status === 'cancelled' ? 'cancelled' : due <= 0 ? 'paid' : paid > 0 ? 'partially_paid' : 'unpaid';
  return {
    id: r.id,
    invoiceId: r.invoiceId,
    number: r.number,
    patientId: r.patientId,
    patientName: names.get(r.patientId) ?? '',
    total: Number(r.total).toFixed(2),
    paid: paid.toFixed(2),
    due: due.toFixed(2),
    status,
    issuedAt: iso(r.issuedAt),
  };
}

function toReport(r: ReportRow, names: Map<string, string>): portal.PortalReport {
  return {
    id: r.id,
    reportId: r.reportId,
    patientId: r.patientId,
    patientName: names.get(r.patientId) ?? '',
    kind: r.kind as portal.PortalReport['kind'],
    title: r.title,
    url: r.url,
    issuedAt: iso(r.issuedAt),
  };
}

function toIntent(r: PaymentIntentRow): portal.PortalPaymentIntent {
  return {
    id: r.id,
    invoiceId: r.invoiceId,
    amount: Number(r.amount).toFixed(2),
    currency: 'INR',
    provider: 'razorpay_stub',
    providerOrderId: r.providerOrderId,
    status: r.status as portal.PortalPaymentIntent['status'],
    createdAt: iso(r.createdAt),
  };
}

function toFeedback(r: FeedbackRow, names: Map<string, string>): portal.PortalFeedback {
  return {
    id: r.id,
    patientId: r.patientId,
    patientName: names.get(r.patientId) ?? '',
    rating: r.rating,
    comment: r.comment,
    appointmentRequestId: r.appointmentRequestId,
    createdAt: iso(r.createdAt),
  };
}
