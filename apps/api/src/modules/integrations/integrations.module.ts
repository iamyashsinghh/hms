import { Module } from '@nestjs/common';

/**
 * Integrations (ABDM). Owned by the "integrations" workstream (see PARALLEL_PLAN.md).
 * Layout: integrations.controller.ts (routes), integrations.service.ts (rules), integrations.repository.ts (Drizzle),
 * permissions and Zod contracts in packages/shared/src/modules/integrations.ts. Follow src/modules/patients as the example.
 */
@Module({})
export class IntegrationsModule {}
