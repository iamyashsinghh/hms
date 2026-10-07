import { Module } from '@nestjs/common';

/**
 * Quality & NABH. Owned by the "quality" workstream (see PARALLEL_PLAN.md).
 * Layout: quality.controller.ts (routes), quality.service.ts (rules), quality.repository.ts (Drizzle),
 * permissions and Zod contracts in packages/shared/src/modules/quality.ts. Follow src/modules/patients as the example.
 */
@Module({})
export class QualityModule {}
