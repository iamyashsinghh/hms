import { Module } from '@nestjs/common';

/**
 * SaaS Platform. Owned by the "platform" workstream (see PARALLEL_PLAN.md).
 * Layout: platform.controller.ts (routes), platform.service.ts (rules), platform.repository.ts (Drizzle),
 * permissions and Zod contracts in packages/shared/src/modules/platform.ts. Follow src/modules/patients as the example.
 */
@Module({})
export class PlatformModule {}
