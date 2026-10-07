import { Module } from '@nestjs/common';

/**
 * Front Office. Owned by the "frontoffice" workstream (see PARALLEL_PLAN.md).
 * Layout: frontoffice.controller.ts (routes), frontoffice.service.ts (rules), frontoffice.repository.ts (Drizzle),
 * permissions and Zod contracts in packages/shared/src/modules/frontoffice.ts. Follow src/modules/patients as the example.
 */
@Module({})
export class FrontofficeModule {}
