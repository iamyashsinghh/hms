import { Module } from '@nestjs/common';

/**
 * Referral & CRM. Owned by the "crm" workstream (see PARALLEL_PLAN.md).
 * Layout: crm.controller.ts (routes), crm.service.ts (rules), crm.repository.ts (Drizzle),
 * permissions and Zod contracts in packages/shared/src/modules/crm.ts. Follow src/modules/patients as the example.
 */
@Module({})
export class CrmModule {}
