import { Module } from '@nestjs/common';

/**
 * Reports & MIS. Owned by the "reports" workstream (see PARALLEL_PLAN.md).
 * Layout: reports.controller.ts (routes), reports.service.ts (rules), reports.repository.ts (Drizzle),
 * permissions and Zod contracts in packages/shared/src/modules/reports.ts. Follow src/modules/patients as the example.
 */
@Module({})
export class ReportsModule {}
