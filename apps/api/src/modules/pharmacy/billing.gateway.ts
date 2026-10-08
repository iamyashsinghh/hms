import { Injectable } from '@nestjs/common';
import { and, billingCharges, eq, type Tx } from '@hms/db';
import type { billing as contracts, ipd } from '@hms/shared';
import { AppError, badRequest } from '../../common/errors/errors';
import { BillingService } from '../billing/billing.service';
import { ChargesService } from '../billing/charges.service';
import { IpdService } from '../ipd/ipd.service';

/** What pharmacy sends to billing. Prices are per unit including GST (MRP), discounts are rupees per line. */
export interface PharmacyInvoiceInput {
  patientId: string;
  facilityId: string;
  source: { module: 'pharmacy'; refId: string };
  lines: { itemId: string; description: string; hsnSac?: string; qty: number; unitPrice: number; taxRate: number; discount: number }[];
  /** Collected at the counter; omitted for credit sales. */
  payNow?: { mode: 'cash' | 'upi' | 'card'; ref?: string };
}

/** One sale line posted to the patient's IPD bill. Price is MRP per unit with GST inside. */
export interface PharmacyChargeInput {
  saleLineId: string;
  itemId: string;
  description: string;
  hsnSac?: string;
  qty: number;
  unitPrice: number;
  taxRate: number;
  /** Rupees for the whole line. */
  discount: number;
}

/**
 * The one place pharmacy talks to billing. Raises a final invoice for a registered patient's sale inside the
 * sale's transaction and records the counter payment. Walk-in OTC sales (no patientId) are not invoiced; the
 * pharmacy bill (PH number) is their bill. Medicines for an admitted patient go on the IPD bill as charges
 * (source pharmacy/<sale id>/<sale line id>) when the hospital's billing rule ipdPharmacy is 'ipd_bill'.
 */
@Injectable()
export class PharmacyBillingGateway {
  constructor(
    private readonly billing: BillingService,
    private readonly charges: ChargesService,
    private readonly ipd: IpdService,
  ) {}

  /** The admission whose IPD bill this patient's medicines go on, or null for a bill of their own. */
  async ipdBillFor(tx: Tx, patientId: string | undefined, facilityId: string): Promise<ipd.CurrentAdmission | null> {
    if (!patientId) return null;
    const admission = await this.ipd.currentAdmission(tx, patientId);
    // Once the IPD bill is final, later medicines are billed on their own.
    if (!admission || admission.billFinal) return null;
    return (await this.charges.rules(tx, facilityId)).ipdPharmacy === 'ipd_bill' ? admission : null;
  }

  /** Posts the sale's lines to the admission (idempotent per sale line). */
  async postIpdCharges(tx: Tx, input: { patientId: string; facilityId: string; admissionId: string; saleId: string; lines: PharmacyChargeInput[] }): Promise<void> {
    for (const l of input.lines) {
      await this.charges.postCharge(tx, {
        patientId: input.patientId,
        facilityId: input.facilityId,
        admissionId: input.admissionId,
        source: { module: 'pharmacy', refId: input.saleId, line: l.saleLineId },
        itemId: l.itemId,
        description: l.description,
        hsnSac: l.hsnSac,
        qty: l.qty,
        unitPrice: l.unitPrice,
        taxRate: l.taxRate,
        priceIncludesTax: true,
        discount: l.discount,
      });
    }
  }

  /** Where each IPD-bill line of a sale stands: pending, billed (on which invoice) or cancelled. Keyed by sale line id. */
  async lineCharges(tx: Tx, saleId: string): Promise<Map<string, { status: string; invoiceId: string | null }>> {
    const rows = await tx
      .select({ line: billingCharges.sourceLine, status: billingCharges.status, invoiceId: billingCharges.invoiceId })
      .from(billingCharges)
      .where(and(eq(billingCharges.sourceModule, 'pharmacy'), eq(billingCharges.sourceRef, saleId)));
    return new Map(rows.map((r) => [r.line, { status: r.status, invoiceId: r.invoiceId }]));
  }

  /** A returned line still pending on the IPD bill: cancel its charge and post the rest of the line again. */
  async reduceIpdCharge(tx: Tx, input: { saleId: string; reason: string; remaining: (PharmacyChargeInput & { patientId: string; facilityId: string; admissionId: string }) | null; saleLineId: string }) {
    await this.charges.cancelBySource(tx, { module: 'pharmacy', refId: input.saleId, line: input.saleLineId }, input.reason);
    if (input.remaining) {
      const { patientId, facilityId, admissionId, ...line } = input.remaining;
      await this.postIpdCharges(tx, { patientId, facilityId, admissionId, saleId: input.saleId, lines: [line] });
    }
  }

  async createInvoice(tx: Tx, input: PharmacyInvoiceInput): Promise<contracts.CreatedInvoice> {
    const base: contracts.CreateInvoice = {
      patientId: input.patientId,
      facilityId: input.facilityId,
      source: input.source,
      lines: input.lines.map((l) => ({ ...l, priceIncludesTax: true })),
    };
    if (!input.payNow) return this.billing.createInvoice(tx, base);

    // Billing may round the total to the rupee, so price a draft first (rolled back) and pay exactly that.
    let due = 0;
    const undo = new Error('price-only draft');
    await tx
      .transaction(async (sp) => {
        due = (await this.billing.createInvoice(sp, { ...base, finalize: false })).total;
        throw undo; // rolls back to the savepoint: no draft invoice is kept
      })
      .catch((e: unknown) => {
        if (e !== undo) throw e;
      });
    return this.billing.createInvoice(tx, { ...base, payNow: due > 0 ? { mode: input.payNow.mode, amount: due, ref: input.payNow.ref } : undefined });
  }

  /** Amount of the invoice that can still be credited (read outside the caller's tx; the invoice is committed). */
  async creditable(invoiceId: string): Promise<number> {
    const inv = await this.billing.getInvoice(invoiceId);
    return Math.max(0, Math.round((inv.total - inv.creditedAmount) * 100) / 100);
  }

  /** Credits returned goods on the sale's invoice; the already-paid part is refunded first. Idempotent on reference. */
  async returnOnInvoice(tx: Tx, invoiceId: string, input: { amount: number; reason: string; refundMode?: string; reference: string }) {
    const refundMode = (['cash', 'upi', 'card'] as const).find((m) => m === input.refundMode);
    try {
      return await this.billing.returnOnInvoice(tx, invoiceId, { ...input, refundMode });
    } catch (e) {
      // Billing asks for a "refundMode"; say it in counter terms.
      if (e instanceof AppError && (e.getResponse() as { code?: string }).code === 'refund_mode_required') {
        throw badRequest('refund_mode_required', 'This bill was already paid, so the money must go back: choose Cash, UPI or Card as the refund mode (not Credit)');
      }
      throw e;
    }
  }
}
