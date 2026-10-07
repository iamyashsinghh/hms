import { Injectable, Logger } from '@nestjs/common';
import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  iso,
  patients,
  pharmacyItems,
  pharmacyPrescriptionLines,
  pharmacyPrescriptions,
  sql,
  type Tx,
} from '@hms/db';
import type { pharmacy } from '@hms/shared';
import type { z } from 'zod';
import { DbService } from '../../common/db/db.service';
import { currentContext } from '../../common/context/request-context';
import type { EventEnvelope } from '../../common/events/event-bus';
import { badRequest, conflict, notFound } from '../../common/errors/errors';
import { pgCode } from './catalog.service';

type RxRow = typeof pharmacyPrescriptions.$inferSelect;

interface IncomingRx {
  tenantId: string;
  prescriptionId: string | null;
  source: 'emr' | 'manual';
  patientId: string;
  doctorId?: string | null;
  doctorName?: string | null;
  facilityId?: string | null;
  notes?: string | null;
  createdBy?: string | null;
  lines: { drugName: string; itemCode?: string; itemId?: string; dose?: string; frequency?: string; days?: number; qty?: number }[];
}

/**
 * Dispense queue. EMR prescriptions arrive through the emr.prescription.created event; paper prescriptions
 * are typed in at the counter. Patient names are read from the patient master for display only.
 */
@Injectable()
export class PharmacyPrescriptionsService {
  private readonly logger = new Logger(PharmacyPrescriptionsService.name);

  constructor(private readonly db: DbService) {}

  /** Handler for emr.prescription.created. Idempotent: a prescription is queued once. */
  async ingestFromEmr(event: EventEnvelope<pharmacy.EmrPrescriptionCreatedEvent>): Promise<void> {
    const p = event.payload;
    await this.db.asTenant({ tenantId: event.tenantId }, async (tx) => {
      const [existing] = await tx
        .select({ id: pharmacyPrescriptions.id })
        .from(pharmacyPrescriptions)
        .where(eq(pharmacyPrescriptions.prescriptionId, p.prescriptionId))
        .limit(1);
      if (existing) return;
      try {
        await this.insert(tx, {
          tenantId: event.tenantId,
          prescriptionId: p.prescriptionId,
          source: 'emr',
          patientId: p.patientId,
          doctorId: p.doctorId ?? null,
          doctorName: p.doctorName ?? null,
          facilityId: p.facilityId ?? null,
          lines: p.lines ?? [],
        });
      } catch (e) {
        if (pgCode(e) === '23505') return;
        throw e;
      }
    });
    this.logger.log(`queued EMR prescription ${p.prescriptionId}`);
  }

  create(input: z.output<typeof pharmacy.createPrescriptionSchema>): Promise<pharmacy.Prescription> {
    const ctx = currentContext()!;
    return this.db.tx(async (tx) => {
      const id = await this.insert(tx, {
        tenantId: ctx.tenantId!,
        prescriptionId: null,
        source: 'manual',
        patientId: input.patientId,
        doctorName: input.doctorName ?? null,
        facilityId: ctx.facilityId ?? null,
        notes: input.notes ?? null,
        createdBy: ctx.userId,
        lines: input.lines,
      }).catch((e: unknown) => {
        if (pgCode(e) === '23503') throw badRequest('unknown_patient', 'Patient not found');
        throw e;
      });
      return (await this.load(tx, [id]))[0]!;
    });
  }

  private async insert(tx: Tx, rx: IncomingRx): Promise<string> {
    const [row] = await tx
      .insert(pharmacyPrescriptions)
      .values({
        tenantId: rx.tenantId,
        prescriptionId: rx.prescriptionId,
        source: rx.source,
        patientId: rx.patientId,
        doctorId: rx.doctorId ?? null,
        doctorName: rx.doctorName ?? null,
        facilityId: rx.facilityId ?? null,
        notes: rx.notes ?? null,
        createdBy: rx.createdBy ?? null,
        updatedBy: rx.createdBy ?? null,
      })
      .returning({ id: pharmacyPrescriptions.id });
    if (rx.lines.length) {
      const matched = await this.matchItems(tx, rx.lines);
      await tx.insert(pharmacyPrescriptionLines).values(
        rx.lines.map((l, i) => ({
          tenantId: rx.tenantId,
          pharmacyPrescriptionId: row!.id,
          lineNo: i + 1,
          drugName: l.drugName,
          itemCode: l.itemCode ?? null,
          itemId: matched[i] ?? null,
          dose: l.dose ?? null,
          frequency: l.frequency ?? null,
          days: l.days ?? null,
          qty: Math.max(0, Math.round(l.qty ?? 0)),
        })),
      );
    }
    return row!.id;
  }

  /** Matches each line to the item master: given itemId, then item code, then exact name. */
  private async matchItems(tx: Tx, lines: IncomingRx['lines']): Promise<(string | undefined)[]> {
    const codes = lines.map((l) => l.itemCode?.toUpperCase()).filter((c): c is string => !!c);
    const names = lines.map((l) => l.drugName.toLowerCase());
    const ids = lines.map((l) => l.itemId).filter((x): x is string => !!x);
    const rows = await tx
      .select({ id: pharmacyItems.id, code: pharmacyItems.code, name: pharmacyItems.name })
      .from(pharmacyItems)
      .where(
        and(
          eq(pharmacyItems.isActive, true),
          sql`(${pharmacyItems.id} in ${ids.length ? ids : ['00000000-0000-0000-0000-000000000000']}
               or upper(${pharmacyItems.code}) in ${codes.length ? codes : ['']}
               or lower(${pharmacyItems.name}) in ${names})`,
        ),
      );
    return lines.map(
      (l) =>
        (l.itemId && rows.find((r) => r.id === l.itemId)?.id) ||
        (l.itemCode && rows.find((r) => r.code.toUpperCase() === l.itemCode!.toUpperCase())?.id) ||
        rows.find((r) => r.name.toLowerCase() === l.drugName.toLowerCase())?.id,
    );
  }

  list(q: z.output<typeof pharmacy.prescriptionQuerySchema>): Promise<{ items: pharmacy.Prescription[]; page: number; pageSize: number; total: number }> {
    return this.db.tx(async (tx) => {
      const term = q.q?.toLowerCase();
      const filter = and(
        q.status === 'open' ? inArray(pharmacyPrescriptions.status, ['pending', 'partial']) : eq(pharmacyPrescriptions.status, q.status),
        term
          ? sql`(${patients.uhid} = upper(${term}) or ${patients.mobile} like ${term + '%'}
                or lower(${patients.firstName} || ' ' || coalesce(${patients.lastName}, '')) like ${'%' + term + '%'})`
          : undefined,
      );
      const base = tx
        .select({ id: pharmacyPrescriptions.id })
        .from(pharmacyPrescriptions)
        .innerJoin(patients, and(eq(patients.tenantId, pharmacyPrescriptions.tenantId), eq(patients.id, pharmacyPrescriptions.patientId)))
        .where(filter);
      const [rows, [{ total }]] = await Promise.all([
        base
          .orderBy(q.status === 'open' ? asc(pharmacyPrescriptions.createdAt) : desc(pharmacyPrescriptions.createdAt))
          .limit(q.pageSize)
          .offset((q.page - 1) * q.pageSize),
        tx
          .select({ total: count() })
          .from(pharmacyPrescriptions)
          .innerJoin(patients, and(eq(patients.tenantId, pharmacyPrescriptions.tenantId), eq(patients.id, pharmacyPrescriptions.patientId)))
          .where(filter),
      ]);
      return { items: await this.load(tx, rows.map((r) => r.id)), page: q.page, pageSize: q.pageSize, total };
    });
  }

  get(id: string): Promise<pharmacy.Prescription> {
    return this.db.tx(async (tx) => {
      const [rx] = await this.load(tx, [id]);
      if (!rx) throw notFound('Prescription');
      return rx;
    });
  }

  cancel(id: string): Promise<pharmacy.Prescription> {
    return this.db.tx(async (tx) => {
      const [row] = await tx.select().from(pharmacyPrescriptions).where(eq(pharmacyPrescriptions.id, id)).for('update').limit(1);
      if (!row) throw notFound('Prescription');
      if (row.status !== 'pending') throw conflict('prescription_not_pending', 'Only a prescription with nothing dispensed can be cancelled');
      await tx.update(pharmacyPrescriptions).set({ status: 'cancelled', updatedBy: currentContext()?.userId }).where(eq(pharmacyPrescriptions.id, id));
      return (await this.load(tx, [id]))[0]!;
    });
  }

  /** Loads prescriptions with lines and patient display fields, keeping the order of `ids`. */
  private async load(tx: Tx, ids: string[]): Promise<pharmacy.Prescription[]> {
    if (!ids.length) return [];
    const [heads, lines] = await Promise.all([
      tx
        .select({ rx: pharmacyPrescriptions, firstName: patients.firstName, lastName: patients.lastName, uhid: patients.uhid })
        .from(pharmacyPrescriptions)
        .innerJoin(patients, and(eq(patients.tenantId, pharmacyPrescriptions.tenantId), eq(patients.id, pharmacyPrescriptions.patientId)))
        .where(inArray(pharmacyPrescriptions.id, ids)),
      tx
        .select({ l: pharmacyPrescriptionLines, itemName: pharmacyItems.name })
        .from(pharmacyPrescriptionLines)
        .leftJoin(pharmacyItems, and(eq(pharmacyItems.tenantId, pharmacyPrescriptionLines.tenantId), eq(pharmacyItems.id, pharmacyPrescriptionLines.itemId)))
        .where(inArray(pharmacyPrescriptionLines.pharmacyPrescriptionId, ids))
        .orderBy(asc(pharmacyPrescriptionLines.lineNo)),
    ]);
    const byId = new Map(heads.map((h) => [h.rx.id, h]));
    return ids
      .map((id) => byId.get(id))
      .filter((h): h is NonNullable<typeof h> => !!h)
      .map((h) => ({
        ...rxDto(h.rx),
        patientName: [h.firstName, h.lastName].filter(Boolean).join(' '),
        uhid: h.uhid,
        lines: lines
          .filter((x) => x.l.pharmacyPrescriptionId === h.rx.id)
          .map(({ l, itemName }) => ({
            id: l.id,
            lineNo: l.lineNo,
            drugName: l.drugName,
            itemCode: l.itemCode,
            itemId: l.itemId,
            itemName: itemName ?? null,
            dose: l.dose,
            frequency: l.frequency,
            days: l.days,
            qty: l.qty,
            dispensedQty: l.dispensedQty,
          })),
      }));
  }
}

function rxDto(r: RxRow): Omit<pharmacy.Prescription, 'patientName' | 'uhid' | 'lines'> {
  return {
    id: r.id,
    prescriptionId: r.prescriptionId,
    source: r.source as pharmacy.Prescription['source'],
    patientId: r.patientId,
    doctorId: r.doctorId,
    doctorName: r.doctorName,
    facilityId: r.facilityId,
    status: r.status as pharmacy.Prescription['status'],
    notes: r.notes,
    createdAt: iso(r.createdAt),
  };
}
