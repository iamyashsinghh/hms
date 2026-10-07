import { Module } from '@nestjs/common';

/**
 * Insurance & Schemes. Owned by the "insurance" workstream (see PARALLEL_PLAN.md).
 * Layout: insurance.controller.ts (routes), insurance.service.ts (rules), insurance.repository.ts (Drizzle),
 * permissions and Zod contracts in packages/shared/src/modules/insurance.ts. Follow src/modules/patients as the example.
 */
@Module({})
export class InsuranceModule {}
