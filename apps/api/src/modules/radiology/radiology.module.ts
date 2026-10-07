import { Module } from '@nestjs/common';

/**
 * Radiology. Owned by the "radiology" workstream (see PARALLEL_PLAN.md).
 * Layout: radiology.controller.ts (routes), radiology.service.ts (rules), radiology.repository.ts (Drizzle),
 * permissions and Zod contracts in packages/shared/src/modules/radiology.ts. Follow src/modules/patients as the example.
 */
@Module({})
export class RadiologyModule {}
