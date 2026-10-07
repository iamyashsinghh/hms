import { Module } from '@nestjs/common';

/**
 * Notifications. Owned by the "notifications" workstream (see PARALLEL_PLAN.md).
 * Layout: notifications.controller.ts (routes), notifications.service.ts (rules), notifications.repository.ts (Drizzle),
 * permissions and Zod contracts in packages/shared/src/modules/notifications.ts. Follow src/modules/patients as the example.
 */
@Module({})
export class NotificationsModule {}
