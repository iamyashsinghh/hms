import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { eq, portalAppointments, portalInvoices, portalPaymentIntents, portalPrescriptions, portalReports, sql, and, type Tx } from '@hms/db';
import { DbService } from '../../common/db/db.service';
import { EventBus, type EventEnvelope } from '../../common/events/event-bus';
import { PortalRepository } from './portal.repository';

type Payload = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

/**
 * Keeps the portal's read models in step with other modules' events (PARALLEL_PLAN.md section 4).
 * Each handler runs in the worker, at least once: the event id is recorded in portal.processed_events
 * in the same transaction, so a redelivery is a no-op. Unknown or incomplete payloads are skipped.
 */
@Injectable()
export class PortalEventsService implements OnModuleInit {
  private readonly logger = new Logger(PortalEventsService.name);

  constructor(
    private readonly bus: EventBus,
    private readonly db: DbService,
    private readonly repo: PortalRepository,
  ) {}

  onModuleInit() {
    const on = (topic: string, fn: (tx: Tx, tenantId: string, p: Payload) => Promise<void>) =>
      this.bus.on<Payload>(topic, (e) => this.apply(e, fn));

    on('frontoffice.appointment.booked', (tx, t, p) => this.appointmentBooked(tx, t, p));
    on('frontoffice.appointment.cancelled', (tx, _t, p) => this.appointmentStatus(tx, p, 'cancelled'));
    on('frontoffice.visit.checked_in', (tx, _t, p) => this.appointmentStatus(tx, p, 'completed'));
    on('emr.prescription.created', (tx, t, p) => this.prescriptionCreated(tx, t, p));
    on('billing.invoice.finalized', (tx, t, p) => this.invoiceFinalized(tx, t, p));
    on('billing.invoice.cancelled', (tx, _t, p) => this.invoiceCancelled(tx, p));
    on('billing.payment.received', (tx, _t, p) => this.paymentReceived(tx, p));
    on('lab.report.verified', (tx, t, p) => this.reportIssued(tx, t, p, 'lab'));
    on('radiology.report.finalized', (tx, t, p) => this.reportIssued(tx, t, p, 'radiology'));
  }

  /** Public so tests (and a future backfill) can apply an event directly. */
  async apply(e: EventEnvelope<Payload>, fn: (tx: Tx, tenantId: string, p: Payload) => Promise<void>): Promise<void> {
    await this.db.asTenant({ tenantId: e.tenantId }, async (tx) => {
      if (!(await this.repo.markProcessed(tx, e.tenantId, e.id, e.topic))) return;
      await fn(tx, e.tenantId, e.payload ?? {});
    });
  }

  private async appointmentBooked(tx: Tx, tenantId: string, p: Payload) {
    const appointmentId = str(p.appointmentId);
    const patientId = str(p.patientId);
    const doctorId = str(p.doctorId);
    const start = str(p.start) ?? str(p.slotStart);
    if (!appointmentId || !patientId || !doctorId || !start) return this.skip('frontoffice.appointment.booked', p);

    if (await this.repo.findAppointmentBySource(tx, appointmentId)) return;
    // An online booking front office just booked: attach instead of duplicating.
    const mine = await this.repo.findUnlinkedPortalBooking(tx, patientId, doctorId, start);
    if (mine) {
      await this.repo.updateAppointment(tx, mine.id, { appointmentId, status: 'booked' });
      return;
    }
    await this.repo.insertAppointment(tx, {
      tenantId,
      patientId,
      doctorId,
      doctorName: str(p.doctorName),
      facilityId: str(p.facilityId),
      slotStart: start,
      status: 'booked',
      source: 'desk',
      appointmentId,
    });
  }

  private async appointmentStatus(tx: Tx, p: Payload, status: 'cancelled' | 'completed') {
    const appointmentId = str(p.appointmentId);
    if (!appointmentId) return;
    await tx
      .update(portalAppointments)
      .set({ status })
      .where(and(eq(portalAppointments.appointmentId, appointmentId), sql`${portalAppointments.status} in ('requested', 'booked', 'confirmed')`));
  }

  private async prescriptionCreated(tx: Tx, tenantId: string, p: Payload) {
    const prescriptionId = str(p.prescriptionId);
    const patientId = str(p.patientId);
    if (!prescriptionId || !patientId) return this.skip('emr.prescription.created', p);
    const lines = Array.isArray(p.lines) ? p.lines : [];
    await tx
      .insert(portalPrescriptions)
      .values({
        tenantId,
        prescriptionId,
        patientId,
        doctorId: str(p.doctorId),
        doctorName: str(p.doctorName),
        lines,
        issuedAt: str(p.createdAt) ?? str(p.issuedAt) ?? new Date().toISOString(),
      })
      .onConflictDoNothing();
  }

  private async invoiceFinalized(tx: Tx, tenantId: string, p: Payload) {
    const invoiceId = str(p.invoiceId);
    const patientId = str(p.patientId);
    const total = num(p.total);
    if (!invoiceId || !patientId || total === null) return this.skip('billing.invoice.finalized', p);
    const paid = Math.min(num(p.paid) ?? num(p.amountPaid) ?? 0, total);
    const status = paid >= total ? 'paid' : paid > 0 ? 'partially_paid' : 'unpaid';
    await tx
      .insert(portalInvoices)
      .values({
        tenantId,
        invoiceId,
        patientId,
        number: str(p.number),
        total: total.toFixed(2),
        paid: paid.toFixed(2),
        status,
        issuedAt: str(p.finalizedAt) ?? str(p.issuedAt) ?? new Date().toISOString(),
      })
      .onConflictDoUpdate({
        target: [portalInvoices.tenantId, portalInvoices.invoiceId],
        set: { total: total.toFixed(2), number: str(p.number) },
      });
  }

  private async invoiceCancelled(tx: Tx, p: Payload) {
    const invoiceId = str(p.invoiceId);
    if (!invoiceId) return;
    await tx.update(portalInvoices).set({ status: 'cancelled' }).where(eq(portalInvoices.invoiceId, invoiceId));
  }

  private async paymentReceived(tx: Tx, p: Payload) {
    const invoiceId = str(p.invoiceId);
    const amount = num(p.amount);
    if (!invoiceId || amount === null) return this.skip('billing.payment.received', p);
    await tx
      .update(portalInvoices)
      .set({
        paid: sql`least(${portalInvoices.total}, ${portalInvoices.paid} + ${amount.toFixed(2)}::numeric)`,
        status: sql`case when ${portalInvoices.status} = 'cancelled' then 'cancelled'
                         when ${portalInvoices.paid} + ${amount.toFixed(2)}::numeric >= ${portalInvoices.total} then 'paid'
                         else 'partially_paid' end`,
      })
      .where(eq(portalInvoices.invoiceId, invoiceId));
    // A payment made through the portal: billing passes our intent id as `ref`.
    const ref = str(p.ref);
    if (ref && /^[0-9a-f-]{36}$/i.test(ref)) {
      await tx
        .update(portalPaymentIntents)
        .set({ settledAt: sql`now()` })
        .where(and(eq(portalPaymentIntents.id, ref), eq(portalPaymentIntents.invoiceId, invoiceId)));
    }
  }

  private async reportIssued(tx: Tx, tenantId: string, p: Payload, kind: 'lab' | 'radiology') {
    const reportId = str(p.reportId);
    const patientId = str(p.patientId);
    if (!reportId || !patientId) return this.skip(`${kind}.report`, p);
    await tx
      .insert(portalReports)
      .values({
        tenantId,
        reportId,
        patientId,
        kind,
        title: str(p.title) ?? (kind === 'lab' ? 'Lab report' : 'Radiology report'),
        url: str(p.url),
        issuedAt: str(p.issuedAt) ?? str(p.verifiedAt) ?? new Date().toISOString(),
      })
      .onConflictDoNothing();
  }

  private skip(topic: string, p: Payload) {
    this.logger.warn(`${topic}: payload missing fields, skipped (${Object.keys(p).join(', ')})`);
  }
}
