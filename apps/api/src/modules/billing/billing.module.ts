import { Module, OnModuleInit } from '@nestjs/common';
import type { billing as B } from '@hms/shared';
import { EventBus } from '../../common/events/event-bus';
import { BillingController } from './billing.controller';
import { BillingRepository } from './billing.repository';
import { BillingService } from './billing.service';
import { ChargesController } from './charges.controller';
import { ChargesRepository } from './charges.repository';
import { ChargesService } from './charges.service';

/**
 * Billing. Owned by the "billing" workstream (see PARALLEL_PLAN.md).
 * Other modules import BillingModule and post what a patient owes with ChargesService.postCharge(tx, …)
 * (billed later in one invoice, or at once with billCharges / billSource). BillingService.createInvoice
 * and getServicePrice remain for direct invoices.
 * Permissions and Zod contracts live in packages/shared/src/modules/billing.ts.
 */
@Module({
  controllers: [BillingController, ChargesController],
  providers: [BillingService, BillingRepository, ChargesService, ChargesRepository],
  exports: [BillingService, ChargesService],
})
export class BillingModule implements OnModuleInit {
  constructor(
    private readonly bus: EventBus,
    private readonly billing: BillingService,
  ) {}

  onModuleInit() {
    // Online payments captured by the patient portal become receipts. Idempotent per intentId.
    this.bus.on<B.PortalPaymentCaptured>('portal.payment.captured', (e) =>
      this.billing.recordOnlinePayment(e.tenantId, e.payload).then(() => undefined),
    );
  }
}
