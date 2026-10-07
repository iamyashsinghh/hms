import { Injectable, Logger } from '@nestjs/common';
import type { Tx } from '@hms/db';

/**
 * Input of BillingService.createInvoice as agreed in PARALLEL_PLAN.md section 4.
 * Pharmacy sends GST-exclusive unit prices with the tax rate, and discounts as rupee amounts.
 */
export interface PharmacyInvoiceInput {
  patientId: string;
  facilityId: string;
  source: { module: 'pharmacy'; refId: string };
  lines: { itemId?: string; description: string; qty: number; unitPrice: number; taxRate: number; discount?: number }[];
  payNow?: { mode: string; amount: number; ref?: string };
}

export interface PharmacyInvoiceResult {
  invoiceId: string;
  number: string;
  total: number;
  status: string;
}

/**
 * The one place pharmacy talks to billing. Until the billing workstream lands BillingService, sales are
 * recorded with their own PH number and no invoice (invoiceId null). When it lands: import BillingModule in
 * PharmacyModule, inject BillingService here and return `billing.createInvoice(tx, input)`.
 * Walk-in OTC sales without a registered patient are not invoiced (the contract needs a patientId).
 */
@Injectable()
export class PharmacyBillingGateway {
  private readonly logger = new Logger(PharmacyBillingGateway.name);

  async createInvoice(_tx: Tx, input: PharmacyInvoiceInput): Promise<PharmacyInvoiceResult | null> {
    this.logger.debug(`billing not connected yet; sale ${input.source.refId} kept without invoice`);
    return null;
  }
}
