import { Module } from '@nestjs/common';

/**
 * Laboratory. Owned by the "lab" workstream (see PARALLEL_PLAN.md).
 * Layout: lab.controller.ts (routes), lab.service.ts (rules), lab.repository.ts (Drizzle),
 * permissions and Zod contracts in packages/shared/src/modules/lab.ts. Follow src/modules/patients as the example.
 */
@Module({})
export class LabModule {}
