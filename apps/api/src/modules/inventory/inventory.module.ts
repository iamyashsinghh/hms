import { Module } from '@nestjs/common';

/**
 * Inventory & Procurement. Owned by the "inventory" workstream (see PARALLEL_PLAN.md).
 * Layout: inventory.controller.ts (routes), inventory.service.ts (rules), inventory.repository.ts (Drizzle),
 * permissions and Zod contracts in packages/shared/src/modules/inventory.ts. Follow src/modules/patients as the example.
 */
@Module({})
export class InventoryModule {}
