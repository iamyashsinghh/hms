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
}
