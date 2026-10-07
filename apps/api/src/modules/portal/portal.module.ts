import { Module } from '@nestjs/common';

/**
 * Patient Portal. Owned by the "portal" workstream (see PARALLEL_PLAN.md).
 * Layout: portal.controller.ts (routes), portal.service.ts (rules), portal.repository.ts (Drizzle),
 * permissions and Zod contracts in packages/shared/src/modules/portal.ts. Follow src/modules/patients as the example.
 */
@Module({})
export class PortalModule {}
