import { Module } from '@nestjs/common';

/**
 * Billing. Owned by the "billing" workstream (see PARALLEL_PLAN.md).
 * Layout: billing.controller.ts (routes), billing.service.ts (rules), billing.repository.ts (Drizzle),
 * permissions and Zod contracts in packages/shared/src/modules/billing.ts. Follow src/modules/patients as the example.
 */
@Module({})
export class BillingModule {}
