import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  reportsAppointments,
  reportsEncounters,
  reportsIngestedEvents,
  reportsInvoiceLines,
  reportsInvoices,
  reportsOpdVisits,
  reportsPayments,
  reportsPharmacyDispenses,
  type Tx,
} from '@hms/db';
import { reports } from '@hms/shared';
import { DbService } from '../../common/db/db.service';
import { EventBus, type EventEnvelope } from '../../common/events/event-bus';

type Payload = Record<string, unknown>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const id = (v: unknown): string | null => (typeof v === 'string' && UUID_RE.test(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const money = (n: number) => n.toFixed(2);
const when = (v: unknown, fallback: string): string => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : fallback);

/**
 * Projects the events other modules publish (PARALLEL_PLAN.md section 4) into reporting.* facts.
 * Runs in the worker. Each event is recorded in reporting.ingested_events first, so a redelivered
 * event is a no-op. Malformed payloads are logged and skipped rather than retried forever.
 */
@Injectable()
export class ReportsIngestService implements OnModuleInit {
  private readonly logger = new Logger(ReportsIngestService.name);

  constructor(
    private readonly db: DbService,
    private readonly bus: EventBus,
  ) {}

  onModuleInit() {
    for (const topic of reports.REPORTS_CONSUMED_TOPICS) this.bus.on(topic, async (e) => {
      await this.ingest(e);
    });
  }

  /** Returns false when the event was already ingested or is not one reports consumes. */
  async ingest(e: EventEnvelope): Promise<boolean> {
    if (!(reports.REPORTS_CONSUMED_TOPICS as readonly string[]).includes(e.topic)) return false;
    const at = when(e.createdAt, new Date().toISOString());
    return this.db.asTenant({ tenantId: e.tenantId }, async (tx) => {
      const inserted = await tx
        .insert(reportsIngestedEvents)
        .values({ tenantId: e.tenantId, id: e.id, topic: e.topic, payload: e.payload, occurredAt: at })
        .onConflictDoNothing()
        .returning({ id: reportsIngestedEvents.id });
      if (!inserted.length) return false;
      const ok = await this.project(tx, e.tenantId, e.id, e.topic as reports.ReportsConsumedTopic, e.payload, at);
      if (!ok) this.logger.warn(`skipped malformed ${e.topic} event ${e.id}`);
      return ok;
    });
  }

  private async project(tx: Tx, tenantId: string, eventId: string, topic: reports.ReportsConsumedTopic, p: Payload, at: string): Promise<boolean> {
    switch (topic) {
      case 'frontoffice.visit.checked_in': {
        const visitId = id(p.visitId);
        const patientId = id(p.patientId);
        if (!visitId || !patientId) return false;
        await tx
          .insert(reportsOpdVisits)
          .values({
            tenantId,
            visitId,
            patientId,
            appointmentId: id(p.appointmentId),
            doctorId: id(p.doctorId),
            facilityId: id(p.facilityId),
            tokenNo: num(p.tokenNo),
            checkedInAt: when(p.checkedInAt, at),
          })
          .onConflictDoNothing();
        return true;
      }
      case 'frontoffice.appointment.booked': {
        const appointmentId = id(p.appointmentId);
        if (!appointmentId) return false;
        const values = {
          patientId: id(p.patientId),
          doctorId: id(p.doctorId),
          facilityId: id(p.facilityId),
          startAt: typeof p.start === 'string' && !Number.isNaN(Date.parse(p.start)) ? p.start : null,
          bookedAt: at,
        };
        await tx
          .insert(reportsAppointments)
          .values({ tenantId, appointmentId, status: 'booked', ...values })
          .onConflictDoUpdate({ target: [reportsAppointments.tenantId, reportsAppointments.appointmentId], set: values });
        return true;
      }
      case 'frontoffice.appointment.cancelled': {
        const appointmentId = id(p.appointmentId);
        if (!appointmentId) return false;
        await tx
          .insert(reportsAppointments)
          .values({
            tenantId,
            appointmentId,
            patientId: id(p.patientId),
            doctorId: id(p.doctorId),
            facilityId: id(p.facilityId),
            startAt: typeof p.start === 'string' && !Number.isNaN(Date.parse(p.start)) ? p.start : null,
            status: 'cancelled',
            cancelledAt: at,
          })
          .onConflictDoUpdate({
            target: [reportsAppointments.tenantId, reportsAppointments.appointmentId],
            set: { status: 'cancelled', cancelledAt: at },
          });
        return true;
      }
      case 'emr.encounter.signed': {
        const encounterId = id(p.encounterId);
        if (!encounterId) return false;
        await tx
          .insert(reportsEncounters)
          .values({ tenantId, encounterId, patientId: id(p.patientId), doctorId: id(p.doctorId), signedAt: when(p.signedAt, at) })
          .onConflictDoNothing();
        return true;
      }
      case 'billing.invoice.finalized': {
        const invoiceId = id(p.invoiceId);
        if (!invoiceId) return false;
        const rawLines = Array.isArray(p.lines) ? (p.lines as Payload[]) : [];
        const lines = rawLines
          .map((l, i) => {
            const qty = num(l.qty) ?? 1;
            const amount = num(l.amount) ?? (num(l.unitPrice) ?? 0) * qty - (num(l.discount) ?? 0);
            return { lineNo: i + 1, serviceCode: str(l.serviceCode), description: str(l.description) ?? 'Item', qty, amount };
          });
        const total = num(p.total) ?? lines.reduce((s, l) => s + l.amount, 0);
        const source = (p.source ?? {}) as Payload;
        const inserted = await tx
          .insert(reportsInvoices)
          .values({
            tenantId,
            invoiceId,
            number: str(p.number),
            patientId: id(p.patientId),
            facilityId: id(p.facilityId),
            doctorId: id(p.doctorId),
            sourceModule: str(source.module),
            sourceRefId: id(source.refId),
            total: money(total),
            finalizedAt: when(p.finalizedAt, at),
          })
          .onConflictDoNothing()
          .returning({ id: reportsInvoices.id });
        if (inserted.length && lines.length) {
          await tx
            .insert(reportsInvoiceLines)
            .values(lines.map((l) => ({ tenantId, invoiceId, ...l, qty: String(l.qty), amount: money(l.amount) })))
            .onConflictDoNothing();
        }
        return true;
      }
      case 'billing.payment.received': {
        const amount = num(p.amount);
        if (amount === null) return false;
        await tx
          .insert(reportsPayments)
          .values({
            tenantId,
            eventId,
            invoiceId: id(p.invoiceId),
            patientId: id(p.patientId),
            facilityId: id(p.facilityId),
            amount: money(amount),
            mode: str(p.mode)?.toLowerCase() ?? 'other',
            receivedAt: when(p.receivedAt, at),
          })
          .onConflictDoNothing();
        return true;
      }
      case 'pharmacy.dispense.completed': {
        await tx
          .insert(reportsPharmacyDispenses)
          .values({ tenantId, eventId, prescriptionId: id(p.prescriptionId), invoiceId: id(p.invoiceId), dispensedAt: at })
          .onConflictDoNothing();
        return true;
      }
      default:
        return false;
    }
  }
}
