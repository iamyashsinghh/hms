import { Module } from '@nestjs/common';

/**
 * OPD / EMR. Owned by the "emr" workstream (see PARALLEL_PLAN.md).
 * Layout: emr.controller.ts (routes), emr.service.ts (rules), emr.repository.ts (Drizzle),
 * permissions and Zod contracts in packages/shared/src/modules/emr.ts. Follow src/modules/patients as the example.
 */
@Module({})
export class EmrModule {}
