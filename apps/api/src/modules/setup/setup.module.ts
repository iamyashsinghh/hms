import { Module } from '@nestjs/common';

/**
 * Hospital Setup. Owned by the "setup" workstream (see PARALLEL_PLAN.md).
 * Layout: setup.controller.ts (routes), setup.service.ts (rules), setup.repository.ts (Drizzle),
 * permissions and Zod contracts in packages/shared/src/modules/setup.ts. Follow src/modules/patients as the example.
 */
@Module({})
export class SetupModule {}
