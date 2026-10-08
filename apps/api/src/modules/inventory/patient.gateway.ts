import { Injectable } from '@nestjs/common';
import { eq, inArray, patients, pharmacyItems, type Tx } from '@hms/db';
import { pharmacy, type ipd, type Paginated } from '@hms/shared';
import { badRequest, conflict, notFound } from '../../common/errors/errors';
import { ChargesService } from '../billing/charges.service';
import { IpdService } from '../ipd/ipd.service';
import { num } from './money';

/** Who an issue is for: a patient, and the admission when they are (or were) admitted. */
export interface IssuePatient {
  patientId: string;
  patientName: string;
  admission: ipd.CurrentAdmission | null;
}

/** One issued line to charge: price is the batch sale rate (MRP-style, GST inside). */
export interface ConsumableLine {
  issueLineId: string;
  itemId: string;
  batchNo: string;
  expiryDate: string;
  qty: number;
  saleRate: number;
}

/**
 * Consumables issued for a patient. Inventory asks IPD who the patient / admission is and posts charges to the
 * patient account through billing, following the hospital's billing rule `consumables` ('charge' the patient,
 * or 'hospital_cost': no charge).
 */
@Injectable()
export class InventoryPatientGateway {
  constructor(
    private readonly charges: ChargesService,
    private readonly ipd: IpdService,
  ) {}

  /** Admitted patients to pick from when issuing (current facility). */
  admitted(q: string | undefined): Promise<Paginated<ipd.AdmissionSummary>> {
    return this.ipd.listAdmissions({ status: 'admitted', q: q || undefined, pageSize: 20 });
  }

  /** Resolves the patient / admission an issue is for (inside the issue's transaction). */
  async resolve(tx: Tx, input: { patientId?: string; admissionId?: string }): Promise<IssuePatient | null> {
    if (input.admissionId) {
      const a = await this.ipd.admissionInTx(tx, input.admissionId);
      if (a.status !== 'admitted') throw conflict('not_admitted', `Admission ${a.ipdNo} is ${a.status}`);
      if (input.patientId && input.patientId !== a.patientId) throw badRequest('admission_other_patient', 'That admission belongs to another patient');
      return { patientId: a.patientId, patientName: a.patientName, admission: a };
    }
    if (!input.patientId) return null;
    const admission = await this.ipd.currentAdmission(tx, input.patientId);
    if (admission) return { patientId: admission.patientId, patientName: admission.patientName, admission };
    const [p] = await tx.select({ firstName: patients.firstName, lastName: patients.lastName }).from(patients).where(eq(patients.id, input.patientId)).limit(1);
    if (!p) throw notFound('Patient');
    return { patientId: input.patientId, patientName: [p.firstName, p.lastName].filter(Boolean).join(' '), admission: null };
  }

  /** Items whose GST is not a billing slab cannot be charged; say so before any stock moves. */
  async assertChargeable(tx: Tx, itemIds: string[], facilityId: string): Promise<boolean> {
    if ((await this.charges.rules(tx, facilityId)).consumables !== 'charge') return false;
    const items = await tx.select({ name: pharmacyItems.name, gstRate: pharmacyItems.gstRate }).from(pharmacyItems).where(inArray(pharmacyItems.id, [...new Set(itemIds)]));
    const bad = items.find((i) => !pharmacy.isGstSlab(num(i.gstRate)));
    if (bad) throw badRequest('gst_rate_not_slab', `${bad.name} has GST ${num(bad.gstRate)}%, which Billing cannot charge. Edit the item and pick a GST slab.`);
    return true;
  }

  /** One charge per issued line (source inventory/<issue id>/<issue line id>); free items are not charged. */
  async charge(tx: Tx, input: { issueId: string; facilityId: string; patient: IssuePatient; lines: ConsumableLine[] }): Promise<void> {
    const ids = [...new Set(input.lines.map((l) => l.itemId))];
    const items = new Map(
      (await tx.select().from(pharmacyItems).where(inArray(pharmacyItems.id, ids))).map((i) => [i.id, i]),
    );
    // On an admission whose bill is still open, the charge joins the IPD bill; otherwise it waits on the account.
    const admission = input.patient.admission && !input.patient.admission.billFinal ? input.patient.admission : null;
    for (const l of input.lines) {
      if (l.saleRate <= 0) continue;
      const item = items.get(l.itemId)!;
      await this.charges.postCharge(tx, {
        patientId: input.patient.patientId,
        facilityId: admission?.facilityId ?? input.facilityId,
        ...(admission ? { admissionId: admission.id } : { standalone: true }),
        source: { module: 'inventory', refId: input.issueId, line: l.issueLineId },
        itemId: l.itemId,
        description: `${item.name} (batch ${l.batchNo}, exp ${l.expiryDate})`,
        hsnSac: item.hsnCode ?? undefined,
        qty: l.qty,
        unitPrice: l.saleRate,
        taxRate: num(item.gstRate),
        priceIncludesTax: true,
      });
    }
  }
}
