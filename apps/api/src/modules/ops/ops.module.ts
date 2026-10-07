import { Module } from '@nestjs/common';

/**
 * Facility Services. Owned by the "ops" workstream (see PARALLEL_PLAN.md).
 * Layout: ops.controller.ts (routes), ops.service.ts (rules), ops.repository.ts (Drizzle),
 * permissions and Zod contracts in packages/shared/src/modules/ops.ts. Follow src/modules/patients as the example.
 */
@Module({})
export class OpsModule {}
