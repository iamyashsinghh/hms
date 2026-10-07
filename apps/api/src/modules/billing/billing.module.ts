import { Module } from '@nestjs/common';
import { BillingController } from './billing.controller';
import { BillingRepository } from './billing.repository';
import { BillingService } from './billing.service';

/**
 * Billing. Owned by the "billing" workstream (see PARALLEL_PLAN.md).
 * Other modules import BillingModule and call BillingService.createInvoice(tx, …) / getServicePrice(…).
 * Permissions and Zod contracts live in packages/shared/src/modules/billing.ts.
 */
@Module({ controllers: [BillingController], providers: [BillingService, BillingRepository], exports: [BillingService] })
export class BillingModule {}
