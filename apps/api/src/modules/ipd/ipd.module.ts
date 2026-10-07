import { Module } from '@nestjs/common';

/**
 * IPD & Nursing. Owned by the "ipd" workstream (see PARALLEL_PLAN.md).
 * Layout: ipd.controller.ts (routes), ipd.service.ts (rules), ipd.repository.ts (Drizzle),
 * permissions and Zod contracts in packages/shared/src/modules/ipd.ts. Follow src/modules/patients as the example.
 */
@Module({})
export class IpdModule {}
