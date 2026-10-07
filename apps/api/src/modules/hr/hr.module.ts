import { Module } from '@nestjs/common';

/**
 * HR & Roster. Owned by the "hr" workstream (see PARALLEL_PLAN.md).
 * Layout: hr.controller.ts (routes), hr.service.ts (rules), hr.repository.ts (Drizzle),
 * permissions and Zod contracts in packages/shared/src/modules/hr.ts. Follow src/modules/patients as the example.
 */
@Module({})
export class HrModule {}
