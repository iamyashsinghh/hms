import { Injectable } from '@nestjs/common';
import type { Tx } from '@hms/db';
import type { billing as contracts } from '@hms/shared';
import { BillingService } from '../billing/billing.service';

/** What pharmacy sends to billing. Prices are per unit including GST (MRP), discounts are rupees per line. */
export interface PharmacyInvoiceInput {
  patientId: string;
  facilityId: string;
  source: { module: 'pharmacy'; refId: string };
  lines: { itemId: string; description: string; hsnSac?: string; qty: number; unitPrice: number; taxRate: number; discount: number }[];
  /** Collected at the counter; omitted for credit sales. */
  payNow?: { mode: 'cash' | 'upi' | 'card'; ref?: string };
}

/**
 * The one place pharmacy talks to billing. Raises a final invoice for a registered patient's sale inside the
 * sale's transaction and records the counter payment. Walk-in OTC sales (no patientId) are not invoiced; the
 * pharmacy bill (PH number) is their bill.
 */
@Injectable()
export class PharmacyBillingGateway {
  constructor(private readonly billing: BillingService) {}

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
  returnOnInvoice(tx: Tx, invoiceId: string, input: { amount: number; reason: string; refundMode?: string; reference: string }) {
    const refundMode = (['cash', 'upi', 'card'] as const).find((m) => m === input.refundMode);
    return this.billing.returnOnInvoice(tx, invoiceId, { ...input, refundMode });
  }
}
